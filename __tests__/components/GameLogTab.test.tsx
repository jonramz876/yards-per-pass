import { describe, it, expect } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import GameLogTab from "@/components/player/GameLogTab";
import type { GameResultsByTeam, ReceiverWeeklyStat, RBWeeklyStat } from "@/lib/types";

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
      <GameLogTab weeklyStats={[{ ...base, ...noRoutes }]} position="WR" season={2026} teamId="SEA" gameResults={{}} boxScoreSeasons={[]} />
    );
    const col = routesColumn(container);
    expect(col).toBeGreaterThan(-1);
    expect(cellText(container, 0, col)).toBe("—");
  });

  it("Routes shows the count when present", () => {
    const { container } = render(
      <GameLogTab weeklyStats={[base]} position="WR" season={2026} teamId="SEA" gameResults={{}} boxScoreSeasons={[]} />
    );
    expect(cellText(container, 0, routesColumn(container))).toBe("31");
  });

  it("sorting by Routes puts the unknown week last", () => {
    const rows: ReceiverWeeklyStat[] = [
      { ...base, week: 1, ...noRoutes },
      { ...base, week: 2, routes_run: 31 },
    ];
    const { container } = render(
      <GameLogTab weeklyStats={rows} position="WR" season={2026} teamId="SEA" gameResults={{}} boxScoreSeasons={[]} />
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
      <GameLogTab weeklyStats={[lockettWk5]} position="WR" season={2025} teamId="TEN" gameResults={schedule} boxScoreSeasons={[]} />
    );
    expect(resultFor(container, 5)).toBe("W 22-21");
  });

  it("looks each row up by its own team, never the player's current team", () => {
    const { container } = render(
      <GameLogTab weeklyStats={[lockettWk5, lockettWk14]} position="WR" season={2025} teamId="LV" gameResults={schedule} boxScoreSeasons={[]} />
    );
    expect(resultFor(container, 5)).toBe("W 22-21"); // TEN's week 5 — not LV's "L 6-40"
    expect(resultFor(container, 14)).toBe("L 17-24");
  });

  it("works after the results cross the server → client boundary (week keys become strings)", () => {
    const serialized = JSON.parse(JSON.stringify(schedule)) as GameResultsByTeam;
    const { container } = render(
      <GameLogTab weeklyStats={[lockettWk5]} position="WR" season={2025} teamId="LV" gameResults={serialized} boxScoreSeasons={[]} />
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
      <GameLogTab weeklyStats={[dal]} position="WR" season={2025} teamId="DAL" gameResults={tie} boxScoreSeasons={[]} />
    );
    expect(resultFor(container, 4)).toBe("T 40-40");
  });

  it("falls back to the stored score when the schedule has no game for the row", () => {
    const { container } = render(
      <GameLogTab weeklyStats={[base]} position="WR" season={2026} teamId="SEA" gameResults={{}} boxScoreSeasons={[]} />
    );
    expect(resultFor(container, 1)).toBe("W 27-20");
  });

  it("ignores a schedule entry whose opponent doesn't match the row", () => {
    const otherGame: GameResultsByTeam = {
      SEA: { 1: { game_id: "2025_01_SF_SEA", team_score: 13, opponent_score: 17, result: "L", opponent_id: "SF" } },
    };
    const { container } = render(
      <GameLogTab weeklyStats={[base]} position="WR" season={2026} teamId="SEA" gameResults={otherGame} boxScoreSeasons={[]} />
    );
    expect(resultFor(container, 1)).toBe("W 27-20");
  });

  it("ignores a malformed schedule entry and falls back to the stored score", () => {
    const malformed = {
      SEA: { 1: { game_id: "2026_01_NE_SEA", team_score: null, opponent_score: NaN, result: "X", opponent_id: "NE" } },
    } as unknown as GameResultsByTeam;
    const { container } = render(
      <GameLogTab weeklyStats={[base]} position="WR" season={2026} teamId="SEA" gameResults={malformed} boxScoreSeasons={[]} />
    );
    expect(resultFor(container, 1)).toBe("W 27-20");
  });

  it("ignores negative schedule scores and falls back to the stored score", () => {
    const negative: GameResultsByTeam = {
      SEA: { 1: { game_id: "2026_01_NE_SEA", team_score: -5, opponent_score: -3, result: "L", opponent_id: "NE" } },
    };
    const { container } = render(
      <GameLogTab weeklyStats={[base]} position="WR" season={2026} teamId="SEA" gameResults={negative} boxScoreSeasons={[]} />
    );
    expect(resultFor(container, 1)).toBe("W 27-20");
  });

  it("shows a dash when there is no schedule game and the stored score isn't a number", () => {
    const blank: ReceiverWeeklyStat = { ...base, team_score: NaN, opponent_score: NaN };
    const { container } = render(
      <GameLogTab weeklyStats={[blank]} position="WR" season={2026} teamId="SEA" gameResults={{}} boxScoreSeasons={[]} />
    );
    expect(resultFor(container, 1)).toBe("—");
  });
});

