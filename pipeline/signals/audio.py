"""Audio excitement signal: loudness dynamics from the VOD's audio track.

Uses ffmpeg's astats filter to get per-window RMS levels, then scores each bin
by (a) absolute loudness vs the session baseline and (b) sudden jumps
(quiet -> scream / crowd pop). No ML needed; this is the cheap arousal proxy
that complements Transcribe semantics.

Usage:
  python3 -m pipeline.signals.audio data/6910008_video.mp4 --out out/audio_signals.json
  python3 -m pipeline.signals.audio extract data/6910008_video.mp4 --to data/6910008_audio.m4a
"""

import argparse
import json
import subprocess
import sys
from pathlib import Path

import numpy as np
from scipy.ndimage import gaussian_filter1d

BIN_SECONDS = 5


def extract_audio(video_path, out_path):
    """Copy the audio stream out of the VOD without re-encoding (fast, small)."""
    cmd = [
        "ffmpeg", "-y", "-v", "error", "-i", str(video_path),
        "-vn", "-acodec", "copy", str(out_path),
    ]
    subprocess.run(cmd, check=True)
    return out_path


def rms_series(media_path, bin_seconds=BIN_SECONDS):
    """Per-bin RMS level (dB) via ffmpeg astats metadata prints."""
    # asetnsamples groups audio into bin-sized frames; astats+ametadata print
    # one Overall.RMS_level per frame on stderr-free stdout (pipe via -f null).
    cmd = [
        "ffmpeg", "-v", "error", "-i", str(media_path), "-vn",
        "-af",
        f"aresample=8000,asetnsamples=n={8000 * bin_seconds}:p=0,"
        "astats=metadata=1:reset=1,"
        "ametadata=print:key=lavfi.astats.Overall.RMS_level:file=-",
        "-f", "null", "-",
    ]
    out = subprocess.run(cmd, check=True, capture_output=True, text=True).stdout
    levels = []
    for line in out.splitlines():
        if line.startswith("lavfi.astats.Overall.RMS_level="):
            v = line.split("=", 1)[1]
            levels.append(float(v) if v not in ("-inf", "nan") else -90.0)
    return np.clip(np.array(levels), -90.0, 0.0)


def audio_features(levels_db, bin_seconds=BIN_SECONDS, smooth_sigma=2.0):
    """Loudness + onset (jump) z-scores fused into one excitement curve."""
    loud_z = (levels_db - levels_db.mean()) / (levels_db.std() or 1.0)
    jump = np.diff(levels_db, prepend=levels_db[0])
    jump_z = np.clip((jump - jump.mean()) / (jump.std() or 1.0), 0, None)  # only rises
    excitement = gaussian_filter1d(0.7 * loud_z + 0.3 * jump_z, smooth_sigma)
    return {
        "t_s": [i * bin_seconds for i in range(len(levels_db))],
        "rms_db": [round(float(v), 2) for v in levels_db],
        "excitement": [round(float(v), 4) for v in excitement],
    }


def analyze(media_path, bin_seconds=BIN_SECONDS):
    levels = rms_series(media_path, bin_seconds)
    feats = audio_features(levels, bin_seconds)
    return {
        "signal": "audio",
        "source": str(media_path),
        "bin_seconds": bin_seconds,
        "series": feats,
    }


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("cmd_or_media", help="'extract' or path to media file")
    ap.add_argument("media", nargs="?", help="media path when using 'extract'")
    ap.add_argument("--to", default=None, help="output audio path for 'extract'")
    ap.add_argument("--out", default="out/audio_signals.json")
    ap.add_argument("--bin", type=int, default=BIN_SECONDS)
    args = ap.parse_args(argv)

    if args.cmd_or_media == "extract":
        to = args.to or str(Path(args.media).with_suffix(".m4a"))
        print("audio ->", extract_audio(args.media, to))
        return

    result = analyze(args.cmd_or_media, args.bin)
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(result))
    n = len(result["series"]["t_s"])
    print(f"bins={n} ({n * args.bin / 60:.1f} min) -> {out}")


if __name__ == "__main__":
    sys.exit(main())
