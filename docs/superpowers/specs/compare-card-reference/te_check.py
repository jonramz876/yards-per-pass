"""Same-day check of the TE pool rule: today's /receivers rows vs today's
/card/trey-mcbride page (both fetched 2026-10-09)."""
import json, re, os, sys, math, html as H
sys.stdout.reconfigure(encoding="ascii", errors="replace")
HERE = os.path.dirname(os.path.abspath(__file__))
raw = open(os.path.join(HERE, "live-rec-1009.html"), encoding="utf-8").read()
text = "".join(json.loads(m.group(1)) for m in re.finditer(r'self\.__next_f\.push\(\[1,("(?:[^"\\]|\\.)*")\]\)', raw))
dec = json.JSONDecoder(); rows = []; i = 0
while True:
    j = text.find('[{"', i)
    if j < 0: break
    try:
        v, e = dec.raw_decode(text, j)
    except Exception:
        i = j + 1; continue
    if isinstance(v, list) and v and isinstance(v[0], dict) and "player_id" in v[0] and len(v) > len(rows): rows = v
    i = e if isinstance(v, list) else j + 1
old = json.load(open(os.path.join(HERE, "live-rec.json"), encoding="utf-8"))
print("rows today", len(rows), "| rows on Oct 7", len(old), "| max games today", max(r["games"] for r in rows))
wk = re.search(r"Through Week \d+", text); print(wk.group(0) if wk else "no week text")
me = [r for r in rows if r["player_name"] == "T.McBride"][0]
pool = [r for r in rows if r["position"] == me["position"] and r["games"] > 0 and r["targets"] / r["games"] >= 2]
keys = ["targets_game", "epa_per_target", "croe", "air_yards_per_target", "yac_per_reception"]
val = lambda r, k: (r["targets"] / r["games"]) if k == "targets_game" else (float("nan") if r[k] is None else r[k])
mine = []
for k in keys:
    vals = [val(r, k) for r in pool if not math.isnan(val(r, k))]
    mine.append(sum(1 for x in vals if x < val(me, k)) / len(vals) * 100)
page = open(os.path.join(HERE, "card-trey-mcbride.html"), encoding="utf-8").read()
body = re.sub(r"<script.*?</script>", " ", page.split("<body", 1)[-1], flags=re.S)
t = re.sub(r"\|+", "|", H.unescape(re.sub(r"<[^>]+>", "|", body)))
live = [int(x) for x in re.findall(r"\|\s*(\d+)(?:ST|ND|RD|TH)\|", t.split("Value / Pctl", 1)[1])][:5]
print("TE pool today", len(pool), "| McBride games", me["games"], "targets", me["targets"])
print("card page :", live)
print("computed  :", [round(x, 1) for x in mine], "->", [int(x + 0.5) for x in mine])
print("MATCH" if live == [int(x + 0.5) for x in mine] else "DIFF")
