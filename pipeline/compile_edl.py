"""Compilation-reel auto-editor: turn ONE themed compilation (a group of
already-selected highlight clips, see pipeline/compilations.py) into a single
multi-clip Edit Decision List the built-in editor can open — the cross-clip
analogue of pipeline/autoedit.py's single-clip EDL.

Where pipeline/edl.py emits one EDL per clip (one segment, its own footage),
this concatenates a reel's member clips onto ONE timeline: a segment per clip
laid end to end, transitions between them, and light per-clip emphasis (an
opening hook + reaction zooms) chosen to match the reel's overall VIBE — the
dominant mood/category of its clips. That "vibe" framing is the whole point:
a "hype" reel gets punchy whip-pan cuts and reaction zooms, an "emotional"
one gets gentle crossfades and fades, etc.

Two-tier by design, mirroring apps/editor's ai-edit route: a real Bedrock
(Claude) call plans the reel when AWS is configured, and a deterministic
vibe-based planner stands in otherwise, so the request -> compile -> open loop
stays runnable without AWS access. A Bedrock failure falls back to the
deterministic plan rather than erroring the whole compile.

Output shape matches docs/contracts/edl.schema.json (the same contract
pipeline/edl.py writes and apps/editor/.../apply-edl.ts renders), with
segments[].clipId referencing the member clips (clip_NN) so the editor can
resolve each segment to that clip's own probed footage.

Usage:
  python3 -m pipeline.compile_edl out/3654414-fast/clips/manifest.json \
      --compilations out/3654414-fast/clips/compilations.json \
      --compilation-id comp_01 \
      --out out/3654414-fast/edl/compilation_comp_01.edl.json
"""

import argparse
import json
import sys
from pathlib import Path

REGION = "us-east-1"
MODEL_ID = "us.anthropic.claude-sonnet-4-6"

CANVAS = {"width": 1080, "height": 1920, "fps": 30}

# Per-vibe editing recipe used by BOTH the deterministic planner and (as a
# hint) the Bedrock prompt, so the two produce stylistically similar reels.
# transition = how to cut BETWEEN clips; zoom = add a reaction punch-in per
# clip; fade = fade each clip in/out.
VIBE_RECIPES = {
    "hype":          {"transition": "whip_pan", "zoom": True,  "fade": False},
    "funny":         {"transition": "cut",      "zoom": True,  "fade": False},
    "impressive":    {"transition": "crossfade", "zoom": True,  "fade": False},
    "emotional":     {"transition": "crossfade", "zoom": False, "fade": True},
    "wholesome":     {"transition": "crossfade", "zoom": False, "fade": True},
    "controversial": {"transition": "cut",      "zoom": True,  "fade": False},
}
DEFAULT_RECIPE = {"transition": "cut", "zoom": False, "fade": False}

TRANSITION_DURATION_S = 0.4  # crossfade / whip-pan length between clips
ZOOM_DURATION_S = 2.0        # reaction punch-in length
ZOOM_SCALE = 1.3


def _clip_key(index):
    """1-based manifest position -> canonical clip id (clip_NN)."""
    return f"clip_{index + 1:02d}"


def _member_clips(manifest, comp):
    """Resolve a compilation's clipIds to (clipId, entry, duration) triples,
    in the compilation's given order, skipping ids not present in the manifest."""
    by_key = {_clip_key(i): (i, entry) for i, entry in enumerate(manifest)}
    members = []
    for clip_id in comp.get("clipIds", []):
        hit = by_key.get(clip_id)
        if hit is None:
            continue
        _, entry = hit
        duration = round(max(0.0, float(entry.get("end_s", 0)) - float(entry.get("start_s", 0))), 3)
        if duration <= 0:
            continue
        members.append({"clipId": clip_id, "entry": entry, "duration": duration})
    return members


def dominant_vibe(members):
    """The reel's overall vibe: the most common mood across its clips (falling
    back to the most common category). Drives the whole editing recipe."""
    def _most_common(values):
        counts = {}
        for v in values:
            if not v:
                continue
            counts[v] = counts.get(v, 0) + 1
        if not counts:
            return ""
        return max(counts, key=lambda k: (counts[k], k))

    mood = _most_common(m["entry"].get("mood", "") for m in members)
    if mood:
        return mood
    return _most_common(m["entry"].get("category", "") for m in members)


def _recipe_for(vibe):
    return VIBE_RECIPES.get((vibe or "").strip().lower(), DEFAULT_RECIPE)


def _hook_text(members):
    """Opening <=12-char hook: reuse the first clip's own hook if it has one,
    else its short title."""
    first = members[0]["entry"]
    hook = (first.get("hook_zh") or first.get("hook_en") or "").strip()
    if hook:
        return hook[:12]
    title = (first.get("title_zh") or first.get("title_en") or "").strip()
    return title[:12]


