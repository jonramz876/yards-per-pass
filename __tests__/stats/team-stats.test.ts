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
import { fmtFixed, fmtSignedInt } from "@/lib/stats/box-score";
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
