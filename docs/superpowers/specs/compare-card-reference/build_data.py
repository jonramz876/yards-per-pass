"""Build the mockup's numbers from the live season rows, with the exact rules
of components/compare/ComparisonTool.tsx + lib/stats/radar.ts + percentiles.ts
+ fantasy.ts (origin/main, 2026-10-07). Writes mock-data.json."""
import json, os, math, sys
from decimal import Decimal, ROUND_HALF_UP

sys.stdout.reconfigure(encoding="ascii", errors="replace")
HERE = os.path.dirname(os.path.abspath(__file__))
L = lambda k: json.load(open(os.path.join(HERE, f"live-{k}.json"), encoding="utf-8"))
QB, REC, RB = L("qb"), L("rec"), L("rb")
NAN = float("nan")


def num(v):
    """getStatVal: a number or NaN."""
    return float(v) if isinstance(v, (int, float)) and not isinstance(v, bool) else NAN


def fx(v, d):
    """JS Number.prototype.toFixed (ties away from zero on the exact binary value)."""
    q = Decimal(1).scaleb(-d)
    s = format(Decimal(v).quantize(q, rounding=ROUND_HALF_UP), "f")
    if v < 0 and float(s) == 0:  # JS keeps the sign: (-0.04).toFixed(1) === "-0.0"
        s = "-" + s.lstrip("-")
    return s


f0 = lambda v: fx(v, 0)
f1 = lambda v: fx(v, 1)
f2 = lambda v: fx(v, 2)
pct1 = lambda v: fx(v * 100, 1) + "%"
sgn1 = lambda v: ("+" if v >= 0 else "") + fx(v, 1)
sgnpct = lambda v: ("+" if v >= 0 else "") + fx(v * 100, 1) + "%"

g = lambda r, k: (r.get(k) or 0)
qb_fp = lambda r: g(r, "passing_yards") / 25 + g(r, "touchdowns") * 4 - g(r, "interceptions") * 2 + g(r, "rush_yards") / 10 + g(r, "rush_tds") * 6 - g(r, "fumbles_lost")
wr_fp = lambda r: g(r, "receiving_yards") / 10 + g(r, "receiving_tds") * 6 + g(r, "receptions") * 1.0 - g(r, "fumbles_lost")
rb_fp = lambda r: g(r, "rushing_yards") / 10 + g(r, "rushing_tds") * 6 + g(r, "receiving_yards") / 10 + g(r, "receiving_tds") * 6 + g(r, "receptions") * 1.0 - g(r, "fumbles_lost")

# (label, key, format, higherBetter, getValue) -- copied from ComparisonTool.tsx
QB_STATS = [
    ("EPA/DB", "epa_per_db", f2, True, None), ("CPOE", "cpoe", sgn1, True, None), ("aDOT", "adot", f1, True, None),
    ("Success%", "success_rate", pct1, True, None), ("Pass Yds", "passing_yards", f0, True, None),
    ("Pass TD", "touchdowns", f0, True, None), ("INT", "interceptions", f0, False, None), ("ANY/A", "any_a", f2, True, None),
    ("Rating", "passer_rating", f1, True, None), ("TD%", "td_pct", f1, True, None), ("INT%", "int_pct", f1, False, None),
    ("SK%", "sack_pct", f1, False, None), ("Total EPA", "total_epa", f1, True, None), ("Rush Yds", "rush_yards", f0, True, None),
    ("Rush TD", "rush_tds", f0, True, None), ("SCR%", "scramble_pct", f1, True, None), ("FPts", "fantasy_pts", f1, True, qb_fp),
    ("Games", "games", f0, True, None),
]
WR_STATS = [
    ("EPA/Tgt", "epa_per_target", f2, True, None), ("CROE", "croe", sgnpct, True, None), ("aDOT", "air_yards_per_target", f1, True, None),
    ("YAC/Rec", "yac_per_reception", f1, True, None), ("YPRR", "yards_per_route_run", f2, True, None),
    ("Targets", "targets", f0, True, None), ("Receptions", "receptions", f0, True, None), ("Yards", "receiving_yards", f0, True, None),
    ("TDs", "receiving_tds", f0, True, None), ("Catch%", "catch_rate", pct1, True, None), ("Tgt Share", "target_share", pct1, True, None),
    ("AY%", "air_yards_share", pct1, True, None), ("FPts (PPR)", "fantasy_pts", f1, True, wr_fp), ("Games", "games", f0, True, None),
]
RB_STATS = [
    ("EPA/Car", "epa_per_carry", f2, True, None), ("Success%", "success_rate", pct1, True, None), ("Stuff%", "stuff_rate", pct1, False, None),
    ("Explosive%", "explosive_rate", pct1, True, None), ("Carries", "carries", f0, True, None), ("Rush Yds", "rushing_yards", f0, True, None),
    ("Rush TD", "rushing_tds", f0, True, None), ("YPC", "yards_per_carry", f1, True, None), ("TCH", "total_touches", f0, True, None),
    ("Total EPA", "total_rushing_epa", f1, True, None), ("FPts (PPR)", "fantasy_pts", f1, True, rb_fp), ("Games", "games", f0, True, None),
]
# The spec's proposed card rows (a subset of the Compare page's rows, by key).
CARD_KEYS = {
    "QB": ["passing_yards", "touchdowns", "interceptions", "epa_per_db", "cpoe", "any_a", "fantasy_pts"],
    "WR": ["targets", "receptions", "receiving_yards", "receiving_tds", "epa_per_target", "croe", "fantasy_pts"],
    "RB": ["carries", "rushing_yards", "rushing_tds", "yards_per_carry", "epa_per_carry", "success_rate", "fantasy_pts"],
}


