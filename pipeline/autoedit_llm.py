"""LLM auto-edit brain: Bedrock (Claude) reasons over a clip's multimodal
context and emits a sequenced, timestamped EDL effects[] list.

This is the LLM replacement for the deterministic scipy detectors in
pipeline/autoedit.py. It reuses the same signal helpers (audio energy peaks,
chat laugh, face boxes) to build a compact per-clip context, hands that plus the
OpenCut editing vocabulary to Claude via the Bedrock Converse API (same pattern
as pipeline/director.py), and validates the returned effects before they touch
disk. On ANY failure (no creds, Bedrock error, unparseable/empty output) it
returns None so the caller can fall back to the deterministic engine.

All emitted timestamps are CLIP-RELATIVE seconds, matching autoedit.py / edl.py.

The effect vocabulary here MUST stay in sync with what the editor's
apps/editor/apps/web/src/commands/timeline/element/apply-edl.ts can render, and
with docs/contracts/edl.schema.json.
"""

import json

import numpy as np
from scipy.signal import find_peaks

from pipeline.autoedit import (
    JUMP_THRESHOLD_DB,
    SFX_DEFAULT,
    SFX_MOOD_MAP,
    _clip_energy,
    _nearest_face_box,
)

REGION = "us-east-1"
MODEL_ID = "us.anthropic.claude-sonnet-4-6"

# --- Effect vocabulary (the contract with apply-edl.ts) --------------------

# The 6 real SFX assets under apps/editor/apps/web/public/sfx/. The LLM must
# choose an assetKey from this catalog; anything else is rewritten to the
# clip mood's default in validation.
SFX_CATALOG = sorted(
    {v["assetKey"] for v in SFX_MOOD_MAP.values()} | {SFX_DEFAULT["assetKey"]}
)

# Canonical sfx-* effectId per assetKey, so a valid asset always gets a tidy
# effectId regardless of what the LLM labeled it (editor track name uses it).
ASSET_TO_EFFECTID = {
    v["assetKey"]: v["effectId"]
    for v in list(SFX_MOOD_MAP.values()) + [SFX_DEFAULT]
}

VISUAL_EFFECT_IDS = {
    "punch-in-zoom",
    "onomatopoeia-caption",
    "camera-pan",
    "opacity-fade",
}

# Caps to keep the edit tasteful and protect the editor.
MAX_EFFECTS = 12
MAX_SFX = 2

SYSTEM = """\
You are a veteran short-form video editor for TikTok / IG Reels / YouTube Shorts,
fluent in Traditional Chinese and English. You are auto-editing ONE vertical
highlight clip cut from a livestream. You receive the clip's transcript, audio
energy spikes, live-chat laugh moments, and on-screen face positions — all in
CLIP-RELATIVE seconds (0 = clip start).

Design a punchy, tasteful edit and reply with ONLY a JSON object (no markdown
fence, no commentary):
{"effects": [ {effect}, ... ]}

Every effect has: "effectId", "type" ("visual" or "sound"), "at" (clip-relative
seconds), "duration" (seconds), "params" (object). Use ONLY these effectIds:

VISUAL (type "visual"):
- "punch-in-zoom": params {"scale": 1.1-1.8, "cx": 0-1, "cy": 0-1}
  Zoom in on a reaction. cx/cy = zoom center; target a face when one is on screen.
- "camera-pan": params {"fromX": -0.1..0.1, "fromY": -0.1..0.1, "toX": -0.1..0.1, "toY": -0.1..0.1}
  Slow push/drift. 0,0 = centered; keep values small (the frame overscans to stay in-bounds).
- "opacity-fade": params {"mode": "in" | "out" | "both"}
  Fade the shot in/out (good at the very start or very end of the clip).
- "onomatopoeia-caption": params {"text": "<short punchy caption, zh or en>",
  "style": {"fontSize": 20-36, "color": "#RRGGBB", "fontWeight": "bold"}}
  A small, punchy burst caption ON the beat of a laugh/gasp/impact. Keep it short.

SOUND (type "sound"):
- Pick effectId + assetKey from this exact catalog (assetKey must match one):
%s
  params {"assetKey": "<one of the above>", "gainDb": -10..-3}
  Drop 0-2 SFX on comedic beats or into silent gaps. Never overlap dialogue with loud SFX.

Rules:
- Place effects ON the energy spikes / laugh moments you are given — that is where
  the emphasis is. Space them out; do not stack many effects at the same instant.
- Keep every "at" within the clip and "at" + "duration" <= clip length.
- At most %d effects total, at most %d SFX.
- If the clip is calm filler, it's fine to return only 1-2 subtle effects.""" % (
    "\n".join(f"    {k}" for k in SFX_CATALOG),
    MAX_EFFECTS,
    MAX_SFX,
)


