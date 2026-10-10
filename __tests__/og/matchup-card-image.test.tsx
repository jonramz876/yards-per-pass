// lib/og/matchup-card-image.tsx (matchup card spec 2026-10-11 §6, §7; PR 2):
// the 1200×630 picture of one game. @vercel/og cannot render under vitest on
// Windows, so these tests read the element tree the renderer is given: what
// Satori accepts, and that every colour, number and sentence on the picture is
// the model's. The real PNGs were rendered and measured separately (spec §18).
// No PNG checksum: the bytes change with next/og.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ReactElement } from "react";
import { matchupCardImage, matchupPlateImage } from "@/lib/og/matchup-card-image";
import { PIXEL, SANS } from "@/lib/og/team-radar-image";
import {
  MATCHUP_CARD_HOW_TO, MATCHUP_CARD_KEEP_CLEAR_Y, MATCHUP_CARD_LAYOUT as L, MATCHUP_CARD_RADAR as G, MATCHUP_CARD_SITE_NAME,
  matchupCardSeasonLine,
} from "@/lib/stats/matchup-card";
import { MATCHUP_RING_AMBER, MATCHUP_RING_GREY } from "@/lib/stats/matchup-colours";
import { RADAR_CARD_SITE_LINE, RADAR_HUB, RADAR_MID_SCORE, radarRadius } from "@/lib/stats/team-radar";
import { MATCHUP_NO_OVERLAY_NOTE, MATCHUP_SMALL_POOL_NOTE } from "@/lib/stats/matchup";
import {
  PLATES, card, cardGame, drawnPane, rowsMissingSpokes, rowsUndrawn, type CardModel,
} from "../stats/helpers/matchup-card-loads";

type El = ReactElement<Record<string, unknown>>;

const CASES: Record<string, () => CardModel> = {
  "BUF at LA (twin blues, grey ring)": () => card("BUF", "LA"),
  "TB at DAL (played: final score)": () => card("TB", "DAL", { game: cardGame("TB", "DAL", { week: 5, gameday: "2026-10-08", weekday: "Thursday", away_score: 24, home_score: 16 }) }),
  "KC vs TB (no game, away gave way)": () => card("KC", "TB", { game: null }),
  "ARI at TB (TB in orange, its rule its own red)": () => card("ARI", "TB"),
  "LAC at KC": () => card("LAC", "KC"),
  "WAS at JAX (the longest names)": () => card("WAS", "JAX"),
  "a missing spoke": () => card("BUF", "LA", { rows: rowsMissingSpokes("BUF") }),
  "one pane undrawn": () => card("BUF", "LA", { rows: rowsUndrawn("BUF") }),
  "a playoff game (no K4)": () => card("BUF", "LA", { game: cardGame("BUF", "LA", { game_type: "CON", week: 21, gameday: "2027-01-24", weekday: "Sunday" }) }),
};

