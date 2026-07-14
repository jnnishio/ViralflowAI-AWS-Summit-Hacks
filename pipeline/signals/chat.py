"""Chat/engagement excitement signal from a langlive event-log CSV.

The log is a CSV with columns [@timestamp, message, msg] where `message` is an
embedded JSON payload and `msg` is the event type:
  - msg / msg_dirty : chat message (c.msg text, c.vip_lvl, c.uglv, c.is_admin, ...)
  - join / msg_join : viewer joined the room
  - duration        : watch-time report on disconnect
  - onRoomCreated / owner_leave : session lifecycle

Output: per-bin engagement features -> normalized excitement curve -> candidate
highlight windows, as JSON (plus an optional plot). Timestamps in the output
are SECONDS SINCE STREAM START (onRoomCreated), which maps 1:1 onto VOD time
when the recording starts at room creation; use --t0 to override.
"""

import argparse
import json
import re
import sys
from pathlib import Path

import numpy as np
import pandas as pd
from scipy.ndimage import gaussian_filter1d
from scipy.signal import find_peaks

BIN_SECONDS = 5

# Patterns that signal laughter / hype in zh-TW stream chat.
LAUGH_RE = re.compile(
    r"哈{2,}|笑死|笑爛|笑翻|太好笑|好猛|太強|太扯|666+|888+|XD+|xd+|lol|LOL|ㄏㄏ|草{2,}|[🤣😂😆😹💀]"
)
EMOJI_RE = re.compile(
    "[\U0001F300-\U0001FAFF\U00002600-\U000027BF\U0001F000-\U0001F02F\U0000FE00-\U0000FE0F]"
)


def _chat_weights(chats):
    """VIP/level-weighted message value with template-spam suppression.

    Fan clubs paste identical promo lines ("送男神專屬禮物...") dozens of times;
    those track fan discipline, not stream excitement. Novelty = 1/sqrt(times
    this exact text appears in the session), so organic reactions dominate.
    """
    weight = 1.0 + 0.5 * np.log1p(chats["vip_lvl"]) + 0.25 * np.log1p(chats["uglv"])
    norm_text = chats["text"].str.replace(r"\s+", "", regex=True)
    novelty = 1.0 / np.sqrt(norm_text.map(norm_text.value_counts()).clip(lower=1))
    return weight * novelty, novelty


def _num(v, default=0.0):
    try:
        return float(v)
    except (TypeError, ValueError):
        return default


def parse_langlive_log(csv_path):
    """Parse the raw log CSV into a tidy event DataFrame (sorted by time)."""
    raw = pd.read_csv(csv_path)
    events = []
    for _, row in raw.iterrows():
        try:
            payload = json.loads(row["message"])
        except (json.JSONDecodeError, TypeError):
            continue
        etype = payload.get("msg")
        t = payload.get("time")
        if not t:
            continue
        ev = {"t": t, "type": etype}
        c = payload.get("c") or {}
        if etype in ("msg", "msg_dirty"):
            ev.update(
                pfid=str(c.get("pfid", "")),
                name=c.get("name", ""),
                text=str(c.get("msg", "")),
                vip_lvl=_num(c.get("vip_lvl")),
                uglv=_num(c.get("uglv")),
                is_admin=bool(c.get("is_admin", False)),
            )
        elif etype == "join":
            ev.update(pfid=str(payload.get("pfid", "")), name=payload.get("user_name", ""))
        elif etype == "msg_join":
            ev.update(pfid=str(c.get("pfid", "")), name=c.get("name", ""))
        events.append(ev)

    df = pd.DataFrame(events)
    df["t"] = pd.to_datetime(df["t"], utc=True, format="ISO8601")
    return df.sort_values("t").reset_index(drop=True)


def session_bounds(events):
    """Stream start/end: room creation -> owner leave (fallback: data extent)."""
    created = events.loc[events["type"] == "onRoomCreated", "t"]
    left = events.loc[events["type"] == "owner_leave", "t"]
    start = created.min() if len(created) else events["t"].min()
    end = left.max() if len(left) else events["t"].max()
    return start, end


