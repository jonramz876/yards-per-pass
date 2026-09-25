import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => "/player/patrick-mahomes",
  useSearchParams: () => new URLSearchParams(),
}));

import PlayerHeader from "@/components/player/PlayerHeader";
import PlayerPageContent from "@/components/player/PlayerPageContent";
import { rbCarryEpaAverage, formatStat } from "@/lib/stats/formatters";
import type { RBSeasonStat } from "@/lib/types";

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
        gameResults={{}}
        boxScoreSeasons={[]}
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

// Spec A §4.4 (T10): the Game Log's EPA colours use the season average of the
// player's own kind of play, computed from the page's full season pool.
describe("PlayerPageContent → GameLogTab epaAverage wiring", () => {
  const cook = { ...mahomes, player_id: "00-0038545", slug: "james-cook", player_name: "James Cook", position: "RB", current_team_id: "BUF" };
  const week1 = {
    player_id: cook.player_id, season: 2026, week: 1, team_id: "BUF", opponent_id: "HOU", home_away: "away",
    result: "W", team_score: 30, opponent_score: 20, carries: 13, rushing_yards: 57, rushing_tds: 0,
    epa_per_carry: -0.01, success_rate: 0.38, yards_per_carry: 4.4, stuff_rate: 0.2, explosive_rate: 0.1,
    targets: 2, receptions: 2, receiving_yards: 10, receiving_tds: 0, fumbles: 0, fumbles_lost: 0,
  };

  it("RB: the average passed is rbCarryEpaAverage(allPlayers)", () => {
    // (-0.06 x 200 + -0.12 x 200) / 400 = -0.09
    const pool = [
      { player_id: "a", epa_per_carry: -0.06, carries: 200 },
      { player_id: "b", epa_per_carry: -0.12, carries: 200 },
    ];
    const expected = rbCarryEpaAverage(pool as unknown as RBSeasonStat[]);
    expect(expected).toBeCloseTo(-0.09, 12);
    const { container } = render(
      <PlayerPageContent
        player={cook}
        seasonStats={[{ player_id: cook.player_id }]}
        weeklyStats={[week1]}
        allPlayers={pool}
        season={2026}
        seasons={SEASONS}
        position="RB"
        tab="game-log"
        gameResults={{}}
        boxScoreSeasons={[]}
      />,
    );
    expect(container.textContent).toContain(`2026 league average (${formatStat("epa_per_carry", expected!)} per running-back carry)`);
  });
});
