"""Job_API: POST /jobs (Task 6.1).

Validates `targets[]` (Property 7 / Req 2.4, 2.5) and that every
`sourceKeys[]` entry was confirmed (Property 9 / Req 4.7); creates the Job
record with pending status, then starts a Pipeline_Orchestrator execution
scoped to the new jobId (Req 4.1, 4.2). If StartExecution fails, marks the
Job failed and returns an error instead of leaving a dangling pending Job
(Req 4.3).
"""
from __future__ import annotations

import json
import os
import uuid
from datetime import datetime, timezone

import boto3

from lambdas.common.auth import AuthError, user_id_from_rest_event
from lambdas.common.ddb import job_table, table
from lambdas.common.responses import error, ok

VALID_TARGETS = {"tiktok", "reels", "shorts"}

_sfn = boto3.client("stepfunctions")


def _confirmed_uploads_table():
    return table("CONFIRMED_UPLOADS_TABLE_NAME")


def _validate_targets(targets) -> str | None:
    if not targets or not isinstance(targets, list):
        return "targets[] is required and must be a non-empty array"
    if not all(isinstance(t, str) and t in VALID_TARGETS for t in targets):
        return f"targets[] must contain only values from {sorted(VALID_TARGETS)}"
    return None


def _unconfirmed_keys(user_id: str, source_keys: list[str]) -> list[str]:
    tbl = _confirmed_uploads_table()
    unconfirmed = []
    for key in source_keys:
        resp = tbl.get_item(Key={"userId": user_id, "key": key})
        if "Item" not in resp:
            unconfirmed.append(key)
    return unconfirmed


def handler(event, context):  # noqa: ARG001
    try:
        user_id = user_id_from_rest_event(event)
    except AuthError as exc:
        return error(401, str(exc))

    try:
        body = json.loads(event.get("body") or "{}")
    except json.JSONDecodeError:
        return error(400, "invalid JSON body")

    targets = body.get("targets")
    targets_error = _validate_targets(targets)
    if targets_error:
        return error(400, targets_error)

    source_keys = body.get("sourceKeys")
    if not source_keys or not isinstance(source_keys, list):
        return error(400, "sourceKeys[] is required and must be a non-empty array")

    unconfirmed = _unconfirmed_keys(user_id, source_keys)
    if unconfirmed:
        return error(
            400,
            "some sourceKeys were not confirmed as uploaded",
            unconfirmedKeys=unconfirmed,
        )

    job_id = str(uuid.uuid4())
    created_at = datetime.now(timezone.utc).isoformat()
    job_item = {
        "jobId": job_id,
        "userId": user_id,
        "status": "pending",
        "targets": targets,
        "sourceKeys": source_keys,
        "createdAt": created_at,
    }
    job_table().put_item(Item=job_item)

    try:
        _sfn.start_execution(
            stateMachineArn=os.environ["STATE_MACHINE_ARN"],
            name=f"job-{job_id}",
            input=json.dumps(
                {"jobId": job_id, "sourceKeys": source_keys, "targets": targets}
            ),
        )
    except Exception as exc:  # noqa: BLE001
        job_table().update_item(
            Key={"jobId": job_id},
            UpdateExpression="SET #s = :failed",
            ExpressionAttributeNames={"#s": "status"},
            ExpressionAttributeValues={":failed": "failed"},
        )
        return error(502, f"failed to start pipeline execution: {exc}")

    return ok({"jobId": job_id, "status": "pending"}, status=201)
