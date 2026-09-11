import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import DivisionRivals from "@/components/team/DivisionRivals";
import type { TeamSeasonStat } from "@/lib/types";

/** A team_season_stats row; the strip reads W/L/T and the two EPA columns. */
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

/**
 * The real live week-1 rows (2026), with distinct EPA so the league ranks are
 * fixed: offense SEA, SF, LA, NE; defense (lower is better) SEA, SF, LA, NE.
 */
const WEEK1: TeamSeasonStat[] = [
  stat("NE", { wins: 0, losses: 1, off_epa_play: -0.2, def_epa_play: 0.2 }),
  stat("SEA", { wins: 1, losses: 0, off_epa_play: 0.2, def_epa_play: -0.2 }),
  stat("LA", { wins: 0, losses: 1, off_epa_play: -0.1, def_epa_play: 0.1 }),
  stat("SF", { wins: 1, losses: 0, off_epa_play: 0.1, def_epa_play: -0.1 }),
];

/** The strip as BUF's page renders it, unless a prop is overridden. */
function renderRivals(
  allTeamStats: TeamSeasonStat[],
  over: Partial<React.ComponentProps<typeof DivisionRivals>> = {},
) {
  return render(
    <DivisionRivals
      allTeamStats={allTeamStats}
      division="AFC East"
      currentTeamId="BUF"
      primaryColor="#00338D"
      secondaryColor="#C60C30"
      {...over}
    />,
  );
}

/** Rival card links, in the order the strip renders them. */
function rivalHrefs(container: HTMLElement): (string | null)[] {
  return Array.from(container.querySelectorAll('a[href^="/team/"]')).map((a) =>
    a.getAttribute("href"),
  );
}

/** One rival's card, by its (lowercase) team id. */
function rivalCard(container: HTMLElement, id: string): HTMLElement {
  const card = container.querySelector(`a[href="/team/${id}"]`);
  expect(card).not.toBeNull();
  return card as HTMLElement;
}

describe("DivisionRivals", () => {
  it("lists all three rivals from NFL_TEAMS even before anyone has played", () => {
    const { container } = renderRivals([]);

    expect(rivalHrefs(container)).toEqual(["/team/mia", "/team/ne", "/team/nyj"]);
    expect(screen.queryByText("No division rival stats available.")).toBeNull();
    for (const card of Array.from(container.querySelectorAll('a[href^="/team/"]'))) {
      expect(card.textContent).toContain("0-0");
    }
    // Off and Def pills on each of the three cards.
    expect(screen.getAllByText("—")).toHaveLength(6);
    expect(container.textContent).not.toContain("0th");
    expect(container.textContent).not.toContain("NaN");
  });

  it("week 1 (live rows): BUF's strip shows MIA and NYJ at 0-0 above 0-1 NE", () => {
    const { container } = renderRivals(WEEK1);

    expect(rivalHrefs(container)).toEqual(["/team/mia", "/team/nyj", "/team/ne"]);

    // NE is last in both off and def EPA among the four rows.
    const ne = rivalCard(container, "ne");
    expect(ne.textContent).toContain("0-1");
    expect(ne.textContent).toContain("4th");

    for (const id of ["mia", "nyj"]) {
      const card = rivalCard(container, id);
      expect(card.textContent).toContain("0-0");
      expect(within(card).getAllByText("—")).toHaveLength(2);
    }
  });

  it("week 1 (live rows): SEA's strip includes 0-0 ARI between 1-0 SF and 0-1 LA", () => {
    const { container } = renderRivals(WEEK1, { division: "NFC West", currentTeamId: "SEA" });

    expect(rivalHrefs(container)).toEqual(["/team/sf", "/team/ari", "/team/la"]);
  });

  it("never includes the current team", () => {
    for (const pool of [[], WEEK1]) {
      const { container, unmount } = renderRivals(pool);
      expect(rivalHrefs(container)).not.toContain("/team/buf");
      unmount();
    }
    const { container } = renderRivals(WEEK1, { division: "NFC West", currentTeamId: "SEA" });
    expect(rivalHrefs(container)).not.toContain("/team/sea");
  });

  it("sorts rivals by win %: 9-7-1 above 9-8", () => {
    const { container } = renderRivals(
      [
        stat("GB", { wins: 9, losses: 7, ties: 1, off_epa_play: -0.1 }),
        stat("DET", { wins: 9, losses: 8, off_epa_play: 0.2 }),
        stat("MIN", { wins: 9, losses: 8, off_epa_play: 0.1 }),
      ],
      { division: "NFC North", currentTeamId: "CHI" },
    );

    expect(rivalHrefs(container)).toEqual(["/team/gb", "/team/det", "/team/min"]);
  });

  it("sorts rivals by win %: 3-1 above 3-2 even with worse offense", () => {
    const { container } = renderRivals([
      stat("MIA", { wins: 3, losses: 2, off_epa_play: 0.3 }),
      stat("NE", { wins: 3, losses: 1, off_epa_play: -0.3 }),
      stat("NYJ", { wins: 2, losses: 2 }),
    ]);

    expect(rivalHrefs(container)).toEqual(["/team/ne", "/team/mia", "/team/nyj"]);
  });

  it("keeps offensive EPA as the tiebreak between rivals with level records", () => {
    const { container } = renderRivals(
      [
        stat("DET", { wins: 9, losses: 8, off_epa_play: 0.05 }),
        stat("MIN", { wins: 9, losses: 8, off_epa_play: 0.1 }),
        stat("GB", { wins: 11, losses: 6 }),
      ],
      { division: "NFC North", currentTeamId: "CHI" },
    );

    expect(rivalHrefs(container)).toEqual(["/team/gb", "/team/min", "/team/det"]);
  });

  it("falls back to A→Z when level rivals have no EPA to compare", () => {
    // MIA and NYJ rows carry no usable EPA; NE has no row at all. All three
    // are 0-0 with nothing to break the tie, so the strip reads A→Z.
    const { container } = renderRivals([
      stat("MIA", { off_epa_play: NaN }),
      stat("NYJ", { off_epa_play: NaN }),
    ]);

    expect(rivalHrefs(container)).toEqual(["/team/mia", "/team/ne", "/team/nyj"]);
  });
});
