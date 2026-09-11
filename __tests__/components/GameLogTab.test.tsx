import { describe, it, expect } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import GameLogTab from "@/components/player/GameLogTab";
import type { ReceiverWeeklyStat } from "@/lib/types";

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
      <GameLogTab weeklyStats={[{ ...base, ...noRoutes }]} position="WR" season={2026} teamId="SEA" />
    );
    const col = routesColumn(container);
    expect(col).toBeGreaterThan(-1);
    expect(cellText(container, 0, col)).toBe("—");
  });

  it("Routes shows the count when present", () => {
    const { container } = render(
      <GameLogTab weeklyStats={[base]} position="WR" season={2026} teamId="SEA" />
    );
    expect(cellText(container, 0, routesColumn(container))).toBe("31");
  });

  it("sorting by Routes puts the unknown week last", () => {
    const rows: ReceiverWeeklyStat[] = [
      { ...base, week: 1, ...noRoutes },
      { ...base, week: 2, routes_run: 31 },
    ];
    const { container } = render(
      <GameLogTab weeklyStats={rows} position="WR" season={2026} teamId="SEA" />
    );
    const col = routesColumn(container);
    fireEvent.click(container.querySelectorAll("thead th")[col]);
    expect(cellText(container, 0, 0)).toBe("2");
    expect(cellText(container, 1, col)).toBe("—");
  });
});
