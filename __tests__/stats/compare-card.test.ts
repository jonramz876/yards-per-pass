import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import path from "path";
import {
  buildComparison, compareGroup, ensureContrast, isHexColor, colorDistance, compareSmallSampleSentence,
  COMPARE_NEUTRAL_COLOR, CONTRAST_PALETTE, MIN_DISTANCE, QB_COMP_STATS, WR_COMP_STATS, RB_COMP_STATS,
  type CompareGroup, type ComparePlayerRow,
} from "@/lib/stats/compare";
import {
  CARD_STAT_KEYS, COMPARE_CARD_KEEP_CLEAR_Y, COMPARE_CARD_LAYOUT, COMPARE_CARD_SITE_LINE, COMPARE_CARD_SITE_SHORT,
  COMPARE_CARD_STAT_HEADER, COMPARE_FULL_LINK_TEXT, COMPARE_IMAGE_UNAVAILABLE, COMPARE_NOT_FOUND_TITLE,
  buildCompareCard, compareCanonicalPath, compareCardHref, compareCardPath, compareDownloadFilename, compareImageAlt,
  compareImageHref, compareMissingAxisNote, compareNameFontSize, compareNoStatsMessage, compareOvrText, comparePlotColors,
  comparePreviewTitle, compareSeasonLine, compareShareDescription, compareShareHeading, compareShareTitle,
  compareStatCardHref, compareStatCardLinkText, compareToolHref, parseCompareImageQuery, parseCompareSlugs,
} from "@/lib/stats/compare-card";
import { buildQBCardData, buildWRCardData, buildRBCardData } from "@/lib/stats/tecmo-card";
import { NFL_TEAMS } from "@/lib/data/teams";
import type { QBSeasonStat, ReceiverSeasonStat, RBSeasonStat } from "@/lib/types";
// Real 2026 season rows through Week 4 (see the file's _provenance line).
import rowsJson from "./fixtures/compare-2026-w4-rows.json";

// lib/stats/compare-card.ts (compare card spec 2026-10-09, PR 2): the share
// card's URL grammar, its model, its sentences and its layout numbers.

type Row = Record<string, unknown>;
const TABLES: Record<CompareGroup, Row[]> = {
  QB: rowsJson.qb as Row[], WR: rowsJson.receivers as Row[], RB: rowsJson.rb as Row[],
};
const asRows = (rows: Row[]) => rows as unknown as ComparePlayerRow[];
const find = (table: Row[], short: string): Row => {
  const hits = table.filter((r) => r.player_name === short);
  expect(hits, short).toHaveLength(1);
  return hits[0];
};
type Who = [short: string, full: string, slug: string];
const ALLEN: Who = ["J.Allen", "Josh Allen", "josh-allen"];
const STAFFORD: Who = ["M.Stafford", "Matthew Stafford", "matthew-stafford"];
const LAMB: Who = ["C.Lamb", "CeeDee Lamb", "ceedee-lamb"];
const JSN: Who = ["J.Smith-Njigba", "Jaxon Smith-Njigba", "jaxon-smith-njigba"];
const BIJAN: Who = ["Bi.Robinson", "Bijan Robinson", "bijan-robinson"];
const GIBBS: Who = ["J.Gibbs", "Jahmyr Gibbs", "jahmyr-gibbs"];
const MCBRIDE: Who = ["T.McBride", "Trey McBride", "trey-mcbride"];
const HUNTLEY: Who = ["T.Huntley", "Tyler Huntley", "tyler-huntley"];
const MVS: Who = ["M.Valdes-Scantling", "Marquez Valdes-Scantling", "marquez-valdes-scantling"];

function card(group: CompareGroup, a: Who, b: Who, table: Row[] = TABLES[group], week: number | null = 4) {
  return buildCompareCard({
    group,
    a: { slug: a[2], fullName: a[1], row: find(table, a[0]) as unknown as ComparePlayerRow },
    b: { slug: b[2], fullName: b[1], row: find(table, b[0]) as unknown as ComparePlayerRow },
    all: asRows(table), season: 2026, throughWeek: week,
  });
}

