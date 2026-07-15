# Implementation Plan: Webapp Skeleton

## Overview

This plan implements the end-to-end skeleton described in `design.md`: an AWS CDK
(Python) backend — Cognito auth, S3/DynamoDB storage, Upload/Job/Highlights REST
APIs, a WebSocket Progress API, and a Step Functions pipeline of 7
`Analysis_Stage_Stub` Lambdas producing placeholder `Clip` records — plus a React
+ TypeScript frontend covering upload, platform selection, processing progress,
and the Highlights Grid (Gallery/Grid view modes, sort, score details,
multi-select, crop/confirm, compilation mode, quick-action chips, freeform
prompt, and confirm/handoff).

**Languages/tooling** (per design's Testing Strategy and Tech Stack):
- Backend: Python (CDK app + Lambda handlers), pytest + Hypothesis for tests.
- Frontend: TypeScript + React, vitest + fast-check for tests.
- IaC: AWS CDK (Python), one app with a storage stack, an API/compute stack, and
  a frontend-hosting stack.

Backend and frontend workstreams are largely independent (frontend consumes the
API contracts already fixed in `design.md` and unit/property tests mock
DynamoDB/S3/Step Functions/network calls per the Testing Strategy), so they are
sequenced to allow parallel execution — see the Task Dependency Graph.

## Tasks

- [x] 1. Set up backend and frontend project structure
  - [x] 1.1 Set up backend CDK project structure
    - Create `backend/` with CDK app entrypoint (`app.py`), stack module layout
      (`infra/storage/`, `infra/api/`, `infra/hosting/`), `lambdas/` package
      layout, `requirements.txt` (aws-cdk-lib, boto3), and pytest + Hypothesis
      dev dependencies/config
    - _Requirements: 16.1_
  - [x] 1.2 Set up frontend project structure
    - Create `frontend/` React + TypeScript SPA scaffold (build tooling,
      routing library, `src/` layout for screens/components/state/api), and
      vitest + fast-check dev dependencies/config
    - _Requirements: 17.1_
  - [x] 1.3 Create fixed mood configuration
    - Create `config/moods.json` with a fixed list of at least 2 mood values
      (e.g. "emotional", "hype", "wholesome", ...) for `CategorizationStub` to
      draw from
    - _Requirements: 6.4_

- [x] 2. Implement storage CDK constructs
  - [x] 2.1 Define DynamoDB tables
    - CDK construct for `Job` (PK `jobId`), `Clip` (PK `jobId`, SK `clipId`),
      `Refinement` (PK `jobId`, SK `refinementId`), `ConfirmedSelection`
      (PK `jobId`, SK `handoffId`) tables matching the Data Models section
    - _Requirements: 16.1_
  - [x] 2.2 Define S3 buckets
    - CDK construct for `Raw_Bucket` (`raw/` prefix usage) and the frontend
      static-asset bucket, both with all public access and public bucket
      policies blocked
    - _Requirements: 3.6, 17.1_
  - [ ]* 2.3 Write unit tests for storage stack synthesis
    - Assert on the synthesized CloudFormation template that both buckets
      block public access and that all four tables exist with correct keys
    - _Requirements: 3.6, 16.1_

- [x] 3. Implement auth, API Gateway skeleton, and shared ownership utility
  - [x] 3.1 Define Cognito User Pool and App Client
    - CDK construct for the Cognito user pool backing `Auth_Service`
    - _Requirements: 3.1_
  - [x] 3.2 Define REST API Gateway with Cognito authorizer
    - CDK construct for the REST API used by Upload_API, Job_API,
      Highlights_API, with a Cognito authorizer attached at the API level so
      every route requires a valid, unexpired, unrevoked token
    - _Requirements: 3.2, 3.3_
  - [x] 3.3 Define WebSocket API Gateway with Cognito authorizer
    - CDK construct for the WebSocket API (`$connect`, `$disconnect`,
      `subscribe` routes) with token validation on `$connect`
    - _Requirements: 3.4, 3.5_
  - [x] 3.4 Implement shared ownership-scoping utility
    - Python module used by Job_API, Highlights_API, and the Progress_API
      `subscribe` handler: given a Cognito claims-derived `userId` and a
      `jobId`, loads the Job and returns it only if `Job.userId == userId`,
      else raises an authorization/not-found error
    - _Requirements: 3.2, 4.5, 4.6, 7.2, 16.3, 16.4, 16.6, 16.7_
  - [ ]* 3.5 Write property test for ownership-scoping utility
    - **Property 8: Cross-API ownership scoping**
    - **Validates: Requirements 4.5, 4.6, 7.2, 16.3, 16.4, 16.6, 16.7**
  - [ ]* 3.6 Write unit tests for authorizer wiring
    - 1-2 examples per REST route and the WebSocket `$connect` route confirming
      the Cognito authorizer is attached and unauthenticated/expired/revoked
      tokens are rejected
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5_

- [x] 4. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 5. Implement Upload_API
  - [x] 5.1 Implement presign handler
    - `POST /uploads/presign` handler: verifies Auth_Service token (via API
      Gateway authorizer), generates a presigned PUT URL scoped to a single
      `raw/{userId}/{jobDraftId}/{uuid}-{filename}` key with a 15-minute expiry
    - _Requirements: 1.1, 1.2, 1.3_
  - [ ]* 5.2 Write property test for presign handler
    - **Property 1: Presigned upload URL scoping**
    - **Validates: Requirements 1.3**
  - [x] 5.3 Implement confirm handler
    - `POST /uploads/confirm` handler: HEADs the object in `Raw_Bucket` to
      verify existence before marking the key confirmed (backs Req 4.7's
      unconfirmed-source check)
    - _Requirements: 4.7_
  - [ ]* 5.4 Write unit tests for confirm handler
    - Cover confirmed-exists, missing-object, and unauthorized-caller cases
    - _Requirements: 4.7_

- [x] 6. Implement Job_API
  - [x] 6.1 Implement create-job handler
    - `POST /jobs` handler: validates `targets[]` is present, non-empty, and
      contains only `"tiktok"`/`"reels"`/`"shorts"`; validates every
      `sourceKeys[]` entry was confirmed; creates the `Job` record with
      pending status; calls `StartExecution` on Pipeline_Orchestrator; on
      `StartExecution` failure sets `Job.status = "failed"` and returns an error
    - _Requirements: 2.3, 2.5, 4.1, 4.2, 4.3, 4.7_
  - [ ]* 6.2 Write property test for target platform validation
    - **Property 7: Target platform validation gate**
    - **Validates: Requirements 2.4, 2.5**
  - [ ]* 6.3 Write property test for unconfirmed source rejection
    - **Property 9: Unconfirmed source rejection**
    - **Validates: Requirements 4.7**
  - [x] 6.4 Implement get-job-status handler
    - `GET /jobs/{jobId}` handler using the shared ownership utility; returns
      404/403 for a `jobId` not owned by the caller
    - _Requirements: 4.5, 4.6, 16.6, 16.7_
  - [ ]* 6.5 Write unit tests for get-job-status handler
    - Cover found/owned, not-found, and owned-by-another-user cases
    - _Requirements: 4.5, 4.6, 16.6, 16.7_

- [x] 7. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 8. Implement Highlights_API
  - [x] 8.1 Implement list-clips handler
    - `GET /jobs/{jobId}/clips` handler using the shared ownership utility;
      returns Clips sorted by `score` descending then `clipId` ascending, with
      presigned `thumbUrl`/`videoUrl` generated per Clip from `thumbKey`/`videoKey`
    - _Requirements: 7.1, 7.2, 7.6, 7.8_
  - [ ]* 8.2 Write property test for presigned media URL generation
    - **Property 18: Presigned media URL generation**
    - **Validates: Requirements 7.6, 7.8**
  - [x] 8.3 Implement crop-confirm handler
    - `PATCH /jobs/{jobId}/clips/{clipId}` handler: updates `start`/`end` on
      success; leaves the Clip untouched and returns an error on failure
    - _Requirements: 11.5_
  - [x] 8.4 Implement refinements handler
    - `POST /jobs/{jobId}/refinements` handler: creates a `Refinement` record
      from a chip selection or freeform text, with `targetIds` set to the
      submitted selection and `status = "pending"`
    - _Requirements: 13.3, 13.4, 14.2_
  - [ ]* 8.5 Write property test for refinement request creation mapping
    - **Property 26: Refinement request creation mapping**
    - **Validates: Requirements 13.3, 13.4, 14.2, 14.5**
  - [x] 8.6 Implement confirm-selection and handoff handlers
    - `POST /jobs/{jobId}/confirm-selection` handler: persists a
      `ConfirmedSelection` scoped to `jobId` and the selected Clip identifiers,
      returns a `handoffId`; `GET /handoff/{handoffId}` handler returns
      `{clipId, titleNative, thumbUrl}` per confirmed Clip
    - _Requirements: 15.3, 15.4_
  - [ ]* 8.7 Write property test for confirm-selection round trip
    - **Property 29: Confirm-selection round trip**
    - **Validates: Requirements 15.3, 15.4**
  - [ ]* 8.8 Write unit tests for Highlights_API error paths
    - Cover not-owned/not-found `jobId`, crop-confirm API failure, and
      refinement-creation failure responses
    - _Requirements: 7.2, 11.6, 13.6, 14.6, 16.3, 16.4_

- [x] 9. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 10. Implement Progress_API WebSocket handlers
  - [x] 10.1 Implement $connect handler
    - Validates the Cognito token and stores `{connectionId, userId}`
    - _Requirements: 3.4_
  - [x] 10.2 Implement subscribe handler
    - Handles `{action: "subscribe", jobId}`: uses the shared ownership
      utility to verify the connection's `userId` owns `jobId`, then stores
      `{connectionId, jobId}`
    - _Requirements: 5.3_
  - [x] 10.3 Implement $disconnect handler
    - Removes the connection record for a closed/expired connection
    - _Requirements: 3.5_
  - [x] 10.4 Implement progress push handler
    - Given `{jobId, stage, status}`, fans the event out via
      `ApiGatewayManagementApi.postToConnection` to all connections subscribed
      to that `jobId`, within the 1-second budget of Req 5.3
    - _Requirements: 5.3_
  - [ ]* 10.5 Write unit tests for Progress_API handlers
    - Cover connect-reject-on-invalid-token, subscribe-reject-on-not-owned,
      disconnect cleanup, and push fan-out to only matching subscribers
    - _Requirements: 3.4, 3.5, 5.3_

- [x] 11. Implement Analysis_Stage_Stub Lambdas and Pipeline_Orchestrator
  - [x] 11.1 Implement deterministic seeded PRNG utility
    - Pure function `seed = hash(jobId + sorted(sourceKeys) + sorted(targets))`
      and a seeded PRNG built from it, shared by all stub Lambdas that need
      randomized-but-deterministic output
    - _Requirements: 6.6, 6.8_
  - [x] 11.2 Implement no-op stub stages and progress-event publishing
    - `NormalizeProxyStub`, `TranscriptStub`, `VisualAnalysisStub`,
      `AudioAnalysisStub`, `ChatAnalysisStub`: each publishes a
      `{jobId, stage, status: "started"}` event, does no real media-analysis
      AWS service call, then publishes `{jobId, stage, status: "completed"}`
      via the Progress_API push handler (Task 10.4)
    - _Requirements: 5.2, 6.1, 6.2_
  - [ ]* 11.3 Write property test for progress event schema validity
    - **Property 10: Progress event schema validity**
    - **Validates: Requirements 5.2**
  - [x] 11.4 Implement FusionScoringStub Lambda
    - Draws `clipCount` in [3, 10] from the seeded PRNG; for each Clip
      generates non-overlapping `start`/`end`, `score` in [0, 100],
      `factors{chat, audio, visual, speech}` each in [-100, 100],
      `titleNative`/`titleEnglish` (non-empty, <=100 chars), `caption`
      (non-empty, <=500 chars), `hashtags[]` (1-10 entries, each <=30 chars),
      and `videoKey`, all derived from the seeded PRNG
    - _Requirements: 6.3, 6.7_
  - [ ]* 11.5 Write property test for stub Clip generation invariants
    - **Property 13: Stub Clip generation invariants**
    - **Validates: Requirements 6.3, 6.4, 6.5, 6.7, 6.9**
  - [x] 11.6 Implement CategorizationStub Lambda
    - Assigns each Clip a `mood` from `config/moods.json` via the seeded PRNG
      and a `momentType` from a fixed placeholder-phrase list; if `clipCount
      >= 2` and only one distinct `mood` was picked, force-reassigns one Clip
      to a different configured mood
    - _Requirements: 6.4, 6.5_
  - [ ]* 11.7 Write property test for stub determinism across re-runs
    - **Property 14: Stub determinism across re-runs**
    - **Validates: Requirements 6.6, 6.8**
  - [x] 11.8 Define Step Functions state machine
    - CDK construct: `SetJobInProgress` -> 7 stub stages in the
      `architecture.md` order -> `SetJobCompleted`; ASL `Catch` on every stub
      stage routes to `SetJobFailed`, which sets `Job.status = "failed"` and
      publishes a `"failed"` progress event
    - _Requirements: 4.4, 5.6, 6.1_
  - [ ]* 11.9 Write property test for stage-failure terminal state
    - **Property 12: Stage failure yields terminal failed state**
    - **Validates: Requirements 5.8**
  - [ ]* 11.10 Write unit test for Step Functions state order
    - Snapshot/definition assertion that the synthesized state machine's
      states match the 7 stub stages plus success/failure terminal states
    - _Requirements: 6.1_

- [x] 12. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 13. Wire backend CDK stack
  - [x] 13.1 Wire REST routes to Lambda handlers
    - Attach Upload_API, Job_API, Highlights_API Lambda handlers to their REST
      routes behind the Cognito authorizer
    - _Requirements: 3.2, 3.3_
  - [x] 13.2 Wire WebSocket routes to Lambda handlers
    - Attach `$connect`/`$disconnect`/`subscribe` handlers to the WebSocket API
    - _Requirements: 3.4, 3.5_
  - [x] 13.3 Grant IAM permissions
    - S3 presign/HEAD permissions for Upload_API/Highlights_API, DynamoDB
      read/write permissions per handler, `states:StartExecution` for Job_API,
      `execute-api:ManageConnections` for the progress push handler
    - _Requirements: 4.2, 16.1_
  - [ ]* 13.4 Write unit tests for full backend stack synthesis
    - CDK synth assertions confirming all routes exist and are wired to the
      expected Lambda handlers with the expected IAM permissions
    - _Requirements: 3.2, 3.3, 3.4, 3.5, 4.2_

- [x] 14. Implement CloudFront and S3 static hosting
  - [x] 14.1 Configure frontend static asset bucket access
    - Confirm the frontend bucket (Task 2.2) blocks all public access; add an
      Origin Access Control so only CloudFront can read it
    - _Requirements: 17.1, 17.2_
  - [x] 14.2 Configure CloudFront distribution
    - HTTPS-only viewer protocol policy; custom error responses mapping
      403/404 to `index.html` with a 200 status for SPA client-side routing
    - _Requirements: 17.3, 17.4_
  - [ ]* 14.3 Write unit tests for hosting stack synthesis
    - CDK synth assertions for HTTPS-only policy, SPA custom error responses,
      and denial of direct S3-origin access
    - _Requirements: 17.2, 17.3, 17.4_

- [x] 15. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 16. Set up frontend shared types and API client
  - [x] 16.1 Scaffold frontend routing and build config
    - App entrypoint, client-side router with routes for Upload,
      PlatformSelect, Processing, HighlightsGrid, HandoffStub screens
    - _Requirements: 17.1_
  - [x] 16.2 Define shared TypeScript types
    - `Job`, `Clip`, `Refinement`, `ConfirmedSelection` wire-shape types and
      the `GridState` type from the design's Data Models / Components section
    - _Requirements: 16.2_
  - [x] 16.3 Implement auth token wiring
    - Attach the Auth_Service (Cognito) token to every REST request header and
      to the WebSocket connection URL/first message
    - _Requirements: 3.1, 3.2, 3.4_
  - [x] 16.4 Implement API client modules
    - Typed client functions for Upload_API, Job_API, Highlights_API
      endpoints, and a Progress_API WebSocket client with connect/subscribe
    - _Requirements: 16.2_

- [x] 17. Implement Upload and Platform Select screens
  - [x] 17.1 Implement file picker with extension/batch validation
    - `UploadScreen`: rejects files whose extension (case-insensitive) is not
      `mp4`/`mov`/`mkv` and shows the accepted-extension list on rejection;
      accepts between 1 and 10 valid files per selection
    - _Requirements: 1.8, 1.9, 1.10_
  - [ ]* 17.2 Write property test for file extension validation
    - **Property 4: File extension validation is case-insensitive and total**
    - **Validates: Requirements 1.8**
  - [ ]* 17.3 Write property test for upload batch limit enforcement
    - **Property 5: Upload batch limit enforcement**
    - **Validates: Requirements 1.9, 1.10**
  - [x] 17.4 Implement per-file upload progress and retry
    - Requests one presigned URL per file (Task 5.1), PUTs directly to
      `Raw_Bucket`, displays 0-100% progress persisting across navigation,
      marks completed files, and on failure shows an error indicator with
      unlimited retries that each request a fresh presigned URL
    - _Requirements: 1.1, 1.4, 1.5, 1.6, 1.7_
  - [ ]* 17.5 Write property test for upload progress state consistency
    - **Property 2: Upload progress state consistency**
    - **Validates: Requirements 1.5**
  - [ ]* 17.6 Write property test for retry-requests-fresh-URL behavior
    - **Property 3: Retry always requests a fresh presigned URL**
    - **Validates: Requirements 1.7**
  - [x] 17.7 Implement PlatformSelectScreen
    - TikTok/Reels/Shorts multi-select toggles (zero or more selectable);
      blocks starting a job with zero platforms selected via a validation
      message; maps the selection to `targets[]` tokens on job start
    - _Requirements: 2.1, 2.2, 2.3, 2.4_
  - [ ]* 17.8 Write property test for platform selection mapping
    - **Property 6: Platform selection toggle and mapping**
    - **Validates: Requirements 2.2, 2.3**

- [x] 18. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 19. Implement Processing screen
  - [x] 19.1 Implement WebSocket subscribe and progress event handling
    - `ProcessingScreen`: connects and subscribes to Progress_API for the
      active `jobId`; renders an animation plus the current stage name;
      updates within 2 seconds of receiving an event
    - _Requirements: 5.1, 5.4_
  - [x] 19.2 Implement polling fallback
    - When the WebSocket connection is unavailable or drops, polls
      `GET /jobs/{id}` at a fixed 5-second interval until reconnect or a
      terminal Job status
    - _Requirements: 5.5_
  - [ ]* 19.3 Write property test for connection-loss polling state machine
    - **Property 11: Connection-loss polling state machine**
    - **Validates: Requirements 5.5**
  - [x] 19.4 Implement completion/failure navigation
    - Navigates to Highlights_Grid on a completion event or completed status
      via polling; displays an error state (instead of navigating) on a
      failure event or failed status
    - _Requirements: 5.7, 5.8_

- [x] 20. Implement Highlights Grid shared state and derivations
  - [x] 20.1 Implement GridState store/reducer
    - `clips`, `sortOrder` (default `"desc"`), `viewMode` (default
      `"gallery"`), `compilationMode` (default `false`), `selectedClipIds`,
      `activeScoreDetailsClipId`, `cropViewClipId`, with actions for each
      field
    - _Requirements: 8.3, 18.2_
  - [x] 20.2 Implement deriveDisplayList pure function
    - Given `GridState`, returns the ordered (and, when `compilationMode` is
      on, grouped-by-`mood`-alphabetically) `Clip[]` to render, applying
      `score` in the selected direction then `clipId` ascending as tiebreaker
    - _Requirements: 8.1, 8.2, 8.4, 12.2_
  - [ ]* 20.3 Write property test for clip sort comparator consistency
    - **Property 15: Clip sort comparator consistency**
    - **Validates: Requirements 7.1, 8.2, 8.4, 18.3**
  - [ ]* 20.4 Write property test for compilation grouping correctness
    - **Property 24: Compilation grouping correctness**
    - **Validates: Requirements 12.2, 12.4**
  - [ ]* 20.5 Write property test for state preservation across non-selection transitions
    - **Property 22: State preservation across non-selection transitions**
    - **Validates: Requirements 10.4, 12.5, 18.6**
  - [ ]* 20.6 Write property test for view mode toggle semantics
    - **Property 32: View mode toggle semantics**
    - **Validates: Requirements 18.1**

- [x] 21. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 22. Implement Grid/Gallery rendering components
  - [x] 22.1 Implement HighlightsGridScreen data loading and status mapping
    - Fetches Clips from Highlights_API on mount; maps Job `status` to exactly
      one of: processing indicator (pending/in_progress), error message
      (failed), empty-state message (completed, zero Clips), or the
      grid/gallery (completed, one or more Clips)
    - _Requirements: 7.2, 7.4, 7.5, 7.9_
  - [ ]* 22.2 Write property test for Job/Clip status-to-view mapping
    - **Property 17: Job/Clip status-to-view mapping**
    - **Validates: Requirements 7.4, 7.5, 7.9**
  - [x] 22.3 Implement GridView and GridCard
    - Compact multi-column layout rendering one cell per Clip with thumbnail,
      `titleNative`, `mood`, `score`
    - _Requirements: 7.3, 18.5_
  - [x] 22.4 Implement GalleryView and GalleryCard
    - Horizontally scrollable row where more than one card is at least
      partially visible at once, ordered/grouped consistently with GridView,
      each card height between 60% and 95% of viewport height
    - _Requirements: 18.3, 18.4_
  - [ ]* 22.5 Write property test for Gallery card height bounds
    - **Property 33: Gallery card height bounds**
    - **Validates: Requirements 18.4**
  - [ ]* 22.6 Write property test for grid cell rendering completeness
    - **Property 16: Grid cell rendering completeness**
    - **Validates: Requirements 7.3, 18.5**
  - [x] 22.7 Implement thumbnail/video presigned loading with fallback
    - Loads thumbnail/video via presigned URLs from Highlights_API; shows a
      placeholder image in a cell if the thumbnail fails to load
    - _Requirements: 7.6, 7.7, 7.8_
  - [ ]* 22.8 Write property test for thumbnail fallback on load failure
    - **Property 19: Thumbnail fallback on load failure**
    - **Validates: Requirements 7.7**

- [x] 23. Implement score details, selection, and crop interactions
  - [x] 23.1 Implement ScoreDetailsPanel
    - Displays exactly the 4 `factors{}` entries in fixed order
      `chat`/`audio`/`visual`/`speech`, sign-prefixed and rounded to 2 decimal
      places; provides a close control; replaces in place when reopened for a
      different Clip
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6_
  - [ ]* 23.2 Write property test for score details view behavior
    - **Property 20: Score details view behavior**
    - **Validates: Requirements 9.1, 9.2, 9.3, 9.5, 9.6**
  - [x] 23.3 Implement selection toggle and SelectionBar
    - Per-cell selection-toggle control distinct from the crop-view click
      target; selection indicator on selected cells; always-visible selected
      count; clear-selection control disabled iff count is zero
    - _Requirements: 10.1, 10.2, 10.3, 10.5, 10.6_
  - [ ]* 23.4 Write property test for selection state consistency
    - **Property 21: Selection state consistency**
    - **Validates: Requirements 10.1, 10.2, 10.3, 10.5, 10.6, 12.3**
  - [x] 23.5 Implement CropView
    - Opens on Clip-cell click showing `start`/`end` at 2-decimal precision;
      clamps adjustments to the Clip's original bounds; blocks confirm when
      `start >= end`; on confirm calls Highlights_API (Task 8.3) and marks
      crop-confirmed on success, preserves adjusted values and shows an error
      on failure; discards adjustments on dismiss without confirming
    - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.5, 11.6, 11.7, 11.8_
  - [ ]* 23.6 Write property test for crop view behavior
    - **Property 23: Crop view behavior**
    - **Validates: Requirements 11.2, 11.3, 11.4, 11.5, 11.6, 11.7, 11.8**

- [x] 24. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 25. Implement compilation mode, refinements, and confirm/handoff
  - [x] 25.1 Implement CompilationModeToggle
    - Menu control wired to `GridState.compilationMode`, preserving selection
      across the toggle transition
    - _Requirements: 12.1, 12.5, 12.6_
  - [x] 25.2 Implement quick-action chips
    - `SelectionBar` shows "Reorder"/"Faster pacing"/"Swap intro"/"More
      reactions" chips iff one or more Clips or exactly one Compilation_Group
      is selected; on chip selection calls Highlights_API (Task 8.4) and
      displays the returned status next to the affected Clip(s)/group
    - _Requirements: 13.1, 13.2, 13.5_
  - [ ]* 25.3 Write property test for quick-action chip visibility
    - **Property 25: Quick-action chip visibility**
    - **Validates: Requirements 13.1, 13.2**
  - [x] 25.4 Implement freeform prompt input
    - Text input available when a Clip or Compilation_Group is selected;
      blocks submission of empty/whitespace-only text or text over 1000
      characters with a validation message; on submit calls Highlights_API
      (Task 8.4) and shows a submission confirmation
    - _Requirements: 14.1, 14.3, 14.4, 14.5_
  - [ ]* 25.5 Write property test for freeform text validation gate
    - **Property 28: Freeform text validation gate**
    - **Validates: Requirements 14.3, 14.4**
  - [x] 25.6 Implement shared write-action error handling
    - Common error-preservation behavior for crop confirm, chip selection,
      freeform submit, and confirm-selection: on API failure, show an error
      indicator and leave selection/entered text/Clip data unchanged for retry
    - _Requirements: 11.6, 13.6, 14.6, 15.5_
  - [ ]* 25.7 Write property test for write-action error preservation
    - **Property 27: Write-action error preservation**
    - **Validates: Requirements 11.6, 13.6, 14.6, 15.5**
  - [x] 25.8 Implement confirm-and-proceed control and HandoffStubScreen
    - Blocks proceeding with zero Clips selected via a validation message; on
      confirm with one or more selected, calls Highlights_API (Task 8.6) and
      navigates to `HandoffStubScreen`, which lists each confirmed Clip's
      thumbnail and `titleNative` and states that AI auto-editing and the
      built-in editor are not yet implemented
    - _Requirements: 15.1, 15.2, 15.4, 15.6_

- [x] 26. Implement reload/reconnect persistence and error retention
  - [x] 26.1 Implement fresh refetch on reload/reconnect
    - On mount/reconnect, re-fetches Job status and Clip records from
      Job_API/Highlights_API instead of reusing client-only cached state, for
      every Job status value
    - _Requirements: 16.2_
  - [ ]* 26.2 Write property test for reload/reconnect refetch behavior
    - **Property 30: Reload/reconnect refetch behavior**
    - **Validates: Requirements 16.2**
  - [x] 26.3 Implement stale-state retention on fetch failure
    - If a status/Clip fetch fails because the API is unreachable, shows an
      error indication while continuing to display the last successfully
      retrieved Job/Clip state
    - _Requirements: 16.5_
  - [ ]* 26.4 Write property test for stale state retention on fetch failure
    - **Property 31: Stale state retention on fetch failure**
    - **Validates: Requirements 16.5**

- [x] 27. Wire full navigation flow and final integration checks
  - [x] 27.1 Wire end-to-end screen navigation
    - Connect Upload -> PlatformSelect -> Processing -> HighlightsGrid ->
      HandoffStub using the API clients and screens built above, so the whole
      flow is navigable with real (mocked-network) state transitions
    - _Requirements: 4.1, 5.1, 5.7, 15.4_
  - [ ]* 27.2 Write integration tests for major screen transitions
    - One end-to-end example per transition (upload -> platforms ->
      processing -> grid -> handoff) verifying the flow is navigable
    - _Requirements: 4.1, 5.1, 5.7, 15.4_
  - [ ]* 27.3 Write static UI presence checks
    - Chip labels, score-details close control, confirm-and-proceed control,
      platform option list, and Handoff_Stub "not yet implemented" notice are
      present
    - _Requirements: 2.1, 9.4, 13.1, 14.1, 15.1, 15.6_

- [x] 28. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP; they
  are all test-writing tasks (unit, integration, or property-based).
- Every property-based test task references its design property number and
  the requirement clauses it validates, and mocks DynamoDB/S3/Step Functions
  clients where the design's Testing Strategy calls for it.
- Backend (Task 1.1, 2-15) and frontend (Task 1.2, 16-27) workstreams have no
  file-level or logical dependency on each other beyond the shared API
  contracts already fixed in `design.md`, so they can be executed in parallel
  — see the Task Dependency Graph.
- Checkpoints (4, 7, 9, 12, 15, 18, 21, 24, 28) are natural points to pause and
  confirm direction before continuing.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2", "1.3"] },
    { "id": 1, "tasks": ["2.1", "2.2", "3.1", "16.1"] },
    { "id": 2, "tasks": ["2.3", "3.2", "3.3", "16.2"] },
    { "id": 3, "tasks": ["3.4", "16.3"] },
    { "id": 4, "tasks": ["3.5", "3.6", "16.4"] },
    { "id": 5, "tasks": ["5.1", "6.1", "8.1", "17.1", "19.1", "20.1"] },
    { "id": 6, "tasks": ["5.2", "5.3", "6.2", "6.3", "8.2", "17.2", "17.3", "19.2", "20.2"] },
    { "id": 7, "tasks": ["5.4", "6.4", "8.3", "8.4", "17.4", "19.3", "20.3", "20.4"] },
    { "id": 8, "tasks": ["6.5", "8.5", "17.5", "17.6", "19.4", "20.5", "20.6"] },
    { "id": 9, "tasks": ["8.6", "17.7"] },
    { "id": 10, "tasks": ["8.7", "8.8", "10.1", "17.8"] },
    { "id": 11, "tasks": ["10.2", "22.1"] },
    { "id": 12, "tasks": ["10.3", "10.4", "22.2", "22.3", "22.4"] },
    { "id": 13, "tasks": ["10.5", "11.1", "22.5", "22.6", "22.7"] },
    { "id": 14, "tasks": ["11.2", "22.8", "23.1"] },
    { "id": 15, "tasks": ["11.3", "11.4", "23.2", "23.3"] },
    { "id": 16, "tasks": ["11.5", "11.6", "23.4", "23.5"] },
    { "id": 17, "tasks": ["11.7", "11.8", "23.6", "25.1"] },
    { "id": 18, "tasks": ["11.9", "25.2"] },
    { "id": 19, "tasks": ["11.10", "25.3", "25.4"] },
    { "id": 20, "tasks": ["13.1", "25.5", "25.6"] },
    { "id": 21, "tasks": ["13.2", "14.1", "25.7", "25.8"] },
    { "id": 22, "tasks": ["13.3", "14.2", "26.1"] },
    { "id": 23, "tasks": ["13.4", "14.3", "26.2", "26.3"] },
    { "id": 24, "tasks": ["26.4"] },
    { "id": 25, "tasks": ["27.1"] },
    { "id": 26, "tasks": ["27.2", "27.3"] }
  ]
}
```
