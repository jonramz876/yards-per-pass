import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import path from "path";
import {
  buildComparison, ensureContrast, colorDistance, getStatVal,
  comparePoolSentence, compareTooFewSentence, compareSmallSampleSentence, compareNotDrawnSentences, comparePlotColors, COMPARE_RADAR_LEGEND,
  compareDisplayName, compareTeamId,
  CONTRAST_PALETTE, MIN_DISTANCE, QB_COMP_STATS, WR_COMP_STATS, RB_COMP_STATS,
  type CompareGroup, type ComparePlayerRow,
} from "@/lib/stats/compare";
import {
  buildQBCardData, buildWRCardData, buildRBCardData,
  qbCardPool, rbCardPool, wrCardPool, qbEligible, rbEligible, wrEligible,
  QB_MIN_ATT_PER_GAME, WR_MIN_TGT_PER_GAME, RB_MIN_CAR_PER_GAME,
} from "@/lib/stats/tecmo-card";
import { radarHasTooFewAxes } from "@/lib/stats/radar";
import { getTeamColor } from "@/lib/data/teams";
import type { QBSeasonStat, ReceiverSeasonStat, RBSeasonStat } from "@/lib/types";
// Real 2026 season rows through Week 4 (see the file's _provenance line).
import rowsJson from "./fixtures/compare-2026-w4-rows.json";
// The Python reference's numbers for the stat card's pools (each player against
// the qualified players of his own position), unrounded.
import goldJson from "./fixtures/compare-card-pool.expected.json";

// lib/stats/compare.ts (compare card spec 2026-10-09). PR 1 moved the Compare
// page's maths here; PR 1b made the radar rank each player in the stat card's
// pool, so a player has one radar shape on his card and on /compare.

type Row = Record<string, unknown>;
const TABLES: Record<CompareGroup, Row[]> = {
  QB: rowsJson.qb as Row[], WR: rowsJson.receivers as Row[], RB: rowsJson.rb as Row[],
};
const asRows = (rows: Row[]) => rows as unknown as ComparePlayerRow[];
const asRow = (row: Row) => row as unknown as ComparePlayerRow;
const raw = (rows: Row[]): Row[] =>
  rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v === null ? "NaN" : v])));

/** A row by its short name, or "name@TEAM" when two players share one. */
function find(table: Row[], who: string): Row {
  const [name, team] = who.split("@");
  const hits = table.filter((r) => r.player_name === name && (!team || r.team_id === team));
  expect(hits, who).toHaveLength(1);
  return hits[0];
}

function compare(group: CompareGroup, a: string, b: string, table: Row[] = TABLES[group]) {
  const rowA = find(table, a);
  const rowB = find(table, b);
  return buildComparison({
    group, rowA: asRow(rowA), rowB: asRow(rowB), all: asRows(table),
    teamA: rowA.team_id as string, teamB: rowB.team_id as string,
  });
}

/** The receiver radar's stats, for made-up rows: without them a row has too few axes to be drawn. */
const RADAR_STATS = { epa_per_target: 0.1, croe: 0.01, air_yards_per_target: 8, yac_per_reception: 4 };

type GoldSide = {
  shortName: string; name: string; team: string; color: string; position: string; poolSize: number;
  eligible: boolean; volume: number; games: number; values: (number | null)[];
};
type GoldPair = {
  group: CompareGroup; axes: string[]; a: GoldSide; b: GoldSide;
  rows: { key: string; label: string; a: string; b: string; winner: number }[];
};
const GOLD = goldJson.pairs as unknown as Record<string, GoldPair>;

describe("buildComparison against the Python reference: the stat card's pools, exact numbers", () => {
  it("the reference covers these seven pairs", () => {
    expect(Object.keys(GOLD).sort()).toEqual(["LOWQB", "QB", "RB", "TE", "WR", "WRRB", "WRTE"]);
  });

  for (const [key, gold] of Object.entries(GOLD)) {
    it(`${key}: ${gold.a.shortName} vs ${gold.b.shortName}`, () => {
      const got = compare(gold.group, `${gold.a.shortName}@${gold.a.team}`, `${gold.b.shortName}@${gold.b.team}`);
      for (const side of ["a", "b"] as const) {
        const g = gold[side];
        const p = got[side];
        // Unrounded on both sides: (values below his / pool size) * 100 is the
        // same arithmetic in Python and JavaScript. null = a missing axis.
        expect(p.values.map((v, i) => (p.missing[i] ? null : v)), `${key} ${side} values`).toEqual(g.values);
        expect(p.poolSize).toBe(g.poolSize);
        expect(p.poolPosition).toBe(g.position);
        expect(p.eligible).toBe(g.eligible);
        expect(p.volume).toBe(g.volume);
        expect(p.games).toBe(g.games);
        expect(p.shortName).toBe(g.shortName);
        expect(p.color).toBe(g.color);
      }
      expect(got.radar).toBe("drawn");
      expect(got.axes.map((a) => a.label)).toEqual(gold.axes);
      expect(got.rows).toEqual(gold.rows);
    });
  }

  it("the spec's table (section 6.4): Allen and Stafford among the 42 qualified quarterbacks", () => {
    const got = compare("QB", "J.Allen", "M.Stafford");
    const round1 = (xs: number[]) => xs.map((v) => Math.round(v * 10) / 10);
    expect(round1(got.a.values)).toEqual([83.3, 81.0, 42.9, 88.1, 35.7, 42.9, 97.6]);
    expect(round1(got.b.values)).toEqual([45.2, 31.0, 88.1, 83.3, 16.7, 47.6, 9.8]);
  });
});

