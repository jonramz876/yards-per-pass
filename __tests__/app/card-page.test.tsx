import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import type { TecmoCardData } from "@/lib/stats/tecmo-card";

vi.mock("next/navigation", () => ({
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
}));

vi.mock("@/lib/data/players", () => ({ getPlayerBySlug: vi.fn() }));

vi.mock("@/lib/data/queries", () => ({
  getAvailableSeasons: vi.fn(),
  fallbackSeason: () => 2026,
}));

vi.mock("@/lib/data/card", () => ({
  getCardDataForPlayer: vi.fn(),
  getLatestCardSeason: vi.fn(),
}));

import CardPage, { generateMetadata } from "@/app/card/[slug]/page";
import { getPlayerBySlug } from "@/lib/data/players";
import { getAvailableSeasons } from "@/lib/data/queries";
import { getCardDataForPlayer, getLatestCardSeason } from "@/lib/data/card";

const mahomes = {
  player_id: "00-0033873",
  slug: "patrick-mahomes",
  player_name: "Patrick Mahomes",
  position: "QB",
  current_team_id: "KC",
  headshot_url: null,
  jersey_number: 15,
};

const aubrey = {
  player_id: "00-0038391",
  slug: "brandon-aubrey",
  player_name: "Brandon Aubrey",
  position: "K",
  current_team_id: "DAL",
  headshot_url: null,
  jersey_number: 17,
};

const card: TecmoCardData = {
  playerName: "Patrick Mahomes", position: "QB", season: 2025, games: 17,
  archetypeLabel: null, eligible: true, ovr: 90,
  statCells: [{ label: "S0", value: "0" }],
  abilityRows: [{ label: "EPA/DROPBACK", raw: "+0.21", percentile: 96, missing: false }],
  radarValues: [], radarLabels: [],
};

const SEASONS = [2026, 2025, 2024, 2023, 2022, 2021, 2020];

const call = (slug: string, season?: string) =>
  CardPage({
    params: Promise.resolve({ slug }),
    searchParams: Promise.resolve(season ? { season } : {}),
  });

const md = (slug: string, season?: string) =>
  generateMetadata({
    params: Promise.resolve({ slug }),
    searchParams: Promise.resolve(season ? { season } : {}),
  });

beforeEach(() => {
  vi.mocked(getPlayerBySlug).mockReset();
  vi.mocked(getAvailableSeasons).mockReset();
  vi.mocked(getCardDataForPlayer).mockReset();
  vi.mocked(getLatestCardSeason).mockReset();
  vi.mocked(getAvailableSeasons).mockResolvedValue(SEASONS);
});

