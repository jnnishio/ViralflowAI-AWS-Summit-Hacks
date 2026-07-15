"""Sanity check that the CDK app's stacks synthesize without error.

Exercises the real cross-stack wiring (ApiStack/HostingStack consume
StorageStack's tables/buckets), matching how app.py constructs them.
"""
import os

import aws_cdk as cdk

from infra.api.api_stack import ApiStack
from infra.hosting.hosting_stack import HostingStack
from infra.storage.storage_stack import StorageStack

# ApiStack Docker-bundles the pipeline_stages Lambdas (they pip-install
# pipeline/requirements.txt via a `docker run -v <outdir>:/asset-output`
# bind mount). cdk.App()'s default outdir is a system temp dir, which
# Docker Desktop for Mac doesn't share by default -- the container's
# non-root user then gets "Permission denied" writing into /asset-output.
# Pointing outdir at a path under the repo keeps it inside Docker's
# already-shared project directory, matching what `cdk synth` does.
_TEST_OUTDIR = os.path.join(os.path.dirname(__file__), "..", "cdk.out.pytest")


def test_storage_stack_synthesizes():
    app = cdk.App(outdir=_TEST_OUTDIR)
    stack = StorageStack(app, "TestStorageStack")
    app.synth()
    assert stack is not None


def test_api_stack_synthesizes():
    app = cdk.App(outdir=_TEST_OUTDIR)
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
    app = cdk.App(outdir=_TEST_OUTDIR)
    stack = HostingStack(app, "TestHostingStack")
    app.synth()
    assert stack is not None