describe("the pool is the stat card's, called and not copied", () => {
  it("the three pool functions are the card's eligibility filters", () => {
    const qbs = TABLES.QB as unknown as QBSeasonStat[];
    const rbs = TABLES.RB as unknown as RBSeasonStat[];
    const recs = TABLES.WR as unknown as ReceiverSeasonStat[];
    expect(qbCardPool(qbs)).toEqual(qbs.filter(qbEligible));
    expect(rbCardPool(rbs)).toEqual(rbs.filter(rbEligible));
    for (const pos of ["WR", "TE", "RB"]) {
      expect(wrCardPool(recs, pos)).toEqual(recs.filter((r) => r.position === pos && wrEligible(r)));
    }
    expect([qbCardPool(qbs).length, rbCardPool(rbs).length]).toEqual([42, 54]);
    expect(["WR", "TE", "RB"].map((p) => wrCardPool(recs, p).length)).toEqual([129, 56, 57]);
    expect(wrCardPool(recs, "K")).toEqual([]);
  });

  it("the direct tie: every quarterback's radar on /compare is his stat card's radar", () => {
    const qbs = TABLES.QB as unknown as QBSeasonStat[];
    for (const me of qbs) {
      const card = buildQBCardData(me, qbs, 2026);
      const got = buildComparison({ group: "QB", rowA: me, rowB: qbs[0], all: qbs, teamA: "BUF", teamB: "KC" });
      expect(got.a.values, me.player_name).toEqual(card.radarValues);
      expect(got.a.missing).toEqual(card.radarValues.map(() => false));
      expect(got.a.eligible).toBe(card.eligible);
    }
  });

  it("the direct tie: every running back's", () => {
    const rbs = TABLES.RB as unknown as RBSeasonStat[];
    for (const me of rbs) {
      const card = buildRBCardData(me, rbs, 2026);
      const got = buildComparison({ group: "RB", rowA: rbs[0], rowB: me, all: rbs, teamA: "BUF", teamB: "KC" });
      expect(got.b.values, me.player_name).toEqual(card.radarValues);
      expect(got.b.missing).toEqual(card.radarValues.map(() => false));
      expect(got.b.eligible).toBe(card.eligible);
    }
  });

  it("the direct tie: every row of the receiver table (WR, TE and the RB rows), values and missing mask", () => {
    const recs = TABLES.WR as unknown as ReceiverSeasonStat[];
    const seen = new Set<string>();
    for (const me of recs) {
      seen.add(me.position);
      const card = buildWRCardData(me, recs, 2026);
      const got = buildComparison({ group: "WR", rowA: me, rowB: recs[0], all: recs, teamA: "BUF", teamB: "KC" });
      expect(got.a.values, me.player_name).toEqual(card.radarValues);
      expect(got.a.missing, me.player_name).toEqual(card.radarMissing);
      expect(got.a.eligible).toBe(card.eligible);
      expect(got.a.poolPosition).toBe(me.position);
      for (const v of got.a.values) expect(Number.isNaN(v)).toBe(false);
    }
    expect(Array.from(seen).sort()).toEqual(["RB", "TE", "WR"]);
  });

  it("a WR against a TE: each is ranked in his own pool, whichever side he is on", () => {
    const wrTe = compare("WR", "C.Lamb", "T.McBride");
    const teWr = compare("WR", "T.McBride", "C.Lamb");
    expect([wrTe.a.poolSize, wrTe.b.poolSize]).toEqual([129, 56]);
    expect([wrTe.a.poolPosition, wrTe.b.poolPosition]).toEqual(["WR", "TE"]);
    expect(teWr.a.values).toEqual(wrTe.b.values);
    expect(teWr.b.values).toEqual(wrTe.a.values);
    // And each equals what he gets against a player of his own position.
    expect(wrTe.a.values).toEqual(compare("WR", "C.Lamb", "J.Smith-Njigba").a.values);
    expect(wrTe.b.values).toEqual(compare("WR", "T.McBride", "S.LaPorta").a.values);
  });

  it("a receiver-table row whose position is RB is ranked against the qualified RB rows of that table, as his row's stat card would be", () => {
    const got = compare("WR", "C.Lamb", "A.Jones@MIN");
    expect(got.b.poolPosition).toBe("RB");
    expect(got.b.poolSize).toBe(57);
    expect(comparePoolSentence(got)).toBe(
      "Radar: each player against qualified players at his position (2+ targets a game): 129 WRs, 57 RBs.");
  });

  it("a player under the line is ranked against the qualified pool (he is not in it) and flagged", () => {
    const got = compare("QB", "T.Huntley", "J.Allen");
    expect(got.a.eligible).toBe(false);
    expect(got.b.eligible).toBe(true);
    expect(got.a.poolSize).toBe(42);
    expect(got.radar).toBe("drawn");
    expect([got.a.volume, got.a.games]).toEqual([9, 1]);
  });
});

describe("pools of 0, 1 and 2", () => {
  const qb = (id: string, attempts: number, games: number, epa: number): Row =>
    ({ player_id: id, player_name: id, team_id: "BUF", attempts, games, dropbacks: attempts, epa_per_db: epa, interceptions: 0, rush_attempts: 0 });
  const build = (rows: Row[]) =>
    buildComparison({ group: "QB", rowA: asRow(rows[0]), rowB: asRow(rows[1]), all: asRows(rows), teamA: "BUF", teamB: "KC" });

  it("nobody qualifies: no radar", () => {
    const got = build([qb("a", 13, 1, 0.1), qb("b", 5, 1, 0.2)]);
    expect([got.a.poolSize, got.b.poolSize]).toEqual([0, 0]);
    expect(got.radar).toBe("too-few");
    expect(compareTooFewSentence(got)).toBe("Not enough qualified quarterbacks to draw the radar (14+ pass attempts a game).");
    expect(comparePoolSentence(got)).toBeNull();
    for (const v of [...got.a.values, ...got.b.values]) expect(Number.isNaN(v)).toBe(false);
  });

  it("one qualifies: still no radar, and the sentence can never say \"the 1 qualified quarterbacks\"", () => {
    const got = build([qb("a", 14, 1, 0.1), qb("b", 5, 1, 0.2)]);
    expect(got.a.poolSize).toBe(1);
    expect(got.radar).toBe("too-few");
    expect(comparePoolSentence(got)).toBeNull();
    expect(compareTooFewSentence(got)).toBe("Not enough qualified quarterbacks to draw the radar (14+ pass attempts a game).");
  });

  it("two qualify: the radar is drawn and the pool sentence counts 2", () => {
    const got = build([qb("a", 14, 1, 0.1), qb("b", 28, 2, 0.2), qb("c", 5, 1, 0.3)]);
    expect(got.radar).toBe("drawn");
    expect(compareTooFewSentence(got)).toBeNull();
    expect(comparePoolSentence(got)).toBe("Radar: percentile among the 2 qualified quarterbacks (14+ pass attempts a game).");
    // With two in the pool a value is 0 or 50: as coarse as the stat card's own.
    expect([got.a.values[0], got.b.values[0]]).toEqual([0, 50]);
  });

  it("the line itself: 14.0 attempts a game qualifies, 13.9 does not", () => {
    expect(qbEligible(qb("x", 140, 10, 0) as unknown as QBSeasonStat)).toBe(true);
    expect(qbEligible(qb("x", 139, 10, 0) as unknown as QBSeasonStat)).toBe(false);
    const got = build([qb("a", 139, 10, 0.1), qb("b", 140, 10, 0.2), qb("c", 300, 10, 0.3)]);
    expect([got.a.eligible, got.b.eligible]).toEqual([false, true]);
    expect(compareSmallSampleSentence(got, "A", "B")).toBe("Small sample: a has 139 pass attempts in 10 games (under 14 a game).");
  });

  const rec = (id: string, position: string, targets: number): Row =>
    ({ player_id: id, player_name: id, team_id: "DAL", position, targets, games: 1, ...RADAR_STATS, epa_per_target: targets / 10 });
  const wrVsTe = (rows: Row[], a = "wr", b = "te") =>
    buildComparison({
      group: "WR", rowA: asRow(rows.find((r) => r.player_id === a)!), rowB: asRow(rows.find((r) => r.player_id === b)!),
      all: asRows(rows), teamA: "DAL", teamB: "ARI",
    });
  const WRS = [rec("wr", "WR", 9), rec("wr2", "WR", 8)];
  const TES = [rec("te", "TE", 7), rec("te2", "TE", 6)];

  it("a WR-vs-TE pair: the sentence names the position whose pool is short", () => {
    const wrShort = wrVsTe([rec("wr", "WR", 9), ...TES]);
    expect(wrShort.radar).toBe("too-few");
    expect(compareTooFewSentence(wrShort)).toBe("Not enough qualified WRs to draw the radar (2+ targets a game).");
    const teShort = wrVsTe([...WRS, rec("te", "TE", 7)]);
    expect(teShort.radar).toBe("too-few");
    expect(compareTooFewSentence(teShort)).toBe("Not enough qualified TEs to draw the radar (2+ targets a game).");
    const neither = wrVsTe([...WRS, ...TES]);
    expect(neither.radar).toBe("drawn");
    expect(comparePoolSentence(neither)).toBe(
      "Radar: each player against qualified players at his position (2+ targets a game): 2 WRs, 2 TEs.");
  });

  it("both pools short: one sentence naming both positions, in the pair's order", () => {
    const rows = [rec("wr", "WR", 9), rec("te", "TE", 7)];
    expect(compareTooFewSentence(wrVsTe(rows))).toBe("Not enough qualified WRs or TEs to draw the radar (2+ targets a game).");
    expect(compareTooFewSentence(wrVsTe(rows, "te", "wr"))).toBe("Not enough qualified TEs or WRs to draw the radar (2+ targets a game).");
  });

  it("running backs and same-position receivers", () => {
    const rb = (id: string, carries: number): Row => ({ player_id: id, player_name: id, team_id: "ATL", carries, games: 1, targets: 1 });
    const few = buildComparison({ group: "RB", rowA: asRow(rb("a", 6)), rowB: asRow(rb("b", 5)), all: asRows([rb("a", 6), rb("b", 5)]), teamA: "ATL", teamB: "DET" });
    expect(compareTooFewSentence(few)).toBe("Not enough qualified running backs to draw the radar (6+ carries a game).");
    const one = wrVsTe([rec("wr", "WR", 9), rec("te", "WR", 1)]);
    expect(compareTooFewSentence(one)).toBe("Not enough qualified WRs to draw the radar (2+ targets a game).");
  });
});

