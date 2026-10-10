// One side's wrapper (team matchup spec §8, §8.3): the ladder and the side
// panel built from the SAME MatchupSide, in one grid. The toggle shows or
// hides whole wrappers, so a ladder and a radar from different sides can
// never be on screen together.
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import MatchupBallView, { BALL_GRID_GAP, BALL_GRID_SPLIT } from "@/components/matchup/MatchupBallView";
import { PANEL_CHART_MAX_WIDTH, PANEL_PADDING } from "@/components/matchup/MatchupSidePanel";
import { awayBall, classes, homeBall, source } from "./helpers";

describe("MatchupBallView", () => {
  it.each([["away", awayBall(), "BUF", "HOU"], ["home", homeBall(), "HOU", "BUF"]] as const)(
    "%s ball: one ladder and one panel, naming the same offense and defense",
    (_name, side, off, def) => {
      const el = render(<MatchupBallView side={side} />).container;
      expect(el.querySelectorAll("[data-ladder]")).toHaveLength(1);
      expect(el.querySelectorAll("[data-matchup-panel]")).toHaveLength(1);
      expect(el.querySelector('[data-unit="off"] [data-unit-title]')?.textContent).toBe(`${off} OFFENSE`);
      expect(el.querySelector("[data-panel-pairing]")?.textContent).toBe(`${off} offense over ${def} defense`);
      expect(side.ladder.offId).toBe(side.overlay.offId);
    },
  );

  it("one column by default; the two-column grid only behind lg:", () => {
    const el = render(<MatchupBallView side={awayBall()} />).container;
    const view = el.querySelector("[data-ball-view]")!;
    const cls = classes(view);
    expect(cls).toContain("grid");
    expect(cls).toContain("grid-cols-1");
    expect(cls).toContain("lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]");
    expect(cls).toContain("lg:gap-[22px]");
    expect(cls).toContain("lg:items-start");
    expect(cls.filter((c) => /grid-cols-\[/.test(c)).every((c) => c.startsWith("lg:"))).toBe(true);
    expect(cls.some((c) => /overflow/.test(c))).toBe(false);
    for (const child of Array.from(view.children)) expect(classes(child)).toContain("min-w-0");
  });

  it("the constants match the class string", () => {
    expect(BALL_GRID_SPLIT).toEqual([1.5, 1]);
    expect(BALL_GRID_GAP).toBe(22);
    expect(source("MatchupBallView.tsx")).toContain(`lg:gap-[${BALL_GRID_GAP}px]`);
  });
});

// §8.1's table, recomputed from the constants: how wide the panel's chart is
// at each window width. The side column is never used where it would make the
// chart smaller than it is on a 375 px phone.
describe("the panel's chart width at each window width (§8.1)", () => {
  const CONTAINER_MAX = 1280; // max-w-7xl
  const pagePad = (w: number) => (w >= 768 ? 24 : 12); // px-3 md:px-6
  const chart = (w: number): number => {
    const container = Math.min(w, CONTAINER_MAX) - 2 * pagePad(w);
    const [a, b] = BALL_GRID_SPLIT;
    const panel = w >= 1024 ? ((container - BALL_GRID_GAP) * b) / (a + b) : container;
    const inner = panel - 2 * ((w >= 768 ? PANEL_PADDING.md : PANEL_PADDING.sm) + 1);
    return Math.round(Math.min(inner, PANEL_CHART_MAX_WIDTH));
  };

  it("matches the spec's table", () => {
    expect([320, 375, 768, 1023, 1024, 1100, 1280, 1440].map(chart)).toEqual([274, 329, 440, 440, 348, 378, 440, 440]);
  });

  it("at 1024 px, the narrowest side column, the chart is at least as wide as on a 375 px phone", () => {
    expect(chart(1024)).toBeGreaterThanOrEqual(chart(375));
  });
});
