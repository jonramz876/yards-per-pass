"""Team radar fixture, step 2: the expected values for lib/stats/team-radar.ts,
from an independent Python reference (team radar spec 2026-10-06, sections 3-4).
Never from the TypeScript: a failing golden means the two disagree.

  explosive pass = sum(explosive_pass) / sum(pass_plays)
  explosive run  = sum(explosive_rush) / sum(rush_plays)
  pass success   = sum(pass_success_rate * pass_plays) / sum(pass_plays)
  run success    = sum(rush_success_rate * rush_plays) / sum(rush_plays)
  sack rate      = sum(sacks) / sum(attempts + sacks)
  turnover rate  = sum(turnovers) / sum(total_drives)
  stuff rate     = sum(stuffed_runs) / sum(designed_runs)   (None if any row is NULL)
  offense = the team's own rows; defense = rows where opponent_id is the team.
  rank = competition rank among teams with a row of their own and a value
  (1 = best; two rates within 1e-9 are a tie and share the better place); offense: higher is better for the first, second, sixth and
  seventh spokes, lower for sack / turnover / stuff; defense: the reverse.

Run: py -3 make_radar_expected.py <rows json> <out json> [mockup radar_2026.json]
"""
import json
import sys

ROWS, OUT = sys.argv[1], sys.argv[2]
MOCK = sys.argv[3] if len(sys.argv) > 3 else None

# key, better-when-higher on OFFENSE (defense is the reverse); spoke order
AXES = [("expl_pass", True), ("pass_sr", True), ("sack", False), ("to", False),
        ("stuff", False), ("rush_sr", True), ("expl_rush", True)]


def total(rows, col):
    return sum(r[col] or 0 for r in rows)


def wavg(rows, rate, den):
    top = bot = 0.0
    for r in rows:
        v, d = r[rate], r[den]
        if v is None or not d:
            continue
        top += v * d
        bot += d
    return top / bot if bot else None


def ratio(n, d):
    return n / d if d else None


def side(rows):
    sacks = total(rows, "sacks")
    known = all(r["designed_runs"] is not None and r["stuffed_runs"] is not None for r in rows)
    return {
        "gp": len(rows),
        "expl_pass": ratio(total(rows, "explosive_pass"), total(rows, "pass_plays")),
        "pass_sr": wavg(rows, "pass_success_rate", "pass_plays"),
        "sack": ratio(sacks, total(rows, "attempts") + sacks),
        "to": ratio(total(rows, "turnovers"), total(rows, "total_drives")),
        "stuff": ratio(total(rows, "stuffed_runs"), total(rows, "designed_runs")) if known else None,
        "rush_sr": wavg(rows, "rush_success_rate", "rush_plays"),
        "expl_rush": ratio(total(rows, "explosive_rush"), total(rows, "rush_plays")),
    }


rows = json.load(open(ROWS, encoding="utf-8"))
ids = sorted({r["team_id"] for r in rows} | {r["opponent_id"] for r in rows})
played = {r["team_id"] for r in rows}
TIE = 1e-9
sides = {t: {"off": side([r for r in rows if r["team_id"] == t]),
             "def": side([r for r in rows if r["opponent_id"] == t])} for t in ids}

teams = {}
for t in ids:
    entry = {}
    for s in ("off", "def"):
        me = sides[t][s]
        rank, pool, tied = {}, {}, {}
        for key, off_high in AXES:
            higher = off_high if s == "off" else not off_high
            # The pool is teams with a row of their own (chaos R1); two rates within
            # TIE (float noise from re-multiplying stored game rates) are the same rate (chaos W1).
            vals = [sides[x][s][key] for x in ids
                    if x in played and sides[x][s]["gp"] > 0 and sides[x][s][key] is not None]
            mine = me[key]
            pool[key] = len(vals)
            if mine is None or me["gp"] == 0 or t not in played:
                rank[key], tied[key] = None, False
            else:
                same = [v for v in vals if abs(v - mine) < TIE]
                rank[key] = 1 + sum(1 for v in vals if abs(v - mine) >= TIE and (v > mine if higher else v < mine))
                tied[key] = len(same) > 1
        entry[s] = {**me, "rank": rank, "pool": pool, "tied": tied}
    teams[t] = entry

expected = {
    "source": "make_radar_expected.py over team-radar-2026-w1-3.json: the frozen Team Stats fixture's 94 "
              "rows (2026 weeks 1-3, read 2026-09-28) with attempts, sacks, total_drives, designed_runs and "
              "stuffed_runs computed on 2026-10-06 from the public nflverse play-by-play by ingest's own "
              "aggregate_team_game_stats over the same 47 game ids (no database); the 10 shared columns "
              "recomputed identical to the frozen ones (0 differences)",
    "teamsPlayed": len({r["team_id"] for r in rows}),
    "throughWeek": max(r["week"] for r in rows),
    "teams": teams,
    "league": {k: v for k, v in side(rows).items()},
}

# Cross-check against the numbers behind the owner-approved mockup (six spokes; stuff was a placeholder there).
if MOCK:
    mock = json.load(open(MOCK, encoding="utf-8"))
    n = 0
    for t in mock["teams"]:
        for s in ("off", "def"):
            for key, _ in AXES:
                if key == "stuff":
                    continue
                a, b = t[s][key], teams[t["team"]][s][key]
                assert abs(a - b) <= 1e-12, (t["team"], s, key, a, b)
                assert t[s]["rank"][key] == teams[t["team"]][s]["rank"][key], (t["team"], s, key)
                assert t[s]["pool"][key] == teams[t["team"]][s]["pool"][key]
                n += 1
    for key, _ in AXES:
        if key != "stuff":
            assert abs(mock["league"][key] - expected["league"][key]) <= 1e-12, key
    print("mockup cross-check: values and ranks identical on", n, "team-side-spokes")

json.dump(expected, open(OUT, "w", encoding="utf-8"), indent=1)
buf = teams["BUF"]
print("teams", len(teams), "teamsPlayed", expected["teamsPlayed"], "through week", expected["throughWeek"])
print("league", {k: (round(v, 4) if isinstance(v, float) else v) for k, v in expected["league"].items()})
for s in ("off", "def"):
    print("BUF", s, {k: (round(buf[s][k], 4), buf[s]["rank"][k], "T" if buf[s]["tied"][k] else "") for k, _ in AXES})
ties = [(t, s, k, teams[t][s]["rank"][k]) for t in ids for s in ("off", "def") for k, _ in AXES if teams[t][s]["tied"][k]]
print("tied cells", len(ties), ties[:12])
