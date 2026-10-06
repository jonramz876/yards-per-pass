import fs from "fs";
import path from "path";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

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
import { notFound } from "next/navigation";
import {
  getPlayerBySlug,
  getQBWeeklyStats,
  getReceiverWeeklyStats,
  getRBWeeklyStats,
  getTeamTopReceivers,
  getTeamStartingQB,
  getQBPassLocationStats,
} from "@/lib/data/players";
import { getGameResults } from "@/lib/data/games";
import { getBoxScoreSeasonsCached } from "@/lib/data/box-score";
import { getAvailableSeasons, getQBStats, fallbackSeason } from "@/lib/data/queries";
import { getReceiverStats } from "@/lib/data/receivers";
import { getRBSeasonStats } from "@/lib/data/rushing";
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

  it("passes the site's default season down, so past-season cross-links keep ?season=", async () => {
    const props = await contentProps();
    expect(props.season).toBe(2025);
    expect(props.defaultSeason).toBe(2026);
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

  // Chaos DEGRADED 2: the .catch() hung off the call's return value, so a throw
  // before the promise existed 500'd the whole player hub with nothing logged.
  it("renders unlinked (and logs) when the probe throws synchronously", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(getBoxScoreSeasonsCached).mockImplementation((() => {
      throw new Error("probe threw before returning a promise");
    }) as unknown as typeof getBoxScoreSeasonsCached);
    const props = await contentProps();
    expect(props.boxScoreSeasons).toEqual([]);
    expect(logged).toHaveBeenCalledTimes(1);
    expect(String(logged.mock.calls[0][0])).toContain("josh-allen");
    logged.mockRestore();
  });

});

