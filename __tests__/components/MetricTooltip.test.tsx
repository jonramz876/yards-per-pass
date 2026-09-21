import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import MetricTooltip, { METRIC_DEFINITIONS as DEFINITION_TEXT } from "@/components/ui/MetricTooltip";
import { TooltipProvider } from "@/components/ui/tooltip";
import { buildComparison } from "@/lib/stats/box-score";
import { BUF_STATS, HOU_STATS } from "../fixtures/box-score-buf-hou";

describe("MetricTooltip — box score definitions (spec §4)", () => {
  it.each([
    ["EPA / play", "the way nflfastR and rbsdm.com do"],
    ["Success rate", "EPA above zero"],
    ["1st down rate", "penalty on a wiped play"],
    ["Explosive plays", "QB scrambles of 10+ yards count as explosive runs"],
    ["Toxic differential", "Turnover margin plus explosive-play margin"],
  ])("defines %s", (metric, fragment) => {
    render(
      <TooltipProvider>
        <MetricTooltip metric={metric} />
      </TooltipProvider>
    );
    expect(screen.getByLabelText(`What is ${metric}?`)).toBeTruthy();
    expect(DEFINITION_TEXT[metric]).toContain(fragment);
  });

  it("defines every tooltip key the box score actually asks for", () => {
    // A renamed or typo'd key fails silently — MetricTooltip returns null and the
    // "i" badge just stops appearing, with no error and nothing for CI to catch.
    const keys = buildComparison(BUF_STATS, HOU_STATS)
      .flatMap((section) => section.rows)
      .map((row) => row.tooltip)
      .filter((key): key is string => Boolean(key));
    expect(keys.length).toBeGreaterThan(0);
    for (const key of keys) {
      expect(DEFINITION_TEXT[key], `no definition for tooltip key "${key}"`).toBeTruthy();
    }
  });

  it("renders nothing for an unknown metric", () => {
    const { container } = render(
      <TooltipProvider>
        <MetricTooltip metric="No such stat" />
      </TooltipProvider>
    );
    expect(container.innerHTML).toBe("");
  });
});
