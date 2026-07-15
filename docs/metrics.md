# Performance & ROI Metrics

Quantitative performance indicators for hackathon deliverable **Req 6**, computed
from real pipeline outputs by `pipeline/metrics.py` into `out/metrics.json`.

> Scope: demo runs on `npm run dev:mock` with no deployed AWS infrastructure, so
> metrics are produced by the local aggregator and surfaced in the standalone
> `pipeline/gallery.py` KPI strip. The `GET /jobs/{id}/metrics` backend endpoint
> is specified but abandoned with the rest of the AWS backend.

## Generate

```bash
# after a pipeline run (single VOD) — timings.json is emitted by pipeline.run
python3 -m pipeline.metrics --clips out/clips/clips.json --stream-id 6910008 \
    --timings out/timings.json --outdir out

# with a batch aggregate + gallery KPI strip
python3 -m pipeline.metrics --clips out/6910008/clips/clips.json --stream-id 6910008 \
    --timings out/6910008/timings.json --batch-manifest out/batch/batch_manifest.json \
    --outdir out/6910008
python3 -m pipeline.gallery out/6910008/clips --metrics out/6910008/metrics.json
```

## Indicators

Each maps to a field in `out/metrics.json` (example:
`docs/contracts/examples/metrics.example.json`). All heuristics/assumptions live in
`config/metrics.json` (config over redeploy).

| Req 6 indicator | `metrics.json` field | How it's computed |
|---|---|---|
| Editing time saved % | `editingTimeSavedPct` | `(baseline − wallClock) / baseline`, where `baseline = clipCount × editorMinutesPerClip`. Manual-editing baseline vs measured pipeline wall-clock (from `timings.json`). |
| Automation level | `automationLevel` | `workflowStages.automated / workflowStages.total` — fraction of the end-to-end clip-production workflow that runs without human action. |
| Throughput | `clipsPerHour` | `clipCount / (wallClockSeconds / 3600)`. |
| Cost per VOD | `costPerVod` | Sum of the `costModel.perVod` components (Transcribe, Rekognition, Bedrock, render), with currency. |
| Detection accuracy | `detectionPrecision` | `precision@k` and mean best temporal IoU of detected clips vs the labeled ground-truth windows in `pipeline/fixtures/ground_truth.json`. Omitted when a VOD has no labeled set. |
| Output quality score | `qualityScore` | Weighted mean of normalized clip virality and normalized cross-modal agreement (`len(modalities)`), in `[0,1]`. |

Timing-derived indicators are omitted (rather than fabricated) when `timings.json`
is absent; precision is omitted when no ground-truth windows exist for the VOD.

## Commercial benefit (projections)

`projections.monetization` and `projections.contentReuse` are **projections**, not
measurements — each is marked `"kind": "projection"` and carries the `assumptions`
used, so the numbers are transparent and tunable:

- **Monetization** — projected creator revenue from `clipCount × projectedViewsPerClip`
  across the target platforms' RPM (`config/metrics.json` `platformRpm`). Frames the
  per-VOD upside of turning one stream into many short-form posts.
- **Content reuse** — clips produced per source hour and a reuse multiplier, framing
  how much publishable short-form a single long VOD yields.

For creators/agencies the headline story is: the pipeline turns hours of manual
editing into a ~minutes, ~few-dollars automated run (`editingTimeSavedPct`,
`costPerVod`, `clipsPerHour`) that produces multiple ranked, platform-ready clips
per VOD (`projections`), at a measured detection quality (`detectionPrecision`,
`qualityScore`).
