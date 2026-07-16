"""AI auto-edit engine: reaction-zoom, onomatopoeia captions, and SFX placement.

Analyzes each highlight clip's audio energy envelope (via clip_energy_series()),
corroborates peaks with chat laugh signals and/or Rekognition face emotions, then
emits EDL effects[] entries (punch-in-zoom, onomatopoeia-caption, sfx) that the
editor's ApplyEdlCommand can render as ordinary user-editable timeline elements.

All timestamps in emitted effects are CLIP-RELATIVE (seconds from clip start),
matching the same pattern pipeline/edl.py's caption_overlays()/word_overlays() use.

Usage:
  python3 -m pipeline.autoedit out/3654414-fast/highlights.json \
      --video out/clips/clip_01_funny.mp4 \
      --transcript out/3654414-fast/transcript.json \
      --visual out/3654414-fast/visual_signals.json \
      --chat out/3654414-fast/chat_signals.json \
      --outdir out/3654414-fast/edl
"""

import argparse
import json
import sys
from pathlib import Path

import numpy as np
from scipy.signal import find_peaks

from pipeline.signals.audio import clip_energy_series

# ---------------------------------------------------------------------------
# Config: tuneable without code changes
# ---------------------------------------------------------------------------

# Minimum jump_db to consider as a candidate reaction peak
JUMP_THRESHOLD_DB = 12.0

# Minimum separation (seconds) between successive zoom events
MIN_ZOOM_GAP_S = 3.0

# Zoom effect parameters
ZOOM_DURATION_S = 2.0
ZOOM_SCALE = 1.3

# Onomatopoeia: minimum jump to trigger a burst caption
ONOMATOPOEIA_JUMP_THRESHOLD_DB = 15.0
# Minimum gap between successive onomatopoeia captions
MIN_ONOMATOPOEIA_GAP_S = 2.5
ONOMATOPOEIA_DURATION_S = 0.8

# SFX silence detection
SILENCE_GAP_S = 1.2         # minimum transcript gap to count as "silence"
SILENCE_RMS_CEIL_DB = -40.0  # max RMS to qualify as quiet
SFX_DURATION_DEFAULT_S = 3.0

# Onomatopoeia text bank keyed by rough intensity bucket
ONOMATOPOEIA_BANK = {
    "high": ["WHAT?!", "NO WAY!", "OMG!!", "太扯了!", "笑死!"],
    "medium": ["哈哈哈!", "HAHA!", "真的假的?!", "不會吧!"],
    "low": ["哇!", "欸!", "嗯?!"],
}

# SFX selection by mood (maps highlight mood -> effectId + asset)
SFX_MOOD_MAP = {
    "funny": {"effectId": "sfx-comedic-stinger", "assetKey": "sfx/comedic_stinger.wav", "gainDb": -4},
    "hype": {"effectId": "sfx-air-horn", "assetKey": "sfx/air_horn.wav", "gainDb": -8},
    "emotional": {"effectId": "sfx-tension-riser", "assetKey": "sfx/tension_riser.wav", "gainDb": -6},
    "impressive": {"effectId": "sfx-whoosh", "assetKey": "sfx/whoosh.wav", "gainDb": -5},
    "wholesome": {"effectId": "sfx-crickets", "assetKey": "sfx/crickets_loop.wav", "gainDb": -6},
    "controversial": {"effectId": "sfx-record-scratch", "assetKey": "sfx/record_scratch.wav", "gainDb": -5},
}
SFX_DEFAULT = {"effectId": "sfx-crickets", "assetKey": "sfx/crickets_loop.wav", "gainDb": -6}


# ---------------------------------------------------------------------------
# Corroboration helpers
# ---------------------------------------------------------------------------

def _chat_laugh_near(chat_signals, t_s, window_s=2.5, bin_seconds=5):
    """Check if chat laugh count is elevated near timestamp t_s (VOD-relative)."""
    if not chat_signals:
        return False
    series = chat_signals.get("series", {})
    laugh = series.get("laugh", [])
    t_bins = series.get("t_s", [])
    if not laugh or not t_bins:
        return False
    for i, t_bin in enumerate(t_bins):
        if abs(t_bin - t_s) <= window_s:
            if laugh[i] > 0:
                return True
    return False


def _face_emotion_near(visual, t_s, window_s=2.0):
    """Check if a SURPRISED/HAPPY face (conf>70) exists near t_s (VOD-relative)."""
    if not visual:
        return False
    faces = visual.get("faces", [])
    for f in faces:
        if abs(f["t_s"] - t_s) <= window_s:
            if f["emotion"] in ("SURPRISED", "HAPPY") and f["emotion_conf"] > 70:
                return True
    return False


