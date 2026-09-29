# Reference copy (spec 2026-09-28 M7): wrote __tests__/stats/fixtures/team-*-2026-w1-3*.json; input/output paths point at the session scratchpad (scratchpad/team-stats/fixture/), not the repo.
"""Build the committed golden fixture for lib/stats/team-stats.ts from the real
2026 team_game_stats rows (weeks 1-3) that aggregate.py read, trimmed to the
columns the page selects, and the expected values = aggregate.py's own output.

Read-only on the repo. Run: py -3 make_fixture.py
"""
import json
import os
import runpy

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, "..")

COLUMNS = [
    "game_id", "team_id", "opponent_id", "season", "week",
    "plays", "pass_plays", "rush_plays", "early_plays", "late_plays",
    "epa_per_play", "success_rate", "first_down_rate",
    "pass_epa_per_play", "pass_success_rate", "pass_first_down_rate",
    "rush_epa_per_play", "rush_success_rate", "rush_first_down_rate",
    "early_epa_per_play", "early_success_rate", "late_epa_per_play", "late_success_rate",
    "explosive_plays", "explosive_pass", "explosive_rush",
    "turnovers", "epa_lost_turnovers", "epa_lost_sacks", "epa_lost_penalties",
]

data = json.load(open(os.path.join(SRC, "tgs_2026.json"), encoding="utf-8"))
rows = sorted(data["tgs"], key=lambda r: (r["game_id"], r["team_id"]))
trimmed = [{c: r[c] for c in COLUMNS} for r in rows]
assert len(trimmed) == 94 and max(r["week"] for r in trimmed) == 3

# Re-run aggregate.py against the TRIMMED rows to prove nothing it reads was cut.
tmp = os.path.join(HERE, "_trimmed_input.json")
json.dump({"tgs": trimmed, "teams": data["teams"], "freshness": data["freshness"]}, open(tmp, "w", encoding="utf-8"))

src = open(os.path.join(SRC, "aggregate.py"), encoding="utf-8").read()
src = src.replace('os.path.join(HERE, "tgs_2026.json")', repr(tmp))
src = src.replace('os.path.join(HERE, "team_stats_2026.json")', repr(os.path.join(HERE, "_trimmed_output.json")))
exec(compile(src, "aggregate.py", "exec"), {"__file__": os.path.join(SRC, "aggregate.py"), "__name__": "__main__"})

a = json.load(open(os.path.join(SRC, "team_stats_2026.json"), encoding="utf-8"))
b = json.load(open(os.path.join(HERE, "_trimmed_output.json"), encoding="utf-8"))
# Same values up to float summation order (rows are re-sorted by game_id, team_id,
# the order the page reads them in): the largest difference is ~2e-18.
def close(x, y):
    if x is None or y is None:
        return x is y
    return abs(x - y) <= 1e-12
for k in a["league"]:
    assert close(a["league"][k], b["league"][k]), k
ta = {t["team"]: t for t in a["teams"]}
for t in b["teams"]:
    for side in ("off", "def"):
        for k, v in t[side].items():
            assert close(ta[t["team"]][side][k], v), (t["team"], side, k)
    for k in ("toxic", "to_margin", "ex_margin"):
        assert ta[t["team"]][k] == t[k]

expected = {
    "source": "aggregate.py over 2026 team_game_stats weeks 1-3 (94 rows, read 2026-09-28)",
    "teams": {t["team"]: {"off": t["off"], "def": t["def"], "toxic": t["toxic"],
                          "to_margin": t["to_margin"], "ex_margin": t["ex_margin"]} for t in b["teams"]},
    "league": b["league"],
}
json.dump(trimmed, open(os.path.join(HERE, "team-game-stats-2026-w1-3.json"), "w", encoding="utf-8"), indent=0)
json.dump(expected, open(os.path.join(HERE, "team-stats-2026-w1-3.expected.json"), "w", encoding="utf-8"), indent=1)
os.remove(tmp)
os.remove(os.path.join(HERE, "_trimmed_output.json"))
print("fixture rows", len(trimmed), "teams", len(expected["teams"]))
