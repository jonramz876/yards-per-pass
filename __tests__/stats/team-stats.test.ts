// /team-stats aggregator (team stats spec 2026-09-28 §3-§4) and its
// presentation pieces (§5.3-5.4).
//
// The golden files are the real 2026 weeks 1-3 team_game_stats rows and the
// reference aggregator's output for them (made by
// docs/superpowers/specs/team-stats-reference/make_fixture.py). NEVER
// re-capture them to make a test pass: a failing golden means the TypeScript
// disagrees with the reference.
import { describe, it, expect } from "vitest";
import rowsJson from "./fixtures/team-game-stats-2026-w1-3.json";
import expectedJson from "./fixtures/team-stats-2026-w1-3.expected.json";
import { buildTeamStats, num, RATE_COLUMNS, type TeamSideStats, type TeamStatsModel } from "@/lib/stats/team-stats";
import * as P from "@/lib/stats/team-stats";
import { fmtFixed, fmtSignedInt, STRIP_SACK_NOTE } from "@/lib/stats/box-score";
import { NFL_TEAMS } from "@/lib/data/teams";

type Row = Record<string, unknown>;
type Expected = {
  teams: Record<string, { off: Record<string, number | null>; def: Record<string, number | null>; toxic: number; to_margin: number; ex_margin: number }>;
  league: Record<string, number | null>;
};

const ROWS = rowsJson as Row[];
const EXPECTED = expectedJson as unknown as Expected;
const MODEL = buildTeamStats(ROWS);
const team = (m: TeamStatsModel, id: string) => {
  const t = m.teams.find((x) => x.team === id);
  if (!t) throw new Error(`no team ${id}`);
  return t;
};

const SIDE_KEYS: (keyof TeamSideStats)[] = [
  "gp", "plays", "pass_plays", "rush_plays", "early_plays", "late_plays",
  "epa", "pass_epa", "rush_epa", "sr", "pass_sr", "rush_sr", "fd", "pass_fd", "rush_fd",
  "early_epa", "early_sr", "late_epa", "late_sr",
  "expl", "expl_rate", "expl_pass", "expl_pass_rate", "expl_rush", "expl_rush_rate",
  "cost_to", "cost_sack", "cost_pen", "cost_total",
];

// Re-sorting the same rows changes float summation order; the largest
// difference measured was 1.7e-18 (league epa), so 12 places is the
// tolerance. Do not "tighten" it to toBe.
function close(actual: number | null | undefined, expected: number | null | undefined, label: string) {
  if (expected === null || expected === undefined) {
    expect(actual, label).toBeNull();
    return;
  }
  expect(actual, label).not.toBeNull();
  expect(actual as number, label).toBeCloseTo(expected, 12);
}

/** A synthetic team_game_stats row: one clean game, every column set. */
function row(over: Row = {}): Row {
  return {
    game_id: "2026_01_AAA_BBB", team_id: "AAA", opponent_id: "BBB", season: 2026, week: 1,
    plays: 60, pass_plays: 35, rush_plays: 25, early_plays: 45, late_plays: 15,
    epa_per_play: 0.1, success_rate: 0.45, first_down_rate: 0.3,
    pass_epa_per_play: 0.2, pass_success_rate: 0.5, pass_first_down_rate: 0.35,
    rush_epa_per_play: -0.04, rush_success_rate: 0.38, rush_first_down_rate: 0.23,
    early_epa_per_play: 0.05, early_success_rate: 0.44, late_epa_per_play: 0.25, late_success_rate: 0.47,
    explosive_plays: 6, explosive_pass: 3, explosive_rush: 3,
    turnovers: 1, epa_lost_turnovers: -3, epa_lost_sacks: -2, epa_lost_penalties: -1,
    ...over,
  };
}

/** Every number in the model is finite or null: nothing Next can't serialise. */
function expectSerialisable(model: TeamStatsModel) {
  expect(JSON.parse(JSON.stringify(model))).toEqual(model);
}

describe("fixture", () => {
  it("is the 94 real rows, 32 teams", () => {
    expect(ROWS).toHaveLength(94);
    expect(Object.keys(EXPECTED.teams)).toHaveLength(32);
  });
});

