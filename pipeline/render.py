"""Clip renderer: highlight manifest -> RAW vertical 9:16 clips.

For each kept highlight:
  1. cut [start_s, end_s] from the VOD
  2. reframe 16:9 -> 9:16: face-guided crop when visual signals are available,
     center crop otherwise

Clips are intentionally RAW: captions and the hook overlay are NOT burned in
here, so the highlights grid shows unedited footage and the creator keeps full
editing control. Captions (karaoke TikTok-style) are applied on demand later,
in the editor, via pipeline/caption_burn.py — which reuses the ASS helpers
(build_ass / build_ass_karaoke / CAPTION_STYLE) still defined in this module.

Local ffmpeg engine (demo path). The orchestrator can alternatively submit the
cut/transcode as a MediaConvert job (cloud path) via --engine mediaconvert.

Usage:
  python3 -m pipeline.render out/highlights.json --video data/6910008_video.mp4 \
      --transcript out/transcript.json --visual out/visual_signals.json --outdir out/clips
"""

import argparse
import json
import platform
import shutil
import subprocess
import sys
from pathlib import Path

IS_WINDOWS = platform.system() == "Windows"

if IS_WINDOWS:
    # Gyan's ffmpeg-for-Windows build has no working fontconfig, so both the
    # `ass` filter's family-name lookup and drawtext's `font=` family-name
    # lookup segfault instead of failing gracefully. Sidestep fontconfig
    # entirely: address a font by file, not by family-name resolution.
    # MingLiU (Traditional Chinese) ships with every Windows install.
    ZH_FONT = "MingLiU"
    _SYSTEM_FONT_FILE = Path(r"C:\Windows\Fonts\mingliu.ttc")
else:
    ZH_FONT = "Noto Sans CJK TC"  # Linux/Docker compatibility (Fargate); macOS: swap for PingFang TC
    _SYSTEM_FONT_FILE = None

# Caption style, shared with pipeline/edl.py so the burned-in captions and the
# EDL's caption.style stay in lockstep (edit here, both follow).
CAPTION_STYLE = {
    "fontName": ZH_FONT,
    "fontSize": 64,
    "alignment": 2,   # ASS: 2 = bottom-center
    "marginV": 220,   # bottom margin in the 1080x1920 PlayRes
}
CAPTION_CHUNK = 16    # max chars per burned caption line
HOOK_DURATION_S = 2.5  # hook overlay shows for the opening seconds


def _local_font_file(workdir):
    """Copy the system CJK font next to the render workdir so it can be
    addressed by a short relative path — ffmpeg's filter-option parser
    can't reliably carry a drive-letter colon (C:\\...) inside a filter's
    sub-option value (e.g. ass=...:fontsdir=...), but a relative path
    sidesteps the ambiguity entirely."""
    fonts_dir = workdir / "fonts"
    fonts_dir.mkdir(parents=True, exist_ok=True)
    dest = fonts_dir / _SYSTEM_FONT_FILE.name
    if not dest.exists():
        shutil.copy(_SYSTEM_FONT_FILE, dest)
    return dest


