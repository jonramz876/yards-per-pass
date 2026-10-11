// lib/stats/matchup.ts — the team matchup's pure half (team matchup spec
// 2026-10-10 §3, §6.4, §7, §8.5).
//
// The golden file (fixtures/matchup-2026-w1-3.expected.json) is written by an
// independent Python reference
// (docs/superpowers/specs/matchup-reference/make_matchup_expected.py) from the
// two frozen row fixtures. NEVER re-capture it to make a test pass: a failing
// golden means the TypeScript disagrees with the reference.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import statsRowsJson from "./fixtures/team-game-stats-2026-w1-3.json";
import radarRowsJson from "./fixtures/team-radar-2026-w1-3.json";
import expectedJson from "./fixtures/matchup-2026-w1-3.expected.json";
import playerRowsJson from "./fixtures/compare-2026-w4-rows.json";
import * as M from "@/lib/stats/matchup";
import type { Edge, LadderRow, LineupPlayer, MatchupModel, MatchupStatKey, RankedValue } from "@/lib/stats/matchup";
import {
  RADAR_AXES,
  RADAR_MIN_TEAMS,
  RADAR_RATES_NOTE,
  RADAR_STUFF_NOTE,
  RADAR_TIE_EPSILON,
  buildTeamRadar,
  fmtRadarPct,
  higherIsBetter,
  rankCellLabel,
  spokeRankLabel,
  type RadarAxisKey,
  type RadarSide,
} from "@/lib/stats/team-radar";
import { EXPLOSIVE_NOTE, buildTeamStats, type TeamSideStats } from "@/lib/stats/team-stats";
import { fmtFixed } from "@/lib/stats/box-score";

type Row = Record<string, unknown>;

/* ─── The 35-column rows: the two frozen fixtures joined by (game_id, team_id) (spec §11 "Golden") ─── */

const RADAR_BY_KEY = new Map((radarRowsJson as Row[]).map((r) => [`${r.game_id}|${r.team_id}`, r]));
const ROWS: Row[] = (statsRowsJson as Row[]).map((r) => ({ ...r, ...RADAR_BY_KEY.get(`${r.game_id}|${r.team_id}`) }));

type ExpCell = { value: number | null; rank: number | null; tied: boolean; pool: number };
type ExpEdge = Pick<Edge, "side" | "level" | "gap" | "places" | "tag"> & { tug: number; verdict: string };
type ExpLine = { key: MatchupStatKey; source: "team-stats" | "radar"; off: ExpCell; def: ExpCell; edge: ExpEdge };
type ExpPair = { away: string; home: string; awayGames: number; homeGames: number; awayBall: ExpLine[]; homeBall: ExpLine[] };
type TeamStatField = "epa" | "pass_epa" | "rush_epa" | "sr" | "early_epa" | "late_epa";
const EXPECTED = expectedJson as unknown as {
  teamsPlayed: number;
  throughWeek: number;
  rowCount: number;
  teamStats: Record<string, Record<RadarSide, Record<TeamStatField, ExpCell>>>;
  pairs: ExpPair[];
};

const SIDES: RadarSide[] = ["off", "def"];
const FIELDS: TeamStatField[] = ["epa", "sr", "pass_epa", "rush_epa", "early_epa", "late_epa"];
const DASH = "—";
const DOT = "·";

const build = (rows: unknown, awayId = "BUF", homeId = "HOU", season = 2026): MatchupModel =>
  M.buildMatchup({ rows: rows as Row[], season, awayId, homeId });

const cell = (rank: number | null | undefined, pool = 32) => ({ rank: rank as number | null, pool });
/** An edge from an offense rank and a defense rank (gap = defense − offense). */
const edge = (offRank: number | null | undefined, defRank: number | null | undefined, pool = 32) =>
  M.edgeOf(cell(offRank, pool), cell(defRank, pool));

function close(actual: number | null | undefined, expected: number | null | undefined, label: string) {
  if (expected === null || expected === undefined) {
    expect(actual, label).toBeNull();
    return;
  }
  expect(actual, label).not.toBeNull();
  expect(actual as number, label).toBeCloseTo(expected, 12);
}

/** Every number in a value is finite (no NaN, no Infinity), however deep. */
function assertFinite(value: unknown, path = "model"): void {
  if (typeof value === "number") {
    expect(Number.isFinite(value), path).toBe(true);
  } else if (Array.isArray(value)) {
    value.forEach((v, i) => assertFinite(v, `${path}[${i}]`));
  } else if (value !== null && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) assertFinite(v, `${path}.${k}`);
  } else {
    expect(value === undefined, `${path} is undefined`).toBe(false);
  }
}

describe("the joined fixture rows", () => {
  it("are the 94 rows with the 35 columns of the matchup read", () => {
    expect(ROWS).toHaveLength(94);
    expect(EXPECTED.rowCount).toBe(94);
    for (const r of ROWS) expect(Object.keys(r)).toHaveLength(35);
  });
});

/* ─── §3.3 constants ─── */

describe("the edge constants (§3.3: one place)", () => {
  it("are the spec's numbers", () => {
    expect(M.EDGE_LEAN_MIN_GAP).toBe(5);
    expect(M.EDGE_CLEAR_MIN_GAP).toBe(13);
    expect(M.EDGE_STRENGTH_MAX_RANK).toBe(8);
    expect(M.EDGE_WEAKNESS_MIN_RANK).toBe(25);
    expect(M.EDGE_NAMED_MIN_POOL).toBe(25);
    expect(M.EDGE_TUG_SCALE).toBe(31);
  });
});

/* ─── §3.2 competitionRank ─── */

describe("competitionRank (§3.2: the radar's pairwise count)", () => {
  const rank = (values: (number | null)[], hi = true) =>
    M.competitionRank(values.map((value, i) => ({ id: `T${i}`, value })), hi);
  const ranks = (m: Map<string, RankedValue>) => Array.from(m.values()).map((v) => v.rank);

  it("an empty list is an empty map", () => {
    expect(M.competitionRank([], true).size).toBe(0);
  });

  it("one team: rank 1, pool 1, not tied", () => {
    expect(rank([0.3]).get("T0")).toEqual({ value: 0.3, rank: 1, tied: false, pool: 1 });
  });

  it("32 distinct values, higher is better: 1..32 from the top", () => {
    const values = Array.from({ length: 32 }, (_, i) => i / 100);
    const got = rank(values, true);
    values.forEach((_, i) => expect(got.get(`T${i}`)).toEqual({ value: i / 100, rank: 32 - i, tied: false, pool: 32 }));
  });

  it("32 distinct values, lower is better: 1..32 from the bottom", () => {
    const values = Array.from({ length: 32 }, (_, i) => i / 100);
    const got = rank(values, false);
    values.forEach((_, i) => expect(got.get(`T${i}`)?.rank).toBe(i + 1));
  });

  it("two values 1e-12 apart tie, print \"T-\", and the next rank is skipped (1, 1, 3)", () => {
    const got = rank([0.5, 0.5 + 1e-12, 0.4]);
    expect(ranks(got)).toEqual([1, 1, 3]);
    expect(Array.from(got.values()).map((v) => v.tied)).toEqual([true, true, false]);
    expect(spokeRankLabel(got.get("T0")!)).toBe("T-1st");
    expect(spokeRankLabel(got.get("T2")!)).toBe("3rd");
  });

  it("three tied for last among 32 are all 30th", () => {
    const values = [...Array.from({ length: 29 }, (_, i) => 1 - i / 100), 0.1, 0.1, 0.1];
    const got = rank(values);
    for (const id of ["T29", "T30", "T31"]) expect(got.get(id)).toEqual({ value: 0.1, rank: 30, tied: true, pool: 32 });
    expect(got.get("T28")).toMatchObject({ rank: 29, tied: false });
  });

  it("a null, NaN, Infinity or numeric-string value is not in the pool", () => {
    const got = M.competitionRank(
      [
        { id: "A", value: 0.2 },
        { id: "B", value: null },
        { id: "C", value: NaN },
        { id: "D", value: Infinity },
        { id: "E", value: "0.9" as never },
        { id: "F", value: -Infinity },
        { id: "G", value: undefined as never },
        { id: "H", value: 0.1 },
      ],
      true,
    );
    expect(got.get("A")).toEqual({ value: 0.2, rank: 1, tied: false, pool: 2 });
    expect(got.get("H")).toEqual({ value: 0.1, rank: 2, tied: false, pool: 2 });
    for (const id of ["B", "C", "D", "E", "F", "G"]) {
      expect(got.get(id), id).toEqual({ value: null, rank: null, tied: false, pool: 2 });
    }
  });

  it("1,000 entries", () => {
    const got = rank(Array.from({ length: 1000 }, (_, i) => i));
    expect(got.size).toBe(1000);
    expect(got.get("T999")).toEqual({ value: 999, rank: 1, tied: false, pool: 1000 });
    expect(got.get("T0")).toEqual({ value: 0, rank: 1000, tied: false, pool: 1000 });
  });

  it("null or junk input does not throw", () => {
    expect(M.competitionRank(null as never, true).size).toBe(0);
    expect(M.competitionRank([null, undefined, 5, { id: "A", value: 1 }] as never, true).get("A")).toMatchObject({ rank: 1, pool: 1 });
  });

  it("a chain of near-ties gives exactly what the radar's loop gives (a sort-then-group version does not)", () => {
    // 0.4, 0.4 + 0.6e-9, 0.4 + 1.2e-9: the middle one is tied with both ends,
    // the ends are not tied with each other.
    const tops = [4e9, 4e9 + 6, 4e9 + 12];
    const rows = tops.map((top, i) => ({
      game_id: `2026_01_T${i}_X${i}`, team_id: `T${i}`, opponent_id: `X${i}`, season: 2026, week: 1,
      pass_plays: 1e10, explosive_pass: top,
    }));
    const radar = buildTeamRadar(rows, 2026);
    const spokes = ["T0", "T1", "T2"].map((id) => radar.teams.find((t) => t.team === id)!.off.spokes[0]);
    const values = spokes.map((s) => s.value as number);
    expect(values[1] - values[0]).toBeLessThan(RADAR_TIE_EPSILON);
    expect(values[2] - values[1]).toBeLessThan(RADAR_TIE_EPSILON);
    expect(values[2] - values[0]).toBeGreaterThanOrEqual(RADAR_TIE_EPSILON);
    expect(spokes.map((s) => s.rank)).toEqual([2, 1, 1]);

    const got = rank(values, true);
    expect(ranks(got)).toEqual([2, 1, 1]);
    expect(Array.from(got.values()).map((v) => v.tied)).toEqual([true, true, true]);
    spokes.forEach((s, i) => {
      expect(got.get(`T${i}`)).toEqual({ value: s.value, rank: s.rank, tied: s.tied, pool: s.pool });
    });
  });

  it("for every spoke of the fixture, reproduces buildTeamRadar's rank, tied and pool", () => {
    const radar = buildTeamRadar(ROWS, 2026);
    let checked = 0;
    for (const side of SIDES) {
      RADAR_AXES.forEach((axis, i) => {
        const got = M.competitionRank(
          radar.teams.map((t) => ({ id: t.team, value: t[side].spokes[i].value })),
          higherIsBetter(axis, side),
        );
        for (const t of radar.teams) {
          const s = t[side].spokes[i];
          expect(got.get(t.team), `${t.team} ${side} ${axis.key}`).toEqual({ value: s.value, rank: s.rank, tied: s.tied, pool: s.pool });
          checked += 1;
        }
      });
    }
    expect(checked).toBe(32 * 2 * 7);
  });
});

/* ─── §3.2 rankTeamStat ─── */

describe("rankTeamStat (§3.2, §7.2)", () => {
  const STATS = buildTeamStats(ROWS);

  it("equals the golden for all six fields × both sides × every team", () => {
    let checked = 0;
    for (const field of FIELDS) {
      for (const side of SIDES) {
        const got = M.rankTeamStat(STATS, field, side, true);
        for (const [team, sides] of Object.entries(EXPECTED.teamStats)) {
          const want = sides[side][field];
          const mine = got.get(team);
          const label = `${team} ${side} ${field}`;
          expect(mine, label).toBeDefined();
          close(mine!.value, want.value, label);
          expect(mine!.rank, label).toBe(want.rank);
          expect(mine!.tied, label).toBe(want.tied);
          expect(mine!.pool, label).toBe(want.pool);
          checked += 1;
        }
      }
    }
    expect(checked).toBe(6 * 2 * 32);
  });

  it("the value is buildTeamStats' own number, never recomputed", () => {
    for (const field of FIELDS) {
      for (const side of SIDES) {
        const got = M.rankTeamStat(STATS, field, side, true);
        for (const t of STATS.teams) expect(got.get(t.team)!.value).toBe(t[side][field as keyof TeamSideStats]);
      }
    }
  });

  it("defense is the reverse of offense on every field", () => {
    for (const field of FIELDS) {
      const values = (side: RadarSide) => STATS.teams.map((t) => ({ id: t.team, v: t[side][field as keyof TeamSideStats] as number }));
      const best = (side: RadarSide, hi: boolean) =>
        values(side).reduce((a, b) => ((hi ? b.v > a.v : b.v < a.v) ? b : a)).id;
      expect(M.rankTeamStat(STATS, field, "off", true).get(best("off", true))!.rank, `${field} off`).toBe(1);
      expect(M.rankTeamStat(STATS, field, "def", true).get(best("def", false))!.rank, `${field} def`).toBe(1);
      // and the other way round when the offense wants a LOWER number
      expect(M.rankTeamStat(STATS, field, "off", false).get(best("off", false))!.rank).toBe(1);
      expect(M.rankTeamStat(STATS, field, "def", false).get(best("def", true))!.rank).toBe(1);
    }
  });

  it("a team with no row of its own (only an opponent's) has no rank and is not in any pool", () => {
    const rows = ROWS.filter((r) => r.team_id !== "BUF");
    const stats = buildTeamStats(rows);
    const buf = stats.teams.find((t) => t.team === "BUF")!;
    expect(buf.off.gp).toBe(0);
    expect(buf.def.gp).toBe(3);
    for (const side of SIDES) {
      const got = M.rankTeamStat(stats, "epa", side, true);
      expect(got.get("BUF")).toEqual({ value: null, rank: null, tied: false, pool: 31 });
      expect(got.get("HOU")!.pool).toBe(31);
      expect(got.get("HOU")!.rank).not.toBeNull();
    }
  });

  it("a team that has not played at all has no rank", () => {
    const rows = ROWS.filter((r) => r.team_id !== "BUF" && r.opponent_id !== "BUF");
    const got = M.rankTeamStat(buildTeamStats(rows), "pass_epa", "off", true);
    expect(got.get("BUF")).toMatchObject({ value: null, rank: null, tied: false });
  });

  it("−0 and 0 tie", () => {
    const row = (team: string, opp: string, epa: number) => ({
      game_id: `2026_01_${team}_${opp}`, team_id: team, opponent_id: opp, season: 2026, week: 1, plays: 10, epa_per_play: epa,
    });
    const stats = buildTeamStats([row("AAA", "BBB", -0), row("BBB", "AAA", 0), row("CCC", "DDD", -0.5)]);
    const got = M.rankTeamStat(stats, "epa", "off", true);
    expect(got.get("AAA")).toMatchObject({ rank: 1, tied: true, pool: 3 });
    expect(got.get("BBB")).toMatchObject({ rank: 1, tied: true, pool: 3 });
    expect(got.get("CCC")).toMatchObject({ rank: 3, tied: false, pool: 3 });
  });

  it("an empty model does not throw", () => {
    const got = M.rankTeamStat(buildTeamStats([]), "epa", "off", true);
    expect(got.get("BUF")).toEqual({ value: null, rank: null, tied: false, pool: 0 });
  });
});