describe("the pool sentence (C4): the count is the pool's own length", () => {
  it("one sentence per group, with the stat card's thresholds", () => {
    expect([QB_MIN_ATT_PER_GAME, RB_MIN_CAR_PER_GAME, WR_MIN_TGT_PER_GAME]).toEqual([14, 6, 2]);
    expect(comparePoolSentence(compare("QB", "J.Allen", "M.Stafford"))).toBe(
      "Radar: percentile among the 42 qualified quarterbacks (14+ pass attempts a game).");
    expect(comparePoolSentence(compare("RB", "Bi.Robinson", "J.Gibbs"))).toBe(
      "Radar: percentile among the 54 qualified running backs (6+ carries a game).");
    expect(comparePoolSentence(compare("WR", "C.Lamb", "J.Smith-Njigba"))).toBe(
      "Radar: percentile among the 129 qualified WRs (2+ targets a game).");
    expect(comparePoolSentence(compare("WR", "T.McBride", "S.LaPorta"))).toBe(
      "Radar: percentile among the 56 qualified TEs (2+ targets a game).");
    expect(comparePoolSentence(compare("WR", "C.Lamb", "T.McBride"))).toBe(
      "Radar: each player against qualified players at his position (2+ targets a game): 129 WRs, 56 TEs.");
    expect(comparePoolSentence(compare("WR", "T.McBride", "C.Lamb"))).toBe(
      "Radar: each player against qualified players at his position (2+ targets a game): 56 TEs, 129 WRs.");
  });

  it("the number in the sentence is the number of players the percentiles were computed against", () => {
    const got = compare("QB", "J.Allen", "M.Stafford");
    expect(got.a.poolSize).toBe((TABLES.QB as unknown as QBSeasonStat[]).filter(qbEligible).length);
    expect(comparePoolSentence(got)).toContain(` ${got.a.poolSize} `);
  });

  it("one voice: quarterbacks are counted in pass attempts in every line, and every line ends with a full stop", () => {
    const low = compare("QB", "T.Huntley", "J.Allen");
    const few = buildComparison({ group: "QB", rowA: asRow(find(TABLES.QB, "T.Huntley")), rowB: asRow(find(TABLES.QB, "J.Allen")), all: [], teamA: "BAL", teamB: "BUF" });
    const lines = [comparePoolSentence(low)!, compareSmallSampleSentence(low, "A", "B")!, compareTooFewSentence(few)!];
    expect(lines).toEqual([
      "Radar: percentile among the 42 qualified quarterbacks (14+ pass attempts a game).",
      "Small sample: T.Huntley has 9 pass attempts in 1 game (under 14 a game).",
      "Not enough qualified quarterbacks to draw the radar (14+ pass attempts a game).",
    ]);
    for (const line of [...lines, comparePoolSentence(compare("WR", "C.Lamb", "T.McBride"))!]) expect(line.endsWith(".")).toBe(true);
  });

  it("it never calls the rule PFR", () => {
    for (const s of [comparePoolSentence(compare("QB", "J.Allen", "M.Stafford")), comparePoolSentence(compare("WR", "C.Lamb", "T.McBride"))]) {
      expect(s).not.toMatch(/PFR|Pro Football Reference/i);
    }
  });
});

