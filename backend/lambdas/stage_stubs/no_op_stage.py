"""No-op Analysis_Stage_Stub Lambda (Task 11.2).

One handler backs all five no-op stub stages (NormalizeProxyStub,
TranscriptStub, VisualAnalysisStub, AudioAnalysisStub, ChatAnalysisStub):
publish a "started" progress event, do no real media-analysis AWS service
call, publish a "completed" progress event, and pass the Job state through
unchanged for the next Step Functions state (Req 5.2, 6.1, 6.2).

The stage name is injected per Task state via the Lambda's `STAGE_NAME`
environment variable rather than baked into the handler, so the same
deployed Lambda backs all five stages without code duplication -- the ASL
state names still match architecture.md's stage list exactly (Req 6.1).
"""
import os

from lambdas.progress_api.push import publish_progress_event


def handler(event, context):  # noqa: ARG001
    job_id = event["jobId"]
    stage = os.environ["STAGE_NAME"]

    publish_progress_event(job_id, stage, "started")
    # Intentionally no real MediaConvert/Transcribe/Rekognition/Bedrock call.
    publish_progress_event(job_id, stage, "completed")

    return event
