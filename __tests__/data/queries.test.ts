import { describe, it, expect, beforeEach, vi } from "vitest";

// Chainable fake Supabase client (same pattern as __tests__/data/games.test.ts).
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

import { getAvailableSeasons } from "@/lib/data/queries";

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

  it("returns [] on a query error (the callers treat empty as a failed read)", async () => {
    result = { data: null, error: { message: "fetch failed" } };
    expect(await getAvailableSeasons()).toEqual([]);
  });
});
