/**
 * Pre-computed / cached results path (hackathon-day, zero-latency demo).
 *
 * At startup we scan each `out/<id>/clips/manifest.json` for directories that already
 * hold a complete pipeline run, and register them by stream-id. A new job can
 * then be bound directly to a cached stream instead of spawning the pipeline,
 * skipping straight to the manifest->Clip mapper + media serving reused from
 * the live path.
 */
import { readdir, stat } from 'node:fs/promises'
import { manifestPath } from './manifest.mjs'

/** True if a stream directory under outRoot has a readable manifest.json. */
export async function hasCompleteManifest(outRoot, streamId) {
  try {
    const s = await stat(manifestPath(outRoot, streamId))
    return s.isFile() && s.size > 0
  } catch {
    return false
  }
}

/**
 * Scan an out root for stream directories with a complete manifest.
 * @returns {Promise<string[]>} sorted stream-ids
 */
export async function scanCachedStreams(outRoot) {
  let entries
  try {
    entries = await readdir(outRoot, { withFileTypes: true })
  } catch {
    return []
  }
  const found = []
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    if (await hasCompleteManifest(outRoot, entry.name)) {
      found.push(entry.name)
    }
  }
  return found.sort()
}

/**
 * Choose the cached stream a new job should bind to, given the uploaded video
 * filename and the set of available cached stream-ids.
 *
 * Matching strategy (first hit wins):
 *   1. explicit override (a cached stream-id contained in the filename), e.g.
 *      uploading "3654414_video.mp4" binds to cached stream "3654414".
 *   2. the leading numeric run-id of the filename ("6910008_log.csv" -> 6910008)
 *      when it exactly matches a cached stream-id.
 *
 * Returns null when nothing matches (caller falls back to the live path).
 */
export function matchCachedStream(videoName, cachedStreamIds) {
  if (!videoName || !Array.isArray(cachedStreamIds) || cachedStreamIds.length === 0) {
    return null
  }
  // 1. substring match (longest id first so "36544140" beats "3654414")
  const byLength = [...cachedStreamIds].sort((a, b) => b.length - a.length)
  for (const id of byLength) {
    if (videoName.includes(id)) return id
  }
  // 2. leading numeric id exact-match
  const leadMatch = videoName.match(/^(\d+)/)
  const lead = leadMatch ? leadMatch[1] : null
  if (lead && cachedStreamIds.includes(lead)) return lead
  return null
}
