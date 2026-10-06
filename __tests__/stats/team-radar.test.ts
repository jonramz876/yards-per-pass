// Team radar pure module (team radar spec 2026-10-06 §3-§4, §7-§9).
//
// The golden pair is the frozen Team Stats fixture's 94 rows with five more
// columns computed from the public play-by-play by ingest's own aggregator
// (docs/superpowers/specs/team-radar-reference/), and an independent Python
// reference's output for them. NEVER re-capture either file to make a test
// pass: a failing golden means the TypeScript disagrees with the reference.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import radarRowsJson from "./fixtures/team-radar-2026-w1-3.json";
import expectedJson from "./fixtures/team-radar-2026-w1-3.expected.json";
import frozenRowsJson from "./fixtures/team-game-stats-2026-w1-3.json";
import * as R from "@/lib/stats/team-radar";
import {
  RADAR_AXES,
  RADAR_HUB,
  RADAR_MIN_SPOKES,
  RADAR_MIN_TEAMS,
  RADAR_SIDES,
  buildTeamRadar,
  radarScore,
  teamRadarSlice,
  teamRadarState,
  type RadarAxisKey,
  type RadarSide,
  type TeamRadarModel,
} from "@/lib/stats/team-radar";
import { buildTeamStats } from "@/lib/stats/team-stats";
import { NFL_TEAMS } from "@/lib/data/teams";

type Row = Record<string, unknown>;
type ExpSide = Record<RadarAxisKey, number | null> & {
  gp: number;
  rank: Record<RadarAxisKey, number | null>;
  pool: Record<RadarAxisKey, number>;
  tied: Record<RadarAxisKey, boolean>;
};
type Expected = {
  teamsPlayed: number;
  throughWeek: number;
  teams: Record<string, { off: ExpSide; def: ExpSide }>;
  league: Record<RadarAxisKey, number | null>;
};

const ROWS = radarRowsJson as Row[];
const FROZEN = frozenRowsJson as Row[];
const EXPECTED = expectedJson as unknown as Expected;
const MODEL = buildTeamRadar(ROWS);
const SIDES: RadarSide[] = ["off", "def"];
const KEYS = RADAR_AXES.map((a) => a.key);

const team = (m: TeamRadarModel, id: string) => {
  const t = m.teams.find((x) => x.team === id);
  if (!t) throw new Error(`no team ${id}`);
  return t;
};
const spoke = (m: TeamRadarModel, id: string, side: RadarSide, key: RadarAxisKey) => {
  const s = team(m, id)[side].spokes.find((x) => x.key === key);
  if (!s) throw new Error(`no spoke ${key}`);
  return s;
};

function close(actual: number | null | undefined, expected: number | null | undefined, label: string) {
  if (expected === null || expected === undefined) {
    expect(actual, label).toBeNull();
    return;
  }
  expect(actual, label).not.toBeNull();
  expect(actual as number, label).toBeCloseTo(expected, 12);
}

/** One clean synthetic team-game row with every radar column set. */
function row(over: Row = {}): Row {
  return {
    game_id: "2026_01_AAA_BBB", team_id: "AAA", opponent_id: "BBB", season: 2026, week: 1,
    pass_plays: 40, rush_plays: 25, pass_success_rate: 0.5, rush_success_rate: 0.4,
    explosive_pass: 4, explosive_rush: 3, attempts: 36, sacks: 2, turnovers: 1, total_drives: 10,
    designed_runs: 24, stuffed_runs: 4,
    ...over,
  };
}

/**
 * A round-robin-free league of `n` teams: team i plays one game against team
 * i+1 (wrapping), so every team has one offense row and one defense row.
 * `tweak(i)` overrides team i's own row.
 */
function league(n: number, tweak: (i: number) => Row = () => ({})): Row[] {
  const id = (i: number) => `T${String(i).padStart(2, "0")}`;
  return Array.from({ length: n }, (_, i) =>
    row({ game_id: `2026_01_G${i}`, team_id: id(i), opponent_id: id((i + 1) % n), ...tweak(i) }),
  );
}

function expectSerialisable(v: unknown) {
  expect(JSON.parse(JSON.stringify(v))).toEqual(v);
}

/* ─── Fixtures ─── */

describe("radar fixture", () => {
  it("is the frozen Team Stats fixture's 94 keys, in the same order", () => {
    expect(ROWS).toHaveLength(94);
    expect(ROWS.map((r) => `${r.game_id}|${r.team_id}`)).toEqual(FROZEN.map((r) => `${r.game_id}|${r.team_id}`));
  });

  it("every column the two fixtures share is identical, row by row (the radar golden cannot drift from the Team Stats golden)", () => {
    const shared = Object.keys(ROWS[0]).filter((c) => c in FROZEN[0]);
    expect(shared.sort()).toEqual(
      ["explosive_pass", "explosive_rush", "game_id", "opponent_id", "pass_plays", "pass_success_rate",
        "rush_plays", "rush_success_rate", "season", "team_id", "turnovers", "week"],
    );
    ROWS.forEach((r, i) => {
      for (const c of shared) expect(r[c], `${r.game_id} ${r.team_id} ${c}`).toBe(FROZEN[i][c]);
    });
  });

  it("carries exactly the five columns the frozen fixture lacks, as whole numbers", () => {
    const extra = Object.keys(ROWS[0]).filter((c) => !(c in FROZEN[0])).sort();
    expect(extra).toEqual(["attempts", "designed_runs", "sacks", "stuffed_runs", "total_drives"]);
    for (const r of ROWS) for (const c of extra) expect(Number.isInteger(r[c]), `${r.game_id} ${c}`).toBe(true);
  });

  it("the six week-1 rows the pytest fixture pins match spec §3.1 (stuffed / designed)", () => {
    const pin: Record<string, [number, number]> = {
      "2026_01_BUF_HOU|BUF": [3, 19], "2026_01_BUF_HOU|HOU": [8, 31], "2026_01_NO_DET|DET": [4, 32],
      "2026_01_NO_DET|NO": [4, 23], "2026_01_TB_CIN|CIN": [4, 25], "2026_01_TB_CIN|TB": [3, 15],
    };
    for (const [k, want] of Object.entries(pin)) {
      const r = ROWS.find((x) => `${x.game_id}|${x.team_id}` === k)!;
      expect([r.stuffed_runs, r.designed_runs], k).toEqual(want);
    }
  });

  it("R5b: Run success and Explosive run keep penalty-wiped runs, Stuff rate does not (DET 36 vs 32, TB 17 vs 15)", () => {
    const det = ROWS.find((x) => x.game_id === "2026_01_NO_DET" && x.team_id === "DET")!;
    const tb = ROWS.find((x) => x.game_id === "2026_01_TB_CIN" && x.team_id === "TB")!;
    expect([det.rush_plays, det.designed_runs]).toEqual([36, 32]);
    expect([tb.rush_plays, tb.designed_runs]).toEqual([17, 15]);
    expect(R.RADAR_STUFF_NOTE).toBe(
      "Stuff rate leaves out kneel-downs, two-point tries and runs wiped out by a penalty; Run success and Explosive run keep two-point tries and penalty-wiped runs, as the Team Stats page does.",
    );
    const axis = (k: RadarAxisKey) => RADAR_AXES.find((a) => a.key === k)!;
    expect(axis("stuff").den).toEqual(["designed_runs"]);
    expect(axis("rush_sr").den).toEqual(["rush_plays"]);
    expect(axis("expl_rush").den).toEqual(["rush_plays"]);
  });
});

/* ─── Golden ─── */

