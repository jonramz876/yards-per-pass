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

  it("renders the legend footnote about outer ring and dashed percentile", () => {
    render(<OverlayRadarChart {...defaultProps} />);
    expect(
      screen.getByText("outer ring = league best · dashed = 50th percentile")
    ).toBeInTheDocument();
  });
});