describe("the share URL: two slugs, order kept", () => {
  it("accepts what the slug generator can write", () => {
    expect(parseCompareSlugs("josh-allen", "matthew-stafford")).toEqual({ a: "josh-allen", b: "matthew-stafford" });
    expect(parseCompareSlugs("matthew-stafford", "josh-allen")).toEqual({ a: "matthew-stafford", b: "josh-allen" });
    expect(parseCompareSlugs("amon-ra-st-brown", "d-andre-swift-det")).not.toBeNull();
    expect(parseCompareSlugs("a", "b2")).not.toBeNull();
    expect(parseCompareSlugs("x".repeat(100), "y")).not.toBeNull();
  });

  it.each([
    ["Josh-Allen", "matthew-stafford"], ["josh.allen", "x"], ["d'andre-swift", "x"], ["josh allen", "x"], ["josh_allen", "x"],
    ["-josh", "x"], ["josh-", "x"], ["josh--allen", "x"], ["", "x"], ["x", ""], ["x".repeat(101), "y"],
    ["josh-allen%00", "x"], ["josh-allen/", "x"], ["jösh", "x"], ["<script>", "x"], ["compare", "Compare"],
  ])("rejects %s / %s", (a, b) => {
    expect(parseCompareSlugs(a, b)).toBeNull();
    expect(parseCompareSlugs(b, a)).toBeNull();
  });

  it("the same player twice is no comparison", () => {
    expect(parseCompareSlugs("josh-allen", "josh-allen")).toBeNull();
  });

  it("anything that is not a string is no slug", () => {
    for (const junk of [null, undefined, 7, ["josh-allen"], {}]) {
      expect(parseCompareSlugs(junk, "josh-allen")).toBeNull();
      expect(parseCompareSlugs("josh-allen", junk)).toBeNull();
    }
  });
});

describe("the image route's query string: one exact form", () => {
  const q = (s: string) => parseCompareImageQuery(new URLSearchParams(s));

  it("nothing, or season / w / download=1, once each", () => {
    expect(q("")).toEqual({ season: null, download: false });
    expect(q("season=2026")).toEqual({ season: 2026, download: false });
    expect(q("season=2025&w=18&download=1")).toEqual({ season: 2025, download: true });
    expect(q("w=5")).toEqual({ season: null, download: false });
    expect(q("download=1")).toEqual({ season: null, download: true });
  });

  it("w is a week a season can have: 1 to 22", () => {
    for (const w of [1, 9, 10, 18, 22]) expect(q(`w=${w}`), String(w)).not.toBeNull();
    for (const w of ["0", "23", "99", "100", "05", "-1", "1.5", "w", "", " 5"]) expect(q(`w=${w}`), w).toBeNull();
  });

  it.each([
    "x=1", "season=2026&x=1", "Season=2025", "utm_source=share", "season=abc", "season=", "season=2025abc", "season=02025",
    "season=1998", "season=2101", "season=99999999999999999999", "season=2025&season=2024", "w=1&w=2",
    "download=0", "download=true", "download=", "Download=1", "download=1&download=1",
  ])("anything else is no card (%s)", (s) => {
    expect(q(s)).toBeNull();
  });
});

describe("compareGroup: which stat table a position is compared in", () => {
  it("QB; WR and TE together; RB with FB", () => {
    expect(["QB", "WR", "TE", "RB", "FB"].map(compareGroup)).toEqual(["QB", "WR", "WR", "RB", "RB"]);
  });

  it("everything else has no table", () => {
    for (const p of ["K", "P", "LB", "", "qb", "WR ", null, undefined, 7, {}, ["QB"]]) expect(compareGroup(p), String(p)).toBeNull();
  });
});

describe("buildComparison refuses what it cannot compare (it used to throw a TypeError somewhere inside)", () => {
  const row = find(TABLES.QB, "J.Allen") as unknown as ComparePlayerRow;
  const base = { rowA: row, rowB: row, all: asRows(TABLES.QB), teamA: "BUF", teamB: "LA" };

  it("an unknown group", () => {
    for (const group of ["K", "TE", "qb", "", null, undefined, 7, "__proto__", "constructor", "toString"]) {
      expect(() => buildComparison({ ...base, group: group as unknown as CompareGroup }), String(group))
        .toThrow(/buildComparison: unknown group/);
    }
  });

  it("a missing row, or a table that is not a list", () => {
    for (const missing of [null, undefined]) {
      expect(() => buildComparison({ ...base, group: "QB", rowA: missing as unknown as ComparePlayerRow })).toThrow(/both players need a season row/);
      expect(() => buildComparison({ ...base, group: "QB", rowB: missing as unknown as ComparePlayerRow })).toThrow(/both players need a season row/);
    }
    expect(() => buildComparison({ ...base, group: "QB", all: null as unknown as ComparePlayerRow[] })).toThrow(/must be an array/);
  });

  it("buildCompareCard passes the refusal on", () => {
    const p = { slug: "x", fullName: "X", row };
    expect(() => buildCompareCard({ group: "K" as CompareGroup, a: p, b: p, all: asRows(TABLES.QB), season: 2026, throughWeek: 4 }))
      .toThrow(/unknown group/);
    expect(() => buildCompareCard({ group: "QB", a: p, b: { ...p, row: null as unknown as ComparePlayerRow }, all: asRows(TABLES.QB), season: 2026, throughWeek: 4 }))
      .toThrow(/season row/);
  });
});