describe("buildTeamRadar — golden (every value, rank, pool and tie against the Python reference)", () => {
  it("32 teams sorted by id, 32 played, through Week 3", () => {
    expect(MODEL.teams.map((t) => t.team)).toEqual(Object.keys(EXPECTED.teams).sort());
    expect(MODEL.teamsPlayed).toBe(EXPECTED.teamsPlayed);
    expect(MODEL.teamsPlayed).toBe(32);
    expect(MODEL.throughWeek).toBe(3);
    expect(MODEL.rowCount).toBe(94);
  });

  it("every team, both sides, all seven spokes", () => {
    for (const t of MODEL.teams) {
      for (const s of SIDES) {
        const exp = EXPECTED.teams[t.team][s];
        expect(t[s].gp, `${t.team}.${s}.gp`).toBe(exp.gp);
        expect(t[s].spokes.map((x) => x.key)).toEqual(KEYS);
        for (const sp of t[s].spokes) {
          const label = `${t.team}.${s}.${sp.key}`;
          close(sp.value, exp[sp.key], label);
          expect(sp.rank, `${label} rank`).toBe(exp.rank[sp.key]);
          expect(sp.pool, `${label} pool`).toBe(exp.pool[sp.key]);
          expect(sp.tied, `${label} tied`).toBe(exp.tied[sp.key]);
        }
      }
    }
  });

  it("the league row", () => {
    for (const k of KEYS) close(MODEL.league[k], EXPECTED.league[k], `league.${k}`);
  });

  it("the league values the spec prints (§3): 7.3 / 11.1 / 46.5 / 39.6 / 6.4 / 11.1, and stuff 395 of 2257", () => {
    const pct = (k: RadarAxisKey) => R.fmtRadarPct(MODEL.league[k]);
    expect([pct("expl_pass"), pct("expl_rush"), pct("pass_sr"), pct("rush_sr"), pct("sack"), pct("to")]).toEqual(
      ["7.3%", "11.1%", "46.5%", "39.6%", "6.4%", "11.1%"],
    );
    expect(MODEL.league.stuff).toBeCloseTo(395 / 2257, 12);
  });

  it("the spec's best and worst (§3): BUF explosive run 20.0% 1st, SF sack rate 0.0% 1st, PHI takeaways 0.0%", () => {
    expect(R.fmtRadarPct(spoke(MODEL, "BUF", "off", "expl_rush").value)).toBe("20.0%");
    expect(spoke(MODEL, "BUF", "off", "expl_rush").rank).toBe(1);
    expect(spoke(MODEL, "SF", "off", "sack").value).toBe(0);
    expect(spoke(MODEL, "SF", "off", "sack").rank).toBe(1);
    expect(spoke(MODEL, "PHI", "def", "to").value).toBe(0);
    expect(team(MODEL, "CHI").off.gp).toBe(2);
    expect(team(MODEL, "PHI").off.gp).toBe(2);
  });

  it("spokes 1-4 are the Team Stats page's numbers for all 32 teams, both sides", () => {
    const stats = buildTeamStats(ROWS);
    const pairs: [RadarAxisKey, "expl_pass_rate" | "expl_rush_rate" | "pass_sr" | "rush_sr"][] = [
      ["expl_pass", "expl_pass_rate"], ["expl_rush", "expl_rush_rate"], ["pass_sr", "pass_sr"], ["rush_sr", "rush_sr"],
    ];
    let n = 0;
    for (const t of stats.teams) {
      for (const s of SIDES) {
        for (const [key, statKey] of pairs) {
          expect(spoke(MODEL, t.team, s, key).value, `${t.team}.${s}.${key}`).toBe(t[s][statKey]);
          n += 1;
        }
      }
    }
    expect(n).toBe(32 * 2 * 4);
    for (const [key, statKey] of pairs) expect(MODEL.league[key]).toBe(stats.league[statKey]);
  });

  it("every number in the model is finite or null (nothing Next cannot serialise)", () => {
    expectSerialisable(MODEL);
  });
});

/* ─── Axes, sides, direction ─── */

describe("RADAR_AXES", () => {
  it("spoke order, clockwise from the top (§4)", () => {
    expect(RADAR_AXES.map((a) => a.label)).toEqual(
      ["Explosive pass", "Pass success", "Sack rate", "Turnover rate", "Stuff rate", "Run success", "Explosive run"],
    );
    expect(RADAR_AXES.map((a) => R.axisLabel(a, "def"))).toEqual(
      ["Explosive pass", "Pass success", "Sack rate", "Takeaway rate", "Stuff rate", "Run success", "Explosive run"],
    );
    expect(RADAR_AXES.map((a) => R.axisLabel(a, "off"))).toEqual(RADAR_AXES.map((a) => a.label));
  });

  it("numerator and denominator columns (§3)", () => {
    expect(RADAR_AXES.map((a) => [a.key, a.num, a.den, a.weighted])).toEqual([
      ["expl_pass", "explosive_pass", ["pass_plays"], false],
      ["pass_sr", "pass_success_rate", ["pass_plays"], true],
      ["sack", "sacks", ["attempts", "sacks"], false],
      ["to", "turnovers", ["total_drives"], false],
      ["stuff", "stuffed_runs", ["designed_runs"], false],
      ["rush_sr", "rush_success_rate", ["rush_plays"], true],
      ["expl_rush", "explosive_rush", ["rush_plays"], false],
    ]);
  });

  it("R4 direction table: offense higher-is-better on four, lower on sack / turnover / stuff; defense the reverse of all seven", () => {
    const off = Object.fromEntries(RADAR_AXES.map((a) => [a.key, R.higherIsBetter(a, "off")]));
    expect(off).toEqual({ expl_pass: true, pass_sr: true, sack: false, to: false, stuff: false, rush_sr: true, expl_rush: true });
    for (const a of RADAR_AXES) expect(R.higherIsBetter(a, "def"), a.key).toBe(!R.higherIsBetter(a, "off"));
    expect(R.RADAR_DIRECTION_NOTE).toBe(
      "On offense a lower sack rate, stuff rate and turnover rate ranks higher. On defense it is the reverse: more sacks, stuffs and takeaways rank higher, and lower explosive and success rates allowed rank higher.",
    );
  });

  it("RADAR_SIDES maps the URL words to the model's sides", () => {
    expect(RADAR_SIDES.map((s) => [s.slug, s.side, s.label])).toEqual([["offense", "off", "Offense"], ["defense", "def", "Defense"]]);
  });
});

/* ─── Scale ─── */

describe("radarScore (§4, R3)", () => {
  it("1st is the outer ring, last the inner ring, the dashed ring is 0.5", () => {
    for (const n of [2, 8, 31, 32]) {
      expect(radarScore(1, n)).toBe(1);
      expect(radarScore(n, n)).toBe(0);
    }
    expect(radarScore(16.5, 32)).toBeCloseTo(0.5, 12);
    expect(R.RADAR_MID_SCORE).toBe(0.5);
    expect(RADAR_HUB).toBe(0.12);
    expect(R.radarRadius(0)).toBeCloseTo(0.12, 12);
    expect(R.radarRadius(1)).toBe(1);
    expect(R.radarRadius(0.5)).toBeCloseTo(0.56, 12);
  });

  it("a pool of 1 scores 1, never NaN or Infinity; a pool of 0 or a missing rank has nothing to score", () => {
    expect(radarScore(1, 1)).toBe(1);
    expect(radarScore(1, 0)).toBeNull();
    expect(radarScore(null, 32)).toBeNull();
    expect(radarScore(NaN, 32)).toBeNull();
    expect(radarScore(3, NaN)).toBeNull();
  });

  it("farther out is always better: a better raw value never has the smaller radius, every axis, both sides (real rows)", () => {
    for (const s of SIDES) {
      for (const a of RADAR_AXES) {
        const cells = MODEL.teams.map((t) => t[s].spokes.find((x) => x.key === a.key)!).filter((c) => c.value !== null);
        const hi = R.higherIsBetter(a, s);
        for (const x of cells) {
          for (const y of cells) {
            const xBetter = hi ? x.value! > y.value! : x.value! < y.value!;
            if (xBetter) expect(x.score!, `${s}.${a.key}`).toBeGreaterThan(y.score!);
            if (x.value === y.value) expect(x.score).toBe(y.score);
          }
        }
      }
    }
  });

  it("R3 names the N it is given", () => {
    expect(R.radarScaleNote(32)).toBe(
      "Each spoke shows the team’s rank among the 32 teams that have played: 1st sits on the outer ring, last on the inner ring, and the dashed ring is the middle of the league. Farther out is always better.",
    );
    expect(R.radarScaleNote(14)).toContain("among the 14 teams that have played");
  });
});

