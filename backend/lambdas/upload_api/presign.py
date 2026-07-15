"""Upload_API: POST /uploads/presign (Task 5.1).

Verifies the caller via the REST API's Cognito authorizer (already
enforced at the API Gateway level -- Req 3.2), then issues a presigned S3
PUT URL scoped to a single `raw/{userId}/{jobDraftId}/{uuid}-{filename}`
key with a 15-minute expiry (Req 1.3).

Validates: Property 1 (Presigned upload URL scoping) -- Requirements 1.3
"""
import json
import os
import uuid

import boto3
from botocore.config import Config

from lambdas.common.auth import AuthError, user_id_from_rest_event
from lambdas.common.responses import error, ok

PRESIGN_EXPIRES_SECONDS = 15 * 60

_s3 = boto3.client("s3", config=Config(signature_version="s3v4"))


def _raw_key(user_id: str, job_draft_id: str, filename: str) -> str:
    return f"raw/{user_id}/{job_draft_id}/{uuid.uuid4()}-{filename}"


def handler(event, context):  # noqa: ARG001
    try:
        user_id = user_id_from_rest_event(event)
    except AuthError as exc:
        return error(401, str(exc))

    try:
        body = json.loads(event.get("body") or "{}")
    except json.JSONDecodeError:
        return error(400, "invalid JSON body")

    filename = body.get("filename")
    if not filename or not isinstance(filename, str):
        return error(400, "filename is required")

    job_draft_id = body.get("jobDraftId") or str(uuid.uuid4())
    bucket = os.environ["RAW_BUCKET_NAME"]
    key = _raw_key(user_id, job_draft_id, filename)

    upload_url = _s3.generate_presigned_url(
        ClientMethod="put_object",
        Params={"Bucket": bucket, "Key": key},
        ExpiresIn=PRESIGN_EXPIRES_SECONDS,
        HttpMethod="PUT",
    )

    return ok(
        {
            "uploadUrl": upload_url,
            "key": key,
            "jobDraftId": job_draft_id,
            "expiresIn": PRESIGN_EXPIRES_SECONDS,
        }
    )
