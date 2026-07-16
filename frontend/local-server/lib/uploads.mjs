/**
 * Persist uploaded bytes to real disk under an uploads root.
 *
 * The mock server previously drained and discarded upload bytes. The
 * local-first server writes them so the real pipeline subprocess has actual
 * files to read.
 *
 * Upload keys look like "<jobDraftId>/<filename>". We map that to
 * <uploadsRoot>/<jobDraftId>/<filename>, sanitizing each path segment to
 * prevent traversal outside the uploads root.
 */
import { createWriteStream } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'

/** Sanitize a single path segment; never allow '', '.' or '..'. */
export function sanitizeSegment(segment) {
  const cleaned = String(segment).replace(/[^A-Za-z0-9._-]/g, '_')
  if (cleaned === '' || cleaned === '.' || cleaned === '..') return '_'
  return cleaned
}

/** Absolute-ish path (under uploadsRoot) where an upload key is stored. */
export function uploadPathForKey(uploadsRoot, key) {
  const segments = String(key)
    .split('/')
    .filter(Boolean)
    .map(sanitizeSegment)
  if (segments.length === 0) segments.push('upload.bin')
  return join(uploadsRoot, ...segments)
}

/**
 * Stream a readable (e.g. an incoming HTTP request) to disk at the location
 * derived from `key`. Resolves with the destination path once fully written.
 *
 * @param {string} uploadsRoot
 * @param {string} key
 * @param {import('node:stream').Readable} readable
 * @returns {Promise<string>}
 */
export async function saveUpload(uploadsRoot, key, readable) {
  const dest = uploadPathForKey(uploadsRoot, key)
  await mkdir(dirname(dest), { recursive: true })
  await new Promise((resolve, reject) => {
    const ws = createWriteStream(dest)
    readable.on('error', reject)
    ws.on('error', reject)
    ws.on('finish', resolve)
    readable.pipe(ws)
  })
  return dest
}