/* ─── Rank, ties, pools ─── */

describe("rank and ties (§4, §9)", () => {
  it("competition rank: ties share the better place and the next place is skipped", () => {
    // sacks allowed: two teams with 0, one with 1, one with 2 (lower is better on offense)
    const m = buildTeamRadar(league(4, (i) => ({ sacks: [0, 0, 1, 2][i], attempts: 30 })));
    const ranks = m.teams.map((t) => spoke(m, t.team, "off", "sack").rank);
    expect(ranks).toEqual([1, 1, 3, 4]);
    expect(m.teams.map((t) => spoke(m, t.team, "off", "sack").tied)).toEqual([true, true, false, false]);
  });

  it("teams tied for last are NOT on the inner ring (review M5): three defenses with 0 takeaways among 32 are T-30th at score 2/31", () => {
    // Team i's own row is what its opponent (team i-1's defense... wrapping) allowed; give 3 offenses 0 turnovers.
    const m = buildTeamRadar(league(32, (i) => ({ turnovers: i < 3 ? 0 : 1 + (i % 5), total_drives: 10 + i })));
    const zero = m.teams.map((t) => spoke(m, t.team, "def", "to")).filter((c) => c.value === 0);
    expect(zero).toHaveLength(3);
    for (const c of zero) {
      expect(c.rank).toBe(30);
      expect(c.tied).toBe(true);
      expect(c.score).toBeCloseTo(2 / 31, 12);
      expect(c.score).toBeGreaterThan(0);
      expect(R.spokeRankLabel(c)).toBe("T-30th");
    }
  });

  it("rank labels: plain ordinal, T- only when another team shares the value, a dash for a missing spoke", () => {
    expect(R.spokeRankLabel({ rank: 2, tied: false })).toBe("2nd");
    expect(R.spokeRankLabel({ rank: 30, tied: true })).toBe("T-30th");
    expect(R.spokeRankLabel({ rank: 1, tied: true })).toBe("T-1st");
    expect(R.spokeRankLabel({ rank: null, tied: false })).toBe("—");
    // Real rows: ATL's defense shares its takeaway rate with another team (28th); PHI's 0.0% stands alone in last.
    expect(spoke(MODEL, "ATL", "def", "to").tied).toBe(true);
    expect(R.spokeRankLabel(spoke(MODEL, "ATL", "def", "to"))).toBe("T-28th");
    expect(R.spokeRankLabel(spoke(MODEL, "PHI", "def", "to"))).toBe("32nd");
    expect(spoke(MODEL, "PHI", "def", "to").score).toBe(0);
    expect(R.spokeRankLabel(spoke(MODEL, "BUF", "off", "expl_rush"))).toBe("1st");
  });

  it("a zero denominator is a missing spoke, not 0; the pool shrinks for that spoke only and the table says so", () => {
    const m = buildTeamRadar(league(9, (i) => (i === 0 ? { rush_plays: 0, explosive_rush: 0, rush_success_rate: null } : {})));
    const mine = spoke(m, "T00", "off", "expl_rush");
    expect(mine.value).toBeNull();
    expect(mine.rank).toBeNull();
    expect(mine.score).toBeNull();
    const other = spoke(m, "T01", "off", "expl_rush");
    expect(other.pool).toBe(8);
    expect(spoke(m, "T01", "off", "expl_pass").pool).toBe(9);
    expect(m.teamsPlayed).toBe(9);
    expect(R.rankCellLabel(other, m.teamsPlayed)).toBe("T-1st of 8");
    expect(R.rankCellLabel(spoke(m, "T01", "off", "expl_pass"), m.teamsPlayed)).toBe("T-1st");
  });

  it("a value of exactly 0% is real: ranked, scored and plotted", () => {
    const m = buildTeamRadar(league(8, (i) => ({ explosive_pass: i === 0 ? 0 : 3 })));
    const c = spoke(m, "T00", "off", "expl_pass");
    expect(c.value).toBe(0);
    expect(c.rank).toBe(8);
    expect(c.score).toBe(0);
    expect(R.fmtRadarPct(c.value)).toBe("0.0%");
  });

  it("the counts behind a ratio spoke are carried for the table; a weighted rate carries none", () => {
    expect(spoke(MODEL, "BUF", "off", "stuff").count).toEqual([
      ROWS.filter((r) => r.team_id === "BUF").reduce((s, r) => s + (r.stuffed_runs as number), 0),
      ROWS.filter((r) => r.team_id === "BUF").reduce((s, r) => s + (r.designed_runs as number), 0),
    ]);
    const sack = spoke(MODEL, "BUF", "off", "sack").count!;
    expect(sack[0] / sack[1]).toBe(spoke(MODEL, "BUF", "off", "sack").value);
    expect(spoke(MODEL, "BUF", "off", "pass_sr").count).toBeNull();
  });

  it("rank tone: the mockup's thirds at 32 (1-10 good, 23-32 bad), by the same position on the scale in a smaller pool", () => {
    expect([1, 10, 11, 22, 23, 32].map((r) => R.rankTone(r, 32))).toEqual(["good", "good", "mid", "mid", "bad", "bad"]);
    expect([1, 2, 3, 4, 5, 6, 8].map((r) => R.rankTone(r, 8))).toEqual(["good", "good", "good", "mid", "mid", "bad", "bad"]);
    expect(R.rankTone(null, 32)).toBe("none");
    expect(R.rankTone(1, 1)).toBe("good");
    expect(R.rankTone(1, 0)).toBe("none");
  });
});

/* ─── Aggregation rules ─── */

