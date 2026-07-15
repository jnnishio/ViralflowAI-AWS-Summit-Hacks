/**
 * Auth token wiring (Task 16.3).
 *
 * Attaches the Auth_Service (Cognito) access token to every REST request
 * header and to the WebSocket connection URL, per Req 3.1, 3.2, 3.4.
 *
 * The actual Cognito sign-in flow (hosted UI / Amplify / amazon-cognito-
 * identity-js) is out of scope for the webapp-skeleton; this module is the
 * single seam the rest of the app calls through, so wiring in a real
 * Cognito SDK later only touches this file.
 */

const TOKEN_STORAGE_KEY = 'webapp-skeleton.accessToken'

let inMemoryToken: string | null = null

export function setAccessToken(token: string | null): void {
  inMemoryToken = token
  if (token) {
    window.localStorage.setItem(TOKEN_STORAGE_KEY, token)
  } else {
    window.localStorage.removeItem(TOKEN_STORAGE_KEY)
  }
}

export function getAccessToken(): string | null {
  if (inMemoryToken) return inMemoryToken
  inMemoryToken = window.localStorage.getItem(TOKEN_STORAGE_KEY)
  return inMemoryToken
}

export function authHeaders(): Record<string, string> {
  const token = getAccessToken()
  return token ? { Authorization: `Bearer ${token}` } : {}
}
