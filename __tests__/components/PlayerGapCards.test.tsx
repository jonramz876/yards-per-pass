// Spec A §4.5 (T11): on /run-gaps, a card's EPA/carry value and its "vs league"
// number are coloured against the league average the header prints ("Lg avg"),
// with the 0.03 carry band, so the two always agree. They used to be sign
// coloured: a better-than-average -0.04 carry printed red.
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import PlayerGapCards, { allRunsLeagueAvg } from "@/components/charts/PlayerGapCards";
import type { RBGapStat } from "@/lib/types";
import type { GapLeagueAvg } from "@/lib/data/run-gaps";

function gapRow(id: string, name: string, epa: number): RBGapStat {
  return {
    id, player_id: id, player_name: name, team_id: "BUF", season: 2026, gap: "LG",
    carries: 20, epa_per_carry: epa, yards_per_carry: 4, success_rate: 0.4, stuff_rate: 0.2, explosive_rate: 0.1,
  };
}

// carries: the league carries behind the average (above the 350-carry floor).
const LEAGUE = { epa: -0.08, yards: 4.2, success: 0.4, stuff: 0.18, explosive: 0.11, carries: 400 };

function card(container: HTMLElement, name: string): HTMLElement {
  const link = Array.from(container.querySelectorAll("a")).find((a) => a.textContent === name)!;
  return link.closest("div.bg-white") as HTMLElement;
}
function valueClass(el: HTMLElement): string {
  const label = Array.from(el.querySelectorAll("div")).find((d) => (d.textContent ?? "").startsWith("EPA/carry:"))!;
  return label.querySelector("span")!.className;
}
function vsLeagueClass(el: HTMLElement): string {
  const row = Array.from(el.querySelectorAll("div")).find(
    (d) => d.firstElementChild?.textContent === "vs league" && d.children.length === 2,
  )!;
  return row.children[1].className;
}

describe("PlayerGapCards EPA colours", () => {
  it("-0.04 against a -0.08 league average is green on both; -0.10 is grey on both", () => {
    const { container } = render(
      <PlayerGapCards
        gap="LG"
        stats={[gapRow("a", "Better Back", -0.04), gapRow("b", "Average Back", -0.1)]}
        teamAvgEpa={-0.07}
        leagueRank={3}
        leagueAvg={LEAGUE}
      />,
    );
    const better = card(container, "Better Back");
    expect(valueClass(better)).toContain("text-green-600");
    expect(vsLeagueClass(better)).toContain("text-green-600");
    expect(valueClass(better)).toContain("font-semibold");
    const average = card(container, "Average Back");
    expect(valueClass(average)).toContain("text-gray-700");
    expect(vsLeagueClass(average)).toContain("text-gray-700");
    expect(valueClass(average)).not.toMatch(/text-(red|green)-/);
  });
});

// Chaos pass C31: the same colour rule as everywhere else on the site.
describe("PlayerGapCards: sample cut-off and printed-number rule", () => {
  function vsLeagueText(el: HTMLElement): string {
    const row = Array.from(el.querySelectorAll("div")).find(
      (d) => d.firstElementChild?.textContent === "vs league" && d.children.length === 2,
    )!;
    return row.children[1].textContent ?? "";
  }

  it("no colour until the league average stands on 350 carries", () => {
    const at = (carries: number) =>
      card(
        render(
          <PlayerGapCards gap="LG" stats={[gapRow("a", "Better Back", -0.04)]} teamAvgEpa={-0.07} leagueRank={3} leagueAvg={{ ...LEAGUE, carries }} />,
        ).container,
        "Better Back",
      );
    const thin = at(349);
    expect(valueClass(thin)).toContain("text-gray-700");
    expect(vsLeagueClass(thin)).toContain("text-gray-700");
    const enough = at(350);
    expect(valueClass(enough)).toContain("text-green-600");
    expect(vsLeagueClass(enough)).toContain("text-green-600");
  });

  it("compares the numbers the card prints (to 0.001): -0.050 against -0.080 is grey, and vs league reads +0.030", () => {
    const { container } = render(
      <PlayerGapCards gap="LG" stats={[gapRow("a", "Edge Back", -0.0496)]} teamAvgEpa={-0.07} leagueRank={3} leagueAvg={{ ...LEAGUE, epa: -0.0804 }} />,
    );
    const el = card(container, "Edge Back");
    expect(el.textContent).toContain("-0.050");
    expect(container.textContent).toContain("Lg avg: -0.080");
    expect(vsLeagueText(el)).toBe("+0.030");
    expect(valueClass(el)).toContain("text-gray-700");
    expect(vsLeagueClass(el)).toContain("text-gray-700");
  });

  it("never prints a signed zero for the league average", () => {
    const { container } = render(
      <PlayerGapCards gap="LG" stats={[gapRow("a", "Some Back", 0.1)]} teamAvgEpa={0} leagueRank={3} leagueAvg={{ ...LEAGUE, epa: -0.0004 }} />,
    );
    expect(container.textContent).toContain("Lg avg: 0.000");
    expect(container.textContent).not.toContain("-0.000");
  });
});

describe("allRunsLeagueAvg (the All Runs baseline)", () => {
  const gap = (g: string, epa: number, carries: number): GapLeagueAvg => ({
    gap: g, avg_epa: epa, avg_yards: epa * 10 + 4, avg_success: 0.4, avg_stuff: 0.2, avg_explosive: 0.1, carries,
  });

  it("weights each gap by its carries, not a plain mean of the gap averages", () => {
    // (-0.2 x 300 + 0.2 x 100) / 400 = -0.10; the plain mean would be 0.00.
    const a = allRunsLeagueAvg([gap("M", -0.2, 300), gap("LE", 0.2, 100)]);
    expect(a.epa).toBeCloseTo(-0.1, 12);
    expect(a.yards).toBeCloseTo((2 * 300 + 6 * 100) / 400, 12);
    expect(a.carries).toBe(400);
  });

  it("is empty (no colour, no Lg avg) with no gaps", () => {
    expect(allRunsLeagueAvg([])).toEqual({ epa: null, yards: null, success: null, stuff: null, explosive: null, carries: 0 });
  });
});
