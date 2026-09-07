import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import ScheduleSection from "@/components/team/ScheduleSection";
import type { TeamGame, TeamSeasonStat } from "@/lib/types";

/**
 * Fixture: a BUF season. `game` builds one row already reduced to the team's
 * perspective (that derivation lives in lib/data/games.ts). Scores are null for
 * unplayed games — the whole point of `played`.
 */
function game(week: number, o: Partial<TeamGame> = {}): TeamGame {
  const opponent = o.opponent_id ?? "HOU";
  const homeAway = o.home_away ?? "home";
  const base: TeamGame = {
    game_id: `2026_${String(week).padStart(2, "0")}_BUF_${opponent}`,
    season: 2026,
    game_type: "REG",
    week,
    gameday: "2026-09-13",
    weekday: "Sunday",
    gametime: "13:00",
    home_team: homeAway === "home" ? "BUF" : opponent,
    away_team: homeAway === "home" ? opponent : "BUF",
    home_score: null,
    away_score: null,
    opponent_id: opponent,
    home_away: homeAway,
    played: false,
    result: null,
    team_score: null,
    opponent_score: null,
  };
  return { ...base, ...o };
}

/** Played game shorthand: fills scores + result from the team's perspective. */
function final(week: number, teamScore: number, oppScore: number, o: Partial<TeamGame> = {}): TeamGame {
  const g = game(week, o);
  const result = teamScore > oppScore ? "W" : teamScore < oppScore ? "L" : "T";
  return {
    ...g,
    played: true,
    result,
    team_score: teamScore,
    opponent_score: oppScore,
    home_score: g.home_away === "home" ? teamScore : oppScore,
    away_score: g.home_away === "home" ? oppScore : teamScore,
  };
}

// Weeks 1-2 played, 3-5 upcoming, week 6 BYE, week 7 upcoming.
const schedule: TeamGame[] = [
  final(1, 27, 20, { opponent_id: "HOU", home_away: "away", gameday: "2026-09-13" }),
  final(2, 24, 31, { opponent_id: "DET", gameday: "2026-09-17", weekday: "Thursday", gametime: "20:15" }),
  game(3, { opponent_id: "LAC", gameday: "2026-09-27" }),
  game(4, { opponent_id: "NE", gameday: "2026-10-04" }),
  game(5, { opponent_id: "LA", home_away: "away", gameday: "2026-10-12", weekday: "Monday", gametime: "20:15" }),
  // week 6 = bye
  game(7, { opponent_id: "LV", home_away: "away", gameday: "2026-10-25", gametime: "16:25" }),
];

const teamStats = { wins: 1, losses: 1, ties: 0 } as TeamSeasonStat;

function renderSchedule(over: Partial<React.ComponentProps<typeof ScheduleSection>> = {}) {
  return render(
    <ScheduleSection
      schedule={schedule}
      teamName="Buffalo Bills"
      primaryColor="#00338D"
      secondaryColor="#C60C30"
      teamStats={teamStats}
      {...over}
    />,
  );
}

