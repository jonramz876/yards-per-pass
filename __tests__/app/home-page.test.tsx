import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render } from "@testing-library/react";
import type { TeamSeasonStat, QBSeasonStat } from "@/lib/types";

vi.mock("@/lib/data/queries", () => ({
  getAvailableSeasons: vi.fn(),
  getDataFreshness: vi.fn(),
  getTeamStats: vi.fn(),
  getQBStats: vi.fn(),
  fallbackSeason: () => 2026,
}));
vi.mock("@/lib/data/receivers", () => ({ getReceiverStats: vi.fn() }));
vi.mock("@/lib/data/rushing", () => ({ getRBSeasonStats: vi.fn() }));
vi.mock("@/lib/data/players", () => ({ getPlayerSlugsByIds: vi.fn() }));
vi.mock("@/lib/data/games", () => ({ hasScheduleForSeason: vi.fn() }));

import HomePage from "@/app/page";
import {
  getAvailableSeasons,
  getDataFreshness,
  getTeamStats,
  getQBStats,
} from "@/lib/data/queries";
import { getReceiverStats } from "@/lib/data/receivers";
import { getRBSeasonStats } from "@/lib/data/rushing";
import { getPlayerSlugsByIds } from "@/lib/data/players";
import { hasScheduleForSeason } from "@/lib/data/games";

/** A team_season_stats row (same shape as the TecmoStandings test helper). */
function stat(teamId: string, over: Partial<TeamSeasonStat> = {}): TeamSeasonStat {
  return {
    id: `${teamId}-2026`,
    team_id: teamId,
    season: 2026,
    off_epa_play: 0,
    def_epa_play: 0,
    off_pass_epa: 0,
    off_rush_epa: 0,
    def_pass_epa: 0,
    def_rush_epa: 0,
    off_success_rate: 0.45,
    def_success_rate: 0.45,
    pass_rate: 0.6,
    plays: 1000,
    wins: 0,
    losses: 0,
    ties: 0,
    takeaways: null,
    giveaways: null,
    turnover_diff: null,
    ...over,
  };
}

/** The live week-1 2026 rows. */
const TEAMS: TeamSeasonStat[] = [
  stat("SEA", { wins: 1, losses: 0, def_epa_play: -0.25 }),
  stat("SF", { wins: 1, losses: 0, def_epa_play: -0.1 }),
  stat("NE", { wins: 0, losses: 1, def_epa_play: 0.12 }),
  stat("LA", { wins: 0, losses: 1, def_epa_play: 0.2 }),
];

const FRESH = { season: 2026, through_week: 1, last_updated: "2026-09-14T13:22:00+00:00" };

const REAL_URL = "https://abcdefghijklmnop.supabase.co";

/** The four stats reads (freshness and seasons are checked separately). */
function statsMocks() {
  return [
    vi.mocked(getTeamStats),
    vi.mocked(getQBStats),
    vi.mocked(getReceiverStats),
    vi.mocked(getRBSeasonStats),
  ];
}

function expectEmptyShell(container: HTMLElement) {
  const rows = Array.from(container.querySelectorAll("[data-team-id]"));
  expect(rows).toHaveLength(32);
  for (const row of rows) expect(row.textContent).toContain("0-0");
  expect(container.textContent).not.toContain("Through Week");
  expect(container.querySelector("h1")?.textContent).toContain("Yards Per Pass");
  expect(container.textContent).toMatch(/2026 Standings/i);
}

