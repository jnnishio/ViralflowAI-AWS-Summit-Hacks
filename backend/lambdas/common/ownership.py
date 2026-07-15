"""Shared ownership-scoping utility (Task 3.4).

Used by Job_API, Highlights_API, and the Progress_API `subscribe` handler:
given a caller's `userId` and a `jobId`, loads the Job and returns it only
if `Job.userId == userId`; otherwise raises OwnershipError so callers can
map it to a uniform 403/404 response.

Validates: Requirements 3.2, 4.5, 4.6, 7.2, 16.3, 16.4, 16.6, 16.7
"""
from lambdas.common import ddb


class OwnershipError(Exception):
    """Raised when a jobId does not exist or is not owned by the caller.

    Deliberately doesn't distinguish "not found" from "not yours" in the
    exception itself -- callers should always render this as a generic
    403/404 so a Job's existence isn't leaked to non-owners.
    """


def get_owned_job(job_id: str, user_id: str) -> dict:
    resp = ddb.job_table().get_item(Key={"jobId": job_id})
    job = resp.get("Item")
    if job is None or job.get("userId") != user_id:
        raise OwnershipError(f"job {job_id!r} not found for caller")
    return job
