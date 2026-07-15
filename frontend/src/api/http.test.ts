import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setAccessToken } from './auth'
import { http } from './http'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('http client auth header wiring (Task 16.3, Req 3.1, 3.2)', () => {
  beforeEach(() => {
    setAccessToken('the-cognito-token')
  })

  afterEach(() => {
    setAccessToken(null)
    vi.unstubAllGlobals()
  })

  it('attaches the Cognito Authorization header on GET requests', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ok: true }))
    vi.stubGlobal('fetch', fetchMock)

    await http.get('/jobs/job-1')

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [, init] = fetchMock.mock.calls[0]
    expect(init.headers.Authorization).toBe('Bearer the-cognito-token')
  })

  it('attaches the Cognito Authorization header on POST requests', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ok: true }))
    vi.stubGlobal('fetch', fetchMock)

    await http.post('/jobs', { sourceKeys: [], targets: ['tiktok'] })

    const [, init] = fetchMock.mock.calls[0]
    expect(init.headers.Authorization).toBe('Bearer the-cognito-token')
  })

  it('attaches the Cognito Authorization header on PATCH requests', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ok: true }))
    vi.stubGlobal('fetch', fetchMock)

    await http.patch('/jobs/job-1/clips/clip-1', { start: 0, end: 1 })

    const [, init] = fetchMock.mock.calls[0]
    expect(init.headers.Authorization).toBe('Bearer the-cognito-token')
  })

  it('omits the Authorization header when no token is set', async () => {
    setAccessToken(null)
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ok: true }))
    vi.stubGlobal('fetch', fetchMock)

    await http.get('/jobs/job-1')

    const [, init] = fetchMock.mock.calls[0]
    expect(init.headers.Authorization).toBeUndefined()
  })
})
