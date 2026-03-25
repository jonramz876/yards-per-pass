import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import StatCardView from "@/components/player/StatCardView";

const defaultProps = {
  playerName: "Josh Allen",
  position: "QB",
  teamName: "Buffalo Bills",
  teamColor: "#00338D",
  season: 2024,
  radarValues: [85, 70, 90, 60, 55, 75],
  radarLabels: ["Efficiency", "Accuracy", "Volume", "Depth", "Ball Security", "Consistency"],
  chipStats: [
    { label: "CMP%", value: "67.2%", rank: "8th of 32" },
    { label: "EPA/DB", value: "0.21", rank: "5th of 32" },
    { label: "TD%", value: "6.1%", rank: "4th of 32" },
  ],
  barStats: [
    { label: "YPA", value: "8.2", delta: 1.1, pct: 30 },
    { label: "CPOE", value: "+2.4", delta: 2.4, pct: 25 },
    { label: "aDOT", value: "9.1", delta: 0.5, pct: 15 },
  ],
};

describe("StatCardView", () => {
  it("renders player name", () => {
    render(<StatCardView {...defaultProps} />);
    expect(screen.getByText("Josh Allen")).toBeInTheDocument();
  });

  it("renders team name and season in header", () => {
    render(<StatCardView {...defaultProps} />);
    // The header contains "QB · Buffalo Bills · 2024 Season" rendered with &middot;
    const header = screen.getByText(/Buffalo Bills/);
    expect(header).toBeInTheDocument();
    expect(header.textContent).toContain("2024 Season");
  });

  it("renders all 6 radar axis labels", () => {
    const { container } = render(<StatCardView {...defaultProps} />);
    const svgTexts = container.querySelectorAll("svg text");
    const labels = Array.from(svgTexts).map((el) => el.textContent);
    for (const label of defaultProps.radarLabels) {
      expect(labels).toContain(label);
    }
  });

  it("renders an SVG with a radar data polygon path", () => {
    const { container } = render(<StatCardView {...defaultProps} />);
    const paths = container.querySelectorAll("svg path");
    // At least 3 paths: outer ring, mid ring, data polygon
    expect(paths.length).toBeGreaterThanOrEqual(3);
  });

  it("renders bar stats with labels and values", () => {
    render(<StatCardView {...defaultProps} />);
    for (const bar of defaultProps.barStats) {
      expect(screen.getByText(bar.label)).toBeInTheDocument();
      // Values may appear multiple times (e.g. value matches delta text)
      const matches = screen.getAllByText(bar.value);
      expect(matches.length).toBeGreaterThanOrEqual(1);
    }
  });

  it("renders chip stats with labels, values, and ranks", () => {
    render(<StatCardView {...defaultProps} />);
    for (const chip of defaultProps.chipStats) {
      expect(screen.getByText(chip.label)).toBeInTheDocument();
      expect(screen.getByText(chip.value)).toBeInTheDocument();
      expect(screen.getByText(chip.rank)).toBeInTheDocument();
    }
  });

  it("renders branding footer with default text", () => {
    render(<StatCardView {...defaultProps} />);
    expect(screen.getByText("yardsperpass.com")).toBeInTheDocument();
  });

  it("renders custom branding when provided", () => {
    render(<StatCardView {...defaultProps} branding="custom-brand.com" />);
    expect(screen.getByText("custom-brand.com")).toBeInTheDocument();
  });

  it("renders data source text", () => {
    render(<StatCardView {...defaultProps} />);
    expect(screen.getByText("Data: nflverse play-by-play")).toBeInTheDocument();
  });

  it("uses inline styles (no Tailwind classes on root)", () => {
    const { container } = render(<StatCardView {...defaultProps} />);
    const root = container.firstElementChild as HTMLElement;
    expect(root.style.width).toBe("960px");
    expect(root.style.backgroundColor).toBe("rgb(255, 255, 255)");
  });

  it("renders the team color bar at the top", () => {
    const { container } = render(<StatCardView {...defaultProps} />);
    // Root > color bar div (first child of the root card)
    const root = container.firstElementChild as HTMLElement;
    const colorBar = root.firstElementChild as HTMLElement;
    expect(colorBar.style.backgroundColor).toBe("rgb(0, 51, 141)"); // #00338D
    expect(colorBar.style.height).toBe("6px");
  });

  it("renders 6 circle dots on the radar chart", () => {
    const { container } = render(<StatCardView {...defaultProps} />);
    const circles = container.querySelectorAll("svg circle");
    expect(circles).toHaveLength(6);
  });
});
