import { describe, it, expect, beforeEach, vi } from "vitest";

// Read resilience spec §1.2 (review M7): fetchAllRows rejects with the raw
// PostgREST object. Every loader that calls it rethrows an Error through
// queryError, so error boundaries and logs get a message, not a bare object.
// (The run-gaps and player-slug callers are in run-gaps.test.ts / players.test.ts.)
const fetchAllRows = vi.fn();
vi.mock("@/lib/data/utils", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/data/utils")>()),
  fetchAllRows: (...args: unknown[]) => fetchAllRows(...args),
}));

import { queryError } from "@/lib/data/utils";
import { getRBSeasonStats } from "@/lib/data/rushing";
import { getAllSurgeData, getWeeklyForStat, SURGE_STATS } from "@/lib/data/trends";
import type { PlayerSlug } from "@/lib/types";

const RAW_ERROR = { message: "TypeError: fetch failed", details: "", hint: "", code: "" };

beforeEach(() => {
  fetchAllRows.mockReset();
});

describe("queryError", () => {
  it("turns a raw PostgREST object into an Error that keeps its message and the cause", () => {
    const err = queryError("run gap stats", RAW_ERROR);
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe("Failed to fetch run gap stats: TypeError: fetch failed");
    expect(err.cause).toBe(RAW_ERROR);
  });

  it("keeps the message of an Error", () => {
    const cause = new Error("Missing Supabase env vars.");
    const err = queryError("seasons", cause);
    expect(err.message).toBe("Failed to fetch seasons: Missing Supabase env vars.");
    expect(err.cause).toBe(cause);
  });

  it.each([
    [{ code: "PGRST301" }, 'Failed to fetch x: {"code":"PGRST301"}'],
    [{ message: 42 }, 'Failed to fetch x: {"message":42}'],
    [{ message: "" }, "Failed to fetch x: "],
    [null, "Failed to fetch x: null"],
    [undefined, "Failed to fetch x: undefined"],
    ["boom", 'Failed to fetch x: "boom"'],
  ])("never throws on an error with no usable message: %j", (raw, expected) => {
    expect(queryError("x", raw).message).toBe(expected);
  });

  it("survives an object JSON cannot serialise", () => {
    const loop: Record<string, unknown> = {};
    loop.self = loop;
    expect(queryError("x", loop).message).toBe("Failed to fetch x: [object Object]");
  });
});

describe("getRBSeasonStats", () => {
  it("returns parsed rows, and [] for a read with no rows", async () => {
    fetchAllRows.mockResolvedValue([{ player_id: "p1", yards_per_carry: "4.5" }]);
    expect((await getRBSeasonStats(2026))[0].yards_per_carry).toBe(4.5);
    fetchAllRows.mockResolvedValue([]);
    expect(await getRBSeasonStats(2026)).toEqual([]);
  });

  it("rethrows the raw object as an Error", async () => {
    fetchAllRows.mockRejectedValue(RAW_ERROR);
    const err = await getRBSeasonStats(2026).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toBe("Failed to fetch RB season stats: TypeError: fetch failed");
  });
});

describe("trends loaders", () => {
  const slugMap = new Map<string, PlayerSlug>([
    [
      "p1",
      { player_id: "p1", slug: "josh-allen", player_name: "Josh Allen", position: "QB", current_team_id: "BUF", headshot_url: null, jersey_number: 17 },
    ],
  ]);

  it("getAllSurgeData returns a list per stat, empty lists for a read with no rows", async () => {
    fetchAllRows.mockImplementation(async (table: string) =>
      table === "qb_weekly_stats" ? [{ player_id: "p1", week: 1, epa_per_dropback: "0.2" }] : [],
    );
    const data = await getAllSurgeData(2026, slugMap);
    expect(data.get("qb_epa")).toHaveLength(1);
    expect(data.get("rb_epa")).toEqual([]);
  });

  it("getAllSurgeData rethrows the raw object as an Error", async () => {
    fetchAllRows.mockRejectedValue(RAW_ERROR);
    const err = await getAllSurgeData(2026, slugMap).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toBe("Failed to fetch weekly stats: TypeError: fetch failed");
  });

  it("getWeeklyForStat returns values, [] for no rows, and rethrows an Error", async () => {
    fetchAllRows.mockResolvedValue([{ player_id: "p1", week: 1, epa_per_dropback: "0.2" }]);
    expect(await getWeeklyForStat(SURGE_STATS[0], 2026, slugMap)).toHaveLength(1);
    fetchAllRows.mockResolvedValue([]);
    expect(await getWeeklyForStat(SURGE_STATS[0], 2026, slugMap)).toEqual([]);
    fetchAllRows.mockRejectedValue(RAW_ERROR);
    const err = await getWeeklyForStat(SURGE_STATS[0], 2026, slugMap).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toBe("Failed to fetch weekly stats: TypeError: fetch failed");
  });
});