describe("colours are always #RRGGBB, whatever comes in", () => {
  it("isHexColor", () => {
    expect(["#00338D", "#abcdef", "#ABCDEF"].every(isHexColor)).toBe(true);
    for (const bad of ["red", "#fff", "#00338", "#00338DD", "00338D", "", "rgb(0,0,0)", "#gggggg", null, undefined, 7]) {
      expect(isHexColor(bad), String(bad)).toBe(false);
    }
  });

  it("ensureContrast never returns a colour it cannot read", () => {
    for (const bad of ["red", "#fff", "", undefined, null, 7, "rgb(0, 51, 141)"]) {
      const c2 = ensureContrast("#00338D", bad as unknown as string);
      expect(isHexColor(c2), `c2 ${String(bad)}`).toBe(true);
      expect(colorDistance("#00338D", c2)).toBeGreaterThanOrEqual(MIN_DISTANCE);
      // A bad first colour is measured as the dark neutral; a readable second colour far from it is kept.
      expect(ensureContrast(bad as unknown as string, "#dc2626")).toBe("#dc2626");
      const both = ensureContrast(bad as unknown as string, bad as unknown as string);
      expect(CONTRAST_PALETTE).toContain(both);
      expect(colorDistance(COMPARE_NEUTRAL_COLOR, both)).toBeGreaterThanOrEqual(MIN_DISTANCE);
    }
  });

  it("valid colours behave exactly as before", () => {
    expect(ensureContrast("#00338D", "#003594")).toBe("#dc2626");
    expect(ensureContrast("#A71930", "#0076B6")).toBe("#0076B6");
  });

  it("comparePlotColors: each team's outline colour by the team radar's rule, then B moved away from A", () => {
    expect(comparePlotColors("BUF", "LA")).toEqual({ a: "#00338D", b: "#dc2626" });
    expect(comparePlotColors("ATL", "DET")).toEqual({ a: "#A71930", b: "#0076B6" });
    // Pittsburgh's gold does not show on white: its black secondary is used.
    const pit = NFL_TEAMS.find((t) => t.id === "PIT")!;
    expect(comparePlotColors("PIT", "BUF").a).toBe(pit.secondaryColor);
    expect(comparePlotColors("PIT", "BUF").a).not.toBe(pit.primaryColor);
  });

  it("for every pair of teams: two readable colours, far enough apart, each dark enough to carry white or black text", () => {
    for (const t1 of NFL_TEAMS) for (const t2 of NFL_TEAMS) {
      const { a, b } = comparePlotColors(t1.id, t2.id);
      expect(isHexColor(a) && isHexColor(b), `${t1.id}/${t2.id}`).toBe(true);
      expect(colorDistance(a, b), `${t1.id}/${t2.id}`).toBeGreaterThanOrEqual(MIN_DISTANCE);
    }
  });

  it("an unknown, missing or junk team id is the dark neutral, never a crash", () => {
    for (const bad of ["???", "", null, undefined, 7, "buf"]) {
      const { a, b } = comparePlotColors(bad, bad);
      expect(a).toBe(COMPARE_NEUTRAL_COLOR);
      expect(isHexColor(b)).toBe(true);
      expect(b).not.toBe(a);
    }
  });
});

describe("links", () => {
  it("the share page: order kept, bare for the default season", () => {
    expect(compareCardPath("josh-allen", "matthew-stafford")).toBe("/card/compare/josh-allen/matthew-stafford");
    expect(compareCardHref("josh-allen", "matthew-stafford", 2026, 2026)).toBe("/card/compare/josh-allen/matthew-stafford");
    expect(compareCardHref("matthew-stafford", "josh-allen", 2025, 2026)).toBe("/card/compare/matthew-stafford/josh-allen?season=2025");
  });

  it("the canonical is the alphabetical order, for both mirrored pages", () => {
    expect(compareCanonicalPath("matthew-stafford", "josh-allen")).toBe("/card/compare/josh-allen/matthew-stafford");
    expect(compareCanonicalPath("josh-allen", "matthew-stafford")).toBe("/card/compare/josh-allen/matthew-stafford");
  });

  it("the image: always the season; the week only when it is a real week; download on request", () => {
    expect(compareImageHref("a", "b", 2026)).toBe("/api/compare-card/a/b?season=2026");
    expect(compareImageHref("a", "b", 2026, { week: 4 })).toBe("/api/compare-card/a/b?season=2026&w=4");
    expect(compareImageHref("a", "b", 2025, { week: 18, download: true })).toBe("/api/compare-card/a/b?season=2025&w=18&download=1");
    for (const week of [null, undefined, 0, 23, 4.5, NaN]) {
      expect(compareImageHref("a", "b", 2026, { week: week as number })).toBe("/api/compare-card/a/b?season=2026");
    }
  });

  it("every image link the page can print is one the route accepts", () => {
    for (const week of [null, 1, 4, 18, 22]) for (const download of [false, true]) {
      const href = compareImageHref("josh-allen", "matthew-stafford", 2026, { week, download });
      expect(parseCompareImageQuery(new URL(href, "https://x").searchParams), href).not.toBeNull();
    }
  });

  it("the downloaded file's name is built from the slug grammar only", () => {
    expect(compareDownloadFilename("josh-allen", "matthew-stafford", 2026)).toBe("josh-allen-vs-matthew-stafford-2026.png");
    expect(compareDownloadFilename('a"\r\nx: y', "b/../c", 2026)).toBe("axy-vs-bc-2026.png");
    expect(compareDownloadFilename("", "", NaN)).toBe("player-vs-player-0.png");
  });

  it("on to the Compare page and to each stat card, with the season kept", () => {
    expect(compareToolHref("josh-allen", "matthew-stafford", 2026, 2026)).toBe("/compare?p1=josh-allen&p2=matthew-stafford");
    expect(compareToolHref("josh-allen", "matthew-stafford", 2025, 2026)).toBe("/compare?p1=josh-allen&p2=matthew-stafford&season=2025");
    expect(compareStatCardHref("josh-allen", 2026, 2026)).toBe("/card/josh-allen");
    expect(compareStatCardHref("josh-allen", 2025, 2026)).toBe("/card/josh-allen?season=2025");
  });
});

