# Requirements Document

## Introduction

This spec covers **Performance & ROI Metrics** for the Live Stream Highlight
Generator: computing quantitative performance indicators from data the pipeline
already emits, plus lightweight new per-stage timing capture. It satisfies
hackathon deliverable Req 6 ("quantitative performance indicators") and provides
the commercial-benefit framing that turns detection output into measurable ROI.

The indicators produced are: editing-time-saved percentage, automation level,
throughput (clips per hour), cost per VOD, detection precision (measured against a
small labeled ground-truth set for the demo VODs), an output quality score derived
from virality scores and cross-modal agreement, and clearly-labeled
creator-monetization and content-reuse **projections**.

All metrics derive from four inputs, three of which already exist:

- **Stage timings** — a new, minimal `out/timings.json` captured by a
  non-invasive wrapper around the existing `log()` points in `pipeline/run.py`.
- **The canonical clip contract** (`out/clips/clips.json`, emitted by
  `pipeline/contracts.py`) — per-clip `score`/`virality_score`, `factors{}`, and
  `modalities[]` (cross-modal agreement), the raw material for quality and
  precision.
- **The aggregate batch manifest** (`out/batch_manifest.json` + machine-readable
  Batch_Summary, produced by the separate, build-order-prior batch-processing
  spec) — for batch-level aggregate metrics.
- **Configuration** (`config/metrics.json`) — the editor-minutes-per-clip
  heuristic, the cost model, platform RPM assumptions, and projection
  assumptions, all tunable without redeploy (mirroring `config/weights.json`).

Two consumption surfaces are delivered on top of the aggregated metrics, mirroring
the existing split between the runnable local pipeline and the AWS backend:

- **A local metrics aggregator + gallery surface** — `pipeline/metrics.py` writes
  `out/metrics.json`, and the standalone `pipeline/gallery.py` (the self-contained
  demo HTML gallery, NOT the React app) gains a KPI header strip.
- **A backend metrics endpoint** — `GET /jobs/{jobId}/metrics` (plus optional
  batch metrics), owner-scoped exactly as `highlights_api/list_clips.py` scopes
  clip reads, reusing only the Lambda/DynamoDB/API Gateway services already in the
  stack.

Out of scope: the single-VOD detection/scoring/render algorithm, the batch
orchestration itself, any new AWS service integration, and **all React/frontend
work**. The frontend metrics panel is explicitly deferred (`[QUEUED — frontend]`)
because the frontend is being actively changed by a teammate and must not be
touched here.

Note (adjusted scope): there is **no compliance/safety input** to these metrics —
that earlier plan is shelved. Metrics derive only from timings, the clip contract
(virality scores + cross-modal agreement counts), the batch manifest, and
configuration.

## Glossary

- **Per_VOD_Pipeline**: The existing single-VOD orchestrator invoked via
  `pipeline/run.py`'s `run()` function, which chains the signal, fusion, AI
  Director, and render stages for one `(video, chat-log)` pair.
- **Stage_Timings**: The machine-readable JSON document (`out/timings.json`)
  recording, per Per_VOD_Pipeline stage, a stage name and its start and end
  timestamps, captured by a non-invasive wrapper around the existing `log()`
  points in `pipeline/run.py`.
- **Timing_Recorder**: The minimal helper added to `pipeline/run.py` that records
  each stage's start and end into Stage_Timings without altering stage logic.
- **Clip_Contract**: The canonical per-clip records in `out/clips/clips.json`
  emitted by `pipeline/contracts.py`, each carrying `score`/`virality_score`,
  `factors{}`, and `modalities[]` (the list of signals that agreed at the peak,
  i.e. cross-modal agreement).
- **Batch_Manifest**: The aggregate JSON document (`out/batch_manifest.json`) and
  its machine-readable Batch_Summary produced by the batch-processing spec,
  reporting per-VOD status/timing/clip-count and batch totals (VODs, clips,
  wall-clock, clips/hour).
- **Metrics_Config**: The configuration file `config/metrics.json` holding the
  editor-minutes-per-clip heuristic, the cost model, platform RPM assumptions,
  quality weights, precision matching parameters, and projection assumptions —
  the reference example for the feature's config-over-redeploy convention
  (mirroring `config/weights.json`).
