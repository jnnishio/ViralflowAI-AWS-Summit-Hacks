"""Unit tests for pipeline/batch.py (batch-processing spec, Task 3).

Plain pytest-style functions. Also runnable directly (`python3 tests/test_batch.py`)
via the __main__ harness below, since pytest is a dev-only dependency.
"""

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from pipeline import batch


def _touch(dirpath, name):
    (dirpath / name).write_text("x")


def test_discovery_pairs_by_stem_and_excludes_unmatched(tmp_path):
    # Req 2.1, 2.3: pair video+log by leading stream-id token; exclude lone videos.
    _touch(tmp_path, "6910008_video.mp4")
    _touch(tmp_path, "6910008_log.csv")
    _touch(tmp_path, "3654414_video.mp4")
    _touch(tmp_path, "3654414_log.csv")
    _touch(tmp_path, "999_video.mp4")            # no matching log -> excluded
    _touch(tmp_path, "6910008_video.m4a")        # non-video ext -> ignored

    targets, excluded = batch.discover_targets(tmp_path)

    assert [t["streamId"] for t in targets] == ["3654414", "6910008"]
    assert excluded == ["999"]
    pair = next(t for t in targets if t["streamId"] == "6910008")
    assert pair["video"].endswith("6910008_video.mp4")
    assert pair["chatLog"].endswith("6910008_log.csv")


def test_empty_discovery_returns_no_targets(tmp_path):
    # Req 2.5: a directory with no pairs yields zero targets (main() then errors).
    _touch(tmp_path, "notes.txt")
    targets, excluded = batch.discover_targets(tmp_path)
    assert targets == []
    assert excluded == []


def test_resolve_concurrency_precedence_and_validation():
    # Req 3.3: CLI value wins over config default.
    assert batch.resolve_concurrency(4, config={"maxWorkers": 2}) == 4
    assert batch.resolve_concurrency(None, config={"maxWorkers": 3}) == 3
    # Req 3.4: < 1 is rejected.
    for bad in (0, -1):
        try:
            batch.resolve_concurrency(bad, config={"maxWorkers": 2})
            raise AssertionError(f"expected ValueError for {bad}")
        except ValueError:
            pass


def test_failure_isolation_and_manifest_completeness(tmp_path):
    # Req 5.1, 5.3: one target raising still yields a full manifest with the rest completed.
    targets = [
        {"streamId": "aaa", "video": "a.mp4", "chatLog": "a.csv"},
        {"streamId": "bbb", "video": "b.mp4", "chatLog": "b.csv"},
    ]

    def runner(argv):
        if argv[argv.index("--stream-id") + 1] == "bbb":
            raise RuntimeError("boom")

    results, wall = batch.run_batch(targets, 2, tmp_path, "bucket", runner=runner)
    by_sid = {r["streamId"]: r for r in results}

    assert len(results) == 2
    assert by_sid["aaa"]["status"] == "completed"
    assert by_sid["bbb"]["status"] == "failed"
    assert by_sid["bbb"]["reason"] == "boom"

    manifest = batch.build_manifest(results, wall, [])
    assert manifest["totals"]["targets"] == 2
    assert len(manifest["targets"]) == 2


def test_summary_math_and_zero_guard():
    # Req 6.3 / 11.4: clips/hr computed normally, zero-guard when wall-clock is 0.
    results = [
        {"streamId": "aaa", "status": "completed", "durationSeconds": 300.0, "clipCount": 3},
        {"streamId": "bbb", "status": "completed", "durationSeconds": 300.0, "clipCount": 5},
    ]
    manifest = batch.build_manifest(results, 3600.0, [])
    assert manifest["totals"]["clipsTotal"] == 8
    assert manifest["summary"]["clipsPerHour"] == 8.0  # 8 clips / 1h

    zero = batch.build_manifest(results, 0.0, [])
    assert zero["summary"]["clipsPerHour"] == 0  # no division by zero


def test_manifest_json_round_trip():
    results = [{"streamId": "aaa", "status": "completed", "durationSeconds": 1.0, "clipCount": 2}]
    manifest = batch.build_manifest(results, 10.0, ["zzz"])
    assert json.loads(json.dumps(manifest)) == manifest


# --- standalone harness (runs without pytest installed) ---------------------
if __name__ == "__main__":
    import tempfile
    import traceback

    passed = failed = 0
    for name, fn in sorted(globals().items()):
        if not (name.startswith("test_") and callable(fn)):
            continue
        needs_tmp = "tmp_path" in fn.__code__.co_varnames[: fn.__code__.co_argcount]
        try:
            if needs_tmp:
                with tempfile.TemporaryDirectory() as d:
                    fn(Path(d))
            else:
                fn()
            print(f"PASS {name}")
            passed += 1
        except Exception:
            print(f"FAIL {name}")
            traceback.print_exc()
            failed += 1
    print(f"\n{passed} passed, {failed} failed")
    sys.exit(1 if failed else 0)
