"""Highlights_API: PATCH /jobs/{jobId}/clips/{clipId} (Task 8.3).

Updates a Clip's `start`/`end` on success and marks it crop-confirmed
(Req 11.5, 11.7); leaves the Clip untouched and returns an error on any
failure below, per the design's Property 27 (write-action error
preservation, Req 11.6).
"""
import json

from lambdas.common.auth import AuthError, user_id_from_rest_event
from lambdas.common.ddb import clip_table
from lambdas.common.ownership import OwnershipError, get_owned_job
from lambdas.common.responses import error, ok


def handler(event, context):  # noqa: ARG001
    try:
        user_id = user_id_from_rest_event(event)
    except AuthError as exc:
        return error(401, str(exc))

    path = event.get("pathParameters") or {}
    job_id = path.get("jobId")
    clip_id = path.get("clipId")
    if not job_id or not clip_id:
        return error(400, "jobId and clipId are required")

    try:
        get_owned_job(job_id, user_id)
    except OwnershipError:
        return error(403, "job not found or not owned by caller")

    try:
        body = json.loads(event.get("body") or "{}")
    except json.JSONDecodeError:
        return error(400, "invalid JSON body")

    start = body.get("start")
    end = body.get("end")
    if not isinstance(start, (int, float)) or not isinstance(end, (int, float)):
        return error(400, "start and end must be numbers")
    if start >= end:
        return error(400, "start must be less than end")

    existing = clip_table().get_item(
        Key={"jobId": job_id, "clipId": clip_id}
    ).get("Item")
    if existing is None:
        return error(404, "clip not found")

    clip_table().update_item(
        Key={"jobId": job_id, "clipId": clip_id},
        UpdateExpression="SET #start = :start, #end = :end, cropConfirmed = :confirmed",
        ExpressionAttributeNames={"#start": "start", "#end": "end"},
        ExpressionAttributeValues={
            ":start": start,
            ":end": end,
            ":confirmed": True,
        },
    )

    updated = {**existing, "start": start, "end": end, "cropConfirmed": True}
    return ok(
        {
            "clipId": updated["clipId"],
            "start": updated["start"],
            "end": updated["end"],
            "cropConfirmed": updated["cropConfirmed"],
        }
    )
