"""Fast-vs-Full performance benchmark for the highlight-detection pipeline.

The per-VOD pipeline already records per-stage wall-clock into `out/<id>/timings.json`
(see `pipeline.run.StageTimer`) and `pipeline.metrics` turns that into wall-clock /
throughput. What was missing — and what this module adds — is a harness that runs the
SAME VOD through more than one `--visual-mode` and produces one apples-to-apples
comparison artifact for the pitch deck: wall-clock per mode, per-stage breakdown, and a
data-driven Rekognition cost/latency estimate.

Two ways to use it:

1. COMPARE existing runs (no AWS calls, no cost, works offline right now):
     python3 -m pipeline.benchmark --from-existing fast=out/3654414-fast full=out/3654414 \
         --outdir out/benchmark
   Produces the cost / analyzed-minutes / candidate / modality comparison from whatever
   each run dir already contains. Wall-clock is included only if that run has a
   timings.json (older runs don't — they'll be reported as "not captured").

2. EXECUTE fresh, timed runs of each mode on one VOD and compare:
     python3 -m pipeline.benchmark --execute \
         --video data/6910008_video.mp4 --chat-log data/6910008_log.csv \
         --s3-bucket <bucket> --stream-id 6910008 --modes fast,full \
         --outdir out/benchmark --execute-full
   Requires live AWS creds. `--visual-mode full` runs whole-VOD Rekognition (shot +
   face) and is the EXPENSIVE path — it is skipped unless you pass --execute-full.

Outputs `out/benchmark/benchmark_<stream>.json` (machine-readable) and
`out/benchmark/benchmark_<stream>.md` (deck-ready table).

What is MEASURED vs ASSUMED (kept honest for the deck):
  - wall-clock, per-stage timing .............. MEASURED (from each run's timings.json)
  - analyzed video minutes per mode ........... MEASURED (VOD duration; summed candidate
                                                windows from candidates.json)
  - Rekognition API groups per mode ........... CODE-DERIVED (full: segment+face on whole
                                                VOD; fast: face on candidate windows)
  - dollar cost ............................... ASSUMPTION (analyzed minutes x the
                                                per-minute rate in config/metrics.json;
                                                the RATIO is robust, the absolute $ is only
                                                as good as the configured rate)
"""

import argparse
import json
import sys
import time
from pathlib import Path

_CONFIG = Path(__file__).resolve().parent.parent / "config" / "metrics.json"
BIN_SECONDS = 5


# ---------------------------------------------------------------------------
# pure helpers (unit-tested in tests/test_benchmark.py)
# ---------------------------------------------------------------------------

def load_config(path=None):
    path = Path(path) if path else _CONFIG
    return json.loads(path.read_text(encoding="utf-8"))


def _load_json(path):
    path = Path(path)
    # utf-8 explicitly: clip captions/metadata are Traditional Chinese, and the
    # default codec on some platforms (Windows cp1252) can't decode them.
    return json.loads(path.read_text(encoding="utf-8")) if path.exists() else None


def wall_clock_seconds(timings):
    """Total wall-clock from first stage start to last stage end (mirrors
    pipeline.metrics.wall_clock_seconds; duplicated here so benchmark has no
    import-time dependency on the metrics module)."""
    stages = (timings or {}).get("stages", [])
    if not stages:
        return None
    start = min(s["startS"] for s in stages)
    end = max(s["endS"] for s in stages)
    return round(max(0.0, end - start), 2)


def stage_durations(timings):
    """Per-stage seconds as an ordered list of {name, seconds}. [] when absent."""
    stages = (timings or {}).get("stages", [])
    return [{"name": s["name"], "seconds": round(s["endS"] - s["startS"], 2)} for s in stages]


def vod_duration_s(candidates, bin_seconds=BIN_SECONDS):
    """Source VOD duration in seconds, derived from the fusion series time grid.
    Returns 0.0 when the series is empty/absent."""
    if not candidates:
        return 0.0
    t_s = candidates.get("series", {}).get("t_s") or []
    return float(t_s[-1] + bin_seconds) if t_s else 0.0


