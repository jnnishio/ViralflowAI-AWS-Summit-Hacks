"""Cross-clip compilation suggester.

After the Director has picked the standalone highlights, this makes ONE extra
Bedrock (Claude) text call over ALL kept clips at once and proposes themed
"compilation reels" — a recurring bit, a person, a topic, a running gag — so
the UI can offer ready-made compilations (e.g. "Zongzi taste-test chaos",
"John's best fails") instead of only standalone clips.

It writes out/<stream>/clips/compilations.json as a SIBLING of manifest.json —
the manifest array shape is left untouched so every existing consumer keeps
working. A clip may belong to more than one compilation.

Usage:
  python3 -m pipeline.compilations out/3654414-fast/clips/manifest.json \
      --out out/3654414-fast/clips/compilations.json
"""

import argparse
import json
import sys
from pathlib import Path

import boto3

REGION = "us-east-1"
MODEL_ID = "us.anthropic.claude-sonnet-4-6"

SYSTEM = """\
You are a short-form video producer, fluent in Traditional Chinese and English,
assembling COMPILATION reels from a set of already-selected highlight clips
taken from ONE livestream. Group clips that share a genuine theme — a recurring
bit, a specific person, a topic, or a running gag — into named compilations a
viewer would binge back-to-back.

Reply with ONLY a JSON object (no markdown fence, no commentary):
{
 "compilations": [
   {
     "title_zh": "...",          // Traditional Chinese (繁體中文, NOT Simplified); catchy + specific; name the person/gag when clips share one
     "title_en": "...",
     "reason": "...",            // ONE sentence, English, why these clips belong together
     "clip_numbers": [1, 3, 4]   // 1-based numbers from the list below; at least 2 per compilation
   }
 ]
}
Rules:
- Only create a compilation when at least 2 clips genuinely share a theme.
- Prefer specific themes ("Zongzi taste-test chaos") over generic ones
  ("Funny moments"). Name a recurring person or gag when you can.
- A clip MAY appear in more than one compilation. It is fine to leave some
  clips ungrouped. Propose 2-5 compilations total (fewer for a small set).
- Titles must be punchy and specific; keep "reason" to a single sentence.
- "title_zh" MUST be Traditional Chinese (繁體中文), never Simplified."""


def _clip_lines(clips):
    lines = []
    for i, c in enumerate(clips, 1):
        title = c.get("title_en") or c.get("title_zh") or ""
        caption = (c.get("caption_en") or c.get("caption_zh") or "")[:180]
        mood = c.get("mood", "")
        category = c.get("category", "")
        lines.append(f"{i}. [{mood}/{category}] {title} — {caption}")
    return "\n".join(lines)


def suggest(clips, model_id=MODEL_ID, region=REGION):
    """Return a list of compilation dicts (frontend wire shape) for the clips.

    Each: {id, title_zh, title_en, reason, clipIds:["clip_01",...]}.
    Returns [] for fewer than 2 clips.
    """
    if len(clips) < 2:
        return []

    brt = boto3.client("bedrock-runtime", region_name=region)
    user = (
        "Here are the highlight clips (numbered):\n\n"
        + _clip_lines(clips)
        + "\n\nPropose the compilations now."
    )
    resp = brt.converse(
        modelId=model_id,
        system=[{"text": SYSTEM}],
        messages=[{"role": "user", "content": [{"text": user}]}],
        inferenceConfig={"maxTokens": 900, "temperature": 0.5},
    )
    raw = resp["output"]["message"]["content"][0]["text"]
    data = json.loads(raw[raw.index("{") : raw.rindex("}") + 1])

    out = []
    for comp in data.get("compilations", []):
        nums = [
            n for n in comp.get("clip_numbers", [])
            if isinstance(n, int) and 1 <= n <= len(clips)
        ]
        nums = sorted(set(nums))
        if len(nums) < 2:
            continue  # a compilation needs at least two clips
        out.append({
            "id": f"comp_{len(out) + 1:02d}",
            "title_zh": comp.get("title_zh", ""),
            "title_en": comp.get("title_en", ""),
            "reason": comp.get("reason", ""),
            "clipIds": [f"clip_{n:02d}" for n in nums],
        })
    return out


def emit(manifest_path, out_path, model_id=MODEL_ID):
    """Read a clips manifest, suggest compilations, write compilations.json."""
    manifest = json.loads(Path(manifest_path).read_text(encoding="utf-8"))
    clips = manifest if isinstance(manifest, list) else manifest.get("clips", [])
    comps = suggest(clips, model_id=model_id)
    out_path = Path(out_path)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(
        json.dumps({"compilations": comps}, ensure_ascii=False, indent=1),
        encoding="utf-8",
    )
    return comps


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("manifest", help="path to clips/manifest.json")
    ap.add_argument("--out", required=True, help="path to write compilations.json")
    ap.add_argument("--model", default=MODEL_ID)
    args = ap.parse_args(argv)

    comps = emit(args.manifest, args.out, model_id=args.model)
    for c in comps:
        print(f"  {c['id']}: {c['title_en']} ({len(c['clipIds'])} clips)")
    print(f"wrote {len(comps)} compilations -> {args.out}")


if __name__ == "__main__":
    sys.exit(main())
