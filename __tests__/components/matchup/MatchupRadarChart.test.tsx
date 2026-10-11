// The two-series overlay radar (team matchup spec §8.1, as amended by the page
// colours amendment 2026-10-10): the offense's shape (solid, round dots) in
// its team's colour over the other team's defense (dashed, white squares) in
// THAT team's colour. The colours come in as props (the share card's rule,
// worked out once on the server); the chart holds none of its own and draws
// no rank-gap bar. Geometry is the team radar's `sm`, unchanged.
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import MatchupRadarChart from "@/components/matchup/MatchupRadarChart";
import type { OverlayModel } from "@/lib/stats/matchup";
import { RADAR_AXES, RADAR_SIZES, plottableScore, radarLabelPosition, spokeRankLabel } from "@/lib/stats/team-radar";
import { awayBall, code, homeBall, model, rowsWithout, source } from "./helpers";

// The defaults are BUF at LA's card colours (blue, gold, grey ring). None may
// equal a constant the chart used to hold (#334155 slate, #f59e0b amber): a
// chart that went back to a hard-coded colour must fail these tests.
const OFF = "#00338D";
const DEF = "#CC8200";
const RING = "#94A3B8";
const draw = (overlay: OverlayModel, off = OFF, def = DEF, ring = RING) =>
  render(<MatchupRadarChart overlay={overlay} offColor={off} defColor={def} ringColor={ring} />).container;
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

  it("the defense outline is dashed in the defense's colour, 2.6 wide; the offense outline is solid in the offense's, 3 wide", () => {
    for (const [off, def] of [[OFF, DEF], ["#D50A0A", "#041E42"], ["#203731", "#8C9295"]]) {
      const el = draw(overlay, off, def);
      const d = el.querySelector('path[data-series="def"]')!;
      expect(d.getAttribute("stroke")).toBe(def);
      expect(d.getAttribute("stroke-dasharray")).toBe("6 4");
      expect(d.getAttribute("stroke-width")).toBe("2.6");
      expect(d.getAttribute("fill")).toBe(`${def}14`);
      const o = el.querySelector('path[data-series="off"]')!;
      expect(o.getAttribute("stroke")).toBe(off);
      expect(o.getAttribute("stroke-dasharray")).toBeNull();
      expect(o.getAttribute("stroke-width")).toBe("3");
      expect(o.getAttribute("fill")).toBe(`${off}22`);
    }
  });

  it("markers: white squares outlined in the defense's colour, dots filled with the offense's and ringed white", () => {
    const el = draw(overlay);
    const squares = Array.from(el.querySelectorAll("rect[data-def-marker]"));
    const dots = Array.from(el.querySelectorAll("circle[data-off-dot]"));
    expect(squares.length).toBeGreaterThan(0);
    expect(dots.length).toBeGreaterThan(0);
    for (const s of squares) {
      expect([s.getAttribute("fill"), s.getAttribute("stroke"), s.getAttribute("stroke-width")]).toEqual(["#ffffff", DEF, "2"]);
    }
    for (const c of dots) {
      expect([c.getAttribute("fill"), c.getAttribute("stroke"), c.getAttribute("stroke-width")]).toEqual([OFF, "#ffffff", "1"]);
    }
  });

  it("draw order is the card's: defense outline, offense outline, squares, dots", () => {
    const el = draw(overlay);
    const order = Array.from(el.querySelectorAll("[data-series], [data-def-marker], [data-off-dot]")).map((n) =>
      n.getAttribute("data-series") ?? (n.hasAttribute("data-def-marker") ? "square" : "dot"),
    );
    const squares = real(overlay.def).length;
    const dots = real(overlay.off).length;
    expect(order).toEqual(["def", "off", ...Array(squares).fill("square"), ...Array(dots).fill("dot")]);
  });

  it("no rank-gap bar, on four overlays whose model does have gapBar spokes", () => {
    const overlays = [overlay, homeBall().overlay, awayBall("DET", "NO").overlay, homeBall("CHI", "PHI").overlay];
    for (const o of overlays) {
      const el = draw(o);
      expect(el.querySelectorAll("[data-gap-bar]")).toHaveLength(0);
      // the only <line>s are the seven spokes, and nothing is drawn 5 wide
      expect(el.querySelectorAll("line")).toHaveLength(RADAR_AXES.length);
      expect(el.querySelector('[stroke-width="5"]')).toBeNull();
      expect(el.innerHTML).not.toMatch(/#D50A0A/i);
    }
    expect(overlays.every((o) => o.spokes.some((s) => s.gapBar))).toBe(true);
  });

  it("the mid ring is dashed, in the ring colour it was given (amber or grey)", () => {
    for (const ring of ["#F59E0B", "#94A3B8"]) {
      const mid = draw(overlay, OFF, DEF, ring).querySelector('path[data-ring="mid"]')!;
      expect(mid.getAttribute("stroke")).toBe(ring);
      expect(mid.getAttribute("stroke-dasharray")).toBeTruthy();
    }
  });

  it("holds no colour of its own for a team, the ring or a gap: no slate, no amber, no accent, no fallback rule", () => {
    const src = code("MatchupRadarChart.tsx");
    expect(src).not.toMatch(/#334155|#f59e0b|#D50A0A/i);
    expect(src).not.toMatch(/gapBar|GAP_BAR|data-gap-bar/);
    expect(src).not.toMatch(/radarStrokeColor|offSecondaryColor|primaryColor|secondaryColor/);
    expect(src).not.toMatch(/places\s*>=?\s*\d/);
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
