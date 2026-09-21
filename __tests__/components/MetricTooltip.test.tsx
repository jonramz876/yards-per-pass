import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import MetricTooltip, { METRIC_DEFINITIONS as DEFINITION_TEXT } from "@/components/ui/MetricTooltip";
import { TooltipProvider } from "@/components/ui/tooltip";

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

  it("renders nothing for an unknown metric", () => {
    const { container } = render(
      <TooltipProvider>
        <MetricTooltip metric="No such stat" />
      </TooltipProvider>
    );
    expect(container.innerHTML).toBe("");
  });
});
