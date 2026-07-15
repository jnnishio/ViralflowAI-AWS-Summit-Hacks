"""Performance & ROI metrics aggregator (deliverable Req 6).

Reads the pipeline's outputs plus config/metrics.json and writes out/metrics.json:
editing-time-saved %, automation level, clips/hour, cost per VOD, output quality
score, detection precision (vs the ground-truth fixture), and clearly-labeled
monetization / content-reuse projections. Optional batch aggregate from a batch
manifest. Every input except the clip contract degrades gracefully if missing.

Usage:
  python3 -m pipeline.metrics --clips out/clips/clips.json --stream-id 6910008 \
      --timings out/timings.json --batch-manifest out/batch/batch_manifest.json \
      --outdir out
"""

import argparse
import json
import sys
from pathlib import Path

from pipeline.precision import load_fixture, score_precision

_CONFIG = Path(__file__).resolve().parent.parent / "config" / "metrics.json"


def load_config(path=None):
    path = Path(path) if path else _CONFIG
    return json.loads(path.read_text())


def _virality(clip):
    return float(clip.get("score", clip.get("virality_score", 0)))


def _agreement(clip):
    return len(clip.get("modalities", []) or [])


def wall_clock_seconds(timings):
    """Total wall-clock from the first stage start to the last stage end."""
    stages = (timings or {}).get("stages", [])
    if not stages:
        return 0.0
    start = min(s["startS"] for s in stages)
    end = max(s["endS"] for s in stages)
    return round(max(0.0, end - start), 2)


def editing_time_saved_pct(clip_count, wall_clock_s, config):
    baseline_min = clip_count * config["editorMinutesPerClip"]
    if baseline_min <= 0:
        return 0.0
    wall_min = wall_clock_s / 60.0
    return round((baseline_min - wall_min) / baseline_min * 100.0, 2)


def automation_level(config):
    stages = config["workflowStages"]
    total = stages["total"]
    if total <= 0:
        return 0.0
    return round(min(1.0, max(0.0, stages["automated"] / total)), 3)


def clips_per_hour(clip_count, wall_clock_s):
    if wall_clock_s <= 0:
        return 0
    return round(clip_count / (wall_clock_s / 3600.0), 2)


def cost_per_vod(config):
    cost = config["costModel"]
    return {"amount": round(sum(cost["perVod"].values()), 2), "currency": cost["currency"]}


def quality_score(clips, config):
    """Weighted mean of normalized virality (score/100) and normalized cross-modal
    agreement (len(modalities)/maxModalities), in [0, 1]. 0 for an empty set."""
    if not clips:
        return 0.0
    weights = config["qualityWeights"]
    max_mod = config.get("precision", {}).get("maxModalities", 3)
    mean_virality = sum(min(_virality(c) / 100.0, 1.0) for c in clips) / len(clips)
    mean_agreement = sum(min(_agreement(c) / max_mod, 1.0) for c in clips) / len(clips)
    score = weights["virality"] * mean_virality + weights["crossModal"] * mean_agreement
    return round(min(1.0, max(0.0, score)), 2)


def monetization_projection(clip_count, config):
    assumptions = config["projectionAssumptions"]
    rpm = config["platformRpm"]
    views_per_clip = assumptions["projectedViewsPerClip"]
    total_views = clip_count * views_per_clip
    # projected as if each clip is posted to every target platform
    amount = sum(total_views / 1000.0 * r for r in rpm.values())
    return {
        "kind": "projection",
        "amount": round(amount, 2),
        "currency": config["costModel"]["currency"],
        "assumptions": {"projectedViewsPerClip": views_per_clip, "platformRpm": dict(rpm)},
    }


def content_reuse_projection(clip_count, source_seconds, config):
    assumptions = config["projectionAssumptions"]
    source_hours = (source_seconds / 3600.0) if source_seconds else assumptions["reuseSourceHours"]
    clips_per_source_hour = round(clip_count / source_hours, 2) if source_hours > 0 else 0
    return {
        "kind": "projection",
        "clipsPerSourceHour": clips_per_source_hour,
        "reuseMultiplier": clip_count,
        "assumptions": {"reuseSourceHours": assumptions["reuseSourceHours"]},
    }


def build_metrics(stream_id, clips, timings, batch, config, labeled=None, source_seconds=None):
    """Assemble the metrics document, omitting indicators whose inputs are absent."""
    clip_count = len(clips)
    doc = {
        "streamId": stream_id,
        "clipCount": clip_count,
        "costPerVod": cost_per_vod(config),
        "qualityScore": quality_score(clips, config),
        "projections": {
            "monetization": monetization_projection(clip_count, config),
            "contentReuse": content_reuse_projection(clip_count, source_seconds, config),
        },
    }

    # timing-derived indicators (omitted when no timings)
    if timings:
        wall = wall_clock_seconds(timings)
        doc["wallClockSeconds"] = wall
        doc["editingTimeSavedPct"] = editing_time_saved_pct(clip_count, wall, config)
        doc["automationLevel"] = automation_level(config)
        doc["clipsPerHour"] = clips_per_hour(clip_count, wall)

    # detection precision (omitted when no fixture windows for this VOD)
    precision = score_precision(clips, labeled or [], config.get("precision", {}))
    if precision is not None:
        doc["detectionPrecision"] = precision

    # batch aggregate (omitted when no batch manifest)
    if batch:
        doc["batch"] = batch

    return doc


def write_metrics(doc, outdir):
    outdir = Path(outdir)
    outdir.mkdir(parents=True, exist_ok=True)
    path = outdir / "metrics.json"
    path.write_text(json.dumps(doc, ensure_ascii=False, indent=1))
    return path


def _load_json(path):
    return json.loads(Path(path).read_text()) if path and Path(path).exists() else None


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--clips", required=True, help="clips.json (canonical clip contract)")
    ap.add_argument("--stream-id", required=True)
    ap.add_argument("--timings", default=None, help="out/timings.json")
    ap.add_argument("--batch-manifest", default=None, help="out/batch/batch_manifest.json")
    ap.add_argument("--source-seconds", type=float, default=None,
                    help="source VOD duration for the reuse projection")
    ap.add_argument("--config", default=None)
    ap.add_argument("--outdir", default="out")
    args = ap.parse_args(argv)

    clips = _load_json(args.clips)
    if clips is None:
        print(f"clip contract required but not found: {args.clips}", file=sys.stderr)
        return 1

    config = load_config(args.config)
    timings = _load_json(args.timings)
    batch_manifest = _load_json(args.batch_manifest)
    batch = batch_manifest.get("summary") if batch_manifest else None
    labeled = load_fixture(args.stream_id)

    doc = build_metrics(args.stream_id, clips, timings, batch, config,
                        labeled=labeled, source_seconds=args.source_seconds)
    path = write_metrics(doc, args.outdir)
    print(f"metrics -> {path}")
    for key in ("clipCount", "editingTimeSavedPct", "automationLevel", "clipsPerHour",
                "qualityScore"):
        if key in doc:
            print(f"  {key}: {doc[key]}")
    if "detectionPrecision" in doc:
        print(f"  precision@{doc['detectionPrecision']['k']}: {doc['detectionPrecision']['precisionAtK']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
