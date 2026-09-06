import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import PlayerFieldHeatMap from "@/components/player/PlayerFieldHeatMap";
import type { QBPassLocationStat } from "@/lib/types";

/**
 * 9-zone fixture (values mirror the design mockup so the numbers below are
 * hand-checkable). NOTE the scale footgun: zone-level `completion_pct` is
 * stored 0–1 here, the opposite of season-level QBSeasonStat.completion_pct.
 */
function zone(
  depth_bin: string,
  direction_bin: string,
  o: Partial<QBPassLocationStat> = {},
): QBPassLocationStat {
  return {
    id: `${depth_bin}-${direction_bin}`,
    player_id: "00-0034857",
    player_name: "Josh Allen",
    team_id: "BUF",
    season: 2026,
    depth_bin,
    direction_bin,
    pass_attempts: 10,
    completions: 6,
    passing_yards: 80,
    pass_tds: 0,
    interceptions: 0,
    epa_sum: 1.0,
    epa_per_attempt: 0.1,
    completion_pct: 0.6,
    yards_per_attempt: 8,
    adot: 9,
    cpoe: 1.0,
    passer_rating: 95,
    ...o,
  };
}

const stats: QBPassLocationStat[] = [
  zone("deep", "left", {
    pass_attempts: 19, completions: 8, passing_yards: 245, pass_tds: 2, interceptions: 1,
    epa_per_attempt: 0.61, cpoe: 8.4, yards_per_attempt: 12.9, completion_pct: 0.421, epa_sum: 11.6,
  }),
  zone("deep", "middle", {
    pass_attempts: 14, completions: 6, passing_yards: 150, pass_tds: 1,
    epa_per_attempt: 0.05, cpoe: -0.7, yards_per_attempt: 10.7, completion_pct: 0.429,
  }),
  zone("deep", "right", {
    pass_attempts: 16, completions: 4, passing_yards: 90, interceptions: 2,
    epa_per_attempt: -0.42, cpoe: -11.3, yards_per_attempt: 5.6, completion_pct: 0.25,
  }),
  zone("intermediate", "left", {
    pass_attempts: 34, completions: 22, passing_yards: 300, pass_tds: 3,
    epa_per_attempt: 0.18, cpoe: 3.2, yards_per_attempt: 8.8, completion_pct: 0.647,
  }),
  zone("intermediate", "middle", {
    pass_attempts: 38, completions: 28, passing_yards: 400, pass_tds: 4, interceptions: 1,
    epa_per_attempt: 0.31, cpoe: 6.1, yards_per_attempt: 10.5, completion_pct: 0.737,
  }),
  zone("intermediate", "right", {
    pass_attempts: 31, completions: 18, passing_yards: 210, pass_tds: 1, interceptions: 1,
    epa_per_attempt: -0.08, cpoe: -2.4, yards_per_attempt: 6.8, completion_pct: 0.581,
  }),
  zone("short", "left", {
    pass_attempts: 61, completions: 48, passing_yards: 320,
    epa_per_attempt: 0.02, cpoe: 0.4, yards_per_attempt: 5.2, completion_pct: 0.787,
  }),
  zone("short", "middle", {
    pass_attempts: 63, completions: 52, passing_yards: 380, pass_tds: 2,
    epa_per_attempt: 0.24, cpoe: 4.9, yards_per_attempt: 6.0, completion_pct: 0.825,
  }),
  zone("short", "right", {
    pass_attempts: 55, completions: 39, passing_yards: 240, interceptions: 2,
    epa_per_attempt: -0.15, cpoe: -3.8, yards_per_attempt: 4.4, completion_pct: 0.709,
  }),
];

const teamProps = {
  teamName: "Buffalo Bills",
  primaryColor: "#00338D",
  secondaryColor: "#C60C30",
  jerseyNumber: 17,
};

function renderMap(over: Partial<React.ComponentProps<typeof PlayerFieldHeatMap>> = {}) {
  return render(
    <PlayerFieldHeatMap
      stats={stats}
      playerName="Josh Allen"
      season={2026}
      {...teamProps}
      {...over}
    />,
  );
}

