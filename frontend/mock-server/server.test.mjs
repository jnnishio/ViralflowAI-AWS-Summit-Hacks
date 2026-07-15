// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { startServer } from './server.mjs'

const CACHED_SID = 'teststream'
let outRoot
let uploadsRoot
let handle
let base
let proxyBytes

async function seedCache() {
  outRoot = await mkdtemp(join(tmpdir(), 'srv-out-'))
  uploadsRoot = await mkdtemp(join(tmpdir(), 'srv-up-'))
  const clips = join(outRoot, CACHED_SID, 'clips')
  await mkdir(clips, { recursive: true })
  proxyBytes = Buffer.alloc(4096, 7) // deterministic media payload
  await writeFile(join(clips, 'clip_01_funny.proxy.mp4'), proxyBytes)
  await writeFile(join(clips, 'clip_01_funny.jpg'), Buffer.alloc(128, 3))
  const manifest = [
    {
      start_s: 10,
      end_s: 40,
      virality_score: 72,
      mood: 'funny',
      category: 'food reaction',
      factors: { chat: 3.4, audio: 1.2, visual: 0.6, speech: -0.1 },
      title_zh: '測試標題',
      title_en: 'Test Title',
      hook_zh: '鉤子',
      caption_zh: '中文說明',
      caption_en: 'english caption',
      hashtags: ['#test', '#funny'],
      file: `out/${CACHED_SID}/clips/clip_01_funny.mp4`,
      thumb: `out/${CACHED_SID}/clips/clip_01_funny.jpg`,
      proxy: `out/${CACHED_SID}/clips/clip_01_funny.proxy.mp4`,
    },
  ]
  await writeFile(join(clips, 'manifest.json'), JSON.stringify(manifest))
}

beforeAll(async () => {
  await seedCache()
  handle = startServer({
    port: 0,
    wsPort: 0,
    outRoot,
    uploadsRoot,
    spawnEnabled: false, // never launch real python in tests
    log: () => {},
  })
  const ready = await handle.whenReady
  base = `http://localhost:${ready.port}`
})

afterAll(async () => {
  await handle.close()
  await rm(outRoot, { recursive: true, force: true })
  await rm(uploadsRoot, { recursive: true, force: true })
})

describe('Task 2: upload persists bytes to disk', () => {
  it('PUT /mock-upload/:key writes real bytes that round-trip from disk', async () => {
    const key = 'draft-1/teststream_video.mp4'
    const payload = Buffer.from('hello-real-bytes')
    const put = await fetch(`${base}/mock-upload/${encodeURIComponent(key)}`, {
      method: 'PUT',
      body: payload,
    })
    expect(put.status).toBe(200)
    const onDisk = await readFile(join(uploadsRoot, 'draft-1', 'teststream_video.mp4'))
    expect(onDisk.equals(payload)).toBe(true)
  })
})

