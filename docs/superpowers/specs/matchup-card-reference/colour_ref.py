"""Reference for the matchup card's colour rule (card spec section 5, as amended by the colour families spec 2026-10-11).
  py -3 -I docs/superpowers/specs/matchup-card-reference/colour_ref.py lib/data/teams.ts <out.json>
Independent of the TypeScript: integer darkening, half-up rounding, CIE76, threshold 40, colour families from the wheel hue.
The away-first chain is the card spec's; "alike" = distance < 40, OR both very dark, OR same colour family, OR a red beside an orange."""
import itertools, json, math, re, sys

THRESH, MIN_CONTRAST, DARK_MAX, RING_MIN = 40.0, 3.0, 25.0, 30.0
C_NEUTRAL, NEUTRAL_BLACK_MAX_L, NEUTRAL_WHITE_MIN_L, BROWN_MAX_L = 8.8, 35.0, 90.0, 30.0
# colour-wheel hue cuts: red | orange | gold | green | teal | blue | purple | red
CUT_ORANGE, CUT_GOLD, CUT_GREEN, CUT_TEAL, CUT_BLUE, CUT_PURPLE, CUT_RED = 7.0, 33.5, 70.0, 172.0, 195.0, 257.0, 306.0
GREY, INK, AMBER, RING_GREY = "#64748B", "#0F172A", "#F59E0B", "#94A3B8"
OWN = ("primary", "secondary", "secondary-darkened", "primary-darkened")
src = open(sys.argv[1], encoding="utf-8").read()
teams = {m.group(1): {"p": m.group(2).upper(), "s": m.group(3).upper()}
         for m in re.finditer(r"id: '(\w+)'.*?primaryColor: '(#[0-9A-Fa-f]{6})', secondaryColor: '(#[0-9A-Fa-f]{6})'", src)}
assert len(teams) == 32
rgb = lambda h: [int(h[i:i + 2], 16) for i in (1, 3, 5)]
def lin(v):
    v /= 255
    return v / 12.92 if v <= 0.03928 else ((v + 0.055) / 1.055) ** 2.4
def lum(h):
    r, g, b = [lin(v) for v in rgb(h)]
    return 0.2126 * r + 0.7152 * g + 0.0722 * b
readable = lambda h: 1.05 / (lum(h) + 0.05) >= MIN_CONTRAST
def lab(h):
    r, g, b = [lin(v) for v in rgb(h)]
    x = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047
    y = 0.2126 * r + 0.7152 * g + 0.0722 * b
    z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883
    f = lambda t: t ** (1 / 3) if t > 0.008856 else 7.787 * t + 16 / 116
    return 116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))
delta = lambda a, b: math.dist(lab(a), lab(b))
chroma = lambda h: math.hypot(lab(h)[1], lab(h)[2])
def wheel_hue(h):
    """The colour-wheel hue (HSV / HSL hue), 0-360; 0 for a pure grey."""
    r, g, b = rgb(h)
    mx, mn = max(r, g, b), min(r, g, b)
    if mx == mn:
        return 0.0
    d = mx - mn
    if mx == r:
        return (60.0 * (g - b) / d) % 360.0
    if mx == g:
        return 60.0 * (b - r) / d + 120.0
    return 60.0 * (r - g) / d + 240.0
def family(h):
    L, c, hue = lab(h)[0], chroma(h), wheel_hue(h)
    if c < C_NEUTRAL:
        return "black" if L < NEUTRAL_BLACK_MAX_L else ("white" if L >= NEUTRAL_WHITE_MIN_L else "grey")
    if CUT_ORANGE <= hue < CUT_GREEN and L < BROWN_MAX_L:
        return "brown"
    if hue < CUT_ORANGE or hue >= CUT_RED:
        return "red"
    for name, cut in (("orange", CUT_GOLD), ("gold", CUT_GREEN), ("green", CUT_TEAL), ("teal", CUT_BLUE), ("blue", CUT_PURPLE), ("purple", CUT_RED)):
        if hue < cut:
            return name
