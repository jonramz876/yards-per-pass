// lib/stats/matchup-colours.ts — the matchup card's colour rule (matchup card
// spec 2026-10-11 §5, as amended by the colour families spec
// 2026-10-11-matchup-colour-families.md): one colour per team across the whole
// card, never two that read alike, never two of one colour family.
//
// The golden file (fixtures/matchup-card-colours.expected.json) is written by
// an independent Python reference:
//
//   py -3 -I docs/superpowers/specs/matchup-card-reference/colour_ref.py lib/data/teams.ts <out>
//
// sha256 of its output (LF line endings):
//   b58830503e606d9d082cfac5989337a3058ecc796b4a8afbd3bf0ce77453cab1
//
// NEVER re-capture it to make a test pass: a failing golden means the
// TypeScript disagrees with the reference. There are two legitimate reasons to
// write it again: a team colour changing in lib/data/teams.ts, or a deliberate,
// spec'd change of the rule itself (the colour families spec was one: 53 of
// the 992 pairs changed). Then re-run the script, look at the affected cards,
// and update the sha everywhere it is pinned: four files, seven places. This
// file (the comment above and GOLDEN_SHA256 below), the matchup card spec
// (three), the team matchup spec (one) and memory/MEMORY.md (one).
import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import expectedJson from "./fixtures/matchup-card-colours.expected.json";
import {
  COLOUR_ALIKE_DISTANCE,
  COLOUR_BLACK_MAX_L,
  COLOUR_BROWN_MAX_L,
  COLOUR_DARK_MAX_L,
  COLOUR_HUE_CUTS,
  COLOUR_NEUTRAL_MAX_CHROMA,
  COLOUR_WHITE_MIN_L,
  MATCHUP_CARD_INK,
  MATCHUP_CARD_SLATE,
  MATCHUP_RING_AMBER,
  MATCHUP_RING_GREY,
  MATCHUP_RING_MIN_DISTANCE,
  colourDistance,
  colourFamily,
  coloursAlike,
  darkenToReadable,
  labOf,
  matchupCardColours,
  matchupRingColour,
  readableOnWhite,
  wheelHue,
  type ColourFamily,
  type MatchupCardColours,
  type MatchupColourSource,
} from "@/lib/stats/matchup-colours";
import * as rule from "@/lib/stats/matchup-colours";
import { NFL_TEAMS } from "@/lib/data/teams";
import { RADAR_MIN_STROKE_CONTRAST, contrastOnWhite } from "@/lib/stats/formatters";

const GOLDEN_SHA256 = "b58830503e606d9d082cfac5989337a3058ecc796b4a8afbd3bf0ce77453cab1";

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

/** Every colour the chain can hand out: the 64 team colours and their darkened forms (60 distinct). */
const TEAM_COLOURS: string[] = Array.from(
  new Set(
    NFL_TEAMS.flatMap((t) => [t.primaryColor, t.secondaryColor]).flatMap((c) => [c.toUpperCase(), darkenToReadable(c) as string]),
  ),
).sort();
const chromaOf = (hex: string) => Math.hypot(labOf(hex).a, labOf(hex).b);

