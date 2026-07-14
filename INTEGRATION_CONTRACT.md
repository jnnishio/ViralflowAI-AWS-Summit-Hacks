# Integration Contract — AI Highlight Clip Generation

**Status of this document:** this repo currently ships two things: (1) a local,
runnable reference pipeline (`pipeline/`) that talks to real AWS services
(Transcribe, Rekognition, Bedrock) and proves the detection/render algorithm
end-to-end on a local machine, and (2) a **spec-only** description of the AWS
backend (`.kiro/steering/architecture.md`, `.kiro/specs/webapp-skeleton/requirements.md`)
that has not been implemented yet — there is no CDK/SAM/Terraform, no deployed
API Gateway, and no DynamoDB table-creation code anywhere in the repo. Every
schema below is therefore derived from one of two sources, labeled inline:

- **[PIPELINE]** — field names/types that actually appear in `pipeline/*.py`
  JSON I/O today (real, runnable, ffmpeg/boto3-backed).
- **[SPEC]** — field names/contracts defined in the Kiro spec
  (`.kiro/steering/architecture.md`, `.kiro/specs/webapp-skeleton/requirements.md`)
  describing the intended Lambda/API Gateway/DynamoDB backend, not yet built.

Anyone wiring a Lambda/API layer on top of `pipeline/` should treat **[PIPELINE]**
as the authoritative shape of the AI Director / render output, and **[SPEC]** as
the target contract the DynamoDB items and REST routes must satisfy once built.

---

## 1. DynamoDB clip-item schema

No `CreateTable` / CDK table construct exists in the repo. The schema below
merges the **[SPEC]** `Clip` entity (`.kiro/specs/webapp-skeleton/requirements.md`
Glossary + Req. 6/7/9/11) with the **[PIPELINE]** highlight/clip record actually
produced by `pipeline/director.py` and `pipeline/render.py`, which is what a
real (non-stub) fusion/categorization Lambda would write.

### 1.1 Key schema [SPEC]

| Attribute | Type | Role |
|---|---|---|
| `jobId` | S | Partition key |
| `clipId` | S | Sort key |