describe("the small-sample sentence (C6): shown exactly when a player is under the stat card's line", () => {
  it("nobody under the line: no sentence", () => {
    expect(compareSmallSampleSentence(compare("QB", "J.Allen", "M.Stafford"), "Josh Allen", "Matthew Stafford")).toBeNull();
  });

  it("one player, either side, with real 2026 players", () => {
    expect(compareSmallSampleSentence(compare("QB", "T.Huntley", "J.Allen"), "Tyler Huntley", "Josh Allen")).toBe(
      "Small sample: T.Huntley has 9 pass attempts in 1 game (under 14 a game).");
    expect(compareSmallSampleSentence(compare("QB", "J.Allen", "T.Huntley"), "Josh Allen", "Tyler Huntley")).toBe(
      "Small sample: T.Huntley has 9 pass attempts in 1 game (under 14 a game).");
    expect(compareSmallSampleSentence(compare("WR", "O.Zaccheaus", "C.Lamb"), "Olamide Zaccheaus", "CeeDee Lamb")).toBe(
      "Small sample: O.Zaccheaus has 7 targets in 4 games (under 2 a game).");
    expect(compareSmallSampleSentence(compare("RB", "G.Holani", "J.Gibbs"), "George Holani", "Jahmyr Gibbs")).toBe(
      "Small sample: G.Holani has 22 carries in 4 games (under 6 a game).");
  });

  it("both players: one sentence, each player's numbers pluralised on their own", () => {
    expect(compareSmallSampleSentence(compare("QB", "T.Huntley", "A.Dalton"), "Tyler Huntley", "Andy Dalton")).toBe(
      "Small sample: T.Huntley has 9 pass attempts in 1 game; A.Dalton has 1 pass attempt in 1 game (under 14 a game).");
    expect(compareSmallSampleSentence(compare("WR", "O.Zaccheaus", "M.Valdes-Scantling"), "Olamide Zaccheaus", "Marquez Valdes-Scantling")).toBe(
      "Small sample: O.Zaccheaus has 7 targets in 4 games; M.Valdes-Scantling has 2 targets in 2 games (under 2 a game).");
  });

  it("every singular: 1 pass attempt, 1 target, 1 carry, 1 game", () => {
    const low = (group: CompareGroup, vol: string, name: string): string | null => {
      const a = { player_id: "a", player_name: name, team_id: "BUF", position: "WR", games: 1, [vol]: 1 };
      const others = [0, 1, 2].map((i) => ({ player_id: `o${i}`, player_name: `o${i}`, team_id: "KC", position: "WR", games: 1, [vol]: 50 }));
      return compareSmallSampleSentence(buildComparison({
        group, rowA: asRow(a), rowB: asRow(others[0]), all: asRows([a, ...others]), teamA: "BUF", teamB: "KC",
      }), "Full A", "Full B");
    };
    expect(low("QB", "attempts", "A.One")).toBe("Small sample: A.One has 1 pass attempt in 1 game (under 14 a game).");
    expect(low("WR", "targets", "A.One")).toBe("Small sample: A.One has 1 target in 1 game (under 2 a game).");
    expect(low("RB", "carries", "A.One")).toBe("Small sample: A.One has 1 carry in 1 game (under 6 a game).");
  });

  it("two players with the same short name: both are written with their full names", () => {
    const row = (id: string, attempts: number): Row => ({ player_id: id, player_name: "J.Williams", team_id: "BUF", games: 2, attempts });
    const rows = [row("a", 6), row("b", 80), { ...row("c", 90), player_name: "Other" }];
    const got = buildComparison({ group: "QB", rowA: asRow(rows[0]), rowB: asRow(rows[1]), all: asRows(rows), teamA: "BUF", teamB: "KC" });
    expect(compareSmallSampleSentence(got, "Jameson Williams", "Javonte Williams")).toBe(
      "Small sample: Jameson Williams has 6 pass attempts in 2 games (under 14 a game).");
    const both = buildComparison({ group: "QB", rowA: asRow(rows[0]), rowB: asRow(row("d", 3)), all: asRows([...rows, row("d", 3)]), teamA: "BUF", teamB: "KC" });
    expect(compareSmallSampleSentence(both, "Jameson Williams", "Javonte Williams")).toBe(
      "Small sample: Jameson Williams has 6 pass attempts in 2 games; Javonte Williams has 3 pass attempts in 2 games (under 14 a game).");
  });

  it("it is shown when no radar is drawn too, so the visitor sees why (spec section 8)", () => {
    const a = { player_id: "a", player_name: "A", team_id: "BUF", games: 1, attempts: 3 };
    const b = { player_id: "b", player_name: "B", team_id: "KC", games: 1, attempts: 30 };
    const got = buildComparison({ group: "QB", rowA: asRow(a), rowB: asRow(b), all: asRows([a, b]), teamA: "BUF", teamB: "KC" });
    expect(got.radar).toBe("too-few");
    expect(compareTooFewSentence(got)).toBe("Not enough qualified quarterbacks to draw the radar (14+ pass attempts a game).");
    expect(compareSmallSampleSentence(got, "A", "B")).toBe("Small sample: A has 3 pass attempts in 1 game (under 14 a game).");
  });

  it("the too-few sentence does not say \"yet\": the page cannot tell a past season, which can never fill up, from this one", () => {
    const a = { player_id: "a", player_name: "A", team_id: "BUF", games: 1, attempts: 3 };
    const got = buildComparison({ group: "QB", rowA: asRow(a), rowB: asRow(a), all: asRows([a]), teamA: "BUF", teamB: "KC" });
    expect(compareTooFewSentence(got)).not.toMatch(/\byet\b/);
  });

  describe("it never prints a number the row does not hold", () => {
    const pair = (volume: unknown, games: unknown) => {
      const a = { player_id: "a", player_name: "A.Odd", team_id: "BUF", games, attempts: volume };
      const others = [0, 1, 2].map((i) => ({ player_id: `o${i}`, player_name: `o${i}`, team_id: "KC", games: 1, attempts: 30 + i }));
      return buildComparison({ group: "QB", rowA: asRow(a), rowB: asRow(others[0]), all: asRows([a, ...others]), teamA: "BUF", teamB: "KC" });
    };

    it("a numeric string is read as its number", () => {
      const got = pair("40", "4");
      expect([got.a.volume, got.a.games]).toEqual([40, 4]);
      expect(got.a.eligible).toBe(false);
      expect(compareSmallSampleSentence(got, "A", "B")).toBe("Small sample: A.Odd has 40 pass attempts in 4 games (under 14 a game).");
    });

    for (const [what, value] of [["null", null], ["undefined", undefined], ["NaN", NaN], ["a negative number", -3], ["the string NaN", "NaN"], ["an empty string", ""], ["true", true]] as [string, unknown][]) {
      it(`volume is ${what}: his clause is left out, no 0 is made up`, () => {
        const got = pair(value, 2);
        expect(got.a.volume).toBeNull();
        expect(compareSmallSampleSentence(got, "A", "B")).toBeNull();
      });
      it(`games is ${what}: his clause is left out`, () => {
        const got = pair(9, value);
        expect(got.a.games).toBeNull();
        const s = compareSmallSampleSentence(got, "A", "B");
        expect(s === null || !s.includes("A.Odd")).toBe(true);
      });
    }

    it("0 games: his clause is left out (never \"in 0 games\")", () => {
      const got = pair(0, 0);
      expect([got.a.volume, got.a.games, got.a.eligible]).toEqual([0, 0, false]);
      expect(compareSmallSampleSentence(got, "A", "B")).toBeNull();
      expect(compareSmallSampleSentence(pair(5, "0"), "A", "B")).toBeNull();
      // 0 attempts in a real game is a fact and is printed.
      expect(compareSmallSampleSentence(pair(0, 1), "A", "B")).toBe("Small sample: A.Odd has 0 pass attempts in 1 game (under 14 a game).");
    });

    it("one player's numbers are unusable, the other's are fine: only the other is named", () => {
      const a = { player_id: "a", player_name: "A.Odd", team_id: "BUF", games: 1, attempts: null };
      const b = { player_id: "b", player_name: "B.Low", team_id: "BUF", games: 1, attempts: 2 };
      const others = [0, 1].map((i) => ({ player_id: `o${i}`, player_name: `o${i}`, team_id: "KC", games: 1, attempts: 30 + i }));
      const got = buildComparison({ group: "QB", rowA: asRow(a), rowB: asRow(b), all: asRows([a, b, ...others]), teamA: "BUF", teamB: "KC" });
      expect(compareSmallSampleSentence(got, "A", "B")).toBe("Small sample: B.Low has 2 pass attempts in 1 game (under 14 a game).");
    });
  });

  describe("names: never \"null\", never empty", () => {
    const same = (nameA: unknown, nameB: unknown) => {
      const a = { player_id: "a", player_name: nameA, team_id: "BUF", games: 2, attempts: 6 };
      const b = { player_id: "b", player_name: nameB, team_id: "BUF", games: 2, attempts: 3 };
      const others = [0, 1].map((i) => ({ player_id: `o${i}`, player_name: `o${i}`, team_id: "KC", games: 1, attempts: 30 + i }));
      return buildComparison({ group: "QB", rowA: asRow(a), rowB: asRow(b), all: asRows([a, b, ...others]), teamA: "BUF", teamB: "KC" });
    };

    it("full names are needed but one is missing: the short name, else a name made from the slug", () => {
      const got = same("J.Williams", "J.Williams");
      expect(compareSmallSampleSentence(got, { fullName: null, slug: "jameson-williams" }, { fullName: "", slug: "javonte-williams" })).toBe(
        "Small sample: J.Williams has 6 pass attempts in 2 games; J.Williams has 3 pass attempts in 2 games (under 14 a game).");
      const noShort = same(null, "");
      expect(compareSmallSampleSentence(noShort, { fullName: null, slug: "jameson-williams" }, { fullName: "  ", slug: "d-andre-swift-det" })).toBe(
        "Small sample: Jameson Williams has 6 pass attempts in 2 games; D Andre Swift Det has 3 pass attempts in 2 games (under 14 a game).");
      expect(compareSmallSampleSentence(noShort, { fullName: "Jameson Williams" }, null)).toBe(
        "Small sample: Jameson Williams has 6 pass attempts in 2 games; Player 2 has 3 pass attempts in 2 games (under 14 a game).");
      for (const s of [
        compareSmallSampleSentence(noShort, null, undefined),
        compareSmallSampleSentence(noShort, { fullName: null, slug: null }, { slug: "" }),
        compareSmallSampleSentence(same(undefined, 7), "", "   "),
      ]) {
        expect(s).toBe("Small sample: Player 1 has 6 pass attempts in 2 games; Player 2 has 3 pass attempts in 2 games (under 14 a game).");
      }
    });
  });
});

