// The two-series overlay radar (team matchup spec §8.1): the offense's shape
// (solid, round dots, team colour) over the other team's defense (dashed
// slate, squares), with a red bar along a spoke where the two ranks are five
// or more places apart. Geometry is the team radar's `sm`, unchanged.
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import MatchupRadarChart from "@/components/matchup/MatchupRadarChart";
import { EDGE_LEAN_MIN_GAP, type OverlayModel } from "@/lib/stats/matchup";
import { RADAR_AXES, RADAR_SIZES, plottableScore, radarLabelPosition, spokeRankLabel } from "@/lib/stats/team-radar";
import { ACCENT, awayBall, homeBall, model, rowsWithout, source } from "./helpers";

const draw = (overlay: OverlayModel, color = "#00338D", secondary = "#C60C30") =>
  render(<MatchupRadarChart overlay={overlay} offColor={color} offSecondaryColor={secondary} />).container;
const real = (side: OverlayModel["off"]) => (side?.spokes ?? []).filter((s) => plottableScore(s) !== null).map((s) => s.key);

describe("MatchupRadarChart", () => {
  const overlay = awayBall().overlay;

  it("draws one svg in the sm geometry's viewBox, full width and never a fixed size", () => {
    const svg = draw(overlay).querySelector("svg")!;
    expect(svg.getAttribute("viewBox")).toBe(`0 0 ${RADAR_SIZES.sm.w} ${RADAR_SIZES.sm.h}`);
    expect(svg.getAttribute("class")).toContain("w-full");
    expect(svg.getAttribute("class")).toContain("h-auto");
    expect(svg.getAttribute("width")).toBeNull();
  });

  it("one circle per real offense spoke, one square per real defense spoke", () => {
    const el = draw(overlay);
    expect(Array.from(el.querySelectorAll("circle[data-off-dot]")).map((c) => c.getAttribute("data-off-dot"))).toEqual(real(overlay.off));
    expect(Array.from(el.querySelectorAll("rect[data-def-marker]")).map((c) => c.getAttribute("data-def-marker"))).toEqual(real(overlay.def));
    const square = el.querySelector("rect[data-def-marker]")!;
    expect([square.getAttribute("width"), square.getAttribute("height")]).toEqual(["9", "9"]);
    expect(el.querySelector("circle[data-off-dot]")!.getAttribute("r")).toBe("5");
  });

  it("the defense outline is dashed slate; the offense outline is solid", () => {
    const el = draw(overlay);
    const def = el.querySelector('path[data-series="def"]')!;
    expect(def.getAttribute("stroke")).toBe("#334155");
    expect(def.getAttribute("stroke-dasharray")).toBe("6 4");
    const off = el.querySelector('path[data-series="off"]')!;
    expect(off.getAttribute("stroke-dasharray")).toBeNull();
    expect(off.getAttribute("stroke")).toBe("#00338D");
  });

  it("the offense outline falls back to a colour that shows on white (PIT, NO)", () => {
    const el = draw(overlay, "#FFB612", "#101820");
    expect(el.querySelector('path[data-series="off"]')!.getAttribute("stroke")).toBe("#101820");
  });

  it("a gap bar exactly on the spokes with gapBar, in the accent, 5 wide", () => {
    const overlays = [overlay, homeBall().overlay, awayBall("DET", "NO").overlay, homeBall("CHI", "PHI").overlay];
    for (const o of overlays) {
      const el = draw(o);
      const bars = Array.from(el.querySelectorAll("line[data-gap-bar]"));
      expect(bars.map((b) => b.getAttribute("data-gap-bar"))).toEqual(o.spokes.filter((s) => s.gapBar).map((s) => s.key));
      for (const b of bars) {
        expect(b.getAttribute("stroke")).toBe(ACCENT);
        expect(b.getAttribute("stroke-width")).toBe("5");
      }
    }
    expect(overlays.some((o) => o.spokes.some((s) => s.gapBar))).toBe(true);
  });

  it("the mid ring is dashed amber", () => {
    const mid = draw(overlay).querySelector('path[data-ring="mid"]')!;
    expect(mid.getAttribute("stroke")).toBe("#f59e0b");
    expect(mid.getAttribute("stroke-dasharray")).toBeTruthy();
  });

  it("two lines per spoke: the spoke name, then offense rank v defense rank", () => {
    const el = draw(overlay);
    for (const s of overlay.spokes) {
      expect(el.querySelector(`text[data-axis="${s.key}"]`)?.textContent).toBe(s.label);
      expect(el.querySelector(`text[data-axis-rank="${s.key}"]`)?.textContent).toBe(s.rankLine);
    }
    expect(el.querySelectorAll("text[data-axis]")).toHaveLength(RADAR_AXES.length);
  });

  it("no NaN, Infinity or undefined in any path or coordinate", () => {
    for (const o of [overlay, homeBall().overlay, awayBall("CHI", "PHI").overlay]) {
      expect(draw(o).innerHTML).not.toMatch(/NaN|Infinity|undefined/);
    }
  });

  it("draws nothing when the overlay is not drawn (a team that has not played)", () => {
    const side = model("BUF", "HOU", rowsWithout("BUF")).awayBall!;
    expect(side.overlay.drawn).toBe(false);
    expect(draw(side.overlay).innerHTML).toBe("");
  });

  it("the gap rule comes from the model's gapBar (EDGE_LEAN_MIN_GAP), never a number compared in the chart", () => {
    expect(EDGE_LEAN_MIN_GAP).toBe(5);
    expect(source("MatchupRadarChart.tsx")).not.toMatch(/places\s*>=?\s*\d/);
  });

  it("is a server component: no \"use client\" (it imports the geometry module)", () => {
    expect(source("MatchupRadarChart.tsx")).not.toMatch(/^\s*["']use client["']/m);
  });
});

describe("overlay label fit (§8.1): the 15-character rank line on every spoke of sm, at 0.556 em a character", () => {
  const g = RADAR_SIZES.sm;
  const width = 15 * g.f * 0.556;
  it.each(RADAR_AXES.map((a, i) => [a.key, i] as const))("%s stays inside the viewBox", (_key, i) => {
    const p = radarLabelPosition(g, i);
    const left = p.anchor === "start" ? p.x : p.anchor === "end" ? p.x - width : p.x - width / 2;
    expect(left).toBeGreaterThanOrEqual(0);
    expect(left + width).toBeLessThanOrEqual(g.w);
    expect(p.y1 - g.f).toBeGreaterThanOrEqual(0);
    expect(p.y2).toBeLessThanOrEqual(g.h);
  });
  it("15 characters is the longest line the model can write: two tied two-digit ranks, built by spokeRankLabel", () => {
    const labels = Array.from({ length: 32 }, (_, i) => i + 1).flatMap((rank) => [
      spokeRankLabel({ rank, tied: false }),
      spokeRankLabel({ rank, tied: true }),
    ]);
    const longest = Math.max(...labels.map((l) => l.length));
    expect(`${spokeRankLabel({ rank: 32, tied: true })} v ${spokeRankLabel({ rank: 14, tied: true })}`).toBe("T-32nd v T-14th");
    expect(longest * 2 + " v ".length).toBe(15);
    // and every line of the real model is within it
    for (const o of [awayBall().overlay, homeBall().overlay, awayBall("CHI", "PHI").overlay]) {
      for (const s of o.spokes) expect(s.rankLine.length).toBeLessThanOrEqual(15);
    }
  });
});
