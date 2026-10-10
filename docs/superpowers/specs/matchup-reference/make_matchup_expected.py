"""Team matchup golden file: the expected values for lib/stats/matchup.ts, from an
independent Python reference (team matchup spec 2026-10-10, sections 3 and 11).
Never from the TypeScript: a failing golden means the two disagree. Never
re-capture the expected file to make a test pass.

No database and no network. It reads the two FROZEN fixtures

  __tests__/stats/fixtures/team-game-stats-2026-w1-3.json   (30 Team Stats columns)
  __tests__/stats/fixtures/team-radar-2026-w1-3.json        (17 radar columns)

joins them by (game_id, team_id) into the 35-column rows the matchup read
returns, and writes

  __tests__/stats/fixtures/matchup-2026-w1-3.expected.json

with, for every team and both sides, value / rank / tied / pool of the six
Team Stats numbers; and for three pairs all 26 edges (13 lines x 2 ladders).

The rules (spec section 3):

  Team Stats numbers (play-weighted, never the mean of game rates):
    epa       = sum(epa_per_play * plays) / sum(plays)
    sr        = sum(success_rate * plays) / sum(plays)
    pass_epa  = sum(pass_epa_per_play * pass_plays) / sum(pass_plays)
    rush_epa  = sum(rush_epa_per_play * rush_plays) / sum(rush_plays)
    early_epa = sum(early_epa_per_play * early_plays) / sum(early_plays)
    late_epa  = sum(late_epa_per_play * late_plays) / sum(late_plays)
  Radar spokes: as docs/superpowers/specs/team-radar-reference/make_radar_expected.py.
  offense = the team's own rows; defense = rows where opponent_id is the team.
  rank = 1 + the number of pool values better than the team's by at least 1e-9
  (competition ranking; two values within 1e-9 are a tie and share the better
  place). Pool = teams with a row of their own, at least one game on the side
  ranked, and a value. Offense: higher is better except sack, turnover and
  stuff rate; defense: the reverse on every line.
  edge: gap = defense rank - offense rank; 0-4 places even, 5-12 lean, 13+ clear.

Run from anywhere:  py -3 -I docs/superpowers/specs/matchup-reference/make_matchup_expected.py
Optional arguments: <team stats rows json> <radar rows json> <out json>
"""
import json
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[4]
FIX = REPO / "__tests__" / "stats" / "fixtures"
STATS_ROWS = Path(sys.argv[1]) if len(sys.argv) > 1 else FIX / "team-game-stats-2026-w1-3.json"
RADAR_ROWS = Path(sys.argv[2]) if len(sys.argv) > 2 else FIX / "team-radar-2026-w1-3.json"
OUT = Path(sys.argv[3]) if len(sys.argv) > 3 else FIX / "matchup-2026-w1-3.expected.json"
RADAR_EXPECTED = FIX / "team-radar-2026-w1-3.expected.json"

TIE = 1e-9
LEAN_MIN_GAP = 5
CLEAR_MIN_GAP = 13
STRENGTH_MAX_RANK = 8
WEAKNESS_MIN_RANK = 25
NAMED_MIN_POOL = 25
TUG_SCALE = 31

# The 13 lines, in page order: key, where the number comes from, better-when-higher on OFFENSE.
LINES = [
    ("epa", "team-stats", True),
    ("sr", "team-stats", True),
    ("pass_epa", "team-stats", True),
    ("pass_sr", "radar", True),
    ("expl_pass", "radar", True),
    ("sack", "radar", False),
    ("rush_epa", "team-stats", True),
    ("rush_sr", "radar", True),
    ("expl_rush", "radar", True),
    ("stuff", "radar", False),
    ("to", "radar", False),
    ("early_epa", "team-stats", True),
    ("late_epa", "team-stats", True),
]
OFF_HIGHER = {key: hi for key, _, hi in LINES}
TEAM_STATS_KEYS = [key for key, source, _ in LINES if source == "team-stats"]

# The three pairs (away, home). CHI and PHI have played two games in the fixture, the rest three.
PAIRS = [("BUF", "HOU"), ("DET", "NO"), ("CHI", "PHI")]