describe("a player with too few radar stats gets no outline, as on his stat card", () => {
  it("the threshold is the stat card chart's own: half the axes or more missing", () => {
    expect([radarHasTooFewAxes(2, 6), radarHasTooFewAxes(3, 6), radarHasTooFewAxes(6, 6)]).toEqual([false, true, true]);
    expect([radarHasTooFewAxes(3, 7), radarHasTooFewAxes(4, 7)]).toEqual([false, true]);
    expect(radarHasTooFewAxes(0, 6)).toBe(false);
  });

  // M.Valdes-Scantling really has 2 of 6 missing (no receptions, no route data).
  // One more is removed here to reach the threshold.
  const withThree = TABLES.WR.map((r) => (r.player_name === "M.Valdes-Scantling" ? { ...r, croe: null } : r));
  const lambToo = withThree.map((r) => (r.player_name === "C.Lamb" ? { ...r, croe: null, epa_per_target: null } : r));

  it("2 of 6 missing: still drawn", () => {
    const got = compare("WR", "M.Valdes-Scantling", "C.Lamb");
    expect(got.a.missing.filter(Boolean)).toHaveLength(2);
    expect([got.a.outline, got.b.outline]).toEqual([true, true]);
    expect(compareNotDrawnSentences(got, "Marquez Valdes-Scantling", "CeeDee Lamb")).toEqual([]);
  });

  it("3 of 6 missing: no outline for him, the other player is still drawn, and a sentence says so", () => {
    const got = compare("WR", "M.Valdes-Scantling", "C.Lamb", withThree);
    expect(got.a.missing.filter(Boolean)).toHaveLength(3);
    expect([got.a.outline, got.b.outline]).toEqual([false, true]);
    expect(got.radar).toBe("drawn");
    expect(compareNotDrawnSentences(got, "Marquez Valdes-Scantling", "CeeDee Lamb")).toEqual([
      "No outline for M.Valdes-Scantling: 3 of his 6 radar stats are not available.",
    ]);
    // The other way round too.
    const swapped = compare("WR", "C.Lamb", "M.Valdes-Scantling", withThree);
    expect([swapped.a.outline, swapped.b.outline]).toEqual([true, false]);
    expect(compareNotDrawnSentences(swapped, "CeeDee Lamb", "Marquez Valdes-Scantling")).toEqual([
      "No outline for M.Valdes-Scantling: 3 of his 6 radar stats are not available.",
    ]);
    // His values and mask are still his stat card's: only the drawing rule is added.
    expect(comparePoolSentence(got)).toBe("Radar: percentile among the 129 qualified WRs (2+ targets a game).");
  });

  it("both players: two sentences, and the pool sentence goes (no radar is drawn)", () => {
    const got = compare("WR", "M.Valdes-Scantling", "C.Lamb", lambToo);
    expect([got.a.outline, got.b.outline]).toEqual([false, false]);
    expect(compareNotDrawnSentences(got, "Marquez Valdes-Scantling", "CeeDee Lamb")).toEqual([
      "No outline for M.Valdes-Scantling: 3 of his 6 radar stats are not available.",
      "No outline for C.Lamb: 3 of his 6 radar stats are not available.",
    ]);
    expect(comparePoolSentence(got)).toBeNull();
  });

  it("quarterbacks and running backs are always drawn: a missing stat plots at the centre for them, on the card too", () => {
    for (const p of [compare("QB", "M.Penix", "J.Allen").a, compare("RB", "Bi.Robinson", "J.Gibbs").a]) expect(p.outline).toBe(true);
  });

  it("with no radar at all (too few qualified players) there is nothing to say about outlines", () => {
    const row = find(withThree, "M.Valdes-Scantling");
    const got = buildComparison({ group: "WR", rowA: asRow(row), rowB: asRow(row), all: asRows([row]), teamA: "LAC", teamB: "LAC" });
    expect(got.radar).toBe("too-few");
    expect(compareNotDrawnSentences(got, "A", "B")).toEqual([]);
  });
});

describe("position words come from a closed list", () => {
  const rec = (id: string, position: unknown, targets = 9): Row => ({ player_id: id, player_name: id, team_id: "DAL", position, targets, games: 1, ...RADAR_STATS });
  const build = (rows: Row[]) =>
    buildComparison({ group: "WR", rowA: asRow(rows[0]), rowB: asRow(rows[1]), all: asRows(rows), teamA: "DAL", teamB: "ARI" });

  it("WR, TE, RB, FB and QB rows of the receiver table have their own word", () => {
    for (const [pos, word] of [["WR", "WRs"], ["TE", "TEs"], ["RB", "RBs"], ["FB", "FBs"], ["QB", "QBs"]]) {
      expect(compareTooFewSentence(build([rec("a", pos), rec("b", pos, 1)]))).toBe(
        `Not enough qualified ${word} to draw the radar (2+ targets a game).`);
    }
  });

  for (const junk of ["wr", "WR ", 7, null, undefined, "<b>", "K"]) {
    it(`a position of ${JSON.stringify(junk)}: the word is "receivers", and the row is still ranked by the stat card's own rule`, () => {
      const rows = [rec("a", junk), rec("b", junk), rec("c", junk, 1), rec("w1", "WR"), rec("w2", "WR")];
      const got = build(rows);
      // wrCardPool matches the position exactly: the two qualified rows that carry the same value.
      expect(got.a.poolSize).toBe(2);
      expect(comparePoolSentence(got)).toBe("Radar: percentile among the 2 qualified receivers (2+ targets a game).");
      const mixed = buildComparison({ group: "WR", rowA: asRow(rows[0]), rowB: asRow(rows[3]), all: asRows(rows), teamA: "DAL", teamB: "ARI" });
      expect(comparePoolSentence(mixed)).toBe(
        "Radar: each player against qualified players at his position (2+ targets a game): 2 receivers, 2 WRs.");
      const few = build([rec("a", junk), rec("b", junk, 1)]);
      expect(compareTooFewSentence(few)).toBe("Not enough qualified receivers to draw the radar (2+ targets a game).");
    });
  }
});

describe("the legend (C5)", () => {
  it("is the reworded sentence: a player under the line can sit on the outer ring without being the league's best", () => {
    expect(COMPARE_RADAR_LEGEND).toBe("Farther out = higher percentile · dashed ring = 50th percentile");
    expect(COMPARE_RADAR_LEGEND).not.toMatch(/league best/);
    // T.Huntley (9 attempts, under the line) is above most qualified passers on CPOE.
    const got = compare("QB", "T.Huntley", "J.Allen");
    expect(got.a.eligible).toBe(false);
    expect(got.a.values[1]).toBeGreaterThan(95);
  });
});