- **Ground_Truth_Fixture**: A committed fixture encoding, per demo VOD, the known
  highlight windows (from `README.md`, e.g. for VOD `6910008`: performer entrance
  27:25, song peak 62:35, joke 45:00, prize 83:45) as labeled `(start, end)`
  windows against which detected clips are scored.
- **Precision_Scorer**: The pure-logic component that scores detected clip windows
  against a Ground_Truth_Fixture, computing precision@k and temporal
  intersection-over-union (IoU) overlap.
- **Metrics_Aggregator**: The local module `pipeline/metrics.py` that reads
  Stage_Timings, the Clip_Contract, the Batch_Manifest, and Metrics_Config and
  writes the Metrics_Document.
- **Metrics_Document**: The machine-readable JSON document (`out/metrics.json`)
  aggregating all computed indicators for a VOD (and, when a Batch_Manifest is
  supplied, batch-level aggregates).
- **Quality_Score**: A single output-quality indicator in the range 0 to 1 derived
  from the Clip_Contract's virality scores and cross-modal agreement counts,
  combined using the weights in Metrics_Config.
- **Monetization_Projection**: A forward-looking creator-revenue estimate derived
  from clip counts and Metrics_Config platform RPM and projection assumptions,
  reported as a projection rather than a measured value.
- **Content_Reuse_Projection**: A forward-looking content-reuse estimate (e.g.
  short-form clips produced per source hour) derived from clip counts, VOD/source
  duration, and Metrics_Config projection assumptions, reported as a projection.
- **Gallery_KPI_Strip**: A KPI header strip (or companion `metrics.html`) added to
  the standalone `pipeline/gallery.py` HTML gallery that renders the
  Metrics_Document's indicators.
- **Metrics_API**: The Lambda-backed REST endpoint(s) behind API Gateway that
  return per-job (and optional per-batch) metrics, owner-scoped.
- **Auth_Service**: The existing Amazon Cognito user pool and API Gateway
  authorizer that authenticates users and authorizes every API request.

## Requirements

### Requirement 1: Metrics Configuration and Schema

**User Story:** As a developer wiring metrics into both the local pipeline and the
backend, I want a single documented configuration file and metrics schema, so that
the aggregator, the gallery, the backend, and the deliverable docs all agree on one
shape and all tunable assumptions live in config rather than code.

#### Acceptance Criteria

1. THE repository SHALL contain a `config/metrics.json` file that defines the
   editor-minutes-per-clip heuristic, a cost model, platform RPM assumptions,
   quality-score weights, precision matching parameters, and projection
   assumptions.
2. THE Metrics_Aggregator SHALL read the editor-minutes-per-clip heuristic, the
   cost model, the platform RPM assumptions, the quality-score weights, the
   precision matching parameters, and the projection assumptions from
   Metrics_Config rather than from hard-coded literals.
3. THE repository SHALL contain, under `docs/contracts/`, a JSON schema for the
   Metrics_Document and an example Metrics_Document instance that validates against
   that schema.
4. THE Metrics_Document SHALL be encoded as JSON.
5. THE `INTEGRATION_CONTRACT.md` document SHALL describe the Metrics_Document
   fields, the `config/metrics.json` fields, and the `GET /jobs/{jobId}/metrics`
   endpoint.

### Requirement 2: Stage-Timing Capture

**User Story:** As a developer computing speed and throughput metrics, I want the
pipeline to persist per-stage timings, so that editing-time-saved, automation
level, and throughput can be computed from measured durations without re-parsing
logs.

#### Acceptance Criteria

1. WHEN the Per_VOD_Pipeline runs a stage, THE Timing_Recorder SHALL record that
   stage's name, start timestamp, and end timestamp into Stage_Timings.
2. THE Timing_Recorder SHALL record each stage's end timestamp as greater than or
   equal to that stage's start timestamp.
3. WHEN the Per_VOD_Pipeline completes, THE Timing_Recorder SHALL write
   Stage_Timings as JSON to a deterministic path (`out/timings.json`) within the
   output directory.
4. THE Timing_Recorder SHALL wrap the existing `pipeline/run.py` logging points
   without modifying the analysis, fusion, Director, or render stage logic.
