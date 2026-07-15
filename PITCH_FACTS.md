# PITCH_FACTS — Fast vs Full Mode (verifiable findings)

Every claim below is tagged so you can trust it at pitch-podium level:

- **[CODE]** — read directly from source; deterministic, you can re-read the cited lines.
- **[ARTIFACT]** — read from a committed run output in `out/`.
- **[DOC-ONLY]** — stated in prose (README/docs) but **NOT** backed by any runnable
  artifact, log, or benchmark in this repo. Treat as an author's claim, not a measurement.
- **[GAP]** — the thing you asked for does not exist in the repo.

TL;DR for the deck: the Fast/Full **tradeoff is real and fully code-verified**. The
**timing and cost numbers you'd want to quote ("7.5 min vs 29 min", "$5 vs $17",
"17x/4x") are documented as "measured" but have no supporting artifact in the repo** —
no `timings.json`, no benchmark script, no logs. There is **no accuracy comparison**
between the modes. Mode is an **operator CLI flag defaulting to `fast`**, and the demo
app doesn't expose it at all.

---

## 1. THE TRADEOFF

The two modes are selected by one flag: **`--visual-mode {fast, full, off}`, default
`fast`** — `pipeline/run.py:72-74`.

The single concrete difference between Fast and Full is **whether the visual
(Rekognition) modality participates in highlight *scoring/selection*.** Everything
else (chat, audio, transcribe/speech, the Bedrock Director, render) is byte-for-byte
identical between modes. There is **no** smaller/cheaper Bedrock model, **no** shorter
prompt, and **no** video-length cap in either mode — those were checked and are not
present.

### What Full mode does — [CODE]
- Starts Rekognition **on the whole VOD**: `SHOT` segment detection **and** `ALL`-attribute
  face detection — `pipeline/signals/visual.py:35-52` (`start_jobs()` →
  `start_segment_detection` + `start_face_detection`).
- Waits for those whole-VOD jobs — `pipeline/run.py:134-160` (start) and
  `pipeline/run.py:163-175` (collect; both guarded by `args.visual_mode == "full"`).
- `parse_results()` bins the whole timeline into `scene_change`, `emotion_hot`,
  `face_count`, `face_size_avg`, `smile_avg` per 5 s — `pipeline/signals/visual.py:146+`.
- Fusion therefore runs on **4 modalities** (chat, audio, speech, **visual**) with the
  `visual` branch active — `pipeline/fusion.py:84-96` — and cross-modal validation can
  use up to 2-of-4.

### What Fast mode does — [CODE]
- **Skips whole-VOD Rekognition entirely.** Fusion runs **first** on chat + audio +
  speech only, producing candidate windows.
- **After** fusion, it cuts only the candidate windows out of the local VOD (`ffmpeg -c copy`,
  `pad_s=10.0`), uploads each, and starts **one face-detection job per segment** —
  `pipeline/run.py:204-212` calling `start_face_jobs_for_windows()`
  (`pipeline/signals/visual.py:89-121`). Comment at `run.py:204`: "~10 min of footage
  instead of the whole VOD."
- Those face results are collected **after the Director has already judged**
  (`pipeline/run.py:215-221`) and written as a **stub** `visual_signals.json` with
  `shots: []` and empty binned series — only sparse face samples for smart-crop.
- **Consequence (this is the honest tradeoff, spelled out in
  `docs/algorithm-decisions.md:45-80`):** in Fast mode, visual data has **zero influence
  over which windows become highlights**. It can only (a) reposition the 9:16 crop and
  (b) feed the Director's own keyframes. A visual-only moment (silent gag, subtle
  reaction) with muted chat and unremarkable audio **cannot be discovered** in Fast mode.
  This is called out as a "known and accepted recall gap."

