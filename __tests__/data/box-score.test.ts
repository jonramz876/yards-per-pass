import { describe, it, expect, beforeEach, vi } from "vitest";
import type { TeamGame } from "@/lib/types";

// Fake Supabase client: every from(table) starts its own chain, so the parallel
// reads in getBoxScore can't interleave. `results[table]` is a response or a
// function of the chain's recorded calls (one table can answer two queries).
type Res = { data: unknown; error: unknown };
const results: Record<string, Res | ((calls: unknown[][]) => Res)> = {};
const chains: { table: string; calls: unknown[][] }[] = [];

vi.mock("@/lib/supabase/server", () => ({
  createServerClient: () => ({
    from: (table: string) => {
      const calls: unknown[][] = [];
      chains.push({ table, calls });
      const builder: Record<string, unknown> = {};
      for (const m of ["select", "eq", "in", "limit", "order", "or", "range", "abortSignal"]) {
        builder[m] = (...a: unknown[]) => {
          calls.push([m, ...a]);
          return builder;
        };
      }
      builder.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => {
        const r = results[table];
        const value = typeof r === "function" ? r(calls) : (r ?? { data: [], error: null });
        return Promise.resolve(value).then(res, rej);
      };
      return builder;
    },
  }),
}));

vi.mock("@/lib/data/games", () => ({
  getGame: vi.fn(),
  getTeamSchedule: vi.fn(async () => []),
}));

vi.mock("@/lib/data/queries", () => ({
  getAvailableSeasons: vi.fn(async () => [2026, 2025]),
}));

import {
  BOX_SCORE_READ_DEADLINE_MS,
  getBoxScore,
  getBoxScoreMeta,
  getBoxScoreSeasons,
  getBoxScoreSeasonsCached,
  getGamePlayerLines,
  getTeamGameStats,
  normalizeGameId,
  TEAM_GAME_NUMERIC,
} from "@/lib/data/box-score";
import { getGame, getTeamSchedule } from "@/lib/data/games";
import { getAvailableSeasons } from "@/lib/data/queries";
import { BUF_HOU_GAME, BUF_STATS, HOU_STATS, scheduleFor } from "../fixtures/box-score-buf-hou";

/** A team_game_stats row as PostgREST sends it: NUMERIC columns are strings. */
function wireRow(team: "BUF" | "HOU"): Record<string, unknown> {
  const src = team === "BUF" ? BUF_STATS : HOU_STATS;
  const row: Record<string, unknown> = { ...src };
  for (const col of TEAM_GAME_NUMERIC) {
    const v = row[col];
    row[col] = v === null ? null : String(v);
  }
  return row;
}

const chainsFor = (table: string) => chains.filter((c) => c.table === table);
const signalsUsed = () =>
  chains.map((c) => (c.calls.find((call) => call[0] === "abortSignal") ?? [])[1]);

// Transcribed by hand from scripts/ingest.py's TEAM_GAME_STATS_RATE_COLS (17)
// and TEAM_GAME_STATS_SUM_COLS (3) -- NOT derived from TEAM_GAME_NUMERIC, which
// is the list under test. wireRow above builds its wire FROM that list, so the
// one failure this layer can really have (a NUMERIC column missing from it) is
// unrepresentable there: drop success_rate and wireRow stops stringifying it
// too, the suite stays green, and the live page renders Success rate as an em
// dash on all 544 games of a season with nothing logged. This is the guard PR
// 2's pytest golden gives itself in test_every_stored_column_has_a_golden_value.
const PR2_NUMERIC = [
  // TEAM_GAME_STATS_RATE_COLS -- NULL when the denominator is 0
  "epa_per_play",
  "success_rate",
  "first_down_rate",
  "pass_epa_per_play",
  "pass_success_rate",
  "pass_first_down_rate",
  "rush_epa_per_play",
  "rush_success_rate",
  "rush_first_down_rate",
  "early_epa_per_play",
  "early_success_rate",
  "late_epa_per_play",
  "late_success_rate",
  "explosive_rate",
  "yards_per_play",
  "yards_per_pass",
  "yards_per_rush",
  // TEAM_GAME_STATS_SUM_COLS -- EPA sums, 0.0 when the team had no such plays
  "epa_lost_turnovers",
  "epa_lost_sacks",
  "epa_lost_penalties",
];

beforeEach(() => {
  for (const k of Object.keys(results)) delete results[k];
  chains.length = 0;
  vi.mocked(getGame).mockReset();
  vi.mocked(getTeamSchedule).mockReset();
  vi.mocked(getTeamSchedule).mockImplementation(async (team: string) => scheduleFor(team as "BUF" | "HOU"));
  vi.mocked(getAvailableSeasons).mockReset();
  vi.mocked(getAvailableSeasons).mockResolvedValue([2026, 2025]);
});

describe("normalizeGameId", () => {
  it("accepts nflverse ids, upper-cases them, and rejects everything else", () => {
    expect(normalizeGameId("2026_01_BUF_HOU")).toBe("2026_01_BUF_HOU");
    expect(normalizeGameId("2026_01_buf_hou")).toBe("2026_01_BUF_HOU");
    expect(normalizeGameId(" 2025_14_PHI_LAC ")).toBe("2025_14_PHI_LAC");
    expect(normalizeGameId("2026_01_LA_SF")).toBe("2026_01_LA_SF");
    for (const bad of ["", "BUF", "2026-01-BUF-HOU", "2026_1_BUF_HOU", "2026_01_BUF_HOU; drop", "2026_01_BUF", null, undefined, "../etc"]) {
      expect(normalizeGameId(bad)).toBeNull();
    }
  });
});

