// lib/stats/matchup-colours.ts — the matchup card's colour rule (matchup card
// spec 2026-10-11 §5): one colour per team across the whole card, never two
// that read alike.
//
// The golden file (fixtures/matchup-card-colours.expected.json) is written by
// an independent Python reference:
//
//   py -3 -I docs/superpowers/specs/matchup-card-reference/colour_ref.py lib/data/teams.ts <out>
//
// sha256 of its output (LF line endings):
//   ce10dda1dd1dd78ef502cfa31682c99460df9c40986116a1c64e6697db07b747
//
// NEVER re-capture it to make a test pass: a failing golden means the
// TypeScript disagrees with the reference. The one legitimate reason to write
// it again is a team colour changing in lib/data/teams.ts; then re-run the
// script, look at the affected cards, and update the sha in its three places:
// below, in the spec (§10, §17) and in memory/MEMORY.md.
import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import expectedJson from "./fixtures/matchup-card-colours.expected.json";
import {
  COLOUR_ALIKE_DISTANCE,
  COLOUR_DARK_MAX_L,
  COLOUR_FAMILY_MAX_HUE,
  COLOUR_FAMILY_MIN_CHROMA,
  MATCHUP_CARD_INK,
  MATCHUP_CARD_SLATE,
  MATCHUP_RING_AMBER,
  MATCHUP_RING_GREY,
  MATCHUP_RING_MIN_DISTANCE,
  colourDistance,
  coloursAlike,
  darkenToReadable,
  labOf,
  matchupCardColours,
  matchupRingColour,
  readableOnWhite,
  type MatchupCardColours,
  type MatchupColourSource,
} from "@/lib/stats/matchup-colours";
import { NFL_TEAMS } from "@/lib/data/teams";
import { RADAR_MIN_STROKE_CONTRAST, contrastOnWhite } from "@/lib/stats/formatters";

const GOLDEN_SHA256 = "ce10dda1dd1dd78ef502cfa31682c99460df9c40986116a1c64e6697db07b747";

type Golden = Pick<
  MatchupCardColours,
  "away" | "awayFrom" | "home" | "homeFrom" | "awaySwitched" | "awayRule" | "homeRule" | "ring"
>;
const EXPECTED = expectedJson as unknown as Record<string, Golden>;

const HEX = /^#[0-9A-F]{6}$/;
const team = (id: string) => {
  const t = NFL_TEAMS.find((x) => x.id === id);
  if (!t) throw new Error(`no team ${id}`);
  return t;
};
const colours = (awayId: string, homeId: string) => matchupCardColours(team(awayId), team(homeId));
const PAIRS: [string, string][] = NFL_TEAMS.flatMap((a) =>
  NFL_TEAMS.filter((h) => h.id !== a.id).map((h): [string, string] => [a.id, h.id]),
);

describe("the constants (§5.2, §5.4: each named once)", () => {
  it("are the spec's numbers", () => {
    expect(COLOUR_ALIKE_DISTANCE).toBe(40);
    expect(COLOUR_DARK_MAX_L).toBe(25);
    expect(COLOUR_FAMILY_MIN_CHROMA).toBe(20);
    expect(COLOUR_FAMILY_MAX_HUE).toBe(30);
    expect(MATCHUP_RING_MIN_DISTANCE).toBe(30);
    expect(MATCHUP_CARD_INK).toBe("#0F172A");
    expect(MATCHUP_CARD_SLATE).toBe("#64748B");
    expect(MATCHUP_RING_AMBER).toBe("#F59E0B");
    expect(MATCHUP_RING_GREY).toBe("#94A3B8");
  });
});

