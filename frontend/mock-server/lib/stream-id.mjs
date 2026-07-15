/**
 * Live-path stream-id derivation.
 *
 * By default a live job uses its jobId (a random UUID) as the stream-id, so its
 * output lands in a unique `out/<uuid>/` and can never collide with another
 * job. The downside: that dir isn't addressable by filename, so re-uploading
 * the same video won't reuse the earlier run's output.
 *
 * For the two known DEMO clips we deliberately opt into a stable, filename-
 * derived stream-id so a re-upload lands in the same `out/<id>/` (and, once
 * rendered, binds to it via the cache path). This is a narrow allowlist on
 * purpose — any other upload still gets a fresh UUID.
 */

/** Stream-ids we pin to a stable `out/<id>/` (demo clips only). */
export const DEMO_STREAM_IDS = ['6910008', '3654414']

/**
 * Return the demo stream-id implied by the uploaded filenames (video and/or
 * chat log), or null if none of the allowlisted ids appear. Longest id first
 * so a more specific id would win over a prefix.
 *
 * @param {Array<string|null|undefined>} names  candidate filenames
 * @param {string[]} [knownIds]
 * @returns {string|null}
 */
export function deriveStreamId(names, knownIds = DEMO_STREAM_IDS) {
  const candidates = (names ?? []).filter(Boolean)
  for (const id of [...knownIds].sort((a, b) => b.length - a.length)) {
    if (candidates.some((name) => name.includes(id))) return id
  }
  return null
}
