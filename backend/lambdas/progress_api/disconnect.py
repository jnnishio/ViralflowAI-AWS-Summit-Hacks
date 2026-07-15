"""Progress_API: $disconnect route handler (Task 10.3).

Removes the connection record for a closed/expired connection (Req 3.5).
"""
from lambdas.common.ddb import connection_table


def handler(event, context):  # noqa: ARG001
    connection_id = event["requestContext"]["connectionId"]
    connection_table().delete_item(Key={"connectionId": connection_id})
    return {"statusCode": 200}
