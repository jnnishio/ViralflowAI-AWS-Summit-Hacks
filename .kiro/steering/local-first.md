# Architecture Decision: Local-First Only (AWS Cloud Infra Is Dormant)

This is the current, authoritative decision for how the "Processing" / highlight-
generation flow runs. It applies to ALL AI assistants and agents (Kiro, Claude,
Cursor, Windsurf, Copilot, etc.). If anything else in the repo contradicts this,
this document wins.

## The decision

**Processing runs local-first ONLY.** The local Node dev server
(`frontend/mock-server/server.mjs`) is the active backend. It either:

1. runs the real pipeline (`python3 -m pipeline.run`) as a subprocess, or
2. serves pre-computed cached results from `out/<streamId>/clips/`.

**The AWS cloud orchestration is DORMANT.** The CDK stacks, Lambdas, Step
Functions, and API Gateway under `backend/` are intentionally left in the repo as
a "this scales to the cloud" talking point. They are NOT the active path and are
NOT used for the demo. The Step Functions / Lambda pipeline was failing (numpy
cross-arch packaging, an event-payload `jobId` bug, a `source_keys[0]` ordering
bug) and we are routing around it, not depending on it.

## Do / Don't for agents

- DO treat the local server as the backend the frontend talks to (via
  `VITE_REST_API_URL` / `VITE_WS_API_URL`).
- DO keep using cloud AI through the local pipeline: AWS Transcribe, Rekognition,
  and Bedrock are mandatory and called via `boto3`. S3 (bucket
  `hackathon-152315741309-us-east-1-an`) is a required I/O store for the async
  Transcribe/Rekognition jobs — it is not optional and must not be removed.
- DON'T route Processing through Step Functions / Lambda / API Gateway.
- DON'T debug, "fix", refactor, redeploy, or extend anything under `backend/`
  (CDK, Lambdas, Step Functions) unless the user explicitly asks. Leave it
  untouched by default.
- DON'T introduce any local/offline AI models — ever. No Whisper, no local LLMs,
  no local computer-vision models. Cloud AI (Transcribe/Rekognition/Bedrock) is
  non-negotiable.
- DON'T delete the dormant AWS backend. It stays in the repo.

## How the local path is wired

- `npm run dev` (in `frontend/`) → local server + `vite --mode demo`, pointed at
  `http://localhost:3000` / `ws://localhost:3001` via `.env.demo`.
- `npm run dev:cloud` → the old cloud-pointed build (kept for reference only).
- `frontend/src/api/auth.ts` short-circuits the Cognito dev sign-in and uses a
  static demo token whenever the REST base URL is localhost, so the app boots
  offline with no network errors.
- Two paths converge on the same `manifest.json` → `Clip` mapper and the same
  `GET /media/<streamId>/<file>` (HTTP Range) route:
  - live: upload → subprocess `pipeline.run` → parsed stdout streamed over WS →
    real clips + media served from `out/<streamId>/clips/`.
  - cached: a job binds to an already-rendered `out/<streamId>/` and skips the
    subprocess for a zero-latency, offline demo.
- Video vs chat-log is resolved by file EXTENSION (`.mp4/.mov/.mkv` vs `.csv`),
  never by upload order/array position.

## Local run prerequisites

- Python venv at repo root `.venv` (Python 3.12) with `pipeline/requirements.txt`
  installed (native-arch numpy/scipy/pandas — avoids the cross-arch `.so` bug).
  The local server auto-detects `.venv/bin/python` (override with
  `PIPELINE_PYTHON`).
- `ffmpeg` built WITH `libass` + `libfreetype` (the `ass`/`subtitles` and
  `drawtext` filters) for the render step. The slim `homebrew-core` ffmpeg lacks
  these; use the `homebrew-ffmpeg/ffmpeg` tap. Verify:
  `ffmpeg -filters | grep -E '\b(ass|subtitles|drawtext)\b'`.
- Working AWS credentials (`aws sts get-caller-identity` succeeds) for
  Transcribe/Rekognition/Bedrock/S3.

## Scope note

This is an MVP / demo-driven project (see the root `.clauderules` / `AGENTS.md`).
Favor the happy-path local flow. The cloud is a future story, not current work.