describe("getBoxScoreSeasons", () => {
  it("probes each candidate with limit 1 and keeps the seasons that have rows, newest first", async () => {
    results.team_game_stats = (calls) =>
      calls.some((c) => c[0] === "eq" && c[1] === "season" && (c[2] === 2026 || c[2] === 2024))
        ? { data: [{ game_id: "2026_01_BUF_HOU" }], error: null }
        : { data: [], error: null };
    // Two covered seasons, given oldest first, pin the descending sort: an
    // unsorted or ascending implementation would answer [2024, 2026].
    expect(await getBoxScoreSeasons([2025, 2024, 2026])).toEqual([2026, 2024]);
    const probes = chainsFor("team_game_stats");
    expect(probes).toHaveLength(3);
    for (const p of probes) {
      expect(p.calls).toContainEqual(["select", "game_id"]);
      expect(p.calls).toContainEqual(["limit", 1]);
    }
  });

  it("dedupes and drops junk candidates; returns [] without a query for none", async () => {
    results.team_game_stats = { data: [{ game_id: "x" }], error: null };
    expect(await getBoxScoreSeasons([2026, 2026, NaN, 0, -1, 2025.5, "2024" as unknown as number])).toEqual([2026]);
    expect(chainsFor("team_game_stats")).toHaveLength(1);
    chains.length = 0;
    expect(await getBoxScoreSeasons([])).toEqual([]);
    expect(await getBoxScoreSeasons(undefined as unknown as number[])).toEqual([]);
    expect(chains).toHaveLength(0);
  });

  // Chaos DEGRADED 1: the drop was silent, so a data_freshness.season column
  // that ever arrived as text would take every box score link on the site dark
  // with nothing logged anywhere.
  it("logs the candidates it drops, naming the value and its type", async () => {
    const warned = vi.spyOn(console, "warn").mockImplementation(() => {});
    results.team_game_stats = { data: [{ game_id: "x" }], error: null };
    expect(await getBoxScoreSeasons(["2026" as unknown as number, NaN, 2025])).toEqual([2025]);
    expect(warned).toHaveBeenCalledTimes(1);
    const line = String(warned.mock.calls[0][0]);
    expect(line).toContain("2026");
    expect(line).toContain("string");
    warned.mockRestore();
  });

  it("logs nothing when every candidate is usable", async () => {
    const warned = vi.spyOn(console, "warn").mockImplementation(() => {});
    results.team_game_stats = { data: [{ game_id: "x" }], error: null };
    await getBoxScoreSeasons([2026, 2025]);
    await getBoxScoreSeasons([]);
    expect(warned).not.toHaveBeenCalled();
    warned.mockRestore();
  });

  it("throws on a query error", async () => {
    results.team_game_stats = { data: null, error: { message: "fetch failed" } };
    await expect(getBoxScoreSeasons([2026])).rejects.toThrow("Failed to fetch box score seasons: fetch failed");
  });
});

describe("TEAM_GAME_NUMERIC is the DDL's NUMERIC list, checked against an independent copy", () => {
  it("holds exactly the 20 NUMERIC columns scripts/ingest.py writes", () => {
    expect([...TEAM_GAME_NUMERIC].sort()).toEqual([...PR2_NUMERIC].sort());
    expect(PR2_NUMERIC).toHaveLength(20);
  });

  it("parses every NUMERIC column of a wire row built from the independent list", async () => {
    const row: Record<string, unknown> = { ...BUF_STATS };
    for (const col of PR2_NUMERIC) {
      const v = row[col];
      row[col] = v === null ? null : String(v);
    }
    results.team_game_stats = { data: [row], error: null };
    const [parsed] = await getTeamGameStats("2026_01_BUF_HOU");
    const out = parsed as unknown as Record<string, unknown>;
    for (const col of PR2_NUMERIC) {
      expect(typeof out[col], col + " is still a string: is it in TEAM_GAME_NUMERIC?").not.toBe("string");
    }
    expect(out.epa_per_play).toBeCloseTo(0.278, 6);
  });
});

describe("getTeamGameStats", () => {
  it("parses NUMERIC strings to numbers and NULL / 'NaN' to null", async () => {
    const hou = wireRow("HOU");
    hou.rush_epa_per_play = "NaN";
    hou.time_of_possession_seconds = null;
    results.team_game_stats = { data: [wireRow("BUF"), hou], error: null };
    const rows = await getTeamGameStats("2026_01_BUF_HOU");
    expect(rows).toHaveLength(2);
    expect(rows[0].epa_per_play).toBeCloseTo(0.278, 6);
    expect(rows[0].epa_lost_penalties).toBeCloseTo(-8.52, 6);
    expect(rows[0].plays).toBe(56);
    expect(rows[1].rush_epa_per_play).toBeNull();
    expect(rows[1].time_of_possession_seconds).toBeNull();
    expect(chainsFor("team_game_stats")[0].calls).toContainEqual(["eq", "game_id", "2026_01_BUF_HOU"]);
  });

  it("throws on a query error", async () => {
    results.team_game_stats = { data: null, error: { message: "boom" } };
    await expect(getTeamGameStats("2026_01_BUF_HOU")).rejects.toThrow("Failed to fetch team game stats for 2026_01_BUF_HOU: boom");
  });
});

