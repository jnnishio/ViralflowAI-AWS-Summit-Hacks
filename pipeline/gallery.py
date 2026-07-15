"""Static demo gallery: out/clips/manifest.json -> a single self-contained HTML
page with clip cards (video preview, virality score, mood, factors breakdown,
copy-paste captions). Quick validation surface until the real React UI lands.

Usage:
  python3 -m pipeline.gallery out/clips --out out/gallery.html
"""

import argparse
import html
import json
import sys
from pathlib import Path

# Base URL of the highlight-api mock editor (apps/editor/apps/web). The
# clip_NN ids below match the fixture clips seeded in
# apps/editor/apps/web/src/services/highlight-api/fixtures.ts, which mirror
# this manifest's cards 1:1 (order-matched) so the "Open in Editor" button
# opens a session whose hook/caption/hashtags match what the card shows.
EDITOR_BASE_URL = "http://localhost:3000"


def render(manifest, clips_dir, editor_video_id):
    cards = []
    for i, c in enumerate(manifest, 1):
        factors = c.get("factors") or {}
        bars = "".join(
            f"<div class='factor'><span>{html.escape(k)}</span>"
            f"<div class='bar'><div style='width:{min(max(v, 0) * 33, 100):.0f}%'></div></div>"
            f"<em>{v:.2f}</em></div>"
            for k, v in factors.items()
        )
        tags = " ".join(html.escape(t) for t in (c.get("hashtags") or []))
        rel = Path(c["file"]).name
        thumb = Path(c.get("thumb", "")).name
        clip_id = f"clip_{i:02d}"
        editor_url = f"{EDITOR_BASE_URL}/editor/video/{editor_video_id}/edit/{clip_id}"

        # Check for autoedit version: clip_NN_<mood>_autoedit.mp4
        autoedit_name = rel.replace(".mp4", "_autoedit.mp4")
        autoedit_path = clips_dir / autoedit_name
        has_autoedit = autoedit_path.exists()

        # Primary video: autoedit if available, otherwise plain
        primary_src = autoedit_name if has_autoedit else rel
        alt_src = rel if has_autoedit else None

        # Version toggle (only if autoedit exists)
        toggle_html = ""
        if has_autoedit:
            vid_id = f"vid_{clip_id}"
            toggle_html = (
                f'<div class="version-toggle">'
                f'<button class="vtog active" onclick="switchVid(\'{vid_id}\',\'{autoedit_name}\',this)">AI Edited</button>'
                f'<button class="vtog" onclick="switchVid(\'{vid_id}\',\'{rel}\',this)">Original</button>'
                f'</div>'
            )
            video_tag = f'<video id="{vid_id}" controls preload="none" poster="{thumb}" src="{primary_src}"></video>'
        else:
            video_tag = f'<video controls preload="none" poster="{thumb}" src="{primary_src}"></video>'

        ai_badge = '<span class="ai-badge">AI edited</span>' if has_autoedit else ''

        cards.append(f"""
<article class="card">
  {video_tag}
  {toggle_html}
  <div class="meta">
    <div class="score">🔥 {c.get('virality_score', '?')}<span class="mood">{html.escape(str(c.get('mood', '')))}</span>{ai_badge}</div>
    <h2>{html.escape(str(c.get('title_zh', '')))}</h2>
    <p class="en">{html.escape(str(c.get('title_en', '')))}</p>
    <p class="cap">{html.escape(str(c.get('caption_zh', '')))}</p>
    <p class="tags">{tags}</p>
    <a class="btn" href="{editor_url}">Open in Editor →</a>
    <details><summary>score details</summary>{bars}
      <p class="range">{c.get('start_s', 0):.0f}s – {c.get('end_s', 0):.0f}s · {html.escape(str(c.get('category', '')))}</p>
    </details>
  </div>
</article>""")

    return f"""<!doctype html><meta charset="utf-8">
<title>StreamSmith — highlight gallery</title>
<style>
 body{{font-family:system-ui;background:#0e0f13;color:#eee;margin:0;padding:24px}}
 h1{{font-weight:600}} .grid{{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:20px}}
 .card{{background:#181a21;border-radius:14px;overflow:hidden}}
 video{{width:100%;aspect-ratio:9/16;background:#000}}
 .meta{{padding:12px 14px}} h2{{font-size:15px;margin:6px 0 2px}}
 .en{{color:#9aa;font-size:12px;margin:0}} .cap{{font-size:13px;color:#ccd}}
 .tags{{color:#6cf;font-size:12px}} .score{{font-size:18px;font-weight:700}}
 .mood{{margin-left:8px;font-size:11px;background:#2a2f3a;padding:2px 8px;border-radius:99px;vertical-align:middle}}
 .ai-badge{{margin-left:8px;font-size:10px;background:#2d6b3f;color:#7fef9a;padding:2px 8px;border-radius:99px;vertical-align:middle}}
 .factor{{display:flex;align-items:center;gap:8px;font-size:11px;margin:3px 0}}
 .factor span{{width:44px;color:#9aa}} .factor em{{color:#9aa;font-style:normal}}
 .bar{{flex:1;height:6px;background:#2a2f3a;border-radius:3px}} .bar div{{height:100%;background:#6cf;border-radius:3px}}
 .range{{color:#889;font-size:11px}}
 details summary{{cursor:pointer;color:#9aa;font-size:12px;margin-top:6px}}
 .btn{{display:block;margin-top:10px;padding:8px 12px;background:#6cf;color:#0e0f13;
   text-align:center;text-decoration:none;font-size:13px;font-weight:600;border-radius:8px}}
 .btn:hover{{background:#8fd6ff}}
 .version-toggle{{display:flex;gap:0;padding:6px 10px;background:#11131a}}
 .vtog{{flex:1;padding:5px 0;border:none;background:#1e2130;color:#8899aa;font-size:11px;
   font-weight:500;cursor:pointer;border-radius:6px;transition:all .15s}}
 .vtog.active{{background:#6cf;color:#0e0f13;font-weight:700}}
 .vtog:first-child{{border-radius:6px 0 0 6px}} .vtog:last-child{{border-radius:0 6px 6px 0}}
</style>
<h1>StreamSmith — auto-generated highlights</h1>
<div class="grid">{''.join(cards)}</div>
<script>
function switchVid(vidId, src, btn) {{
  var v = document.getElementById(vidId);
  if (v.src.endsWith(src)) return;
  var wasPlaying = !v.paused;
  v.src = src; v.load();
  if (wasPlaying) v.play();
  btn.parentElement.querySelectorAll('.vtog').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
}}
</script>"""


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("clips_dir")
    ap.add_argument("--out", default=None)
    ap.add_argument("--stream-id", required=True,
                    help="drives the 'Open in Editor' link (video_{stream-id}) — "
                         "must match the fixtures.ts video id seeded for this run")
    args = ap.parse_args(argv)

    clips_dir = Path(args.clips_dir)
    manifest = json.loads((clips_dir / "manifest.json").read_text(encoding="utf-8"))
    out = Path(args.out) if args.out else clips_dir / "gallery.html"
    out.write_text(render(manifest, clips_dir, f"video_{args.stream_id}"), encoding="utf-8")
    print(f"gallery ({len(manifest)} clips) -> {out}")


if __name__ == "__main__":
    sys.exit(main())
