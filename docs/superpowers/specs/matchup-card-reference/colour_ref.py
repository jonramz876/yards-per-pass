"""Reference for the matchup card's colour rule (spec section 5).  py -3 -I colour_ref.py <teams.ts> <out.json>
Independent of the TypeScript: integer darkening, half-up rounding, CIE76, threshold 40."""
import itertools, json, math, re, sys

THRESH, MIN_CONTRAST, HUE_MIN, CHROMA_MIN, DARK_MAX, RING_MIN = 40.0, 3.0, 30.0, 20.0, 25.0, 30.0
GREY, INK, AMBER, RING_GREY = "#64748B", "#0F172A", "#F59E0B", "#94A3B8"
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
def alike(a, b):
    if delta(a, b) < THRESH:
        return True
    p, q = lab(a), lab(b)
    if p[0] < DARK_MAX and q[0] < DARK_MAX:
        return True
    if math.hypot(p[1], p[2]) < CHROMA_MIN or math.hypot(q[1], q[2]) < CHROMA_MIN:
        return False
    dh = abs(math.degrees(math.atan2(p[2], p[1])) - math.degrees(math.atan2(q[2], q[1]))) % 360
    return min(dh, 360 - dh) < HUE_MIN
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
        if readable(c) and not alike(a, c):
            return a, astep, c, step, False
    for astep2, a2 in (("secondary", ta["s"]), ("secondary-darkened", darken(ta["s"]))):
        if not readable(a2) or a2 == a:
            continue
        for step, c in own(th):
            if readable(c) and not alike(a2, c):
                return a2, astep2, c, step, True
    for step, c in (("grey", GREY), ("ink", INK)):
        if not alike(a, c):
            return a, astep, c, step, False
    best = max(((delta(a, c), c, step) for step, c in own(th) + [("grey", GREY), ("ink", INK)] if readable(c)))
    return a, astep, best[1], best[2] + "-closest", False
other = lambda t, step: t["s"] if step.startswith("primary") else t["p"]
near_amber = lambda c: lab(c)[0] >= DARK_MAX and alike(AMBER, c)
out = {}
for x, y in itertools.permutations(sorted(teams), 2):
    a, astep, h, hstep, switched = pick(x, y)
    ring = RING_GREY if near_amber(a) or near_amber(h) else AMBER
    assert readable(a) and readable(h) and not alike(a, h) and hstep in ("primary", "secondary", "secondary-darkened", "primary-darkened"), (x, y)
    assert min(delta(ring, a), delta(ring, h)) >= RING_MIN, (x, y, ring)
    out[x + "-" + y] = {"away": a, "awayFrom": astep, "home": h, "homeFrom": hstep, "awaySwitched": switched,
                        "awayRule": other(teams[x], astep), "homeRule": other(teams[y], hstep), "ring": ring}
json.dump(out, open(sys.argv[2], "w", encoding="utf-8", newline="\n"), indent=0, sort_keys=True)
print("pairs", len(out), "amber", sum(1 for v in out.values() if v["ring"] == AMBER), "grey", sum(1 for v in out.values() if v["ring"] == RING_GREY),
      "switched", sum(1 for v in out.values() if v["awaySwitched"]), "min dE", round(min(delta(v["away"], v["home"]) for v in out.values()), 1),
      "min ring dE", round(min(min(delta(v["ring"], v["away"]), delta(v["ring"], v["home"])) for v in out.values()), 1))
