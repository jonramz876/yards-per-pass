import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import TecmoStandings from "@/components/team/TecmoStandings";
import { NFL_TEAMS, DIVISIONS } from "@/lib/data/teams";
import type { TeamSeasonStat } from "@/lib/types";

/** A team_season_stats row; only the W/L/T fields matter to the board. */
function stat(teamId: string, over: Partial<TeamSeasonStat> = {}): TeamSeasonStat {
  return {
    id: `${teamId}-2026`,
    team_id: teamId,
    season: 2026,
    off_epa_play: 0,
    def_epa_play: 0,
    off_pass_epa: 0,
    off_rush_epa: 0,
    def_pass_epa: 0,
    def_rush_epa: 0,
    off_success_rate: 0.45,
    def_success_rate: 0.45,
    pass_rate: 0.6,
    plays: 1000,
    wins: 0,
    losses: 0,
    ties: 0,
    takeaways: null,
    giveaways: null,
    turnover_diff: null,
    ...over,
  };
}

/** The card for one division, by its `data-division` marker. */
function divisionCard(container: HTMLElement, division: string): HTMLElement {
  const card = container.querySelector(`[data-division="${division}"]`);
  expect(card).not.toBeNull();
  return card as HTMLElement;
}

/** Team abbreviations in the order the card renders them. */
function rowOrder(card: HTMLElement): string[] {
  return Array.from(card.querySelectorAll("[data-team-id]")).map(
    (row) => row.getAttribute("data-team-id") as string
  );
}

