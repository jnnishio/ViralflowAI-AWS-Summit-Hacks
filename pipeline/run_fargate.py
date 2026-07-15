import os
import sys
import json
import subprocess
import boto3
from pathlib import Path

def main():
    s3 = boto3.client('s3')
    bucket = os.environ['RAW_BUCKET_NAME']
    job_id = os.environ['JOB_ID']
    
    # Paths according to INTEGRATION_CONTRACT.md
    prefix = f"raw/{job_id}"
    video_key = f"{prefix}/video.mp4"
    highlights_key = f"{prefix}/highlights.json"
    transcript_key = f"{prefix}/transcript.json"
    visual_key = f"{prefix}/visual_signals.json"
    
    workdir = Path("/tmp/work")
    workdir.mkdir(parents=True, exist_ok=True)
    
    video_path = workdir / "video.mp4"
    highlights_path = workdir / "highlights.json"
    transcript_path = workdir / "transcript.json"
    visual_path = workdir / "visual_signals.json"
    outdir = workdir / "clips"
    
    print(f"Downloading inputs from s3://{bucket}/{prefix}/...")
    s3.download_file(bucket, video_key, str(video_path))
    s3.download_file(bucket, highlights_key, str(highlights_path))
    
    # Transcript and visual might be optional depending on the pipeline, but we try to download
    try:
        s3.download_file(bucket, transcript_key, str(transcript_path))
        has_transcript = True
    except Exception as e:
        print(f"Transcript not found or error: {e}")
        has_transcript = False
        
    try:
        s3.download_file(bucket, visual_key, str(visual_path))
        has_visual = True
    except Exception as e:
        print(f"Visual signals not found or error: {e}")
        has_visual = False

    cmd = [
        "python3", "-m", "pipeline.render", str(highlights_path),
        "--video", str(video_path),
        "--outdir", str(outdir)
    ]
    if has_transcript:
        cmd.extend(["--transcript", str(transcript_path)])
    if has_visual:
        cmd.extend(["--visual", str(visual_path)])
        
    print(f"Running render engine: {' '.join(cmd)}")
    subprocess.run(cmd, check=True)
    
    # Upload results back to S3
    print(f"Uploading clips to s3://{bucket}/{prefix}/clips/...")
    for clip_file in outdir.glob("*"):
        if clip_file.is_file():
            s3_key = f"{prefix}/clips/{clip_file.name}"
            print(f"  -> {s3_key}")
            s3.upload_file(str(clip_file), bucket, s3_key)
            
    print("Fargate render task completed successfully.")

if __name__ == "__main__":
    main()