describe("building blocks (§5.1)", () => {
  it("CIELAB (D65) of white, black and pure red", () => {
    const white = labOf("#FFFFFF");
    expect(white.L).toBeCloseTo(100, 6);
    expect(white.a).toBeCloseTo(0, 1);
    expect(white.b).toBeCloseTo(0, 1);
    const black = labOf("#000000");
    expect(Object.keys(black).sort()).toEqual(["L", "a", "b"]);
    expect(black.L).toBeCloseTo(0, 9);
    expect(black.a).toBeCloseTo(0, 9);
    expect(black.b).toBeCloseTo(0, 9);
    const red = labOf("#FF0000");
    expect(red.L).toBeCloseTo(53.23, 2);
    expect(red.a).toBeCloseTo(80.11, 2);
    expect(red.b).toBeCloseTo(67.22, 2);
  });

  it("a lower-case hex is the same colour", () => {
    expect(labOf("#f59e0b")).toEqual(labOf("#F59E0B"));
  });

  it("distance is CIE76: symmetric, 0 for equal colours", () => {
    expect(colourDistance("#00338D", "#00338D")).toBe(0);
    expect(colourDistance("#00338D", "#003594")).toBe(colourDistance("#003594", "#00338D"));
    expect(colourDistance("#00338D", "#003594")).toBeCloseTo(3.04, 2);
    expect(colourDistance("#000000", "#FFFFFF")).toBeCloseTo(100, 1);
    expect(colourDistance("#0F172A", "#64748B")).toBeCloseTo(40.55, 2);
    expect(colourDistance("#041E42", "#64748B")).toBeCloseTo(38.95, 2);
  });

  it("readableOnWhite is the site's 3.0 contrast line", () => {
    expect(RADAR_MIN_STROKE_CONTRAST).toBe(3);
    // #949494 is 3.03 against white, #959595 is 2.995
    expect(readableOnWhite("#949494")).toBe(true);
    expect(readableOnWhite("#959595")).toBe(false);
    for (const c of ["#00338D", "#FFB612", "#D3BC8D", "#000000", "#FFFFFF", "#869397"]) {
      expect(readableOnWhite(c), c).toBe(contrastOnWhite(c) >= RADAR_MIN_STROKE_CONTRAST);
    }
  });

  it("darkenToReadable: whole twentieths, half rounds up, the first readable step", () => {
    expect(darkenToReadable("#FFA300")).toBe("#CC8200"); // LA
    expect(darkenToReadable("#FFB81C")).toBe("#BF8A15"); // KC
    expect(darkenToReadable("#FFB612")).toBe("#BF890E"); // PIT, GB, WAS
    expect(darkenToReadable("#D3BC8D")).toBe("#9E8D6A"); // NO
    expect(darkenToReadable("#FFC20E")).toBe("#B3880A"); // LAC
    expect(darkenToReadable("#B3995D")).toBe("#AA9158"); // SF
    expect(darkenToReadable("#A5ACAF")).toBe("#8C9295"); // LV, PHI
  });

  it("a readable colour comes back unchanged (upper-cased)", () => {
    expect(darkenToReadable("#00338D")).toBe("#00338D");
    expect(darkenToReadable("#869397")).toBe("#869397");
    expect(darkenToReadable("#00338d")).toBe("#00338D");
    expect(darkenToReadable("#000000")).toBe("#000000");
  });

  it("pure white ends at a readable grey, and no colour ever gives NaN", () => {
    expect(darkenToReadable("#FFFFFF")).toBe("#8C8C8C");
    for (const t of NFL_TEAMS) {
      for (const c of [t.primaryColor, t.secondaryColor]) {
        const d = darkenToReadable(c);
        expect(d, c).toMatch(HEX);
        expect(readableOnWhite(d as string), c).toBe(true);
      }
    }
  });
});

