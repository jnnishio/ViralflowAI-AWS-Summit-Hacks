"""Unit tests for pipeline/metrics.py + pipeline/precision.py (metrics-dashboard, Task 6).

Plain pytest-style functions, also runnable directly (`python3 tests/test_metrics.py`)
via the __main__ harness, since pytest is a dev-only dependency.
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from pipeline import metrics as m
from pipeline import precision as p


def _cfg():
    return m.load_config()


def test_iou_and_precision_at_k():
    # Req 4.1: IoU geometry.
    assert p.iou((0, 10), (0, 10)) == 1.0          # identical
    assert p.iou((0, 10), (20, 30)) == 0.0         # disjoint
    assert round(p.iou((0, 10), (5, 15)), 3) == 0.333  # half overlap

    # Req 4.3: precision@k over ranked detections vs labeled windows.
    labeled = [(1645, 1675), (3755, 3785)]
    ranked = [(1645, 1675), (100, 130), (3755, 3785)]  # 2 of 3 match
    assert abs(p.precision_at_k(ranked, labeled, 3, 0.3) - 2 / 3) < 1e-9
    assert p.precision_at_k(ranked, labeled, 2, 0.3) == 0.5  # only rank-1 matches in top-2
    assert p.precision_at_k(ranked, labeled, 0, 0.3) == 0.0  # k=0 guard


def test_editing_time_saved_zero_guard():
    cfg = _cfg()
    # Req 6.3: zero clips -> zero baseline -> 0%, no division by zero.
    assert m.editing_time_saved_pct(0, 100.0, cfg) == 0.0
    # normal case: 2 clips * 45min baseline=90min; wall=15min -> 83.33%
    assert m.editing_time_saved_pct(2, 900.0, cfg) == 83.33


def test_clips_per_hour_zero_guard():
    # Req 7.2: zero wall-clock -> 0, no division by zero.
    assert m.clips_per_hour(5, 0.0) == 0
    assert m.clips_per_hour(2, 900.0) == 8.0


def test_quality_score_bounds_and_empty():
    cfg = _cfg()
    # Req 8.3: empty clip set -> 0.
    assert m.quality_score([], cfg) == 0.0
    # Req 8.2: bounded in [0, 1].
    top = [{"score": 100, "modalities": ["chat", "audio", "visual"]}]
    bottom = [{"score": 0, "modalities": []}]
    assert 0.0 <= m.quality_score(bottom, cfg) <= m.quality_score(top, cfg) <= 1.0
    assert m.quality_score(top, cfg) == 1.0


def test_wall_clock_from_timings():
    timings = {"stages": [
        {"name": "chat", "startS": 0.0, "endS": 1.0},
        {"name": "render", "startS": 1.0, "endS": 900.0},
    ]}
    assert m.wall_clock_seconds(timings) == 900.0
    assert m.wall_clock_seconds(None) == 0.0


def test_graceful_degradation_omits_absent_indicators():
    cfg = _cfg()
    clips = [{"score": 80, "modalities": ["chat", "audio"]}]

    # Req 10.1/10.3: no timings -> timing indicators omitted, doc still built.
    no_timings = m.build_metrics("unknown", clips, None, None, cfg, labeled=[])
    for k in ("wallClockSeconds", "editingTimeSavedPct", "automationLevel", "clipsPerHour"):
        assert k not in no_timings
    assert "qualityScore" in no_timings and "costPerVod" in no_timings

    # Req 4.5: no fixture windows -> precision omitted.
    assert "detectionPrecision" not in no_timings

    # with a fixture + timings + batch, all present.
    timings = {"stages": [{"name": "a", "startS": 0.0, "endS": 900.0}]}
    labeled = p.load_fixture("6910008")
    full = m.build_metrics("6910008", clips, timings, {"vods": 2}, cfg, labeled=labeled)
    assert "detectionPrecision" in full
    assert "clipsPerHour" in full
    assert full["batch"] == {"vods": 2}


def test_projections_labeled():
    cfg = _cfg()
    mon = m.monetization_projection(5, cfg)
    reuse = m.content_reuse_projection(5, None, cfg)
    # Req 9.3: both marked as projections and carry their assumptions.
    assert mon["kind"] == "projection" and "assumptions" in mon
    assert reuse["kind"] == "projection" and "assumptions" in reuse


# --- standalone harness (runs without pytest installed) ---------------------
if __name__ == "__main__":
    import traceback

    passed = failed = 0
    for name, fn in sorted(globals().items()):
        if not (name.startswith("test_") and callable(fn)):
            continue
        try:
            fn()
            print(f"PASS {name}")
            passed += 1
        except Exception:
            print(f"FAIL {name}")
            traceback.print_exc()
            failed += 1
    print(f"\n{passed} passed, {failed} failed")
    sys.exit(1 if failed else 0)