describe("buildTeamStats — golden (every value against aggregate.py)", () => {
  it("every team, both sides, every key; toxic and margins; the league row", () => {
    expect(MODEL.teams.map((t) => t.team)).toEqual(Object.keys(EXPECTED.teams).sort());
    for (const t of MODEL.teams) {
      const exp = EXPECTED.teams[t.team];
      for (const s of ["off", "def"] as const) {
        expect(Object.keys(t[s]).sort()).toEqual(Object.keys(exp[s]).sort());
        for (const k of SIDE_KEYS) close(t[s][k], exp[s][k], `${t.team}.${s}.${k}`);
      }
      close(t.toxic, exp.toxic, `${t.team}.toxic`);
      close(t.to_margin, exp.to_margin, `${t.team}.to_margin`);
      close(t.ex_margin, exp.ex_margin, `${t.team}.ex_margin`);
    }
    for (const k of SIDE_KEYS) close(MODEL.league[k], EXPECTED.league[k], `league.${k}`);
    expect(MODEL.teamsPlayed).toBe(32);
    expect(MODEL.leagueToxic).toBe(0);
    expectSerialisable(MODEL);
  });

  it("names come from NFL_TEAMS", () => {
    expect(team(MODEL, "SF").name).toBe("San Francisco 49ers");
    expect(team(MODEL, "LA").name).toBe("Los Angeles Rams");
  });
});

describe("spot values as a reader sees them", () => {
  it("SF +0.330, MIN defense −0.204, league +0.008, SF toxic +17, CHI GP 2", () => {
    expect(fmtFixed(team(MODEL, "SF").off.epa, 3, true)).toBe("+0.330");
    expect(fmtFixed(team(MODEL, "MIN").def.epa, 3, true)).toBe("−0.204");
    expect(fmtFixed(MODEL.league.epa, 3, true)).toBe("+0.008");
    expect(fmtSignedInt(team(MODEL, "SF").toxic)).toBe("+17");
    expect(team(MODEL, "CHI").off.gp).toBe(2);
    expect(team(MODEL, "PHI").off.gp).toBe(2);
  });
});

describe("season = play-weighted sum, not the mean of game rates", () => {
  it("NYG late-down EPA/play is −0.094, not the +0.074 mean", () => {
    const games = ROWS.filter((r) => r.team_id === "NYG");
    expect(games.map((r) => r.late_plays)).toEqual([10, 17, 14]);
    const mean = games.reduce((s, r) => s + (r.late_epa_per_play as number), 0) / games.length;
    expect(fmtFixed(mean, 3, true)).toBe("+0.074");
    const nyg = team(MODEL, "NYG").off.late_epa as number;
    expect(fmtFixed(nyg, 3, true)).toBe("−0.094");
    close(nyg, EXPECTED.teams.NYG.off.late_epa, "NYG late");
    expect(Math.abs(nyg - mean)).toBeGreaterThan(0.1);
  });

  it("10 plays at +1.0 and 90 at 0.0 → 0.100, never 0.500", () => {
    const m = buildTeamStats([
      row({ game_id: "g1", plays: 10, epa_per_play: 1.0 }),
      row({ game_id: "g2", plays: 90, epa_per_play: 0.0 }),
    ]);
    expect(team(m, "AAA").off.epa).toBeCloseTo(0.1, 12);
  });
});

describe("a one-game team equals its box-score row exactly", () => {
  // (r × d) / d reproduced r bit-for-bit in all 1,222 rate cells of the
  // fixture (measured in the spec review), so toBe is safe here.
  it("week 1: every team's offense is its stored row", () => {
    const week1 = ROWS.filter((r) => r.week === 1);
    expect(week1).toHaveLength(32);
    const m = buildTeamStats(week1);
    for (const r of week1) {
      const t = team(m, r.team_id as string);
      expect(t.off.gp).toBe(1);
      for (const [key, rate] of RATE_COLUMNS) expect(t.off[key], `${t.team} ${key}`).toBe(r[rate]);
      for (const c of ["plays", "pass_plays", "rush_plays", "early_plays", "late_plays"] as const) {
        expect(t.off[c]).toBe(r[c]);
      }
      expect(t.off.expl).toBe(r.explosive_plays);
      expect(t.off.expl_rate).toBe((r.explosive_plays as number) / (r.plays as number));
      expect(t.off.cost_to).toBe(r.epa_lost_turnovers);
      expect(t.off.cost_sack).toBe(r.epa_lost_sacks);
      expect(t.off.cost_pen).toBe(r.epa_lost_penalties);
    }
  });
});

describe("defense is the opponents' rows", () => {
  it("MIN's defense is the sum of rows with opponent_id MIN", () => {
    const against = ROWS.filter((r) => r.opponent_id === "MIN");
    const min = team(MODEL, "MIN").def;
    expect(min.gp).toBe(against.length);
    expect(min.plays).toBe(against.reduce((s, r) => s + (r.plays as number), 0));
    expect(min.expl).toBe(against.reduce((s, r) => s + (r.explosive_plays as number), 0));
  });

  it("toxic is to_margin + ex_margin for all 32 teams", () => {
    for (const t of MODEL.teams) expect(t.toxic).toBe((t.to_margin as number) + (t.ex_margin as number));
  });
});

