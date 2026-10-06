import { describe, it, expect, beforeEach, vi } from "vitest";
import { render } from "@testing-library/react";
import type { ReactElement } from "react";

// Read resilience spec §1.2, "core reads" table: on the seven season pages
// every read is core, and on /compare the seasons list and the position table
// are. A rejected read must reject the page function (Next then shows that
// route's error.tsx), never resolve to a page with empty tables.
//
// Before PR 1A the loaders themselves hid the failure: a failed seasons read
// was [], a failed freshness read was null (which the leaderboards turned
// into an 18-week qualifier and a near-empty board), and failed gap data was
// an empty heatmap. Those loader contracts are pinned in __tests__/data/*;
// this file pins that no page catches what they now throw.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
}));
vi.mock("next/dynamic", () => ({ default: () => () => null }));

vi.mock("@/lib/data/queries", () => ({
  getAvailableSeasons: vi.fn(),
  fallbackSeason: vi.fn(() => 2026),
  getDataFreshness: vi.fn(),
  getQBStats: vi.fn(),
  getTeamStats: vi.fn(),
}));
vi.mock("@/lib/data/players", () => ({
  getAllPlayerSlugs: vi.fn(),
  getPlayerBySlug: vi.fn(),
}));
vi.mock("@/lib/data/receivers", () => ({ getReceiverStats: vi.fn() }));
vi.mock("@/lib/data/rushing", () => ({ getRBSeasonStats: vi.fn() }));
vi.mock("@/lib/data/run-gaps", () => ({
  getRBGapStats: vi.fn(),
  getAllGapData: vi.fn(),
  getRBGapStatsWeekly: vi.fn(),
  getDefGapStats: vi.fn(),
}));
vi.mock("@/lib/data/trends", () => ({ getAllSurgeData: vi.fn(), SURGE_STATS: [] }));
vi.mock("@/lib/data/team-stats", () => ({ getTeamStatsSeason: vi.fn() }));
vi.mock("@/lib/data/box-score", () => ({ getBoxScoreSeasonsCached: vi.fn(async () => [2026]) }));
vi.mock("@/components/compare/ComparisonTool", () => ({ default: vi.fn(() => null) }));

import { getAvailableSeasons, getDataFreshness, getQBStats, getTeamStats } from "@/lib/data/queries";
import { getAllPlayerSlugs, getPlayerBySlug } from "@/lib/data/players";
import { getReceiverStats } from "@/lib/data/receivers";
import { getRBSeasonStats } from "@/lib/data/rushing";
import { getRBGapStats, getAllGapData, getRBGapStatsWeekly, getDefGapStats } from "@/lib/data/run-gaps";
import { getAllSurgeData } from "@/lib/data/trends";
import { getTeamStatsSeason } from "@/lib/data/team-stats";
import ComparisonTool from "@/components/compare/ComparisonTool";
import TeamsPage from "@/app/teams/page";
import QBPage from "@/app/qb-leaderboard/page";
import ReceiversPage from "@/app/receivers/page";
import RushingPage from "@/app/rushing/page";
import TrendsPage from "@/app/trends/page";
import RunGapsPage from "@/app/run-gaps/page";
import TeamStatsPage from "@/app/team-stats/page";
import ComparePage from "@/app/compare/page";

type Page = (args: { searchParams: Promise<Record<string, string>> }) => Promise<unknown>;

const call = (page: Page, params: Record<string, string> = {}) =>
  page({ searchParams: Promise.resolve(params) });

const FAILED = (what: string) => new Error(`Failed to fetch ${what}: TypeError: fetch failed`);
const FRESH = { season: 2026, through_week: 4, last_updated: "2026-10-05T13:20:00+00:00" };

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(getAvailableSeasons).mockResolvedValue([2026, 2025]);
  vi.mocked(getDataFreshness).mockResolvedValue(FRESH);
  vi.mocked(getQBStats).mockResolvedValue([]);
  vi.mocked(getTeamStats).mockResolvedValue([]);
  vi.mocked(getReceiverStats).mockResolvedValue([]);
  vi.mocked(getRBSeasonStats).mockResolvedValue([]);
  vi.mocked(getAllPlayerSlugs).mockResolvedValue([]);
  vi.mocked(getPlayerBySlug).mockResolvedValue(null);
  vi.mocked(getRBGapStats).mockResolvedValue([]);
  vi.mocked(getRBGapStatsWeekly).mockResolvedValue([]);
  vi.mocked(getDefGapStats).mockResolvedValue([]);
  vi.mocked(getAllGapData).mockResolvedValue({ allGapStats: [], teams: [], leagueAvgs: { averages: [], teamGapEpas: [] } });
  vi.mocked(getAllSurgeData).mockResolvedValue(new Map());
  vi.mocked(getTeamStatsSeason).mockResolvedValue({ state: "uncovered", firstSeason: 2026 } as never);
  vi.mocked(ComparisonTool).mockReturnValue(null as never);
});

const SEASON_PAGES: [string, Page][] = [
  ["/teams", TeamsPage as Page],
  ["/qb-leaderboard", QBPage as Page],
  ["/receivers", ReceiversPage as Page],
  ["/rushing", RushingPage as Page],
  ["/trends", TrendsPage as Page],
  ["/run-gaps", RunGapsPage as Page],
  ["/team-stats", TeamStatsPage as Page],
];