5. WHERE a stage is skipped because its output already exists, THE Timing_Recorder
   SHALL record that stage with a zero-length duration rather than omitting a
   timestamp field.

### Requirement 3: Ground-Truth Fixture

**User Story:** As a developer measuring detection quality, I want the known
highlight moments of the demo VODs encoded as a committed fixture, so that
detection precision can be computed against a labeled reference.

#### Acceptance Criteria

1. THE repository SHALL contain a Ground_Truth_Fixture that encodes, per demo VOD,
   a set of labeled highlight windows each with a start time and an end time in
   seconds.
2. THE Ground_Truth_Fixture SHALL include the known highlight windows documented in
   `README.md` for VOD `6910008` (performer entrance at 27:25, song performance
   peak at 62:35, joke landing at 45:00, and prize announcement at 83:45).
3. THE Ground_Truth_Fixture SHALL identify each VOD's labeled window set by that
   VOD's stream id.
4. THE Ground_Truth_Fixture SHALL record each labeled window's end time as greater
   than that window's start time.

### Requirement 4: Detection Precision Scoring

**User Story:** As a developer reporting detection quality, I want detected clips
scored against the labeled ground truth, so that I can report a defensible
precision number instead of an anecdote.

#### Acceptance Criteria

1. WHEN the Precision_Scorer scores a set of detected clip windows against a
   Ground_Truth_Fixture window set, THE Precision_Scorer SHALL compute the temporal
   intersection-over-union (IoU) overlap between a detected window and a labeled
   window as the length of their intersection divided by the length of their union.
2. THE Precision_Scorer SHALL treat a detected window as matching a labeled window
   if and only if their temporal IoU overlap is greater than or equal to the
   IoU match threshold from Metrics_Config.
3. WHEN the Precision_Scorer computes precision at k, THE Precision_Scorer SHALL
   compute it as the number of the top-k detected windows (ranked by
   `virality_score` descending) that match at least one labeled window, divided by
   k.
4. THE Precision_Scorer SHALL compute every reported precision and IoU value as a
   number between 0 and 1 inclusive.
5. IF no Ground_Truth_Fixture window set exists for the VOD being scored, THEN THE
   Metrics_Aggregator SHALL omit the detection-precision indicator from the
   Metrics_Document rather than reporting a fabricated value.

### Requirement 5: Metrics Aggregation and Document Schema

**User Story:** As a developer, I want a single command that reads the pipeline's
outputs and configuration and emits one machine-readable metrics document, so that
every indicator is computed in one place with one agreed shape.

#### Acceptance Criteria

1. WHEN the Metrics_Aggregator runs for a VOD, THE Metrics_Aggregator SHALL read
   Stage_Timings, the Clip_Contract, and Metrics_Config as inputs.
2. WHERE a Batch_Manifest path is supplied, THE Metrics_Aggregator SHALL read the
   Batch_Manifest and include batch-level aggregate metrics in the
   Metrics_Document.
3. WHEN the Metrics_Aggregator finishes, THE Metrics_Aggregator SHALL write the
   Metrics_Document as JSON to a deterministic path (`out/metrics.json`) within the
   output directory.
4. THE Metrics_Document SHALL contain the editing-time-saved percentage, the
   automation level, the throughput in clips per hour, the cost per VOD, the output
   quality score, the detection-precision indicator when available, the
   monetization projection, and the content-reuse projection.
5. THE Metrics_Document SHALL identify the VOD it describes by that VOD's stream id.

### Requirement 6: Editing-Time-Saved and Automation Level

**User Story:** As a creator evaluating the tool, I want to see how much editing
time it saves and how automated it is, so that I can quantify the labor benefit.

#### Acceptance Criteria

1. WHEN the Metrics_Aggregator computes the editing-time-saved percentage, THE
   Metrics_Aggregator SHALL compute the manual editing baseline as the produced
   clip count multiplied by the editor-minutes-per-clip heuristic from
   Metrics_Config.
2. WHEN the manual editing baseline is greater than zero, THE Metrics_Aggregator
   SHALL compute the editing-time-saved percentage as the manual editing baseline
   minus the pipeline wall-clock duration, divided by the manual editing baseline,
   expressed as a percentage.