describe("aggregation (§3)", () => {
  it("offense is the team's own rows, defense is its opponents' rows (swap test, R2)", () => {
    const rows = [
      row({ team_id: "AAA", opponent_id: "BBB", explosive_pass: 8, pass_plays: 40 }),
      row({ team_id: "BBB", opponent_id: "AAA", explosive_pass: 2, pass_plays: 40 }),
    ];
    const m = buildTeamRadar(rows);
    expect(spoke(m, "AAA", "off", "expl_pass").value).toBe(0.2);
    expect(spoke(m, "AAA", "def", "expl_pass").value).toBe(0.05);
    expect(spoke(m, "BBB", "off", "expl_pass").value).toBe(0.05);
    expect(spoke(m, "BBB", "def", "expl_pass").value).toBe(0.2);
    expect(R.RADAR_SUBTITLE).toEqual({ off: "What the offense did", def: "What opponents did against this defense" });
  });

  it("R5: rates are play-weighted over the season, never the mean of game rates", () => {
    const rows = [
      row({ game_id: "g1", pass_plays: 10, pass_success_rate: 0.8, rush_plays: 40, rush_success_rate: 0.25, sacks: 0, attempts: 10, turnovers: 0, total_drives: 5 }),
      row({ game_id: "g2", pass_plays: 50, pass_success_rate: 0.4, rush_plays: 10, rush_success_rate: 0.5, sacks: 5, attempts: 45, turnovers: 3, total_drives: 15 }),
    ];
    const m = buildTeamRadar(rows);
    expect(spoke(m, "AAA", "off", "pass_sr").value).toBeCloseTo((0.8 * 10 + 0.4 * 50) / 60, 12);
    expect(spoke(m, "AAA", "off", "pass_sr").value).not.toBeCloseTo(0.6, 6);
    expect(spoke(m, "AAA", "off", "rush_sr").value).toBeCloseTo((0.25 * 40 + 0.5 * 10) / 50, 12);
    expect(spoke(m, "AAA", "off", "sack").value).toBe(5 / 60);
    expect(spoke(m, "AAA", "off", "to").value).toBe(3 / 20);
    expect(R.RADAR_RATES_NOTE).toBe(
      "Every rate adds up the team’s box scores for the season. A pass play is any dropback, including sacks and scrambles. QB scrambles of 10+ yards count as explosive runs but not as designed runs, so a team with long scrambles can run high on Explosive run.",
    );
  });

  it("sack rate is sacks ÷ (attempts + sacks) (J3); turnover rate is per drive (J2); stuff is stuffed ÷ designed", () => {
    const m = buildTeamRadar([row()]);
    expect(spoke(m, "AAA", "off", "sack").value).toBe(2 / 38);
    expect(spoke(m, "AAA", "off", "to").value).toBe(1 / 10);
    expect(spoke(m, "AAA", "off", "stuff").value).toBe(4 / 24);
    expect(spoke(m, "AAA", "off", "expl_rush").value).toBe(3 / 25);
  });

  it("NULL in either new column on ANY of a side's rows: stuff is missing for that side (never 0) and for the league average", () => {
    const rows = league(8);
    rows[2] = { ...rows[2], designed_runs: null, stuffed_runs: null }; // T02's own row = T03's defense row
    const m = buildTeamRadar(rows);
    expect(spoke(m, "T02", "off", "stuff").value).toBeNull();
    expect(spoke(m, "T03", "def", "stuff").value).toBeNull();
    expect(spoke(m, "T02", "def", "stuff").value).not.toBeNull();
    expect(spoke(m, "T04", "off", "stuff").value).toBe(4 / 24);
    expect(spoke(m, "T04", "off", "stuff").pool).toBe(7);
    expect(m.league.stuff).toBeNull();
    expect(m.league.sack).not.toBeNull();

    const onlyStuffed = league(8);
    onlyStuffed[0] = { ...onlyStuffed[0], stuffed_runs: null };
    expect(spoke(buildTeamRadar(onlyStuffed), "T00", "off", "stuff").value).toBeNull();
    const twoGames = [row({ game_id: "g1" }), row({ game_id: "g2", designed_runs: null, stuffed_runs: null })];
    expect(spoke(buildTeamRadar(twoGames), "AAA", "off", "stuff").value).toBeNull();
  });

  it("the whole NULL window (rows written before the first refresh): no team has a stuff spoke, six spokes still rank", () => {
    const m = buildTeamRadar(ROWS.map((r) => ({ ...r, designed_runs: null, stuffed_runs: null })));
    for (const t of m.teams) {
      for (const s of SIDES) {
        expect(spoke(m, t.team, s, "stuff").value).toBeNull();
        expect(spoke(m, t.team, s, "stuff").pool).toBe(0);
        expect(spoke(m, t.team, s, "sack").rank).toBe(spoke(MODEL, t.team, s, "sack").rank);
      }
    }
    expect(m.league.stuff).toBeNull();
    expect(R.realSpokeCount(team(m, "BUF").off)).toBe(6);
    expectSerialisable(m);
  });

  it("numeric strings are numbers; 'NaN', '', null, undefined, Infinity and objects are missing, never NaN", () => {
    const strings = buildTeamRadar([row({ pass_plays: "40", explosive_pass: "4", pass_success_rate: "0.5", sacks: "2", attempts: "36" })]);
    expect(spoke(strings, "AAA", "off", "expl_pass").value).toBe(0.1);
    expect(spoke(strings, "AAA", "off", "pass_sr").value).toBe(0.5);
    expect(spoke(strings, "AAA", "off", "sack").value).toBe(2 / 38);

    for (const junk of ["NaN", "", null, undefined, Infinity, {}, "abc"]) {
      const m = buildTeamRadar([row({ pass_success_rate: junk, rush_plays: junk, designed_runs: junk, total_drives: junk })]);
      expect(spoke(m, "AAA", "off", "pass_sr").value).toBeNull();
      expect(spoke(m, "AAA", "off", "expl_rush").value).toBeNull();
      expect(spoke(m, "AAA", "off", "stuff").value).toBeNull();
      expect(spoke(m, "AAA", "off", "to").value).toBeNull();
      expectSerialisable(m);
    }
  });

  it("through week is the largest week in the rows (M3); null when no row has one", () => {
    expect(buildTeamRadar([row({ week: 2 }), row({ game_id: "g2", week: "4" }), row({ game_id: "g3", week: null })]).throughWeek).toBe(4);
    expect(buildTeamRadar([row({ week: null })]).throughWeek).toBeNull();
    expect(buildTeamRadar([]).throughWeek).toBeNull();
  });

  it("pool sizes 0 / 1 / 7 / 8 / 32", () => {
    const empty = buildTeamRadar([]);
    expect(empty.teams).toEqual([]);
    expect(empty.teamsPlayed).toBe(0);
    expect(Object.values(empty.league).every((v) => v === null)).toBe(true);

    const one = buildTeamRadar([row()]);
    expect(one.teamsPlayed).toBe(1);
    expect(spoke(one, "AAA", "off", "sack")).toMatchObject({ rank: 1, pool: 1, score: 1, tied: false });

    for (const n of [7, 8, 32]) {
      const m = buildTeamRadar(league(n, (i) => ({ explosive_pass: i })));
      expect(m.teamsPlayed).toBe(n);
      expect(m.teams.map((t) => spoke(m, t.team, "off", "expl_pass").rank)).toEqual(Array.from({ length: n }, (_, i) => n - i));
      expect(spoke(m, "T00", "off", "expl_pass").pool).toBe(n);
    }
  });

  it("1000+ rows, an unknown team id, and rows with no usable team id", () => {
    const big: Row[] = [];
    for (let g = 0; g < 40; g += 1) for (const r of league(32)) big.push({ ...r, game_id: `${r.game_id}_${g}`, week: (g % 18) + 1 });
    expect(big.length).toBeGreaterThan(1000);
    big.push(row({ game_id: "x1", team_id: "ZZZ", opponent_id: "T00" }));
    big.push(row({ game_id: "x2", team_id: null, opponent_id: undefined }));
    big.push(row({ game_id: "x3", team_id: "", opponent_id: 7 }));
    const m = buildTeamRadar(big);
    expect(m.rowCount).toBe(big.length);
    expect(m.teamsPlayed).toBe(33);
    expect(team(m, "ZZZ").off.gp).toBe(1);
    expect(team(m, "ZZZ").def.gp).toBe(0);
    expect(R.realSpokeCount(team(m, "ZZZ").def)).toBe(0);
    expect(m.teams.find((t) => t.team === "")).toBeUndefined();
    expect(m.throughWeek).toBe(18);
    expectSerialisable(m);
  });

  it("garbage in: null, undefined and non-object rows do not throw", () => {
    expect(buildTeamRadar(null as never).teams).toEqual([]);
    expect(buildTeamRadar(undefined as never).teamsPlayed).toBe(0);
    expect(() => buildTeamRadar([null, undefined, 5, "x", row()] as never)).not.toThrow();
    expect(buildTeamRadar([null, undefined, 5, "x", row()] as never).teamsPlayed).toBe(1);
  });
});

