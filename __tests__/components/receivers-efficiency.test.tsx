// Spec A §4.11 (T3): the Efficiency tab ranks by a column that has data. With
// no route data (2026: nflverse has no participation file) it sorts by a new
// EPA/Tgt column and says why the route columns are empty; with route data it
// keeps YPRR. The rule is the homepage's (lib/stats/radar.ts seasonHasRouteData).
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { ReceiverSeasonStat } from "@/lib/types";

const nav = vi.hoisted(() => ({
  params: new URLSearchParams(),
  push: vi.fn(),
  replace: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useSearchParams: () => nav.params,
  useRouter: () => ({ push: nav.push, replace: nav.replace }),
  usePathname: () => "/receivers",
}));

import ReceiverLeaderboard from "@/components/tables/ReceiverLeaderboard";

const NOTE_2026 =
  "YPRR, TPRR, Snap% and Route% show “—” for 2026: nflverse hasn’t published full 2026 participation data (who was on the field for each play), which those stats are built from.";

beforeEach(() => {
  nav.push.mockReset();
  nav.replace.mockReset();
  nav.params = new URLSearchParams();
});

function rec(i: number, over: Partial<ReceiverSeasonStat>): ReceiverSeasonStat {
  return {
    id: `r${i}`, player_id: `r${i}`, player_name: `Receiver ${String.fromCharCode(65 + i)}`,
    position: "WR", team_id: "KC", season: 2026, games: 2, targets: 10, receptions: 7,
    receiving_yards: 80, receiving_tds: 0, catch_rate: 0.7, yards_per_target: 8,
    yards_per_reception: 11, epa_per_target: 0.1, yac: 30, yac_per_reception: 4,
    air_yards: 60, air_yards_per_target: 6, target_share: 0.2, fumbles: 0, fumbles_lost: 0,
    routes_run: null as unknown as number, yards_per_route_run: null as unknown as number,
    targets_per_route_run: null as unknown as number, total_snaps: null as unknown as number,
    snap_share: null as unknown as number, route_participation_rate: null as unknown as number,
    air_yards_share: 0.2, croe: 0, receiving_success_rate: 0.5, total_receiving_epa: 1,
    ...over,
  };
}

/** 2026 shape: no participation data, EPA/Tgt order C, A, B (not the row order). */
const NO_ROUTES = [
  rec(0, { epa_per_target: 0.2 }),
  rec(1, { epa_per_target: -0.1 }),
  rec(2, { epa_per_target: 0.5 }),
];

/** 2025 shape: every qualified row has routes and a YPRR; YPRR order B, C, A. */
const WITH_ROUTES = [
  rec(0, { season: 2025, routes_run: 40, yards_per_route_run: 1.1, epa_per_target: 0.9 }),
  rec(1, { season: 2025, routes_run: 40, yards_per_route_run: 2.4, epa_per_target: 0.0 }),
  rec(2, { season: 2025, routes_run: 40, yards_per_route_run: 1.8, epa_per_target: 0.3 }),
];

function renderBoard(data: ReceiverSeasonStat[], query: string, season = 2026) {
  nav.params = new URLSearchParams(query);
  return render(
    <TooltipProvider>
      <ReceiverLeaderboard data={data} throughWeek={2} season={season} />
    </TooltipProvider>,
  );
}

function headers(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll("thead th")).map((th) => th.textContent ?? "");
}
function sortedHeader(container: HTMLElement): string | undefined {
  return headers(container).find((h) => h.includes("▼") || h.includes("▲"));
}
function names(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll("tbody tr a[href^='/player/']")).map((a) => a.textContent ?? "");
}
function note(container: HTMLElement): string | null {
  const p = Array.from(container.querySelectorAll("p")).find((el) => (el.textContent ?? "").startsWith("YPRR, TPRR"));
  return p ? p.textContent : null;
}

describe("Efficiency tab without route data", () => {
  it("has an EPA/Tgt column right after GP, sorts by it, and explains the dashes", () => {
    const { container } = renderBoard(NO_ROUTES, "tab=efficiency");
    const h = headers(container);
    const gp = h.findIndex((x) => x.startsWith("GP"));
    expect(h[gp + 1].startsWith("EPA/Tgt")).toBe(true);
    expect(sortedHeader(container)?.startsWith("EPA/Tgt")).toBe(true);
    expect(names(container)).toEqual(["Receiver C", "Receiver A", "Receiver B"]);
    expect(note(container)).toBe(NOTE_2026);
    expect(container.textContent).not.toMatch(/\\u[0-9a-fA-F]{4}/);
  });

  it("switching away and back puts no sort= in the URL", () => {
    const { container } = renderBoard(NO_ROUTES, "tab=efficiency");
    const tab = (label: string) =>
      Array.from(container.querySelectorAll("button")).find((b) => b.textContent === label)!;
    fireEvent.click(tab("Receiving"));
    fireEvent.click(tab("Efficiency"));
    const last = nav.push.mock.calls.at(-1)![0] as string;
    expect(last).toContain("tab=efficiency");
    expect(last).not.toContain("sort=");
    expect(sortedHeader(container)?.startsWith("EPA/Tgt")).toBe(true);
  });

  it("shows the note on Overview too, but not on Receiving, and not for an empty table", () => {
    expect(note(renderBoard(NO_ROUTES, "").container)).toBe(NOTE_2026);
    expect(note(renderBoard(NO_ROUTES, "tab=receiving").container)).toBeNull();
    expect(note(renderBoard([], "tab=efficiency").container)).toBeNull();
  });

  it("leaves the Overview default (EPA/Tgt) alone", () => {
    const { container } = renderBoard(NO_ROUTES, "");
    expect(sortedHeader(container)?.startsWith("EPA/Tgt")).toBe(true);
  });
});

describe("Efficiency tab with route data", () => {
  it("keeps YPRR as the sort and shows no note", () => {
    const { container } = renderBoard(WITH_ROUTES, "tab=efficiency", 2025);
    expect(sortedHeader(container)?.startsWith("YPRR")).toBe(true);
    expect(names(container)).toEqual(["Receiver B", "Receiver C", "Receiver A"]);
    expect(note(container)).toBeNull();
  });

  // Same pool shape as __tests__/app/home-page.test.tsx's 90% boundary pair.
  it.each([
    [9, "YPRR"],
    [8, "EPA/Tgt"],
  ] as const)("%i of 10 qualified receivers with routes: sorts by %s", (routed, label) => {
    const rows = Array.from({ length: 10 }, (_, i) =>
      rec(
        i,
        i < routed
          ? { targets: 10, routes_run: 40, yards_per_route_run: 1 + i / 10, epa_per_target: 0.1 }
          : { targets: 10, routes_run: 0, yards_per_route_run: null as unknown as number, epa_per_target: 0.1 },
      ),
    );
    const { container } = renderBoard(rows, "tab=efficiency");
    expect(sortedHeader(container)?.startsWith(label)).toBe(true);
  });
});
