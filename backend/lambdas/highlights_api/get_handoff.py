"""Highlights_API: GET /handoff/{handoffId} (Task 8.6).

Returns {clips: [{clipId, titleNative, thumbUrl}]} for each confirmed Clip
(Req 15.4). ConfirmedSelection is keyed by (jobId, handoffId), but the
handoffId alone is opaque/unguessable (uuid4) and is treated as the
bearer credential for this stub screen -- consistent with Handoff_Stub
being a placeholder past which no further access control is specified.
A GSI on handoffId lets us look it up without needing the jobId in the URL.
"""
import os

import boto3
from botocore.config import Config

from lambdas.common.ddb import clip_table, confirmed_selection_table
from lambdas.common.responses import error, ok

PRESIGN_EXPIRES_SECONDS = 5 * 60

_s3 = boto3.client("s3", config=Config(signature_version="s3v4"))


def _presigned_get(bucket: str, key: str) -> str:
    return _s3.generate_presigned_url(
        ClientMethod="get_object",
        Params={"Bucket": bucket, "Key": key},
        ExpiresIn=PRESIGN_EXPIRES_SECONDS,
    )


def handler(event, context):  # noqa: ARG001
    handoff_id = (event.get("pathParameters") or {}).get("handoffId")
    if not handoff_id:
        return error(400, "handoffId is required")

    resp = confirmed_selection_table().query(
        IndexName="byHandoffId",
        KeyConditionExpression="handoffId = :h",
        ExpressionAttributeValues={":h": handoff_id},
    )
    items = resp.get("Items", [])
    if not items:
        return error(404, "handoff not found")
    selection = items[0]

    job_id = selection["jobId"]
    clip_ids = selection.get("clipIds", [])
    bucket = os.environ["RAW_BUCKET_NAME"]

    clips = []
    for clip_id in clip_ids:
        item = clip_table().get_item(
            Key={"jobId": job_id, "clipId": clip_id}
        ).get("Item")
        if item is None:
            continue
        clips.append(
            {
                "clipId": item["clipId"],
                "titleNative": item["titleNative"],
                "thumbUrl": _presigned_get(bucket, item["thumbKey"])
                if item.get("thumbKey")
                else None,
            }
        )

    return ok({"clips": clips})
