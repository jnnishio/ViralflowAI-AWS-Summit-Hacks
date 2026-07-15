import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setAccessToken } from './auth'
import { connectProgress } from './progressApi'

class FakeWebSocket {
  static instances: FakeWebSocket[] = []
  url: string
  sent: string[] = []
  onopen: (() => void) | null = null
  onmessage: ((event: { data: string }) => void) | null = null
  onclose: (() => void) | null = null
  onerror: (() => void) | null = null

  constructor(url: string) {
    this.url = url
    FakeWebSocket.instances.push(this)
  }

  send(data: string) {
    this.sent.push(data)
  }

  close() {
    this.onclose?.()
  }
}

describe('Progress_API WebSocket auth wiring (Task 16.3, Req 3.4)', () => {
  beforeEach(() => {
    FakeWebSocket.instances = []
    vi.stubGlobal('WebSocket', FakeWebSocket as unknown as typeof WebSocket)
  })

  afterEach(() => {
    setAccessToken(null)
    vi.unstubAllGlobals()
  })

  it('includes the Cognito token as a query param on the connection URL', () => {
    setAccessToken('ws-token')

    connectProgress('job-123', { onEvent: () => {} })

    const socket = FakeWebSocket.instances[0]
    expect(socket.url).toContain('token=ws-token')
  })

  it('sends a subscribe message with the jobId once the connection opens', () => {
    setAccessToken('ws-token')

    connectProgress('job-123', { onEvent: () => {} })

    const socket = FakeWebSocket.instances[0]
    socket.onopen?.()

    expect(socket.sent).toHaveLength(1)
    expect(JSON.parse(socket.sent[0])).toEqual({
      action: 'subscribe',
      jobId: 'job-123',
    })
  })

  it('omits the token query param when no token is set', () => {
    setAccessToken(null)

    connectProgress('job-123', { onEvent: () => {} })

    const socket = FakeWebSocket.instances[0]
    expect(socket.url).not.toContain('token=')
  })
})
