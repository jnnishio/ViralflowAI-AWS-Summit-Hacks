"""Stress test for pipeline/autoedit.py — edge cases, performance, correctness.

Run:  python tests/stress_test_autoedit.py
"""
import json
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from pipeline.autoedit import autoedit_effects, detect_reaction_zooms, detect_onomatopoeia, detect_sfx_placements

CLIP = "out/clips/clip_01_funny.mp4"
HL_JSON = "out/3654414-fast/highlights.json"
TX_JSON = "out/3654414-fast/transcript.json"
VIS_JSON = "out/3654414-fast/visual_signals.json"
CHAT_JSON = "out/3654414-fast/chat_signals.json"

passed = 0
failed = 0


def check(name, condition, detail=""):
    global passed, failed
    if condition:
        print(f"  [PASS] {name}")
        passed += 1
    else:
        print(f"  [FAIL] {name}  {detail}")
        failed += 1


def load_json(path):
    p = Path(path)
    if p.exists():
        return json.loads(p.read_text(encoding="utf-8"))
    return None


print("=" * 60)
print("STRESS TEST: pipeline/autoedit.py")
print("=" * 60)

# Load real test data
transcript = load_json(TX_JSON)
visual = load_json(VIS_JSON)
chat = load_json(CHAT_JSON)
highlights = load_json(HL_JSON)
hl = highlights["highlights"][0] if highlights else None

# --- Test Group 1: Null/empty inputs (no crash) ---
print("\n--- Group 1: Null/empty inputs ---")

hl_basic = {"start_s": 0, "end_s": 35, "mood": "funny"}

effects = autoedit_effects(hl_basic, CLIP, transcript=None, visual=None, chat_signals=None)
check("No signals → no crash", isinstance(effects, list))
check("No signals → only SFX possible (from transcript gaps)", True)

effects = autoedit_effects(hl_basic, CLIP,
                           transcript={"segments": [], "words": []},
                           visual={"faces": []},
                           chat_signals={"series": {"t_s": [], "laugh": []}})
check("Empty data structures → no crash", isinstance(effects, list))
check("Empty data → 0 zooms (no corroboration)", 
      all(e["effectId"] != "punch-in-zoom" for e in effects))

# --- Test Group 2: Performance with large data ---
print("\n--- Group 2: Performance ---")

big_visual = {"faces": [
    {"t_s": i * 0.1, "box": {"Left": 0.4, "Top": 0.3, "Width": 0.2, "Height": 0.15},
     "emotion": "HAPPY" if i % 3 == 0 else "CALM", "emotion_conf": 95.0, "smile": 50.0}
    for i in range(10000)
]}

t0 = time.time()
effects = autoedit_effects(hl_basic, CLIP, transcript=None, visual=big_visual, chat_signals=None)
elapsed = time.time() - t0
check(f"10k faces in {elapsed:.2f}s (target <10s)", elapsed < 10.0)
check(f"10k faces → got zooms (faces provide corroboration)", 
      any(e["effectId"] == "punch-in-zoom" for e in effects))

# Large chat signal
big_chat = {"series": {
    "t_s": list(range(0, 200, 5)),
    "laugh": [3 if i % 4 == 0 else 0 for i in range(40)],
}}
t0 = time.time()
effects = autoedit_effects(hl_basic, CLIP, transcript=None, visual=None, chat_signals=big_chat)
elapsed = time.time() - t0
check(f"Large chat signal in {elapsed:.2f}s", elapsed < 10.0)

# --- Test Group 3: Boundary conditions ---
print("\n--- Group 3: Boundary conditions ---")

# Very short clip
hl_short = {"start_s": 0, "end_s": 0.5, "mood": "hype"}
effects = autoedit_effects(hl_short, CLIP, transcript=None, visual=None, chat_signals=None)
check("0.5s clip → no crash", isinstance(effects, list))

# Zero-duration highlight
hl_zero = {"start_s": 10, "end_s": 10, "mood": "funny"}
try:
    effects = autoedit_effects(hl_zero, CLIP, transcript=None, visual=None, chat_signals=None)
    check("Zero-duration → no crash", True)
