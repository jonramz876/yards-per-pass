import { describe, it, expect } from "vitest";
import { computeZScore, detectSurges, type WeeklyValue } from "@/lib/stats/surge";

describe("computeZScore", () => {
  it("returns 0 when recent equals season average", () => {
    expect(computeZScore([10, 10, 10, 10, 10, 10, 10, 10], 4)).toBeCloseTo(0, 1);
  });

  it("returns positive z-score for recent surge", () => {
    const z = computeZScore([5, 5, 5, 5, 5, 5, 20, 20], 2);
    expect(z).toBeGreaterThan(1.5);
  });

  it("returns negative z-score for recent collapse", () => {
    const z = computeZScore([20, 20, 20, 20, 20, 20, 2, 2], 2);
    expect(z).toBeLessThan(-1.5);
  });

  it("returns 0 when stdev is 0 (all values identical)", () => {
    expect(computeZScore([7, 7, 7, 7, 7, 7], 3)).toBe(0);
  });

  it("returns 0 for fewer than minGames values", () => {
    expect(computeZScore([10, 20], 2)).toBe(0);
  });

  it("handles window larger than half the data", () => {
    // 6 values, window=4 → needs at least window+2=6 games, exactly enough
    const z = computeZScore([5, 5, 15, 15, 15, 15], 4);
    expect(z).toBeGreaterThan(0);
  });

  it("respects custom minGames parameter", () => {
    // 4 values with minGames=3, window=2 → should work (z = 1.0 exactly)
    const z = computeZScore([5, 5, 20, 20], 2, 3);
    expect(z).toBeCloseTo(1, 1);
    // Same data but minGames=5 → too few games, returns 0
    expect(computeZScore([5, 5, 20, 20], 2, 5)).toBe(0);
  });
});

describe("detectSurges", () => {
  const makePlayers = (overrides: Partial<WeeklyValue>[]): WeeklyValue[] =>
    overrides.map((o, i) => ({
      playerId: `p${i + 1}`,
      playerName: `Player ${i + 1}`,
      teamId: "KC",
      position: "QB",
      slug: `player-${i + 1}`,
      weeks: [],
      ...o,
    }));

  it("identifies a surging player", () => {
    const players = makePlayers([{
      weeks: [
        { week: 1, value: 0.05 }, { week: 2, value: 0.04 }, { week: 3, value: 0.06 },
        { week: 4, value: 0.03 }, { week: 5, value: 0.05 }, { week: 6, value: 0.04 },
        { week: 7, value: 0.25 }, { week: 8, value: 0.28 },
      ],
    }]);
    const result = detectSurges(players, { window: 2, minGames: 6, threshold: 1.5 });
    expect(result.rising.length).toBe(1);
    expect(result.rising[0].playerId).toBe("p1");
    expect(result.rising[0].zScore).toBeGreaterThan(1.5);
    expect(result.rising[0].delta).toBeGreaterThan(0);
    expect(result.falling.length).toBe(0);
  });

  it("identifies a collapsing player", () => {
    const players = makePlayers([{
      playerName: "Test WR", teamId: "BUF", position: "WR", slug: "test-wr",
      weeks: [
        { week: 1, value: 0.20 }, { week: 2, value: 0.22 }, { week: 3, value: 0.18 },
        { week: 4, value: 0.21 }, { week: 5, value: 0.19 }, { week: 6, value: 0.20 },
        { week: 7, value: 0.01 }, { week: 8, value: 0.02 },
      ],
    }]);
    const result = detectSurges(players, { window: 2, minGames: 6, threshold: 1.5 });
    expect(result.falling.length).toBe(1);
    expect(result.falling[0].zScore).toBeLessThan(-1.5);
    expect(result.rising.length).toBe(0);
  });

  it("skips players with fewer than minGames", () => {
    const players = makePlayers([{
      weeks: [{ week: 1, value: 0.30 }, { week: 2, value: 0.01 }],
    }]);
    const result = detectSurges(players, { window: 2, minGames: 6, threshold: 1.5 });
    expect(result.rising.length).toBe(0);
    expect(result.falling.length).toBe(0);
  });

  it("sorts rising by z-score descending", () => {
    const result = detectSurges(makePlayers([
      {
        playerName: "Small Surge",
        // Varied baseline so stdev is already elevated, moderate spike
        weeks: [
          { week: 1, value: 8 }, { week: 2, value: 12 }, { week: 3, value: 6 },
          { week: 4, value: 14 }, { week: 5, value: 10 }, { week: 6, value: 8 },
          { week: 7, value: 22 }, { week: 8, value: 24 },
        ],
      },
      {
        playerName: "Big Surge",
        // Very consistent baseline → low stdev → even moderate spike = high z
        weeks: [
          { week: 1, value: 10 }, { week: 2, value: 10 }, { week: 3, value: 10 },
          { week: 4, value: 10 }, { week: 5, value: 10 }, { week: 6, value: 10 },
          { week: 7, value: 22 }, { week: 8, value: 24 },
        ],
      },
    ]), { window: 2, minGames: 6, threshold: 1.5 });
    expect(result.rising.length).toBe(2);
    // Consistent baseline → higher z-score than varied baseline with same spike
    expect(result.rising[0].zScore).toBeGreaterThanOrEqual(result.rising[1].zScore);
    expect(result.rising[0].playerId).toBe("p2"); // Big Surge (consistent baseline) first
  });

  it("computes correct seasonAvg and recentAvg", () => {
    const players = makePlayers([{
      weeks: [
        { week: 1, value: 10 }, { week: 2, value: 10 }, { week: 3, value: 10 },
        { week: 4, value: 10 }, { week: 5, value: 10 }, { week: 6, value: 10 },
        { week: 7, value: 30 }, { week: 8, value: 30 },
      ],
    }]);
    const result = detectSurges(players, { window: 2, minGames: 6, threshold: 1.0 });
    expect(result.rising.length).toBe(1);
    expect(result.rising[0].seasonAvg).toBeCloseTo(15, 1);
    expect(result.rising[0].recentAvg).toBeCloseTo(30, 1);
    expect(result.rising[0].delta).toBeCloseTo(15, 1);
  });

  it("handles unsorted weeks input", () => {
    const players = makePlayers([{
      weeks: [
        { week: 8, value: 30 }, { week: 1, value: 10 }, { week: 6, value: 10 },
        { week: 3, value: 10 }, { week: 7, value: 30 }, { week: 2, value: 10 },
        { week: 5, value: 10 }, { week: 4, value: 10 },
      ],
    }]);
    const result = detectSurges(players, { window: 2, minGames: 6, threshold: 1.0 });
    expect(result.rising.length).toBe(1);
    expect(result.rising[0].recentAvg).toBeCloseTo(30, 1);
  });

  it("returns empty arrays when no players exceed threshold", () => {
    const players = makePlayers([{
      weeks: [
        { week: 1, value: 10 }, { week: 2, value: 11 }, { week: 3, value: 10 },
        { week: 4, value: 11 }, { week: 5, value: 10 }, { week: 6, value: 11 },
        { week: 7, value: 10 }, { week: 8, value: 11 },
      ],
    }]);
    const result = detectSurges(players, { window: 2, minGames: 6, threshold: 1.5 });
    expect(result.rising.length).toBe(0);
    expect(result.falling.length).toBe(0);
  });
});