describe("GameLogTab — Result links to the box score (box score spec §7)", () => {
  const schedule: GameResultsByTeam = {
    TEN: { 5: { game_id: "2025_05_TEN_ARI", team_score: 22, opponent_score: 21, result: "W", opponent_id: "ARI" } },
  };
  const wk5: ReceiverWeeklyStat = {
    ...base, player_id: "00-0032211", season: 2025, week: 5, team_id: "TEN", opponent_id: "ARI",
    home_away: "away", result: "L", team_score: 19, opponent_score: 21,
  };

  function resultCell(container: HTMLElement, week: number): HTMLTableCellElement {
    const headers = Array.from(container.querySelectorAll("thead th"));
    const col = headers.findIndex((th) => (th.textContent ?? "").startsWith("Result"));
    const row = Array.from(container.querySelectorAll("tbody tr")).find(
      (tr) => tr.querySelectorAll("td").length > 2 && tr.querySelector("td")?.textContent === String(week)
    )!;
    return row.querySelectorAll("td")[col];
  }

  it("links the schedule result when the row's season has box scores", () => {
    const { container } = render(
      <GameLogTab weeklyStats={[wk5]} position="WR" season={2025} teamId="TEN" gameResults={schedule} boxScoreSeasons={[2026, 2025]} />
    );
    const link = resultCell(container, 5).querySelector("a[data-box-score-link]")!;
    expect(link.getAttribute("href")).toBe("/game/2025_05_TEN_ARI");
    expect(link.textContent).toBe("W 22-21");
  });

  it("links nothing for a season without box scores (2025 until the backfill) or an empty list", () => {
    for (const seasons of [[2026], []]) {
      const { container } = render(
        <GameLogTab weeklyStats={[wk5]} position="WR" season={2025} teamId="TEN" gameResults={schedule} boxScoreSeasons={seasons} />
      );
      const cell = resultCell(container, 5);
      expect(cell.querySelector("a")).toBeNull();
      expect(cell.textContent).toBe("W 22-21");
    }
  });

  // Chaos ERROR 4: this gate had no id guard at all, so a corrupt row produced
  // /game/null, /game/undefined, /game and /game/2026_01 NE_SEA — a "W 22-21"
  // the visitor clicks into a 404. Same rule as ScheduleSection: GAME_ID_PATTERN.
  it("never links a result whose game_id is missing or not a game id", () => {
    for (const bad of [null, undefined, "", "   ", "2026_01 NE_SEA", "2026_1_TEN_ARI"]) {
      const broken: GameResultsByTeam = {
        TEN: { 5: { ...schedule.TEN[5], game_id: bad as unknown as string } },
      };
      const { container } = render(
        <GameLogTab weeklyStats={[wk5]} position="WR" season={2025} teamId="TEN" gameResults={broken} boxScoreSeasons={[2025]} />
      );
      const cell = resultCell(container, 5);
      expect(cell.querySelector("a")).toBeNull();
      // …and the cell reads exactly as an unlinked result does today.
      expect(cell.textContent).toBe("W 22-21");
    }
  });

  it("never links a stored-score fallback, even in a covered season", () => {
    const { container } = render(
      <GameLogTab weeklyStats={[base]} position="WR" season={2026} teamId="SEA" gameResults={{}} boxScoreSeasons={[2026]} />
    );
    const cell = resultCell(container, 1);
    expect(cell.querySelector("a")).toBeNull();
    expect(cell.textContent).toBe("W 27-20");
  });

  it("works after the props cross the server → client boundary, and with no list at runtime", () => {
    const serialized = JSON.parse(JSON.stringify({ schedule, seasons: [2025] }));
    const { container } = render(
      <GameLogTab weeklyStats={[wk5]} position="WR" season={2025} teamId="TEN" gameResults={serialized.schedule} boxScoreSeasons={serialized.seasons} />
    );
    expect(resultCell(container, 5).querySelector("a")?.getAttribute("href")).toBe("/game/2025_05_TEN_ARI");
    const { container: none } = render(
      <GameLogTab weeklyStats={[wk5]} position="WR" season={2025} teamId="TEN" gameResults={schedule} boxScoreSeasons={undefined as unknown as number[]} />
    );
    expect(resultCell(none, 5).textContent).toBe("W 22-21");
  });
});