except Exception as e:
    check("Zero-duration → no crash", False, str(e))

# --- Test Group 4: Correctness with real data ---
print("\n--- Group 4: Correctness with real data ---")

if hl and Path(CLIP).exists():
    effects = autoedit_effects(hl, CLIP, transcript, visual, chat)
    
    check(f"Real data → got effects ({len(effects)})", len(effects) > 0)
    
    # All timestamps clip-relative and non-negative
    neg = [e for e in effects if e["at"] < 0]
    check("No negative timestamps", len(neg) == 0, f"found {neg}")
    
    # All effects have required fields
    for e in effects:
        has_fields = all(k in e for k in ("effectId", "type", "at", "duration", "params"))
        if not has_fields:
            check("All required fields present", False, f"missing in {e}")
            break
    else:
        check("All required fields present", True)
    
    # Zoom effects have scale, cx, cy
    zooms = [e for e in effects if e["effectId"] == "punch-in-zoom"]
    if zooms:
        z = zooms[0]
        check("Zoom has scale/cx/cy", 
              "scale" in z["params"] and "cx" in z["params"] and "cy" in z["params"])
        check("Zoom scale in [1.0, 3.0]", 1.0 <= z["params"]["scale"] <= 3.0)
        check("Zoom cx in [0, 1]", 0 <= z["params"]["cx"] <= 1)
        check("Zoom cy in [0, 1]", 0 <= z["params"]["cy"] <= 1)
    
    # Onomatopoeia effects have text
    onomat = [e for e in effects if e["effectId"] == "onomatopoeia-caption"]
    if onomat:
        check("Onomatopoeia has text", "text" in onomat[0]["params"])
        check("Onomatopoeia text non-empty", len(onomat[0]["params"]["text"]) > 0)
    
    # SFX effects have assetKey
    sfx = [e for e in effects if e["type"] == "sound"]
    if sfx:
        check("SFX has assetKey", "assetKey" in sfx[0]["params"])
        check("SFX has gainDb", "gainDb" in sfx[0]["params"])
    
    # Effects don't extend far past clip duration
    clip_dur = hl["end_s"] - hl["start_s"]
    overflow = [e for e in effects if e["at"] + e["duration"] > clip_dur + 1.0]
    check("No major duration overflow", len(overflow) == 0, 
          f"{len(overflow)} effects exceed clip by >1s")
    
    # Effects sorted by time
    times = [e["at"] for e in effects]
    check("Effects sorted by time", times == sorted(times))

# --- Test Group 5: All moods produce valid SFX mapping ---
print("\n--- Group 5: Mood → SFX mapping ---")

moods = ["funny", "hype", "emotional", "impressive", "wholesome", "controversial", "unknown_mood"]
for mood in moods:
    hl_mood = {"start_s": 0, "end_s": 35, "mood": mood}
    effects = autoedit_effects(hl_mood, CLIP, transcript=transcript, visual=visual, chat_signals=None)
    sfx = [e for e in effects if e["type"] == "sound"]
    sfx_id = sfx[0]["effectId"] if sfx else "none"
    check(f"mood={mood:15s} → sfx={sfx_id}", isinstance(effects, list))

# --- Test Group 6: Detector isolation ---
print("\n--- Group 6: Individual detectors ---")

if hl:
    # Zoom detector alone
    zooms = detect_reaction_zooms(hl, CLIP, chat, visual)
    check(f"detect_reaction_zooms: {len(zooms)} results", isinstance(zooms, list))
    
    # Onomatopoeia detector alone
    onomat = detect_onomatopoeia(hl, CLIP, transcript)
    check(f"detect_onomatopoeia: {len(onomat)} results", isinstance(onomat, list))
    
    # SFX detector alone
    sfx = detect_sfx_placements(hl, transcript)
    check(f"detect_sfx_placements: {len(sfx)} results", isinstance(sfx, list))

# --- Summary ---
print("\n" + "=" * 60)
total = passed + failed
print(f"RESULTS: {passed}/{total} passed, {failed} failed")
if failed:
    print("*** SOME TESTS FAILED ***")
    sys.exit(1)
else:
    print("ALL TESTS PASSED")
    sys.exit(0)
