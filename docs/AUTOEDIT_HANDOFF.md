# AI Auto-Edit Engine — Handoff (Claude session ran out of usage mid-implementation)

**Read this whole file before touching code.** It is a complete, self-contained
transfer of everything a previous Claude Code session learned and decided
while scoping and starting to build this feature. The session was cut off
by a usage limit while mid-way through step 1 of an 11-step approved plan.
Nothing below is speculative — every architectural claim was verified by
directly reading the cited files in this repo.

## 1. What the user asked for

After a highlight clip is extracted by the existing pipeline, automatically
run an AI editing pass that:

1. **Zooms in on a person** when there's extensive laughter or loud sound
   coming from them.
2. Flashes **onomatopoeia-style captions** ("WHAT?!", "NO WAY") for a split
   second when there's a vocal accent/emphasis in the dialogue.
3. Auto-places **sound effects** matched to the scene's vibe (e.g. crickets
   after an awkward silence following dialogue).
4. Other potential "make it more viral" edits — **explicitly deferred**,
   out of scope until 1-3 are solid (user's own instruction).

**Mid-conversation addition that changed the design** (this is important,
don't miss it): the user also requires that every AI-made edit be
**adjustable, deletable, or added-onto by the user in the editor UI**
afterward — not baked in irreversibly. This single requirement is why the
plan below leans hard on materializing AI edits as *ordinary* timeline
elements rather than a locked/special overlay (see §3.2 for why that gets
the "adjustable" requirement for free in this specific codebase).

## 2. Repo architecture as discovered (verified by reading the actual files)

This is a hackathon project ("StreamSmith") with three tiers of maturity:

- **`pipeline/`** — real, runnable Python. Talks to actual AWS (Transcribe,
  Rekognition, Bedrock) + local ffmpeg. This is the part that actually works
  end-to-end today, driven by `pipeline/run.py`. **All new signal-detection
  code in this plan goes here.**
- **`.kiro/steering/architecture.md` + `.kiro/specs/webapp-skeleton/`** —
  spec-only description of an intended AWS Lambda/API Gateway/DynamoDB
  backend. Not implemented (stub Lambdas only, in `backend/`). Treat as
  target contract, not runnable code.
- **`apps/editor/`** — a vendored fork of `opencut-app/opencut-classic`
  (mature Next.js/TypeScript video editor with a Rust+WASM GPU effects
  renderer), adapted with a thin "highlight-api" mock backend
  (`apps/editor/apps/web/src/services/highlight-api/`) built specifically
  for this repo's contract. **All new editor-UI wiring in this plan goes
  here.**

Local pipeline flow (`pipeline/run.py`, already working, do not need to
modify its earlier stages):

```
chat log -> chat signals (local, pipeline/signals/chat.py)         \
VOD -> extract audio -> S3 -> Transcribe (pipeline/signals/transcript.py) |-> fusion.py (excitement curve,
VOD -> S3 -> Rekognition shots+faces (pipeline/signals/visual.py)  |    cross-modal validation)
local audio RMS/onset analysis (pipeline/signals/audio.py)         /
  -> candidates.json
  -> AI Director (pipeline/director.py, Bedrock Claude, multimodal judge) -> highlights.json
  -> pipeline/render.py (ffmpeg: crop/caption/hook burn-in) -> clips/*.mp4, thumbs, proxies
  -> pipeline/contracts.py + pipeline/edl.py -> clips/manifest.json, clips/clips.json, edl/*.edl.json
  -> pipeline/gallery.py -> clips/gallery.html  (NOT auto-invoked by run.py; standalone script)
  -> pipeline/publish.py (optional, --upload-s3 flag) -> S3 + presigned URLs
```

### The exact gap this feature fills

- `docs/contracts/edl.schema.json` already has an `effects[]` array
  (`type: "sound"|"visual"`, `at`, `duration`, `params`) explicitly flagged
  in its own description as **"FAST-FOLLOW... this array's shape is
  illustrative until that manifest is built."**
- `pipeline/edl.py`'s `build_edl()` (line ~73-111) always emits
  `"effects": []` — nothing populates it today.
- `.kiro/steering/architecture.md` names this whole stage **"5. AI
  auto-edit engine"** (line 138-142): *"Bedrock receives selected clips +
  the effects library manifest (each sound/visual effect described with
  metadata: name, type, duration, 'use when' guidance) and returns an Edit
  Decision List."* No effects library manifest exists anywhere in the repo
  yet — **we are building the first one.**
- Architecture non-negotiable (line 200-205, and restated in
  `docs/contracts/edl.schema.json`'s own `$id` description): **"Edits are
  data, not renders — only final export hits ffmpeg-on-Fargate."** This is
  why the plan treats the EDL `effects[]` array as the source of truth, with
  a burned-in MP4 as a secondary/demo convenience, not the primary output.
- `apps/editor/apps/web/src/commands/timeline/element/apply-edl.ts`
  (`ApplyEdlCommand`) already applies EDL `segments[]` → `VideoElement`s and
  `captions.overlays`/`hookOverlay` → `TextElement`s, but its own comment
  (lines 18-24) says: *"`edl.effects[]` is accepted but not yet visually
  applied (no effects-library manifest exists — same 'illustrative/
  fast-follow' status the real schema itself assigns that field)."*
  **This is the other half of the gap — we're extending this command.**

### Critical finding: `apps/editor` never reads the Python pipeline's EDL output today

Grepped the entire `apps/editor/apps/web/src` tree for
`edl\.json|loadEdl|initialEdl|fetchEdl|out/.*edl|clip_.*\.edl` — **zero
matches.** `RemoteClipsManager.loadVideo()`
(`apps/editor/apps/web/src/core/managers/remote-clips-manager.ts:58-120`)
builds each clip's scene purely from `getVideoClips({videoId})` (the
highlight-api client, backed by mock Next.js routes + hand-maintained
fixtures in `services/highlight-api/fixtures.ts`) — no EDL is loaded at
scene-build time at all.

The editor *does* have an "AI edit" feature, but it's two separate,
disconnected systems, **neither of which uses real audio-signal data**:

- **System A ("agentic", currently live in the UI):**
  `components/editor/panels/ai-edit/index.tsx` →
  `services/ai-agent/agent-runner.ts`'s `runAutonomousEdit()` → a Bedrock
  tool-use loop → `services/ai-agent/tool-executor.ts` executes each
  returned tool **immediately** against the live editor (its own docstring,
  `agent-runner.ts:17`: *"execute requested tools against the live editor
  immediately, no review gate — Ctrl+Z is the safety net"*). Tool catalog
  (`services/ai-agent/tool-catalog.ts`) has `trim_element`, `move_element`,
  `delete_elements`, `insert_text_element`, `add_blur_effect`, etc. — **no
  zoom or SFX tool exists today.**
- **System B ("EDL-based", has a review pattern, but wired to nothing in
  the UI):** `RemoteClipsManager.requestAiEdit()`
  (`remote-clips-manager.ts:286-294`) fetches an `Edl` *without* applying it
  (for review), and a separate `applyEdl({edl})` (296-301) applies it via
  `ApplyEdlCommand` only when called. Grepped the whole `components/`+`app/`
  tree for callers of `requestAiEdit`/`applyEdl`/`chipAction` — **found none
  outside `remote-clips-manager.ts` and `services/highlight-api/client.ts`
  themselves.** It's dead code from the UI's perspective today, but it's
  exactly the right extension point (see §3.3).

Both systems reason from **transcript text only**, via a live/mocked
Bedrock call — they cannot ground "laughter," "vocal emphasis," or
"silence" in real measured audio the way the user's request needs. **This
is why the real detection work must happen in the Python pipeline** (which
already has ffmpeg/waveform access via `pipeline/signals/audio.py`), not in
the editor's own LLM calls. The editor's job in this feature is only to
*apply* and let the user *edit* what the pipeline already detected.

### Editor internals relevant to "must be user-adjustable" (§1's added requirement)

Read in detail: `apps/editor/apps/web/src/timeline/types.ts`,
`timeline/components/timeline-element.tsx`,
`timeline/controllers/resize-controller.ts`,
`commands/timeline/element/{move-elements,delete-elements,insert-element}.ts`,
`commands/timeline/element/keyframes/upsert-keyframe.ts`,
`components/editor/panels/properties/registry.tsx`,
`animation/types.ts`, `effects/definitions/blur.ts`, `docs/effects-renderer.md`.

Findings:

- Timeline element types: `TrackType = "video"|"text"|"audio"|"graphic"|"effect"`.
  Every concrete element (`VideoElement`, `TextElement`, `AudioElement`,
  etc.) extends `BaseTimelineElement`, which carries
  `animations?: ElementAnimations` and `params: ParamValues`.
- **`ANIMATION_PROPERTY_PATHS`** (`animation/types.ts:4-19`) already
  includes `transform.scaleX`/`transform.scaleY`, with `linear`/`hold`/
  `bezier` interpolation and per-key bezier handles. **A punch-in zoom
  ("ease in → hold → ease out") is just 3-4 keyframes on an existing
  `VideoElement`'s `transform.scaleX`/`scaleY` — this needs ZERO new effect
  definition, ZERO new WGSL shader, ZERO Rust rebuild.** Committed via the
  existing generic `UpsertKeyframeCommand`
  (`commands/timeline/element/keyframes/upsert-keyframe.ts`).
- There IS an `EffectElement`/`"effect"` track type already
  (`timeline/types.ts:159-162`), but it's a **static, duration-scoped
  filter** (e.g. blur), not a keyframed property — not the right tool for
  zoom. Don't use it for this feature; use transform keyframing on the
  `VideoElement` instead (previous bullet).
- `apps/editor/apps/web/src/effects/definitions/` (⚠️ note:
  `docs/effects-renderer.md` says `lib/effects/definitions/` — **that path
  is stale/wrong**, the real path has no `lib/`) contains only `blur.ts` +
  `index.ts`. No Ken-Burns/zoom-over-time effect exists. Adding a genuinely
  new GPU shader effect requires a new WGSL file under
  `rust/crates/gpu/src/shaders/` + registration in `shader_registry.rs` +
  **a Rust rebuild** — avoid this path entirely for the zoom feature (use
  keyframing, previous bullets). Reserve the GPU-shader path only for an
  effect that truly can't be expressed as parameter keyframing (none of our
  three features need it).
- **Generic CRUD is confirmed fully type-agnostic** — this is the key
  enabler for "user can adjust/delete" being nearly free:
  - Select/drag: `timeline-element.tsx` — one shared wrapper handles
    `onMouseDown` for every element type; type-specific rendering is
    isolated to a small `ElementContent` switch that only affects what's
    drawn *inside* the block, not the drag/select wiring.
  - Move: `MoveElementCommand` operates on generic `TimelineElement`/
    `SceneTracks` unions, no per-type branching.
  - Resize: `ResizeController` produces generic `trimStart/trimEnd/
    startTime/duration` patches, type-agnostic.
  - Delete: the `"delete-selected"` keybinding calls
    `editor.timeline.deleteElements(...)` → `DeleteElementsCommand`, which
    filters by `{trackId, elementId}` — no type branching at all.
  - Insert: `InsertElementCommand` takes any of 7 `CreateTimelineElement`
    union members with only light per-type field validation.
  - **Undo/redo**: every command above follows one uniform pattern —
    snapshot `SceneTracks` in `execute()`, restore verbatim in `undo()`.
    Type-agnostic. `ApplyEdlCommand` already demonstrates the pattern for
    "one Ctrl+Z reverts a whole multi-element AI edit" — extend it, don't
    replace it.
- Properties panel (`components/editor/panels/properties/registry.tsx`,
  `getPropertiesConfig()`) is also generic: composes from shared tab
  builders (`buildTransformTab`, `buildTextTab`, `buildAudioTab`,
  `buildClipEffectsTab`, `buildStandaloneEffectTab`). A new element type
  needs only one config switch-case picking which existing tabs apply —
  the field-editing primitives themselves (`ElementParamsTab`,
  `PropertyParamField`, per-field keyframe toggles via
  `useKeyframedParamProperty`) already generalize over any param shape.

**Conclusion driving the whole design: if the new auto-edit engine
materializes its zoom/caption/SFX decisions as ordinary `VideoElement`
keyframes / `TextElement`s / `AudioElement`s on named tracks, the user gets
full select/move/resize/delete/undo — and a mostly-reused properties panel —
for free.** No bespoke "AI edit review UI" needs to be built. This is *why*
the plan doesn't propose new UI components beyond the `ApplyEdlCommand`
extension itself.

### Other repo facts that matter (don't rediscover these)

- **No `pipeline/requirements.txt` exists anywhere.** The pipeline runs on
  ambient installs of `numpy`, `scipy`, `pandas`, `boto3` — no pin file.
  Only `backend/requirements.txt` exists (CDK-scoped: `aws-cdk-lib`,
  `constructs` — unrelated to `pipeline/`).
- **Do not add `librosa`, `pydub`, or any new audio-DSP/ML dependency.**
  `docs/algorithm-decisions.md` §c.3 explicitly documents that the team
  already considered and **deliberately deferred** adding a YAMNet-based
  laughter/applause audio-event classifier, reasoning: *"integrating an
  unvalidated new ML model into pipeline code shortly before a hackathon
  demo carries real risk of breaking something that currently works, with
  no time budget to test it properly."* Stay within ffmpeg + numpy + scipy
  only, consistent with that prior decision. This is why the plan's
  detection logic is heuristic/signal-based (RMS energy + existing chat
  laugh-regex + existing Rekognition emotion data), not a new classifier.
- **Windows ffmpeg font gotcha** (`pipeline/render.py:27-64`): Gyan's
  ffmpeg-for-Windows build has no working fontconfig — both the `ass`
  filter's family-name lookup and `drawtext`'s `font=` family-name lookup
  **segfault** (not fail gracefully) instead. Existing workaround: address
  fonts by file path, not family name — `_local_font_file()` copies
  `C:\Windows\Fonts\mingliu.ttc` next to the render workdir and references
  it via `fontsdir=`/`fontfile=` with `.as_posix()` paths (ffmpeg's
  filtergraph parser treats backslash as an escape char, so native Windows
  paths embedded in `-vf` get mangled). **Any new burned-in text (the
  onomatopoeia captions' burned-in variant, the director's-cut render) must
  reuse this exact pattern (`_local_font_file()` in `render.py`) or it will
  crash on this machine.**
- **ffmpeg `-ss`/`-to` before `-i`** = input-seeking. `render_clip()`
  already uses this ordering for the real cut
  (`pipeline/render.py` ~line 220: `-ss <start_s> -to <end_s> -i <video>`).
  I used the same ordering in the new `rms_series_window()` (§4) for
  consistency — audio seeking this way is frame-accurate (audio has no
  keyframe/GOP structure like video), so this is safe and deliberate, not
  an oversight.
- **Clip-ID ordering contract**: `pipeline/gallery.py` has an explicit
  comment that clip ids must **order-match**
  `apps/editor/apps/web/src/services/highlight-api/fixtures.ts`. When
  wiring pipeline EDLs into `fixtures.ts` (plan step 2b/5), this ordering
  must be preserved or clips will show the wrong data in the editor.
- `docs/contracts/edl.schema.json` has `"additionalProperties": false` at
  the top level, but each `effects[]` entry's `params` is a free-form
  object (`{"type": "object"}`) — new effect-specific fields (`scale`,
  `text`, `style`, `assetKey`, `gainDb`) all nest inside `params` and need
  **no schema-file change**.
- **Effect naming/shape to match exactly** (so nothing needs re-negotiating
  on the TypeScript side): `apps/editor/apps/web/src/services/highlight-api/ai-edit-mock.ts`'s
  `buildEmphasisResponse()` (~lines 140-158) already prototyped:
  ```json
  {"effectId": "punch-in-zoom", "type": "visual", "at": <seconds>, "duration": 2,
   "params": {"scale": 1.3}}
  ```
  Use this exact `effectId` string and `type`/`params.scale` shape for the
  zoom effect. Additively extend `params` with `cx`/`cy` (crop target
  center) — safe since `params` is freeform, and the mock's version simply
  won't set them.
  For the two new effect shapes (not prototyped anywhere else — my design,
  free to adjust if needed):
  ```json
  {"effectId": "onomatopoeia-caption", "type": "visual", "at": .., "duration": 0.5,
   "params": {"text": "WHAT?!", "style": {"fontSize": 120, "burst": true}}}
  ```
  ```json
  {"effectId": "sfx-crickets", "type": "sound", "at": .., "duration": 3.0,
   "params": {"assetKey": "sfx/crickets_loop.wav", "gainDb": -6}}
  ```
- **Testing data available locally** (no source VOD exists anywhere under
  `data/` — cannot re-run the full `pipeline.run` orchestrator end-to-end in
  this environment):
  - `out/3654414-fast/` has all JSON artifacts: `highlights.json`,
    `transcript.json`, `visual_signals.json`, `chat_signals.json`,
    `candidates.json`, `audio_signals.json`, `clips/manifest.json`,
    `clips/clips.json`, `edl/clip_01.edl.json` … `edl/clip_05.edl.json`.
    Its `clips/` dir has only thumbnails (`.jpg`) + `gallery.html`, **no
    mp4s**.
  - `out/clips/` and `out/3654414-v2/clips/` **do** have real, playable
    rendered MP4s: `clip_01_funny.mp4` … `clip_05_funny.mp4` (plus
    `.proxy.mp4` variants). These are already-cut clips starting at local
    time 0 (not VOD-relative), so when testing new code against them,
    pass `start_s=0.0, end_s=<probed duration>`, not the original
    `highlights.json` VOD-relative timestamps.
  - `ffmpeg`/`ffprobe` are on PATH (Windows, confirmed at
    `/c/Users/Aaron/AppData/Local/Microsoft/WinGet/Links/ffmpeg`).
  - `apps/editor` uses Bun + Turbo (`bun.lock`, `turbo.json` present). Exact
    dev run command was **not yet confirmed** in this session — check
    `apps/editor/package.json` scripts and `apps/editor/README.md` before
    attempting to run it.

## 3. Decisions already confirmed with the user (do not re-ask these)

1. **Output path: BOTH.** EDL `effects[]` is the source of truth for the
   editor, **and** also produce a locally burned-in "director's cut" MP4
   (mirrors `render.py`'s existing caption/hook burn-in) so results are
   viewable without running the editor.
2. **SFX assets: small curated local set, bundled in-repo.** No external
   fetch/download tool is available in a Claude Code session for sourcing
   real licensed audio, so the plan is to **synthesize placeholder SFX via
   `ffmpeg -f lavfi`** tone/noise generation (crickets, comedic
   stinger/rimshot, whoosh, air-horn, record-scratch, tension riser) —
   deterministic, no licensing/download dependency, clearly labeled as
   placeholders to swap for real recorded/licensed audio later. Note
   `apps/editor/apps/web/src/sounds/` already has a working Freesound
   search/library (`freesound.ts`, `sounds-store.ts`, `SoundEffect`/
   `SavedSound` types) — that's the natural place to swap in real assets
   later; not needed for v1.
3. **Build order**: (1) shared fine-grained audio utility first (needed by
   multiple features) → (2) zoom-on-reaction **end-to-end** (detection → EDL
   → editor apply → confirm user-editable) before moving on → (3)
   onomatopoeia captions → (4) SFX/silence detection. "Other viral edits"
   stays explicitly out of scope until 1-3 are solid — don't add scope here
   without asking the user first.
4. **(Added mid-conversation, changes the design — see §2's "Conclusion"
   above)**: AI edits must be user-adjustable/deletable/addable in the
   editor UI. Satisfied by materializing edits as ordinary timeline
   elements, not a special locked overlay — confirmed this gets full CRUD
   editing for free in this specific editor's architecture.

## 4. Exact current state of the repo — what's already done

**Only one file has been modified so far**: `pipeline/signals/audio.py`.
This edit **was successfully applied** (confirmed by the Edit tool
succeeding) before the session was cut off. Current contents of the
relevant section (verify by reading the file — this is what should be
there):

```python
def rms_series_window(media_path, start_s=None, end_s=None, bin_seconds=BIN_SECONDS):
    """Per-bin RMS level (dB) via ffmpeg astats metadata prints, optionally
    scoped to [start_s, end_s] of media_path via input-seeking (same -ss/-to
    -i ordering pipeline.render.render_clip() already uses for cutting, so
    behavior stays consistent between what's measured and what's rendered).
    """
    n_samples = int(round(8000 * bin_seconds))
    cmd = ["ffmpeg", "-v", "error"]
    if start_s is not None:
        cmd += ["-ss", str(start_s)]
    if end_s is not None:
        cmd += ["-to", str(end_s)]
    cmd += [
        "-i", str(media_path), "-vn",
        "-af",
        f"aresample=8000,asetnsamples=n={n_samples}:p=0,"
        "astats=metadata=1:reset=1,"
        "ametadata=print:key=lavfi.astats.Overall.RMS_level:file=-",
        "-f", "null", "-",
    ]
    out = subprocess.run(cmd, check=True, capture_output=True, text=True).stdout
    levels = []
    for line in out.splitlines():
        if line.startswith("lavfi.astats.Overall.RMS_level="):
            v = line.split("=", 1)[1]
            levels.append(float(v) if v not in ("-inf", "nan") else -90.0)
    return np.clip(np.array(levels), -90.0, 0.0)


def rms_series(media_path, bin_seconds=BIN_SECONDS):
    """Per-bin RMS level (dB) for the whole media file."""
    return rms_series_window(media_path, bin_seconds=bin_seconds)


def clip_energy_series(video_path, start_s, end_s, bin_seconds=0.2):
    """Fine-grained RMS energy envelope scoped to one highlight clip's window
    (start_s/end_s are original-VOD timestamps, same convention as
    highlights.json). Clips are short (<=60s) so fine bins here are cheap,
    unlike a full-VOD fine-grained pass would be. t_s stays in original-VOD
    time (not clip-relative) to match highlights.json/transcript.json's
    convention; callers subtract start_s themselves, same as edl.py does.

    Feeds pipeline.autoedit's reaction-zoom / onomatopoeia spike detection.
    """
    levels = rms_series_window(video_path, start_s, end_s, bin_seconds)
    t_s = [round(start_s + i * bin_seconds, 3) for i in range(len(levels))]
    jump = np.diff(levels, prepend=levels[0] if len(levels) else 0.0)
    return {
        "t_s": t_s,
        "rms_db": [round(float(v), 2) for v in levels],
        "jump_db": [round(float(v), 2) for v in jump],
    }
```

What changed vs. the original file: the old `rms_series()`'s body was moved
into the new `rms_series_window()` with `-ss`/`-to` scoping added, plus a
**latent bug fix**: the old code built `f"n={8000 * bin_seconds}"` which
produces a float string like `"1600.0"` when `bin_seconds` is fractional
(e.g. `0.2`) — ffmpeg's `asetnsamples` expects an integer, so fine-grained
bins would have broken the ffmpeg command. Fixed with
`n_samples = int(round(8000 * bin_seconds))`. `rms_series()` itself is now a
thin wrapper (behavior-preserving — confirmed via grep that only
`audio.py`'s own `analyze()` function calls `rms_series`, so no other
caller anywhere in the repo needed updating).

### ⚠️ UNTESTED — do this first

**`clip_energy_series()` has not been verified to actually run correctly
yet.** The previous session was in the middle of running this exact
verification script when it was cut off:

```bash
python3 -c "
import sys
sys.path.insert(0, '.')
from pipeline.signals.audio import clip_energy_series
import subprocess, json

out = subprocess.run(['ffprobe','-v','error','-show_entries','format=duration','-of','json','out/clips/clip_01_funny.mp4'], capture_output=True, text=True)
dur = json.loads(out.stdout)['format']['duration']
print('duration', dur)

res = clip_energy_series('out/clips/clip_01_funny.mp4', 0.0, float(dur), bin_seconds=0.2)
print('bins:', len(res['t_s']))
print('first 5 t_s:', res['t_s'][:5])
print('first 5 rms_db:', res['rms_db'][:5])
print('first 5 jump_db:', res['jump_db'][:5])
print('max jump:', max(res['jump_db']))
"
```

Run this (or equivalent) first. Confirm: no ffmpeg errors, bin count is
roughly `duration / 0.2`, `rms_db` values are all within `[-90, 0]`. Only
then proceed to build `pipeline/autoedit.py` on top of it.

## 5. Full remaining task list, in order (nothing has been started beyond §4)

1. **[UNTESTED, finish this first]** Verify `clip_energy_series()` (§4).
2. **Build `pipeline/autoedit.py`** — new module, reaction-zoom detection +
   EDL effects emission. For each highlight in `highlights.json` (same set
   `render.py`/`edl.py` already iterate):
   - Call `clip_energy_series()` for the clip's window.
   - Find local peaks in the energy/jump curve; **corroborate each peak with
     ≥1 other existing signal** before accepting it as a "reaction" — either
     a chat `LAUGH_RE` hit near that timestamp (`pipeline/signals/chat.py`
     already has this regex — reuse it, don't reinvent) or a Rekognition
     `emotion_hot` face (`SURPRISED`/`HAPPY`, conf > 70 — already computed by
     `pipeline/signals/visual.py`, when visual signals are present). This
     mirrors `fusion.py`'s existing cross-modal-validation philosophy and
     avoids zooming on loud music/mic bumps with no human reaction.
   - For each confirmed spike, find the nearest face box in that window
     (reuse the pattern in `pipeline/render.py`'s `face_crop_x()`, scoped to
     a narrower window) for target `cx`/`cy`.
   - Emit `punch-in-zoom` effects using the **exact** shape in §2's "Effect
     naming/shape to match exactly" bullet.
   - `at`/timestamps in the emitted effect must be **clip-relative**
     (`timestamp - start_s`), matching the same pattern
     `pipeline/edl.py`'s existing `caption_overlays()`/`word_overlays()`
     already use (`round(max(0.0, seg["start_s"] - start_s), 3)`) — copy
     that pattern exactly, don't reinvent clamping/rounding logic.
3. **Wire into `pipeline/edl.py`** — `build_edl()` (line ~66-111) currently
   hardcodes `"effects": []`. Add one call into the new `autoedit` module to
   populate that list instead, for each clip.
4. **Extend `ApplyEdlCommand`**
   (`apps/editor/apps/web/src/commands/timeline/element/apply-edl.ts`) to
   handle `effects[]` entries with `effectId === "punch-in-zoom"`: locate the
   `VideoElement` (from the `videoElements` array already built in
   `execute()`) whose timeline span contains the effect's `at`, and add
   keyframes on `transform.scaleX`/`transform.scaleY` spanning
   `[at, at+duration]` (base scale → `params.scale` → base scale, ease
   in/hold/out) using the existing animation/keyframe infrastructure (see
   §2's `ANIMATION_PROPERTY_PATHS`/`UpsertKeyframeCommand` findings — do
   **not** build a new GPU effect for this). Keep this inside the same
   `execute()`/`undo()` pair so applying a whole AI edit is still one Ctrl+Z
   step, consistent with the file's existing pattern.
5. **Wire pipeline output into the editor's load path** (this is the
   "automatically runs after extraction" part — currently nothing does
   this, see §2's "Critical finding"):
   - Extend `apps/editor/apps/web/src/services/highlight-api/fixtures.ts`
     with an EDL-per-clip lookup sourced from the pipeline's real
     `edl/clip_NN.edl.json` output. **Preserve clip-id ordering** — see
     §2's "Clip-ID ordering contract" gotcha.
   - Add an `"auto"` action to `aiEditChipActionSchema` in
     `apps/editor/apps/web/src/services/highlight-api/schema.ts` so
     `requestAiEdit({clipId, request: {action: "auto"}})` returns the
     fixture EDL instead of going through `ai-edit-mock.ts`'s synthetic
     generator or a live Bedrock call.
   - In `RemoteClipsManager.loadVideo()`
     (`remote-clips-manager.ts:58-120`), right after each clip's scene is
     built (`buildSceneForClip`), automatically call
     `requestAiEdit(...action:"auto")` → `applyEdl({edl})` for that clip.
6. **Verify the zoom feature end-to-end** on the `out/3654414-fast` data
   before moving to onomatopoeia: run `pipeline.autoedit` standalone,
   inspect `edl/clip_01.edl.json`'s populated `effects[]`, then run
   `apps/editor` locally and confirm the zoom appears automatically on
   clip load and can be selected/dragged/resized/deleted/undone via the
   normal timeline UI.
7. **Onomatopoeia captions** — add detection to `pipeline/autoedit.py`:
   within the same energy curve, find sharp jumps aligned to a specific
   transcript word's timing (`transcript.json["words"]` — same data
   `pipeline/render.py`'s `build_ass_karaoke()` already consumes). Pick text
   from a small curated bank keyed by rough intensity ("WHAT?!", "NO WAY",
   "HAHA") — **deterministic/heuristic, do not add a new LLM call for this**
   (see §2's dependency-risk note). Emit `onomatopoeia-caption` effects
   (shape in §2).
8. **Extend `ApplyEdlCommand`** for `onomatopoeia-caption`: build a
   `TextElement` via the same `buildTextElement` helper already used for
   captions/hook in that file, short duration, burst styling from
   `params.style`, onto a new dedicated text track (e.g. "AI Zoom
   Captions"), following the exact find-or-create-track pattern already
   used for `CAPTIONS_TRACK_NAME` in the same file.
9. **SFX/silence detection** — add to `pipeline/autoedit.py`: find
   transcript gaps (>~1.2s) with low energy in the window; pick an SFX by
   simple heuristic off the clip's existing `mood` field (e.g. `funny` +
   silence → comedic stinger; default → crickets) — heuristic-only, same
   reasoning as step 7. Also build:
   - `config/effects_library.json` — new manifest matching
     `architecture.md` section 5's spec: one entry per `effectId` used
     across all three features, with `name`, `type`, `useWhen`,
     `defaultDuration`, and (for sound effects) `assetKey`.
   - `assets/sfx/*.wav` — synthesize ~6-8 placeholder SFX via
     `ffmpeg -f lavfi` tone/noise generation (crickets, stinger, whoosh,
     air-horn, record-scratch, tension riser) per §3.2's decision. Document
     clearly in the manifest that these are placeholders.
10. **Extend `ApplyEdlCommand`** for `type: "sound"` effects: build an
    `AudioElement` (library/source-url variant) onto a new "AI SFX" audio
    track at `at`, `sourceUrl` pointing at the served asset (decide how the
    asset gets served to the editor — likely a static path under
    `apps/editor`'s public assets, or copied alongside the fixture data).
11. **Burned-in "director's cut" reference render** (§3.1's "both" output
    decision) — extend `pipeline/render.py` (or a new
    `pipeline/render_autoedit.py` reusing its filter-building helpers) to
    optionally bake the same effects into a second ffmpeg render per clip:
    zoom via an animated crop/scale filter over `[at, at+duration]`,
    onomatopoeia via a second `drawtext` layer gated with
    `enable='between(t,..,..)'` (**must reuse the Windows font workaround**,
    §2), SFX mixed in via `-filter_complex amix` at the right offset.
    Output as `clip_NN_<mood>_autoedit.mp4` alongside the existing plain
    render. Small follow-on touch to `pipeline/gallery.py` to link/preview
    this second file if present.
12. Wire `pipeline.autoedit.emit(...)` into `pipeline/run.py`'s stage 10
    (right after the existing `edl_mod.emit(...)` call) so it runs
    automatically on every pipeline invocation — no new CLI flag needed.

**"Other viral edits" (item 4 from §1) stays explicitly deferred** — do not
add scope here without checking with the user first, per their own stated
build-order preference (§3.3).

## 6. Full original plan document (verbatim, for reference)

The plan below was written to `C:\Users\Aaron\.claude\plans\radiant-singing-hartmanis.md`
on the previous session's machine — a path **outside this repo**, which a
different agent/session will not be able to read. Reproduced verbatim here
so nothing is lost:

---

### AI Auto-Edit Engine — Zoom / Onomatopoeia / SFX

*(This section duplicates §1-§3 above in the original plan's own words —
kept for完整性/fidelity to what was actually approved by the user. If
anything here appears to conflict with §1-§5 above, prefer §1-§5, which
were written with more hindsight after the plan was already approved and
after `pipeline/signals/audio.py` was already edited.)*

Context, decisions, Part 1 (Python pipeline), Part 2 (apps/editor), build
order, and verification steps are as detailed in §1 through §5 above — this
handoff document is the complete, expanded version of that original plan
plus everything learned/decided since. No content from the original plan
file was left out; it has all been folded into the sections above.

---

## 7. How to resume

1. Read this whole file (done, if you're reading this).
2. Run the verification script in §4 to confirm `clip_energy_series()`
   works.
3. Proceed through the numbered list in §5 in order, checking off each step.
4. If you want to track progress with a todo list, recreate one matching
   §5's 12 items (the previous session's todo list had 11 items very close
   to this list — item 1 here splits "verify" out as its own explicit first
   step since it was left unverified).
5. Do not re-ask the user the questions already answered in §3 — those are
   settled. Do ask before expanding into §1 item 4 ("other viral edits") or
   before making any other scope-expanding decision not covered above.
