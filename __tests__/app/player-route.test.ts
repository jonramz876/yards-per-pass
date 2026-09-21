import fs from "fs";
import path from "path";
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next/navigation", () => ({
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
  redirect: vi.fn((url: string) => {
    throw new Error("NEXT_REDIRECT:" + url);
  }),
}));

vi.mock("@/lib/data/players", () => ({
  getPlayerBySlug: vi.fn(),
  getQBWeeklyStats: vi.fn(async () => []),
  getReceiverWeeklyStats: vi.fn(async () => []),
  getRBWeeklyStats: vi.fn(async () => []),
  getTeamTopReceivers: vi.fn(async () => []),
  getTeamStartingQB: vi.fn(async () => null),
  getQBPassLocationStats: vi.fn(async () => []),
}));

vi.mock("@/lib/data/queries", () => ({
  getQBStats: vi.fn(async () => []),
  getAvailableSeasons: vi.fn(async () => [2026, 2025]),
  fallbackSeason: vi.fn(() => 2026),
}));

vi.mock("@/lib/data/receivers", () => ({
  getReceiverStats: vi.fn(async () => []),
}));

vi.mock("@/lib/data/rushing", () => ({
  getRBSeasonStats: vi.fn(async () => []),
}));

vi.mock("@/components/player/PlayerPageContent", () => ({
  default: vi.fn(() => null),
}));

vi.mock("@/lib/data/games", () => ({
  getGameResults: vi.fn(async () => ({})),
}));

vi.mock("@/lib/data/box-score", () => ({
  getBoxScoreSeasons: vi.fn(async () => []),
  getBoxScoreSeasonsCached: vi.fn(async () => []),
}));

vi.mock("@/components/ui/Breadcrumbs", () => ({
  default: () => null,
}));

import { render } from "@testing-library/react";
import PlayerPage, { generateMetadata } from "@/app/player/[slug]/page";
import PlayerPageContent from "@/components/player/PlayerPageContent";
import { getPlayerBySlug, getReceiverWeeklyStats } from "@/lib/data/players";
import { getGameResults } from "@/lib/data/games";
import { getBoxScoreSeasonsCached } from "@/lib/data/box-score";
import { getAvailableSeasons } from "@/lib/data/queries";
import type { ReceiverWeeklyStat } from "@/lib/types";

const ROOT = path.resolve(__dirname, "../..");

describe("player route files", () => {
  // A root loading boundary wraps every route, so notFound()/redirect()
  // would stream as HTTP 200 instead of a real 404/307 (verified with a
  // Next 14.2.35 probe). /card/[slug] returns a real 404 today because no
  // loading boundary sits above it.
  it("has no app/loading.tsx", () => {
    expect(fs.existsSync(path.resolve(ROOT, "app/loading.tsx"))).toBe(false);
  });

  it("keeps the player-specific not-found page", () => {
    expect(fs.existsSync(path.resolve(ROOT, "app/player/[slug]/not-found.tsx"))).toBe(true);
  });
});

describe("PlayerPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("redirects mixed-case slugs to lowercase and keeps season/tab", async () => {
    await expect(
      PlayerPage({
        params: Promise.resolve({ slug: "Drake-Maye" }),
        searchParams: Promise.resolve({ season: "2025", tab: "gamelog" }),
      }),
    ).rejects.toThrow("NEXT_REDIRECT:/player/drake-maye?season=2025&tab=gamelog");
    expect(getPlayerBySlug).not.toHaveBeenCalled();
  });

  it("calls notFound for an unknown slug", async () => {
    vi.mocked(getPlayerBySlug).mockResolvedValue(null);
    await expect(
      PlayerPage({
        params: Promise.resolve({ slug: "no-such-player-xyz" }),
        searchParams: Promise.resolve({}),
      }),
    ).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("renders a known player", async () => {
    vi.mocked(getPlayerBySlug).mockResolvedValue({
      player_id: "00-0039732",
      slug: "drake-maye",
      player_name: "Drake Maye",
      position: "QB",
      current_team_id: "NE",
      headshot_url: null,
      jersey_number: null,
    });
    await expect(
      PlayerPage({
        params: Promise.resolve({ slug: "drake-maye" }),
        searchParams: Promise.resolve({}),
      }),
    ).resolves.toBeDefined();
  });

  it("generateMetadata returns the not-found title for an unknown slug", async () => {
    vi.mocked(getPlayerBySlug).mockResolvedValue(null);
    const meta = await generateMetadata({
      params: Promise.resolve({ slug: "no-such-player-xyz" }),
    });
    expect(String(meta.title)).toContain("Player Not Found");
  });
});