def load(path):
    with open(path, encoding="utf-8") as fh:
        return json.load(fh)


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
        # Team Stats numbers
        "epa": wavg(rows, "epa_per_play", "plays"),
        "sr": wavg(rows, "success_rate", "plays"),
        "pass_epa": wavg(rows, "pass_epa_per_play", "pass_plays"),
        "rush_epa": wavg(rows, "rush_epa_per_play", "rush_plays"),
        "early_epa": wavg(rows, "early_epa_per_play", "early_plays"),
        "late_epa": wavg(rows, "late_epa_per_play", "late_plays"),
        # Radar spokes
        "expl_pass": ratio(total(rows, "explosive_pass"), total(rows, "pass_plays")),
        "pass_sr": wavg(rows, "pass_success_rate", "pass_plays"),
        "sack": ratio(sacks, total(rows, "attempts") + sacks),
        "to": ratio(total(rows, "turnovers"), total(rows, "total_drives")),
        "stuff": ratio(total(rows, "stuffed_runs"), total(rows, "designed_runs")) if known else None,
        "rush_sr": wavg(rows, "rush_success_rate", "rush_plays"),
        "expl_rush": ratio(total(rows, "explosive_rush"), total(rows, "rush_plays")),
    }


# ── the 35-column rows: the two fixtures joined by (game_id, team_id) ──
stats_rows = load(STATS_ROWS)
radar_by_key = {(r["game_id"], r["team_id"]): r for r in load(RADAR_ROWS)}
assert len(radar_by_key) == len(stats_rows), "the two fixtures hold different rows"
rows = []
for r in stats_rows:
    extra = radar_by_key[(r["game_id"], r["team_id"])]
    for col, v in extra.items():
        if col in r:
            assert r[col] == v, ("shared column differs", r["game_id"], r["team_id"], col)
    rows.append({**r, **extra})
assert all(len(r) == 35 for r in rows), sorted({len(r) for r in rows})

ids = sorted({r["team_id"] for r in rows} | {r["opponent_id"] for r in rows})
played = {r["team_id"] for r in rows}
sides = {t: {"off": side([r for r in rows if r["team_id"] == t]),
             "def": side([r for r in rows if r["opponent_id"] == t])} for t in ids}


def ranked(team, s, key):
    """value / rank / tied / pool of one number for one team on one side."""
    higher = OFF_HIGHER[key] if s == "off" else not OFF_HIGHER[key]
    vals = [sides[x][s][key] for x in ids
            if x in played and sides[x][s]["gp"] > 0 and sides[x][s][key] is not None]
    me = sides[team][s]
    mine = me[key]
    if mine is None or me["gp"] == 0 or team not in played:
        return {"value": None, "rank": None, "tied": False, "pool": len(vals)}
    ahead = sum(1 for v in vals if abs(v - mine) >= TIE and (v > mine if higher else v < mine))
    same = sum(1 for v in vals if abs(v - mine) < TIE)  # counts the team itself
    return {"value": mine, "rank": ahead + 1, "tied": same > 1, "pool": len(vals)}


def edge(off, dfn, off_id, def_id):
    """The edge of one ladder line from the two ranked cells (spec 3.3)."""
    if off["rank"] is None or dfn["rank"] is None:
        return {"side": "na", "level": 0, "gap": None, "places": None, "tag": "Not enough data",
                "tug": 50.0, "verdict": "Not enough data"}
    gap = dfn["rank"] - off["rank"]
    places = abs(gap)
    tug = min(100.0, max(0.0, 50 - (gap / TUG_SCALE) * 50))
    if places < LEAN_MIN_GAP:
        named = off["pool"] >= NAMED_MIN_POOL and dfn["pool"] >= NAMED_MIN_POOL
        if named and off["rank"] <= STRENGTH_MAX_RANK and dfn["rank"] <= STRENGTH_MAX_RANK:
            tag = "Strength on strength"
        elif named and off["rank"] >= WEAKNESS_MIN_RANK and dfn["rank"] >= WEAKNESS_MIN_RANK:
            tag = "Weakness on weakness"
        else:
            tag = "Even"
        if places == 0:
            verdict = f"{tag} · same rank"
        else:
            verdict = f"{tag} · {places} {'place' if places == 1 else 'places'} apart"
        return {"side": "even", "level": 0, "gap": gap, "places": places, "tag": tag, "tug": tug, "verdict": verdict}
    who = "off" if gap > 0 else "def"
    unit = f"{off_id} offense" if who == "off" else f"{def_id} defense"
    if places < CLEAR_MIN_GAP:
        return {"side": who, "level": 1, "gap": gap, "places": places, "tag": "Lean", "tug": tug,
                "verdict": f"{unit} by {places} places"}
    return {"side": who, "level": 2, "gap": gap, "places": places, "tag": "Clear edge", "tug": tug,
            "verdict": f"{unit} by {places} places · clear edge"}