def nn(v):
    return NAN if v is None else float(v)


def qb_radar(r, k):
    if k == "epa_per_db": return nn(r["epa_per_db"])
    if k == "cpoe": return nn(r["cpoe"])
    if k == "dropbacks_game": return r["dropbacks"] / r["games"] if r["games"] else NAN
    if k == "adot": return nn(r["adot"])
    if k == "inv_int_pct": return 1 - r["interceptions"] / r["attempts"] if r["attempts"] > 0 else NAN
    if k == "success_rate": return nn(r["success_rate"])
    if k == "rush_epa":
        raw = nn(r["rush_epa_per_play"])
        if math.isnan(raw): return NAN
        return raw * min(r["rush_attempts"] / 60, 1) ** 3


def wr_radar(r, k):
    if k == "targets_game": return r["targets"] / r["games"] if r["games"] else NAN
    return nn(r[k])


def rb_radar(r, k):
    if k == "carries_game": return r["carries"] / r["games"] if r["games"] else NAN
    if k == "epa_per_carry": return nn(r["epa_per_carry"])
    if k == "stuff_avoidance":  # JS: !isNaN(null) is true and 1 - null === 1
        return 1 - (r["stuff_rate"] or 0)
    if k == "explosive_rate": return nn(r["explosive_rate"])
    if k == "targets_game": return r["targets"] / r["games"] if r["games"] else NAN
    if k == "success_rate": return nn(r["success_rate"])


GROUPS = {
    "QB": dict(pool=QB, stats=QB_STATS, radar=qb_radar, missing_nan=False,
               keys=["epa_per_db", "cpoe", "dropbacks_game", "adot", "inv_int_pct", "success_rate", "rush_epa"],
               axes=["EPA/DB", "CPOE", "DB/Game", "aDOT", "Ball Security", "Success%", "Rush EPA"]),
    "WR": dict(pool=REC, stats=WR_STATS, radar=wr_radar, missing_nan=True,
               keys=["targets_game", "epa_per_target", "croe", "air_yards_per_target", "yac_per_reception", "yards_per_route_run"],
               axes=["Tgt/Game", "EPA/Tgt", "CROE", "aDOT", "YAC/Rec", "YPRR"]),
    "RB": dict(pool=RB, stats=RB_STATS, radar=rb_radar, missing_nan=False,
               keys=["carries_game", "epa_per_carry", "stuff_avoidance", "explosive_rate", "targets_game", "success_rate"],
               axes=["Car/Game", "EPA/Car", "Stuff Avoid", "Explosive%", "Tgt/Game", "Success%"]),
}


def percentiles(cfg, pool, row):
    out = []
    for k in cfg["keys"]:
        vals = sorted(v for v in (cfg["radar"](p, k) for p in pool) if not math.isnan(v))
        v = cfg["radar"](row, k)
        if math.isnan(v) or not vals:
            out.append(None if cfg["missing_nan"] else 0.0)
        else:
            out.append(sum(1 for x in vals if x < v) / len(vals) * 100)
    return out