/* ─── States (§7) ─── */

describe("teamRadarState — one test per row of §7's table, top to bottom", () => {
  const base = { failed: false, rowCount: 94, teamsPlayed: 32, teamHasRows: true, season: 2026, newestSeason: 2026, covered: [2026] };

  it("1: the read rejects → unavailable (whatever else is true)", () => {
    expect(teamRadarState({ ...base, failed: true })).toEqual({ state: "unavailable", firstSeason: null });
    expect(teamRadarState({ ...base, failed: true, rowCount: 0, season: 2019 }).state).toBe("unavailable");
  });

  it("2: rows and fewer than 8 teams have played → small-pool, even for a team with no row (checked BEFORE no-games, review I4)", () => {
    expect(teamRadarState({ ...base, rowCount: 14, teamsPlayed: 7 }).state).toBe("small-pool");
    expect(teamRadarState({ ...base, rowCount: 2, teamsPlayed: 2, teamHasRows: false }).state).toBe("small-pool");
    expect(RADAR_MIN_TEAMS).toBe(8);
  });

  it("3: rows, 8+ teams, this team has no row → no-games", () => {
    expect(teamRadarState({ ...base, rowCount: 16, teamsPlayed: 8, teamHasRows: false }).state).toBe("no-games");
  });

  it("4: rows, 8+ teams, this team has a row → ready (exactly at the threshold too)", () => {
    expect(teamRadarState(base).state).toBe("ready");
    expect(teamRadarState({ ...base, rowCount: 8, teamsPlayed: 8 }).state).toBe("ready");
    expect(teamRadarState({ ...base, season: 2025, newestSeason: 2026, covered: [] }).state).toBe("ready");
  });

  it("5: no rows for the newest data season, or for a season the probe says is covered → unavailable (a silently failing read)", () => {
    expect(teamRadarState({ ...base, rowCount: 0, teamsPlayed: 0, teamHasRows: false }).state).toBe("unavailable");
    expect(teamRadarState({ ...base, rowCount: 0, teamsPlayed: 0, teamHasRows: false, covered: [] }).state).toBe("unavailable");
    expect(
      teamRadarState({ ...base, rowCount: 0, teamsPlayed: 0, teamHasRows: false, season: 2025, covered: [2026, 2025] }).state,
    ).toBe("unavailable");
  });

  it("6: no rows for a season later than the newest data season → small-pool (R11 is true: no team has played)", () => {
    expect(teamRadarState({ ...base, rowCount: 0, teamsPlayed: 0, teamHasRows: false, season: 2027 }).state).toBe("small-pool");
    expect(teamRadarState({ ...base, rowCount: 0, teamsPlayed: 0, teamHasRows: false, season: 2099, covered: [] }).state).toBe("small-pool");
  });

  it("7: no rows otherwise → uncovered; the first covered season is named only when known AND later than the viewed season", () => {
    const none = { ...base, rowCount: 0, teamsPlayed: 0, teamHasRows: false };
    // older than the first covered season
    expect(teamRadarState({ ...none, season: 2025 })).toEqual({ state: "uncovered", firstSeason: 2026 });
    expect(teamRadarState({ ...none, season: 2021, covered: [2026, 2024] })).toEqual({ state: "uncovered", firstSeason: 2024 });
    // a gap season after a partial backfill (2023 and 2026 covered, viewing 2024)
    expect(teamRadarState({ ...none, season: 2024, covered: [2026, 2023] })).toEqual({ state: "uncovered", firstSeason: null });
    // the probe returned [] (or failed and degraded to []): the first season is unknown
    expect(teamRadarState({ ...none, season: 2025, covered: [] })).toEqual({ state: "uncovered", firstSeason: null });
    // no newest season known at all (no database)
    expect(teamRadarState({ ...none, season: 2025, newestSeason: null, covered: [] })).toEqual({ state: "uncovered", firstSeason: null });
  });

  it("is total: every combination of the inputs returns one of the five states", () => {
    const states = new Set<string>();
    for (const failed of [true, false])
      for (const rowCount of [0, 1, 94])
        for (const teamsPlayed of [0, 7, 8, 32])
          for (const teamHasRows of [true, false])
            for (const season of [1999, 2025, 2026, 2027])
              for (const newestSeason of [null, 2026])
                for (const covered of [[], [2026], [2026, 2025]]) {
                  const out = teamRadarState({ failed, rowCount, teamsPlayed, teamHasRows, season, newestSeason, covered });
                  expect(["ready", "no-games", "small-pool", "uncovered", "unavailable"]).toContain(out.state);
                  states.add(out.state);
                }
    expect(states.size).toBe(5);
  });
});

/* ─── The slice handed to the client hub ─── */

describe("teamRadarSlice — plain data for the 'use client' hub", () => {
  const args = { teamId: "BUF", season: 2026, rows: ROWS, newestSeason: 2026, covered: [2026] };

  it("ready: this team's two sides, the league row, N, games and the week, all JSON-safe", () => {
    const s = teamRadarSlice(args);
    if (s.state !== "ready") throw new Error(s.state);
    expect(s.season).toBe(2026);
    expect(s.teamsPlayed).toBe(32);
    expect(s.games).toBe(3);
    expect(s.throughWeek).toBe(3);
    expect(s.isLatestSeason).toBe(true);
    expect(s.off).toEqual(team(MODEL, "BUF").off);
    expect(s.def).toEqual(team(MODEL, "BUF").def);
    expect(s.league).toEqual(MODEL.league);
    expectSerialisable(s);
    expect(JSON.stringify(s)).not.toMatch(/NaN|Infinity/);
  });

  it("ready with junk rows still carries null, never NaN (review M10)", () => {
    const rows = league(8, (i) => (i === 0 ? { pass_success_rate: "NaN", rush_plays: 0, designed_runs: null, total_drives: 0, attempts: 0, sacks: 0 } : {}));
    const s = teamRadarSlice({ ...args, teamId: "T00", rows });
    if (s.state !== "ready") throw new Error(s.state);
    const values = Object.fromEntries(s.off.spokes.map((x) => [x.key, x.value]));
    expect(values).toMatchObject({ pass_sr: null, expl_rush: null, rush_sr: null, stuff: null, to: null, sack: null });
    expect(values.expl_pass).toBe(0.1);
    for (const sp of s.off.spokes) for (const v of Object.values(sp)) expect(Number.isNaN(v)).toBe(false);
    expectSerialisable(s);
  });

  it("a rejected read (rows = null) → unavailable", () => {
    expect(teamRadarSlice({ ...args, rows: null })).toEqual({ state: "unavailable", season: 2026 });
  });

  it("opening Thursday: 2 teams played, a third team is told small-pool, not no-games", () => {
    expect(teamRadarSlice({ ...args, teamId: "KC", rows: league(2) })).toEqual({ state: "small-pool", season: 2026 });
  });

  it("8 teams played, this one has not → no-games", () => {
    expect(teamRadarSlice({ ...args, teamId: "KC", rows: league(8) })).toEqual({ state: "no-games", season: 2026 });
  });

  // Chaos R1: this used to be `ready` with "through 0 games". A team is "played"
  // only by a row of its own (spec §7 row 3: "this team has no row").
  it("a team that appears only as an opponent (its own row missing) is no-games", () => {
    const rows = league(9).filter((r) => r.team_id !== "T03");
    expect(teamRadarSlice({ ...args, teamId: "T03", rows })).toEqual({ state: "no-games", season: 2026 });
  });

  it("no rows: the newest season → unavailable; a later season → small-pool; an older one → uncovered with or without a first season", () => {
    expect(teamRadarSlice({ ...args, rows: [] })).toEqual({ state: "unavailable", season: 2026 });
    expect(teamRadarSlice({ ...args, rows: [], season: 2027 })).toEqual({ state: "small-pool", season: 2027 });
    expect(teamRadarSlice({ ...args, rows: [], season: 2025 })).toEqual({ state: "uncovered", season: 2025, firstSeason: 2026 });
    expect(teamRadarSlice({ ...args, rows: [], season: 2025, covered: [] })).toEqual({ state: "uncovered", season: 2025, firstSeason: null });
  });

  it("a past season with rows is ready and not 'latest' (no early-season note there)", () => {
    const s = teamRadarSlice({ ...args, season: 2025, rows: ROWS.map((r) => ({ ...r, season: 2025 })), covered: [2026, 2025] });
    if (s.state !== "ready") throw new Error(s.state);
    expect(s.isLatestSeason).toBe(false);
  });

  it("lower-case or unknown team ids never throw", () => {
    expect(teamRadarSlice({ ...args, teamId: "buf" }).state).toBe("no-games");
    expect(teamRadarSlice({ ...args, teamId: "" }).state).toBe("no-games");
  });
});

