"""Auto-align the platform event log with the VOD.

The recording usually starts AFTER the chat room opens (pre-show lobby), so chat
timestamps (seconds since onRoomCreated) lead video timestamps by an unknown
offset. We estimate it by cross-correlating the chat excitement curve against
the audio excitement curve over all feasible lags: the crowd reacts to what
happens on stream, so the curves line up at the true offset.

Usage:
  python3 -m pipeline.align out/chat_signals.json out/audio_signals.json
Prints the best offset (seconds to SUBTRACT from chat times to get video time).
"""

import argparse
import json
import sys
from pathlib import Path

import numpy as np


def estimate_offset(chat, audio, max_extra_lag_s=600):
    """Best lag (s): chat_time - lag = video_time. Returns (lag_s, confidence)."""
    bs = chat["bin_seconds"]
    assert audio["bin_seconds"] == bs, "signals must share bin size"
    c = np.asarray(chat["series"]["excitement"], dtype=float)
    a = np.asarray(audio["series"]["excitement"], dtype=float)

    c = (c - c.mean()) / (c.std() or 1.0)
    a = (a - a.mean()) / (a.std() or 1.0)

    # Chat session should be >= video duration; search lag in
    # [0, session_len - video_len + slack].
    max_lag_bins = max(len(c) - len(a), 0) + int(max_extra_lag_s // bs)
    scores = []
    for lag in range(0, max_lag_bins + 1):
        seg = c[lag: lag + len(a)]
        n = min(len(seg), len(a))
        if n < 60:  # need at least 5 min of overlap
            break
        scores.append(float(np.dot(seg[:n], a[:n]) / n))
    if not scores:
        return 0.0, 0.0
    scores = np.asarray(scores)
    best = int(scores.argmax())
    # confidence: peak height vs distribution of other lags
    others = np.delete(scores, best)
    conf = float((scores[best] - others.mean()) / (others.std() or 1.0))
    return best * bs, conf


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("chat_json")
    ap.add_argument("audio_json")
    args = ap.parse_args(argv)

    chat = json.loads(Path(args.chat_json).read_text())
    audio = json.loads(Path(args.audio_json).read_text())
    lag, conf = estimate_offset(chat, audio)
    session = chat["duration_s"]
    video = audio["series"]["t_s"][-1] + audio["bin_seconds"]
    print(f"session={session:.0f}s video={video:.0f}s naive_offset={session - video:.0f}s")
    print(f"estimated chat->video offset: {lag:.0f}s (confidence z={conf:.1f})")
    print(json.dumps({"offset_s": lag, "confidence_z": round(conf, 2)}))


if __name__ == "__main__":
    sys.exit(main())
