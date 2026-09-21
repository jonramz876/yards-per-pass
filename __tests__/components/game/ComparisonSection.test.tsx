import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";

vi.mock("@/components/ui/MetricTooltip", () => ({
  default: ({ metric }: { metric: string }) => <span data-tooltip={metric} />,
}));

import ComparisonSection from "@/components/game/ComparisonSection";
import { buildComparison, type ComparisonSectionModel } from "@/lib/stats/box-score";
import { BUF_STATS, HOU_STATS } from "../../fixtures/box-score-buf-hou";

const [efficiency, teamStats] = buildComparison(BUF_STATS, HOU_STATS);

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

  it("shows the footnote only when given", () => {
    const { container } = renderSection(teamStats, "Why the play counts differ.");
    expect(container.querySelector("p")?.textContent).toBe("Why the play counts differ.");
    const { container: bare } = renderSection(teamStats);
    expect(bare.querySelector("p")).toBeNull();
    expect(bare.querySelectorAll("[data-row]")).toHaveLength(25);
  });
});