describe("ScheduleSection (Tecmo season grid)", () => {
  it("renders one tile per game plus bye tiles at the missing weeks", () => {
    const { container } = renderSchedule();
    expect(container.querySelectorAll("[data-game-id]").length).toBe(6);

    const byes = container.querySelectorAll("[data-bye-week]");
    expect(byes.length).toBe(1);
    expect(byes[0].getAttribute("data-bye-week")).toBe("6");
    expect(byes[0].textContent).toContain("BYE");
  });

  it("places the bye tile in week order between weeks 5 and 7", () => {
    const { container } = renderSchedule();
    const tiles = Array.from(container.querySelectorAll("[data-game-id], [data-bye-week]"));
    const labels = tiles.map((t) =>
      t.getAttribute("data-bye-week") ? `BYE${t.getAttribute("data-bye-week")}` : t.textContent!.slice(0, 2),
    );
    expect(labels).toEqual(["W1", "W2", "W3", "W4", "W5", "BYE6", "W7"]);
  });

  it("paints win, loss and upcoming tiles with their own states", () => {
    const { container } = renderSchedule();
    const tile = (week: number) =>
      container.querySelectorAll("[data-game-id]")[week - 1] as HTMLElement;

    const w1 = tile(1);
    expect(w1.getAttribute("data-state")).toBe("win");
    expect(w1.textContent).toContain("W");
    expect(w1.textContent).toContain("27-20");
    expect(w1.getAttribute("style")).toContain("rgb(20, 83, 45)"); // #14532d

    const w2 = tile(2);
    expect(w2.getAttribute("data-state")).toBe("loss");
    expect(w2.textContent).toContain("24-31");
    expect(w2.getAttribute("style")).toContain("rgb(127, 29, 29)"); // #7f1d1d

    const w3 = tile(3);
    expect(w3.getAttribute("data-state")).toBe("upcoming");
    expect(w3.textContent).toContain("SUN");
    expect(w3.textContent).toContain("1:00"); // 13:00 ET → 12-hour, no am/pm
    expect(w3.textContent).not.toContain("27-20");
  });

  it("gives a tie its own slate tile, distinct from an unplayed game", () => {
    const { container } = renderSchedule({
      schedule: [final(3, 20, 20, { opponent_id: "LAC", gameday: "2026-09-27" })],
    });
    const tile = container.querySelector("[data-game-id]")! as HTMLElement;
    expect(tile.getAttribute("data-state")).toBe("tie");
    expect(tile.textContent).toContain("T");
    expect(tile.textContent).toContain("20-20");
    // Slate-700 #334155 / #64748b — NOT the upcoming pair (#1e293b / #334155),
    // so a played tie can never read as a game that hasn't kicked off.
    expect(tile.getAttribute("style")).toContain("rgb(51, 65, 85)");
    expect(tile.getAttribute("style")).toContain("rgb(100, 116, 139)");
    expect(tile.getAttribute("style")).not.toContain("rgb(30, 41, 59)");
    // A tie is played, so it never carries the kickoff line or the next border.
    expect(tile.textContent).not.toContain("SUN");
    expect(tile.getAttribute("data-next")).toBeNull();
  });

  it("marks only the next unplayed game with the bright border", () => {
    const { container } = renderSchedule();
    const next = container.querySelectorAll('[data-next="true"]');
    expect(next.length).toBe(1);
    expect(next[0].getAttribute("data-game-id")).toContain("_03_"); // week 3
    expect(next[0].getAttribute("style")).toContain("rgb(96, 165, 250)"); // #60a5fa
  });

  it("renders a 20:15 kickoff as 8:15 and keeps the weekday", () => {
    const { container } = renderSchedule();
    const w5 = container.querySelectorAll("[data-game-id]")[4];
    expect(w5.textContent).toContain("MON");
    expect(w5.textContent).toContain("8:15");
  });

  it("omits the kickoff line when gametime is null", () => {
    const { container } = renderSchedule({
      schedule: [game(3, { opponent_id: "LAC", gametime: null })],
    });
    const tile = container.querySelector("[data-game-id]")!;
    expect(tile.textContent).toContain("LAC");
    expect(tile.textContent).not.toContain("SUN");
    expect(tile.textContent).not.toContain(":");
    expect(tile.textContent).not.toContain("null");
  });

  it("links every opponent to their team page, with @ for road games", () => {
    const { container } = renderSchedule();
    const links = Array.from(container.querySelectorAll("a"));
    expect(links.length).toBe(6);
    expect(container.querySelector('a[href="/team/HOU"]')!.textContent).toBe("@HOU");
    expect(container.querySelector('a[href="/team/DET"]')!.textContent).toBe("DET");
    expect(container.querySelector('a[href="/team/LA"]')!.textContent).toBe("@LA");
  });

  it("appends playoff tiles labeled by round and never treats them as byes", () => {
    const { container } = renderSchedule({
      schedule: [
        ...schedule,
        game(19, { game_type: "WC", opponent_id: "MIA", gameday: "2027-01-10" }),
        final(20, 21, 17, { game_type: "DIV", opponent_id: "KC", gameday: "2027-01-17" }),
      ],
    });
    // Weeks 8-18 have no rows, but the REG-scoped bye rule stops at week 7.
    expect(container.querySelectorAll("[data-bye-week]").length).toBe(1);

    const tiles = Array.from(container.querySelectorAll("[data-game-id], [data-bye-week]"));
    expect(tiles.length).toBe(9);
    expect(tiles[7].textContent).toContain("WC");
    expect(tiles[8].textContent).toContain("DIV");
    expect(tiles[8].textContent).toContain("21-17");
  });

  it("stops the bye grid at the last REG week (2020's 17-week season)", () => {
    // 16 games across weeks 1-17 with week 9 off — the REG-scoped max week is
    // 17, so there must be no phantom week-18 bye.
    const weeks = Array.from({ length: 17 }, (_, i) => i + 1).filter((w) => w !== 9);
    const { container } = renderSchedule({
      schedule: weeks.map((w) => game(w, { opponent_id: "MIA", gameday: "2020-09-13" })),
    });

    expect(container.querySelectorAll("[data-game-id]").length).toBe(16);

    const byes = container.querySelectorAll("[data-bye-week]");
    expect(byes.length).toBe(1);
    expect(byes[0].getAttribute("data-bye-week")).toBe("9");
    expect(container.querySelector('[data-bye-week="18"]')).toBeNull();

    const tiles = Array.from(container.querySelectorAll("[data-game-id], [data-bye-week]"));
    expect(tiles.length).toBe(17);
    // The bye sits at its own week position, and week 17 closes the grid.
    expect(tiles[8].getAttribute("data-bye-week")).toBe("9");
    expect(tiles[16].textContent).toContain("W17");
  });

  it("gives every tile a descriptive title tooltip", () => {
    const { container } = renderSchedule();
    const tiles = Array.from(container.querySelectorAll("[data-game-id], [data-bye-week]"));
    expect(tiles.every((t) => (t.getAttribute("title") ?? "").length > 0)).toBe(true);

    const w1 = container.querySelectorAll("[data-game-id]")[0].getAttribute("title")!;
    expect(w1).toContain("Week 1");
    expect(w1).toContain("Sun Sep 13");
    expect(w1).toContain("at Houston Texans");
    expect(w1).toContain("Final: W 27-20");

    const w3 = container.querySelectorAll("[data-game-id]")[2].getAttribute("title")!;
    expect(w3).toContain("1:00 PM ET");
    expect(w3).toContain("vs Los Angeles Chargers");
    expect(w3).not.toContain("Final");
  });

  it("shows the record in the band, and omits it when teamStats is null", () => {
    const { rerender } = renderSchedule();
    expect(screen.getByText("Schedule & Results")).toBeTruthy();
    expect(screen.getByText("1-1")).toBeTruthy();

    rerender(
      <ScheduleSection
        schedule={schedule}
        teamName="Buffalo Bills"
        primaryColor="#00338D"
        secondaryColor="#C60C30"
        teamStats={null}
      />,
    );
    expect(screen.getByText("Schedule & Results")).toBeTruthy();
    expect(screen.queryByText("1-1")).toBeNull();
    expect(document.body.textContent).not.toContain("undefined");
    expect(document.body.textContent).not.toContain("NaN");
  });

  it("labels the band with the year and drops the record on an upcoming season", () => {
    // Pre-week-1: the page hands over NEXT season's slate. teamStats is still
    // the viewed (finished) season's, so the record must NOT ride along.
    renderSchedule({
      schedule: [1, 2, 3].map((w) => game(w, { opponent_id: "MIA", gameday: "2027-09-12" })),
      upcomingSeason: 2027,
    });
    expect(screen.getByText("Schedule · 2027")).toBeTruthy();
    expect(screen.queryByText("Schedule & Results")).toBeNull();
    expect(screen.queryByText("1-1")).toBeNull();
    expect(document.body.textContent).not.toContain("undefined");
    expect(document.body.textContent).not.toContain("NaN");
  });

  it("names the year in the grid's aria-label on an upcoming season", () => {
    // The upcoming section renders ABOVE the viewed season's, so the two grids
    // must not carry the same label.
    const viewed = renderSchedule();
    expect(
      viewed.container.querySelector('[aria-label="Buffalo Bills schedule and results"]'),
    ).toBeTruthy();

    const upcoming = renderSchedule({
      schedule: [1, 2, 3].map((w) => game(w, { opponent_id: "MIA", gameday: "2027-09-12" })),
      upcomingSeason: 2027,
    });
    expect(upcoming.container.querySelector('[aria-label="Buffalo Bills 2027 schedule"]')).toBeTruthy();
    expect(
      upcoming.container.querySelector('[aria-label="Buffalo Bills schedule and results"]'),
    ).toBeNull();
  });

  it("marks week 1 as next when no game has been played yet", () => {
    const { container } = renderSchedule({
      schedule: [1, 2, 3].map((w) => game(w, { opponent_id: "MIA", gameday: "2027-09-12" })),
      upcomingSeason: 2027,
    });
    const next = container.querySelectorAll('[data-next="true"]');
    expect(next.length).toBe(1);
    expect(next[0].getAttribute("data-game-id")).toContain("_01_");
    expect(next[0].getAttribute("style")).toContain("rgb(96, 165, 250)"); // #60a5fa
  });

  it("includes ties in the record", () => {
    renderSchedule({ teamStats: { wins: 9, losses: 7, ties: 1 } as TeamSeasonStat });
    expect(screen.getByText("9-7-1")).toBeTruthy();
  });

  it("renders nothing when the team has no schedule rows", () => {
    const { container } = renderSchedule({ schedule: [] });
    expect(container.innerHTML).toBe("");
  });
});
