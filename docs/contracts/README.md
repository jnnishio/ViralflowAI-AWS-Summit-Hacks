# Data contracts

Three schemas describing what passes between the three pieces of this project: the
highlight-extraction pipeline (this repo's `pipeline/`), the web UI + backend, and the
OpenCut-based AI auto-edit engine. `.kiro/steering/architecture.md` remains the source of
truth for overall product architecture — these contracts are the concrete JSON shapes that
implement its `Job`/`Clip`/`Edit` data model, grounded in real output from
`out/3654414-fast/`.

| File | What it is | Consumed by |
|---|---|---|
| [`clip-manifest.schema.json`](clip-manifest.schema.json) | One scored highlight clip | UI grid, score-details panel, compilation-mode grouping |
| [`job-status.schema.json`](job-status.schema.json) | Pipeline run status/progress | UI progress bar / WebSocket handler (draft — see below) |
| [`edl.schema.json`](edl.schema.json) | Edit Decision List | OpenCut auto-edit engine + built-in editor (draft) |

Examples live in [`examples/`](examples/), each validated against its schema. `examples/raw/`
holds literal excerpts of the pipeline's actual current output files, unmodified, for
provenance.

## Clip manifest

Canonical shape is camelCase, matching architecture.md's DynamoDB `Clip` item, since that
doc is the already-agreed source of truth. The pipeline's real output today
(`out/*/highlights.json`, `out/*/clips/manifest.json`) uses a different naming convention —
snake_case with `_zh`/`_en` suffixes. Mapping, for whoever wires the pipeline output into
DynamoDB:

| Pipeline field (today) | Contract field |
|---|---|
| `start_s` | `start` |
| `end_s` | `end` |
| `peak_s` | `peak` |
| `virality_score` | `score` |
| `title_zh` / `title_en` | `title.zh` / `title.en` |
| `hook_zh` | `hook.zh` (no `hook_en` emitted today — see Open questions) |
| `caption_zh` / `caption_en` | `caption.zh` / `caption.en` |
| `file` (local path) | `clipKey` (S3 key) |
| `thumb` (local path) | `thumbKey` (S3 key) |
| `factors`, `hashtags`, `mood`, `category` | unchanged |

`modalities`, `keep`, and `reason` come from `highlights.json` (the Director's raw output)
but aren't in `clips/manifest.json` (the post-render file) — kept in the contract since
they're useful for the "view score details" UI panel and for debugging why a clip scored the
way it did.

## Job status — draft

No real Job record exists yet; the pipeline is a local CLI (`pipeline/run.py`) today, not a
deployed Step Functions machine. This schema's `stage` enum is lifted directly from
`run.py`'s own comment-documented stage order (chat → audio extract/upload → Transcribe →
Rekognition → fusion → Director → render), so it can double as the state-name basis when the
cloud deployment (Step Functions + Lambda) actually gets built. Treat this contract as the
spec to build toward, not something already running.

## EDL — draft

This is the `edl` payload inside architecture.md's `Edit` item. Two pieces are explicitly
**illustrative / fast-follow**, since they depend on work that hasn't started:

- **`effects[]`** — depends on the effects-library manifest (name/type/duration/"use when"
  guidance per effect) mentioned in architecture.md section 5. Doesn't exist yet.
- **`musicBed`** — depends on a music-track library. Doesn't exist yet.

Everything else in the EDL schema is grounded in real pipeline behavior:
- `crop.cx` mirrors `pipeline/render.py`'s `face_crop_x()` — the example's `cx: 0.4925` is the
  actual median face-center x computed from `out/3654414-fast/visual_signals.json` for
  clip_01's window (2698–2758s), not a made-up number.
- `captions.style` mirrors the real ASS style line `build_ass()` writes (font, size,
  bottom-third alignment, margin).
- `captions.overlays` in the example are real `transcript.json` segments for clip_01's first
  ~15 seconds, time-shifted from absolute VOD timestamps to clip-relative ones (subtract
  2698s). The full 60s clip has more segments in the real transcript; the example is
  truncated for brevity.
- `hookOverlay` mirrors `render.py`'s real drawtext hook behavior (first 2.5s).

## Open questions / fast-follows

- **`hook.en`** — the pipeline only emits a Traditional Chinese hook line (`hook_zh`) today.
  If the export path needs an English on-screen hook, the Director prompt needs a small
  addition; the contract already has the optional field ready.
- **Effects library manifest** — not designed yet. Needed before `edl.schema.json`'s
  `effects[]` field can move from illustrative to real.
- **Music bed library** — same status as above.
- **Step Functions stage names** — `job-status.schema.json`'s `stage` enum is a proposal;
  confirm it against the actual state machine once it's built, since the cloud version fans
  chat/audio/Transcribe/Rekognition out in parallel (per architecture.md) rather than running
  them sequentially like the local CLI does.
