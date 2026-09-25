import { describe, it, expect, beforeEach, vi } from "vitest";
import { render } from "@testing-library/react";
import type { ReactNode } from "react";

// Pages must hand their components the site's default season (computed on the
// server), so past-season player links carry ?season= and default-season links
// stay bare. See lib/utils.ts playerHref.

const { dynamicProps } = vi.hoisted(() => ({ dynamicProps: [] as Record<string, unknown>[] }));

vi.mock("next/dynamic", () => ({
  default: () => (props: Record<string, unknown>) => {
    dynamicProps.push(props);
    return null;
  },
}));

vi.mock("@/components/layout/DashboardShell", () => ({
  default: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock("@/components/tables/QBLeaderboard", () => ({ default: vi.fn(() => null) }));
vi.mock("@/components/tables/ReceiverLeaderboard", () => ({ default: vi.fn(() => null) }));
vi.mock("@/components/tables/RBLeaderboard", () => ({ default: vi.fn(() => null) }));
vi.mock("@/components/trends/SurgeDetector", () => ({ default: vi.fn(() => null) }));

vi.mock("@/lib/data/queries", () => ({
  getAvailableSeasons: vi.fn(),
  fallbackSeason: vi.fn(() => 2026),
  getDataFreshness: vi.fn(async () => null),
  getQBStats: vi.fn(async () => [{ player_id: "00-0034857" }]),
}));
vi.mock("@/lib/data/players", () => ({ getAllPlayerSlugs: vi.fn(async () => []) }));
vi.mock("@/lib/data/receivers", () => ({ getReceiverStats: vi.fn(async () => []) }));
vi.mock("@/lib/data/rushing", () => ({ getRBSeasonStats: vi.fn(async () => []) }));
vi.mock("@/lib/data/trends", () => ({
  getAllSurgeData: vi.fn(async () => new Map()),
  SURGE_STATS: [],
}));
vi.mock("@/lib/data/run-gaps", () => ({
  getRBGapStats: vi.fn(async () => []),
  getAllGapData: vi.fn(async () => ({ allGapStats: [], teams: [], leagueAvgs: { averages: [], teamGapEpas: [] } })),
  getRBGapStatsWeekly: vi.fn(async () => []),
  getDefGapStats: vi.fn(async () => []),
}));

import QBLeaderboardPage from "@/app/qb-leaderboard/page";
import ReceiversPage from "@/app/receivers/page";
import RushingPage from "@/app/rushing/page";
import TrendsPage from "@/app/trends/page";
import RunGapsPage from "@/app/run-gaps/page";
import QBLeaderboard from "@/components/tables/QBLeaderboard";
import ReceiverLeaderboard from "@/components/tables/ReceiverLeaderboard";
import RBLeaderboard from "@/components/tables/RBLeaderboard";
import SurgeDetector from "@/components/trends/SurgeDetector";
import { getAvailableSeasons } from "@/lib/data/queries";

const SEASONS = [2026, 2025, 2024, 2023, 2022, 2021, 2020];

type Page = (args: { searchParams: Promise<Record<string, string>> }) => Promise<JSX.Element>;

async function renderPage(page: Page, params: Record<string, string>) {
  render(await page({ searchParams: Promise.resolve(params) }));
}

function lastProps(component: unknown) {
  const calls = vi.mocked(component as (p: Record<string, unknown>) => null).mock.calls;
  return calls[calls.length - 1][0];
}

beforeEach(() => {
  vi.clearAllMocks();
  dynamicProps.length = 0;
  vi.mocked(getAvailableSeasons).mockResolvedValue(SEASONS);
});

const LEADERBOARD_PAGES: [string, Page, unknown][] = [
  ["/qb-leaderboard", QBLeaderboardPage as unknown as Page, QBLeaderboard],
  ["/receivers", ReceiversPage as unknown as Page, ReceiverLeaderboard],
  ["/rushing", RushingPage as unknown as Page, RBLeaderboard],
  ["/trends", TrendsPage as unknown as Page, SurgeDetector],
];

describe("season pages pass the viewed and the default season", () => {
  it.each(LEADERBOARD_PAGES)("%s ?season=2024", async (_path, page, component) => {
    await renderPage(page, { season: "2024" });
    const props = lastProps(component);
    expect(props.season).toBe(2024);
    expect(props.defaultSeason).toBe(2026);
  });

  it.each(LEADERBOARD_PAGES)("%s with no seasons falls back to fallbackSeason()", async (_path, page, component) => {
    vi.mocked(getAvailableSeasons).mockResolvedValue([]);
    await renderPage(page, { season: "2024" });
    expect(lastProps(component).defaultSeason).toBe(2026);
  });

  it("/run-gaps?team=BUF&season=2024 → RunGapDiagram", async () => {
    await renderPage(RunGapsPage as unknown as Page, { team: "BUF", season: "2024" });
    const diagram = dynamicProps.filter((p) => p.selectedTeam === "BUF");
    expect(diagram).toHaveLength(1);
    expect(diagram[0].season).toBe(2024);
    expect(diagram[0].defaultSeason).toBe(2026);
  });

  it("/run-gaps with no seasons falls back to fallbackSeason()", async () => {
    vi.mocked(getAvailableSeasons).mockResolvedValue([]);
    await renderPage(RunGapsPage as unknown as Page, { team: "BUF", season: "2024" });
    const diagram = dynamicProps.filter((p) => p.selectedTeam === "BUF");
    expect(diagram[0].defaultSeason).toBe(2026);
  });
});