def candidate_windows(candidates):
    """[(start_s, end_s), ...] for every candidate the run produced (these are the
    exact windows fast mode sends to Rekognition face detection)."""
    if not candidates:
        return []
    return [(c["start_s"], c["end_s"]) for c in candidates.get("candidates", [])]


def rekognition_workload(mode, duration_s, windows, pad_s):
    """Video-minutes billed to Rekognition per API group, from the real run shape.

    full: whole-VOD SegmentDetection + FaceDetection (visual.start_jobs)         -> both APIs, full duration
    fast: FaceDetection on padded candidate windows (visual.start_face_jobs...)  -> face only, candidate minutes
    off : no Rekognition
    """
    if mode == "full":
        minutes = round(duration_s / 60.0, 2)
        return {"segment": minutes, "face": minutes}
    if mode == "fast":
        total_s = sum((e - s) + 2 * pad_s for s, e in windows)
        if duration_s:
            total_s = min(total_s, duration_s)  # can't analyze more footage than exists
        return {"face": round(total_s / 60.0, 2)}
    return {}


def rekognition_cost(workload, rates):
    """Sum(minutes[api] * rate[api]) over the API groups actually invoked."""
    return round(sum(minutes * rates.get(api, 0.0) for api, minutes in workload.items()), 4)


def _ratio(full_value, fast_value):
    """full/fast ratio, rounded; None when the denominator is zero/absent."""
    if not fast_value:
        return None
    return round(full_value / fast_value, 2)


def summarize_run(mode, run_dir, config):
    """Read one run directory into a comparable summary dict."""
    run_dir = Path(run_dir)
    candidates = _load_json(run_dir / "candidates.json")
    timings = _load_json(run_dir / "timings.json")
    clips = _load_json(run_dir / "clips" / "clips.json")
    if clips is None:
        clips = _load_json(run_dir / "clips" / "manifest.json")

    rek_cfg = config.get("rekognition", {})
    rates = rek_cfg.get("ratesPerMinute", {})
    pad_s = rek_cfg.get("facePadSeconds", 10.0)

    duration = vod_duration_s(candidates)
    windows = candidate_windows(candidates)
    workload = rekognition_workload(mode, duration, windows, pad_s)

    return {
        "mode": mode,
        "runDir": str(run_dir),
        "vodDurationSeconds": round(duration, 2),
        "vodDurationMinutes": round(duration / 60.0, 2),
        "modalitiesPresent": (candidates or {}).get("modalities_present", []),
        "candidateCount": len(windows),
        "clipCount": len(clips) if isinstance(clips, list) else None,
        "wallClockSeconds": wall_clock_seconds(timings),
        "wallClockMinutes": (round(wall_clock_seconds(timings) / 60.0, 2)
                             if wall_clock_seconds(timings) is not None else None),
        "stageSeconds": stage_durations(timings),
        "rekognitionWorkloadMinutes": workload,
        "rekognitionMinutesTotal": round(sum(workload.values()), 2),
        "estimatedRekognitionCostUsd": rekognition_cost(workload, rates),
    }


