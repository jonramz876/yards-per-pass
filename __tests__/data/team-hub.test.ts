import { describe, it, expect, beforeEach, vi } from "vitest";

// Read resilience spec §1.2: getTeamHubData used to turn each of its 12 reads
// into "no rows" on failure, so a failed read rendered a team page with the
// name and nothing else. Ten reads are now core (a failure rejects, and the
// route's error card shows); two may degrade, logged.
vi.mock("@/lib/data/queries", () => ({
  getTeamStats: vi.fn(),
  getQBStats: vi.fn(),
  getDataFreshness: vi.fn(),
  getAvailableSeasons: vi.fn(),
}));
vi.mock("@/lib/data/receivers", () => ({ getReceiverStats: vi.fn() }));
vi.mock("@/lib/data/run-gaps", () => ({ getRBGapStats: vi.fn(), getDefGapStats: vi.fn() }));
vi.mock("@/lib/data/players", () => ({ getAllPlayerSlugs: vi.fn() }));
vi.mock("@/lib/data/games", () => ({ getTeamSchedule: vi.fn() }));

// The two reads team-hub.ts makes itself (down-distance, situational).
let tableResults: Record<string, { data: unknown; error: unknown }> = {};
vi.mock("@/lib/supabase/server", () => ({
  createServerClient: () => ({
    from: (table: string) => {
      const builder: Record<string, unknown> = {};
      for (const m of ["select", "eq", "in"]) builder[m] = () => builder;
      builder.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
        Promise.resolve(tableResults[table]).then(res, rej);
      return builder;
    },
  }),
}));

import { getTeamHubData } from "@/lib/data/team-hub";
import { getTeamStats, getQBStats, getDataFreshness, getAvailableSeasons } from "@/lib/data/queries";
import { getReceiverStats } from "@/lib/data/receivers";
import { getRBGapStats, getDefGapStats } from "@/lib/data/run-gaps";
import { getAllPlayerSlugs } from "@/lib/data/players";
import { getTeamSchedule } from "@/lib/data/games";
import type { TeamGame } from "@/lib/types";

const FAILED = new Error("Failed to fetch something: TypeError: fetch failed");
const FAIL = { data: null, error: { message: "TypeError: fetch failed" } };
const FRESH = { season: 2026, through_week: 4, last_updated: "2026-10-05T13:20:00+00:00" };
const GAME = { game_id: "2026_01_BUF_HOU", season: 2026, week: 1 } as unknown as TeamGame;
const NEXT_GAME = { game_id: "2027_01_BUF_MIA", season: 2027, week: 1 } as unknown as TeamGame;

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(getTeamStats).mockResolvedValue([{ team_id: "BUF" }, { team_id: "KC" }] as never);
  vi.mocked(getQBStats).mockResolvedValue([{ player_id: "q1", team_id: "BUF" }] as never);
  vi.mocked(getReceiverStats).mockResolvedValue([{ player_id: "r1", team_id: "BUF" }] as never);
  vi.mocked(getRBGapStats).mockResolvedValue([{ team_id: "BUF", gap: "LT" }] as never);
  vi.mocked(getDefGapStats).mockResolvedValue([{ team_id: "BUF", gap: "LT" }] as never);
  vi.mocked(getTeamSchedule).mockImplementation(async (_team, season) => (season === 2026 ? [GAME] : []));
  vi.mocked(getAllPlayerSlugs).mockResolvedValue([{ player_id: "q1", slug: "josh-allen" }] as never);
  vi.mocked(getDataFreshness).mockResolvedValue(FRESH);
  vi.mocked(getAvailableSeasons).mockResolvedValue([2026, 2025]);
  tableResults = {
    team_down_distance_stats: {
      data: [
        { team_id: "BUF", season: 2026, carries: "12" },
        { team_id: "NFL", season: 2026, carries: "400" },
      ],
      error: null,
    },
    team_situational_stats: {
      data: [
        { team_id: "BUF", season: 2026, plays: "60" },
        { team_id: "KC", season: 2026, plays: "55" },
        { team_id: "NFL", season: 2026, plays: "1800" },
      ],
      error: null,
    },
  };
});

