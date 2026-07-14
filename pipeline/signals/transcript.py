"""Speech signal: Amazon Transcribe job management + transcript parsing.

Starts a Transcribe job directly on the S3 VOD (no download needed), waits for
completion, and parses the result into:
  - word/segment timeline (for caption burn-in later)
  - per-bin speech-rate features that feed the fusion engine
Also requests SRT/VTT subtitle sidecars from Transcribe for the render stage.

Usage:
  python3 -m pipeline.signals.transcript start s3://bucket/video.mp4 --job my-job
  python3 -m pipeline.signals.transcript wait my-job --out out/transcript.json
"""

import argparse
import json
import sys
import time
from pathlib import Path

import boto3

REGION = "us-east-1"
LANGUAGE = "zh-TW"


def start_job(media_uri, job_name, output_bucket=None, language=LANGUAGE):
    tx = boto3.client("transcribe", region_name=REGION)
    kwargs = dict(
        TranscriptionJobName=job_name,
        Media={"MediaFileUri": media_uri},
        MediaFormat=media_uri.rsplit(".", 1)[-1].lower(),
        LanguageCode=language,
        Subtitles={"Formats": ["srt", "vtt"]},
        Settings={
            "ShowSpeakerLabels": True,
            "MaxSpeakerLabels": 4,
        },
    )
    if output_bucket:
        kwargs["OutputBucketName"] = output_bucket
        kwargs["OutputKey"] = f"transcribe/{job_name}/"
    tx.start_transcription_job(**kwargs)
    return job_name


def get_job(job_name):
    tx = boto3.client("transcribe", region_name=REGION)
    return tx.get_transcription_job(TranscriptionJobName=job_name)["TranscriptionJob"]


def wait_job(job_name, poll_s=30, timeout_s=3600):
    waited = 0
    while waited < timeout_s:
        job = get_job(job_name)
        status = job["TranscriptionJobStatus"]
        if status in ("COMPLETED", "FAILED"):
            return job
        time.sleep(poll_s)
        waited += poll_s
    raise TimeoutError(f"transcribe job {job_name} still running after {timeout_s}s")


def fetch_result(job):
    """Download the transcript JSON for a completed job (handles both output modes)."""
    import urllib.request

    uri = job["Transcript"]["TranscriptFileUri"]
    if uri.startswith("s3://") or ".s3." in uri or "//s3." in uri:
        # Bucket-owned output: fetch via boto3 (the https form isn't presigned).
        s3 = boto3.client("s3", region_name=REGION)
        if uri.startswith("s3://"):
            bucket, key = uri[5:].split("/", 1)
        else:
            # https://<bucket>.s3.<region>.amazonaws.com/<key> or path-style
            from urllib.parse import urlparse

            p = urlparse(uri)
            if p.netloc.startswith("s3."):
                bucket, key = p.path.lstrip("/").split("/", 1)
            else:
                bucket = p.netloc.split(".s3")[0]
                key = p.path.lstrip("/")
        body = s3.get_object(Bucket=bucket, Key=key)["Body"].read()
    else:
        body = urllib.request.urlopen(uri).read()
    return json.loads(body)


def parse_transcript(raw):
    """Transcribe JSON -> {segments: [{start_s, end_s, speaker, text}], words: [...]}"""
    words = []
    for item in raw["results"]["items"]:
        if item["type"] != "pronunciation":
            continue
        words.append(
            {
                "start_s": float(item["start_time"]),
                "end_s": float(item["end_time"]),
                "text": item["alternatives"][0]["content"],
                "speaker": item.get("speaker_label", ""),
            }
        )

    # Prefer Transcribe's own audio_segments when present; else split on gaps.
    segments = []
    for seg in raw["results"].get("audio_segments", []):
        segments.append(
            {
                "start_s": float(seg["start_time"]),
                "end_s": float(seg["end_time"]),
                "speaker": seg.get("speaker_label", ""),
                "text": seg["transcript"],
            }
        )
    if not segments and words:
        cur = None
        for w in words:
            if cur and w["start_s"] - cur["end_s"] < 1.5 and w["speaker"] == cur["speaker"]:
                cur["end_s"] = w["end_s"]
                cur["text"] += w["text"]
            else:
                if cur:
                    segments.append(cur)
                cur = dict(start_s=w["start_s"], end_s=w["end_s"], speaker=w["speaker"], text=w["text"])
        if cur:
            segments.append(cur)

    return {"segments": segments, "words": words}


def speech_features(parsed, bin_seconds=5, duration_s=None):
    """Per-bin words-per-second (speech intensity proxy) for the fusion engine."""
    import numpy as np

    words = parsed["words"]
    end = duration_s or (words[-1]["end_s"] if words else 0)
    n_bins = int(end // bin_seconds) + 1
    rate = np.zeros(n_bins)
    for w in words:
        b = int(w["start_s"] // bin_seconds)
        if b < n_bins:
            rate[b] += 1
    return {"t_s": [b * bin_seconds for b in range(n_bins)], "word_rate": rate.tolist()}


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__)
    sub = ap.add_subparsers(dest="cmd", required=True)

    p_start = sub.add_parser("start")
    p_start.add_argument("media_uri")
    p_start.add_argument("--job", required=True)
    p_start.add_argument("--output-bucket", default=None)
    p_start.add_argument("--language", default=LANGUAGE)

    p_wait = sub.add_parser("wait")
    p_wait.add_argument("job")
    p_wait.add_argument("--out", default="out/transcript.json")

    p_status = sub.add_parser("status")
    p_status.add_argument("job")

    args = ap.parse_args(argv)
    if args.cmd == "start":
        start_job(args.media_uri, args.job, args.output_bucket, args.language)
        print("started:", args.job)
    elif args.cmd == "status":
        job = get_job(args.job)
        print(job["TranscriptionJobStatus"], job.get("FailureReason", ""))
    elif args.cmd == "wait":
        job = wait_job(args.job)
        if job["TranscriptionJobStatus"] == "FAILED":
            print("FAILED:", job.get("FailureReason"))
            return 1
        parsed = parse_transcript(fetch_result(job))
        out = Path(args.out)
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(json.dumps(parsed, ensure_ascii=False))
        subs = job.get("Subtitles", {}).get("SubtitleFileUris", [])
        print(f"segments={len(parsed['segments'])} words={len(parsed['words'])} -> {out}")
        for s in subs:
            print("subtitle:", s)


if __name__ == "__main__":
    sys.exit(main())
