/**
 * Editor-shaped views of the real pipeline output, so the vendored OpenCut
 * editor (apps/editor) can load ANY processed VOD's clips + that run's real
 * AI auto-edit — not the hardcoded video_3654414 fixtures.
 *
 * The editor's highlight-api client (apps/editor/.../services/highlight-api)
 * is pointed here via NEXT_PUBLIC_BACKEND_API_URL, and expects the schemas in
 * that package's schema.ts. This module maps:
 *   out/<stream>/clips/manifest.json  -> editor Clip[]
 *   out/<stream>/edl/clip_NN.edl.json -> editor Edl (the friend's autoedit)
 *
 * Clip ids are stream-scoped ("<idPart>__clip_NN") because the editor's
 * /clips/{clipId}/... routes carry only the clip id, no video id — the scope
 * lets us resolve which run a clip belongs to. `idPart` is whatever the
 * "Open in Editor" link used (the jobId); we resolve it to a stream dir.
 */
import { readFile, readdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { basename, join } from 'node:path'
import { clipsDir, manifestPath, mediaUrl } from './manifest.mjs'

const num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d)

/** Resolve the URL id (jobId or stream dir) to an on-disk stream dir name. */
export async function resolveStreamId(idPart, outRoot, jobs) {
  const job = jobs?.get?.(idPart)
  if (job?.streamId && existsSync(manifestPath(outRoot, job.streamId))) {
    return job.streamId
  }
  if (existsSync(manifestPath(outRoot, idPart))) return idPart
  return null
}

/** "<idPart>__clip_03" -> { idPart, clipKey: "clip_03" }. */
export function splitScopedClipId(scoped) {
  const i = scoped.lastIndexOf('__')
  if (i === -1) return { idPart: '', clipKey: scoped }
  return { idPart: scoped.slice(0, i), clipKey: scoped.slice(i + 2) }
}

async function scanStreamDirs(outRoot) {
  let entries = []
  try {
    entries = await readdir(outRoot, { withFileTypes: true })
  } catch {
    return []
  }
  return entries
    .filter((e) => e.isDirectory() && existsSync(manifestPath(outRoot, e.name)))
    .map((e) => e.name)
}

/**
 * GET /api/videos — every stream with a manifest becomes a Video, plus an
 * alias per live job (jobId -> its streamId) so `video_<jobId>` links resolve
 * while the server is alive. The provider only reads `id` + `title`.
 */
export async function listEditorVideos(outRoot, jobs) {
  const idToStream = new Map()
  for (const dir of await scanStreamDirs(outRoot)) idToStream.set(dir, dir)
  for (const [jobId, job] of jobs ?? []) {
    if (job?.streamId && existsSync(manifestPath(outRoot, job.streamId))) {
      idToStream.set(jobId, job.streamId)
    }
  }
  return [...idToStream.entries()].map(([id, streamId]) => ({
    id: `video_${id}`,
    title: `StreamSmith highlights (${streamId})`,
    videoUrl: '',
    mediaAssetId: `media_${streamId}`,
    durationSeconds: 0,
    createdAt: new Date().toISOString(),
  }))
}

function evenShots(duration) {
  const step = duration / 4
  return [0, 1, 2, 3].map((i) => ({
    start: i * step,
    end: (i + 1) * step,
    confidence: 95,
  }))
}

/** One manifest entry -> editor Clip (schema.ts clipSchema). */
function manifestEntryToEditorClip(entry, index, idPart, streamId, baseUrl) {
  const clipKey = `clip_${String(index + 1).padStart(2, '0')}`
  const proxyOrFile = entry.proxy ?? entry.file ?? null
  const duration = Math.max(0, num(entry.end_s) - num(entry.start_s))
  return {
    id: `${idPart}__${clipKey}`,
    videoId: `video_${idPart}`,
    // The clip's own already-cut footage; start/end are trim offsets into it.
    sourceVideoUrl: mediaUrl(baseUrl, streamId, proxyOrFile) ?? '',
    start: 0,
    end: duration,
    shots: evenShots(duration),
    score: num(entry.virality_score),
    category: entry.category ?? '',
    mood: entry.mood ?? '',
    hook: entry.hook_zh ?? '',
    hookEn: entry.hook_en ?? '',
    caption: entry.caption_zh ?? entry.caption_en ?? '',
    captionEn: entry.caption_en ?? '',
    hashtags: Array.isArray(entry.hashtags) ? entry.hashtags : [],
    thumbKey: mediaUrl(baseUrl, streamId, entry.thumb),
    renderStatus: 'idle',
    previewUrl: null,
  }
}

