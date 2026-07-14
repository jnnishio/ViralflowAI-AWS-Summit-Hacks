"""AI Director: Bedrock (Claude) validates each fused candidate, sets narrative
clip boundaries (setup -> payoff, not just the peak), scores virality, and
writes platform metadata (titles/hooks/captions/hashtags, zh + en).

Each candidate is judged with full multimodal context:
  - transcript excerpt (Transcribe segments around the window)
  - chat excerpt (novelty-weighted messages from the langlive log)
  - up to 3 keyframes extracted from the VOD (Claude vision)

Usage:
  python3 -m pipeline.director out/candidates.json \
      --transcript out/transcript.json --chat-log data/6910008_log.csv \
      --video data/6910008_video.mp4 --out out/highlights.json
"""

import argparse
import json
import subprocess
import sys
from pathlib import Path

import boto3

REGION = "us-east-1"
MODEL_ID = "us.anthropic.claude-sonnet-4-6"
CONTEXT_PAD_S = 20  # transcript/chat context around the window
MAX_CLIP_S = 60     # hard cap regardless of what the model returns

SYSTEM = """\
You are a veteran short-form video editor for TikTok / IG Reels / YouTube Shorts,
fluent in Traditional Chinese and English, editing highlights from a livestream VOD.
You receive one candidate moment with transcript, live-chat excerpt, and keyframes.

Judge it and reply with ONLY a JSON object (no markdown fence, no commentary):
{
 "keep": true/false,            // is this a genuinely clip-worthy moment?
 "reason": "...",               // one sentence, English
 "start_s": <float>,            // adjusted clip start: include the SETUP of the moment
 "end_s": <float>,              // adjusted clip end: land just after the PAYOFF
 "virality_score": 0-100,
 "mood": "funny|hype|emotional|impressive|wholesome|controversial",
 "category": "...",             // short grouping label, e.g. "funny moment", "song performance", "clutch play"
 "title_zh": "...", "title_en": "...",
 "hook_zh": "...",              // <=12 chars on-screen hook for the first 2 seconds
 "caption_zh": "...", "caption_en": "...",
 "hashtags": ["#...", ...]      // 5-8, mixed zh/en, platform-generic
}
Rules: start_s/end_s must stay within the allowed range given by the user, total
length 8-60 seconds. Prefer starting at a natural sentence/action boundary.
If transcript and chat both look like idle filler, set keep=false."""


def extract_keyframes(video, times_s, max_dim=640):
    """Grab downscaled JPEG frames at the given timestamps."""
    frames = []
    for t in times_s:
        cmd = [
            "ffmpeg", "-v", "error", "-ss", str(t), "-i", str(video),
            "-frames:v", "1", "-vf", f"scale='min({max_dim},iw)':-2",
            "-q:v", "5", "-f", "image2pipe", "-vcodec", "mjpeg", "-",
        ]
        try:
            out = subprocess.run(cmd, check=True, capture_output=True).stdout
            if out:
                frames.append(out)
        except subprocess.CalledProcessError:
            pass
    return frames


def transcript_excerpt(transcript, start_s, end_s):
    segs = [
        s for s in transcript["segments"]
        if s["end_s"] >= start_s - CONTEXT_PAD_S and s["start_s"] <= end_s + CONTEXT_PAD_S
    ]
    return "\n".join(f"[{s['start_s']:.0f}s {s.get('speaker','')}] {s['text']}" for s in segs)


def chat_excerpt(chats, start_s, end_s, limit=25):
    window = chats[
        (chats["offset_s"] >= start_s - CONTEXT_PAD_S) & (chats["offset_s"] <= end_s + CONTEXT_PAD_S)
    ]
    top = window.sort_values("weight", ascending=False).head(limit).sort_values("offset_s")
    return "\n".join(f"[{r.offset_s:.0f}s] {r.name_}: {r.text}" for r in top.itertuples())


