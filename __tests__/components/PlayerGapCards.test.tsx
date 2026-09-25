// Spec A §4.5 (T11): on /run-gaps, a card's EPA/carry value and its "vs league"
// number are coloured against the league average the header prints ("Lg avg"),
// with the 0.03 carry band, so the two always agree. They used to be sign
// coloured: a better-than-average -0.04 carry printed red.
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import PlayerGapCards from "@/components/charts/PlayerGapCards";
import type { RBGapStat } from "@/lib/types";

function gapRow(id: string, name: string, epa: number): RBGapStat {
  return {
    id, player_id: id, player_name: name, team_id: "BUF", season: 2026, gap: "LG",
    carries: 20, epa_per_carry: epa, yards_per_carry: 4, success_rate: 0.4, stuff_rate: 0.2, explosive_rate: 0.1,
  };
}

const LEAGUE = { epa: -0.08, yards: 4.2, success: 0.4, stuff: 0.18, explosive: 0.11 };

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
