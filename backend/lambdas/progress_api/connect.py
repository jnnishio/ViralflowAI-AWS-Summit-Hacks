"""Progress_API: $connect route handler (Task 10.1).

By the time this handler runs, the $connect Lambda authorizer
(authorizer.py) has already validated the token (Req 3.4); this handler
just records {connectionId, userId} so `subscribe` can later verify
ownership of a jobId for this connection.
"""
from lambdas.common.ddb import connection_table


def handler(event, context):  # noqa: ARG001
    request_context = event["requestContext"]
    connection_id = request_context["connectionId"]
    user_id = request_context.get("authorizer", {}).get("userId")

    connection_table().put_item(
        Item={"connectionId": connection_id, "userId": user_id}
    )

    return {"statusCode": 200}