/** GET /api/videos/{videoId}/clips */
export async function loadEditorClips(outRoot, idPart, streamId, baseUrl) {
  const raw = await readFile(manifestPath(outRoot, streamId), 'utf-8')
  const manifest = JSON.parse(raw)
  if (!Array.isArray(manifest)) return []
  return manifest.map((entry, i) =>
    manifestEntryToEditorClip(entry, i, idPart, streamId, baseUrl),
  )
}

/**
 * Map a pipeline EDL (out/<stream>/edl/clip_NN.edl.json, the friend's
 * pipeline/autoedit.py output) to the editor's Edl schema. Nearly identical;
 * the only hard incompatibility is captions.source (pipeline emits
 * "transcribe_word_karaoke", the editor schema only accepts
 * "transcribe_word_timeline") and the per-word overlay array, which the
 * editor's segment-level caption schema doesn't model — so we normalize both.
 */
function mapPipelineEdl(edl, scopedClipId) {
  return {
    edlId: edl.edlId ?? `edl_${scopedClipId}`,
    jobId: edl.jobId ?? scopedClipId,
    clipIds: [scopedClipId],
    status: edl.status ?? 'draft',
    canvas: edl.canvas ?? { width: 1080, height: 1920, fps: 30 },
    segments: (edl.segments ?? []).map((s) => ({
      segmentId: s.segmentId,
      clipId: scopedClipId,
      sourceStart: num(s.sourceStart),
      sourceEnd: num(s.sourceEnd),
      timelineStart: num(s.timelineStart),
      timelineEnd: num(s.timelineEnd),
      transitionIn: s.transitionIn ?? null,
      crop: s.crop
        ? {
            mode: s.crop.mode === 'face_track' ? 'face_track' : 'center',
            ...(typeof s.crop.cx === 'number' ? { cx: s.crop.cx } : {}),
          }
        : { mode: 'center' },
    })),
    effects: (edl.effects ?? []).map((e) => ({
      effectId: e.effectId,
      type: e.type === 'sound' ? 'sound' : 'visual',
      at: num(e.at),
      duration: num(e.duration),
      ...(e.params ? { params: e.params } : {}),
    })),
    captions: {
      source: 'transcribe_word_timeline',
      burnIn: !!edl.captions?.burnIn,
      ...(edl.captions?.style ? { style: edl.captions.style } : {}),
      overlays: (edl.captions?.overlays ?? []).map((o) => ({
        start: num(o.start),
        end: num(o.end),
        text: o.text ?? '',
        ...(o.speaker ? { speaker: o.speaker } : {}),
      })),
    },
    hookOverlay: edl.hookOverlay
      ? {
          text: edl.hookOverlay.text ?? '',
          start: num(edl.hookOverlay.start),
          duration: num(edl.hookOverlay.duration, 2.5),
          ...(edl.hookOverlay.style ? { style: edl.hookOverlay.style } : {}),
        }
      : null,
    musicBed: edl.musicBed ?? null,
  }
}

function summarizeEffects(effects) {
  if (!effects.length) return 'No auto-edit effects detected for this clip.'
  const zooms = effects.filter((e) => e.effectId === 'punch-in-zoom').length
  const caps = effects.filter((e) => e.effectId === 'onomatopoeia-caption').length
  const sfx = effects.filter((e) => e.type === 'sound').length
  const parts = []
  if (zooms) parts.push(`${zooms} reaction zoom(s)`)
  if (caps) parts.push(`${caps} burst caption(s)`)
  if (sfx) parts.push(`${sfx} sound effect(s)`)
  const detail = parts.length ? parts.join(', ') : `${effects.length} effect(s)`
  return `Applied AI auto-edit: ${detail}. All edits are user-adjustable on the timeline.`
}

// ---- base EDL + deterministic chip/prompt edits (ported from the editor's
// ai-edit-mock.ts, so the AI Edit panel's non-"auto" chips/prompts still work
// against dynamically-loaded clips) --------------------------------------

function buildBaseEdl(clip) {
  const duration = clip.end - clip.start
  return {
    edlId: `edl_${clip.id}_${Date.now()}`,
    jobId: clip.videoId,
    clipIds: [clip.id],
    status: 'draft',
    canvas: { width: 1080, height: 1920, fps: 30 },
    segments: [
      {
        segmentId: 'seg_01',
        clipId: clip.id,
        sourceStart: clip.start,
        sourceEnd: clip.end,
        timelineStart: 0,
        timelineEnd: duration,
        transitionIn: null,
        crop: { mode: 'center' },
      },
    ],
    effects: [],
    captions: {
      source: 'transcribe_word_timeline',
      burnIn: true,
      style: { fontName: 'PingFang TC', fontSize: 64, alignment: 2, marginV: 220 },
      overlays: [],
    },
    hookOverlay: { text: clip.hook, start: 0, duration: 2.5 },
    musicBed: null,
  }
}