describe("costs", () => {
  it("are per game: Σ epa_lost_* / gp", () => {
    const m = buildTeamStats([
      row({ game_id: "g1", epa_lost_turnovers: -4, epa_lost_sacks: -1, epa_lost_penalties: -2 }),
      row({ game_id: "g2", epa_lost_turnovers: 0, epa_lost_sacks: -3, epa_lost_penalties: 1 }),
    ]);
    const a = team(m, "AAA").off;
    expect([a.cost_to, a.cost_sack, a.cost_pen, a.cost_total]).toEqual([-2, -2, -0.5, -4.5]);
  });

  it("a strip-sack in both columns counts twice in Total", () => {
    const m = buildTeamStats([row({ epa_lost_turnovers: -3, epa_lost_sacks: -3, epa_lost_penalties: 0 })]);
    expect(team(m, "AAA").off.cost_total).toBe(-6);
  });
});

describe("nulls and zeros", () => {
  it("zero pass plays in every game → pass rates null; epa is the rush-only rate", () => {
    const m = buildTeamStats([
      row({ game_id: "g1", plays: 20, pass_plays: 0, rush_plays: 20, epa_per_play: -0.1, pass_epa_per_play: null, pass_success_rate: null, pass_first_down_rate: null, explosive_pass: 0 }),
      row({ game_id: "g2", plays: 30, pass_plays: 0, rush_plays: 30, epa_per_play: 0.1, pass_epa_per_play: null, pass_success_rate: null, pass_first_down_rate: null, explosive_pass: 0 }),
    ]);
    const a = team(m, "AAA").off;
    expect([a.pass_epa, a.pass_sr, a.pass_fd, a.expl_pass_rate]).toEqual([null, null, null, null]);
    expect(a.epa).toBeCloseTo((-0.1 * 20 + 0.1 * 30) / 50, 12);
    expectSerialisable(m);
  });

  it("a null / 'NaN' / undefined rate leaves that game's denominator out", () => {
    for (const bad of [null, "NaN", undefined]) {
      const m = buildTeamStats([
        row({ game_id: "g1", plays: 40, epa_per_play: bad }),
        row({ game_id: "g2", plays: 60, epa_per_play: 0.25 }),
      ]);
      const a = team(m, "AAA").off;
      expect(a.epa).toBe(0.25);
      expect(a.plays).toBe(100);
      expectSerialisable(m);
    }
  });

  it("numeric strings are parsed", () => {
    const m = buildTeamStats([row({ plays: "50", epa_per_play: "0.2", explosive_plays: "5" })]);
    const a = team(m, "AAA").off;
    expect([a.plays, a.epa, a.expl, a.expl_rate]).toEqual([50, 0.2, 5, 0.1]);
  });

  it("num(): finite numbers and numeric strings only", () => {
    expect([num(1.5), num("2"), num(" 3 "), num(""), num("NaN"), num("x"), num(null), num(undefined), num(Infinity), num(NaN), num({})]).toEqual(
      [1.5, 2, 3, null, null, null, null, null, null, null, null],
    );
  });

  it("a missing opponent row skips the game for toxic only", () => {
    const m = buildTeamStats([
      row({ game_id: "g1", turnovers: 0, explosive_plays: 5 }),
      row({ game_id: "g1", team_id: "BBB", opponent_id: "AAA", turnovers: 2, explosive_plays: 3 }),
      row({ game_id: "g2", turnovers: 3, explosive_plays: 9 }), // BBB's g2 row never arrived
    ]);
    const a = team(m, "AAA");
    expect(a.off.gp).toBe(2);
    expect(a.off.cost_to).toBe(-3);
    expect([a.to_margin, a.ex_margin, a.toxic]).toEqual([2, 2, 4]);
    expect(team(m, "BBB").toxic).toBe(-4);
    expect(m.leagueToxic).toBe(0);
  });

  it("a team with no rows: GP 0, every rate/cost/toxic null, counts 0", () => {
    const m = buildTeamStats([row({ team_id: "SF", opponent_id: "ARI" })]);
    const nyj = team(m, "NYJ");
    for (const s of ["off", "def"] as const) {
      expect(nyj[s].gp).toBe(0);
      for (const [key] of RATE_COLUMNS) expect(nyj[s][key]).toBeNull();
      for (const k of ["expl_rate", "expl_pass_rate", "expl_rush_rate", "cost_to", "cost_sack", "cost_pen", "cost_total"] as const) {
        expect(nyj[s][k]).toBeNull();
      }
      for (const k of ["plays", "pass_plays", "rush_plays", "early_plays", "late_plays", "expl", "expl_pass", "expl_rush"] as const) {
        expect(nyj[s][k]).toBe(0);
      }
    }
    expect([nyj.toxic, nyj.to_margin, nyj.ex_margin]).toEqual([null, null, null]);
    expect(m.teamsPlayed).toBe(1);
    expectSerialisable(m);
  });

  it("an unknown team_id is kept, named by its id", () => {
    const m = buildTeamStats([row({ team_id: "XYZ", opponent_id: "SF" })]);
    expect(m.teams).toHaveLength(33);
    expect(team(m, "XYZ").name).toBe("XYZ");
    expect(team(m, "SF").def.gp).toBe(1);
  });

  it("no rows → the 32 teams, all dashes; league rates null; teamsPlayed 0; leagueToxic null", () => {
    const m = buildTeamStats([]);
    expect(m.teams.map((t) => t.team)).toEqual(NFL_TEAMS.map((t) => t.id).sort());
    expect(m.league.gp).toBe(0);
    expect(m.league.epa).toBeNull();
    expect(m.league.cost_total).toBeNull();
    expect(m.teamsPlayed).toBe(0);
    expect(m.leagueToxic).toBeNull();
    expectSerialisable(m);
  });

  it("an explosive-rush count above designed runs gives a rate over 100%", () => {
    const m = buildTeamStats([row({ rush_plays: 2, explosive_rush: 3 })]);
    expect(team(m, "AAA").off.expl_rush_rate).toBe(1.5);
  });
});

