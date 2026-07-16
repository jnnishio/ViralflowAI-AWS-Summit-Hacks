// @vitest-environment node
import { describe, expect, it } from 'vitest'
import {
  manifestEntryToClip,
  manifestToClips,
  mediaUrl,
} from './manifest.mjs'

const BASE = 'http://localhost:3000'

const FULL_ENTRY = {
  start_s: 2074.0,
  end_s: 2134.0,
  virality_score: 72,
  mood: 'funny',
  category: 'food reaction',
  factors: { chat: 3.498, audio: 1.267, visual: 0.622, speech: -0.142 },
  title_zh: '減重粽竟然沒有味道',
  title_en: 'Diet Zongzi',
  hook_zh: '減重粽是什麼',
  caption_zh: '第一次吃減重粽',
  caption_en: 'First time trying',
  hashtags: ['#減重粽', '#foodreaction'],
  file: 'out/3654414/clips/clip_01_funny.mp4',
  thumb: 'out/3654414/clips/clip_01_funny.jpg',
  proxy: 'out/3654414/clips/clip_01_funny.proxy.mp4',
}

describe('mediaUrl', () => {
  it('builds a /media URL from the basename of a repo-relative path', () => {
    expect(mediaUrl(BASE, '3654414', 'out/3654414/clips/clip_01_funny.mp4')).toBe(
      'http://localhost:3000/media/3654414/clip_01_funny.mp4',
    )
  })
  it('returns null for a missing path', () => {
    expect(mediaUrl(BASE, '3654414', null)).toBeNull()
  })
})

describe('manifestEntryToClip: full field mapping', () => {
  const clip = manifestEntryToClip(FULL_ENTRY, 0, '3654414', BASE)

  it('maps every field per the contract', () => {
    expect(clip).toEqual({
      clipId: 'clip_01',
      start: 2074.0,
      end: 2134.0,
      score: 72,
      factors: { chat: 3.498, audio: 1.267, visual: 0.622, speech: -0.142 },
      mood: 'funny',
      momentType: 'food reaction',
      titleNative: '減重粽竟然沒有味道',
      titleEnglish: 'Diet Zongzi',
      caption: '第一次吃減重粽',
      hashtags: ['#減重粽', '#foodreaction'],
      thumbUrl: 'http://localhost:3000/media/3654414/clip_01_funny.jpg',
      videoUrl: 'http://localhost:3000/media/3654414/clip_01_funny.proxy.mp4',
      cropConfirmed: false,
    })
  })

  it('uses proxy for videoUrl, preferring it over file', () => {
    expect(clip.videoUrl).toContain('.proxy.mp4')
  })
})

describe('manifestEntryToClip: defaults for thin/partial entries', () => {
  it('defaults missing factors to 0 and missing text to empty', () => {
    const clip = manifestEntryToClip(
      { start_s: 1, end_s: 2, virality_score: 5, file: 'out/x/clips/c.mp4', thumb: 'out/x/clips/c.jpg' },
      2,
      'x',
      BASE,
    )
    expect(clip.clipId).toBe('clip_03')
    expect(clip.factors).toEqual({ chat: 0, audio: 0, visual: 0, speech: 0 })
    expect(clip.titleNative).toBe('')
    expect(clip.hashtags).toEqual([])
    // no proxy -> falls back to file for videoUrl
    expect(clip.videoUrl).toBe('http://localhost:3000/media/x/c.mp4')
  })

  it('falls back to caption_en when caption_zh is absent', () => {
    const clip = manifestEntryToClip({ caption_en: 'english only' }, 0, 'x', BASE)
    expect(clip.caption).toBe('english only')
  })
})

describe('manifestToClips', () => {
  it('maps an array with 1-based padded clip ids', () => {
    const clips = manifestToClips([FULL_ENTRY, { ...FULL_ENTRY }], '3654414', BASE)
    expect(clips.map((c) => c.clipId)).toEqual(['clip_01', 'clip_02'])
  })
  it('returns [] for a non-array', () => {
    expect(manifestToClips(null, 'x', BASE)).toEqual([])
  })
})
