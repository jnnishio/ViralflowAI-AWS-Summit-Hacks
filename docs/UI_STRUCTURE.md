# UI Structure — Clip Display Page → Editor

How the review-and-edit UI is put together, from the highlights page through the
built-in editor. This is the "everything after processing" half of the flow.

## Two apps, one deep link

The post-processing UI spans **two separate apps**:

| App | Path | Dev server | Talks to |
|-----|------|-----------|----------|
| **SPA** (highlights page) | `frontend/src` (Vite + React Router) | `http://localhost:5173` (`npm run dev`) | local mock server `http://localhost:3000` / WS `:3001` |
| **Editor** (OpenCut fork) | `apps/editor/apps/web` (Next.js) | `http://localhost:3100` (`npm run editor`) | local mock server `http://localhost:3000/api` |

They are **not** embedded — the SPA hands off to the editor with a plain
`<a target="_blank">` deep link. Both are backed by the same local Node server
(`frontend/local-server/server.mjs`), which serves the real pipeline output.

```
Upload → Platforms → Processing → HIGHLIGHTS PAGE ──(Open in Editor deep link)──▶ EDITOR
                                   (SPA, :5173)                                   (:3100)
                                        │                                            │
                                        └──────── mock server :3000 ─────────────────┘
```

---

## 1. Highlights page (clip display) — SPA

**Route:** `/highlights/:jobId` → `frontend/src/screens/HighlightsGridScreen.tsx`

### Component tree
```
HighlightsGridScreen                         screens/HighlightsGridScreen.tsx
├─ .highlights-controls
│  ├─ SortControl                            components/SortControl.tsx      (score asc/desc)
│  └─ CompilationModeToggle                  components/CompilationModeToggle.tsx  ("Compilation reels")
├─ GalleryView                               components/GalleryView.tsx
│  ├─ (flat mode) .clip-row  → ClipCard[]    horizontal scrolling row of all clips
│  └─ (compilation mode) one section per reel:
│        header (title 中文 + EN subtitle + N clips)
│        .comp-reason (why these belong together)
│        .clip-row → ClipCard[] (each with a "×" remove control)
│        .comp-add  <details> → list of non-member clips to add
└─ ScoreDetailsPanel (modal)                 components/ScoreDetailsPanel.tsx  (factor bars)
```

`ClipCard` (`components/ClipCard.tsx`) renders per clip: 9:16 video (poster =
thumbnail), 🔥 virality score + mood pill, native/English titles, caption,
hashtags, an inline `<details>` "score details" (chat/audio/visual/speech
factor bars), and the **"Open in Editor →"** link. In a compilation reel it also
shows a top-right **×** to remove the clip from that reel.

### State (single reducer)
`frontend/src/state/gridState.ts` — `GridState`:
- `clips: Clip[]`, `compilations: Compilation[]` — fetched from the server
- `sortOrder`, `compilationMode`, `activeScoreDetailsClipId`
- actions: `setClips`, `setCompilations`, `setSortOrder`, `setCompilationMode`,
  `addClipToCompilation`, `removeClipFromCompilation`, `setActiveScoreDetails`
- `deriveDisplayList(state)` → flat sorted list;
  `deriveCompilationGroups(state)` → resolves each `Compilation` to its member
  `Clip` objects (compilation curation is client-side only).

### Data flow
1. On mount: `getJob(jobId)` (`api/jobApi.ts`). When `status === "completed"`,
2. `listClips(jobId)` (`api/highlightsApi.ts`) → `GET /jobs/:id/clips` returns
   `{ clips, compilations }`.
3. Compilation reels come from `pipeline/compilations.py` output
   (`out/<stream>/clips/compilations.json`); the server maps it in
   `local-server/lib/manifest.mjs` → `loadCompilations()`.

---

## 2. The hand-off (deep link)

`ClipCard` builds (`frontend/src/api/config.ts` supplies the base + video id):
```
{VITE_EDITOR_BASE_URL}/editor/video/{videoId}/edit/{stream}__{clipId}
        (default :3100)                 │              │
                                        │              └─ e.g. clip_01  → scene id "3654414__clip_01"
                                        └─ videoId = VITE_EDITOR_VIDEO_ID or `video_{jobId}`
```
The clip id is **stream-scoped** (`{stream}__clip_NN`) so the editor's backend
can resolve which run a clip belongs to. This bypasses the editor's own
(removed) gallery and lands directly on one clip's editing session.

---

## 3. Editor — Next.js (OpenCut fork)

**Route:** `/editor/video/[video_id]/edit/[clip_id]/page.tsx`

### Component tree
```
VideoEditorPage
└─ VideoEditorProvider(videoId, initialClipId)     components/providers/video-editor-provider.tsx
   └─ RemoteClipsManager.loadVideo(...)            core/managers/remote-clips-manager.ts
      ├─ VideoEditorHeader                         components/editor/video-editor-header.tsx
      │  ├─ clip title
      │  ├─ AiAutoEditButton  ✨                    components/editor/ai-auto-edit-button.tsx
      │  ├─ ExportButton                           components/editor/export-button.tsx  (client-side render/download)
      │  └─ ThemeToggle
      └─ VideoEditorLayout (resizable panels)
         ├─ AssetsPanel        (left)              components/editor/panels/assets
         ├─ PreviewPanel       (center)            preview/components   (live 9:16 preview)
         ├─ AiEditPanel        (right-center)      components/editor/panels/ai-edit  (Bedrock agent, freeform)
         ├─ PropertiesPanel    (right)             components/editor/panels/properties
         ├─ ClipMetadataPanel  (far right)         components/editor/panels/clip-metadata  (hook/caption/hashtags 中文+EN)
         └─ Timeline           (bottom)            timeline/components
```

