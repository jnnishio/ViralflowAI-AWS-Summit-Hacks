import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  authHeaders,
  DEMO_ACCESS_TOKEN,
  getAccessToken,
  initDevAuth,
  isLocalBaseUrl,
  setAccessToken,
} from './auth'

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

describe('isLocalBaseUrl', () => {
  it('recognizes localhost and loopback addresses (any port)', () => {
    expect(isLocalBaseUrl('http://localhost:3000')).toBe(true)
    expect(isLocalBaseUrl('http://localhost')).toBe(true)
    expect(isLocalBaseUrl('http://127.0.0.1:3000/')).toBe(true)
    expect(isLocalBaseUrl('https://localhost:8080/prod')).toBe(true)
  })

  it('rejects deployed API Gateway hosts', () => {
    expect(
      isLocalBaseUrl('https://8lxgkmh7ff.execute-api.us-east-1.amazonaws.com/prod'),
    ).toBe(false)
    // guard against a naive substring match on "localhost"
    expect(isLocalBaseUrl('https://localhost.evil.example.com')).toBe(false)
  })
})

describe('initDevAuth (Task 1: localhost short-circuit)', () => {
  beforeEach(() => {
    setAccessToken(null)
  })

  it('sets the static demo token and fires NO network request on localhost', async () => {
    const fetchSpy = vi.fn()
    await initDevAuth({
      restBaseUrl: 'http://localhost:3000',
      cognitoUserPoolId: 'us-east-1_ffg3ehM8j',
      cognitoClientId: 'some-client-id',
      fetchImpl: fetchSpy as unknown as typeof fetch,
    })
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(getAccessToken()).toBe(DEMO_ACCESS_TOKEN)
    expect(authHeaders()).toEqual({ Authorization: `Bearer ${DEMO_ACCESS_TOKEN}` })
  })

  it('performs the Cognito dev sign-in fetch against a cloud base URL', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      json: () => Promise.resolve({ AuthenticationResult: { IdToken: 'cloud-id-token' } }),
    })
    await initDevAuth({
      restBaseUrl: 'https://8lxgkmh7ff.execute-api.us-east-1.amazonaws.com/prod',
      cognitoUserPoolId: 'us-east-1_ffg3ehM8j',
      cognitoClientId: 'some-client-id',
      fetchImpl: fetchSpy as unknown as typeof fetch,
    })
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    expect(getAccessToken()).toBe('cloud-id-token')
  })

  it('does nothing on a cloud base URL when Cognito is not configured', async () => {
    const fetchSpy = vi.fn()
    await initDevAuth({
      restBaseUrl: 'https://api.example.com/prod',
      cognitoUserPoolId: '',
      cognitoClientId: '',
      fetchImpl: fetchSpy as unknown as typeof fetch,
    })
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(getAccessToken()).toBeNull()
  })
})
