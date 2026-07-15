/**
 * Local mock backend for interactive UI testing without AWS.
 *
 * Implements the exact REST/WS contract the frontend calls (see
 * ../src/api/*.ts and .kiro/specs/webapp-skeleton/design.md), backed by an
 * in-memory store and deterministic fixture data instead of real Cognito/
 * S3/DynamoDB/Step Functions. Run via `npm run dev:mock`.
 */
import { createServer } from 'node:http'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { WebSocketServer } from 'ws'

const PORT = 3000
const WS_PORT = 3001

const __dirname = dirname(fileURLToPath(import.meta.url))
const MOODS = JSON.parse(
  readFileSync(join(__dirname, '../../config/moods.json'), 'utf-8'),
).moods

const STAGES = [
  'normalize/proxy',
  'transcript',
  'visual analysis',
  'audio analysis',
  'chat analysis',
  'fusion/scoring',
  'categorization',
]
const STAGE_DELAY_MS = 500

const MOMENT_TYPES = [
  'song performance',
  'guest story & song reveal',
  'clutch play',
  'crowd reaction',
  'funny fail',
  'heartfelt moment',
]

// Deterministic per-jobId RNG so revisiting a job (e.g. GET /jobs/:id/clips
// after a page refresh) always returns the same fixture clips.
function seedFrom(str) {
  let h = 1779033703 ^ str.length
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353)
    h = (h << 13) | (h >>> 19)
  }
  return h >>> 0
}
function mulberry32(seed) {
  let a = seed
  return function () {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function genClips(jobId) {
  const rng = mulberry32(seedFrom(jobId))
  const count = 3 + Math.floor(rng() * 8) // 3-10
  const clips = []
  for (let i = 0; i < count; i++) {
    const start = i * 45
    const end = start + 15 + Math.floor(rng() * 30)
    const mood = MOODS[Math.floor(rng() * MOODS.length)]
    const factor = () => Math.round((rng() * 200 - 100) * 100) / 100
    const clipId = `${jobId}-clip-${i}`
    clips.push({
      clipId,
      start,
      end,
      score: Math.round(rng() * 10000) / 100,
      factors: { chat: factor(), audio: factor(), visual: factor(), speech: factor() },
      mood,
      momentType: MOMENT_TYPES[Math.floor(rng() * MOMENT_TYPES.length)],
      titleNative: `Highlight ${i + 1}: ${mood}`,
      titleEnglish: `Highlight ${i + 1}: ${mood}`,
      caption: `A ${mood} moment worth clipping. #${i + 1}`,
      hashtags: [`#${mood}`, '#highlights', '#stream'],
      thumbUrl: `http://localhost:${PORT}/placeholder/${encodeURIComponent(clipId)}?mood=${encodeURIComponent(mood)}`,
      videoUrl: null,
      cropConfirmed: false,
    })
  }
  return clips
}

const MOOD_COLORS = {
  funny: '#f4c542',
  hype: '#e14b4b',
  emotional: '#7b6cf6',
  impressive: '#3fb0e8',
  wholesome: '#5cc98b',
  controversial: '#c94ac9',
}

function placeholderSvg(clipId, mood) {
  const color = MOOD_COLORS[mood] ?? '#888'
  const label = clipId.length > 22 ? `${clipId.slice(0, 19)}...` : clipId
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180">` +
    `<rect width="320" height="180" fill="${color}"/>` +
    `<text x="50%" y="45%" dominant-baseline="middle" text-anchor="middle" fill="#fff" font-size="16" font-family="sans-serif">${mood}</text>` +
    `<text x="50%" y="65%" dominant-baseline="middle" text-anchor="middle" fill="#fff" font-size="10" font-family="sans-serif">${label}</text>` +
    `</svg>`
  )
}

// jobId -> { status, targets, createdAt, failing }
const jobs = new Map()
// jobId -> Clip[]
const clipsByJob = new Map()
// key -> original filename (used only to decide pass/fail, per README)
const uploadedFilenames = new Map()
// jobId -> Set<ws>
const subscribers = new Map()
// jobId -> Refinement[]
const refinementsByJob = new Map()
// handoffId -> HandoffClip[]
const handoffs = new Map()

function broadcast(jobId, event) {
  for (const ws of subscribers.get(jobId) ?? []) {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(event))
  }
}

function runPipeline(jobId) {
  const job = jobs.get(jobId)
  let i = 0
  const step = () => {
    if (i >= STAGES.length) {
      if (job.failing) {
        job.status = 'failed'
        broadcast(jobId, { jobId, stage: 'pipeline', status: 'failed' })
      } else {
        clipsByJob.set(jobId, genClips(jobId))
        job.status = 'completed'
        broadcast(jobId, { jobId, stage: 'pipeline', status: 'completed' })
      }
      return
    }
    const stage = STAGES[i]
    // Fail partway through so the failure path is exercised realistically
    // rather than always failing before any stage runs.
    if (job.failing && i === Math.floor(STAGES.length / 2)) {
      job.status = 'failed'
      broadcast(jobId, { jobId, stage, status: 'failed' })
      return
    }
    job.status = 'in_progress'
    broadcast(jobId, { jobId, stage, status: 'started' })
    setTimeout(() => {
      broadcast(jobId, { jobId, stage, status: 'completed' })
      i++
      setTimeout(step, STAGE_DELAY_MS)
    }, STAGE_DELAY_MS)
  }
  step()
}