describe("getGamePlayerLines", () => {
  it("reads the three weekly tables by season, week and both teams, then the players they name", async () => {
    results.qb_weekly_stats = { data: [{ player_id: "q1", team_id: "BUF", epa_per_dropback: "0.5557", rush_epa_per_carry: "-0.4626" }], error: null };
    results.receiver_weekly_stats = { data: [{ player_id: "r1", team_id: "HOU", epa_per_target: "NaN" }, { player_id: "q1", team_id: "BUF" }], error: null };
    results.rb_weekly_stats = { data: [{ player_id: "b1", team_id: "HOU", epa_per_carry: "0.16" }], error: null };
    results.player_slugs = {
      data: [
        { player_id: "q1", player_name: "Josh Allen", position: "QB", slug: "josh-allen" },
        { player_id: "b1", player_name: "Woody Marks", position: "RB", slug: null },
      ],
      error: null,
    };
    const lines = await getGamePlayerLines(2026, 1, ["BUF", "HOU"]);
    expect(lines.qbs[0].epa_per_dropback).toBeCloseTo(0.5557, 6);
    expect(lines.qbs[0].rush_epa_per_carry).toBeCloseTo(-0.4626, 6);
    expect(lines.receivers[0].epa_per_target).toBeNull();
    expect(lines.rbs[0].epa_per_carry).toBeCloseTo(0.16, 6);
    expect(lines.players).toEqual({
      q1: { player_id: "q1", player_name: "Josh Allen", position: "QB", slug: "josh-allen" },
      b1: { player_id: "b1", player_name: "Woody Marks", position: "RB", slug: null },
    });
    for (const table of ["qb_weekly_stats", "receiver_weekly_stats", "rb_weekly_stats"]) {
      const calls = chainsFor(table)[0].calls;
      expect(calls).toContainEqual(["eq", "season", 2026]);
      expect(calls).toContainEqual(["eq", "week", 1]);
      expect(calls).toContainEqual(["in", "team_id", ["BUF", "HOU"]]);
    }
    const slugCalls = chainsFor("player_slugs")[0].calls;
    expect(slugCalls).toContainEqual(["select", "player_id, player_name, position, slug"]);
    expect(slugCalls.find((c) => c[0] === "in")?.[2]).toEqual(["q1", "r1", "b1"]);
  });

  it("skips the player_slugs read when no row names a player", async () => {
    const lines = await getGamePlayerLines(2026, 1, ["BUF", "HOU"]);
    expect(lines).toEqual({ qbs: [], receivers: [], rbs: [], players: {} });
    expect(chainsFor("player_slugs")).toHaveLength(0);
  });

  it("throws when a weekly read or the slug read fails", async () => {
    results.rb_weekly_stats = { data: null, error: { message: "rb down" } };
    await expect(getGamePlayerLines(2026, 1, ["BUF", "HOU"])).rejects.toThrow("Failed to fetch rb_weekly_stats for 2026 week 1: rb down");
    delete results.rb_weekly_stats;
    results.qb_weekly_stats = { data: [{ player_id: "q1", team_id: "BUF" }], error: null };
    results.player_slugs = { data: null, error: { message: "slugs down" } };
    await expect(getGamePlayerLines(2026, 1, ["BUF", "HOU"])).rejects.toThrow("Failed to fetch player identities: slugs down");
  });
});