describe("PlayerPage — Game Log results (box score spec §9)", () => {
  // Tyler Lockett: current team LV, but his 2025 rows are TEN then LV.
  const lockett = {
    player_id: "00-0032211",
    slug: "tyler-lockett",
    player_name: "Tyler Lockett",
    position: "WR",
    current_team_id: "LV",
    headshot_url: null,
    jersey_number: null,
  };
  const row = (week: number, team_id: string) =>
    ({ player_id: "00-0032211", season: 2025, week, team_id }) as unknown as ReceiverWeeklyStat;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getPlayerBySlug).mockResolvedValue(lockett);
    vi.mocked(getReceiverWeeklyStats).mockResolvedValue([]);
    vi.mocked(getGameResults).mockReset();
    vi.mocked(getGameResults).mockResolvedValue({});
  });

  /** Render the page and return the props PlayerPageContent received. */
  async function contentProps() {
    render(
      await PlayerPage({
        params: Promise.resolve({ slug: "tyler-lockett" }),
        searchParams: Promise.resolve({ season: "2025", tab: "game-log" }),
      }),
    );
    const calls = vi.mocked(PlayerPageContent).mock.calls;
    return calls[calls.length - 1][0];
  }

  it("fetches results for every team in the weekly rows, not the current team", async () => {
    vi.mocked(getReceiverWeeklyStats).mockResolvedValue([row(5, "TEN"), row(7, "TEN"), row(14, "LV")]);
    const results = {
      TEN: { 5: { game_id: "2025_05_TEN_ARI", team_score: 22, opponent_score: 21, result: "W" as const, opponent_id: "ARI" } },
    };
    vi.mocked(getGameResults).mockResolvedValue(results);

    const props = await contentProps();

    expect(getGameResults).toHaveBeenCalledTimes(1);
    const [ids, season] = vi.mocked(getGameResults).mock.calls[0];
    expect([...ids].sort()).toEqual(["LV", "TEN"]);
    expect(season).toBe(2025);
    expect(props.gameResults).toEqual(results);
  });

  it("skips the read when the player has no weekly rows", async () => {
    const props = await contentProps();
    expect(getGameResults).not.toHaveBeenCalled();
    expect(props.gameResults).toEqual({});
  });

  it("still renders when the games read fails; the Game Log keeps stored scores and the failure is logged", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(getReceiverWeeklyStats).mockResolvedValue([row(5, "TEN")]);
    vi.mocked(getGameResults).mockRejectedValue(new Error("Failed to fetch game results: fetch failed"));
    const props = await contentProps();
    expect(props.gameResults).toEqual({});
    expect(logged).toHaveBeenCalledTimes(1);
    expect(String(logged.mock.calls[0][0])).toContain("tyler-lockett");
    expect(String(logged.mock.calls[0][0])).toContain("2025");
    logged.mockRestore();
  });

  it("still renders when getGameResults throws instead of rejecting", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(getReceiverWeeklyStats).mockResolvedValue([row(5, "TEN")]);
    vi.mocked(getGameResults).mockImplementation(() => {
      throw new Error("sync failure before any promise exists");
    });
    const props = await contentProps();
    expect(props.gameResults).toEqual({});
    expect(logged).toHaveBeenCalledTimes(1);
    logged.mockRestore();
  });

  it("logs nothing when the games read succeeds", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(getReceiverWeeklyStats).mockResolvedValue([row(5, "TEN")]);
    await contentProps();
    expect(logged).not.toHaveBeenCalled();
    logged.mockRestore();
  });
});

describe("PlayerPage — box score link gate (box score spec §7)", () => {
  const allen = {
    player_id: "00-0034857",
    slug: "josh-allen",
    player_name: "Josh Allen",
    position: "QB",
    current_team_id: "BUF",
    headshot_url: null,
    jersey_number: 17,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getPlayerBySlug).mockResolvedValue(allen);
    vi.mocked(getBoxScoreSeasonsCached).mockReset();
    vi.mocked(getBoxScoreSeasonsCached).mockResolvedValue([2026]);
  });

  async function contentProps() {
    render(
      await PlayerPage({
        params: Promise.resolve({ slug: "josh-allen" }),
        searchParams: Promise.resolve({ tab: "game-log" }),
      }),
    );
    const calls = vi.mocked(PlayerPageContent).mock.calls;
    return calls[calls.length - 1][0];
  }

  it("probes the available seasons through the memo and passes the covered ones down", async () => {
    const props = await contentProps();
    expect(getBoxScoreSeasonsCached).toHaveBeenCalledWith([2026, 2025]);
    expect(props.boxScoreSeasons).toEqual([2026]);
  });

  it("renders unlinked (and logs) when the probe fails", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(getBoxScoreSeasonsCached).mockRejectedValue(new Error("Failed to fetch box score seasons: fetch failed"));
    const props = await contentProps();
    expect(props.boxScoreSeasons).toEqual([]);
    expect(logged).toHaveBeenCalledTimes(1);
    expect(String(logged.mock.calls[0][0])).toContain("josh-allen");
    logged.mockRestore();
  });

  it("logs the silent path: no seasons from data_freshness means no links", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(getAvailableSeasons).mockResolvedValueOnce([]);
    await contentProps();
    expect(logged).toHaveBeenCalledTimes(1);
    expect(String(logged.mock.calls[0][0])).toContain("no seasons from data_freshness");
    logged.mockRestore();
  });
});