describe("buildComparison: values and the missing mask", () => {
  it("values are never NaN; a missing WR/TE axis is 0 in values and true in the mask", () => {
    const got = compare("WR", "C.Lamb", "J.Smith-Njigba");
    // No 2026 receiver has route data, so YPRR (the last axis) is missing for everyone.
    expect(got.a.missing).toEqual([false, false, false, false, false, true]);
    expect(got.b.missing).toEqual([false, false, false, false, false, true]);
    expect(got.a.values[5]).toBe(0);
    for (const p of [got.a, got.b]) for (const v of p.values) expect(Number.isNaN(v)).toBe(false);
  });

  it("missing for one receiver only: his mask alone is set", () => {
    // M.Valdes-Scantling: 2 targets, 0 receptions, so no YAC per reception.
    const got = compare("WR", "M.Valdes-Scantling", "C.Lamb");
    expect(got.a.missing[4]).toBe(true);
    expect(got.b.missing[4]).toBe(false);
    expect(got.rows.find((r) => r.label === "YAC/Rec")).toMatchObject({ a: "—", winner: 0 });
  });

  it("QB and RB: a missing axis plots at the centre (0) and the mask stays false", () => {
    // M.Penix: no rush attempts, so no rushing EPA (the last QB axis).
    const got = compare("QB", "M.Penix", "J.Allen");
    expect(got.a.values[6]).toBe(0);
    expect(got.a.missing).toEqual(Array(7).fill(false));
    expect(compare("RB", "Bi.Robinson", "J.Gibbs").a.missing).toEqual(Array(6).fill(false));
  });

  it("null, undefined and the string \"NaN\" all mean no value: one answer for all three", () => {
    for (const [group, [nameA, nameB]] of [
      ["QB", ["M.Penix", "J.Allen"]], ["WR", ["M.Valdes-Scantling", "C.Lamb"]], ["RB", ["Bi.Robinson", "J.Gibbs"]],
    ] as [CompareGroup, [string, string]][]) {
      const parsed = compare(group, nameA, nameB);
      expect(compare(group, nameA, nameB, raw(TABLES[group])), `${group} "NaN"`).toEqual(parsed);
      const withUndefined = TABLES[group].map((r) =>
        Object.fromEntries(Object.entries(r).filter(([, v]) => v !== null)));
      expect(compare(group, nameA, nameB, withUndefined), `${group} undefined`).toEqual(parsed);
    }
  });

  it("the one known exception (F12), kept as it is: a null stuff_rate plots as a 0% stuff rate, \"NaN\" at the centre", () => {
    const edit = (value: unknown) => TABLES.RB.map((r) => (r.player_name === "J.Gibbs" ? { ...r, stuff_rate: value } : r));
    const STUFF_AVOID = 2;
    // Gibbs qualifies, so his own edited row is in the pool he is ranked in.
    const pool = rbCardPool(edit(null) as unknown as RBSeasonStat[]);
    const neverStuffed = pool.filter((r) => (r.stuff_rate as number) > 0).length / pool.length * 100;
    const asNull = compare("RB", "Bi.Robinson", "J.Gibbs", edit(null));
    expect(asNull.b.values[STUFF_AVOID]).toBe(neverStuffed);
    expect(neverStuffed).toBeGreaterThan(80);
    expect(asNull.rows.find((r) => r.label === "Stuff%")).toMatchObject({ b: "—", winner: 0 });
    // Only null does this. undefined and "NaN" plot at the centre.
    for (const other of [undefined, "NaN"]) {
      const got = compare("RB", "Bi.Robinson", "J.Gibbs", edit(other));
      expect(got.b.values[STUFF_AVOID]).toBe(0);
      expect(got.rows.find((r) => r.label === "Stuff%")).toMatchObject({ b: "—", winner: 0 });
    }
  });

  it("rows that hold almost nothing (the shape other tests hand the Compare page) do not throw", () => {
    const a = { player_id: "a", player_name: "A", team_id: "BUF", epa_per_db: 0.25, games: 4 };
    const b = { player_id: "b", player_name: "B", team_id: "KC", epa_per_db: 0.15, games: 4 };
    const got = buildComparison({
      group: "QB", rowA: asRow(a), rowB: asRow(b), all: asRows([a, b]), teamA: "BUF", teamB: "KC",
    });
    expect(got.rows).toHaveLength(QB_COMP_STATS.length);
    expect(got.rows[0]).toEqual({ key: "epa_per_db", label: "EPA/DB", a: "0.25", b: "0.15", winner: 1 });
    expect(got.rows.find((r) => r.label === "CPOE")).toMatchObject({ a: "—", b: "—", winner: 0 });
    expect(got.a.values).toHaveLength(7);
    // No attempts column at all: nobody qualifies, so no radar and no nonsense sentence.
    expect(got.radar).toBe("too-few");
    expect(compareSmallSampleSentence(got, "A", "B")).toBeNull();
  });

  it("an empty table: numbers, never a crash", () => {
    const row = find(TABLES.WR, "C.Lamb");
    const none = buildComparison({ group: "WR", rowA: asRow(row), rowB: asRow(row), all: [], teamA: "DAL", teamB: "DAL" });
    expect(none.a.missing).toEqual(Array(6).fill(true));
    expect(none.a.values).toEqual(Array(6).fill(0));
    expect(none.radar).toBe("too-few");
  });

  it("receiver rows with no position: ranked among the other rows with none (the stat card's own filter), and a plain word, never \"undefineds\"", () => {
    const a = { player_id: "a", player_name: "A", team_id: "DAL", targets: 9, games: 1, ...RADAR_STATS };
    const b = { player_id: "b", player_name: "B", team_id: "ARI", targets: 8, games: 1, ...RADAR_STATS };
    const c = { player_id: "c", player_name: "C", team_id: "ARI", targets: 1, games: 1, ...RADAR_STATS };
    const got = buildComparison({ group: "WR", rowA: asRow(a), rowB: asRow(b), all: asRows([a, b, c]), teamA: "DAL", teamB: "ARI" });
    expect(comparePoolSentence(got)).toBe("Radar: percentile among the 2 qualified receivers (2+ targets a game).");
    const few = buildComparison({ group: "WR", rowA: asRow(a), rowB: asRow(c), all: asRows([a, c]), teamA: "DAL", teamB: "ARI" });
    expect(compareTooFewSentence(few)).toBe("Not enough qualified receivers to draw the radar (2+ targets a game).");
  });
});

describe("buildComparison: the stat table (the pool does not touch it)", () => {
  it("one row per stat of the group, in the page's order", () => {
    expect(compare("QB", "J.Allen", "M.Stafford").rows.map((r) => r.label)).toEqual(QB_COMP_STATS.map((s) => s.label));
    expect(compare("WR", "C.Lamb", "J.Smith-Njigba").rows.map((r) => r.label)).toEqual(WR_COMP_STATS.map((s) => s.label));
    expect(compare("RB", "Bi.Robinson", "J.Gibbs").rows.map((r) => r.label)).toEqual(RB_COMP_STATS.map((s) => s.label));
    expect([QB_COMP_STATS.length, WR_COMP_STATS.length, RB_COMP_STATS.length]).toEqual([18, 14, 12]);
  });

  it("higher wins, except where lower is better; a tie highlights neither", () => {
    const rows = compare("QB", "J.Allen", "M.Stafford").rows;
    const row = (label: string) => rows.find((r) => r.label === label)!;
    expect(row("Pass Yds")).toMatchObject({ a: "1039", b: "1189", winner: 2 });
    expect(row("INT")).toMatchObject({ a: "3", b: "6", winner: 1 }); // fewer is better
    expect(row("Pass TD")).toMatchObject({ a: "6", b: "6", winner: 0 });
  });

  // Chaos W1 (compare card PR 2): the winner used to be decided on the unrounded
  // numbers, so two cells that PRINT the same could carry one green highlight.
  // On a shared picture nobody can hover for more decimals: a printed tie is a tie.
  it("two values that print the same are a tie: no highlight on either side (real 2026 rows)", () => {
    const croe = compare("WR", "P.Bryant", "D.London").rows.find((r) => r.label === "CROE")!;
    expect(croe).toEqual({ key: "croe", label: "CROE", a: "+9.1%", b: "+9.1%", winner: 0 });
    const croe2 = compare("WR", "J.Taylor@IND", "J.Warren@PIT").rows.find((r) => r.label === "CROE")!;
    expect(croe2).toMatchObject({ a: "-13.9%", b: "-13.9%", winner: 0 });
    const ypc = compare("RB", "T.Goodson", "S.McGowan").rows.find((r) => r.label === "YPC")!;
    expect(ypc).toMatchObject({ a: "3.8", b: "3.8", winner: 0 });
    // The rows that print differently keep their winner.
    expect(compare("WR", "P.Bryant", "D.London").rows.filter((r) => r.a !== r.b).every((r) => r.winner !== 0)).toBe(true);
  });

  it("across every row of every real pair of the same team's table sample: a highlight exists exactly when the two cells print differently", () => {
    for (const group of ["QB", "WR", "RB"] as const) {
      const table = TABLES[group].slice(0, 40);
      for (let i = 0; i + 1 < table.length; i += 2) {
        const got = buildComparison({
          group, rowA: asRow(table[i]), rowB: asRow(table[i + 1]), all: asRows(TABLES[group]), teamA: "BUF", teamB: "KC",
        });
        for (const r of got.rows) {
          if (r.a === r.b) expect(r.winner, `${group} ${r.label} ${r.a}`).toBe(0);
          else if (r.a !== "—" && r.b !== "—") expect(r.winner, `${group} ${r.label} ${r.a} / ${r.b}`).not.toBe(0);
        }
      }
    }
  });

  it("the table is the same whatever the rest of the season table holds", () => {
    const full = compare("QB", "J.Allen", "M.Stafford");
    const onlyTwo = compare("QB", "J.Allen", "M.Stafford", TABLES.QB.filter((r) => ["J.Allen", "M.Stafford"].includes(r.player_name as string)));
    expect(onlyTwo.rows).toEqual(full.rows);
    expect(onlyTwo.a.values).not.toEqual(full.a.values);
  });

  it("swapping the players mirrors the table and the radar", () => {
    const ab = compare("RB", "Bi.Robinson", "J.Gibbs");
    const ba = compare("RB", "J.Gibbs", "Bi.Robinson");
    expect(ba.a.values).toEqual(ab.b.values);
    expect(ba.b.values).toEqual(ab.a.values);
    expect(ba.rows).toEqual(ab.rows.map((r) => ({ ...r, a: r.b, b: r.a, winner: r.winner === 0 ? 0 : 3 - r.winner })));
  });

  it("getStatVal: only a real number counts", () => {
    const row = { a: 1.5, b: null, c: "NaN", d: "2", e: 0 } as unknown as ComparePlayerRow;
    expect(getStatVal(row, "a")).toBe(1.5);
    expect(getStatVal(row, "e")).toBe(0);
    for (const key of ["b", "c", "d", "missing"]) expect(Number.isNaN(getStatVal(row, key))).toBe(true);
  });
});

