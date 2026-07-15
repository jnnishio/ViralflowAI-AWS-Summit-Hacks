"""Director's-cut renderer: burn AI auto-edit effects into a second MP4 per clip.

Reads each clip's EDL (with populated effects[]) and renders:
- punch-in-zoom via animated crop/scale filter
- onomatopoeia captions via drawtext with enable='between(t,...,...)'
- SFX mixed in via amix at the right offset

Output: clip_NN_<mood>_autoedit.mp4 alongside the existing plain render.

Windows font gotcha: reuses pipeline/render.py's _local_font_file() pattern
(address font by file path, not family name — see render.py for explanation).

Usage:
  python3 -m pipeline.render_autoedit out/3654414-fast/edl \
      --clips-dir out/clips --outdir out/clips
"""

import argparse
import json
import subprocess
import sys
from pathlib import Path

from pipeline.render import IS_WINDOWS, ZH_FONT, _local_font_file

SFX_DIR = Path("assets/sfx")


def _probe_fps(video_path):
    """Get the video's frame rate (as float). Defaults to 30 on failure."""
    try:
        out = subprocess.run(
            ["ffprobe", "-v", "error", "-select_streams", "v:0",
             "-show_entries", "stream=r_frame_rate", "-of", "csv=p=0", str(video_path)],
            capture_output=True, text=True, check=True,
        ).stdout.strip()
        num, den = out.split("/")
        return float(num) / float(den) if float(den) else float(num)
    except Exception:
        return 30.0


def _zoompan_filter(zooms, fps, w=1080, h=1920):
    """Build a single zoompan filter that applies all punch-in-zoom windows.

    zoompan re-evaluates its z/x/y expressions per output frame (unlike scale
    or crop, whose size is fixed at init) — so it's the right tool for an
    animated punch-in that ramps in, holds, and ramps out.

    Each zoom window contributes a triangular ramp on z centered on its face
    target (cx, cy). Windows don't overlap (>=3s gap enforced upstream), so at
    most one is active at a time; when none are active z=1 and x=y=0 (full
    frame). All expressions are single-quoted so the commas inside between()/
    min() aren't parsed as filter-chain separators.
    """
    if not zooms:
        return None

    rf = max(1.0, 0.3 * fps)  # ramp frames (0.3s in/out)
    z_terms, x_terms, y_terms = [], [], []
    for zf in zooms:
        at = zf["at"]
        end = at + zf["duration"]
        s = zf["params"].get("scale", 1.3)
        cx = zf["params"].get("cx", 0.5)
        cy = zf["params"].get("cy", 0.4)
        af = at * fps
        ef = end * fps
        gate = f"between(in,{af:.1f},{ef:.1f})"
        tri = f"min(1,min((in-{af:.1f})/{rf:.1f},({ef:.1f}-in)/{rf:.1f}))"
        z_terms.append(f"({s}-1)*{gate}*max(0,{tri})")
        # Viewport top-left to center on (cx, cy); gated so it's 0 when inactive
        x_terms.append(f"(iw*{cx:.4f}-iw/zoom/2)*{gate}")
        y_terms.append(f"(ih*{cy:.4f}-ih/zoom/2)*{gate}")

    z_expr = "1+" + "+".join(z_terms)
    x_expr = "+".join(x_terms) if x_terms else "0"
    y_expr = "+".join(y_terms) if y_terms else "0"

    return (
        f"zoompan=z='{z_expr}':x='{x_expr}':y='{y_expr}':"
        f"d=1:s={w}x{h}:fps={fps:g}"
    )


def _drawtext_filter(effect, font_file):
    """Build a drawtext filter for an onomatopoeia burst caption."""
    at = effect["at"]
    dur = effect["duration"]
    end = at + dur
    text = effect["params"].get("text", "!").replace("'", "").replace(":", "").replace("\\", "")
    font_size = effect["params"].get("style", {}).get("fontSize", 120)

    font_arg = f"fontfile='{font_file.as_posix()}'" if font_file else f"font='{ZH_FONT}'"

    return (
        f"drawtext={font_arg}:text='{text}':fontsize={font_size}:"
        f"fontcolor=yellow:borderw=4:bordercolor=black:"
        f"x=(w-text_w)/2:y=h*0.35:"
        f"enable='between(t,{at:.3f},{end:.3f})'"
    )