def judge_candidate(brt, cand, transcript, chats, video, model_id=MODEL_ID):
    start_s, end_s, peak_s = cand["start_s"], cand["end_s"], cand["peak_s"]
    lo, hi = max(0, start_s - CONTEXT_PAD_S), end_s + CONTEXT_PAD_S

    content = []
    text = (
        f"Candidate moment: peak at {peak_s:.0f}s, detected window {start_s:.0f}-{end_s:.0f}s, "
        f"fusion score {cand['score']}, agreeing signals: {', '.join(cand.get('modalities', []))}.\n"
        f"Allowed clip range: {lo:.0f}s to {hi:.0f}s.\n\n"
    )
    if transcript:
        text += f"TRANSCRIPT:\n{transcript_excerpt(transcript, start_s, end_s) or '(no speech)'}\n\n"
    if chats is not None:
        text += f"LIVE CHAT:\n{chat_excerpt(chats, start_s, end_s) or '(no chat)'}\n\n"
    content.append({"text": text})

    if video:
        for frame in extract_keyframes(video, [start_s + 1, peak_s, max(end_s - 1, peak_s + 1)]):
            content.append({"image": {"format": "jpeg", "source": {"bytes": frame}}})

    resp = brt.converse(
        modelId=model_id,
        system=[{"text": SYSTEM}],
        messages=[{"role": "user", "content": content}],
        inferenceConfig={"maxTokens": 800, "temperature": 0.4},
    )
    raw = resp["output"]["message"]["content"][0]["text"]
    verdict = json.loads(raw[raw.index("{"): raw.rindex("}") + 1])
    # Clamp the director's boundaries to the allowed range and length rules.
    verdict["start_s"] = max(lo, float(verdict.get("start_s", start_s)))
    verdict["end_s"] = min(hi, float(verdict.get("end_s", end_s)))
    if verdict["end_s"] - verdict["start_s"] > MAX_CLIP_S:
        # keep the peak inside; bias toward keeping the setup before it
        verdict["start_s"] = max(verdict["start_s"], min(peak_s - MAX_CLIP_S * 0.6, verdict["end_s"] - MAX_CLIP_S))
        verdict["end_s"] = verdict["start_s"] + MAX_CLIP_S
    return verdict


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("candidates")
    ap.add_argument("--transcript", default=None)
    ap.add_argument("--chat-log", default=None, help="raw langlive CSV")
    ap.add_argument("--chat-offset", type=float, default=0.0,
                    help="seconds to subtract from chat times to get video time")
    ap.add_argument("--video", default=None, help="local VOD for keyframes")
    ap.add_argument("--model", default=MODEL_ID)
    ap.add_argument("--out", default="out/highlights.json")
    args = ap.parse_args(argv)

    cands = json.loads(Path(args.candidates).read_text())["candidates"]
    transcript = json.loads(Path(args.transcript).read_text()) if args.transcript else None

    chats = None
    if args.chat_log:
        from pipeline.signals.chat import _chat_weights, parse_langlive_log, session_bounds

        events = parse_langlive_log(args.chat_log)
        start, _ = session_bounds(events)
        chats = events[events["type"].isin(["msg", "msg_dirty"])].copy()
        chats["offset_s"] = (chats["t"] - start).dt.total_seconds() - args.chat_offset
        chats["weight"], _ = _chat_weights(chats)
        chats["name_"] = chats["name"]

    brt = boto3.client("bedrock-runtime", region_name=REGION)
    highlights = []
    for i, cand in enumerate(cands):
        try:
            verdict = judge_candidate(brt, cand, transcript, chats, args.video, args.model)
        except Exception as e:  # keep going; one bad candidate shouldn't kill the run
            print(f"  candidate {i} ({cand['peak_s']}s) ERROR: {e}")
            continue
        status = "KEEP" if verdict.get("keep") else "drop"
        print(f"  [{status}] {cand['peak_s']:6.0f}s v={verdict.get('virality_score')} "
              f"{verdict.get('mood','')} | {verdict.get('title_zh','')}")
        if verdict.get("keep"):
            highlights.append({**cand, **verdict})

    highlights.sort(key=lambda h: -h.get("virality_score", 0))
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps({"model": args.model, "highlights": highlights}, ensure_ascii=False, indent=1))
    print(f"kept {len(highlights)}/{len(cands)} -> {out}")


if __name__ == "__main__":
    sys.exit(main())
