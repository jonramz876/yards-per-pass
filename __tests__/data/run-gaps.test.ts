import { describe, it, expect, beforeEach, vi } from "vitest";

// Read resilience spec §1.2: the three rb_gap_stats loaders used to catch a
// failed read and answer "no gap data", which /run-gaps rendered as an empty
// heatmap. They now throw; empty comes back only from a read with no rows.
// fetchAllRows rejects with the raw PostgREST object, so each case rejects
// with a plain object and expects an Error.
const fetchAllRows = vi.fn();
vi.mock("@/lib/data/utils", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/data/utils")>()),
  fetchAllRows: (...args: unknown[]) => fetchAllRows(...args),
}));
vi.mock("@/lib/supabase/server", () => ({
  createServerClient: () => {
    throw new Error("run-gaps.test: no direct client read expected");
  },
}));

import {
  getAllGapData,
  getLeagueGapAverages,
  getTeamsWithGapData,
  getRBGapStats,
  getDefGapStats,
} from "@/lib/data/run-gaps";

const RAW_ERROR = { message: "TypeError: fetch failed", details: "", hint: "", code: "" };

const ROWS = [
  { team_id: "BUF", gap: "LT", carries: 10, epa_per_carry: "0.10", yards_per_carry: "4.0", success_rate: "0.5", stuff_rate: "0.1", explosive_rate: "0.2" },
  { team_id: "KC", gap: "LT", carries: 30, epa_per_carry: "-0.10", yards_per_carry: "3.0", success_rate: "0.4", stuff_rate: "0.2", explosive_rate: "0.1" },
];

const EMPTY_ALL = { allGapStats: [], teams: [], leagueAvgs: { averages: [], teamGapEpas: [] } };

beforeEach(() => {
  fetchAllRows.mockReset();
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

describe("getAllGapData", () => {
  it("returns rows, teams and league averages", async () => {
    fetchAllRows.mockResolvedValue(ROWS);
    const data = await getAllGapData(2026);
    expect(fetchAllRows).toHaveBeenCalledWith("rb_gap_stats", "*", { season: 2026 });
    expect(data.teams).toEqual(["BUF", "KC"]);
    expect(data.allGapStats).toHaveLength(2);
    expect(data.allGapStats[0].epa_per_carry).toBe(0.1);
    expect(data.leagueAvgs.averages).toHaveLength(1);
    expect(data.leagueAvgs.averages[0].carries).toBe(40);
    expect(data.leagueAvgs.averages[0].avg_epa).toBeCloseTo(-0.05, 10);
  });

  it("returns the empty shape only when the read succeeded with no rows", async () => {
    fetchAllRows.mockResolvedValue([]);
    expect(await getAllGapData(2026)).toEqual(EMPTY_ALL);
  });

  it("throws an Error on a failed read instead of an empty heatmap", async () => {
    fetchAllRows.mockRejectedValue(RAW_ERROR);
    const err = await rejection(getAllGapData(2026));
    expect(err.message).toBe("Failed to fetch run gap stats: TypeError: fetch failed");
  });
});

describe("getLeagueGapAverages", () => {
  it("returns the averages", async () => {
    fetchAllRows.mockResolvedValue(ROWS);
    const data = await getLeagueGapAverages(2026);
    expect(data.averages[0].carries).toBe(40);
    expect(data.teamGapEpas).toHaveLength(2);
  });

  it("returns empty only when the read succeeded with no rows", async () => {
    fetchAllRows.mockResolvedValue([]);
    expect(await getLeagueGapAverages(2026)).toEqual({ averages: [], teamGapEpas: [] });
  });

  it("throws an Error on a failed read", async () => {
    fetchAllRows.mockRejectedValue(RAW_ERROR);
    const err = await rejection(getLeagueGapAverages(2026));
    expect(err.message).toBe("Failed to fetch league gap averages: TypeError: fetch failed");
  });
});

describe("getTeamsWithGapData", () => {
  it("returns the sorted, unique team ids", async () => {
    fetchAllRows.mockResolvedValue([{ team_id: "KC" }, { team_id: "BUF" }, { team_id: "KC" }]);
    expect(await getTeamsWithGapData(2026)).toEqual(["BUF", "KC"]);
  });

  it("returns [] only when the read succeeded with no rows", async () => {
    fetchAllRows.mockResolvedValue([]);
    expect(await getTeamsWithGapData(2026)).toEqual([]);
  });

  it("throws an Error on a failed read", async () => {
    fetchAllRows.mockRejectedValue(RAW_ERROR);
    const err = await rejection(getTeamsWithGapData(2026));
    expect(err.message).toBe("Failed to fetch teams with gap data: TypeError: fetch failed");
  });
});

describe("the other fetchAllRows callers rethrow an Error (review M7)", () => {
  it("getRBGapStats, all teams", async () => {
    fetchAllRows.mockResolvedValue(ROWS);
    expect(await getRBGapStats(2026)).toHaveLength(2);
    fetchAllRows.mockResolvedValue([]);
    expect(await getRBGapStats(2026)).toEqual([]);
    fetchAllRows.mockRejectedValue(RAW_ERROR);
    const err = await rejection(getRBGapStats(2026));
    expect(err.message).toBe("Failed to fetch RB gap stats: TypeError: fetch failed");
  });

  it("getDefGapStats", async () => {
    fetchAllRows.mockResolvedValue([{ team_id: "BUF", gap: "LT", def_epa_per_carry: "0.05" }]);
    const rows = await getDefGapStats(2026, "BUF");
    expect(fetchAllRows).toHaveBeenCalledWith("def_gap_stats", "*", { season: 2026, team_id: "BUF" });
    expect(rows[0].def_epa_per_carry).toBe(0.05);
    fetchAllRows.mockResolvedValue([]);
    expect(await getDefGapStats(2026)).toEqual([]);
    fetchAllRows.mockRejectedValue(RAW_ERROR);
    const err = await rejection(getDefGapStats(2026));
    expect(err.message).toBe("Failed to fetch defensive gap stats: TypeError: fetch failed");
  });
});
