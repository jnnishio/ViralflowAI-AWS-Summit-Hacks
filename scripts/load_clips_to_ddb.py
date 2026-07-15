#!/usr/bin/env python3
"""Step 0 seam-check loader: pipeline clips.json -> deployed DynamoDB tables.

Reads the canonical clip manifest emitted by `pipeline/contracts.py`
(out/<run>/clips/clips.json) and writes the flat DynamoDB `Clip` items the
deployed Highlights_API (`backend/lambdas/highlights_api/list_clips.py`)
actually reads, plus a `completed` `Job` row so the frontend can navigate
straight to the Highlights Grid for that jobId.

This is the "prove the seam before touching infra" step: it validates the
one genuinely tricky part -- the shape translation between the pipeline's
nested/bilingual output and the frontend's flat wire shape -- against real
pipeline output and (optionally) real deployed tables.

Shape translation (canonical clips.json  ->  DynamoDB Clip item):
    title.zh / title.en   -> titleNative / titleEnglish
    caption.zh            -> caption
    category              -> momentType
    clipKey               -> videoKey
    thumbKey              -> thumbKey   (unchanged)
    factors{...}          -> factors{chat,audio,visual,speech}  (missing -> 0)
    start/end/score/mood/hashtags/clipId  -> unchanged
    (added)               -> cropConfirmed = False

Usage (dry run -- no AWS creds needed, just prints translated items):
    python3 scripts/load_clips_to_ddb.py \
        --clips out/3654414-fast/clips/clips.json --dry-run

Usage (write to deployed tables):
    python3 scripts/load_clips_to_ddb.py \
        --clips out/3654414-fast/clips/clips.json \
        --job-table <JobTableName> --clip-table <ClipTableName> \
        --user-id <cognito-sub-of-your-test-user> \
        --region us-east-1 \
        --targets tiktok reels

Optionally upload the local rendered media so the grid's presigned
thumbnail/video URLs resolve (list_clips presigns from the raw bucket):
    ... --upload-media --raw-bucket <RawBucketName>
"""
from __future__ import annotations

import argparse
import json
import sys
from decimal import Decimal
from pathlib import Path

FACTOR_KEYS = ("chat", "audio", "visual", "speech")


def _factors(raw: dict) -> dict:
    """Frontend ClipFactors requires all four modalities; the pipeline only
    emits the ones that were present (visual is usually absent in fast mode).
    Default the missing modalities to 0 so the score-details panel renders."""
    return {k: raw.get(k, Decimal(0)) for k in FACTOR_KEYS}


def to_ddb_clip(clip: dict, job_id: str) -> dict:
    """Translate one canonical clips.json record to the flat DynamoDB item."""
    title = clip.get("title") or {}
    caption = clip.get("caption") or {}
    return {
        "jobId": job_id,
        "clipId": clip["clipId"],
        "start": clip["start"],
        "end": clip["end"],
        "score": clip["score"],
        "factors": _factors(clip.get("factors") or {}),
        "mood": clip["mood"],
        "momentType": clip.get("category", ""),
        "titleNative": title.get("zh", ""),
        "titleEnglish": title.get("en", ""),
        "caption": caption.get("zh", ""),
        "hashtags": clip.get("hashtags", []),
        "thumbKey": clip.get("thumbKey"),
        "videoKey": clip.get("clipKey"),
        "cropConfirmed": False,
    }


def load_clips(path: Path) -> list[dict]:
    # parse_float=Decimal so numbers are DynamoDB-safe (boto3 rejects floats).
    return json.loads(path.read_text(encoding="utf-8"), parse_float=Decimal)


