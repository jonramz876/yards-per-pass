// Direction A's side panel "SHAPE VS SHAPE" (team matchup spec §8, §8.1,
// §8.3): one overlay radar for the side that has the ball, its legend, the
// count line and one paragraph. The only sticky element on the matchup pages.
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import MatchupSidePanel, { PANEL_CHART_MAX_WIDTH, PANEL_STICKY } from "@/components/matchup/MatchupSidePanel";
import { EDGE_LEAN_MIN_GAP, MATCHUP_NO_OVERLAY_NOTE, MATCHUP_RADAR_NOTE, overlayCountLine } from "@/lib/stats/matchup";
import { ACCENT, awayBall, classes, code, homeBall, model, rowsWithout, source } from "./helpers";

const show = (overlay = awayBall().overlay) => render(<MatchupSidePanel overlay={overlay} />).container;
const RED = /213,\s*10,\s*10|#D50A0A/i;

describe("MatchupSidePanel: a drawn overlay", () => {
  it("heading, then a sub-heading that names the pairing it was given", () => {
    const el = show();
    expect(el.querySelector("h3")?.textContent).toBe("SHAPE VS SHAPE");
    expect(el.querySelector("[data-panel-pairing]")?.textContent).toBe("BUF offense over HOU defense");
  });

  it("on the home tab the offense is the HOME team: sub-heading and legend follow offId / defId, never away / home", () => {
    const el = show(homeBall().overlay);
    expect(el.querySelector("[data-panel-pairing]")?.textContent).toBe("HOU offense over BUF defense");
    const legend = el.querySelector("[data-panel-legend]")!.textContent!;
    expect(legend).toContain("HOU offense");
    expect(legend).toContain("BUF defense");
    expect(legend).not.toContain("BUF offense");
    expect(legend).not.toContain("HOU defense");
  });

  it("exactly one svg, capped at 440 px wide", () => {
    const el = show();
    expect(el.querySelectorAll("svg")).toHaveLength(1);
    expect(PANEL_CHART_MAX_WIDTH).toBe(440);
    expect((el.querySelector("[data-panel-chart]") as HTMLElement).style.maxWidth).toBe("440px");
  });

  it("the legend: offense, defense, the gap bar with its number from the constant, the mid ring", () => {
    const el = show();
    const legend = el.querySelector("[data-panel-legend]")!;
    expect(legend.textContent).toContain("BUF offense");
    expect(legend.textContent).toContain("HOU defense");
    expect(legend.textContent).toContain(`ranks ${EDGE_LEAN_MIN_GAP}+ apart`);
    expect(legend.textContent).toContain("middle of the league");
    expect((legend.querySelector("[data-swatch='gap']") as HTMLElement).getAttribute("style")).toMatch(RED);
  });

  it("the count line M4 and the paragraph M5, once each", () => {
    const overlay = awayBall().overlay;
    const el = show(overlay);
    expect(el.querySelector("[data-panel-count]")?.textContent).toBe(overlayCountLine(overlay.tally!));
    expect(el.querySelectorAll("[data-panel-note]")).toHaveLength(1);
    expect(el.querySelector("[data-panel-note]")?.textContent).toBe(MATCHUP_RADAR_NOTE);
    expect(el.textContent!.split(MATCHUP_RADAR_NOTE)).toHaveLength(2);
    expect(el.textContent).not.toMatch(/win probability|projected|favou?red/i);
  });
});

describe("MatchupSidePanel: an overlay that cannot be drawn", () => {
  const overlay = model("BUF", "HOU", rowsWithout("BUF")).awayBall!.overlay;
  it("the heading, the sub-heading and M3; no svg, no legend, no count line, no paragraph", () => {
    const el = show(overlay);
    expect(el.querySelector("h3")?.textContent).toBe("SHAPE VS SHAPE");
    expect(el.querySelector("[data-panel-pairing]")?.textContent).toBe("BUF offense over HOU defense");
    expect(el.querySelector("[data-panel-empty]")?.textContent).toBe(MATCHUP_NO_OVERLAY_NOTE);
    expect(el.querySelector("svg")).toBeNull();
    expect(el.querySelector("[data-panel-legend]")).toBeNull();
    expect(el.querySelector("[data-panel-count]")).toBeNull();
    expect(el.querySelector("[data-panel-note]")).toBeNull();
  });
});

describe("the sticky rule (§8.3): the one sticky element, behind both variants", () => {
  it("PANEL_STICKY is one string literal with no interpolation", () => {
    const literal = /const PANEL_STICKY\s*=\s*"([^"]+)";/.exec(source("MatchupSidePanel.tsx"));
    expect(literal, "PANEL_STICKY must be a plain double-quoted literal on one line").not.toBeNull();
    expect(literal![1]).toBe(PANEL_STICKY);
    expect(PANEL_STICKY).not.toContain("${");
  });

  it("two classes, sticky and top-20, each behind lg: and the SAME min-height", () => {
    const parts = PANEL_STICKY.split(/\s+/);
    expect(parts).toHaveLength(2);
    const m = parts.map((p) => /^lg:\[@media\(min-height:(\d+)px\)\]:(sticky|top-20)$/.exec(p));
    expect(m[0]?.[2]).toBe("sticky");
    expect(m[1]?.[2]).toBe("top-20");
    expect(m[0]![1]).toBe(m[1]![1]);
    const height = Number(m[0]![1]);
    expect(height).toBeGreaterThanOrEqual(600);
    expect(height % 20).toBe(0);
  });

  it("the outer element carries them, plus self-start, and no bare sticky / z-index / overflow class", () => {
    const outer = show().firstElementChild!;
    const cls = classes(outer);
    for (const part of PANEL_STICKY.split(/\s+/)) expect(cls).toContain(part);
    expect(cls).toContain("self-start");
    expect(cls.some((c) => /^(sm:|md:|lg:|xl:)?sticky$/.test(c))).toBe(false);
    expect(cls.some((c) => /^z-/.test(c))).toBe(false);
    expect(cls.some((c) => /overflow/.test(c))).toBe(false);
  });

  it("the accent appears in the panel once: the legend's gap swatch", () => {
    expect(code("MatchupSidePanel.tsx").split(ACCENT).length - 1).toBe(1);
    expect(code("MatchupSidePanel.tsx")).not.toMatch(/nflred|red-\d00/);
  });
});
