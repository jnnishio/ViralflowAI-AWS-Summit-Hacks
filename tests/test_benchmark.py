"""Unit tests for pipeline/benchmark.py (Fast-vs-Full performance harness).

Plain pytest-style functions, also runnable directly
(`python3 tests/test_benchmark.py`) via the __main__ harness, matching
tests/test_metrics.py — pytest is a dev-only dependency.
"""

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from pipeline import benchmark as b


def _cfg():
    return b.load_config()


def test_wall_clock_and_stage_durations():
    timings = {"stages": [
        {"name": "chat", "startS": 0.0, "endS": 2.0},
        {"name": "director", "startS": 2.0, "endS": 100.0},
        {"name": "render", "startS": 100.0, "endS": 450.0},
    ]}
    assert b.wall_clock_seconds(timings) == 450.0
    assert b.wall_clock_seconds(None) is None          # absent -> None (honest omission)
    assert b.wall_clock_seconds({"stages": []}) is None
    durs = b.stage_durations(timings)
    assert durs[0] == {"name": "chat", "seconds": 2.0}
    assert durs[1]["seconds"] == 98.0
    assert b.stage_durations(None) == []


def test_vod_duration_and_windows():
    cands = {"series": {"t_s": [0, 5, 10, 15]}, "candidates": [
        {"start_s": 10, "end_s": 40}, {"start_s": 100, "end_s": 145}]}
    assert b.vod_duration_s(cands) == 20.0             # last bin (15) + bin_seconds (5)
    assert b.vod_duration_s(None) == 0.0
    assert b.vod_duration_s({"series": {"t_s": []}}) == 0.0
    assert b.candidate_windows(cands) == [(10, 40), (100, 145)]
    assert b.candidate_windows(None) == []


def test_rekognition_workload_full_vs_fast():
    # full: whole-VOD segment + face (both API groups, full duration).
    full = b.rekognition_workload("full", duration_s=3600.0, windows=[], pad_s=10.0)
    assert full == {"segment": 60.0, "face": 60.0}

    # fast: face only on padded candidate windows.
    # two 30s windows + 2*10s pad each = (30+20)*2 = 100s = 1.6667 min.
    fast = b.rekognition_workload(
        "fast", duration_s=3600.0, windows=[(0, 30), (100, 130)], pad_s=10.0)
    assert set(fast) == {"face"}
    assert fast["face"] == round(100 / 60.0, 2)

    # off: no Rekognition at all.
    assert b.rekognition_workload("off", 3600.0, [], 10.0) == {}


def test_fast_workload_clamped_to_vod_duration():
    # padded windows summing beyond the VOD can't bill more than the VOD length.
    wl = b.rekognition_workload("fast", duration_s=60.0, windows=[(0, 55), (10, 55)], pad_s=10.0)
    assert wl["face"] == round(60.0 / 60.0, 2)  # clamped to 1.0 min


def test_rekognition_cost_only_bills_invoked_apis():
    rates = {"segment": 0.05, "face": 0.10}
    # full: 60 min segment + 60 min face = 3.0 + 6.0 = 9.0
    assert b.rekognition_cost({"segment": 60.0, "face": 60.0}, rates) == 9.0
    # fast: face only, 1.67 min * 0.10 = 0.167
    assert b.rekognition_cost({"face": 1.67}, rates) == round(1.67 * 0.10, 4)
    assert b.rekognition_cost({}, rates) == 0.0


