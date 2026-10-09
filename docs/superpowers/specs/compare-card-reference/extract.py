# NOTE: does not run from the repo. Needs the saved live leaderboard pages beside it (live-qb.html,
# live-rec.html, live-rb.html): session scratch, not committed. Its output is the repo fixture compare-2026-w4-rows.json.
"""Pull the season rows out of the saved leaderboard pages' RSC payload.
Writes live-<kind>.json (list of row dicts) and prints a summary."""
import json, re, sys, os

HERE = os.path.dirname(os.path.abspath(__file__))


def payload(path):
    html = open(path, encoding="utf-8").read()
    parts = []
    for m in re.finditer(r'self\.__next_f\.push\(\[1,("(?:[^"\\]|\\.)*")\]\)', html):
        parts.append(json.loads(m.group(1)))
    return "".join(parts), html


def find_arrays(text, marker='"player_id"'):
    """Every top-level JSON array of objects that contains the marker."""
    dec = json.JSONDecoder()
    out = []
    i = 0
    while True:
        j = text.find('[{"', i)
        if j < 0:
            break
        try:
            val, end = dec.raw_decode(text, j)
        except Exception:
            i = j + 1
            continue
        if isinstance(val, list) and val and isinstance(val[0], dict) and "player_id" in val[0]:
            out.append(val)
            i = end
        else:
            i = j + 1
    return out


for kind in ("qb", "rec", "rb"):
    text, html = payload(os.path.join(HERE, f"live-{kind}.html"))
    arrays = find_arrays(text)
    print(kind, "payload chars", len(text), "arrays", [(len(a), sorted(a[0].keys())[:6]) for a in arrays])
    if arrays:
        best = max(arrays, key=len)
        json.dump(best, open(os.path.join(HERE, f"live-{kind}.json"), "w", encoding="utf-8"))
        print("  keys:", sorted(best[0].keys()))
        print("  seasons:", sorted({r.get("season") for r in best}))
    # freshness / through week hints
    for m in re.finditer(r'[Tt]hrough [Ww]eek[^"<]{0,20}', text):
        print("  ", m.group(0)[:60])
        break
    for m in re.finditer(r'"through_week":\s*(\d+)', text):
        print("   through_week", m.group(1))
        break
