import { describe, it, expect } from "vitest";
import {
  NFL_TEAMS,
  getTeam,
  getTeamColor,
  getTeamLogo,
  winPct,
  compareRecords,
} from "@/lib/data/teams";

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

/** A W/L/T record; ties default to 0. */
function R(wins: number, losses: number, ties = 0) {
  return { wins, losses, ties };
}

// ---------------------------------------------------------------------------
// winPct
// ---------------------------------------------------------------------------
describe("winPct", () => {
  it("counts a tie as half a win", () => {
    expect(winPct({ wins: 9, losses: 7, ties: 1 })).toBeCloseTo(0.5588, 4);
  });

  it("treats 0-0 and a missing row as .500", () => {
    expect(winPct({ wins: 0, losses: 0, ties: 0 })).toBe(0.5);
    expect(winPct(undefined)).toBe(0.5);
    expect(winPct(null)).toBe(0.5);
  });

  it("reads null/NaN counts as 0 and never returns NaN", () => {
    expect(
      winPct({
        wins: NaN,
        losses: null as unknown as number,
        ties: undefined as unknown as number,
      })
    ).toBe(0.5);
  });
});

// ---------------------------------------------------------------------------
// compareRecords
// ---------------------------------------------------------------------------
describe("compareRecords", () => {
  it("ranks 9-7-1 ahead of 9-8", () => {
    expect(compareRecords(R(9, 7, 1), R(9, 8))).toBeLessThan(0);
    expect(compareRecords(R(9, 8), R(9, 7, 1))).toBeGreaterThan(0);
  });

  it("ranks 3-1 ahead of 3-2 and ahead of 4-2 (bye weeks)", () => {
    expect(compareRecords(R(3, 1), R(3, 2))).toBeLessThan(0);
    expect(compareRecords(R(3, 1), R(4, 2))).toBeLessThan(0);
  });

  it("ranks 1-0 ahead of 0-0, and 0-0 ahead of 0-1", () => {
    expect(compareRecords(R(1, 0), R(0, 0))).toBeLessThan(0);
    expect(compareRecords(R(0, 0), R(0, 1))).toBeLessThan(0);
    // A missing row ranks like 0-0.
    expect(compareRecords(undefined, R(0, 1))).toBeLessThan(0);
  });

  it("at the same win %, more games over .500 leads", () => {
    expect(compareRecords(R(5, 0), R(4, 0))).toBeLessThan(0);
    expect(compareRecords(R(0, 2), R(0, 3))).toBeLessThan(0);
  });

  it("returns 0 for level records", () => {
    expect(compareRecords(R(9, 8), R(9, 8))).toBe(0);
    expect(compareRecords(R(0, 0), R(0, 0, 1))).toBe(0);
    expect(compareRecords(R(1, 1), R(2, 2))).toBe(0);
  });

  it("never returns NaN on broken rows", () => {
    expect(compareRecords({ wins: NaN, losses: NaN, ties: NaN }, undefined)).toBe(0);
  });
});
