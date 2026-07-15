# Requirements Document

## Introduction

This spec covers the end-to-end **skeleton** of the Live Stream Highlight Generator
web app: the frontend screens and the AWS backend wiring that connects them, as
described in `architecture.md` and `user-flow.md`. It delivers a navigable flow from
VOD upload through platform selection, processing progress, and the highlights grid
(including sort, score details, multi-select, crop/confirm, compilation mode,
quick-action chips, and freeform prompt refinement).

The actual highlight-detection / virality-scoring algorithm, the built-in video
editor (forked `react-video-editor`), and the AI auto-editing engine are **out of
scope**. Analysis Lambdas that would normally compute real scores are replaced by
stubs that produce placeholder `Clip` records so the UI downstream of them is fully
exercisable. Any step past the highlights grid (auto-edit, editor, export) is
represented only by a placeholder screen/endpoint sufficient to prove the flow is
navigable end-to-end; its internal behavior is not specified here.

## Glossary

- **Frontend_App**: The React single-page application hosted on S3 and served via
  CloudFront, covering all screens in `user-flow.md` steps 1-4.
- **Auth_Service**: The Amazon Cognito user pool and API Gateway authorizer that
  authenticates users and authorizes every API request.
- **Upload_API**: The Lambda-backed REST endpoint(s) behind API Gateway that issue
  presigned S3 upload URLs and create `Job` records.
- **Raw_Bucket**: The S3 bucket that stores uploaded VOD source files under a
  `raw/` prefix.
- **Job**: A DynamoDB record with attributes `jobId, userId, status, targets[],
  sourceKeys[], createdAt` representing one upload-to-highlights request.
- **Job_API**: The Lambda-backed REST endpoint(s) that create a `Job`, start the
  pipeline, and return `Job` status.
- **Pipeline_Orchestrator**: The Step Functions state machine that sequences the
  analysis stages for a `Job`.
- **Analysis_Stage_Stub**: A placeholder Lambda step inside Pipeline_Orchestrator
  that stands in for a real analysis stage (MediaConvert, Transcribe, Rekognition,
  audio/chat analysis, Fusion, Bedrock) and emits deterministic placeholder output
  instead of performing real media analysis.
- **Progress_API**: The API Gateway WebSocket API that pushes `Job` status and
  stage-transition events to Frontend_App.