def bin_features(events, start, end, bin_seconds=BIN_SECONDS):
    """Aggregate events into fixed-width time bins of engagement features."""
    events = events[(events["t"] >= start) & (events["t"] <= end)].copy()
    events["bin"] = ((events["t"] - start).dt.total_seconds() // bin_seconds).astype(int)
    n_bins = int(np.ceil((end - start).total_seconds() / bin_seconds)) + 1
    idx = pd.RangeIndex(n_bins, name="bin")

    chats = events[events["type"].isin(["msg", "msg_dirty"])].copy()
    chats["weight"], novelty = _chat_weights(chats)
    chats["laugh"] = chats["text"].str.count(LAUGH_RE) * novelty
    chats["emoji"] = chats["text"].str.count(EMOJI_RE) * novelty

    # `join` fires once per socket (often 2+ per user join) - dedupe per user+second.
    joins = events[events["type"] == "join"].copy()
    joins = joins.drop_duplicates(subset=["pfid", joins["t"].dt.floor("s").name or "t"])
    joins = joins.drop_duplicates(subset=["pfid", "bin"])

    g = chats.groupby("bin")
    feats = pd.DataFrame(
        {
            "msg_count": g.size(),
            "weighted_msg": g["weight"].sum(),
            "chatters": g["pfid"].nunique(),
            "laugh": g["laugh"].sum(),
            "emoji": g["emoji"].sum(),
        },
        index=idx,
    ).fillna(0.0)
    feats["join_count"] = joins.groupby("bin").size().reindex(idx).fillna(0.0)
    return feats


def _z(series):
    sd = series.std()
    if sd == 0:
        return series * 0.0
    return (series - series.mean()) / sd


def excitement_curve(feats, smooth_sigma=2.0):
    """Fuse chat features into one smoothed excitement z-curve."""
    score = (
        0.40 * _z(feats["weighted_msg"])
        + 0.20 * _z(feats["chatters"])
        + 0.25 * _z(feats["laugh"] + 0.5 * feats["emoji"])
        + 0.15 * _z(feats["join_count"])
    )
    return pd.Series(gaussian_filter1d(score.values, smooth_sigma), index=feats.index)


def detect_candidates(
    curve,
    chats=None,
    bin_seconds=BIN_SECONDS,
    height=1.0,
    min_gap_bins=8,
    edge_threshold=0.35,
    max_len_s=75,
    min_len_s=10,
):
    """Peak-pick the curve and expand each peak into a candidate window."""
    peaks, props = find_peaks(curve.values, height=height, distance=min_gap_bins)
    candidates = []
    for p in peaks:
        lo = p
        while lo > 0 and curve.iloc[lo - 1] > edge_threshold and (p - lo) * bin_seconds < max_len_s / 2:
            lo -= 1
        hi = p
        while (
            hi < len(curve) - 1
            and curve.iloc[hi + 1] > edge_threshold
            and (hi - p) * bin_seconds < max_len_s / 2
        ):
            hi += 1
        start_s = lo * bin_seconds
        end_s = (hi + 1) * bin_seconds
        if end_s - start_s < min_len_s:
            pad = (min_len_s - (end_s - start_s)) / 2
            start_s, end_s = max(0, start_s - pad), end_s + pad
        cand = {
            "start_s": round(start_s, 1),
            "end_s": round(end_s, 1),
            "peak_s": round(p * bin_seconds, 1),
            "score": round(float(curve.iloc[p]), 3),
        }
        if chats is not None:
            window = chats[(chats["offset_s"] >= start_s) & (chats["offset_s"] <= end_s)]
            top = window.sort_values("weight", ascending=False).head(8)
            cand["sample_messages"] = [
                {"t": round(r.offset_s, 1), "name": r.name_, "text": r.text}
                for r in top.itertuples()
            ]
        candidates.append(cand)

    # Merge overlaps, keep the higher-scored peak's metadata.
    candidates.sort(key=lambda c: c["start_s"])
    merged = []
    for c in candidates:
        if merged and c["start_s"] <= merged[-1]["end_s"]:
            keep = max(merged[-1], c, key=lambda x: x["score"])
            keep = dict(keep)
            keep["start_s"] = merged[-1]["start_s"]
            keep["end_s"] = max(merged[-1]["end_s"], c["end_s"])
            merged[-1] = keep
        else:
            merged.append(c)
    merged.sort(key=lambda c: -c["score"])
    return merged


def analyze(csv_path, t0=None, bin_seconds=BIN_SECONDS):
    """Full chat-signal pass. Returns the result dict (see module docstring)."""
    events = parse_langlive_log(csv_path)
    start, end = session_bounds(events)
    if t0 is not None:
        start = pd.Timestamp(t0, tz="UTC")
    feats = bin_features(events, start, end, bin_seconds)
    curve = excitement_curve(feats)

    chats = events[events["type"].isin(["msg", "msg_dirty"])].copy()
    chats["offset_s"] = (chats["t"] - start).dt.total_seconds()
    chats["weight"], _ = _chat_weights(chats)
    chats["name_"] = chats["name"]

    candidates = detect_candidates(curve, chats, bin_seconds)
    return {
        "signal": "chat",
        "source": str(csv_path),
        "session_start_utc": start.isoformat(),
        "session_end_utc": end.isoformat(),
        "duration_s": round((end - start).total_seconds(), 1),
        "bin_seconds": bin_seconds,
        "series": {
            "t_s": [int(b * bin_seconds) for b in feats.index],
            "excitement": [round(float(v), 4) for v in curve.values],
            "msg_count": feats["msg_count"].astype(int).tolist(),
            "join_count": feats["join_count"].astype(int).tolist(),
            "laugh": feats["laugh"].astype(int).tolist(),
        },
        "candidates": candidates,
    }


def plot(result, out_png):
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    t = np.array(result["series"]["t_s"]) / 60.0
    fig, ax = plt.subplots(figsize=(14, 4.5))
    ax.plot(t, result["series"]["excitement"], lw=1.2, label="excitement (z)")
    for c in result["candidates"]:
        ax.axvspan(c["start_s"] / 60, c["end_s"] / 60, alpha=0.25, color="tab:orange")
    ax.set_xlabel("stream time (min)")
    ax.set_ylabel("excitement")
    ax.set_title("Chat engagement excitement curve — candidates shaded")
    ax.legend()
    fig.tight_layout()
    fig.savefig(out_png, dpi=130)
    return out_png


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("csv", help="langlive event-log CSV")
    ap.add_argument("--out", default="out/chat_signals.json")
    ap.add_argument("--plot", default=None, help="optional PNG path for the curve plot")
    ap.add_argument("--t0", default=None, help="override stream start (ISO UTC) for VOD alignment")
    ap.add_argument("--bin", type=int, default=BIN_SECONDS)
    args = ap.parse_args(argv)

    result = analyze(args.csv, t0=args.t0, bin_seconds=args.bin)
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(
        json.dumps(result, ensure_ascii=False, indent=1,
                   default=lambda o: o.item() if hasattr(o, "item") else str(o))
    )
    print(f"session: {result['session_start_utc']} -> {result['session_end_utc']} "
          f"({result['duration_s'] / 60:.1f} min)")
    print(f"candidates: {len(result['candidates'])} -> {out}")
    for c in result["candidates"][:10]:
        mm, ss = divmod(int(c["peak_s"]), 60)
        print(f"  {mm:3d}:{ss:02d}  score={c['score']:5.2f}  window={c['start_s']:.0f}-{c['end_s']:.0f}s")
    if args.plot:
        print("plot ->", plot(result, args.plot))


if __name__ == "__main__":
    sys.exit(main())
