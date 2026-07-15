"""Progress_API: `subscribe` route handler (Task 10.2).

Handles {action: "subscribe", jobId}: uses the shared ownership utility to
verify the connection's userId owns jobId, then stores
{connectionId, jobId} on the connection record (Req 5.3). Rejects the
subscribe request (without erroring the whole connection) if the caller
doesn't own the job, consistent with the ownership-scoping property used
by every other API (Req 16.3, 16.4).
"""
import json

from lambdas.common.ddb import connection_table
from lambdas.common.ownership import OwnershipError, get_owned_job


def handler(event, context):  # noqa: ARG001
    connection_id = event["requestContext"]["connectionId"]

    try:
        body = json.loads(event.get("body") or "{}")
    except json.JSONDecodeError:
        return {"statusCode": 400, "body": "invalid JSON body"}

    job_id = body.get("jobId")
    if not job_id:
        return {"statusCode": 400, "body": "jobId is required"}

    conn = connection_table().get_item(
        Key={"connectionId": connection_id}
    ).get("Item")
    user_id = conn.get("userId") if conn else None

    try:
        get_owned_job(job_id, user_id)
    except OwnershipError:
        return {"statusCode": 403, "body": "job not found or not owned by caller"}

    connection_table().update_item(
        Key={"connectionId": connection_id},
        UpdateExpression="SET jobId = :jobId",
        ExpressionAttributeValues={":jobId": job_id},
    )

    return {"statusCode": 200}
