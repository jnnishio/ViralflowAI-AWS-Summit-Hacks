// @vitest-environment node
import { describe, expect, it } from 'vitest'
import {
  extensionOf,
  keyFilename,
  resolveRoles,
  roleOf,
} from './roles.mjs'

describe('roles: extension + role classification', () => {
  it('extracts the filename from a "<jobDraftId>/<filename>" key', () => {
    expect(keyFilename('abc-123/my video.mp4')).toBe('my video.mp4')
    expect(keyFilename('log.csv')).toBe('log.csv')
  })

  it('reads a case-insensitive extension', () => {
    expect(extensionOf('draft/CLIP.MP4')).toBe('.mp4')
    expect(extensionOf('draft/chat.CSV')).toBe('.csv')
    expect(extensionOf('draft/noext')).toBe('')
  })

  it('classifies video and chat-log extensions', () => {
    expect(roleOf('d/a.mp4')).toBe('video')
    expect(roleOf('d/a.mov')).toBe('video')
    expect(roleOf('d/a.mkv')).toBe('video')
    expect(roleOf('d/a.csv')).toBe('chatLog')
    expect(roleOf('d/a.txt')).toBe('unknown')
  })
})

describe('resolveRoles: pairing by extension, not position', () => {
  it('resolves roles when the video is uploaded first', () => {
    const r = resolveRoles(['draft/stream.mp4', 'draft/chat.csv'])
    expect(r.videoKey).toBe('draft/stream.mp4')
    expect(r.chatLogKey).toBe('draft/chat.csv')
  })

  it('resolves the SAME roles when the CSV is uploaded first (the audio.py bug)', () => {
    const r = resolveRoles(['draft/chat.csv', 'draft/stream.mp4'])
    expect(r.videoKey).toBe('draft/stream.mp4')
    expect(r.chatLogKey).toBe('draft/chat.csv')
    expect(r.videoName).toBe('stream.mp4')
    expect(r.chatLogName).toBe('chat.csv')
  })

  it('returns null for a missing role', () => {
    expect(resolveRoles(['draft/only.mp4']).chatLogKey).toBeNull()
    expect(resolveRoles(['draft/only.csv']).videoKey).toBeNull()
    expect(resolveRoles([]).videoKey).toBeNull()
  })

  it('takes the first match of each role and ignores extras/unknowns', () => {
    const r = resolveRoles([
      'd/notes.txt',
      'd/a.mov',
      'd/b.mp4',
      'd/first.csv',
      'd/second.csv',
    ])
    expect(r.videoKey).toBe('d/a.mov')
    expect(r.chatLogKey).toBe('d/first.csv')
  })
})