def build_comparison(run_summaries, config):
    """Assemble the comparison doc + fast-vs-full deltas from per-mode summaries."""
    by_mode = {r["mode"]: r for r in run_summaries}
    doc = {
        "runs": run_summaries,
        "costModelNote": config.get("rekognition", {}).get("sourceNote", ""),
        "currency": config.get("costModel", {}).get("currency", "USD"),
    }

    if "fast" in by_mode and "full" in by_mode:
        fast, full = by_mode["fast"], by_mode["full"]
        deltas = {
            "rekognitionMinutesRatio": _ratio(full["rekognitionMinutesTotal"],
                                               fast["rekognitionMinutesTotal"]),
            "rekognitionCostRatio": _ratio(full["estimatedRekognitionCostUsd"],
                                           fast["estimatedRekognitionCostUsd"]),
            "rekognitionCostSavedUsd": round(full["estimatedRekognitionCostUsd"]
                                             - fast["estimatedRekognitionCostUsd"], 4),
        }
        if fast["wallClockSeconds"] is not None and full["wallClockSeconds"] is not None:
            deltas["wallClockSpeedup"] = _ratio(full["wallClockSeconds"], fast["wallClockSeconds"])
            deltas["wallClockSavedSeconds"] = round(full["wallClockSeconds"]
                                                    - fast["wallClockSeconds"], 2)
        else:
            deltas["wallClockNote"] = ("wall-clock not captured for one/both runs "
                                       "(no timings.json) — run with --execute to measure it")
        doc["deltas"] = deltas

    return doc


def render_markdown(doc):
    """Deck-ready Markdown table from the comparison doc."""
    lines = ["# Fast vs Full — Pipeline Performance Benchmark", ""]
    runs = doc["runs"]

    def cell(v):
        return "not captured" if v is None else str(v)

    lines += ["| Metric | " + " | ".join(r["mode"] for r in runs) + " |",
              "|---|" + "---|" * len(runs)]
    rows = [
        ("VOD duration (min)", lambda r: r["vodDurationMinutes"]),
        ("Modalities in fusion", lambda r: ", ".join(r["modalitiesPresent"]) or "—"),
        ("Candidates detected", lambda r: r["candidateCount"]),
        ("Clips produced", lambda r: cell(r["clipCount"])),
        ("Wall-clock (min)", lambda r: cell(r["wallClockMinutes"])),
        ("Rekognition minutes billed", lambda r: r["rekognitionMinutesTotal"]),
        ("Est. Rekognition cost (USD)", lambda r: r["estimatedRekognitionCostUsd"]),
    ]
    for label, fn in rows:
        lines.append(f"| {label} | " + " | ".join(cell(fn(r)) for r in runs) + " |")

    deltas = doc.get("deltas")
    if deltas:
        lines += ["", "## Fast vs Full deltas", ""]
        if deltas.get("wallClockSpeedup") is not None:
            lines.append(f"- Wall-clock speedup (full/fast): **{deltas['wallClockSpeedup']}x** "
                         f"({deltas['wallClockSavedSeconds']} s saved)")
        elif "wallClockNote" in deltas:
            lines.append(f"- Wall-clock speedup: _{deltas['wallClockNote']}_")
        if deltas.get("rekognitionMinutesRatio") is not None:
            lines.append(f"- Rekognition video-minutes analyzed (full/fast): "
                         f"**{deltas['rekognitionMinutesRatio']}x** fewer in fast mode")
        if deltas.get("rekognitionCostRatio") is not None:
            lines.append(f"- Est. Rekognition cost (full/fast): **{deltas['rekognitionCostRatio']}x** "
                         f"(${deltas['rekognitionCostSavedUsd']} saved/VOD, at configured rate)")

    lines += ["", "## Per-stage wall-clock (seconds)", ""]
    any_stages = any(r["stageSeconds"] for r in runs)
    if not any_stages:
        lines.append("_No timings.json in the compared runs — run with `--execute` to capture "
                     "per-stage wall-clock._")
    else:
        for r in runs:
            lines.append(f"### {r['mode']}")
            if not r["stageSeconds"]:
                lines.append("_not captured_")
            else:
                for st in r["stageSeconds"]:
                    lines.append(f"- {st['name']}: {st['seconds']} s")
            lines.append("")

    lines += ["", f"> Cost note: {doc.get('costModelNote', '')}"]
    return "\n".join(lines) + "\n"


# ---------------------------------------------------------------------------
# execution (runs the real pipeline — needs AWS creds)
# ---------------------------------------------------------------------------

