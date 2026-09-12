import { describe, it, expect, beforeEach, vi } from "vitest";
import type { PlayerSlug } from "@/lib/types";

// Chainable fake Supabase client: records the query chain and resolves a
// settable result, so the real getLatestCardSeason runs against it.
const calls: unknown[][] = [];
let result: { data: unknown; error: unknown } = { data: [], error: null };
let clientThrows = false;

vi.mock("@/lib/supabase/server", () => {
  const builder: Record<string, unknown> = {};
  for (const m of ["select", "eq", "order", "limit"]) {
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
        if (clientThrows) throw new Error("no supabase env");
        calls.push(["from", t]);
        return builder;
      },
    }),
  };
});

import { getLatestCardSeason } from "@/lib/data/card";

function player(over: Partial<PlayerSlug>): PlayerSlug {
  return {
    player_id: "00-0033873",
    slug: "patrick-mahomes",
    player_name: "Patrick Mahomes",
    position: "QB",
    current_team_id: "KC",
    headshot_url: null,
    jersey_number: 15,
    ...over,
  };
}

beforeEach(() => {
  calls.length = 0;
  clientThrows = false;
  result = { data: [], error: null };
});

describe("getLatestCardSeason", () => {
  it("QB → newest qb_season_stats season", async () => {
    result = { data: [{ season: 2025 }], error: null };
    expect(await getLatestCardSeason(player({}))).toBe(2025);
    expect(calls).toContainEqual(["from", "qb_season_stats"]);
    expect(calls).toContainEqual(["select", "season"]);
    expect(calls).toContainEqual(["eq", "player_id", "00-0033873"]);
    expect(calls).toContainEqual(["order", "season", { ascending: false }]);
    expect(calls).toContainEqual(["limit", 1]);
  });

  it("WR and TE read receiver_season_stats; RB and FB read rb_season_stats", async () => {
    result = { data: [{ season: 2024 }], error: null };
    for (const [position, table] of [
      ["WR", "receiver_season_stats"],
      ["TE", "receiver_season_stats"],
      ["RB", "rb_season_stats"],
      ["FB", "rb_season_stats"],
    ] as const) {
      calls.length = 0;
      expect(await getLatestCardSeason(player({ position }))).toBe(2024);
      expect(calls[0]).toEqual(["from", table]);
    }
  });

  it("K, P, LB, DB and empty position → null without any query", async () => {
    result = { data: [{ season: 2025 }], error: null };
    for (const position of ["K", "P", "LB", "DB", ""]) {
      expect(await getLatestCardSeason(player({ position }))).toBeNull();
    }
    expect(calls).toEqual([]);
  });

  it("no rows → null", async () => {
    result = { data: [], error: null };
    expect(await getLatestCardSeason(player({}))).toBeNull();
  });

  it("error → null", async () => {
    result = { data: null, error: { message: "boom" } };
    expect(await getLatestCardSeason(player({}))).toBeNull();
  });

  it("client throws → null", async () => {
    clientThrows = true;
    expect(await getLatestCardSeason(player({}))).toBeNull();
  });

  it("season value guards", async () => {
    result = { data: [{ season: "2025" }], error: null };
    expect(await getLatestCardSeason(player({}))).toBe(2025);
    result = { data: [{ season: null }], error: null };
    expect(await getLatestCardSeason(player({}))).toBeNull();
    result = { data: [{ season: "abc" }], error: null };
    expect(await getLatestCardSeason(player({}))).toBeNull();
  });
});
