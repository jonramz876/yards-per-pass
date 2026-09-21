import { describe, it, expect, beforeEach, vi } from "vitest";

// Chainable fake Supabase client (same pattern as __tests__/data/card.test.ts):
// records the query chain and resolves a settable result.
const calls: unknown[][] = [];
let result: { data: unknown; error: unknown } = { data: [], error: null };

vi.mock("@/lib/supabase/server", () => {
  const builder: Record<string, unknown> = {};
  for (const m of ["select", "eq", "or", "order", "limit", "range"]) {
    builder[m] = (...a: unknown[]) => {
      calls.push([m, ...a]);
      return builder;
    };
  }
  builder.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
    Promise.resolve(result).then(res, rej);
  return {
    createServerClient: () => ({
      from: (t: string) => {
        calls.push(["from", t]);
        return builder;
      },
    }),
  };
});

import { getGameResults, getGame, getPlayedRegularSeasonGameIds } from "@/lib/data/games";

/** A `games` row as PostgREST returns it (defaults: 2025 week 1, BAL 40 @ BUF 41). */
function game(over: Record<string, unknown>) {
  return {
    game_id: "2025_01_BAL_BUF",
    season: 2025,
    game_type: "REG",
    week: 1,
    gameday: "2025-09-07",
    weekday: "Sunday",
    gametime: "20:20",
    home_team: "BUF",
    away_team: "BAL",
    home_score: 41,
    away_score: 40,
    ...over,
  };
}

beforeEach(() => {
  calls.length = 0;
  result = { data: [], error: null };
});

describe("getGameResults", () => {
  it("keys each requested team's result by team, then week, from that team's side", async () => {
    result = { data: [game({})], error: null };
    const out = await getGameResults(["BUF", "BAL"], 2025);
    expect(out.BUF[1]).toEqual({
      game_id: "2025_01_BAL_BUF",
      team_score: 41,
      opponent_score: 40,
      result: "W",
      opponent_id: "BAL",
    });
    expect(out.BAL[1]).toEqual({
      game_id: "2025_01_BAL_BUF",
      team_score: 40,
      opponent_score: 41,
      result: "L",
      opponent_id: "BUF",
    });
  });

  it("leaves out an opponent that wasn't requested", async () => {
    result = { data: [game({})], error: null };
    const out = await getGameResults(["BUF"], 2025);
    expect(Object.keys(out)).toEqual(["BUF"]);
  });

  it("covers every team a traded player played for", async () => {
    // Tyler Lockett, 2025: TEN through week 7, LV from week 9. Both teams played week 5.
    result = {
      data: [
        game({ game_id: "2025_05_TEN_ARI", week: 5, home_team: "ARI", away_team: "TEN", home_score: 21, away_score: 22 }),
        game({ game_id: "2025_05_LV_IND", week: 5, home_team: "IND", away_team: "LV", home_score: 40, away_score: 6 }),
        game({ game_id: "2025_14_DEN_LV", week: 14, home_team: "LV", away_team: "DEN", home_score: 17, away_score: 24 }),
      ],
      error: null,
    };
    const out = await getGameResults(["TEN", "LV"], 2025);
    expect(out.TEN[5]).toMatchObject({ game_id: "2025_05_TEN_ARI", result: "W", team_score: 22, opponent_score: 21 });
    expect(out.LV[5]).toMatchObject({ game_id: "2025_05_LV_IND", result: "L", team_score: 6, opponent_score: 40 });
    expect(out.LV[14]).toMatchObject({ game_id: "2025_14_DEN_LV", result: "L", team_score: 17, opponent_score: 24 });
  });

  it("reads a tie as T", async () => {
    result = {
      data: [game({ game_id: "2025_04_GB_DAL", week: 4, home_team: "DAL", away_team: "GB", home_score: 40, away_score: 40 })],
      error: null,
    };
    const out = await getGameResults(["DAL"], 2025);
    expect(out.DAL[4]).toMatchObject({ result: "T", team_score: 40, opponent_score: 40, opponent_id: "GB" });
  });

  it("skips games without both scores", async () => {
    result = {
      data: [
        game({ home_score: null, away_score: null }),
        game({ game_id: "2025_02_BUF_NYJ", week: 2, home_score: 30, away_score: null }),
      ],
      error: null,
    };
    expect(await getGameResults(["BUF"], 2025)).toEqual({});
  });

  it("skips playoff games (weekly stat rows are regular season only)", async () => {
    result = { data: [game({ game_id: "2025_19_BUF_JAX", game_type: "WC", week: 19 })], error: null };
    expect(await getGameResults(["BUF"], 2025)).toEqual({});
  });

  it("treats a missing game_type as regular season, like getTeamSchedule", async () => {
    result = { data: [game({ game_type: null })], error: null };
    const out = await getGameResults(["BUF"], 2025);
    expect(out.BUF[1]).toMatchObject({ result: "W" });
  });

  it("filters by season and both sides, with ids deduped and reduced to letters and digits", async () => {
    await getGameResults(["BUF", "KC", "BUF", "N.E)"], 2025);
    expect(calls).toContainEqual(["from", "games"]);
    expect(calls).toContainEqual(["eq", "season", 2025]);
    expect(calls).toContainEqual(["or", "home_team.in.(BUF,KC,NE),away_team.in.(BUF,KC,NE)"]);
  });

  it("returns {} without querying when no usable team id is given", async () => {
    expect(await getGameResults([], 2025)).toEqual({});
    expect(await getGameResults(["", "()"], 2025)).toEqual({});
    expect(calls).toHaveLength(0);
  });

  it("throws on a query error so the caller chooses the fallback", async () => {
    result = { data: null, error: { message: "fetch failed" } };
    await expect(getGameResults(["BUF"], 2025)).rejects.toThrow("Failed to fetch game results: fetch failed");
  });
});

