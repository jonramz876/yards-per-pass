// Spec A §4.12 (T12): the team page's Passing Attack table explains an all-dash
// YPRR column (no participation data for the season), and only then.
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import PassingSection from "@/components/team/PassingSection";
import type { ReceiverSeasonStat } from "@/lib/types";

function rec(id: string, targets: number, routes: number | null, season = 2026): ReceiverSeasonStat {
  return {
    id, player_id: id, player_name: `Receiver ${id}`, position: "WR", team_id: "BUF", season, games: 2,
    targets, receptions: 5, receiving_yards: 60, receiving_tds: 0, catch_rate: 0.6, yards_per_target: 7,
    yards_per_reception: 12, epa_per_target: 0.2, yac: 20, yac_per_reception: 4, air_yards: 50,
    air_yards_per_target: 6, target_share: 0.2, fumbles: 0, fumbles_lost: 0,
    routes_run: routes as number,
    yards_per_route_run: (routes == null ? null : 60 / Math.max(routes, 1)) as number,
    targets_per_route_run: null as unknown as number, total_snaps: null as unknown as number,
    snap_share: null as unknown as number, route_participation_rate: null as unknown as number,
    air_yards_share: 0.2, croe: 0, receiving_success_rate: 0.5, total_receiving_epa: 2,
  };
}

function renderSection(receivers: ReceiverSeasonStat[]) {
  return render(
    <PassingSection
      teamQBs={[]}
      teamReceivers={receivers}
      slugMap={{}}
      allTeamStats={[]}
      teamId="BUF"
      freshness={null}
      primaryColor="#00338D"
      secondaryColor="#C60C30"
      season={2026}
      defaultSeason={2026}
    />,
  ).container;
}

function note(container: HTMLElement): string | null {
  const p = Array.from(container.querySelectorAll("p")).find((el) => (el.textContent ?? "").startsWith("YPRR shows"));
  return p ? p.textContent : null;
}

describe("PassingSection route-data note", () => {
  it("shows when every receiver's routes are unknown", () => {
    const container = renderSection([rec("a", 12, null), rec("b", 8, null)]);
    expect(note(container)).toBe(
      "YPRR shows “—” for 2026: nflverse hasn’t published full 2026 participation data (who was on the field for each play).",
    );
    expect(container.textContent).not.toMatch(/\\u[0-9a-fA-F]{4}/);
  });

  it("does not show when any receiver has routes, or with no receivers", () => {
    expect(note(renderSection([rec("a", 12, null), rec("b", 8, 40)]))).toBeNull();
    expect(note(renderSection([rec("a", 12, 60, 2025)]))).toBeNull();
    expect(note(renderSection([]))).toBeNull();
  });
});