def _peaks_clip_relative(highlight, video_path, bin_seconds=0.2):
    """Audio energy jump peaks as [(t_clip, jump_db)], clip-relative."""
    start_s = highlight["start_s"]
    end_s = highlight["end_s"]
    try:
        energy = _clip_energy(video_path, start_s, end_s, bin_seconds)
    except Exception:
        return []
    t_arr = np.array(energy["t_s"])
    jump_arr = np.array(energy["jump_db"])
    if len(jump_arr) == 0:
        return []
    idxs, _ = find_peaks(jump_arr, height=JUMP_THRESHOLD_DB,
                         distance=int(1.5 / bin_seconds))
    peaks = []
    for i in idxs:
        t_clip = round(max(0.0, float(t_arr[i]) - start_s), 2)
        peaks.append((t_clip, round(float(jump_arr[i]), 1)))
    return peaks


def build_clip_context(highlight, video_path, transcript=None, visual=None,
                       chat_signals=None):
    """Assemble a compact, LLM-friendly text context for one clip."""
    start_s = highlight["start_s"]
    end_s = highlight["end_s"]
    dur = round(end_s - start_s, 2)
    lines = [
        f"Clip length: {dur:.1f}s | mood: {highlight.get('mood', '?')} | "
        f"virality: {highlight.get('virality_score', '?')}",
    ]

    peaks = _peaks_clip_relative(highlight, video_path)
    if peaks:
        lines.append("AUDIO ENERGY SPIKES (t=clip-seconds, louder=bigger jump):")
        lines.append(", ".join(f"{t:.1f}s(+{j:.0f}dB)" for t, j in peaks[:20]))

    # Transcript segments in window, clip-relative
    if transcript and transcript.get("segments"):
        segs = [s for s in transcript["segments"]
                if s["end_s"] >= start_s and s["start_s"] <= end_s]
        if segs:
            lines.append("TRANSCRIPT:")
            for s in segs[:30]:
                t = max(0.0, s["start_s"] - start_s)
                lines.append(f"[{t:.1f}s] {s.get('text', '')}")

    # Chat laugh moments in window, clip-relative
    if chat_signals and chat_signals.get("series"):
        series = chat_signals["series"]
        t_bins = series.get("t_s", [])
        laugh = series.get("laugh", [])
        moments = [
            round(t_bins[i] - start_s, 1)
            for i in range(min(len(t_bins), len(laugh)))
            if start_s <= t_bins[i] <= end_s and laugh[i] > 0
        ]
        if moments:
            lines.append("CHAT LAUGH MOMENTS (t=clip-seconds): "
                         + ", ".join(f"{m:.0f}s" for m in moments[:20]))

    # On-screen faces sampled in window, clip-relative
    if visual and visual.get("faces"):
        faces = [f for f in visual["faces"] if start_s <= f["t_s"] <= end_s]
        if faces:
            lines.append("ON-SCREEN FACES (t: emotion @ center):")
            for f in faces[::max(1, len(faces) // 8)][:8]:
                t = round(f["t_s"] - start_s, 1)
                box = f["box"]
                cx = round(box["Left"] + box["Width"] / 2, 2)
                cy = round(box["Top"] + box["Height"] / 2, 2)
                lines.append(f"[{t:.1f}s] {f.get('emotion', '?')} @ ({cx},{cy})")

    return "\n".join(lines), dur


# --- Validation (safety boundary) ------------------------------------------

def _num(v, default=None):
    return float(v) if isinstance(v, (int, float)) else default


def _clamp(v, lo, hi):
    return max(lo, min(hi, v))


def validate_effects(raw_effects, clip_duration, mood=""):
    """Filter/clamp LLM effects into a safe, renderable list."""
    if not isinstance(raw_effects, list):
        return []
    out = []
    sfx_count = 0
    default_sfx = SFX_MOOD_MAP.get(mood, SFX_DEFAULT)

    for e in raw_effects:
        if not isinstance(e, dict):
            continue
        eid = e.get("effectId")
        etype = e.get("type")
        at = _num(e.get("at"))
        dur = _num(e.get("duration"))
        if at is None or dur is None or dur <= 0:
            continue
        at = _clamp(at, 0.0, max(0.0, clip_duration))
        dur = min(dur, max(0.1, clip_duration - at))
        if dur < 0.1:
            continue
        params = e.get("params") if isinstance(e.get("params"), dict) else {}

        if etype == "sound":
            if sfx_count >= MAX_SFX:
                continue
            asset = params.get("assetKey")
            if asset not in SFX_CATALOG:
                asset = default_sfx["assetKey"]
            gain = _num(params.get("gainDb"), -6)
            out.append({
                # Canonical sfx-* effectId derived from the asset, not the LLM label.
                "effectId": ASSET_TO_EFFECTID.get(asset, default_sfx["effectId"]),
                "type": "sound",
                "at": round(at, 3), "duration": round(dur, 3),
                "params": {"assetKey": asset, "gainDb": _clamp(gain, -20, 0)},
            })
            sfx_count += 1
            continue

        if etype != "visual" or eid not in VISUAL_EFFECT_IDS:
            continue

        p = {}
        if eid == "punch-in-zoom":
            p["scale"] = round(_clamp(_num(params.get("scale"), 1.3), 1.0, 2.0), 3)
            cx = _num(params.get("cx"))
            cy = _num(params.get("cy"))
            if cx is None or cy is None:
                cx, cy = 0.5, 0.4  # centered-ish default
            p["cx"] = round(_clamp(cx, 0.0, 1.0), 4)
            p["cy"] = round(_clamp(cy, 0.0, 1.0), 4)
        elif eid == "camera-pan":
            for k, d in (("fromX", 0.0), ("fromY", 0.0), ("toX", 0.0), ("toY", 0.0)):
                p[k] = round(_clamp(_num(params.get(k), d), -0.1, 0.1), 4)
        elif eid == "opacity-fade":
            mode = params.get("mode")
            p["mode"] = mode if mode in ("in", "out", "both") else "in"
        elif eid == "onomatopoeia-caption":
            text = params.get("text")
            if not isinstance(text, str) or not text.strip():
                continue
            style_in = params.get("style") if isinstance(params.get("style"), dict) else {}
            style = {"fontSize": int(_clamp(_num(style_in.get("fontSize"), 28), 16, 40)),
                     "burst": True}
            for k in ("color", "fontFamily", "fontWeight", "background"):
                if k in style_in:
                    style[k] = style_in[k]
            p["text"] = text.strip()
            p["style"] = style

        out.append({
            "effectId": eid, "type": "visual",
            "at": round(at, 3), "duration": round(dur, 3), "params": p,
        })

    out.sort(key=lambda e: e["at"])
    return out[:MAX_EFFECTS]


# --- Generation ------------------------------------------------------------

def generate(highlight, video_path, transcript=None, visual=None,
             chat_signals=None, brt=None):
    """Return a validated effects[] list for one clip, or None on failure.

    Pass a shared boto3 bedrock-runtime client via `brt` to reuse it across
    clips; if omitted, one is created per call.
    """
    try:
        context, dur = build_clip_context(highlight, video_path, transcript,
                                          visual, chat_signals)
        if brt is None:
            import boto3
            brt = boto3.client("bedrock-runtime", region_name=REGION)

        resp = brt.converse(
            modelId=MODEL_ID,
            system=[{"text": SYSTEM}],
            messages=[{"role": "user", "content": [{"text": context}]}],
            inferenceConfig={"maxTokens": 1200, "temperature": 0.4},
        )
        raw = resp["output"]["message"]["content"][0]["text"]
        parsed = json.loads(raw[raw.index("{"): raw.rindex("}") + 1])
        effects = validate_effects(parsed.get("effects", []), dur,
                                   highlight.get("mood", ""))
        return effects or None
    except Exception:
        return None