describe("CardPage", () => {
  it("unknown slug → notFound (unchanged)", async () => {
    vi.mocked(getPlayerBySlug).mockResolvedValue(null);
    await expect(call("not-a-real-player")).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("week-1 regression: no ?season, Mahomes has no 2026 row → 200 message, not 404", async () => {
    vi.mocked(getPlayerBySlug).mockResolvedValue(mahomes);
    vi.mocked(getCardDataForPlayer).mockResolvedValue(null);
    vi.mocked(getLatestCardSeason).mockResolvedValue(2025);
    const { container } = render(await call("patrick-mahomes"));
    expect(screen.getByText("No 2026 card yet for Patrick Mahomes")).toBeTruthy();
    const link = container.querySelector('a[href="/card/patrick-mahomes?season=2025"]');
    expect(link).not.toBeNull();
    expect(link?.textContent).toContain("See his 2025 card");
    expect(container.querySelector('a[href="/player/patrick-mahomes"]')).not.toBeNull();
    expect(screen.queryByText("Download Image")).toBeNull();
    expect(screen.queryByText("Copy Link")).toBeNull();
    // No silent fallback: the 2026 season is the only one looked up.
    expect(vi.mocked(getCardDataForPlayer).mock.calls).toHaveLength(1);
    expect(vi.mocked(getCardDataForPlayer).mock.calls[0][1]).toBe(2026);
  });

  it("explicit ?season=2026 without a row → same message", async () => {
    vi.mocked(getPlayerBySlug).mockResolvedValue(mahomes);
    vi.mocked(getCardDataForPlayer).mockResolvedValue(null);
    vi.mocked(getLatestCardSeason).mockResolvedValue(2025);
    render(await call("patrick-mahomes", "2026"));
    expect(screen.getByText("No 2026 card yet for Patrick Mahomes")).toBeTruthy();
    expect(vi.mocked(getCardDataForPlayer).mock.calls[0][1]).toBe(2026);
  });

  it("kicker → 'No stat card' message, profile link only", async () => {
    vi.mocked(getPlayerBySlug).mockResolvedValue(aubrey);
    vi.mocked(getCardDataForPlayer).mockResolvedValue(null);
    vi.mocked(getLatestCardSeason).mockResolvedValue(null);
    const { container } = render(await call("brandon-aubrey"));
    expect(screen.getByText("No stat card for Brandon Aubrey")).toBeTruthy();
    expect(container.textContent).toContain("quarterbacks, receivers and running backs");
    expect(container.querySelector('a[href^="/card/"]')).toBeNull();
    expect(container.querySelector('a[href="/player/brandon-aubrey"]')).not.toBeNull();
  });

  it("card position with no card in any season → message with profile link only", async () => {
    vi.mocked(getPlayerBySlug).mockResolvedValue(mahomes);
    vi.mocked(getCardDataForPlayer).mockResolvedValue(null);
    vi.mocked(getLatestCardSeason).mockResolvedValue(null);
    const { container } = render(await call("patrick-mahomes"));
    expect(container.querySelector('a[href^="/card/"]')).toBeNull();
    expect(container.querySelector('a[href="/player/patrick-mahomes"]')).not.toBeNull();
  });

  it("past season without a row → 'has no stats for the 2024 season' + link to newest card", async () => {
    vi.mocked(getPlayerBySlug).mockResolvedValue(mahomes);
    vi.mocked(getCardDataForPlayer).mockResolvedValue(null);
    vi.mocked(getLatestCardSeason).mockResolvedValue(2025);
    const { container } = render(await call("patrick-mahomes", "2024"));
    expect(screen.getByText("No 2024 card for Patrick Mahomes")).toBeTruthy();
    expect(container.textContent).toContain("has no stats for the 2024 season");
    expect(
      container.querySelector('a[href="/card/patrick-mahomes?season=2025"]'),
    ).not.toBeNull();
  });

  it("latest card season equal to the requested one → no self-link", async () => {
    vi.mocked(getPlayerBySlug).mockResolvedValue(mahomes);
    vi.mocked(getCardDataForPlayer).mockResolvedValue(null);
    vi.mocked(getLatestCardSeason).mockResolvedValue(2026);
    const { container } = render(await call("patrick-mahomes", "2026"));
    expect(
      container.querySelector('a[href="/card/patrick-mahomes?season=2026"]'),
    ).toBeNull();
  });

  it("latest card season the site has no data for → no link (it would 404)", async () => {
    vi.mocked(getPlayerBySlug).mockResolvedValue(mahomes);
    vi.mocked(getCardDataForPlayer).mockResolvedValue(null);
    vi.mocked(getLatestCardSeason).mockResolvedValue(2019);
    const { container } = render(await call("patrick-mahomes"));
    expect(container.querySelector('a[href^="/card/"]')).toBeNull();
  });

  it("card present → card + Copy Link + Download, no message (2025 unchanged)", async () => {
    vi.mocked(getPlayerBySlug).mockResolvedValue(mahomes);
    vi.mocked(getCardDataForPlayer).mockResolvedValue(card);
    const { container } = render(await call("patrick-mahomes", "2025"));
    expect(screen.getByText("Download Image")).toBeTruthy();
    expect(screen.getByText("View full player profile →")).toBeTruthy();
    expect(container.querySelector("[data-card-message]")).toBeNull();
    expect(getLatestCardSeason).not.toHaveBeenCalled();
  });

  it("?season=2099 → notFound, no stats query", async () => {
    vi.mocked(getPlayerBySlug).mockResolvedValue(mahomes);
    await expect(call("patrick-mahomes", "2099")).rejects.toThrow("NEXT_NOT_FOUND");
    expect(getCardDataForPlayer).not.toHaveBeenCalled();
  });

  it("?season=99999999999999999999 → notFound, never reaches the DB", async () => {
    vi.mocked(getPlayerBySlug).mockResolvedValue(mahomes);
    await expect(
      call("patrick-mahomes", "99999999999999999999"),
    ).rejects.toThrow("NEXT_NOT_FOUND");
    expect(getCardDataForPlayer).not.toHaveBeenCalled();
  });

  it("stats query throws → notFound (unchanged)", async () => {
    vi.mocked(getPlayerBySlug).mockResolvedValue(mahomes);
    vi.mocked(getCardDataForPlayer).mockRejectedValue(new Error("boom"));
    await expect(call("patrick-mahomes", "2025")).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("empty seasons list → fallbackSeason() used, message still renders", async () => {
    vi.mocked(getAvailableSeasons).mockResolvedValue([]);
    vi.mocked(getPlayerBySlug).mockResolvedValue(mahomes);
    vi.mocked(getCardDataForPlayer).mockResolvedValue(null);
    vi.mocked(getLatestCardSeason).mockResolvedValue(null);
    const { container } = render(await call("patrick-mahomes"));
    expect(vi.mocked(getCardDataForPlayer).mock.calls[0][1]).toBe(2026);
    expect(container.textContent).toContain("No 2026 card yet");
  });

  it("special-character names render as text", async () => {
    vi.mocked(getCardDataForPlayer).mockResolvedValue(null);
    vi.mocked(getLatestCardSeason).mockResolvedValue(null);
    vi.mocked(getPlayerBySlug).mockResolvedValue({
      ...mahomes, slug: "dandre-swift", player_name: "D'Andre Swift", position: "RB",
    });
    const swift = render(await call("dandre-swift"));
    expect(swift.container.textContent).toContain("No 2026 card yet for D'Andre Swift");

    vi.mocked(getPlayerBySlug).mockResolvedValue({
      ...mahomes, slug: "amon-ra-st-brown", player_name: "Amon-Ra St. Brown", position: "WR",
    });
    const stBrown = render(await call("amon-ra-st-brown"));
    expect(stBrown.container.textContent).toContain("No 2026 card yet for Amon-Ra St. Brown");
  });
});

describe("card generateMetadata", () => {
  it("canonical and og:url carry ?season= when requested", async () => {
    vi.mocked(getPlayerBySlug).mockResolvedValue(mahomes);
    vi.mocked(getCardDataForPlayer).mockResolvedValue(card);
    const meta = await md("patrick-mahomes", "2025");
    expect(meta.alternates?.canonical).toBe(
      "https://yardsperpass.com/card/patrick-mahomes?season=2025",
    );
    expect(meta.openGraph?.url).toBe(
      "https://yardsperpass.com/card/patrick-mahomes?season=2025",
    );
  });

  it("canonical is bare without a valid ?season=", async () => {
    vi.mocked(getPlayerBySlug).mockResolvedValue(mahomes);
    vi.mocked(getCardDataForPlayer).mockResolvedValue(card);
    for (const season of [undefined, "abc", "2099"]) {
      const meta = await md("patrick-mahomes", season);
      expect(meta.alternates?.canonical).toBe("https://yardsperpass.com/card/patrick-mahomes");
    }
  });

  it("message page (no 2026 row) is noindex, follow", async () => {
    vi.mocked(getPlayerBySlug).mockResolvedValue(mahomes);
    vi.mocked(getCardDataForPlayer).mockResolvedValue(null);
    const meta = await md("patrick-mahomes");
    expect(meta.robots).toEqual({ index: false, follow: true });
  });

  it("card page stays indexable", async () => {
    vi.mocked(getPlayerBySlug).mockResolvedValue(mahomes);
    vi.mocked(getCardDataForPlayer).mockResolvedValue(card);
    const meta = await md("patrick-mahomes", "2025");
    expect("robots" in meta).toBe(false);
  });

  it("kicker is noindex without querying stats", async () => {
    vi.mocked(getPlayerBySlug).mockResolvedValue(aubrey);
    const meta = await md("brandon-aubrey");
    expect(getCardDataForPlayer).not.toHaveBeenCalled();
    expect(meta.robots).toEqual({ index: false, follow: true });
  });

  it("stats lookup throws → no robots override, no throw", async () => {
    vi.mocked(getPlayerBySlug).mockResolvedValue(mahomes);
    vi.mocked(getCardDataForPlayer).mockRejectedValue(new Error("boom"));
    const meta = await md("patrick-mahomes", "2025");
    expect("robots" in meta).toBe(false);
  });

  it("unknown slug → 'Player Not Found' title (unchanged)", async () => {
    vi.mocked(getPlayerBySlug).mockResolvedValue(null);
    const meta = await md("not-a-real-player");
    expect(String(meta.title)).toContain("Player Not Found");
  });
});
