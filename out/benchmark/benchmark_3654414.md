# Fast vs Full — Pipeline Performance Benchmark

| Metric | fast | full |
|---|---|---|
| VOD duration (min) | 74.0 | 74.0 |
| Modalities in fusion | audio, chat, speech | audio, chat, speech, visual |
| Candidates detected | 12 | 7 |
| Clips produced | 5 | 5 |
| Wall-clock (min) | not captured | not captured |
| Rekognition minutes billed | 15.67 | 148.0 |
| Est. Rekognition cost (USD) | 1.567 | 11.1 |

## Fast vs Full deltas

- Wall-clock speedup: _wall-clock not captured for one/both runs (no timings.json) — run with --execute to measure it_
- Rekognition video-minutes analyzed (full/fast): **9.44x** fewer in fast mode
- Est. Rekognition cost (full/fast): **7.08x** ($9.533 saved/VOD, at configured rate)

## Per-stage wall-clock (seconds)

_No timings.json in the compared runs — run with `--execute` to capture per-stage wall-clock._

> Cost note: ASSUMPTION: AWS Rekognition Video list price, us-east-1 (SegmentDetection ~$0.05/min, FaceDetection ~$0.10/min). Verify at https://aws.amazon.com/rekognition/pricing/ before quoting dollars. The analyzed-MINUTES figures are computed from real run data; only the per-minute rate is an assumption.