describe("coloursAlike (§5.2): one case per branch and its edge", () => {
  it("distance: the BUF and LA primaries are 3.0 apart", () => {
    expect(coloursAlike("#00338D", "#003594")).toBe(true);
  });

  it("distance: under 40 is alike, 40 or more is not (two grey pairs either side of the line)", () => {
    // greys have no chroma, so only the distance test can fire
    expect(colourDistance("#343434", "#959595")).toBeCloseTo(39.997, 3);
    expect(coloursAlike("#343434", "#959595")).toBe(true);
    expect(colourDistance("#2F2F2F", "#8F8F8F")).toBeCloseTo(40.003, 3);
    expect(coloursAlike("#2F2F2F", "#8F8F8F")).toBe(false);
  });

  it("both very dark: Buffalo's blue and Cleveland's brown are 70+ apart and still alike", () => {
    expect(colourDistance("#00338D", "#311D00")).toBeGreaterThan(COLOUR_ALIKE_DISTANCE);
    expect(labOf("#00338D").L).toBeLessThan(COLOUR_DARK_MAX_L);
    expect(labOf("#311D00").L).toBeLessThan(COLOUR_DARK_MAX_L);
    expect(coloursAlike("#00338D", "#311D00")).toBe(true);
    // one of the two is not dark: the LA blue is L 25.8
    expect(labOf("#003594").L).toBeGreaterThanOrEqual(COLOUR_DARK_MAX_L);
  });

  it("same family: KC red and TB orange; royal and powder blue (each 40+ apart)", () => {
    expect(colourDistance("#E31837", "#FF7900")).toBeGreaterThan(COLOUR_ALIKE_DISTANCE);
    expect(coloursAlike("#E31837", "#FF7900")).toBe(true);
    expect(colourDistance("#00338D", "#4B92DB")).toBeGreaterThan(COLOUR_ALIKE_DISTANCE);
    expect(coloursAlike("#00338D", "#4B92DB")).toBe(true);
  });

  it("a grey has no hue to compare: slate sits 25 degrees from Buffalo's blue and is not alike it", () => {
    expect(Math.hypot(labOf("#64748B").a, labOf("#64748B").b)).toBeLessThan(COLOUR_FAMILY_MIN_CHROMA);
    expect(coloursAlike("#64748B", "#00338D")).toBe(false);
    expect(coloursAlike("#869397", "#D50A0A")).toBe(false);
    expect(coloursAlike("#A5ACAF", "#203731")).toBe(false);
  });

  it("is symmetric", () => {
    for (const [a, b] of [["#E31837", "#FF7900"], ["#64748B", "#00338D"], ["#343434", "#959595"], ["#00338D", "#311D00"]]) {
      expect(coloursAlike(a, b)).toBe(coloursAlike(b, a));
    }
  });
});

describe("matchupRingColour (§5.4): amber, grey when a CARD colour is close to amber", () => {
  it("amber beside two colours far from it", () => {
    expect(matchupRingColour("#D50A0A", "#041E42")).toBe(MATCHUP_RING_AMBER);
  });

  it("grey beside a gold or an orange, on either side", () => {
    expect(matchupRingColour("#00338D", "#CC8200")).toBe(MATCHUP_RING_GREY);
    expect(matchupRingColour("#CC8200", "#00338D")).toBe(MATCHUP_RING_GREY);
    expect(matchupRingColour("#FB4F14", "#002244")).toBe(MATCHUP_RING_GREY);
  });

  it("a very dark colour is never close to amber: Cleveland's brown keeps the amber ring", () => {
    expect(coloursAlike(MATCHUP_RING_AMBER, "#311D00")).toBe(true); // amber's hue family…
    expect(labOf("#311D00").L).toBeLessThan(COLOUR_DARK_MAX_L); // …but very dark
    expect(matchupRingColour("#311D00", "#869397")).toBe(MATCHUP_RING_AMBER);
  });
});

