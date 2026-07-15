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

/**
 * Base URL of the vendored OpenCut editor app (apps/editor). This is a
 * SEPARATE app from the REST/pipeline server — the editor runs its own Next.js
 * dev server, so it must NOT reuse REST_API_BASE_URL (localhost:3000, the
 * pipeline server). Default 3100 to avoid that port clash; run the editor with
 * `next dev -p 3100` (see apps/editor/apps/web `dev:highlight` script).
 */
export const EDITOR_BASE_URL: string =
  import.meta.env.VITE_EDITOR_BASE_URL ?? 'http://localhost:3100'

/**
 * The editor video id that "Open in Editor" deep-links into. The editor is a
 * self-contained fixture demo that currently only serves `video_3654414`
 * (clip_01..clip_05), so for the demo this is pinned via VITE_EDITOR_VIDEO_ID.
 * When empty, callers fall back to `video_{jobId}` (for a future dynamic
 * per-job integration once the editor can load arbitrary videos).
 */
export const EDITOR_VIDEO_ID: string = import.meta.env.VITE_EDITOR_VIDEO_ID ?? ''

export const COGNITO_USER_POOL_ID: string = import.meta.env.VITE_COGNITO_USER_POOL_ID || ''
export const COGNITO_CLIENT_ID: string = import.meta.env.VITE_COGNITO_CLIENT_ID || ''