function withSpeed(base, rate) {
  const seg = base.segments[0]
  const span = seg.sourceEnd - seg.sourceStart
  return { ...base, segments: [{ ...seg, timelineStart: 0, timelineEnd: span / rate }] }
}

function buildReorder(clip, base) {
  if (clip.shots.length < 2) {
    return { summary: 'Not enough distinct segments in this clip to reorder.', edl: base }
  }
  const order = [clip.shots.length - 1, ...clip.shots.slice(0, -1).map((_, i) => i)]
  let cursor = 0
  const segments = order.map((shotIndex, pos) => {
    const shot = clip.shots[shotIndex]
    const span = shot.end - shot.start
    const seg = {
      segmentId: `seg_${String(pos + 1).padStart(2, '0')}`,
      clipId: clip.id,
      sourceStart: shot.start,
      sourceEnd: shot.end,
      timelineStart: cursor,
      timelineEnd: cursor + span,
      transitionIn: pos === 0 ? null : { type: 'cut', duration: 0 },
      crop: { mode: 'center' },
    }
    cursor += span
    return seg
  })
  return { summary: "Reordered segments to lead with the clip's final beat.", edl: { ...base, segments } }
}

function buildEmphasis(clip, base) {
  const mid = (clip.end - clip.start) / 2
  return {
    summary: "Added a punch-in zoom around the clip's midpoint to emphasize the reaction.",
    edl: {
      ...base,
      effects: [
        { effectId: 'punch-in-zoom', type: 'visual', at: Math.max(0, mid - 1), duration: 2, params: { scale: 1.3 } },
      ],
    },
  }
}

function generateForChip(clip, base, chip) {
  switch (chip) {
    case 'faster_pacing':
      return { summary: 'Sped up the clip by 30% for punchier pacing.', edl: withSpeed(base, 1.3) }
    case 'reorder':
      return buildReorder(clip, base)
    case 'swap_intro':
      return { summary: "Swap intro isn't available yet — this clip has no alternate footage to draw from.", edl: base }
    case 'more_reactions':
      return buildEmphasis(clip, base)
    default:
      return { summary: 'No change applied.', edl: base }
  }
}

function generateForPrompt(clip, base, prompt) {
  const lower = (prompt ?? '').toLowerCase()
  if (/short|trim|cut|tighter/.test(lower)) {
    const seg = base.segments[0]
    const span = seg.sourceEnd - seg.sourceStart
    const t = span * 0.2
    const sourceStart = seg.sourceStart + t
    const sourceEnd = seg.sourceEnd - t
    return {
      summary: `Trimmed ${t.toFixed(1)}s off each end for a tighter cut.`,
      edl: { ...base, segments: [{ ...seg, sourceStart, sourceEnd, timelineEnd: sourceEnd - sourceStart }] },
    }
  }
  if (/fast|speed|pace|quicker/.test(lower)) return generateForChip(clip, base, 'faster_pacing')
  if (/zoom|reaction|emphasis|punch/.test(lower)) return buildEmphasis(clip, base)
  if (/caption|subtitle|text/.test(lower)) {
    return {
      summary: 'Added the hook as an on-screen caption for the first 2.5 seconds.',
      edl: { ...base, captions: { ...base.captions, overlays: [{ start: 0, end: 2.5, text: clip.hook }] } },
    }
  }
  if (/reorder|rearrange|order/.test(lower)) return buildReorder(clip, base)
  return {
    summary:
      "Couldn't determine a specific edit from that prompt — try a quick action, or mention trim/speed/captions/zoom/reorder directly.",
    edl: base,
  }
}

/**
 * POST /api/clips/{clipId}/ai-edit. `chipAction: "auto"` (and the default
 * on-load call) returns the pipeline's precomputed autoedit EDL; other chips
 * and freeform prompts run the deterministic transforms above.
 */
export async function getEditorAiEdit({ outRoot, jobs, baseUrl, scopedClipId, request }) {
  const { idPart, clipKey } = splitScopedClipId(scopedClipId)
  const streamId = await resolveStreamId(idPart, outRoot, jobs)
  if (!streamId) return { error: 'clip not found' }
  const clips = await loadEditorClips(outRoot, idPart, streamId, baseUrl)
  const clip = clips.find((c) => c.id === scopedClipId)
  if (!clip) return { error: 'clip not found' }

  const chip = request?.chipAction
  const prompt = request?.prompt

  if (!chip || chip === 'auto') {
    const edlPath = join(outRoot, streamId, 'edl', `${clipKey}.edl.json`)
    if (existsSync(edlPath)) {
      const edl = mapPipelineEdl(JSON.parse(await readFile(edlPath, 'utf-8')), scopedClipId)
      return { response: { summary: summarizeEffects(edl.effects), edl } }
    }
    return { response: { summary: 'No auto-edit effects detected for this clip.', edl: buildBaseEdl(clip) } }
  }

  const base = buildBaseEdl(clip)
  const result = chip ? generateForChip(clip, base, chip) : generateForPrompt(clip, base, prompt)
  return { response: result }
}

