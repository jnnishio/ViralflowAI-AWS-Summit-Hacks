"""Highlights_API: POST /jobs/{jobId}/refinements (Task 8.4).

Creates a Refinement record from a quick-action chip selection or freeform
text, with `targetIds` set to the submitted selection and `status =
"pending"` (Req 13.3, 13.4, 14.2; Property 26).
"""
import json
import uuid
from datetime import datetime, timezone

from lambdas.common.auth import AuthError, user_id_from_rest_event
from lambdas.common.ddb import refinement_table
from lambdas.common.ownership import OwnershipError, get_owned_job
from lambdas.common.responses import error, ok

VALID_CHIP_TYPES = {"reorder", "faster_pacing", "swap_intro", "more_reactions"}
MAX_FREEFORM_LENGTH = 1000


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

    target_type = body.get("targetType")
    target_ids = body.get("targetIds")
    action_type = body.get("actionType")

    if target_type not in ("clip", "group"):
        return error(400, "targetType must be 'clip' or 'group'")
    if not target_ids or not isinstance(target_ids, list):
        return error(400, "targetIds[] is required and must be non-empty")
    if action_type not in ("chip", "freeform"):
        return error(400, "actionType must be 'chip' or 'freeform'")

    chip_type = None
    text = None
    if action_type == "chip":
        chip_type = body.get("chipType")
        if chip_type not in VALID_CHIP_TYPES:
            return error(400, f"chipType must be one of {sorted(VALID_CHIP_TYPES)}")
    else:
        text = body.get("text")
        if not isinstance(text, str) or not text.strip():
            return error(400, "text must be non-empty and not whitespace-only")
        if len(text) > MAX_FREEFORM_LENGTH:
            return error(400, f"text must be at most {MAX_FREEFORM_LENGTH} characters")

    refinement_id = str(uuid.uuid4())
    item = {
        "jobId": job_id,
        "refinementId": refinement_id,
        "targetType": target_type,
        "targetIds": target_ids,
        "actionType": action_type,
        "chipType": chip_type,
        "text": text,
        "status": "pending",
        "createdAt": datetime.now(timezone.utc).isoformat(),
    }
    refinement_table().put_item(Item=item)

    return ok(item, status=201)