describe("ensureContrast: only player 2's colour is ever moved", () => {
  it("the spec's table: BUF/LA and DAL/SEA go to red, ATL/DET is left alone", () => {
    expect(ensureContrast(getTeamColor("BUF"), getTeamColor("LA"))).toBe("#dc2626");
    expect(ensureContrast(getTeamColor("DAL"), getTeamColor("SEA"))).toBe("#dc2626");
    expect(ensureContrast(getTeamColor("ATL"), getTeamColor("DET"))).toBe(getTeamColor("DET"));
  });

  it("the same team twice: player 2 gets the first palette colour far enough from the team's", () => {
    for (const team of ["BUF", "KC", "GB", "PIT", "NO"]) {
      const c1 = getTeamColor(team);
      const c2 = ensureContrast(c1, c1);
      expect(CONTRAST_PALETTE).toContain(c2);
      expect(colorDistance(c1, c2)).toBeGreaterThanOrEqual(MIN_DISTANCE);
      expect(c2).toBe(CONTRAST_PALETTE.find((alt) => colorDistance(c1, alt) >= MIN_DISTANCE));
    }
    // KC is red, so the first palette colour (red) is too close and blue is used.
    expect(ensureContrast(getTeamColor("KC"), getTeamColor("KC"))).toBe("#2563eb");
  });

  it("for every pair of NFL teams the two colours end up at least 150 apart", () => {
    const teams = ["ARI", "ATL", "BAL", "BUF", "CAR", "CHI", "CIN", "CLE", "DAL", "DEN", "DET", "GB", "HOU", "IND", "JAX", "KC",
      "LA", "LAC", "LV", "MIA", "MIN", "NE", "NO", "NYG", "NYJ", "PHI", "PIT", "SEA", "SF", "TB", "TEN", "WAS"];
    for (const t1 of teams) for (const t2 of teams) {
      const c1 = getTeamColor(t1);
      expect(colorDistance(c1, ensureContrast(c1, getTeamColor(t2))), `${t1}/${t2}`).toBeGreaterThanOrEqual(MIN_DISTANCE);
    }
  });

  // Compare card PR 3: /compare draws each player in the colour the share card
  // draws him in, so one player is never two colours on the site. The card's
  // rule: the outline colour of the team he played for THAT season (his season
  // row's team), by the team radar's rule (the primary when it shows on white,
  // else the secondary, else a dark neutral), then player B moved away from A.
  describe("the colours are the share card's (PR 3)", () => {
    const withTeams = (teamA: string, teamB: string) => {
      const rows = TABLES.QB.map((r) =>
        (r.player_name === "J.Allen" ? { ...r, team_id: teamA } : r.player_name === "M.Stafford" ? { ...r, team_id: teamB } : r));
      const find = (n: string) => asRow(rows.find((r) => r.player_name === n)!);
      // What player_slugs says today is passed too, as /compare passes it: it must not decide the colour.
      return buildComparison({ group: "QB", rowA: find("J.Allen"), rowB: find("M.Stafford"), all: asRows(rows), teamA: "BUF", teamB: "LA" });
    };

    it("a Steeler is not drawn in Pittsburgh's gold (it does not show on white) but in its black; a Saint likewise", () => {
      const pit = withTeams("PIT", "KC");
      expect(pit.a.color).toBe("#101820");
      expect(pit.a.color).not.toBe(getTeamColor("PIT"));
      const no = withTeams("KC", "NO");
      expect(no.b.color).not.toBe(getTeamColor("NO"));
      expect(colorDistance(no.a.color, no.b.color)).toBeGreaterThanOrEqual(MIN_DISTANCE);
      // PIT against NO: both would be the same near-black, so player B is moved to red.
      expect(withTeams("PIT", "NO")).toMatchObject({ a: { color: "#101820" }, b: { color: "#dc2626" } });
    });

    it("a traded player wears the team of his season row, not the team player_slugs has for him today", () => {
      const traded = withTeams("KC", "DET");
      expect([traded.a.color, traded.b.color]).toEqual([getTeamColor("KC"), getTeamColor("DET")]);
    });

    it("it is exactly the card's pair of colours, for every pair of teams", () => {
      for (const t1 of ["BUF", "PIT", "NO", "KC", "NYJ", "LA", "DAL", "SEA"]) for (const t2 of ["BUF", "PIT", "NO", "KC", "NYJ", "LA", "DET"]) {
        const got = withTeams(t1, t2);
        expect({ a: got.a.color, b: got.b.color }, `${t1}/${t2}`).toEqual(comparePlotColors(t1, t2));
      }
    });

    it("the teams whose colours were fine before are unchanged: BUF/LA still blue and red, ATL/DET as they were", () => {
      expect(withTeams("BUF", "LA")).toMatchObject({ a: { color: "#00338D" }, b: { color: "#dc2626" } });
      expect(withTeams("ATL", "DET")).toMatchObject({ a: { color: "#A71930" }, b: { color: "#0076B6" } });
    });

    it("a row with no team falls back to the team the caller names; an unknown team is the dark neutral (it was a mid grey)", () => {
      const a = { player_id: "a", player_name: "A", games: 4, attempts: 100, epa_per_db: 0.2 };
      const b = { player_id: "b", player_name: "B", games: 4, attempts: 100, epa_per_db: 0.1 };
      const named = buildComparison({ group: "QB", rowA: asRow(a), rowB: asRow(b), all: asRows([a, b]), teamA: "KC", teamB: "DET" });
      expect([named.a.color, named.b.color]).toEqual([getTeamColor("KC"), getTeamColor("DET")]);
      const unknown = buildComparison({ group: "QB", rowA: asRow(a), rowB: asRow(b), all: asRows([a, b]), teamA: "???", teamB: "BUF" });
      expect(unknown.a.color).toBe("#0f172a");
      expect(colorDistance(unknown.a.color, unknown.b.color)).toBeGreaterThanOrEqual(MIN_DISTANCE);
    });
  });
});

