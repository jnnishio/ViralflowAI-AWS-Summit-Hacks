"""Job_API: GET /jobs/{jobId} (Task 6.4).

Uses the shared ownership utility so a jobId not owned by (or non-existent
for) the caller yields a uniform 403 rather than leaking existence
(Req 4.5, 4.6, 16.6, 16.7).
"""
from lambdas.common.auth import AuthError, user_id_from_rest_event
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
        job = get_owned_job(job_id, user_id)
    except OwnershipError:
        return error(403, "job not found or not owned by caller")

    return ok(
        {
            "jobId": job["jobId"],
            "status": job["status"],
            "targets": job.get("targets", []),
            "createdAt": job.get("createdAt"),
        }
    )