(`.kiro/specs/webapp-skeleton/requirements.md` Glossary: *"Clip: A DynamoDB
record with attributes `jobId, clipId, start, end, score, factors{}, category,
title, thumbKey`"*.)

### 1.2 Full item — merged spec + pipeline output

| Field | DynamoDB type | Source | Example | Notes |
|---|---|---|---|---|
| `jobId` | S | SPEC | `"job_6910008_a1b2c3"` | Partition key |
| `clipId` | S | SPEC | `"clip_04"` | Sort key |
| `userId` | S | SPEC | `"us-east-1:8f3c...cognito-sub"` | Owner, for auth scoping (Req. 16.3) |
| `status` | S | SPEC (inferred from `crop-confirmed` state, Req. 11) | `"crop-confirmed"` | One of `pending` \| `crop-confirmed` |
| `start` / `start_s` | N | SPEC uses `start`; PIPELINE emits `start_s` | `1655.0` | Seconds, float. **Naming mismatch to resolve**: pipeline JSON key is `start_s`/`end_s` (`pipeline/director.py:39-40`, `pipeline/fusion.py:123-124`); spec Glossary/Req. 11 use `start`/`end`. Pick one at the Lambda boundary. |
| `end` / `end_s` | N | see above | `1704.0` | Seconds, float, 2-decimal precision expected by crop UI (Req. 11.1) |
| `peak_s` | N | PIPELINE | `1662.0` | Detected peak inside the window (`pipeline/fusion.py:125`) — not in SPEC Glossary but useful for thumbnail selection (`pipeline/render.py:144`) |
| `score` | N | SPEC=`score`; PIPELINE=`virality_score` | `87` | 0–100 int/float. Pipeline's fusion `score` (z-score composite, `pipeline/fusion.py:126`) is distinct from the Director's `virality_score` (0–100, `pipeline/director.py:40`) — the DynamoDB `score` field used for sort/display should be `virality_score`. |
| `factors` | M (map of S→N) | SPEC=`factors{}`; PIPELINE=`factors` | `{"chat": 0.82, "audio": 0.61, "visual": 0.35}` | Per-modality z-score at the peak (`pipeline/fusion.py:129`); "≥2 entries" required by stub Req. 6.3, real values keyed by whichever modalities were present (`chat`, `audio`, `visual`, `speech`) |
| `modalities` | L (of S) | PIPELINE | `["chat", "audio"]` | Which signals agreed at this peak (`pipeline/fusion.py:127`) — cross-modal validation provenance, not in SPEC Glossary but worth persisting for "view score details" |
| `category` | S | SPEC + PIPELINE | `"funny moment"` | Free-text grouping label from Bedrock (`pipeline/director.py:42`); Compilation Mode groups by this (Req. 12) |
| `mood` | S | SPEC (Req. 13 chip context) + PIPELINE | `"hype"` | Enum: `funny \| hype \| emotional \| impressive \| wholesome \| controversial` (`pipeline/director.py:41`) |
| `title` / `title_zh` | S | SPEC=`title`; PIPELINE=`title_zh`+`title_en` | `"閃電對唱高潮"` | Bilingual pair in pipeline output (`pipeline/director.py:44`); SPEC's single `title` maps to `title_zh` as the primary display title (`pipeline/gallery.py:34`) |
| `titleEn` / `title_en` | S | PIPELINE | `"Duet Climax Moment"` | English title |
| `hook` / `hook_zh` | S | SPEC=`hook`; PIPELINE=`hook_zh` | `"別眨眼！"` | ≤12-character on-screen hook, burned in for first 2.5s (`pipeline/director.py:44`, `pipeline/render.py:98-104`) |
| `caption` / `caption_zh` | S | SPEC=`caption`; PIPELINE=`caption_zh`+`caption_en` | `"這段對唱直接把現場音量拉滿🔥"` | Copy-paste social caption |
| `captionEn` / `caption_en` | S | PIPELINE | `"This duet sent the whole chat into overdrive."` | |
| `hashtags` | L (of S) | SPEC + PIPELINE | `["#langlive", "#duet", "#live秀", "#高能", "#神仙打架"]` | 5–8 tags, mixed zh/en (`pipeline/director.py:46`) |
| `thumbKey` | S | SPEC=`thumbKey`; PIPELINE emits local `thumb` path | `"clips/job_6910008/clip_04_thumb.jpg"` | S3 key for the peak-frame JPEG; pipeline currently writes a local path (`pipeline/render.py:142-153`) — must be rewritten to an S3 key when the render Lambda uploads it |
| `outputKey` / `file` | S | not in SPEC Glossary (belongs to `Export` entity); PIPELINE=`file` | `"clips/job_6910008/clip_04.mp4"` | Rendered MP4 S3 key; pipeline writes a local filesystem path (`pipeline/render.py:153`) |
| `cropWindow` | M | **not present in either SPEC or PIPELINE today** — see §1.3 | `{"x": 0.5, "y": 0.0, "width": 0.5625, "height": 1.0}` | Smart-crop parameters; see gap note below |
| `shots` | L (of M) | PIPELINE (visual signal, not currently copied onto the clip record) | `[{"start_s": 1650.2, "end_s": 1658.9, "confidence": 98.4}]` | Rekognition shot segments near the clip; see §1.3 |
| `createdAt` | S (ISO-8601) | SPEC (implied by `Job.createdAt`, applied by analogy) | `"2026-07-14T09:32:11Z"` | |
| `refinementRequestIds` | L (of S) | SPEC (Req. 13/14 create `Refinement_Request` records referencing `clipId`) | `["refine_01"]` | Optional back-reference; the spec models `Refinement_Request` as its own DynamoDB item, not embedded |

### 1.3 Gaps between the spec/pipeline and a real crop-window / shot-boundary field

Neither the **[SPEC]** Glossary nor the **[PIPELINE]** JSON currently has a
`cropWindow` field on the clip record — the two pieces exist but aren't wired
together yet:

- **Crop window** is computed at *render time*, not stored: `pipeline/render.py:28-40`
  (`face_crop_x`) computes a single median face-center `x` (0–1) from
  Rekognition face boxes and bakes it directly into an ffmpeg `crop=` filter
  string (`pipeline/render.py:88-91`) rather than persisting `{x, y, width,
  height}` as data. To make crop windows inspectable/re-editable (needed for
  Req. 11's crop-and-confirm UI), the render Lambda should persist the computed
  window as a `cropWindow: {x, y, width, height}` map (fractional 0–1
  coordinates, 9:16 target) alongside the render, not just apply it to ffmpeg.
- **Shot boundaries**: Rekognition shot segments are parsed into
  `{"start_s", "end_s", "confidence"}` records by `pipeline/signals/visual.py:76-84`
  and written to `out/visual_signals.json`, but they live in a *job-level*
  visual-signals blob, not per-clip. The Director is told to "snap near
  sentence/shot boundaries" (`pipeline/director.py:48`) but the chosen shot
  boundary is never captured back onto the highlight record — `start_s`/`end_s`
  on the final clip are the Director's freeform floats, not a copy of the
  matching Rekognition segment's timestamps.

**Recommendation for whoever builds the real fusion/render Lambdas:** persist
both `cropWindow` and the specific `shots: [...]` (or at least `matchedShotId`)
that bounded the clip, since the spec's crop UI (Req. 11) and "view score
details" (Req. 9) both imply this provenance should be inspectable, not just
implicit in a burned-in render.

### 1.4 Related item types [SPEC]

Same table pattern (`jobId` as partition key), from `.kiro/steering/architecture.md:157-163`:

- **`Job`**: `jobId, userId, status, targets[], sourceKey, proxyKey, createdAt`.
  **Inconsistency**: the webapp-skeleton spec's Glossary instead lists
  `sourceKeys[]`, plural (`.kiro/specs/webapp-skeleton/requirements.md:31`),
  to support the 1–10 file multi-upload batch defined in Req. 1.9. Treat the
  plural `sourceKeys[]` as authoritative — a single Job can reference multiple
  uploaded source files — and the singular `sourceKey` in `architecture.md` as
  stale.
  `status` values used in the spec text: `pending` (Req. 4.1) → `in-progress`
  (Req. 4.4) → `completed` | `failed` (Req. 5.6/5.8).
- **`Edit`**: `jobId, editId, clipIds[], edl(json), status` — out of scope for
  the current skeleton spec (auto-edit engine not implemented).
- **`Export`**: `jobId, exportId, platform, outputKey, captions` — out of
  scope; this is where the rendered-clip S3 key formally belongs per the
  architecture doc, separate from the `Clip` item's `thumbKey`.
- **`Refinement_Request`** (webapp-skeleton spec only): quick-action chip or
  freeform prompt request — `jobId, refinementId, actionType, targetIds[],
  promptText?, status`. `status` starts at a pending value (Req. 13.4).

---

## 2. API Gateway routes

**No API Gateway definition exists in the repo** — no CDK `RestApi`/`HttpApi`
construct, no SAM template, no serverless.yml, no Lambda handler files. The
routes below are the **[SPEC]** contract implied by
`.kiro/specs/webapp-skeleton/requirements.md`; none are implemented. REST +
WebSocket split per `.kiro/steering/architecture.md:38, 96`.

### 2.1 REST routes (implied, not built)

| Route (implied) | Method | Auth | Request | Response | Spec ref |
|---|---|---|---|---|---|
| Upload_API: request presigned upload URL | `POST` | Cognito | `{fileName, contentType}` per file | `{uploadUrl, key}` — scoped to `raw/` prefix, single key, 15-min validity | Req. 1.1–1.3 |
| Job_API: create job / start pipeline | `POST /jobs` | Cognito | `{sourceKeys: [...], targets: ["tiktok","reels","shorts"]}` | `{jobId, status: "pending"}`; `400` if `targets[]` invalid/empty (Req 2.5), `400` if referenced `sourceKeys` never confirmed uploaded (Req 4.7) | Req. 2.3–2.5, 4.1–4.7 |
| Job_API: get job status | `GET /jobs/{jobId}` | Cognito, owner-scoped | — | `{jobId, status, targets[], createdAt}`; `403`/`404`-style "authorization error" if not owned (Req 4.6) | Req. 4.5–4.6, 16.6–16.7 |
| Highlights_API: list clips for a job | `GET /jobs/{jobId}/clips` | Cognito, owner-scoped | — | `[{jobId, clipId, start, end, score, factors{}, category, title, thumbKey, ...}]`, ordered by `score` desc (Req 7.1) | Req. 7.1–7.2, 16.3–16.4 |
| Highlights_API: update crop (start/end) | `PATCH /jobs/{jobId}/clips/{clipId}` | Cognito, owner-scoped | `{start, end}` (2-decimal seconds, within original clip bounds) | Updated clip record, or error if update fails (Req 11.6) | Req. 11.5–11.7 |
| Highlights_API: create refinement request (chip) | `POST /jobs/{jobId}/refinements` | Cognito, owner-scoped | `{actionType: "reorder"\|"faster_pacing"\|"swap_intro"\|"more_reactions", targetIds: [clipId,...] or [compilationGroupId]}` | `{refinementId, status: "pending"}` | Req. 13.3–13.6 |
| Highlights_API: create refinement request (freeform) | `POST /jobs/{jobId}/refinements` | Cognito, owner-scoped | `{promptText: string (1-1000 chars), targetIds: [...]}` | `{refinementId, status: "pending"}` | Req. 14.2–14.6 |
| Highlights_API: confirm selection / handoff | `POST /jobs/{jobId}/confirm-selection` | Cognito, owner-scoped | `{clipIds: [...]}` (≥1) | `{handoffId}` reference to the (stub) auto-edit entry point | Req. 15.2–15.5 |

Every route requires a bearer token issued by the Cognito user pool; missing/
expired/revoked tokens get a generic "authorization error" response, not a
per-route-defined error body (Req. 3.2–3.3). No response status codes or JSON
error envelopes are specified in the spec — only the required behavior.

### 2.2 WebSocket route (implied, not built)

`Progress_API` (API Gateway WebSocket API), `.kiro/steering/architecture.md:96`
and Req. 5:

- Connect: requires a valid Cognito token as a query param or header; invalid
  token ⇒ connection rejected; token expiry/revocation while connected ⇒
  connection closed server-side (Req. 3.4–3.5).
- Subscribe: client subscribes to a `jobId`.
- Server → client push, within 1s of the underlying Step Functions transition
  (Req. 5.3): `{jobId, stage: string, status: "started"|"completed"|"failed"}`.
  Stage names come from `architecture.md`'s pipeline stage list: normalize/
  proxy, transcript, visual analysis, audio analysis, chat analysis,
  fusion/scoring, categorization (Req. 6.1).
- Fallback: if the socket is unavailable, the frontend polls
  `GET /jobs/{jobId}` every 5s (Req. 5.5) — i.e. Progress_API is an
  optimization over Job_API's status endpoint, not the source of truth.

---

## 3. S3 key conventions

No S3 bucket definitions (CDK `Bucket` constructs, bucket policies) exist in
the repo. Conventions below are what `pipeline/run.py` actually uses
**[PIPELINE]**, plus the prefix convention named in the spec **[SPEC]**.

| Asset | Convention | Source | Example |
|---|---|---|---|
| Raw uploaded VOD | `raw/` prefix, single object key per file (exact naming scheme within the prefix not specified) | SPEC (`.kiro/specs/webapp-skeleton/requirements.md:29, 74`) | `raw/<jobId>/<originalFileName>.mp4` (inferred; not literally in code) |
| VOD referenced by stream/session id | `<stream-id>_video.mp4` at bucket root (no prefix) | PIPELINE (`pipeline/run.py:96`: `f"s3://{args.s3_bucket}/{sid}_video.mp4"`) | `s3://hackathon-152315741309-us-east-1-an/6910008_video.mp4` |
| Extracted audio track (for Transcribe, which rejects media >2GB) | `audio/<audio-file-name>` | PIPELINE (`pipeline/run.py:69`: `f"audio/{audio_file.name}"`, where `audio_file` is `video.with_suffix(".m4a")`) | `audio/6910008_video.m4a` |
| Transcribe output | `transcribe/<job_name>/` prefix (Transcribe writes its own file(s) under this) | PIPELINE (`pipeline/signals/transcript.py:41`: `kwargs["OutputKey"] = f"transcribe/{job_name}/"`), job name pattern from `pipeline/run.py:79`: `f"vod-{sid}-{int(audio_file.stat().st_size) % 100000}"` | `transcribe/vod-6910008-41823/` |
| Keyframes (Director's Bedrock vision input) | **Not persisted to S3** — extracted in-memory via ffmpeg to stdout and passed directly as bytes to Bedrock `converse()`, never written to disk/S3 | PIPELINE (`pipeline/director.py:53-68`, `-f image2pipe ... -`) | n/a |
| Rendered clip output | Local filesystem only in current pipeline: `<outdir>/clips/clip_<NN>_<mood>.mp4` | PIPELINE (`pipeline/render.py:137-139`) | `out/clips/clip_01_hype.mp4` — **not yet an S3 key**; a render Lambda targeting S3 needs to define its own `clips/<jobId>/<clipId>.mp4` convention (none exists today) |
| Clip thumbnail | Local filesystem only, same stem as clip with `.jpg` | PIPELINE (`pipeline/render.py:141-147`: `out_path.with_suffix(".jpg")`) | `out/clips/clip_01_hype.jpg` — same caveat, not yet an S3 key |
| Clip manifest (local demo aggregation) | `<outdir>/clips/manifest.json` | PIPELINE (`pipeline/render.py:154`) | `out/clips/manifest.json` |

**Inconsistency:** the spec's `raw/` prefix convention and the pipeline's
actual VOD key (`{stream_id}_video.mp4` at bucket root, no prefix at all —
`pipeline/run.py:96`) directly conflict. Whoever wires the real upload Lambda
needs to pick one; recommend keeping the `raw/` prefix from the spec (it's the
one with an access-control story — Req. 3.6 scopes presigned URLs to that
prefix) and updating the pipeline's convention to match, e.g. `raw/<jobId>/<stream_id>_video.mp4`.

**Gap:** there is no established S3 key convention for rendered clips or
thumbnails once they leave the local demo pipeline — `render.py` writes to a
local `--outdir`, and nothing in the repo uploads those files to S3 or assigns
them the `thumbKey`/`outputKey` values referenced by the DynamoDB schema in
§1. Whoever wires the render Lambda needs to pick a convention (e.g.
`clips/<jobId>/<clipId>.mp4` and `clips/<jobId>/<clipId>_thumb.jpg`, mirroring
the `audio/` and `transcribe/<job>/` prefix style already used) and write it
into the `Clip` item's `outputKey`/`thumbKey` fields.

---

## 4. Render job status tracking

There is **no MediaConvert usage in the code today** — `pipeline/render.py`'s
module docstring mentions MediaConvert as a future "cloud path" alternative
(`--engine mediaconvert`, `pipeline/render.py:11-12`) but only implements the
local ffmpeg path; no `--engine` flag or MediaConvert client call actually
exists in the file. Status tracking for render jobs is therefore entirely
**[SPEC]**-level intent, not implemented:

- **Local pipeline today**: rendering is synchronous — `render_clip()`
  (`pipeline/render.py:84-116`) blocks on `subprocess.run(cmd, check=True)`
  and the caller (`pipeline/run.py:167-177`) just calls it inline; there is no
  job-status concept at all, success/failure is a Python exception.
- **Architecture doc's stated direction** (`.kiro/steering/architecture.md:148-149`):
  final render uses **ffmpeg on Fargate**, not MediaConvert, specifically
  because MediaConvert job templates can't easily express AI-driven
  overlays/compositing — despite MediaConvert being listed as a service in
  the proposal briefing's AWS table (`README.md:55`). This is an
  inconsistency between the two design docs worth flagging to the team: the
  proposal briefing (`README.md`) still names MediaConvert for "clip cutting,
  9:16 transforms, delivery renditions," while the steering doc has since
  moved final render to Fargate+ffmpeg and reserves MediaConvert only for the
  normalize/proxy/audio-extract stage (`.kiro/steering/architecture.md:79-81`).
- **Status field, once implemented**: per the `Job`/`Edit` entities in
  `.kiro/steering/architecture.md:157-163`, an `Export` record
  (`jobId, exportId, platform, outputKey, captions`) is the natural place for
  per-render-job status, but no `status` enum is defined for it in either
  spec doc — only `Job.status` (`pending → in-progress → completed|failed`,
  Req. 4/5) and `Refinement_Request.status` (`pending`, Req. 13.4) have
  documented enums. A render/export status enum needs to be defined from
  scratch when this stage is built; EventBridge rules for MediaConvert
  `JOB STATE CHANGE` events are not mentioned anywhere in either doc, since
  the chosen render engine is Fargate, not MediaConvert.

---

## Summary of open gaps for implementers

1. **Field-name mismatch**: pipeline JSON uses `start_s`/`end_s`/`virality_score`/
   `title_zh`/`hook_zh`/`caption_zh`; the spec Glossary uses `start`/`end`/
   `score`/`title`/`hook`/`caption`. Pick one naming convention at the Lambda
   boundary (recommend keeping bilingual pairs, e.g. `title`+`titleEn`, and
   dropping the `_s` suffix since DynamoDB attributes don't need it).
2. **No `cropWindow` persisted** — currently baked directly into an ffmpeg
   filter string, not stored as data (§1.3).
3. **No per-clip shot-boundary reference** — Rekognition shots exist only in
   the job-level visual-signals blob (§1.3).
4. **No S3 upload step for rendered clips/thumbnails** in the current
   pipeline — they stay local (§3).
5. **`Job.sourceKey` vs `Job.sourceKeys[]`** — the architecture doc's singular
   field is stale next to the webapp-skeleton spec's plural, multi-file form
   (§1.4).
6. **VOD S3 key convention conflict** — spec says `raw/` prefix, pipeline
   actually writes `{stream_id}_video.mp4` at bucket root with no prefix (§3).
7. **No API Gateway / DynamoDB table / MediaConvert or Fargate render
   infrastructure exists in the repo at all** — this document describes a
   target contract synthesized from spec docs plus the real pipeline's data
   shapes, not something you can currently call or query.
8. **MediaConvert vs. Fargate+ffmpeg inconsistency** between `README.md` (proposal
   briefing) and `.kiro/steering/architecture.md` (steering doc) for the final
   render stage (§4). The independent verification pass also confirmed
   `pipeline/render.py`'s `--engine mediaconvert` mention is aspirational
   text only — no such CLI flag or MediaConvert client call actually exists
   in that file.