/* ─── Copy (§8): every visitor-facing sentence, bound to the rule it describes ─── */

describe("copy", () => {
  it("R1 lead: N is the pool, G the team's games; 'all' only at 32; '1 game' singular", () => {
    expect(R.radarLead("Buffalo Bills", 32, 3)).toBe("How the Buffalo Bills rank among all 32 teams, through 3 games.");
    expect(R.radarLead("Chicago Bears", 32, 1)).toBe("How the Chicago Bears rank among all 32 teams, through 1 game.");
    expect(R.radarLead("Buffalo Bills", 14, 1)).toBe("How the Buffalo Bills rank among the 14 teams that have played, through 1 game.");
    const s = teamRadarSlice({ teamId: "CHI", season: 2026, rows: ROWS, newestSeason: 2026, covered: [2026] });
    if (s.state !== "ready") throw new Error(s.state);
    expect(R.radarLead("Chicago Bears", s.teamsPlayed, s.games)).toBe("How the Chicago Bears rank among all 32 teams, through 2 games.");
    expect(s.games).toBe(ROWS.filter((r) => r.team_id === "CHI").length);
  });

  it("R7 sub-lines, in spoke order; the defense table's fourth line is the opponents' version (review M2)", () => {
    expect(RADAR_AXES.map((a) => R.axisSubline(a, "off"))).toEqual([
      "Completions of 20+ yards ÷ pass plays",
      "Pass plays with EPA above zero",
      "Sacks ÷ (pass attempts + sacks)",
      "Turnovers ÷ drives",
      "Runs for no gain or a loss ÷ designed runs",
      "Designed runs with EPA above zero",
      "Runs of 10+ yards ÷ designed runs",
    ]);
    const def = RADAR_AXES.map((a) => R.axisSubline(a, "def"));
    expect(def[3]).toBe("Opponent turnovers ÷ opponent drives");
    expect(def.filter((_, i) => i !== 3)).toEqual(RADAR_AXES.map((a) => R.axisSubline(a, "off")).filter((_, i) => i !== 3));
  });

  it("R6: the early-season note only in weeks 1-4 of the newest season; footnotes in order R3, R4, R5, R5b, R6", () => {
    const notes = R.teamRadarFootnotes({ teamsPlayed: 32, throughWeek: 3, isLatestSeason: true });
    expect(notes).toEqual([
      R.radarScaleNote(32),
      R.RADAR_DIRECTION_NOTE,
      R.RADAR_RATES_NOTE,
      R.RADAR_STUFF_NOTE,
      "With only 3 weeks played, one game moves a team a long way.",
    ]);
    expect(R.teamRadarFootnotes({ teamsPlayed: 32, throughWeek: 5, isLatestSeason: true })).toHaveLength(4);
    expect(R.teamRadarFootnotes({ teamsPlayed: 32, throughWeek: 3, isLatestSeason: false })).toHaveLength(4);
    expect(R.teamRadarFootnotes({ teamsPlayed: 32, throughWeek: null, isLatestSeason: true })).toHaveLength(4);
  });

  it("R9: the Team Stats sentence names every spoke family in RADAR_AXES", () => {
    expect(R.TEAM_STATS_RADAR_NOTE).toBe("Each team’s page has a radar of its explosive, success, sack, stuff and turnover rates.");
    const family = (label: string) => label.toLowerCase().split(" ").find((w) => ["explosive", "success", "sack", "stuff", "turnover"].includes(w));
    const families = new Set(RADAR_AXES.map((a) => family(a.label)));
    expect(families.has(undefined)).toBe(false);
    expect(families.size).toBe(5);
    for (const f of Array.from(families)) expect(R.TEAM_STATS_RADAR_NOTE).toContain(f as string);
  });

  it("R10 no-games", () => {
    expect(R.radarNoGamesNote("Kansas City Chiefs", 2026)).toBe(
      "The Kansas City Chiefs have not played a 2026 game yet. Their radar appears after their first game.",
    );
  });

  it("R11 small-pool: the threshold constant drives the sentence and the rule", () => {
    expect(R.RADAR_SMALL_POOL_NOTE).toBe(
      "Team radars start once 8 teams have played this season. Until then there are too few teams to rank against.",
    );
    expect(R.RADAR_SMALL_POOL_NOTE).toContain(`once ${RADAR_MIN_TEAMS} teams`);
    const at = (n: number) => teamRadarState({ failed: false, rowCount: n, teamsPlayed: n, teamHasRows: true, season: 2026, newestSeason: 2026, covered: [] }).state;
    expect(at(RADAR_MIN_TEAMS - 1)).toBe("small-pool");
    expect(at(RADAR_MIN_TEAMS)).toBe("ready");
  });

  it("R12 / R12b uncovered: names a first season only when given one; never promises a backfill; never an unknown year", () => {
    expect(R.radarUncoveredNote(2025, 2026)).toBe("Team radars start with the 2026 season.");
    expect(R.radarUncoveredNote(2025, null)).toBe("Team radars are not available for the 2025 season.");
    expect(R.radarUncoveredNote(2024, null)).not.toMatch(/null|undefined|NaN/);
    expect(R.radarUncoveredNote(2025, 2026)).not.toMatch(/soon|coming|yet|will/i);
  });

  it("R13 unavailable", () => {
    expect(R.RADAR_UNAVAILABLE_NOTE).toBe("The team radar is unavailable right now.");
  });

  it("R17 team sack rate: the sentence and the columns it describes", () => {
    expect(R.TEAM_SACK_RATE_DEFINITION).toBe(
      "Sacks divided by pass attempts plus sacks, added up over the team’s games. Scrambles and two-point tries are not counted.",
    );
    const a = RADAR_AXES.find((x) => x.key === "sack")!;
    expect([a.num, a.den]).toEqual(["sacks", ["attempts", "sacks"]]);
    expect(a.tooltip).toBe("Team sack rate");
  });

  it("R18 team turnover rate", () => {
    expect(R.TEAM_TURNOVER_RATE_DEFINITION).toBe(
      "Turnovers (interceptions plus fumbles lost) divided by the team’s drives. On defense it is the takeaway rate: opponents’ turnovers divided by opponents’ drives.",
    );
    const a = RADAR_AXES.find((x) => x.key === "to")!;
    expect([a.num, a.den]).toEqual(["turnovers", ["total_drives"]]);
    expect(a.tooltip).toBe("Team turnover rate");
  });

  it("R19 team stuff rate: names kneel-downs and penalty-wiped runs, and says it will not match the backs' rates", () => {
    expect(R.TEAM_STUFF_RATE_DEFINITION).toBe(
      "Designed runs stopped for no gain or a loss, divided by designed runs. Kneel-downs, QB scrambles, two-point tries and runs wiped out by a penalty are left out. It counts every designed run, including those by quarterbacks and receivers, so it will not match the running backs’ stuff rates.",
    );
    const a = RADAR_AXES.find((x) => x.key === "stuff")!;
    expect([a.num, a.den]).toEqual(["stuffed_runs", ["designed_runs"]]);
    expect(a.tooltip).toBe("Team stuff rate");
    expect(R.TEAM_STUFF_RATE_DEFINITION).toMatch(/Kneel-downs/);
    expect(R.TEAM_STUFF_RATE_DEFINITION).toMatch(/wiped out by a penalty/);
    expect(R.TEAM_STUFF_RATE_DEFINITION).toMatch(/quarterbacks and receivers/);
    expect(R.TEAM_STUFF_RATE_DEFINITION).toMatch(/will not match the running backs/);
  });

  it("R20 table-only: fewer than 4 real spokes, per side", () => {
    expect(R.radarTableOnlyNote("off")).toBe("Not enough of these rates are available yet to draw the offense radar.");
    expect(R.radarTableOnlyNote("def")).toBe("Not enough of these rates are available yet to draw the defense radar.");
    expect(RADAR_MIN_SPOKES).toBe(4);
    const three = buildTeamRadar([row({ rush_plays: 0, designed_runs: 0, total_drives: 0, rush_success_rate: null })]);
    expect(R.realSpokeCount(team(three, "AAA").off)).toBe(3);
    expect(R.canDrawRadar(team(three, "AAA").off)).toBe(false);
    const four = buildTeamRadar([row({ rush_plays: 0, designed_runs: 0, rush_success_rate: null })]);
    expect(R.realSpokeCount(team(four, "AAA").off)).toBe(4);
    expect(R.canDrawRadar(team(four, "AAA").off)).toBe(true);
  });

  it("the Team Stats link and the share-card href carry a past season and stay bare for the default one", () => {
    expect(R.COMPARE_TEAMS_LINK_TEXT).toBe("Compare all teams on Team Stats");
    expect(R.teamStatsHref(2026, 2026)).toBe("/team-stats");
    expect(R.teamStatsHref(2025, 2026)).toBe("/team-stats?season=2025");
    expect(R.radarCardHref("BUF", "off", 2026, 2026)).toBe("/card/team/BUF/offense");
    expect(R.radarCardHref("BUF", "def", 2025, 2026)).toBe("/card/team/BUF/defense?season=2025");
  });

  it("the band's right-hand text", () => {
    expect(R.radarBandAside(2026, 3)).toBe("2026 · Through Week 3");
    expect(R.radarBandAside(2026, null)).toBe("2026");
  });

  it("percent formatting: one decimal, a dash for a missing value", () => {
    expect(R.fmtRadarPct(0.1071)).toBe("10.7%");
    expect(R.fmtRadarPct(0)).toBe("0.0%");
    expect(R.fmtRadarPct(null)).toBe("—");
    expect(R.fmtRadarPct(NaN)).toBe("—");
    expect(R.fmtRadarPct(undefined)).toBe("—");
  });
});

