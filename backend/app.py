#!/usr/bin/env python3
"""CDK app entrypoint for the webapp-skeleton backend.

Wires together the storage, API/compute, and hosting stacks that make up
the Live Stream Highlight Generator backend skeleton (see
.kiro/specs/webapp-skeleton/design.md).
"""
import aws_cdk as cdk

from infra.storage.storage_stack import StorageStack
from infra.api.api_stack import ApiStack
from infra.hosting.hosting_stack import HostingStack

app = cdk.App()

env = cdk.Environment(
    account=app.node.try_get_context("account"),
    region=app.node.try_get_context("region"),
)

storage_stack = StorageStack(app, "WebappSkeleton-Storage", env=env)
api_stack = ApiStack(
    app,
    "WebappSkeleton-Api",
    job_table=storage_stack.job_table,
    clip_table=storage_stack.clip_table,
    refinement_table=storage_stack.refinement_table,
    confirmed_selection_table=storage_stack.confirmed_selection_table,
    confirmed_uploads_table=storage_stack.confirmed_uploads_table,
    connection_table=storage_stack.connection_table,
    raw_bucket=storage_stack.raw_bucket,
    env=env,
)
hosting_stack = HostingStack(
    app,
    "WebappSkeleton-Hosting",
    env=env,
)

api_stack.add_dependency(storage_stack)
# HostingStack now owns its own frontend bucket (see hosting_stack.py's
# docstring for why it can't live in StorageStack), so it has no runtime
# dependency on storage_stack.

app.synth()