### Second-order effect: fusion weights renormalize — [CODE]
Weights are per-vertical (`config/weights.json`; `talk` = chat .40 / audio .25 /
speech .15 / **visual .20**). When `visual` is absent, `fuse()` renormalizes the
remaining weights over whatever modalities are present —
`pipeline/fusion.py:100-104` (`weights = {k: WEIGHTS[vertical][k] for k in modal}` →
`total = sum(...)` → `curve = sum(w/total * modal[k] ...)`). So Fast mode isn't just
"Full minus visual" — the other three modalities are **reweighted upward**, which
changes scores and ranking (see below).

### Proof from committed run artifacts (same VOD, both modes) — [ARTIFACT]
Same stream `3654414`, ~74-min VOD (`series.t_s` runs to 4435 s in both):

| | Full — `out/3654414/candidates.json` | Fast — `out/3654414-fast/candidates.json` |
|---|---|---|
| `modalities_present` | `["audio","chat","speech","visual"]` | `["audio","chat","speech"]` |
| Candidates emitted | 7 | 12 |
| Top candidate (peak 75 s) score | **1.944**, modalities incl. `visual` | **2.191**, `chat,audio` only |
| Example rank shift | peak ~1425 s ranked #5 (score 1.042) | peak ~1425 s ranked #3 (score 1.408) |

This is a real, reproducible difference in the *output* of the two modes on the same
input. **Caveat:** it is a *selection/scoring* difference, **not** a quality judgment —
there's no ground truth for this VOD (see §3).

---

## 2. TIMING NUMBERS

**There is no measured timing artifact in this repo.** — [GAP]

- `file_search` for `timings.json` → **none exist** anywhere in the tree.
- `pipeline/run.py` *has* a `StageTimer`/`write_timings()` that can emit
  `out/timings.json` (`run.py:33-66`), but **no run persisted one** — including the two
  `3654414` runs used for the §1 comparison.
- `out/3654414-fast/metrics.json` exists but contains **no `wallClockSeconds`,
  `editingTimeSavedPct`, or `clipsPerHour`** — `pipeline/metrics.py` omits all
  timing-derived fields when `timings.json` is absent (`metrics.py` `build_metrics()`),
  which confirms no timing file was fed in.
- `scripts/` contains only `load_clips_to_ddb.py` and `setup_dev_user.py` — **no
  benchmark script.**
- No deployed AWS path to pull CloudWatch / Step Functions durations from — the cloud
  backend is intentionally dormant (per `.kiro/steering/*`), and the demo runs locally.

**The numbers that appear in prose (DO NOT present these as measured without a caveat):** — [DOC-ONLY]
- `README.md:74`: "Speed (measured, 74-min VOD): full-VOD visual analysis ≈ 29 min;
  fast mode ≈ 7.5 min (12 min with cold Transcribe)."
- `docs/algorithm-decisions.md:47-50`: "≈7.5 min vs ≈29 min pipeline latency."
- `docs/algorithm-decisions.md:219` (summary table): "~17x cost reduction, ~4x latency
  reduction measured."

These say "measured," but **nothing in the repo substantiates them** — no timing file,
log, or script produced them. Flag them as author estimates until reproduced.

### Benchmark harness (added) — `pipeline/benchmark.py`
A Fast-vs-Full benchmark harness now exists. It reuses the per-run `timings.json`
(`run.py` `StageTimer`) and produces one comparison artifact (`out/benchmark/benchmark_<id>.json`
+ `.md`, deck-ready). It clearly separates measured from assumed.

**To capture real wall-clock**, run both modes fresh and timed (needs live AWS creds;
`full` is the expensive path and is gated behind `--execute-full`):
```
python -m pipeline.benchmark --execute --execute-full \
    --video <vod>.mp4 --chat-log <vod>_log.csv \
    --s3-bucket hackathon-152315741309-us-east-1-an --stream-id demo --modes fast,full \
    --outdir out/benchmark
```
Both modes share the same cold-start Transcribe cost, so the wall-clock delta is
dominated by whole-VOD (full) vs candidate-window (fast) Rekognition.

