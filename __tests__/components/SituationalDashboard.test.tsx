import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import SituationalDashboard from "@/components/team/SituationalDashboard";
import { parseNumericFields } from "@/lib/utils";
import type { TeamSituationalStat } from "@/lib/types";

// Same field list as SIT_NUMERIC in lib/data/team-hub.ts:25. It isn't exported, and
// importing team-hub.ts would pull the Supabase server client into this test.
const SIT_NUMERIC: string[] = ["plays", "epa_per_play", "success_rate", "pass_rate", "rush_epa_per_play", "pass_epa_per_play", "rush_success_rate", "pass_success_rate"];

// Real rows: Supabase team_situational_stats, season 2026, team NE (fetched 2026-09-11).
// NE ran ZERO times in the red zone and at the goal line, so rush_epa_per_play /
// rush_success_rate come back from Supabase as the string "NaN".
const NE_2026_RAW = [
  { team_id: "NE", season: 2026, situation: "all", plays: 67, epa_per_play: -0.1096282705405689, success_rate: 0.417910447761194, pass_rate: 0.5373134328358209, rush_epa_per_play: -0.08786257971716564, pass_epa_per_play: -0.1283709487496106, rush_success_rate: 0.3548387096774194, pass_success_rate: 0.4722222222222222 },
  { team_id: "NE", season: 2026, situation: "early_down", plays: 49, epa_per_play: -0.1306293424407771, success_rate: 0.40816326530612246, pass_rate: 0.46938775510204084, rush_epa_per_play: -0.18003685676376335, pass_epa_per_play: -0.07477736972783611, rush_success_rate: 0.3076923076923077, pass_success_rate: 0.5217391304347826 },
  { team_id: "NE", season: 2026, situation: "goalline", plays: 1, epa_per_play: 0.8406261451600585, success_rate: 1.0, pass_rate: 1.0, rush_epa_per_play: "NaN", pass_epa_per_play: 0.8406261451600585, rush_success_rate: "NaN", pass_success_rate: 1.0 },
  { team_id: "NE", season: 2026, situation: "late_close", plays: 19, epa_per_play: -0.24785080437217594, success_rate: 0.42105263157894735, pass_rate: 0.6842105263157895, rush_epa_per_play: 0.10886103030255374, pass_epa_per_play: -0.4124870357605127, rush_success_rate: 0.6666666666666666, pass_success_rate: 0.3076923076923077 },
  { team_id: "NE", season: 2026, situation: "passing_down", plays: 24, epa_per_play: -0.28366816715932514, success_rate: 0.4166666666666667, pass_rate: 0.7083333333333334, rush_epa_per_play: 0.45115607188615414, pass_epa_per_play: -0.5862428538251108, rush_success_rate: 0.5714285714285714, pass_success_rate: 0.35294117647058826 },
  { team_id: "NE", season: 2026, situation: "redzone", plays: 2, epa_per_play: -0.9130950444814516, success_rate: 0.5, pass_rate: 1.0, rush_epa_per_play: "NaN", pass_epa_per_play: -0.9130950444814516, rush_success_rate: "NaN", pass_success_rate: 0.5 },
  { team_id: "NE", season: 2026, situation: "short_yardage", plays: 4, epa_per_play: -0.11217689808108844, success_rate: 0.5, pass_rate: 0.25, rush_epa_per_play: 0.29074399460417527, pass_epa_per_play: -1.3209395761368796, rush_success_rate: 0.6666666666666666, pass_success_rate: 0.0 },
];