- **Clip**: A DynamoDB record with attributes `jobId, clipId, start, end, score,
  factors{chat, audio, visual, speech}, mood, titleNative, titleEnglish,
  caption, hashtags[], momentType, thumbKey, videoKey` representing one
  detected highlight. `factors{}` always contains exactly the four numeric
  entries `chat`, `audio`, `visual`, and `speech`, each of which may be
  negative. `mood` (e.g. "emotional", "hype", "wholesome") is the renamed
  successor to an earlier undifferentiated `category` concept: it is drawn
  from a fixed configured list and is the field used for Compilation_Group
  grouping. `momentType` is a separate, purely descriptive human-readable
  label of the kind of moment shown (e.g. "song performance", "guest story &
  song reveal"); it is not used for grouping or sorting. `titleNative` and
  `titleEnglish` together replace an earlier single `title` field, holding
  the highlight's title in its original language and in English respectively.
  `videoKey` is an S3 key for the Clip's rendered video preview, analogous to
  `thumbKey`. Under Analysis_Stage_Stub, `score`, `factors{}`, `mood`,
  `titleNative`, `titleEnglish`, `caption`, `hashtags[]`, `momentType`, and
  `videoKey` hold placeholder values rather than algorithm output.
- **Highlights_API**: The Lambda-backed REST endpoint(s) that list `Clip` records
  for a `Job` and record user actions on them (crop, confirm, refine, group).
- **Highlights_Grid**: The Frontend_App screen that renders `Clip` records for a
  completed or in-progress `Job`.
- **Compilation_Group**: A named grouping of `Clip` records sharing the same
  `mood`, produced when Compilation Mode is active.
- **Refinement_Request**: A DynamoDB-persisted record capturing a quick-action
  chip selection or freeform prompt text submitted against one or more `Clip`
  records, with `status` reflecting stubbed processing.
- **Handoff_Stub**: A placeholder Frontend_App screen and backend endpoint reached
  after the user confirms highlight selection, representing the entry point to the
  (out-of-scope) AI auto-edit engine and built-in editor.
- **crop-confirmed**: A per-Clip state indicating the user has confirmed adjusted
  `start`/`end` boundaries for that Clip via the crop view (Requirement 11). This
  is distinct from the multi-select "confirm selection" action (Requirement 15),
  which confirms a set of selected Clips for hand-off rather than a Clip's
  boundaries.

## Requirements

### Requirement 1: VOD Upload

**User Story:** As a content creator, I want to upload one or more VOD files, so that I can generate highlight clips from them.

#### Acceptance Criteria

1. WHEN a user selects one or more video files in Frontend_App, THE Frontend_App SHALL request one presigned S3 upload URL per file from Upload_API.
2. WHEN Upload_API receives a presigned-URL request, THE Upload_API SHALL verify the request is authorized by Auth_Service before issuing a URL.
3. WHEN Upload_API issues a presigned upload URL, THE Upload_API SHALL scope the URL to the Raw_Bucket `raw/` prefix, to a single object key, and to a validity period of 15 minutes from issuance.
4. WHEN a presigned upload URL is issued, THE Frontend_App SHALL upload the corresponding file directly to Raw_Bucket without routing file bytes through any Lambda function.
5. WHILE a file upload is in progress and has not failed, THE Frontend_App SHALL display upload progress for that file as a percentage between 0 and 100, maintaining and displaying that progress regardless of whether the user navigates away from or returns to the upload screen.
6. WHEN a file upload completes successfully, THE Frontend_App SHALL mark that file as uploaded in the upload UI.
7. IF a file upload fails, THEN THE Frontend_App SHALL replace that file's progress display with an error indicator, SHALL permit an unlimited number of retry attempts for that file, and SHALL request a new presigned upload URL from Upload_API for each retry attempt.
8. IF a user selects a file whose extension, evaluated case-insensitively, is not one of `mp4`, `mov`, `mkv`, THEN THE Frontend_App SHALL reject that file and SHALL display the list of accepted file extensions.
9. THE Frontend_App SHALL support selecting between 1 and 10 files with an accepted extension for a single upload batch.
10. IF the number of files with an accepted extension in a single selection exceeds 10, THEN THE Frontend_App SHALL reject the files beyond the first 10 and SHALL display a validation message indicating the 10-file batch limit.

### Requirement 2: Target Platform Selection

**User Story:** As a content creator, I want to select which social platforms my highlights are intended for, so that downstream formatting matches each platform.

#### Acceptance Criteria

1. THE Frontend_App SHALL present TikTok, Instagram Reels, and YouTube Shorts as selectable target platform options.
2. THE Frontend_App SHALL allow zero or more target platform options to be selected simultaneously.
3. WHEN the user starts a job, THE Job_API SHALL store the selected target platform options as the `targets[]` attribute of the created Job, using the values `"tiktok"`, `"reels"`, and `"shorts"` to represent TikTok, Instagram Reels, and YouTube Shorts respectively.
4. IF the user attempts to start a job with zero target platforms selected, THEN THE Frontend_App SHALL display a validation message and SHALL prevent the job from starting.
5. IF a start-job request received by the Job_API has a `targets[]` value that is missing, empty, or contains any value other than `"tiktok"`, `"reels"`, or `"shorts"`, THEN THE Job_API SHALL reject the request without creating a Job and SHALL return an error response indicating that the target platforms are invalid.

### Requirement 3: Authentication and Authorization

**User Story:** As a product owner, I want every API call authenticated, so that user data and uploaded media stay private.

#### Acceptance Criteria

1. THE Auth_Service SHALL authenticate users via a Cognito user pool before granting access to any Frontend_App screen other than the sign-in and sign-up screens.
2. THE Job_API, Upload_API, Highlights_API, and Progress_API SHALL require, on every request, a token that is issued by Auth_Service, unexpired, and unrevoked, and SHALL treat any request without such a token as unauthenticated.
3. IF a request to Job_API, Upload_API, or Highlights_API has no token, or has a token that is missing, expired, revoked, or otherwise fails Auth_Service validation, THEN THE receiving API SHALL respond with an authorization error and SHALL NOT perform the requested operation.
4. IF a WebSocket connection request to Progress_API has no token, or has a token that is missing, expired, revoked, or otherwise fails Auth_Service validation, THEN THE Progress_API SHALL reject the connection.
5. WHILE a Progress_API WebSocket connection established with a valid Auth_Service token is open, IF that token expires or is revoked, THEN THE Progress_API SHALL close the connection.
6. THE Raw_Bucket and any proxy/output S3 buckets SHALL deny public read and public write access, exposing objects only through presigned URLs.

### Requirement 4: Job Creation and Pipeline Start

**User Story:** As a content creator, I want to start processing after uploading and selecting platforms, so that highlight generation begins.

#### Acceptance Criteria

1. WHEN a user confirms uploaded files and target platforms in Frontend_App, THE Job_API SHALL create a Job record with `status` set to an initial pending value.
2. WHEN a Job record is created, THE Job_API SHALL start one Pipeline_Orchestrator execution scoped to that Job's `jobId`.
3. IF Job_API fails to start a Pipeline_Orchestrator execution for a newly created Job, THEN THE Job_API SHALL set that Job's `status` to a failed value and SHALL return an error to Frontend_App indicating the job could not be started.
4. WHEN a Pipeline_Orchestrator execution starts, THE Pipeline_Orchestrator SHALL update the associated Job's `status` to an in-progress value.
5. WHEN Job_API receives a request for the status of a Job identified by `jobId`, THE Job_API SHALL return that Job's current status if the `jobId` belongs to the authenticated requester.
6. IF a status request references a `jobId` that does not exist or does not belong to the authenticated requester, THEN THE Job_API SHALL respond with an authorization error and SHALL NOT return any status information for that `jobId`.
7. IF Job_API receives a start-job request referencing source files that were never confirmed as uploaded, THEN THE Job_API SHALL reject the request without creating a Job record or starting a Pipeline_Orchestrator execution, and SHALL return an error indicating which referenced source files were not confirmed as uploaded.

### Requirement 5: Processing Progress Animation

**User Story:** As a content creator, I want to see real progress while my VOD is processed, so that I know the system is working and how far along it is.

#### Acceptance Criteria

1. WHEN Frontend_App starts a job, THE Frontend_App SHALL display a processing screen showing an animation and the current pipeline stage name.
2. WHEN Pipeline_Orchestrator transitions between stages, THE Pipeline_Orchestrator SHALL publish a progress event containing `jobId`, stage name, and stage status to Progress_API, where stage status is one of "started", "completed", or "failed".
3. WHEN Progress_API receives a progress event for a Job, THE Progress_API SHALL push that event to any Frontend_App client subscribed to that Job's `jobId` within 1 second of receipt.
4. WHEN Frontend_App receives a progress event over Progress_API, THE Frontend_App SHALL update the processing screen to reflect the received stage and status within 2 seconds of receipt.
5. IF the Progress_API WebSocket connection is unavailable or drops while a job is in progress, THEN THE Frontend_App SHALL poll the Job_API status endpoint at a fixed 5-second interval until the connection is restored or the job completes.
6. WHEN Pipeline_Orchestrator completes all stages for a Job, THE Pipeline_Orchestrator SHALL set that Job's `status` to a completed value and SHALL publish a completion progress event.
7. WHEN Frontend_App receives a completion progress event or observes a completed status via polling, THE Frontend_App SHALL navigate from the processing screen to Highlights_Grid.
8. IF any pipeline stage reports a failure status, THEN THE Pipeline_Orchestrator SHALL set the Job's `status` to a failed value, and THE Frontend_App SHALL display an error state on the processing screen showing an error message indicating that processing failed, instead of navigating to Highlights_Grid.

### Requirement 6: Analysis Pipeline Orchestration Skeleton

**User Story:** As a developer, I want the analysis pipeline wired end-to-end with stubbed stages, so that the highlights grid can be exercised before the real detection algorithm exists.

#### Acceptance Criteria

1. THE Pipeline_Orchestrator SHALL execute its stages as an ordered sequence of Analysis_Stage_Stub steps matching the stage names listed in `architecture.md` (normalize/proxy, transcript, visual analysis, audio analysis, chat analysis, fusion/scoring, categorization).
2. WHEN an Analysis_Stage_Stub step runs, THE Analysis_Stage_Stub SHALL complete without invoking any real media-analysis AWS service (MediaConvert, Transcribe, Rekognition, or Bedrock inference for scoring).
3. WHEN the fusion/scoring Analysis_Stage_Stub step runs for a Job, THE Analysis_Stage_Stub SHALL create between 3 and 10 Clip records for that Job, each with a deterministically generated placeholder `score` between 0 and 100 inclusive and a placeholder `factors{}` breakdown containing exactly the 4 entries `chat`, `audio`, `visual`, and `speech`, each a numeric value between -100 and 100 inclusive.
4. WHEN the categorization Analysis_Stage_Stub step runs for a Job, THE Analysis_Stage_Stub SHALL assign to each Clip record belonging to that Job one placeholder `mood` value drawn from a fixed configured list containing at least 2 possible values, and one placeholder `momentType` value that is a non-empty string of at most 100 characters.
5. IF a Job has 2 or more Clip records after the categorization Analysis_Stage_Stub step runs, THEN THE Analysis_Stage_Stub SHALL ensure at least 2 distinct `mood` values are represented across that Job's Clip records.
6. WHEN the fusion/scoring and categorization Analysis_Stage_Stub steps run more than once for a Job whose `jobId`, `sourceKeys[]`, and `targets[]` attribute values are unchanged between runs, THE Analysis_Stage_Stub SHALL produce an identical number of Clip records and identical `score`, `factors{}`, `mood`, and `momentType` values across those runs.
7. WHEN the fusion/scoring Analysis_Stage_Stub step runs for a Job, THE Analysis_Stage_Stub SHALL also generate, for each created Clip record, deterministic placeholder values for `titleNative` (a non-empty string of at most 100 characters), `titleEnglish` (a non-empty string of at most 100 characters), `caption` (a non-empty string of at most 500 characters), `hashtags[]` (an array containing between 1 and 10 non-empty string entries, each of at most 30 characters), and `videoKey` (a non-empty string).
8. WHEN the Analysis_Stage_Stub steps run more than once for a Job whose `jobId`, `sourceKeys[]`, and `targets[]` attribute values are unchanged between runs, THE Analysis_Stage_Stub SHALL produce identical `titleNative`, `titleEnglish`, `caption`, `hashtags[]`, and `videoKey` values across those runs.
9. THE Analysis_Stage_Stub SHALL produce Job and Clip records that conform exactly to the field names and structure defined for Job_API, Highlights_API, and Frontend_App contracts in the Glossary.

### Requirement 7: Highlights Grid Display

**User Story:** As a content creator, I want to see detected highlights in a grid, so that I can review what was found.

#### Acceptance Criteria

1. WHEN Frontend_App navigates to Highlights_Grid for a Job, THE Highlights_API SHALL return all Clip records associated with that Job's `jobId`, ordered by `score` in descending order, applying `clipId` ascending order as a secondary sort key for any Clip records with equal `score` values.
2. IF the requested Job's `jobId` does not exist or does not belong to the authenticated user, THEN THE Highlights_API SHALL return an authorization/not-found error, and THE Highlights_Grid SHALL display an error message instead of a grid.
3. WHEN Highlights_API returns Clip records for a Job, THE Highlights_Grid SHALL render one grid cell per Clip, showing at minimum its thumbnail, `titleNative`, `mood`, and `score`.
4. IF the Job's status is completed and the Job has zero associated Clip records, THEN THE Highlights_Grid SHALL display an empty-state message indicating no highlights were found, instead of an empty grid.
5. WHILE the Job's status is a pending or in-progress value, THE Highlights_Grid SHALL display a processing indicator instead of the empty-state message or grid.
6. WHEN Highlights_Grid renders a Clip thumbnail, THE Frontend_App SHALL load the thumbnail image via a presigned S3 GET URL obtained from Highlights_API, valid for at least 5 minutes from issuance.
7. IF a Clip thumbnail image fails to load, THEN THE Highlights_Grid SHALL display a placeholder image in that grid cell instead of leaving it blank.
8. WHEN Highlights_Grid renders a Clip's video preview in Gallery view (Requirement 18), THE Frontend_App SHALL load that video preview via a presigned S3 GET URL for the Clip's `videoKey`, obtained from Highlights_API, following the same presigned-URL pattern used for thumbnails.
9. IF the Job's status is a failed value, THEN THE Highlights_Grid SHALL display an error message indicating that processing failed, instead of a grid, empty-state message, or processing indicator.

### Requirement 8: Sort Highlights by Score

**User Story:** As a content creator, I want to sort highlights by score, so that I can quickly find the strongest candidates.

#### Acceptance Criteria

1. THE Highlights_Grid SHALL provide controls to sort displayed Clip records by `score` in descending order and in ascending order, and SHALL indicate to the user which of the two sort orders is currently active.
2. WHEN the user selects a sort order, THE Highlights_Grid SHALL reorder the displayed Clip records to match the selected sort order, applying `clipId` ascending order as a secondary sort key for any Clip records with equal `score` values, without requesting data from Highlights_API again.
3. WHEN Highlights_Grid first renders Clip records for a Job, THE Highlights_Grid SHALL default to sorting displayed Clip records by `score` in descending order.
4. WHILE Compilation Mode is active, THE Highlights_Grid SHALL apply the currently selected sort order to displayed Clip records independently within each Compilation_Group section.

### Requirement 9: View Score Details

**User Story:** As a content creator, I want to see why a highlight scored the way it did, so that I can decide whether to trust or override it.

#### Acceptance Criteria

1. WHEN the user activates the score control on a Clip in Highlights_Grid, THE Highlights_Grid SHALL display the `factors{}` breakdown for that Clip in a detail view, without opening the crop view described in Requirement 11.
2. THE score details view SHALL display exactly the 4 entries present in that Clip's `factors{}`, in the fixed order `chat`, `audio`, `visual`, `speech`, each as a labeled numeric value rounded to 2 decimal places, with no additional or omitted entries.
3. THE score details view SHALL display each `factors{}` value prefixed with its sign (`+` for values greater than or equal to 0, `-` for negative values) followed by the value's absolute magnitude rounded to 2 decimal places.
4. THE score details view SHALL provide a close control.
5. WHEN the user activates the close control or otherwise dismisses the score details view, THE Highlights_Grid SHALL return to the grid without altering the Clip's data.
6. WHEN the user activates the score control on a Clip while the score details view is already open for a different Clip, THE Highlights_Grid SHALL replace the displayed breakdown in place with the newly activated Clip's `factors{}` breakdown, without requiring the view to be closed and reopened.

### Requirement 10: Multi-Select Highlights

**User Story:** As a content creator, I want to select multiple highlights at once, so that I can act on several of them together.

#### Acceptance Criteria

1. THE Highlights_Grid SHALL provide, on each Clip cell, a selection-toggle control distinct from the click target that opens the crop view (Requirement 11), and SHALL allow the user to use that control to toggle selection of any number of Clip cells, including zero, one, or all displayed Clips.
2. WHEN a Clip cell is selected, THE Highlights_Grid SHALL display an observable selection indicator on that cell that is not present on unselected Clip cells.
3. THE Highlights_Grid SHALL display a count of currently selected Clips at all times, including a count of zero when no Clip cells are selected.
4. WHEN the displayed sort order changes per Requirement 8, or WHEN Compilation Mode is toggled on or off per Requirement 12, THE Highlights_Grid SHALL preserve the current set of selected Clips unchanged.
5. WHEN the user activates the clear-selection control, THE Highlights_Grid SHALL deselect all currently selected Clip cells and SHALL update the selected count to zero.
6. WHILE zero Clip cells are selected, THE Highlights_Grid SHALL disable the clear-selection control.

### Requirement 11: Crop and Confirm a Highlight

**User Story:** As a content creator, I want to crop a highlight's boundaries and confirm it, so that only the part I want is carried forward.

#### Acceptance Criteria

1. WHEN the user clicks into a Clip cell in Highlights_Grid, THE Frontend_App SHALL open a crop view showing that Clip's current `start` and `end` values in seconds with 2-decimal precision.
2. WHILE the crop view is open, THE Frontend_App SHALL allow the user to adjust `start` and `end`, expressed in seconds with 2-decimal precision, within the bounds of the source Clip's original `start` and `end`.
3. IF the user attempts to adjust `start` or `end` to a value outside the bounds of the source Clip's original `start` and `end`, THEN THE Frontend_App SHALL clamp the adjusted value to the nearest bound.
4. IF the user adjusts `start` to a value greater than or equal to the adjusted `end`, THEN THE Frontend_App SHALL display a validation message and SHALL prevent confirming the crop.
5. WHEN the user confirms a crop, THE Highlights_API SHALL update the Clip record's `start` and `end` attributes with the adjusted values.
6. IF the Highlights_API fails to update the Clip record's `start` and `end` attributes after the user confirms a crop, THEN THE Frontend_App SHALL display an error message, SHALL preserve the user's adjusted `start` and `end` values in the crop view, and SHALL NOT mark that Clip as crop-confirmed.
7. WHEN the Highlights_API successfully updates the Clip record's `start` and `end` attributes, THE Frontend_App SHALL close the crop view and SHALL mark that Clip as crop-confirmed in Highlights_Grid, distinct from the multi-select "confirm selection" action described in Requirement 15.
8. WHEN the user dismisses the crop view without confirming the crop, THE Frontend_App SHALL discard any adjustments made to `start` and `end` and SHALL leave the Clip's crop-confirmed state unchanged.

### Requirement 12: Compilation Mode Grouping

**User Story:** As a content creator, I want highlights automatically grouped by mood, so that I can build a compilation instead of picking clips one by one.

#### Acceptance Criteria

1. THE Highlights_Grid SHALL provide a menu control to toggle Compilation Mode on and off.
2. WHEN Compilation Mode is toggled on, THE Highlights_Grid SHALL organize displayed Clip records into Compilation_Group sections, one per distinct `mood` value present among that Job's Clips, ordered alphabetically by `mood` value.
3. WHILE Compilation Mode is on, THE Highlights_Grid SHALL allow multi-select of Clips within and across Compilation_Group sections.
4. WHEN Compilation Mode is toggled off, THE Highlights_Grid SHALL display Clip records as a single ungrouped grid instead of Compilation_Group sections.
5. WHEN the user toggles Compilation Mode, THE Highlights_Grid SHALL preserve the current Clip selection state across the transition.
6. IF a Job has zero associated Clip records while Compilation Mode is on, THEN THE Highlights_Grid SHALL display an empty-state message instead of empty Compilation_Group sections.

### Requirement 13: Quick-Action Chip Refinement

**User Story:** As a content creator, I want one-tap common edit requests, so that I can adjust a highlight without typing a prompt.

#### Acceptance Criteria

1. WHILE one or more Clip records are selected, or exactly one Compilation_Group is selected, in Highlights_Grid, THE Highlights_Grid SHALL present quick-action chips labeled "Reorder", "Faster pacing", "Swap intro", and "More reactions".
2. WHILE zero Clip records and zero Compilation_Groups are selected in Highlights_Grid, THE Highlights_Grid SHALL NOT display quick-action chips.
3. WHEN the user selects a quick-action chip, THE Highlights_API SHALL create a Refinement_Request record with the chip's structured action type and, as target identifiers, either all currently selected Clip identifiers (if one or more Clips are selected) or the single selected Compilation_Group identifier (if a Compilation_Group is selected).
4. WHEN a Refinement_Request record is created, THE Highlights_API SHALL set its `status` to a pending value and SHALL return the created record to Frontend_App.
5. WHEN Frontend_App receives a created Refinement_Request, THE Highlights_Grid SHALL display that Refinement_Request's `status` next to each affected Clip or next to the affected Compilation_Group.
6. IF Highlights_API fails to create a Refinement_Request record after the user selects a quick-action chip, THEN THE Highlights_API SHALL return an error indicating the creation failure, and THE Highlights_Grid SHALL display an error indicator next to the affected Clip(s) or Compilation_Group without altering the current selection state.

### Requirement 14: Freeform Prompt Refinement

**User Story:** As a content creator, I want to describe a custom change in my own words, so that I can request edits the quick-action chips do not cover.

#### Acceptance Criteria

1. WHILE a Clip or Compilation_Group is selected in Highlights_Grid, THE Highlights_Grid SHALL provide a freeform text input for that selection.
2. WHEN the user submits freeform prompt text, THE Highlights_API SHALL create a Refinement_Request record containing the submitted text and the target Clip or Compilation_Group identifiers.
3. IF the user submits a freeform prompt that is empty or contains only whitespace, THEN THE Frontend_App SHALL display a validation message and SHALL prevent submission.
4. IF the user submits freeform prompt text exceeding 1000 characters, THEN THE Frontend_App SHALL display a validation message indicating the 1000-character limit and SHALL prevent submission.
5. WHEN the Highlights_API successfully creates a Refinement_Request record from freeform prompt text, THE Frontend_App SHALL display a submission confirmation.
6. IF Highlights_API fails to create a Refinement_Request record after the user submits freeform prompt text, THEN THE Highlights_API SHALL return an error indicating the failure, and THE Frontend_App SHALL display an error indicator while preserving the user's entered text for retry.

### Requirement 15: Confirm Selection and Hand Off

**User Story:** As a content creator, I want to confirm my chosen highlights and move forward, so that I can reach the (future) auto-editing step.

#### Acceptance Criteria

1. THE Highlights_Grid SHALL provide a control to confirm the current Clip selection and proceed.
2. IF the user activates the confirm-and-proceed control with zero Clips selected, THEN THE Frontend_App SHALL display a validation message and SHALL prevent proceeding.
3. WHEN the user activates the confirm-and-proceed control with one or more Clips selected, THE Highlights_API SHALL record the confirmed selection, scoped to the Job's `jobId` and the selected Clip identifiers, and SHALL respond with a Handoff_Stub reference.
4. WHEN Frontend_App receives a Handoff_Stub reference, THE Frontend_App SHALL navigate to the Handoff_Stub screen and SHALL display, for each confirmed Clip, at minimum its thumbnail and `titleNative`.
5. IF Highlights_API fails to record the confirmed selection after the user activates the confirm-and-proceed control, THEN THE Frontend_App SHALL display an error message, SHALL retain the current Clip selection, and SHALL allow the user to retry.
6. THE Handoff_Stub screen SHALL indicate that AI auto-editing and the built-in editor are not yet implemented.

### Requirement 16: Data Persistence

**User Story:** As a developer, I want Job, Clip, and Refinement_Request data persisted consistently, so that the frontend reflects accurate state across reloads and reconnects.

#### Acceptance Criteria

1. THE Job_API, Highlights_API, and Pipeline_Orchestrator SHALL persist Job, Clip, and Refinement_Request records in DynamoDB.
2. WHEN Frontend_App reloads or reconnects, THE Frontend_App SHALL retrieve that Job's current status and associated Clip records from Job_API and Highlights_API rather than relying on client-only state, regardless of whether the Job's status is pending, in progress, complete, or failed.
3. THE Highlights_API SHALL scope all Clip and Refinement_Request reads and writes to the `jobId` and `userId` of the authenticated requester.
4. IF a request to Highlights_API references a `jobId` not owned by the authenticated requester, THEN THE Highlights_API SHALL respond with an authorization error.
5. IF Job_API or Highlights_API is unreachable when Frontend_App attempts to retrieve Job status or Clip records on reload or reconnect, THEN THE Frontend_App SHALL display an error indication to the user and retain the last successfully retrieved Job and Clip state rather than discarding it.
6. THE Job_API SHALL scope all Job status-read requests to the `jobId` and `userId` of the authenticated requester.
7. IF a request to Job_API's status-read endpoint references a `jobId` not owned by the authenticated requester, THEN THE Job_API SHALL respond with an authorization error.

### Requirement 17: Frontend Hosting and Delivery

**User Story:** As a developer, I want the frontend deployed as static assets behind a CDN, so that the app matches the architecture's hosting model.

#### Acceptance Criteria

1. THE Frontend_App SHALL be built into a static asset bundle (HTML, CSS, JavaScript, and other associated build output files) and stored in a dedicated S3 bucket with all public access and public bucket policies blocked.
2. THE Frontend_App static asset bucket SHALL be served to end users exclusively through a CloudFront distribution, such that direct end-user requests to the S3 bucket's endpoint are denied.
3. THE CloudFront distribution SHALL deliver the Frontend_App content to end users only over HTTPS connections.
4. WHEN the CloudFront distribution receives a request for a path that does not match an existing file in the Frontend_App static asset bundle, THE CloudFront distribution SHALL return the Frontend_App's entry page instead of an error response, so that client-side routing can resolve the path.

### Requirement 18: Highlights Grid View Modes

**User Story:** As a content creator, I want to switch between a compact grid and a richer scrolling gallery of my highlights, so that I can pick the browsing style that suits what I am doing.

#### Acceptance Criteria

1. THE Highlights_Grid SHALL support exactly two view modes, "Gallery" and "Grid", and SHALL provide a control that lets the user switch the active view mode to either value at any time.
2. WHEN Highlights_Grid first renders Clip records for a Job, THE Highlights_Grid SHALL default the active view mode to "Gallery".
3. WHILE the active view mode is "Gallery", THE Highlights_Grid SHALL render Clip records as a horizontally scrollable row of cards in which more than one card is at least partially visible at once, instead of restricting display to one card at a time, ordered according to the currently active sort order (Requirement 8) and, while Compilation Mode is on, grouped into Compilation_Group sections (Requirement 12) consistent with Grid view.
4. WHILE the active view mode is "Gallery", THE Highlights_Grid SHALL render each Clip card at a height that is at least 60% and at most 95% of the viewport's vertical height.
5. WHILE the active view mode is "Grid", THE Highlights_Grid SHALL render Clip records using the compact multi-column grid layout described in Requirement 7.
6. WHEN the user switches the active view mode, THE Highlights_Grid SHALL preserve the current Clip selection state, the currently selected sort order, and the current Compilation Mode state unchanged across the transition, consistent with the persistence behavior described in Requirements 8.4, 10.4, and 12.5.
7. THE Highlights_Grid SHALL support sort (Requirement 8), score details (Requirement 9), multi-select (Requirement 10), crop and confirm (Requirement 11), Compilation Mode (Requirement 12), quick-action chips (Requirement 13), and freeform prompt refinement (Requirement 14) identically regardless of whether the active view mode is "Gallery" or "Grid".