describe("PlayerFieldHeatMap (Tecmo Field)", () => {
  it("renders all 9 depth × direction zones", () => {
    const { container } = renderMap();
    expect(container.querySelectorAll("[data-zone]").length).toBe(9);
    for (const depth of ["deep", "intermediate", "short"]) {
      for (const dir of ["left", "middle", "right"]) {
        expect(container.querySelector(`[data-zone="${depth}-${dir}"]`)).not.toBeNull();
      }
    }
  });

  it("shows the empty-state message when there is no location data", () => {
    const { container } = render(
      <PlayerFieldHeatMap stats={[]} playerName="Josh Allen" season={2026} {...teamProps} />,
    );
    expect(screen.getByText(/no pass location data/i)).toBeTruthy();
    expect(container.querySelectorAll("[data-zone]").length).toBe(0);
  });

  it("switching tabs changes the value shown in a zone", () => {
    const { container } = renderMap();
    const deepLeft = () => container.querySelector('[data-zone="deep-left"]')!;
    expect(deepLeft().textContent).toContain("+0.61"); // EPA/ATT default tab

    fireEvent.click(screen.getByRole("button", { name: /CPOE/i }));
    expect(deepLeft().textContent).toContain("+8.4%");
    expect(deepLeft().textContent).not.toContain("+0.61");

    fireEvent.click(screen.getByRole("button", { name: /YDS\/ATT/i }));
    expect(deepLeft().textContent).toContain("12.9");

    fireEvent.click(screen.getByRole("button", { name: /^YARDS$/i }));
    expect(deepLeft().textContent).toContain("245");
  });

  it("gives every non-empty zone a detail title tooltip", () => {
    const { container } = renderMap();
    const cells = Array.from(container.querySelectorAll("[data-zone]"));
    expect(cells.every((c) => (c.getAttribute("title") ?? "").length > 0)).toBe(true);
    // comp% comes from the 0–1 zone scale ×100 — 8/19 = 42.1%
    const title = container.querySelector('[data-zone="deep-left"]')!.getAttribute("title")!;
    expect(title).toContain("DEEP LEFT");
    expect(title).toContain("8/19");
    expect(title).toContain("42.1%");
    expect(title).toContain("245 yds");
    expect(title).toContain("2 TD");
    expect(title).toContain("1 INT");
  });

  it("renders a missing zone as an em dash with no tooltip", () => {
    const { container } = renderMap({ stats: stats.slice(0, 8) });
    const empty = container.querySelector('[data-zone="short-right"]')!;
    expect(empty.textContent).toContain("—");
    expect(empty.getAttribute("title")).toBeNull();
  });

  it("renders NaN metrics (parseNumericFields' null convention) as em dashes, not 'NaN'", () => {
    // parseNumericFields turns null into NaN, so `?? 0` guards are not enough.
    const nanStats = [
      zone("deep", "left", {
        pass_attempts: 5, completions: 2, passing_yards: NaN, pass_tds: 0, interceptions: 0,
        epa_per_attempt: NaN, cpoe: NaN, yards_per_attempt: NaN, completion_pct: NaN, epa_sum: NaN,
      }),
      ...stats.slice(1),
    ];
    const { container } = renderMap({ stats: nanStats });
    const deepLeft = container.querySelector('[data-zone="deep-left"]')!;
    expect(deepLeft.textContent).toContain("—");
    expect(container.textContent).not.toContain("NaN");
    // ...and it must not be painted as the most-positive step.
    expect(deepLeft.getAttribute("style")).toContain("30, 41, 59"); // #1e293b neutral
  });

  it("renders the team band and season totals strip", () => {
    renderMap();
    expect(screen.getByText(/Buffalo Bills/i)).toBeTruthy();
    expect(screen.getByText(/17-Josh Allen/i)).toBeTruthy();
    // totals: 225/331 completions/attempts across the fixture
    expect(screen.getByText("225/331")).toBeTruthy();
  });
});
