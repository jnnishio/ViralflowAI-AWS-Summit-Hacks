// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { contentTypeFor, parseRange } from './media-range.mjs'

describe('contentTypeFor', () => {
  it('maps common media extensions', () => {
    expect(contentTypeFor('a/b/clip.mp4')).toBe('video/mp4')
    expect(contentTypeFor('t.JPG')).toBe('image/jpeg')
    expect(contentTypeFor('x.unknown')).toBe('application/octet-stream')
  })
})

describe('parseRange', () => {
  const SIZE = 1000

  it('returns null when there is no range header (caller serves full 200)', () => {
    expect(parseRange(undefined, SIZE)).toBeNull()
    expect(parseRange('', SIZE)).toBeNull()
    expect(parseRange('bytes=-', SIZE)).toBeNull()
    expect(parseRange('items=0-10', SIZE)).toBeNull()
  })

  it('parses a closed range inclusively', () => {
    expect(parseRange('bytes=0-499', SIZE)).toEqual({ satisfiable: true, start: 0, end: 499 })
  })

  it('parses an open-ended range to the last byte', () => {
    expect(parseRange('bytes=500-', SIZE)).toEqual({ satisfiable: true, start: 500, end: 999 })
  })

  it('clamps an end past EOF', () => {
    expect(parseRange('bytes=900-100000', SIZE)).toEqual({ satisfiable: true, start: 900, end: 999 })
  })

  it('parses a suffix range (last N bytes)', () => {
    expect(parseRange('bytes=-200', SIZE)).toEqual({ satisfiable: true, start: 800, end: 999 })
  })

  it('flags an unsatisfiable range (start past EOF)', () => {
    expect(parseRange('bytes=2000-3000', SIZE)).toEqual({ satisfiable: false })
  })
})
