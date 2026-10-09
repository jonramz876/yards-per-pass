import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import RadarChart from "@/components/qb/RadarChart";
import { radarHasTooFewAxes } from "@/lib/stats/radar";

// The stat card's radar and the Compare page share one rule for "too few
// stats to draw an outline": radarHasTooFewAxes in lib/stats/radar.ts (half
// the axes or more missing). These tests bind the stat card's chart to it, so
// the two cannot drift apart.

const NO_OUTLINE = "Not enough data for radar chart";
const axes = (n: number) => Array.from({ length: n }, (_, i) => ({ label: `Axis ${i + 1}` }));
const mask = (n: number, missing: number) => Array.from({ length: n }, (_, i) => i < missing);

function draw(axisCount: number, missingCount: number) {
  const { container } = render(
    <RadarChart values={Array(axisCount).fill(60)} color="#00338D" axes={axes(axisCount)} missing={mask(axisCount, missingCount)} />,
  );
  return { text: container.textContent ?? "", svg: container.querySelector("svg"), dots: container.querySelectorAll("svg circle").length };
}

describe("RadarChart: no outline when half the axes or more are missing", () => {
  it("6 axes: 2 missing is drawn, 3 missing shows the sentence", () => {
    const two = draw(6, 2);
    expect(two.svg).not.toBeNull();
    expect(two.dots).toBe(4);
    expect(two.text).not.toContain(NO_OUTLINE);
    const three = draw(6, 3);
    expect(three.svg).toBeNull();
    expect(three.text).toBe(NO_OUTLINE);
  });

  it("7 axes: 3 missing is drawn, 4 missing shows the sentence", () => {
    const three = draw(7, 3);
    expect(three.svg).not.toBeNull();
    expect(three.dots).toBe(4);
    const four = draw(7, 4);
    expect(four.svg).toBeNull();
    expect(four.text).toBe(NO_OUTLINE);
  });

  it("for every count of missing axes the chart does what the shared rule says", () => {
    for (const n of [6, 7]) {
      for (let k = 0; k <= n; k++) {
        expect(draw(n, k).svg === null, `${k} of ${n}`).toBe(radarHasTooFewAxes(k, n));
      }
    }
  });

  it("a NaN value counts as missing too, as it always did", () => {
    const { container } = render(<RadarChart values={[60, 60, 60, NaN, NaN, NaN]} color="#00338D" axes={axes(6)} />);
    expect(container.textContent).toBe(NO_OUTLINE);
  });
});
