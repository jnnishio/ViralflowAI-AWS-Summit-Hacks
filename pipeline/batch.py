"""Batch orchestrator: run the per-VOD pipeline over many (video, chat-log) pairs.

Discovers VOD+log pairs from a directory (paired by stream-id stem), runs the
existing single-VOD pipeline (`pipeline.run.run`) over each with a bounded worker
pool, and aggregates one machine-readable `out/batch_manifest.json` + summary.

Each per-VOD run is failure-isolated (one bad VOD never aborts the batch) and
resumable for free (the per-VOD pipeline already skips stages whose outputs
exist). The aggregate summary (VODs, clips, wall-clock, clips/hr) is consumed by
the metrics-dashboard spec.

Usage:
  python3 -m pipeline.batch --input-dir data --s3-bucket my-bucket --outdir out/batch
  python3 -m pipeline.batch --input-dir data --s3-bucket my-bucket --max-workers 2
"""

import argparse
import json
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

VIDEO_EXTS = {".mp4", ".mov", ".mkv"}
LOG_EXTS = {".csv"}
_CONFIG = Path(__file__).resolve().parent.parent / "config" / "batch.json"


def _stream_id(path):
    """Stream id = the leading token of the file stem (e.g. `6910008_video` ->
    `6910008`, `6910008_log` -> `6910008`)."""
    return Path(path).stem.split("_")[0]


def discover_targets(source):
    """Discover (video, chat-log) pairs in a directory, paired by stream-id stem.

    Returns (targets, excluded_stream_ids) where targets is a list of
    {streamId, video, chatLog} dicts sorted by streamId, and excluded_stream_ids
    lists videos that had no matching chat-log.
    """
    source = Path(source)
    if not source.is_dir():
        raise ValueError(f"input source is not a directory: {source}")

    logs_by_sid = {}
    for f in source.iterdir():
        if f.suffix.lower() in LOG_EXTS:
            logs_by_sid.setdefault(_stream_id(f), f)

    targets, excluded = [], []
    for f in sorted(source.iterdir()):
        if f.suffix.lower() not in VIDEO_EXTS:
            continue
        sid = _stream_id(f)
        log = logs_by_sid.get(sid)
        if log is None:
            excluded.append(sid)
        else:
            targets.append({"streamId": sid, "video": str(f), "chatLog": str(log)})

    targets.sort(key=lambda t: t["streamId"])
    return targets, sorted(set(excluded))


def resolve_concurrency(cli_value, config=None):
    """Effective max concurrency: the CLI value if supplied, else the configured
    default (config/batch.json). Errors if the effective value is < 1."""
    if cli_value is not None:
        value = cli_value
    else:
        cfg = config
        if cfg is None:
            cfg = json.loads(_CONFIG.read_text()) if _CONFIG.exists() else {}
        value = cfg.get("maxWorkers", 2)
    if value < 1:
        raise ValueError(f"max concurrency must be >= 1, got {value}")
    return value


def count_clips(target_outdir):
    """Count clips produced for one target from its rendered manifest."""
    target_outdir = Path(target_outdir)
    for rel in ("clips/manifest.json", "clips/clips.json"):
        path = target_outdir / rel
        if path.exists():
            try:
                data = json.loads(path.read_text())
                return len(data)
            except (json.JSONDecodeError, TypeError):
                return 0
    return 0


def _run_one(target, outdir, s3_bucket, runner, run_kwargs):
    """Run the per-VOD pipeline for one target; never raises. Returns a result dict."""
    sid = target["streamId"]
    target_outdir = Path(outdir) / sid
    argv = [
        "--video", target["video"],
        "--chat-log", target["chatLog"],
        "--s3-bucket", s3_bucket,
        "--stream-id", sid,
        "--outdir", str(target_outdir),
    ]
    for flag, value in run_kwargs.items():
        if value is not None:
            argv += [f"--{flag}", str(value)]

    start = time.monotonic()
    try:
        runner(argv)
        duration = round(time.monotonic() - start, 2)
        return {
            "streamId": sid,
            "status": "completed",
            "durationSeconds": duration,
            "clipCount": count_clips(target_outdir),
        }
    except Exception as exc:  # failure isolation: record and continue
        duration = round(time.monotonic() - start, 2)
        return {
            "streamId": sid,
            "status": "failed",
            "durationSeconds": duration,
            "clipCount": 0,
            "reason": str(exc) or exc.__class__.__name__,
        }