describe("the J2 divisor is teamsPlayed, not a literal 32", () => {
  it("week 1 minus one game: 30 teams played", () => {
    const week1 = ROWS.filter((r) => r.week === 1);
    const dropped = week1[0].game_id;
    const m = buildTeamStats(week1.filter((r) => r.game_id !== dropped));
    expect(m.teamsPlayed).toBe(30);
    expect(m.teams).toHaveLength(32);
  });
});

describe("1000+ rows", () => {
  it("1,100 synthetic rows (550 games) aggregate", () => {
    const ids = NFL_TEAMS.map((t) => t.id);
    const many: Row[] = [];
    for (let g = 0; g < 550; g++) {
      const a = ids[g % 32];
      const b = ids[(g + 1) % 32];
      many.push(row({ game_id: `g${g}`, team_id: a, opponent_id: b }));
      many.push(row({ game_id: `g${g}`, team_id: b, opponent_id: a, turnovers: 2 }));
    }
    const m = buildTeamStats(many);
    expect(m.league.gp).toBe(1100);
    expect(m.teamsPlayed).toBe(32);
    expectSerialisable(m);
  });
});

/* ─── Presentation pieces (spec §5.3-5.4) ─── */

const MINUS = "−";
const keys = (tab: P.TeamStatsTab, side: P.TeamStatsSide) => P.teamStatsColumns(tab, side).map((c) => c.key);

describe("column table", () => {
  it("per tab and side; Toxic is Offense only", () => {
    expect(keys("eff", "off")).toEqual([
      "epa", "pass_epa", "rush_epa", "sr", "pass_sr", "rush_sr", "fd", "pass_fd", "rush_fd",
      "expl", "expl_rate", "expl_pass_rate", "expl_rush_rate", "toxic",
    ]);
    expect(keys("eff", "def")).toEqual(keys("eff", "off").filter((k) => k !== "toxic"));
    expect(keys("downs", "off")).toEqual(["early_plays", "early_epa", "early_sr", "late_plays", "late_epa", "late_sr"]);
    expect(keys("downs", "def")).toEqual(keys("downs", "off"));
    expect(keys("cost", "off")).toEqual(["cost_to", "cost_sack", "cost_pen", "cost_total"]);
    expect(keys("cost", "def")).toEqual(keys("cost", "off"));
  });

  it("neutral = the Plays columns; colour = the five EPA/play columns; tooltips only the three allowed keys", () => {
    const all = (["eff", "downs", "cost"] as const).flatMap((t) => P.teamStatsColumns(t, "off"));
    expect(all.filter((c) => c.neutral).map((c) => c.key)).toEqual(["early_plays", "late_plays"]);
    expect(all.filter((c) => c.colour).map((c) => c.key)).toEqual(["epa", "pass_epa", "rush_epa", "early_epa", "late_epa"]);
    expect(all.filter((c) => c.tooltip).map((c) => c.tooltip)).toEqual(["EPA / play", "Success rate", "Explosive plays"]);
    expect(all.filter((c) => c.group).map((c) => c.group)).toEqual([
      "EPA / play", "Success rate", "1st down rate", "Explosive plays", "Toxic",
      "Early downs (1st–2nd)", "Late downs (3rd–4th)", "EPA lost per game",
    ]);
    expect(all.find((c) => c.key === "toxic")?.label).toBe("Diff");
  });

  it("tab labels", () => {
    expect(P.TEAM_STATS_TABS.map((t) => P.TEAM_STATS_TAB_LABELS[t])).toEqual(["Efficiency", "Early vs Late Downs", "What It Cost Them"]);
  });
});