// Read resilience spec §1.2. Before PR 1A a failed read on this page became
// the Not Found page (player row), or "No QB stats found for X in 2026" for a
// player who has stats (season table / weekly rows, swallowed by an outer
// catch). Core reads now reject, which Next hands to error.tsx.
describe("PlayerPage — a failed read is an error, never Not Found or an empty page", () => {
  const allen = {
    player_id: "00-0034857",
    slug: "josh-allen",
    player_name: "Josh Allen",
    position: "QB",
    current_team_id: "BUF",
    headshot_url: null,
    jersey_number: 17,
  };
  const shakir = { ...allen, player_id: "00-0037261", slug: "khalil-shakir", player_name: "Khalil Shakir", position: "WR" };
  const cook = { ...allen, player_id: "00-0037248", slug: "james-cook", player_name: "James Cook", position: "RB" };
  const FAILED = new Error("Failed to fetch something: TypeError: fetch failed");
  const REAL_URL = "https://abcdefghijklmnop.supabase.co";

  const page = (slug: string) =>
    PlayerPage({ params: Promise.resolve({ slug }), searchParams: Promise.resolve({}) });

  async function contentProps(slug: string) {
    render(await page(slug));
    const calls = vi.mocked(PlayerPageContent).mock.calls;
    return calls[calls.length - 1][0];
  }

  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(notFound).mockImplementation(() => {
      throw new Error("NEXT_NOT_FOUND");
    });
    vi.mocked(getPlayerBySlug).mockResolvedValue(allen);
    vi.mocked(getAvailableSeasons).mockResolvedValue([2026, 2025]);
    vi.mocked(fallbackSeason).mockReturnValue(2026);
    vi.mocked(getQBStats).mockResolvedValue([]);
    vi.mocked(getReceiverStats).mockResolvedValue([]);
    vi.mocked(getRBSeasonStats).mockResolvedValue([]);
    vi.mocked(getQBWeeklyStats).mockResolvedValue([]);
    vi.mocked(getReceiverWeeklyStats).mockResolvedValue([]);
    vi.mocked(getRBWeeklyStats).mockResolvedValue([]);
    vi.mocked(getTeamTopReceivers).mockResolvedValue([]);
    vi.mocked(getTeamStartingQB).mockResolvedValue(null);
    vi.mocked(getQBPassLocationStats).mockResolvedValue([]);
    vi.mocked(getGameResults).mockResolvedValue({});
    vi.mocked(getBoxScoreSeasonsCached).mockResolvedValue([2026]);
    vi.mocked(PlayerPageContent).mockReturnValue(null as never);
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", REAL_URL);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("player row read fails → the page throws that error and notFound is NOT called", async () => {
    vi.mocked(getPlayerBySlug).mockRejectedValue(new Error("Failed to fetch player josh-allen: TypeError: fetch failed"));
    await expect(page("josh-allen")).rejects.toThrow("Failed to fetch player josh-allen");
    expect(notFound).not.toHaveBeenCalled();
  });

  it("generateMetadata: player row read fails → rejects; no 'Player Not Found' title for a real player", async () => {
    vi.mocked(getPlayerBySlug).mockRejectedValue(new Error("Failed to fetch player josh-allen: TypeError: fetch failed"));
    await expect(generateMetadata({ params: Promise.resolve({ slug: "josh-allen" }) })).rejects.toThrow(
      "Failed to fetch player josh-allen",
    );
  });

  it("seasons read fails → throws", async () => {
    vi.mocked(getAvailableSeasons).mockRejectedValue(new Error("Failed to fetch seasons: TypeError: fetch failed"));
    await expect(page("josh-allen")).rejects.toThrow("Failed to fetch seasons");
  });

  it("an empty data_freshness table with a real database → throws (homepage rule)", async () => {
    vi.mocked(getAvailableSeasons).mockResolvedValue([]);
    await expect(page("josh-allen")).rejects.toThrow(/no seasons/);
    expect(getQBStats).not.toHaveBeenCalled();
  });

  it("an empty seasons list with no database (placeholder build) → renders on the fallback season", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://placeholder.supabase.co");
    vi.mocked(getAvailableSeasons).mockResolvedValue([]);
    const props = await contentProps("josh-allen");
    expect(props.season).toBe(2026);
  });

  it.each([
    ["QB season table", allen, () => vi.mocked(getQBStats).mockRejectedValue(FAILED)],
    ["QB weekly rows", allen, () => vi.mocked(getQBWeeklyStats).mockRejectedValue(FAILED)],
    ["receiver season table", shakir, () => vi.mocked(getReceiverStats).mockRejectedValue(FAILED)],
    ["receiver weekly rows", shakir, () => vi.mocked(getReceiverWeeklyStats).mockRejectedValue(FAILED)],
    ["RB season table", cook, () => vi.mocked(getRBSeasonStats).mockRejectedValue(FAILED)],
    ["RB weekly rows", cook, () => vi.mocked(getRBWeeklyStats).mockRejectedValue(FAILED)],
  ])("%s read fails → throws (it used to render 'No stats found')", async (_name, player, breakIt) => {
    vi.mocked(getPlayerBySlug).mockResolvedValue(player);
    breakIt();
    await expect(page(player.slug)).rejects.toThrow("Failed to fetch something");
    expect(PlayerPageContent).not.toHaveBeenCalled();
  });

  it("a raw (non-Error) rejection from the RB season table still rejects", async () => {
    vi.mocked(getPlayerBySlug).mockResolvedValue(cook);
    vi.mocked(getRBSeasonStats).mockRejectedValue({ message: "TypeError: fetch failed" });
    await expect(page("james-cook")).rejects.toBeDefined();
  });

  it.each([
    ["Team's Top Receivers box", allen, () => vi.mocked(getTeamTopReceivers).mockRejectedValue(FAILED), "crossLinkReceivers", []],
    ["passing map", allen, () => vi.mocked(getQBPassLocationStats).mockRejectedValue(FAILED), "passLocationStats", []],
    ["Team QB box", shakir, () => vi.mocked(getTeamStartingQB).mockRejectedValue(FAILED), "crossLinkQB", null],
  ] as const)("%s read fails → the page still renders without it, and the failure is logged", async (_name, player, breakIt, prop, empty) => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(getPlayerBySlug).mockResolvedValue(player);
    breakIt();
    const props = await contentProps(player.slug);
    expect(props[prop]).toEqual(empty);
    expect(props.player).toEqual(player);
    expect(logged).toHaveBeenCalledTimes(1);
    expect(String(logged.mock.calls[0][0])).toContain(player.slug);
    expect(String(logged.mock.calls[0][0])).toContain("2026");
    expect(logged.mock.calls[0][1]).toBe(FAILED);
    logged.mockRestore();
  });

  it("a healthy render logs nothing", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    await contentProps("josh-allen");
    expect(logged).not.toHaveBeenCalled();
    logged.mockRestore();
  });
});