// Spec A §4.4 (T10): the Game Log colours each game's EPA against the season's
// league average for that kind of play, not against zero (0.00 used to be green,
// and every back's ordinary game red).
describe("GameLogTab — EPA colours against the league average", () => {
  const rbGame = (week: number, epa: number): RBWeeklyStat => ({
    player_id: "00-0038545", season: 2026, week, team_id: "BUF", opponent_id: `O${week}`,
    home_away: "home", result: "W", team_score: 30, opponent_score: 20,
    carries: 13, rushing_yards: 57, rushing_tds: 0, epa_per_carry: epa, success_rate: 0.38,
    yards_per_carry: 4.4, stuff_rate: 0.2, explosive_rate: 0.1, targets: 2, receptions: 2,
    receiving_yards: 10, receiving_tds: 0, fumbles: 0, fumbles_lost: 0,
  });

  function epaClass(container: HTMLElement, label: string, week: number): string {
    const headers = Array.from(container.querySelectorAll("thead th"));
    const col = headers.findIndex((th) => (th.textContent ?? "").startsWith(label));
    const row = Array.from(container.querySelectorAll("tbody tr")).find(
      (tr) => tr.querySelectorAll("td").length > 2 && tr.querySelector("td")?.textContent === String(week),
    )!;
    return row.querySelectorAll("td")[col].className;
  }
  function legend(container: HTMLElement): string | null {
    const p = Array.from(container.querySelectorAll("p")).find((el) => (el.textContent ?? "").startsWith("EPA colours compare"));
    return p ? p.textContent : null;
  }

  it("RB: -0.05 and +0.20 are green, -0.10 grey, -0.14 red against a -0.10 average", () => {
    const rows = [rbGame(1, -0.05), rbGame(2, 0.2), rbGame(3, -0.1), rbGame(4, -0.14)];
    const { container } = render(
      <GameLogTab weeklyStats={rows} position="RB" season={2026} teamId="BUF" gameResults={{}} boxScoreSeasons={[]} epaAverage={-0.1} />
    );
    expect(epaClass(container, "EPA/Car", 1)).toContain("text-green-600");
    expect(epaClass(container, "EPA/Car", 2)).toContain("text-green-600");
    expect(epaClass(container, "EPA/Car", 3)).toContain("text-gray-700");
    expect(epaClass(container, "EPA/Car", 4)).toContain("text-red-600");
    const text = legend(container);
    expect(text).toContain("2026 league average (-0.10 per running-back carry)");
    expect(text).toContain("grey = within 0.03");
    expect(text).not.toMatch(/\\u[0-9a-fA-F]{4}/);
  });

  it("with no average yet, every EPA cell is uncoloured and there is no legend", () => {
    const rows = [rbGame(1, -0.05), rbGame(2, 0.2), rbGame(3, 0)];
    const { container } = render(
      <GameLogTab weeklyStats={rows} position="RB" season={2026} teamId="BUF" gameResults={{}} boxScoreSeasons={[]} epaAverage={null} />
    );
    for (const w of [1, 2, 3]) {
      expect(epaClass(container, "EPA/Car", w)).toContain("text-gray-700");
      expect(epaClass(container, "EPA/Car", w)).not.toMatch(/text-(red|green)-/);
    }
    expect(legend(container)).toBeNull();
  });

  it("WR: uses the target band (0.06)", () => {
    const rows: ReceiverWeeklyStat[] = [
      { ...base, week: 1, epa_per_target: 0.28 },
      { ...base, week: 2, epa_per_target: 0.3 },
      { ...base, week: 3, epa_per_target: 0.16 },
    ];
    const { container } = render(
      <GameLogTab weeklyStats={rows} position="WR" season={2026} teamId="SEA" gameResults={{}} boxScoreSeasons={[]} epaAverage={0.23} />
    );
    expect(epaClass(container, "EPA/Tgt", 1)).toContain("text-gray-700"); // +0.05: within 0.06
    expect(epaClass(container, "EPA/Tgt", 2)).toContain("text-green-600");
    expect(epaClass(container, "EPA/Tgt", 3)).toContain("text-red-600");
    expect(legend(container)).toContain("(0.23 per target)");
    expect(legend(container)).toContain("grey = within 0.06");
  });
});
