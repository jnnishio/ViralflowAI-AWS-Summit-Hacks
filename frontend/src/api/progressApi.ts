import { getAccessToken } from './auth'
import { WS_API_BASE_URL } from './config'

export type ProgressStatus = 'started' | 'completed' | 'failed'

export interface ProgressEvent {
  jobId: string
  stage: string
  status: ProgressStatus
}

export interface ProgressClientHandlers {
  onEvent: (event: ProgressEvent) => void
  onClose?: () => void
  onError?: () => void
}

export interface ProgressClient {
  close: () => void
}

/**
 * Connects to Progress_API, attaches the Auth_Service token to the
 * connection URL (Req 3.4), and subscribes to `jobId` once open (Req 5.1,
 * 5.3). Returns a handle to close the connection; ProcessingScreen's
 * polling-fallback logic (Task 19.2) decides when to call connect/close
 * based on onClose/onError firing.
 */
export function connectProgress(
  jobId: string,
  handlers: ProgressClientHandlers,
): ProgressClient {
  const token = getAccessToken()
  const url = token
    ? `${WS_API_BASE_URL}?token=${encodeURIComponent(token)}`
    : WS_API_BASE_URL

  const socket = new WebSocket(url)

  socket.onopen = () => {
    socket.send(JSON.stringify({ action: 'subscribe', jobId }))
  }

  socket.onmessage = (event) => {
    try {
      const parsed = JSON.parse(event.data) as ProgressEvent
      handlers.onEvent(parsed)
    } catch {
      // ignore malformed frames
    }
  }

  socket.onclose = () => handlers.onClose?.()
  socket.onerror = () => handlers.onError?.()

  return {
    close: () => socket.close(),
  }
}