describe("better-first direction and default sort", () => {
  it("Offense: higher first everywhere; Defense (C3): lower first except neutral Plays", () => {
    for (const tab of P.TEAM_STATS_TABS) {
      for (const c of P.teamStatsColumns(tab, "off")) expect(P.betterFirstDir(c, "off")).toBe("desc");
      for (const c of P.teamStatsColumns(tab, "def")) expect(P.betterFirstDir(c, "def"), c.key).toBe(c.neutral ? "desc" : "asc");
    }
  });

  it("default sort = first non-neutral column", () => {
    expect(P.defaultSortKey("eff")).toBe("epa");
    expect(P.defaultSortKey("downs")).toBe("early_epa");
    expect(P.defaultSortKey("cost")).toBe("cost_to");
  });
});

describe("sortTeamRows", () => {
  const col = (k: string) => P.teamStatsColumns("eff", "off").find((c) => c.key === k)!;
  const synthetic = buildTeamStats([
    row({ game_id: "g1", team_id: "SF", opponent_id: "ARI", epa_per_play: 0.2 }),
    row({ game_id: "g2", team_id: "KC", opponent_id: "BUF", epa_per_play: 0.2 }),
    row({ game_id: "g3", team_id: "DAL", opponent_id: "NYG", epa_per_play: -0.1 }),
    row({ game_id: "g4", team_id: "MIA", opponent_id: "NE", epa_per_play: null }),
  ]);
  const order = (dir: P.SortDir) => P.sortTeamRows(synthetic.teams, col("epa"), "off", dir).map((t) => t.team);

  it("nulls last in both directions; ties by team id ascending in both directions", () => {
    const desc = order("desc");
    const asc = order("asc");
    expect(desc.slice(0, 3)).toEqual(["KC", "SF", "DAL"]);
    expect(asc.slice(0, 3)).toEqual(["DAL", "KC", "SF"]);
    // the rest are null (MIA's rate and the 28 teams without games), by id
    const rest = NFL_TEAMS.map((t) => t.id).filter((id) => !["KC", "SF", "DAL"].includes(id)).sort();
    expect(desc.slice(3)).toEqual(rest);
    expect(asc.slice(3)).toEqual(rest);
  });

  it("does not mutate its input", () => {
    const before = synthetic.teams.map((t) => t.team);
    P.sortTeamRows(synthetic.teams, col("epa"), "off", "desc");
    expect(synthetic.teams.map((t) => t.team)).toEqual(before);
  });

  it("Defense on the fixture: MIN then LV on EPA ascending", () => {
    const c = P.teamStatsColumns("eff", "def")[0];
    const sorted = P.sortTeamRows(MODEL.teams, c, "def", P.betterFirstDir(c, "def"));
    expect(sorted.slice(0, 2).map((t) => t.team)).toEqual(["MIN", "LV"]);
  });

  it("a positive penalty cost ranks above −0.10 on Offense (higher first, not closer to zero)", () => {
    const m = buildTeamStats([
      row({ game_id: "g1", team_id: "PIT", opponent_id: "NE", epa_lost_penalties: 0.5 }),
      row({ game_id: "g2", team_id: "WAS", opponent_id: "SEA", epa_lost_penalties: -0.1 }),
    ]);
    const c = P.teamStatsColumns("cost", "off").find((x) => x.key === "cost_pen")!;
    expect(P.sortTeamRows(m.teams, c, "off", P.betterFirstDir(c, "off")).slice(0, 2).map((t) => t.team)).toEqual(["PIT", "WAS"]);
    // Defense: more negative first — SEA's opponent lost 0.10, NE's gained 0.50
    const d = P.teamStatsColumns("cost", "def").find((x) => x.key === "cost_pen")!;
    expect(P.sortTeamRows(m.teams, d, "def", P.betterFirstDir(d, "def")).slice(0, 2).map((t) => t.team)).toEqual(["SEA", "NE"]);
  });
});

