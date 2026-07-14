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
  extract audio track. (Transcribe rejects media >2GB — always feed it the extracted
  audio track, never the raw VOD.)
- **Transcribe** — word-level timestamps (backbone for cutting on sentence boundaries).
  zh-TW for langlive content; speaker labels on; request SRT/VTT sidecars for export.
- **Rekognition Video** — shot boundaries (also the clip cut points), face emotions
  (SURPRISED/HAPPY spikes), face bounding boxes (reused for 9:16 smart-crop panning).
- **Audio analysis Lambda** — RMS loudness spikes + onset jumps (quiet→scream),
  laughter/cheer energy (cheap, strong signal).
- **Chat analysis Lambda** — per-5s-bin features from the platform event log:
  message-rate z-score, unique chatters, join surges, laugh/slang bursts (哈哈哈, 笑死,
  666), **VIP/user-level-weighted message value** (a whale reacting ≠ a lurker spamming),
  and **template-spam suppression** (novelty weight = 1/√(times this exact text repeats
  in the session) — kills copy-paste fan-club promos that otherwise dominate the peaks).
  For live content this is often the single best virality predictor; prioritize it.

UI progress is driven by real Step Functions state transitions pushed over an
API Gateway WebSocket (fallback: poll `GET /jobs/{id}`).

### The highlight-detection / virality algorithm (Fusion Lambda)
All signals are resampled onto a common 5-second bin grid and z-normalized per-VOD
(so scores are comparable within a stream), then combined as a weighted composite:

```
score = w_chat·chatSpikeZ + w_audio·audioEnergyZ + w_emotion·faceEmotionPeak
      + w_text·transcriptSalience + w_scene·sceneChangeDensity
```

- **Per-vertical weight presets** (config, not code — `config/weights.json`):
  talk/entertainment boosts chat + audio + speech; gaming boosts scene-change + OCR.
- Peak-pick the smoothed curve, then expand each peak outward while the curve stays
  elevated (captures build-up, max ~75s), and merge overlapping windows.
- **Cross-modal validation**: a candidate survives only if ≥2 modalities spike
  together near the peak. This is the false-positive killer (chat spam without an
  on-stream moment, loud music without a reaction, scene-change bursts alone).
- Missing signals degrade gracefully: weights renormalize over whatever modalities
  are present (e.g. no chat file → audio/visual/speech only).

### The AI Director (Bedrock semantic pass)
Statistical peaks become publishable clips here. For each surviving candidate,
Bedrock (Claude) receives the transcript excerpt, the novelty-weighted chat excerpt,
and up to 3 keyframes (multimodal), and returns:
- **keep/drop** — is this genuinely clip-worthy, or idle filler that spiked?
- **Narrative boundaries** — adjusted start/end capturing *setup → payoff*, not just
  the peak (snap near sentence/shot boundaries).
- **virality_score** (0–100), **mood** (funny/hype/emotional/impressive/wholesome/
  controversial), **category** (grouping label for compilation mode).
- **Platform metadata** — title, ≤12-char on-screen hook, caption, hashtags, in
  Traditional Chinese + English.
The per-modality `factors{}` breakdown from fusion is carried through to the clip
record and drives "view score details."

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
- `Clip`: `jobId, clipId, start, end, score, factors{}, category, mood, title,
  titleEn, hook, caption, captionEn, hashtags[], thumbKey`
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

## Reference implementation (repo `pipeline/`)

The detection pipeline exists as runnable Python modules, validated on a real 96-min
langlive VOD (`6910008`) + its event log; the Lambda/Step Functions deployment wraps
these same stages:

- `pipeline/signals/chat.py` — event-log parsing + engagement features + spam suppression
- `pipeline/signals/audio.py` — audio-track extraction + RMS/onset energy
- `pipeline/signals/transcript.py` — Transcribe job mgmt + word-timeline parsing
- `pipeline/signals/visual.py` — Rekognition shot/face jobs + per-bin visual features
- `pipeline/fusion.py` — bin/normalize/weight → excitement curve → validated candidates
- `pipeline/director.py` — Bedrock AI Director (multimodal judging + metadata)
- `pipeline/render.py` — 9:16 face-guided crop, ASS caption burn-in, hook overlay, thumbnails
- `pipeline/run.py` — end-to-end local orchestrator (mirrors the Step Functions graph)

## Non-negotiables to remember

- Cognito authorizer on every API route; presigned-only S3 access.
- Run analysis on proxy/downscaled assets; sample long VODs (e.g., 1fps for labels)
  to keep Rekognition/Transcribe cost and runtime sane.
- Keep scoring weights, effect metadata, and platform presets in config.
