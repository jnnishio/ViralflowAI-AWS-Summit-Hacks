import os
import json
import boto3
from pipeline import fusion

def handler(event, context):
    job_id = event['jobId']
    
    bucket = os.environ['RAW_BUCKET_NAME']
    s3 = boto3.client('s3')
    
    prefix = f"raw/{job_id}"
    chat_key = f"{prefix}/chat_signals.json"
    audio_key = f"{prefix}/audio_signals.json"
    out_key = f"{prefix}/candidates.json"
    
    local_chat = f"/tmp/{job_id}_chat.json"
    local_audio = f"/tmp/{job_id}_audio.json"
    local_out = f"/tmp/{job_id}_candidates.json"
    
    print(f"Downloading signals from s3://{bucket}/{prefix}/...")
    try:
        s3.download_file(bucket, chat_key, local_chat)
        s3.download_file(bucket, audio_key, local_audio)
    except Exception as e:
        print(f"Failed to download signals: {e}")
        # Return dummy candidates if signals fail to download so pipeline proceeds
        dummy = {"candidates": [{"start_s": 0, "end_s": 15}]}
        with open(local_out, 'w') as f:
            json.dump(dummy, f)
        s3.upload_file(local_out, bucket, out_key)
        return {**event, "status": "skipped", "candidates_key": out_key}
        
    print("Running fusion scoring...")
    
    # We call fusion.main with args similar to run.py
    fusion_args = [
        "--chat", local_chat,
        "--audio", local_audio,
        "--chat-offset", "0",
        "--vertical", "talk",
        "--out", local_out
    ]
    fusion.main(fusion_args)
    
    print(f"Uploading to {out_key}")
    s3.upload_file(local_out, bucket, out_key)
    
    return {**event, "status": "success", "candidates_key": out_key}