def build_deterministic_plan(members, vibe):
    """Vibe-based fallback edit plan: keep the reel's clip order, full footage
    per clip, transitions + emphasis picked from the vibe recipe.

    Returns (segments, effects) in the EDL wire shape (clip-relative times)."""
    recipe = _recipe_for(vibe)
    segments = []
    effects = []
    cursor = 0.0
    for position, member in enumerate(members):
        duration = member["duration"]
        timeline_start = round(cursor, 3)
        timeline_end = round(cursor + duration, 3)

        if position == 0:
            transition = None
        else:
            transition = {"type": recipe["transition"],
                          "duration": TRANSITION_DURATION_S}

        segments.append({
            "segmentId": f"seg_{position + 1:02d}",
            "clipId": member["clipId"],
            "sourceStart": 0,
            "sourceEnd": duration,
            "timelineStart": timeline_start,
            "timelineEnd": timeline_end,
            "transitionIn": transition,
            "crop": {"mode": "center"},
        })

        mid = timeline_start + duration / 2
        if recipe["zoom"] and duration >= ZOOM_DURATION_S:
            effects.append({
                "effectId": "punch-in-zoom",
                "type": "visual",
                "at": round(max(timeline_start, mid - ZOOM_DURATION_S / 2), 3),
                "duration": ZOOM_DURATION_S,
                "params": {"scale": ZOOM_SCALE},
            })
        if recipe["fade"]:
            effects.append({
                "effectId": "opacity-fade",
                "type": "visual",
                "at": timeline_start,
                "duration": min(0.6, duration),
                "params": {"mode": "in" if position == 0 else "both"},
            })

        cursor = timeline_end

    return segments, effects


SYSTEM = """\
You are a short-form video editor assembling ONE compilation reel from a set of
already-cut highlight clips that share a theme. You decide the reel's edit: the
order the clips play, the transition between each, and light per-clip emphasis
(reaction punch-in zooms), all chosen to match the reel's overall VIBE.

Reply with ONLY a JSON object (no markdown fence, no commentary):
{
 "order": [1, 3, 2],          // 1-based clip numbers from the list, each once
 "transition": "cut" | "crossfade" | "whip_pan",   // between consecutive clips
 "zoomClips": [1, 3],         // clip numbers to add a single reaction zoom to
 "reason": "..."              // ONE sentence, English, the editing rationale
}
Rules:
- "order" must be a permutation of the given clip numbers (lead with the
  strongest hook, build to the biggest payoff).
- Pick ONE transition for the whole reel that fits the vibe: whip_pan/cut for
  high-energy (hype/funny), crossfade for emotional/wholesome/impressive.
- Only list clips in "zoomClips" that have a genuine reaction/peak worth
  emphasizing; leave it empty for calm reels.
- Keep "reason" to a single sentence."""


def _clip_lines(members):
    lines = []
    for i, m in enumerate(members, 1):
        e = m["entry"]
        title = e.get("title_en") or e.get("title_zh") or ""
        caption = (e.get("caption_en") or e.get("caption_zh") or "")[:160]
        lines.append(
            f"{i}. [{e.get('mood', '')}/{e.get('category', '')}] "
            f"{title} ({m['duration']:.1f}s) — {caption}"
        )
    return "\n".join(lines)


def _plan_with_bedrock(members, vibe, model_id, region):
    """Ask Bedrock for the reel's order/transition/zoom plan, then materialize
    it into (segments, effects). Raises on any failure; callers fall back."""
    import boto3

    brt = boto3.client("bedrock-runtime", region_name=region)
    user = (
        f"Reel vibe: {vibe or 'mixed'}.\n"
        "Here are the clips (numbered, in their current order):\n\n"
        + _clip_lines(members)
        + "\n\nPlan the reel now."
    )
    resp = brt.converse(
        modelId=model_id,
        system=[{"text": SYSTEM}],
        messages=[{"role": "user", "content": [{"text": user}]}],
        inferenceConfig={"maxTokens": 500, "temperature": 0.4},
    )
    raw = resp["output"]["message"]["content"][0]["text"]
    data = json.loads(raw[raw.index("{"): raw.rindex("}") + 1])

    n = len(members)
    order = [i for i in data.get("order", []) if isinstance(i, int) and 1 <= i <= n]
    order = list(dict.fromkeys(order))  # de-dupe, preserve order
    for i in range(1, n + 1):           # append any the model dropped
        if i not in order:
            order.append(i)

    transition = data.get("transition")
    if transition not in ("cut", "crossfade", "whip_pan"):
        transition = _recipe_for(vibe)["transition"]

    zoom_clips = {i for i in data.get("zoomClips", []) if isinstance(i, int) and 1 <= i <= n}

    ordered = [members[i - 1] for i in order]
    segments = []
    effects = []
    cursor = 0.0
    for position, (clip_number, member) in enumerate(zip(order, ordered)):
        duration = member["duration"]
        timeline_start = round(cursor, 3)
        timeline_end = round(cursor + duration, 3)
        segments.append({
            "segmentId": f"seg_{position + 1:02d}",
            "clipId": member["clipId"],
            "sourceStart": 0,
            "sourceEnd": duration,
            "timelineStart": timeline_start,
            "timelineEnd": timeline_end,
            "transitionIn": None if position == 0 else {"type": transition, "duration": TRANSITION_DURATION_S},
            "crop": {"mode": "center"},
        })
        if clip_number in zoom_clips and duration >= ZOOM_DURATION_S:
            mid = timeline_start + duration / 2
            effects.append({
                "effectId": "punch-in-zoom",
                "type": "visual",
                "at": round(max(timeline_start, mid - ZOOM_DURATION_S / 2), 3),
                "duration": ZOOM_DURATION_S,
                "params": {"scale": ZOOM_SCALE},
            })
        cursor = timeline_end

    return segments, effects, data.get("reason", "")