def render_autoedit_clip(clip_path, edl, out_path, workdir=Path("out/tmp")):
    """Render a director's-cut version of a clip with AI effects burned in."""
    workdir.mkdir(parents=True, exist_ok=True)
    effects = edl.get("effects", [])
    if not effects:
        return None  # No effects to burn in

    font_file = _local_font_file(workdir) if IS_WINDOWS else None
    fps = _probe_fps(clip_path)

    # Separate effect types
    zooms = [e for e in effects if e["effectId"] == "punch-in-zoom"]
    captions = [e for e in effects if e["effectId"] == "onomatopoeia-caption"]
    sfx_effects = [e for e in effects if e["type"] == "sound"]

    # Build video filter chain — zoom FIRST (zoompan), then caption overlays.
    vf_parts = []

    zoom_f = _zoompan_filter(zooms, fps)
    if zoom_f:
        vf_parts.append(zoom_f)

    # Add onomatopoeia captions
    for cap in captions:
        vf_parts.append(_drawtext_filter(cap, font_file))

    if not vf_parts and not sfx_effects:
        return None

    # Build ffmpeg command
    cmd = ["ffmpeg", "-y", "-v", "error", "-i", str(clip_path)]

    # Add SFX inputs
    sfx_inputs = []
    for sfx in sfx_effects:
        asset_key = sfx["params"].get("assetKey", "")
        sfx_path = SFX_DIR / Path(asset_key).name
        if sfx_path.exists():
            cmd += ["-i", str(sfx_path)]
            sfx_inputs.append(sfx)

    if sfx_inputs:
        # Use filter_complex for audio mixing
        n_audio = len(sfx_inputs) + 1  # main + sfx tracks
        filter_parts = []

        # Video filter
        if vf_parts:
            filter_parts.append(f"[0:v]{','.join(vf_parts)}[vout]")
        else:
            filter_parts.append("[0:v]null[vout]")

        # Audio mixing: delay each SFX to its correct position
        audio_labels = ["[0:a]"]
        for i, sfx in enumerate(sfx_inputs, 1):
            delay_ms = int(sfx["at"] * 1000)
            gain_db = sfx["params"].get("gainDb", -6)
            # Convert dB to volume multiplier
            import math
            vol = math.pow(10, gain_db / 20)
            filter_parts.append(
                f"[{i}:a]adelay={delay_ms}|{delay_ms},volume={vol:.3f}[sfx{i}]"
            )
            audio_labels.append(f"[sfx{i}]")

        # Mix all audio
        filter_parts.append(
            f"{''.join(audio_labels)}amix=inputs={n_audio}:duration=first:dropout_transition=0[aout]"
        )

        cmd += ["-filter_complex", ";".join(filter_parts)]
        cmd += ["-map", "[vout]", "-map", "[aout]"]
    else:
        # Simple video-only filter
        if vf_parts:
            cmd += ["-vf", ",".join(vf_parts)]
        cmd += ["-c:a", "copy"]

    cmd += [
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "21",
        "-movflags", "+faststart",
        str(out_path),
    ]

    subprocess.run(cmd, check=True)
    return out_path


def emit(edl_dir, clips_dir, outdir=None):
    """Process all EDL files in edl_dir and render autoedit clips."""
    edl_dir = Path(edl_dir)
    clips_dir = Path(clips_dir)
    outdir = Path(outdir) if outdir else clips_dir

    rendered = []
    for edl_path in sorted(edl_dir.glob("clip_*.edl.json")):
        edl = json.loads(edl_path.read_text(encoding="utf-8"))
        if not edl.get("effects"):
            continue

        clip_id = edl_path.stem.replace(".edl", "")
        # Find the corresponding rendered clip
        # Naming convention: clip_NN_<mood>.mp4
        candidates = list(clips_dir.glob(f"{clip_id}_*.mp4"))
        candidates = [c for c in candidates if "autoedit" not in c.name and "proxy" not in c.name]
        if not candidates:
            continue

        clip_path = candidates[0]
        out_name = clip_path.stem + "_autoedit.mp4"
        out_path = outdir / out_name

        result = render_autoedit_clip(clip_path, edl, out_path)
        if result:
            rendered.append((clip_id, out_path))

    return rendered


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("edl_dir", help="Directory containing clip_NN.edl.json files")
    ap.add_argument("--clips-dir", required=True, help="Directory with rendered clip MP4s")
    ap.add_argument("--outdir", default=None, help="Output dir (default: same as clips-dir)")
    args = ap.parse_args(argv)

    rendered = emit(args.edl_dir, args.clips_dir, args.outdir)
    for clip_id, path in rendered:
        print(f"  {clip_id} -> {path}")
    print(f"Rendered {len(rendered)} autoedit clips")


if __name__ == "__main__":
    sys.exit(main())
