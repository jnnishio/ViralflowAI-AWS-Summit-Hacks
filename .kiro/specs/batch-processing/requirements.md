# Requirements Document

## Introduction

This spec covers **batch processing** for the Live Stream Highlight Generator: the
ability to process multiple VODs in a single request instead of one VOD at a time.
It satisfies hackathon deliverable Req 4 ("batch processing capabilities") and makes
the Req 5 scalability story demonstrable using the two ready VOD+log pairs already in
the repo's `data/` directory (`6910008`, `3654414`).

Two surfaces are delivered, mirroring the existing split between the runnable local
pipeline and the AWS backend:

- **A local batch orchestrator CLI** (`pipeline/batch.py`) that discovers `(video,
  chat-log)` pairs, runs the existing per-VOD pipeline (`pipeline/run.py`'s `run()`)
  over each pair with a bounded worker pool, and aggregates a machine-readable
  `out/batch_manifest.json`. This is the demoable increment for a two-VOD run.
- **A backend fan-out API** that, at the API layer, creates N `Job` records and starts
  N existing `Pipeline_Orchestrator` executions under one `Batch` record — the
  lowest-risk way to demonstrate parallelism without restructuring the per-job state
  machine.

The single-VOD detection/scoring/render algorithm, the per-job `Pipeline_Orchestrator`
state machine's internal stages, and all React/frontend work are **out of scope** here.
The frontend batch dashboard is explicitly deferred (`[QUEUED — frontend]`) because the
frontend is being actively changed by a teammate and must not be touched in this spec.
An optional Step Functions distributed-`Map` fan-out variant is specified behind a flag
purely as a stronger scalability story for the Req 5 architecture narrative; it must
not replace the working per-execution path.

This feature's aggregate batch manifest is a build-order dependency for a separate
Metrics spec, so its summary output must be machine-readable.

## Glossary

- **Per_VOD_Pipeline**: The existing single-VOD orchestrator invoked via
  `pipeline/run.py`'s `run()` function, which chains chat/audio/transcript/visual
  signal stages through fusion, the AI Director, and render for one `(video,
  chat-log)` pair. It is resumable and idempotent: it skips any stage whose output
  already exists in its output directory.
- **Batch_Orchestrator**: The local CLI module `pipeline/batch.py` that discovers
  multiple `(video, chat-log)` pairs, runs the Per_VOD_Pipeline over each with a
  bounded Worker_Pool, and aggregates a Batch_Manifest.
- **Batch_Target**: One `(video, chat-log)` input pair to be processed within a batch,
  identified by a stable target identifier (the stream id derived from the file stem,
  e.g. `6910008`).
- **Worker_Pool**: The bounded set of concurrent workers, of a configurable maximum
  size, that the Batch_Orchestrator uses to run multiple Per_VOD_Pipeline invocations
  in parallel.
- **Batch_Manifest**: The machine-readable JSON document (`out/batch_manifest.json`)
  aggregating, per Batch_Target, its target identifier, terminal processing status,
  wall-clock timing, and produced clip count, plus batch-level totals.
- **Batch_Summary**: The machine-readable rollup derived from the Batch_Manifest
  reporting the number of VODs processed, total clips produced, total wall-clock
  duration, and throughput expressed as clips per hour; consumed by the separate
  Metrics spec.
- **Job**: The existing DynamoDB record representing one upload-to-highlights request,
  with attributes `jobId, userId, status, targets[], sourceKeys[], createdAt` (defined
  in the webapp-skeleton spec).
- **Batch**: A DynamoDB record representing one batch request, with attributes
  `batchId, userId, jobIds[], status, createdAt, aggregate{jobs, clipsTotal, ...}`,
  where `aggregate` holds rolled-up child-Job counts.
- **Batch_API**: The Lambda-backed REST endpoint(s) behind API Gateway that create a
  Batch (starting N child Pipeline_Orchestrator executions) and report Batch status.
- **Pipeline_Orchestrator**: The existing per-job Step Functions state machine that
  sequences the analysis stages for a single Job (defined in the webapp-skeleton spec).
- **Auth_Service**: The existing Amazon Cognito user pool and API Gateway authorizer
  that authenticates users and authorizes every API request.
- **Batch_Map_Variant**: An optional, flag-gated Step Functions distributed-`Map`
  state machine that wraps the Per_VOD_Pipeline per Batch_Target as a stronger
  scalability demonstration, provided in addition to (never as a replacement for) the
  per-execution fan-out path.
- **Weights_Config**: The existing `config/weights.json` scoring-weight configuration,
  the reference example for the feature's config-over-redeploy convention (concurrency
  limits and batch defaults are read from configuration, not hard-coded).

## Requirements

### Requirement 1: Batch Manifest Schema and Batch Record

