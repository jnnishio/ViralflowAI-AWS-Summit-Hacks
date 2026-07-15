"""Emit a real Edit Decision List per clip (docs/contracts/edl.schema.json).

This is the input the AI auto-edit engine / built-in editor consumes: it turns a
Director highlight + the Transcribe timeline + face positions into an editable
timeline (one segment, face-guided crop, caption overlays, opening hook). Built
entirely from artifacts the pipeline already produces — no re-analysis needed.

Caption style and crop logic are imported from pipeline.render so the EDL and the
burned-in reference render never drift apart.

Usage:
  python3 -m pipeline.edl out/3654414-fast/highlights.json --stream-id 3654414 \
      --transcript out/3654414-fast/transcript.json \
      --visual out/3654414-fast/visual_signals.json \
      --outdir out/3654414-fast/edl
"""

import argparse
import json
from pathlib import Path

from pipeline.render import CAPTION_STYLE, HOOK_DURATION_S, face_crop_x


def caption_overlays(transcript, start_s, end_s):
    """Transcript segments inside the window, shifted to clip-relative time."""
    overlays = []
    for seg in transcript["segments"]:
        if seg["end_s"] < start_s or seg["start_s"] > end_s:
            continue
        overlays.append({
            "start": round(max(0.0, seg["start_s"] - start_s), 3),
            "end": round(seg["end_s"] - start_s, 3),
            "text": seg["text"].replace("\n", " "),
            "speaker": seg.get("speaker", ""),
        })
    return overlays


def word_overlays(transcript, start_s, end_s, words_per_group=4):
    """Word-level overlays grouped into short phrases for karaoke display."""
    clip_words = [
        w for w in transcript.get("words", [])
        if w["end_s"] >= start_s and w["start_s"] <= end_s
    ]
    overlays = []
    for g in range(0, len(clip_words), words_per_group):
        group = clip_words[g:g + words_per_group]
        if not group:
            continue
        overlays.append({
            "start": round(max(0.0, group[0]["start_s"] - start_s), 3),
            "end": round(group[-1]["end_s"] - start_s, 3),
            "words": [
                {"text": w["text"],
                 "start": round(max(0.0, w["start_s"] - start_s), 3),
                 "end": round(w["end_s"] - start_s, 3)}
                for w in group
            ],
            "text": "".join(w["text"] for w in group),
            "speaker": group[0].get("speaker", ""),
        })
    return overlays


def build_edl(hl, clip_id, job_id, transcript=None, visual=None, fps=30):
    start_s, end_s = hl["start_s"], hl["end_s"]
    duration = round(end_s - start_s, 3)

    has_faces = bool(visual and visual.get("faces"))
    cx = face_crop_x(visual, start_s, end_s) if has_faces else 0.5

    edl = {
        "edlId": f"edl_{clip_id}_v1",
        "jobId": job_id,
        "clipIds": [clip_id],
        "status": "draft",
        "canvas": {"width": 1080, "height": 1920, "fps": fps},
        "segments": [{
            "segmentId": "seg_01",
            "clipId": clip_id,
            "sourceStart": 0,
            "sourceEnd": duration,
            "timelineStart": 0,
            "timelineEnd": duration,
            "transitionIn": None,
            "crop": {"mode": "face_track" if has_faces else "center", "cx": round(cx, 4)},
            "vodStart": start_s,
            "vodEnd": end_s,
        }],
        "effects": [],
        "captions": {
            "source": "transcribe_word_karaoke" if transcript and transcript.get("words") else "transcribe_word_timeline",
            "burnIn": True,
            "style": dict(CAPTION_STYLE),
            "overlays": (word_overlays(transcript, start_s, end_s)
                         if transcript and transcript.get("words")
                         else caption_overlays(transcript, start_s, end_s) if transcript
                         else []),
        },
        "hookOverlay": None,
        "musicBed": None,
    }
    if hl.get("hook_zh"):
        edl["hookOverlay"] = {
            "text": hl["hook_zh"],
            "start": 0,
            "duration": HOOK_DURATION_S,
            "style": {"fontSize": 88, "fontColor": "white", "borderWidth": 6, "borderColor": "black"},
        }
    return edl


def emit(highlights_path, stream_id, outdir, transcript_path=None, visual_path=None, top=None):
    highlights = json.loads(Path(highlights_path).read_text())["highlights"]
    if top:
        highlights = highlights[:top]
    transcript = json.loads(Path(transcript_path).read_text()) if transcript_path else None
    visual = (json.loads(Path(visual_path).read_text())
              if visual_path and Path(visual_path).exists() else None)
    job_id = f"job_{stream_id}"

    outdir = Path(outdir)
    outdir.mkdir(parents=True, exist_ok=True)
    written = []
    for i, hl in enumerate(highlights, 1):
        clip_id = f"clip_{i:02d}"
        edl = build_edl(hl, clip_id, job_id, transcript, visual)
        path = outdir / f"{clip_id}.edl.json"
        path.write_text(json.dumps(edl, ensure_ascii=False, indent=1))
        written.append(path)
    return written


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("highlights")
    ap.add_argument("--stream-id", required=True)
    ap.add_argument("--transcript", default=None)
    ap.add_argument("--visual", default=None)
    ap.add_argument("--outdir", required=True)
    ap.add_argument("--top", type=int, default=None)
    args = ap.parse_args(argv)
    written = emit(args.highlights, args.stream_id, args.outdir,
                   args.transcript, args.visual, args.top)
    print(f"{len(written)} EDLs -> {args.outdir}/")


if __name__ == "__main__":
    main()
