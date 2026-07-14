"""Multimodal fusion: merge per-signal series into one excitement curve and
emit ranked candidate highlight windows for the AI Director.

Inputs are the JSON outputs of pipeline.signals.{chat,audio,visual,transcript}.
All series are resampled onto a common bin grid, z-normalized, and combined
with per-vertical weights. Cross-modal validation keeps only windows where at
least `min_modalities` signals independently spike, which kills single-source
false positives (chat spam, music loudness, scene-change bursts).

Usage:
  python3 -m pipeline.fusion --chat out/chat_signals.json --audio out/audio_signals.json \
      --visual out/visual_signals.json --out out/candidates.json --top 12
"""

import argparse
import json
import sys
from pathlib import Path

import numpy as np
from scipy.ndimage import gaussian_filter1d
from scipy.signal import find_peaks

BIN_SECONDS = 5

# Per-vertical fusion weights (the "generic/both" story: same signals,
# different emphasis). config/weights.json overrides these without a redeploy
# (see .kiro/steering/architecture.md "Config over redeploy").
WEIGHTS = {
    "talk": {"chat": 0.40, "audio": 0.25, "speech": 0.15, "visual": 0.20},
    "gaming": {"chat": 0.35, "audio": 0.20, "speech": 0.10, "visual": 0.35},
}
_cfg = Path(__file__).resolve().parent.parent / "config" / "weights.json"
if _cfg.exists():
    WEIGHTS.update(json.loads(_cfg.read_text()))


def _z(x):
    x = np.asarray(x, dtype=float)
    sd = x.std()
    return (x - x.mean()) / sd if sd else x * 0.0


