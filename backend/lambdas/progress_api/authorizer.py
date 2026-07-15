"""Progress_API $connect Lambda authorizer (Task 10.1 support).

API Gateway WebSocket APIs have no native Cognito User Pool authorizer
type (unlike REST), so token validation on `$connect` (Req 3.4) is done by
this REQUEST-type Lambda authorizer, wired to the `$connect` route only.
It validates the token the same way REST's Cognito authorizer would --
by asking Cognito to vouch for it -- and denies the connection outright if
that fails, before `$connect`'s own handler ever runs.
"""
from lambdas.common.auth import AuthError, validate_access_token


def _policy(principal_id: str, effect: str, method_arn: str) -> dict:
    return {
        "principalId": principal_id,
        "policyDocument": {
            "Version": "2012-10-17",
            "Statement": [
                {
                    "Action": "execute-api:Invoke",
                    "Effect": effect,
                    "Resource": method_arn,
                }
            ],
        },
    }


def handler(event, context):  # noqa: ARG001
    token = (event.get("queryStringParameters") or {}).get("token")
    method_arn = event["methodArn"]

    try:
        user_id = validate_access_token(token)
    except AuthError:
        # Returning an explicit Deny (rather than raising) surfaces a clean
        # 403 to the client instead of API Gateway's generic 500.
        return _policy("unauthorized", "Deny", method_arn)

    policy = _policy(user_id, "Allow", method_arn)
    policy["context"] = {"userId": user_id}
    return policy