def _nearest_face_box(visual, t_s, window_s=3.0):
    """Find the nearest face bounding box to t_s, return (cx, cy) in 0..1 coords."""
    if not visual:
        return 0.5, 0.4  # default center
    faces = visual.get("faces", [])
    best = None
    best_dt = float("inf")
    for f in faces:
        dt = abs(f["t_s"] - t_s)
        if dt < best_dt and dt <= window_s:
            best_dt = dt
            best = f
    if best is None:
        return 0.5, 0.4
    box = best["box"]
    cx = box["Left"] + box["Width"] / 2
    cy = box["Top"] + box["Height"] / 2
    return round(cx, 4), round(cy, 4)


# ---------------------------------------------------------------------------
# Reaction-zoom detection
# ---------------------------------------------------------------------------

def _probe_duration(video_path):
    """Get media file duration in seconds via ffprobe."""
    import subprocess
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration",
         "-of", "json", str(video_path)],
        capture_output=True, text=True, check=True,
    )
    return float(json.loads(out.stdout)["format"]["duration"])


def _clip_energy(video_path, start_s, end_s, bin_seconds=0.2):
    """Get clip energy, handling pre-cut clips (start at t=0) vs the full VOD.

    The returned t_s is always in VOD-relative time (start_s + i*bin) so it can
    be corroborated against chat/face/transcript signals, which are all in
    VOD time.

    Detection: if the media file is shorter than the highlight's END timestamp,
    it cannot be the source VOD (which must contain footage up to end_s) — so
    it's a pre-cut clip and we analyze 0..file_duration. Otherwise it's the
    source VOD and we seek [start_s, end_s]. This is robust even when the clip
    length equals the window length (the old `file_dur < duration*0.8` check
    broke in that case, seeking past a short clip's end and returning nothing).
    """
    duration = end_s - start_s
    try:
        file_dur = _probe_duration(video_path)
    except Exception:
        file_dur = duration

    is_precut = file_dur < end_s - 1.0  # -1s tolerance for rounding
    if is_precut:
        # Pre-cut clip: analyze from 0, relabel t_s as VOD-relative
        energy = clip_energy_series(video_path, 0.0, min(file_dur, duration + 1.0), bin_seconds)
        energy["t_s"] = [round(start_s + i * bin_seconds, 3)
                         for i in range(len(energy["rms_db"]))]
    else:
        energy = clip_energy_series(video_path, start_s, end_s, bin_seconds)

    return energy


def detect_reaction_zooms(highlight, video_path, chat_signals, visual, bin_seconds=0.2):
    """Detect confirmed reaction peaks and emit punch-in-zoom effects.

    A peak is confirmed only if corroborated by at least one other modality:
    chat laugh spike OR Rekognition SURPRISED/HAPPY face near the same timestamp.
    """
    start_s = highlight["start_s"]
    end_s = highlight["end_s"]

    energy = _clip_energy(video_path, start_s, end_s, bin_seconds)
    t_s_arr = np.array(energy["t_s"])
    jump_arr = np.array(energy["jump_db"])

    # Find peaks in jump curve
    peak_indices, _ = find_peaks(jump_arr, height=JUMP_THRESHOLD_DB,
                                  distance=int(MIN_ZOOM_GAP_S / bin_seconds))

    effects = []
    last_zoom_t = -999.0

    for idx in peak_indices:
        t_vod = t_s_arr[idx]  # VOD-relative timestamp

        # Enforce minimum gap
        if t_vod - last_zoom_t < MIN_ZOOM_GAP_S:
            continue

        # Cross-modal validation: need at least one corroborating signal
        has_chat = _chat_laugh_near(chat_signals, t_vod)
        has_face = _face_emotion_near(visual, t_vod)

        if not has_chat and not has_face:
            continue

        # Convert to clip-relative time (same pattern as edl.py)
        t_clip = round(max(0.0, t_vod - start_s), 3)

        # Find nearest face for zoom target
        cx, cy = _nearest_face_box(visual, t_vod)

        effects.append({
            "effectId": "punch-in-zoom",
            "type": "visual",
            "at": t_clip,
            "duration": ZOOM_DURATION_S,
            "params": {
                "scale": ZOOM_SCALE,
                "cx": cx,
                "cy": cy,
            },
        })
        last_zoom_t = t_vod

    return effects


# ---------------------------------------------------------------------------
# Onomatopoeia caption detection
# ---------------------------------------------------------------------------