3. IF the manual editing baseline is zero, THEN THE Metrics_Aggregator SHALL report
   the editing-time-saved percentage as zero rather than performing a division by
   zero.
4. WHEN the Metrics_Aggregator computes the automation level, THE Metrics_Aggregator
   SHALL compute it as the number of pipeline-automated stages divided by the total
   number of stages in the end-to-end clip-production workflow, where the automated
   stage count is derived from Stage_Timings and the total-stage count is read from
   Metrics_Config.
5. THE Metrics_Aggregator SHALL report the automation level as a number between 0
   and 1 inclusive.

### Requirement 7: Throughput and Cost Per VOD

**User Story:** As a stakeholder assessing scalability and unit economics, I want
throughput and per-VOD cost, so that I can reason about running the system at
scale.

#### Acceptance Criteria

1. WHEN the Metrics_Aggregator computes throughput, THE Metrics_Aggregator SHALL
   compute clips per hour as the produced clip count divided by the pipeline
   wall-clock duration in hours.
2. IF the pipeline wall-clock duration is zero, THEN THE Metrics_Aggregator SHALL
   report the clips-per-hour throughput as zero rather than performing a division
   by zero.
3. WHEN the Metrics_Aggregator computes cost per VOD, THE Metrics_Aggregator SHALL
   compute it as the sum of the per-VOD cost-model components defined in
   Metrics_Config.
4. THE Metrics_Aggregator SHALL report the cost per VOD in the currency named in
   the Metrics_Config cost model.

### Requirement 8: Output Quality Score

**User Story:** As a creator, I want a single output-quality score summarizing how
strong the detected highlights are, so that I can gauge output quality at a glance.

#### Acceptance Criteria

1. WHEN the Metrics_Aggregator computes the Quality_Score, THE Metrics_Aggregator
   SHALL derive it from the Clip_Contract's per-clip virality scores and per-clip
   cross-modal agreement counts (the number of entries in each clip's
   `modalities[]`), combined using the quality-score weights from Metrics_Config.
2. THE Metrics_Aggregator SHALL report the Quality_Score as a number between 0 and
   1 inclusive.
3. IF the Clip_Contract contains zero clips, THEN THE Metrics_Aggregator SHALL
   report the Quality_Score as zero rather than performing a division by zero.
4. WHEN one clip set's per-clip virality scores and cross-modal agreement counts
   are each greater than or equal to those of a second clip set of the same size
   (pairwise), THE Metrics_Aggregator SHALL compute a Quality_Score for the first
   set that is greater than or equal to the Quality_Score for the second set.

### Requirement 9: Monetization and Content-Reuse Projections

**User Story:** As a creator weighing commercial value, I want projected
monetization and content-reuse figures, so that I can estimate business upside
while understanding these are assumptions, not measurements.

#### Acceptance Criteria

1. WHEN the Metrics_Aggregator computes the Monetization_Projection, THE
   Metrics_Aggregator SHALL derive it from the produced clip count and the platform
   RPM and projection assumptions in Metrics_Config.
2. WHEN the Metrics_Aggregator computes the Content_Reuse_Projection, THE
   Metrics_Aggregator SHALL derive it from the produced clip count, the source
   duration, and the projection assumptions in Metrics_Config.
3. THE Metrics_Aggregator SHALL mark the Monetization_Projection and the
   Content_Reuse_Projection in the Metrics_Document as projections rather than
   measured values.
4. THE Metrics_Document SHALL record, for the Monetization_Projection and the
   Content_Reuse_Projection, the projection assumption values used to compute them.

### Requirement 10: Graceful Degradation on Missing Inputs

**User Story:** As an operator running metrics against a partial pipeline output, I
want missing optional inputs to degrade gracefully, so that a metrics run never
crashes and always reports whatever can be computed.

#### Acceptance Criteria

1. IF Stage_Timings is absent when the Metrics_Aggregator runs, THEN THE
   Metrics_Aggregator SHALL omit the timing-derived indicators (editing-time-saved
   percentage, automation level, and clips-per-hour throughput) from the
   Metrics_Document rather than raising an error.
2. IF no Batch_Manifest path is supplied, THEN THE Metrics_Aggregator SHALL omit the
   batch-level aggregate metrics from the Metrics_Document rather than raising an
   error.
