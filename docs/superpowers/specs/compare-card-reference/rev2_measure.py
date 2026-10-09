# NOTE: needs no scratch inputs, but needs the fontTools package and the repo's node_modules
# (it measures text in the Noto Sans file that ships inside next/og). Kept as a record of the widths in the spec.
"""Revision 2: widths of the reworded sentences in the image's fonts."""
import os, sys
from fontTools.ttLib import TTFont
sys.stdout.reconfigure(encoding="ascii", errors="replace")
REPO = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "..", ".."))
f = TTFont(os.path.join(REPO, "node_modules", "next", "dist", "compiled", "@vercel", "og", "noto-sans-v27-latin-regular.ttf"))
cmap, hm, upm = f.getBestCmap(), f["hmtx"].metrics, f["head"].unitsPerEm
w = lambda s, px: sum(hm[cmap.get(ord(c), ".notdef")][0] for c in s) * px / upm
def show(tag, s, px, limit):
    x = w(s, px); print(f"{'OVER' if x > limit else 'ok  '} {x:7.1f} / {limit}  [{tag} @{px}] {s}")
print("-- C6, one line across the card, 36..1164 = 1128")
for s in [
    "Small sample: T.Huntley has 9 pass attempts in 1 game (under 14 a game). OVR hidden.",
    "Small sample: D.Thompson-Robinson has 113 pass attempts in 12 games; M.Valdes-Scantling has 107 pass attempts in 11 games (under 14 a game). OVR hidden.",
    "Small sample: Dorian Thompson-Robinson has 113 pass attempts in 12 games; Marquez Valdes-Scantling has 107 pass attempts in 11 games (under 14 a game). OVR hidden.",
    "Small sample: Equanimeous St. Brown has 1 target in 1 game; Marquez Valdes-Scantling has 21 targets in 11 games (under 2 a game). OVR hidden.",
]:
    show("C6", s, 13, 1128); show("C6", s, 14, 1128)
print("-- sub-band left text, room 952 (site name on the right)")
for s in [
    "2026 season \u00b7 Through Week 22 \u00b7 Radar: percentile among the 142 qualified quarterbacks (14+ attempts a game)",
    "2026 season \u00b7 Through Week 22 \u00b7 Radar: percentile among the 154 qualified running backs (6+ carries a game)",
    "2026 season \u00b7 Through Week 22 \u00b7 Radar: percentile among the 129 qualified WRs (2+ targets a game)",
    "2026 season \u00b7 Through Week 22 \u00b7 Radar: each player against qualified players at his position (2+ targets a game): 129 WRs, 156 TEs",
]:
    show("C3+C4", s, 15, 952)
print("-- table-only note in the radar pane, 2 lines of 440 at 22px")
for s in ["Not enough qualified quarterbacks yet to draw the radar (14+ attempts a game)."]:
    show("C4z", s, 22, 880)
print("-- header short names at 16px, each side capped at 240")
for s in ["M.Valdes-Scantling", "D.Thompson-Robinson", "J.Croskey-Merritt"]:
    show("hdr", s, 16, 240)
