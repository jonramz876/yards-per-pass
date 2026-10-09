import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import OverlayRadarChart from "@/components/compare/OverlayRadarChart";

const defaultProps = {
  values1: [80, 70, 90, 60, 55, 75],
  values2: [50, 85, 40, 70, 60, 65],
  color1: "#00338D",
  color2: "#E31837",
  name1: "Josh Allen",
  name2: "Patrick Mahomes",
};

describe("OverlayRadarChart", () => {
  it("renders both player names in the legend", () => {
    render(<OverlayRadarChart {...defaultProps} />);
    expect(screen.getByText("Josh Allen")).toBeInTheDocument();
    expect(screen.getByText("Patrick Mahomes")).toBeInTheDocument();
  });

  it("renders an SVG element", () => {
    const { container } = render(<OverlayRadarChart {...defaultProps} />);
    const svg = container.querySelector("svg");
    expect(svg).toBeInTheDocument();
  });

  it("renders two data polygons (one per player)", () => {
    const { container } = render(<OverlayRadarChart {...defaultProps} />);
    // There are 3 structural polygons (outer, mid, inner rings) + 2 data polygons
    const polygons = container.querySelectorAll("svg polygon");
    expect(polygons.length).toBeGreaterThanOrEqual(5);

    // The last two polygons should be the player data ones
    const dataPolygons = Array.from(polygons).filter(
      (p) => p.getAttribute("stroke") === defaultProps.color1 || p.getAttribute("stroke") === defaultProps.color2
    );
    expect(dataPolygons).toHaveLength(2);
  });

  it("renders default axis labels when no custom axes provided", () => {
    render(<OverlayRadarChart {...defaultProps} />);
    for (const label of ["EPA/DB", "CPOE", "DB/Game", "aDOT", "INT Rate", "Success%"]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });

  it("renders custom axis labels when provided", () => {
    const customAxes = [
      { label: "A" },
      { label: "B" },
      { label: "C" },
      { label: "D" },
      { label: "E" },
      { label: "F" },
    ];
    render(<OverlayRadarChart {...defaultProps} axes={customAxes} />);
    for (const axis of customAxes) {
      expect(screen.getByText(axis.label)).toBeInTheDocument();
    }
  });

  it("renders without crashing when all values are zero", () => {
    const { container } = render(
      <OverlayRadarChart
        {...defaultProps}
        values1={[0, 0, 0, 0, 0, 0]}
        values2={[0, 0, 0, 0, 0, 0]}
      />
    );
    const svg = container.querySelector("svg");
    expect(svg).toBeInTheDocument();
  });

  it("renders without crashing when all values are 100", () => {
    const { container } = render(
      <OverlayRadarChart
        {...defaultProps}
        values1={[100, 100, 100, 100, 100, 100]}
        values2={[100, 100, 100, 100, 100, 100]}
      />
    );
    const svg = container.querySelector("svg");
    expect(svg).toBeInTheDocument();
  });

  it("renders 12 dot markers (6 per player)", () => {
    const { container } = render(<OverlayRadarChart {...defaultProps} />);
    const circles = container.querySelectorAll("svg circle");
    expect(circles).toHaveLength(12);
  });

  it("applies correct stroke colors to player polygons", () => {
    const { container } = render(<OverlayRadarChart {...defaultProps} />);
    const polygons = container.querySelectorAll("svg polygon");
    const strokes = Array.from(polygons).map((p) => p.getAttribute("stroke"));
    expect(strokes).toContain(defaultProps.color1);
    expect(strokes).toContain(defaultProps.color2);
  });

  it("player 2 polygon uses dashed stroke", () => {
    const { container } = render(<OverlayRadarChart {...defaultProps} />);
    const polygons = container.querySelectorAll("svg polygon");
    const p2Polygon = Array.from(polygons).find(
      (p) => p.getAttribute("stroke") === defaultProps.color2
    );
    expect(p2Polygon).toBeDefined();
    expect(p2Polygon!.getAttribute("stroke-dasharray")).toBe("6,3");
  });

  it("the legend line is the reworded sentence, once, and no longer says league best", () => {
    const { container } = render(<OverlayRadarChart {...defaultProps} />);
    expect(
      screen.getAllByText("Farther out = higher percentile · dashed ring = 50th percentile")
    ).toHaveLength(1);
    expect(container.textContent).not.toMatch(/league best/);
  });

  it("what the legend says is true of the drawing: a larger value is never closer in, and the dashed ring is at half the radius", () => {
    const axes = ["A", "B", "C", "D", "E", "F"].map((label) => ({ label }));
    const { container } = render(
      <OverlayRadarChart {...defaultProps} values1={[0, 0, 0, 0, 0, 0]} values2={[10, 25, 50, 75, 90, 100]} axes={axes} />
    );
    const polygons = Array.from(container.querySelectorAll("svg polygon"));
    const center = polygons.find((p) => p.getAttribute("stroke") === defaultProps.color1)!
      .getAttribute("points")!.trim().split(/\s+/)[0].split(",").map(Number);
    const dist = (pt: string) => { const [x, y] = pt.split(",").map(Number); return Math.hypot(x - center[0], y - center[1]); };
    const radii = polygons.find((p) => p.getAttribute("stroke") === defaultProps.color2)!
      .getAttribute("points")!.trim().split(/\s+/).map(dist);
    for (let i = 1; i < radii.length; i++) expect(radii[i]).toBeGreaterThan(radii[i - 1]);
    const outer = radii[5];
    const dashed = polygons.find((p) => p.getAttribute("stroke-dasharray") === "5,3")!;
    expect(dist(dashed.getAttribute("points")!.trim().split(/\s+/)[0])).toBeCloseTo(outer / 2, 6);
    expect(radii[2]).toBeCloseTo(outer / 2, 6);
  });

  it("a masked axis is treated exactly as a NaN value: no dot, no vertex, grey label only when both players lack it", () => {
    const axes = ["A", "B", "C", "D", "E", "F"].map((label) => ({ label }));
    const values1 = [80, 70, 90, 60, 55, 0];
    const values2 = [50, 85, 40, 70, 0, 0];
    const masked = render(
      <OverlayRadarChart {...defaultProps} values1={values1} values2={values2} axes={axes}
        missing1={[false, false, false, false, false, true]} missing2={[false, false, false, false, true, true]} />
    );
    const maskedSvg = masked.container.querySelector("svg")!.outerHTML;
    masked.unmount();
    const withNaN = render(
      <OverlayRadarChart {...defaultProps} values1={[80, 70, 90, 60, 55, NaN]} values2={[50, 85, 40, 70, NaN, NaN]} axes={axes} />
    );
    expect(withNaN.container.querySelector("svg")!.outerHTML).toBe(maskedSvg);
    expect(withNaN.container.querySelectorAll("svg circle")).toHaveLength(9);
    expect(screen.getByText("F").getAttribute("fill")).toBe("#cbd5e1");
    // E is missing for player 2 only: the label stays dark.
    expect(screen.getByText("E").getAttribute("fill")).toBe("#475569");
  });

  it("without mask props, or with all-false masks, a 0 is a real 0 at the centre", () => {
    const zeros = [80, 70, 90, 60, 55, 0];
    const plain = render(<OverlayRadarChart {...defaultProps} values1={zeros} />);
    const plainSvg = plain.container.querySelector("svg")!.outerHTML;
    expect(plain.container.querySelectorAll("svg circle")).toHaveLength(12);
    plain.unmount();
    const allFalse = render(
      <OverlayRadarChart {...defaultProps} values1={zeros} missing1={Array(6).fill(false)} missing2={Array(6).fill(false)} />
    );
    expect(allFalse.container.querySelector("svg")!.outerHTML).toBe(plainSvg);
  });

  it("a NaN axis gets no dot and no vertex", () => {
    const customAxes = ["A", "B", "C", "D", "E", "F"].map((label) => ({ label }));
    const { container } = render(
      <OverlayRadarChart
        {...defaultProps}
        values1={[80, 70, 90, 60, 55, NaN]}
        values2={[50, 85, 40, 70, 60, NaN]}
        axes={customAxes}
      />
    );
    expect(container.querySelectorAll("svg circle")).toHaveLength(10);
    const dataPolygons = Array.from(container.querySelectorAll("svg polygon")).filter(
      (p) => p.getAttribute("stroke") === defaultProps.color1 || p.getAttribute("stroke") === defaultProps.color2
    );
    expect(dataPolygons).toHaveLength(2);
    for (const p of dataPolygons) {
      expect(p.getAttribute("points")!.trim().split(/\s+/)).toHaveLength(5);
    }
    expect(screen.getByText("F").getAttribute("fill")).toBe("#cbd5e1");
    expect(screen.getByText("A").getAttribute("fill")).toBe("#475569");
  });
});