describe("sentences (the spec's copy table)", () => {
  it("C1, C1b, heading, C16", () => {
    expect(compareShareTitle("Josh Allen", "Matthew Stafford", 2026)).toBe("Josh Allen vs Matthew Stafford — 2026 — Yards Per Pass");
    expect(compareShareTitle("A", "B", 2026).match(/Yards Per Pass/g)).toHaveLength(1);
    expect(comparePreviewTitle("Josh Allen", "Matthew Stafford")).toBe("Josh Allen vs Matthew Stafford");
    expect(compareShareHeading("Josh Allen", "Matthew Stafford", 2026)).toBe("Josh Allen vs Matthew Stafford — 2026");
    expect(compareImageAlt("Josh Allen", "Matthew Stafford", 2026)).toBe("Josh Allen vs Matthew Stafford comparison card, 2026");
  });

  it("C3: the season line, with the week only when it is known", () => {
    expect(compareSeasonLine(2026, 4)).toBe("2026 season · Through Week 4");
    expect(compareSeasonLine(2025, null)).toBe("2025 season");
  });

  it("C2: the description names each player's position and team from his season row", () => {
    expect(compareShareDescription(card("QB", ALLEN, STAFFORD))).toBe(
      "Josh Allen (QB, Buffalo Bills) vs Matthew Stafford (QB, Los Angeles Rams), 2026 through Week 4: overlaid radar and head-to-head stats.");
    expect(compareShareDescription(card("WR", LAMB, MCBRIDE, TABLES.WR, null))).toBe(
      "CeeDee Lamb (WR, Dallas Cowboys) vs Trey McBride (TE, Arizona Cardinals), 2026: overlaid radar and head-to-head stats.");
  });

  it("C7, C8, C9, C12, C14, C15", () => {
    expect(compareMissingAxisNote("YPRR", 2026)).toBe("YPRR is not available for 2026.");
    expect(COMPARE_CARD_SITE_LINE).toBe("YARDSPERPASS.COM · DATA: NFLVERSE");
    expect(COMPARE_CARD_SITE_SHORT).toBe("YARDSPERPASS.COM");
    expect(COMPARE_CARD_STAT_HEADER).toBe("STAT");
    expect(COMPARE_FULL_LINK_TEXT).toBe("See the full comparison →");
    expect(compareStatCardLinkText("Josh Allen")).toBe("Josh Allen stat card →");
    expect(COMPARE_IMAGE_UNAVAILABLE).toBe("Comparison image temporarily unavailable. Try again in a few minutes.");
    expect(COMPARE_NOT_FOUND_TITLE).toBe("Comparison Not Found — Yards Per Pass");
  });

  it("C10: nothing to compare, four ways", () => {
    const base = { nameA: "CeeDee Lamb", nameB: "Jaxon Smith-Njigba", season: 2026, isNewestSeason: true };
    expect(compareNoStatsMessage({ ...base, missingA: true, missingB: false })).toBe(
      "CeeDee Lamb has no 2026 stats yet, so there is nothing to compare. Comparisons update the day after each game.");
    expect(compareNoStatsMessage({ ...base, missingA: false, missingB: true })).toBe(
      "Jaxon Smith-Njigba has no 2026 stats yet, so there is nothing to compare. Comparisons update the day after each game.");
    expect(compareNoStatsMessage({ ...base, missingA: true, missingB: true })).toBe(
      "CeeDee Lamb and Jaxon Smith-Njigba have no 2026 stats yet, so there is nothing to compare. Comparisons update the day after each game.");
    const past = { ...base, season: 2021, isNewestSeason: false };
    expect(compareNoStatsMessage({ ...past, missingA: false, missingB: true })).toBe(
      "Jaxon Smith-Njigba has no stats for the 2021 season, so there is nothing to compare.");
    expect(compareNoStatsMessage({ ...past, missingA: true, missingB: true })).toBe(
      "CeeDee Lamb and Jaxon Smith-Njigba have no stats for the 2021 season, so there is nothing to compare.");
    // A past season can never fill up: no "yet" there.
    expect(compareNoStatsMessage({ ...past, missingA: true, missingB: false })).not.toMatch(/\byet\b/);
  });

  it("the OVR badge: the number, or a dash for a player under the line", () => {
    expect(compareOvrText(91)).toBe("91");
    expect(compareOvrText(0)).toBe("0");
    for (const none of [null, NaN, Infinity]) expect(compareOvrText(none as number | null)).toBe("—");
  });

  it("C6 on the card ends with \" OVR hidden.\"; on /compare it does not", () => {
    const c = card("QB", HUNTLEY, ALLEN).comparison;
    expect(compareSmallSampleSentence(c, "Tyler Huntley", "Josh Allen", { ovrHidden: true })).toBe(
      "Small sample: T.Huntley has 9 pass attempts in 1 game (under 14 a game). OVR hidden.");
    expect(compareSmallSampleSentence(c, "Tyler Huntley", "Josh Allen")).toBe(
      "Small sample: T.Huntley has 9 pass attempts in 1 game (under 14 a game).");
  });
});

