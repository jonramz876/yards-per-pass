// /team-stats route (team stats spec §5.2): season resolution, the ready and
// uncovered bodies, metadata and robots.
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ReactElement } from "react";
import { render } from "@testing-library/react";
import rowsJson from "../stats/fixtures/team-game-stats-2026-w1-3.json";

vi.mock("@/lib/data/queries", () => ({
  getAvailableSeasons: vi.fn(async () => [2026, 2025]),
  getDataFreshness: vi.fn(async (s: number) => ({ season: s, through_week: 3, last_updated: "2026-09-28T12:00:00Z" })),
  fallbackSeason: () => 2026,
}));
vi.mock("@/lib/data/team-stats", () => ({ getTeamStatsSeason: vi.fn() }));
vi.mock("@/lib/data/box-score", () => ({ getBoxScoreSeasonsCached: vi.fn(async () => [2026]) }));

import TeamStatsPage, { generateMetadata, revalidate } from "@/app/team-stats/page";
import TeamStatsTable from "@/components/tables/TeamStatsTable";
import DashboardShell from "@/components/layout/DashboardShell";
import { getTeamStatsSeason } from "@/lib/data/team-stats";
import { getBoxScoreSeasonsCached } from "@/lib/data/box-score";
import { getAvailableSeasons, getDataFreshness } from "@/lib/data/queries";
import { buildTeamStats } from "@/lib/stats/team-stats";

const ROWS = rowsJson as Record<string, unknown>[];

type ShellProps = { title: string; currentSeason: number; seasons: number[]; children: ReactElement };

async function page(season?: string) {
  return (await TeamStatsPage({ searchParams: Promise.resolve(season ? { season } : {}) })) as ReactElement<ShellProps>;
}
const meta = (season?: string) => generateMetadata({ searchParams: Promise.resolve(season ? { season } : {}) });

beforeEach(() => {
  vi.mocked(getTeamStatsSeason).mockReset();
  vi.mocked(getTeamStatsSeason).mockImplementation(async (s: number) =>
    s === 2026 ? { state: "ready", rows: ROWS as never } : { state: "uncovered", firstSeason: 2026 },
  );
  vi.mocked(getBoxScoreSeasonsCached).mockReset();
  vi.mocked(getBoxScoreSeasonsCached).mockResolvedValue([2026]);
  vi.mocked(getAvailableSeasons).mockResolvedValue([2026, 2025]);
});