3. WHEN the Metrics_Aggregator omits an indicator because its input is absent, THE
   Metrics_Aggregator SHALL still write a Metrics_Document containing the indicators
   whose inputs are present.

### Requirement 11: Gallery KPI Strip

**User Story:** As a demo presenter, I want the standalone HTML gallery to show the
headline KPIs, so that the performance story is visible alongside the clips without
the React app.

#### Acceptance Criteria

1. WHERE a Metrics_Document is available to `pipeline/gallery.py`, THE
   Gallery_KPI_Strip SHALL render the editing-time-saved percentage, the automation
   level, the clips-per-hour throughput, the cost per VOD, and the output quality
   score.
2. WHEN the Gallery_KPI_Strip renders a value that the Metrics_Document marks as a
   projection, THE Gallery_KPI_Strip SHALL label that value as a projection.
3. THE Gallery_KPI_Strip SHALL be rendered within the self-contained
   `pipeline/gallery.py` HTML output without requiring the React frontend.
4. IF no Metrics_Document is available, THEN `pipeline/gallery.py` SHALL render the
   clip gallery without a Gallery_KPI_Strip rather than raising an error.

### Requirement 12: Backend Metrics Endpoint

**User Story:** As a content creator, I want to retrieve my job's performance
metrics from the backend, so that the metrics are available to a client scoped to
me.

#### Acceptance Criteria

1. THE Metrics_API SHALL require, on every request, a token that is issued by
   Auth_Service, unexpired, and unrevoked, and SHALL treat any request without such
   a token as unauthenticated.
2. IF a request to the Metrics_API has no token, or has a token that is missing,
   expired, revoked, or otherwise fails Auth_Service validation, THEN THE
   Metrics_API SHALL respond with an authorization error and SHALL NOT return any
   metrics.
3. WHEN the Metrics_API receives a request for the metrics of a job identified by
   `jobId` owned by the authenticated requester, THE Metrics_API SHALL return that
   job's metrics.
4. IF a metrics request references a `jobId` that does not exist or whose `userId`
   is not the authenticated requester's identity, THEN THE Metrics_API SHALL respond
   with an authorization/not-found error and SHALL NOT return any metrics for that
   `jobId`.
5. WHERE a batch metrics route is provided, THE Metrics_API SHALL return
   batch-level aggregate metrics only for a batch owned by the authenticated
   requester and SHALL respond with an authorization/not-found error otherwise.

### Requirement 13: Metrics Storage and Permissions

**User Story:** As a developer, I want the metrics endpoint wired with
least-privilege access using only existing infrastructure, so that no new AWS
service is introduced and the metrics handler can only touch what it needs.

#### Acceptance Criteria

1. THE Metrics_API handler SHALL be granted read access to the data it needs to
   derive or return per-job metrics (the Job and Clip data already stored in
   DynamoDB).
2. THE Metrics feature SHALL use only the AWS services already present in the
   backend stack (API Gateway, Lambda, and DynamoDB) and SHALL NOT introduce a new
   AWS service integration.
3. THE Metrics_API route SHALL sit behind the Auth_Service authorizer, consistent
   with the existing read endpoints.

### Requirement 14: Metrics Panel (Deferred — Frontend)

**User Story:** As a content creator, I want an in-app metrics panel visualizing my
job's KPIs, so that I can review performance in the web UI.

#### Acceptance Criteria

1. THE frontend metrics panel work SHALL be deferred and marked `[QUEUED —
   frontend]`, and SHALL NOT be implemented within this spec.

### Requirement 15: Deliverable Documentation and Commercial Framing

**User Story:** As a hackathon reviewer, I want the Req 6 performance indicators
documented against the real numbers the pipeline produces, so that the quantitative
deliverable and its commercial benefit are clearly evidenced.

#### Acceptance Criteria

1. THE documentation SHALL describe each Req 6 performance indicator (editing-time
   saved, automation level, clips per hour, cost per VOD, detection precision,
   output quality score) and SHALL reference the corresponding field in the
   Metrics_Document as the source of each number.
2. THE documentation SHALL present the monetization and content-reuse figures as
   projections and SHALL state the commercial-benefit framing for creators and
   agencies.
