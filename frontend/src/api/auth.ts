import { COGNITO_USER_POOL_ID, COGNITO_CLIENT_ID } from './config'

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

if (import.meta.env.DEV) {
  const region = COGNITO_USER_POOL_ID ? COGNITO_USER_POOL_ID.split('_')[0] : null
  if (COGNITO_CLIENT_ID && region) {
    console.log('Fetching fresh dev token...')
    fetch(`https://cognito-idp.${region}.amazonaws.com/`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-amz-json-1.1',
        'X-Amz-Target': 'AWSCognitoIdentityProviderService.InitiateAuth'
      },
      body: JSON.stringify({
        AuthFlow: 'USER_PASSWORD_AUTH',
        ClientId: COGNITO_CLIENT_ID,
        AuthParameters: {
          USERNAME: 'dev-user@example.com',
          PASSWORD: 'DevPassword123!'
        }
      })
    })
    .then(res => res.json())
    .then(data => {
      if (data.AuthenticationResult?.IdToken) {
        setAccessToken(data.AuthenticationResult.IdToken)
        console.log('Silent dev login successful!')
      } else {
        console.error('Silent dev login failed:', data)
      }
    })
    .catch(err => console.error('Silent dev login error:', err))
  }
}
