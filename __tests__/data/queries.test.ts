import { describe, it, expect, beforeEach, vi } from "vitest";

// Chainable fake Supabase client (same pattern as __tests__/data/games.test.ts).
const calls: unknown[][] = [];
let result: { data: unknown; error: unknown } = { data: [], error: null };

vi.mock("@/lib/supabase/server", () => {
  const builder: Record<string, unknown> = {};
  for (const m of ["select", "eq", "or", "order", "limit", "range", "maybeSingle"]) {
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

import { getAvailableSeasons, getDataFreshness, getTeamStats, getQBStats } from "@/lib/data/queries";

beforeEach(() => {
  calls.length = 0;
  result = { data: [], error: null };
});

describe("getAvailableSeasons", () => {
  it("reads data_freshness newest first", async () => {
    result = { data: [{ season: 2026 }, { season: 2025 }], error: null };
    expect(await getAvailableSeasons()).toEqual([2026, 2025]);
    expect(calls).toContainEqual(["from", "data_freshness"]);
    expect(calls).toContainEqual(["order", "season", { ascending: false }]);
  });

  // Chaos DEGRADED 1: this is the one place the season leaves the database.
  // Uncoerced, a NUMERIC/TEXT column change made every downstream integer
  // check false and took every box score link on the site dark, silently.
  it("coerces the season to a number so a text column cannot go silently dark", async () => {
    result = { data: [{ season: "2026" }, { season: "2025" }], error: null };
    expect(await getAvailableSeasons()).toEqual([2026, 2025]);
  });

  it("drops a season that is not a usable year", async () => {
    result = {
      data: [{ season: 2026 }, { season: null }, { season: "abc" }, { season: 0 }, { season: 2025.5 }],
      error: null,
    };
    expect(await getAvailableSeasons()).toEqual([2026]);
  });

  // Read resilience spec §1.2: a failed read must not look like an empty one.
  it("throws an Error on a query error", async () => {
    result = { data: null, error: { message: "TypeError: fetch failed" } };
    const err = await getAvailableSeasons().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toBe("Failed to fetch seasons: TypeError: fetch failed");
  });

  // Chaos K2: this logged "Failed to fetch seasons: undefined".
  it("an error with no message still says something useful (its code and details)", async () => {
    result = { data: null, error: { code: "PGRST301", details: "JWT expired", hint: null } };
    const err = await getAvailableSeasons().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).not.toContain("undefined");
    expect((err as Error).message).toContain("PGRST301");
    expect((err as Error).message).toContain("JWT expired");
  });

  it("the loaders that already threw before PR 1A get the same treatment", async () => {
    result = { data: null, error: { code: "57014" } };
    for (const load of [() => getTeamStats(2026), () => getQBStats(2026), () => getDataFreshness(2026)]) {
      const err = await load().catch((e: unknown) => e);
      expect(err).toBeInstanceOf(Error);
      expect((err as Error).message).not.toContain("undefined");
      expect((err as Error).message).toContain("57014");
    }
  });

  it("returns [] only when the read succeeded with no rows", async () => {
    result = { data: [], error: null };
    expect(await getAvailableSeasons()).toEqual([]);
    result = { data: null, error: null };
    expect(await getAvailableSeasons()).toEqual([]);
  });
});

describe("getDataFreshness (read resilience spec §1.2)", () => {
  const ROW = { season: 2026, through_week: 4, last_updated: "2026-10-05T13:20:00+00:00" };

  it("returns the season's row, read with maybeSingle", async () => {
    result = { data: ROW, error: null };
    expect(await getDataFreshness(2026)).toEqual(ROW);
    expect(calls).toContainEqual(["from", "data_freshness"]);
    expect(calls).toContainEqual(["eq", "season", 2026]);
    expect(calls).toContainEqual(["maybeSingle"]);
  });

  it("with no season, reads the newest row", async () => {
    result = { data: ROW, error: null };
    expect(await getDataFreshness()).toEqual(ROW);
    expect(calls).toContainEqual(["order", "season", { ascending: false }]);
    expect(calls).toContainEqual(["limit", 1]);
    expect(calls).toContainEqual(["maybeSingle"]);
  });

  it("returns null for a season with no row (not an error)", async () => {
    result = { data: null, error: null };
    expect(await getDataFreshness(2027)).toBeNull();
  });

  it("throws an Error on a query error instead of answering null", async () => {
    result = { data: null, error: { message: "TypeError: fetch failed" } };
    const err = await getDataFreshness(2026).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toBe("Failed to fetch data freshness: TypeError: fetch failed");
  });
});
