import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/lib/data/players", () => ({ getAllPlayerSlugs: vi.fn() }));
vi.mock("@/lib/data/queries", () => ({
  getDataFreshness: vi.fn(),
  getAvailableSeasons: vi.fn(async () => [2026, 2025]),
}));
vi.mock("@/lib/data/box-score", () => ({ getBoxScoreSeasons: vi.fn(async () => []) }));
vi.mock("@/lib/data/games", () => ({ getPlayedRegularSeasonGameIds: vi.fn(async () => []) }));

import sitemap, { revalidate } from "@/app/sitemap";
import { getAllPlayerSlugs } from "@/lib/data/players";
import { getAvailableSeasons, getDataFreshness } from "@/lib/data/queries";
import { getBoxScoreSeasons } from "@/lib/data/box-score";
import { getPlayedRegularSeasonGameIds } from "@/lib/data/games";

const SLUGS = [
  { slug: "patrick-mahomes" },
  { slug: "brandon-aubrey" },
  { slug: "drake-maye" },
];

const FRESH = { season: 2026, through_week: 1, last_updated: "2026-09-10T16:42:00+00:00" };

beforeEach(() => {
  vi.mocked(getAllPlayerSlugs).mockReset();
  vi.mocked(getDataFreshness).mockReset();
  vi.mocked(getAvailableSeasons).mockReset();
  vi.mocked(getAvailableSeasons).mockResolvedValue([2026, 2025]);
  vi.mocked(getBoxScoreSeasons).mockReset();
  vi.mocked(getBoxScoreSeasons).mockResolvedValue([]);
  vi.mocked(getPlayedRegularSeasonGameIds).mockReset();
  vi.mocked(getPlayedRegularSeasonGameIds).mockResolvedValue([]);
  // The sitemap reads only .slug, so the fixtures stay slug-only.
  vi.mocked(getAllPlayerSlugs).mockResolvedValue(SLUGS as never);
  vi.mocked(getDataFreshness).mockResolvedValue(FRESH as never);
});

describe("sitemap", () => {
  it("regression: no /card/ URLs, one /player/ URL per slug", async () => {
    const entries = await sitemap();
    expect(entries.filter((e) => e.url.includes("/card/"))).toHaveLength(0);
    expect(entries.filter((e) => e.url.includes("/player/"))).toHaveLength(3);
    expect(entries).toHaveLength(10 + 32 + 3);
  });

  it("lastmod is data_freshness.last_updated, not request time", async () => {
    const entries = await sitemap();
    const stamped = entries.filter(
      (e) =>
        e.url.includes("/player/") ||
        e.url.includes("/team/") ||
        e.url === "https://yardsperpass.com" ||
        e.url.endsWith("/qb-leaderboard"),
    );
    expect(stamped.length).toBeGreaterThan(0);
    for (const e of stamped) {
      expect((e.lastModified as Date).toISOString()).toBe("2026-09-10T16:42:00.000Z");
    }
    for (const page of ["/glossary", "/privacy"]) {
      expect(entries.find((e) => e.url.endsWith(page))?.lastModified).toBeUndefined();
    }
  });

  it("missing, invalid or failed freshness → no lastModified, no throw", async () => {
    const cases = [
      () => vi.mocked(getDataFreshness).mockResolvedValue(null),
      () => vi.mocked(getDataFreshness).mockResolvedValue({ last_updated: "not-a-date" } as never),
      () => vi.mocked(getDataFreshness).mockRejectedValue(new Error("boom")),
    ];
    for (const setup of cases) {
      setup();
      const entries = await sitemap();
      expect(entries.every((e) => e.lastModified === undefined)).toBe(true);
    }
  });

  it("Supabase down for slugs → static + team pages only", async () => {
    vi.mocked(getAllPlayerSlugs).mockRejectedValue(new Error("boom"));
    const entries = await sitemap();
    expect(entries).toHaveLength(10 + 32);
  });

  it("1,250 slugs (past the 1,000-row cap) → 1,250 player URLs, no duplicates", async () => {
    const many = Array.from({ length: 1250 }, (_, i) => ({ slug: `player-${i}` }));
    vi.mocked(getAllPlayerSlugs).mockResolvedValue(many as never);
    const entries = await sitemap();
    const players = entries.filter((e) => e.url.includes("/player/"));
    expect(players).toHaveLength(1250);
    expect(new Set(players.map((e) => e.url)).size).toBe(1250);
    expect(entries.filter((e) => e.url.includes("/card/"))).toHaveLength(0);
  });
});

