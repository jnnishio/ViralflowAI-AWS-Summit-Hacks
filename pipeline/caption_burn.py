"""On-demand caption burn for the editor's "Auto Caption" button.

The highlights grid ships RAW clips (see pipeline/render.py). When a creator
opens a clip in the editor and presses "Auto Caption", the local server
(frontend/local-server) invokes THIS module to burn karaoke-style TikTok
captions onto that one already-cut clip, using the clip-relative word timings
the pipeline already computed into the clip's EDL (pipeline/edl.py
word_overlays). The result is an MP4 with captions burned in at the exact same
visual quality as the old baked-in path — that's the point of doing it
server-side rather than approximating in the editor's text elements.

Because the input is an ALREADY-CUT clip (start at t=0), the EDL overlays are
clip-relative and no re-crop/re-scale is needed: we only overlay the ASS
subtitle filter and copy the audio.

Reuses CAPTION_STYLE / ZH_FONT / font handling from pipeline.render so the
burned captions stay in lockstep with the rest of the pipeline's styling.

Usage:
  python3 -m pipeline.caption_burn \
      --clip out/<id>/clips/clip_01_hype.mp4 \
      --edl  out/<id>/edl/clip_01.edl.json \
      --out  out/<id>/clips/clip_01_hype_captioned.mp4
"""

import argparse
import json
import shutil
import subprocess
import sys
from pathlib import Path

from pipeline.render import (
    CAPTION_STYLE,
    IS_WINDOWS,
    _local_font_file,
)


def _ts(t):
    """Seconds -> ASS timestamp (H:MM:SS.cc)."""
    t = max(0.0, t)
    hh, rem = divmod(t, 3600)
    mm, ss = divmod(rem, 60)
    return f"{int(hh)}:{int(mm):02d}:{ss:05.2f}"


def build_ass_from_overlays(overlays, path, play_res=(1080, 1920),
                            highlight_color="00FFFF"):
    """Build a karaoke ASS file from clip-relative EDL caption overlays.

    `overlays` is the list from an EDL's captions.overlays (pipeline/edl.py):
      - karaoke overlays carry a per-word `words: [{text,start,end}]` array,
        rendered with ASS \\kf (smooth fill) so each word lights up as spoken;
      - plain overlays carry only {start,end,text} and render as a static line.
    Times are already clip-relative (0 == clip start). `highlight_color` is
    BGR hex for the filled (spoken) colour; unsaid words stay white.
    """
    w, h = play_res
    lines = [
        "[Script Info]",
        f"PlayResX: {w}",
        f"PlayResY: {h}",
        "WrapStyle: 0",
        "",
        "[V4+ Styles]",
        "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour,"
        " OutlineColour, BackColour, Bold, Outline, Shadow, Alignment,"
        " MarginL, MarginR, MarginV",
        f"Style: karaoke,{CAPTION_STYLE['fontName']},{CAPTION_STYLE['fontSize']},"
        f"&H00{highlight_color},&H00FFFFFF,&H00000000,&H80000000,1,3,1,"
        f"{CAPTION_STYLE['alignment']},60,60,{CAPTION_STYLE['marginV']}",
        "",
        "[Events]",
        "Format: Layer, Start, End, Style, Text",
    ]

    for ov in overlays:
        words = ov.get("words")
        if words:
            g_start = words[0]["start"]
            g_end = words[-1]["end"]
            parts = []
            for cw in words:
                dur_cs = max(1, round((cw["end"] - cw["start"]) * 100))
                parts.append(f"{{\\kf{dur_cs}}}{cw['text']}")
            text = "".join(parts)
        else:
            g_start = ov.get("start", 0.0)
            g_end = ov.get("end", 0.0)
            text = (ov.get("text") or "").replace("\n", " ")
        if not text:
            continue
        lines.append(f"Dialogue: 0,{_ts(g_start)},{_ts(g_end)},karaoke,{text}")

    Path(path).write_text("\n".join(lines))
    return path


def _read_overlays(edl_path):
    edl = json.loads(Path(edl_path).read_text(encoding="utf-8"))
    return (edl.get("captions") or {}).get("overlays") or []


def burn_captions(clip_path, edl_path, out_path, workdir=None):
    """Burn karaoke captions from `edl_path`'s overlays onto `clip_path`.

    The clip is already the cut 9:16 footage, so we only overlay the ASS
    subtitle filter and copy the audio stream (no re-crop, no re-scale). If the
    EDL carries no caption overlays, the clip is copied through unchanged so the
    caller still gets a valid output file.
    """
    clip_path = Path(clip_path)
    out_path = Path(out_path)
    out_path.parent.mkdir(parents=True, exist_ok=True)

    overlays = _read_overlays(edl_path)
    if not overlays:
        # Nothing to burn (e.g. Transcribe produced no usable words — a real
        # case for singing clips). Hand back the raw clip so the editor still
        # gets a file; the creator can add captions manually.
        shutil.copy(clip_path, out_path)
        return out_path

    workdir = Path(workdir) if workdir else out_path.parent / "tmp"
    workdir.mkdir(parents=True, exist_ok=True)

    font_file = _local_font_file(workdir) if IS_WINDOWS else None
    ass = build_ass_from_overlays(overlays, workdir / f"{out_path.stem}.ass")
    # Forward slashes parse correctly in the -vf filtergraph on every ffmpeg
    # build (a native Windows path's "\" is treated as an escape char).
    ass_filter = f"ass={Path(ass).as_posix()}"
    if font_file:
        # Sidestep the broken fontconfig lookup on Windows ffmpeg builds by
        # pointing libass straight at a local font file (see pipeline.render).
        ass_filter += f":fontsdir={font_file.parent.as_posix()}"

    cmd = [
        "ffmpeg", "-y", "-v", "error",
        "-i", str(clip_path),
        "-vf", ass_filter,
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "21",
        "-c:a", "copy",
        "-movflags", "+faststart",
        str(out_path),
    ]
    subprocess.run(cmd, check=True)
    return out_path


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--clip", required=True, help="already-cut 9:16 clip mp4")
    ap.add_argument("--edl", required=True, help="clip EDL json with captions.overlays")
    ap.add_argument("--out", required=True, help="output captioned mp4 path")
    args = ap.parse_args(argv)
    out = burn_captions(args.clip, args.edl, args.out)
    print(f"captioned clip -> {out}")


if __name__ == "__main__":
    sys.exit(main())
