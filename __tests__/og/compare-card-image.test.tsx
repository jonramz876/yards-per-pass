import { describe, it, expect, vi } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { ReactElement } from "react";
import { compareCardImage, comparePlateImage } from "@/lib/og/compare-card-image";
import { PIXEL, SANS, radarImageFonts } from "@/lib/og/team-radar-image";
import type { CompareGroup, ComparePlayerRow } from "@/lib/stats/compare";
import {
  CARD_STAT_KEYS, COMPARE_CARD_KEEP_CLEAR_Y, COMPARE_CARD_LAYOUT as L, buildCompareCard, compareNoStatsMessage,
  type CompareCardModel,
} from "@/lib/stats/compare-card";
// Real 2026 season rows through Week 4 (see the file's _provenance line).
import rowsJson from "../stats/fixtures/compare-2026-w4-rows.json";

// lib/og/compare-card-image.tsx (compare card spec 2026-10-09 §3, PR 2): the
// 1200×630 picture. @vercel/og cannot render under vitest on Windows, so these
// tests read the element tree the renderer is given: what Satori accepts, and
// that every number and sentence on the picture is the model's. The real PNGs
// were rendered and looked at separately (spec §16).

type Row = Record<string, unknown>;
type El = ReactElement<Record<string, unknown>>;
const TABLES: Record<CompareGroup, Row[]> = { QB: rowsJson.qb as Row[], WR: rowsJson.receivers as Row[], RB: rowsJson.rb as Row[] };
const row = (table: Row[], short: string) => {
  const hits = table.filter((r) => r.player_name === short);
  expect(hits, short).toHaveLength(1);
  return hits[0] as unknown as ComparePlayerRow;
};
type Who = [short: string, full: string, slug: string];
const model = (group: CompareGroup, a: Who, b: Who, table: Row[] = TABLES[group], week: number | null = 4): CompareCardModel =>
  buildCompareCard({
    group, a: { slug: a[2], fullName: a[1], row: row(table, a[0]) }, b: { slug: b[2], fullName: b[1], row: row(table, b[0]) },
    all: table as unknown as ComparePlayerRow[], season: 2026, throughWeek: week,
  });

const ALLEN: Who = ["J.Allen", "Josh Allen", "josh-allen"];
const STAFFORD: Who = ["M.Stafford", "Matthew Stafford", "matthew-stafford"];
const LAMB: Who = ["C.Lamb", "CeeDee Lamb", "ceedee-lamb"];
const JSN: Who = ["J.Smith-Njigba", "Jaxon Smith-Njigba", "jaxon-smith-njigba"];
const BIJAN: Who = ["Bi.Robinson", "Bijan Robinson", "bijan-robinson"];
const GIBBS: Who = ["J.Gibbs", "Jahmyr Gibbs", "jahmyr-gibbs"];
const MCBRIDE: Who = ["T.McBride", "Trey McBride", "trey-mcbride"];
const HUNTLEY: Who = ["T.Huntley", "Tyler Huntley", "tyler-huntley"];
const MVS: Who = ["M.Valdes-Scantling", "Marquez Valdes-Scantling", "marquez-valdes-scantling"];
// A 34-character name (one more than fits) against a 33-character one (the longest that fits).
const LONG_A: Who = ["M.Valdes-Scantling", "Dorian Thompson-Robinson The Third", "x"];
const LONG_B: Who = ["O.Zaccheaus", "Marquez Valdes-Scantling-Longname", "y"];
const WITH_THREE_MISSING = TABLES.WR.map((r) => (r.player_name === "M.Valdes-Scantling" ? { ...r, croe: null } : r));
const ONLY_TWO_QBS = TABLES.QB.filter((r) => ["J.Allen", "T.Huntley"].includes(r.player_name as string));