describe("the seven rows on the card", () => {
  const STATS = { QB: QB_COMP_STATS, WR: WR_COMP_STATS, RB: RB_COMP_STATS };

  it("seven per group, each one of the Compare table's own rows", () => {
    for (const group of ["QB", "WR", "RB"] as const) {
      expect(CARD_STAT_KEYS[group]).toHaveLength(7);
      expect(new Set(CARD_STAT_KEYS[group]).size).toBe(7);
      for (const key of CARD_STAT_KEYS[group]) expect(STATS[group].filter((s) => s.key === key), `${group} ${key}`).toHaveLength(1);
    }
  });

  it("the labels the spec lists, in its order", () => {
    const labels = (group: CompareGroup, a: Who, b: Who) => card(group, a, b).rows.map((r) => r.label);
    expect(labels("QB", ALLEN, STAFFORD)).toEqual(["Pass Yds", "Pass TD", "INT", "EPA/DB", "CPOE", "ANY/A", "FPts"]);
    expect(labels("WR", LAMB, JSN)).toEqual(["Targets", "Receptions", "Yards", "TDs", "EPA/Tgt", "CROE", "FPts (PPR)"]);
    expect(labels("RB", BIJAN, GIBBS)).toEqual(["Carries", "Rush Yds", "Rush TD", "YPC", "EPA/Car", "Success%", "FPts (PPR)"]);
  });

  it("each card row IS the Compare page's row for that stat: same text, same winner", () => {
    for (const [group, a, b] of [["QB", ALLEN, STAFFORD], ["WR", LAMB, JSN], ["RB", BIJAN, GIBBS], ["WR", LAMB, MCBRIDE], ["QB", HUNTLEY, ALLEN]] as [CompareGroup, Who, Who][]) {
      const table = TABLES[group];
      const rowA = find(table, a[0]), rowB = find(table, b[0]);
      const onCompare = buildComparison({
        group, rowA: rowA as unknown as ComparePlayerRow, rowB: rowB as unknown as ComparePlayerRow, all: asRows(table),
        teamA: rowA.team_id as string, teamB: rowB.team_id as string,
      });
      const m = card(group, a, b);
      for (const row of m.rows) expect(onCompare.rows).toContainEqual(row);
      // And the radar is the Compare page's too.
      expect(m.comparison.a.values).toEqual(onCompare.a.values);
      expect(m.comparison.b.values).toEqual(onCompare.b.values);
      expect(m.comparison.a.missing).toEqual(onCompare.a.missing);
      expect(m.comparison.rows).toEqual(onCompare.rows);
    }
  });

  it("the spec's rows for the three mockup pairs (section 6.4)", () => {
    const cells = (m: ReturnType<typeof card>) => m.rows.map((r) => `${r.a}${r.winner === 1 ? "*" : ""} ${r.label} ${r.b}${r.winner === 2 ? "*" : ""}`);
    expect(cells(card("QB", ALLEN, STAFFORD))).toEqual([
      "1039 Pass Yds 1189*", "6 Pass TD 6", "3* INT 6", "0.29* EPA/DB 0.05", "+6.0* CPOE -0.1", "7.61* ANY/A 5.94", "112.9* FPts 62.2"]);
    expect(cells(card("WR", LAMB, JSN))).toEqual([
      "46* Targets 42", "37* Receptions 32", "498* Yards 481", "4 TDs 6*", "0.88* EPA/Tgt 0.77", "+15.1%* CROE +13.7%", "110.8 FPts (PPR) 116.1*"]);
    expect(cells(card("RB", BIJAN, GIBBS))).toEqual([
      "85* Carries 80", "494* Rush Yds 353", "4 Rush TD 5*", "5.8* YPC 4.4", "0.13* EPA/Car -0.02", "54.1%* Success% 47.5%", "105.4 FPts (PPR) 116.1*"]);
  });
});

