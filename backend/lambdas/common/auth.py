"""Auth helpers shared by REST handlers and the Progress_API Lambda authorizer.

REST routes sit behind API Gateway's native Cognito User Pool authorizer
(Req 3.2, 3.3), which verifies the token's signature/expiry itself and
injects the verified claims into the request context before the handler
ever runs -- so REST handlers only need to *read* `sub` from those claims.

The WebSocket API has no native Cognito authorizer type, so Progress_API
uses a small Lambda authorizer (see lambdas/progress_api/authorizer.py)
that validates the token by calling Cognito's GetUser API: Cognito itself
rejects the call if the access token is missing, malformed, expired, or
revoked (Req 3.4), which is exactly the validation Auth_Service is
responsible for.
"""
import os

import boto3

_cognito = boto3.client("cognito-idp")


class AuthError(Exception):
    """Raised when a request's caller identity cannot be established."""


def user_id_from_rest_event(event: dict) -> str:
    """Extract the Cognito `sub` claim injected by the REST API's Cognito
    authorizer. Raises AuthError if absent (should not happen once the
    authorizer is attached, but keeps handlers safe under direct/test
    invocation)."""
    claims = (
        event.get("requestContext", {})
        .get("authorizer", {})
        .get("claims", {})
    )
    sub = claims.get("sub")
    if not sub:
        raise AuthError("missing authenticated user claims")
    return sub


def validate_access_token(access_token: str) -> str:
    """Validate a Cognito access token via GetUser and return the caller's
    `username` (== sub for the default attribute mapping). Raises AuthError
    if the token is missing/invalid/expired/revoked."""
    if not access_token:
        raise AuthError("missing token")
    try:
        resp = _cognito.get_user(AccessToken=access_token)
    except Exception as exc:  # noqa: BLE001 - any Cognito failure => unauth
        raise AuthError(f"invalid token: {exc}") from exc
    for attr in resp.get("UserAttributes", []):
        if attr["Name"] == "sub":
            return attr["Value"]
    return resp["Username"]


def user_pool_id() -> str:
    return os.environ["USER_POOL_ID"]