describe("getBoxScore", () => {
  const ready = () => {
    vi.mocked(getGame).mockResolvedValue(BUF_HOU_GAME);
    results.team_game_stats = (calls) =>
      calls.some((c) => c[0] === "limit")
        ? { data: [{ game_id: "2026_01_BUF_HOU" }], error: null }
        // Home row first, on purpose: the query has no .order(), so PostgREST
        // row order is arbitrary and the rows must be matched by team_id.
        : { data: [wireRow("HOU"), wireRow("BUF")], error: null };
    results.qb_weekly_stats = { data: [{ player_id: "q1", team_id: "BUF" }], error: null };
    results.player_slugs = { data: [{ player_id: "q1", player_name: "Josh Allen", position: "QB", slug: "josh-allen" }], error: null };
  };

  it("unknown id → not-found; no schedule or stats reads", async () => {
    vi.mocked(getGame).mockResolvedValue(null);
    expect(await getBoxScore("2026_01_XXX_YYY")).toEqual({ state: "not-found" });
    expect(getTeamSchedule).not.toHaveBeenCalled();
    expect(chains).toHaveLength(0);
  });

  it("no final score → unplayed, carrying the game; one missing score is enough", async () => {
    vi.mocked(getGame).mockResolvedValue({ ...BUF_HOU_GAME, home_score: null, away_score: null });
    const out = await getBoxScore("2026_01_BUF_HOU");
    expect(out).toMatchObject({ state: "unplayed", game: { game_id: "2026_01_BUF_HOU" } });
    // A half-written schedules ingest leaves one score null; that is not played.
    vi.mocked(getGame).mockResolvedValue({ ...BUF_HOU_GAME, away_score: null });
    expect((await getBoxScore("2026_01_BUF_HOU")).state).toBe("unplayed");
    vi.mocked(getGame).mockResolvedValue({ ...BUF_HOU_GAME, home_score: null });
    expect((await getBoxScore("2026_01_BUF_HOU")).state).toBe("unplayed");
    expect(chains).toHaveLength(0);
  });

  it("ready: both rows, records through the week, player lines", async () => {
    ready();
    const out = await getBoxScore("2026_01_BUF_HOU");
    expect(out.state).toBe("ready");
    if (out.state !== "ready") return;
    expect(out.game).toEqual(BUF_HOU_GAME);
    expect(out.records).toEqual({ away: { wins: 1, losses: 0, ties: 0 }, home: { wins: 0, losses: 1, ties: 0 } });
    expect(out.away.team_id).toBe("BUF");
    expect(out.home.team_id).toBe("HOU");
    expect(out.away.epa_per_play).toBeCloseTo(0.278, 6);
    expect(out.lines.qbs).toHaveLength(1);
    expect(out.lines.players.q1.slug).toBe("josh-allen");
    expect(getTeamSchedule).toHaveBeenCalledWith("BUF", 2026, expect.any(AbortSignal));
    expect(getTeamSchedule).toHaveBeenCalledWith("HOU", 2026, expect.any(AbortSignal));
    // No coverage probe was needed.
    expect(chainsFor("team_game_stats")).toHaveLength(1);
    expect(getAvailableSeasons).not.toHaveBeenCalled();
  });

  // Spec §6: the player rows come from the `games` row's season and week,
  // never by parsing the address. Nothing pinned that — deriving either from
  // `gameId` instead would have left every test in this file green, because
  // the fixture's row agrees with its own id. The companion case below makes
  // them disagree, which is what makes this pair discriminating.
  it("reads the player lines with the games row's own season and week (spec §6)", async () => {
    ready();
    await getBoxScore("2026_01_BUF_HOU");
    for (const table of ["qb_weekly_stats", "receiver_weekly_stats", "rb_weekly_stats"]) {
      const calls = chainsFor(table)[0].calls;
      expect(calls).toContainEqual(["eq", "season", 2026]);
      expect(calls).toContainEqual(["eq", "week", 1]);
    }
  });

  it("prefers the games row over the id when the two disagree", async () => {
    ready();
    vi.mocked(getGame).mockResolvedValue({ ...BUF_HOU_GAME, season: 2025, week: 5 });
    await getBoxScore("2026_01_BUF_HOU");
    const calls = chainsFor("qb_weekly_stats")[0].calls;
    expect(calls).toContainEqual(["eq", "season", 2025]);
    expect(calls).toContainEqual(["eq", "week", 5]);
    expect(calls).not.toContainEqual(["eq", "season", 2026]);
    expect(calls).not.toContainEqual(["eq", "week", 1]);
  });

  it("played 2025 game before the backfill → uncovered, naming the first covered season", async () => {
    vi.mocked(getGame).mockResolvedValue({ ...BUF_HOU_GAME, game_id: "2025_14_PHI_LAC", season: 2025, week: 14, away_team: "PHI", home_team: "LAC", away_score: 19, home_score: 22 });
    results.team_game_stats = (calls) =>
      calls.some((c) => c[0] === "eq" && c[1] === "season" && c[2] === 2026)
        ? { data: [{ game_id: "2026_01_BUF_HOU" }], error: null }
        : { data: [], error: null };
    const out = await getBoxScore("2025_14_PHI_LAC");
    expect(out).toMatchObject({ state: "uncovered", reason: "season", firstSeason: 2026 });
    expect(getAvailableSeasons).toHaveBeenCalledTimes(1);
  });

  it("played, covered season, rows not written yet → pending (also when only one team's row exists)", async () => {
    vi.mocked(getGame).mockResolvedValue(BUF_HOU_GAME);
    results.team_game_stats = (calls) =>
      calls.some((c) => c[0] === "limit") ? { data: [{ game_id: "2026_01_NE_SEA" }], error: null } : { data: [], error: null };
    expect((await getBoxScore("2026_01_BUF_HOU")).state).toBe("pending");
    results.team_game_stats = (calls) =>
      calls.some((c) => c[0] === "limit") ? { data: [{ game_id: "2026_01_NE_SEA" }], error: null } : { data: [wireRow("BUF")], error: null };
    expect((await getBoxScore("2026_01_BUF_HOU")).state).toBe("pending");
  });

  it("one game with no rows, in a season that has them → pending, settled by its own season's probe", async () => {
    vi.mocked(getGame).mockResolvedValue(BUF_HOU_GAME);
    results.team_game_stats = (calls) =>
      calls.some((c) => c[0] === "limit") ? { data: [{ game_id: "2026_01_NE_SEA" }], error: null } : { data: [], error: null };
    expect((await getBoxScore("2026_01_BUF_HOU")).state).toBe("pending");
    // The game's own season answers it: the game's rows, then one probe. No
    // data_freshness read and no probe of the other seasons.
    expect(chainsFor("team_game_stats")).toHaveLength(2);
    expect(getAvailableSeasons).not.toHaveBeenCalled();
  });

  // Behaviour change (review IMPORTANT-2). This used to return "pending", which
  // was right only before PR 2's first refresh, when no season had rows yet.
  // Production now holds team_game_stats rows, so every probe coming back empty
  // means the read is broken (a dropped read policy, a renamed table, a bad
  // key) and PostgREST reports exactly that as 200-with-no-rows. Spec §6: a
  // failed read throws, so ISR keeps the last good copy instead of caching
  // "stats arrive shortly" on every game page in every season.
  it("data_freshness lists seasons but no season has rows → throws instead of pending", async () => {
    vi.mocked(getGame).mockResolvedValue(BUF_HOU_GAME);
    results.team_game_stats = { data: [], error: null };
    await expect(getBoxScore("2026_01_BUF_HOU")).rejects.toThrow(/none has a team_game_stats row/);
  });

  it("a season inside the covered range with no rows of its own → uncovered, not pending", async () => {
    vi.mocked(getGame).mockResolvedValue({ ...BUF_HOU_GAME, game_id: "2025_14_PHI_LAC", season: 2025, week: 14, away_team: "PHI", home_team: "LAC", away_score: 19, home_score: 22 });
    vi.mocked(getAvailableSeasons).mockResolvedValue([2026, 2025, 2024]);
    results.team_game_stats = (calls) =>
      calls.some((c) => c[0] === "eq" && c[1] === "season" && c[2] === 2025)
        ? { data: [], error: null }
        : calls.some((c) => c[0] === "limit")
          ? { data: [{ game_id: "x" }], error: null }
          : { data: [], error: null };
    // uncovered is the state; the first covered season is 2024, which is
    // BEFORE this game, so naming it would print "Box scores start with the
    // 2024 season" over a 2025 game. null, and the page's neutral heading.
    expect(await getBoxScore("2025_14_PHI_LAC")).toMatchObject({ state: "uncovered", reason: "season", firstSeason: null });
  });

  it("a non-contiguous backfill: the gap year names no season, a genuinely older game names 2020", async () => {
    // 2020-2024 and 2026 covered, 2025 not. "Box scores start with the 2020
    // season" over a 2025 game is false on its own screen -- 2025 is AFTER
    // 2020 -- and the only thing a visitor takes from it ("this game is too
    // old") is wrong. Name a first season only when the game really precedes
    // it; the page already has a neutral heading for null.
    const COVERED = [2026, 2024, 2023, 2022, 2021, 2020];
    const backfill = (calls: unknown[][]) => {
      const seasonCall = calls.find((c) => c[0] === "eq" && c[1] === "season");
      const isProbe = seasonCall !== undefined && calls.some((c) => c[0] === "limit");
      if (!isProbe) return { data: [], error: null };
      return COVERED.includes(seasonCall![2] as number)
        ? { data: [{ game_id: "x" }], error: null }
        : { data: [], error: null };
    };
    vi.mocked(getAvailableSeasons).mockResolvedValue([2026, 2025, 2024, 2023, 2022, 2021, 2020]);
    results.team_game_stats = backfill;

    vi.mocked(getGame).mockResolvedValue({ ...BUF_HOU_GAME, game_id: "2025_14_PHI_LAC", season: 2025, week: 14, away_team: "PHI", home_team: "LAC", away_score: 19, home_score: 22 });
    expect(await getBoxScore("2025_14_PHI_LAC")).toMatchObject({ state: "uncovered", reason: "season", firstSeason: null });

    // A 2019 game really is before the backfill, so naming 2020 is true and
    // useful. firstSeason is the EARLIEST covered season; Math.max would say 2026.
    vi.mocked(getGame).mockResolvedValue({ ...BUF_HOU_GAME, game_id: "2019_14_PHI_LAC", season: 2019, week: 14, away_team: "PHI", home_team: "LAC", away_score: 19, home_score: 22 });
    expect(await getBoxScore("2019_14_PHI_LAC")).toMatchObject({ state: "uncovered", reason: "season", firstSeason: 2020 });
  });

  it("a season newer than every covered one → pending (the ingest has not reached it yet)", async () => {
    vi.mocked(getGame).mockResolvedValue({ ...BUF_HOU_GAME, game_id: "2027_01_BUF_HOU", season: 2027 });
    vi.mocked(getAvailableSeasons).mockResolvedValue([2026, 2025]);
    results.team_game_stats = (calls) =>
      calls.some((c) => c[0] === "eq" && c[1] === "season" && c[2] === 2026)
        ? { data: [{ game_id: "x" }], error: null }
        : { data: [], error: null };
    expect((await getBoxScore("2027_01_BUF_HOU")).state).toBe("pending");
  });

  it("logs a half-written game instead of silently promising stats that are not coming", async () => {
    // The ingest upserts both teams together, so ONE row means the aggregation
    // already ran and produced something corrupt (or a team id no longer
    // matches after a relocation). The page then says "stats arrive ... within
    // a few hours" forever, and nothing anywhere records why.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.mocked(getGame).mockResolvedValue(BUF_HOU_GAME);
    results.team_game_stats = (calls) =>
      calls.some((c) => c[0] === "limit")
        ? { data: [{ game_id: "x" }], error: null }
        : { data: [wireRow("BUF")], error: null };
    expect((await getBoxScore("2026_01_BUF_HOU")).state).toBe("pending");
    const logged = warn.mock.calls.map((c) => c.join(" ")).join(" | ");
    expect(logged).toContain("2026_01_BUF_HOU");
    expect(logged).toContain("HOU");
    warn.mockRestore();
  });

  it("playoff game → uncovered / playoffs with the regular-season records", async () => {
    vi.mocked(getGame).mockResolvedValue({ ...BUF_HOU_GAME, game_id: "2026_19_BUF_HOU", game_type: "WC", week: 19 });
    const out = await getBoxScore("2026_19_BUF_HOU");
    expect(out).toMatchObject({ state: "uncovered", reason: "playoffs", firstSeason: null, records: { away: { wins: 1 } } });
  });

  // Chaos ERROR 2: an empty or lower-case game_type read as a playoff game here
  // while the scoreboard band above it read "WEEK 1" — the page contradicted
  // itself on one screen. One rule now, shared with gameLabel and the gates.
  it("an empty, blank or lower-case game_type is a regular-season game, not a playoff", async () => {
    for (const raw of ["", "   ", "reg", "Reg"]) {
      ready();
      vi.mocked(getGame).mockResolvedValue({ ...BUF_HOU_GAME, game_type: raw });
      expect((await getBoxScore("2026_01_BUF_HOU")).state).toBe("ready");
    }
    ready();
    vi.mocked(getGame).mockResolvedValue({ ...BUF_HOU_GAME, game_type: "wc" });
    expect(await getBoxScore("2026_01_BUF_HOU")).toMatchObject({ state: "uncovered", reason: "playoffs" });
  });

  // Chaos ERROR 5: .find matched the same row for both sides, so the page
  // rendered one team against itself with duplicate React keys and a footnote
  // that repeated its own sentence.
  it("home_team === away_team → not-found, with no further reads", async () => {
    vi.mocked(getGame).mockResolvedValue({ ...BUF_HOU_GAME, home_team: "BUF" });
    expect(await getBoxScore("2026_01_BUF_HOU")).toEqual({ state: "not-found" });
    expect(getTeamSchedule).not.toHaveBeenCalled();
    expect(chains).toHaveLength(0);
    expect(getAvailableSeasons).not.toHaveBeenCalled();
  });

  it("throws when a protected read fails: schedule, stats rows, seasons list", async () => {
    vi.mocked(getGame).mockResolvedValue(BUF_HOU_GAME);
    vi.mocked(getTeamSchedule).mockRejectedValue(new Error("Failed to fetch schedule: fetch failed"));
    await expect(getBoxScore("2026_01_BUF_HOU")).rejects.toThrow("Failed to fetch schedule");

    vi.mocked(getTeamSchedule).mockImplementation(async (team: string) => scheduleFor(team as "BUF" | "HOU"));
    results.team_game_stats = { data: null, error: { message: "tgs down" } };
    await expect(getBoxScore("2026_01_BUF_HOU")).rejects.toThrow("tgs down");

    results.team_game_stats = { data: [], error: null };
    vi.mocked(getAvailableSeasons).mockResolvedValue([]);
    await expect(getBoxScore("2026_01_BUF_HOU")).rejects.toThrow("no seasons from data_freshness");

    vi.mocked(getGame).mockRejectedValue(new Error("Failed to fetch game 2026_01_BUF_HOU: down"));
    await expect(getBoxScore("2026_01_BUF_HOU")).rejects.toThrow("Failed to fetch game");
  });

  it("records ignore the schedule's unplayed and later games", async () => {
    ready();
    const later: TeamGame[] = [...scheduleFor("BUF"), { ...scheduleFor("BUF")[0], game_id: "2026_03_BUF_LAC", week: 3, result: "L", team_score: 10, opponent_score: 20 }];
    vi.mocked(getTeamSchedule).mockImplementation(async (team: string) => (team === "BUF" ? later : scheduleFor("HOU")));
    const out = await getBoxScore("2026_01_BUF_HOU");
    expect(out.state === "ready" && out.records.away).toEqual({ wins: 1, losses: 0, ties: 0 });
  });
});

