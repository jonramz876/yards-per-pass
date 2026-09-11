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

  describe("division rank (standings order)", () => {
    /** The real live week-1 rows (2026): NE 0-1, SEA 1-0, LA 0-1, SF 1-0. */
    const WEEK1: TeamSeasonStat[] = [
      stat("NE", { wins: 0, losses: 1 }),
      stat("SEA", { wins: 1, losses: 0 }),
      stat("LA", { wins: 0, losses: 1 }),
      stat("SF", { wins: 1, losses: 0 }),
    ];

    /** Header for `teamId`, fed its own row from `pool`. */
    function renderTeam(teamId: string, pool: TeamSeasonStat[]) {
      return render(
        <TeamIdentityCard
          team={getTeam(teamId)!}
          teamStats={pool.find((t) => t.team_id === teamId)!}
          allTeamStats={pool}
        />,
      );
    }

    it("week 1 (live rows): 0-1 NE is 4th behind 0-0 rivals that have no stats row", () => {
      renderTeam("NE", WEEK1);
      expect(screen.getByText("0-1 · 4th AFC East")).toBeInTheDocument();
    });

    it("week 1 (live rows): 0-1 LA is 4th behind 1-0 SEA, 1-0 SF and 0-0 ARI", () => {
      renderTeam("LA", WEEK1);
      expect(screen.getByText("0-1 · 4th NFC West")).toBeInTheDocument();
    });

    it("week 1 (live rows): 1-0 SEA and 1-0 SF share 1st", () => {
      renderTeam("SEA", WEEK1);
      expect(screen.getByText("1-0 · 1st NFC West")).toBeInTheDocument();
    });

    it("counts a tie as half a win: 9-7-1 ranks above 9-8", () => {
      // BUF 9-7-1, MIA 9-8, NE 8-9, NYJ 4-13 (NYJ is already 4-13 in ALL).
      const pool = poolWithBuf({ wins: 9, losses: 7, ties: 1 }).map((t) =>
        t.team_id === "MIA"
          ? { ...t, wins: 9, losses: 8 }
          : t.team_id === "NE"
            ? { ...t, wins: 8, losses: 9 }
            : t,
      );
      renderTeam("BUF", pool);
      expect(screen.getByText("9-7-1 · 1st AFC East")).toBeInTheDocument();
      renderTeam("MIA", pool);
      expect(screen.getByText("9-8 · 2nd AFC East")).toBeInTheDocument();
    });

    it("2025 NFC North: 9-8 DET is 3rd behind 11-6 CHI and 9-7-1 GB, level with 9-8 MIN", () => {
      const pool = [
        stat("CHI", { wins: 11, losses: 6 }),
        stat("DET", { wins: 9, losses: 8 }),
        stat("GB", { wins: 9, losses: 7, ties: 1 }),
        stat("MIN", { wins: 9, losses: 8 }),
      ];
      renderTeam("DET", pool);
      expect(screen.getByText("9-8 · 3rd NFC North")).toBeInTheDocument();
    });

    it("bye week: 3-2 ranks below 3-1", () => {
      renderTeam("BUF", [stat("BUF", { wins: 3, losses: 2 }), stat("MIA", { wins: 3, losses: 1 })]);
      expect(screen.getByText("3-2 · 2nd AFC East")).toBeInTheDocument();
    });

    it("bye week: 4-2 ranks below 3-1 (win %, not raw wins)", () => {
      renderTeam("BUF", [stat("BUF", { wins: 4, losses: 2 }), stat("MIA", { wins: 3, losses: 1 })]);
      expect(screen.getByText("4-2 · 2nd AFC East")).toBeInTheDocument();
    });

    it("a rival row with NaN counts reads as 0-0 and never breaks the rank", () => {
      const pool = [
        stat("BUF", { wins: 0, losses: 1 }),
        stat("MIA", { wins: NaN, losses: NaN, ties: NaN }),
      ];
      const { container } = renderTeam("BUF", pool);
      expect(screen.getByText("0-1 · 4th AFC East")).toBeInTheDocument();
      expect(container.textContent).not.toContain("NaN");
    });
  });
});
