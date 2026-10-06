import { describe, it, expect, beforeEach, vi } from "vitest";

// Read resilience spec §1.2: every loader in lib/data/players.ts throws an
// Error on a query error and returns empty only when the read succeeded with
// no rows. Chainable fake client (same pattern as __tests__/data/queries.test.ts);
// `results` is a queue so a loader that makes two reads can fail on the second.
const calls: unknown[][] = [];
let results: { data: unknown; error: unknown }[] = [];

vi.mock("@/lib/supabase/server", () => {
  const builder: Record<string, unknown> = {};
  for (const m of ["select", "eq", "in", "or", "order", "limit", "range", "maybeSingle"]) {
    builder[m] = (...a: unknown[]) => {
      calls.push([m, ...a]);
      return builder;
    };
  }
  builder.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
    Promise.resolve(results.length > 1 ? results.shift() : results[0]).then(res, rej);
  return {
    createServerClient: () => ({
      from: (t: string) => {
        calls.push(["from", t]);
        return builder;
      },
    }),
  };
});

import {
  getPlayerBySlug,
  getAllPlayerSlugs,
  getPlayerSlugsByIds,
  getQBWeeklyStats,
  getReceiverWeeklyStats,
  getRBWeeklyStats,
  getQBPassLocationStats,
  getTeamTopReceivers,
  getTeamStartingQB,
} from "@/lib/data/players";

const FAIL = { data: null, error: { message: "TypeError: fetch failed" } };
const EMPTY = { data: [], error: null };

const ALLEN = {
  player_id: "00-0034857",
  slug: "josh-allen",
  player_name: "Josh Allen",
  position: "QB",
  current_team_id: "BUF",
  headshot_url: null,
  jersey_number: 17,
};

beforeEach(() => {
  calls.length = 0;
  results = [EMPTY];
});

