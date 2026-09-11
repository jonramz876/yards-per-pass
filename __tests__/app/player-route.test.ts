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
  default: () => null,
}));

vi.mock("@/components/ui/Breadcrumbs", () => ({
  default: () => null,
}));

import PlayerPage, { generateMetadata } from "@/app/player/[slug]/page";
import { getPlayerBySlug } from "@/lib/data/players";

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