describe("a team that hasn't played (I5)", () => {
  const m = buildTeamStats([row({ team_id: "SF", opponent_id: "ARI" })]);
  const nyj = team(m, "NYJ");

  it("prints a dash in every cell on both sides", () => {
    for (const side of ["off", "def"] as const) {
      for (const tab of P.TEAM_STATS_TABS) {
        for (const c of P.teamStatsColumns(tab, side)) {
          expect(P.cellValue(nyj, c, side), `${side} ${c.key}`).toBeNull();
          expect(P.formatCell(c, P.cellValue(nyj, c, side))).toBe("—");
        }
      }
    }
  });

  it("sorts last on every column, both sides, both directions", () => {
    for (const side of ["off", "def"] as const) {
      for (const tab of P.TEAM_STATS_TABS) {
        for (const c of P.teamStatsColumns(tab, side)) {
          for (const dir of ["asc", "desc"] as const) {
            const sorted = P.sortTeamRows(m.teams, c, side, dir);
            const played = sorted.findIndex((t) => t.team === (side === "off" ? "SF" : "ARI"));
            const idx = sorted.findIndex((t) => t.team === "NYJ");
            expect(idx, `${side} ${c.key} ${dir}`).toBeGreaterThan(played);
          }
        }
      }
    }
  });
});

describe("teamEpaClass (spec §5.3)", () => {
  const avg = 0.008;
  it("Offense: ±0.030 grey, +0.031 green, −0.031 red", () => {
    expect(P.teamEpaClass(0.038, avg, "off")).toBe("text-gray-700");
    expect(P.teamEpaClass(-0.022, avg, "off")).toBe("text-gray-700");
    expect(P.teamEpaClass(0.039, avg, "off")).toBe("text-green-600");
    expect(P.teamEpaClass(-0.023, avg, "off")).toBe("text-red-600");
  });
  it("Defense is the mirror: lower is green", () => {
    expect(P.teamEpaClass(0.038, avg, "def")).toBe("text-gray-700");
    expect(P.teamEpaClass(-0.022, avg, "def")).toBe("text-gray-700");
    expect(P.teamEpaClass(0.039, avg, "def")).toBe("text-red-600");
    expect(P.teamEpaClass(-0.023, avg, "def")).toBe("text-green-600");
  });
  it("compares values as printed at 3 dp", () => {
    expect(P.teamEpaClass(0.0384, avg, "off")).toBe("text-gray-700"); // prints 0.038
    expect(P.teamEpaClass(0.0386, avg, "off")).toBe("text-green-600"); // prints 0.039
  });
  it("null → gray-400; no average → gray-700; a value printing as −0.000", () => {
    expect(P.teamEpaClass(null, avg, "off")).toBe("text-gray-400");
    expect(P.teamEpaClass(null, avg, "def")).toBe("text-gray-400");
    expect(P.teamEpaClass(0.5, null, "off")).toBe("text-gray-700");
    expect(P.teamEpaClass(0.5, null, "def")).toBe("text-gray-700");
    expect(P.teamEpaClass(-0.0001, 0, "off")).toBe("text-gray-700");
    expect(P.teamEpaClass(-0.0001, 0, "def")).toBe("text-gray-700");
  });
  it("colour is on only once the league has 600 plays", () => {
    expect(P.colourOn(MODEL)).toBe(true);
    const oneGame = buildTeamStats(ROWS.slice(0, 2));
    expect(oneGame.league.plays).toBeLessThan(600);
    expect(P.colourOn(oneGame)).toBe(false);
  });
});

