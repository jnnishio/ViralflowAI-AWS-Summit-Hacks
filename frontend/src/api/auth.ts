import { COGNITO_USER_POOL_ID, COGNITO_CLIENT_ID, REST_API_BASE_URL } from './config'

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
 *
 * Local-first demo (see Implementation Plan Task 1): when the app points at a
 * localhost REST base URL it is talking to the local Node dev server, which
 * has no Cognito. In that mode we must NOT fire the dev sign-in fetch at all —
 * it throws noisy errors on flaky/no Wi-Fi and blocks an offline demo. Instead
 * we set a static demo token so the Authorization header + WS token still flow
 * through unchanged.
 */

const TOKEN_STORAGE_KEY = 'webapp-skeleton.accessToken'

/** Static token used for the local/offline demo (no Cognito round-trip). */
export const DEMO_ACCESS_TOKEN = 'local-demo-token'

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

/** True when the REST base URL resolves to the local dev server. */
export function isLocalBaseUrl(url: string): boolean {
  return /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?(?:\/|$)/i.test(url)
}

export interface DevAuthOptions {
  restBaseUrl: string
  cognitoUserPoolId: string
  cognitoClientId: string
  /** Injectable for tests; defaults to the global fetch. */
  fetchImpl?: typeof fetch
}

/**
 * Dev-only auth bootstrap. Split out from the module side effect so it is
 * unit-testable (the module below invokes it once at import time in DEV).
 *
 * - localhost base URL -> set the static demo token, fire NO network request.
 * - otherwise -> perform the existing Cognito USER_PASSWORD_AUTH dev sign-in.
 *
 * Returns a promise that resolves once any async work settles (resolves
 * immediately for the localhost path).
 */
export function initDevAuth(options: DevAuthOptions): Promise<void> {
  const { restBaseUrl, cognitoUserPoolId, cognitoClientId } = options

  // Local-first path: no Cognito, no fetch, fully offline-safe.
  if (isLocalBaseUrl(restBaseUrl)) {
    setAccessToken(DEMO_ACCESS_TOKEN)
    return Promise.resolve()
  }

  const doFetch = options.fetchImpl ?? fetch
  const region = cognitoUserPoolId ? cognitoUserPoolId.split('_')[0] : null
  if (!cognitoClientId || !region) return Promise.resolve()

  console.log('Fetching fresh dev token...')
  return doFetch(`https://cognito-idp.${region}.amazonaws.com/`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-amz-json-1.1',
      'X-Amz-Target': 'AWSCognitoIdentityProviderService.InitiateAuth',
    },
    body: JSON.stringify({
      AuthFlow: 'USER_PASSWORD_AUTH',
      ClientId: cognitoClientId,
      AuthParameters: {
        USERNAME: 'dev-user@example.com',
        PASSWORD: 'DevPassword123!',
      },
    }),
  })
    .then((res) => res.json())
    .then((data) => {
      if (data.AuthenticationResult?.IdToken) {
        setAccessToken(data.AuthenticationResult.IdToken)
        console.log('Silent dev login successful!')
      } else {
        console.error('Silent dev login failed:', data)
      }
    })
    .catch((err) => console.error('Silent dev login error:', err))
}

if (import.meta.env.DEV) {
  void initDevAuth({
    restBaseUrl: REST_API_BASE_URL,
    cognitoUserPoolId: COGNITO_USER_POOL_ID,
    cognitoClientId: COGNITO_CLIENT_ID,
  })
}