describe("getBoxScoreSeasonsCached — the link gate's hourly memo", () => {
  // Date.now is stubbed rather than faking timers, so the promises in the fake
  // Supabase client still settle normally.
  let now = 1700000000000;

  beforeEach(() => {
    // Start each test more than a window past the last, so whatever the
    // module-scope memo holds from an earlier test is already stale.
    now += 2 * 60 * 60 * 1000;
    vi.spyOn(Date, "now").mockImplementation(() => now);
  });

  it("answers from the memo inside the hour and probes again once it expires", async () => {
    results.team_game_stats = { data: [{ game_id: "x" }], error: null };
    expect(await getBoxScoreSeasonsCached([2026, 2025])).toEqual([2026, 2025]);
    expect(chainsFor("team_game_stats")).toHaveLength(2);

    now += 59 * 60 * 1000;
    expect(await getBoxScoreSeasonsCached([2026, 2025])).toEqual([2026, 2025]);
    expect(chainsFor("team_game_stats")).toHaveLength(2);

    now += 2 * 60 * 1000;
    expect(await getBoxScoreSeasonsCached([2026, 2025])).toEqual([2026, 2025]);
    expect(chainsFor("team_game_stats")).toHaveLength(4);
  });

  it("keys on the candidate list, so one list never reads another's answer", async () => {
    results.team_game_stats = (calls) =>
      calls.some((c) => c[0] === "eq" && c[1] === "season" && c[2] === 2026)
        ? { data: [{ game_id: "x" }], error: null }
        : { data: [], error: null };
    expect(await getBoxScoreSeasonsCached([2026])).toEqual([2026]);
    expect(await getBoxScoreSeasonsCached([2024])).toEqual([]);
    // Each is memoised under its own key; neither re-probes, and [2024] never
    // reads [2026]'s answer.
    expect(await getBoxScoreSeasonsCached([2026])).toEqual([2026]);
    expect(await getBoxScoreSeasonsCached([2024])).toEqual([]);
    expect(chainsFor("team_game_stats")).toHaveLength(2);
  });

  it("never memoises a rejection: it reaches the caller and the next call retries", async () => {
    results.team_game_stats = { data: null, error: { message: "fetch failed" } };
    await expect(getBoxScoreSeasonsCached([2023])).rejects.toThrow(
      "Failed to fetch box score seasons: fetch failed"
    );
    results.team_game_stats = { data: [{ game_id: "x" }], error: null };
    expect(await getBoxScoreSeasonsCached([2023])).toEqual([2023]);
  });

  it("hands out a copy, so a caller cannot mutate the cached answer", async () => {
    results.team_game_stats = { data: [{ game_id: "x" }], error: null };
    // The first call is the miss path, and the value it returns is the one
    // that was just stored: mutating it must not reach the memo.
    const first = await getBoxScoreSeasonsCached([2026, 2025]);
    expect(first).toEqual([2026, 2025]);
    first.push(1999);
    first.sort((a, b) => a - b);
    // Same hour, same key: the hit path, still answering the memo's own value.
    const second = await getBoxScoreSeasonsCached([2026, 2025]);
    expect(second).toEqual([2026, 2025]);
    expect(second).not.toBe(first);
    // Two hits never share one instance either.
    const third = await getBoxScoreSeasonsCached([2026, 2025]);
    expect(third).not.toBe(second);
    expect(chainsFor("team_game_stats")).toHaveLength(2);
  });

  it("de-duplicates concurrent misses: 20 cold views cost one probe per season, not 20", async () => {
    // The value was awaited and only THEN stored, deliberately, so a rejection
    // could never be memoised -- right goal, wrong mechanism. Nothing was
    // recorded while the probe was in flight, so every request arriving in
    // that window was a miss and fired its own seasons.length parallel
    // limit(1) queries: on a cold lambda, or at the instant the hour rolls
    // over, 20 concurrent team-page views cost 20 x 7 = 140 PostgREST requests
    // for 7 answers, on the route the memo exists to make cheap.
    results.team_game_stats = { data: [{ game_id: "x" }], error: null };
    const all = await Promise.all(
      Array.from({ length: 20 }, () => getBoxScoreSeasonsCached([2026, 2025]))
    );
    expect(chainsFor("team_game_stats")).toHaveLength(2);
    for (const a of all) expect(a).toEqual([2026, 2025]);
    // ...and every caller still gets its own copy, in flight or not.
    expect(all[0]).not.toBe(all[1]);
  });

  it("deletes an in-flight entry that rejects, so a rejection is still never memoised", async () => {
    results.team_game_stats = { data: null, error: { message: "fetch failed" } };
    const settled = await Promise.allSettled([
      getBoxScoreSeasonsCached([2022]),
      getBoxScoreSeasonsCached([2022]),
    ]);
    expect(settled.map((s) => s.status)).toEqual(["rejected", "rejected"]);
    results.team_game_stats = { data: [{ game_id: "x" }], error: null };
    expect(await getBoxScoreSeasonsCached([2022])).toEqual([2022]);
  });

  it("is not used by getBoxScore's own pending-vs-uncovered probe", async () => {
    // Memoise "2026 is covered", then take the rows away. getBoxScore's own
    // probe has to read live: were it memoised it would answer "pending".
    results.team_game_stats = { data: [{ game_id: "x" }], error: null };
    expect(await getBoxScoreSeasonsCached([2026])).toEqual([2026]);
    results.team_game_stats = { data: [], error: null };
    vi.mocked(getGame).mockResolvedValue(BUF_HOU_GAME);
    chains.length = 0;
    await expect(getBoxScore("2026_01_BUF_HOU")).rejects.toThrow(
      "none has a team_game_stats row"
    );
    expect(chainsFor("team_game_stats").length).toBeGreaterThan(1);
  });
});

