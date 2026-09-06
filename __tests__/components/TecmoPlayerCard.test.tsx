import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import TecmoPlayerCard from "@/components/player/TecmoPlayerCard";
import type { TecmoCardData } from "@/lib/stats/tecmo-card";

const data: TecmoCardData = {
  playerName: "Josh Allen", position: "QB", season: 2026, games: 16,
  archetypeLabel: "Gunslinger", eligible: true, ovr: 91,
  statCells: Array.from({ length: 12 }, (_, i) => ({ label: `S${i}`, value: `${i}` })),
  abilityRows: [
    { label: "EPA/DROPBACK", raw: "+0.21", percentile: 96, missing: false },
    { label: "BALL SECURITY", raw: "3.1% INT", percentile: 38, missing: false },
    { label: "RUSH EPA", raw: "—", percentile: 0, missing: true },
  ],
  radarValues: [96, 84, 90, 62, 78, 71, 91],
  radarLabels: ["EPA/DB", "CPOE", "DB/Game", "aDOT", "Ball Security", "Success%", "Rush EPA"],
};
const team = { teamName: "Buffalo Bills", teamId: "BUF", primaryColor: "#00338D", secondaryColor: "#C60C30" };

describe("TecmoPlayerCard", () => {
  it("renders name, team band, and OVR", () => {
    render(<TecmoPlayerCard data={data} {...team} headshotUrl={null} jerseyNumber={17} />);
    expect(screen.getByText(/Josh Allen/i)).toBeTruthy();
    expect(screen.getByText(/Buffalo Bills/i)).toBeTruthy();
    expect(screen.getByText("91")).toBeTruthy();
    // stat grid renders every cell's label and value
    expect(screen.getByText("S0")).toBeTruthy();
    expect(screen.getByText("11")).toBeTruthy();
  });
  it("renders raw / ordinal percentile per present ability row", () => {
    render(<TecmoPlayerCard data={data} {...team} headshotUrl={null} jerseyNumber={17} />);
    expect(screen.getByText(/\+0\.21/)).toBeTruthy();
    expect(screen.getByText(/96TH/i)).toBeTruthy();
  });
  // The OVR value carries data-ovr so these two assertions can target it exactly:
  // screen.getByText("0") would be ambiguous (a stat cell also renders "0").
  it("renders OVR 0 as 0, not em dash (0 is a valid score)", () => {
    const { container } = render(
      <TecmoPlayerCard data={{ ...data, ovr: 0 }} {...team} headshotUrl={null} jerseyNumber={17} />
    );
    expect(container.querySelector("[data-ovr]")?.textContent).toBe("0");
  });
  it("shows em dash for null OVR", () => {
    const { container } = render(
      <TecmoPlayerCard data={{ ...data, ovr: null, eligible: false }} {...team} headshotUrl={null} jerseyNumber={null} />
    );
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
    expect(container.querySelector("[data-ovr]")?.textContent).toBe("—");
  });
  it("missing ability row: no percentile text, no colored tier dot", () => {
    const { container } = render(<TecmoPlayerCard data={data} {...team} headshotUrl={null} jerseyNumber={17} />);
    // The missing RUSH EPA row must NOT render "0TH". Word-anchored because
    // RadarChart's own legend ("dashed = 50th percentile") contains "0th".
    expect(screen.queryByText(/\b0TH\b/i)).toBeNull();
    // gray dot for missing row
    const dots = container.querySelectorAll("[data-tier-dot]");
    expect(dots.length).toBe(3);
    expect(dots[2].getAttribute("style")).toContain("148, 163, 184"); // #94a3b8 gray
  });
  it("present rows keep tier colors and a percentile-width bar", () => {
    const { container } = render(<TecmoPlayerCard data={data} {...team} headshotUrl={null} jerseyNumber={17} />);
    const dots = container.querySelectorAll("[data-tier-dot]");
    expect(dots[0].getAttribute("style")).toContain("22, 163, 74");  // #16a34a green (96th)
    expect(dots[1].getAttribute("style")).toContain("220, 38, 38");  // #dc2626 red (38th)
    const fills = container.querySelectorAll("[data-bar-fill]");
    expect(fills[0].getAttribute("style")).toContain("width: 96%");
    expect(fills[2].getAttribute("style")).toContain("width: 0%"); // missing row: zero-width bar
  });

  it("keeps the percentile accent readable when the team secondary is light", () => {
    // LV/DAL silver would be near-invisible on the white card.
    const { container } = render(
      <TecmoPlayerCard data={data} {...team} secondaryColor="#A5ACAF"
        headshotUrl={null} jerseyNumber={17} />
    );
    const style = container.querySelector("[data-pct-accent]")?.getAttribute("style");
    expect(style).not.toContain("165, 172, 175"); // #A5ACAF
    expect(style).toContain("15, 23, 42");        // #0f172a navy fallback
  });

  it("keeps a dark team secondary as the percentile accent", () => {
    const { container } = render(
      <TecmoPlayerCard data={data} {...team} headshotUrl={null} jerseyNumber={17} />
    );
    // #C60C30 is dark enough to read on white, so it survives the guard.
    expect(container.querySelector("[data-pct-accent]")?.getAttribute("style"))
      .toContain("198, 12, 48");
  });
  it("labels the ability-row value column VALUE / PCTL", () => {
    render(<TecmoPlayerCard data={data} {...team} headshotUrl={null} jerseyNumber={17} />);
    expect(screen.getByText(/VALUE \/ PCTL/i)).toBeTruthy();
  });

  it("explains each ordinal with a percentile tooltip naming the position pool", () => {
    const { container } = render(
      <TecmoPlayerCard data={data} {...team} headshotUrl={null} jerseyNumber={17} />
    );
    const accents = container.querySelectorAll("[data-pct-accent]");
    // Two present rows (RUSH EPA is missing, so it renders no ordinal).
    expect(accents.length).toBe(2);
    expect(accents[0].getAttribute("title")).toBe("96th percentile among qualified QBs");
    expect(accents[1].getAttribute("title")).toBe("38th percentile among qualified QBs");
  });

  it("a genuine last-place row (percentile 0, not missing) renders normally", () => {
    const lastPlace: TecmoCardData = {
      ...data,
      abilityRows: [{ label: "EPA/DROPBACK", raw: "-0.35", percentile: 0, missing: false }],
    };
    const { container } = render(
      <TecmoPlayerCard data={lastPlace} {...team} headshotUrl={null} jerseyNumber={17} />
    );
    expect(screen.getByText(/\b0TH\b/i)).toBeTruthy();
    expect(container.querySelector("[data-tier-dot]")?.getAttribute("style")).toContain("220, 38, 38");
  });
});