async function rejection(p: Promise<unknown>): Promise<Error> {
  const err = await p.then(
    () => {
      throw new Error("expected a rejection, but the loader resolved");
    },
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(Error);
  return err as Error;
}

describe("getPlayerBySlug", () => {
  it("returns the player row, read with maybeSingle", async () => {
    results = [{ data: ALLEN, error: null }];
    expect(await getPlayerBySlug("josh-allen")).toEqual(ALLEN);
    expect(calls).toContainEqual(["from", "player_slugs"]);
    expect(calls).toContainEqual(["eq", "slug", "josh-allen"]);
    expect(calls).toContainEqual(["maybeSingle"]);
  });

  it("returns null for an unknown slug (the read succeeded with no row)", async () => {
    results = [{ data: null, error: null }];
    expect(await getPlayerBySlug("no-such-player")).toBeNull();
  });

  // Chaos K1: a slug Postgres or the gateway itself refuses (a NUL byte is a
  // 400, an absurd length a 414) came back as a query error, so since PR 1A it
  // read as "database down" on /player, /card and /api/stat-card instead of
  // "no such player". No player can have such a slug (scripts/ingest.py
  // make_slug emits only a-z, 0-9 and hyphens), so the answer is null with no
  // read at all.
  it.each([
    ["a NUL byte", "\u0000"],
    ["a NUL byte inside a name", "josh\u0000allen"],
    ["an empty slug", ""],
    ["an absurd length", "a".repeat(5000)],
    ["101 characters", "a".repeat(101)],
    ["a space", "josh allen"],
    ["a slash", "josh/allen"],
    ["a percent sign", "josh%00allen"],
    ["a newline", "josh\nallen"],
    ["a filter-syntax attempt", "x,player_id.eq.1"],
    ["non-Latin letters", "josé-allen"],
  ])("returns null without reading for a slug no player can have: %s", async (_name, slug) => {
    results = [FAIL]; // a read would throw
    expect(await getPlayerBySlug(slug)).toBeNull();
    expect(calls).toHaveLength(0);
  });

  it.each([
    "josh-allen",
    "amon-ra-st-brown",
    "dj-moore-chi",
    "josh-allen-qb",
    "mike-williams-00-0033536",
    "a",
    "a".repeat(100),
    "Josh-Allen",
    "d'andre-swift",
    "t.j.-watt",
  ])("still reads for a plausible slug: %s", async (slug) => {
    results = [{ data: null, error: null }];
    expect(await getPlayerBySlug(slug)).toBeNull();
    expect(calls).toContainEqual(["eq", "slug", slug]);
  });

  it("throws on a query error, so a failed read is never a 404", async () => {
    results = [FAIL];
    const err = await rejection(getPlayerBySlug("josh-allen"));
    expect(err.message).toBe("Failed to fetch player josh-allen: TypeError: fetch failed");
  });
});

describe("getPlayerSlugsByIds", () => {
  it("returns the rows", async () => {
    results = [{ data: [ALLEN], error: null }];
    expect(await getPlayerSlugsByIds(["00-0034857"])).toEqual([ALLEN]);
    expect(calls).toContainEqual(["in", "player_id", ["00-0034857"]]);
  });

  it("returns [] for no ids without querying, and for a read with no rows", async () => {
    expect(await getPlayerSlugsByIds([])).toEqual([]);
    expect(calls).toHaveLength(0);
    expect(await getPlayerSlugsByIds(["x"])).toEqual([]);
    results = [{ data: null, error: null }];
    expect(await getPlayerSlugsByIds(["x"])).toEqual([]);
  });

  it("throws on a query error", async () => {
    results = [FAIL];
    const err = await rejection(getPlayerSlugsByIds(["00-0034857"]));
    expect(err.message).toBe("Failed to fetch player slugs: TypeError: fetch failed");
  });
});

describe("getAllPlayerSlugs", () => {
  it("returns every row", async () => {
    results = [{ data: [ALLEN], error: null }];
    expect(await getAllPlayerSlugs()).toEqual([ALLEN]);
  });

  it("returns [] when the table read succeeds with no rows", async () => {
    expect(await getAllPlayerSlugs()).toEqual([]);
  });

  it("rethrows fetchAllRows' raw PostgREST object as an Error", async () => {
    results = [FAIL];
    const err = await rejection(getAllPlayerSlugs());
    expect(err.message).toBe("Failed to fetch player slugs: TypeError: fetch failed");
  });
});

describe.each([
  ["getQBWeeklyStats", getQBWeeklyStats, "qb_weekly_stats", "QB weekly stats", { epa_per_dropback: "0.25" }, { epa_per_dropback: 0.25 }],
  ["getReceiverWeeklyStats", getReceiverWeeklyStats, "receiver_weekly_stats", "receiver weekly stats", { catch_rate: "0.7" }, { catch_rate: 0.7 }],
  ["getRBWeeklyStats", getRBWeeklyStats, "rb_weekly_stats", "RB weekly stats", { yards_per_carry: "4.5" }, { yards_per_carry: 4.5 }],
  ["getQBPassLocationStats", getQBPassLocationStats, "qb_pass_location_stats", "QB pass location stats", { cpoe: "3.5" }, { cpoe: 3.5 }],
] as const)("%s", (_name, loader, table, label, raw, parsed) => {
  it("returns the parsed rows", async () => {
    results = [{ data: [{ player_id: "p1", season: 2026, week: 1, ...raw }], error: null }];
    const rows = await loader("p1", 2026);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject(parsed);
    expect(calls).toContainEqual(["from", table]);
    expect(calls).toContainEqual(["eq", "player_id", "p1"]);
    expect(calls).toContainEqual(["eq", "season", 2026]);
  });

  it("returns [] when the read succeeded with no rows", async () => {
    expect(await loader("p1", 2026)).toEqual([]);
    results = [{ data: null, error: null }];
    expect(await loader("p1", 2026)).toEqual([]);
  });

  it("throws on a query error instead of answering []", async () => {
    results = [FAIL];
    const err = await rejection(loader("p1", 2026));
    expect(err.message).toBe(`Failed to fetch ${label}: TypeError: fetch failed`);
  });
});

describe("getTeamTopReceivers", () => {
  const ROW = { player_id: "r1", player_name: "Khalil Shakir", targets: 40, receptions: 30, receiving_yards: 350, receiving_tds: 2 };

  it("returns the receivers with their slugs", async () => {
    results = [
      { data: [ROW], error: null },
      { data: [{ player_id: "r1", slug: "khalil-shakir" }], error: null },
    ];
    expect(await getTeamTopReceivers("BUF", 2026)).toEqual([{ ...ROW, slug: "khalil-shakir" }]);
  });

  it("returns [] when the team has no receiver rows", async () => {
    expect(await getTeamTopReceivers("BUF", 2026)).toEqual([]);
  });

  it("throws on a query error", async () => {
    results = [FAIL];
    const err = await rejection(getTeamTopReceivers("BUF", 2026));
    expect(err.message).toBe("Failed to fetch team top receivers: TypeError: fetch failed");
  });

  it("throws when the slug read fails (the caller decides to degrade)", async () => {
    results = [{ data: [ROW], error: null }, FAIL];
    const err = await rejection(getTeamTopReceivers("BUF", 2026));
    expect(err.message).toBe("Failed to fetch player slugs: TypeError: fetch failed");
  });
});

describe("getTeamStartingQB", () => {
  const ROW = { player_id: "00-0034857", player_name: "Josh Allen", dropbacks: 150, passing_yards: 1100, touchdowns: 9 };

  it("returns the quarterback with his slug", async () => {
    results = [
      { data: [ROW], error: null },
      { data: [{ player_id: "00-0034857", slug: "josh-allen" }], error: null },
    ];
    expect(await getTeamStartingQB("BUF", 2026)).toEqual({ ...ROW, slug: "josh-allen" });
  });

  it("returns null when the team has no QB row", async () => {
    expect(await getTeamStartingQB("BUF", 2026)).toBeNull();
    results = [{ data: null, error: null }];
    expect(await getTeamStartingQB("BUF", 2026)).toBeNull();
  });

  it("throws on a query error", async () => {
    results = [FAIL];
    const err = await rejection(getTeamStartingQB("BUF", 2026));
    expect(err.message).toBe("Failed to fetch team starting QB: TypeError: fetch failed");
  });
});