def ladder(off_id, def_id):
    out = []
    for key, source, _ in LINES:
        off = ranked(off_id, "off", key)
        dfn = ranked(def_id, "def", key)
        out.append({"key": key, "source": source, "off": off, "def": dfn, "edge": edge(off, dfn, off_id, def_id)})
    return out


team_stats = {t: {s: {key: ranked(t, s, key) for key in TEAM_STATS_KEYS} for s in ("off", "def")} for t in ids}

for away, home in PAIRS:
    assert away in played and home in played, (away, home)
pairs = [{"away": away, "home": home,
          "awayGames": sides[away]["off"]["gp"], "homeGames": sides[home]["off"]["gp"],
          # away offense against home defense, then home offense against away defense
          "awayBall": ladder(away, home), "homeBall": ladder(home, away)} for away, home in PAIRS]

# Cross-check: the seven radar lines here must be the radar golden's own values and ranks.
if RADAR_EXPECTED.exists():
    radar = load(RADAR_EXPECTED)["teams"]
    n = 0
    for t in ids:
        for s in ("off", "def"):
            for key, source, _ in LINES:
                if source != "radar":
                    continue
                got, want = ranked(t, s, key), radar[t][s]
                assert got["rank"] == want["rank"][key], (t, s, key, got, want["rank"][key])
                assert got["pool"] == want["pool"][key] and got["tied"] == want["tied"][key], (t, s, key)
                a, b = got["value"], want[key]
                assert (a is None and b is None) or abs(a - b) <= 1e-12, (t, s, key, a, b)
                n += 1
    print("radar cross-check: value, rank, tied and pool identical on", n, "team-side-spokes")

expected = {
    "source": "make_matchup_expected.py over the two frozen fixtures team-game-stats-2026-w1-3.json and "
              "team-radar-2026-w1-3.json (94 rows, 2026 weeks 1-3), joined by (game_id, team_id) into the "
              "35-column matchup rows. No database. Pairs are (away, home): BUF at HOU, DET at NO, and CHI at "
              "PHI (CHI and PHI have two games in the fixture, every other team three).",
    "teamsPlayed": len(played),
    "throughWeek": max(r["week"] for r in rows),
    "rowCount": len(rows),
    "teamStats": team_stats,
    "pairs": pairs,
}

with open(OUT, "w", encoding="utf-8", newline="\n") as fh:
    json.dump(expected, fh, indent=1, ensure_ascii=False)
    fh.write("\n")

print("teams", len(ids), "teamsPlayed", expected["teamsPlayed"], "through week", expected["throughWeek"])
print("two-game teams", sorted(t for t in ids if sides[t]["off"]["gp"] == 2))
ties = [(t, s, k) for t in ids for s in ("off", "def") for k in TEAM_STATS_KEYS if team_stats[t][s][k]["tied"]]
print("tied Team Stats cells", len(ties), ties[:8])
for p in pairs:
    for ball in ("awayBall", "homeBall"):
        tags = {}
        for line in p[ball]:
            tags[line["edge"]["tag"]] = tags.get(line["edge"]["tag"], 0) + 1
        print(p["away"], "at", p["home"], ball, tags)
print("wrote", OUT)
