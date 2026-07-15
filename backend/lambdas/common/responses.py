"""Shared API Gateway REST response helpers.

Keeps every Upload_API/Job_API/Highlights_API handler returning the same
JSON + CORS shape (design.md's Backend API surfaces section).
"""
import json
from decimal import Decimal
from typing import Any


class _DecimalEncoder(json.JSONEncoder):
    def default(self, o):
        if isinstance(o, Decimal):
            return float(o)
        return super().default(o)


def _headers() -> dict:
    return {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
    }


def ok(body: Any, status: int = 200) -> dict:
    return {
        "statusCode": status,
        "headers": _headers(),
        "body": json.dumps(body, cls=_DecimalEncoder, ensure_ascii=False),
    }


def error(status: int, message: str, **extra) -> dict:
    payload = {"error": message}
    payload.update(extra)
    return {
        "statusCode": status,
        "headers": _headers(),
        "body": json.dumps(payload, cls=_DecimalEncoder, ensure_ascii=False),
    }
