/**
 * Local-first backend for the highlight-generation demo.
 *
 * Implements the exact REST/WS contract the frontend calls (see
 * ../src/api/*.ts), but instead of the synthetic fixtures the old mock used,
 * it runs the REAL Python pipeline (`python3 -m pipeline.run`) as a
 * subprocess and streams its real progress over WebSocket, then serves the
 * real rendered media. It also supports a pre-computed CACHE path: a new job
 * whose uploaded video matches an already-rendered `out/<id>` binds straight
 * to those clips with zero pipeline latency.
 *
 * The dormant AWS backend (CDK / Lambda / Step Functions) is left untouched;
 * this server is the local stand-in that teammates point the UI at via the
 * VITE_REST_API_URL / VITE_WS_API_URL env vars (see .env.demo).
 *
 * Run via `npm run dev` (server + vite --mode demo) or `npm run local-server`.
 */
import { createServer } from 'node:http'
import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve, basename } from 'node:path'
import { existsSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { WebSocketServer } from 'ws'

import { resolveRoles } from './lib/roles.mjs'
import { saveUpload, uploadPathForKey } from './lib/uploads.mjs'
import { buildPipelineArgs, DEFAULT_S3_BUCKET } from './lib/pipeline-args.mjs'
import { spawnPipeline } from './lib/runner.mjs'
import { parseLogLine, toProgressEvent } from './lib/progress.mjs'
import { loadManifestClips, loadCompilations, clipsDir } from './lib/manifest.mjs'
import { scanCachedStreams, matchCachedStream } from './lib/cache.mjs'
import {
  listEditorVideos,
  loadEditorClips,
  resolveStreamId,
  getEditorAiEdit,
  getEditorClip,
  editorClipPreviewUrl,
  applyClipCaptions,
  compileCompilation,
  loadCompilationEdl,
} from './lib/editor-api.mjs'
import { contentTypeFor, parseRange } from './lib/media-range.mjs'
import { deriveStreamId } from './lib/stream-id.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(__dirname, '../..')

/**
 * Resolve the Python interpreter for the pipeline subprocess:
 *   1. explicit PIPELINE_PYTHON env var
 *   2. the repo-local .venv created for the pipeline (so `npm run dev` works
 *      without the user activating the venv)
 *   3. fall back to `python3` on PATH
 */
function resolvePython() {
  if (process.env.PIPELINE_PYTHON) return process.env.PIPELINE_PYTHON
  const venvPython = join(REPO_ROOT, '.venv', 'bin', 'python')
  if (existsSync(venvPython)) return venvPython
  return 'python3'
}

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, Range',
  'Access-Control-Allow-Methods': 'GET, POST, PATCH, PUT, OPTIONS',
  'Access-Control-Expose-Headers': 'Content-Range, Accept-Ranges, Content-Length',
}

function sendJson(res, status, body) {
  const text = body === undefined ? '' : JSON.stringify(body)
  res.writeHead(status, { 'Content-Type': 'application/json', ...CORS_HEADERS })
  res.end(text)
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let raw = ''
    req.on('data', (chunk) => (raw += chunk))
    req.on('end', () => {
      if (!raw) return resolve(null)
      try {
        resolve(JSON.parse(raw))
      } catch (err) {
        reject(err)
      }
    })
    req.on('error', reject)
  })
}

/**
 * Start the local server.
 *
 * @param {object} [opts]
 * @param {number} [opts.port]        REST port (0 = ephemeral, for tests)
 * @param {number} [opts.wsPort]      WebSocket port
 * @param {string} [opts.outRoot]     where pipeline output lives (default <repo>/out)
 * @param {string} [opts.uploadsRoot] where uploads are written (default <repo>/uploads)
 * @param {string} [opts.cwd]         cwd for the pipeline subprocess (default repo root)
 * @param {string} [opts.python]      interpreter (default: PIPELINE_PYTHON env, else repo .venv, else 'python3')
 * @param {string} [opts.s3Bucket]
 * @param {boolean} [opts.spawnEnabled] set false in tests to skip real python
 * @param {(msg:string)=>void} [opts.log]
 * @returns {{ server, wss, close: ()=>Promise<void>, whenReady: Promise<{port:number,wsPort:number}> }}
 */