describe("the four shared lines (§3.1, S2): the radar spoke is Team Stats' number", () => {
  it("pass_sr, expl_pass, rush_sr and expl_rush match for every team and side", () => {
    const stats = buildTeamStats(ROWS);
    const radar = buildTeamRadar(ROWS, 2026);
    const pairs: [RadarAxisKey, keyof TeamSideStats][] = [
      ["pass_sr", "pass_sr"], ["expl_pass", "expl_pass_rate"], ["rush_sr", "rush_sr"], ["expl_rush", "expl_rush_rate"],
    ];
    let checked = 0;
    for (const t of radar.teams) {
      const s = stats.teams.find((x) => x.team === t.team)!;
      for (const side of SIDES) {
        for (const [spokeKey, statKey] of pairs) {
          const spoke = t[side].spokes.find((x) => x.key === spokeKey)!;
          close(spoke.value, s[side][statKey] as number | null, `${t.team} ${side} ${spokeKey}`);
          checked += 1;
        }
      }
    }
    expect(checked).toBe(32 * 2 * 4);
  });
});

/* ─── §3.1 the 13 lines ─── */

describe("MATCHUP_STATS (§3.1)", () => {
  it("is the 13 rows in the spec's order", () => {
    expect(M.MATCHUP_STATS.map((s) => s.key)).toEqual([
      "epa", "sr", "pass_epa", "pass_sr", "expl_pass", "sack", "rush_epa", "rush_sr", "expl_rush", "stuff", "to", "early_epa", "late_epa",
    ]);
  });

  it("groups: Overall 2, Passing 4, Rushing 4, Turnovers 1, Downs 2, each in one run", () => {
    expect(M.MATCHUP_STATS.map((s) => s.group)).toEqual([
      "Overall", "Overall", "Passing", "Passing", "Passing", "Passing",
      "Rushing", "Rushing", "Rushing", "Rushing", "Turnovers", "Downs", "Downs",
    ]);
  });

  it("labels", () => {
    expect(M.MATCHUP_STATS.map((s) => s.label)).toEqual([
      "EPA / play", "Success rate", "Pass EPA / play", "Pass success rate", "Explosive pass rate", "Sack rate",
      "Rush EPA / play", "Run success rate", "Explosive run rate", "Stuff rate", "Turnover rate vs takeaway rate",
      "Early downs EPA (1st–2nd)", "Late downs EPA (3rd–4th)",
    ]);
    expect(M.MATCHUP_STATS.find((s) => s.key === "to")!.shortLabel).toBe("Turnovers");
  });

  it("direction, row by row: sack, stuff and turnover are the only lines where the offense wants a lower number", () => {
    const lower = M.MATCHUP_STATS.filter((s) => !s.offHigherBetter).map((s) => s.key);
    expect(lower).toEqual(["sack", "stuff", "to"]);
    for (const s of M.MATCHUP_STATS) {
      expect(s.offHigherBetter, s.key).toBe(!["sack", "stuff", "to"].includes(s.key));
    }
  });

  it("the radar lines keep the radar's own direction", () => {
    for (const s of M.MATCHUP_STATS.filter((x) => x.source === "radar")) {
      expect(s.offHigherBetter, s.key).toBe(RADAR_AXES.find((a) => a.key === s.key)!.offHigherBetter);
    }
  });

  it("source: six from Team Stats, seven from the radar", () => {
    expect(M.MATCHUP_STATS.filter((s) => s.source === "team-stats").map((s) => s.key)).toEqual([
      "epa", "sr", "pass_epa", "rush_epa", "early_epa", "late_epa",
    ]);
    expect(M.MATCHUP_STATS.filter((s) => s.source === "radar").map((s) => s.key).sort()).toEqual(RADAR_AXES.map((a) => a.key).sort());
  });

  it("format: EPA for the five EPA lines, pct for the rest", () => {
    expect(M.MATCHUP_STATS.filter((s) => s.format === "epa").map((s) => s.key)).toEqual(["epa", "pass_epa", "rush_epa", "early_epa", "late_epa"]);
    expect(M.MATCHUP_STATS.filter((s) => s.format === "pct")).toHaveLength(8);
  });

  it("the word under the defense rank, per row", () => {
    const words = Object.fromEntries(M.MATCHUP_STATS.map((s) => [s.key, s.defWord]));
    expect(words).toEqual({
      epa: "allowed", sr: "allowed", pass_epa: "allowed", pass_sr: "allowed", expl_pass: "allowed", sack: "made",
      rush_epa: "allowed", rush_sr: "allowed", expl_rush: "allowed", stuff: "made", to: "takeaways",
      early_epa: "allowed", late_epa: "allowed",
    });
  });
});

/* ─── §3.3 edgeOf ─── */

describe("edgeOf (§3.3: every boundary)", () => {
  it("gap 0: even, same rank", () => {
    expect(edge(15, 15)).toEqual({ side: "even", level: 0, gap: 0, places: 0, tag: "Even" });
  });

  it.each([
    [15, 16, 1], [16, 15, -1], [10, 14, 4], [14, 10, -4],
  ])("offense %i against defense %i (gap %i) is even", (off, def, gap) => {
    expect(edge(off, def)).toEqual({ side: "even", level: 0, gap, places: Math.abs(gap), tag: "Even" });
  });

  it("gap +5 is a lean to the offense; gap −5 a lean to the defense", () => {
    expect(edge(10, 15)).toEqual({ side: "off", level: 1, gap: 5, places: 5, tag: "Lean" });
    expect(edge(15, 10)).toEqual({ side: "def", level: 1, gap: -5, places: 5, tag: "Lean" });
  });

  it("gap ±12 is still a lean; ±13 is a clear edge", () => {
    expect(edge(10, 22)).toEqual({ side: "off", level: 1, gap: 12, places: 12, tag: "Lean" });
    expect(edge(22, 10)).toEqual({ side: "def", level: 1, gap: -12, places: 12, tag: "Lean" });
    expect(edge(10, 23)).toEqual({ side: "off", level: 2, gap: 13, places: 13, tag: "Clear edge" });
    expect(edge(23, 10)).toEqual({ side: "def", level: 2, gap: -13, places: 13, tag: "Clear edge" });
  });

  it("gap ±31: (1, 32) is a clear edge to the offense, (32, 1) to the defense", () => {
    expect(edge(1, 32)).toEqual({ side: "off", level: 2, gap: 31, places: 31, tag: "Clear edge" });
    expect(edge(32, 1)).toEqual({ side: "def", level: 2, gap: -31, places: 31, tag: "Clear edge" });
  });

  it("tied ranks use the shared place: offense T-3rd against defense 8th is gap +5, a lean", () => {
    const got = M.edgeOf({ rank: 3, pool: 32, tied: true } as never, { rank: 8, pool: 32 });
    expect(got).toMatchObject({ side: "off", level: 1, gap: 5 });
  });

  it("strength on strength: both ranks 8th or better and within 4 places", () => {
    expect(edge(8, 8).tag).toBe("Strength on strength");
    expect(edge(4, 8).tag).toBe("Strength on strength");
    expect(edge(8, 4).tag).toBe("Strength on strength");
    expect(edge(1, 1)).toEqual({ side: "even", level: 0, gap: 0, places: 0, tag: "Strength on strength" });
    expect(edge(8, 9).tag).toBe("Even");
    expect(edge(9, 8).tag).toBe("Even");
  });

  it("4th against 9th is gap 5: a lean, never a named even", () => {
    expect(edge(4, 9)).toEqual({ side: "off", level: 1, gap: 5, places: 5, tag: "Lean" });
    expect(edge(3, 8)).toMatchObject({ side: "off", tag: "Lean" });
  });

  it("weakness on weakness: both ranks 25th or worse and within 4 places", () => {
    expect(edge(25, 25).tag).toBe("Weakness on weakness");
    expect(edge(25, 29).tag).toBe("Weakness on weakness");
    expect(edge(29, 25).tag).toBe("Weakness on weakness");
    expect(edge(32, 32).tag).toBe("Weakness on weakness");
    expect(edge(24, 25).tag).toBe("Even");
    expect(edge(25, 24).tag).toBe("Even");
  });

  it("a null rank on either side, both sides, undefined, or a null object: not enough data", () => {
    const na = { side: "na", level: 0, gap: null, places: null, tag: "Not enough data" };
    expect(edge(null, 5)).toEqual(na);
    expect(edge(5, null)).toEqual(na);
    expect(edge(null, null)).toEqual(na);
    expect(edge(undefined, 5)).toEqual(na);
    expect(M.edgeOf(null, cell(5))).toEqual(na);
    expect(M.edgeOf(cell(5), undefined)).toEqual(na);
    expect(M.edgeOf(null, null)).toEqual(na);
    expect(M.edgeOf(undefined, undefined)).toEqual(na);
    expect(M.edgeOf({} as never, cell(5))).toEqual(na);
  });

  it("rank 0, a negative, fractional or non-finite rank: not enough data", () => {
    for (const bad of [0, -1, 2.5, NaN, Infinity, "3" as never]) {
      expect(edge(bad, 5).side, String(bad)).toBe("na");
      expect(edge(5, bad).side, String(bad)).toBe("na");
    }
  });

  it("small pools (S3): the named labels need both pools at 25 or more; 24 is plain Even", () => {
    expect(edge(2, 3, 24).tag).toBe("Even");
    expect(edge(2, 3, 25).tag).toBe("Strength on strength");
    expect(edge(8, 8, 8).tag).toBe("Even");
    expect(edge(25, 25, 25).tag).toBe("Weakness on weakness");
    expect(M.edgeOf(cell(2, 32), cell(3, 24)).tag).toBe("Even");
    expect(M.edgeOf(cell(2, 24), cell(3, 32)).tag).toBe("Even");
    expect(M.edgeOf(cell(2, 32), cell(3, NaN)).tag).toBe("Even");
    expect(M.edgeOf({ rank: 2 } as never, cell(3, 32)).tag).toBe("Even");
  });

  it("the lean and clear cut-offs stay 5 and 13 in any pool", () => {
    expect(edge(1, 6, 8)).toMatchObject({ side: "off", level: 1, tag: "Lean" });
    expect(edge(1, 14, 14)).toMatchObject({ side: "off", level: 2, tag: "Clear edge" });
  });

  it("pools of different size: the gap is still rank minus rank", () => {
    expect(M.edgeOf(cell(3, 31), cell(20, 32))).toEqual({ side: "off", level: 2, gap: 17, places: 17, tag: "Clear edge" });
  });
});

/* ─── §3.3 tug marker and verdict ─── */

describe("tugPosition (§3.3)", () => {
  it("50 at gap 0, 0 at +31, 100 at −31", () => {
    expect(M.tugPosition(edge(15, 15))).toBe(50);
    expect(M.tugPosition(edge(1, 32))).toBe(0);
    expect(M.tugPosition(edge(32, 1))).toBe(100);
  });

  it("a positive gap slides the marker left (the offense is on the left)", () => {
    expect(M.tugPosition(edge(10, 15))).toBeCloseTo(50 - (5 / 31) * 50, 12);
    expect(M.tugPosition(edge(15, 10))).toBeCloseTo(50 + (5 / 31) * 50, 12);
  });

  it("is clamped to 0-100 beyond the scale", () => {
    expect(M.tugPosition({ side: "off", level: 2, gap: 40, places: 40, tag: "Clear edge" })).toBe(0);
    expect(M.tugPosition({ side: "def", level: 2, gap: -40, places: 40, tag: "Clear edge" })).toBe(100);
  });

  it("50 for not enough data, and for a gap that is not a number", () => {
    expect(M.tugPosition(edge(null, 5))).toBe(50);
    expect(M.tugPosition({ side: "na", level: 0, gap: NaN, places: null, tag: "Not enough data" })).toBe(50);
  });

  it("an even row sits within 6.5% of the middle", () => {
    for (const [off, def] of [[10, 14], [14, 10], [10, 11], [8, 8]]) {
      expect(Math.abs(M.tugPosition(edge(off, def)) - 50)).toBeLessThanOrEqual(6.5);
    }
  });
});

describe("verdictText (§3.3's table)", () => {
  it("lean: the better-ranked unit by N places", () => {
    expect(M.verdictText(edge(10, 17), "BUF", "LA")).toBe("BUF offense by 7 places");
    expect(M.verdictText(edge(17, 10), "BUF", "LA")).toBe("LA defense by 7 places");
  });

  it("clear edge", () => {
    expect(M.verdictText(edge(2, 26), "BUF", "LA")).toBe(`BUF offense by 24 places ${DOT} clear edge`);
    expect(M.verdictText(edge(26, 2), "BUF", "LA")).toBe(`LA defense by 24 places ${DOT} clear edge`);
  });

  it("even: the tag and how far apart (\"1 place\", \"same rank\")", () => {
    expect(M.verdictText(edge(15, 17), "BUF", "LA")).toBe(`Even ${DOT} 2 places apart`);
    expect(M.verdictText(edge(17, 15), "BUF", "LA")).toBe(`Even ${DOT} 2 places apart`);
    expect(M.verdictText(edge(15, 16), "BUF", "LA")).toBe(`Even ${DOT} 1 place apart`);
    expect(M.verdictText(edge(15, 15), "BUF", "LA")).toBe(`Even ${DOT} same rank`);
    expect(M.verdictText(edge(4, 8), "BUF", "LA")).toBe(`Strength on strength ${DOT} 4 places apart`);
    expect(M.verdictText(edge(8, 8), "BUF", "LA")).toBe(`Strength on strength ${DOT} same rank`);
    expect(M.verdictText(edge(30, 29), "BUF", "LA")).toBe(`Weakness on weakness ${DOT} 1 place apart`);
  });

  it("not enough data", () => {
    expect(M.verdictText(edge(null, 4), "BUF", "LA")).toBe("Not enough data");
  });

  it("never names a winner, a probability or a score", () => {
    for (const e of [edge(1, 32), edge(32, 1), edge(10, 17), edge(15, 15), edge(null, 1)]) {
      expect(M.verdictText(e, "BUF", "LA")).not.toMatch(/win|beat|favou?r|%|probab|score|predict/i);
    }
  });
});

/* ─── §7.2 buildMatchup ─── */

const fmtValue = (line: ExpLine, v: number | null) =>
  M.MATCHUP_STATS.find((s) => s.key === line.key)!.format === "epa" ? fmtFixed(v, 3, true) : fmtRadarPct(v);

function expectLadder(rows: LadderRow[], lines: ExpLine[], teamsPlayed: number, label: string) {
  expect(rows).toHaveLength(13);
  lines.forEach((line, i) => {
    const row = rows[i];
    const at = `${label} ${line.key}`;
    expect(row.key, at).toBe(line.key);
    expect(row.offValue, at).toBe(fmtValue(line, line.off.value));
    expect(row.defValue, at).toBe(fmtValue(line, line.def.value));
    expect(row.offRank, at).toBe(rankCellLabel(line.off, teamsPlayed));
    expect(row.defRank, at).toBe(rankCellLabel(line.def, teamsPlayed));
    expect(row.edge, at).toEqual({ side: line.edge.side, level: line.edge.level, gap: line.edge.gap, places: line.edge.places, tag: line.edge.tag });
    expect(row.tug, at).toBeCloseTo(line.edge.tug, 10);
    expect(row.verdict, at).toBe(line.edge.verdict);
  });
}

