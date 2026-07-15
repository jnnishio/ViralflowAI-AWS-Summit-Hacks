"""Sanity check that the CDK app's stacks synthesize without error.

Exercises the real cross-stack wiring (ApiStack/HostingStack consume
StorageStack's tables/buckets), matching how app.py constructs them.
"""
import aws_cdk as cdk

from infra.api.api_stack import ApiStack
from infra.hosting.hosting_stack import HostingStack
from infra.storage.storage_stack import StorageStack


def test_storage_stack_synthesizes():
    app = cdk.App()
    stack = StorageStack(app, "TestStorageStack")
    app.synth()
    assert stack is not None


def test_api_stack_synthesizes():
    app = cdk.App()
    storage = StorageStack(app, "TestStorageStackForApi")
    stack = ApiStack(
        app,
        "TestApiStack",
        job_table=storage.job_table,
        clip_table=storage.clip_table,
        refinement_table=storage.refinement_table,
        confirmed_selection_table=storage.confirmed_selection_table,
        confirmed_uploads_table=storage.confirmed_uploads_table,
        connection_table=storage.connection_table,
        raw_bucket=storage.raw_bucket,
    )
    app.synth()
    assert stack is not None


def test_hosting_stack_synthesizes():
    app = cdk.App()
    stack = HostingStack(app, "TestHostingStack")
    app.synth()
    assert stack is not None
