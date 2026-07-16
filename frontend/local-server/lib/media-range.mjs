/**
 * HTTP Range support for serving rendered media (proxies/thumbnails).
 *
 * <video> seeking issues `Range: bytes=start-end` requests and expects a
 * `206 Partial Content` with a `Content-Range` header. This module holds the
 * pure range math + content-type lookup; the server wires it to a file stream.
 */
import { extname } from 'node:path'

const CONTENT_TYPES = {
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.mkv': 'video/x-matroska',
  '.webm': 'video/webm',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.json': 'application/json',
}

export function contentTypeFor(path) {
  return CONTENT_TYPES[extname(path).toLowerCase()] ?? 'application/octet-stream'
}

/**
 * Parse a Range header against a known content size.
 *
 * @returns {null | {satisfiable:false} | {satisfiable:true,start:number,end:number}}
 *   - null: no/blank or non-bytes range header -> caller serves full 200
 *   - {satisfiable:false}: range out of bounds -> caller returns 416
 *   - {satisfiable:true,...}: inclusive byte range for a 206
 */
export function parseRange(rangeHeader, size) {
  if (!rangeHeader || typeof rangeHeader !== 'string') return null
  const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim())
  if (!match) return null
  const [, rawStart, rawEnd] = match
  if (rawStart === '' && rawEnd === '') return null

  let start
  let end
  if (rawStart === '') {
    // suffix range: last N bytes
    const suffix = Number(rawEnd)
    if (suffix <= 0) return { satisfiable: false }
    start = Math.max(0, size - suffix)
    end = size - 1
  } else {
    start = Number(rawStart)
    end = rawEnd === '' ? size - 1 : Number(rawEnd)
  }

  if (Number.isNaN(start) || Number.isNaN(end)) return null
  if (start > end || start >= size) return { satisfiable: false }
  if (end >= size) end = size - 1
  return { satisfiable: true, start, end }
}