describe("buildMatchup: the golden (three pairs, all 26 edges each)", () => {
  it("the golden holds the three pairs the spec names, 13 lines a ladder", () => {
    expect(EXPECTED.pairs.map((p) => `${p.away}@${p.home}`)).toEqual(["BUF@HOU", "DET@NO", "CHI@PHI"]);
    for (const p of EXPECTED.pairs) {
      expect(p.awayBall).toHaveLength(13);
      expect(p.homeBall).toHaveLength(13);
    }
    expect(EXPECTED.pairs[2].awayGames).toBe(2);
    expect(EXPECTED.pairs[2].homeGames).toBe(2);
  });

  it.each(EXPECTED.pairs.map((p) => [`${p.away} at ${p.home}`, p] as const))("%s", (_name, pair) => {
    const m = build(ROWS, pair.away, pair.home);
    expect(m.state).toBe("ready");
    expect(m.season).toBe(2026);
    expect(m.teamsPlayed).toBe(EXPECTED.teamsPlayed);
    expect(m.throughWeek).toBe(EXPECTED.throughWeek);
    expect(m.away).toEqual({ id: pair.away, games: pair.awayGames });
    expect(m.home).toEqual({ id: pair.home, games: pair.homeGames });
    expect(m.rejected).toEqual([]);
    expect(m.awayBall!.ladder.offId).toBe(pair.away);
    expect(m.awayBall!.ladder.defId).toBe(pair.home);
    expect(m.homeBall!.ladder.offId).toBe(pair.home);
    expect(m.homeBall!.ladder.defId).toBe(pair.away);
    expectLadder(m.awayBall!.ladder.rows, pair.awayBall, m.teamsPlayed, "away ball");
    expectLadder(m.homeBall!.ladder.rows, pair.homeBall, m.teamsPlayed, "home ball");
  });

  it("the ladder's printed forms on real numbers (BUF at HOU)", () => {
    const m = build(ROWS);
    const rows = m.awayBall!.ladder.rows;
    for (const r of rows) {
      const stat = M.MATCHUP_STATS.find((s) => s.key === r.key)!;
      expect(r.offValue, r.key).toMatch(stat.format === "epa" ? /^([+−]\d\.\d{3}|0\.000)$/ : /^\d{1,3}\.\d%$/);
      expect(r.defValue, r.key).toMatch(stat.format === "epa" ? /^([+−]\d\.\d{3}|0\.000)$/ : /^\d{1,3}\.\d%$/);
      expect(r.offRank, r.key).toMatch(/^(T-)?\d{1,2}(st|nd|rd|th)$/);
      expect(r.defRank, r.key).toMatch(/^(T-)?\d{1,2}(st|nd|rd|th)$/);
      expect(r.label).toBe(stat.label);
      expect(r.shortLabel).toBe(stat.shortLabel ?? stat.label);
      expect(r.group).toBe(stat.group);
      expect(r.defWord).toBe(stat.defWord);
    }
  });
});

describe("buildMatchup: shape and states (§3.4, §7.2)", () => {
  const RADAR = buildTeamRadar(ROWS, 2026);
  const KEYS = M.MATCHUP_STATS.map((s) => s.key);
  const ladderKeys = (m: MatchupModel, ball: "awayBall" | "homeBall") => m[ball]!.ladder.rows.map((r) => r.key);

  it("always 13 rows per ladder, in the §3.1 order", () => {
    const m = build(ROWS, "DET", "NO");
    expect(ladderKeys(m, "awayBall")).toEqual(KEYS);
    expect(ladderKeys(m, "homeBall")).toEqual(KEYS);
  });

  it("awayBall is the away offense against the home defense, homeBall the reverse (swap test)", () => {
    const ab = build(ROWS, "BUF", "HOU");
    const ba = build(ROWS, "HOU", "BUF");
    expect(ab.awayBall).toEqual(ba.homeBall);
    expect(ab.homeBall).toEqual(ba.awayBall);
    expect(ab.away).toEqual(ba.home);
    expect(ab.awayBall).not.toEqual(ab.homeBall);
  });

  it("throughWeek and teamsPlayed are buildTeamRadar's", () => {
    const m = build(ROWS);
    expect(m.throughWeek).toBe(RADAR.throughWeek);
    expect(m.teamsPlayed).toBe(RADAR.teamsPlayed);
  });

  const firstTeams = (n: number) => {
    const ids = Array.from(new Set(ROWS.map((r) => r.team_id as string))).sort().slice(0, n);
    return { ids, rows: ROWS.filter((r) => ids.includes(r.team_id as string)) };
  };

  it("7 teams played: small-pool, both sides null, no rank anywhere (S4)", () => {
    const { ids, rows } = firstTeams(RADAR_MIN_TEAMS - 1);
    const m = build(rows, ids[0], ids[1]);
    expect(m.teamsPlayed).toBe(7);
    expect(m.state).toBe("small-pool");
    expect(m.awayBall).toBeNull();
    expect(m.homeBall).toBeNull();
    expect(m.away).toEqual({ id: ids[0], games: rows.filter((r) => r.team_id === ids[0]).length });
    expect(JSON.stringify(m)).not.toMatch(/\d(st|nd|rd|th)\b/);
  });

  it("8 teams played: ready", () => {
    const { ids, rows } = firstTeams(RADAR_MIN_TEAMS);
    const m = build(rows, ids[0], ids[1]);
    expect(m.teamsPlayed).toBe(8);
    expect(m.state).toBe("ready");
    expect(m.awayBall!.ladder.rows).toHaveLength(13);
    expect(m.homeBall!.ladder.rows).toHaveLength(13);
  });

  it("empty rows and null rows: small-pool, no throw", () => {
    for (const rows of [[], null, undefined, "rows", 7, {}]) {
      const m = build(rows);
      expect(m).toMatchObject({ state: "small-pool", teamsPlayed: 0, throughWeek: null, awayBall: null, homeBall: null, rejected: [] });
      expect(m.away).toEqual({ id: "BUF", games: 0 });
      expect(m.home).toEqual({ id: "HOU", games: 0 });
    }
  });

  it("a team with no rows: its cells are dashes, every row it is part of is na, games 0, its overlay side null, no throw", () => {
    const rows = ROWS.filter((r) => r.team_id !== "BUF" && r.opponent_id !== "BUF");
    const m = build(rows, "BUF", "DET");
    expect(m.state).toBe("ready");
    expect(m.teamsPlayed).toBe(31);
    expect(m.away).toEqual({ id: "BUF", games: 0 });
    // DET's own rows that are left (its game against BUF went with BUF's)
    expect(m.home.games).toBe(rows.filter((r) => r.team_id === "DET").length);
    expect(m.home.games).toBeGreaterThan(0);
    for (const r of m.awayBall!.ladder.rows) {
      expect(r.offValue, r.key).toBe(DASH);
      expect(r.offRank, r.key).toBe(DASH);
      expect(r.edge, r.key).toEqual({ side: "na", level: 0, gap: null, places: null, tag: "Not enough data" });
      expect(r.tug).toBe(50);
      expect(r.verdict).toBe("Not enough data");
      // the other team's numbers still print
      expect(r.defValue, r.key).not.toBe(DASH);
      expect(r.defRank, r.key).not.toBe(DASH);
    }
    for (const r of m.homeBall!.ladder.rows) {
      expect(r.defValue, r.key).toBe(DASH);
      expect(r.defRank, r.key).toBe(DASH);
      expect(r.edge.side, r.key).toBe("na");
      expect(r.offValue, r.key).not.toBe(DASH);
    }
    expect(m.awayBall!.overlay.off).toBeNull();
    expect(m.awayBall!.overlay.def).not.toBeNull();
    expect(m.homeBall!.overlay.def).toBeNull();
    expect(m.homeBall!.overlay.off).not.toBeNull();
    for (const ball of [m.awayBall!, m.homeBall!]) {
      expect(ball.overlay.drawn).toBe(false);
      expect(ball.overlay.tally).toBeNull();
      expect(ball.overlay.spokes).toHaveLength(7);
      for (const s of ball.overlay.spokes) expect(s.gapBar).toBe(false);
    }
    expect(m.awayBall!.overlay.spokes[0].rankLine).toMatch(new RegExp(`^${DASH} v (T-)?\\d`));
  });

  it("a team with only an opponent's row (no row of its own) has not played: games 0, dashes, na", () => {
    const rows = ROWS.filter((r) => r.team_id !== "BUF");
    const m = build(rows, "BUF", "DET");
    expect(m.away.games).toBe(0);
    for (const ball of [m.awayBall!, m.homeBall!]) {
      for (const r of ball.ladder.rows) expect(r.edge.side, r.key).toBe("na");
    }
    for (const r of m.homeBall!.ladder.rows) {
      expect(r.defValue, r.key).toBe(DASH);
      expect(r.defRank, r.key).toBe(DASH);
    }
    expect(m.awayBall!.overlay.off).toBeNull();
    expect(m.homeBall!.overlay.def).toBeNull();
  });

  it("both teams with no rows", () => {
    const gone = ["BUF", "DET"];
    const rows = ROWS.filter((r) => !gone.includes(r.team_id as string) && !gone.includes(r.opponent_id as string));
    const m = build(rows, "BUF", "DET");
    expect(m.state).toBe("ready");
    expect(m.away.games).toBe(0);
    expect(m.home.games).toBe(0);
    for (const ball of [m.awayBall!, m.homeBall!]) {
      expect(ball.overlay.off).toBeNull();
      expect(ball.overlay.def).toBeNull();
      for (const r of ball.ladder.rows) {
        expect([r.offValue, r.offRank, r.defValue, r.defRank]).toEqual([DASH, DASH, DASH, DASH]);
        expect(r.edge.side).toBe("na");
      }
    }
  });

  it("an unknown team id is a team that has not played, never a throw", () => {
    for (const id of ["XXX", "", "buf", "__proto__", "constructor"]) {
      const m = build(ROWS, id, "HOU");
      expect(m.state).toBe("ready");
      expect(m.away).toEqual({ id, games: 0 });
      for (const r of m.awayBall!.ladder.rows) expect(r.edge.side).toBe("na");
      expect(m.awayBall!.overlay.off).toBeNull();
    }
  });

  it("the same team on both sides does not throw (the route answers 404 before this)", () => {
    const m = build(ROWS, "BUF", "BUF");
    expect(m.awayBall!.ladder.rows).toHaveLength(13);
  });

  it("rows of another season, a repeated (game_id, team_id) and non-objects change nothing", () => {
    const noisy = [
      ...ROWS,
      ...ROWS.slice(0, 6),
      ...ROWS.slice(0, 12).map((r) => ({ ...r, season: 2025, game_id: String(r.game_id).replace("2026", "2025"), epa_per_play: 9 })),
      null, undefined, 5, "row", [],
    ];
    expect(build(noisy)).toEqual(build(ROWS));
    expect(build(noisy, "DET", "NO")).toEqual(build(ROWS, "DET", "NO"));
  });

  it("the row filter is buildTeamRadar's: the same row count on the fixture and on mixed rows", () => {
    const mixes: unknown[][] = [
      ROWS,
      [...ROWS, ...ROWS.slice(0, 6)],
      [...ROWS, ...ROWS.slice(0, 12).map((r) => ({ ...r, season: 2025 }))],
      [...ROWS, null, undefined, 5, "row", [], {}],
      [...ROWS, { ...ROWS[0], season: null }, { ...ROWS[1], season: "2026" }, { ...ROWS[2], season: "2025" }],
      [...ROWS, { ...ROWS[0], game_id: null }, { ...ROWS[0], game_id: null }, { ...ROWS[0], team_id: "" }],
      [],
    ];
    for (const rows of mixes) {
      expect(M.matchupSeasonRows(rows as never, 2026)).toHaveLength(buildTeamRadar(rows as never, 2026).rowCount);
    }
    expect(M.matchupSeasonRows(null as never, 2026)).toEqual([]);
    expect(M.matchupSeasonRows(ROWS, 2025)).toHaveLength(0);
  });

  it("a NULL designed_runs: the stuff row is na and that spoke is missing (never 0)", () => {
    const first = ROWS.findIndex((r) => r.team_id === "BUF");
    const rows = ROWS.map((r, i) => (i === first ? { ...r, designed_runs: null } : r));
    const m = build(rows);
    const stuff = m.awayBall!.ladder.rows.find((r) => r.key === "stuff")!;
    expect(stuff.offValue).toBe(DASH);
    expect(stuff.offRank).toBe(DASH);
    expect(stuff.edge.side).toBe("na");
    const spoke = m.awayBall!.overlay.spokes.find((s) => s.key === "stuff")!;
    expect(spoke.rankLine).toMatch(new RegExp(`^${DASH} v `));
    expect(spoke.gapBar).toBe(false);
    expect(m.awayBall!.overlay.tally!.ranked).toBe(6);
    // every other row still has its numbers
    for (const r of m.awayBall!.ladder.rows.filter((x) => x.key !== "stuff")) expect(r.edge.side).not.toBe("na");
    expect(m.rejected).toEqual([]);
  });

  it("a pool smaller than the teams that have played prints \"of {pool}\"", () => {
    const i = ROWS.findIndex((r) => r.team_id === "ARI" && r.opponent_id === "LAC");
    const rows = ROWS.map((r, j) => (j === i ? { ...r, designed_runs: null } : r));
    const stuff = build(rows).awayBall!.ladder.rows.find((r) => r.key === "stuff")!;
    expect(stuff.offRank).toMatch(/^(T-)?\d{1,2}(st|nd|rd|th) of 31$/);
    expect(stuff.defRank).toMatch(/^(T-)?\d{1,2}(st|nd|rd|th) of 31$/);
    expect(stuff.edge.side).not.toBe("na");
  });

  it("a rate outside 0-1: the row is na and the rate is listed in rejected", () => {
    const first = ROWS.findIndex((r) => r.team_id === "BUF");
    const rows = ROWS.map((r, i) => (i === first ? { ...r, pass_success_rate: 12 } : r));
    const m = build(rows);
    const row = m.awayBall!.ladder.rows.find((r) => r.key === "pass_sr")!;
    expect(row.offValue).toBe(DASH);
    expect(row.edge.side).toBe("na");
    expect(m.rejected).toContain("BUF off pass_sr");
    expect(m.rejected).toEqual(buildTeamRadar(rows, 2026).rejected);
  });

  it("numeric strings are read as numbers", () => {
    const strings = ROWS.map((r) =>
      Object.fromEntries(Object.entries(r).map(([k, v]) => [k, typeof v === "number" ? String(v) : v])),
    );
    expect(build(strings)).toEqual(build(ROWS));
  });

  it("the string \"NaN\" is a missing number, never a printed one", () => {
    const rows = ROWS.map((r) => (r.team_id === "BUF" ? { ...r, epa_per_play: "NaN", pass_epa_per_play: NaN, rush_epa_per_play: Infinity } : r));
    const m = build(rows);
    for (const key of ["epa", "pass_epa", "rush_epa"]) {
      const row = m.awayBall!.ladder.rows.find((r) => r.key === key)!;
      expect(row.offValue, key).toBe(DASH);
      expect(row.offRank, key).toBe(DASH);
      expect(row.edge.side, key).toBe("na");
    }
    expect(m.awayBall!.ladder.rows.find((r) => r.key === "sr")!.edge.side).not.toBe("na");
  });

  it("no NaN, Infinity or undefined anywhere in the model, and it survives JSON unchanged", () => {
    const first = ROWS.findIndex((r) => r.team_id === "BUF");
    const chaos = ROWS.map((r, i) =>
      i === first
        ? { ...r, pass_success_rate: 12, designed_runs: null, epa_per_play: NaN, plays: Infinity, sacks: -3, total_drives: "x" }
        : i === first + 1
          ? { ...r, pass_plays: 0, rush_plays: 0, plays: 0, attempts: 0, sacks: 0, total_drives: 0 }
          : r,
    );
    const { ids, rows: seven } = firstTeams(7);
    const models = [
      build(ROWS),
      build(ROWS, "DET", "NO"),
      build(ROWS, "XXX", "YYY"),
      build(chaos),
      build(chaos, "HOU", "BUF"),
      build(seven, ids[0], ids[1]),
      build([]),
      build(ROWS.filter((r) => r.team_id !== "BUF")),
    ];
    for (const m of models) {
      assertFinite(m);
      expect(JSON.parse(JSON.stringify(m))).toEqual(m);
    }
  });

  it("1,000+ rows (20 made-up teams with 60 games each) do not throw", () => {
    const junk = Array.from({ length: 1200 }, (_, i) => ({
      ...ROWS[i % ROWS.length], game_id: `2026_01_J${i}_K${i}`, team_id: `J${i % 20}`, opponent_id: `K${i % 20}`,
    }));
    const m = build([...ROWS, ...junk]);
    expect(m.teamsPlayed).toBe(52);
    expect(m.awayBall!.ladder.rows).toHaveLength(13);
    assertFinite(m);
  });
});