// Real rows: Supabase team_situational_stats, season 2026, team SF (fetched 2026-09-11,
// after the 16:14 UTC ingest picked up LA-SF). SF ran ZERO times at the goal line, and
// has no late_close row at all (only 6 situations).
const SF_2026_RAW = [
  { team_id: "SF", season: 2026, situation: "all", plays: 64, epa_per_play: 0.17876756143518158, success_rate: 0.5625, pass_rate: 0.53125, rush_epa_per_play: 0.2205165465323565, pass_epa_per_play: 0.1419302216435567, rush_success_rate: 0.5666666666666667, pass_success_rate: 0.5588235294117647 },
  { team_id: "SF", season: 2026, situation: "early_down", plays: 52, epa_per_play: 0.1912692373164016, success_rate: 0.5576923076923077, pass_rate: 0.46153846153846156, rush_epa_per_play: 0.19614254926481017, pass_epa_per_play: 0.18558370670992494, rush_success_rate: 0.5357142857142857, pass_success_rate: 0.5833333333333334 },
  { team_id: "SF", season: 2026, situation: "goalline", plays: 3, epa_per_play: -0.14098465279970038, success_rate: 0.3333333333333333, pass_rate: 1.0, rush_epa_per_play: "NaN", pass_epa_per_play: -0.14098465279970038, rush_success_rate: "NaN", pass_success_rate: 0.3333333333333333 },
  { team_id: "SF", season: 2026, situation: "passing_down", plays: 12, epa_per_play: 0.6981779368956677, success_rate: 0.75, pass_rate: 0.8333333333333334, rush_epa_per_play: 0.8387978143582586, pass_epa_per_play: 0.6700539614031495, rush_success_rate: 0.5, pass_success_rate: 0.8 },
  { team_id: "SF", season: 2026, situation: "redzone", plays: 10, epa_per_play: 0.30925314499675566, success_rate: 0.5, pass_rate: 0.8, rush_epa_per_play: -0.3926996862865053, pass_epa_per_play: 0.4847413528175709, rush_success_rate: 0.0, pass_success_rate: 0.625 },
  { team_id: "SF", season: 2026, situation: "short_yardage", plays: 6, epa_per_play: 0.008068040399894283, success_rate: 0.6666666666666666, pass_rate: 0.6666666666666666, rush_epa_per_play: 0.5617525082780048, pass_epa_per_play: -0.268774193539161, rush_success_rate: 1.0, pass_success_rate: 0.5 },
];

function parse(raw: Record<string, unknown>[]): TeamSituationalStat[] {
  return raw.map((r) => parseNumericFields<TeamSituationalStat>(r as unknown as TeamSituationalStat, SIT_NUMERIC));
}

const NE = parse(NE_2026_RAW);
const SF = parse(SF_2026_RAW);

const NE_GOALLINE = NE.find((r) => r.situation === "goalline")!;

const LABELS = ["All Plays", "Early Downs", "Passing Downs", "Short Yardage", "Red Zone", "Goal Line", "Late & Close"];

function renderDashboard(rows: TeamSituationalStat[], teamName = "New England Patriots") {
  return render(
    <SituationalDashboard
      teamStats={rows}
      allTeamStats={rows}
      teamName={teamName}
      primaryColor="#002244"
      secondaryColor="#C60C30"
    />
  );
}

/** The situation card whose label is `label` (probe-verified selector). */
function card(label: string): HTMLElement {
  return screen.getByText(label).closest('[class*="border-l-4"]') as HTMLElement;
}