describe("the table: all 32 × 31 = 992 ordered pairs (§5.3, §5.5)", () => {
  const ALL = PAIRS.map(([a, h]) => ({ a, h, c: colours(a, h) }));

  it("there are 992", () => {
    expect(NFL_TEAMS).toHaveLength(32);
    expect(ALL).toHaveLength(992);
    expect(Object.keys(EXPECTED)).toHaveLength(992);
  });

  it("both colours are #RRGGBB and readable on white", () => {
    for (const { a, h, c } of ALL) {
      expect(c.away, `${a} at ${h}`).toMatch(HEX);
      expect(c.home, `${a} at ${h}`).toMatch(HEX);
      expect(readableOnWhite(c.away), `${a} at ${h} away`).toBe(true);
      expect(readableOnWhite(c.home), `${a} at ${h} home`).toBe(true);
    }
  });

  it("the two colours are never alike", () => {
    for (const { a, h, c } of ALL) expect(coloursAlike(c.away, c.home), `${a} at ${h}: ${c.away} ${c.home}`).toBe(false);
  });

  it("no pair needs a neutral, and none is a closest pick", () => {
    for (const { a, h, c } of ALL) {
      expect(["primary", "primary-darkened", "secondary", "secondary-darkened"], `${a} at ${h}`).toContain(c.homeFrom);
      expect(["primary", "primary-darkened", "secondary", "secondary-darkened"], `${a} at ${h}`).toContain(c.awayFrom);
      expect(c.closest, `${a} at ${h}`).toBe(false);
    }
  });

  it("the ring is amber or grey, and at least 30 from both colours", () => {
    let smallest = Infinity;
    for (const { a, h, c } of ALL) {
      expect([MATCHUP_RING_AMBER, MATCHUP_RING_GREY], `${a} at ${h}`).toContain(c.ring);
      expect(c.ring).toBe(matchupRingColour(c.away, c.home));
      const d = Math.min(colourDistance(c.ring, c.away), colourDistance(c.ring, c.home));
      expect(d, `${a} at ${h}`).toBeGreaterThanOrEqual(MATCHUP_RING_MIN_DISTANCE);
      smallest = Math.min(smallest, d);
    }
    expect(smallest).toBeCloseTo(30.3, 1); // grey beside Miami's teal, CIN at MIA
  });

  it("each rule is the team's colour NOT in use", () => {
    const other = (t: { primaryColor: string; secondaryColor: string }, from: MatchupColourSource) =>
      (from === "primary" || from === "primary-darkened" ? t.secondaryColor : t.primaryColor).toUpperCase();
    for (const { a, h, c } of ALL) {
      expect(c.awayRule, `${a} at ${h}`).toBe(other(team(a), c.awayFrom));
      expect(c.homeRule, `${a} at ${h}`).toBe(other(team(h), c.homeFrom));
    }
  });

  it("a team's colour is its own: the card colour is one of its two colours or a darker shade of one", () => {
    for (const { a, h, c } of ALL) {
      const own = (t: { primaryColor: string; secondaryColor: string }) =>
        [t.primaryColor, t.secondaryColor, darkenToReadable(t.primaryColor), darkenToReadable(t.secondaryColor)];
      expect(own(team(a)), `${a} at ${h}`).toContain(c.away);
      expect(own(team(h)), `${a} at ${h}`).toContain(c.home);
    }
  });

  it("the same answer on every call", () => {
    for (const [a, h] of PAIRS.slice(0, 60)) expect(colours(a, h)).toEqual(colours(a, h));
  });

  // §5.5's named pairs, literal hexes: away, from, home, from, ring, rules, away gave way
  const A = MATCHUP_RING_AMBER;
  const G = MATCHUP_RING_GREY;
  const NAMED: [string, string, string, MatchupColourSource, string, MatchupColourSource, string, string, string, boolean][] = [
    ["BUF", "LA", "#00338D", "primary", "#CC8200", "secondary-darkened", G, "#C60C30", "#003594", false],
    ["LA", "BUF", "#003594", "primary", "#C60C30", "secondary", A, "#FFA300", "#00338D", false],
    ["TB", "DAL", "#D50A0A", "primary", "#041E42", "primary", A, "#FF7900", "#869397", false],
    ["LAC", "KC", "#0080C6", "primary", "#E31837", "primary", A, "#FFC20E", "#FFB81C", false],
    ["KC", "TB", "#BF8A15", "secondary-darkened", "#D50A0A", "primary", G, "#E31837", "#FF7900", true],
    ["TB", "KC", "#D50A0A", "primary", "#BF8A15", "secondary-darkened", G, "#FF7900", "#E31837", false],
    ["KC", "SF", "#E31837", "primary", "#AA9158", "secondary-darkened", G, "#FFB81C", "#AA0000", false],
    ["PIT", "NO", "#BF890E", "primary-darkened", "#101820", "secondary", G, "#101820", "#D3BC8D", false],
    ["NO", "PIT", "#9E8D6A", "primary-darkened", "#101820", "secondary", G, "#101820", "#FFB612", false],
    ["BAL", "PIT", "#241773", "primary", "#BF890E", "primary-darkened", G, "#000000", "#101820", false],
    ["DAL", "NE", "#041E42", "primary", "#C60C30", "secondary", A, "#869397", "#002244", false],
    ["NE", "DAL", "#002244", "primary", "#869397", "secondary", A, "#C60C30", "#041E42", false],
    ["MIA", "NYJ", "#008E97", "primary", "#000000", "secondary", A, "#FC4C02", "#125740", false],
    ["JAX", "PHI", "#9F792C", "secondary", "#004C54", "primary", G, "#006778", "#A5ACAF", true],
    ["GB", "NYJ", "#BF890E", "secondary-darkened", "#125740", "primary", G, "#203731", "#000000", true],
    ["GB", "PHI", "#203731", "primary", "#8C9295", "secondary-darkened", A, "#FFB612", "#004C54", false],
    ["CIN", "DEN", "#FB4F14", "primary", "#002244", "secondary", G, "#000000", "#FB4F14", false],
    ["DET", "LAC", "#0076B6", "primary", "#B3880A", "secondary-darkened", G, "#B0B7BC", "#0080C6", false],
    ["CLE", "DAL", "#311D00", "primary", "#869397", "secondary", A, "#FF3C00", "#041E42", false],
    ["CLE", "CHI", "#FF3C00", "secondary", "#0B162A", "primary", G, "#311D00", "#C83803", true],
    ["HOU", "TEN", "#03202F", "primary", "#4B92DB", "secondary", A, "#A71930", "#0C2340", false],
  ];

  it.each(NAMED)("%s at %s", (a, h, away, awayFrom, home, homeFrom, ring, awayRule, homeRule, awaySwitched) => {
    expect(colours(a, h)).toEqual({ away, awayFrom, home, homeFrom, ring, awayRule, homeRule, awaySwitched, closest: false });
  });

  it("there are 21 named pairs", () => {
    expect(NAMED).toHaveLength(21);
  });

  it("the 5 px rule is exempt from 'not alike': CIN at DEN's home rule IS the away colour (§5.3)", () => {
    const c = colours("CIN", "DEN");
    expect(c.homeRule).toBe(c.away);
    const b = colours("BUF", "LA");
    expect(coloursAlike(b.homeRule, b.away)).toBe(true);
  });

  it("the golden file is the reference script's output, untouched (never re-captured to make a test pass)", () => {
    const raw = readFileSync(join(process.cwd(), "__tests__/stats/fixtures/matchup-card-colours.expected.json"), "utf8");
    // git may check the file out with CRLF (core.autocrlf); the script writes LF
    expect(createHash("sha256").update(raw.replace(/\r\n/g, "\n"), "utf8").digest("hex")).toBe(GOLDEN_SHA256);
  });

  it("the whole table equals the golden (a team colour change in teams.ts is the one reason to write it again)", () => {
    for (const { a, h, c } of ALL) {
      const want = EXPECTED[`${a}-${h}`];
      expect(want, `${a}-${h} in the golden`).toBeDefined();
      const { closest, ...eight } = c;
      expect(closest).toBe(false);
      expect(eight, `${a} at ${h}`).toEqual(want);
    }
  });

  it("totals, as a tripwire (§5.5)", () => {
    const count = (f: (c: MatchupCardColours) => boolean) => ALL.filter((x) => f(x.c)).length;
    expect(count((c) => c.awaySwitched)).toBe(71);
    expect(count((c) => !c.awaySwitched && c.homeFrom === "primary")).toBe(548);
    expect(count((c) => !c.awaySwitched && c.homeFrom === "secondary")).toBe(192);
    expect(count((c) => !c.awaySwitched && c.homeFrom === "secondary-darkened")).toBe(149);
    expect(count((c) => !c.awaySwitched && c.homeFrom === "primary-darkened")).toBe(32);
    expect(count((c) => c.awayFrom === "primary")).toBe(859);
    expect(count((c) => c.awayFrom === "primary-darkened")).toBe(62);
    expect(count((c) => c.ring === MATCHUP_RING_AMBER)).toBe(637);
    expect(count((c) => c.ring === MATCHUP_RING_GREY)).toBe(355);
    expect(new Set(ALL.flatMap((x) => [x.c.away, x.c.home])).size).toBe(48);
    const closestPair = Math.min(...ALL.map((x) => colourDistance(x.c.away, x.c.home)));
    expect(closestPair).toBeCloseTo(40.3, 1); // GB at LV and GB at PHI: dark green beside silver
  });
});

