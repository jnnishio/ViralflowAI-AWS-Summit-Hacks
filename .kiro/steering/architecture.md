# Architecture Guideline — Live Stream Highlight Generator (MVP)

This document is the source of truth for the product architecture. Follow it when
building features, and keep it updated when architectural decisions change.

## Product summary

A web app that turns long VODs / livestream recordings into social-media-ready
highlight clips and compilations for TikTok, Instagram Reels, and YouTube Shorts.
Core loop: upload VOD → analyze with a multimodal highlight-detection algorithm →
review scored highlights in a grid → AI auto-edits selected clips → refine in a
built-in editor → export per platform with captions.

## Guiding principles

- **Async by default.** Video work is long-running; never block a request on it.
  Orchestrate with Step Functions, report progress over WebSocket (poll as fallback).
- **Direct-to-S3 for large media.** Browser uploads/downloads use presigned URLs.
  Compute never proxies raw video bytes.
- **Edits are data, not renders.** Represent AI edits as an Edit Decision List (EDL)
  JSON. Only render pixels at final export. This keeps iteration cheap.
- **Work on proxies.** Run analysis and browser editing against a low-res proxy;
  render the final output from the source.
- **Auth from day one.** Every API route sits behind a Cognito authorizer.
  S3 is presigned-only, no public buckets.
- **Config over redeploy.** Scoring weights, effect library metadata, and platform
  presets live in config so they can be tuned without code changes.

## System shape

```
                         ┌─────────────────────────────────────────┐
   Browser (React SPA)   │  CloudFront + S3 (static hosting)        │
   - upload UI           └─────────────────────────────────────────┘
   - highlights grid                     │  HTTPS / WSS
   - forked video editor                 ▼
   - export dialog        ┌─────────────────────────────────────────┐
        │  presigned PUT   │  API Gateway (REST + WebSocket)         │
        │────────────────► │  Cognito authorizer                     │
        ▼                  └─────────────────────────────────────────┘
   ┌──────────┐                           │  invokes
   │ S3 raw   │                           ▼
   │ (VODs)   │            ┌─────────────────────────────────────────┐
   └──────────┘            │  Lambda (thin API handlers)             │
        │ ObjectCreated    │  - create job, get status, list clips   │
        ▼                  │  - request edit, request export         │
   ┌─────────────────────────────────────────────────────────────┐
   │           Step Functions: "Analyze VOD" pipeline             │
   │  1 MediaConvert (normalize + proxy + audio extract)          │
   │  2 Transcribe (word-level timestamps)                        │
   │  3 Rekognition (shots, faces+emotion, labels, on-screen text)│
   │  4 Audio analysis Lambda (loudness/laughter/energy spikes)   │
   │  5 Chat analysis Lambda (message-rate spikes, if chat file)  │
   │  6 Fusion Lambda → candidate windows + virality score        │
   │  7 Bedrock (Claude) → categorize + label + captions          │
   └─────────────────────────────────────────────────────────────┘
        │ writes                          │ progress events
        ▼                                 ▼
   ┌──────────┐                    ┌──────────────┐
   │ DynamoDB │◄───────────────────│  WebSocket    │──► live UI progress
   │ jobs,    │                    │  push          │
   │ clips    │                    └──────────────┘
   └──────────┘
```

## User flow → services

### 1. Upload VODs
Frontend requests a presigned multipart-upload URL from a Lambda, then uploads
directly to the S3 `raw/` bucket. An explicit "start job" call (carrying platform
selections) begins the pipeline.

### 2. Select platforms (TikTok / Reels / Shorts)
Stored as job metadata (`targets: ["tiktok","reels","shorts"]`). Only consumed at
export time for aspect ratio, duration caps, and bitrate.

### 3. Highlight detection + processing animation
Long-running, so orchestrated by **Step Functions** with fan-out:
- **MediaConvert** — normalize source, emit low-res proxy for the browser editor,
  extract audio track.
- **Transcribe** — word-level timestamps (backbone for cutting on sentence boundaries).
- **Rekognition Video** — shot boundaries, face emotions, labels/activities, on-screen text.
- **Audio analysis Lambda** — RMS loudness spikes, laughter/cheer energy (cheap, strong signal).
- **Chat analysis Lambda** — message-rate and emote-burst spikes when a chat log is
  provided. For live content this is often the single best virality predictor; prioritize it.

