// @vitest-environment node
import { afterAll, describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { sanitizeSegment, saveUpload, uploadPathForKey } from './uploads.mjs'

const tmpDirs = []
async function makeRoot() {
  const dir = await mkdtemp(join(tmpdir(), 'uploads-test-'))
  tmpDirs.push(dir)
  return dir
}

afterAll(async () => {
  await Promise.all(tmpDirs.map((d) => rm(d, { recursive: true, force: true })))
})

describe('uploads: path resolution + traversal guard', () => {
  it('maps "<jobDraftId>/<filename>" under the uploads root', () => {
    expect(uploadPathForKey('/root', 'draft123/video.mp4')).toBe(
      join('/root', 'draft123', 'video.mp4'),
    )
  })

  it('neutralizes path-traversal attempts', () => {
    expect(sanitizeSegment('..')).toBe('_')
    const p = uploadPathForKey('/root', '../../etc/passwd')
    expect(p.startsWith(join('/root'))).toBe(true)
    expect(p.includes('..')).toBe(false)
  })
})

describe('uploads: byte round-trip to disk', () => {
  it('writes streamed bytes to the resolved path and reads them back', async () => {
    const root = await makeRoot()
    const key = 'draft-xyz/stream.mp4'
    const payload = Buffer.from('fake-video-bytes-\u00ff\u0000-end')
    const dest = await saveUpload(root, key, Readable.from(payload))
    expect(dest).toBe(join(root, 'draft-xyz', 'stream.mp4'))
    const back = await readFile(dest)
    expect(back.equals(payload)).toBe(true)
  })

  it('creates nested directories as needed', async () => {
    const root = await makeRoot()
    const dest = await saveUpload(
      root,
      'a/b.csv',
      Readable.from(Buffer.from('t,ts\nhi,1\n')),
    )
    expect((await readFile(dest, 'utf-8')).startsWith('t,ts')).toBe(true)
  })
})