def _local_media_path(clips_dir: Path, s3_key: str | None) -> Path | None:
    """clips.json stores S3 keys only; the rendered files sit next to it in
    the same clips/ dir under the same basename."""
    if not s3_key:
        return None
    candidate = clips_dir / Path(s3_key).name
    return candidate if candidate.exists() else None


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--clips", required=True,
                    help="path to canonical clips.json (from pipeline/contracts.py)")
    ap.add_argument("--job-id",
                    help="override jobId (default: taken from the clips.json records)")
    ap.add_argument("--user-id",
                    help="Cognito sub of the owning user (required unless --dry-run)")
    ap.add_argument("--targets", nargs="+", default=["tiktok"],
                    help="platform targets for the Job row (default: tiktok)")
    ap.add_argument("--job-table", help="deployed Job table name")
    ap.add_argument("--clip-table", help="deployed Clip table name")
    ap.add_argument("--region", default="us-east-1")
    ap.add_argument("--upload-media", action="store_true",
                    help="upload local rendered clips/thumbs to --raw-bucket "
                         "under their videoKey/thumbKey so presigned URLs resolve")
    ap.add_argument("--raw-bucket",
                    help="raw bucket name (RAW_BUCKET_NAME) for --upload-media")
    ap.add_argument("--dry-run", action="store_true",
                    help="translate and print items; write nothing, need no creds")
    args = ap.parse_args(argv)

    clips_path = Path(args.clips)
    if not clips_path.exists():
        ap.error(f"clips file not found: {clips_path}")
    clips_dir = clips_path.parent

    raw_clips = load_clips(clips_path)
    if not raw_clips:
        ap.error("clips.json is empty")

    job_id = args.job_id or raw_clips[0].get("jobId")
    if not job_id:
        ap.error("no jobId in clips.json; pass --job-id explicitly")

    ddb_clips = [to_ddb_clip(c, job_id) for c in raw_clips]
    job_item = {
        "jobId": job_id,
        "userId": args.user_id or "<user-id>",
        "status": "completed",
        "targets": args.targets,
        "sourceKeys": [f"raw/{job_id}/source.mp4"],
        "createdAt": raw_clips[0].get("createdAt", ""),
    }

    if args.dry_run:
        print("=== DRY RUN: no writes ===\n")
        print("Job item:")
        print(json.dumps(job_item, ensure_ascii=False, indent=2, default=str))
        print(f"\n{len(ddb_clips)} Clip item(s):")
        print(json.dumps(ddb_clips, ensure_ascii=False, indent=2, default=str))
        return 0

    # ---- live writes: validate required flags -------------------------------
    missing = [f for f, v in (("--user-id", args.user_id),
                              ("--job-table", args.job_table),
                              ("--clip-table", args.clip_table)) if not v]
    if missing:
        ap.error(f"live write requires: {', '.join(missing)} (or use --dry-run)")
    if args.upload_media and not args.raw_bucket:
        ap.error("--upload-media requires --raw-bucket")

    import boto3  # imported lazily so --dry-run has no boto3 dependency

    ddb = boto3.resource("dynamodb", region_name=args.region)
    job_table = ddb.Table(args.job_table)
    clip_table = ddb.Table(args.clip_table)

    if args.upload_media:
        s3 = boto3.client("s3", region_name=args.region)
        uploaded = 0
        for src, key in [(c["videoKey"], c["videoKey"]) for c in ddb_clips] + \
                        [(c["thumbKey"], c["thumbKey"]) for c in ddb_clips]:
            local = _local_media_path(clips_dir, key)
            if local is None:
                print(f"  ! no local file for {key}, skipping upload")
                continue
            ctype = "video/mp4" if local.suffix == ".mp4" else "image/jpeg"
            s3.upload_file(str(local), args.raw_bucket, key,
                           ExtraArgs={"ContentType": ctype})
            uploaded += 1
        print(f"uploaded {uploaded} media object(s) to s3://{args.raw_bucket}")

    job_table.put_item(Item=job_item)
    print(f"wrote Job {job_id} (status=completed, owner={args.user_id})")

    with clip_table.batch_writer() as batch:
        for clip in ddb_clips:
            batch.put_item(Item=clip)
    print(f"wrote {len(ddb_clips)} Clip item(s) to {args.clip_table}")

    print(f"\nDone. Open the frontend as user {args.user_id} and load jobId:\n  {job_id}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
