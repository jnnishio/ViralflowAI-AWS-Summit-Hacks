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
    # By convention, assume the chat log is either uploaded as chat_log.csv or we mock it if missing
    log_key = f"{prefix}/chat_log.csv"
    out_key = f"{prefix}/chat_signals.json"
    
    local_log = f"/tmp/{job_id}_chat.csv"
    try:
        s3.download_file(bucket, log_key, local_log)
    except Exception as e:
        print(f"Chat log not found at {log_key}, skipping or mocking... {e}")
        # In a real scenario we'd fail or fallback
        # For now, let's just write an empty result to continue the pipeline
        result = {"signal": "chat", "bin_seconds": 5, "series": {"t_s": [], "rate": [], "kappa": []}}
        
        local_out = f"/tmp/{job_id}_chat.json"
        with open(local_out, 'w') as f:
            json.dump(result, f)
        s3.upload_file(local_out, bucket, out_key)
        return {"status": "skipped", "reason": "no chat log"}
        
    result = chat.analyze(local_log)
    
    local_out = f"/tmp/{job_id}_chat.json"
    with open(local_out, 'w') as f:
        json.dump(result, f, ensure_ascii=False, default=lambda o: o.item() if hasattr(o, "item") else str(o))
        
    s3.upload_file(local_out, bucket, out_key)
    
    return {"status": "success", "chat_signals_key": out_key}