describe("NFL average row (J2)", () => {
  const eff = (k: string) => P.teamStatsColumns("eff", "off").find((c) => c.key === k)!;
  it("counts are the average team; rates league-wide; toxic computed", () => {
    expect(P.averageCell(MODEL, eff("expl"))).toBe("16.5");
    expect(P.averageCell(MODEL, eff("epa"))).toBe("+0.008");
    expect(P.averageCell(MODEL, eff("sr"))).toBe("44%");
    expect(P.averageCell(MODEL, eff("toxic"))).toBe("0");
    const late = P.teamStatsColumns("downs", "off").find((c) => c.key === "late_plays")!;
    expect(P.averageCell(MODEL, late)).toBe(fmtFixed(1364 / 32, 1));
    const total = P.teamStatsColumns("cost", "off").find((c) => c.key === "cost_total")!;
    expect(P.averageCell(MODEL, total)).toBe(`${MINUS}16.02`);
  });
  it("the divisor is teamsPlayed (M3): week 1 minus one game → / 30", () => {
    const week1 = ROWS.filter((r) => r.week === 1);
    const m = buildTeamStats(week1.filter((r) => r.game_id !== week1[0].game_id));
    expect(P.averageCell(m, eff("expl"))).toBe(fmtFixed(m.league.expl / 30, 1));
    expect(P.averageCell(m, eff("expl"))).not.toBe(fmtFixed(m.league.expl / 32, 1));
  });
  it("a dash when no team has played", () => {
    expect(P.averageCell(buildTeamStats([]), eff("expl"))).toBe("—");
    expect(P.averageCell(buildTeamStats([]), eff("toxic"))).toBe("—");
  });
});

describe("URL state", () => {
  const parse = (q: string) => P.parseTeamStatsParams(new URLSearchParams(q));

  it("defaults", () => {
    expect(parse("")).toEqual({ side: "off", tab: "eff", sort: "epa", dir: "desc" });
    expect(parse("side=def")).toEqual({ side: "def", tab: "eff", sort: "epa", dir: "asc" });
    expect(parse("tab=downs")).toEqual({ side: "off", tab: "downs", sort: "early_epa", dir: "desc" });
    expect(parse("tab=cost&side=def")).toEqual({ side: "def", tab: "cost", sort: "cost_to", dir: "asc" });
  });

  it("valid values are read", () => {
    expect(parse("tab=downs&sort=late_plays&dir=asc")).toEqual({ side: "off", tab: "downs", sort: "late_plays", dir: "asc" });
    expect(parse("sort=toxic")).toEqual({ side: "off", tab: "eff", sort: "toxic", dir: "desc" });
  });

  it("every invalid value falls back", () => {
    expect(parse("side=zzz&tab=zzz&sort=zzz&dir=zzz")).toEqual(parse(""));
    expect(parse("sort=toxic&side=def")).toEqual({ side: "def", tab: "eff", sort: "epa", dir: "asc" });
    expect(parse("sort=cost_to")).toEqual(parse(""));
    expect(parse("sort=gp")).toEqual(parse(""));
    expect(parse("dir=up")).toEqual(parse(""));
    expect(parse("sort=__proto__&tab=constructor&side=toString")).toEqual(parse(""));
  });

  it("build omits defaults and keeps other params", () => {
    const base = new URLSearchParams("season=2025&side=def&sort=x");
    expect(P.buildTeamStatsQuery(parse(""), base)).toBe("season=2025");
    expect(P.buildTeamStatsQuery({ side: "def", tab: "eff", sort: "epa", dir: "asc" }, base)).toBe("season=2025&side=def");
    expect(P.buildTeamStatsQuery({ side: "off", tab: "downs", sort: "late_epa", dir: "asc" }, new URLSearchParams())).toBe(
      "tab=downs&sort=late_epa&dir=asc",
    );
  });

  it("round-trips every tab × side × column × direction", () => {
    for (const side of ["off", "def"] as const) {
      for (const tab of P.TEAM_STATS_TABS) {
        for (const c of P.teamStatsColumns(tab, side)) {
          for (const dir of ["asc", "desc"] as const) {
            const state = { side, tab, sort: c.key, dir };
            expect(parse(P.buildTeamStatsQuery(state, new URLSearchParams()))).toEqual(state);
          }
        }
      }
    }
  });
});