describe("read deadlines -- a slow database must reach error.tsx, not a Vercel 504", () => {
  it("gives every read of one box score the same deadline", async () => {
    // Nothing on this page had one. A `ready` view is 8 PostgREST requests in
    // 4 serial waves and there is deliberately no loading.tsx, so TTFB IS the
    // whole chain: a merely slow Supabase (not a failed one) ran past the
    // function limit and the invocation was killed. error.tsx only catches
    // throws from INSIDE the invocation, so the one failure mode this PR built
    // an error boundary for was the one it could not see.
    vi.mocked(getGame).mockResolvedValue(BUF_HOU_GAME);
    results.team_game_stats = { data: [wireRow("HOU"), wireRow("BUF")], error: null };
    results.qb_weekly_stats = { data: [{ player_id: "q1", team_id: "BUF" }], error: null };
    results.player_slugs = { data: [], error: null };
    expect((await getBoxScore("2026_01_BUF_HOU")).state).toBe("ready");

    const signals = signalsUsed();
    expect(signals.length).toBeGreaterThan(3);
    for (const s of signals) expect(s).toBeInstanceOf(AbortSignal);
    // ONE budget for the whole assembly, not one per request: the chain is 4
    // serial waves, so per-request deadlines multiply and 4 x the budget is
    // exactly what overruns the platform limit.
    expect(new Set(signals).size).toBe(1);
    // The two reads that live in lib/data/games.ts are on the same critical
    // path (waves 1 and 2) and take the same deadline.
    expect(getGame).toHaveBeenCalledWith("2026_01_BUF_HOU", signals[0]);
    expect(getTeamSchedule).toHaveBeenCalledWith("BUF", 2026, signals[0]);
  });

  it("turns a read past the deadline into a thrown error, never a hang", async () => {
    vi.mocked(getGame).mockResolvedValue(BUF_HOU_GAME);
    // supabase-js turns an aborted fetch into a PostgREST-shaped error rather
    // than a rejection (postgrest-js, PostgrestBuilder.then's catch), so this
    // is exactly what a timed-out read looks like from here. The existing
    // rethrow in the page then hands it to error.tsx.
    results.team_game_stats = {
      data: null,
      error: { message: "TimeoutError: The operation was aborted due to timeout" },
    };
    await expect(getBoxScore("2026_01_BUF_HOU")).rejects.toThrow("The operation was aborted");
  });

  it("budgets the assembly comfortably inside Vercel's default function limit", () => {
    // Vercel's Node default is 10s (Hobby) / 15s (Pro). The budget has to leave
    // room for cold start, render and response on top of it.
    expect(BOX_SCORE_READ_DEADLINE_MS).toBeGreaterThanOrEqual(3000);
    expect(BOX_SCORE_READ_DEADLINE_MS).toBeLessThanOrEqual(6000);
  });

  it("gives the link gate's own probe a deadline too", async () => {
    results.team_game_stats = { data: [{ game_id: "x" }], error: null };
    await getBoxScoreSeasons([2026, 2025]);
    const signals = signalsUsed();
    expect(signals).toHaveLength(2);
    for (const s of signals) expect(s).toBeInstanceOf(AbortSignal);
  });
});

