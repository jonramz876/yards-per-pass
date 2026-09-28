# Reference copy (spec 2026-09-28 M7): produced the golden team-stats fixtures; input/output paths point at the session scratchpad (scratchpad/team-stats/), not the repo.
"""Aggregate 2026 team_game_stats into season team leaderboards for the mockup.

Every rate is play-weighted: sum(rate * denominator) / sum(denominator), with the
denominator the box score uses for that rate. Defence = the opponents' offensive rows.
"""
import json
import math
import os

HERE = os.path.dirname(os.path.abspath(__file__))
data = json.load(open(os.path.join(HERE, "tgs_2026.json"), encoding="utf-8"))
rows = data["tgs"]
teams = {t["id"]: t for t in data["teams"]}


def num(v):
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return f if math.isfinite(f) else None


def wavg(rs, rate, den):
    top = bot = 0.0
    for r in rs:
        v, d = num(r.get(rate)), num(r.get(den))
        if v is None or not d:
            continue
        top += v * d
        bot += d
    return top / bot if bot else None


def total(rs, col):
    return sum(num(r.get(col)) or 0 for r in rs)


RATES = [  # (key, rate column, denominator column)
    ("epa", "epa_per_play", "plays"), ("pass_epa", "pass_epa_per_play", "pass_plays"),
    ("rush_epa", "rush_epa_per_play", "rush_plays"),
    ("sr", "success_rate", "plays"), ("pass_sr", "pass_success_rate", "pass_plays"),
    ("rush_sr", "rush_success_rate", "rush_plays"),
    ("fd", "first_down_rate", "plays"), ("pass_fd", "pass_first_down_rate", "pass_plays"),
    ("rush_fd", "rush_first_down_rate", "rush_plays"),
    ("early_epa", "early_epa_per_play", "early_plays"), ("early_sr", "early_success_rate", "early_plays"),
    ("late_epa", "late_epa_per_play", "late_plays"), ("late_sr", "late_success_rate", "late_plays"),
]


def side(rs):
    out = {"gp": len(rs), "plays": total(rs, "plays"), "pass_plays": total(rs, "pass_plays"),
           "rush_plays": total(rs, "rush_plays"), "early_plays": total(rs, "early_plays"),
           "late_plays": total(rs, "late_plays")}
    for key, rate, den in RATES:
        out[key] = wavg(rs, rate, den)
    ex, exp, exr = total(rs, "explosive_plays"), total(rs, "explosive_pass"), total(rs, "explosive_rush")
    out["expl"] = ex
    out["expl_rate"] = ex / out["plays"] if out["plays"] else None
    out["expl_pass"] = exp
    out["expl_pass_rate"] = exp / out["pass_plays"] if out["pass_plays"] else None
    out["expl_rush"] = exr
    out["expl_rush_rate"] = exr / out["rush_plays"] if out["rush_plays"] else None
    gp = out["gp"] or 1
    for key, col in (("cost_to", "epa_lost_turnovers"), ("cost_sack", "epa_lost_sacks"),
                     ("cost_pen", "epa_lost_penalties")):
        out[key] = total(rs, col) / gp
    out["cost_total"] = out["cost_to"] + out["cost_sack"] + out["cost_pen"]
    return out


by_game = {}
for r in rows:
    by_game.setdefault(r["game_id"], []).append(r)

result = []
for tid in sorted({r["team_id"] for r in rows}):
    off = [r for r in rows if r["team_id"] == tid]
    dfn = [r for r in rows if r["opponent_id"] == tid]
    toxic = to_margin = ex_margin = 0
    for r in off:
        opp = next((o for o in by_game[r["game_id"]] if o["team_id"] != tid), None)
        if opp is None:
            continue
        to_margin += (num(opp.get("turnovers")) or 0) - (num(r.get("turnovers")) or 0)
        ex_margin += (num(r.get("explosive_plays")) or 0) - (num(opp.get("explosive_plays")) or 0)
    t = teams.get(tid, {})
    result.append({"team": tid, "name": t.get("name") or tid, "off": side(off), "def": side(dfn),
                   "toxic": to_margin + ex_margin, "to_margin": to_margin, "ex_margin": ex_margin})

lg = side(rows)
json.dump({"teams": result, "league": lg, "freshness": data["freshness"],
           "team_cols": sorted(next(iter(teams.values())).keys())},
          open(os.path.join(HERE, "team_stats_2026.json"), "w", encoding="utf-8"))

top = sorted(result, key=lambda x: -(x["off"]["epa"] or -9))[:5]
print("league EPA/play %.3f  SR %.3f  1st %.3f  expl %.3f" % (lg["epa"], lg["sr"], lg["fd"], lg["expl_rate"]))
print("top 5 offence EPA/play:", [(x["team"], round(x["off"]["epa"], 3), x["off"]["gp"]) for x in top])
bot = sorted(result, key=lambda x: (x["def"]["epa"] or 9))[:5]
print("top 5 defence EPA/play allowed:", [(x["team"], round(x["def"]["epa"], 3)) for x in bot])
print("toxic top 3:", sorted([(x["team"], x["toxic"]) for x in result], key=lambda y: -y[1])[:3])
print("team columns:", sorted(next(iter(teams.values())).keys()))