def detect_onomatopoeia(highlight, video_path, transcript, bin_seconds=0.2):
    """Detect sharp energy jumps aligned to transcript words and emit
    onomatopoeia-caption effects with text from a curated bank."""
    start_s = highlight["start_s"]
    end_s = highlight["end_s"]

    energy = _clip_energy(video_path, start_s, end_s, bin_seconds)
    t_s_arr = np.array(energy["t_s"])
    jump_arr = np.array(energy["jump_db"])

    # Find high-intensity peaks
    peak_indices, props = find_peaks(jump_arr, height=ONOMATOPOEIA_JUMP_THRESHOLD_DB,
                                      distance=int(MIN_ONOMATOPOEIA_GAP_S / bin_seconds))

    if len(peak_indices) == 0:
        return []

    # Get transcript words in this clip's window
    words = []
    if transcript and transcript.get("words"):
        words = [w for w in transcript["words"]
                 if w["end_s"] >= start_s and w["start_s"] <= end_s]

    effects = []
    text_idx = 0  # rotate through bank

    for idx in peak_indices:
        t_vod = t_s_arr[idx]
        t_clip = round(max(0.0, t_vod - start_s), 3)
        jump_val = jump_arr[idx]

        # The energy jump peak IS the vocal emphasis — the caption should hit
        # right AT that moment. Appear a hair (0.08s) before the peak so it's
        # already on-screen as the sound lands, rather than snapping to a
        # word-start that could be up to 0.5s away from the actual emphasis.
        aligned_t = round(max(0.0, t_clip - 0.08), 3)

        # Optionally refine to a word start ONLY if one lands very close
        # (<0.15s) to the peak — keeps phrasing tidy without drifting off-beat.
        for w in words:
            w_clip_t = round(max(0.0, w["start_s"] - start_s), 3)
            if abs(w_clip_t - t_clip) < 0.15:
                aligned_t = w_clip_t
                break

        # Pick text by intensity
        if jump_val > 25:
            bucket = "high"
        elif jump_val > 18:
            bucket = "medium"
        else:
            bucket = "low"

        bank = ONOMATOPOEIA_BANK[bucket]
        text = bank[text_idx % len(bank)]
        text_idx += 1

        effects.append({
            "effectId": "onomatopoeia-caption",
            "type": "visual",
            "at": aligned_t,
            "duration": ONOMATOPOEIA_DURATION_S,
            "params": {
                "text": text,
                "style": {"fontSize": 120, "burst": True},
            },
        })

    return effects


# ---------------------------------------------------------------------------
# SFX / silence detection
# ---------------------------------------------------------------------------

def detect_sfx_placements(highlight, transcript, bin_seconds=0.2):
    """Find transcript gaps (silence) and place contextual SFX.

    Uses the highlight's mood field to pick an appropriate sound effect.
    """
    start_s = highlight["start_s"]
    end_s = highlight["end_s"]
    mood = highlight.get("mood", "")

    # Get transcript words/segments in window to find gaps
    segments = []
    if transcript and transcript.get("segments"):
        segments = [s for s in transcript["segments"]
                    if s["end_s"] >= start_s and s["start_s"] <= end_s]

    if not segments:
        return []

    # Sort segments by start time
    segments = sorted(segments, key=lambda s: s["start_s"])

    # Find gaps between consecutive segments
    effects = []
    sfx_info = SFX_MOOD_MAP.get(mood, SFX_DEFAULT)

    for i in range(len(segments) - 1):
        gap_start = segments[i]["end_s"]
        gap_end = segments[i + 1]["start_s"]
        gap_duration = gap_end - gap_start

        if gap_duration < SILENCE_GAP_S:
            continue

        # Place SFX slightly after the silence starts (0.3s in)
        t_vod = gap_start + 0.3
        t_clip = round(max(0.0, t_vod - start_s), 3)

        # Limit SFX duration to not exceed gap
        sfx_dur = min(SFX_DURATION_DEFAULT_S, round(gap_duration - 0.3, 1))
        if sfx_dur < 0.5:
            continue

        effects.append({
            "effectId": sfx_info["effectId"],
            "type": "sound",
            "at": t_clip,
            "duration": sfx_dur,
            "params": {
                "assetKey": sfx_info["assetKey"],
                "gainDb": sfx_info["gainDb"],
            },
        })

    # Limit to max 2 SFX per clip to avoid over-editing
    return effects[:2]


# ---------------------------------------------------------------------------
# Main entry: compute all auto-edit effects for one highlight
# ---------------------------------------------------------------------------