describe("junk in (§5.1, §5.3 steps 4-5): never real data, never a throw", () => {
  const JUNK: unknown[] = ["", "#FFF", null, undefined, "red", "#GGGGGG"];
  const BUF = { primaryColor: "#00338D", secondaryColor: "#C60C30" };
  const LA = { primaryColor: "#003594", secondaryColor: "#FFA300" };
  const pick = (a: unknown, b: unknown, c: unknown, d: unknown) =>
    matchupCardColours({ primaryColor: a, secondaryColor: b } as never, { primaryColor: c, secondaryColor: d } as never);

  it("darkenToReadable of an unusable value is null (never '#NaNNaNNaN')", () => {
    for (const j of [...JUNK, 42, {}, "#12345", "#1234567", "00338D"]) expect(darkenToReadable(j as never), String(j)).toBeNull();
  });

  it("any one, two, three or all four colours junk: both colours and both rules are #RRGGBB, readable, and stable", () => {
    const real = [BUF.primaryColor, BUF.secondaryColor, LA.primaryColor, LA.secondaryColor];
    let cases = 0;
    for (let mask = 1; mask < 16; mask += 1) {
      for (const j of JUNK) {
        const args = real.map((c, i) => (mask & (1 << i) ? j : c)) as [unknown, unknown, unknown, unknown];
        let out: MatchupCardColours | null = null;
        expect(() => { out = pick(...args); }, `${mask} ${String(j)}`).not.toThrow();
        const c = out as unknown as MatchupCardColours;
        for (const hex of [c.away, c.home, c.awayRule, c.homeRule, c.ring]) expect(hex, `${mask} ${String(j)}`).toMatch(HEX);
        expect(readableOnWhite(c.away)).toBe(true);
        expect(readableOnWhite(c.home)).toBe(true);
        expect(pick(...args)).toEqual(c);
        cases += 1;
      }
    }
    expect(cases).toBe(90);
    // "not alike" is NOT asserted here on purpose: step 5 may return an alike pair (§5.3).
  });

  it("a team that is not an object at all is two unusable colours", () => {
    for (const t of [null, undefined, "BUF", 7]) {
      expect(() => matchupCardColours(t as never, t as never)).not.toThrow();
      expect(matchupCardColours(t as never, t as never)).toEqual(pick(null, null, null, null));
    }
  });

  it("all four junk: ink and slate (step 4; 40.5 apart), not a closest pick", () => {
    for (const j of JUNK) {
      expect(pick(j, j, j, j)).toEqual({
        away: "#0F172A", awayFrom: "ink", home: "#64748B", homeFrom: "grey", awaySwitched: false,
        awayRule: "#0F172A", homeRule: "#64748B", ring: MATCHUP_RING_AMBER, closest: false,
      });
    }
  });

  it("DAL away with both home colours junk: slate is the farthest neutral and still alike (step 5, closest)", () => {
    const c = pick("#041E42", "#869397", "", null);
    expect(c).toMatchObject({ away: "#041E42", awayFrom: "primary", home: "#64748B", homeFrom: "grey", closest: true, awaySwitched: false });
    expect(coloursAlike(c.away, c.home)).toBe(true);
    // a junk rule colour is drawn in the team's card colour (the band has no stripe)
    expect(c.homeRule).toBe("#64748B");
    expect(c.awayRule).toBe("#869397");
  });

  it("step 1 does not darken the secondary: a junk primary with a light secondary is ink (builder note 3)", () => {
    const c = pick("red", "#FFB612", "#00338D", "#C60C30");
    expect(c.away).toBe("#0F172A");
    expect(c.awayFrom).toBe("ink");
    // the rule is the primary when the card colour is not from it; the primary is junk, so the card colour
    expect(c.awayRule).toBe("#0F172A");
    // a junk primary with a readable secondary: the secondary
    expect(pick("red", "#C60C30", "#003594", "#FFA300")).toMatchObject({ away: "#C60C30", awayFrom: "secondary", awayRule: "#C60C30" });
  });

  it("a lower-case input gives the same answer as its upper-case form", () => {
    expect(pick("#00338d", "#c60c30", "#003594", "#ffa300")).toEqual(colours("BUF", "LA"));
    expect(pick("#e31837", "#ffb81c", "#d50a0a", "#ff7900")).toEqual(colours("KC", "TB"));
  });

  it("a team whose two colours are the same string does not loop", () => {
    const c = pick("#00338D", "#00338D", "#00338D", "#00338D");
    expect(c.away).toBe("#00338D");
    expect(c.home).toMatch(HEX);
    expect(coloursAlike(c.away, c.home)).toBe(false);
    expect(c.homeFrom).toBe("grey");
    const light = pick("#FFB612", "#FFB612", "#FFB612", "#FFB612");
    expect(light.away).toBe("#BF890E");
    expect(light.home).toMatch(HEX);
  });
});

describe("lib/stats/matchup-colours.ts is pure (§3)", () => {
  const source = readFileSync(join(process.cwd(), "lib/stats/matchup-colours.ts"), "utf8");
  const imports = Array.from(source.matchAll(/from\s+["']([^"']+)["']/g)).map((m) => m[1]);

  it("imports only the contrast rule from formatters: nothing from lib/data, React or Next", () => {
    expect(imports).toEqual(["@/lib/stats/formatters"]);
    expect(source).not.toMatch(/\brequire\(|\bimport\(/);
    expect(source).not.toContain("use client");
  });
});