### How clips load
`RemoteClipsManager.loadVideo({ videoId, initialClipId })`:
1. `getVideoClips(videoId)` → `GET /api/videos/:id/clips` → one `Clip` per
   highlight (mapped from the run's `manifest.json`).
2. Each clip becomes a **scene** (`buildSceneForClip`) with its own probed media
   asset. The scene whose id matches `initialClipId` opens first.
3. **Clips open CLEAN** — no effects are baked in on load.

### The two "AI" surfaces in the editor (distinct)
- **✨ AI Auto-Edit button** (header, `ai-auto-edit-button.tsx`) — applies the
  **pipeline's precomputed auto-edit**. On click:
  `remoteClips.requestAiEdit({ clipId, { chipAction: "auto" } })` →
  `remoteClips.applyEdl({ edl })` (one undoable `ApplyEdlCommand`). It lays down
  reaction **zooms**, **camera pans**, **opacity fades**,
  **onomatopoeia burst captions** ("AI Zoom Captions" text track), and **SFX**
  ("AI SFX" audio track, from `public/sfx/*.wav`) — all as ordinary editable
  timeline elements. Effects source: the run's `out/<stream>/edl/clip_NN.edl.json`.
  That `effects[]` array is now generated by an **LLM brain**
  (`pipeline/autoedit_llm.py`, Bedrock/Claude) reasoning over the clip's
  transcript + audio/chat/visual signals, with the deterministic scipy detectors
  in `pipeline/autoedit.py` as a fallback (see `--autoedit-mode`). The effect
  vocabulary is the shared contract in `docs/contracts/edl.schema.json` — the LLM
  prompt and `apply-edl.ts` must agree on it. (The burned gallery-preview MP4 from
  `pipeline/render_autoedit.py` still only renders zoom/onomatopoeia/SFX; the new
  effect types show up in the editor, not that preview.)
- **AI Edit panel** (`panels/ai-edit`) — a **Bedrock LLM agent** for freeform /
  quick-action edits ("faster pacing", "add reaction zoom", …). Separate feature.

### EDL → editor primitives
`commands/timeline/element/apply-edl.ts` (`applyEdlEffectsToTracks` /
`ApplyEdlCommand`) turns an EDL into ordinary, user-editable timeline elements:
`punch-in-zoom` → scale keyframes; `onomatopoeia-caption` → text elements;
`sound` → library-audio elements. Nothing is a special renderer — every AI
decision is a normal element the creator can tweak or delete.

---

## 4. Server endpoints (mock server, `frontend/local-server/server.mjs`)

**SPA-shaped** (SPA calls these):
`POST /uploads/presign`, `PUT /mock-upload/:key`, `POST /uploads/confirm`,
`POST /jobs`, `GET /jobs/:id`, `GET /jobs/:id/clips` → `{ clips, compilations }`,
`GET /media/:stream/:file` (HTTP Range), WS `:3001` (progress).

**Editor-shaped** (`/api`, editor calls these; see `lib/editor-api.mjs`):
`GET /api/videos`, `GET /api/videos/:id/clips`, `POST /api/clips/:id/ai-edit`
(`chipAction:"auto"` returns the precomputed autoedit EDL),
`GET /api/clips/:id/status`, `POST /api/clips/:id/render`, `PATCH /api/clips/:id`.

**Stream resolution:** a clip/video id like `video_<jobId>` or `<jobId>__clip_NN`
is resolved to an on-disk `out/<streamId>/` dir via the in-memory job map
(`job.streamId`) or, as a fallback, by treating the id itself as the dir name.

---

## 5. Known demo gotchas

- **Restart the mock server after code changes** — it's plain Node with no
  watch, so edits to `server.mjs` / `lib/*.mjs` (e.g. serving compilations) only
  take effect on restart. The editor (Next) hot-reloads.
- **Duplicate `out/3654414*` stream dirs.** The cache matcher
  (`lib/cache.mjs`) binds an upload named `3654414…` to the plain `3654414`
  dir by leading-id match. Only re-generated streams contain
  `compilations.json` + populated `edl/` — an older/partial dir will show no
  compilations and "no auto-edit effects." Fix: re-run the pipeline for a clean,
  complete stream (see below).
- **Clip count** is `--top-clips` (now defaults to 12) in `pipeline/run.py`; the
  actual number is capped by how many candidates the Director marks `keep=true`.
  Cached streams keep whatever count they were rendered with — bump requires a
  re-run.

### Clean re-run (fixes clip count + compilations + auto-edit together)
```
python3 -m pipeline.run --video <vod.mp4> --chat-log <log.csv> \
    --s3-bucket <bucket> --stream-id <fresh-id> --top-clips 12
```
This produces `out/<fresh-id>/` with `clips/manifest.json`,
`clips/compilations.json`, and `edl/clip_NN.edl.json` (with autoedit effects),
all consistent.
