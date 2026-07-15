"""Upload_API: POST /uploads/confirm (Task 5.3).

HEADs the object in Raw_Bucket to verify it exists before marking the key
confirmed. Confirmed keys are recorded in a lightweight per-user "confirmed
uploads" item so Job_API can validate `sourceKeys[]` at job-creation time
(Req 4.7) without re-touching S3.
"""
import json
import os

import boto3
from botocore.exceptions import ClientError

from lambdas.common.auth import AuthError, user_id_from_rest_event
from lambdas.common.ddb import table
from lambdas.common.responses import error, ok

_s3 = boto3.client("s3")


def _confirmed_uploads_table():
    return table("CONFIRMED_UPLOADS_TABLE_NAME")


def handler(event, context):  # noqa: ARG001
    try:
        user_id = user_id_from_rest_event(event)
    except AuthError as exc:
        return error(401, str(exc))

    try:
        body = json.loads(event.get("body") or "{}")
    except json.JSONDecodeError:
        return error(400, "invalid JSON body")

    key = body.get("key")
    if not key or not isinstance(key, str):
        return error(400, "key is required")

    # Keys are scoped raw/{userId}/... at presign time; refuse to confirm a
    # key issued to a different caller.
    if not key.startswith(f"raw/{user_id}/"):
        return error(403, "key does not belong to caller")

    bucket = os.environ["RAW_BUCKET_NAME"]
    try:
        _s3.head_object(Bucket=bucket, Key=key)
    except ClientError as exc:
        code = exc.response.get("Error", {}).get("Code")
        if code in ("404", "NoSuchKey", "NotFound"):
            return error(404, f"object not found for key: {key}")
        raise

    _confirmed_uploads_table().put_item(
        Item={"userId": user_id, "key": key}
    )

    return ok({"confirmed": True})