export function startServer(opts = {}) {
  const outRoot = opts.outRoot ?? join(REPO_ROOT, 'out')
  const uploadsRoot = opts.uploadsRoot ?? join(REPO_ROOT, 'uploads')
  const cwd = opts.cwd ?? REPO_ROOT
  const python = opts.python ?? resolvePython()
  const s3Bucket = opts.s3Bucket ?? DEFAULT_S3_BUCKET
  // Cached-only deploy sets CACHED_ONLY=1 to disable the Python subprocess.
  const spawnEnabled = opts.spawnEnabled ?? process.env.CACHED_ONLY !== '1'
  // When set, any upload that matches no pre-rendered stream is bound to this
  // demo stream (instead of hanging as `pending`) so the hosted flow always
  // completes. Gated on spawn being disabled so live dev/tests are unaffected.
  const demoFallbackStreamId = opts.demoFallbackStreamId ?? process.env.DEMO_STREAM_ID ?? null
  // Replay a cached run as a paced "processing" animation (DEMO_PACING=1).
  const pacedDemo = opts.pacedDemo ?? process.env.DEMO_PACING === '1'
  const log = opts.log ?? ((m) => console.log(m))

  // Per-server state (kept off the module scope so tests are isolated).
  const jobs = new Map() // jobId -> job
  const clipsByJob = new Map() // jobId -> Clip[]
  const uploadedFilenames = new Map() // key -> filename
  const subscribers = new Map() // jobId -> Set<ws>
  const refinementsByJob = new Map()
  const handoffs = new Map()
  let cachedStreams = [] // stream-ids with a complete manifest

  const ctx = { port: opts.port ?? 3000, wsPort: opts.wsPort ?? 3001 }
  // Absolute base, used only to parse incoming request URLs.
  const baseUrl = () => `http://localhost:${ctx.port}`
  // Base baked into client-facing media/upload URLs. In a container behind a
  // different origin, set PUBLIC_BASE_URL='' so these become relative
  // (/media/..., /mock-upload/...) and resolve same-origin on any domain.
  const mediaBase = () =>
    process.env.PUBLIC_BASE_URL != null ? process.env.PUBLIC_BASE_URL : baseUrl()

  function broadcast(jobId, event) {
    for (const ws of subscribers.get(jobId) ?? []) {
      if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(event))
    }
  }

  async function completeFromManifest(job, streamId) {
    try {
      const clips = await loadManifestClips(outRoot, streamId, mediaBase())
      clipsByJob.set(job.jobId, clips)
      job.status = 'completed'
      broadcast(job.jobId, { jobId: job.jobId, stage: 'pipeline', status: 'completed' })
      log(`[${job.jobId}] completed with ${clips.length} clips (stream ${streamId})`)
    } catch (err) {
      job.status = 'failed'
      broadcast(job.jobId, { jobId: job.jobId, stage: 'pipeline', status: 'failed' })
      log(`[${job.jobId}] FAILED to load manifest for stream ${streamId}: ${err.message}`)
    }
  }

  // --- Live path: spawn the real pipeline for this job ------------------
  function startLivePipeline(job, videoPath, chatLogPath) {
    const streamId = job.streamId
    const outdir = join(outRoot, streamId)
    const args = buildPipelineArgs({ videoPath, chatLogPath, streamId, outdir, s3Bucket })
    log(`[${job.jobId}] spawning: ${python} ${args.join(' ')}`)
    job.status = 'in_progress'

    const handle = spawnPipeline({
      python,
      args,
      cwd,
      env: process.env,
      onStdoutLine: (line) => {
        log(`[${job.jobId}] ${line}`)
        const parsed = parseLogLine(line)
        const event = toProgressEvent(job.jobId, parsed)
        if (event) {
          job.status = 'in_progress'
          job.stage = event.stage
          broadcast(job.jobId, event)
        }
      },
      onStderr: (chunk) => log(`[${job.jobId}][stderr] ${chunk.replace(/\n$/, '')}`),
      onExit: (code, stderr) => {
        if (code === 0) {
          completeFromManifest(job, streamId)
        } else {
          job.status = 'failed'
          log(`[${job.jobId}] pipeline exited ${code}\n${stderr}`)
          broadcast(job.jobId, { jobId: job.jobId, stage: 'pipeline', status: 'failed' })
        }
      },
    })
    job.runner = handle
    job.pid = handle.state.pid
  }

  // Scripted stage labels for the paced "processing" animation when replaying
  // a cached run; each maps to a phase in the frontend stepper (STAGE_TO_PHASE).
  const DEMO_STAGES = [
    'Normalizing video',
    'Transcribing speech',
    'Analyzing video (Rekognition)',
    'Analyzing audio',
    'Analyzing chat',
    'Scoring highlight candidates',
    'Rendering clips',
  ]

  // --- Cache path: bind to an already-rendered stream -------------------
  function bindCachedStream(job, streamId) {
    job.streamId = streamId
    job.source = 'cache'
    log(`[${job.jobId}] binding to cached stream ${streamId} (no subprocess)`)
    if (!pacedDemo) {
      setTimeout(() => {
        job.status = 'in_progress'
        broadcast(job.jobId, { jobId: job.jobId, stage: 'Loading cached highlights', status: 'started' })
        completeFromManifest(job, streamId)
      }, 300)
      return
    }
    // Paced replay: walk the stage labels over ~4.2s so the animation reads as
    // a real run, then complete from the manifest. The 5s REST poll is a safety
    // net if the client's WS subscription misses an early frame.
    const step = 600
    job.status = 'in_progress'
    DEMO_STAGES.forEach((stage, i) => {
      setTimeout(() => broadcast(job.jobId, { jobId: job.jobId, stage, status: 'started' }), i * step)
    })
    setTimeout(() => completeFromManifest(job, streamId), DEMO_STAGES.length * step)
  }

  const server = createServer(async (req, res) => {
    const url = new URL(req.url, baseUrl())
    const path = url.pathname

    if (req.method === 'OPTIONS') {
      res.writeHead(204, CORS_HEADERS)
      return res.end()
    }

    // GET /media/:streamId/:file  — real rendered clips/thumbnails with Range.
    const mediaMatch = path.match(/^\/media\/([^/]+)\/([^/]+)$/)
    if (req.method === 'GET' && mediaMatch) {
      return serveMedia(res, req, decodeURIComponent(mediaMatch[1]), decodeURIComponent(mediaMatch[2]))
    }

    // PUT /mock-upload/:key  — stands in for the presigned S3 PUT; writes bytes.
    if (req.method === 'PUT' && path.startsWith('/mock-upload/')) {
      const key = decodeURIComponent(path.slice('/mock-upload/'.length))
      try {
        const dest = await saveUpload(uploadsRoot, key, req)
        log(`upload saved: ${key} -> ${dest}`)
        return sendJson(res, 200, { ok: true })
      } catch (err) {
        return sendJson(res, 500, { error: `failed to save upload: ${err.message}` })
      }
    }

    let body = null
    if (req.method === 'POST' || req.method === 'PATCH') {
      try {
        body = await readJsonBody(req)
      } catch {
        return sendJson(res, 400, { error: 'invalid JSON body' })
      }
    }

    // POST /uploads/presign
    if (req.method === 'POST' && path === '/uploads/presign') {
      const jobDraftId = body?.jobDraftId ?? randomUUID()
      const filename = body?.filename ?? 'upload.mp4'
      const key = `${jobDraftId}/${filename}`
      uploadedFilenames.set(key, filename)
      return sendJson(res, 200, {
        uploadUrl: `${mediaBase()}/mock-upload/${encodeURIComponent(key)}`,
        key,
        jobDraftId,
        expiresIn: 900,
      })
    }

    // POST /uploads/confirm
    if (req.method === 'POST' && path === '/uploads/confirm') {
      return sendJson(res, 200, { confirmed: true })
    }

    // POST /jobs
    if (req.method === 'POST' && path === '/jobs') {
      const jobId = randomUUID()
      const sourceKeys = body?.sourceKeys ?? []
      const { videoKey, chatLogKey, videoName, chatLogName } = resolveRoles(sourceKeys)

      // For the known demo clips (6910008 / 3654414), pin the live run to a
      // stable, filename-derived out/<id> so a re-upload reuses that run's
      // output (and binds to it via the cache path once rendered). Any other
      // upload keeps the unique-per-job UUID so runs can't collide.
      const streamId = deriveStreamId([videoName, chatLogName]) ?? jobId

      const job = {
        jobId,
        status: 'pending',
        targets: body?.targets ?? [],
        createdAt: new Date().toISOString(),
        streamId,
        source: 'live',
      }
      jobs.set(jobId, job)

      // 1. Cache path: does the uploaded video match a pre-rendered stream?
      const cachedSid = matchCachedStream(videoName, cachedStreams)
      if (cachedSid) {
        bindCachedStream(job, cachedSid)
        return sendJson(res, 200, { jobId, status: job.status })
      }

      // 1b. Cached-only demo fallback: bind ANY otherwise-unmatched upload to
      // the configured demo stream so the hosted flow always completes instead
      // of hanging as `pending`. Only active when spawn is disabled AND a valid
      // fallback stream is configured, so live dev/tests keep their behavior.
      if (!spawnEnabled && demoFallbackStreamId && cachedStreams.includes(demoFallbackStreamId)) {
        bindCachedStream(job, demoFallbackStreamId)
        return sendJson(res, 200, { jobId, status: job.status })
      }

      // 2. Live path needs BOTH a video and a chat log (resolved by extension).
      if (!videoKey || !chatLogKey) {
        job.status = 'failed'
        log(`[${jobId}] missing ${!videoKey ? 'video' : 'chat-log'} in sourceKeys; failing`)
        setTimeout(
          () => broadcast(jobId, { jobId, stage: 'pipeline', status: 'failed' }),
          100,
        )
        return sendJson(res, 200, { jobId, status: 'pending' })
      }

      if (spawnEnabled) {
        const videoPath = uploadPathForKey(uploadsRoot, videoKey)
        const chatLogPath = uploadPathForKey(uploadsRoot, chatLogKey)
        startLivePipeline(job, videoPath, chatLogPath)
      }
      return sendJson(res, 200, { jobId, status: 'pending' })
    }

    // GET /jobs/:jobId
    const jobMatch = path.match(/^\/jobs\/([^/]+)$/)
    if (req.method === 'GET' && jobMatch) {
      const job = jobs.get(jobMatch[1])
      if (job) {
        return sendJson(res, 200, {
          jobId: job.jobId,
          status: job.status,
          targets: job.targets,
          createdAt: job.createdAt,
        })
      }
      // Fallback: an already-rendered run on disk (e.g. after a server
      // restart, or opening /highlights/<streamId> for a prior run) is still
      // addressable by its out/<id> dir name.
      if (existsSync(join(outRoot, jobMatch[1], 'clips', 'manifest.json'))) {
        return sendJson(res, 200, {
          jobId: jobMatch[1],
          status: 'completed',
          targets: [],
          createdAt: new Date().toISOString(),
        })
      }
      return sendJson(res, 404, { error: 'job not found' })
    }

    // GET /jobs/:jobId/clips  — clips + (optional) cross-clip compilation reels
    const clipsMatch = path.match(/^\/jobs\/([^/]+)\/clips$/)
    if (req.method === 'GET' && clipsMatch) {
      const jobId = clipsMatch[1]
      // Resolve which on-disk stream this job's compilations live under: a
      // live/cache job carries its streamId; an on-disk run is addressed by
      // its dir name (jobId === streamId).
      const job = jobs.get(jobId)
      const onDisk = existsSync(join(outRoot, jobId, 'clips', 'manifest.json'))
      const streamId = job?.streamId ?? (onDisk ? jobId : null)
      const compilations = streamId ? await loadCompilations(outRoot, streamId) : []

      if (clipsByJob.has(jobId)) {
        return sendJson(res, 200, { clips: clipsByJob.get(jobId), compilations })
      }
      // Fallback: load straight from an on-disk run's manifest.
      if (onDisk) {
        try {
          const clips = await loadManifestClips(outRoot, jobId, mediaBase())
          return sendJson(res, 200, { clips, compilations })
        } catch {
          return sendJson(res, 200, { clips: [], compilations })
        }
      }
      return sendJson(res, 200, { clips: [], compilations: [] })
    }

    // PATCH /jobs/:jobId/clips/:clipId  (crop-confirm)
    const cropMatch = path.match(/^\/jobs\/([^/]+)\/clips\/([^/]+)$/)
    if (req.method === 'PATCH' && cropMatch) {
      const clips = clipsByJob.get(cropMatch[1]) ?? []
      const clip = clips.find((c) => c.clipId === cropMatch[2])
      if (!clip) return sendJson(res, 404, { error: 'clip not found' })
      if (typeof body?.start === 'number') clip.start = body.start
      if (typeof body?.end === 'number') clip.end = body.end
      clip.cropConfirmed = true
      return sendJson(res, 200, {
        clipId: clip.clipId,
        start: clip.start,
        end: clip.end,
        cropConfirmed: clip.cropConfirmed,
      })
    }

    // POST /jobs/:jobId/refinements
    const refinementMatch = path.match(/^\/jobs\/([^/]+)\/refinements$/)
    if (req.method === 'POST' && refinementMatch) {
      const jobId = refinementMatch[1]
      const refinement = {
        jobId,
        refinementId: randomUUID(),
        targetType: body?.targetType,
        targetIds: body?.targetIds ?? [],
        actionType: body?.actionType,
        chipType: body?.chipType ?? null,
        text: body?.text ?? null,
        status: 'completed',
        createdAt: new Date().toISOString(),
      }
      const list = refinementsByJob.get(jobId) ?? []
      list.push(refinement)
      refinementsByJob.set(jobId, list)
      return sendJson(res, 200, refinement)
    }

    // POST /jobs/:jobId/confirm-selection
    const confirmMatch = path.match(/^\/jobs\/([^/]+)\/confirm-selection$/)
    if (req.method === 'POST' && confirmMatch) {
      const jobId = confirmMatch[1]
      const clips = clipsByJob.get(jobId) ?? []
      const clipIds = body?.clipIds ?? []
      const handoffId = randomUUID()
      handoffs.set(
        handoffId,
        clips
          .filter((c) => clipIds.includes(c.clipId))
          .map((c) => ({ clipId: c.clipId, titleNative: c.titleNative, thumbUrl: c.thumbUrl })),
      )
      return sendJson(res, 200, { handoffId })
    }

    // POST /jobs/:jobId/compilations/:compilationId/compile — plan + write the
    // reel's multi-clip EDL (pipeline/compile_edl.py). The frontend "Compile
    // this reel" button calls this, then deep-links into the editor.
    const compileMatch = path.match(
      /^\/jobs\/([^/]+)\/compilations\/([^/]+)\/compile$/,
    )
    if (req.method === 'POST' && compileMatch) {
      const jobId = decodeURIComponent(compileMatch[1])
      const compilationId = decodeURIComponent(compileMatch[2])
      try {
        const out = await compileCompilation({
          outRoot, jobs, jobId, compilationId, python, cwd,
        })
        if (out.error) return sendJson(res, out.status ?? 404, { error: out.error })
        log(`[${jobId}] compiled reel ${compilationId}: ${out.response.summary}`)
        return sendJson(res, 200, out.response)
      } catch (err) {
        log(`[compile] ${jobId}/${compilationId} failed: ${err.message}`)
        return sendJson(res, 500, { error: `compilation failed: ${err.message}` })
      }
    }

    // GET /handoff/:handoffId
    const handoffMatch = path.match(/^\/handoff\/([^/]+)$/)
    if (req.method === 'GET' && handoffMatch) {
      const clips = handoffs.get(handoffMatch[1])
      if (!clips) return sendJson(res, 404, { error: 'handoff not found' })
      return sendJson(res, 200, { clips })
    }

    // === Editor-shaped API (apps/editor points here via
    // NEXT_PUBLIC_BACKEND_API_URL). Serves the real pipeline output in the
    // editor's highlight-api schema so any processed VOD opens in the editor
    // with that run's real auto-edit. See lib/editor-api.mjs. ===

    // GET /api/videos  — list every stream with a manifest (+ live-job aliases)
    if (req.method === 'GET' && path === '/api/videos') {
      return sendJson(res, 200, await listEditorVideos(outRoot, jobs))
    }

    // GET /api/videos/:videoId/clips
    const evClipsMatch = path.match(/^\/api\/videos\/([^/]+)\/clips$/)
    if (req.method === 'GET' && evClipsMatch) {
      const videoId = decodeURIComponent(evClipsMatch[1])
      const idPart = videoId.replace(/^video_/, '')
      const streamId = await resolveStreamId(idPart, outRoot, jobs)
      if (!streamId) return sendJson(res, 404, { error: 'video not found' })
      const clips = await loadEditorClips(outRoot, idPart, streamId, baseUrl())
      return sendJson(res, 200, { clips })
    }

    // GET /api/videos/:videoId/compilations/:compilationId/edl — the editor
    // loads this to concatenate a reel's member clips onto one timeline.
    const evCompMatch = path.match(
      /^\/api\/videos\/([^/]+)\/compilations\/([^/]+)\/edl$/,
    )
    if (req.method === 'GET' && evCompMatch) {
      const videoId = decodeURIComponent(evCompMatch[1])
      const compilationId = decodeURIComponent(evCompMatch[2])
      try {
        const out = await loadCompilationEdl({
          outRoot, jobs, videoId, compilationId, python, cwd,
        })
        if (out.error) return sendJson(res, out.status ?? 404, { error: out.error })
        return sendJson(res, 200, out.response)
      } catch (err) {
        log(`[compilation-edl] ${videoId}/${compilationId} failed: ${err.message}`)
        return sendJson(res, 500, { error: `compilation EDL failed: ${err.message}` })
      }
    }

    // POST /api/clips/:clipId/ai-edit
    const aiEditMatch = path.match(/^\/api\/clips\/([^/]+)\/ai-edit$/)
    if (req.method === 'POST' && aiEditMatch) {
      const scopedClipId = decodeURIComponent(aiEditMatch[1])
      const out = await getEditorAiEdit({
        outRoot, jobs, baseUrl: baseUrl(), scopedClipId, request: body ?? {},
      })
      if (out.error) return sendJson(res, 404, { error: out.error })
      return sendJson(res, 200, out.response)
    }

    // GET /api/clips/:clipId/status  — stub: renders are pre-baked, so ready.
    const clipStatusMatch = path.match(/^\/api\/clips\/([^/]+)\/status$/)
    if (req.method === 'GET' && clipStatusMatch) {
      const scopedClipId = decodeURIComponent(clipStatusMatch[1])
      const previewUrl = await editorClipPreviewUrl({ outRoot, jobs, baseUrl: baseUrl(), scopedClipId })
      return sendJson(res, 200, { status: 'ready', previewUrl })
    }

    // POST /api/clips/:clipId/render  — stub: return the clip marked ready.
    const clipRenderMatch = path.match(/^\/api\/clips\/([^/]+)\/render$/)
    if (req.method === 'POST' && clipRenderMatch) {
      const scopedClipId = decodeURIComponent(clipRenderMatch[1])
      const clip = await getEditorClip({ outRoot, jobs, baseUrl: baseUrl(), scopedClipId })
      if (!clip) return sendJson(res, 404, { error: 'clip not found' })
      const previewUrl = await editorClipPreviewUrl({ outRoot, jobs, baseUrl: baseUrl(), scopedClipId })
      return sendJson(res, 200, { ...clip, renderStatus: 'ready', previewUrl })
    }

    // POST /api/clips/:clipId/apply-captions  — burn karaoke captions on demand.
    const applyCaptionsMatch = path.match(/^\/api\/clips\/([^/]+)\/apply-captions$/)
    if (req.method === 'POST' && applyCaptionsMatch) {
      const scopedClipId = decodeURIComponent(applyCaptionsMatch[1])
      try {
        const out = await applyClipCaptions({
          outRoot, jobs, baseUrl: baseUrl(), scopedClipId, python, cwd,
        })
        if (out.error) return sendJson(res, out.status ?? 404, { error: out.error })
        return sendJson(res, 200, out.response)
      } catch (err) {
        log(`[apply-captions] ${scopedClipId} failed: ${err.message}`)
        return sendJson(res, 500, { error: `caption burn failed: ${err.message}` })
      }
    }

    // PATCH /api/clips/:clipId  — accept metadata/trim edits, echo the clip.
    const clipPatchMatch = path.match(/^\/api\/clips\/([^/]+)$/)
    if (req.method === 'PATCH' && clipPatchMatch) {
      const scopedClipId = decodeURIComponent(clipPatchMatch[1])
      const clip = await getEditorClip({ outRoot, jobs, baseUrl: baseUrl(), scopedClipId })
      if (!clip) return sendJson(res, 404, { error: 'clip not found' })
      const patch = body ?? {}
      const allowed = ['start', 'end', 'hook', 'hookEn', 'caption', 'captionEn', 'hashtags']
      for (const k of allowed) if (k in patch) clip[k] = patch[k]
      return sendJson(res, 200, clip)
    }

    // Fall through to the built SPA (production single-container). Serves
    // index.html for client routes (/upload, /processing/*) and hashed assets.
    if (await serveStatic(res, req, path)) return

    sendJson(res, 404, { error: 'not found' })
  })

  // --- static SPA serving (production single-container) ------------------
  const STATIC_MIME = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.map': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.ico': 'image/x-icon',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
    '.ttf': 'font/ttf',
    '.txt': 'text/plain; charset=utf-8',
  }

  async function serveStatic(res, req, pathname) {
    const publicDir = process.env.PUBLIC_DIR
    if (!publicDir) return false
    if (req.method !== 'GET' && req.method !== 'HEAD') return false

    const rootDir = resolve(publicDir)
    const hasExt = /\.[a-zA-Z0-9]+$/.test(pathname)
    // No extension => SPA client route (/upload, /processing/x): serve the shell.
    const target = pathname === '/' || !hasExt ? '/index.html' : pathname
    let filePath = resolve(rootDir, `.${target}`)
    if (filePath !== rootDir && !filePath.startsWith(rootDir + '/')) return false // traversal guard

    let s
    try {
      s = await stat(filePath)
    } catch {
      if (hasExt) return false // missing hashed asset -> real 404
      filePath = resolve(rootDir, 'index.html') // unknown route -> SPA shell
      try {
        s = await stat(filePath)
      } catch {
        return false
      }
    }
    if (!s.isFile()) return false

    const ext = filePath.slice(filePath.lastIndexOf('.'))
    const isShell = filePath.endsWith('index.html')
    res.writeHead(200, {
      'Content-Type': STATIC_MIME[ext] ?? 'application/octet-stream',
      'Content-Length': s.size,
      // The shell must never be cached; hashed assets are immutable.
      'Cache-Control': isShell ? 'no-cache' : 'public, max-age=31536000, immutable',
    })
    if (req.method === 'HEAD') {
      res.end()
      return true
    }
    createReadStream(filePath).pipe(res)
    return true
  }

  // --- media serving with HTTP Range ------------------------------------
  async function serveMedia(res, req, streamId, file) {
    const filePath = join(clipsDir(outRoot, streamId), basename(file))
    let size
    try {
      const s = await stat(filePath)
      if (!s.isFile()) throw new Error('not a file')
      size = s.size
    } catch {
      return sendJson(res, 404, { error: 'media not found' })
    }

    const type = contentTypeFor(filePath)
    const range = parseRange(req.headers.range, size)

    if (range === null) {
      res.writeHead(200, {
        'Content-Type': type,
        'Content-Length': size,
        'Accept-Ranges': 'bytes',
        'Access-Control-Allow-Origin': '*',
      })
      return createReadStream(filePath).pipe(res)
    }

    if (range.satisfiable === false) {
      res.writeHead(416, {
        'Content-Range': `bytes */${size}`,
        'Access-Control-Allow-Origin': '*',
      })
      return res.end()
    }

    const { start, end } = range
    res.writeHead(206, {
      'Content-Type': type,
      'Content-Range': `bytes ${start}-${end}/${size}`,
      'Content-Length': end - start + 1,
      'Accept-Ranges': 'bytes',
      'Access-Control-Allow-Origin': '*',
    })
    createReadStream(filePath, { start, end }).pipe(res)
  }

  // --- WebSocket (progress) — shares the HTTP port via the upgrade event -
  const wss = new WebSocketServer({ server })
  wss.on('connection', (ws) => {
    let subscribedJobId = null
    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString())
        if (msg.action === 'subscribe' && msg.jobId) {
          subscribedJobId = msg.jobId
          if (!subscribers.has(msg.jobId)) subscribers.set(msg.jobId, new Set())
          subscribers.get(msg.jobId).add(ws)
        }
      } catch {
        // ignore malformed frames
      }
    })
    ws.on('close', () => {
      if (subscribedJobId) subscribers.get(subscribedJobId)?.delete(ws)
    })
  })

  // --- startup: scan cache + listen -------------------------------------
  const whenReady = (async () => {
    cachedStreams = await scanCachedStreams(outRoot)
    if (cachedStreams.length) {
      log(`[cache] pre-computed streams available: ${cachedStreams.join(', ')}`)
    }
    await new Promise((resolveListen) => {
      server.listen(opts.port ?? 3000, () => {
        ctx.port = server.address().port
        ctx.wsPort = ctx.port // WS shares the HTTP port via upgrade
        resolveListen()
      })
    })
    log(`[local-server] REST API on ${baseUrl()}`)
    log(`[local-server] Progress WS shares port ${ctx.port}`)
    log(`[local-server] pipeline interpreter: ${python}`)
    return { port: ctx.port, wsPort: ctx.wsPort }
  })()

  async function close() {
    await new Promise((r) => wss.close(r))
    await new Promise((r) => server.close(r))
  }

  return { server, wss, close, whenReady, ctx, _state: { jobs, clipsByJob } }
}

// Auto-start only when run directly (not when imported by tests).
const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) {
  startServer({ port: process.env.PORT ? Number(process.env.PORT) : 3000 })
}