/** Every element of a tree, depth first. */
function flatten(node: unknown, out: El[] = []): El[] {
  if (Array.isArray(node)) node.forEach((n) => flatten(n, out));
  else if (node !== null && typeof node === "object" && "props" in (node as object)) {
    const el = node as El;
    out.push(el);
    flatten(el.props.children, out);
  }
  return out;
}
/** All the text under an element. */
function text(node: unknown): string {
  if (node === null || node === undefined || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(text).join("");
  return text((node as El).props.children);
}
const by = (els: El[], attr: string, value?: string) =>
  els.filter((e) => (value === undefined ? e.props[attr] !== undefined : e.props[attr] === value));
const one = (els: El[], attr: string, value?: string): El => {
  const hits = by(els, attr, value);
  expect(hits, `${attr}=${value ?? "*"}`).toHaveLength(1);
  return hits[0];
};
const style = (e: El) => (e.props.style ?? {}) as Record<string, unknown>;
/** A tree as plain data (type, props, children), to compare two drawings of the same block. */
const shape = (node: unknown): unknown => {
  if (Array.isArray(node)) return node.map(shape);
  if (node === null || typeof node !== "object" || !("props" in (node as object))) return node;
  const { children, ...props } = (node as El).props;
  return { type: (node as El).type, props, children: shape(children) };
};

/* The fixed neutrals of the image file (spec §10), upper-case. */
const NEUTRALS = ["#FFFFFF", "#0F172A", "#475569", "#64748B", "#94A3B8", "#E2E8F0", "#EEF2F7", "#F8FAFC"];
/** Every colour an element carries: text, background, borders, fill and stroke. */
function coloursOf(e: El): string[] {
  const s = style(e);
  const values: unknown[] = [s.color, s.backgroundColor, s.borderColor, s.border, s.borderTop, s.borderBottom, s.borderLeft, s.borderRight, e.props.fill, e.props.stroke];
  const out: string[] = [];
  for (const v of values) {
    if (v === undefined || v === "none") continue;
    const text = String(v);
    const hexes = text.match(/#[0-9a-fA-F]+/g);
    // A colour that is not written as a hex (rgb(), a name) is not on the list either.
    if (!hexes) out.push(text);
    else out.push(...hexes.map((h) => h.toUpperCase()));
  }
  return out;
}

describe.each(Object.entries(CASES))("what Satori is given: %s", (_name, build) => {
  const m = build();
  const tree = matchupCardImage(m);
  const els = flatten(tree);

  it("plain elements only: div, svg, path, line, circle. No components, no fragments, no svg text, rect or polygon", () => {
    for (const e of els) expect(["div", "svg", "path", "line", "circle"], String(e.type)).toContain(e.type);
    for (const svg of els.filter((e) => e.type === "svg")) {
      for (const inner of flatten(svg.props.children)) expect(["path", "line", "circle"], String(inner.type)).toContain(inner.type);
    }
  });

  it("every div is display:flex, and none is a grid", () => {
    for (const e of els.filter((x) => x.type === "div")) expect(style(e).display, text(e).slice(0, 40)).toBe("flex");
  });

  it("no NaN, undefined or null reaches the picture: not in a path, not in a coordinate, not in any text", () => {
    for (const e of els) {
      for (const [key, value] of Object.entries(e.props)) {
        if (key === "children" || key === "style") continue;
        if (typeof value === "number") expect(Number.isFinite(value), `${String(e.type)} ${key}`).toBe(true);
        if (typeof value === "string") expect(value, `${String(e.type)} ${key}`).not.toMatch(/NaN|undefined|null|Infinity/);
      }
      for (const [key, value] of Object.entries(style(e))) {
        if (typeof value === "number") expect(Number.isFinite(value), `style ${key}`).toBe(true);
        if (typeof value === "string") expect(value, `style ${key}`).not.toMatch(/NaN|undefined|null/);
      }
    }
    expect(text(tree)).not.toMatch(/NaN|undefined|null|\[object/);
  });

  it("svg coordinates are plain numbers", () => {
    for (const e of els.filter((x) => x.type === "circle")) for (const k of ["cx", "cy", "r"]) expect(typeof e.props[k], k).toBe("number");
    for (const e of els.filter((x) => x.type === "line")) for (const k of ["x1", "y1", "x2", "y2"]) expect(typeof e.props[k], k).toBe("number");
    for (const e of els.filter((x) => x.type === "path")) expect(e.props.d).toMatch(/^M[\d.,\s-]+(L[\d.,\s-]+)*Z$/i);
  });

  it("five blocks of fixed heights that stack to 630; the first four end at the keep-clear line", () => {
    const blocks = by(els, "data-block");
    expect(blocks.map((b) => b.props["data-block"])).toEqual(["band", "rule", "sub-band", "body", "footer"]);
    const heights = blocks.map((b) => style(b).height as number);
    expect(heights).toEqual([L.band, L.rule, L.subBand, L.body, L.footer]);
    expect(heights.reduce((a, b) => a + b, 0)).toBe(630);
    expect(heights.slice(0, 4).reduce((a, b) => a + b, 0)).toBe(MATCHUP_CARD_KEEP_CLEAR_Y);
    // The blocks are the root's only children, in a column.
    const root = els[0];
    expect(style(root)).toMatchObject({ display: "flex", flexDirection: "column", width: "100%", height: "100%" });
    expect((root.props.children as unknown[]).flat().filter(Boolean)).toEqual(blocks);
  });

  it("the band: each half 600 wide in its team's card colour, the upper-cased name in the pixel font at the model's size, the record under it", () => {
    for (const side of ["away", "home"] as const) {
      const b = m.band[side];
      const half = one(els, "data-band-half", side);
      expect(style(half)).toMatchObject({ width: 600, height: 76, backgroundColor: b.color, color: b.textColor, padding: "0 40px" });
      expect(style(half).alignItems).toBe(side === "home" ? "flex-end" : "flex-start");
      const name = one(els, "data-band-name", side);
      expect(text(name)).toBe(b.name);
      expect(text(name)).toBe(text(name).toUpperCase());
      expect(style(name)).toMatchObject({ fontFamily: PIXEL, fontSize: b.nameSize, width: 520, height: 32, whiteSpace: "nowrap", overflow: "hidden" });
      // Right-aligned on the home half only while the name fits its box; else its start is kept.
      const fits = b.name.length * b.nameSize <= 520;
      expect(style(name).justifyContent).toBe(side === "home" && fits ? "flex-end" : "flex-start");
      const meta = one(els, "data-band-meta", side);
      expect(text(meta)).toBe(b.meta);
      expect(style(meta)).toMatchObject({ fontSize: 16, opacity: 0.92, marginTop: 1 });
    }
    expect(m.band.away.color).toBe(m.colours.away);
    expect(m.band.home.color).toBe(m.colours.home);
  });

  it("the 5 px rule: two 600 px halves in each team's colour not in use", () => {
    expect(style(one(els, "data-rule", "away"))).toMatchObject({ width: 600, height: 5, backgroundColor: m.colours.awayRule });
    expect(style(one(els, "data-rule", "home"))).toMatchObject({ width: 600, height: 5, backgroundColor: m.colours.homeRule });
  });

  it("the seam box: AT or VS in the pixel font, white on ink, centred on the seam", () => {
    const seam = one(els, "data-seam");
    expect(text(seam)).toBe(m.hasGame ? "AT" : "VS");
    expect(text(seam)).toBe(m.band.seam);
    expect(style(seam)).toMatchObject({
      position: "absolute", left: 568, top: 11, width: 64, height: 54, borderRadius: 4, border: "3px solid #FFFFFF",
      backgroundColor: "#0F172A", color: "#FFFFFF", fontFamily: PIXEL, fontSize: 16,
    });
    expect((style(seam).left as number) + (style(seam).width as number) / 2).toBe(600);
  });

  it("the sub-band: K3 on the left, K4 in the middle unless the game is a playoff game, the site name on the right", () => {
    const sub = by(els, "data-block", "sub-band")[0];
    expect(style(sub)).toMatchObject({ backgroundColor: "#F8FAFC", borderBottom: "1px solid #E2E8F0", padding: "0 40px", justifyContent: "space-between", alignItems: "center" });
    const line = one(els, "data-sub-line");
    expect(text(line)).toBe(m.subLine);
    expect(style(line)).toMatchObject({ fontSize: 15, color: "#475569", whiteSpace: "nowrap", overflow: "hidden", maxWidth: m.showHowTo ? L.subLineMaxWidth : L.subLineMaxWidthAlone });
    const howTo = by(els, "data-how-to");
    expect(howTo).toHaveLength(m.showHowTo ? 1 : 0);
    if (m.showHowTo) {
      expect(text(howTo[0])).toBe(MATCHUP_CARD_HOW_TO);
      expect(style(howTo[0])).toMatchObject({ fontSize: 15, color: "#475569", whiteSpace: "nowrap" });
    }
    const site = one(els, "data-sub-site");
    expect(text(site)).toBe(MATCHUP_CARD_SITE_NAME);
    expect(style(site)).toMatchObject({ fontFamily: PIXEL, fontSize: 10, color: "#64748B" });
    expect(text(sub)).toBe(`${m.subLine}${m.showHowTo ? MATCHUP_CARD_HOW_TO : ""}${MATCHUP_CARD_SITE_NAME}`);
  });

  it("the body: pane, divider, pane; each pane a 34 px legend row over a 599×363 area", () => {
    const body = by(els, "data-block", "body")[0];
    const kids = (body.props.children as El[]).filter(Boolean);
    expect(kids.map((k) => k.props["data-pane"] ?? (k.props["data-divider"] !== undefined ? "divider" : "?"))).toEqual(["0", "divider", "1"]);
    expect(style(kids[1])).toMatchObject({ width: 2, marginTop: 14, marginBottom: 10, backgroundColor: "#E2E8F0" });
    for (const n of ["0", "1"]) {
      const pane = one(els, "data-pane", n);
      expect(style(pane)).toMatchObject({ width: 599, height: 397, flexDirection: "column" });
      const inner = flatten(pane);
      expect(style(one(inner, "data-legend-row"))).toMatchObject({ height: 34, alignItems: "center", justifyContent: "center" });
      const area = one(inner, "data-radar-area");
      expect(style(area)).toMatchObject({ width: 599, height: 363 });
    }
    expect(599 + 2 + 599).toBe(1200);
  });

  it("each pane's legend row: the offense's solid sample and words, 'over', the defense's dashed sample with its square, in the two card colours", () => {
    m.panes.forEach((p, n) => {
      const row = flatten(one(flatten(one(els, "data-pane", String(n))), "data-legend-row"));
      expect(text(one(row, "data-legend-off"))).toBe(`${p.offId} offense`);
      expect(text(one(row, "data-legend-over"))).toBe("over");
      expect(text(one(row, "data-legend-def"))).toBe(`${p.defId} defense`);
      expect(style(one(row, "data-legend-off"))).toMatchObject({ fontSize: 19, color: "#0F172A", marginLeft: 8 });
      expect(style(one(row, "data-legend-def"))).toMatchObject({ fontSize: 19, color: "#0F172A", marginLeft: 8 });
      expect(style(one(row, "data-legend-over"))).toMatchObject({ fontSize: 15, color: "#64748B", margin: "0 12px" });
      const off = flatten(one(row, "data-legend-sample", "off"));
      const def = flatten(one(row, "data-legend-sample", "def"));
      expect(off[0].props).toMatchObject({ width: 46, height: 14 });
      expect(off.find((e) => e.type === "line")!.props).toMatchObject({ stroke: p.offColor, strokeWidth: 4, strokeDasharray: undefined });
      expect(off.find((e) => e.type === "circle")!.props).toMatchObject({ r: 5.5, fill: p.offColor });
      expect(def.find((e) => e.type === "line")!.props).toMatchObject({ stroke: p.defColor, strokeWidth: 4, strokeDasharray: "8,5" });
      expect(def.find((e) => e.type === "path")!.props).toMatchObject({ fill: "#FFFFFF", stroke: p.defColor });
    });
    // A team's colour is the same in both panes.
    expect([m.panes[0].offColor, m.panes[1].defColor]).toEqual([m.colours.away, m.colours.away]);
    expect([m.panes[0].defColor, m.panes[1].offColor]).toEqual([m.colours.home, m.colours.home]);
  });

  it("the footer: K5 and the site line, right-aligned, on the panel colour", () => {
    const footer = by(els, "data-block", "footer")[0];
    expect(style(footer)).toMatchObject({
      flexDirection: "column", alignItems: "flex-end", padding: "14px 40px 0", backgroundColor: "#F8FAFC", borderTop: "1px solid #E2E8F0",
    });
    const k5 = one(els, "data-legend-line");
    expect(text(k5)).toBe(m.legendLine);
    expect(style(k5)).toMatchObject({ fontSize: 15, color: "#64748B", whiteSpace: "nowrap" });
    const site = one(els, "data-site");
    expect(text(site)).toBe(RADAR_CARD_SITE_LINE);
    expect(style(site)).toMatchObject({ fontFamily: PIXEL, fontSize: 10, color: "#94A3B8", marginTop: 12 });
    expect(text(footer)).toBe(`${m.legendLine}${RADAR_CARD_SITE_LINE}`);
  });

  it("the colour allow-list: every colour in the tree is a fixed neutral, a card colour (plain or tinted 14 / 22), a rule colour or the ring colour", () => {
    const c = m.colours;
    const allowed = new Set([
      ...NEUTRALS, c.away, c.home, c.awayRule, c.homeRule, c.ring,
      `${c.away}14`, `${c.away}22`, `${c.home}14`, `${c.home}22`,
    ].map((x) => x.toUpperCase()));
    const seen = new Set<string>();
    for (const e of els) {
      for (const colour of coloursOf(e)) {
        seen.add(colour);
        expect(allowed.has(colour), `${colour} on <${String(e.type)}> "${text(e).slice(0, 30)}"`).toBe(true);
      }
    }
    // The list is exercised: both card colours and the ring were found.
    expect(seen.has(c.away) && seen.has(c.home)).toBe(true);
    if (m.panes.some((p) => p.drawn)) expect(seen.has(c.ring)).toBe(true);
  });

  it("the middle ring's colour is the colour rule's, and K5's word names it", () => {
    const rings = by(els, "data-ring", "mid");
    expect(rings).toHaveLength(m.panes.filter((p) => p.drawn).length);
    for (const ring of rings) expect(ring.props.stroke).toBe(m.colours.ring);
    expect([MATCHUP_RING_AMBER, MATCHUP_RING_GREY]).toContain(m.colours.ring);
    expect(m.legendLine).toContain(m.colours.ring === MATCHUP_RING_GREY ? ", grey dotted ring" : ", amber dotted ring");
  });

  it("fonts: the two the team radar image registers, and nothing else; nothing is bold", () => {
    const families = new Set(els.map((e) => style(e).fontFamily).filter(Boolean));
    expect(Array.from(families).sort()).toEqual([PIXEL, SANS].sort());
    expect(style(els[0]).fontFamily).toBe(SANS);
    for (const e of els) expect(style(e).fontWeight).toBeUndefined();
  });
});

describe("the named pairs' colours on the picture (spec §5.5)", () => {
  it("BUF at LA: Buffalo's blue, LA in darkened gold on a blue rule, the grey ring", () => {
    const m = card("BUF", "LA");
    const els = flatten(matchupCardImage(m));
    expect([m.colours.away, m.colours.home, m.colours.ring]).toEqual(["#00338D", "#CC8200", "#94A3B8"]);
    expect(style(one(els, "data-band-half", "home")).backgroundColor).toBe("#CC8200");
    expect(style(one(els, "data-rule", "home")).backgroundColor).toBe("#003594");
    expect(style(one(els, "data-rule", "away")).backgroundColor).toBe("#C60C30");
    expect(els.flatMap(coloursOf)).not.toContain("#D50A0A");
  });

  it("ARI at TB: Tampa Bay in orange with its own red as its 5 px rule, and that is the only red on the card", () => {
    const m = card("ARI", "TB");
    const els = flatten(matchupCardImage(m));
    expect(m.colours.homeRule).toBe("#D50A0A");
    expect([m.colours.away, m.colours.home]).not.toContain("#D50A0A");
    const red = els.filter((e) => coloursOf(e).includes("#D50A0A"));
    expect(red).toHaveLength(1);
    expect(red[0].props["data-rule"]).toBe("home");
  });

  it("TB at DAL: red is Tampa Bay's own colour, so it is on the card as that team's line", () => {
    const m = card("TB", "DAL");
    const els = flatten(matchupCardImage(m));
    expect([m.colours.away, m.colours.home, m.colours.ring]).toEqual(["#D50A0A", "#041E42", "#F59E0B"]);
    expect(one(flatten(one(els, "data-pane", "0")), "data-outline", "off").props.stroke).toBe("#D50A0A");
    expect(one(flatten(one(els, "data-pane", "1")), "data-outline", "def").props.stroke).toBe("#D50A0A");
  });

  it("KC vs TB: VS on the seam, the away team in its darkened gold", () => {
    const m = card("KC", "TB", { game: null });
    const els = flatten(matchupCardImage(m));
    expect(text(one(els, "data-seam"))).toBe("VS");
    expect([m.colours.away, m.colours.home]).toEqual(["#BF8A15", "#D50A0A"]);
    expect(text(one(els, "data-sub-line"))).toBe("No 2026 game between these teams · 2026 through Week 3");
  });
});

describe("the radar (spec §6.4)", () => {
  const m = card("BUF", "LA");
  const els = flatten(matchupCardImage(m));
  const radar = (n: number) => flatten(one(flatten(one(els, "data-pane", String(n))), "data-radar"));
  const dist = (x: number, y: number) => Math.hypot(x - G.cx, y - G.cy);
  const firstPoint = (d: unknown) => String(d).slice(1).split(/[ L]/)[0].split(",").map(Number) as [number, number];

  it("one svg of the pane's size, under the labels", () => {
    for (const n of [0, 1]) {
      // radar(n)[0] is the box itself; its first child is the svg.
      const svg = radar(n)[1];
      expect(svg.type).toBe("svg");
      expect(radar(n).filter((e) => e.type === "svg" && e.props["data-mark"] === undefined)).toHaveLength(1);
      expect(svg.props).toMatchObject({ width: 599, height: 363, viewBox: "0 0 599 363" });
    }
  });

  it("the three rings: outer at r, the dotted middle ring at the middle score, the white hub ring", () => {
    for (const n of [0, 1]) {
      const r = radar(n);
      const outer = one(r, "data-ring", "outer");
      const mid = one(r, "data-ring", "mid");
      const hub = one(r, "data-ring", "hub");
      expect(outer.props).toMatchObject({ fill: "none", stroke: "#E2E8F0", strokeWidth: 1.5 });
      expect(mid.props).toMatchObject({ fill: "none", strokeWidth: 1.5, strokeDasharray: "5,3" });
      expect(hub.props).toMatchObject({ fill: "#FFFFFF", stroke: "#E2E8F0", strokeWidth: 1.1 });
      expect(dist(...firstPoint(outer.props.d))).toBeCloseTo(G.r, 1);
      expect(dist(...firstPoint(mid.props.d))).toBeCloseTo(G.r * radarRadius(RADAR_MID_SCORE), 1);
      expect(dist(...firstPoint(hub.props.d))).toBeCloseTo(G.r * RADAR_HUB, 1);
    }
  });

  it("the only lines are the seven spokes, each from the hub ring to the outer ring: no line joins an offense vertex to a defense vertex (no gap bar)", () => {
    for (const n of [0, 1]) {
      const lines = radar(n).filter((e) => e.type === "line");
      expect(lines).toHaveLength(7);
      for (const l of lines) {
        expect(l.props["data-spoke"]).toBeDefined();
        expect(l.props).toMatchObject({ stroke: "#EEF2F7", strokeWidth: 1.1 });
        // Coordinates are written to a tenth of a pixel.
        expect(Math.abs(dist(l.props.x1 as number, l.props.y1 as number) - G.r * RADAR_HUB)).toBeLessThan(0.1);
        expect(Math.abs(dist(l.props.x2 as number, l.props.y2 as number) - G.r)).toBeLessThan(0.1);
      }
      // Nothing else in the svg is a stroke between two points: paths are the rings, the two outlines and the square markers.
      // (the chart's own svg: the labels' marks are separate little svgs)
      const paths = flatten(radar(n)[1]).filter((e) => e.type === "path");
      expect(paths.every((p) => p.props["data-ring"] || p.props["data-outline"] || p.props["data-marker"])).toBe(true);
      expect(radar(n).filter((e) => e.props["data-gap"] !== undefined)).toHaveLength(0);
    }
  });

  it("drawn in order: rings, spokes, the dashed defense outline, the solid offense outline, the square markers, the round dots", () => {
    for (const n of [0, 1]) {
      const p = drawnPane(m.panes[n]);
      const r = radar(n);
      const def = one(r, "data-outline", "def");
      const off = one(r, "data-outline", "off");
      const markers = by(r, "data-marker", "def");
      const dots = by(r, "data-dot", "off");
      const order = [one(r, "data-ring", "outer"), one(r, "data-ring", "mid"), one(r, "data-ring", "hub"), by(r, "data-spoke")[0], def, off, markers[0], dots[0]].map((e) => r.indexOf(e));
      expect(order).toEqual([...order].sort((a, b) => a - b));
      expect(def.props).toMatchObject({ fill: `${p.defColor}14`, stroke: p.defColor, strokeWidth: 3, strokeDasharray: "8,5", strokeLinejoin: "round" });
      expect(off.props).toMatchObject({ fill: `${p.offColor}22`, stroke: p.offColor, strokeWidth: 3.4, strokeLinejoin: "round" });
      expect(off.props.strokeDasharray).toBeUndefined();
      expect(markers.every((e) => e.type === "path")).toBe(true);
      expect(dots.every((e) => e.type === "circle")).toBe(true);
      for (const e of markers) expect(e.props).toMatchObject({ fill: "#FFFFFF", stroke: p.defColor, strokeWidth: 2.6 });
      for (const e of dots) expect(e.props).toMatchObject({ r: 6, fill: p.offColor, stroke: "#FFFFFF", strokeWidth: 1.3 });
    }
  });

  it("every vertex is the model's: a dot per offense vertex, an 11 px square per defense vertex, the outlines through them", () => {
    for (const n of [0, 1]) {
      const p = drawnPane(m.panes[n]);
      const r = radar(n);
      const dots = by(r, "data-dot", "off");
      expect(dots).toHaveLength(p.off.length);
      dots.forEach((e, i) => {
        expect(e.props.cx).toBeCloseTo(p.off[i].x, 1);
        expect(e.props.cy).toBeCloseTo(p.off[i].y, 1);
      });
      const markers = by(r, "data-marker", "def");
      expect(markers).toHaveLength(p.def.length);
      markers.forEach((e, i) => {
        const pts = String(e.props.d).replace(/Z$/, "").slice(1).split(/ ?L/).map((q) => q.split(",").map(Number));
        expect(pts).toHaveLength(4);
        expect(pts[0][0]).toBeCloseTo(p.def[i].x - 5.5, 1);
        expect(pts[0][1]).toBeCloseTo(p.def[i].y - 5.5, 1);
        expect(pts[2][0]).toBeCloseTo(p.def[i].x + 5.5, 1);
        expect(pts[2][1]).toBeCloseTo(p.def[i].y + 5.5, 1);
      });
      const outline = (unit: "off" | "def") => String(one(r, "data-outline", unit).props.d).replace(/Z$/, "").slice(1).split(/ ?L/).map((q) => q.split(",").map(Number));
      expect(outline("off")).toEqual(p.off.map((v) => [Number(v.x.toFixed(1)), Number(v.y.toFixed(1))]));
      expect(outline("def")).toEqual(p.def.map((v) => [Number(v.x.toFixed(1)), Number(v.y.toFixed(1))]));
    }
  });

  it("a missing spoke: no dot there, the outline bridges it, and its label line is a dash", () => {
    const missing = card("BUF", "LA", { rows: rowsMissingSpokes("BUF") });
    const p = drawnPane(missing.panes[0]);
    expect(p.off.map((v) => v.key)).toEqual(["expl_pass", "pass_sr", "sack", "rush_sr", "expl_rush"]);
    const r = flatten(one(flatten(one(flatten(matchupCardImage(missing)), "data-pane", "0")), "data-radar"));
    expect(by(r, "data-dot", "off")).toHaveLength(5);
    expect(by(r, "data-marker", "def")).toHaveLength(7);
    expect(String(one(r, "data-outline", "off").props.d).split("L")).toHaveLength(5);
    const label = flatten(one(r, "data-label", "to"));
    expect(text(one(label, "data-label-row", "off"))).toBe("—");
    expect(text(one(label, "data-label-row", "def"))).toMatch(/% · /);
  });

  it("an outline needs three vertices: with two, the dots are drawn and no outline", () => {
    const base = card("BUF", "LA");
    const p = drawnPane(base.panes[0]);
    const two: CardModel = { ...base, panes: [{ ...p, off: p.off.slice(0, 2) }, base.panes[1]] };
    const r = flatten(one(flatten(one(flatten(matchupCardImage(two)), "data-pane", "0")), "data-radar"));
    expect(by(r, "data-outline", "off")).toHaveLength(0);
    expect(by(r, "data-dot", "off")).toHaveLength(2);
    expect(by(r, "data-outline", "def")).toHaveLength(1);
  });
});

describe("the spoke labels (spec §6.4)", () => {
  const ALIGN = { start: "flex-start", center: "center", end: "flex-end" } as const;

  it.each(Object.keys(CASES))("%s: seven per drawn pane, divs over the svg at the model's boxes, each a 60 px column of three rows 18 / 21 / 21", (name) => {
    const m = CASES[name]();
    const els = flatten(matchupCardImage(m));
    m.panes.forEach((pane, n) => {
      const paneEls = flatten(one(els, "data-pane", String(n)));
      const labels = by(paneEls, "data-label");
      if (!pane.drawn) {
        expect(labels).toHaveLength(0);
        return;
      }
      expect(labels.map((l) => l.props["data-label"])).toEqual(pane.labels.map((l) => l.key));
      // Direct children of the box the svg sits in, after the svg.
      const radarKids = (one(paneEls, "data-radar").props.children as unknown[]).flat().filter(Boolean) as El[];
      expect(radarKids[0].type).toBe("svg");
      expect(radarKids.slice(1)).toEqual(labels);
      labels.forEach((el, i) => {
        const want = pane.labels[i];
        expect(el.type).toBe("div");
        expect(style(el)).toMatchObject({
          position: "absolute", flexDirection: "column", height: 60, overflow: "hidden",
          left: want.box.left, top: want.box.top, width: want.box.width,
        });
        const rows = (el.props.children as El[]).filter(Boolean);
        expect(rows.map((r) => style(r).height)).toEqual([18, 21, 21]);
        for (const r of rows) {
          expect(style(r)).toMatchObject({ display: "flex", alignItems: "center", justifyContent: ALIGN[want.box.align], whiteSpace: "nowrap" });
        }
        const [nameRow, offRow, defRow] = rows;
        expect(nameRow.props["data-label-name"]).toBeDefined();
        expect(text(nameRow)).toBe(want.name);
        expect(style(nameRow)).toMatchObject({ fontSize: 14, color: "#475569" });
        expect([offRow.props["data-label-row"], defRow.props["data-label-row"]]).toEqual(["off", "def"]);
        expect(text(offRow)).toBe(want.offLine);
        expect(text(defRow)).toBe(want.defLine);
        for (const [row, unit, colour] of [[offRow, "off", pane.offColor], [defRow, "def", pane.defColor]] as const) {
          const inner = flatten(row.props.children);
          const mark = one(inner, "data-mark", unit);
          expect(mark.type).toBe("svg");
          expect(mark.props).toMatchObject({ width: 11, height: 11 });
          const drawing = flatten(mark.props.children)[0];
          if (unit === "off") expect(drawing.props).toMatchObject({ fill: colour });
          else expect(drawing.props).toMatchObject({ fill: "#FFFFFF", stroke: colour, strokeWidth: 2.5 });
          expect(drawing.type).toBe(unit === "off" ? "circle" : "path");
          // The numbers are always ink; only the mark carries the team colour.
          const words = one(inner, "data-label-text");
          expect(style(words)).toMatchObject({ fontSize: 17, color: "#0F172A", lineHeight: 1, marginLeft: 6 });
        }
      });
    });
  });

  it("the worst case prints as it is: every line 100.0% · T-32nd", () => {
    const base = card("BUF", "LA");
    const worst: CardModel = {
      ...base,
      panes: base.panes.map((p) => (p.drawn ? { ...p, labels: p.labels.map((l) => ({ ...l, offLine: "100.0% · T-32nd", defLine: "100.0% · T-32nd" })) } : p)) as CardModel["panes"],
    };
    const rows = by(flatten(matchupCardImage(worst)), "data-label-row");
    expect(rows).toHaveLength(28);
    for (const r of rows) expect(text(r)).toBe("100.0% · T-32nd");
  });
});

describe("a pane that cannot be drawn (spec §6.5)", () => {
  it("keeps its legend row and prints its sentence in place of the radar; the other pane still draws", () => {
    const m = card("BUF", "LA", { rows: rowsUndrawn("BUF") });
    expect(m.panes[0].drawn).toBe(false);
    const els = flatten(matchupCardImage(m));
    const pane = flatten(one(els, "data-pane", "0"));
    expect(text(one(pane, "data-legend-row"))).toBe("BUF offenseoverLA defense");
    expect(pane.filter((e) => e.type === "svg" && e.props["data-legend-sample"] === undefined)).toHaveLength(0);
    expect(by(pane, "data-radar")).toHaveLength(0);
    const message = one(pane, "data-pane-message");
    expect(text(message)).toBe(MATCHUP_NO_OVERLAY_NOTE);
    expect(style(message)).toMatchObject({ width: 460, fontSize: 18, color: "#475569", textAlign: "center", justifyContent: "center" });
    expect(style(one(pane, "data-radar-area"))).toMatchObject({ width: 599, height: 363, alignItems: "center", justifyContent: "center" });
    const other = flatten(one(els, "data-pane", "1"));
    expect(by(other, "data-label")).toHaveLength(7);
    expect(by(other, "data-pane-message")).toHaveLength(0);
  });
});

describe.each(Object.entries(PLATES))("the plate: %s (spec §7)", (_name, build) => {
  const p = build();
  const tree = matchupPlateImage(p);
  const els = flatten(tree);

  it("Satori's rules hold: flex divs only, no svg at all, nothing undefined", () => {
    for (const e of els) {
      expect(e.type).toBe("div");
      expect(style(e).display).toBe("flex");
    }
    expect(text(tree)).not.toMatch(/NaN|undefined|null|\[object/);
  });

  it("the card's five blocks at the card's heights, the body replaced by one message block", () => {
    const blocks = by(els, "data-block");
    expect(blocks.map((b) => b.props["data-block"])).toEqual(["band", "rule", "sub-band", "message", "footer"]);
    const heights = blocks.map((b) => style(b).height as number);
    expect(heights).toEqual([76, 5, 32, 397, 120]);
    expect(heights.reduce((a, b) => a + b, 0)).toBe(630);
  });

  it("the band, the seam and the rule are the card's own drawing for the same band model", () => {
    const asCardModel = { ...card("BUF", "HOU"), band: p.band, colours: p.colours, hasGame: p.hasGame };
    const cardEls = flatten(matchupCardImage(asCardModel));
    for (const block of ["band", "rule"]) {
      expect(shape(by(els, "data-block", block)[0])).toEqual(shape(by(cardEls, "data-block", block)[0]));
    }
    expect(text(one(els, "data-seam"))).toBe(p.hasGame ? "AT" : "VS");
    expect(text(one(els, "data-band-name", "away"))).toBe("BUFFALO BILLS");
    expect(style(one(els, "data-band-half", "home")).backgroundColor).toBe(p.colours.home);
  });

  it("the sub-band: the season text only and the site name; no game line, no K4", () => {
    const sub = by(els, "data-block", "sub-band")[0];
    expect(style(sub)).toMatchObject({ backgroundColor: "#F8FAFC", borderBottom: "1px solid #E2E8F0", padding: "0 40px" });
    expect(text(one(els, "data-sub-line"))).toBe(matchupCardSeasonLine(p.season, p.throughWeek));
    expect(text(sub)).toBe(`${matchupCardSeasonLine(p.season, p.throughWeek)}${MATCHUP_CARD_SITE_NAME}`);
    expect(by(els, "data-how-to")).toHaveLength(0);
    expect(text(sub)).not.toMatch(/Week 5|game between|Each label/);
  });

  it("the message block: the sentence, once, centred in a 900 px box on white; no legend row, no divider", () => {
    const block = by(els, "data-block", "message")[0];
    expect(style(block)).toMatchObject({ alignItems: "center", justifyContent: "center", backgroundColor: "#FFFFFF" });
    const message = one(els, "data-plate-message");
    expect(text(message)).toBe(p.message);
    expect(text(block)).toBe(p.message);
    expect(style(message)).toMatchObject({ width: 900, fontSize: 26, color: "#475569", textAlign: "center", justifyContent: "center" });
    expect(by(els, "data-legend-row")).toHaveLength(0);
    expect(by(els, "data-divider")).toHaveLength(0);
    expect(by(els, "data-pane")).toHaveLength(0);
  });

  it("the footer: the site line only, where the card has it; no K5", () => {
    const footer = by(els, "data-block", "footer")[0];
    expect(style(footer)).toMatchObject({ alignItems: "flex-end", backgroundColor: "#F8FAFC", borderTop: "1px solid #E2E8F0" });
    expect(text(footer)).toBe(RADAR_CARD_SITE_LINE);
    expect(style(one(els, "data-site"))).toMatchObject({ fontFamily: PIXEL, fontSize: 10, color: "#94A3B8" });
    expect(by(els, "data-legend-line")).toHaveLength(0);
  });

  it("the colour allow-list holds on the plate too", () => {
    const c = p.colours;
    const allowed = new Set([...NEUTRALS, c.away, c.home, c.awayRule, c.homeRule].map((x) => x.toUpperCase()));
    for (const e of els) for (const colour of coloursOf(e)) expect(allowed.has(colour), colour).toBe(true);
  });
});

describe("the plates' sentences", () => {
  it("are the page's own", () => {
    expect(PLATES["small-pool"]().message).toBe(MATCHUP_SMALL_POOL_NOTE);
    expect(PLATES.uncovered().message).toBe("Team matchups start with the 2026 season");
    expect(PLATES["neither pane drawn"]().message).toBe(MATCHUP_NO_OVERLAY_NOTE);
  });
});

describe("the file keeps Satori's rules, and shares the fonts", () => {
  const source = readFileSync(join(process.cwd(), "lib", "og", "matchup-card-image.tsx"), "utf8");
  const code = source.replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, "").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

  it("reads no font itself and takes the two family names from the radar image", () => {
    expect(source).not.toMatch(/readFile|\.ttf/);
    expect(source).toMatch(/import \{ PIXEL, SANS \} from "@\/lib\/og\/team-radar-image"/);
  });

  it("no svg text, rect or polygon, no grid, no className, no img", () => {
    expect(code).not.toMatch(/<text|<polygon|<rect|<img|display: "grid"|className=/);
  });

  it("no red of its own and no gap bar: the only colours written in the file are the eight neutrals", () => {
    const hexes = Array.from(new Set((code.match(/#[0-9a-fA-F]{6}\b/g) ?? []).map((h) => h.toUpperCase()))).sort();
    expect(hexes).toEqual([...NEUTRALS].sort());
    expect(code).not.toMatch(/rgba?\(/);
  });

  it("imports nothing from lib/data: it draws the model and nothing else", () => {
    const specs = Array.from(source.matchAll(/from\s+["']([^"']+)["']/g)).map((x) => x[1]);
    expect(specs.sort()).toEqual(["@/lib/og/team-radar-image", "@/lib/stats/matchup-card", "@/lib/stats/team-radar"]);
  });
});