def run_mode(mode, base_argv, outdir, runner=None):
    """Run the pipeline once in `mode` into `outdir`, returning external wall-clock
    seconds (independent of the internal StageTimer). `runner` defaults to
    pipeline.run.run; tests inject a fake."""
    if runner is None:
        from pipeline.run import run as runner
    argv = list(base_argv) + ["--visual-mode", mode, "--outdir", str(outdir)]
    start = time.monotonic()
    runner(argv)
    return round(time.monotonic() - start, 2)


def _parse_from_existing(pairs):
    """['fast=out/x', 'full=out/y'] -> [('fast','out/x'), ('full','out/y')]."""
    out = []
    for p in pairs:
        if "=" not in p:
            raise ValueError(f"--from-existing expects MODE=DIR, got: {p}")
        mode, path = p.split("=", 1)
        if mode not in ("fast", "full", "off"):
            raise ValueError(f"unknown mode '{mode}' (expected fast|full|off)")
        out.append((mode, path))
    return out


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--from-existing", nargs="+", metavar="MODE=DIR",
                    help="compare already-produced run dirs, e.g. fast=out/3654414-fast full=out/3654414")
    ap.add_argument("--execute", action="store_true",
                    help="run fresh, timed pipeline passes (needs AWS creds)")
    ap.add_argument("--execute-full", action="store_true",
                    help="allow running --visual-mode full (whole-VOD Rekognition; the EXPENSIVE path)")
    ap.add_argument("--modes", default="fast,full", help="comma list for --execute (default fast,full)")
    ap.add_argument("--video")
    ap.add_argument("--chat-log")
    ap.add_argument("--s3-bucket")
    ap.add_argument("--stream-id")
    ap.add_argument("--vertical", default="talk")
    ap.add_argument("--outdir", default="out/benchmark")
    ap.add_argument("--config", default=None)
    args = ap.parse_args(argv)

    config = load_config(args.config)
    outdir = Path(args.outdir)
    outdir.mkdir(parents=True, exist_ok=True)
    stream_id = args.stream_id or "benchmark"
    run_dirs = []  # (mode, dir)

    if args.execute:
        for req in ("video", "chat_log", "s3_bucket", "stream_id"):
            if not getattr(args, req):
                print(f"--execute requires --{req.replace('_', '-')}", file=sys.stderr)
                return 2
        base_argv = ["--video", args.video, "--chat-log", args.chat_log,
                     "--s3-bucket", args.s3_bucket, "--stream-id", args.stream_id,
                     "--vertical", args.vertical]
        for mode in [m.strip() for m in args.modes.split(",") if m.strip()]:
            if mode == "full" and not args.execute_full:
                print(f"skipping '{mode}' (whole-VOD Rekognition, real cost) — pass --execute-full "
                      f"to include it", file=sys.stderr)
                continue
            mode_dir = outdir / f"{args.stream_id}-{mode}"
            print(f"[benchmark] running mode={mode} -> {mode_dir}")
            wall = run_mode(mode, base_argv, mode_dir)
            print(f"[benchmark] mode={mode} external wall-clock: {wall}s")
            run_dirs.append((mode, mode_dir))

    elif args.from_existing:
        run_dirs = _parse_from_existing(args.from_existing)
    else:
        ap.error("provide --from-existing MODE=DIR ... or --execute with input flags")

    summaries = [summarize_run(mode, d, config) for mode, d in run_dirs]
    doc = build_comparison(summaries, config)

    json_path = outdir / f"benchmark_{stream_id}.json"
    md_path = outdir / f"benchmark_{stream_id}.md"
    json_path.write_text(json.dumps(doc, ensure_ascii=False, indent=1), encoding="utf-8")
    md_path.write_text(render_markdown(doc), encoding="utf-8")

    print(f"\nbenchmark -> {json_path}\nbenchmark -> {md_path}\n")
    print(render_markdown(doc))
    return 0


if __name__ == "__main__":
    sys.exit(main())
