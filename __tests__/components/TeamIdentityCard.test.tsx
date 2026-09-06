import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import TeamIdentityCard from "@/components/team/TeamIdentityCard";
import { getTeam } from "@/lib/data/teams";
import type { TeamSeasonStat } from "@/lib/types";

const BUF = getTeam("BUF")!;

/** A team_season_stats row with everything the header could read. */
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
 * Six-team pool. Offense sorts desc (KC, PHI, BUF → BUF is 3rd); defense sorts
 * asc since lower EPA is better (NE, NYJ, KC, PHI, BUF → BUF is 5th). Division
 * wins put MIA (13) ahead of BUF (12) → BUF is 2nd in the AFC East.
 */
const ALL: TeamSeasonStat[] = [
  stat("KC", { off_epa_play: 0.3, def_epa_play: -0.1, wins: 14, losses: 3 }),
  stat("PHI", { off_epa_play: 0.2, def_epa_play: -0.05, wins: 13, losses: 4 }),
  stat("BUF", {
    off_epa_play: 0.1,
    def_epa_play: 0.02,
    wins: 12,
    losses: 5,
    takeaways: 25,
    giveaways: 16,
    turnover_diff: 9,
  }),
  stat("MIA", { off_epa_play: 0.05, def_epa_play: 0.1, wins: 13, losses: 4 }),
  stat("NE", { off_epa_play: -0.05, def_epa_play: -0.2, wins: 9, losses: 8 }),
  stat("NYJ", { off_epa_play: -0.1, def_epa_play: -0.15, wins: 4, losses: 13 }),
];

const bufStats = ALL.find((t) => t.team_id === "BUF")!;

function renderCard(over: Partial<React.ComponentProps<typeof TeamIdentityCard>> = {}) {
  return render(
    <TeamIdentityCard team={BUF} teamStats={bufStats} allTeamStats={ALL} {...over} />,
  );
}

/** Same pool with one BUF field changed. */
function poolWithBuf(over: Partial<TeamSeasonStat>): TeamSeasonStat[] {
  return ALL.map((t) => (t.team_id === "BUF" ? { ...t, ...over } : t));
}

describe("TeamIdentityCard (Tecmo header)", () => {
  describe("with season stats", () => {
    it("bands the team name and its division", () => {
      renderCard();
      expect(screen.getByRole("heading", { name: "Buffalo Bills" })).toBeInTheDocument();
      expect(screen.getByText("AFC East")).toBeInTheDocument();
    });

    it("renders the record with the division rank", () => {
      renderCard();
      expect(screen.getByText("12-5 · 2nd AFC East")).toBeInTheDocument();
    });

    it("renders EPA ranks and a signed turnover differential", () => {
      renderCard();
      expect(
        screen.getByText("Off EPA 3rd · Def EPA 5th · TO Diff +9"),
      ).toBeInTheDocument();
    });

    it("shows the team logo", () => {
      renderCard();
      expect(screen.getByRole("img", { name: "Buffalo Bills" })).toBeInTheDocument();
    });

    it("includes the ties leg of the record only when there are ties", () => {
      renderCard({
        teamStats: { ...bufStats, wins: 9, losses: 7, ties: 1 },
        allTeamStats: poolWithBuf({ wins: 9, losses: 7, ties: 1 }),
      });
      expect(screen.getByText(/^9-7-1 · /)).toBeInTheDocument();
    });

    it("gives teams tied on wins the same division rank", () => {
      // MIA 13, BUF 13, NE 9, NYJ 4 — BUF and MIA both sit 1st.
      const tied = poolWithBuf({ wins: 13, losses: 4 });
      renderCard({ teamStats: tied.find((t) => t.team_id === "BUF")!, allTeamStats: tied });
      expect(screen.getByText("13-4 · 1st AFC East")).toBeInTheDocument();
    });

    it("shows a negative turnover differential with a minus sign", () => {
      const pool = poolWithBuf({ takeaways: 13, giveaways: 16, turnover_diff: -3 });
      renderCard({ teamStats: pool.find((t) => t.team_id === "BUF")!, allTeamStats: pool });
      expect(screen.getByText(/TO Diff -3$/)).toBeInTheDocument();
    });

    it("drops the turnover leg when the column is null", () => {
      // Rows ingested before takeaways/giveaways existed.
      expect(bufStats.turnover_diff).toBe(9);
      const pool = poolWithBuf({ takeaways: null, giveaways: null, turnover_diff: null });
      const { container } = renderCard({
        teamStats: pool.find((t) => t.team_id === "BUF")!,
        allTeamStats: pool,
      });
      expect(screen.getByText("Off EPA 3rd · Def EPA 5th")).toBeInTheDocument();
      expect(container.textContent).not.toContain("TO Diff");
      expect(container.textContent).not.toMatch(/null|undefined|NaN/);
    });

    it("drops an EPA leg whose value is NaN (parseNumericFields turns nulls into NaN)", () => {
      const pool = poolWithBuf({ off_epa_play: NaN });
      const { container } = renderCard({
        teamStats: pool.find((t) => t.team_id === "BUF")!,
        allTeamStats: pool,
      });
      expect(container.textContent).not.toContain("Off EPA");
      expect(container.textContent).not.toContain("NaN");
      expect(screen.getByText(/^Def EPA /)).toBeInTheDocument();
    });
  });

  describe("pre-season launch state (teamStats null)", () => {
    it("still renders the band, name, division and logo", () => {
      renderCard({ teamStats: null });
      expect(screen.getByRole("heading", { name: "Buffalo Bills" })).toBeInTheDocument();
      expect(screen.getByText("AFC East")).toBeInTheDocument();
      expect(screen.getByRole("img", { name: "Buffalo Bills" })).toBeInTheDocument();
    });

    it("omits the record/rank pixel lines entirely", () => {
      const { container } = renderCard({ teamStats: null });
      expect(container.textContent).not.toContain("Off EPA");
      expect(container.textContent).not.toContain("Def EPA");
      expect(container.textContent).not.toContain("TO Diff");
      expect(container.textContent).not.toMatch(/\d+-\d+/);
    });

    it("never leaks undefined or NaN", () => {
      const { container } = renderCard({ teamStats: null, allTeamStats: [] });
      expect(container.textContent).not.toMatch(/undefined|NaN|null/);
    });
  });
});
