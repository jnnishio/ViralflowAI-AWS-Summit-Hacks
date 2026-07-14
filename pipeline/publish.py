"""Upload the contract-shaped deliverables to S3 and emit presigned GET URLs.

Hosts each clip's mp4 / thumbnail / proxy plus the canonical clips.json and the
per-clip EDLs under presigned-GET-able keys, so the UI and editor teammates can
fetch real assets from the cloud instead of files on a laptop — without the API
Gateway/Lambda layer existing yet. Writes out/{stream}/published.json mapping
clipId -> URLs for immediate demo/dev use.

Reuses the boto3 S3 pattern from pipeline/run.py (head_object idempotency guard).
Needs live AWS creds; degrades to a clear message (not a crash) when they're
missing/expired.

Usage:
  python3 -m pipeline.publish --stream-id 3654414 --outdir out/3654414-fast \
      --s3-bucket hackathon-152315741309-us-east-1-an
"""

import argparse
import json
from pathlib import Path

import boto3
from botocore.exceptions import ClientError, NoCredentialsError

from pipeline.contracts import s3_key

REGION = "us-east-1"
PRESIGN_EXPIRES_S = 24 * 3600

CONTENT_TYPES = {".mp4": "video/mp4", ".jpg": "image/jpeg",
                 ".jpeg": "image/jpeg", ".json": "application/json"}


def _content_type(path):
    return CONTENT_TYPES.get(Path(path).suffix.lower(), "application/octet-stream")


def _upload(s3, bucket, local, key):
    """Idempotent upload — skip if the object already exists (same guard as run.py)."""
    try:
        s3.head_object(Bucket=bucket, Key=key)
    except ClientError:
        s3.upload_file(str(local), bucket, key,
                       ExtraArgs={"ContentType": _content_type(local)})
    return key


def _presign(s3, bucket, key, expires=PRESIGN_EXPIRES_S):
    return s3.generate_presigned_url(
        "get_object", Params={"Bucket": bucket, "Key": key}, ExpiresIn=expires)


def publish(stream_id, outdir, bucket, expires=PRESIGN_EXPIRES_S):
    outdir = Path(outdir)
    manifest = json.loads((outdir / "clips" / "manifest.json").read_text())
    clips_json = outdir / "clips" / "clips.json"
    edl_dir = outdir / "edl"

    s3 = boto3.client("s3", region_name=REGION)
    published = {"jobId": f"job_{stream_id}", "clips": {}}

    try:
        for i, m in enumerate(manifest, 1):
            clip_id = f"clip_{i:02d}"
            entry = {}
            for role, local in (("clip", m.get("file")), ("thumb", m.get("thumb")),
                                ("proxy", m.get("proxy"))):
                if not local or not Path(local).exists():
                    continue
                key = _upload(s3, bucket, local, s3_key("clips", stream_id, local))
                entry[f"{role}Url"] = _presign(s3, bucket, key, expires)
            # per-clip EDL
            edl_file = edl_dir / f"{clip_id}.edl.json"
            if edl_file.exists():
                key = _upload(s3, bucket, edl_file, f"edls/{stream_id}/{edl_file.name}")
                entry["edlUrl"] = _presign(s3, bucket, key, expires)
            published["clips"][clip_id] = entry

        if clips_json.exists():
            key = _upload(s3, bucket, clips_json, f"manifests/{stream_id}/clips.json")
            published["manifestUrl"] = _presign(s3, bucket, key, expires)
    except (NoCredentialsError, ClientError) as e:
        code = getattr(e, "response", {}).get("Error", {}).get("Code", type(e).__name__)
        print(f"publish: skipped S3 upload ({code}). Refresh AWS creds and rerun with "
              f"--upload-s3 to host the artifacts.")
        return None

    (outdir / "published.json").write_text(json.dumps(published, ensure_ascii=False, indent=1))
    print(f"published {len(published['clips'])} clips -> s3://{bucket}/ "
          f"(URLs in {outdir}/published.json)")
    return published


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--stream-id", required=True)
    ap.add_argument("--outdir", required=True)
    ap.add_argument("--s3-bucket", required=True)
    ap.add_argument("--expires", type=int, default=PRESIGN_EXPIRES_S)
    args = ap.parse_args(argv)
    publish(args.stream_id, args.outdir, args.s3_bucket, args.expires)


if __name__ == "__main__":
    main()
