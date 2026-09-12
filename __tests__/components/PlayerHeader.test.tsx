import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => "/player/patrick-mahomes",
  useSearchParams: () => new URLSearchParams(),
}));

import PlayerHeader from "@/components/player/PlayerHeader";
import PlayerPageContent from "@/components/player/PlayerPageContent";

const mahomes = {
  player_id: "00-0033873",
  slug: "patrick-mahomes",
  player_name: "Patrick Mahomes",
  position: "QB",
  current_team_id: "KC",
  headshot_url: null,
  jersey_number: 15,
};

const maye = {
  player_id: "00-0039732",
  slug: "drake-maye",
  player_name: "Drake Maye",
  position: "QB",
  current_team_id: "NE",
  headshot_url: null,
  jersey_number: 10,
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

const SEASONS = [2026, 2025, 2024, 2023, 2022, 2021, 2020];

describe("PlayerHeader Share Card", () => {
  it("shows Share Card linked to the viewed season when hasCard", () => {
    const { container } = render(
      <PlayerHeader player={maye} season={2026} seasons={SEASONS} hasCard />,
    );
    const link = container.querySelector('a[href="/card/drake-maye?season=2026"]');
    expect(link).not.toBeNull();
    expect(link?.textContent).toBe("Share Card");
  });

  it("week-1 regression: hasCard=false hides Share Card", () => {
    const { container } = render(
      <PlayerHeader player={mahomes} season={2026} seasons={SEASONS} hasCard={false} />,
    );
    expect(container.querySelector('a[href^="/card/"]')).toBeNull();
    expect(screen.queryByText("Share Card")).toBeNull();
    // The rest of the header is untouched.
    expect(screen.getByText("Compare")).toBeTruthy();
    expect(container.querySelector("select")).not.toBeNull();
  });

  it("2025 view keeps its Share Card (unchanged)", () => {
    const { container } = render(
      <PlayerHeader player={mahomes} season={2025} seasons={SEASONS} hasCard />,
    );
    expect(
      container.querySelector('a[href="/card/patrick-mahomes?season=2025"]'),
    ).not.toBeNull();
  });
});

describe("PlayerPageContent → PlayerHeader hasCard wiring", () => {
  // tab="game-log" keeps the fixtures tiny: GameLogTab renders an empty state.
  function renderContent(
    player: typeof mahomes,
    position: string,
    seasonStats: unknown[],
  ) {
    return render(
      <PlayerPageContent
        player={player}
        seasonStats={seasonStats}
        weeklyStats={[]}
        allPlayers={[]}
        season={2026}
        seasons={SEASONS}
        position={position}
        tab="game-log"
      />,
    );
  }

  it("QB with a stat row this season → Share Card shown", () => {
    const { container } = renderContent(mahomes, "QB", [{ player_id: mahomes.player_id }]);
    expect(
      container.querySelector('a[href="/card/patrick-mahomes?season=2026"]'),
    ).not.toBeNull();
  });

  it("QB with no row this season (Mahomes, 2026, week 1) → hidden", () => {
    const { container } = renderContent(mahomes, "QB", []);
    expect(container.querySelector('a[href^="/card/"]')).toBeNull();
  });

  it("kicker → hidden even with a row", () => {
    const { container } = renderContent(aubrey, "K", [{ player_id: aubrey.player_id }]);
    expect(container.querySelector('a[href^="/card/"]')).toBeNull();
  });

  it("FB with a row → shown (FBs use RB cards)", () => {
    const { container } = renderContent(mahomes, "FB", [{ player_id: mahomes.player_id }]);
    expect(
      container.querySelector('a[href="/card/patrick-mahomes?season=2026"]'),
    ).not.toBeNull();
  });

  it("empty position string → hidden", () => {
    const { container } = renderContent(mahomes, "", [{ player_id: mahomes.player_id }]);
    expect(container.querySelector('a[href^="/card/"]')).toBeNull();
  });
});
