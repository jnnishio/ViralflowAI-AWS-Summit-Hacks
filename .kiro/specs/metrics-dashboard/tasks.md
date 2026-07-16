# Implementation Plan: Performance & ROI Metrics

## Hackathon scope note

This plan is trimmed to the lean scope needed for the hackathon demo. The build
target is the **local metrics path**: `config/metrics.json` + `pipeline/metrics.py`
computing the Req 6 indicators from `clips.json` + timings + config, surfaced as a
KPI strip in the standalone `pipeline/gallery.py`. That shows real performance
numbers on real clips with no frontend needed.

The **backend metrics endpoint** (`GET /jobs/{jobId}/metrics`, the shared-module
extraction, IAM/CDK wiring) is ABANDONED — the project has dropped deployed AWS
infrastructure entirely and demos on `npm run dev:mock`. The metrics surface for
this build is the local `pipeline/metrics.py` CLI (emits `out/metrics.json`) plus
the KPI strip in the standalone `pipeline/gallery.py`. Tests are a small set of
plain unit tests rather than the full property-based suite in `design.md`.

## Tasks

- [ ] 1. Metrics config + example
  - Add `config/metrics.json` (mirroring `config/weights.json`):
    `editorMinutesPerClip`, `costModel` (currency + per-VOD components),
    `workflowStages` (automated + total), `qualityWeights`, `precision`
    (`k`, `iouMatchThreshold`), `platformRpm`, `projectionAssumptions`. Add a
    `docs/contracts/metrics.example.json` example and a short
    `INTEGRATION_CONTRACT.md` paragraph. Skip the formal JSON schema.
  - _Requirements: 1.1, 1.4, 1.5_

- [ ] 2. Stage-timing capture in `pipeline/run.py`
  - Add a small `record_stage(name)` context manager + `write_timings(entries, outdir)`
    that bracket the existing `log()` points in `run()`, capturing each stage's name,
    start, end (end ≥ start; a skipped stage recorded with start == end), and write
    `out/timings.json` at the end of `run()` — without changing any stage logic.
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5_

- [ ] 3. Ground-truth fixture + precision scorer
  - Add `pipeline/fixtures/ground_truth.json` keyed by stream id, encoding the
    `README.md` `6910008` windows (entrance 27:25, joke 45:00, song peak 62:35,
    prize 83:45) as `(start, end)`. Add `iou(a, b)`, `matches(det, lab, threshold)`,
    `precision_at_k(ranked, labeled, k, threshold)` (top-k by `virality_score` desc
    matching ≥1 labeled window / k), and `score_precision(...)` returning `None` when
    no fixture windows exist for the VOD.
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 4.1, 4.2, 4.3, 4.4, 4.5_

- [ ] 4. Metrics aggregator (`pipeline/metrics.py`)
  - `load_config`, `wall_clock_seconds(timings)`, `editing_time_saved_pct`,
    `automation_level` (automated/total stages, clamped [0,1]), `clips_per_hour`
    (zero-guard), `cost_per_vod`, `quality_score` (weighted normalized mean virality
    + mean cross-modal agreement from `len(modalities)`, [0,1], 0 for empty),
    `monetization_projection` / `content_reuse_projection` (labeled as projections
    with their assumptions), then `build_metrics(...)` (assemble the doc, omit
    timing-derived metrics when no timings, precision when no fixture, batch
    aggregates when no manifest) + `write_metrics` → `out/metrics.json` + `main(argv)`
    (`--clips`, `--timings`, `--batch-manifest`, `--stream-id`, `--config`, `--outdir`).
  - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 6.1, 6.2, 6.3, 6.4, 6.5, 7.1, 7.2, 7.3, 7.4, 8.1, 8.2, 8.3, 8.4, 9.1, 9.2, 9.3, 9.4, 10.1, 10.2, 10.3_

- [ ] 5. KPI strip in the standalone gallery (`pipeline/gallery.py`)
  - Add `render_kpi_strip(metrics)` (editing-time-saved %, automation, clips/hr,
    cost/VOD, quality score; label projection values), thread an optional
    `--metrics <path>` through `main`, and prepend the strip in `render(...)` when a
    Metrics_Document is supplied; render the gallery unchanged when it is absent.
  - _Requirements: 11.1, 11.2, 11.3, 11.4_

- [ ] 6. Unit tests for the metrics math
  - A few plain `pytest` tests (no property-based suite): IoU + precision@k on a
    known example (Req 4.1, 4.3); editing-time-saved / clips-per-hour zero-guards
    (Req 6.3, 7.2); quality score bounds + empty-set → 0 (Req 8.2, 8.3);
    graceful degradation — no timings omits timing metrics, no fixture omits
    precision, doc still written (Req 10.1, 10.3, 4.5).
  - _Requirements: 4.1, 4.3, 4.5, 6.3, 7.2, 8.2, 8.3, 10.1, 10.3_

- [ ] 7. Req 6 deliverable documentation
  - Document each Req 6 indicator (editing-time saved, automation level, clips/hr,
    cost/VOD, detection precision, quality score) referencing the corresponding
    `metrics.json` field, and present monetization/content-reuse as clearly-labeled
    projections with the commercial-benefit framing for creators/agencies.
  - _Requirements: 15.1, 15.2_

- [ ] 8. Checkpoint - run the aggregator + gallery and confirm the numbers
  - Run `pipeline/metrics.py` on a real job's outputs, open the gallery with
    `--metrics`, confirm the KPIs render and all tests pass. Pause for questions.

## Out of scope (abandoned — no AWS deploy)

The project dropped deployed AWS infrastructure; the demo runs on `npm run dev:mock`.
These remain specified in `requirements.md`/`design.md` as a would-be productionization
contract, but are NOT built:

- **Backend metrics endpoint** — `GET /jobs/{jobId}/metrics` (+ optional batch
  route), the pure-function shared-module extraction for Lambda reuse, IAM grants,
  and CDK synth assertions (Reqs 12, 13). Abandoned with the rest of the CDK/Lambda
  backend. (If metrics need to appear in the mock UI later, the natural home is a
  `GET /jobs/:id/metrics` handler in `frontend/local-server/server.mjs` serving
  `metrics.json` — a small JS addition, coordinated with the frontend owner.)
- **Metrics panel** (Req 14) — `[QUEUED — frontend]`, teammate owns the frontend.
- **Property-based test suite** — the 13 properties in `design.md` are covered at a
  hackathon level by the Task 6 unit tests; full Hypothesis coverage is optional.