beforeEach(() => {
  vi.mocked(getAvailableSeasons).mockReset();
  vi.mocked(getDataFreshness).mockReset();
  for (const m of statsMocks()) m.mockReset();
  vi.mocked(getPlayerSlugsByIds).mockReset();
  vi.mocked(hasScheduleForSeason).mockReset();

  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", REAL_URL);

  vi.mocked(getAvailableSeasons).mockResolvedValue([2026, 2025]);
  vi.mocked(getDataFreshness).mockResolvedValue(FRESH);
  vi.mocked(getTeamStats).mockResolvedValue(TEAMS);
  vi.mocked(getQBStats).mockResolvedValue([]);
  vi.mocked(getReceiverStats).mockResolvedValue([]);
  vi.mocked(getRBSeasonStats).mockResolvedValue([]);
  vi.mocked(hasScheduleForSeason).mockResolvedValue(false);
  vi.mocked(getPlayerSlugsByIds).mockResolvedValue([]);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("HomePage", () => {
  it("week-1 state renders; empty player strips are not errors", async () => {
    const { container } = render(await HomePage());
    // Never assert the "Updated" date: it depends on the machine's timezone.
    expect(container.textContent).toContain("Through Week 1");
    expect(container.textContent).toContain("2026 Season");
    expect(container.querySelector('[data-team-id="SEA"]')?.textContent).toContain("1-0");
    expect(container.querySelectorAll("[data-team-id]")).toHaveLength(32);
    // Team Defense strip links use the uppercase id (standings rows are lowercase).
    expect(container.querySelector('a[href="/team/SEA"]')).not.toBeNull();
    expect(vi.mocked(getDataFreshness)).toHaveBeenCalledWith(2026);
    for (const m of statsMocks()) expect(m).toHaveBeenCalledWith(2026);
  });

  it("INCIDENT 2026-09-14: one failing query must not produce a blank board", async () => {
    vi.mocked(getQBStats).mockRejectedValue(
      new Error("Failed to fetch QB stats: TypeError: fetch failed"),
    );
    // Before the fix this resolved to a page with no freshness line and 32
    // rows of 0-0, which ISR cached for an hour.
    await expect(HomePage()).rejects.toThrow("Failed to fetch QB stats");

    // The blip clears; the next render (Vercel's retry) is the full page.
    vi.mocked(getQBStats).mockResolvedValue([]);
    const { container } = render(await HomePage());
    expect(container.textContent).toContain("Through Week 1");
    expect(container.textContent).toContain("2026 Season");
  });

  it.each([
    [
      "getTeamStats rejects",
      () =>
        vi.mocked(getTeamStats).mockRejectedValue(
          new Error("Failed to fetch team stats: TypeError: fetch failed"),
        ),
      "Failed to fetch team stats",
    ],
    [
      "getReceiverStats rejects",
      () =>
        vi.mocked(getReceiverStats).mockRejectedValue(
          new Error("Failed to fetch receiver stats: TypeError: fetch failed"),
        ),
      "Failed to fetch receiver stats",
    ],
    [
      "getRBSeasonStats rejects",
      () =>
        vi.mocked(getRBSeasonStats).mockRejectedValue(
          new Error("rb_season_stats: TypeError: fetch failed"),
        ),
      "rb_season_stats: TypeError: fetch failed",
    ],
    [
      "getDataFreshness resolves null",
      () => vi.mocked(getDataFreshness).mockResolvedValue(null),
      /no data_freshness row for 2026/,
    ],
    [
      "getAvailableSeasons resolves []",
      () => vi.mocked(getAvailableSeasons).mockResolvedValue([]),
      /no seasons/,
    ],
    [
      "getQBStats rejects",
      () =>
        vi.mocked(getQBStats).mockRejectedValue(
          new Error("Failed to fetch QB stats: TypeError: fetch failed"),
        ),
      "Failed to fetch QB stats",
    ],
  ] as const)("%s → throws; no partial or blank page is returned", async (_name, setup, expected) => {
    setup();
    await expect(HomePage()).rejects.toThrow(expected);
  });

  it("rushing's raw PostgREST error object becomes an Error", async () => {
    vi.mocked(getRBSeasonStats).mockRejectedValue({
      message: "TypeError: fetch failed",
      details: "",
      hint: "",
      code: "",
    });
    const err = await HomePage().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toContain("fetch failed");
    expect((err as Error).message).toContain("Homepage data unavailable");
  });

  it("CI placeholder build renders the empty shell, as today", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://placeholder.supabase.co");
    vi.mocked(getAvailableSeasons).mockResolvedValue([]);
    vi.mocked(getDataFreshness).mockResolvedValue(null);
    vi.mocked(getTeamStats).mockRejectedValue(new Error("Failed to fetch team stats: TypeError: fetch failed"));
    vi.mocked(getQBStats).mockRejectedValue(new Error("Failed to fetch QB stats: TypeError: fetch failed"));
    vi.mocked(getReceiverStats).mockRejectedValue(
      new Error("Failed to fetch receiver stats: TypeError: fetch failed"),
    );
    vi.mocked(getRBSeasonStats).mockRejectedValue({ message: "TypeError: fetch failed", details: "", hint: "", code: "" });

    const { container } = render(await HomePage());
    expectEmptyShell(container);
    // The empty seasons list stops the page before the stats reads.
    for (const m of statsMocks()) expect(m).not.toHaveBeenCalled();
  });

  it("no Supabase URL behaves like the placeholder build", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.mocked(getAvailableSeasons).mockRejectedValue(
      new Error(
        "Missing Supabase env vars. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local",
      ),
    );
    const { container } = render(await HomePage());
    expectEmptyShell(container);
  });

  it("look-alike placeholder URLs count as real databases", async () => {
    vi.mocked(getQBStats).mockRejectedValue(new Error("Failed to fetch QB stats: TypeError: fetch failed"));
    for (const url of [
      "https://notplaceholder.supabase.co",
      "https://placeholder.supabase.co.example.com",
      "https://abc.supabase.co/?placeholder",
    ]) {
      vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", url);
      await expect(HomePage(), url).rejects.toThrow("Failed to fetch QB stats");
    }

    // The real placeholder, uppercase with a trailing slash, still renders.
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "HTTPS://PLACEHOLDER.SUPABASE.CO/");
    const { container } = render(await HomePage());
    expect(container.querySelectorAll("[data-team-id]")).toHaveLength(32);
  });

  it("next-season board still renders when next-season team stats fail (unchanged)", async () => {
    vi.mocked(hasScheduleForSeason).mockResolvedValue(true);
    vi.mocked(getTeamStats).mockImplementation(async (s) => {
      if (s === 2027) throw new Error("boom");
      return TEAMS;
    });
    const { container } = render(await HomePage());
    expect(container.textContent).toMatch(/2027 Standings/i);
    expect(container.querySelector('[data-team-id="SEA"]')?.textContent).toContain("0-0");
    // The Team Defense strip keeps using the 2026 rows.
    expect(container.querySelector('a[href="/team/SEA"]')).not.toBeNull();
  });

  it("missing slugs leave leader cards unlinked (unchanged)", async () => {
    // EPA order q1..q6; CPOE order puts q6 first, so the two top-5 lists
    // together cover all six players.
    const qbs = [
      { player_id: "q1", player_name: "D'Andre Test", team_id: "KC", dropbacks: 150, epa_per_play: 0.3, cpoe: 1 },
      { player_id: "q2", player_name: "Amon-Ra St. Test", team_id: "DET", dropbacks: 150, epa_per_play: 0.25, cpoe: 2 },
      { player_id: "q3", player_name: "Third Passer", team_id: "BUF", dropbacks: 150, epa_per_play: 0.2, cpoe: 3 },
      { player_id: "q4", player_name: "Fourth Passer", team_id: "BAL", dropbacks: 150, epa_per_play: 0.15, cpoe: 4 },
      { player_id: "q5", player_name: "Fifth Passer", team_id: "CIN", dropbacks: 150, epa_per_play: 0.1, cpoe: 5 },
      { player_id: "q6", player_name: "Sixth Passer", team_id: "LAC", dropbacks: 150, epa_per_play: 0.05, cpoe: 6 },
    ].map((q) => q as unknown as QBSeasonStat);
    vi.mocked(getQBStats).mockResolvedValue(qbs);

    const { container } = render(await HomePage());
    for (const q of qbs) expect(container.textContent).toContain(q.player_name);
    expect(container.querySelectorAll('a[href^="/player/"]')).toHaveLength(0);

    expect(vi.mocked(getPlayerSlugsByIds)).toHaveBeenCalledTimes(1);
    const ids = vi.mocked(getPlayerSlugsByIds).mock.calls[0][0];
    expect(ids).toHaveLength(6);
    expect(ids).toEqual(expect.arrayContaining(["q1", "q2", "q3", "q4", "q5", "q6"]));
  });
});
