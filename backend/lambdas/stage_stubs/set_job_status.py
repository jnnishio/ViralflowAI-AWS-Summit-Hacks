"""Helper Lambda backing SetJobInProgress / SetJobCompleted / SetJobFailed
states (Task 11.8 support).

Each of the three states invokes this same handler with a different
STATUS env var, updates the Job's `status` in DynamoDB, and -- for
SetJobFailed -- publishes a "failed" progress event so Frontend_App shows
the processing-error state instead of navigating to Highlights_Grid
(Req 5.8).
"""
import os

from lambdas.common.ddb import job_table
from lambdas.progress_api.push import publish_progress_event


def handler(event, context):  # noqa: ARG001
    job_id = event["jobId"]
    status = os.environ["STATUS"]

    job_table().update_item(
        Key={"jobId": job_id},
        UpdateExpression="SET #s = :status",
        ExpressionAttributeNames={"#s": "status"},
        ExpressionAttributeValues={":status": status},
    )

    if status == "failed":
        # error info attached by the ASL Catch is under event["error"]; the
        # stage that failed isn't always resolvable here, so publish under
        # a synthetic "pipeline" stage name.
        publish_progress_event(job_id, "pipeline", "failed")
    elif status == "completed":
        publish_progress_event(job_id, "pipeline", "completed")

    return event
