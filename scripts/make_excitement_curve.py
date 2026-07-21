#!/usr/bin/env python3
"""Render the excitement curve + detected highlight windows from out/<streamId>/."""
import json
import sys
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.patches import Patch
from matplotlib.lines import Line2D

REPO = Path(__file__).resolve().parents[1]
STREAM = sys.argv[1] if len(sys.argv) > 1 else "3654414"
OUT = REPO / "docs/media/excitement-curve.png"

SURFACE = "#fcfcfb"
INK = "#0b0b0b"
INK_2 = "#52514e"
GRID = "#e5e4e7"
CURVE = "#2a78d6"   # categorical slot 1
WINDOW = "#eb6834"  # categorical slot 2

cand = json.loads((REPO / "out" / STREAM / "candidates.json").read_text())
hl = json.loads((REPO / "out" / STREAM / "highlights.json").read_text())["highlights"]

t = [x / 60.0 for x in cand["series"]["t_s"]]
y = cand["series"]["excitement"]
kept = sorted((h for h in hl if h.get("keep", True)), key=lambda h: h["start_s"])

fig, ax = plt.subplots(figsize=(11, 4.2), dpi=200)
fig.patch.set_facecolor(SURFACE)
ax.set_facecolor(SURFACE)

for h in kept:
    ax.axvspan(h["start_s"] / 60, h["end_s"] / 60, color=WINDOW, alpha=0.16, lw=0, zorder=1)

ax.plot(t, y, color=CURVE, lw=1.6, zorder=3, solid_capstyle="round")
ax.axhline(0, color=GRID, lw=1, zorder=2)

# peak markers + rank labels on the top few windows
top = sorted(kept, key=lambda h: -h.get("virality_score", 0))[:3]
labelled = []  # (x, dy) already placed, to stagger collisions
for h in kept:
    px = h["peak_s"] / 60
    py = max((yy for tt, yy in zip(t, y) if abs(tt - px) < 0.09), default=0)
    ax.plot([px], [py], "o", ms=5, mfc=WINDOW, mec=SURFACE, mew=1.4, zorder=4)
    if h in top:
        dy = 11
        while any(abs(px - lx) < 6 and abs(dy - ldy) < 12 for lx, ldy in labelled):
            dy += 13
        labelled.append((px, dy))
        ax.annotate(
            f"{h['mood']} · {h['virality_score']}",
            (px, py), textcoords="offset points", xytext=(0, dy),
            ha="center", fontsize=8, color=INK_2, zorder=5,
        )

ax.set_xlim(0, max(t))
ax.set_xlabel("stream time (minutes)", fontsize=9, color=INK_2)
ax.set_ylabel("fused excitement (z)", fontsize=9, color=INK_2)
ax.set_title(
    f"Excitement curve — stream {STREAM} · {len(kept)} highlight windows kept",
    fontsize=12, color=INK, loc="left", pad=14, fontweight="semibold",
)
ax.text(
    0, 1.015,
    f"chat + audio + speech, z-normalized on a {cand['bin_seconds']}s grid · vertical: {cand['vertical']}",
    transform=ax.transAxes, fontsize=8.5, color=INK_2, va="bottom",
)

ax.grid(axis="y", color=GRID, lw=0.8)
ax.set_axisbelow(True)
for side in ("top", "right", "left"):
    ax.spines[side].set_visible(False)
ax.spines["bottom"].set_color(GRID)
ax.tick_params(colors=INK_2, labelsize=8.5, length=0)

ax.legend(
    handles=[
        Line2D([], [], color=CURVE, lw=1.6, label="excitement curve"),
        Patch(facecolor=WINDOW, alpha=0.16, label="detected highlight window"),
    ],
    loc="lower right", bbox_to_anchor=(1, 1.005), frameon=False,
    fontsize=8.5, labelcolor=INK_2, ncol=2, handlelength=1.6, columnspacing=1.4,
)

OUT.parent.mkdir(parents=True, exist_ok=True)
fig.tight_layout()
fig.savefig(OUT, facecolor=SURFACE, bbox_inches="tight")
print(f"wrote {OUT}")