describe("sitemap — box score pages (box score spec §6)", () => {
  it("lists every played regular-season game of each covered season", async () => {
    vi.mocked(getBoxScoreSeasons).mockResolvedValue([2026]);
    vi.mocked(getPlayedRegularSeasonGameIds).mockResolvedValue(["2026_01_BUF_HOU", "2026_01_NE_SEA"]);
    const entries = await sitemap();
    const games = entries.filter((e) => e.url.includes("/game/"));
    expect(games.map((e) => e.url)).toEqual([
      "https://yardsperpass.com/game/2026_01_BUF_HOU",
      "https://yardsperpass.com/game/2026_01_NE_SEA",
    ]);
    expect((games[0].lastModified as Date).toISOString()).toBe("2026-09-10T16:42:00.000Z");
    expect(games[0].priority).toBe(0.6);
    expect(getBoxScoreSeasons).toHaveBeenCalledWith([2026, 2025]);
    expect(getPlayedRegularSeasonGameIds).toHaveBeenCalledTimes(1);
    expect(getPlayedRegularSeasonGameIds).toHaveBeenCalledWith(2026);
    expect(entries).toHaveLength(10 + 32 + 3 + 2);
  });

  it("lists none when no season is covered, and none (no throw) when the reads fail", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    expect((await sitemap()).filter((e) => e.url.includes("/game/"))).toHaveLength(0);
    expect(logged).not.toHaveBeenCalled();
    vi.mocked(getBoxScoreSeasons).mockRejectedValue(new Error("boom"));
    const entries = await sitemap();
    expect(entries.filter((e) => e.url.includes("/game/"))).toHaveLength(0);
    expect(entries).toHaveLength(10 + 32 + 3);
    vi.mocked(getBoxScoreSeasons).mockResolvedValue([2026]);
    vi.mocked(getPlayedRegularSeasonGameIds).mockRejectedValue(new Error("boom"));
    expect((await sitemap()).filter((e) => e.url.includes("/game/"))).toHaveLength(0);
    vi.mocked(getPlayedRegularSeasonGameIds).mockResolvedValue(["2026_01_BUF_HOU"]);
    vi.mocked(getAvailableSeasons).mockRejectedValueOnce(new Error("boom"));
    expect((await sitemap()).filter((e) => e.url.includes("/game/"))).toHaveLength(0);
    // Each of the three failures says so, the way the team and player pages
    // log theirs. Dropping every box score URL in silence is exactly how the
    // no-seasons path above went unnoticed in a no-database build.
    expect(logged).toHaveBeenCalledTimes(3);
    for (const call of logged.mock.calls) {
      expect(String(call[0])).toContain("box score game ids unavailable");
    }
    logged.mockRestore();
  });

  // The sitemap is a link surface, and it was the only one on this branch not
  // applying the address rule that ScheduleSection and GameLogTab apply. An id
  // the page answers 404 for must never be submitted to Google.
  it("runs ids through normalizeGameId: junk is dropped, the rest upper-cased", async () => {
    vi.mocked(getBoxScoreSeasons).mockResolvedValue([2026]);
    vi.mocked(getPlayedRegularSeasonGameIds).mockResolvedValue([
      "2026_01_BUF_HOU",
      "2026_01_ne_sea", // stored lower case: the page upper-cases, so must this
      "  2026_02_DET_BUF  ", // stray whitespace
      "2026_1_BUF_HOU", // one-digit week
      "2026_01_BUFF_HOUS", // four-letter team codes
      "null", // a NULL game_id through String()
      "",
    ] as never);
    const games = (await sitemap()).filter((e) => e.url.includes("/game/"));
    expect(games.map((e) => e.url)).toEqual([
      "https://yardsperpass.com/game/2026_01_BUF_HOU",
      "https://yardsperpass.com/game/2026_01_NE_SEA",
      "https://yardsperpass.com/game/2026_02_DET_BUF",
    ]);
  });

  it("logs the silent path: no seasons from data_freshness means no game URLs", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(getAvailableSeasons).mockResolvedValue([]);
    const entries = await sitemap();
    expect(entries.filter((e) => e.url.includes("/game/"))).toHaveLength(0);
    expect(logged).toHaveBeenCalledTimes(1);
    expect(String(logged.mock.calls[0][0])).toContain("no seasons from data_freshness");
    logged.mockRestore();
  });

  it("regenerates hourly, so new box scores and lastmod don't wait for a deploy (or never come)", () => {
    expect(revalidate).toBe(3600);
  });
});