/* ─── §7.2, §8.1 the overlay ─── */

describe("buildMatchup: the overlay radars", () => {
  const RADAR = buildTeamRadar(ROWS, 2026);
  const spokeOf = (team: string, side: RadarSide, i: number) => RADAR.teams.find((t) => t.team === team)![side].spokes[i];
  const IDS = RADAR.teams.map((t) => t.team);

  it("seven spokes in RADAR_AXES order with the matchup's own short labels", () => {
    const o = build(ROWS).awayBall!.overlay;
    expect(o.spokes.map((s) => s.key)).toEqual(RADAR_AXES.map((a) => a.key));
    expect(o.spokes.map((s) => s.label)).toEqual([
      "Explosive pass", "Pass success", "Sacks", "Turnovers", "Stuffs", "Run success", "Explosive run",
    ]);
    expect(o.offId).toBe("BUF");
    expect(o.defId).toBe("HOU");
  });

  it("off is the offense team's offense side and def the defense team's defense side, as the radar built them", () => {
    const m = build(ROWS);
    expect(m.awayBall!.overlay.off).toEqual(RADAR.teams.find((t) => t.team === "BUF")!.off);
    expect(m.awayBall!.overlay.def).toEqual(RADAR.teams.find((t) => t.team === "HOU")!.def);
    expect(m.homeBall!.overlay.off).toEqual(RADAR.teams.find((t) => t.team === "HOU")!.off);
    expect(m.homeBall!.overlay.def).toEqual(RADAR.teams.find((t) => t.team === "BUF")!.def);
    expect(m.awayBall!.overlay.drawn).toBe(true);
  });

  it("rankLine is \"offense rank v defense rank\" in the radar's own labels", () => {
    const o = build(ROWS).awayBall!.overlay;
    o.spokes.forEach((s, i) => {
      expect(s.rankLine).toBe(`${spokeRankLabel(spokeOf("BUF", "off", i))} v ${spokeRankLabel(spokeOf("HOU", "def", i))}`);
      expect(s.rankLine).toMatch(/^(T-)?\d{1,2}(st|nd|rd|th) v (T-)?\d{1,2}(st|nd|rd|th)$/);
    });
  });

  it("gapBar is true at 5 places and false at 4, over every ordered pair of the fixture", () => {
    const seen = new Map<number, number>();
    for (const off of IDS) {
      for (const def of IDS) {
        if (off === def) continue;
        const o = build(ROWS, off, def).awayBall!.overlay;
        o.spokes.forEach((s, i) => {
          const places = Math.abs(spokeOf(def, "def", i).rank! - spokeOf(off, "off", i).rank!);
          expect(s.gapBar, `${off} v ${def} ${s.key} (${places})`).toBe(places >= M.EDGE_LEAN_MIN_GAP);
          seen.set(places, (seen.get(places) ?? 0) + 1);
        });
      }
    }
    // both sides of the boundary really occurred
    expect(seen.get(4)).toBeGreaterThan(0);
    expect(seen.get(5)).toBeGreaterThan(0);
    expect(seen.get(0)).toBeGreaterThan(0);
  });

  it("the tally counts the seven spokes by the lean rule and never names a winner", () => {
    for (const p of EXPECTED.pairs) {
      const m = build(ROWS, p.away, p.home);
      for (const [ball, lines] of [[m.awayBall!, p.awayBall], [m.homeBall!, p.homeBall]] as const) {
        const radarLines = lines.filter((l) => l.source === "radar");
        expect(radarLines).toHaveLength(7);
        const want = {
          off: radarLines.filter((l) => (l.edge.gap as number) >= 5).length,
          def: radarLines.filter((l) => (l.edge.gap as number) <= -5).length,
          even: radarLines.filter((l) => Math.abs(l.edge.gap as number) <= 4).length,
          ranked: 7,
        };
        expect(ball.overlay.tally).toEqual(want);
        expect(want.off + want.def + want.even).toBe(7);
      }
    }
  });

  it("a spoke with a missing rank is left out of the count, and `ranked` says how many were counted", () => {
    const rows = ROWS.map((r) => (r.team_id === "BUF" ? { ...r, designed_runs: null, total_drives: 0 } : r));
    const o = build(rows).awayBall!.overlay;
    expect(o.drawn).toBe(true);
    expect(o.tally!.ranked).toBe(5);
    expect(o.tally!.off + o.tally!.def + o.tally!.even).toBe(5);
    expect(o.spokes.filter((s) => s.rankLine.startsWith(DASH)).map((s) => s.key)).toEqual(["to", "stuff"]);
  });

  it("drawn is false with 3 real spokes on the offense side, true with 4", () => {
    const three = ROWS.map((r) => (r.team_id === "BUF" ? { ...r, pass_plays: 0, attempts: 0, sacks: 0, total_drives: 0 } : r));
    const o3 = build(three).awayBall!.overlay;
    expect(o3.drawn).toBe(false);
    expect(o3.tally).toBeNull();
    expect(o3.off).not.toBeNull();
    // the ladder below is unaffected: its 13 rows are still there
    expect(build(three).awayBall!.ladder.rows).toHaveLength(13);

    const four = ROWS.map((r) => (r.team_id === "BUF" ? { ...r, pass_plays: 0, total_drives: 0 } : r));
    const o4 = build(four).awayBall!.overlay;
    expect(o4.drawn).toBe(true);
    expect(o4.tally!.ranked).toBe(4);
  });

  it("drawn is false with 3 real spokes on the defense side, true with 4", () => {
    const three = ROWS.map((r) => (r.opponent_id === "HOU" ? { ...r, pass_plays: 0, attempts: 0, sacks: 0, total_drives: 0 } : r));
    expect(build(three).awayBall!.overlay.drawn).toBe(false);
    expect(build(three).awayBall!.overlay.tally).toBeNull();
    const four = ROWS.map((r) => (r.opponent_id === "HOU" ? { ...r, pass_plays: 0, total_drives: 0 } : r));
    expect(build(four).awayBall!.overlay.drawn).toBe(true);
  });
});

/* ─── §8.5 copy ─── */

describe("visitor-facing copy (§8.5)", () => {
  it("M1: the small-pool sentence, with the number from RADAR_MIN_TEAMS", () => {
    expect(M.MATCHUP_SMALL_POOL_NOTE).toBe(
      "Matchup ranks start once 8 teams have played this season. Until then there are too few teams to rank against.",
    );
    expect(M.MATCHUP_SMALL_POOL_NOTE).toContain(` ${RADAR_MIN_TEAMS} teams`);
  });

  it("M2: a team with no games", () => {
    expect(M.matchupNoGamesNote("Buffalo Bills", 2026)).toBe("The Buffalo Bills have not played a 2026 game yet.");
  });

  it("M3: a pane with no overlay", () => {
    expect(M.MATCHUP_NO_OVERLAY_NOTE).toBe("Not enough of these rates are available yet to draw this radar.");
  });

  it("M4: the count line; never names a winner; numbers from the constant", () => {
    expect(M.overlayCountLine({ off: 2, def: 1, even: 4, ranked: 7 })).toBe(
      "Of the 7 spokes: offense is 5+ places higher on 2, defense on 1, 4 within 4 places.",
    );
    expect(M.overlayCountLine({ off: 2, def: 1, even: 3, ranked: 6 })).toBe(
      "Of the 6 spokes ranked: offense is 5+ places higher on 2, defense on 1, 3 within 4 places.",
    );
    expect(M.overlayCountLine({ off: 0, def: 0, even: 7, ranked: 7 })).toBe(
      "Of the 7 spokes: offense is 5+ places higher on 0, defense on 0, 7 within 4 places.",
    );
    expect(M.overlayCountLine({ off: 2, def: 1, even: 4, ranked: 7 })).toContain(`${M.EDGE_LEAN_MIN_GAP}+ places`);
    expect(M.overlayCountLine({ off: 7, def: 0, even: 0, ranked: 7 })).not.toMatch(/win|edge|better team|favou?r/i);
  });

  it("M5: under the radars", () => {
    // The page's ring is the share card's: amber, or grey beside a team colour close to amber
    // (page colours amendment 2026-10-10). The sentence names the ring's own word, nothing else moves.
    expect(M.matchupRadarNote("grey")).toBe(
      "Both shapes are drawn by league rank, so the outer ring is 1st on every spoke and the grey ring is the middle of the league. Where the solid shape reaches past the dashed one, the offense ranks higher. Each label shows offense rank v defense rank.",
    );
    expect(M.matchupRadarNote("grey")).toBe(M.matchupRadarNote("amber").replace("amber ring", "grey ring"));
    expect("MATCHUP_RADAR_NOTE" in M).toBe(false);
    // "amber" is the sentence as it was before the amendment, to the letter.
    expect(M.matchupRadarNote("amber")).toBe(
      "Both shapes are drawn by league rank, so the outer ring is 1st on every spoke and the amber ring is the middle of the league. Where the solid shape reaches past the dashed one, the offense ranks higher. Each label shows offense rank v defense rank.",
    );
  });

  it("M6: what the ranks are among", () => {
    const base = { season: 2026, awayId: "BUF", homeId: "HOU" };
    const tail = " A defense is ranked on what its opponents did, so allowing less ranks higher; for sacks, takeaways and stuffs, making more ranks higher.";
    expect(M.matchupRankNote({ ...base, teamsPlayed: 30, throughWeek: 3, awayGames: 3, homeGames: 2 })).toBe(
      `Every rank is among the 30 teams that have played in 2026, through Week 3 (BUF has played 3 games, HOU 2).${tail}`,
    );
    expect(M.matchupRankNote({ ...base, teamsPlayed: 32, throughWeek: 5, awayGames: 5, homeGames: 4 })).toBe(
      `Every rank is among all 32 teams in 2026, through Week 5 (BUF has played 5 games, HOU 4).${tail}`,
    );
    expect(M.matchupRankNote({ ...base, teamsPlayed: 16, throughWeek: 1, awayGames: 1, homeGames: 0 })).toBe(
      `Every rank is among the 16 teams that have played in 2026, through Week 1 (BUF has played 1 game, HOU 0).${tail}`,
    );
    expect(M.matchupRankNote({ ...base, teamsPlayed: 32, throughWeek: null, awayGames: 3, homeGames: 1 })).toBe(
      `Every rank is among all 32 teams in 2026 (BUF has played 3 games, HOU 1).${tail}`,
    );
    expect(M.matchupRankNote({ ...base, teamsPlayed: 32, throughWeek: NaN, awayGames: 3, homeGames: 3 })).not.toContain("Week");
  });

  it("M7: the edge rule, with its numbers from the constants", () => {
    expect(M.matchupEdgeNote()).toBe(
      "An edge only compares two season ranks: defense rank minus offense rank. 0 to 4 places apart is called even, 5 to 12 a lean, 13 or more a clear edge. It is not a prediction and not a win probability.",
    );
    expect(M.matchupEdgeNote()).toContain(`${M.EDGE_LEAN_MIN_GAP} to ${M.EDGE_CLEAR_MIN_GAP - 1} a lean`);
    expect(M.matchupEdgeNote()).toContain(`${M.EDGE_CLEAR_MIN_GAP} or more a clear edge`);
  });

  it("M8: which EPA family, with the two link texts inside it", () => {
    expect(M.MATCHUP_FAMILY_NOTE).toBe(
      "These numbers add up every game’s box score, the same play filter as Team Stats and the team radars. A team’s EPA/play here can differ from the figure in its team page header and on Team Tiers, which count plays differently.",
    );
    expect(M.MATCHUP_FAMILY_NOTE).toContain(M.MATCHUP_TEAM_STATS_LINK_TEXT);
    expect(M.MATCHUP_FAMILY_NOTE).toContain(M.MATCHUP_TEAM_TIERS_LINK_TEXT);
    expect(M.MATCHUP_TEAM_STATS_LINK_TEXT).toBe("Team Stats");
    expect(M.MATCHUP_TEAM_TIERS_LINK_TEXT).toBe("Team Tiers");
  });

  it("M9: no new wording: the existing tested notes, and the radar's own sub-lines joined with a middle dot", () => {
    expect(M.MATCHUP_FORMULA_NOTES).toEqual([RADAR_RATES_NOTE, RADAR_STUFF_NOTE, EXPLOSIVE_NOTE]);
    const sub = (key: RadarAxisKey) => RADAR_AXES.find((a) => a.key === key)!.subline;
    expect(M.MATCHUP_FORMULA_LINE).toBe(`${sub("sack")} ${DOT} ${sub("to")} ${DOT} ${sub("stuff")}`);
    expect(M.MATCHUP_FORMULA_LINE).toBe(
      `Sacks ÷ (pass attempts + sacks) ${DOT} Turnovers ÷ drives ${DOT} Runs for no gain or a loss ÷ designed runs`,
    );
  });

  it("M10: who the main players are", () => {
    expect(M.MATCHUP_PLAYERS_NOTE).toBe(
      "Players: the quarterback with the most dropbacks, the two backs with the most carries and the four wide receivers or tight ends with the most targets. A traded player is listed with the team he has played most for. Names open the player page.",
    );
  });

  it("M12, M15, M16", () => {
    expect(M.MATCHUP_PLAYERS_UNAVAILABLE).toBe("Main players are unavailable right now.");
    expect(M.MATCHUP_LADDER_NOTE).toBe(
      "The red marker slides toward the unit with the better league rank. The farther from the middle, the bigger the rank gap.",
    );
    expect(M.MATCHUP_GAMES_UNAVAILABLE).toBe("This week’s games are unavailable right now.");
  });

  it("M13: an uncovered season (the uncoveredHeading pattern)", () => {
    expect(M.matchupUncoveredHeading(2025, 2026)).toBe("Team matchups start with the 2026 season");
    expect(M.matchupUncoveredHeading(2025, null)).toBe("Team matchups aren’t available for the 2025 season");
  });

  it("M14: no unplayed game in the season", () => {
    expect(M.matchupNoUpcomingNote(2026)).toBe("No upcoming games in the 2026 schedule. Pick any two teams below.");
  });

  it("no sentence carries a bare ASCII apostrophe (lint rejects one in JSX text; the house style is the curly one)", () => {
    const all = [
      M.MATCHUP_SMALL_POOL_NOTE, M.matchupNoGamesNote("Buffalo Bills", 2026), M.MATCHUP_NO_OVERLAY_NOTE, M.matchupRadarNote("amber"), M.matchupRadarNote("grey"),
      M.matchupEdgeNote(), M.MATCHUP_FAMILY_NOTE, M.MATCHUP_PLAYERS_NOTE, M.MATCHUP_PLAYERS_UNAVAILABLE, M.MATCHUP_LADDER_NOTE,
      M.MATCHUP_GAMES_UNAVAILABLE, M.matchupUncoveredHeading(2025, null), M.matchupNoUpcomingNote(2026),
    ];
    for (const s of all) expect(s).not.toContain("'");
  });
});