describe("copy (spec §5.4)", () => {
  it("C1 names Team Tiers and says plays are counted differently", () => {
    expect(P.TEAM_TIERS_NOTE).toBe(
      "These rankings add up every game’s box score, so they use the same play filter as the box scores and rbsdm.com. A team’s EPA/play here can differ from its figure on Team Tiers, which counts plays differently.",
    );
  });

  it("C2 subtitles", () => {
    expect(P.SUBTITLE.off).toBe("What each offense did");
    expect(P.SUBTITLE.def).toBe("What opponents did against each team");
  });

  it("C3, C4, C5, C11 text", () => {
    expect(P.DEFENSE_NOTE).toBe("Defense ranks what opponents did against each team, so lower EPA, success and explosive rates rank higher.");
    expect(P.EXPLOSIVE_NOTE).toBe(
      "Explosive plays are completions of 20+ yards and runs of 10+ (QB scrambles count as runs). The rush explosive rate divides by designed runs only, so a team with long scrambles can run high.",
    );
    expect(P.TOXIC_NOTE).toBe("Toxic differential is turnover margin plus explosive-play margin, one figure for the whole team.");
    expect(P.AVERAGE_ROW_NOTE).toBe("In the NFL average row, rates are league-wide and counts are for the average team.");
  });

  it("C7 is built from the band constant; C7b names the season", () => {
    expect(P.colourNote()).toBe("EPA/play is green (better) or red (worse) against the NFL average in the bottom row, grey within 0.03.");
    expect(P.colourPendingNote(2026)).toBe("EPA colours start once the 2026 season has enough plays to set a league average.");
  });

  it("C8 shows for weeks 1-4 of the latest season only", () => {
    expect(P.earlySeasonNote(1, true)).toBe("With only 1 week played, one game moves a team a long way.");
    expect(P.earlySeasonNote(3, true)).toBe("With only 3 weeks played, one game moves a team a long way.");
    expect(P.earlySeasonNote(4, true)).not.toBeNull();
    expect(P.earlySeasonNote(5, true)).toBeNull();
    expect(P.earlySeasonNote(null, true)).toBeNull();
    expect(P.earlySeasonNote(0, true)).toBeNull();
    expect(P.earlySeasonNote(3, false)).toBeNull();
  });

  it("C9 uncovered heading and body", () => {
    expect(P.uncoveredHeading(2025, 2026)).toBe("Team stats start with the 2026 season");
    expect(P.uncoveredHeading(2030, null)).toBe("Team stats aren’t available for the 2030 season");
    expect(P.UNCOVERED_BODY).toBe("Earlier seasons aren’t available yet.");
  });

  it("C10 metadata copy", () => {
    expect(P.teamStatsTitle(2026)).toBe("NFL Team Stats 2026");
    expect(P.teamStatsDescription(2026)).toBe(
      "Every NFL team's offense and defense for the 2026 season: EPA per play, success rate, explosive plays, early and late downs, and what turnovers, sacks and penalties cost.",
    );
  });

  it("C6 / C6b cost notes; C6b agrees with the box score's strip-sack rule", () => {
    expect(P.COST_NOTE.off).toBe(
      "EPA each team lost per game to its own turnovers, sacks and penalties. Penalties count the team’s flags on both sides of the ball, as in the box score. Higher (less negative) is better.",
    );
    expect(P.COST_NOTE.def).toBe(
      "EPA each team’s opponents lost per game to their own turnovers, sacks and penalties (their flags on both sides of the ball). More negative is better.",
    );
    for (const s of [P.STRIP_SACK_COST_NOTE, STRIP_SACK_NOTE]) {
      expect(s.toLowerCase()).toContain("strip-sack");
      expect(s).toContain("both");
    }
    expect(P.STRIP_SACK_COST_NOTE).toBe(
      "A strip-sack counts in both the Turnovers and Sacks columns, as in the box score, so Total counts it twice.",
    );
  });

  it("footnotes per side × tab", () => {
    const f = (side: P.TeamStatsSide, tab: P.TeamStatsTab, extra: Partial<P.FootnoteState> = {}) =>
      P.teamStatsFootnotes({ side, tab, colourOn: true, season: 2026, throughWeek: 3, isLatestSeason: true, ...extra });
    const early = P.earlySeasonNote(3, true)!;
    expect(f("off", "eff")).toEqual([P.EXPLOSIVE_NOTE, P.TOXIC_NOTE, P.AVERAGE_ROW_NOTE, P.colourNote(), early]);
    expect(f("def", "eff")).toEqual([P.DEFENSE_NOTE, P.EXPLOSIVE_NOTE, P.AVERAGE_ROW_NOTE, P.colourNote(), early]);
    expect(f("off", "downs")).toEqual([P.AVERAGE_ROW_NOTE, P.colourNote(), early]);
    expect(f("def", "downs")).toEqual([P.DEFENSE_NOTE, P.AVERAGE_ROW_NOTE, P.colourNote(), early]);
    expect(f("off", "cost")).toEqual([P.COST_NOTE.off, P.STRIP_SACK_COST_NOTE, early]);
    expect(f("def", "cost")).toEqual([P.COST_NOTE.def, P.STRIP_SACK_COST_NOTE, early]);
    expect(f("off", "eff", { colourOn: false })).toContain(P.colourPendingNote(2026));
    expect(f("off", "eff", { colourOn: false })).not.toContain(P.colourNote());
    expect(f("off", "eff", { throughWeek: 9 })).not.toContain(early);
  });
});