describe("the card's model", () => {
  it("OVR is the stat card's number for the same rows, by construction", () => {
    const qbs = TABLES.QB as unknown as QBSeasonStat[];
    const recs = TABLES.WR as unknown as ReceiverSeasonStat[];
    const rbs = TABLES.RB as unknown as RBSeasonStat[];
    const qb = card("QB", ALLEN, STAFFORD);
    expect([qb.a.ovr, qb.b.ovr]).toEqual([
      buildQBCardData(qbs.find((r) => r.player_name === "J.Allen")!, qbs, 2026).ovr,
      buildQBCardData(qbs.find((r) => r.player_name === "M.Stafford")!, qbs, 2026).ovr,
    ]);
    const wr = card("WR", LAMB, MCBRIDE);
    expect([wr.a.ovr, wr.b.ovr]).toEqual([
      buildWRCardData(recs.find((r) => r.player_name === "C.Lamb")!, recs, 2026).ovr,
      buildWRCardData(recs.find((r) => r.player_name === "T.McBride")!, recs, 2026).ovr,
    ]);
    const rb = card("RB", BIJAN, GIBBS);
    expect([rb.a.ovr, rb.b.ovr]).toEqual([
      buildRBCardData(rbs.find((r) => r.player_name === "Bi.Robinson")!, rbs, 2026).ovr,
      buildRBCardData(rbs.find((r) => r.player_name === "J.Gibbs")!, rbs, 2026).ovr,
    ]);
    // The numbers the live stat cards showed on 2026-10-07 (spec section 6.4).
    expect([qb.a.ovr, qb.b.ovr, wr.a.ovr, rb.a.ovr, rb.b.ovr, card("WR", LAMB, JSN).b.ovr]).toEqual([91, 76, 97, 96, 85, 96]);
  });

  it("a player under the line: OVR is null (a dash), and the strip says why", () => {
    const m = card("QB", HUNTLEY, ALLEN);
    expect(m.a.ovr).toBeNull();
    expect(m.b.ovr).toBe(91);
    expect(m.stripLine).toBe("Small sample: T.Huntley has 9 pass attempts in 1 game (under 14 a game). OVR hidden.");
    expect(m.smallSampleLine).toBe(m.stripLine);
    expect(card("QB", ALLEN, STAFFORD).stripLine).toBeNull();
  });

  it("who is who: names, the season row's position and team, games, colours", () => {
    const m = card("WR", LAMB, MCBRIDE);
    expect(m.a).toMatchObject({
      slug: "ceedee-lamb", fullName: "CeeDee Lamb", headerName: "C.Lamb", position: "WR", teamId: "DAL", teamName: "Dallas Cowboys",
      games: 4, meta: "WR · Dallas Cowboys · 4 games", color: "#041E42", textColor: "#ffffff",
    });
    expect(m.b).toMatchObject({ position: "TE", teamName: "Arizona Cardinals", meta: "TE · Arizona Cardinals · 4 games", color: "#97233F" });
    expect(card("QB", HUNTLEY, ALLEN).a.meta).toBe("QB · Baltimore Ravens · 1 game");
  });

  it("the team is the SEASON ROW's, not anything the caller knows about today", () => {
    const traded = TABLES.QB.map((r) => (r.player_name === "J.Allen" ? { ...r, team_id: "KC" } : r));
    const m = card("QB", ALLEN, STAFFORD, traded);
    expect(m.a.teamName).toBe("Kansas City Chiefs");
    expect(m.a.color).toBe(comparePlotColors("KC", "LA").a);
  });

  it("near-identical team colours: player B is moved to red, on the band and the outline alike", () => {
    const m = card("QB", ALLEN, STAFFORD);
    expect([m.a.color, m.b.color]).toEqual(["#00338D", "#dc2626"]);
    expect(m.b.textColor).toBe("#ffffff");
  });

  it("the sub-band: the season line, then the pool line, the same sentence /compare prints", () => {
    expect(card("QB", ALLEN, STAFFORD).subBandLine).toBe(
      "2026 season · Through Week 4 · Radar: percentile among the 42 qualified quarterbacks (14+ pass attempts a game).");
    expect(card("WR", LAMB, MCBRIDE).subBandLine).toBe(
      "2026 season · Through Week 4 · Radar: each player against qualified players at his position (2+ targets a game): 129 WRs, 56 TEs.");
    expect(card("RB", BIJAN, GIBBS, TABLES.RB, null).subBandLine).toBe(
      "2026 season · Radar: percentile among the 54 qualified running backs (6+ carries a game).");
  });

  it("too few qualified players: no radar, the sub-band keeps only the season line, the pane gets the sentence", () => {
    const two = TABLES.QB.filter((r) => ["J.Allen", "T.Huntley"].includes(r.player_name as string));
    const m = card("QB", ALLEN, HUNTLEY, two);
    expect(m.radarDrawn).toBe(false);
    expect(m.subBandLine).toBe("2026 season · Through Week 4");
    expect(m.poolLine).toBeNull();
    expect(m.tooFewLine).toBe("Not enough qualified quarterbacks to draw the radar (14+ pass attempts a game).");
    expect(m.missingAxisNotes).toEqual([]);
    expect(m.rows).toHaveLength(7);
  });

  it("a missing axis for both players is named (C7); for one player it is not", () => {
    expect(card("WR", LAMB, JSN).missingAxisNotes).toEqual(["YPRR is not available for 2026."]);
    expect(card("WR", MVS, LAMB).missingAxisNotes).toEqual(["YPRR is not available for 2026."]);
    expect(card("QB", ALLEN, STAFFORD).missingAxisNotes).toEqual([]);
  });

  it("one outline left out: the line under the radar says so in place of the legend", () => {
    const withThree = TABLES.WR.map((r) => (r.player_name === "M.Valdes-Scantling" ? { ...r, croe: null } : r));
    const m = card("WR", MVS, LAMB, withThree);
    expect(m.radarDrawn).toBe(true);
    expect(m.notDrawnLines).toEqual(["No outline for M.Valdes-Scantling: 3 of his 6 radar stats are not available."]);
    expect(m.paneLine).toBe(m.notDrawnLines[0]);
    expect(card("WR", LAMB, JSN).paneLine).toBe("Farther out = higher percentile · dashed ring = 50th percentile");
  });

  it("two players with the same short name: full names over the table columns and in the sentences", () => {
    const a = { ...find(TABLES.QB, "T.Huntley"), player_id: "a", player_name: "J.Williams" };
    const b = { ...find(TABLES.QB, "A.Dalton"), player_id: "b", player_name: "J.Williams" };
    const m = buildCompareCard({
      group: "QB", a: { slug: "jameson-williams", fullName: "Jameson Williams", row: a as unknown as ComparePlayerRow },
      b: { slug: "javonte-williams", fullName: "Javonte Williams", row: b as unknown as ComparePlayerRow },
      all: asRows([...TABLES.QB, a, b]), season: 2026, throughWeek: 4,
    });
    expect([m.a.headerName, m.b.headerName]).toEqual(["Jameson Williams", "Javonte Williams"]);
    expect(m.stripLine).toBe(
      "Small sample: Jameson Williams has 9 pass attempts in 1 game; Javonte Williams has 1 pass attempt in 1 game (under 14 a game). OVR hidden.");
  });

  it("a missing full name falls back to the short name, then the slug; a junk week is no week", () => {
    const m = buildCompareCard({
      group: "QB",
      a: { slug: "josh-allen", fullName: null, row: find(TABLES.QB, "J.Allen") as unknown as ComparePlayerRow },
      b: { slug: "matthew-stafford", fullName: "  ", row: { ...find(TABLES.QB, "M.Stafford"), player_name: null } as unknown as ComparePlayerRow },
      all: asRows(TABLES.QB), season: 2026, throughWeek: NaN,
    });
    expect([m.a.fullName, m.b.fullName]).toEqual(["J.Allen", "Matthew Stafford"]);
    expect(m.throughWeek).toBeNull();
    expect(m.seasonLine).toBe("2026 season");
  });

  it("nothing on the card is NaN, undefined or null as text", () => {
    for (const m of [card("QB", ALLEN, STAFFORD), card("WR", MVS, LAMB), card("QB", HUNTLEY, ALLEN), card("WR", LAMB, MCBRIDE)]) {
      const text = JSON.stringify([m.a, m.b, m.rows, m.seasonLine, m.poolLine, m.subBandLine, m.stripLine, m.paneLine, m.notDrawnLines, m.missingAxisNotes]);
      expect(text).not.toMatch(/NaN|undefined/);
      for (const v of [...m.comparison.a.values, ...m.comparison.b.values]) expect(Number.isFinite(v)).toBe(true);
    }
  });
});

