import { describe, it, expect } from "vitest";
import { qbFantasyPoints, wrFantasyPoints, rbFantasyPoints } from "@/lib/stats/fantasy";

// ---------------------------------------------------------------------------
// qbFantasyPoints
// ---------------------------------------------------------------------------
describe("qbFantasyPoints", () => {
  it("calculates known QB stat line correctly", () => {
    // 300 pass yds / 25 = 12, 3 TDs * 4 = 12, 1 INT * -2 = -2, 30 rush yds / 10 = 3, 1 rush TD * 6 = 6
    const pts = qbFantasyPoints({
      passing_yards: 300,
      touchdowns: 3,
      interceptions: 1,
      rush_yards: 30,
      rush_tds: 1,
    });
    expect(pts).toBeCloseTo(31, 1);
  });

  it("handles zero stats", () => {
    expect(
      qbFantasyPoints({ passing_yards: 0, touchdowns: 0, interceptions: 0 })
    ).toBe(0);
  });

  it("subtracts for interceptions and fumbles", () => {
    const pts = qbFantasyPoints({
      passing_yards: 0,
      touchdowns: 0,
      interceptions: 3,
      fumbles_lost: 2,
    });
    // 3 * -2 + 2 * -1 = -8
    expect(pts).toBe(-8);
  });

  it("handles missing optional fields gracefully", () => {
    const pts = qbFantasyPoints({
      passing_yards: 250,
      touchdowns: 2,
      interceptions: 0,
    });
    // 250/25 + 2*4 = 10 + 8 = 18
    expect(pts).toBeCloseTo(18, 1);
  });

  it("gives a big game the right total (400 yds, 4 TDs, 0 INTs, 40 rush, 1 rush TD)", () => {
    const pts = qbFantasyPoints({
      passing_yards: 400,
      touchdowns: 4,
      interceptions: 0,
      rush_yards: 40,
      rush_tds: 1,
    });
    // 400/25=16, 4*4=16, 40/10=4, 1*6=6 → 42
    expect(pts).toBeCloseTo(42, 1);
  });
});

// ---------------------------------------------------------------------------
// wrFantasyPoints
// ---------------------------------------------------------------------------
describe("wrFantasyPoints", () => {
  it("calculates PPR scoring correctly", () => {
    const pts = wrFantasyPoints(
      { receiving_yards: 120, receiving_tds: 1, receptions: 8 },
      "ppr"
    );
    // 120/10=12, 1*6=6, 8*1=8 → 26
    expect(pts).toBeCloseTo(26, 1);
  });

  it("calculates half-PPR scoring correctly", () => {
    const pts = wrFantasyPoints(
      { receiving_yards: 120, receiving_tds: 1, receptions: 8 },
      "half"
    );
    // 120/10=12, 1*6=6, 8*0.5=4 → 22
    expect(pts).toBeCloseTo(22, 1);
  });

  it("calculates standard scoring correctly", () => {
    const pts = wrFantasyPoints(
      { receiving_yards: 120, receiving_tds: 1, receptions: 8 },
      "std"
    );
    // 120/10=12, 1*6=6, 8*0=0 → 18
    expect(pts).toBeCloseTo(18, 1);
  });

  it("defaults to PPR when format is omitted", () => {
    const pts = wrFantasyPoints({
      receiving_yards: 100,
      receiving_tds: 0,
      receptions: 5,
    });
    // 100/10=10, 5*1=5 → 15
    expect(pts).toBeCloseTo(15, 1);
  });

  it("subtracts for fumbles", () => {
    const pts = wrFantasyPoints(
      { receiving_yards: 0, receiving_tds: 0, receptions: 0, fumbles_lost: 2 },
      "ppr"
    );
    expect(pts).toBe(-2);
  });

  it("handles all zeros", () => {
    expect(
      wrFantasyPoints({ receiving_yards: 0, receiving_tds: 0, receptions: 0 }, "ppr")
    ).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// rbFantasyPoints
// ---------------------------------------------------------------------------
describe("rbFantasyPoints", () => {
  it("calculates PPR with rushing + receiving", () => {
    const pts = rbFantasyPoints(
      {
        rushing_yards: 100,
        rushing_tds: 1,
        receiving_yards: 40,
        receiving_tds: 0,
        receptions: 4,
      },
      "ppr"
    );
    // 100/10=10, 1*6=6, 40/10=4, 4*1=4 → 24
    expect(pts).toBeCloseTo(24, 1);
  });

  it("calculates half-PPR correctly", () => {
    const pts = rbFantasyPoints(
      {
        rushing_yards: 100,
        rushing_tds: 1,
        receiving_yards: 40,
        receiving_tds: 0,
        receptions: 4,
      },
      "half"
    );
    // 100/10=10, 1*6=6, 40/10=4, 4*0.5=2 → 22
    expect(pts).toBeCloseTo(22, 1);
  });

  it("calculates standard scoring correctly", () => {
    const pts = rbFantasyPoints(
      {
        rushing_yards: 100,
        rushing_tds: 1,
        receiving_yards: 40,
        receiving_tds: 0,
        receptions: 4,
      },
      "std"
    );
    // 100/10=10, 1*6=6, 40/10=4, 4*0=0 → 20
    expect(pts).toBeCloseTo(20, 1);
  });

  it("subtracts for fumbles", () => {
    const pts = rbFantasyPoints(
      { rushing_yards: 0, rushing_tds: 0, fumbles_lost: 3 },
      "ppr"
    );
    expect(pts).toBe(-3);
  });

  it("handles all zeros", () => {
    expect(
      rbFantasyPoints({ rushing_yards: 0, rushing_tds: 0 }, "ppr")
    ).toBe(0);
  });

  it("counts receiving TDs for RBs", () => {
    const pts = rbFantasyPoints(
      {
        rushing_yards: 0,
        rushing_tds: 0,
        receiving_yards: 0,
        receiving_tds: 2,
        receptions: 2,
      },
      "ppr"
    );
    // 2*6=12, 2*1=2 → 14
    expect(pts).toBeCloseTo(14, 1);
  });
});
