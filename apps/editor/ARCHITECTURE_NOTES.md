# Architecture Notes — apps/editor + services/infra

**Provenance note:** `apps/editor` originally vendored the OpenCut *rewrite*
(a scaffold with no editor logic — just shadcn/ui primitives and router
boilerplate; see the vendored README's own "OpenCut is being rewritten from
the ground up" notice). It has since been replaced with a vendor of
[`opencut-app/opencut-classic`](https://github.com/opencut-app/opencut-classic)
at commit `cf5e79e` — the mature, actually-implemented editor this document
describes. If `apps/editor` is ever re-vendored from upstream, re-verify this
document against the new commit before relying on it.

---

## Part 1 — apps/editor (opencut-classic)

### 1. Project model

**Type:** `apps/editor/apps/web/src/project/types.ts:44-51`

```ts
TProject = {
  metadata: TProjectMetadata,   // id, name, thumbnail?, duration, createdAt, updatedAt (types.ts:20-27)
  scenes: TScene[],
  currentSceneId: string,
  settings: TProjectSettings,   // fps, canvasSize, canvasSizeMode?, background (types.ts:29-36)
  version: number,
  timelineViewState?: TTimelineViewState,
}
```

A project has no direct media-reference array — timeline elements reference
media by `mediaId`, resolved against a separate per-project media store (§4).

**Persistence — client-side only, not the app's Postgres DB.** The repo root
has a real Postgres/Drizzle backend (`db/schema.ts`, `drizzle.config.ts`), but
it only defines Better-Auth tables (`users`, `sessions`, `accounts`,
`verifications`) plus a `feedback` table (`db/schema.ts:3-70`) — **no
`projects`/`scenes`/`media` tables exist server-side today.** Projects live
entirely in the browser:

- `src/services/storage/service.ts` — `StorageService` singleton
  (`storageService`, line 574) wraps `IndexedDBAdapter`s: DB
  `video-editor-projects` (store `projects`, keyed by project id), plus
  per-project DBs `video-editor-media-${projectId}` for media metadata, and an
  `OPFSAdapter` bucket `media-files-${projectId}` for raw file blobs.
  Key methods: `saveProject`/`loadProject`/`loadAllProjects`/`deleteProject`
  (lines 134-285), `saveMediaAsset`/`loadMediaAsset`/`deleteMediaAsset`
  (lines 287-420).
- `src/services/storage/migrations/` — 31 sequential migrations
  (`v0-to-v1.ts` … `v30-to-v31.ts`), `CURRENT_PROJECT_VERSION` referenced in
  `core/managers/project-manager.ts:22`. The local schema has evolved a lot;
  any backend-API schema needs its own versioning story, not necessarily this
  one.
- `src/core/managers/project-manager.ts` — `ProjectManager` class
  (`createNewProject`, `loadProject`, `saveCurrentProject`, `deleteProjects`,
  `duplicateProjects`, `renameProject`) is the single choke point that calls
  `storageService` — **this is the seam to replace with API calls.**

### 2. Timeline/clip state

**Shape:** `src/timeline/types.ts`. `TScene` (19-27): `{ tracks: SceneTracks,
bookmarks: Bookmark[] }`. `SceneTracks` (76-80): `{ overlay: OverlayTrack[],
main: VideoTrack, audio: AudioTrack[] }` — one required main video track plus
arrays of overlay/audio tracks. Each track holds `elements: TimelineElement[]`
**as a plain array, not normalized by id** — clips are found via
`.find(el => el.id === elementId)` scans (e.g. `resize-controller.ts:91`).
This is tree-shaped (scene → tracks → elements), not a normalized store.

`BaseTimelineElement` (types.ts:105-115): `id, name, duration, startTime,
trimStart, trimEnd, sourceDuration?, animations?, params`. Concrete unions:
`VideoElement`, `ImageElement`, `TextElement`, `AudioElement` (upload vs.
library source, 93-103), `StickerElement`, `GraphicElement`, `EffectElement`.

**Ownership:** `ScenesManager` (`core/managers/scenes-manager.ts` — plain
class, `active`/`list`, manual `subscribe`/`notify` pub-sub) and
`TimelineManager` (`core/managers/timeline-manager.ts`, 935 lines — track/
element CRUD, drag/resize/split orchestration). All mutations run through a
command pattern (`src/commands/`, e.g. `commands/timeline/element/
split-elements.ts` → `SplitElementsCommand`) executed via `CommandManager`
(`core/managers/commands.ts`) for undo/redo.

**Trim-handle drag:** `src/timeline/controllers/resize-controller.ts` —
`ResizeController`. `onResizeStart` (197) begins a drag; `handleMouseMove`
(325) computes `rawDeltaTime`, calls `snappedDelta` (266) — which builds snap
points and calls `computeGroupResize` (`timeline/group-resize/compute-resize.ts`)
to produce `GroupResizeUpdate[]` patches (`trimStart`/`trimEnd`/`startTime`/
`duration`). `previewElements`/`commitElements` callbacks (`ResizeConfig`,
52-64) apply the patch live and commit on mouseup (348-361).

### 3. State management library

**Zustand v5** (`package.json`: `"zustand": "^5.0.2"`) — but only for
**UI/view state**, in separate store modules: `editor/editor-store.ts`,
`editor/panel-store.ts`, `timeline/timeline-store.ts` (`snappingEnabled`,
`rippleEditingEnabled`, `expandedElementIds`, persisted), `preview/
preview-store.ts`, `app/projects/store.ts`, plus panel-local stores
(`components/editor/panels/assets/assets-panel-store.tsx`, `components/editor/
panels/properties/stores/properties-store.ts`), `sounds/sounds-store.ts`,
`stickers/stickers-store.ts`, `actions/keybindings-store.ts`.

**Domain/document state is NOT in Zustand** — it's hand-rolled singleton
"manager" classes composed by `src/core/index.ts`'s `EditorCore` singleton
(`getInstance()`): `ProjectManager`, `TimelineManager`, `ScenesManager`,
`MediaManager`, `RendererManager`, `SaveManager`, `AudioManager`,
`SelectionManager`, `ClipboardManager`, `CommandManager`,
`DiagnosticsManager`, `PlaybackManager`. Each is a plain class with a manual
`subscribe`/`notify` pub-sub, consumed via `useEditor()`
(`src/editor/use-editor.ts`).

**Implication:** the data-layer refactor targets `core/managers/` (especially
`ProjectManager`, `MediaManager`, `ScenesManager`), not the Zustand stores.

### 4. Media loading

`src/media/use-file-upload.ts` (`useFileUpload`, drag/drop + `<input
type=file>`, 10-105) → `onFilesSelected(files: File[])` → dimension/duration
probing via `mediabunny` (`media/mediabunny.ts`, `media/processing.ts`) →
`EditorCore.media.addMediaAsset({ projectId, asset })`
(`core/managers/media-manager.ts:17-51`) → `storageService.saveMediaAsset`
(`services/storage/service.ts:287-334`) → raw blob into OPFS
(`OPFSAdapter.set`), metadata into IndexedDB (`MediaAssetData`,
`services/storage/types.ts:17-30`).

`MediaAsset` (`media/types.ts:5-9`): `{ ...MediaAssetData, file: File, url?:
string }` — **modeled as a wrapper around a browser `File`; there is no
remote-URL-only media source today.** `url`/`thumbnailUrl` are populated via
`URL.createObjectURL(file)` (`services/storage/service.ts:353-367`) from the
local blob, not fetched remotely. The only existing non-blob "url" concept is
`LibraryAudioElement.sourceUrl` (`timeline/types.ts:98-101`) for the built-in
sound-effects library — this upload-vs-library split is the template for
adding a third "remote" media-asset variant.

Thumbnails: `src/media/thumbnail.ts` (`thumbnailSize`, `renderThumbnailDataUrl`
— canvas-based via `mediabunny`, not ffmpeg.wasm). `wasm/` wraps the
`opencut-wasm` npm package for frame-accurate time math and GPU/canvas
compositing, not decoding/thumbnailing.

### 5. Export

**Fully client-side, no server render trigger today.** UI entry:
`src/components/editor/export-button.tsx` → `EditorCore.project.export(...)`
(`core/managers/project-manager.ts:212-234`) → `renderer.exportProject(...)`
(`core/managers/renderer-manager.ts`) → `src/services/renderer/
scene-exporter.ts`'s `SceneExporter` (extends `EventEmitter3`), which uses
`mediabunny` (`Output`, `Mp4OutputFormat`, `WebMOutputFormat`,
`BufferTarget`, `CanvasSource`, `AudioBufferSource` — a WebCodecs-based
muxer, not ffmpeg.wasm) to mux frames from `CanvasRenderer`
(`services/renderer/canvas-renderer.ts`) into an in-memory MP4/WebM buffer.

`src/export/index.ts`: `ExportFormat = "mp4"|"webm"`, `ExportQuality =
"low"|"medium"|"high"|"very_high"`, `ExportResult { success, buffer?, error?,
cancelled? }` (4-34), `downloadBuffer()` (52-70) — Blob + `<a download>`
link. **Output is a local file download; nothing is ever uploaded.**

### Snapping infrastructure (relevant to shot-boundary snapping)

A pluggable snap-source system already exists — the natural extension point:

- `src/timeline/snapping/types.ts`: `SnapPoint { time, type, elementId?,
  trackId? }`, `SnapPointType = "element-start"|"element-end"|"playhead"|
  "bookmark"|"keyframe"` (3-8), `TimelineSnapPointSource = () =>
  Iterable<SnapPoint>` (23) — adding a shot-boundary source means one more
  function of this shape plus a new `SnapPointType` member.
- `src/timeline/snapping/build.ts` (`buildTimelineSnapPoints`), `resolve.ts`
  (`resolveTimelineSnap`), `threshold.ts` (`getTimelineSnapThresholdInTicks`).
- Existing sources: `timeline/element-snap-source.ts`
  (`getElementEdgeSnapPoints`), `timeline/playhead-snap-source.ts`
  (`getPlayheadSnapPoints`), `timeline/animation-snap-points.ts`, `timeline/
  bookmarks/snap-source.ts`.
- Consumed in the trim path at `resize-controller.ts:284-294`, which composes
  element-edge + playhead + keyframe sources (bookmark source is used
  elsewhere, e.g. group-move). A shot-boundary source needs to be added to
  this array (and to `group-move/snap.ts`/`drag-drop-controller.ts` for
  full-clip drags).
- `timeline/bookmarks/*` is the best template: `Bookmark { time, note?,
  color?, duration? }` (types.ts:12-17), stored per-scene
  (`TScene.bookmarks`), rendered in `timeline/bookmarks/components/
  bookmarks.tsx`, already snap-source-ified — same shape but read-only/
  externally-driven instead of user-created fits shot boundaries well.
- **No scene-detection/auto-boundary logic exists anywhere today** (`guides/`,
  `ripple/`, `selection/` concern canvas alignment guides and ripple-edit/
  selection state, not shot boundaries) — this is new.

---

## Part 2 — services/infra (AI Highlight Clip backend)

**Status: `services/` and `infra/` do not exist as directories in this repo.**
The backend is, today, only:
- `pipeline/` — a runnable local Python reference implementation
  (Transcribe/Rekognition/Bedrock calls against real AWS, ffmpeg render,
  no Lambda/API Gateway/DynamoDB wiring).
- `.kiro/steering/architecture.md` and `.kiro/specs/webapp-skeleton/
  requirements.md` — spec docs describing the intended AWS backend, not yet
  built.

A full breakdown (DynamoDB clip-item schema, API routes, S3 key conventions,
render-job status tracking, plus every gap/inconsistency found between the
pipeline code and the spec docs) is already written up in
[`INTEGRATION_CONTRACT.md`](../../INTEGRATION_CONTRACT.md) at the repo root —
see that file for the full detail rather than duplicating it here. Summary of
what the editor refactor needs to target:

- **Clip fields** (merged spec + pipeline output — see `INTEGRATION_CONTRACT.md`
  §1): `jobId`/`clipId` keys, `start`/`end` (seconds), `score`/
  `virality_score`, `factors{}`, `category`, `mood`, `title`/`titleEn`
  (`title_zh`/`title_en` in pipeline output), `hook`/`hook_zh`, `caption`/
  `captionEn` (`caption_zh`/`caption_en`), `hashtags[]`, `thumbKey`,
  `outputKey`. **No `cropWindow` or per-clip shot-boundary field is
  persisted today** — crop is baked into an ffmpeg filter string at render
  time, and shot boundaries live only in a job-level Rekognition blob
  (`pipeline/signals/visual.py:76-84`, `{start_s, end_s, confidence}` per
  shot). The mock API layer built for the editor refactor should expose shot
  boundaries as their own list per video (not embedded in the clip item),
  matching how Rekognition actually returns them.
- **API routes**: none implemented; `INTEGRATION_CONTRACT.md` §2 documents the
  spec's implied REST/WebSocket contract (`Job_API`, `Highlights_API`,
  `Progress_API`). The routes this refactor consumes (`GET /videos`, `GET
  /videos/{id}/clips`, `PATCH /clips/{id}`, `POST /clips/{id}/render`, `GET
  /clips/{id}/status`) are a **new, narrower contract** tailored to the
  editor's needs — they don't map 1:1 onto the spec's `Highlights_API` routes
  (which are grid/refinement-oriented, not editor/render-oriented) and are
  being introduced fresh as part of this refactor, mocked client-side since no
  server exists.
- **S3 key conventions**: `INTEGRATION_CONTRACT.md` §3 — `raw/` prefix (spec)
  vs. the pipeline's actual `{stream_id}_video.mp4` at bucket root (conflict,
  flagged there); rendered clips/thumbnails never leave the local filesystem
  in the current pipeline.
- **Render-job status**: `INTEGRATION_CONTRACT.md` §4 — no MediaConvert
  usage exists in code today (only local ffmpeg); no status enum is defined
  anywhere for a render/export job. The editor's `POST /clips/{id}/render` +
  `GET /clips/{id}/status` mock needs to invent this enum from scratch —
  recommend `queued → rendering → ready | failed`, mirroring the Job status
  pattern already used elsewhere (`pending → in-progress → completed|failed`).