describe("the image's layout numbers", () => {
  const L = COMPARE_CARD_LAYOUT;

  it("the blocks stack to exactly 630, and everything a reader needs ends at the keep-clear line", () => {
    expect(L.band + L.rule + L.subBand + L.body + L.strip + L.footer).toBe(L.height);
    expect([L.width, L.height]).toEqual([1200, 630]);
    expect(L.band + L.rule + L.subBand + L.body + L.strip).toBe(COMPARE_CARD_KEEP_CLEAR_Y);
    expect(COMPARE_CARD_KEEP_CLEAR_Y).toBe(522);
  });

  it("the radar, its labels and the legend line fit inside the pane, for 6 and 7 axes", () => {
    const R = L.radar;
    const radarHeight = L.body - L.legend.height;
    expect(R.cy - R.r - R.gap - R.labelHeight).toBeGreaterThanOrEqual(0);
    expect(R.cy + R.r + R.gap + R.labelHeight).toBeLessThanOrEqual(radarHeight);
    // The widest labels at 17 px Noto Sans are about 105 px ("Ball Security").
    for (const n of [6, 7]) {
      for (let i = 0; i < n; i++) {
        const cos = Math.cos(-Math.PI / 2 + (i * Math.PI * 2) / n);
        const x = R.cx + (R.r + R.gap) * cos;
        if (cos > 0.3) expect(L.pane - x).toBeGreaterThanOrEqual(120);
        if (cos < -0.3) expect(x).toBeGreaterThanOrEqual(120);
      }
    }
  });

  it("the table fits beside the radar: a header and seven rows inside the body", () => {
    expect(L.table.head + L.table.row * L.table.rows).toBeLessThanOrEqual(L.body);
    expect(CARD_STAT_KEYS.QB).toHaveLength(L.table.rows);
  });

  it("band names: the pixel font is one em per character, so 21, 26 and 33 characters fit the box and the 34th is cut", () => {
    expect([1, 21, 22, 26, 27, 33, 34, 60].map(compareNameFontSize)).toEqual([20, 20, 16, 16, 13, 13, 13, 13]);
    for (const n of [21, 26, 33]) expect(n * compareNameFontSize(n)).toBeLessThanOrEqual(L.nameBox);
    expect(34 * compareNameFontSize(34)).toBeGreaterThan(L.nameBox);
    for (const name of ["D'ANDRE SWIFT", "AMON-RA ST. BROWN", "DORIAN THOMPSON-ROBINSON"]) {
      expect(name.length * compareNameFontSize(name.length)).toBeLessThanOrEqual(L.nameBox);
    }
    // The box ends before the OVR badge (x 478 in each 600-wide half).
    expect(L.pad + L.nameBox).toBeLessThanOrEqual(478);
  });
});