describe("season pages: a failed read rejects the page", () => {
  it.each(SEASON_PAGES)("%s resolves when every read succeeds (control)", async (_path, page) => {
    await expect(call(page)).resolves.toBeDefined();
  });

  it.each(SEASON_PAGES)("%s: the seasons read fails", async (_path, page) => {
    vi.mocked(getAvailableSeasons).mockRejectedValue(FAILED("seasons"));
    await expect(call(page)).rejects.toThrow("Failed to fetch seasons");
  });

  it.each(SEASON_PAGES)("%s: the freshness read fails (it used to become an 18-week qualifier)", async (_path, page) => {
    vi.mocked(getDataFreshness).mockRejectedValue(FAILED("data freshness"));
    await expect(call(page)).rejects.toThrow("Failed to fetch data freshness");
  });

  it.each([
    ["/teams", TeamsPage as Page, () => vi.mocked(getTeamStats).mockRejectedValue(FAILED("team stats")), "team stats", {}],
    ["/qb-leaderboard", QBPage as Page, () => vi.mocked(getQBStats).mockRejectedValue(FAILED("QB stats")), "QB stats", {}],
    ["/qb-leaderboard (slugs)", QBPage as Page, () => vi.mocked(getAllPlayerSlugs).mockRejectedValue(FAILED("player slugs")), "player slugs", {}],
    ["/receivers", ReceiversPage as Page, () => vi.mocked(getReceiverStats).mockRejectedValue(FAILED("receiver stats")), "receiver stats", {}],
    ["/rushing", RushingPage as Page, () => vi.mocked(getRBSeasonStats).mockRejectedValue(FAILED("RB season stats")), "RB season stats", {}],
    ["/trends", TrendsPage as Page, () => vi.mocked(getAllSurgeData).mockRejectedValue(FAILED("weekly stats")), "weekly stats", {}],
    ["/run-gaps (it used to be an empty heatmap)", RunGapsPage as Page, () => vi.mocked(getAllGapData).mockRejectedValue(FAILED("run gap stats")), "run gap stats", {}],
    ["/run-gaps?team=BUF", RunGapsPage as Page, () => vi.mocked(getRBGapStatsWeekly).mockRejectedValue(FAILED("weekly gap stats")), "weekly gap stats", { team: "BUF" }],
    ["/run-gaps (defense)", RunGapsPage as Page, () => vi.mocked(getDefGapStats).mockRejectedValue(FAILED("defensive gap stats")), "defensive gap stats", {}],
    ["/team-stats", TeamStatsPage as Page, () => vi.mocked(getTeamStatsSeason).mockRejectedValue(FAILED("team stats")), "team stats", {}],
  ] as const)("%s: its own table read fails", async (_name, page, breakIt, what, params) => {
    breakIt();
    await expect(call(page, { ...params })).rejects.toThrow(`Failed to fetch ${what}`);
  });
});

describe("/compare", () => {
  const allen = {
    player_id: "00-0034857",
    slug: "josh-allen",
    player_name: "Josh Allen",
    position: "QB",
    current_team_id: "BUF",
    headshot_url: null,
    jersey_number: 17,
  };

  /** Render the page and return the props ComparisonTool received. */
  async function toolProps(params: Record<string, string>) {
    render((await call(ComparePage as Page, params)) as ReactElement);
    const calls = vi.mocked(ComparisonTool).mock.calls;
    return calls[calls.length - 1][0];
  }

  it("the seasons read fails → rejects", async () => {
    vi.mocked(getAvailableSeasons).mockRejectedValue(FAILED("seasons"));
    await expect(call(ComparePage as Page)).rejects.toThrow("Failed to fetch seasons");
  });

  it("an explicit ?season= needs no seasons read, so the tool renders even with the database down", async () => {
    vi.mocked(getAvailableSeasons).mockRejectedValue(FAILED("seasons"));
    const props = await toolProps({ season: "2025" });
    expect(props.season).toBe(2025);
    expect(getAvailableSeasons).not.toHaveBeenCalled();
  });

  it("the position table read fails when p1 is given → rejects", async () => {
    vi.mocked(getPlayerBySlug).mockResolvedValue(allen);
    vi.mocked(getQBStats).mockRejectedValue(FAILED("QB stats"));
    await expect(call(ComparePage as Page, { p1: "josh-allen" })).rejects.toThrow("Failed to fetch QB stats");
  });

  it("the p1 player lookup fails → the tool still renders with nothing preloaded, and the failure is logged", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const failure = FAILED("player josh-allen");
    vi.mocked(getPlayerBySlug).mockRejectedValue(failure);
    const props = await toolProps({ p1: "josh-allen" });
    expect(props.qbs).toEqual([]);
    expect(props.receivers).toEqual([]);
    expect(props.rbs).toEqual([]);
    expect(props.season).toBe(2026);
    expect(getQBStats).not.toHaveBeenCalled();
    expect(logged).toHaveBeenCalledTimes(1);
    expect(String(logged.mock.calls[0][0])).toContain("josh-allen");
    expect(logged.mock.calls[0][1]).toBe(failure);
    logged.mockRestore();
  });

  it("a healthy p1 preloads its position table and logs nothing", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(getPlayerBySlug).mockResolvedValue(allen);
    vi.mocked(getQBStats).mockResolvedValue([{ player_id: "00-0034857" }] as never);
    const props = await toolProps({ p1: "josh-allen" });
    expect(props.qbs).toHaveLength(1);
    expect(logged).not.toHaveBeenCalled();
    logged.mockRestore();
  });
});
