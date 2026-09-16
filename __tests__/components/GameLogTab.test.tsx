import { describe, it, expect } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import GameLogTab from "@/components/player/GameLogTab";
import type { GameResultsByTeam, ReceiverWeeklyStat } from "@/lib/types";

const base: ReceiverWeeklyStat = {
  player_id: "00-0038543", season: 2026, week: 1, team_id: "SEA", opponent_id: "NE",
  home_away: "home", result: "W", team_score: 27, opponent_score: 20,
  targets: 11, receptions: 8, receiving_yards: 92, receiving_tds: 1,
  epa_per_target: 0.7, catch_rate: 0.727, yac: 31, yac_per_reception: 3.9,
  adot: 6.9, air_yards: 76, routes_run: 31, yards_per_route_run: 2.97,
};

// No participation file (2026 until nflverse publishes it): the DB holds NULL.
const noRoutes: Partial<ReceiverWeeklyStat> = {
  routes_run: null as unknown as number,
  yards_per_route_run: null as unknown as number,
};

function routesColumn(container: HTMLElement): number {
  const headers = Array.from(container.querySelectorAll("thead th"));
  return headers.findIndex((th) => (th.textContent ?? "").startsWith("Routes"));
}

function cellText(container: HTMLElement, rowIndex: number, col: number): string | null {
  const row = container.querySelectorAll("tbody tr")[rowIndex];
  return row.querySelectorAll("td")[col].textContent;
}

describe("GameLogTab — Routes column", () => {
  it("Routes shows an em dash when routes_run is null (no participation file)", () => {
    const { container } = render(
      <GameLogTab weeklyStats={[{ ...base, ...noRoutes }]} position="WR" season={2026} teamId="SEA" gameResults={{}} />
    );
    const col = routesColumn(container);
    expect(col).toBeGreaterThan(-1);
    expect(cellText(container, 0, col)).toBe("—");
  });

  it("Routes shows the count when present", () => {
    const { container } = render(
      <GameLogTab weeklyStats={[base]} position="WR" season={2026} teamId="SEA" gameResults={{}} />
    );
    expect(cellText(container, 0, routesColumn(container))).toBe("31");
  });

  it("sorting by Routes puts the unknown week last", () => {
    const rows: ReceiverWeeklyStat[] = [
      { ...base, week: 1, ...noRoutes },
      { ...base, week: 2, routes_run: 31 },
    ];
    const { container } = render(
      <GameLogTab weeklyStats={rows} position="WR" season={2026} teamId="SEA" gameResults={{}} />
    );
    const col = routesColumn(container);
    fireEvent.click(container.querySelectorAll("thead th")[col]);
    expect(cellText(container, 0, 0)).toBe("2");
    expect(cellText(container, 1, col)).toBe("—");
  });
});

/** Text of the Result cell in the row for `week` (BYE/DNP rows have only 2 cells). */
function resultFor(container: HTMLElement, week: number): string | null {
  const headers = Array.from(container.querySelectorAll("thead th"));
  const col = headers.findIndex((th) => (th.textContent ?? "").startsWith("Result"));
  const row = Array.from(container.querySelectorAll("tbody tr")).find(
    (tr) => tr.querySelectorAll("td").length > 2 && tr.querySelector("td")?.textContent === String(week)
  );
  return row ? row.querySelectorAll("td")[col].textContent : null;
}

describe("GameLogTab — Result comes from the schedule (box score spec §9)", () => {
  // Tyler Lockett, 2025: TEN through week 7, LV from week 9. His player page's
  // teamId prop is LV, his current team. Stored scores are the live DB values.
  const lockettWk5: ReceiverWeeklyStat = {
    ...base, player_id: "00-0032211", season: 2025, week: 5, team_id: "TEN", opponent_id: "ARI",
    home_away: "away", result: "L", team_score: 19, opponent_score: 21,
  };
  const lockettWk14: ReceiverWeeklyStat = {
    ...lockettWk5, week: 14, team_id: "LV", opponent_id: "DEN", home_away: "home", team_score: 14, opponent_score: 24,
  };
  const schedule: GameResultsByTeam = {
    TEN: { 5: { game_id: "2025_05_TEN_ARI", team_score: 22, opponent_score: 21, result: "W", opponent_id: "ARI" } },
    LV: {
      5: { game_id: "2025_05_LV_IND", team_score: 6, opponent_score: 40, result: "L", opponent_id: "IND" },
      14: { game_id: "2025_14_DEN_LV", team_score: 17, opponent_score: 24, result: "L", opponent_id: "DEN" },
    },
  };

  it("shows the schedule's final score, not the stored one", () => {
    const { container } = render(
      <GameLogTab weeklyStats={[lockettWk5]} position="WR" season={2025} teamId="TEN" gameResults={schedule} />
    );
    expect(resultFor(container, 5)).toBe("W 22-21");
  });

  it("looks each row up by its own team, never the player's current team", () => {
    const { container } = render(
      <GameLogTab weeklyStats={[lockettWk5, lockettWk14]} position="WR" season={2025} teamId="LV" gameResults={schedule} />
    );
    expect(resultFor(container, 5)).toBe("W 22-21"); // TEN's week 5 — not LV's "L 6-40"
    expect(resultFor(container, 14)).toBe("L 17-24");
  });

  it("works after the results cross the server → client boundary (week keys become strings)", () => {
    const serialized = JSON.parse(JSON.stringify(schedule)) as GameResultsByTeam;
    const { container } = render(
      <GameLogTab weeklyStats={[lockettWk5]} position="WR" season={2025} teamId="LV" gameResults={serialized} />
    );
    expect(resultFor(container, 5)).toBe("W 22-21");
  });

  it("shows a tie from the schedule as T", () => {
    // Values from Dak Prescott's 2025 week 4 row: stored 40-37, final 40-40.
    const dal: ReceiverWeeklyStat = { ...base, season: 2025, week: 4, team_id: "DAL", opponent_id: "GB", team_score: 40, opponent_score: 37 };
    const tie: GameResultsByTeam = {
      DAL: { 4: { game_id: "2025_04_GB_DAL", team_score: 40, opponent_score: 40, result: "T", opponent_id: "GB" } },
    };
    const { container } = render(
      <GameLogTab weeklyStats={[dal]} position="WR" season={2025} teamId="DAL" gameResults={tie} />
    );
    expect(resultFor(container, 4)).toBe("T 40-40");
  });

  it("falls back to the stored score when the schedule has no game for the row", () => {
    const { container } = render(
      <GameLogTab weeklyStats={[base]} position="WR" season={2026} teamId="SEA" gameResults={{}} />
    );
    expect(resultFor(container, 1)).toBe("W 27-20");
  });

  it("ignores a schedule entry whose opponent doesn't match the row", () => {
    const otherGame: GameResultsByTeam = {
      SEA: { 1: { game_id: "2025_01_SF_SEA", team_score: 13, opponent_score: 17, result: "L", opponent_id: "SF" } },
    };
    const { container } = render(
      <GameLogTab weeklyStats={[base]} position="WR" season={2026} teamId="SEA" gameResults={otherGame} />
    );
    expect(resultFor(container, 1)).toBe("W 27-20");
  });

  it("shows a dash when there is no schedule game and the stored score isn't a number", () => {
    const blank: ReceiverWeeklyStat = { ...base, team_score: NaN, opponent_score: NaN };
    const { container } = render(
      <GameLogTab weeklyStats={[blank]} position="WR" season={2026} teamId="SEA" gameResults={{}} />
    );
    expect(resultFor(container, 1)).toBe("—");
  });
});
