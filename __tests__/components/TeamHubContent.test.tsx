// Where the Team Radar sits on the team page (team radar spec 2026-10-06 J8):
// under the schedule sections, above Passing Attack. The other sections are
// stubbed to markers; the radar section is the real component.
import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import { TooltipProvider } from "@/components/ui/tooltip";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const marker = vi.hoisted(() => (name: string) => ({
  default: () => <div data-section={name} />,
}));
vi.mock("@/components/layout/DashboardShell", () => ({
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/ui/Breadcrumbs", () => marker("breadcrumbs"));
vi.mock("@/components/team/TeamIdentityCard", () => marker("identity"));
vi.mock("@/components/team/ScheduleSection", () => marker("schedule"));
vi.mock("@/components/team/PassingSection", () => marker("passing"));
vi.mock("@/components/team/GroundGameSection", () => marker("ground"));
vi.mock("@/components/team/DefenseSection", () => marker("defense"));
vi.mock("@/components/team/DivisionRivals", () => marker("rivals"));
vi.mock("@/components/team/DownDistanceHeatmap", () => marker("down-distance"));
vi.mock("@/components/team/SituationalDashboard", () => marker("situational"));

import TeamHubContent from "@/components/team/TeamHubContent";
import rowsJson from "../stats/fixtures/team-radar-2026-w1-3.json";
import { teamRadarSlice, type TeamRadarSlice } from "@/lib/stats/team-radar";
import { getTeam } from "@/lib/data/teams";
import type { TeamHubData } from "@/lib/data/team-hub";

const DATA = { currentSeason: 2026, seasons: [2026, 2025], freshness: null } as unknown as TeamHubData;
const READY = teamRadarSlice({
  teamId: "BUF",
  season: 2026,
  rows: rowsJson as Record<string, unknown>[],
  newestSeason: 2026,
  covered: [2026],
});

function order(radar: TeamRadarSlice): string[] {
  const { container } = render(
    <TooltipProvider>
      <TeamHubContent team={getTeam("BUF")!} data={DATA} boxScoreSeasons={[2026]} radar={radar} defaultSeason={2026} />
    </TooltipProvider>,
  );
  return Array.from(container.querySelectorAll('[data-section], [id="team-radar"]')).map(
    (el) => el.getAttribute("data-section") ?? "team-radar",
  );
}

describe("TeamHubContent — the Team Radar section", () => {
  it("sits under both schedule sections and above Passing Attack", () => {
    expect(order(READY)).toEqual([
      "breadcrumbs", "identity", "schedule", "schedule", "team-radar",
      "passing", "ground", "down-distance", "situational", "defense", "rivals",
    ]);
  });

  it("keeps its place, and the rest of the hub renders, in every message state", () => {
    const states: TeamRadarSlice[] = [
      { state: "unavailable", season: 2026 },
      { state: "no-games", season: 2026 },
      { state: "small-pool", season: 2026 },
      { state: "uncovered", season: 2025, firstSeason: 2026 },
      { state: "uncovered", season: 2025, firstSeason: null },
    ];
    for (const s of states) {
      const o = order(s);
      expect(o.indexOf("team-radar"), s.state).toBe(4);
      expect(o, s.state).toHaveLength(11);
    }
  });
});
