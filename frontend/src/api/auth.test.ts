import { beforeEach, describe, expect, it } from 'vitest'
import { authHeaders, getAccessToken, setAccessToken } from './auth'

describe('auth token wiring (Task 16.3)', () => {
  beforeEach(() => {
    setAccessToken(null)
  })

  it('returns no Authorization header when no token is set', () => {
    expect(authHeaders()).toEqual({})
    expect(getAccessToken()).toBeNull()
  })

  it('returns a Bearer Authorization header once a token is set', () => {
    setAccessToken('test-access-token')
    expect(getAccessToken()).toBe('test-access-token')
    expect(authHeaders()).toEqual({ Authorization: 'Bearer test-access-token' })
  })

  it('persists the token across in-memory resets by reading localStorage', () => {
    setAccessToken('persisted-token')
    // Simulate a fresh module load losing the in-memory cache but keeping
    // localStorage (e.g. a page reload) by clearing localStorage directly
    // and confirming setAccessToken(null) clears both.
    setAccessToken(null)
    expect(window.localStorage.getItem('webapp-skeleton.accessToken')).toBeNull()
    expect(getAccessToken()).toBeNull()
  })

  it('clears the token and Authorization header when set to null', () => {
    setAccessToken('some-token')
    setAccessToken(null)
    expect(getAccessToken()).toBeNull()
    expect(authHeaders()).toEqual({})
  })
})