/* ─── §7.3 main players ─── */

const QBS = playerRowsJson.qb as unknown as Row[];
const RBS = playerRowsJson.rb as unknown as Row[];
const RECS = playerRowsJson.receivers as unknown as Row[];

type Slug = { slug: string; player_name: string };
const pick = (over: {
  teamId?: string; season?: number; defaultSeason?: number; qbs?: unknown; rbs?: unknown; receivers?: unknown;
  slugs?: Map<string, Slug>;
}): LineupPlayer[] =>
  M.pickMainPlayers({
    teamId: over.teamId ?? "BUF",
    season: over.season ?? 2026,
    defaultSeason: over.defaultSeason ?? 2026,
    qbs: (over.qbs ?? []) as never,
    rbs: (over.rbs ?? []) as never,
    receivers: (over.receivers ?? []) as never,
    slugByPlayerId: over.slugs ?? new Map(),
  });

const qbRow = (over: Row = {}): Row => ({
  player_id: "q1", player_name: "Q.One", team_id: "BUF", season: 2026, dropbacks: 100, attempts: 90,
  epa_per_db: 0.1234, cpoe: 2.34, passing_yards: 1234, touchdowns: 7, interceptions: 2, ...over,
});
const rbRow = (over: Row = {}): Row => ({
  player_id: "r1", player_name: "R.One", position: "RB", team_id: "BUF", season: 2026, carries: 50, rushing_yards: 250,
  epa_per_carry: -0.051, success_rate: 0.4321, ...over,
});
const recRow = (over: Row = {}): Row => ({
  player_id: "w1", player_name: "W.One", position: "WR", team_id: "BUF", season: 2026, targets: 30, receiving_yards: 400,
  receiving_tds: 3, epa_per_target: 0.456, ...over,
});
const ids = (players: LineupPlayer[]) => players.map((p) => p.playerId);
const statLine = (p: LineupPlayer) => p.stats.map((s) => `${s.label}: ${s.value}`);

describe("pickMainPlayers (§7.3) on the real 2026 week-4 tables", () => {
  const real = (teamId: string, slugs = new Map<string, Slug>()) =>
    pick({ teamId, qbs: QBS, rbs: RBS, receivers: RECS, slugs });

  it("BUF: Allen; Cook and Davis; Shakir, Moore, Kincaid, Coleman (Cook's receiving row is not a WR/TE)", () => {
    const got = real("BUF");
    expect(got.map((p) => [p.slot, p.pos, p.name])).toEqual([
      ["QB", "QB", "J.Allen"],
      ["RB", "RB", "J.Cook"],
      ["RB", "RB", "R.Davis"],
      ["REC", "WR", "K.Shakir"],
      ["REC", "WR", "D.Moore"],
      ["REC", "TE", "D.Kincaid"],
      ["REC", "WR", "K.Coleman"],
    ]);
    expect(ids(got)).toEqual(["00-0034857", "00-0037248", "00-0039875", "00-0037261", "00-0034827", "00-0038933", "00-0039901"]);
  });

  it("BUF's stat lines, formatted (§7.3's table)", () => {
    const got = real("BUF");
    expect(statLine(got[0])).toEqual(["EPA / dropback: +0.29", "CPOE: +6.0", "Pass yards: 1,039", "TD–INT: 6-3"]);
    expect(statLine(got[1])).toEqual(["Carries: 70", "Rush yards: 421", "EPA / carry: +0.13", "Success: 54.3%"]);
    expect(statLine(got[2])).toEqual(["Carries: 2", "Rush yards: 6", "EPA / carry: −0.16", "Success: 0.0%"]);
    expect(statLine(got[3])).toEqual(["Targets: 23", "Rec yards: 166", "TD: 0", "EPA / target: +0.06"]);
    expect(statLine(got[5])).toEqual(["Targets: 19", "Rec yards: 270", "TD: 1", "EPA / target: +0.62"]);
    for (const p of got) expect(p.stats).toHaveLength(4);
  });

  it("DET: Goff; Gibbs and Vaki; St. Brown, LaPorta, Williams, TeSlaa (Gibbs' 28 targets do not make him a receiver)", () => {
    const got = real("DET");
    expect(got.map((p) => p.name)).toEqual(["J.Goff", "J.Gibbs", "S.Vaki", "A.St. Brown", "S.LaPorta", "J.Williams", "I.TeSlaa"]);
    expect(statLine(got[0])).toEqual(["EPA / dropback: +0.24", "CPOE: +1.5", "Pass yards: 1,214", "TD–INT: 9-0"]);
  });

  it("with no slug list: the season row's name and no link", () => {
    for (const p of real("BUF")) expect(p.href).toBeNull();
  });

  it("with a slug: the full name from the slug list and a link to the player page", () => {
    const slugs = new Map<string, Slug>([
      ["00-0034857", { slug: "josh-allen", player_name: "Josh Allen" }],
      ["00-0037248", { slug: "james-cook", player_name: "James Cook" }],
    ]);
    const got = real("BUF", slugs);
    expect(got[0]).toMatchObject({ name: "Josh Allen", href: "/player/josh-allen" });
    expect(got[1]).toMatchObject({ name: "James Cook", href: "/player/james-cook" });
    expect(got[2]).toMatchObject({ name: "R.Davis", href: null });
  });

  it("every team in the tables gets at most 7 players, in slot order, with no throw", () => {
    const teams = Array.from(new Set(QBS.map((r) => r.team_id as string)));
    expect(teams.length).toBeGreaterThanOrEqual(30);
    for (const t of teams) {
      const got = real(t);
      expect(got.length).toBeLessThanOrEqual(7);
      expect(got.map((p) => p.slot).join(",")).toMatch(/^(QB,?)?(RB,?){0,2}(REC,?){0,4}$/);
      for (const p of got) {
        if (p.slot === "REC") expect(["WR", "TE"]).toContain(p.pos);
      }
    }
  });
});

describe("pickMainPlayers: the selection rule (§7.3)", () => {
  it("QB: most dropbacks, then attempts, then player_id; stable when the input order is reversed", () => {
    const rows = [
      qbRow({ player_id: "b", dropbacks: 100, attempts: 80 }),
      qbRow({ player_id: "a", dropbacks: 100, attempts: 90 }),
      qbRow({ player_id: "c", dropbacks: 99, attempts: 99 }),
    ];
    expect(ids(pick({ qbs: rows }))).toEqual(["a"]);
    expect(ids(pick({ qbs: [...rows].reverse() }))).toEqual(["a"]);
    const tie = [qbRow({ player_id: "z" }), qbRow({ player_id: "y" })];
    expect(ids(pick({ qbs: tie }))).toEqual(["y"]);
    expect(ids(pick({ qbs: [...tie].reverse() }))).toEqual(["y"]);
  });

  it("RB: most carries, then rushing yards, then player_id; two are taken", () => {
    const rows = [
      rbRow({ player_id: "c", carries: 40, rushing_yards: 100 }),
      rbRow({ player_id: "b", carries: 40, rushing_yards: 200 }),
      rbRow({ player_id: "a", carries: 40, rushing_yards: 100 }),
      rbRow({ player_id: "d", carries: 41, rushing_yards: 1 }),
    ];
    expect(ids(pick({ rbs: rows }))).toEqual(["d", "b"]);
    expect(ids(pick({ rbs: [...rows].reverse() }))).toEqual(["d", "b"]);
    expect(ids(pick({ rbs: rows.slice(0, 3) }))).toEqual(["b", "a"]);
  });

  it("WR/TE: most targets, then receiving yards, then player_id; four are taken", () => {
    const rows = [
      recRow({ player_id: "e", targets: 10, receiving_yards: 50 }),
      recRow({ player_id: "d", targets: 10, receiving_yards: 50 }),
      recRow({ player_id: "c", targets: 10, receiving_yards: 60, position: "TE" }),
      recRow({ player_id: "b", targets: 11 }),
      recRow({ player_id: "a", targets: 9 }),
      recRow({ player_id: "f", targets: 12 }),
    ];
    expect(ids(pick({ receivers: rows }))).toEqual(["f", "b", "c", "d"]);
    expect(ids(pick({ receivers: [...rows].reverse() }))).toEqual(["f", "b", "c", "d"]);
  });

  it("a WR listed in the QB table with 1 dropback does not beat the starter", () => {
    const rows = [qbRow({ player_id: "wr", dropbacks: 1, attempts: 1 }), qbRow({ player_id: "qb", dropbacks: 150 })];
    expect(ids(pick({ qbs: rows }))).toEqual(["qb"]);
  });

  it("a QB row with no dropbacks, a back with no carries and a receiver with no targets are never picked", () => {
    expect(pick({ qbs: [qbRow({ dropbacks: 0 })], rbs: [rbRow({ carries: 0 })], receivers: [recRow({ targets: 0 })] })).toEqual([]);
    expect(pick({ qbs: [qbRow({ dropbacks: null })], rbs: [rbRow({ carries: "NaN" })], receivers: [recRow({ targets: undefined })] })).toEqual([]);
  });

  it("an RB row in the receiver table is not picked as WR/TE, whatever his targets", () => {
    const rows = [recRow({ player_id: "rb", position: "RB", targets: 99 }), recRow({ player_id: "wr", targets: 5 })];
    expect(ids(pick({ receivers: rows }))).toEqual(["wr"]);
    expect(pick({ receivers: [recRow({ position: "QB" }), recRow({ position: null }), recRow({ position: "wr" })] })).toEqual([]);
  });

  it("FB counts as RB (and prints RB); another position in the RB table does not", () => {
    const got = pick({ rbs: [rbRow({ player_id: "fb", position: "FB", carries: 60 }), rbRow({ player_id: "qb", position: "QB", carries: 80 })] });
    expect(got.map((p) => [p.playerId, p.slot, p.pos])).toEqual([["fb", "RB", "RB"]]);
  });

  it("a team with no QB row, one RB, and no rows at all", () => {
    expect(pick({ rbs: [rbRow()], receivers: [recRow()] }).map((p) => p.slot)).toEqual(["RB", "REC"]);
    expect(pick({})).toEqual([]);
    expect(pick({ qbs: null, rbs: undefined, receivers: "x" })).toEqual([]);
  });

  it("a row of another team, or whose team_id differs only in case, is not picked", () => {
    const got = pick({
      qbs: [qbRow({ team_id: "buf" }), qbRow({ team_id: "HOU", player_id: "h" }), qbRow({ team_id: "BUF ", player_id: "s" })],
      rbs: [rbRow({ team_id: "Buf" })],
      receivers: [recRow({ team_id: null })],
    });
    expect(got).toEqual([]);
  });

  it("a repeated player_id counts once (the first row kept)", () => {
    const rows = [recRow({ player_id: "a", targets: 30, receiving_yards: 111 }), recRow({ player_id: "a", targets: 50, receiving_yards: 999 }), recRow({ player_id: "b", targets: 5 })];
    const got = pick({ receivers: rows });
    expect(ids(got)).toEqual(["a", "b"]);
    expect(statLine(got[0])[1]).toBe("Rec yards: 111");
  });

  it("a non-finite sort value counts as 0", () => {
    const rows = [
      rbRow({ player_id: "a", carries: 10, rushing_yards: null }),
      rbRow({ player_id: "b", carries: 10, rushing_yards: 5 }),
      rbRow({ player_id: "c", carries: 10, rushing_yards: "NaN" }),
    ];
    expect(ids(pick({ rbs: rows }))).toEqual(["b", "a"]);
  });

  it("a row with no usable player_id is skipped; junk rows do not throw", () => {
    const got = pick({ qbs: [null, 5, "x", qbRow({ player_id: "" }), qbRow({ player_id: null }), qbRow({ player_id: "ok", dropbacks: 3 })] });
    expect(ids(got)).toEqual(["ok"]);
  });

  it("names with apostrophes, hyphens and periods pass through untouched", () => {
    const slugs = new Map<string, Slug>([
      ["s", { slug: "dandre-swift", player_name: "D'Andre Swift" }],
      ["a", { slug: "amon-ra-st-brown", player_name: "Amon-Ra St. Brown" }],
    ]);
    const got = pick({ rbs: [rbRow({ player_id: "s", player_name: "D.Swift" })], receivers: [recRow({ player_id: "a", player_name: "A.St. Brown" })], slugs });
    expect(got.map((p) => p.name)).toEqual(["D'Andre Swift", "Amon-Ra St. Brown"]);
    expect(pick({ receivers: [recRow({ player_name: "M.Valdes-Scantling" })] })[0].name).toBe("M.Valdes-Scantling");
  });

  it("a slug entry with no name falls back to the row's name; a row with no name either is still listed", () => {
    const slugs = new Map<string, Slug>([["q1", { slug: "q-one", player_name: "" }]]);
    expect(pick({ qbs: [qbRow()], slugs })[0]).toMatchObject({ name: "Q.One", href: "/player/q-one" });
    expect(pick({ qbs: [qbRow({ player_name: null })] })[0].name).toBe(DASH);
  });

  it("a past season's href carries ?season=; the default season's does not", () => {
    const slugs = new Map<string, Slug>([["q1", { slug: "q-one", player_name: "Quentin One" }]]);
    expect(pick({ qbs: [qbRow()], slugs, season: 2025, defaultSeason: 2026 })[0].href).toBe("/player/q-one?season=2025");
    expect(pick({ qbs: [qbRow()], slugs, season: 2026, defaultSeason: 2026 })[0].href).toBe("/player/q-one");
  });

  it("null, undefined, NaN and the string \"NaN\" print a dash, never a crash (the F1 rule)", () => {
    const qb = pick({ qbs: [qbRow({ epa_per_db: null, cpoe: "NaN", passing_yards: undefined, touchdowns: NaN })] })[0];
    expect(statLine(qb)).toEqual([`EPA / dropback: ${DASH}`, `CPOE: ${DASH}`, `Pass yards: ${DASH}`, `TD–INT: ${DASH}`]);
    expect(statLine(pick({ qbs: [qbRow({ interceptions: null })] })[0])[3]).toBe(`TD–INT: ${DASH}`);
    const rb = pick({ rbs: [rbRow({ rushing_yards: "NaN", epa_per_carry: null, success_rate: Infinity })] })[0];
    expect(statLine(rb)).toEqual(["Carries: 50", `Rush yards: ${DASH}`, `EPA / carry: ${DASH}`, `Success: ${DASH}`]);
    const rec = pick({ receivers: [recRow({ receiving_yards: null, receiving_tds: null, epa_per_target: "NaN" })] })[0];
    expect(statLine(rec)).toEqual(["Targets: 30", `Rec yards: ${DASH}`, `TD: ${DASH}`, `EPA / target: ${DASH}`]);
  });

  it("formats: signed EPA to 2, CPOE to 1, thousands separators, a 0-1 success rate as a percent", () => {
    expect(statLine(pick({ qbs: [qbRow({ epa_per_db: -0.004, cpoe: -3.25, passing_yards: 4567 })] })[0])).toEqual([
      "EPA / dropback: 0.00", "CPOE: −3.3", "Pass yards: 4,567", "TD–INT: 7-2",
    ]);
    expect(statLine(pick({ rbs: [rbRow({ carries: 1234, rushing_yards: -5 })] })[0])).toEqual([
      "Carries: 1,234", "Rush yards: −5", "EPA / carry: −0.05", "Success: 43.2%",
    ]);
    expect(statLine(pick({ receivers: [recRow({ targets: "12", receiving_yards: 1005 })] })[0])).toEqual([
      "Targets: 12", "Rec yards: 1,005", "TD: 3", "EPA / target: +0.46",
    ]);
  });

  it("the model is plain data (no NaN) and survives JSON", () => {
    const got = pick({ qbs: [qbRow({ epa_per_db: NaN })], rbs: [rbRow()], receivers: [recRow()] });
    assertFinite(got);
    expect(JSON.parse(JSON.stringify(got))).toEqual(got);
  });
});

