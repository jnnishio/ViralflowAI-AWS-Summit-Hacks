"""Highlights_API: POST /jobs/{jobId}/confirm-selection (Task 8.6).

Persists a ConfirmedSelection scoped to jobId and the selected Clip
identifiers, and returns a handoffId (Req 15.3; Property 29).
"""
import json
import uuid
from datetime import datetime, timezone

from lambdas.common.auth import AuthError, user_id_from_rest_event
from lambdas.common.ddb import confirmed_selection_table
from lambdas.common.ownership import OwnershipError, get_owned_job
from lambdas.common.responses import error, ok


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

    try:
        body = json.loads(event.get("body") or "{}")
    except json.JSONDecodeError:
        return error(400, "invalid JSON body")

    clip_ids = body.get("clipIds")
    if not clip_ids or not isinstance(clip_ids, list):
        return error(400, "clipIds[] is required and must be non-empty")

    handoff_id = str(uuid.uuid4())
    confirmed_selection_table().put_item(
        Item={
            "jobId": job_id,
            "handoffId": handoff_id,
            "clipIds": clip_ids,
            "createdAt": datetime.now(timezone.utc).isoformat(),
        }
    )

    return ok({"handoffId": handoff_id}, status=201)