**Available now, no AWS/no cost** — compare the two existing `3654414` runs:
```
python -m pipeline.benchmark --from-existing fast=out/3654414-fast full=out/3654414 \
    --outdir out/benchmark --stream-id 3654414
```

### On cost specifically — [ARTIFACT] + [DOC-ONLY] + internal inconsistency
- The only cost model in code is **flat and mode-independent**: `config/metrics.json`
  `costModel.perVod` = transcribe 1.8 / rekognition **1.0** / bedrock 0.3 / render 1.0
  = **$4.1**, which is exactly what `out/3654414-fast/metrics.json` reports
  (`costPerVod.amount: 4.1`). This is a **config constant, not a measured runtime cost,
  and it does not distinguish Fast from Full.**
- The "$17 full-VOD" and "$1 vs $17" figures (`README.md:75`,
  `docs/algorithm-decisions.md:47-49`) appear **only in prose** — no `$17` value exists
  anywhere in code or config. **[DOC-ONLY]**
- **Inconsistency to be aware of:** `README.md:75` says Fast ≈ **$5/VOD** total;
  `docs/algorithm-decisions.md:47` says ≈ **$1** (that's the Rekognition line-item only).
  Same authors, two framings. Don't quote both.

### Data-derived Rekognition comparison (added, from `pipeline/benchmark.py`) — [ARTIFACT + ASSUMPTION]
Computed from the two committed `3654414` runs — `out/benchmark/benchmark_3654414.json`:

| | Fast | Full |
|---|---|---|
| VOD duration | 74.0 min | 74.0 min |
| Rekognition API groups | face only, on candidate windows | segment + face, whole VOD |
| **Rekognition minutes billed** | **15.67 min** | **148.0 min** |
| Est. Rekognition cost | ~$1.57 | ~$11.10 |

- **Minutes ratio ≈ 9.4x fewer** and **cost ratio ≈ 7.1x** in fast mode. The **minutes are
  MEASURED** (VOD duration + summed candidate windows from `candidates.json`, +10 s pad
  per `visual.py`); only the **$/min rate is an ASSUMPTION** (`config/metrics.json`
  `rekognition.ratesPerMinute`, list price — verify before quoting dollars).
- This supersedes the unsourced prose "$1 vs $17": the honest, reproducible headline is
  **"fast mode analyzes ~9x fewer Rekognition video-minutes"**; the dollar figure follows
  from your chosen rate.
- Wall-clock is still **not captured** for these two runs (no `timings.json`) — use the
  `--execute` recipe above to measure it.

---

## 3. ACCURACY / QUALITY DELTA

**No accuracy or quality comparison between Fast and Full exists.** — [GAP]

- Ground truth (`pipeline/fixtures/ground_truth.json`) covers **only stream `6910008`**.
  The Fast/Full comparison VOD is `3654414`, which has **no labeled windows**, so
  `pipeline/metrics.py` emits **no `detectionPrecision`** for either run — confirmed:
  `out/3654414-fast/metrics.json` has no `detectionPrecision` field.
- Only **one** metrics file exists (`out/3654414-fast/metrics.json`, `qualityScore: 0.79`).
  There is **no Full-mode `metrics.json`** to compare against, and `qualityScore` is an
  internal virality/agreement composite (`metrics.py:quality_score`), **not** a
  hand-labeled or human eval.
- `README.md:73` mentions detection precision "top-5 clips judged highlight-worthy by a
  human … (target ≥ 4/5)" and "eliminated 100% of chat-template spam false positives on
  the demo VOD." These are **[DOC-ONLY]** and framed as a **target / general demo claim**,
  not a recorded Fast-vs-Full result.
- `docs/algorithm-decisions.md` §c#2 explicitly states there is **"no feedback loop and
  no eval set"** and that a validation methodology was deferred post-MVP — i.e., the
  authors themselves acknowledge this gap.

**Recommendation:** present the Fast-vs-Full *selection difference* from the two
`candidates.json` files (§1) as a factual observation, but do **not** claim Fast is
"as accurate as" or "X% of" Full — that comparison has not been done.

---

## 4. MODE SELECTION LOGIC

**It's an operator/CLI parameter, not an automatic decision, and the demo app doesn't
expose it.** — [CODE]

- Defined as a CLI arg with a static default: `pipeline/run.py:72`
  ```
  ap.add_argument("--visual-mode", choices=["fast", "full", "off"], default="fast", ...)
  ```
- Batch runner passes it straight through (still operator-set): `pipeline/batch.py:201`
  and `:214-217`.
- **No automatic logic.** There is nothing that switches mode based on VOD length, queue
  depth, or urgency — the only branches on `args.visual_mode` are the literal
  `== "full"` / `== "fast"` checks at `run.py:134, 163, 206`. Grep for `visual.?mode`
  across the repo returns only: `run.py`, `batch.py`, `docs/algorithm-decisions.md`,
  `docs/batch-processing.md:34`, `docs/contracts/clip-manifest.schema.json:23`, and a
  frontend fixture comment (`apps/editor/apps/web/src/services/highlight-api/fixtures.ts:37`).
- **The running demo app never sets it** → always the default (`fast`). The local server
  builds the pipeline argv in `frontend/mock-server/lib/pipeline-args.mjs`
  (`buildPipelineArgs()`), which passes `--video/--chat-log/--s3-bucket/--stream-id/
  --outdir/--vertical` and **omits `--visual-mode` entirely**. So a streamer/end-user
  has **no way to choose** Full in the app; Full is reachable only by running the CLI
  (or `pipeline.batch`) by hand with `--visual-mode full`.
- The cloud/API path (Step Functions / Lambda) that might have carried a user parameter
  is dormant per `.kiro/steering/*` and is not the active path.

---

## Appendix — exact references

| Claim | Location |
|---|---|
| Mode flag + default `fast` | `pipeline/run.py:72-74` |
| Full: whole-VOD Rekognition start/collect | `pipeline/run.py:134-160`, `:163-175` |
| Full: `start_jobs()` (SHOT + faces on whole VOD) | `pipeline/signals/visual.py:35-52` |
| Full: whole-VOD binning | `pipeline/signals/visual.py:146+` (`parse_results`) |
| Fast: candidate-window face jobs | `pipeline/run.py:204-212`; `pipeline/signals/visual.py:89-121` |
| Fast: face results collected after Director; stub visual json | `pipeline/run.py:215-221` |
| 4-modal vs 3-modal fusion (visual branch) | `pipeline/fusion.py:84-96` |
| Weight renormalization when visual absent | `pipeline/fusion.py:100-104` |
| Per-vertical weights (visual .20) | `config/weights.json`; `pipeline/fusion.py:29-31` |
| Tradeoff narrative + recall gap | `docs/algorithm-decisions.md:43-80`, `:219` |
| Modalities present, Full run | `out/3654414/candidates.json` (`"modalities_present"`) |
| Modalities present, Fast run | `out/3654414-fast/candidates.json` (`"modalities_present"`) |
| Timing/cost prose claims (unsubstantiated) | `README.md:74-75`; `docs/algorithm-decisions.md:47-50`, `:219` |
| Flat, mode-independent cost model | `config/metrics.json` (`costModel.perVod`) |
| Only metrics file / qualityScore 0.79 / no precision | `out/3654414-fast/metrics.json` |
| Ground truth covers 6910008 only | `pipeline/fixtures/ground_truth.json` |
| Demo app omits `--visual-mode` | `frontend/mock-server/lib/pipeline-args.mjs` (`buildPipelineArgs`) |
| Batch passthrough of mode | `pipeline/batch.py:201`, `:214-217` |