describe("lib/stats/compare-card.ts stays pure", () => {
  const ROOT = path.join(__dirname, "..", "..");
  const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");
  const runtimeImports = (source: string): string[] =>
    Array.from(source.matchAll(/^\s*(?:import|export)\s+(?!type\b)[^;]*?from\s+["']([^"']+)["']/gm)).map((m) => m[1])
      .concat(Array.from(source.matchAll(/^\s*import\s+["']([^"']+)["']/gm)).map((m) => m[1]));
  function resolve(from: string, spec: string): string | null {
    const base = spec.startsWith("@/") ? spec.slice(2) : spec.startsWith(".") ? path.posix.join(path.posix.dirname(from), spec) : null;
    if (base === null) return null;
    for (const ext of [".ts", ".tsx", "/index.ts"]) {
      try { read(base + ext); return base + ext; } catch { /* next */ }
    }
    throw new Error(`cannot resolve ${spec} from ${from}`);
  }

  it("everything it pulls in, followed import by import, is lib/stats or the static team list: no React, Next, Supabase or other package", () => {
    const files: string[] = [];
    const packages = new Set<string>();
    const todo = ["lib/stats/compare-card.ts"];
    while (todo.length > 0) {
      const file = todo.pop()!;
      if (files.includes(file)) continue;
      files.push(file);
      for (const spec of runtimeImports(read(file))) {
        const next = resolve(file, spec);
        if (next === null) packages.add(spec); else todo.push(next);
      }
    }
    for (const f of ["lib/stats/compare.ts", "lib/stats/tecmo-card.ts", "lib/stats/team-radar.ts", "lib/data/teams.ts"]) expect(files).toContain(f);
    expect(files.filter((f) => f.startsWith("lib/data/"))).toEqual(["lib/data/teams.ts"]);
    for (const f of files) {
      expect(f, f).toMatch(/^lib\/(stats|data)\//);
      expect(read(f), f).not.toMatch(/^\s*["']use client["']/m);
    }
    expect(Array.from(packages)).toEqual([]);
  });
});
