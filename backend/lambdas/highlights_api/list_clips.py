"""Highlights_API: GET /jobs/{jobId}/clips (Task 8.1).

Returns Clips sorted by `score` descending then `clipId` ascending
(Req 7.1, Property 15), with presigned `thumbUrl`/`videoUrl` generated per
Clip from `thumbKey`/`videoKey`, valid for >=5 minutes (Req 7.6, 7.8,
Property 18).
"""
import os

import boto3
from botocore.config import Config

from lambdas.common.auth import AuthError, user_id_from_rest_event
from lambdas.common.ddb import clip_table
from lambdas.common.ownership import OwnershipError, get_owned_job
from lambdas.common.responses import error, ok

PRESIGN_EXPIRES_SECONDS = 5 * 60

_s3 = boto3.client("s3", config=Config(signature_version="s3v4"))


def _presigned_get(bucket: str, key: str) -> str:
    return _s3.generate_presigned_url(
        ClientMethod="get_object",
        Params={"Bucket": bucket, "Key": key},
        ExpiresIn=PRESIGN_EXPIRES_SECONDS,
    )


def _to_wire_shape(clip: dict, bucket: str) -> dict:
    return {
        "clipId": clip["clipId"],
        "start": clip["start"],
        "end": clip["end"],
        "score": clip["score"],
        "factors": clip["factors"],
        "mood": clip["mood"],
        "momentType": clip.get("momentType"),
        "titleNative": clip["titleNative"],
        "titleEnglish": clip["titleEnglish"],
        "caption": clip["caption"],
        "hashtags": clip.get("hashtags", []),
        "thumbUrl": _presigned_get(bucket, clip["thumbKey"]) if clip.get("thumbKey") else None,
        "videoUrl": _presigned_get(bucket, clip["videoKey"]) if clip.get("videoKey") else None,
        "cropConfirmed": clip.get("cropConfirmed", False),
    }


def handler(event, context):  # noqa: ARG001
    try:
        user_id = user_id_from_rest_event(event)
    except AuthError as exc:
        return error(401, str(exc))

    job_id = (event.get("pathParameters") or {}).get("jobId")
    if not job_id:
        return error(400, "jobId is required")

    try:
        get_owned_job(job_id, user_id)
    except OwnershipError:
        return error(403, "job not found or not owned by caller")

    resp = clip_table().query(
        KeyConditionExpression="jobId = :jobId",
        ExpressionAttributeValues={":jobId": job_id},
    )
    clips = resp.get("Items", [])
    clips.sort(key=lambda c: (-float(c["score"]), c["clipId"]))

    bucket = os.environ["RAW_BUCKET_NAME"]
    return ok({"clips": [_to_wire_shape(c, bucket) for c in clips]})