describe("getGame (box score spec §6)", () => {
  it("returns the row for one game id with parsed scores, filtering by game_id with limit 1", async () => {
    result = { data: [game({ home_score: "31", away_score: 36 })], error: null };
    const out = await getGame("2025_01_BAL_BUF");
    expect(out).toEqual({
      game_id: "2025_01_BAL_BUF", season: 2025, game_type: "REG", week: 1, gameday: "2025-09-07",
      weekday: "Sunday", gametime: "20:20", home_team: "BUF", away_team: "BAL", home_score: 31, away_score: 36,
    });
    expect(calls).toContainEqual(["from", "games"]);
    expect(calls).toContainEqual(["eq", "game_id", "2025_01_BAL_BUF"]);
    expect(calls).toContainEqual(["limit", 1]);
  });

  it("keeps null scores for an unplayed game and reads a missing game_type as REG", async () => {
    result = { data: [game({ home_score: null, away_score: null, game_type: null, gametime: null })], error: null };
    const out = await getGame("2025_01_BAL_BUF");
    expect(out).toMatchObject({ home_score: null, away_score: null, game_type: "REG", gametime: null });
  });

  it("returns null when there is no such row, and throws on a query error", async () => {
    expect(await getGame("2025_01_XXX_YYY")).toBeNull();
    result = { data: null, error: { message: "fetch failed" } };
    await expect(getGame("2025_01_BAL_BUF")).rejects.toThrow("Failed to fetch game 2025_01_BAL_BUF: fetch failed");
  });
});

describe("getPlayedRegularSeasonGameIds (sitemap)", () => {
  it("returns the ids of played REG games only, reading through fetchAllRows", async () => {
    result = {
      data: [
        { game_id: "2026_01_BUF_HOU", game_type: "REG", home_score: 31, away_score: 36 },
        { game_id: "2026_02_DET_BUF", game_type: "REG", home_score: null, away_score: null },
        { game_id: "2026_19_BUF_MIA", game_type: "WC", home_score: 20, away_score: 17 },
        { game_id: "2026_01_NE_SEA", game_type: null, home_score: "13", away_score: "10" },
      ],
      error: null,
    };
    expect(await getPlayedRegularSeasonGameIds(2026)).toEqual(["2026_01_BUF_HOU", "2026_01_NE_SEA"]);
    expect(calls).toContainEqual(["from", "games"]);
    expect(calls).toContainEqual(["eq", "season", 2026]);
    expect(calls).toContainEqual(["range", 0, 999]);
  });

  it("propagates a query error (the sitemap catches it)", async () => {
    result = { data: null, error: { message: "fetch failed" } };
    await expect(getPlayedRegularSeasonGameIds(2026)).rejects.toMatchObject({ message: "fetch failed" });
  });
});
