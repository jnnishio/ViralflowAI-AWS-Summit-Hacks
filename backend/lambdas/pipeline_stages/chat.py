import os
import json
import boto3
from pipeline.signals import chat

def handler(event, context):
    job_id = event.get('jobId')
    if not job_id:
        raise ValueError("Missing jobId")
        
    bucket = os.environ['RAW_BUCKET_NAME']
    s3 = boto3.client('s3')
    
    prefix = f"raw/{job_id}"
    out_key = f"{prefix}/chat_signals.json"
    
    # Find the CSV file in sourceKeys
    source_keys = event.get('sourceKeys', [])
    log_key = next((k for k in source_keys if k.endswith('.csv')), None)
    
    if not log_key:
        print("No .csv file found in sourceKeys, skipping or mocking...")
        result = {"signal": "chat", "bin_seconds": 5, "series": {"t_s": [], "rate": [], "kappa": []}}
        
        local_out = f"/tmp/{job_id}_chat.json"
        with open(local_out, 'w') as f:
            json.dump(result, f)
        s3.upload_file(local_out, bucket, out_key)
        return {"status": "skipped", "reason": "no chat log"}
        
    local_log = f"/tmp/{job_id}_chat.csv"
    try:
        s3.download_file(bucket, log_key, local_log)
    except Exception as e:
        print(f"Failed to download chat log: {e}")
        return {"status": "failed", "reason": str(e)}
        
    result = chat.analyze(local_log)
    
    local_out = f"/tmp/{job_id}_chat.json"
    with open(local_out, 'w') as f:
        json.dump(result, f, ensure_ascii=False, default=lambda o: o.item() if hasattr(o, "item") else str(o))
        
    s3.upload_file(local_out, bucket, out_key)
    
    return {"status": "success", "chat_signals_key": out_key}