describe("SituationalDashboard", () => {
  describe("2026 week 1, New England's real rows (0 rushes in red zone and goal line)", () => {
    it("parseNumericFields turns the DB's 'NaN' split into null", () => {
      for (const sit of ["redzone", "goalline"]) {
        const row = NE.find((r) => r.situation === sit)!;
        expect(row.rush_epa_per_play).toBeNull();
        expect(row.rush_success_rate).toBeNull();
      }
    });

    it("renders New England's real 2026 rows without throwing", () => {
      expect(() => renderDashboard(NE)).not.toThrow();
      expect(screen.getByText("Situational Efficiency")).toBeInTheDocument();
      for (const label of LABELS) {
        expect(screen.getByText(label)).toBeInTheDocument();
      }
    });

    it("shows a gray dash for the missing run split in the red zone and at the goal line", () => {
      renderDashboard(NE);

      const redZone = card("Red Zone");
      expect(within(redZone).getAllByText("-0.91")).toHaveLength(2);
      expect(within(redZone).getByText("—").className).toContain("text-gray-400");

      const goalLine = card("Goal Line");
      expect(within(goalLine).getAllByText("+0.84")).toHaveLength(2);
      expect(within(goalLine).getByText("—").className).toContain("text-gray-400");
    });

    it("never prints NaN, null or undefined", () => {
      const { container } = renderDashboard(NE);
      expect(container.textContent).not.toMatch(/NaN|null|undefined/);
    });

    it("renders San Francisco's real 2026 rows (0 goal-line rushes, no late & close row) without throwing", () => {
      expect(() => renderDashboard(SF, "San Francisco 49ers")).not.toThrow();
      for (const label of LABELS.filter((l) => l !== "Late & Close")) {
        expect(screen.getByText(label)).toBeInTheDocument();
      }
      expect(screen.queryByText("Late & Close")).toBeNull();

      const goalLine = card("Goal Line");
      expect(within(goalLine).getAllByText("-0.14")).toHaveLength(2);
      expect(within(goalLine).getByText("—").className).toContain("text-gray-400");
    });
  });

  describe("missing splits", () => {
    it("shows a gray dash for the pass side when a situation had 0 passes", () => {
      const row: TeamSituationalStat = {
        ...NE_GOALLINE,
        pass_epa_per_play: null as unknown as number,
        pass_success_rate: null as unknown as number,
        pass_rate: 0,
        rush_epa_per_play: -0.4,
        epa_per_play: -0.4,
      };
      renderDashboard([row]);

      const goalLine = card("Goal Line");
      expect(within(goalLine).getAllByText("-0.40")).toHaveLength(2);
      expect(within(goalLine).getByText("—").className).toContain("text-gray-400");
      expect(within(goalLine).getByText("0%")).toBeInTheDocument();
    });

    it("omits the split bars when both sides are missing", () => {
      const row: TeamSituationalStat = {
        ...NE_GOALLINE,
        rush_epa_per_play: null as unknown as number,
        pass_epa_per_play: null as unknown as number,
      };
      renderDashboard([row]);

      const goalLine = card("Goal Line");
      expect(within(goalLine).getByText("+0.84")).toBeInTheDocument();
      expect(within(goalLine).queryByText("Run")).toBeNull();
      expect(within(goalLine).queryByText("Pass")).toBeNull();
    });

    it("shows a dash when success rate or pass rate is null", () => {
      const all = NE.find((r) => r.situation === "all")!;
      const row: TeamSituationalStat = {
        ...all,
        success_rate: null as unknown as number,
        pass_rate: null as unknown as number,
      };
      renderDashboard([row]);

      const allPlays = card("All Plays");
      expect(allPlays.textContent).toContain("SR: —");
      expect(allPlays.textContent).toContain("Pass%: —");
    });
  });

  describe("full-season rows (2025 and earlier) render exactly as before", () => {
    it("formats real numbers with the same text and colors", () => {
      const row: TeamSituationalStat = {
        team_id: "KC",
        season: 2025,
        situation: "all",
        plays: 1000,
        epa_per_play: 0.071,
        success_rate: 0.456,
        pass_rate: 0.6,
        rush_epa_per_play: -0.12,
        pass_epa_per_play: 0.25,
        rush_success_rate: 0.4,
        pass_success_rate: 0.5,
      };
      renderDashboard([row], "Kansas City Chiefs");

      const allPlays = card("All Plays");
      expect(within(allPlays).getByText("+0.07")).toBeInTheDocument();
      expect(within(allPlays).getByText("46%")).toBeInTheDocument();
      expect(within(allPlays).getByText("60%")).toBeInTheDocument();
      expect(within(allPlays).getByText("-0.12").className).toContain("text-red-600");
      expect(within(allPlays).getByText("+0.25").className).toContain("text-blue-700");
      expect(within(allPlays).queryByText("—")).toBeNull();
    });
  });
});