describe("the constants (§5.2, §5.4, colour families spec §2 and §3: each named once)", () => {
  it("are the spec's numbers", () => {
    expect(COLOUR_ALIKE_DISTANCE).toBe(40);
    expect(COLOUR_DARK_MAX_L).toBe(25);
    expect(COLOUR_NEUTRAL_MAX_CHROMA).toBe(8.8);
    expect(COLOUR_BLACK_MAX_L).toBe(35);
    expect(COLOUR_WHITE_MIN_L).toBe(90);
    expect(COLOUR_BROWN_MAX_L).toBe(30);
    expect(COLOUR_HUE_CUTS).toEqual({ orange: 7, gold: 33.5, green: 70, teal: 172, blue: 195, purple: 257, red: 306 });
    // the pairwise hue test is gone, and its two constants with it
    expect(Object.keys(rule)).not.toContain("COLOUR_FAMILY_MIN_CHROMA");
    expect(Object.keys(rule)).not.toContain("COLOUR_FAMILY_MAX_HUE");
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

  /** Alike by the family rules alone: 40 or more apart and not both very dark. */
  const onlyByFamily = (a: string, b: string) => {
    expect(colourDistance(a, b), `${a} ${b} distance`).toBeGreaterThanOrEqual(COLOUR_ALIKE_DISTANCE);
    expect(labOf(a).L < COLOUR_DARK_MAX_L && labOf(b).L < COLOUR_DARK_MAX_L, `${a} ${b} both very dark`).toBe(false);
  };

  it.each([
    ["navy and sky blue (Giants, Panthers)", "#0B2265", "#0085CA", "blue"],
    ["Baltimore's indigo and sky blue", "#241773", "#0085CA", "blue"],
    ["royal and powder blue (Bills, Titans)", "#00338D", "#4B92DB", "blue"],
    ["burgundy and Chiefs red", "#5A1414", "#E31837", "red"],
    ["two golds (Steelers darkened, Saints darkened)", "#BF890E", "#9E8D6A", "gold"],
    ["two greens (Jets, Seahawks darkened)", "#125740", "#59A222", "green"],
  ] as [string, string, string, ColourFamily][])("same family: %s are alike, 40+ apart and not both very dark", (_name, a, b, family) => {
    onlyByFamily(a, b);
    expect(colourFamily(a)).toBe(family);
    expect(colourFamily(b)).toBe(family);
    expect(coloursAlike(a, b)).toBe(true);
  });

  it("a red beside an orange is alike: KC red and TB's orange, plain (46.3 apart) and darkened (42.9)", () => {
    for (const orange of ["#FF7900", "#E66D00"]) {
      onlyByFamily("#E31837", orange);
      expect([colourFamily("#E31837"), colourFamily(orange)]).toEqual(["red", "orange"]);
      expect(coloursAlike("#E31837", orange)).toBe(true);
      expect(coloursAlike(orange, "#E31837")).toBe(true);
    }
    expect(colourDistance("#E31837", "#E66D00")).toBeCloseTo(42.9, 1);
  });

  it("different families 40+ apart are NOT alike: brown beside orange, brown beside gold, orange beside gold, navy beside Vikings purple", () => {
    const pairs: [string, ColourFamily, string, ColourFamily][] = [
      ["#311D00", "brown", "#FF3C00", "orange"],
      ["#311D00", "brown", "#BF890E", "gold"],
      ["#FB4F14", "orange", "#BF8A15", "gold"],
      ["#002244", "blue", "#4F2683", "purple"],
      ["#869397", "grey", "#D50A0A", "red"],
      ["#A5ACAF", "grey", "#203731", "green"],
    ];
    for (const [a, fa, b, fb] of pairs) {
      onlyByFamily(a, b);
      expect(colourFamily(a), a).toBe(fa);
      expect(colourFamily(b), b).toBe(fb);
      expect(coloursAlike(a, b), `${a} ${b}`).toBe(false);
    }
    expect(colourDistance("#002244", "#4F2683")).toBeCloseTo(42.8, 1);
  });

  it("the chain's neutrals measure blue here: slate and ink are alike any blue (the chain itself compares them by distance and darkness only)", () => {
    onlyByFamily("#64748B", "#00338D");
    expect(colourFamily(MATCHUP_CARD_SLATE)).toBe("blue");
    expect(colourFamily(MATCHUP_CARD_INK)).toBe("blue");
    expect(coloursAlike("#64748B", "#00338D")).toBe(true);
    onlyByFamily("#0F172A", "#003594");
    expect(coloursAlike("#0F172A", "#003594")).toBe(true);
  });

  it("is symmetric, over every pair of team colours", () => {
    expect(TEAM_COLOURS).toHaveLength(60);
    for (const a of TEAM_COLOURS) {
      for (const b of TEAM_COLOURS) expect(coloursAlike(a, b), `${a} ${b}`).toBe(coloursAlike(b, a));
    }
    for (const [a, b] of [["#E31837", "#FF7900"], ["#64748B", "#00338D"], ["#343434", "#959595"], ["#00338D", "#311D00"]]) {
      expect(coloursAlike(a, b)).toBe(coloursAlike(b, a));
    }
  });
});

describe("wheelHue (colour families spec §2): the colour-wheel hue, 0 to 360", () => {
  it("the six corners, a pure grey, and the wrap below red", () => {
    expect(wheelHue("#FF0000")).toBe(0);
    expect(wheelHue("#FFFF00")).toBe(60);
    expect(wheelHue("#00FF00")).toBe(120);
    expect(wheelHue("#00FFFF")).toBe(180);
    expect(wheelHue("#0000FF")).toBe(240);
    expect(wheelHue("#FF00FF")).toBe(300);
    for (const grey of ["#000000", "#808080", "#FFFFFF"]) expect(wheelHue(grey)).toBe(0);
    // red with more blue than green is just under 360, never negative
    expect(wheelHue("#FF0080")).toBeCloseTo(329.882, 3);
    expect(wheelHue("#97233F")).toBeCloseTo(345.5, 1);
  });

  it("team colours the spec names; lower case is the same colour", () => {
    expect(wheelHue("#D50A0A")).toBe(0);
    expect(wheelHue("#FF3C00")).toBeCloseTo(14.1, 1);
    expect(wheelHue("#241773")).toBeCloseTo(248.5, 1);
    expect(wheelHue("#4F2683")).toBeCloseTo(266.5, 1);
    expect(wheelHue(MATCHUP_RING_AMBER)).toBeCloseTo(37.7, 1);
    expect(wheelHue("#f59e0b")).toBe(wheelHue("#F59E0B"));
    expect(wheelHue("#aBcDeF")).toBe(wheelHue("#ABCDEF"));
  });
});

describe("colourFamily (colour families spec §2)", () => {
  // §2.2, literal: primary, its family, secondary, its family
  const TEAM_FAMILIES: Record<string, [string, ColourFamily, string, ColourFamily]> = {
    ARI: ["#97233F", "red", "#000000", "black"],
    ATL: ["#A71930", "red", "#000000", "black"],
    BAL: ["#241773", "blue", "#000000", "black"],
    BUF: ["#00338D", "blue", "#C60C30", "red"],
    CAR: ["#0085CA", "blue", "#101820", "black"],
    CHI: ["#0B162A", "blue", "#C83803", "orange"],
    CIN: ["#FB4F14", "orange", "#000000", "black"],
    CLE: ["#311D00", "brown", "#FF3C00", "orange"],
    DAL: ["#041E42", "blue", "#869397", "grey"],
    DEN: ["#FB4F14", "orange", "#002244", "blue"],
    DET: ["#0076B6", "blue", "#B0B7BC", "grey"],
    GB: ["#203731", "green", "#FFB612", "gold"],
    HOU: ["#03202F", "blue", "#A71930", "red"],
    IND: ["#002C5F", "blue", "#A2AAAD", "grey"],
    JAX: ["#006778", "teal", "#9F792C", "gold"],
    KC: ["#E31837", "red", "#FFB81C", "gold"],
    LA: ["#003594", "blue", "#FFA300", "gold"],
    LAC: ["#0080C6", "blue", "#FFC20E", "gold"],
    LV: ["#000000", "black", "#A5ACAF", "grey"],
    MIA: ["#008E97", "teal", "#FC4C02", "orange"],
    MIN: ["#4F2683", "purple", "#FFC62F", "gold"],
    NE: ["#002244", "blue", "#C60C30", "red"],
    NO: ["#D3BC8D", "gold", "#101820", "black"],
    NYG: ["#0B2265", "blue", "#A71930", "red"],
    NYJ: ["#125740", "green", "#000000", "black"],
    PHI: ["#004C54", "teal", "#A5ACAF", "grey"],
    PIT: ["#FFB612", "gold", "#101820", "black"],
    SEA: ["#002244", "blue", "#69BE28", "green"],
    SF: ["#AA0000", "red", "#B3995D", "gold"],
    TB: ["#D50A0A", "red", "#FF7900", "orange"],
    TEN: ["#0C2340", "blue", "#4B92DB", "blue"],
    WAS: ["#5A1414", "red", "#FFB612", "gold"],
  };
  // the 12 distinct darkened hexes (15 team colours are darkened: PIT, GB and WAS share one, PHI and LV another)
  const DARKENED: Record<string, ColourFamily> = {
    "#59A222": "green", "#8A9193": "grey", "#8C9295": "grey", "#8D9296": "grey", "#9E8D6A": "gold", "#AA9158": "gold",
    "#B3880A": "gold", "#B38B21": "gold", "#BF890E": "gold", "#BF8A15": "gold", "#CC8200": "gold", "#E66D00": "orange",
  };

  it("the 32 teams: all 64 colours against the spec's table", () => {
    expect(Object.keys(TEAM_FAMILIES).sort()).toEqual(NFL_TEAMS.map((t) => t.id).sort());
    for (const t of NFL_TEAMS) {
      const [primary, pf, secondary, sf] = TEAM_FAMILIES[t.id];
      expect(t.primaryColor.toUpperCase(), `${t.id} primary`).toBe(primary);
      expect(t.secondaryColor.toUpperCase(), `${t.id} secondary`).toBe(secondary);
      expect(colourFamily(primary), `${t.id} primary ${primary}`).toBe(pf);
      expect(colourFamily(secondary), `${t.id} secondary ${secondary}`).toBe(sf);
    }
  });

  it("the counts: blue 16, gold 10, red 10, black 9, orange 6, grey 5, green 3, teal 3, brown 1, purple 1", () => {
    const counts: Record<string, number> = {};
    for (const t of NFL_TEAMS) {
      for (const c of [t.primaryColor, t.secondaryColor]) counts[colourFamily(c)] = (counts[colourFamily(c)] ?? 0) + 1;
    }
    expect(counts).toEqual({ blue: 16, gold: 10, red: 10, black: 9, orange: 6, grey: 5, green: 3, teal: 3, brown: 1, purple: 1 });
  });

  it("the darkened forms: 15 team colours, 12 distinct hexes, and none changes family", () => {
    const darkened = NFL_TEAMS.flatMap((t) => [t.primaryColor, t.secondaryColor])
      .map((c) => [c.toUpperCase(), darkenToReadable(c) as string])
      .filter(([c, d]) => c !== d);
    expect(darkened).toHaveLength(15);
    expect(Array.from(new Set(darkened.map(([, d]) => d))).sort()).toEqual(Object.keys(DARKENED).sort());
    for (const [c, d] of darkened) {
      expect(colourFamily(d), d).toBe(DARKENED[d]);
      expect(colourFamily(d), `${c} darkened to ${d}`).toBe(colourFamily(c));
    }
  });

  it("the order of the tests: neutrals first, brown before red, then the hue bands (half-open)", () => {
    expect(colourFamily("#000000")).toBe("black");
    expect(colourFamily("#101820")).toBe("black"); // chroma 6.8: under the floor though it leans blue
    expect(colourFamily("#808080")).toBe("grey");
    expect(colourFamily("#FFFFFF")).toBe("white");
    expect(colourFamily("#311D00")).toBe("brown");
    expect(colourFamily("#FF0000")).toBe("red");
    expect(colourFamily("#FF0080")).toBe("red"); // 329.9 degrees: red wraps
    expect(colourFamily("#FF1E00")).toBe("orange"); // 7.06 degrees, just over the red | orange cut
    expect(colourFamily("#FF8F00")).toBe("gold"); // 33.65 degrees, just over the orange | gold cut
    expect(colourFamily("#FFFF00")).toBe("gold");
    expect(colourFamily("#00FF00")).toBe("green");
    expect(colourFamily("#00FFFF")).toBe("teal");
    expect(colourFamily("#00BFFF")).toBe("blue"); // 195.06 degrees, just over the teal | blue cut
    expect(colourFamily("#0000FF")).toBe("blue");
    expect(colourFamily("#FF00FF")).toBe("purple"); // 300 degrees: purple runs to 306
    expect(colourFamily("#203731")).toBe("green"); // chroma 10.8: has a hue
    expect(colourFamily("#f59e0b")).toBe("gold"); // amber, lower case
  });

  it("a hue exactly ON a cut belongs to the family the cut is named for (half-open bands: `<` below, `>=` at)", () => {
    // each colour's wheel hue is exactly the cut by the integer formula; L 40 to 45, chroma 25 to 50 (so never neutral or brown)
    const ON_CUT: [string, number, ColourFamily][] = [
      ["#86514A", 7, "orange"],
      ["#885310", 33.5, "gold"],
      ["#556600", 70, "green"],
      ["#007868", 172, "teal"],
      ["#006688", 195, "blue"],
      ["#665591", 257, "purple"],
      ["#85497F", 306, "red"],
    ];
    expect(ON_CUT.map(([, cut]) => cut).sort((a, b) => a - b)).toEqual(Object.values(COLOUR_HUE_CUTS).slice().sort((a, b) => a - b));
    for (const [hex, cut, family] of ON_CUT) {
      expect(wheelHue(hex), hex).toBe(cut);
      expect(chromaOf(hex), hex).toBeGreaterThanOrEqual(COLOUR_NEUTRAL_MAX_CHROMA);
      expect(labOf(hex).L, hex).toBeGreaterThanOrEqual(COLOUR_BROWN_MAX_L);
      expect(colourFamily(hex), `${hex} at ${cut}`).toBe(family);
    }
  });

  describe("margins: a team colour edited onto a cut must fail here (§2.1)", () => {
    const hueDecided = () => TEAM_COLOURS.filter((c) => chromaOf(c) >= COLOUR_NEUTRAL_MAX_CHROMA && colourFamily(c) !== "brown");
    const apart = (a: number, b: number) => Math.min(Math.abs(a - b) % 360, 360 - (Math.abs(a - b) % 360));

    it("every colour whose family is decided by hue is at least 4 degrees from every hue cut (tightest: #CC8200, 4.7 from orange | gold)", () => {
      let tightest = Infinity;
      expect(hueDecided().length).toBeGreaterThan(30);
      for (const c of hueDecided()) {
        for (const [name, cut] of Object.entries(COLOUR_HUE_CUTS)) {
          const d = apart(wheelHue(c), cut);
          expect(d, `${c} from the ${name} cut`).toBeGreaterThanOrEqual(4);
          tightest = Math.min(tightest, d);
        }
      }
      expect(tightest).toBeCloseTo(4.74, 2);
      expect(apart(wheelHue("#CC8200"), COLOUR_HUE_CUTS.gold)).toBeCloseTo(4.74, 2);
    });

    it("no colour's chroma is within 1.5 of the neutral floor (nearest: #101820 below, #203731 above)", () => {
      for (const c of TEAM_COLOURS) expect(Math.abs(chromaOf(c) - COLOUR_NEUTRAL_MAX_CHROMA), c).toBeGreaterThanOrEqual(1.5);
      expect(chromaOf("#101820")).toBeCloseTo(6.83, 2);
      expect(chromaOf("#203731")).toBeCloseTo(10.76, 2);
    });

    it("the very dark colours are exactly these 14 (the Bills' blue by 0.39, held by name; the Rams' and the Vikings' are not)", () => {
      expect(TEAM_COLOURS.filter((c) => labOf(c).L < COLOUR_DARK_MAX_L)).toEqual([
        "#000000", "#002244", "#002C5F", "#00338D", "#03202F", "#041E42", "#0B162A", "#0B2265", "#0C2340", "#101820", "#203731", "#241773", "#311D00", "#5A1414",
      ]);
      expect(labOf("#00338D").L).toBeCloseTo(24.61, 2);
      expect(labOf("#003594").L).toBeCloseTo(25.82, 2);
      expect(labOf("#4F2683").L).toBeGreaterThanOrEqual(COLOUR_DARK_MAX_L);
    });

    it("the black | grey and brown cuts have at least 10 of lightness either side", () => {
      for (const c of TEAM_COLOURS) {
        const { L } = labOf(c);
        if (chromaOf(c) < COLOUR_NEUTRAL_MAX_CHROMA) {
          expect(Math.abs(L - COLOUR_BLACK_MAX_L), `${c} black | grey`).toBeGreaterThanOrEqual(10);
          expect(Math.abs(L - COLOUR_WHITE_MIN_L), `${c} grey | white`).toBeGreaterThanOrEqual(10);
        } else if (wheelHue(c) >= COLOUR_HUE_CUTS.orange && wheelHue(c) < COLOUR_HUE_CUTS.green) {
          expect(Math.abs(L - COLOUR_BROWN_MAX_L), `${c} brown`).toBeGreaterThanOrEqual(10);
        }
      }
    });
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

  it("amber is a gold; close to amber = alike amber, or an orange", () => {
    expect(colourFamily(MATCHUP_RING_AMBER)).toBe("gold");
    // an orange is a different family and can be over 40 from amber: its own clause keeps the ring grey
    expect(colourFamily("#FB4F14")).toBe("orange");
    expect(colourDistance(MATCHUP_RING_AMBER, "#FB4F14")).toBeGreaterThan(COLOUR_ALIKE_DISTANCE);
    expect(coloursAlike(MATCHUP_RING_AMBER, "#FB4F14")).toBe(false);
    expect(matchupRingColour("#FB4F14", "#002244")).toBe(MATCHUP_RING_GREY);
    expect(matchupRingColour("#002244", "#FB4F14")).toBe(MATCHUP_RING_GREY);
    for (const orange of ["#FF3C00", "#C83803", "#FC4C02", "#E66D00"]) expect(matchupRingColour(orange, "#000000"), orange).toBe(MATCHUP_RING_GREY);
  });

  it("Cleveland's brown keeps the amber ring, with no lightness clause: brown is its own family, 83 from amber", () => {
    expect(colourFamily("#311D00")).toBe("brown");
    expect(coloursAlike(MATCHUP_RING_AMBER, "#311D00")).toBe(false);
    expect(colourDistance(MATCHUP_RING_AMBER, "#311D00")).toBeCloseTo(83.4, 1);
    expect(matchupRingColour("#311D00", "#869397")).toBe(MATCHUP_RING_AMBER);
  });

  it("no team colour under the very-dark line is close to amber (why the old lightness clause could go)", () => {
    for (const c of TEAM_COLOURS.filter((x) => labOf(x).L < COLOUR_DARK_MAX_L)) {
      expect(matchupRingColour(c, "#FFFFFF"), c).toBe(MATCHUP_RING_AMBER);
    }
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

  it("no card has two colours of one family, and none has a red beside an orange (\"both teams shouldn't be in blue etc\")", () => {
    for (const { a, h, c } of ALL) {
      const families = [colourFamily(c.away), colourFamily(c.home)];
      expect(families[0], `${a} at ${h}: ${c.away} ${c.home}`).not.toBe(families[1]);
      expect(families.slice().sort(), `${a} at ${h}: ${c.away} ${c.home}`).not.toEqual(["orange", "red"]);
    }
  });

  it("what stays allowed: orange beside gold on 12 cards, brown beside a red on 14, navy or blue beside Vikings purple on 18", () => {
    const cards = (x: ColourFamily, y: ColourFamily) =>
      ALL.filter(({ c }) => [colourFamily(c.away), colourFamily(c.home)].sort().join() === [x, y].sort().join()).length;
    expect(cards("orange", "gold")).toBe(12);
    expect(cards("brown", "red")).toBe(14);
    expect(cards("brown", "orange")).toBe(5);
    expect(cards("brown", "gold")).toBe(7);
    expect(cards("blue", "purple")).toBe(18);
  });

  it("160 matchups come out in different colours by order (team colours can depend on who is home)", () => {
    const differ = PAIRS.filter(([a, h]) => {
      if (a > h) return false;
      const one = colours(a, h);
      const other = colours(h, a);
      return one.away !== other.home || one.home !== other.away;
    });
    expect(differ).toHaveLength(160);
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
    // the two of the original 21 that the colour families change
    ["CLE", "CHI", "#311D00", "primary", "#C83803", "secondary", G, "#FF3C00", "#0B162A", false],
    ["HOU", "TEN", "#A71930", "secondary", "#0C2340", "primary", A, "#03202F", "#4B92DB", true],
    // colour families spec §5.2: two blues before, one team in its second colour now
    ["CAR", "BUF", "#0085CA", "primary", "#C60C30", "secondary", A, "#101820", "#00338D", false],
    ["BUF", "CAR", "#C60C30", "secondary", "#0085CA", "primary", A, "#00338D", "#101820", true],
    ["CAR", "LA", "#0085CA", "primary", "#CC8200", "secondary-darkened", G, "#101820", "#003594", false],
    ["CAR", "NYG", "#0085CA", "primary", "#A71930", "secondary", A, "#101820", "#0B2265", false],
    ["NYG", "CAR", "#A71930", "secondary", "#0085CA", "primary", A, "#0B2265", "#101820", true],
    ["BAL", "CAR", "#000000", "secondary", "#0085CA", "primary", A, "#241773", "#101820", true],
    ["LAC", "BAL", "#0080C6", "primary", "#000000", "secondary", A, "#FFC20E", "#241773", false],
    ["TEN", "BAL", "#4B92DB", "secondary", "#000000", "secondary", A, "#0C2340", "#241773", true],
    ["DET", "BAL", "#0076B6", "primary", "#000000", "secondary", A, "#B0B7BC", "#241773", false],
    // two greens before
    ["GB", "SEA", "#BF890E", "secondary-darkened", "#002244", "primary", G, "#203731", "#69BE28", true],
    // a red beside an orange before
    ["ARI", "CIN", "#97233F", "primary", "#000000", "secondary", A, "#000000", "#FB4F14", false],
    ["ARI", "TB", "#000000", "secondary", "#D50A0A", "primary", A, "#97233F", "#FF7900", true],
    // brown is its own family: it may sit beside an orange or a red
    ["CLE", "CIN", "#311D00", "primary", "#FB4F14", "primary", G, "#FF3C00", "#000000", false],
    ["CLE", "TB", "#311D00", "primary", "#D50A0A", "primary", A, "#FF3C00", "#FF7900", false],
    // navy beside Vikings purple, 40.6 apart
    ["DAL", "MIN", "#041E42", "primary", "#4F2683", "primary", A, "#869397", "#FFC62F", false],
    ["MIN", "DAL", "#4F2683", "primary", "#041E42", "primary", A, "#FFC62F", "#869397", false],
    // unchanged by the colour families
    ["TB", "ATL", "#D50A0A", "primary", "#000000", "secondary", A, "#FF7900", "#A71930", false],
    ["SF", "SEA", "#AA0000", "primary", "#002244", "primary", A, "#B3995D", "#69BE28", false],
    ["ARI", "SF", "#97233F", "primary", "#AA9158", "secondary-darkened", G, "#000000", "#AA0000", false],
    ["BUF", "NE", "#00338D", "primary", "#C60C30", "secondary", A, "#C60C30", "#002244", false],
    ["NE", "BUF", "#002244", "primary", "#C60C30", "secondary", A, "#C60C30", "#00338D", false],
    ["WAS", "DAL", "#5A1414", "primary", "#869397", "secondary", A, "#FFB612", "#041E42", false],
    ["DET", "NYG", "#0076B6", "primary", "#A71930", "secondary", A, "#B0B7BC", "#0B2265", false],
    ["DEN", "KC", "#FB4F14", "primary", "#BF8A15", "secondary-darkened", G, "#002244", "#E31837", false],
  ];

  it.each(NAMED)("%s at %s", (a, h, away, awayFrom, home, homeFrom, ring, awayRule, homeRule, awaySwitched) => {
    expect(colours(a, h)).toEqual({ away, awayFrom, home, homeFrom, ring, awayRule, homeRule, awaySwitched, closest: false });
  });

  it("there are 45 named pairs, each once", () => {
    expect(NAMED).toHaveLength(45);
    expect(new Set(NAMED.map(([a, h]) => `${a}-${h}`)).size).toBe(45);
  });

  it("DAL at MIN is the thinnest pass: navy beside purple, 40.6 apart, the purple 0.8 over the very-dark line", () => {
    const c = colours("DAL", "MIN");
    expect(colourDistance(c.away, c.home)).toBeCloseTo(40.6, 1);
    expect(labOf(c.home).L).toBeCloseTo(25.8, 1);
    expect([colourFamily(c.away), colourFamily(c.home)]).toEqual(["blue", "purple"]);
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

  it("the whole table equals the golden (a team colour change in teams.ts, or a spec'd change of the rule, are the only reasons to write it again)", () => {
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
    expect(count((c) => c.awaySwitched)).toBe(73);
    // home sources where the away team did NOT give way (the four add up to 992 - 73 = 919)
    expect(count((c) => !c.awaySwitched && c.homeFrom === "primary")).toBe(524);
    expect(count((c) => !c.awaySwitched && c.homeFrom === "secondary")).toBe(205);
    expect(count((c) => !c.awaySwitched && c.homeFrom === "secondary-darkened")).toBe(156);
    expect(count((c) => !c.awaySwitched && c.homeFrom === "primary-darkened")).toBe(34);
    // every home source, away switched or not (colour families spec §5)
    expect(count((c) => c.homeFrom === "primary")).toBe(591);
    expect(count((c) => c.homeFrom === "secondary")).toBe(210);
    expect(count((c) => c.homeFrom === "secondary-darkened")).toBe(157);
    expect(count((c) => c.homeFrom === "primary-darkened")).toBe(34);
    expect(count((c) => c.awayFrom === "primary")).toBe(857);
    expect(count((c) => c.awayFrom === "primary-darkened")).toBe(62);
    expect(count((c) => c.awayFrom === "secondary")).toBe(38);
    expect(count((c) => c.awayFrom === "secondary-darkened")).toBe(35);
    expect(count((c) => c.ring === MATCHUP_RING_AMBER)).toBe(629);
    expect(count((c) => c.ring === MATCHUP_RING_GREY)).toBe(363);
    expect(new Set(ALL.flatMap((x) => [x.c.away, x.c.home])).size).toBe(47);
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

  it("the chain's neutrals have no family: both away colours junk is ink, and a blue home team keeps its blue (colour families spec, builder note 3)", () => {
    // ink measures blue, and so does the Rams' primary: by family they would be "alike" and the
    // Rams would be pushed to gold. Ink and slate are compared by distance and darkness only.
    expect(colourFamily(MATCHUP_CARD_INK)).toBe(colourFamily(LA.primaryColor));
    expect(colourDistance(MATCHUP_CARD_INK, LA.primaryColor)).toBeGreaterThanOrEqual(COLOUR_ALIKE_DISTANCE);
    for (const j of JUNK) {
      expect(pick(j, j, LA.primaryColor, LA.secondaryColor), String(j)).toEqual({
        away: "#0F172A", awayFrom: "ink", home: "#003594", homeFrom: "primary", awaySwitched: false,
        awayRule: "#0F172A", homeRule: "#FFA300", ring: MATCHUP_RING_AMBER, closest: false,
      });
      // …and with the Rams' gold junk too
      expect(pick(j, j, LA.primaryColor, j), String(j)).toMatchObject({ away: "#0F172A", home: "#003594", homeFrom: "primary", closest: false });
    }
  });

  it("every junk mask gives the answer it gave before the colour families (captured from the rule as it was, 2026-10-10)", () => {
    // bit 0 = BUF primary, 1 = BUF secondary, 2 = LA primary, 3 = LA secondary; a set bit is junk.
    // away, awayFrom, home, homeFrom, awayRule, homeRule, ring, awaySwitched (closest is false in all 15)
    const A = MATCHUP_RING_AMBER;
    const G = MATCHUP_RING_GREY;
    const BEFORE: Record<number, [string, MatchupColourSource, string, MatchupColourSource, string, string, string, boolean]> = {
      1: ["#C60C30", "secondary", "#003594", "primary", "#C60C30", "#FFA300", A, false],
      2: ["#00338D", "primary", "#CC8200", "secondary-darkened", "#00338D", "#003594", G, false],
      3: ["#0F172A", "ink", "#003594", "primary", "#0F172A", "#FFA300", A, false],
      4: ["#00338D", "primary", "#CC8200", "secondary-darkened", "#C60C30", "#CC8200", G, false],
      5: ["#C60C30", "secondary", "#CC8200", "secondary-darkened", "#C60C30", "#CC8200", G, false],
      6: ["#00338D", "primary", "#CC8200", "secondary-darkened", "#00338D", "#CC8200", G, false],
      7: ["#0F172A", "ink", "#CC8200", "secondary-darkened", "#0F172A", "#CC8200", G, false],
      8: ["#C60C30", "secondary", "#003594", "primary", "#00338D", "#003594", A, true],
      9: ["#C60C30", "secondary", "#003594", "primary", "#C60C30", "#003594", A, false],
      10: ["#00338D", "primary", "#64748B", "grey", "#00338D", "#003594", A, false],
      11: ["#0F172A", "ink", "#003594", "primary", "#0F172A", "#003594", A, false],
      12: ["#00338D", "primary", "#64748B", "grey", "#C60C30", "#64748B", A, false],
      13: ["#C60C30", "secondary", "#64748B", "grey", "#C60C30", "#64748B", A, false],
      14: ["#00338D", "primary", "#64748B", "grey", "#00338D", "#64748B", A, false],
      15: ["#0F172A", "ink", "#64748B", "grey", "#0F172A", "#64748B", A, false],
    };
    const real = [BUF.primaryColor, BUF.secondaryColor, LA.primaryColor, LA.secondaryColor];
    for (let mask = 1; mask < 16; mask += 1) {
      const [away, awayFrom, home, homeFrom, awayRule, homeRule, ring, awaySwitched] = BEFORE[mask];
      for (const j of JUNK) {
        const args = real.map((c, i) => (mask & (1 << i) ? j : c)) as [unknown, unknown, unknown, unknown];
        expect(pick(...args), `mask ${mask} ${String(j)}`).toEqual({ away, awayFrom, home, homeFrom, awayRule, homeRule, ring, awaySwitched, closest: false });
      }
    }
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
    expect(c.home).toBe("#64748B");
    // what step 4 guarantees for a neutral is distance (and not both very dark), not the public
    // coloursAlike: slate measures blue there, so it IS "alike" Buffalo's blue by family
    expect(colourDistance(c.away, c.home)).toBeGreaterThanOrEqual(COLOUR_ALIKE_DISTANCE);
    expect(labOf(c.home).L).toBeGreaterThanOrEqual(COLOUR_DARK_MAX_L);
    expect(coloursAlike(c.away, c.home)).toBe(true);
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