describe("pairLineups (§7.2, §7.3): always 7 rows", () => {
  const player = (slot: LineupPlayer["slot"], pos: string, playerId: string): LineupPlayer =>
    ({ slot, pos, playerId, name: playerId, href: null, stats: [] });
  const full = (prefix: string, recs = ["WR", "WR", "TE", "WR"]) => [
    player("QB", "QB", `${prefix}q`), player("RB", "RB", `${prefix}r1`), player("RB", "RB", `${prefix}r2`),
    ...recs.map((pos, i) => player("REC", pos, `${prefix}w${i}`)),
  ];

  it("pairs slot by slot: QB, RB, RB, then four receivers", () => {
    const got = M.pairLineups(full("a"), full("h"));
    expect(got).toHaveLength(7);
    expect(got.map((r) => [r.away?.playerId, r.home?.playerId])).toEqual([
      ["aq", "hq"], ["ar1", "hr1"], ["ar2", "hr2"], ["aw0", "hw0"], ["aw1", "hw1"], ["aw2", "hw2"], ["aw3", "hw3"],
    ]);
    expect(got.map((r) => r.pos)).toEqual(["QB", "RB", "RB", "WR", "WR", "TE", "WR"]);
  });

  it("the centre label is the shared position, \"a/b\" when the two differ, or the one present", () => {
    const got = M.pairLineups(full("a", ["WR", "TE", "WR", "TE"]), full("h", ["TE", "TE", "WR"]));
    expect(got.slice(3).map((r) => r.pos)).toEqual(["WR/TE", "TE", "WR", "TE"]);
    expect(got[6].home).toBeNull();
  });

  it("a missing player leaves that side null and keeps the later slots in place", () => {
    const away = [player("RB", "RB", "r1"), player("REC", "WR", "w0")];
    const got = M.pairLineups(away, full("h"));
    expect(got.map((r) => r.away?.playerId ?? null)).toEqual([null, "r1", null, "w0", null, null, null]);
    expect(got.map((r) => r.home?.playerId)).toEqual(["hq", "hr1", "hr2", "hw0", "hw1", "hw2", "hw3"]);
  });

  it("a team with no rows at all: 7 empty rows, the slot's own label in the centre", () => {
    const got = M.pairLineups([], []);
    expect(got).toHaveLength(7);
    for (const r of got) expect([r.away, r.home]).toEqual([null, null]);
    expect(got.map((r) => r.pos)).toEqual(["QB", "RB", "RB", "WR/TE", "WR/TE", "WR/TE", "WR/TE"]);
    expect(M.pairLineups(null as never, undefined as never)).toHaveLength(7);
  });

  it("extra players beyond a slot's count are dropped", () => {
    const many = [...full("a"), player("QB", "QB", "q2"), player("RB", "RB", "r3"), player("REC", "WR", "w9")];
    const got = M.pairLineups(many, []);
    expect(got.map((r) => r.away?.playerId)).toEqual(["aq", "ar1", "ar2", "aw0", "aw1", "aw2", "aw3"]);
  });

  it("works on pickMainPlayers' output for two real teams", () => {
    const of = (teamId: string) => pick({ teamId, qbs: QBS, rbs: RBS, receivers: RECS });
    const got = M.pairLineups(of("BUF"), of("DET"));
    expect(got.map((r) => `${r.away?.name} | ${r.pos} | ${r.home?.name}`)).toEqual([
      "J.Allen | QB | J.Goff",
      "J.Cook | RB | J.Gibbs",
      "R.Davis | RB | S.Vaki",
      "K.Shakir | WR | A.St. Brown",
      "D.Moore | WR/TE | S.LaPorta",
      "D.Kincaid | TE/WR | J.Williams",
      "K.Coleman | WR | I.TeSlaa",
    ]);
  });
});

/* ─── §6.4 schedule rules ─── */

type Game = Parameters<typeof M.formatKickoff>[0];
/** A `games` row as getSeasonGames returns it. Default: an unplayed week-5 REG game, BUF at LA. */
const game = (over: Partial<Game> = {}): Game => ({
  game_id: "2026_05_BUF_LA", season: 2026, game_type: "REG", week: 5, gameday: "2026-10-11", weekday: "Sunday",
  gametime: "13:00", home_team: "LA", away_team: "BUF", home_score: null, away_score: null, ...over,
});
const played = (over: Partial<Game> = {}): Game => game({ home_score: 20, away_score: 27, ...over });

describe("findPairGame (§6.4)", () => {
  it("no game between the two: nothing, no swap", () => {
    expect(M.findPairGame([], "BUF", "LA")).toEqual({ game: null, swap: false });
    expect(M.findPairGame([game({ away_team: "BUF", home_team: "HOU" }), game({ away_team: "NE", home_team: "LA" })], "BUF", "LA")).toEqual({ game: null, swap: false });
  });

  it("one game in the order asked for", () => {
    const g = game();
    expect(M.findPairGame([game({ game_id: "x", away_team: "NE", home_team: "NYJ" }), g], "BUF", "LA")).toEqual({ game: g, swap: false });
  });

  it("the only game is in the other order: swap, and no game for this order", () => {
    expect(M.findPairGame([game()], "LA", "BUF")).toEqual({ game: null, swap: true });
  });

  it("both orders exist (division rivals): no swap, and each order gets its own game", () => {
    const atBuf = game({ game_id: "2026_05_NE_BUF", away_team: "NE", home_team: "BUF", week: 5 });
    const atNe = game({ game_id: "2026_15_BUF_NE", away_team: "BUF", home_team: "NE", week: 15, gameday: "2026-12-20" });
    expect(M.findPairGame([atBuf, atNe], "NE", "BUF")).toEqual({ game: atBuf, swap: false });
    expect(M.findPairGame([atBuf, atNe], "BUF", "NE")).toEqual({ game: atNe, swap: false });
    // and it stays that way once one of them is played
    const done = played({ ...atBuf });
    expect(M.findPairGame([done, atNe], "NE", "BUF")).toEqual({ game: done, swap: false });
    expect(M.findPairGame([done, atNe], "BUF", "NE")).toEqual({ game: atNe, swap: false });
  });

  it("a played game and a later unplayed one in the same order: the unplayed one", () => {
    const reg = played({ week: 5 });
    const later = game({ game_id: "2026_20_BUF_LA", game_type: "DIV", week: 20, gameday: "2027-01-17" });
    expect(M.findPairGame([reg, later], "BUF", "LA").game).toBe(later);
    expect(M.findPairGame([later, reg], "BUF", "LA").game).toBe(later);
  });

  it("only played games: the latest", () => {
    const reg = played({ week: 5 });
    const playoff = played({ game_id: "2026_20_BUF_LA", game_type: "DIV", week: 20, gameday: "2027-01-17", home_score: 31, away_score: 17 });
    expect(M.findPairGame([reg, playoff], "BUF", "LA").game).toBe(playoff);
    expect(M.findPairGame([playoff, reg], "BUF", "LA").game).toBe(playoff);
    expect(M.findPairGame([reg], "BUF", "LA")).toEqual({ game: reg, swap: false });
  });

  it("a stale duplicate unplayed row (a reschedule): the one with the later gameday", () => {
    const stale = game({ game_id: "2026_05_BUF_LA", week: 5, gameday: "2026-10-11" });
    const real = game({ game_id: "2026_12_BUF_LA", week: 12, gameday: "2026-11-29" });
    expect(M.findPairGame([stale, real], "BUF", "LA").game).toBe(real);
    expect(M.findPairGame([real, stale], "BUF", "LA").game).toBe(real);
  });

  it("two unplayed rows with the same gameday: the larger game_id", () => {
    const a = game({ game_id: "2026_05_BUF_LA" });
    const b = game({ game_id: "2026_06_BUF_LA", week: 6 });
    expect(M.findPairGame([a, b], "BUF", "LA").game).toBe(b);
    expect(M.findPairGame([b, a], "BUF", "LA").game).toBe(b);
  });

  it("a stale unplayed row plus the real game already played: the played game with its final, never the stale kickoff", () => {
    const stale = game({ game_id: "2026_03_BUF_LA", week: 3, gameday: "2026-09-27" });
    const real = played({ game_id: "2026_05_BUF_LA", week: 5, gameday: "2026-10-11" });
    expect(M.findPairGame([stale, real], "BUF", "LA").game).toBe(real);
    expect(M.findPairGame([real, stale], "BUF", "LA").game).toBe(real);
    // same date, e.g. a time-only move that got a new id: still the played one
    const sameDay = played({ game_id: "2026_03_BUF_LA_B", week: 3, gameday: "2026-09-27" });
    expect(M.findPairGame([stale, sameDay], "BUF", "LA").game).toBe(sameDay);
  });

  it("a playoff rematch in the same building: the unplayed playoff game is kept (the played one is earlier and a lower week)", () => {
    const reg = played({ week: 5, gameday: "2026-10-11" });
    const rematch = game({ game_id: "2026_19_BUF_LA", game_type: "WC", week: 19, gameday: "2027-01-10" });
    expect(M.findPairGame([reg, rematch], "BUF", "LA")).toEqual({ game: rematch, swap: false });
  });

  it("a null gameday sorts before any date: a dated unplayed row wins over an undated one", () => {
    const undated = game({ game_id: "2026_09_BUF_LA", week: 9, gameday: null });
    const dated = game({ game_id: "2026_05_BUF_LA", week: 5, gameday: "2026-10-11" });
    expect(M.findPairGame([undated, dated], "BUF", "LA").game).toBe(dated);
    expect(M.findPairGame([dated, undated], "BUF", "LA").game).toBe(dated);
    expect(M.findPairGame([game({ gameday: "not a date", game_id: "2026_09_BUF_LA" }), dated], "BUF", "LA").game).toBe(dated);
  });

  it("a null gameday: the only game is still found; two undated rows fall to the larger game_id", () => {
    const only = game({ gameday: null });
    expect(M.findPairGame([only], "BUF", "LA")).toEqual({ game: only, swap: false });
    const other = game({ game_id: "2026_07_BUF_LA", week: 7, gameday: null });
    expect(M.findPairGame([only, other], "BUF", "LA").game).toBe(other);
  });

  it("a null gameday on the played game: the stale row is still dropped by the higher week", () => {
    const stale = game({ game_id: "2026_03_BUF_LA", week: 3, gameday: "2026-09-27" });
    const real = played({ game_id: "2026_05_BUF_LA", week: 5, gameday: null });
    expect(M.findPairGame([stale, real], "BUF", "LA").game).toBe(real);
  });

  it("a game moved to an EARLIER week is not covered (§15): the stale later row is kept", () => {
    const stale = game({ game_id: "2026_09_BUF_LA", week: 9, gameday: "2026-11-08" });
    const real = played({ game_id: "2026_05_BUF_LA", week: 5, gameday: "2026-10-11" });
    expect(M.findPairGame([stale, real], "BUF", "LA").game).toBe(stale);
  });

  it("junk in the list, null input and ids that match only in case do not throw or match", () => {
    expect(M.findPairGame([null, undefined, 5, {}, game()] as never, "BUF", "LA").game).toMatchObject({ game_id: "2026_05_BUF_LA" });
    expect(M.findPairGame(null as never, "BUF", "LA")).toEqual({ game: null, swap: false });
    expect(M.findPairGame([game()], "buf", "la")).toEqual({ game: null, swap: false });
    expect(M.findPairGame([game({ away_team: "BUF", home_team: "BUF" })], "BUF", "BUF")).toEqual({ game: null, swap: false });
  });
});

describe("teamRecord (§6.4: played REG games, counted from `games`)", () => {
  it("0-0 with no games", () => {
    expect(M.teamRecord([], "BUF")).toEqual({ wins: 0, losses: 0, ties: 0 });
    expect(M.teamRecord(null as never, "BUF")).toEqual({ wins: 0, losses: 0, ties: 0 });
  });

  it("wins, losses and ties, home or away", () => {
    const games = [
      played({ game_id: "1", week: 1, away_team: "BUF", home_team: "LA", away_score: 27, home_score: 20 }), // BUF W
      played({ game_id: "2", week: 2, away_team: "NE", home_team: "BUF", away_score: 30, home_score: 10 }), // BUF L
      played({ game_id: "3", week: 3, away_team: "BUF", home_team: "NYJ", away_score: 17, home_score: 17 }), // T
      played({ game_id: "4", week: 4, away_team: "MIA", home_team: "BUF", away_score: 3, home_score: 9 }), // BUF W
      played({ game_id: "5", week: 4, away_team: "KC", home_team: "DEN", away_score: 3, home_score: 9 }), // not BUF
    ];
    expect(M.teamRecord(games, "BUF")).toEqual({ wins: 2, losses: 1, ties: 1 });
    expect(M.teamRecord(games, "LA")).toEqual({ wins: 0, losses: 1, ties: 0 });
    expect(M.teamRecord(games, "NYJ")).toEqual({ wins: 0, losses: 0, ties: 1 });
  });

  it("playoff games and unplayed games are ignored", () => {
    const games = [
      played({ game_id: "1", week: 1 }),
      played({ game_id: "2", week: 19, game_type: "WC" }),
      played({ game_id: "3", week: 22, game_type: "SB" }),
      game({ game_id: "4", week: 6 }),
      game({ game_id: "5", week: 7, home_score: 10, away_score: null }),
    ];
    expect(M.teamRecord(games, "BUF")).toEqual({ wins: 1, losses: 0, ties: 0 });
  });

  it("a 0-0 final is a tie, not an unplayed game", () => {
    expect(M.teamRecord([played({ home_score: 0, away_score: 0 })], "BUF")).toEqual({ wins: 0, losses: 0, ties: 1 });
  });
});