**User Story:** As a developer wiring batch processing into both the local pipeline and
the backend, I want a single documented schema for the Batch record and Batch_Manifest,
so that the CLI, the backend, and the downstream Metrics spec all agree on one shape.

#### Acceptance Criteria

1. THE Batch record SHALL contain exactly the attributes `batchId`, `userId`,
   `jobIds[]`, `status`, `createdAt`, and `aggregate`.
2. THE Batch record `status` attribute SHALL hold exactly one of the values `pending`,
   `in_progress`, `completed`, or `failed`.
3. THE Batch record `aggregate` attribute SHALL contain at minimum a `jobs` count equal
   to the length of `jobIds[]` and a `clipsTotal` count equal to the sum of clip counts
   across the batch's child Jobs.
4. THE Batch_Manifest SHALL contain, for each Batch_Target, a target identifier, a
   terminal status of exactly one of `completed` or `failed`, a wall-clock duration in
   seconds, and a produced clip count.
5. THE Batch_Manifest SHALL contain batch-level totals for the number of targets
   processed, the total produced clip count, and the total wall-clock duration in
   seconds.
6. THE Batch_Manifest SHALL be encoded as JSON.
7. THE repository SHALL contain, under `docs/contracts/`, a JSON schema for the
   Batch_Manifest and an example Batch_Manifest instance that validates against that
   schema.
8. THE `INTEGRATION_CONTRACT.md` document SHALL describe the Batch record attributes and
   the `POST /batches` and `GET /batches/{batchId}` endpoints.

### Requirement 2: Batch Target Discovery

**User Story:** As an operator running a batch demo, I want the Batch_Orchestrator to
discover the VOD+log pairs to process, so that I can point it at the `data/` directory
and have it find the ready pairs without listing each file by hand.

#### Acceptance Criteria

1. WHEN the Batch_Orchestrator is given a directory path, THE Batch_Orchestrator SHALL
   discover every `(video, chat-log)` pair in that directory whose video file and
   chat-log file share the same stream-id stem.
2. WHEN the Batch_Orchestrator is given an explicit manifest of input pairs, THE
   Batch_Orchestrator SHALL use exactly the pairs listed in that manifest as the set of
   Batch_Targets.
3. IF a video file has no chat-log file sharing its stream-id stem, THEN THE
   Batch_Orchestrator SHALL exclude that video from the set of Batch_Targets and SHALL
   record the excluded stream id in its output.
4. WHEN the Batch_Orchestrator derives a target identifier for a Batch_Target, THE
   Batch_Orchestrator SHALL derive it from the video file's stream-id stem.
5. IF discovery yields zero Batch_Targets, THEN THE Batch_Orchestrator SHALL return an
   error indicating that no input pairs were found and SHALL NOT start any
   Per_VOD_Pipeline invocation.

### Requirement 3: Bounded Parallel Batch Execution

**User Story:** As an operator, I want the batch to run several VODs concurrently up to a
configured limit, so that a multi-VOD demo finishes faster while staying within resource
limits.

#### Acceptance Criteria

1. WHEN the Batch_Orchestrator processes a set of Batch_Targets, THE Batch_Orchestrator
   SHALL run each target through the Per_VOD_Pipeline.
2. WHILE processing a set of Batch_Targets, THE Batch_Orchestrator SHALL run no more than
   the configured maximum number of Per_VOD_Pipeline invocations concurrently.
3. WHERE the maximum concurrency is not supplied on the command line, THE
   Batch_Orchestrator SHALL read the maximum concurrency value from configuration rather
   than a hard-coded literal.
4. IF the configured maximum concurrency is less than 1, THEN THE Batch_Orchestrator
   SHALL return an error indicating an invalid concurrency value and SHALL NOT start any
   Per_VOD_Pipeline invocation.
5. WHEN the Batch_Orchestrator has processed every Batch_Target, THE Batch_Orchestrator
   SHALL record a terminal status of `completed` or `failed` for each Batch_Target in the
   Batch_Manifest.

### Requirement 4: Resumable and Idempotent Batch Runs

**User Story:** As an operator, I want re-running a batch to skip work that already
succeeded, so that an interrupted demo run can be resumed without recomputing finished
VODs.

#### Acceptance Criteria

1. WHEN the Batch_Orchestrator runs a Batch_Target whose Per_VOD_Pipeline outputs already
   exist, THE Batch_Orchestrator SHALL rely on the Per_VOD_Pipeline's stage-skipping
   behavior rather than deleting or overwriting those existing outputs.
2. WHEN the Batch_Orchestrator is re-run over the same set of Batch_Targets with the same
   output location, THE Batch_Orchestrator SHALL produce a Batch_Manifest with the same
   set of target identifiers as the prior run.
3. WHEN the Batch_Orchestrator completes a run, THE Batch_Orchestrator SHALL write the
   Batch_Manifest to a deterministic path within the output location.

