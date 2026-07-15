# Implementation Plan: Batch Processing

## Hackathon scope note

This plan is trimmed to the lean scope needed for the hackathon demo. The build
target is the **local batch CLI** (`pipeline/batch.py`) that runs the existing
per-VOD pipeline over the two `data/` VOD pairs and aggregates one manifest +
summary — that alone demonstrates the Req 4 "batch processing" capability and
feeds the metrics-dashboard spec.

The **backend fan-out API** (`POST /batches`, `GET /batches/{batchId}`, the
`Batch` DynamoDB table, IAM/CDK wiring) and the **distributed-`Map` variant** are
ABANDONED — the project has dropped deployed AWS infrastructure entirely and demos
on `npm run dev:mock` (the frontend mock server). Only the local `pipeline/batch.py`
CLI is built. It stays independent of AWS *infrastructure*; the underlying per-VOD
pipeline still calls the Transcribe/Rekognition/Bedrock *APIs* (that's the detection
algorithm, not deployed infra). The Req 5 scalability story is an architecture-slide
talking point: the CLI's bounded fan-out maps cleanly onto a Step Functions `Map` if
ever productionized. Tests are a small set of plain unit tests rather than the full
property-based suite in `design.md`.

## Tasks

- [ ] 1. Document the batch manifest shape
  - Add a `docs/contracts/batch_manifest.example.json` example (per-target entry:
    stream id, status in {completed, failed}, duration seconds, clip count;
    batch-level totals; summary block), and a short paragraph in
    `INTEGRATION_CONTRACT.md` describing it. Skip the formal JSON schema.
  - _Requirements: 1.4, 1.5, 1.6, 1.8_

- [ ] 2. Implement the batch orchestrator CLI (`pipeline/batch.py`)
  - [ ] 2.1 Target discovery
    - `discover_targets(source)`: from a directory, pair videos with chat-logs by
      shared stream-id stem; derive each target id from the video stem; exclude
      videos with no matching chat-log (record excluded ids); error on zero targets.
    - _Requirements: 2.1, 2.3, 2.4, 2.5_
  - [ ] 2.2 Bounded, failure-isolated runner + concurrency resolution
    - `resolve_concurrency(cli_value, config)` (CLI value else config default; error
      if `< 1`) and `run_batch(targets, max_workers, outdir)`: submit each target to
      a bounded pool invoking `pipeline.run.run(...)` with a per-target output
      subdir; cap concurrency at `max_workers`; capture any per-target exception as a
      `failed` result with a reason and continue the rest; record a terminal
      `completed`/`failed` status per target; batch exit status successful iff ≥1
      target completed. Per-VOD stage-skipping gives resumability for free.
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 4.1, 5.1, 5.2, 5.3, 5.4_
  - [ ] 2.3 Manifest + summary aggregation and CLI
    - `count_clips`, `build_manifest(results, wall_clock_s)` (one entry per target +
      batch totals: target count, total clip count = sum, total wall-clock =
      last-completion − first-start), `build_summary(manifest)` (VODs, total clips,
      wall-clock, clips/hr with a zero-guard), and `write_outputs` writing
      `out/batch_manifest.json` to a deterministic path; add `main(argv)`
      (`--input-dir`, `--max-workers`, `--outdir`).
    - _Requirements: 4.2, 4.3, 6.1, 6.2, 6.3, 6.4, 11.1, 11.2, 11.3, 11.4_

- [ ] 3. Unit tests for the batch CLI
  - A few plain `pytest` tests (no property-based suite): discovery pairs by
    shared stem and excludes unmatched videos (Req 2.1, 2.3); failure isolation —
    one target raising still yields a full manifest with the others `completed`
    (Req 5.1, 5.3); summary math incl. the zero-wall-clock guard (Req 6.3, 11.4);
    invalid-concurrency and empty-discovery errors (Req 2.5, 3.4).
  - _Requirements: 2.1, 2.3, 2.5, 3.4, 5.1, 5.3, 6.3, 11.4_

- [ ] 4. Batch + scalability documentation
  - Add a batch-capability section (Req 4) describing `pipeline/batch.py` and the
    two-VOD run over `6910008` and `3654414`, and a short fan-out scalability
    narrative (Req 5) framed over the existing per-job Step Functions (with the
    deferred API/`Map` variant noted as the productionization path).
  - _Requirements: 14.1, 14.2_

- [ ] 5. Checkpoint - run the batch over `data/` and confirm the manifest
  - Run `pipeline/batch.py` over the two `data/` pairs; confirm `batch_manifest.json`
    + summary look right and all tests pass. Pause for questions.

## Out of scope (abandoned — no AWS deploy)

The project dropped deployed AWS infrastructure; the demo runs on `npm run dev:mock`.
These remain specified in `requirements.md`/`design.md` as a would-be productionization
contract, but are NOT built:

- **Backend fan-out API** — `POST /batches` + `GET /batches/{batchId}`, the shared
  child-job helper from `create_job.py`, the `Batch` DynamoDB table, IAM grants, and
  CDK synth assertions (Reqs 7, 8, 9, 10). Abandoned with the rest of the CDK/Lambda
  backend.
- **Distributed-`Map` variant** (Req 12) — architecture-slide talking point only.
- **Batch dashboard** (Req 13) — `[QUEUED — frontend]`, teammate owns the frontend.
- **Property-based test suite** — the 13 properties in `design.md` are covered at a
  hackathon level by the Task 3 unit tests; full Hypothesis coverage is optional.
