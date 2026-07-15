// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { DEMO_STREAM_IDS, deriveStreamId } from './stream-id.mjs'

describe('deriveStreamId (demo allowlist only)', () => {
  it('derives from the known demo video filenames', () => {
    expect(deriveStreamId(['6910008_video.mp4', '6910008_log.csv'])).toBe('6910008')
    expect(deriveStreamId(['3654414_video.mp4', '3654414_log.csv'])).toBe('3654414')
  })

  it('also matches from the chat-log filename alone', () => {
    expect(deriveStreamId([null, '6910008_log.csv'])).toBe('6910008')
    expect(deriveStreamId([undefined, '3654414_chat_export.csv'])).toBe('3654414')
  })

  it('returns null for any non-allowlisted upload (keeps the UUID default)', () => {
    expect(deriveStreamId(['my-stream.mp4', 'chat.csv'])).toBeNull()
    expect(deriveStreamId(['1234567_video.mp4', '1234567_log.csv'])).toBeNull()
    expect(deriveStreamId(['540c917c-b57e_video.mp4'])).toBeNull()
    expect(deriveStreamId([])).toBeNull()
    expect(deriveStreamId(null)).toBeNull()
  })

  it('exposes exactly the two demo ids', () => {
    expect(DEMO_STREAM_IDS).toEqual(['6910008', '3654414'])
  })
})
