"""Emit the canonical Clip manifest defined in docs/contracts/clip-manifest.schema.json.

The pipeline internally speaks snake_case with _zh/_en suffixes and local file
paths (highlights.json, clips/manifest.json). The UI + DynamoDB layer speak the
camelCase Clip model from .kiro/steering/architecture.md. This module is the single
translation point between the two, so the naming drift lives in one place.

Reads highlights.json (the AI Director output — carries peak/modalities/keep/reason
that the render manifest drops) joined with clips/manifest.json (for the rendered
file/thumb/proxy basenames), and writes clips/clips.json.

Usage:
  python3 -m pipeline.contracts out/3654414-fast/highlights.json \
      --manifest out/3654414-fast/clips/manifest.json --stream-id 3654414 \
      --out out/3654414-fast/clips/clips.json
"""

import argparse
import json
from datetime import datetime, timezone
from pathlib import Path


def s3_key(prefix, stream_id, local_path):
    """clips/{stream}/{basename} — matches the key layout pipeline/publish.py uploads to."""
    return f"{prefix}/{stream_id}/{Path(local_path).name}"


def to_canonical_clip(hl, i, job_id, clip_key, thumb_key, proxy_key, created_at):
    """Map one Director highlight to the canonical camelCase Clip record."""
    clip = {
        "jobId": job_id,
        "clipId": f"clip_{i:02d}",
        "start": hl["start_s"],
        "end": hl["end_s"],
        "score": hl["virality_score"],
        "factors": hl["factors"],
        "modalities": hl.get("modalities", []),
        "keep": hl.get("keep", True),
        "mood": hl["mood"],
        "category": hl["category"],
        "title": {"zh": hl["title_zh"], "en": hl["title_en"]},
        "hook": {"zh": hl["hook_zh"]},
        "caption": {"zh": hl["caption_zh"], "en": hl["caption_en"]},
        "hashtags": hl["hashtags"],
        "clipKey": clip_key,
        "thumbKey": thumb_key,
        "proxyKey": proxy_key,
        "createdAt": created_at,
    }
    # peak_s / reason are optional in the schema; include when the Director provided them
    if "peak_s" in hl:
        clip["peak"] = hl["peak_s"]
    if hl.get("reason"):
        clip["reason"] = hl["reason"]
    return clip


def emit(highlights_path, manifest_path, stream_id, out_path, created_at=None):
    highlights = json.loads(Path(highlights_path).read_text())["highlights"]
    manifest = json.loads(Path(manifest_path).read_text())
    job_id = f"job_{stream_id}"
    created_at = created_at or datetime.now(timezone.utc).isoformat(timespec="seconds")

    clips = []
    # render.py renders highlights[:top] 1:1 in order, so zip by position
    for i, (hl, m) in enumerate(zip(highlights, manifest), 1):
        clips.append(to_canonical_clip(
            hl, i, job_id,
            clip_key=s3_key("clips", stream_id, m["file"]),
            thumb_key=s3_key("clips", stream_id, m["thumb"]),
            proxy_key=s3_key("clips", stream_id, m["proxy"]) if m.get("proxy") else None,
            created_at=created_at,
        ))
    Path(out_path).write_text(json.dumps(clips, ensure_ascii=False, indent=1))
    return clips


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("highlights")
    ap.add_argument("--manifest", required=True, help="clips/manifest.json from render.py")
    ap.add_argument("--stream-id", required=True)
    ap.add_argument("--out", required=True)
    args = ap.parse_args(argv)
    clips = emit(args.highlights, args.manifest, args.stream_id, args.out)
    print(f"{len(clips)} clips -> {args.out}")


if __name__ == "__main__":
    main()
