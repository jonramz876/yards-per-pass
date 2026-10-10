// Advance widths from a TTF (cmap format 4 + hmtx). Run from the repo root:
//   node docs/superpowers/specs/matchup-card-reference/measure.mjs
// (the two font paths below are relative to the working directory; they were
// absolute session paths in the spec's scratch copy, nothing else was changed)
import { readFileSync } from "node:fs";
function font(path) {
  const b = readFileSync(path); const n = b.readUInt16BE(4); const t = {};
  for (let i = 0; i < n; i++) { const o = 12 + i * 16; t[b.toString("ascii", o, o + 4)] = { off: b.readUInt32BE(o + 8), len: b.readUInt32BE(o + 12) }; }
  const upm = b.readUInt16BE(t.head.off + 18); const nh = b.readUInt16BE(t.hhea.off + 34);
  const cm = t.cmap.off; const nt = b.readUInt16BE(cm + 2); let sub = -1;
  for (let i = 0; i < nt; i++) { const p = b.readUInt16BE(cm + 4 + i * 8), e = b.readUInt16BE(cm + 6 + i * 8), o = b.readUInt32BE(cm + 8 + i * 8); if (b.readUInt16BE(cm + o) === 4 && ((p === 3 && e === 1) || p === 0)) sub = cm + o; }
  if (sub < 0) throw new Error("no format 4 cmap");
  const segX2 = b.readUInt16BE(sub + 6); const end = sub + 14, start = end + segX2 + 2, idD = start + segX2, idR = idD + segX2;
  const gid = (c) => { for (let i = 0; i < segX2 / 2; i++) { const e = b.readUInt16BE(end + i * 2); if (c <= e) { const s = b.readUInt16BE(start + i * 2); if (c < s) return 0; const ro = b.readUInt16BE(idR + i * 2), d = b.readInt16BE(idD + i * 2); if (ro === 0) return (c + d) & 0xffff; const g = b.readUInt16BE(idR + i * 2 + ro + (c - s) * 2); return g === 0 ? 0 : (g + d) & 0xffff; } } return 0; };
  const adv = (g) => b.readUInt16BE(t.hmtx.off + Math.min(g, nh - 1) * 4);
  return { upm, width: (s, px) => [...s].reduce((w, ch) => { const g = gid(ch.codePointAt(0)); return w + adv(g); }, 0) * px / upm, has: (ch) => gid(ch.codePointAt(0)) !== 0 };
}
const sans = font("node_modules/next/dist/compiled/@vercel/og/noto-sans-v27-latin-regular.ttf");
const pix = font("app/fonts/PressStart2P-Regular.ttf");
const w = (s, px) => sans.width(s, px).toFixed(1);
console.log("sans upm", sans.upm, "pixel upm", pix.upm, "pixel 'W' 'I' ' ' '4' at 20:", pix.width("W", 20), pix.width("I", 20), pix.width(" ", 20), pix.width("4", 20));
console.log("has middot/em dash/arrow:", sans.has("·"), sans.has("—"), sans.has("→"));
for (const s of ["100.0% · T-32nd", "100.0% · T-27th", "88.8% · T-28th", "11.3% · 1st", "7.0% · 19th", "—", "0.0% · T-1st"]) console.log("17px", s, w(s, 17));
for (const s of ["Explosive pass", "Explosive run", "Pass success", "Run success", "Turnovers", "Stuffs", "Sacks"]) console.log("14px", s, w(s, 14));
for (const s of ["WAS offense", "over", "WAS defense", "LAC offense", "LAC defense"]) console.log("19/15px", s, w(s, 19), w(s, 15));
const subs = [
  "Week 5 · Mon Oct 12 · 8:15 PM ET · 2026 through Week 5",
  "Week 5 · Thu Oct 8 · Final: TB 24, DAL 16 · 2026 through Week 5",
  "Week 18 · Sat Jan 10 · Final: WAS 38, NYG 35 · 2026 through Week 18",
  "Week 18 · Wed Dec 30 · 12:30 PM ET · 2026 through Week 18",
  "Conference Championship · Sun Jan 24 · Final: WAS 38, LAC 35 · 2026 through Week 18",
  "Conference Championship · Sun Jan 24 · 12:30 PM ET · 2026 through Week 18",
  "No 2026 game between these teams · 2026 through Week 18",
  "2026 through Week 18", "2026 season",
  "Each label: the stat · its league rank · farther out = better rank",
  "Solid line, round dots = offense. Dashed line, squares = defense. Outer ring = 1st of 32, amber dotted ring = middle of the league.",
  "Solid line, round dots = offense. Dashed line, squares = defense. Outer ring = 1st, amber dotted ring = middle of the league.",
  "Not enough of these rates are available yet to draw this radar.",
  "The Washington Commanders have not played a 2026 game yet.",
  "Matchup ranks start once 8 teams have played this season. Until then there are too few teams to rank against.",
];
for (const s of subs) console.log("15px", w(s, 15), "| 16px", w(s, 16), "| 18px", w(s, 18), "|", s);
for (const s of ["3-1 · away", "12-4-1 · home", "0-0", "17-0 · away"]) console.log("16px", s, w(s, 16));