describe("getTeamHubData — healthy", () => {
  it("returns every section", async () => {
    const data = await getTeamHubData("BUF", 2026, true);
    expect(data.teamStats).toEqual({ team_id: "BUF" });
    expect(data.allTeamStats).toHaveLength(2);
    expect(data.teamQBs).toHaveLength(1);
    expect(data.teamReceivers).toHaveLength(1);
    expect(data.teamRBGaps).toHaveLength(1);
    expect(data.teamDefGaps).toHaveLength(1);
    expect(data.downDistanceStats).toHaveLength(1);
    expect(data.downDistanceStats[0]).toMatchObject({ team_id: "BUF", season: 2026, carries: 12 });
    expect(data.downDistanceNFL).toHaveLength(1);
    expect(data.downDistanceNFL[0]).toMatchObject({ team_id: "NFL", season: 2026, carries: 400 });
    expect(data.situationalStats).toHaveLength(1);
    expect(data.situationalStats[0]).toMatchObject({ team_id: "BUF", season: 2026, plays: 60 });
    expect(data.allSituationalStats.map((s) => s.team_id)).toEqual(["BUF", "KC"]);
    expect(data.schedule).toEqual([GAME]);
    expect(data.slugMap).toEqual({ q1: "josh-allen" });
    expect(data.freshness).toEqual(FRESH);
    expect(data.seasons).toEqual([2026, 2025]);
  });

  it("a read that succeeds with no rows is still an empty section, not an error", async () => {
    vi.mocked(getRBGapStats).mockResolvedValue([]);
    vi.mocked(getDataFreshness).mockResolvedValue(null);
    tableResults.team_down_distance_stats = { data: [], error: null };
    tableResults.team_situational_stats = { data: null, error: null };
    const data = await getTeamHubData("BUF", 2026, true);
    expect(data.teamRBGaps).toEqual([]);
    expect(data.freshness).toBeNull();
    expect(data.downDistanceStats).toEqual([]);
    expect(data.downDistanceNFL).toEqual([]);
    expect(data.situationalStats).toEqual([]);
  });
});

describe("getTeamHubData — a failed core read rejects (no blank team page)", () => {
  it.each([
    ["team stats", () => vi.mocked(getTeamStats).mockRejectedValue(FAILED)],
    ["QB stats", () => vi.mocked(getQBStats).mockRejectedValue(FAILED)],
    ["receiver stats", () => vi.mocked(getReceiverStats).mockRejectedValue(FAILED)],
    ["RB gap stats", () => vi.mocked(getRBGapStats).mockRejectedValue(FAILED)],
    ["defensive gap stats", () => vi.mocked(getDefGapStats).mockRejectedValue(FAILED)],
    [
      "this season's schedule",
      () =>
        vi.mocked(getTeamSchedule).mockImplementation(async (_team, season) => {
          if (season === 2026) throw FAILED;
          return [];
        }),
    ],
    ["data freshness", () => vi.mocked(getDataFreshness).mockRejectedValue(FAILED)],
    ["seasons", () => vi.mocked(getAvailableSeasons).mockRejectedValue(FAILED)],
  ])("%s", async (_name, breakIt) => {
    breakIt();
    await expect(getTeamHubData("BUF", 2026, true)).rejects.toThrow("Failed to fetch something");
  });

  it("down-distance stats (the read ignored its error before)", async () => {
    tableResults.team_down_distance_stats = FAIL;
    const err = await getTeamHubData("BUF", 2026, true).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toBe("Failed to fetch down and distance stats: TypeError: fetch failed");
  });

  it("situational stats (the read ignored its error before)", async () => {
    tableResults.team_situational_stats = FAIL;
    const err = await getTeamHubData("BUF", 2026, true).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toBe("Failed to fetch situational stats: TypeError: fetch failed");
  });
});

describe("getTeamHubData — the two reads that may degrade, logged", () => {
  it("player slugs fail: the page data resolves with names unlinked", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(getAllPlayerSlugs).mockRejectedValue(FAILED);
    const data = await getTeamHubData("BUF", 2026, true);
    expect(data.slugMap).toEqual({});
    expect(data.teamQBs).toHaveLength(1);
    expect(logged).toHaveBeenCalledTimes(1);
    expect(String(logged.mock.calls[0][0])).toContain("BUF");
    expect(String(logged.mock.calls[0][0])).toContain("player links");
    expect(logged.mock.calls[0][1]).toBe(FAILED);
    logged.mockRestore();
  });

  it("next season's schedule fails: no upcoming section, this season's schedule still there", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(getTeamSchedule).mockImplementation(async (_team, season) => {
      if (season === 2027) throw FAILED;
      return [GAME];
    });
    const data = await getTeamHubData("BUF", 2026, true);
    expect(data.schedule).toEqual([GAME]);
    expect(data.upcomingSchedule).toEqual([]);
    expect(data.upcomingSeason).toBeUndefined();
    expect(logged).toHaveBeenCalledTimes(1);
    expect(String(logged.mock.calls[0][0])).toContain("2027");
    logged.mockRestore();
  });

  it("logs nothing when every read succeeds, and keeps the upcoming season", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(getTeamSchedule).mockImplementation(async (_team, season) => (season === 2027 ? [NEXT_GAME] : [GAME]));
    const data = await getTeamHubData("BUF", 2026, true);
    expect(data.upcomingSchedule).toEqual([NEXT_GAME]);
    expect(data.seasons).toEqual([2027, 2026, 2025]);
    expect(logged).not.toHaveBeenCalled();
    logged.mockRestore();
  });
});
