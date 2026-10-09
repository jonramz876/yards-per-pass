"""Cross-check: the stat-card-pool percentiles computed by build_data.py against
the percentiles printed on the six live /card/<slug> pages."""
import re, os, sys, json, html as H
sys.stdout.reconfigure(encoding="ascii", errors="replace")
HERE = os.path.dirname(os.path.abspath(__file__))
D = json.load(open(os.path.join(HERE, "mock-data.json"), encoding="utf-8"))
total = bad = 0
seen = set()
for g, p in list(D["pairs"].items()) + list(D.get("fixtureOnly", {}).items()):
    for pl, alt in zip(p["players"], (p["altA"], p["altB"])):
        if pl["slug"] in seen or not os.path.exists(os.path.join(HERE, f"card-{pl['slug']}.html")):
            continue
        seen.add(pl["slug"])
        raw = open(os.path.join(HERE, f"card-{pl['slug']}.html"), encoding="utf-8").read()
        body = re.sub(r"<script.*?</script>", " ", raw.split("<body", 1)[-1], flags=re.S)
        text = re.sub(r"\|+", "|", H.unescape(re.sub(r"<[^>]+>", "|", body)))
        gm = re.search(r"\|(\d+)\|\s*GAMES", text)
        if gm and int(gm.group(1)) != pl["games"]:
            print("SKIP", pl["name"], "card page now shows", gm.group(1), "games; rows captured at", pl["games"]); continue
        seg = text.split("Value / Pctl", 1)[1]
        live = [int(x) for x in re.findall(r"\|\s*(\d+)(?:ST|ND|RD|TH)\|", seg)][: len(alt)]
        dashes = seg.count("—")
        mine = [None if v is None else int(v + 0.5) for v in alt]
        shown = [v for v in mine if v is not None]
        ok = live[: len(shown)] == shown
        total += 1; bad += (not ok)
        print(("OK  " if ok else "DIFF"), pl["name"], "| card page:", live, "| computed:", mine)
print("players", total, "mismatches", bad)