def _resample(t_s, values, n_bins, bin_seconds):
    """Map an arbitrary (t_s, value) series onto the common bin grid."""
    out = np.zeros(n_bins)
    counts = np.zeros(n_bins)
    for t, v in zip(t_s, values):
        b = int(t // bin_seconds)
        if 0 <= b < n_bins:
            out[b] += v
            counts[b] += 1
    counts[counts == 0] = 1
    return out / counts


def load_signal(path):
    return json.loads(Path(path).read_text()) if path and Path(path).exists() else None


def fuse(chat=None, audio=None, visual=None, transcript_feats=None,
         vertical="talk", bin_seconds=BIN_SECONDS, smooth_sigma=1.5,
         chat_offset_s=0.0):
    """Returns (curve, per_modality_z, n_bins). Missing signals just drop out
    and their weight is renormalized over what's present. chat_offset_s maps
    event-log session time onto video time (see pipeline.align)."""
    duration_candidates = []
    for sig in (audio, visual):
        if sig:
            duration_candidates.append(sig["series"]["t_s"][-1] + sig["bin_seconds"])
    if chat:
        duration_candidates.append(chat["series"]["t_s"][-1] - chat_offset_s + chat["bin_seconds"])
    if transcript_feats:
        duration_candidates.append(transcript_feats["t_s"][-1] + bin_seconds)
    duration = max(duration_candidates)
    n_bins = int(np.ceil(duration / bin_seconds))

    modal = {}
    if chat:
        chat_t = [t - chat_offset_s for t in chat["series"]["t_s"]]
        modal["chat"] = _z(_resample(chat_t, chat["series"]["excitement"], n_bins, bin_seconds))
    if audio:
        modal["audio"] = _z(_resample(audio["series"]["t_s"], audio["series"]["excitement"], n_bins, bin_seconds))
    if visual:
        v = visual["series"]
        vis = 0.5 * _z(_resample(v["t_s"], v["scene_change"], n_bins, bin_seconds)) + \
              0.5 * _z(_resample(v["t_s"], v["emotion_hot"], n_bins, bin_seconds))
        modal["visual"] = vis
    if transcript_feats:
        modal["speech"] = _z(_resample(transcript_feats["t_s"], transcript_feats["word_rate"], n_bins, bin_seconds))

    weights = {k: WEIGHTS[vertical][k] for k in modal}
    total = sum(weights.values())
    curve = sum(w / total * modal[k] for k, w in weights.items())
    curve = gaussian_filter1d(curve, smooth_sigma)
    return curve, modal, n_bins


def candidates_from_curve(curve, modal, bin_seconds=BIN_SECONDS, top=12,
                          min_modalities=2, modality_bar=0.75,
                          edge_threshold=0.3, max_len_s=75, min_len_s=15):
    peaks, _ = find_peaks(curve, height=0.8, distance=int(60 // bin_seconds))
    out = []
    for p in peaks:
        # Cross-modal validation: how many signals independently spike near p?
        lo_c, hi_c = max(0, p - 2), min(len(curve), p + 3)
        agreeing = [k for k, v in modal.items() if v[lo_c:hi_c].max() >= modality_bar]
        if len(agreeing) < min(min_modalities, len(modal)):
            continue

        lo = p
        while lo > 0 and curve[lo - 1] > edge_threshold and (p - lo) * bin_seconds < max_len_s / 2:
            lo -= 1
        hi = p
        while hi < len(curve) - 1 and curve[hi + 1] > edge_threshold and (hi - p) * bin_seconds < max_len_s / 2:
            hi += 1
        start_s, end_s = lo * bin_seconds, (hi + 1) * bin_seconds
        if end_s - start_s < min_len_s:
            pad = (min_len_s - (end_s - start_s)) / 2
            start_s, end_s = max(0, start_s - pad), end_s + pad
        out.append(
            {
                "start_s": round(start_s, 1),
                "end_s": round(end_s, 1),
                "peak_s": round(p * bin_seconds, 1),
                "score": round(float(curve[p]), 3),
                "modalities": agreeing,
                # per-modality z at the peak -> "view score details" in the UI
                "factors": {k: round(float(v[lo_c:hi_c].max()), 3) for k, v in modal.items()},
            }
        )

    # merge overlaps, rank by score
    out.sort(key=lambda c: c["start_s"])
    merged = []
    for c in out:
        if merged and c["start_s"] <= merged[-1]["end_s"]:
            best = max(merged[-1], c, key=lambda x: x["score"])
            best = dict(best)
            best["start_s"] = merged[-1]["start_s"]
            best["end_s"] = max(merged[-1]["end_s"], c["end_s"])
            best["modalities"] = sorted(set(merged[-1]["modalities"]) | set(c["modalities"]))
            merged[-1] = best
        else:
            merged.append(c)
    merged.sort(key=lambda c: -c["score"])
    return merged[:top]


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--chat")
    ap.add_argument("--audio")
    ap.add_argument("--visual")
    ap.add_argument("--transcript", help="out/transcript.json (for word-rate feature)")
    ap.add_argument("--vertical", choices=list(WEIGHTS), default="talk")
    ap.add_argument("--chat-offset", type=float, default=0.0,
                    help="seconds to subtract from chat times to get video time")
    ap.add_argument("--top", type=int, default=12)
    ap.add_argument("--min-modalities", type=int, default=2)
    ap.add_argument("--out", default="out/candidates.json")
    args = ap.parse_args(argv)

    chat, audio, visual = (load_signal(p) for p in (args.chat, args.audio, args.visual))
    transcript_feats = None
    if args.transcript and Path(args.transcript).exists():
        from pipeline.signals.transcript import speech_features

        transcript_feats = speech_features(json.loads(Path(args.transcript).read_text()), BIN_SECONDS)

    curve, modal, n_bins = fuse(chat, audio, visual, transcript_feats,
                                vertical=args.vertical, chat_offset_s=args.chat_offset)
    cands = candidates_from_curve(curve, modal, top=args.top, min_modalities=args.min_modalities)

    result = {
        "vertical": args.vertical,
        "bin_seconds": BIN_SECONDS,
        "modalities_present": sorted(modal),
        "series": {
            "t_s": [b * BIN_SECONDS for b in range(n_bins)],
            "excitement": [round(float(v), 4) for v in curve],
            **{f"z_{k}": [round(float(x), 3) for x in v] for k, v in modal.items()},
        },
        "candidates": cands,
    }
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(
        result, default=lambda o: o.item() if hasattr(o, "item") else str(o)))
    print(f"modalities={sorted(modal)} candidates={len(cands)} -> {out}")
    for c in cands:
        mm, ss = divmod(int(c["peak_s"]), 60)
        print(f"  {mm:3d}:{ss:02d} score={c['score']:5.2f} [{','.join(c['modalities'])}] {c['start_s']:.0f}-{c['end_s']:.0f}s")


if __name__ == "__main__":
    sys.exit(main())
