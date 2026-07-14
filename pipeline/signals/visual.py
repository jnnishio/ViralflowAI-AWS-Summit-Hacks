"""Visual signal: Rekognition Video jobs (shot segments + faces/emotions).

Rekognition Video reads the VOD straight from S3 (async jobs). We use:
  - SegmentDetection (SHOT): scene-change density feeds fusion; shot boundaries
    also give clean clip cut points later.
  - FaceDetection: per-timestamp emotions (SURPRISED/HAPPY spikes) + face
    bounding boxes reused by the render stage for 9:16 smart-crop.

Full-video text OCR is skipped on cost grounds; Bedrock multimodal keyframe
checks near candidate peaks cover that need in director.py.

Usage:
  python3 -m pipeline.signals.visual start s3://bucket/video.mp4
  python3 -m pipeline.signals.visual wait --faces <job> --shots <job> --out out/visual_signals.json
"""

import argparse
import json
import sys
import time
from pathlib import Path

import numpy as np

import boto3

REGION = "us-east-1"
BIN_SECONDS = 5


def _rek():
    return boto3.client("rekognition", region_name=REGION)


def start_jobs(s3_uri):
    bucket, key = s3_uri[5:].split("/", 1)
    video = {"S3Object": {"Bucket": bucket, "Name": key}}
    rek = _rek()
    shots = rek.start_segment_detection(
        Video=video,
        SegmentTypes=["SHOT"],
        Filters={"ShotFilter": {"MinSegmentConfidence": 60.0}},
    )["JobId"]
    faces = rek.start_face_detection(Video=video, FaceAttributes="ALL")["JobId"]
    return {"shots": shots, "faces": faces}


def _drain(fetch_page):
    """Collect all pages of a Rekognition Get* API."""
    token, out = None, []
    while True:
        resp = fetch_page(token)
        status = resp["JobStatus"]
        if status == "IN_PROGRESS":
            return status, None
        if status == "FAILED":
            return status, resp.get("StatusMessage")
        out.append(resp)
        token = resp.get("NextToken")
        if not token:
            return status, out


def get_shots(job_id):
    rek = _rek()
    return _drain(lambda tok: rek.get_segment_detection(JobId=job_id, **({"NextToken": tok} if tok else {})))


def get_faces(job_id):
    rek = _rek()
    return _drain(lambda tok: rek.get_face_detection(JobId=job_id, **({"NextToken": tok} if tok else {})))


def parse_results(shot_pages, face_pages, bin_seconds=BIN_SECONDS):
    shots = []
    for page in shot_pages:
        for seg in page.get("Segments", []):
            shots.append(
                {
                    "start_s": seg["StartTimestampMillis"] / 1000,
                    "end_s": seg["EndTimestampMillis"] / 1000,
                    "confidence": round(seg["ShotSegment"]["Confidence"], 1),
                }
            )

    faces = []  # sparse samples: timestamp, box, strongest emotion
    for page in face_pages:
        for f in page.get("Faces", []):
            det = f["Face"]
            emotions = {e["Type"]: e["Confidence"] for e in det.get("Emotions", [])}
            top = max(emotions, key=emotions.get) if emotions else ""
            faces.append(
                {
                    "t_s": f["Timestamp"] / 1000,
                    "box": {k: round(v, 4) for k, v in det["BoundingBox"].items()},
                    "emotion": top,
                    "emotion_conf": round(emotions.get(top, 0.0), 1),
                    "smile": round(det.get("Smile", {}).get("Confidence", 0.0), 1)
                    if det.get("Smile", {}).get("Value")
                    else 0.0,
                }
            )

    duration = max(
        [s["end_s"] for s in shots] + [f["t_s"] for f in faces] + [0]
    )
    n_bins = int(duration // bin_seconds) + 1
    scene_change = np.zeros(n_bins)
    for s in shots:
        b = int(s["start_s"] // bin_seconds)
        if b < n_bins:
            scene_change[b] += 1
    emotion_hot = np.zeros(n_bins)
    for f in faces:
        if f["emotion"] in ("SURPRISED", "HAPPY") and f["emotion_conf"] > 70:
            b = int(f["t_s"] // bin_seconds)
            if b < n_bins:
                emotion_hot[b] += 1

    return {
        "signal": "visual",
        "bin_seconds": bin_seconds,
        "series": {
            "t_s": [b * bin_seconds for b in range(n_bins)],
            "scene_change": scene_change.tolist(),
            "emotion_hot": emotion_hot.tolist(),
        },
        "shots": shots,
        "faces": faces,
    }


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__)
    sub = ap.add_subparsers(dest="cmd", required=True)

    p_start = sub.add_parser("start")
    p_start.add_argument("s3_uri")

    p_wait = sub.add_parser("wait")
    p_wait.add_argument("--shots", required=True)
    p_wait.add_argument("--faces", required=True)
    p_wait.add_argument("--out", default="out/visual_signals.json")
    p_wait.add_argument("--poll", type=int, default=30)

    args = ap.parse_args(argv)
    if args.cmd == "start":
        jobs = start_jobs(args.s3_uri)
        print(json.dumps(jobs))
        return

    while True:
        s_status, shot_pages = get_shots(args.shots)
        f_status, face_pages = get_faces(args.faces)
        if s_status == "FAILED" or f_status == "FAILED":
            print("FAILED:", shot_pages if s_status == "FAILED" else face_pages)
            return 1
        if s_status == "SUCCEEDED" and f_status == "SUCCEEDED":
            break
        print(f"shots={s_status} faces={f_status} ...")
        time.sleep(args.poll)

    result = parse_results(shot_pages, face_pages)
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(result))
    print(f"shots={len(result['shots'])} face_samples={len(result['faces'])} -> {out}")


if __name__ == "__main__":
    sys.exit(main())