def face_crop_x(visual, start_s, end_s):
    """Median face-center x (0..1) inside the window, for crop positioning."""
    if not visual:
        return 0.5
    xs = [
        f["box"]["Left"] + f["box"]["Width"] / 2
        for f in visual.get("faces", [])
        if start_s <= f["t_s"] <= end_s
    ]
    if not xs:
        return 0.5
    xs.sort()
    return xs[len(xs) // 2]


def build_ass(transcript, start_s, end_s, path, play_res=(1080, 1920)):
    """ASS subtitles (bottom-third, zh-friendly) from transcript segments."""
    w, h = play_res

    def ts(t):
        t = max(0.0, t)
        hh, rem = divmod(t, 3600)
        mm, ss = divmod(rem, 60)
        return f"{int(hh)}:{int(mm):02d}:{ss:05.2f}"

    lines = [
        "[Script Info]",
        f"PlayResX: {w}",
        f"PlayResY: {h}",
        "WrapStyle: 0",
        "",
        "[V4+ Styles]",
        "Format: Name, Fontname, Fontsize, PrimaryColour, OutlineColour, BackColour,"
        " Bold, Outline, Shadow, Alignment, MarginL, MarginR, MarginV",
        f"Style: zh,{CAPTION_STYLE['fontName']},{CAPTION_STYLE['fontSize']},"
        f"&H00FFFFFF,&H00000000,&H80000000,1,3,1,"
        f"{CAPTION_STYLE['alignment']},60,60,{CAPTION_STYLE['marginV']}",
        "",
        "[Events]",
        "Format: Layer, Start, End, Style, Text",
    ]
    for seg in transcript["segments"]:
        if seg["end_s"] < start_s or seg["start_s"] > end_s:
            continue
        text = seg["text"].replace("\n", " ")
        # chunk long segments so lines stay readable
        for i in range(0, len(text), CAPTION_CHUNK):
            chunk = text[i: i + CAPTION_CHUNK]
            frac_lo = i / max(len(text), 1)
            frac_hi = min((i + CAPTION_CHUNK) / max(len(text), 1), 1.0)
            dur = seg["end_s"] - seg["start_s"]
            t0 = seg["start_s"] + frac_lo * dur - start_s
            t1 = seg["start_s"] + frac_hi * dur - start_s
            lines.append(f"Dialogue: 0,{ts(t0)},{ts(t1)},zh,{chunk}")
    Path(path).write_text("\n".join(lines))
    return path


def build_ass_karaoke(transcript, start_s, end_s, path, play_res=(1080, 1920),
                      words_per_group=4, highlight_color="00FFFF"):
    """ASS subtitles with karaoke-style word highlighting.

    Groups words into short phrases (words_per_group), shows them as one
    dialogue line, and uses ASS \\kf (smooth fill) tags to highlight
    each word as it's spoken.  highlight_color is BGR hex for the filled
    (spoken) colour; unsaid words show in white.
    """
    w, h = play_res

    def ts(t):
        t = max(0.0, t)
        hh, rem = divmod(t, 3600)
        mm, ss = divmod(rem, 60)
        return f"{int(hh)}:{int(mm):02d}:{ss:05.2f}"

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

    clip_words = [
        cw for cw in transcript.get("words", [])
        if cw["end_s"] >= start_s and cw["start_s"] <= end_s
    ]

    for g in range(0, len(clip_words), words_per_group):
        group = clip_words[g:g + words_per_group]
        if not group:
            continue
        g_start = group[0]["start_s"] - start_s
        g_end = group[-1]["end_s"] - start_s
        parts = []
        for cw in group:
            dur_cs = max(1, round((cw["end_s"] - cw["start_s"]) * 100))
            parts.append(f"{{\\kf{dur_cs}}}{cw['text']}")
        text = "".join(parts)
        lines.append(f"Dialogue: 0,{ts(g_start)},{ts(g_end)},karaoke,{text}")

    Path(path).write_text("\n".join(lines))
    return path


def render_clip(video, hl, out_path, transcript=None, visual=None, workdir=Path("out/tmp")):
    """Cut [start_s, end_s] and reframe 16:9 -> 9:16. RAW output: no captions
    and no hook overlay are burned in here anymore — the highlights grid shows
    unedited clips so the creator keeps full editing control. Captions are
    applied later, on demand, in the editor (see pipeline/caption_burn.py, wired
    to the editor's "Auto Caption" button). `transcript` is accepted for a
    stable call signature but is no longer used for burning.
    """
    start_s, end_s = hl["start_s"], hl["end_s"]
    workdir.mkdir(parents=True, exist_ok=True)

    # 16:9 -> 9:16 crop: crop width = height*9/16 in source pixels, panned to face.
    cx = face_crop_x(visual, start_s, end_s)
    # x offset clamped so the crop window stays inside the frame
    crop = f"crop=w=ih*9/16:h=ih:x=clip(iw*{cx:.4f}-(ih*9/16)/2\\,0\\,iw-ih*9/16):y=0"
    vf = [crop, "scale=1080:1920"]

    cmd = [
        "ffmpeg", "-y", "-v", "error",
        "-ss", str(start_s), "-to", str(end_s), "-i", str(video),
        "-vf", ",".join(vf),
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "21",
        "-c:a", "aac", "-b:a", "128k",
        "-movflags", "+faststart",
        str(out_path),
    ]
    subprocess.run(cmd, check=True)
    return out_path


def make_proxy(clip_path, proxy_path, height=960):
    """Low-res 9:16 proxy of a rendered clip — the media the browser editor loads.
    Small + fast to stream; the final render still comes from the full-res clip."""
    subprocess.run(
        ["ffmpeg", "-y", "-v", "error", "-i", str(clip_path),
         "-vf", f"scale=-2:{height}", "-c:v", "libx264", "-preset", "veryfast",
         "-crf", "30", "-c:a", "aac", "-b:a", "96k", "-movflags", "+faststart",
         str(proxy_path)],
        check=True,
    )
    return proxy_path


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("highlights")
    ap.add_argument("--video", required=True)
    ap.add_argument("--transcript", default=None)
    ap.add_argument("--visual", default=None)
    ap.add_argument("--outdir", default="out/clips")
    ap.add_argument("--top", type=int, default=5)
    args = ap.parse_args(argv)

    hls = json.loads(Path(args.highlights).read_text())["highlights"][: args.top]
    transcript = json.loads(Path(args.transcript).read_text()) if args.transcript else None
    visual = json.loads(Path(args.visual).read_text()) if args.visual and Path(args.visual).exists() else None

    outdir = Path(args.outdir)
    outdir.mkdir(parents=True, exist_ok=True)

    def render_one(i_hl):
        i, hl = i_hl
        name = f"clip_{i:02d}_{hl.get('mood','clip')}.mp4"
        out_path = outdir / name
        print(f"rendering {name}  {hl['start_s']:.0f}-{hl['end_s']:.0f}s  v={hl.get('virality_score')}")
        render_clip(Path(args.video), hl, out_path, transcript, visual)
        # thumbnail at the peak moment (UI clip cards)
        thumb = out_path.with_suffix(".jpg")
        subprocess.run(
            ["ffmpeg", "-y", "-v", "error", "-ss", str(hl.get("peak_s", hl["start_s"])),
             "-i", str(args.video), "-frames:v", "1", "-vf", "scale=480:-2", str(thumb)],
            check=True,
        )
        # low-res proxy for the browser editor (see pipeline/edl.py + architecture.md)
        proxy = out_path.with_suffix(".proxy.mp4")
        make_proxy(out_path, proxy)
        # field names follow the UI's Clip data model (see .kiro/steering/architecture.md)
        return {**{k: hl.get(k) for k in
                   ("start_s", "end_s", "virality_score", "mood", "category",
                    "factors", "title_zh", "title_en", "hook_zh", "caption_zh",
                    "caption_en", "hashtags")},
                "file": str(out_path), "thumb": str(thumb), "proxy": str(proxy)}

    from concurrent.futures import ThreadPoolExecutor

    with ThreadPoolExecutor(max_workers=3) as pool:  # ffmpeg is multi-threaded; 3 keeps cores busy
        manifest = list(pool.map(render_one, enumerate(hls, 1)))
    (outdir / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=1))
    print(f"{len(manifest)} clips -> {outdir}/")


if __name__ == "__main__":
    sys.exit(main())