const CASES: Record<string, () => CompareCardModel> = {
  "Allen vs Stafford (QB, 7 axes)": () => model("QB", ALLEN, STAFFORD),
  "Lamb vs Smith-Njigba (WR, YPRR missing)": () => model("WR", LAMB, JSN),
  "Robinson vs Gibbs (RB)": () => model("RB", BIJAN, GIBBS),
  "Lamb vs McBride (WR vs TE)": () => model("WR", LAMB, MCBRIDE),
  "Huntley vs Allen (under the line)": () => model("QB", HUNTLEY, ALLEN),
  "long names": () => model("WR", LONG_A, LONG_B, TABLES.WR, 18),
  "one outline left out": () => model("WR", MVS, LAMB, WITH_THREE_MISSING),
  "too few qualified players": () => model("QB", ALLEN, HUNTLEY, ONLY_TWO_QBS),
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

describe.each(Object.entries(CASES))("what Satori is given: %s", (_name, build) => {
  const m = build();
  const els = flatten(compareCardImage(m));

  it("plain elements only: div, svg, path, line, circle. No components, no fragments, no svg text, no polygon", () => {
    for (const e of els) expect(["div", "svg", "path", "line", "circle"], String(e.type)).toContain(e.type);
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
        if (typeof value === "string") expect(value, `style ${key}`).not.toMatch(/NaN|undefined/);
      }
    }
    expect(text(compareCardImage(m))).not.toMatch(/NaN|undefined|null|\[object/);
  });

  it("svg coordinates are plain numbers", () => {
    for (const e of els.filter((x) => x.type === "circle")) {
      for (const k of ["cx", "cy", "r"]) expect(typeof e.props[k], k).toBe("number");
    }
    for (const e of els.filter((x) => x.type === "line")) {
      for (const k of ["x1", "y1", "x2", "y2"]) expect(typeof e.props[k], k).toBe("number");
    }
    for (const e of els.filter((x) => x.type === "path")) expect(e.props.d).toMatch(/^M[\d.,\s-]+(L[\d.,\s-]+)*Z?$/i);
  });

  it("the blocks have fixed heights that stack to 630, and nothing a reader needs is below the keep-clear line", () => {
    const blocks = by(els, "data-block");
    expect(blocks.map((b) => b.props["data-block"])).toEqual(["band", "rule", "sub-band", "body", "strip", "footer"]);
    const heights = blocks.map((b) => style(b).height as number);
    expect(heights).toEqual([L.band, L.rule, L.subBand, L.body, L.strip, L.footer]);
    expect(heights.reduce((a, b) => a + b, 0)).toBe(630);
    expect(heights.slice(0, 5).reduce((a, b) => a + b, 0)).toBe(COMPARE_CARD_KEEP_CLEAR_Y);
    // The footer (below the line) holds the site line and nothing else.
    const footer = blocks[5];
    expect(text(footer)).toBe("YARDSPERPASS.COM · DATA: NFLVERSE");
  });

  it("the band: each half in its player's colour, his full name upper-cased in the pixel font, his meta line and his OVR", () => {
    for (const side of ["a", "b"] as const) {
      const p = m[side];
      const half = one(els, "data-band-half", side);
      expect(style(half).backgroundColor).toBe(p.color);
      expect(style(half).color).toBe(p.textColor);
      expect(style(half).width).toBe(600);
      const name = one(els, "data-band-name", side);
      expect(text(name)).toBe(p.fullName.toUpperCase());
      expect(style(name)).toMatchObject({ fontFamily: PIXEL, width: L.nameBox, whiteSpace: "nowrap", overflow: "hidden" });
      expect(text(one(els, "data-band-meta", side))).toBe(p.meta);
      expect(text(one(els, "data-ovr-value", side))).toBe(p.ovr === null ? "—" : String(p.ovr));
      expect(text(one(els, "data-ovr", side))).toMatch(/OVR$/);
    }
    expect(text(one(els, "data-vs"))).toBe("VS");
  });

  it("the sub-band: the model's line on the left, the site name on the right", () => {
    expect(text(one(els, "data-sub-band-line"))).toBe(m.subBandLine);
    expect(text(one(els, "data-sub-band-site"))).toBe("YARDSPERPASS.COM");
  });

  it("the table: seven rows, each the Compare page's own row, the better value (and only it) in the green pill", () => {
    const rowsEls = by(els, "data-row");
    expect(rowsEls.map((r) => r.props["data-row"])).toEqual([...CARD_STAT_KEYS[m.group]]);
    for (const [i, r] of Array.from(rowsEls.entries())) {
      const inner = flatten(r);
      const want = m.rows[i];
      const a = one(inner, "data-cell", "a");
      const b = one(inner, "data-cell", "b");
      expect([text(a), text(one(inner, "data-cell-label")), text(b)]).toEqual([want.a, want.label, want.b]);
      expect([a.props["data-win"], b.props["data-win"]]).toEqual([want.winner === 1 ? "true" : undefined, want.winner === 2 ? "true" : undefined]);
      for (const [cell, win] of [[a, want.winner === 1], [b, want.winner === 2]] as const) {
        const pill = flatten(cell)[1];
        expect(style(pill).backgroundColor).toBe(win ? "#dcfce7" : "#ffffff");
        // A visible edge, so the pill reads as a pill even beside a green player's line (Jets green);
        // the other cell has the same box in white, so the numbers stay aligned.
        expect(style(pill).border).toBe(win ? "1px solid #86efac" : "1px solid #ffffff");
        expect(style(pill).color).toBe(win ? "#166534" : "#0f172a");
        expect(style(pill).fontWeight).toBeUndefined();
      }
      expect(style(r).height).toBe(L.table.row);
    }
  });

  it("the table header: each player's name beside his line sample, solid for A and dashed for B, in his colour", () => {
    expect(text(one(els, "data-head-name", "a"))).toBe(m.a.headerName);
    expect(text(one(els, "data-head-name", "b"))).toBe(m.b.headerName);
    expect(text(one(els, "data-head-stat"))).toBe("STAT");
    const sample = (side: "a" | "b") => flatten(one(els, "data-line-sample", side)).find((e) => e.type === "line")!;
    expect(sample("a").props).toMatchObject({ stroke: m.a.color, strokeDasharray: undefined });
    expect(sample("b").props).toMatchObject({ stroke: m.b.color, strokeDasharray: "9,5" });
  });

  it("the strip: the small-sample line when there is one, else empty", () => {
    const strip = by(els, "data-block", "strip")[0];
    expect(text(strip)).toBe(m.stripLine ?? "");
    if (m.stripLine) expect(style(one(els, "data-strip-line"))).toMatchObject({ fontSize: 13, whiteSpace: "nowrap" });
  });

  it("fonts: the two the team radar image registers, and nothing else", () => {
    const families = new Set(els.map((e) => style(e).fontFamily).filter(Boolean));
    expect(Array.from(families).sort()).toEqual([PIXEL, SANS].sort());
  });
});