describe("TecmoStandings", () => {
  it("renders all 8 divisions with 4 teams each", () => {
    const { container } = render(<TecmoStandings season={2026} teamStats={[]} />);

    expect(container.querySelectorAll("[data-division]")).toHaveLength(8);
    for (const division of DIVISIONS) {
      expect(rowOrder(divisionCard(container, division))).toHaveLength(4);
    }
    // Every team in the league is on the board exactly once.
    expect(container.querySelectorAll("[data-team-id]")).toHaveLength(32);
  });

  it("shows the season sub-label", () => {
    render(<TecmoStandings season={2026} teamStats={[]} />);
    expect(screen.getByText(/2026 Standings/i)).toBeTruthy();
  });

  it("defaults every team to 0-0 when no stats exist yet", () => {
    const { container } = render(<TecmoStandings season={2026} teamStats={[]} />);

    const rows = Array.from(container.querySelectorAll("[data-team-id]"));
    expect(rows).toHaveLength(32);
    for (const row of rows) {
      expect(row.textContent).toContain("0-0");
    }
  });

  it("sorts a division by wins, best record first", () => {
    const teamStats = [
      stat("BUF", { wins: 9, losses: 8 }),
      stat("MIA", { wins: 13, losses: 4 }),
      stat("NE", { wins: 11, losses: 6 }),
      stat("NYJ", { wins: 2, losses: 15 }),
    ];
    const { container } = render(<TecmoStandings season={2026} teamStats={teamStats} />);

    const card = divisionCard(container, "AFC East");
    expect(rowOrder(card)).toEqual(["MIA", "NE", "BUF", "NYJ"]);
    // The winner's record renders on the winner's row.
    const first = card.querySelectorAll("[data-team-id]")[0];
    expect(first.textContent).toContain("13-4");
  });

  it("keeps teams without a stats row at 0-0 below teams that have won games", () => {
    // Only one AFC West team has played; the other three stay 0-0 beneath it.
    const { container } = render(
      <TecmoStandings season={2026} teamStats={[stat("KC", { wins: 1, losses: 0 })]} />
    );

    const card = divisionCard(container, "AFC West");
    expect(rowOrder(card)[0]).toBe("KC");
    const rows = card.querySelectorAll("[data-team-id]");
    expect(rows[0].textContent).toContain("1-0");
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i].textContent).toContain("0-0");
    }
  });

  it("renders a tie in the record", () => {
    const { container } = render(
      <TecmoStandings season={2026} teamStats={[stat("PIT", { wins: 10, losses: 6, ties: 1 })]} />
    );

    const row = container.querySelector('[data-team-id="PIT"]');
    expect(row?.textContent).toContain("10-6-1");
  });

  it("links every team row to its team page", () => {
    const { container } = render(<TecmoStandings season={2026} teamStats={[]} />);

    for (const team of NFL_TEAMS) {
      const row = container.querySelector(`[data-team-id="${team.id}"]`);
      expect(row?.getAttribute("href")).toBe(`/team/${team.id.toLowerCase()}`);
    }
  });

  it("renders a logo and abbreviation on each row", () => {
    const { container } = render(<TecmoStandings season={2026} teamStats={[]} />);

    const row = container.querySelector('[data-team-id="BUF"]') as HTMLElement;
    expect(within(row).getByAltText("Buffalo Bills")).toBeTruthy();
    expect(row.textContent).toContain("BUF");
  });

  it("bands AFC divisions red and NFC divisions blue", () => {
    const { container } = render(<TecmoStandings season={2026} teamStats={[]} />);

    // jsdom normalizes inline hex to rgb().
    const AFC_RGB = "rgb(200, 16, 46)"; // #C8102E
    const NFC_RGB = "rgb(1, 51, 105)"; // #013369

    for (const division of DIVISIONS) {
      const band = divisionCard(container, division).querySelector("h3") as HTMLElement;
      expect(band.style.background).toBe(division.startsWith("AFC") ? AFC_RGB : NFC_RGB);
      // Band text is auto-contrasted, never hardcoded.
      expect(band.style.color).toBe("rgb(255, 255, 255)");
    }
  });

  it("never prints NaN when a record field is missing", () => {
    const broken = stat("DAL", {
      wins: NaN as unknown as number,
      losses: NaN as unknown as number,
      ties: NaN as unknown as number,
    });
    const { container } = render(<TecmoStandings season={2026} teamStats={[broken]} />);

    const row = container.querySelector('[data-team-id="DAL"]');
    expect(row?.textContent).toContain("0-0");
    expect(container.textContent).not.toContain("NaN");
  });

  /** The real live week-1 rows (2026): NE 0-1, SEA 1-0, LA 0-1, SF 1-0. */
  const WEEK1: TeamSeasonStat[] = [
    stat("NE", { wins: 0, losses: 1 }),
    stat("SEA", { wins: 1, losses: 0 }),
    stat("LA", { wins: 0, losses: 1 }),
    stat("SF", { wins: 1, losses: 0 }),
  ];

  it("week 1 (live rows): lists 0-1 NE below 0-0 BUF, MIA and NYJ", () => {
    const { container } = render(<TecmoStandings season={2026} teamStats={WEEK1} />);

    expect(rowOrder(divisionCard(container, "AFC East"))).toEqual(["BUF", "MIA", "NYJ", "NE"]);
    expect(rowOrder(divisionCard(container, "NFC West"))).toEqual(["SEA", "SF", "ARI", "LA"]);
  });

  it("ranks by win % with a tie as half a win (2025 NFC North: GB 9-7-1 above DET 9-8)", () => {
    const teamStats = [
      stat("CHI", { wins: 11, losses: 6 }),
      stat("DET", { wins: 9, losses: 8 }),
      stat("GB", { wins: 9, losses: 7, ties: 1 }),
      stat("MIN", { wins: 9, losses: 8 }),
    ];
    const { container } = render(<TecmoStandings season={2025} teamStats={teamStats} />);

    expect(rowOrder(divisionCard(container, "NFC North"))).toEqual(["CHI", "GB", "DET", "MIN"]);
  });

  it("puts 3-1 above 3-2 in a bye week even when the 3-2 team is first alphabetically", () => {
    const teamStats = [
      stat("BUF", { wins: 3, losses: 2 }),
      stat("MIA", { wins: 3, losses: 1 }),
      stat("NE", { wins: 2, losses: 2 }),
      stat("NYJ", { wins: 1, losses: 3 }),
    ];
    const { container } = render(<TecmoStandings season={2026} teamStats={teamStats} />);

    expect(rowOrder(divisionCard(container, "AFC East"))).toEqual(["MIA", "BUF", "NE", "NYJ"]);
  });

  it("puts 3-1 above 4-2 (win %, not raw wins)", () => {
    // NE and NYJ have no row, so they read 0-0 = .500.
    const teamStats = [stat("BUF", { wins: 4, losses: 2 }), stat("MIA", { wins: 3, losses: 1 })];
    const { container } = render(<TecmoStandings season={2026} teamStats={teamStats} />);

    expect(rowOrder(divisionCard(container, "AFC East"))).toEqual(["MIA", "BUF", "NE", "NYJ"]);
  });

  it("at the same win %, more games over .500 ranks higher (5-0 above 4-0, 0-2 above 0-3)", () => {
    const teamStats = [
      stat("BUF", { wins: 4, losses: 0 }),
      stat("MIA", { wins: 5, losses: 0 }),
      stat("NE", { wins: 0, losses: 3 }),
      stat("NYJ", { wins: 0, losses: 2 }),
    ];
    const { container } = render(<TecmoStandings season={2026} teamStats={teamStats} />);

    expect(rowOrder(divisionCard(container, "AFC East"))).toEqual(["MIA", "BUF", "NYJ", "NE"]);
  });

  it("puts a 1-0 team above the 0-0 teams even when it is last alphabetically", () => {
    const { container } = render(
      <TecmoStandings season={2026} teamStats={[stat("LV", { wins: 1 })]} />
    );

    expect(rowOrder(divisionCard(container, "AFC West"))).toEqual(["LV", "DEN", "KC", "LAC"]);
  });

  it("orders an all-0-0 division alphabetically", () => {
    const { container } = render(<TecmoStandings season={2026} teamStats={[]} />);

    expect(rowOrder(divisionCard(container, "AFC East"))).toEqual(["BUF", "MIA", "NE", "NYJ"]);
    expect(rowOrder(divisionCard(container, "NFC West"))).toEqual(["ARI", "LA", "SEA", "SF"]);
    expect(rowOrder(divisionCard(container, "AFC West"))).toEqual(["DEN", "KC", "LAC", "LV"]);
  });

  it("orders level records alphabetically (0-0-1 tie level with 0-0)", () => {
    const { container } = render(
      <TecmoStandings season={2026} teamStats={[stat("NYJ", { ties: 1 })]} />
    );

    expect(rowOrder(divisionCard(container, "AFC East"))).toEqual(["BUF", "MIA", "NE", "NYJ"]);
    const row = container.querySelector('[data-team-id="NYJ"]');
    expect(row?.textContent).toContain("0-0-1");
  });
});