describe("lib/stats/compare.ts stays pure", () => {
  const ROOT = path.join(__dirname, "..", "..");
  const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");

  /** Every runtime import of a file ("import type" lines are erased by the compiler and do not count). */
  function runtimeImports(source: string): string[] {
    return Array.from(source.matchAll(/^\s*(?:import|export)\s+(?!type\b)[^;]*?from\s+["']([^"']+)["']/gm)).map((m) => m[1])
      .concat(Array.from(source.matchAll(/^\s*import\s+["']([^"']+)["']/gm)).map((m) => m[1]));
  }

  /** A project import as a repo-relative file, or null for a package. */
  function resolve(from: string, spec: string): string | null {
    let base: string;
    if (spec.startsWith("@/")) base = spec.slice(2);
    else if (spec.startsWith(".")) base = path.posix.join(path.posix.dirname(from), spec);
    else return null;
    for (const ext of [".ts", ".tsx", "/index.ts"]) {
      try { read(base + ext); return base + ext; } catch { /* try the next one */ }
    }
    throw new Error(`cannot resolve ${spec} from ${from}`);
  }

  function chain(entry: string): { files: string[]; packages: string[] } {
    const files: string[] = [];
    const packages = new Set<string>();
    const todo = [entry];
    while (todo.length > 0) {
      const file = todo.pop()!;
      if (files.includes(file)) continue;
      files.push(file);
      for (const spec of runtimeImports(read(file))) {
        const next = resolve(file, spec);
        if (next === null) packages.add(spec);
        else todo.push(next);
      }
    }
    return { files: files.sort(), packages: Array.from(packages).sort() };
  }

  it("imports nothing from lib/data except the static team list, and no React, Next or Supabase", () => {
    const source = read("lib/stats/compare.ts");
    const imports = Array.from(source.matchAll(/from\s+["']([^"']+)["']/g)).map((m) => m[1]);
    expect(imports.length).toBeGreaterThan(0);
    expect(imports.filter((i) => i.includes("lib/data"))).toEqual(["@/lib/data/teams"]);
    for (const i of imports) expect(i).not.toMatch(/supabase|^react|^next|components\//);
    expect(source).not.toContain("use client");
    expect(source).not.toMatch(/\brequire\(|\bimport\(/);
  });

  it("the same holds for everything it pulls in, followed import by import (compare.ts, the stat card module, and on down)", () => {
    const { files, packages } = chain("lib/stats/compare.ts");
    // It really walked: the stat card module and what that needs are in the chain.
    for (const f of ["lib/stats/compare.ts", "lib/stats/tecmo-card.ts", "lib/stats/radar.ts", "lib/stats/percentiles.ts", "lib/stats/archetypes.ts", "lib/data/teams.ts"]) {
      expect(files, f).toContain(f);
    }
    expect(files.filter((f) => f.startsWith("lib/data/"))).toEqual(["lib/data/teams.ts"]);
    for (const f of files) {
      expect(f, f).toMatch(/^lib\/(stats|data)\//);
      const source = read(f);
      expect(source, f).not.toMatch(/^\s*["']use client["']/m);
      expect(source, f).not.toMatch(/\brequire\(|\bimport\(/);
    }
    // No package at all at run time: no React, no Next, no Supabase.
    expect(packages).toEqual([]);
  });

  // Compare card PR 3: the Share block first cost /compare's visitors 16 kB of
  // JavaScript (138 kB to 154 kB first load), because the browser code reached
  // the team radar's and the team stats page's modules through two imports.
  // The bundler keeps a module it can reach, used or not.
  it("/compare's browser code never reaches the share card's model, the team radar or the team stats modules", () => {
    const { files } = chain("components/compare/ComparisonTool.tsx");
    for (const f of ["components/compare/CompareShare.tsx", "lib/stats/compare.ts", "lib/stats/compare-links.ts", "lib/stats/formatters.ts"]) {
      expect(files, f).toContain(f);
    }
    for (const f of ["lib/stats/compare-card.ts", "lib/stats/team-radar.ts", "lib/stats/team-stats.ts", "lib/data/compare-card.ts"]) {
      expect(files, f).not.toContain(f);
    }
    expect(runtimeImports(read("lib/stats/compare-links.ts"))).toEqual([]);
    expect(runtimeImports(read("lib/stats/formatters.ts"))).toEqual([]);
  });

  it("the walker would catch a bad import: it sees runtime imports and ignores type-only ones", () => {
    expect(runtimeImports('import type React from "react";\nimport { a } from "@/lib/supabase/client";\nimport {\n  b,\n} from "./x";\nexport { c } from "next/navigation";\nimport "server-only";'))
      .toEqual(["@/lib/supabase/client", "./x", "next/navigation", "server-only"]);
  });
});

// Chaos PR 3, R2 and R3: two small rules that /compare and the share card must
// share, so they live here once.
describe("compareTeamId: the team a player is drawn in", () => {
  const row = (team_id: unknown) => ({ player_id: "x", team_id }) as unknown as ComparePlayerRow;

  it("the season row's team when it has one", () => {
    expect(compareTeamId(row("BUF"), "KC")).toBe("BUF");
    expect(compareTeamId(row(" BUF "), "KC")).toBe("BUF");
  });

  it.each([null, undefined, "", "   ", 7])("row team %j: the team player_slugs names", (v) => {
    expect(compareTeamId(row(v), "KC")).toBe("KC");
    expect(compareTeamId(row(v), " KC ")).toBe("KC");
  });

  it.each([null, undefined, "", "  ", 7])("neither: no team (\"\"), which is drawn in the neutral colour (fallback %j)", (v) => {
    expect(compareTeamId(row(null), v)).toBe("");
    expect(compareTeamId(null, v)).toBe("");
  });
});

describe("compareDisplayName: full name, else short name, else from the slug, else Player N", () => {
  it("each step of the chain", () => {
    expect(compareDisplayName({ fullName: "Josh Allen", slug: "josh-allen" }, "J.Allen", "Player 1")).toBe("Josh Allen");
    expect(compareDisplayName("Josh Allen", "J.Allen", "Player 1")).toBe("Josh Allen");
    expect(compareDisplayName({ fullName: "", slug: "josh-allen" }, "J.Allen", "Player 1")).toBe("J.Allen");
    expect(compareDisplayName({ fullName: null, slug: "josh-allen" }, null, "Player 1")).toBe("Josh Allen");
    expect(compareDisplayName({ fullName: "  ", slug: "" }, "  ", "Player 2")).toBe("Player 2");
    expect(compareDisplayName(null, undefined, "Player 1")).toBe("Player 1");
  });

  it("never empty, never padded, never the word null", () => {
    for (const name of [null, undefined, "", " ", { fullName: null, slug: null }, { fullName: undefined }, {}]) {
      for (const short of [null, undefined, "", " ", 5]) {
        const got = compareDisplayName(name as never, short, "Player 1");
        expect(got).toBe("Player 1");
      }
    }
    expect(compareDisplayName("  Josh Allen ", null, "Player 1")).toBe("Josh Allen");
  });
});
