# Batch Processing

Process many VODs in one run instead of invoking the pipeline once per file.
This covers hackathon deliverable **Req 4 (batch processing capability)** and the
**Req 5 (scalability)** narrative.

> Scope: the project demos on `npm run dev:mock` with no deployed AWS
> infrastructure, so batch is delivered as a **local CLI** (`pipeline/batch.py`)
> over the existing per-VOD pipeline. The per-VOD pipeline still calls the
> Transcribe / Rekognition / Bedrock APIs — that's the detection algorithm, not
> deployed infra. A backend `POST /batches` fan-out is specified in
> `.kiro/specs/batch-processing/` but intentionally not built.

## What it does

`pipeline/batch.py` discovers `(video, chat-log)` pairs in a directory, runs the
per-VOD pipeline (`pipeline.run.run`) over each with a bounded worker pool, and
writes one aggregate `out/batch_manifest.json` with a machine-readable summary.

- **Discovery** — videos (`.mp4/.mov/.mkv`) are paired with chat-logs (`.csv`) by
  their leading stream-id token (`6910008_video.mp4` ↔ `6910008_log.csv`). A video
  with no matching log is skipped and listed under `excludedStreamIds`.
- **Bounded concurrency** — at most `maxWorkers` VODs run at once (default from
  `config/batch.json`, override with `--max-workers`). Config over redeploy.
- **Failure isolation** — one VOD raising is recorded as `failed` with a reason;
  the rest keep going. The batch exits successfully if ≥1 VOD completed.
- **Resumable** — the per-VOD pipeline already skips stages whose outputs exist,
  so re-running a batch resumes rather than recomputing finished VODs.

## Usage

```bash
python3 -m pipeline.batch --input-dir data --s3-bucket <bucket> --outdir out/batch
# options: --max-workers N  --vertical talk|gaming  --visual-mode fast|full|off  --top-clips N
```

Each VOD's full pipeline output lands in `out/batch/<streamId>/`; the aggregate
manifest is written to `out/batch/batch_manifest.json`.

## Output

See `docs/contracts/examples/batch-manifest.example.json`. The `summary` block
(`vods`, `clipsTotal`, `wallClockSeconds`, `clipsPerHour`) is consumed by the
metrics-dashboard feature.

## Scalability (Req 5)

The batch layer is a supervisor over independent, individually-resumable per-VOD
units — nothing is shared between them. This is the same shape managed AWS
services use to scale:

- **Locally:** a bounded thread pool fans N VODs across workers.
- **Productionized (not built):** the identical fan-out maps 1:1 onto a Step
  Functions `Map` state (one per-VOD execution per item), scaling to N parallel
  executions with Transcribe/Rekognition/Bedrock/render scaling per job. The
  detection algorithm and per-VOD contract are unchanged; only the executor
  differs. This is presented as an architecture slide, not deployed code.