/* ─── The module stays out of the server data layer (review M10) ─── */

describe("lib/stats/team-radar.ts imports nothing from lib/data", () => {
  const read = (rel: string) => readFileSync(join(__dirname, "..", "..", rel), "utf8");

  it("no import from lib/data or lib/supabase in the module itself", () => {
    const src = read("lib/stats/team-radar.ts");
    expect(src).not.toMatch(/from\s+["']@\/lib\/data\//);
    expect(src).not.toMatch(/from\s+["']@\/lib\/supabase\//);
    expect(src).not.toMatch(/from\s+["']\.\.\/data\//);
    expect(src).not.toMatch(/import\(/);
  });

  it("nothing it imports, at any depth, reaches the Supabase client", () => {
    const seen = new Set<string>();
    const walk = (rel: string) => {
      if (seen.has(rel)) return;
      seen.add(rel);
      const src = read(rel);
      for (const m of Array.from(src.matchAll(/from\s+["']@\/(lib\/[^"']+)["']/g))) {
        const base = m[1];
        const file = [`${base}.ts`, `${base}.tsx`, `${base}/index.ts`].find((f) => {
          try {
            read(f);
            return true;
          } catch {
            return false;
          }
        });
        if (file) walk(file);
      }
    };
    walk("lib/stats/team-radar.ts");
    expect(Array.from(seen).filter((f) => f.startsWith("lib/supabase"))).toEqual([]);
    // lib/data/teams (a static list, no client) is the only lib/data file the graph may touch.
    expect(Array.from(seen).filter((f) => f.startsWith("lib/data/") && f !== "lib/data/teams.ts")).toEqual([]);
  });
});

/* ─── Chaos pass (2026-10-06): W1, R1-R5 ─── */

describe("chaos W1 — float noise never splits a tie", () => {
  // Both teams are 31 successes on 68 pass plays, but the stored per-game rates
  // re-multiply to 0.4558823529411765 and 0.45588235294117646.
  const noisy = [
    ...league(8, (i) => ({ pass_plays: 40, pass_success_rate: 0.3 + i / 100 })),
    row({ game_id: "a1", team_id: "AAA", opponent_id: "T00", pass_plays: 30, pass_success_rate: 10 / 30 }),
    row({ game_id: "a2", team_id: "AAA", opponent_id: "T01", pass_plays: 38, pass_success_rate: 21 / 38 }),
    row({ game_id: "b1", team_id: "BBB", opponent_id: "T02", pass_plays: 33, pass_success_rate: 12 / 33 }),
    row({ game_id: "b2", team_id: "BBB", opponent_id: "T03", pass_plays: 35, pass_success_rate: 19 / 35 }),
  ];

  it("two teams with the same season totals share the better place and print T-", () => {
    const m = buildTeamRadar(noisy);
    const a = spoke(m, "AAA", "off", "pass_sr");
    const b = spoke(m, "BBB", "off", "pass_sr");
    expect(a.value).not.toBe(b.value); // the noise is real
    expect(Math.abs(a.value! - b.value!)).toBeLessThan(R.RADAR_TIE_EPSILON);
    expect([a.rank, b.rank]).toEqual([1, 1]);
    expect([a.tied, b.tied]).toEqual([true, true]);
    expect(a.score).toBe(b.score);
    expect(R.spokeRankLabel(a)).toBe("T-1st");
    // the next team is 3rd, not 2nd
    expect(m.teams.map((t) => spoke(m, t.team, "off", "pass_sr").rank).sort((x, y) => x! - y!).slice(0, 3)).toEqual([1, 1, 3]);
  });

  it("a real difference, however small it prints, is still a different rank", () => {
    const m = buildTeamRadar(league(8, (i) => ({ pass_plays: 1000, pass_success_rate: 0.5 + i * 1e-6 })));
    expect(m.teams.map((t) => spoke(m, t.team, "off", "pass_sr").rank)).toEqual([8, 7, 6, 5, 4, 3, 2, 1]);
    expect(m.teams.some((t) => spoke(m, t.team, "off", "pass_sr").tied)).toBe(false);
  });
});

describe("chaos R1 — played means a row of the team’s own", () => {
  const noBuf = ROWS.filter((r) => r.team_id !== "BUF");

  it("a team with no row of its own (only its opponents’ rows) is no-games (R10), never through 0 games", () => {
    expect(teamRadarSlice({ teamId: "BUF", season: 2026, rows: noBuf, newestSeason: 2026, covered: [2026] })).toEqual({
      state: "no-games",
      season: 2026,
    });
  });

  it("N and every pool count the same teams: no rank can exceed the N the lead prints", () => {
    const m = buildTeamRadar(noBuf);
    expect(m.teamsPlayed).toBe(31);
    for (const t of m.teams) {
      for (const s of SIDES) {
        for (const sp of t[s].spokes) {
          expect(sp.pool, `${t.team}.${s}.${sp.key}`).toBeLessThanOrEqual(31);
          if (sp.rank !== null) expect(sp.rank).toBeLessThanOrEqual(31);
        }
      }
    }
    // BUF is in no pool and has no rank, on either side
    for (const s of SIDES) for (const sp of team(m, "BUF")[s].spokes) expect(sp.rank).toBeNull();
    expect(spoke(m, "KC", "def", "sack").pool).toBe(31);
  });
});

describe("chaos R3 — a rate outside 0-1 is a missing spoke, reported, never printed", () => {
  it("stuffed > designed, a negative denominator, a success rate of 12, more turnovers than drives", () => {
    const rows = league(9, (i) =>
      i === 0 ? { stuffed_runs: 60, designed_runs: 20 }
        : i === 1 ? { pass_plays: -40 }
          : i === 2 ? { rush_success_rate: 12 }
            : i === 3 ? { total_drives: 10, turnovers: 15 }
              : {},
    );
    const m = buildTeamRadar(rows);
    expect(spoke(m, "T00", "off", "stuff")).toMatchObject({ value: null, rank: null, count: null });
    expect(spoke(m, "T01", "off", "expl_pass").value).toBeNull();
    expect(spoke(m, "T01", "off", "pass_sr").value).toBeNull();
    expect(spoke(m, "T02", "off", "rush_sr").value).toBeNull();
    expect(spoke(m, "T03", "off", "to").value).toBeNull();
    // the same row seen from the defense side
    expect(spoke(m, "T01", "def", "stuff").value).toBeNull();
    // untouched teams keep their values and rank in a smaller pool
    expect(spoke(m, "T05", "off", "stuff").value).toBe(4 / 24);
    expect(spoke(m, "T05", "off", "stuff").pool).toBe(8);
    for (const t of m.teams) for (const s of SIDES) for (const sp of t[s].spokes) {
      if (sp.value !== null) {
        expect(sp.value).toBeGreaterThanOrEqual(0);
        expect(sp.value).toBeLessThanOrEqual(1);
      }
    }
    for (const v of Object.values(m.league)) if (v !== null) expect(v >= 0 && v <= 1).toBe(true);
    expect(m.rejected.length).toBeGreaterThan(0);
    expect(m.rejected.join(" ")).toContain("T00 off stuff");
    expectSerialisable(m);
  });

  it("the real fixture rejects nothing", () => {
    expect(MODEL.rejected).toEqual([]);
  });

  it("teamRadarSlice reports rejected rates once, through the logger it is given", () => {
    const messages: string[] = [];
    const rows = league(9, (i) => (i === 0 ? { stuffed_runs: 60, designed_runs: 20 } : i === 1 ? { pass_plays: -40 } : {}));
    teamRadarSlice({ teamId: "T04", season: 2026, rows, newestSeason: 2026, covered: [2026], log: (m) => messages.push(m) });
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatch(/outside 0-1/);
    expect(messages[0]).toContain("T00 off stuff");
    const quiet: string[] = [];
    teamRadarSlice({ teamId: "BUF", season: 2026, rows: ROWS, newestSeason: 2026, covered: [2026], log: (m) => quiet.push(m) });
    expect(quiet).toEqual([]);
  });
});

describe("chaos R4 / R5 — defence in depth on the rows", () => {
  it("R4: rows of another season are ignored when a season is asked for", () => {
    const mixed = [...ROWS, ...ROWS.map((r) => ({ ...r, season: 2025 }))];
    expect(buildTeamRadar(mixed, 2026)).toEqual(MODEL);
    expect(buildTeamRadar(ROWS, 2025).rowCount).toBe(0);
    expect(buildTeamRadar(ROWS.map((r) => ({ ...r, season: "2026" })), 2026).rowCount).toBe(94);
    // 2025 rows handed to a 2026 page are not drawn as 2026
    const s = teamRadarSlice({ teamId: "BUF", season: 2026, rows: ROWS.map((r) => ({ ...r, season: 2025 })), newestSeason: 2026, covered: [2026] });
    expect(s.state).toBe("unavailable");
    const ok = teamRadarSlice({ teamId: "BUF", season: 2026, rows: mixed, newestSeason: 2026, covered: [2026] });
    if (ok.state !== "ready") throw new Error(ok.state);
    expect(ok.games).toBe(3);
  });

  it("R5: a repeated (game_id, team_id) row counts once (the first is kept)", () => {
    const buf = ROWS.filter((r) => r.team_id === "BUF");
    expect(buildTeamRadar([...ROWS, ...buf])).toEqual(MODEL);
    expect(buildTeamRadar([...ROWS, ...ROWS])).toEqual(MODEL);
    const first = buildTeamRadar([row({ sacks: 2 }), row({ sacks: 30 })]);
    expect(team(first, "AAA").off.gp).toBe(1);
    expect(spoke(first, "AAA", "off", "sack").value).toBe(2 / 38);
  });
});

describe("chaos R2 — the outline colour is always visible on white", () => {
  it("every team: stroke contrast on white is at least 3:1; a readable primary is kept", () => {
    expect(NFL_TEAMS).toHaveLength(32);
    for (const t of NFL_TEAMS) {
      const stroke = R.radarStrokeColor(t.primaryColor, t.secondaryColor);
      expect(R.contrastOnWhite(stroke), `${t.id} ${stroke}`).toBeGreaterThanOrEqual(3);
      if (R.contrastOnWhite(t.primaryColor) >= 3) expect(stroke, t.id).toBe(t.primaryColor);
    }
  });

  it("PIT and NO (gold on white, under 2:1) switch to their dark secondary", () => {
    for (const id of ["PIT", "NO"]) {
      const t = NFL_TEAMS.find((x) => x.id === id)!;
      expect(R.contrastOnWhite(t.primaryColor)).toBeLessThan(2);
      expect(R.radarStrokeColor(t.primaryColor, t.secondaryColor)).toBe(t.secondaryColor);
    }
  });

  it("two light colours, or junk, fall back to a dark neutral", () => {
    expect(R.radarStrokeColor("#FFB612", "#FFFF00")).toBe("#0f172a");
    expect(R.radarStrokeColor("", "nope")).toBe("#0f172a");
    expect(R.radarStrokeColor(undefined as never, null as never)).toBe("#0f172a");
    expect(R.contrastOnWhite("#000000")).toBeCloseTo(21, 5);
    expect(R.contrastOnWhite("#ffffff")).toBeCloseTo(1, 5);
    expect(R.contrastOnWhite("junk")).toBe(1);
  });
});