def autoedit_effects(highlight, video_path, transcript=None, visual=None,
                     chat_signals=None, bin_seconds=0.2):
    """Compute all AI auto-edit effects for a single highlight clip.

    Returns a list of effect dicts ready to be inserted into edl['effects'].
    """
    effects = []

    # 1. Reaction zooms
    zooms = detect_reaction_zooms(highlight, video_path, chat_signals, visual, bin_seconds)
    effects.extend(zooms)

    # 2. Onomatopoeia captions
    onomat = detect_onomatopoeia(highlight, video_path, transcript, bin_seconds)
    effects.extend(onomat)

    # 3. SFX placements
    sfx = detect_sfx_placements(highlight, transcript, bin_seconds)
    effects.extend(sfx)

    # Sort by time
    effects.sort(key=lambda e: e["at"])

    return effects


# ---------------------------------------------------------------------------
# Batch emit: process all highlights, update EDL files in place
# ---------------------------------------------------------------------------

def _make_bedrock_client():
    """Create a shared bedrock-runtime client, or None if unavailable."""
    try:
        import boto3

        from pipeline.autoedit_llm import REGION
        return boto3.client("bedrock-runtime", region_name=REGION)
    except Exception:
        return None


def emit(highlights_path, video_path, outdir, transcript_path=None,
         visual_path=None, chat_path=None, top=None, mode="auto"):
    """Run autoedit on all highlights and update existing EDL files with effects.

    If video_path is a single clip file (e.g. out/clips/clip_01_funny.mp4),
    processes only that clip with start_s=0, end_s=duration.
    If video_path points to the source VOD, processes all clips using their
    VOD-relative timestamps from highlights.json.

    mode:
      "auto"  — LLM brain (pipeline/autoedit_llm) per clip, falling back to the
                deterministic detectors on any failure/missing creds (default).
      "llm"   — LLM only; if a clip's LLM call fails, its effects are empty.
      "rules" — deterministic scipy detectors only (original behavior).

    Each returned tuple is (clip_id, n_effects, source) where source is
    "llm" or "rules".
    """
    highlights = json.loads(Path(highlights_path).read_text(encoding="utf-8"))["highlights"]
    if top:
        highlights = highlights[:top]

    transcript = (json.loads(Path(transcript_path).read_text(encoding="utf-8"))
                  if transcript_path and Path(transcript_path).exists() else None)
    visual = (json.loads(Path(visual_path).read_text(encoding="utf-8"))
              if visual_path and Path(visual_path).exists() else None)
    chat_signals = (json.loads(Path(chat_path).read_text(encoding="utf-8"))
                    if chat_path and Path(chat_path).exists() else None)

    llm_gen = None
    brt = None
    if mode in ("auto", "llm"):
        try:
            from pipeline import autoedit_llm as llm_gen  # noqa: F401
            brt = _make_bedrock_client()
        except Exception:
            llm_gen = None

    outdir = Path(outdir)
    updated = []

    for i, hl in enumerate(highlights, 1):
        clip_id = f"clip_{i:02d}"
        edl_path = outdir / f"{clip_id}.edl.json"

        if not edl_path.exists():
            continue

        # Compute effects: LLM brain first (auto/llm), else deterministic.
        effects = None
        source = "rules"
        if llm_gen is not None and brt is not None:
            effects = llm_gen.generate(hl, video_path, transcript, visual,
                                       chat_signals, brt=brt)
            if effects:
                source = "llm"
        if not effects:
            if mode == "llm":
                effects = []           # llm-only: no rules fallback
            else:
                effects = autoedit_effects(hl, video_path, transcript, visual,
                                           chat_signals)
                source = "rules"

        # Update EDL in place
        edl = json.loads(edl_path.read_text(encoding="utf-8"))
        edl["effects"] = effects
        edl_path.write_text(json.dumps(edl, ensure_ascii=False, indent=1),
                            encoding="utf-8")
        updated.append((clip_id, len(effects), source))

    return updated


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("highlights", help="Path to highlights.json")
    ap.add_argument("--video", required=True, help="Source VOD or single clip path")
    ap.add_argument("--transcript", default=None)
    ap.add_argument("--visual", default=None)
    ap.add_argument("--chat", default=None)
    ap.add_argument("--outdir", required=True, help="Directory with existing EDL files")
    ap.add_argument("--top", type=int, default=None)
    ap.add_argument("--mode", choices=["auto", "llm", "rules"], default="auto",
                    help="auto: LLM brain w/ deterministic fallback (default); "
                         "llm: LLM only; rules: deterministic detectors only")
    args = ap.parse_args(argv)

    updated = emit(args.highlights, args.video, args.outdir,
                   args.transcript, args.visual, args.chat, args.top,
                   mode=args.mode)
    for clip_id, n, source in updated:
        print(f"  {clip_id}: {n} effects ({source})")
    print(f"Updated {len(updated)} EDLs in {args.outdir}/")


if __name__ == "__main__":
    sys.exit(main())
