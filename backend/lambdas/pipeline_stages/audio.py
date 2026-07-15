import os
import json
import boto3
import urllib.parse
from pipeline.signals import audio

def handler(event, context):
    job_id = event['jobId']
    source_keys = event['sourceKeys']
    
    bucket = os.environ['RAW_BUCKET_NAME']
    s3 = boto3.client('s3')
    
    # We assume the first source key is the video
    video_key = source_keys[0]
    local_video = f"/tmp/{os.path.basename(video_key)}"
    
    print(f"Downloading {video_key} to {local_video}")
    s3.download_file(bucket, video_key, local_video)
    
    print("Running audio analysis...")
    result = audio.analyze(local_video)
    
    out_key = f"raw/{job_id}/audio_signals.json"
    local_out = f"/tmp/{job_id}_audio.json"
    
    with open(local_out, 'w') as f:
        json.dump(result, f, ensure_ascii=False)
        
    print(f"Uploading to {out_key}")
    s3.upload_file(local_out, bucket, out_key)
    
    return {**event, "status": "success", "audio_signals_key": out_key}