describe("the radar on the picture", () => {
  const dots = (els: El[], side: string) => by(els, "data-dot", side);
  const R = L.radar;
  const pct = (e: El) => (Math.hypot((e.props.cx as number) - R.cx, (e.props.cy as number) - R.cy) / R.r) * 100;

  it("A solid on top, B dashed behind: B's outline comes first in the svg and is the only dashed one", () => {
    const els = flatten(compareCardImage(model("QB", ALLEN, STAFFORD)));
    const a = one(els, "data-outline", "a");
    const b = one(els, "data-outline", "b");
    expect(els.indexOf(b)).toBeLessThan(els.indexOf(a));
    expect(b.props.strokeDasharray).toBe("9,5");
    expect(a.props.strokeDasharray).toBeUndefined();
    expect([a.props.stroke, b.props.stroke]).toEqual(["#00338D", "#dc2626"]);
  });

  it("every corner is at its percentile: the spec's Allen and Stafford numbers, read back from the dots", () => {
    const els = flatten(compareCardImage(model("QB", ALLEN, STAFFORD)));
    // Coordinates are written to a tenth of a pixel, so a dot is within 0.15 of a percentile point of its value.
    const near = (side: string, want: number[]) => {
      const got = dots(els, side).map(pct);
      expect(got).toHaveLength(want.length);
      got.forEach((v, i) => expect(Math.abs(v - want[i]), `${side}${i}: ${v}`).toBeLessThan(0.15));
    };
    near("a", [83.3, 81.0, 42.9, 88.1, 35.7, 42.9, 97.6]);
    near("b", [45.2, 31.0, 88.1, 83.3, 16.7, 47.6, 9.8]);
  });

  it("the dots are the model's values, for every case", () => {
    for (const build of Object.values(CASES)) {
      const m = build();
      if (!m.radarDrawn) continue;
      const els = flatten(compareCardImage(m));
      for (const side of ["a", "b"] as const) {
        const p = m.comparison[side];
        const want = p.outline ? p.values.filter((_, i) => !p.missing[i]) : [];
        const got = dots(els, side).map(pct);
        expect(got).toHaveLength(want.length);
        // Coordinates are written to one decimal: within a tenth of a pixel.
        got.forEach((v, i) => expect(Math.abs(v - want[i])).toBeLessThan(0.2));
      }
    }
  });

  // Code review M9: three things that could break with no other test failing.
  it("the outlines are see-through and the rings are not filled in: A's shape never hides B's or the rings", () => {
    const els = flatten(compareCardImage(model("QB", ALLEN, STAFFORD)));
    expect(one(els, "data-outline", "a").props.fill).toMatch(/^#[0-9a-fA-F]{6}1F$/);
    expect(one(els, "data-outline", "b").props.fill).toMatch(/^#[0-9a-fA-F]{6}1A$/);
    expect(one(els, "data-ring", "outer").props.fill).toBe("none");
    expect(one(els, "data-ring", "inner").props.fill).toBe("none");
    expect(one(els, "data-ring", "mid").props.fill).toMatch(/^rgba\(251,191,36,0\.0\d+\)$/);
  });

  it("the VS block on the seam does not cover either OVR badge", () => {
    const els = flatten(compareCardImage(model("QB", ALLEN, STAFFORD)));
    const vs = style(one(els, "data-vs")) as { left: number; width: number };
    const badgeA = style(one(els, "data-ovr", "a")) as { left: number; width: number };
    const badgeB = style(one(els, "data-ovr", "b")) as { left: number; width: number };
    // Badge positions are local to their 600 px half; the VS block's is card-wide.
    expect(badgeA.left + badgeA.width).toBeLessThanOrEqual(vs.left);
    expect(600 + badgeB.left).toBeGreaterThanOrEqual(vs.left + vs.width);
    expect(vs.left + vs.width / 2).toBe(600);
  });

  it("the legend line is the last thing in the radar pane, and the site line sits at the bottom right of the band under it", () => {
    const els = flatten(compareCardImage(model("QB", ALLEN, STAFFORD)));
    const legend = style(one(els, "data-legend")) as { top: number; height: number; position: string; left: number; width: number };
    expect(legend.position).toBe("absolute");
    expect(legend.top + legend.height).toBe(L.body);
    expect([legend.left, legend.width]).toEqual([0, L.pane]);
    const footer = style(by(els, "data-block", "footer")[0]);
    expect(footer).toMatchObject({ alignItems: "flex-end", justifyContent: "flex-end", height: L.footer });
  });

  it("a missing axis is a gap: no corner, no dot, and its label is grey only when neither player has it", () => {
    const m = model("WR", MVS, LAMB);
    const els = flatten(compareCardImage(m));
    expect(dots(els, "a")).toHaveLength(4); // no YAC/Rec, no YPRR
    expect(dots(els, "b")).toHaveLength(5); // no YPRR
    const label = (name: string) => one(els, "data-axis-label", name);
    expect(label("YPRR").props["data-axis-missing"]).toBe("true");
    expect(style(label("YPRR")).color).toBe("#cbd5e1");
    expect(label("YAC/Rec").props["data-axis-missing"]).toBeUndefined();
    expect(style(label("YAC/Rec")).color).toBe("#475569");
  });

  it("a quarterback's missing stat plots at the centre, as on his stat card", () => {
    const m = model("QB", ["M.Penix", "Michael Penix Jr.", "michael-penix"], ALLEN);
    const els = flatten(compareCardImage(m));
    expect(dots(els, "a")).toHaveLength(7);
    expect(pct(dots(els, "a")[6])).toBe(0);
  });

  it("a player with half his radar stats missing gets no outline and no dots; the line under the radar says so in the legend's place", () => {
    const m = model("WR", MVS, LAMB, WITH_THREE_MISSING);
    const els = flatten(compareCardImage(m));
    expect(by(els, "data-outline", "a")).toHaveLength(0);
    expect(dots(els, "a")).toHaveLength(0);
    expect(by(els, "data-outline", "b")).toHaveLength(1);
    expect(text(one(els, "data-legend"))).toBe("No outline for M.Valdes-Scantling: 3 of his 6 radar stats are not available.");
    // A label is grey when the only drawn player has no corner there.
    expect(one(els, "data-axis-label", "YPRR").props["data-axis-missing"]).toBe("true");
  });

  it("otherwise the line under the radar is the legend, and the dashed ring is at half the radius", () => {
    const els = flatten(compareCardImage(model("RB", BIJAN, GIBBS)));
    expect(text(one(els, "data-legend"))).toBe("Farther out = higher percentile · dashed ring = 50th percentile");
    const mid = one(els, "data-ring", "mid");
    const [x, y] = String(mid.props.d).slice(1).split(/[ L]/)[0].split(",").map(Number);
    expect(Math.hypot(x - R.cx, y - R.cy)).toBeCloseTo(R.r / 2, 0);
    expect(mid.props.strokeDasharray).toBe("5,3");
  });

  it("the axis labels are divs over the svg, one per axis, each inside the pane and above the legend line", () => {
    for (const m of [model("QB", ALLEN, STAFFORD), model("WR", LAMB, JSN)]) {
      const els = flatten(compareCardImage(m));
      const labels = by(els, "data-axis-label");
      expect(labels.map(text)).toEqual(m.comparison.axes.map((a) => a.label));
      for (const l of labels) {
        const s = style(l) as { top: number; left: number; width: number; height: number; position: string };
        expect(s.position).toBe("absolute");
        expect(s.top).toBeGreaterThanOrEqual(0);
        expect(s.top + s.height).toBeLessThanOrEqual(L.body - L.legend.height);
        expect(s.left).toBeGreaterThanOrEqual(0);
        expect(s.left + s.width).toBeLessThanOrEqual(L.pane);
      }
    }
  });

  it("too few qualified players: no svg in the pane, the sentence instead; the table and the band are still there", () => {
    const m = model("QB", ALLEN, HUNTLEY, ONLY_TWO_QBS);
    const els = flatten(compareCardImage(m));
    const pane = one(els, "data-radar-pane");
    expect(pane.props["data-no-radar"]).toBe(true);
    expect(flatten(pane).filter((e) => e.type === "svg")).toHaveLength(0);
    expect(text(pane)).toBe("Not enough qualified quarterbacks to draw the radar (14+ pass attempts a game).");
    expect(by(els, "data-legend")).toHaveLength(0);
    expect(by(els, "data-row")).toHaveLength(7);
    expect(text(one(els, "data-sub-band-line"))).toBe("2026 season · Through Week 4");
  });
});

describe("long names", () => {
  it("a name that fits is right-aligned on the right half; one too long is cut at its END on both halves, never under the OVR badge", () => {
    const m = model("WR", LONG_A, LONG_B, TABLES.WR, 18);
    const els = flatten(compareCardImage(m));
    const a = one(els, "data-band-name", "a");
    const b = one(els, "data-band-name", "b");
    expect(text(a)).toHaveLength(34);
    expect(text(b)).toHaveLength(33);
    expect([style(a).fontSize, style(b).fontSize]).toEqual([13, 13]);
    // 34 x 13 = 442 > 430: cut by the box. 33 x 13 = 429: fits, right-aligned.
    expect(style(a).justifyContent).toBe("flex-start");
    expect(style(b).justifyContent).toBe("flex-end");
    const mirrored = flatten(compareCardImage(model("WR", LONG_B, LONG_A, TABLES.WR, 18)));
    expect(style(one(mirrored, "data-band-name", "b")).justifyContent).toBe("flex-start");
    for (const side of ["a", "b"] as const) {
      const badge = style(one(els, "data-ovr", side)) as { left: number; width: number };
      // Half-local x: the name box is [36, 466] on the left half and [134, 564] on the right.
      if (side === "a") expect(badge.left).toBeGreaterThanOrEqual(L.pad + L.nameBox);
      else expect(badge.left + badge.width).toBeLessThanOrEqual(600 - L.pad - L.nameBox);
    }
  });

  it("font steps: 20 px to 21 characters, 16 to 26, 13 beyond; an apostrophe and a dotted name included", () => {
    const sized = (full: string) => {
      const els = flatten(compareCardImage(model("QB", ["J.Allen", full, "x"], STAFFORD)));
      return style(one(els, "data-band-name", "a")).fontSize;
    };
    expect(sized("D'Andre Swift")).toBe(20);
    expect(sized("Amon-Ra St. Brown")).toBe(20);
    expect(sized("Equanimeous St. Brown")).toBe(20);
    expect(sized("Dorian Thompson-Robinson")).toBe(16);
    expect(sized("Marquez Valdes-Scantling Jr")).toBe(13);
  });

  it("the table header names keep to their 240 px columns: clipped, never wrapped, player B's right-aligned to the table's edge", () => {
    const els = flatten(compareCardImage(model("WR", LONG_A, LONG_B)));
    const column = (side: "a" | "b") => {
      const name = one(els, "data-head-name", side);
      expect(style(name).whiteSpace).toBe("nowrap");
      return els.find((e) => Array.isArray(e.props.children) && (e.props.children as unknown[]).includes(name))!;
    };
    expect(style(column("a"))).toMatchObject({ width: 240, overflow: "hidden" });
    expect(style(column("b"))).toMatchObject({ width: 240, overflow: "hidden", justifyContent: "flex-end" });
    // The three header cells fill the 570 px table exactly.
    expect(240 + (style(one(els, "data-head-stat")).width as number) + 240).toBe(570);
  });
});

describe("the OVR badge", () => {
  it("OVR 100 is drawn smaller so it does not fill the badge edge to edge; 91 and a dash keep the full size", () => {
    const m = model("QB", ALLEN, HUNTLEY);
    const hundred = { ...m, a: { ...m.a, ovr: 100 } };
    const els = flatten(compareCardImage(hundred));
    const a = one(els, "data-ovr-value", "a");
    const b = one(els, "data-ovr-value", "b");
    expect([text(a), style(a).fontSize]).toEqual(["100", 18]);
    expect([text(b), style(b).fontSize]).toEqual(["\u2014", 24]);
    const badge = style(one(els, "data-ovr", "a")) as { width: number };
    expect(3 * (style(a).fontSize as number)).toBeLessThanOrEqual(badge.width - 20);
    expect(style(one(flatten(compareCardImage(m)), "data-ovr-value", "a")).fontSize).toBe(24);
  });
});

describe("the plate: a real pair with nothing to compare", () => {
  const message = compareNoStatsMessage({ nameA: "CeeDee Lamb", nameB: "Jaxon Smith-Njigba", missingA: false, missingB: true, season: 2021, isNewestSeason: false });
  const plate = comparePlateImage({ nameA: "CeeDee Lamb", nameB: "Jaxon Smith-Njigba", season: 2021, message });
  const els = flatten(plate);

  it("both names, the season, the page's own sentence and the site line; never the card", () => {
    expect(text(one(els, "data-plate-name", "a"))).toBe("CEEDEE LAMB");
    expect(text(one(els, "data-plate-name", "b"))).toBe("JAXON SMITH-NJIGBA");
    expect(text(one(els, "data-plate-season"))).toBe("2021 SEASON");
    expect(text(one(els, "data-plate-message"))).toBe("Jaxon Smith-Njigba has no stats for the 2021 season, so there is nothing to compare.");
    expect(text(one(els, "data-site"))).toBe("YARDSPERPASS.COM · DATA: NFLVERSE");
    expect(by(els, "data-row")).toHaveLength(0);
    expect(els.filter((e) => e.type === "svg")).toHaveLength(0);
  });

  it("Satori's rules hold here too", () => {
    for (const e of els) {
      expect(e.type).toBe("div");
      expect(style(e).display).toBe("flex");
    }
    expect(text(plate)).not.toMatch(/NaN|undefined|null/);
  });

  it("long names get a smaller size", () => {
    const size = (a: string, b: string) =>
      style(one(flatten(comparePlateImage({ nameA: a, nameB: b, season: 2026, message: "m" })), "data-plate-name", "a")).fontSize;
    expect(size("Josh Allen", "Bo Nix")).toBe(34);
    expect(size("Josh Allen", "Jaxon Smith-Njigba")).toBe(26);
    expect(size("Dorian Thompson-Robinson The Third", "Bo Nix")).toBe(18);
  });
});

describe("fonts are shared with the team radar image, not copied", () => {
  it("this file reads no font itself and imports the radar image's loader names", () => {
    const source = readFileSync(join(process.cwd(), "lib", "og", "compare-card-image.tsx"), "utf8");
    expect(source).not.toMatch(/readFile|\.ttf/);
    expect(source).toMatch(/import \{ PIXEL, SANS \} from "@\/lib\/og\/team-radar-image"/);
    const code = source.split(/\r?\n/).filter((line) => !line.trim().startsWith("//")).join("\n");
    expect(code).not.toMatch(/<text|<polygon|display: "grid"/);
  });

  it("a font that cannot be read is logged under the caller's own name (the team radar's by default)", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const broken = { sans: async () => { throw new Error("ENOENT"); }, pixel: async () => new ArrayBuffer(8) };
    expect(await radarImageFonts(broken, "Compare card image")).toBeUndefined();
    expect(spy.mock.calls[0][0]).toBe("Compare card image: font RadarSans unavailable");
    spy.mockClear();
    await radarImageFonts(broken);
    expect(spy.mock.calls[0][0]).toBe("Team radar image: font RadarSans unavailable");
    spy.mockRestore();
  });

  it("the shared loader finds both font files in this checkout and names them as the image does", async () => {
    expect(existsSync(join(process.cwd(), "app", "fonts", "PressStart2P-Regular.ttf"))).toBe(true);
    const fonts = await radarImageFonts();
    expect(fonts?.map((f) => f.name).sort()).toEqual([PIXEL, SANS].sort());
  });

  it("there is no file-convention opengraph-image in the share page's folder (it could not carry the season)", () => {
    for (const name of ["opengraph-image.tsx", "twitter-image.tsx"]) {
      expect(existsSync(join(process.cwd(), "app", "card", "compare", "[a]", "[b]", name))).toBe(false);
    }
  });
});