TEAMS = {  # lib/data/teams.ts
    "BUF": ("Buffalo Bills", "#00338D"), "LA": ("Los Angeles Rams", "#003594"), "DAL": ("Dallas Cowboys", "#041E42"),
    "SEA": ("Seattle Seahawks", "#002244"), "ATL": ("Atlanta Falcons", "#A71930"), "DET": ("Detroit Lions", "#0076B6"),
}
PALETTE = ["#dc2626", "#2563eb", "#16a34a", "#d97706", "#9333ea", "#0891b2"]


def dist(a, b):
    r1, g1, b1 = (int(a[i:i + 2], 16) for i in (1, 3, 5))
    r2, g2, b2 = (int(b[i:i + 2], 16) for i in (1, 3, 5))
    return math.sqrt(2 * (r1 - r2) ** 2 + 4 * (g1 - g2) ** 2 + 3 * (b1 - b2) ** 2)


def ensure_contrast(c1, c2):
    if dist(c1, c2) >= 150: return c2
    for alt in PALETTE:
        if dist(c1, alt) >= 150: return alt
    return PALETTE[1]


ELIG = {"QB": lambda r: r["games"] > 0 and r["attempts"] / r["games"] >= 14,
        "WR": lambda r: r["games"] > 0 and r["targets"] / r["games"] >= 2,
        "RB": lambda r: r["games"] > 0 and r["carries"] / r["games"] >= 6}

PAIRS = [
    ("QB", ("J.Allen", "BUF", "Josh Allen", "josh-allen", "QB", 91, "Dual Threat"),
           ("M.Stafford", "LA", "Matthew Stafford", "matthew-stafford", "QB", 76, "Gunslinger")),
    ("WR", ("C.Lamb", "DAL", "CeeDee Lamb", "ceedee-lamb", "WR", 97, "Target Magnet"),
           ("J.Smith-Njigba", "SEA", "Jaxon Smith-Njigba", "jaxon-smith-njigba", "WR", 96, "Alpha WR1")),
    ("RB", ("Bi.Robinson", "ATL", "Bijan Robinson", "bijan-robinson", "RB", 96, "Three-Down Back"),
           ("J.Gibbs", "DET", "Jahmyr Gibbs", "jahmyr-gibbs", "RB", 85, "Dual-Threat Back")),
]
# Fixture-only pairs (not in the mockup): a TE pair and a WR-vs-TE pair, so the
# expected file covers a TE pool and two pools in one comparison. OVR not captured.
EXTRA = [
    ("TE", "WR", ("T.McBride", "ARI", "Trey McBride", "trey-mcbride", "TE", None, None),
                 ("S.LaPorta", "DET", "Sam LaPorta", "sam-laporta", "TE", None, None)),
    ("WRTE", "WR", ("C.Lamb", "DAL", "CeeDee Lamb", "ceedee-lamb", "WR", 97, "Target Magnet"),
                   ("T.McBride", "ARI", "Trey McBride", "trey-mcbride", "TE", None, None)),
]
TEAMS.update({"ARI": ("Arizona Cardinals", "#97233F")})


def card_pool(group, row, table):
    """The stat card's pool for ONE player (lib/stats/tecmo-card.ts): qualified
    players; for the receiver table, of the row's own position."""
    if group == "WR":
        return [r for r in table if r["position"] == row["position"] and ELIG["WR"](r)]
    return [r for r in table if ELIG[group](r)]