describe('Task 6: cached path resolves a job to real clips without a subprocess', () => {
  let jobId
  it('POST /jobs with a video matching a cached stream binds to cache', async () => {
    const res = await fetch(`${base}/jobs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sourceKeys: ['draft-1/chat.csv', 'draft-1/teststream_video.mp4'],
        targets: ['tiktok'],
      }),
    })
    expect(res.status).toBe(200)
    jobId = (await res.json()).jobId
    expect(jobId).toBeTruthy()
  })

  it('reaches completed status and returns real mapped clips', async () => {
    let status = 'pending'
    for (let i = 0; i < 40 && status !== 'completed' && status !== 'failed'; i++) {
      await new Promise((r) => setTimeout(r, 50))
      status = (await (await fetch(`${base}/jobs/${jobId}`)).json()).status
    }
    expect(status).toBe('completed')

    const { clips } = await (await fetch(`${base}/jobs/${jobId}/clips`)).json()
    expect(clips).toHaveLength(1)
    const clip = clips[0]
    expect(clip.clipId).toBe('clip_01')
    expect(clip.titleNative).toBe('測試標題')
    expect(clip.momentType).toBe('food reaction')
    expect(clip.score).toBe(72)
    expect(clip.videoUrl).toContain('/media/teststream/clip_01_funny.proxy.mp4')
    expect(clip.thumbUrl).toContain('/media/teststream/clip_01_funny.jpg')
    expect(clip.cropConfirmed).toBe(false)
  })

  it('Task 7: crop-confirm, refinement, confirm-selection and handoff work on cached clips', async () => {
    // crop-confirm
    const patched = await (
      await fetch(`${base}/jobs/${jobId}/clips/clip_01`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ start: 12, end: 30 }),
      })
    ).json()
    expect(patched).toMatchObject({ clipId: 'clip_01', start: 12, end: 30, cropConfirmed: true })

    // refinement
    const refinement = await (
      await fetch(`${base}/jobs/${jobId}/refinements`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targetType: 'clip',
          targetIds: ['clip_01'],
          actionType: 'chip',
          chipType: 'faster_pacing',
        }),
      })
    ).json()
    expect(refinement.status).toBe('completed')

    // confirm-selection -> handoff
    const { handoffId } = await (
      await fetch(`${base}/jobs/${jobId}/confirm-selection`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clipIds: ['clip_01'] }),
      })
    ).json()
    expect(handoffId).toBeTruthy()

    const { clips } = await (await fetch(`${base}/handoff/${handoffId}`)).json()
    expect(clips).toHaveLength(1)
    expect(clips[0]).toMatchObject({ clipId: 'clip_01', titleNative: '測試標題' })
  })
})

describe('Task 5: /media serves real files with HTTP Range', () => {
  it('returns 200 + full body with no Range header', async () => {
    const res = await fetch(`${base}/media/${CACHED_SID}/clip_01_funny.proxy.mp4`)
    expect(res.status).toBe(200)
    expect(res.headers.get('accept-ranges')).toBe('bytes')
    expect(res.headers.get('content-type')).toBe('video/mp4')
    const body = Buffer.from(await res.arrayBuffer())
    expect(body.length).toBe(proxyBytes.length)
  })

  it('returns 206 Partial Content + correct Content-Range for a Range request', async () => {
    const res = await fetch(`${base}/media/${CACHED_SID}/clip_01_funny.proxy.mp4`, {
      headers: { Range: 'bytes=0-1023' },
    })
    expect(res.status).toBe(206)
    expect(res.headers.get('content-range')).toBe(`bytes 0-1023/${proxyBytes.length}`)
    expect(res.headers.get('content-length')).toBe('1024')
    const body = Buffer.from(await res.arrayBuffer())
    expect(body.length).toBe(1024)
  })

  it('returns 416 for an unsatisfiable range', async () => {
    const res = await fetch(`${base}/media/${CACHED_SID}/clip_01_funny.proxy.mp4`, {
      headers: { Range: 'bytes=999999-1000000' },
    })
    expect(res.status).toBe(416)
    expect(res.headers.get('content-range')).toBe(`bytes */${proxyBytes.length}`)
  })

  it('returns 404 for missing media', async () => {
    const res = await fetch(`${base}/media/${CACHED_SID}/does-not-exist.mp4`)
    expect(res.status).toBe(404)
  })
})

describe('live path: stream-id derivation for demo clips', () => {
  async function createJob(sourceKeys) {
    const res = await fetch(`${base}/jobs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sourceKeys, targets: [] }),
    })
    return (await res.json()).jobId
  }

  it('pins a known demo video to a filename-derived stream-id', async () => {
    const jobId = await createJob(['d/6910008_video.mp4', 'd/6910008_log.csv'])
    expect(handle._state.jobs.get(jobId).streamId).toBe('6910008')
  })

  it('keeps a unique UUID stream-id (== jobId) for non-allowlisted uploads', async () => {
    const jobId = await createJob(['d/random-clip.mp4', 'd/chat.csv'])
    expect(handle._state.jobs.get(jobId).streamId).toBe(jobId)
  })
})

describe('live path guard: a job missing the video or chat log fails fast', () => {
  it('fails a job with only a CSV (no video)', async () => {
    const res = await fetch(`${base}/jobs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sourceKeys: ['draft-9/only.csv'], targets: [] }),
    })
    const { jobId } = await res.json()
    let status = 'pending'
    for (let i = 0; i < 20 && status !== 'failed'; i++) {
      await new Promise((r) => setTimeout(r, 50))
      status = (await (await fetch(`${base}/jobs/${jobId}`)).json()).status
    }
    expect(status).toBe('failed')
  })
})