function send(res, status, body) {
  const text = body === undefined ? '' : JSON.stringify(body)
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, PUT, OPTIONS',
  })
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

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`)
  const path = url.pathname

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Allow-Methods': 'GET, POST, PATCH, PUT, OPTIONS',
    })
    return res.end()
  }

  // GET /placeholder/:clipId -- inline SVG thumbnail, no external network
  // calls so the mock works fully offline.
  if (req.method === 'GET' && path.startsWith('/placeholder/')) {
    const clipId = decodeURIComponent(path.slice('/placeholder/'.length))
    const mood = url.searchParams.get('mood') ?? 'unknown'
    res.writeHead(200, {
      'Content-Type': 'image/svg+xml',
      'Access-Control-Allow-Origin': '*',
    })
    return res.end(placeholderSvg(clipId, mood))
  }

  // PUT /mock-upload/:key -- stands in for the presigned S3 PUT.
  if (req.method === 'PUT' && path.startsWith('/mock-upload/')) {
    req.resume()
    req.on('end', () => send(res, 200, { ok: true }))
    return
  }

  let body = null
  if (req.method === 'POST' || req.method === 'PATCH') {
    try {
      body = await readJsonBody(req)
    } catch {
      return send(res, 400, { error: 'invalid JSON body' })
    }
  }

  // POST /uploads/presign
  if (req.method === 'POST' && path === '/uploads/presign') {
    const jobDraftId = body?.jobDraftId ?? randomUUID()
    const key = `${jobDraftId}/${body?.filename ?? 'upload.mp4'}`
    uploadedFilenames.set(key, body?.filename ?? '')
    return send(res, 200, {
      uploadUrl: `http://localhost:${PORT}/mock-upload/${encodeURIComponent(key)}`,
      key,
      jobDraftId,
      expiresIn: 900,
    })
  }

  // POST /uploads/confirm
  if (req.method === 'POST' && path === '/uploads/confirm') {
    return send(res, 200, { confirmed: true })
  }

  // POST /jobs
  if (req.method === 'POST' && path === '/jobs') {
    const jobId = randomUUID()
    const sourceKeys = body?.sourceKeys ?? []
    // Dev lever: name an uploaded file with "fail" in it (e.g.
    // "clip-fail.mp4") to exercise the failed-processing UI path.
    const failing = sourceKeys.some((key) =>
      (uploadedFilenames.get(key) ?? '').toLowerCase().includes('fail'),
    )
    jobs.set(jobId, {
      jobId,
      status: 'pending',
      targets: body?.targets ?? [],
      createdAt: new Date().toISOString(),
      failing,
    })
    setTimeout(() => runPipeline(jobId), STAGE_DELAY_MS)
    return send(res, 200, { jobId, status: 'pending' })
  }

  // GET /jobs/:jobId
  const jobMatch = path.match(/^\/jobs\/([^/]+)$/)
  if (req.method === 'GET' && jobMatch) {
    const job = jobs.get(jobMatch[1])
    if (!job) return send(res, 404, { error: 'job not found' })
    const { failing, ...jobView } = job
    return send(res, 200, jobView)
  }

  // GET /jobs/:jobId/clips
  const clipsMatch = path.match(/^\/jobs\/([^/]+)\/clips$/)
  if (req.method === 'GET' && clipsMatch) {
    const clips = clipsByJob.get(clipsMatch[1]) ?? []
    return send(res, 200, { clips })
  }

  // PATCH /jobs/:jobId/clips/:clipId
  const cropMatch = path.match(/^\/jobs\/([^/]+)\/clips\/([^/]+)$/)
  if (req.method === 'PATCH' && cropMatch) {
    const clips = clipsByJob.get(cropMatch[1]) ?? []
    const clip = clips.find((c) => c.clipId === cropMatch[2])
    if (!clip) return send(res, 404, { error: 'clip not found' })
    clip.start = body?.start ?? clip.start
    clip.end = body?.end ?? clip.end
    clip.cropConfirmed = true
    return send(res, 200, {
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
    return send(res, 200, refinement)
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
    return send(res, 200, { handoffId })
  }

  // GET /handoff/:handoffId
  const handoffMatch = path.match(/^\/handoff\/([^/]+)$/)
  if (req.method === 'GET' && handoffMatch) {
    const clips = handoffs.get(handoffMatch[1])
    if (!clips) return send(res, 404, { error: 'handoff not found' })
    return send(res, 200, { clips })
  }

  send(res, 404, { error: 'not found' })
})

const wss = new WebSocketServer({ port: WS_PORT })
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

server.listen(PORT, () => {
  console.log(`[mock-server] REST API on http://localhost:${PORT}`)
  console.log(`[mock-server] Progress WS on ws://localhost:${WS_PORT}`)
})
