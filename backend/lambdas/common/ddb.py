"""DynamoDB table handle helpers.

Table names are injected as Lambda environment variables by the CDK stack
(infra/api/api_stack.py) rather than hardcoded, so the same handler code
works across stacks/stages.
"""
import os

import boto3

_resource = boto3.resource("dynamodb")


def table(env_var: str):
    return _resource.Table(os.environ[env_var])


def job_table():
    return table("JOB_TABLE_NAME")


def clip_table():
    return table("CLIP_TABLE_NAME")


def refinement_table():
    return table("REFINEMENT_TABLE_NAME")


def confirmed_selection_table():
    return table("CONFIRMED_SELECTION_TABLE_NAME")


def connection_table():
    return table("CONNECTION_TABLE_NAME")
