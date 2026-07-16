// @vitest-environment node
import { afterAll, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { hasCompleteManifest, matchCachedStream, scanCachedStreams } from './cache.mjs'

const tmpDirs = []
async function makeOutTree(streams) {
  const root = await mkdtemp(join(tmpdir(), 'cache-test-'))
  tmpDirs.push(root)
  for (const [sid, complete] of Object.entries(streams)) {
    const dir = join(root, sid, 'clips')
    await mkdir(dir, { recursive: true })
    if (complete) {
      await writeFile(join(dir, 'manifest.json'), JSON.stringify([{ start_s: 1 }]))
    }
  }
  return root
}

afterAll(async () => {
  await Promise.all(tmpDirs.map((d) => rm(d, { recursive: true, force: true })))
})

describe('scanCachedStreams', () => {
  it('finds only stream dirs with a non-empty manifest.json', async () => {
    const root = await makeOutTree({ '3654414': true, '9999999': true, incomplete: false })
    const found = await scanCachedStreams(root)
    expect(found).toEqual(['3654414', '9999999'])
  })

  it('returns [] for a missing out root', async () => {
    expect(await scanCachedStreams('/no/such/path/here')).toEqual([])
  })

  it('hasCompleteManifest reflects presence', async () => {
    const root = await makeOutTree({ good: true, bad: false })
    expect(await hasCompleteManifest(root, 'good')).toBe(true)
    expect(await hasCompleteManifest(root, 'bad')).toBe(false)
  })
})

describe('matchCachedStream', () => {
  const cached = ['3654414', '6910008']

  it('matches a stream-id embedded in the uploaded filename', () => {
    expect(matchCachedStream('3654414_video.mp4', cached)).toBe('3654414')
    expect(matchCachedStream('6910008_log_export.mp4', cached)).toBe('6910008')
  })

  it('matches a leading numeric run-id', () => {
    expect(matchCachedStream('6910008.mp4', cached)).toBe('6910008')
  })

  it('returns null when nothing matches', () => {
    expect(matchCachedStream('random-clip.mp4', cached)).toBeNull()
    expect(matchCachedStream('', cached)).toBeNull()
    expect(matchCachedStream('3654414.mp4', [])).toBeNull()
  })

  it('prefers the longest matching id', () => {
    expect(matchCachedStream('36544140_v.mp4', ['3654414', '36544140'])).toBe('36544140')
  })
})
