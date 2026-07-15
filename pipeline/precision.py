"""Detection-precision scoring against a labeled ground-truth fixture.

Pure functions over `(start, end)` windows: temporal IoU, match test, and
precision@k of detected highlight clips vs the known highlight windows in
`pipeline/fixtures/ground_truth.json`. Consumed by pipeline.metrics.
"""

import json
from pathlib import Path

_FIXTURE = Path(__file__).resolve().parent / "fixtures" / "ground_truth.json"


def _bounds(win):
    """Accept (start, end) tuples, or clip/window dicts with start/end or
    start_s/end_s keys."""
    if isinstance(win, dict):
        start = win.get("start", win.get("start_s"))
        end = win.get("end", win.get("end_s"))
        return float(start), float(end)
    return float(win[0]), float(win[1])


def iou(a, b):
    """Temporal intersection-over-union of two windows, in [0, 1]."""
    a0, a1 = _bounds(a)
    b0, b1 = _bounds(b)
    inter = max(0.0, min(a1, b1) - max(a0, b0))
    union = (a1 - a0) + (b1 - b0) - inter
    return inter / union if union > 0 else 0.0


def matches(detected, labeled, threshold):
    """True iff the detected window overlaps a labeled window at IoU >= threshold."""
    return iou(detected, labeled) >= threshold


def precision_at_k(detected_ranked, labeled, k, threshold):
    """Fraction of the top-k detected windows (already ranked best-first) that
    match at least one labeled window. Returns a value in [0, 1]."""
    if k <= 0:
        return 0.0
    top = detected_ranked[:k]
    hits = sum(1 for d in top if any(matches(d, lab, threshold) for lab in labeled))
    return hits / k


def load_fixture(stream_id, path=None):
    """Labeled windows for a stream id, or [] if none exist."""
    path = Path(path) if path else _FIXTURE
    if not path.exists():
        return []
    data = json.loads(path.read_text())
    return data.get(str(stream_id), [])


def score_precision(clips, labeled, config):
    """Precision indicator for a VOD, or None when there are no labeled windows.

    `clips` are clip records (contract shape: start/end/score); ranked by score
    descending. `config` is the `precision` block of config/metrics.json.
    """
    if not labeled:
        return None
    k = int(config.get("k", 5))
    threshold = float(config.get("iouMatchThreshold", 0.3))

    ranked = sorted(clips, key=lambda c: -float(c.get("score", c.get("virality_score", 0))))
    detected = []
    for c in ranked:
        try:
            detected.append(_bounds(c))
        except (TypeError, ValueError, KeyError):
            continue  # skip clips without usable start/end

    p_at_k = precision_at_k(detected, labeled, k, threshold)
    # meanBestIou: for each labeled window, the best IoU over all detected windows.
    if detected:
        best = [max(iou(d, lab) for d in detected) for lab in labeled]
        mean_best_iou = round(sum(best) / len(best), 2)
    else:
        mean_best_iou = 0.0
    return {"k": k, "precisionAtK": round(p_at_k, 2), "meanBestIou": mean_best_iou}
