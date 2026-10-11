// Direction A's side panel "SHAPE VS SHAPE" (team matchup spec §8, §8.1,
// §8.3): one overlay radar for the side that has the ball, its legend, the
// count line and one paragraph. The only sticky element on the matchup pages.
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import MatchupSidePanel, { PANEL_CHART_MAX_WIDTH, PANEL_STICKY, type MatchupSidePaint } from "@/components/matchup/MatchupSidePanel";
import { MATCHUP_NO_OVERLAY_NOTE, matchupRadarNote, overlayCountLine } from "@/lib/stats/matchup";
import { ACCENT, awayBall, classes, code, homeBall, model, rowsWithout, source } from "./helpers";

// The default paint is BUF at LA's (blue offense, gold defense, grey ring: the
// card's colours for that pair). No default may equal a colour the panel used
// to hold itself (#334155 slate, amber): a panel that went back to one fails.
const PAINT: MatchupSidePaint = { offColor: "#00338D", defColor: "#CC8200", ringColor: "#94A3B8", ringWord: "grey" };
const AMBER: MatchupSidePaint = { offColor: "#D50A0A", defColor: "#041E42", ringColor: "#F59E0B", ringWord: "amber" };
const show = (overlay = awayBall().overlay, paint: MatchupSidePaint = PAINT) =>
  render(<MatchupSidePanel overlay={overlay} paint={paint} />).container;
const rgb = (hex: string) => `rgb(${parseInt(hex.slice(1, 3), 16)}, ${parseInt(hex.slice(3, 5), 16)}, ${parseInt(hex.slice(5, 7), 16)})`;
const swatch = (el: HTMLElement, which: "off" | "def" | "ring") => el.querySelector(`[data-panel-legend] i[data-legend="${which}"]`) as HTMLElement;

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

  it("the legend: three items (offense, defense, the mid ring) and no rank-gap entry", () => {
    const el = show();
    const legend = el.querySelector("[data-panel-legend]")!;
    expect(Array.from(legend.querySelectorAll("li")).map((li) => li.textContent)).toEqual(["BUF offense", "HOU defense", "middle of the league"]);
    expect(Array.from(legend.querySelectorAll("i")).map((i) => i.getAttribute("data-legend"))).toEqual(["off", "def", "ring"]);
    expect(legend.querySelector("[data-swatch='gap']")).toBeNull();
    expect(el.querySelector("[data-swatch]")).toBeNull();
    expect(el.textContent).not.toContain("apart");
  });

  it.each([["BUF at LA's", PAINT], ["an amber-ring pair's", AMBER]] as const)(
    "the three swatches wear the paint they were given (%s), and so does the chart",
    (_name, paint) => {
      const el = show(awayBall().overlay, paint);
      expect(swatch(el, "off").style.borderColor).toBe(rgb(paint.offColor));
      expect(swatch(el, "off").className).toContain("border-solid");
      expect(swatch(el, "def").style.borderColor).toBe(rgb(paint.defColor));
      expect(swatch(el, "def").className).toContain("border-dashed");
      expect(swatch(el, "ring").style.borderColor).toBe(rgb(paint.ringColor));
      expect(swatch(el, "ring").className).toContain("border-dashed");
      // the ring's colour is the paint's, never a class of its own
      expect(swatch(el, "ring").className).not.toMatch(/amber|slate-\d/);
      expect(el.querySelector('path[data-series="off"]')!.getAttribute("stroke")).toBe(paint.offColor);
      expect(el.querySelector('path[data-series="def"]')!.getAttribute("stroke")).toBe(paint.defColor);
      expect(el.querySelector('path[data-ring="mid"]')!.getAttribute("stroke")).toBe(paint.ringColor);
    },
  );

  it("the count line M4 and the paragraph M5, once each; M5 names the ring by the paint's word", () => {
    const overlay = awayBall().overlay;
    const el = show(overlay);
    expect(el.querySelector("[data-panel-count]")?.textContent).toBe(overlayCountLine(overlay.tally!));
    expect(el.querySelectorAll("[data-panel-note]")).toHaveLength(1);
    expect(el.querySelector("[data-panel-note]")?.textContent).toBe(matchupRadarNote("grey"));
    expect(el.textContent!.split(matchupRadarNote("grey"))).toHaveLength(2);
    expect(el.textContent).toContain("the grey ring is the middle of the league");
    expect(el.textContent).not.toContain("amber");
    const amber = show(overlay, AMBER);
    expect(amber.querySelector("[data-panel-note]")?.textContent).toBe(matchupRadarNote("amber"));
    expect(amber.textContent).toContain("the amber ring is the middle of the league");
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

  // Re-measured in headless Chrome on 2026-10-10 over the 15 pairs of week 5,
  // both tabs, after the legend lost its rank-gap entry (page colours
  // amendment): the panel is 617 px tall at 1280 px wide (the legend is one
  // row there now; it was 642) and 586 px at 1024 px, the same for every pair.
  // The rule: tallest + 80 (the sticky offset) + 16, rounded up to the next 20.
  it("the min-height is the measured one: (617 + 80 + 16) rounded up to the next 20 = 720", () => {
    const TALLEST_MEASURED = 617;
    const expected = Math.ceil((TALLEST_MEASURED + 80 + 16) / 20) * 20;
    expect(expected).toBe(720);
    expect(PANEL_STICKY).toBe(`lg:[@media(min-height:${expected}px)]:sticky lg:[@media(min-height:${expected}px)]:top-20`);
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

  it("the accent appears in the panel 0 times, and the panel looks no team up and holds no colour rule", () => {
    const src = code("MatchupSidePanel.tsx");
    expect(src.split(ACCENT).length - 1).toBe(0);
    expect(src).not.toMatch(/nflred|red-\d00/);
    expect(src).not.toMatch(/#334155|#f59e0b|amber-500|GAP_BAR|EDGE_LEAN_MIN_GAP/i);
    expect(src).not.toMatch(/getTeam|lib\/data\/teams|radarStrokeColor|primaryColor|secondaryColor/);
  });
});
