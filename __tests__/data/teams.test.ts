import { describe, it, expect } from "vitest";
import { NFL_TEAMS, getTeam, getTeamColor, getTeamLogo } from "@/lib/data/teams";

// ---------------------------------------------------------------------------
// getTeam
// ---------------------------------------------------------------------------
describe("getTeam", () => {
  it("returns Buffalo Bills for 'BUF'", () => {
    const team = getTeam("BUF");
    expect(team).toBeDefined();
    expect(team!.name).toBe("Buffalo Bills");
  });

  it("returns Los Angeles Rams for 'LA' (not 'LAR')", () => {
    const team = getTeam("LA");
    expect(team).toBeDefined();
    expect(team!.name).toBe("Los Angeles Rams");
  });

  it("returns undefined for 'LAR' (wrong abbreviation)", () => {
    expect(getTeam("LAR")).toBeUndefined();
  });

  it("returns undefined for an invalid ID", () => {
    expect(getTeam("XYZ")).toBeUndefined();
  });

  it("returns undefined for empty string", () => {
    expect(getTeam("")).toBeUndefined();
  });

  it("finds all AFC East teams", () => {
    for (const abbr of ["BUF", "MIA", "NE", "NYJ"]) {
      expect(getTeam(abbr)).toBeDefined();
    }
  });
});

// ---------------------------------------------------------------------------
// getTeamColor
// ---------------------------------------------------------------------------
describe("getTeamColor", () => {
  it("returns a hex color string for a valid team", () => {
    const color = getTeamColor("KC");
    expect(color).toMatch(/^#[0-9A-Fa-f]{6}$/);
  });

  it("returns the correct primary color for the Chiefs", () => {
    expect(getTeamColor("KC")).toBe("#E31837");
  });

  it("returns fallback gray for an invalid team ID", () => {
    expect(getTeamColor("INVALID")).toBe("#6B7280");
  });
});

// ---------------------------------------------------------------------------
// getTeamLogo
// ---------------------------------------------------------------------------
describe("getTeamLogo", () => {
  it("returns /logos/{slug}.png for a valid team", () => {
    const logo = getTeamLogo("BUF");
    expect(logo).toBe("/logos/buf.png");
  });

  it("returns /logos/la.png for the Rams", () => {
    expect(getTeamLogo("LA")).toBe("/logos/la.png");
  });

  it("returns empty string for an invalid team ID", () => {
    expect(getTeamLogo("INVALID")).toBe("");
  });
});

// ---------------------------------------------------------------------------
// NFL_TEAMS completeness
// ---------------------------------------------------------------------------
describe("NFL_TEAMS", () => {
  it("contains exactly 32 teams", () => {
    expect(NFL_TEAMS).toHaveLength(32);
  });

  it("every team has an id, name, abbreviation, division, conference, primaryColor, and logo", () => {
    for (const team of NFL_TEAMS) {
      expect(team.id).toBeTruthy();
      expect(team.name).toBeTruthy();
      expect(team.abbreviation).toBeTruthy();
      expect(team.division).toBeTruthy();
      expect(team.conference).toBeTruthy();
      expect(team.primaryColor).toMatch(/^#[0-9A-Fa-f]{6}$/);
      expect(team.logo).toMatch(/^\/logos\/.+\.png$/);
    }
  });

  it("has no duplicate team IDs", () => {
    const ids = NFL_TEAMS.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("every team belongs to either AFC or NFC", () => {
    for (const team of NFL_TEAMS) {
      expect(["AFC", "NFC"]).toContain(team.conference);
    }
  });

  it("has 16 teams per conference", () => {
    const afc = NFL_TEAMS.filter((t) => t.conference === "AFC");
    const nfc = NFL_TEAMS.filter((t) => t.conference === "NFC");
    expect(afc).toHaveLength(16);
    expect(nfc).toHaveLength(16);
  });
});