describe("/team-stats page", () => {
  it("revalidates hourly", () => {
    expect(revalidate).toBe(3600);
  });

  it("ready: the table, keyed by season, with buildTeamStats output", async () => {
    const shell = await page();
    expect(shell.type).toBe(DashboardShell);
    expect(shell.props.title).toBe("Team Stats");
    expect(shell.props.currentSeason).toBe(2026);
    const child = shell.props.children as ReactElement<Record<string, unknown>>;
    expect(child.type).toBe(TeamStatsTable);
    expect(child.key).toBe("2026");
    expect(child.props.model).toEqual(buildTeamStats(ROWS));
    expect(child.props.season).toBe(2026);
    expect(child.props.throughWeek).toBe(3);
    expect(child.props.isLatestSeason).toBe(true);
    expect(getTeamStatsSeason).toHaveBeenCalledWith(2026, [2026, 2025]);
    expect(getDataFreshness).toHaveBeenCalledWith(2026);
  });

  it("a past season: isLatestSeason false", async () => {
    vi.mocked(getTeamStatsSeason).mockResolvedValue({ state: "ready", rows: ROWS as never });
    const child = (await page("2025")).props.children as ReactElement<Record<string, unknown>>;
    expect(child.key).toBe("2025");
    expect(child.props.isLatestSeason).toBe(false);
  });

  it("uncovered: the message, no table", async () => {
    const shell = await page("2025");
    const { container } = render(shell.props.children);
    expect(container.querySelector("table")).toBeNull();
    expect(container.textContent).toContain("Team stats start with the 2026 season");
    expect(container.textContent).toContain("Earlier seasons aren’t available yet.");
  });

  it("uncovered with no first season: the neutral heading, no body line", async () => {
    vi.mocked(getTeamStatsSeason).mockResolvedValue({ state: "uncovered", firstSeason: null });
    const { container } = render((await page("2030")).props.children);
    expect(container.textContent).toContain("Team stats aren’t available for the 2030 season");
    expect(container.textContent).not.toContain("Earlier seasons");
  });

  it("a loader rejection propagates (error.tsx handles it)", async () => {
    vi.mocked(getTeamStatsSeason).mockRejectedValue(new Error("Failed to fetch team_game_stats for 2026: boom"));
    await expect(page()).rejects.toThrow("boom");
  });

  it("junk season param falls back to the newest season", async () => {
    expect((await page("zzz")).props.currentSeason).toBe(2026);
  });

  it("an implausible season (out of 1999-2100) is treated as absent, never sent to the database", async () => {
    for (const bad of ["99999999999999999999", "1e9", "0x7EA", "-1", "0", "1998", "2101"]) {
      vi.mocked(getTeamStatsSeason).mockClear();
      const shell = await page(bad);
      expect(shell.props.currentSeason, bad).toBe(2026);
      expect(getTeamStatsSeason).toHaveBeenCalledWith(2026, [2026, 2025]);
      const m = await meta(bad);
      expect(m.title, bad).toBe("NFL Team Stats 2026");
      expect(m.robots, bad).toBeUndefined();
    }
    expect(getBoxScoreSeasonsCached).not.toHaveBeenCalled();
  });

  it("the range edges 1999 and 2100 are real seasons to the page (the message)", async () => {
    vi.mocked(getTeamStatsSeason).mockResolvedValue({ state: "uncovered", firstSeason: null });
    expect((await page("2100")).props.currentSeason).toBe(2100);
    expect((await page("1999")).props.currentSeason).toBe(1999);
    expect((await meta("1999")).title).toBe("NFL Team Stats 1999");
  });
});

describe("/team-stats metadata", () => {
  it("newest season: title, ready description, indexable, no probe", async () => {
    const m = await meta();
    expect(m.title).toBe("NFL Team Stats 2026");
    expect(m.description).toBe(
      "Every NFL team's offense and defense for the 2026 season: EPA per play, success rate, explosive plays, early and late downs, and what turnovers, sacks and penalties cost.",
    );
    expect(m.robots).toBeUndefined();
    expect(getBoxScoreSeasonsCached).not.toHaveBeenCalled();
  });

  it("an uncovered season: noindex, follow and the message as description", async () => {
    const m = await meta("2025");
    expect(m.title).toBe("NFL Team Stats 2025");
    expect(m.description).toBe("Team stats start with the 2026 season.");
    expect(m.robots).toEqual({ index: false, follow: true });
    expect(getBoxScoreSeasonsCached).toHaveBeenCalledWith([2026, 2025]);
  });

  it("a covered past season stays indexable", async () => {
    vi.mocked(getBoxScoreSeasonsCached).mockResolvedValue([2026, 2025]);
    const m = await meta("2025");
    expect(m.robots).toBeUndefined();
    expect(m.description).toContain("for the 2025 season");
  });

  it("no seasons from data_freshness: the body throws, so the metadata makes no claim (title only, no probe)", async () => {
    vi.mocked(getAvailableSeasons).mockResolvedValue([]);
    const m = await meta();
    expect(m).toEqual({ title: "NFL Team Stats 2026" });
    expect(getBoxScoreSeasonsCached).not.toHaveBeenCalled();
    expect(await meta("2025")).toEqual({ title: "NFL Team Stats 2025" });
  });

  it("a probe failure is logged and leaves the page indexable", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(getBoxScoreSeasonsCached).mockRejectedValue(new Error("probe down"));
    const m = await meta("2025");
    expect(m.robots).toBeUndefined();
    expect(logged).toHaveBeenCalled();
    logged.mockRestore();
  });
});
