import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";

vi.mock("@/components/ui/MetricTooltip", () => ({
  default: ({ metric }: { metric: string }) => <span data-tooltip={metric} />,
}));

import ComparisonSection from "@/components/game/ComparisonSection";
import { buildComparison, type ComparisonSectionModel } from "@/lib/stats/box-score";
import { BUF_STATS, HOU_STATS, teamRow } from "../../fixtures/box-score-buf-hou";

const [efficiency, teamStats] = buildComparison(BUF_STATS, HOU_STATS);
const M = "\u2212"; // typographic minus

function renderSection(section: ComparisonSectionModel, footnote?: string) {
  return render(<ComparisonSection section={section} awayId="BUF" homeId="HOU" footnote={footnote} />);
}

describe("ComparisonSection", () => {
  it("bands the away abbreviation, title and home abbreviation on the 28/1fr/28 grid", () => {
    const { container } = renderSection(efficiency);
    const band = container.querySelector("h2")!;
    expect(band.className).toContain("grid-cols-[28%_1fr_28%]");
    const spans = Array.from(band.querySelectorAll("span")).map((s) => [s.textContent, s.className.includes("text-right"), s.className.includes("text-left")]);
    expect(spans).toEqual([["BUF", true, false], ["Efficiency", false, false], ["HOU", false, true]]);
    const cols = container.querySelectorAll("colgroup col");
    expect(cols[0].className).toContain("w-[28%]");
    expect(cols[2].className).toContain("w-[28%]");
  });

  it("aligns away values right and home values left, shades the better side, mutes details", () => {
    const { container } = renderSection(efficiency);
    const row = container.querySelector('[data-row="epa"]')!;
    const [away, label, home] = Array.from(row.querySelectorAll("td"));
    expect(away.className).toContain("text-right");
    expect(home.className).toContain("text-left");
    expect(label.className).toContain("text-center");
    expect(row.getAttribute("data-better")).toBe("away");
    expect((away as HTMLElement).style.backgroundColor).toBe("rgb(236, 253, 245)");
    expect((away as HTMLElement).style.color).toBe("rgb(6, 95, 70)");
    expect(away.className).toContain("font-bold");
    expect((home as HTMLElement).style.backgroundColor).toBe("");
    expect(away.textContent).toBe("+0.28(56)");
    expect(away.querySelector("span")?.textContent).toBe("(56)");
    expect(away.querySelector("span")?.className).toContain("text-[#3f8f72]");
    expect(home.querySelector("span")?.className).toContain("text-slate-400");
  });

  it("prefixes sub-rows with the arrow in lighter type and leaves equal rows unshaded", () => {
    const { container } = renderSection(efficiency);
    const sub = container.querySelector('[data-row="epa-pass"]')!;
    expect(sub.querySelectorAll("td")[1].textContent).toBe("↳ Passing");
    // BUF is the better side of this sub-row (bold); HOU's cell shows the lighter sub-row type.
    expect(sub.querySelectorAll("td")[0].className).toContain("font-bold");
    expect(sub.querySelectorAll("td")[2].className).toContain("font-medium");
    const equal = container.querySelector('[data-row="explosive"]')!;
    expect(equal.getAttribute("data-better")).toBeNull();
    for (const td of Array.from(equal.querySelectorAll("td"))) expect((td as HTMLElement).style.backgroundColor).toBe("");
  });

  it("renders a tooltip on the rows that carry one, label details and suffixes", () => {
    const { container } = renderSection(efficiency);
    expect(Array.from(container.querySelectorAll("[data-tooltip]")).map((e) => e.getAttribute("data-tooltip"))).toEqual([
      "EPA / play", "Success rate", "1st down rate", "Explosive plays", "Toxic differential",
    ]);
    expect(container.querySelector('[data-row="epa"] td:nth-child(2)')?.textContent).toBe("EPA / play(plays)");
    const downs = buildComparison(BUF_STATS, HOU_STATS)[3];
    const { container: c2 } = renderSection(downs);
    expect(c2.querySelector('[data-row="early-epa"] td:nth-child(2)')?.textContent).toBe("Early downs(1st–2nd) EPA / play");
    expect(c2.querySelectorAll("[data-tooltip]")).toHaveLength(0);
  });

  // Only the `epa` row's shading was asserted at the component level, and it
  // is the easy case (bigger number wins). These two are the ones a refactor
  // would get wrong: "What it cost them" applies higher-is-better to negative
  // "EPA lost to" values, so less bad wins — 0.0 beats −7.0 — and the made-att
  // rows shade by the conversion rate, not by the made count.
  it("shades less-bad as better in the cost section, and by the rate on made-att rows", () => {
    const { container: cost } = renderSection(buildComparison(BUF_STATS, HOU_STATS)[2]);
    const turnovers = cost.querySelector('[data-row="cost-turnovers"]')!;
    const [costAway, , costHome] = Array.from(turnovers.querySelectorAll("td"));
    expect([costAway.textContent, costHome.textContent]).toEqual(["0.0", `${M}7.0`]);
    expect(turnovers.getAttribute("data-better")).toBe("away");
    expect((costAway as HTMLElement).style.backgroundColor).toBe("rgb(236, 253, 245)");
    expect((costHome as HTMLElement).style.backgroundColor).toBe("");

    // The golden game's 3-9 (33%) against 7-16 (44%) gives the same answer
    // whether you compare the rate or the made count, so it cannot tell the
    // two apart. Make them disagree: 3 of 5 (60%) against 4 of 16 (25%) —
    // the made count would shade home, the conversion rate shades away.
    const skewed = buildComparison(
      teamRow({ third_down_conv: 3, third_down_att: 5 }),
      teamRow({ team_id: "HOU", third_down_conv: 4, third_down_att: 16 })
    )[1];
    const { container: team } = renderSection(skewed);
    const third = team.querySelector('[data-row="third-down"]')!;
    const [thirdAway, , thirdHome] = Array.from(third.querySelectorAll("td"));
    expect([thirdAway.textContent, thirdHome.textContent]).toEqual(["3-5", "4-16"]);
    expect(third.getAttribute("data-better")).toBe("away");
    expect((thirdAway as HTMLElement).style.backgroundColor).toBe("rgb(236, 253, 245)");
    expect((thirdHome as HTMLElement).style.backgroundColor).toBe("");
  });

  it("shows the footnote only when given", () => {
    const { container } = renderSection(teamStats, "Why the play counts differ.");
    expect(container.querySelector("p")?.textContent).toBe("Why the play counts differ.");
    const { container: bare } = renderSection(teamStats);
    expect(bare.querySelector("p")).toBeNull();
    expect(bare.querySelectorAll("[data-row]")).toHaveLength(25);
  });
});