def test_build_comparison_deltas_and_wallclock_note():
    cfg = _cfg()
    # build summaries by hand (avoids filesystem) to test delta math directly.
    full_sum = {
        "mode": "full", "vodDurationMinutes": 60.0, "modalitiesPresent": ["chat", "audio", "speech", "visual"],
        "candidateCount": 7, "clipCount": 5, "wallClockSeconds": 1740.0, "wallClockMinutes": 29.0,
        "stageSeconds": [{"name": "director", "seconds": 100.0}],
        "rekognitionWorkloadMinutes": {"segment": 60.0, "face": 60.0}, "rekognitionMinutesTotal": 120.0,
        "estimatedRekognitionCostUsd": 9.0,
    }
    fast_sum = {
        "mode": "fast", "vodDurationMinutes": 60.0, "modalitiesPresent": ["chat", "audio", "speech"],
        "candidateCount": 12, "clipCount": 5, "wallClockSeconds": 450.0, "wallClockMinutes": 7.5,
        "stageSeconds": [{"name": "director", "seconds": 100.0}],
        "rekognitionWorkloadMinutes": {"face": 15.0}, "rekognitionMinutesTotal": 15.0,
        "estimatedRekognitionCostUsd": 1.5,
    }
    doc = b.build_comparison([fast_sum, full_sum], cfg)
    d = doc["deltas"]
    assert d["wallClockSpeedup"] == round(1740.0 / 450.0, 2)      # ~3.87x
    assert d["wallClockSavedSeconds"] == 1290.0
    assert d["rekognitionMinutesRatio"] == round(120.0 / 15.0, 2)  # 8.0x
    assert d["rekognitionCostRatio"] == round(9.0 / 1.5, 2)        # 6.0x
    assert d["rekognitionCostSavedUsd"] == 7.5

    # markdown renders without error and includes the headline speedup.
    md = b.render_markdown(doc)
    assert "Fast vs Full" in md and "speedup" in md


def test_build_comparison_missing_wallclock_is_flagged_not_faked():
    cfg = _cfg()
    full_sum = {"mode": "full", "vodDurationMinutes": 60.0, "modalitiesPresent": [],
                "candidateCount": 7, "clipCount": None, "wallClockSeconds": None,
                "wallClockMinutes": None, "stageSeconds": [],
                "rekognitionWorkloadMinutes": {"segment": 60.0, "face": 60.0},
                "rekognitionMinutesTotal": 120.0, "estimatedRekognitionCostUsd": 9.0}
    fast_sum = {"mode": "fast", "vodDurationMinutes": 60.0, "modalitiesPresent": [],
                "candidateCount": 12, "clipCount": None, "wallClockSeconds": None,
                "wallClockMinutes": None, "stageSeconds": [],
                "rekognitionWorkloadMinutes": {"face": 15.0},
                "rekognitionMinutesTotal": 15.0, "estimatedRekognitionCostUsd": 1.5}
    doc = b.build_comparison([fast_sum, full_sum], cfg)
    # cost/minutes deltas still computed; wall-clock explicitly flagged, never fabricated.
    assert doc["deltas"]["rekognitionCostRatio"] == 6.0
    assert "wallClockSpeedup" not in doc["deltas"]
    assert "wallClockNote" in doc["deltas"]


def test_run_mode_injects_visual_mode_flag_and_times():
    captured = {}

    def fake_runner(argv):
        captured["argv"] = argv

    wall = b.run_mode("full", ["--video", "v", "--stream-id", "s"], "out/x", runner=fake_runner)
    assert "--visual-mode" in captured["argv"]
    i = captured["argv"].index("--visual-mode")
    assert captured["argv"][i + 1] == "full"
    assert "--outdir" in captured["argv"]
    assert isinstance(wall, float) and wall >= 0.0


def test_parse_from_existing():
    assert b._parse_from_existing(["fast=out/a", "full=out/b"]) == [("fast", "out/a"), ("full", "out/b")]
    for bad in (["nope"], ["weird=out/a"]):
        try:
            b._parse_from_existing(bad)
            assert False, "expected ValueError"
        except ValueError:
            pass


def test_summarize_run_from_synthetic_dir(tmp_path=None):
    import tempfile
    d = Path(tempfile.mkdtemp())
    (d / "candidates.json").write_text(json.dumps({
        "modalities_present": ["audio", "chat", "speech"],
        "series": {"t_s": [0, 5, 10]},
        "candidates": [{"start_s": 0, "end_s": 30}],
    }))
    (d / "clips").mkdir()
    (d / "clips" / "clips.json").write_text(json.dumps([{"clipId": "c1"}, {"clipId": "c2"}]))
    s = b.summarize_run("fast", d, _cfg())
    assert s["mode"] == "fast"
    assert s["modalitiesPresent"] == ["audio", "chat", "speech"]
    assert s["candidateCount"] == 1
    assert s["clipCount"] == 2
    assert s["vodDurationSeconds"] == 15.0
    assert s["wallClockSeconds"] is None            # no timings.json -> honest None
    assert set(s["rekognitionWorkloadMinutes"]) == {"face"}


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