describe("currentSlate (§6.4)", () => {
  const week = (w: number, done: boolean, n = 2): Game[] =>
    Array.from({ length: n }, (_, i) =>
      (done ? played : game)({
        game_id: `2026_${String(w).padStart(2, "0")}_A${i}_H${i}`, week: w, away_team: `A${i}`, home_team: `H${i}`,
        gameday: `2026-10-${String(w).padStart(2, "0")}`,
      }),
    );

  it("an empty list, or null: no slate", () => {
    expect(M.currentSlate([])).toBeNull();
    expect(M.currentSlate(null as never)).toBeNull();
  });

  it("nothing played yet: week 1", () => {
    const got = M.currentSlate([...week(2, false), ...week(1, false), ...week(3, false)]);
    expect(got!.label).toBe("Week 1");
    expect(got!.games.map((g) => g.week)).toEqual([1, 1]);
  });

  it("every game played: no slate", () => {
    expect(M.currentSlate([...week(1, true), ...week(2, true)])).toBeNull();
  });

  it("the lowest week at or after the last played week that has an unplayed game", () => {
    const got = M.currentSlate([...week(1, true), ...week(2, true), ...week(3, false), ...week(4, false)]);
    expect(got!.label).toBe("Week 3");
    expect(got!.games).toHaveLength(2);
  });

  it("mid-week: Thursday played, the rest not: the whole week, Thursday first", () => {
    const thursday = played({ game_id: "2026_05_NYJ_NE", week: 5, gameday: "2026-10-08", gametime: "20:15", away_team: "NYJ", home_team: "NE" });
    const sundayLate = game({ game_id: "2026_05_KC_DEN", week: 5, gameday: "2026-10-11", gametime: "16:25", away_team: "KC", home_team: "DEN" });
    const sundayEarlyB = game({ game_id: "2026_05_MIA_CAR", week: 5, gameday: "2026-10-11", gametime: "13:00", away_team: "MIA", home_team: "CAR" });
    const sundayEarlyA = game({ game_id: "2026_05_BUF_LA", week: 5, gameday: "2026-10-11", gametime: "13:00" });
    const monday = game({ game_id: "2026_05_SF_SEA", week: 5, gameday: "2026-10-12", gametime: "20:15", away_team: "SF", home_team: "SEA" });
    const got = M.currentSlate([monday, sundayLate, sundayEarlyB, ...week(4, true), sundayEarlyA, thursday, ...week(6, false)]);
    expect(got!.label).toBe("Week 5");
    expect(got!.games.map((g) => g.game_id)).toEqual([
      "2026_05_NYJ_NE", "2026_05_BUF_LA", "2026_05_MIA_CAR", "2026_05_KC_DEN", "2026_05_SF_SEA",
    ]);
  });

  it("a stale unplayed row in week 3 while weeks 4-5 have results: never week 3", () => {
    const stale = game({ game_id: "2026_03_BUF_LA", week: 3, gameday: "2026-09-27" });
    const partial = [...week(5, true), game({ game_id: "2026_05_SF_SEA", week: 5, away_team: "SF", home_team: "SEA" })];
    const got = M.currentSlate([...week(1, true), ...week(2, true), ...week(3, true), stale, ...week(4, true), ...partial, ...week(6, false)]);
    expect(got!.label).toBe("Week 5");
    expect(got!.games).toHaveLength(3);
    // week 5 complete: the next week with an unplayed game
    const next = M.currentSlate([...week(3, true), stale, ...week(4, true), ...week(5, true), ...week(6, false)]);
    expect(next!.label).toBe("Week 6");
    // nothing left after the last played week: no slate, even with the stale row
    expect(M.currentSlate([...week(3, true), stale, ...week(4, true), ...week(5, true)])).toBeNull();
  });

  it("a playoff week is labelled by its round", () => {
    const regs = Array.from({ length: 18 }, (_, i) => week(i + 1, true, 1)).flat();
    const wc = game({ game_id: "2026_19_BUF_LA", week: 19, game_type: "WC", gameday: "2027-01-10" });
    expect(M.currentSlate([...regs, wc])!.label).toBe("Wild Card");
    const labels = (type: string, w: number) =>
      M.currentSlate([...regs, game({ game_id: `2026_${w}_BUF_LA`, week: w, game_type: type, gameday: "2027-01-20" })])!.label;
    expect(labels("DIV", 20)).toBe("Divisional");
    expect(labels("CON", 21)).toBe("Conference Championship");
    expect(labels("SB", 22)).toBe("Super Bowl");
    expect(labels("reg", 19)).toBe("Week 19");
  });

  it("games with no gameday sort after the dated ones; ties fall to gametime, then game_id", () => {
    const a = game({ game_id: "b", gameday: null, gametime: null });
    const b = game({ game_id: "a", gameday: null, gametime: null });
    const c = game({ game_id: "z", gameday: "2026-10-11", gametime: null });
    const d = game({ game_id: "y", gameday: "2026-10-11", gametime: "13:00" });
    expect(M.currentSlate([a, b, c, d])!.games.map((g) => g.game_id)).toEqual(["y", "z", "a", "b"]);
  });

  it("does not change the list it was given, and junk entries do not throw", () => {
    const list = [...week(2, false), ...week(1, false)];
    const before = list.map((g) => g.game_id);
    M.currentSlate(list);
    expect(list.map((g) => g.game_id)).toEqual(before);
    expect(M.currentSlate([null, 5, {}, ...week(1, false)] as never)!.label).toBe("Week 1");
  });
});

describe("formatKickoff (§6.4: dates parsed by hand)", () => {
  it("all parts", () => {
    expect(M.formatKickoff(game())).toBe(`Sun Oct 11 ${DOT} 1:00 PM ET`);
    expect(M.formatKickoff(game({ gameday: "2026-10-12", weekday: "Monday", gametime: "20:15" }))).toBe(`Mon Oct 12 ${DOT} 8:15 PM ET`);
    expect(M.formatKickoff(game({ gameday: "2026-09-10", weekday: "Thursday", gametime: "20:20" }))).toBe(`Thu Sep 10 ${DOT} 8:20 PM ET`);
  });

  it("no time", () => {
    expect(M.formatKickoff(game({ gametime: null }))).toBe("Sun Oct 11");
    expect(M.formatKickoff(game({ gametime: "" }))).toBe("Sun Oct 11");
    expect(M.formatKickoff(game({ gametime: "TBD" }))).toBe("Sun Oct 11");
    expect(M.formatKickoff(game({ gametime: "25:00" }))).toBe("Sun Oct 11");
    expect(M.formatKickoff(game({ gametime: "13:75" }))).toBe("Sun Oct 11");
  });

  it("no date: the time alone (a weekday with no date is dropped too)", () => {
    expect(M.formatKickoff(game({ gameday: null }))).toBe("1:00 PM ET");
    expect(M.formatKickoff(game({ gameday: null, weekday: null }))).toBe("1:00 PM ET");
  });

  it("a date with no weekday", () => {
    expect(M.formatKickoff(game({ weekday: null }))).toBe(`Oct 11 ${DOT} 1:00 PM ET`);
  });

  it("\"00:30\" and \"12:00\"", () => {
    expect(M.formatKickoff(game({ gametime: "00:30" }))).toBe(`Sun Oct 11 ${DOT} 12:30 AM ET`);
    expect(M.formatKickoff(game({ gametime: "12:00" }))).toBe(`Sun Oct 11 ${DOT} 12:00 PM ET`);
    expect(M.formatKickoff(game({ gametime: "09:30" }))).toBe(`Sun Oct 11 ${DOT} 9:30 AM ET`);
    expect(M.formatKickoff(game({ gametime: "23:59:00" }))).toBe(`Sun Oct 11 ${DOT} 11:59 PM ET`);
  });

  it("a played game: the final, away team first, and no kickoff time", () => {
    expect(M.formatKickoff(played({ gameday: "2026-09-27", week: 3 }))).toBe(`Sun Sep 27 ${DOT} Final: BUF 27, LA 20`);
    expect(M.formatKickoff(played({ gameday: null, home_score: 0, away_score: 0 }))).toBe("Final: BUF 0, LA 0");
  });

  it("a gameday that is not a date is dropped", () => {
    for (const gameday of ["TBD", "2026-13-01", "2026-00-10", "2026-10-00", "2026-10-32", "10/11/2026", ""]) {
      expect(M.formatKickoff(game({ gameday })), gameday).toBe("1:00 PM ET");
    }
  });

  it("the date is read by hand: the same answer whatever the machine's time zone would make of the string", () => {
    expect(M.formatKickoff(game({ gameday: "2026-01-01", weekday: "Thursday", gametime: "00:00" }))).toBe(`Thu Jan 1 ${DOT} 12:00 AM ET`);
    expect(M.formatKickoff(game({ gameday: "2026-12-31", weekday: "Thursday" }))).toBe(`Thu Dec 31 ${DOT} 1:00 PM ET`);
  });

  it("nothing usable: an empty string, never a throw", () => {
    expect(M.formatKickoff(game({ gameday: null, weekday: null, gametime: null }))).toBe("");
    expect(M.formatKickoff(null as never)).toBe("");
    expect(M.formatKickoff({} as never)).toBe("");
  });
});

/* ─── Chaos pass, PR 1 (spec §17, findings F1, F4, F7, F9, F10, F11) ─── */

describe("chaos F1 / F7: `today` makes a never-played row stale (findPairGame)", () => {
  // An unplayed row whose gameday is MORE than 2 days before today is stale.
  const old = game({ game_id: "2026_05_BUF_LA", week: 5, gameday: "2026-10-11" });

  it("a stale row that is the only row for the pair: the pair has no game", () => {
    expect(M.findPairGame([old], "BUF", "LA", "2026-10-14")).toEqual({ game: null, swap: false });
    expect(M.findPairGame([old], "BUF", "LA", "2026-11-30")).toEqual({ game: null, swap: false });
  });

  it("two days after its date it is still a game (scores land the morning after)", () => {
    expect(M.findPairGame([old], "BUF", "LA", "2026-10-13").game).toBe(old);
    expect(M.findPairGame([old], "BUF", "LA", "2026-10-11").game).toBe(old);
    expect(M.findPairGame([old], "BUF", "LA", "2026-10-01").game).toBe(old);
  });

  it("a stale row is never chosen over anything else", () => {
    const real = game({ game_id: "2026_12_BUF_LA", week: 12, gameday: "2026-11-29" });
    const done = played({ game_id: "2026_02_BUF_LA", week: 2, gameday: "2026-09-20" });
    expect(M.findPairGame([old, real], "BUF", "LA", "2026-10-20").game).toBe(real);
    // a played game that is EARLIER than the stale row (the case rule 1 cannot see)
    expect(M.findPairGame([old, done], "BUF", "LA", "2026-10-20").game).toBe(done);
    expect(M.findPairGame([done, old], "BUF", "LA", "2026-10-20").game).toBe(done);
  });

  it("a stale row does not count as a game in its order: the other order's game swaps", () => {
    const other = game({ game_id: "2026_12_LA_BUF", week: 12, gameday: "2026-11-29", away_team: "LA", home_team: "BUF" });
    expect(M.findPairGame([old, other], "BUF", "LA", "2026-10-20")).toEqual({ game: null, swap: true });
    // and a stale row in the OTHER order does not cause a swap
    expect(M.findPairGame([old], "LA", "BUF", "2026-10-20")).toEqual({ game: null, swap: false });
  });

  it("a played game is never stale, however old", () => {
    const done = played({ gameday: "2026-09-13", week: 1 });
    expect(M.findPairGame([done], "BUF", "LA", "2027-02-01").game).toBe(done);
  });

  it("the day count is right across a month, a year and a leap day (no Date object)", () => {
    const at = (gameday: string, today: string) => M.findPairGame([game({ gameday })], "BUF", "LA", today).game !== null;
    expect(at("2026-12-30", "2027-01-01")).toBe(true); // 2 days
    expect(at("2026-12-30", "2027-01-02")).toBe(false); // 3 days
    expect(at("2026-09-29", "2026-10-01")).toBe(true);
    expect(at("2026-09-29", "2026-10-02")).toBe(false);
    expect(at("2027-02-27", "2027-03-01")).toBe(true); // 2 days in a common year
    expect(at("2028-02-27", "2028-03-01")).toBe(false); // 3 days in a leap year
  });

  it("no `today`, or one that is not a date: the rules without a date, as before", () => {
    for (const today of [undefined, null, "", "today", "2026-13-40", 20261020 as never]) {
      expect(M.findPairGame([old], "BUF", "LA", today as never).game).toBe(old);
    }
  });

  it("F7: an undated unplayed row loses to a played game of the same pair and order in the same or a later week", () => {
    const undated = game({ game_id: "stale", week: 5, gameday: null });
    const sameWeek = played({ game_id: "real", week: 5, gameday: "2026-10-12" });
    expect(M.findPairGame([undated, sameWeek], "BUF", "LA").game).toBe(sameWeek);
    expect(M.findPairGame([sameWeek, undated], "BUF", "LA").game).toBe(sameWeek);
    const undatedPlayed = played({ game_id: "real2", week: 5, gameday: null });
    expect(M.findPairGame([undated, undatedPlayed], "BUF", "LA").game).toBe(undatedPlayed);
    // an undated row in a LATER week than the played game is a game still to come
    const later = game({ game_id: "later", week: 19, gameday: null, game_type: "WC" });
    expect(M.findPairGame([later, sameWeek], "BUF", "LA").game).toBe(later);
  });
});

describe("chaos F1: `today` and undated rows in currentSlate", () => {
  const wk = (w: number, done: boolean, gameday: string, n = 2): Game[] =>
    Array.from({ length: n }, (_, i) =>
      (done ? played : game)({ game_id: `2026_${String(w).padStart(2, "0")}_A${i}_H${i}`, week: w, away_team: `A${i}`, home_team: `H${i}`, gameday }),
    );
  const stale5 = game({ game_id: "stale5", week: 5, gameday: "2026-10-11", away_team: "SF", home_team: "SEA" });
  const LIST = [...wk(5, true, "2026-10-11"), stale5, ...wk(6, false, "2026-10-18")];

  it("the report's case: week 5 is over but holds a never-played row. Three days on, the slate is week 6", () => {
    expect(M.currentSlate(LIST, "2026-10-14")!.label).toBe("Week 6");
    expect(M.currentSlate(LIST, "2026-10-14")!.games.map((g) => g.game_id)).toEqual(["2026_06_A0_H0", "2026_06_A1_H1"]);
  });

  it("within two days of its date the row is still Sunday's or Monday's game: week 5, the whole week", () => {
    for (const today of ["2026-10-11", "2026-10-12", "2026-10-13"]) {
      const got = M.currentSlate(LIST, today)!;
      expect(got.label, today).toBe("Week 5");
      expect(got.games.map((g) => g.game_id)).toContain("stale5");
    }
  });

  it("without `today` the date rule is off (the rule as first built)", () => {
    expect(M.currentSlate(LIST)!.label).toBe("Week 5");
    expect(M.currentSlate(LIST, "soon" as never)!.label).toBe("Week 5");
  });

  it("a stale row is not listed in the slate it used to belong to", () => {
    const mixed = [...wk(5, true, "2026-10-11"), stale5, game({ game_id: "moved", week: 5, gameday: "2026-10-27", away_team: "KC", home_team: "DEN" })];
    const got = M.currentSlate(mixed, "2026-10-20")!;
    expect(got.label).toBe("Week 5");
    expect(got.games.map((g) => g.game_id)).not.toContain("stale5");
    expect(got.games.map((g) => g.game_id)).toContain("moved");
  });

  it("only stale rows are left: no slate", () => {
    expect(M.currentSlate([...wk(5, true, "2026-10-11"), stale5], "2026-10-20")).toBeNull();
    expect(M.currentSlate([stale5], "2026-10-20")).toBeNull();
  });

  it("before the season, every game is in the future: week 1", () => {
    expect(M.currentSlate([...wk(1, false, "2026-09-13"), ...wk(2, false, "2026-09-20")], "2026-08-01")!.label).toBe("Week 1");
  });

  it("an undated unplayed row is ignored when its week already has a played game, or is below the last played week (no `today` needed)", () => {
    const undated5 = game({ game_id: "undated5", week: 5, gameday: null, away_team: "SF", home_team: "SEA" });
    const undated3 = game({ game_id: "undated3", week: 3, gameday: null, away_team: "SF", home_team: "SEA" });
    const list = [...wk(5, true, "2026-10-11"), undated5, undated3, ...wk(6, false, "2026-10-18")];
    const got = M.currentSlate(list)!;
    expect(got.label).toBe("Week 6");
    expect(M.currentSlate([...wk(5, true, "2026-10-11"), undated5])).toBeNull();
  });

  it("an undated unplayed row in a week with no result yet is a real game", () => {
    const undated6 = game({ game_id: "undated6", week: 6, gameday: null, away_team: "SF", home_team: "SEA" });
    const got = M.currentSlate([...wk(5, true, "2026-10-11"), undated6])!;
    expect(got.label).toBe("Week 6");
    expect(got.games.map((g) => g.game_id)).toEqual(["undated6"]);
    expect(M.currentSlate([undated6])!.label).toBe("Week 6");
  });
});