def build_compilation_edl(manifest, comp, stream_id=None, use_bedrock=True,
                          model_id=MODEL_ID, region=REGION):
    """Build a multi-clip compilation EDL (docs/contracts/edl.schema.json) for
    one compilation. Returns (edl_dict, summary_str)."""
    members = _member_clips(manifest, comp)
    if len(members) < 2:
        raise ValueError("a compilation needs at least two resolvable clips")

    vibe = dominant_vibe(members)
    comp_id = comp.get("id", "comp")
    job_id = f"job_{stream_id}" if stream_id else "job_compilation"

    reason = ""
    planner = "vibe-based auto-editor"
    if use_bedrock:
        try:
            segments, effects, reason = _plan_with_bedrock(members, vibe, model_id, region)
            planner = "Bedrock"
        except Exception as e:  # noqa: BLE001 — any Bedrock/parse failure -> fallback
            print(f"  bedrock plan failed ({e}); using deterministic vibe plan", file=sys.stderr)
            segments, effects = build_deterministic_plan(members, vibe)
    else:
        segments, effects = build_deterministic_plan(members, vibe)

    total = segments[-1]["timelineEnd"] if segments else 0
    edl = {
        "edlId": f"edl_{comp_id}",
        "jobId": job_id,
        "clipIds": [m["clipId"] for m in members],
        "status": "draft",
        "canvas": dict(CANVAS),
        "segments": segments,
        "effects": effects,
        "captions": {
            "source": "transcribe_word_timeline",
            "burnIn": False,
            "overlays": [],
        },
        "hookOverlay": {
            "text": _hook_text(members),
            "start": 0,
            "duration": 2.5,
        },
        "musicBed": None,
    }

    zoom_count = sum(1 for e in effects if e["effectId"] == "punch-in-zoom")
    summary = (
        f"Compiled a {vibe or 'mixed'} reel of {len(members)} clips "
        f"(~{total:.0f}s) via {planner}: {reason or 'ordered for flow'}"
        + (f", {zoom_count} reaction zoom(s)." if zoom_count else ".")
    )
    return edl, summary


def _find_compilation(compilations, compilation_id):
    for c in compilations:
        if c.get("id") == compilation_id:
            return c
    return None


def _normalize_compilations(data):
    if isinstance(data, list):
        return data
    return data.get("compilations", [])


def emit(manifest_path, compilations_path, compilation_id, out_path,
         stream_id=None, use_bedrock=True, model_id=MODEL_ID):
    """Read manifest + compilations, build the EDL for one compilation, write it."""
    manifest = json.loads(Path(manifest_path).read_text(encoding="utf-8"))
    manifest = manifest if isinstance(manifest, list) else manifest.get("clips", [])

    comps = _normalize_compilations(
        json.loads(Path(compilations_path).read_text(encoding="utf-8"))
    )
    comp = _find_compilation(comps, compilation_id)
    if comp is None:
        raise ValueError(f"compilation {compilation_id!r} not found in {compilations_path}")

    edl, summary = build_compilation_edl(
        manifest, comp, stream_id=stream_id,
        use_bedrock=use_bedrock, model_id=model_id,
    )
    out_path = Path(out_path)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(edl, ensure_ascii=False, indent=1), encoding="utf-8")
    return edl, summary


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("manifest", help="path to clips/manifest.json")
    ap.add_argument("--compilations", required=True, help="path to clips/compilations.json")
    ap.add_argument("--compilation-id", required=True, help="e.g. comp_01")
    ap.add_argument("--out", required=True, help="path to write the compilation EDL")
    ap.add_argument("--stream-id", default=None)
    ap.add_argument("--model", default=MODEL_ID)
    ap.add_argument("--no-bedrock", action="store_true",
                    help="skip the Bedrock plan and use the deterministic vibe planner")
    args = ap.parse_args(argv)

    edl, summary = emit(
        args.manifest, args.compilations, args.compilation_id, args.out,
        stream_id=args.stream_id, use_bedrock=not args.no_bedrock, model_id=args.model,
    )
    print(summary)
    print(f"wrote {len(edl['segments'])} segments, {len(edl['effects'])} effects -> {args.out}")


if __name__ == "__main__":
    sys.exit(main())
