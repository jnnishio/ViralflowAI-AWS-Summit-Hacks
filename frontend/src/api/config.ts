/**
 * Runtime API endpoint configuration.
 *
 * Read from Vite env vars so the built SPA can point at whatever REST/WS
 * API Gateway stage was deployed by the backend CDK app, without a rebuild
 * per environment (set VITE_REST_API_URL / VITE_WS_API_URL at build/deploy
 * time).
 */

export const REST_API_BASE_URL: string =
  import.meta.env.VITE_REST_API_URL ?? 'http://localhost:3000'

export const WS_API_BASE_URL: string =
  import.meta.env.VITE_WS_API_URL ?? 'ws://localhost:3001'