def alike_without_family(a, b):
    return delta(a, b) < THRESH or (lab(a)[0] < DARK_MAX and lab(b)[0] < DARK_MAX)
def alike(a, b):
    if alike_without_family(a, b):
        return True
    fa, fb = family(a), family(b)
    return fa == fb or {fa, fb} == {"red", "orange"}
def alike_in_chain(a, b):
    """The chain's own neutrals (slate, ink) are not team colours and have no family: distance and very dark only."""
    return alike_without_family(a, b) if a in (GREY, INK) or b in (GREY, INK) else alike(a, b)
def darken(h):
    if readable(h):
        return h
    c = rgb(h)
    for n in range(1, 20):
        out = "#%02X%02X%02X" % tuple((v * (20 - n) * 2 + 20) // 40 for v in c)   # round half up of v*(20-n)/20
        if readable(out):
            return out
    return out
def away_first(t):
    if readable(t["p"]):
        return t["p"], "primary"
    d = darken(t["p"])
    if readable(d):
        return d, "primary-darkened"
    return (t["s"], "secondary") if readable(t["s"]) else (INK, "ink")
own = lambda t: [("primary", t["p"]), ("secondary", t["s"]), ("secondary-darkened", darken(t["s"])), ("primary-darkened", darken(t["p"]))]
def pick(a_id, h_id):
    ta, th = teams[a_id], teams[h_id]
    a, astep = away_first(ta)
    for step, c in own(th):
        if readable(c) and not alike_in_chain(a, c):
            return a, astep, c, step, False
    for astep2, a2 in (("secondary", ta["s"]), ("secondary-darkened", darken(ta["s"]))):
        if not readable(a2) or a2 == a:
            continue
        for step, c in own(th):
            if readable(c) and not alike_in_chain(a2, c):
                return a2, astep2, c, step, True
    for step, c in (("grey", GREY), ("ink", INK)):
        if not alike_in_chain(a, c):
            return a, astep, c, step, False
    best = max(((delta(a, c), c, step) for step, c in own(th) + [("grey", GREY), ("ink", INK)] if readable(c)))
    return a, astep, best[1], best[2], False
other = lambda t, step: t["s"] if step.startswith("primary") else t["p"]
# The ring: amber, grey beside a card colour close to amber. Close = alike amber (a gold, or within 40 of it), or an orange.
near_amber = lambda c: alike(AMBER, c) or family(c) == "orange"
out = {}
for x, y in itertools.permutations(sorted(teams), 2):
    a, astep, h, hstep, switched = pick(x, y)
    ring = RING_GREY if near_amber(a) or near_amber(h) else AMBER
    assert readable(a) and readable(h) and not alike(a, h) and astep in OWN and hstep in OWN, (x, y)
    assert family(a) != family(h) and {family(a), family(h)} != {"red", "orange"}, (x, y)
    assert min(delta(ring, a), delta(ring, h)) >= RING_MIN, (x, y, ring)
    out[x + "-" + y] = {"away": a, "awayFrom": astep, "home": h, "homeFrom": hstep, "awaySwitched": switched,
                        "awayRule": other(teams[x], astep), "homeRule": other(teams[y], hstep), "ring": ring}
json.dump(out, open(sys.argv[2], "w", encoding="utf-8", newline="\n"), indent=0, sort_keys=True)
print("pairs", len(out), "amber", sum(1 for v in out.values() if v["ring"] == AMBER), "grey", sum(1 for v in out.values() if v["ring"] == RING_GREY),
      "switched", sum(1 for v in out.values() if v["awaySwitched"]), "min dE", round(min(delta(v["away"], v["home"]) for v in out.values()), 1),
      "min ring dE", round(min(min(delta(v["ring"], v["away"]), delta(v["ring"], v["home"])) for v in out.values()), 1))