### Requirement 5: Failure Isolation Across Targets

**User Story:** As an operator, I want one VOD failing not to abort the whole batch, so
that a single bad input doesn't waste the processing already done on the others.

#### Acceptance Criteria

1. IF the Per_VOD_Pipeline raises an error for one Batch_Target, THEN THE
   Batch_Orchestrator SHALL record that Batch_Target's status as `failed` and SHALL
   continue processing the remaining Batch_Targets.
2. WHEN a Batch_Target fails, THE Batch_Orchestrator SHALL record a failure reason for
   that Batch_Target in the Batch_Manifest.
3. IF at least one Batch_Target completes successfully while one or more others fail, THEN
   THE Batch_Orchestrator SHALL still write a Batch_Manifest covering every Batch_Target.
4. WHEN every Batch_Target has been attempted, THE Batch_Orchestrator SHALL report a
   batch-level exit status that is successful if and only if at least one Batch_Target
   completed successfully.

### Requirement 6: Aggregate Batch Manifest

**User Story:** As a developer, I want the batch run to emit one aggregated manifest, so
that per-job results are collected in a single machine-readable file.

#### Acceptance Criteria

1. WHEN the Batch_Orchestrator finishes processing all Batch_Targets, THE
   Batch_Orchestrator SHALL write a Batch_Manifest aggregating one entry per Batch_Target.
2. THE Batch_Orchestrator SHALL set each Batch_Manifest entry's produced clip count to the
   number of clips produced by that Batch_Target's Per_VOD_Pipeline run.
3. THE Batch_Orchestrator SHALL set the Batch_Manifest's total produced clip count to the
   sum of the per-target produced clip counts.
4. THE Batch_Orchestrator SHALL set the Batch_Manifest's total wall-clock duration to the
   elapsed wall-clock time from the start of the first Batch_Target to the completion of
   the last Batch_Target.

### Requirement 7: Backend Batch Creation Endpoint

**User Story:** As a content creator, I want to submit several source files as one batch,
so that they are all processed together under a single batch I can track.

#### Acceptance Criteria

1. WHEN the Batch_API receives a batch-create request, THE Batch_API SHALL verify the
   request is authorized by Auth_Service before creating any Job or Batch record.
2. WHEN the Batch_API receives a valid batch-create request listing N sets of target
   platforms and source keys, THE Batch_API SHALL create N Job records, one per listed
   set.
3. WHEN the Batch_API creates the N Job records, THE Batch_API SHALL start one
   Pipeline_Orchestrator execution per created Job.
4. WHEN the Batch_API has created the N Job records and started their executions, THE
   Batch_API SHALL persist one Batch record whose `jobIds[]` attribute lists exactly the
   N created Job identifiers.
5. IF a batch-create request has a `targets[]` value for any listed set that is missing,
   empty, or contains any value other than `"tiktok"`, `"reels"`, or `"shorts"`, THEN THE
   Batch_API SHALL reject the request without creating any Job or Batch record and SHALL
   return an error response indicating the target platforms are invalid.
6. IF a batch-create request references any source key that was never confirmed as
   uploaded, THEN THE Batch_API SHALL reject the request without creating any Job or Batch
   record and SHALL return an error naming the unconfirmed source keys.
7. IF a batch-create request lists zero target sets, THEN THE Batch_API SHALL reject the
   request without creating any Job or Batch record and SHALL return an error indicating
   at least one target set is required.
8. IF the Batch_API fails to start a Pipeline_Orchestrator execution for any created Job,
   THEN THE Batch_API SHALL set the Batch record's `status` to a failed value and SHALL
   return an error to the caller indicating the batch could not be fully started.

### Requirement 8: Backend Batch Status Endpoint

**User Story:** As a content creator, I want to see the aggregated status of a batch, so
that I know how many of my VODs have finished and how many clips were produced.

#### Acceptance Criteria

1. WHEN the Batch_API receives a request for the status of a Batch identified by
   `batchId` owned by the authenticated requester, THE Batch_API SHALL return that Batch's
   `status`, its child Job statuses, and an aggregated clip count across its child Jobs.
2. WHEN the Batch_API aggregates child Job statuses for a Batch, THE Batch_API SHALL report
   the Batch `status` as `completed` if and only if every child Job has reached a
   completed status.
3. WHEN the Batch_API aggregates child Job statuses for a Batch and at least one child Job
   has a failed status while none are still pending or in progress, THE Batch_API SHALL
   report the Batch `status` as `failed`.
4. WHILE at least one child Job of a Batch has a pending or in-progress status, THE
   Batch_API SHALL report the Batch `status` as `in_progress`.

### Requirement 9: Batch Ownership and Authorization

**User Story:** As a product owner, I want every batch call authenticated and scoped to
its owner, so that one user cannot read or affect another user's batches or jobs.