UI progress is driven by real Step Functions state transitions pushed over an
API Gateway WebSocket (fallback: poll `GET /jobs/{id}`).

### The highlight-detection / virality algorithm (Fusion Lambda)
Slide a window over the timeline; for each candidate compute a weighted composite of
z-normalized signals (normalized per-VOD so scores are comparable within a stream):

```
score = w_chat·chatSpikeZ + w_audio·audioEnergyZ + w_emotion·faceEmotionPeak
      + w_text·transcriptSalience + w_scene·sceneChangeDensity
```

Bedrock then adds the semantic pass: category ("funny moment", "clutch play",
"hot take"), a one-line title, and the factor breakdown shown in "view score details."
Keep weights in config for tuning without redeploy.

### 4. Grid + sort + score details + multi-select / Compilation mode
All DynamoDB reads. Each clip row holds `{start, end, score, factors{}, category,
title, thumbnailKey}`. Sort/filter client-side. **Compilation mode** groups by
`category` (assigned by Bedrock). Quick-action chips (reorder, faster pacing, swap
intro, more reactions) map to structured parameters passed to Bedrock; the freeform
prompt is the escape hatch. Chips cover the 80% case cheaply and predictably.

### 5. AI auto-edit engine
Bedrock receives selected clips + the **effects library manifest** (each sound/visual
effect described with metadata: name, type, duration, "use when…" guidance) and
returns an **Edit Decision List** — ordered segments, transitions, effect placements,
music bed, caption overlays. The EDL is data, cheap to regenerate on tweaks.

### 6. Built-in editor (fork of openvideodev/react-video-editor)
Loads the low-res proxy + the EDL as initial timeline state, so the user edits the
AI's first draft rather than from scratch. Editing is client-side; only final render
hits the backend. Verify react-video-editor's license and render approach.
For the MVP, render final output with **ffmpeg on Fargate** (flexible enough for
AI-driven overlays/compositing that MediaConvert job templates can't express easily).

### 7 & 8. Export / format / captions
On export, produce one render per selected platform (9:16, duration caps, bitrate
presets). Captions come from the Transcribe transcript, reformatted per platform by
Bedrock (phrasing + hashtags), returned as copy-to-clipboard text plus optional
burned-in SRT. "Export raw file" serves the rendered MP4 via presigned GET.

## Data model (DynamoDB, single-table friendly)

- `Job`: `jobId, userId, status, targets[], sourceKey, proxyKey, createdAt`
- `Clip`: `jobId, clipId, start, end, score, factors{}, category, title, thumbKey`
- `Edit`: `jobId, editId, clipIds[], edl(json), status`
- `Export`: `jobId, exportId, platform, outputKey, captions`

## Tech stack

- **Frontend:** React SPA (fork of openvideodev/react-video-editor), hosted on S3 + CloudFront.
- **API:** API Gateway (REST + WebSocket) + Cognito authorizer + Lambda handlers.
- **Orchestration:** Step Functions.
- **Media:** S3 (raw/proxy/output), MediaConvert (transcode/proxy), ffmpeg on Fargate (final render).
- **AI/ML:** Transcribe, Rekognition, Bedrock (Claude for categorization, EDL, captions).
- **Data:** DynamoDB.
- **IaC:** CDK or SAM (pick one and stay consistent).

## MVP scope

**Ship first (vertical slice, end-to-end demoable):**
upload → analyze pipeline → scored grid → auto-edit EDL → basic editor → single-platform export.

**Fast-follows:**
compilation-mode grouping, freeform LLM edits (chips only at first), simultaneous
multi-platform export, chat-log ingestion (highest-value signal — add right after
the core loop works).

## Non-negotiables to remember

- Cognito authorizer on every API route; presigned-only S3 access.
- Run analysis on proxy/downscaled assets; sample long VODs (e.g., 1fps for labels)
  to keep Rekognition/Transcribe cost and runtime sane.
- Keep scoring weights, effect metadata, and platform presets in config.
