# User Flow Guideline — Live Stream Highlight Generator

This is the canonical product/UX flow. It defines *what the user experiences*;
see `architecture.md` for *how each step is built* on AWS. Keep the two in sync.

## The flow

### 1. Upload VODs
User uploads one or more VOD files (long livestream recordings).

### 2. Select target platforms
User picks the destinations: TikTok, Instagram Reels, YouTube Shorts.
Selection drives aspect ratio, duration caps, and formatting at export time.

### 3. Run highlight detection
The VOD runs through the novel highlight-detection algorithm.
Show a processing animation on the UI, driven by real pipeline progress.

### 4. Review detected highlights (grid)
Detected highlights are displayed in a grid, each showing a **virality score**
computed by the algorithm. In the grid the user can:
- Click into a highlight to crop it and confirm.
- Sort by score.
- View score details (the contributing factors).
- Multi-select highlights.

**4a. Compilation mode (grid menu):**
Automatically groups highlights by category (e.g. funny moments) so the user can
build a compilation instead of standalone clips.

**4b. Refine:**
The user can either continue with the highlights as-is, or prompt an LLM for
changes to individual ones:
- **Quick-action chips** for the 80% case: reorder, faster pacing, swap intro,
  more reactions.
- **Freeform prompt** for everything else.

### 5. AI auto-edit
Once confirmed, AI auto-edits all selected highlights or compilations. The system
provides built-in sound effects and visual effects, each with metadata describing
what it is and its common use-cases, so the LLM can choose appropriately.

### 6. Built-in video editor
After auto-editing, the user lands in a simple built-in video editor showing the
applied visual effects, sound effects, and music (if any), with the ability to
customize. (Forked from an open-source editor such as `openvideodev/react-video-editor`.)

### 7. Export
User exports an individual highlight or exports all.

### 8. Choose format + captions
User chooses the output format ("Social platforms", "Export raw file", etc.) and
can copy generated captions.

## Flow at a glance

```
Upload VODs
   → Select platforms (TikTok / Reels / Shorts)
      → Highlight detection (processing animation)
         → Highlights grid  ──┐  sort · score details · multi-select · crop/confirm
             │                └─ Compilation mode (group by category)
             │                └─ Refine: quick-action chips  OR  freeform LLM prompt
             → AI auto-edit (built-in SFX/VFX + music, LLM-driven)
                → Built-in video editor (customize)
                   → Export (single or all)
                      → Choose format + copy captions
```