out = {"season": 2026, "throughWeek": 4, "pairs": {}}
for pkey, group, a, b in [(g, g, a, b) for g, a, b in PAIRS] + EXTRA:
    cfg = GROUPS[group]
    pool = cfg["pool"]
    rows = []
    for spec in (a, b):
        m = [r for r in pool if r["player_name"] == spec[0] and r["team_id"] == spec[1]]
        assert len(m) == 1, (spec, len(m))
        rows.append(m[0])
    ra, rb_ = rows
    stats = []
    for label, key, fmt, hb, getv in cfg["stats"]:
        v1 = getv(ra) if getv else num(ra.get(key))
        v2 = getv(rb_) if getv else num(rb_.get(key))
        ok1, ok2 = not math.isnan(v1), not math.isnan(v2)
        w = 0
        if ok1 and ok2:
            w = (1 if v1 > v2 else 2 if v2 > v1 else 0) if hb else (1 if v1 < v2 else 2 if v2 < v1 else 0)
        stats.append({"label": label, "key": key, "a": fmt(v1) if ok1 else "—", "b": fmt(v2) if ok2 else "—", "w": w})
    c1 = TEAMS[a[1]][1]
    c2raw = TEAMS[b[1]][1]
    c2 = ensure_contrast(c1, c2raw)
    pa, pb = percentiles(cfg, pool, ra), percentiles(cfg, pool, rb_)
    # the alternative pool (Decision): same exact position + the player card's eligibility line
    pos_ok = (lambda r: True) if group != "WR" else (lambda r: r["position"] == "WR")
    pool_a, pool_b = card_pool(group, ra, pool), card_pool(group, rb_, pool)
    alt_pool = pool_a
    alt_a, alt_b = percentiles(cfg, pool_a, ra), percentiles(cfg, pool_b, rb_)
    rnd = lambda xs: [None if x is None else round(x, 2) for x in xs]
    players = []
    for spec, row, col in ((a, ra, c1), (b, rb_, c2)):
        vol = {"QB": ("attempts", "pass attempts"), "WR": ("targets", "targets"), "RB": ("carries", "carries")}[group]
        players.append({"name": spec[2], "slug": spec[3], "pos": spec[4], "team": spec[1], "teamName": TEAMS[spec[1]][0],
                        "teamColor": TEAMS[spec[1]][1], "color": col, "games": row["games"], "ovr": spec[5], "archetype": spec[6],
                        "volume": row[vol[0]], "volumeWord": vol[1], "eligible": bool(ELIG[group](row))})
    (out["pairs"] if pkey in ("QB", "WR", "RB") else out.setdefault("fixtureOnly", {}))[pkey] = {
        "group": group, "players": players, "axes": cfg["axes"], "a": rnd(pa), "b": rnd(pb),
        "altA": rnd(alt_a), "altB": rnd(alt_b), "poolSize": len(pool), "altPoolSize": len(alt_pool), "cardPoolA": len(pool_a), "cardPoolB": len(pool_b),
        "rowPosA": ra.get("position", "QB"), "rowPosB": rb_.get("position", "QB"),
        "stats": stats, "cardKeys": CARD_KEYS[group], "contrastSwapped": c2 != c2raw, "rawColorB": c2raw,
    }
    # A real player under the stat card's line, for the small-sample wording (C6).
    vk, vw = {"QB": ("attempts", "pass attempts"), "WR": ("targets", "targets"), "RB": ("carries", "carries")}[group]
    low = max((r for r in pool if pos_ok(r) and not ELIG[group](r) and r["games"] > 0), key=lambda r: (r[vk], r["player_name"]))
    (out["pairs"] if pkey in out["pairs"] else out["fixtureOnly"])[pkey]["lowSample"] = {"short": low["player_name"], "team": low["team_id"], "n": low[vk], "unit": vw, "games": low["games"]}
    print("   low sample:", low["player_name"], low[vk], low["games"], "| card pools", len(pool_a), len(pool_b))
    print(group, a[2], "vs", b[2], "| colours", c1, c2, "(raw", c2raw + ")", "| pool", len(pool), "alt", len(alt_pool))
    for ax, x, y, xa, ya in zip(cfg["axes"], pa, pb, alt_a, alt_b):
        f = lambda v: "  -- " if v is None else f"{v:5.1f}"
        print(f"   {ax:14s} {f(x)} {f(y)}   alt {f(xa)} {f(ya)}")
    for s in stats:
        print(f"   {s['a']:>8s} {'*' if s['w'] == 1 else ' '} {s['label']:11s} {'*' if s['w'] == 2 else ' '} {s['b']:>8s}")

if RB:
    print("RB null stuff_rate rows:", sum(1 for r in RB if r["stuff_rate"] is None))
print("REC by position:", {p: sum(1 for r in REC if r["position"] == p) for p in ("WR", "TE", "RB")})
json.dump(out, open(os.path.join(HERE, "mock-data.json"), "w", encoding="utf-8"), ensure_ascii=True, separators=(",", ":"))
print("bytes", os.path.getsize(os.path.join(HERE, "mock-data.json")))
