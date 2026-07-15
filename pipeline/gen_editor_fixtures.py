"""Generate edl-fixtures.ts from the real v2 pipeline EDL output.

Reads out/3654414-v2/edl/clip_NN.edl.json, extracts each clip's effects[],
and writes a TypeScript fixtures module. Preserves clip-id ordering.
"""
import json
from pathlib import Path

EDL_DIR = Path("out/3654414-v2/edl")
OUT = Path("apps/editor/apps/web/src/services/highlight-api/edl-fixtures.ts")

clip_effects = {}
for edl_path in sorted(EDL_DIR.glob("clip_*.edl.json")):
    clip_id = edl_path.stem.replace(".edl", "")
    edl = json.loads(edl_path.read_text(encoding="utf-8"))
    clip_effects[clip_id] = edl.get("effects", [])


def ts_value(v, indent=0):
    """Render a Python value as a TS literal."""
    pad = "\t" * indent
    if isinstance(v, dict):
        items = []
        for k, val in v.items():
            key = k if k.isidentifier() else json.dumps(k)
            items.append(f"{pad}\t{key}: {ts_value(val, indent + 1)}")
        return "{\n" + ",\n".join(items) + f"\n{pad}}}"
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, (int, float)):
        return repr(v)
    if isinstance(v, str):
        return json.dumps(v, ensure_ascii=False)
    if v is None:
        return "null"
    if isinstance(v, list):
        return "[" + ", ".join(ts_value(x, indent) for x in v) + "]"
    return json.dumps(v, ensure_ascii=False)


lines = []
lines.append("/**")
lines.append(" * Pre-computed EDL effects from the pipeline's autoedit module.")
lines.append(" *")
lines.append(" * AUTO-GENERATED from out/3654414-v2/edl/*.edl.json by _gen_fixtures.py.")
lines.append(" * These are the real AI-detected effects (reaction zooms, onomatopoeia")
lines.append(" * burst captions, SFX) for each clip. Clip-id ordering matches fixtures.ts")
lines.append(" * (clip_01..clip_05) per the ordering contract in pipeline/gallery.py.")
lines.append(" *")
lines.append(" * The \"auto\" chip action in ai-edit-mock.ts returns these so the editor")
lines.append(" * materializes them as editable timeline elements via ApplyEdlCommand.")
lines.append(" */")
lines.append("")
lines.append('import type { EdlEffect } from "./schema";')
lines.append("")
lines.append("export type EdlEffectsMap = Record<string, EdlEffect[]>;")
lines.append("")
lines.append("export const PIPELINE_EDL_EFFECTS: EdlEffectsMap = {")
for clip_id, effects in clip_effects.items():
    n_zoom = sum(1 for e in effects if e["effectId"] == "punch-in-zoom")
    n_cap = sum(1 for e in effects if e["effectId"] == "onomatopoeia-caption")
    n_sfx = sum(1 for e in effects if e["type"] == "sound")
    lines.append(f"\t// {clip_id}: {n_zoom} zoom, {n_cap} caption, {n_sfx} sfx")
    lines.append(f"\t{clip_id}: [")
    for e in effects:
        lines.append(f"\t\t{ts_value(e, 2)},")
    lines.append("\t],")
lines.append("};")
lines.append("")

OUT.write_text("\n".join(lines), encoding="utf-8")
total = sum(len(v) for v in clip_effects.values())
print(f"Wrote {OUT} with {len(clip_effects)} clips, {total} total effects")
for cid, effs in clip_effects.items():
    print(f"  {cid}: {len(effs)} effects")