describe("getBoxScoreMeta -- the cheap path generateMetadata needs", () => {
  it("reads the games row and the stat rows, and nothing else", async () => {
    // generateMetadata only ever used the `games` row and the coverage verdict,
    // yet it paid for both team schedules, both stat rows, three weekly tables
    // and player_slugs -- the whole 8-request assembly, a second time, on a
    // route that renders per request.
    vi.mocked(getGame).mockResolvedValue(BUF_HOU_GAME);
    results.team_game_stats = { data: [wireRow("HOU"), wireRow("BUF")], error: null };
    expect(await getBoxScoreMeta("2026_01_BUF_HOU")).toEqual({ game: BUF_HOU_GAME, ready: true });
    expect(getTeamSchedule).not.toHaveBeenCalled();
    expect(getAvailableSeasons).not.toHaveBeenCalled();
    expect(chains.map((c) => c.table)).toEqual(["team_game_stats"]);
    expect(getGame).toHaveBeenCalledWith("2026_01_BUF_HOU", expect.any(AbortSignal));
  });

  it("has no page for an unknown id, an unplayed game, or a team playing itself", async () => {
    vi.mocked(getGame).mockResolvedValue(null);
    expect(await getBoxScoreMeta("2026_01_BUF_HOU")).toEqual({ game: null, ready: false });
    expect(chains).toHaveLength(0);

    vi.mocked(getGame).mockResolvedValue({ ...BUF_HOU_GAME, home_score: null });
    expect(await getBoxScoreMeta("2026_01_BUF_HOU")).toEqual({ game: null, ready: false });

    vi.mocked(getGame).mockResolvedValue({ ...BUF_HOU_GAME, home_team: "BUF" });
    expect(await getBoxScoreMeta("2026_01_BUF_HOU")).toEqual({ game: null, ready: false });
    expect(chains).toHaveLength(0);
  });

  it("is not ready for a playoff game, and asks the database nothing more about it", async () => {
    vi.mocked(getGame).mockResolvedValue({ ...BUF_HOU_GAME, game_id: "2026_19_BUF_HOU", game_type: "WC", week: 19 });
    const meta = await getBoxScoreMeta("2026_19_BUF_HOU");
    expect(meta.ready).toBe(false);
    expect(meta.game).not.toBeNull();
    expect(chains).toHaveLength(0);
  });

  it("is not ready when a team's row is missing -- pending and uncovered are both noindex", async () => {
    vi.mocked(getGame).mockResolvedValue(BUF_HOU_GAME);
    results.team_game_stats = { data: [wireRow("BUF")], error: null };
    expect(await getBoxScoreMeta("2026_01_BUF_HOU")).toMatchObject({ ready: false });
    results.team_game_stats = { data: [], error: null };
    expect(await getBoxScoreMeta("2026_01_BUF_HOU")).toMatchObject({ ready: false });
  });

  it("answers the same question getBoxScore answers, so the two cannot drift", async () => {
    // Two implementations of "does this address have a page, and is it ready?"
    // is how a cheap path goes wrong. Same inputs, same verdict.
    const ready = () => {
      vi.mocked(getGame).mockResolvedValue(BUF_HOU_GAME);
      results.team_game_stats = (calls) =>
        calls.some((c) => c[0] === "limit")
          ? { data: [{ game_id: "2026_01_BUF_HOU" }], error: null }
          : { data: [wireRow("HOU"), wireRow("BUF")], error: null };
      results.qb_weekly_stats = { data: [], error: null };
    };
    ready();
    expect((await getBoxScore("2026_01_BUF_HOU")).state).toBe("ready");
    expect((await getBoxScoreMeta("2026_01_BUF_HOU")).ready).toBe(true);

    // pending: the season has rows, this game's are not written yet.
    vi.mocked(getGame).mockResolvedValue(BUF_HOU_GAME);
    results.team_game_stats = (calls) =>
      calls.some((c) => c[0] === "limit")
        ? { data: [{ game_id: "2026_01_NE_SEA" }], error: null }
        : { data: [], error: null };
    expect((await getBoxScore("2026_01_BUF_HOU")).state).toBe("pending");
    expect((await getBoxScoreMeta("2026_01_BUF_HOU")).ready).toBe(false);

    // no page at all
    vi.mocked(getGame).mockResolvedValue(null);
    expect((await getBoxScore("2026_01_BUF_HOU")).state).toBe("not-found");
    expect((await getBoxScoreMeta("2026_01_BUF_HOU")).game).toBeNull();
  });

  it("throws on a failed read, exactly as getBoxScore does", async () => {
    vi.mocked(getGame).mockResolvedValue(BUF_HOU_GAME);
    results.team_game_stats = { data: null, error: { message: "fetch failed" } };
    await expect(getBoxScoreMeta("2026_01_BUF_HOU")).rejects.toThrow("Failed to fetch team game stats");
  });
});
