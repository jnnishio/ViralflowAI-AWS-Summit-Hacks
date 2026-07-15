"""Progress_API: progress push handler (Task 10.4).

Given {jobId, stage, status}, fans the event out via
ApiGatewayManagementApi.postToConnection to every connection subscribed to
that jobId (Req 5.3). Invoked directly (not via an API Gateway route) by
the Analysis_Stage_Stub Lambdas and the Step Functions Catch/terminal
states whenever they need to publish a progress event.

Stale connections (410 Gone -- the client disconnected without a clean
$disconnect) are cleaned up opportunistically rather than treated as
failures, so one dead subscriber can't block delivery to the others.
"""
import json
import os

import boto3

from lambdas.common.ddb import connection_table

_apigw_management = None


def _management_client():
    global _apigw_management
    if _apigw_management is None:
        _apigw_management = boto3.client(
            "apigatewaymanagementapi",
            endpoint_url=os.environ["PROGRESS_WS_MANAGEMENT_ENDPOINT"],
        )
    return _apigw_management


def publish_progress_event(job_id: str, stage: str, status: str) -> None:
    """Publish {jobId, stage, status} to every connection subscribed to
    job_id. status must be one of "started"/"completed"/"failed"
    (Req 5.2, Property 10)."""
    assert status in ("started", "completed", "failed")
    event_payload = json.dumps({"jobId": job_id, "stage": stage, "status": status})

    resp = connection_table().query(
        IndexName="byJobId",
        KeyConditionExpression="jobId = :jobId",
        ExpressionAttributeValues={":jobId": job_id},
    )
    client = _management_client()
    for conn in resp.get("Items", []):
        connection_id = conn["connectionId"]
        try:
            client.post_to_connection(
                ConnectionId=connection_id, Data=event_payload.encode("utf-8")
            )
        except client.exceptions.GoneException:
            connection_table().delete_item(Key={"connectionId": connection_id})


def handler(event, context):  # noqa: ARG001
    """Direct-invoke entrypoint: event = {jobId, stage, status}."""
    publish_progress_event(event["jobId"], event["stage"], event["status"])
    return {"published": True}
