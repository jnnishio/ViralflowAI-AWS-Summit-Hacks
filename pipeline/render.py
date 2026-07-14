"""Clip renderer: highlight manifest -> vertical 9:16 clips with burned-in
captions and a hook overlay.

For each kept highlight:
  1. cut [start_s, end_s] from the VOD
  2. reframe 16:9 -> 9:16: face-guided crop when visual signals are available,
     center crop otherwise
  3. burn zh captions (ASS built from Transcribe word timestamps)
  4. overlay the AI Director's hook line for the first 2.5 seconds

Local ffmpeg engine (demo path). The orchestrator can alternatively submit the
cut/transcode as a MediaConvert job (cloud path) via --engine mediaconvert.

Usage:
  python3 -m pipeline.render out/highlights.json --video data/6910008_video.mp4 \
      --transcript out/transcript.json --visual out/visual_signals.json --outdir out/clips
"""

import argparse
import json
import subprocess
import sys
from pathlib import Path

ZH_FONT = "PingFang TC"  # macOS built-in; Linux: swap for Noto Sans CJK TC

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


def render_clip(video, hl, out_path, transcript=None, visual=None, workdir=Path("out/tmp")):
    start_s, end_s = hl["start_s"], hl["end_s"]
    workdir.mkdir(parents=True, exist_ok=True)

    # 16:9 -> 9:16 crop: crop width = height*9/16 in source pixels, panned to face.
    cx = face_crop_x(visual, start_s, end_s)
    # x offset clamped so the crop window stays inside the frame
    crop = f"crop=w=ih*9/16:h=ih:x=clip(iw*{cx:.4f}-(ih*9/16)/2\\,0\\,iw-ih*9/16):y=0"
    vf = [crop, "scale=1080:1920"]

    if transcript:
        ass = build_ass(transcript, start_s, end_s, workdir / f"{out_path.stem}.ass")
        vf.append(f"ass={ass}")

    hook = (hl.get("hook_zh") or "").replace("'", "").replace(":", "")
    if hook:
        vf.append(
            f"drawtext=font='{ZH_FONT}':text='{hook}':fontsize=88:fontcolor=white:"
            "borderw=6:bordercolor=black:x=(w-text_w)/2:y=h*0.18:"
            f"enable='lt(t,{HOOK_DURATION_S})'"
        )

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
