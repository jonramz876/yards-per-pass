"""Team radar fixture, step 1 (no database): the five columns the frozen Team
Stats fixture lacks, computed from the public nflverse play-by-play with
ingest's own aggregate_team_game_stats, restricted to the frozen fixture's
game ids. Shared columns are COPIED from the frozen fixture; this script only
reports whether the recomputed ones agree, it never overwrites them.

Never connects to a database: load_dotenv is a no-op and psycopg2.connect is
removed before anything can call it.

Run: py -3 make_radar_rows.py <worktree> <pbp parquet> <out json>
"""
import json
import math
import os
import sys

import dotenv

dotenv.load_dotenv = lambda *a, **k: False

WT, PBP, OUT = sys.argv[1], sys.argv[2], sys.argv[3]
sys.path.insert(0, os.path.join(WT, "scripts"))
import ingest  # noqa: E402
import pandas as pd  # noqa: E402

ingest.psycopg2.connect = None

FROZEN = os.path.join(WT, "__tests__", "stats", "fixtures", "team-game-stats-2026-w1-3.json")
frozen = json.load(open(FROZEN, encoding="utf-8"))
assert len(frozen) == 94
games = sorted({r["game_id"] for r in frozen})
keys = [(r["game_id"], r["team_id"]) for r in frozen]

pbp = pd.read_parquet(PBP)
pbp = pbp[pbp["game_id"].isin(games)]
print("pbp rows for the frozen games:", len(pbp), "games:", pbp["game_id"].nunique(), "of", len(games))
rows = ingest.aggregate_team_game_stats(pbp, 2026)
got = {(r["game_id"], r["team_id"]): r for r in rows.to_dict("records")}
assert set(got) == set(keys), (set(keys) - set(got), set(got) - set(keys))

SHARED = ["opponent_id", "season", "week", "pass_plays", "rush_plays", "pass_success_rate",
          "rush_success_rate", "explosive_pass", "explosive_rush", "turnovers"]
NEW = ["attempts", "sacks", "total_drives", "designed_runs", "stuffed_runs"]


def same(a, b):
    if a is None or b is None or (isinstance(b, float) and math.isnan(b)):
        return a is None and (b is None or (isinstance(b, float) and math.isnan(b)))
    if isinstance(a, str) or isinstance(b, str):
        return str(a) == str(b)
    return abs(float(a) - float(b)) <= 1e-9


diffs = []
for f in frozen:
    g = got[(f["game_id"], f["team_id"])]
    for c in SHARED:
        if not same(f[c], g[c]):
            diffs.append((f["game_id"], f["team_id"], c, f[c], g[c]))
print("shared-column differences (frozen vs recomputed):", len(diffs))
for d in diffs:
    print("  DIFF", d)

out = []
for f in frozen:
    g = got[(f["game_id"], f["team_id"])]
    row = {c: f[c] for c in ["game_id", "team_id"] + SHARED}
    for c in NEW:
        v = g[c]
        assert v is not None and float(v) == int(v), (f["game_id"], f["team_id"], c, v)
        row[c] = int(v)
    assert 0 <= row["stuffed_runs"] <= row["designed_runs"] <= row["rush_plays"], row
    out.append(row)

PIN = {("2026_01_BUF_HOU", "BUF"): (3, 19), ("2026_01_BUF_HOU", "HOU"): (8, 31),
       ("2026_01_NO_DET", "DET"): (4, 32), ("2026_01_NO_DET", "NO"): (4, 23),
       ("2026_01_TB_CIN", "CIN"): (4, 25), ("2026_01_TB_CIN", "TB"): (3, 15)}
by = {(r["game_id"], r["team_id"]): r for r in out}
for k, want in PIN.items():
    have = (by[k]["stuffed_runs"], by[k]["designed_runs"])
    print("  pin", k, have, "OK" if have == want else "DIFFERS " + str(want))
    assert have == want

if diffs:
    print("NOT WRITTEN: shared columns differ")
    sys.exit(1)
json.dump(out, open(OUT, "w", encoding="utf-8"), indent=0)
print("wrote", OUT, len(out), "rows;",
      "league stuff", sum(r["stuffed_runs"] for r in out), "/", sum(r["designed_runs"] for r in out),
      "sacks", sum(r["sacks"] for r in out), "attempts", sum(r["attempts"] for r in out),
      "drives", sum(r["total_drives"] for r in out), "turnovers", sum(r["turnovers"] for r in out))