def run_batch(targets, max_workers, outdir, s3_bucket, runner=None, **run_kwargs):
    """Run the per-VOD pipeline over targets with a bounded pool. Failure-isolated.

    `runner` defaults to `pipeline.run.run`; tests can inject a fake. Returns
    (results, wall_clock_seconds).
    """
    if runner is None:
        from pipeline.run import run as runner  # lazy import (pulls boto3)

    Path(outdir).mkdir(parents=True, exist_ok=True)
    start = time.monotonic()
    with ThreadPoolExecutor(max_workers=max_workers) as pool:
        results = list(pool.map(
            lambda t: _run_one(t, outdir, s3_bucket, runner, run_kwargs), targets
        ))
    wall_clock_s = round(time.monotonic() - start, 2)
    # keep output order stable by streamId regardless of completion order
    results.sort(key=lambda r: r["streamId"])
    return results, wall_clock_s


def build_manifest(results, wall_clock_s, excluded_stream_ids=None):
    """Aggregate per-target results into the batch manifest (with summary)."""
    excluded_stream_ids = excluded_stream_ids or []
    clips_total = sum(r["clipCount"] for r in results)
    manifest = {
        "targets": results,
        "excludedStreamIds": excluded_stream_ids,
        "totals": {
            "targets": len(results),
            "clipsTotal": clips_total,
            "wallClockSeconds": round(wall_clock_s, 2),
        },
    }
    manifest["summary"] = build_summary(manifest)
    return manifest


def build_summary(manifest):
    """Machine-readable rollup consumed by the metrics-dashboard spec."""
    totals = manifest["totals"]
    wall = totals["wallClockSeconds"]
    clips = totals["clipsTotal"]
    clips_per_hour = round(clips / (wall / 3600.0), 2) if wall > 0 else 0
    return {
        "vods": totals["targets"],
        "clipsTotal": clips,
        "wallClockSeconds": wall,
        "clipsPerHour": clips_per_hour,
    }


def write_outputs(manifest, outdir):
    """Write batch_manifest.json to a deterministic path within outdir."""
    outdir = Path(outdir)
    outdir.mkdir(parents=True, exist_ok=True)
    path = outdir / "batch_manifest.json"
    path.write_text(json.dumps(manifest, ensure_ascii=False, indent=1))
    return path


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--input-dir", required=True, help="directory of (video, log) pairs")
    ap.add_argument("--s3-bucket", required=True)
    ap.add_argument("--max-workers", type=int, default=None,
                    help="max concurrent VODs (default: config/batch.json)")
    ap.add_argument("--outdir", default="out/batch")
    # pass-through to the per-VOD pipeline
    ap.add_argument("--vertical", default=None)
    ap.add_argument("--visual-mode", default=None, choices=[None, "fast", "full", "off"])
    ap.add_argument("--top-clips", type=int, default=None)
    args = ap.parse_args(argv)

    max_workers = resolve_concurrency(args.max_workers)
    targets, excluded = discover_targets(args.input_dir)
    if not targets:
        print(f"no (video, chat-log) pairs found in {args.input_dir}", file=sys.stderr)
        return 1
    if excluded:
        print(f"excluded (no matching chat-log): {', '.join(excluded)}")

    print(f"batch: {len(targets)} VODs, max_workers={max_workers}")
    run_kwargs = {
        "vertical": args.vertical,
        "visual-mode": args.visual_mode,
        "top-clips": args.top_clips,
    }
    results, wall_clock_s = run_batch(
        targets, max_workers, args.outdir, args.s3_bucket, **run_kwargs
    )
    manifest = build_manifest(results, wall_clock_s, excluded)
    path = write_outputs(manifest, args.outdir)

    s = manifest["summary"]
    print(f"\nbatch manifest -> {path}")
    for r in results:
        line = f"  {r['streamId']}: {r['status']} ({r['durationSeconds']}s, {r['clipCount']} clips)"
        if r.get("reason"):
            line += f" - {r['reason']}"
        print(line)
    print(f"summary: {s['vods']} VODs, {s['clipsTotal']} clips, "
          f"{s['wallClockSeconds']}s, {s['clipsPerHour']} clips/hr")

    # exit successful iff at least one target completed
    return 0 if any(r["status"] == "completed" for r in results) else 1


if __name__ == "__main__":
    sys.exit(main())