/** Look up a single editor clip by its scoped id (for patch/render/status). */
export async function getEditorClip({ outRoot, jobs, baseUrl, scopedClipId }) {
  const { idPart } = splitScopedClipId(scopedClipId)
  const streamId = await resolveStreamId(idPart, outRoot, jobs)
  if (!streamId) return null
  const clips = await loadEditorClips(outRoot, idPart, streamId, baseUrl)
  return clips.find((c) => c.id === scopedClipId) ?? null
}

/** previewUrl for a "rendered" clip: prefer the burned autoedit render. */
export async function editorClipPreviewUrl({ outRoot, jobs, baseUrl, scopedClipId }) {
  const { idPart, clipKey } = splitScopedClipId(scopedClipId)
  const streamId = await resolveStreamId(idPart, outRoot, jobs)
  if (!streamId) return null
  const raw = await readFile(manifestPath(outRoot, streamId), 'utf-8').catch(() => null)
  if (!raw) return null
  const manifest = JSON.parse(raw)
  const idx = Number(clipKey.replace('clip_', '')) - 1
  const entry = manifest[idx]
  if (!entry) return null
  const file = entry.file ?? entry.proxy
  if (!file) return null
  const base = String(file).split('/').pop()
  const autoedit = base.replace(/\.mp4$/, '_autoedit.mp4')
  if (existsSync(join(outRoot, streamId, 'clips', autoedit))) {
    return mediaUrl(baseUrl, streamId, autoedit)
  }
  return mediaUrl(baseUrl, streamId, entry.proxy ?? entry.file)
}

/** Spawn a one-shot python module and resolve on exit 0, reject otherwise. */
function runPython({ python, args, cwd }) {
  return new Promise((resolve, reject) => {
    const child = spawn(python, args, { cwd, env: process.env })
    let stderr = ''
    child.stderr?.on('data', (d) => (stderr += d.toString()))
    child.on('error', reject)
    child.on('exit', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`caption_burn exited ${code}: ${stderr.trim()}`))
    })
  })
}

/**
 * POST /api/clips/{clipId}/apply-captions — on-demand karaoke caption burn.
 *
 * Grid clips are RAW (pipeline/render.py). This burns the clip's EDL word
 * overlays (pipeline/edl.py) onto its already-cut footage via
 * pipeline/caption_burn.py, writing clip_NN_<mood>_captioned.mp4 next to the
 * raw clip, and returns its previewUrl. Idempotent: a prior burn is reused.
 */
export async function applyClipCaptions({ outRoot, jobs, baseUrl, scopedClipId, python, cwd }) {
  const { idPart, clipKey } = splitScopedClipId(scopedClipId)
  const streamId = await resolveStreamId(idPart, outRoot, jobs)
  if (!streamId) return { status: 404, error: 'clip not found' }

  const raw = await readFile(manifestPath(outRoot, streamId), 'utf-8').catch(() => null)
  if (!raw) return { status: 404, error: 'clip not found' }
  const manifest = JSON.parse(raw)
  const idx = Number(clipKey.replace('clip_', '')) - 1
  const entry = manifest[idx]
  if (!entry) return { status: 404, error: 'clip not found' }

  // Burn onto the full-res raw clip (fall back to proxy if that's all there is).
  const sourceFile = entry.file ?? entry.proxy
  if (!sourceFile) return { status: 404, error: 'clip has no rendered file' }
  const sourceBase = basename(String(sourceFile))
  const captionedBase = sourceBase.replace(/\.mp4$/, '_captioned.mp4')

  const dir = clipsDir(outRoot, streamId)
  const sourcePath = join(dir, sourceBase)
  const captionedPath = join(dir, captionedBase)
  const edlPath = join(outRoot, streamId, 'edl', `${clipKey}.edl.json`)

  if (!existsSync(sourcePath)) return { status: 404, error: 'source clip file missing' }
  if (!existsSync(edlPath)) return { status: 404, error: 'clip EDL (caption data) missing' }

  // Idempotent: reuse a prior burn unless the source clip is newer.
  if (!existsSync(captionedPath)) {
    await runPython({
      python: python ?? 'python3',
      cwd,
      args: [
        '-m', 'pipeline.caption_burn',
        '--clip', sourcePath,
        '--edl', edlPath,
        '--out', captionedPath,
      ],
    })
  }

  return {
    status: 200,
    response: { status: 'ready', previewUrl: mediaUrl(baseUrl, streamId, captionedBase) },
  }
}