#### Acceptance Criteria

1. THE Batch_API SHALL require, on every request, a token that is issued by Auth_Service,
   unexpired, and unrevoked, and SHALL treat any request without such a token as
   unauthenticated.
2. IF a request to the Batch_API has no token, or has a token that is missing, expired,
   revoked, or otherwise fails Auth_Service validation, THEN THE Batch_API SHALL respond
   with an authorization error and SHALL NOT perform the requested operation.
3. WHEN the Batch_API creates a Batch record, THE Batch_API SHALL set the Batch record's
   `userId` attribute to the authenticated requester's identity derived from the
   Auth_Service claims.
4. WHEN the Batch_API creates the child Jobs for a Batch, THE Batch_API SHALL set each
   child Job's `userId` attribute to the authenticated requester's identity derived from
   the Auth_Service claims.
5. IF a batch-status request references a `batchId` that does not exist or whose `userId`
   is not the authenticated requester's identity, THEN THE Batch_API SHALL respond with an
   authorization error and SHALL NOT return any status information for that `batchId`.

### Requirement 10: Batch Storage and Permissions

**User Story:** As a developer, I want the Batch record persisted with least-privilege
access, so that batch state survives across requests and the batch Lambdas can only touch
what they need.

#### Acceptance Criteria

1. THE storage layer SHALL define a Batch DynamoDB table with `batchId` as its partition
   key.
2. THE Batch_API create handler SHALL be granted read and write access to the Batch table.
3. THE Batch_API status handler SHALL be granted read access to the Batch table.
4. THE Batch_API create handler SHALL be granted permission to start Pipeline_Orchestrator
   executions.
5. THE Batch_API SHALL persist Batch records in the Batch DynamoDB table.
6. THE Batch feature SHALL use only the AWS services already present in the backend stack
   (Step Functions, DynamoDB, Lambda) and SHALL NOT introduce a new AWS service
   integration.

### Requirement 11: Machine-Readable Batch Summary

**User Story:** As a developer building the downstream Metrics spec, I want the batch run
to emit a machine-readable summary of throughput, so that metrics can be computed from the
batch output without re-parsing logs.

#### Acceptance Criteria

1. WHEN the Batch_Orchestrator finishes a run, THE Batch_Orchestrator SHALL produce a
   Batch_Summary reporting the number of VODs processed, the total produced clip count, the
   total wall-clock duration in seconds, and a throughput value expressed as clips per
   hour.
2. THE Batch_Orchestrator SHALL derive the Batch_Summary values from the Batch_Manifest.
3. THE Batch_Orchestrator SHALL emit the Batch_Summary in a machine-readable format.
4. IF the total wall-clock duration is zero, THEN THE Batch_Orchestrator SHALL report the
   clips-per-hour throughput as zero rather than performing a division by zero.

### Requirement 12: Optional Distributed-Map Fan-Out Variant

**User Story:** As a developer presenting the scalability story, I want an optional
distributed-`Map` fan-out variant behind a flag, so that I can show a stronger parallelism
architecture without disturbing the working per-execution path.

#### Acceptance Criteria

1. WHERE the distributed-`Map` variant is enabled by its flag, THE Batch_Map_Variant SHALL
   process each Batch_Target through the Per_VOD_Pipeline as a mapped iteration.
2. WHERE the distributed-`Map` variant flag is not enabled, THE backend SHALL start one
   Pipeline_Orchestrator execution per child Job as described in Requirement 7.
3. THE Batch_Map_Variant SHALL be defined in addition to the per-execution fan-out path and
   SHALL NOT remove or replace the per-execution fan-out path.
4. THE Batch_Map_Variant SHALL use only the AWS services already present in the backend
   stack (Step Functions, DynamoDB, Lambda).

### Requirement 13: Batch Dashboard (Deferred — Frontend)

**User Story:** As a content creator, I want a dashboard showing my batch's job list and
aggregate KPIs, so that I can monitor a multi-VOD run visually.

#### Acceptance Criteria

1. THE batch dashboard frontend work SHALL be deferred and marked `[QUEUED — frontend]`,
   and SHALL NOT be implemented within this spec.

### Requirement 14: Batch Capability and Scalability Documentation

**User Story:** As a hackathon reviewer, I want documented batch capability and scalability
narratives, so that Req 4 and Req 5 are clearly evidenced.

#### Acceptance Criteria

1. THE documentation SHALL contain a batch-capability section describing how the
   Batch_Orchestrator and Batch_API satisfy deliverable Req 4, evidenced by the two-VOD
   run over `6910008` and `3654414`.
2. THE documentation SHALL contain a fan-out scalability narrative describing how the
   per-execution fan-out and the optional Batch_Map_Variant satisfy deliverable Req 5.
