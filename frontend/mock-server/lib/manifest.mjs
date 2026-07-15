/**
 * Map the real pipeline manifest (out/<streamId>/clips/manifest.json) to the
 * frontend Clip shape (frontend/src/types/index.ts).
 *
 * This is the single convergence point for BOTH the live-subprocess path and
 * the pre-computed cache path: whatever produced the manifest, the UI sees the
 * same Clip records and the same /media URLs.
 */
import { readFile } from 'node:fs/promises'
import { basename, join } from 'node:path'

const num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d)

/** Build the media URL the browser fetches for a rendered artifact. */
export function mediaUrl(baseUrl, streamId, localPath) {
  if (!localPath) return null
  return `${baseUrl}/media/${encodeURIComponent(streamId)}/${encodeURIComponent(basename(localPath))}`
}

/**
 * Map one manifest entry to a Clip.
 * @param {object} entry manifest entry
 * @param {number} index 0-based position
 * @param {string} streamId
 * @param {string} baseUrl e.g. http://localhost:3000
 */
export function manifestEntryToClip(entry, index, streamId, baseUrl) {
  const factors = entry.factors ?? {}
  const proxyOrFile = entry.proxy ?? entry.file ?? null
  return {
    clipId: `clip_${String(index + 1).padStart(2, '0')}`,
    start: num(entry.start_s),
    end: num(entry.end_s),
    score: num(entry.virality_score),
    factors: {
      chat: num(factors.chat),
      audio: num(factors.audio),
      visual: num(factors.visual),
      speech: num(factors.speech),
    },
    mood: entry.mood ?? '',
    momentType: entry.category ?? '',
    titleNative: entry.title_zh ?? '',
    titleEnglish: entry.title_en ?? '',
    caption: entry.caption_zh ?? entry.caption_en ?? '',
    hashtags: Array.isArray(entry.hashtags) ? entry.hashtags : [],
    thumbUrl: mediaUrl(baseUrl, streamId, entry.thumb),
    videoUrl: mediaUrl(baseUrl, streamId, proxyOrFile),
    cropConfirmed: false,
  }
}

/** Map a whole manifest array to Clips. */
export function manifestToClips(manifest, streamId, baseUrl) {
  if (!Array.isArray(manifest)) return []
  return manifest.map((entry, i) => manifestEntryToClip(entry, i, streamId, baseUrl))
}

/** Path to a stream's clips directory under an out root. */
export function clipsDir(outRoot, streamId) {
  return join(outRoot, streamId, 'clips')
}

/** Path to a stream's manifest.json under an out root. */
export function manifestPath(outRoot, streamId) {
  return join(clipsDir(outRoot, streamId), 'manifest.json')
}

/** Read + map the manifest for a stream. Throws if the manifest is absent. */
export async function loadManifestClips(outRoot, streamId, baseUrl) {
  const raw = await readFile(manifestPath(outRoot, streamId), 'utf-8')
  return manifestToClips(JSON.parse(raw), streamId, baseUrl)
}