describe("chaos F4: an impossible Team Stats number is dropped before ranking, like a radar rate", () => {
  const withBuf = (over: Row) => ROWS.map((r) => (r.team_id === "BUF" ? { ...r, ...over } : r));
  const row = (m: MatchupModel, key: string) => m.awayBall!.ladder.rows.find((r) => r.key === key)!;
  /** Every value string of both ladders. */
  const printed = (m: MatchupModel) =>
    [...m.awayBall!.ladder.rows, ...m.homeBall!.ladder.rows].map((r) => `${r.offValue} ${r.defValue}`).join(" | ");

  it("the bounds are one place", () => {
    expect(M.MATCHUP_MAX_EPA_PER_PLAY).toBe(5);
  });

  it("a success rate of 12: a dash, the row na, listed in rejected, and not ranked 1st", () => {
    const m = build(withBuf({ success_rate: 12 }));
    expect(row(m, "sr")).toMatchObject({ offValue: DASH, offRank: DASH, verdict: "Not enough data" });
    expect(row(m, "sr").edge.side).toBe("na");
    expect(m.rejected).toContain("BUF off sr");
    expect(printed(m)).not.toMatch(/1200|\d{3}\.\d%/);
    // the other lines of the same team still print
    expect(row(m, "epa").edge.side).not.toBe("na");
  });

  it("a negative success rate and an EPA per play of 900 are dropped the same way", () => {
    const neg = build(withBuf({ success_rate: -0.5 }));
    expect(row(neg, "sr").offValue).toBe(DASH);
    expect(neg.rejected).toContain("BUF off sr");
    const epa = build(withBuf({ epa_per_play: 900, pass_epa_per_play: -900, late_epa_per_play: 1e308 }));
    for (const key of ["epa", "pass_epa", "late_epa"]) {
      expect(row(epa, key).offValue, key).toBe(DASH);
      expect(row(epa, key).edge.side, key).toBe("na");
      expect(epa.rejected, key).toContain(`BUF off ${key}`);
    }
    expect(printed(epa)).not.toMatch(/900|Infinity|e\+/);
    assertFinite(epa);
  });

  it("the team is out of that line's pool, so nobody else's rank moves because of it", () => {
    const clean = buildTeamStats(ROWS);
    const bad = buildTeamStats(withBuf({ early_epa_per_play: 900 }));
    const before = M.rankTeamStat(clean, "early_epa", "off", true);
    const after = M.rankTeamStat(bad, "early_epa", "off", true);
    expect(after.get("BUF")).toEqual({ value: null, rank: null, tied: false, pool: 31 });
    const bufRank = before.get("BUF")!.rank!;
    for (const [team, cell] of Array.from(before.entries())) {
      if (team === "BUF") continue;
      // everyone below BUF moves up one place; nobody is pushed down by a made-up 1st
      expect(after.get(team)!.rank, team).toBe(cell.rank! > bufRank ? cell.rank! - 1 : cell.rank);
    }
  });

  it("the edges of the range are kept: a rate of 0 or 1, an EPA per play of exactly ±5", () => {
    const one = (epa: number, sr: number) => {
      const r = (team: string, opp: string, e: number, s: number) => ({
        game_id: `2026_01_${team}_${opp}`, team_id: team, opponent_id: opp, season: 2026, week: 1, plays: 10, epa_per_play: e, success_rate: s,
      });
      const stats = buildTeamStats([r("AAA", "BBB", epa, sr), r("BBB", "AAA", 0.1, 0.5)]);
      return { epa: M.rankTeamStat(stats, "epa", "off", true).get("AAA")!.rank, sr: M.rankTeamStat(stats, "sr", "off", true).get("AAA")!.rank };
    };
    expect(one(5, 1)).toEqual({ epa: 1, sr: 1 });
    expect(one(-5, 0)).toEqual({ epa: 2, sr: 2 });
    expect(one(5.01, 1.0001)).toEqual({ epa: null, sr: null });
    expect(one(-5.01, -0.0001)).toEqual({ epa: null, sr: null });
  });

  it("the fixture has nothing to reject, and the golden is untouched", () => {
    expect(build(ROWS).rejected).toEqual([]);
  });
});

describe("chaos F9 / F10 / F11: small print", () => {
  it("F9: one ranked spoke is \"spoke\"", () => {
    expect(M.overlayCountLine({ off: 0, def: 1, even: 0, ranked: 1 })).toBe(
      "Of the 1 spoke ranked: offense is 5+ places higher on 0, defense on 1, 0 within 4 places.",
    );
    expect(M.overlayCountLine({ off: 0, def: 0, even: 0, ranked: 0 })).toMatch(/^Of the 0 spokes ranked:/);
  });

  it("F10: a whitespace-only name falls back to the season row's name, then a dash; a blank slug is no link", () => {
    const blank = new Map<string, Slug>([["q1", { slug: "q-one", player_name: "   " }]]);
    expect(pick({ qbs: [qbRow()], slugs: blank })[0]).toMatchObject({ name: "Q.One", href: "/player/q-one" });
    expect(pick({ qbs: [qbRow({ player_name: " \t " })], slugs: blank })[0].name).toBe(DASH);
    expect(pick({ qbs: [qbRow({ player_name: "\n" })] })[0].name).toBe(DASH);
    const noSlug = new Map<string, Slug>([["q1", { slug: "  ", player_name: "Quentin One" }]]);
    expect(pick({ qbs: [qbRow()], slugs: noSlug })[0]).toMatchObject({ name: "Quentin One", href: null });
  });

  it("F11: a 12-hour kickoff string keeps its AM or PM", () => {
    expect(M.formatKickoff(game({ gametime: "1:00 PM" }))).toBe(`Sun Oct 11 ${DOT} 1:00 PM ET`);
    expect(M.formatKickoff(game({ gametime: "8:15pm" }))).toBe(`Sun Oct 11 ${DOT} 8:15 PM ET`);
    expect(M.formatKickoff(game({ gametime: "12:30 AM" }))).toBe(`Sun Oct 11 ${DOT} 12:30 AM ET`);
    expect(M.formatKickoff(game({ gametime: "12:00 p.m." }))).toBe(`Sun Oct 11 ${DOT} 12:00 PM ET`);
    expect(M.formatKickoff(game({ gametime: "9:30 am" }))).toBe(`Sun Oct 11 ${DOT} 9:30 AM ET`);
  });

  it("F11: a kickoff string of an unknown shape prints no time", () => {
    for (const gametime of ["13:00 PM", "0:30 AM", "13:00 junk", "1:00 XM", "1pm", "13", "13:0", "noon", "13:00:99x"]) {
      expect(M.formatKickoff(game({ gametime })), gametime).toBe("Sun Oct 11");
    }
  });

  it("F11: a date that does not exist is no date", () => {
    for (const gameday of ["2026-02-31", "2026-02-29", "2026-04-31", "2026-06-31", "2026-11-31"]) {
      expect(M.formatKickoff(game({ gameday })), gameday).toBe("1:00 PM ET");
    }
    expect(M.formatKickoff(game({ gameday: "2028-02-29", weekday: "Tuesday" }))).toBe(`Tue Feb 29 ${DOT} 1:00 PM ET`);
    expect(M.formatKickoff(game({ gameday: "2026-01-31", weekday: "Saturday" }))).toBe(`Sat Jan 31 ${DOT} 1:00 PM ET`);
    // and it is not a date for the stale rule or the sort either
    expect(M.findPairGame([game({ gameday: "2026-02-31" })], "BUF", "LA", "2026-12-01").game).not.toBeNull();
  });

  it("F11: a negative rate prints the true minus; a non-finite or absurd number prints a dash", () => {
    expect(statLine(pick({ rbs: [rbRow({ success_rate: -0.4 })] })[0])[3]).toBe("Success: −40.0%");
    expect(statLine(pick({ rbs: [rbRow({ success_rate: 1e308, rushing_yards: 1e21, epa_per_carry: -1e12 })] })[0])).toEqual([
      "Carries: 50", `Rush yards: ${DASH}`, `EPA / carry: ${DASH}`, `Success: ${DASH}`,
    ]);
    expect(statLine(pick({ qbs: [qbRow({ passing_yards: 2e9, cpoe: 1e10, touchdowns: 1e21 })] })[0])).toEqual([
      "EPA / dropback: +0.12", `CPOE: ${DASH}`, `Pass yards: ${DASH}`, `TD–INT: ${DASH}`,
    ]);
    expect(statLine(pick({ receivers: [recRow({ receiving_yards: 999_999_999 })] })[0])[1]).toBe("Rec yards: 999,999,999");
    const all = JSON.stringify(pick({ qbs: [qbRow({ epa_per_db: 1e308 })], rbs: [rbRow({ success_rate: 1e308 })] }));
    expect(all).not.toMatch(/Infinity|e\+/);
  });
});

/* ─── the module's place in the graph ─── */

describe("lib/stats/matchup.ts is pure (§7.2)", () => {
  const source = readFileSync(join(process.cwd(), "lib/stats/matchup.ts"), "utf8");
  const imports = Array.from(source.matchAll(/from\s+["']([^"']+)["']/g)).map((m) => m[1]);

  it("imports nothing from lib/data but the static team list", () => {
    expect(imports.length).toBeGreaterThan(0);
    for (const i of imports.filter((x) => x.includes("lib/data"))) expect(i).toBe("@/lib/data/teams");
  });

  it("imports only the modules the spec allows: no React, Next, Supabase or component", () => {
    const allowed = [
      "@/lib/stats/team-stats", "@/lib/stats/team-radar", "@/lib/stats/box-score", "@/lib/stats/formatters",
      "@/lib/stats/percentiles", "@/lib/stats/matchup-links", "@/lib/utils", "@/lib/data/teams", "@/lib/types",
    ];
    for (const i of imports) expect(allowed, i).toContain(i);
    for (const i of imports) expect(i).not.toMatch(/supabase|^react|^next|components\//);
    expect(source).not.toContain("use client");
    expect(source).not.toMatch(/\brequire\(|\bimport\(/);
  });

  it("never reads the clock or calls new Date on a string (§6.4: neither schedule rule needs today's date)", () => {
    expect(source).not.toMatch(/new Date\(|Date\.now\(|Date\.parse\(/);
  });
});

/* ─── PR 2 additions (§7.3a): the player tiles' lists, M17, and the ties sentence ─── */

describe("lineupByTeam (§7.3a): each team's players in tile order, from the paired rows", () => {
  const player = (slot: LineupPlayer["slot"], pos: string, playerId: string): LineupPlayer =>
    ({ slot, pos, playerId, name: playerId, href: null, stats: [] });
  const real = (teamId: string) => pick({ teamId, qbs: QBS, rbs: RBS, receivers: RECS });

  it("undoes pairLineups for real teams: { away, home } are the two pickMainPlayers lists", () => {
    for (const [a, h] of [["BUF", "DET"], ["DET", "BUF"], ["KC", "PIT"]]) {
      const away = real(a);
      const home = real(h);
      expect(away.length).toBeGreaterThan(0);
      expect(M.lineupByTeam(M.pairLineups(away, home))).toEqual({ away, home });
    }
  });

  it("a team with one RB and no QB: no null in the output, order kept", () => {
    const away = [player("RB", "RB", "r1"), player("REC", "WR", "w0"), player("REC", "TE", "w1")];
    const home = [player("QB", "QB", "q"), player("RB", "RB", "hr1"), player("RB", "RB", "hr2")];
    const got = M.lineupByTeam(M.pairLineups(away, home));
    expect(got.away.map((p) => p.playerId)).toEqual(["r1", "w0", "w1"]);
    expect(got.home.map((p) => p.playerId)).toEqual(["q", "hr1", "hr2"]);
    expect([...got.away, ...got.home].every((p) => p !== null && typeof p === "object")).toBe(true);
  });

  it("both teams empty: two empty lists", () => {
    expect(M.lineupByTeam(M.pairLineups([], []))).toEqual({ away: [], home: [] });
  });

  it("null, undefined, a non-array and rows holding null: two empty lists, no throw", () => {
    for (const bad of [null, undefined, "rows", 7, {}, [null, undefined, 5, "x"], [{ away: null, home: null }], [{}]]) {
      expect(M.lineupByTeam(bad as never), JSON.stringify(bad)).toEqual({ away: [], home: [] });
    }
  });

  it("the output survives JSON", () => {
    const got = M.lineupByTeam(M.pairLineups(real("BUF"), real("DET")));
    expect(JSON.parse(JSON.stringify(got))).toEqual(got);
  });
});

describe("PR 2 copy: M17 and the ties sentence", () => {
  it("M17: a team with no player to list", () => {
    expect(M.matchupNoPlayersNote("Buffalo Bills", 2026)).toBe("No 2026 players to show for the Buffalo Bills yet.");
    expect(M.matchupNoPlayersNote("San Francisco 49ers", 2025)).toBe("No 2025 players to show for the San Francisco 49ers yet.");
    expect(M.matchupNoPlayersNote("Buffalo Bills", 2026)).not.toContain("'");
  });

  it("ties (PR 1 code review should-fix): a shared place here, row numbers on Team Stats", () => {
    expect(M.MATCHUP_TIES_NOTE).toBe(
      "Tied teams share a place here, as on the team radars (T-7th and T-7th, then 9th). The Team Stats table numbers its rows one by one, so a tied team can carry a different number there.",
    );
    expect(M.MATCHUP_TIES_NOTE).not.toContain("'");
  });
});

describe("gameWeekLabel (PR 2, for the header): the week, or the playoff round", () => {
  const g = (over: Partial<Game> = {}) => game(over);
  it("a regular-season game is \"Week N\"", () => {
    expect(M.gameWeekLabel(g({ game_type: "REG", week: 5 }))).toBe("Week 5");
    expect(M.gameWeekLabel(g({ game_type: "REG", week: 18 }))).toBe("Week 18");
  });
  it("a playoff game is its round's name (the names currentSlate uses)", () => {
    expect(M.gameWeekLabel(g({ game_type: "WC", week: 19 }))).toBe("Wild Card");
    expect(M.gameWeekLabel(g({ game_type: "DIV", week: 20 }))).toBe("Divisional");
    expect(M.gameWeekLabel(g({ game_type: "CON", week: 21 }))).toBe("Conference Championship");
    expect(M.gameWeekLabel(g({ game_type: "SB", week: 22 }))).toBe("Super Bowl");
  });
  it("an empty, null or lower-case game_type goes through normalizeGameType, like every other reader", () => {
    expect(M.gameWeekLabel(g({ game_type: "", week: 3 }))).toBe("Week 3");
    expect(M.gameWeekLabel(g({ game_type: null as never, week: 3 }))).toBe("Week 3");
    expect(M.gameWeekLabel(g({ game_type: "reg", week: 3 }))).toBe("Week 3");
    expect(M.gameWeekLabel(g({ game_type: "sb", week: 22 }))).toBe("Super Bowl");
  });
  it("no usable week, or no game: an empty string, never \"Week NaN\"", () => {
    for (const week of [null, undefined, NaN, "5", Infinity]) {
      expect(M.gameWeekLabel(g({ game_type: "REG", week: week as never }))).toBe("");
    }
    expect(M.gameWeekLabel(null as never)).toBe("");
    expect(M.gameWeekLabel(undefined as never)).toBe("");
    expect(M.gameWeekLabel("game" as never)).toBe("");
  });
});
