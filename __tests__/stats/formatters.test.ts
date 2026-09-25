import { describe, it, expect } from "vitest";
import * as formatters from "@/lib/stats/formatters";
import {
  EM_DASH,
  formatRate,
  textColorForBackground,
  EPA_BAND,
  EPA_AVERAGE_MIN_PLAYS,
  leagueEpaAverage,
  rbCarryEpaAverage,
  targetEpaAverage,
  qbEpaAverages,
  epaVsAverageClass,
} from "@/lib/stats/formatters";
import type { QBSeasonStat, RBSeasonStat, ReceiverSeasonStat } from "@/lib/types";

describe("formatRate", () => {
  it("formats a 0–1 rate as a percentage", () => {
    expect(formatRate(0.876)).toBe("87.6%");
  });
  it("honors the decimals argument", () => {
    expect(formatRate(0.876, 0)).toBe("88%");
  });
  it("returns the em dash for NaN", () => {
    expect(formatRate(NaN)).toBe(EM_DASH);
  });
  // Guard is isFinite, not isNaN: a divide-by-zero rate used to render
  // "Infinity%" on the card instead of the em dash every other formatter uses.
  it("returns the em dash for Infinity", () => {
    expect(formatRate(Infinity)).toBe(EM_DASH);
    expect(formatRate(-Infinity)).toBe(EM_DASH);
  });
});

describe("textColorForBackground", () => {
  it("returns white on dark team colors", () => {
    expect(textColorForBackground("#00338D")).toBe("#ffffff"); // BUF navy
  });
  it("returns near-black on light team colors", () => {
    expect(textColorForBackground("#FB4F14")).toBe("#0f172a"); // CIN orange
  });
  it("tolerates malformed input", () => {
    expect(textColorForBackground("")).toBe("#ffffff");
  });

  // Threshold regression guard — real NFL primaries from lib/data/teams.ts.
  // Each expectation matches the color that actually wins the WCAG contrast
  // ratio against the given background, so tuning the threshold cannot
  // silently break a team's card band.
  it("picks white on genuinely dark team primaries", () => {
    expect(textColorForBackground("#97233F")).toBe("#ffffff"); // ARI cardinal
    expect(textColorForBackground("#101820")).toBe("#ffffff"); // CAR/PIT black
    expect(textColorForBackground("#0076B6")).toBe("#ffffff"); // DET blue
    expect(textColorForBackground("#203731")).toBe("#ffffff"); // GB forest green
    expect(textColorForBackground("#000000")).toBe("#ffffff"); // LV black
  });
  it("picks near-black on genuinely light team colors", () => {
    expect(textColorForBackground("#FFB612")).toBe("#0f172a"); // PIT gold
    expect(textColorForBackground("#D3BC8D")).toBe("#0f172a"); // NO gold
    expect(textColorForBackground("#008E97")).toBe("#0f172a"); // MIA aqua
    expect(textColorForBackground("#A5ACAF")).toBe("#0f172a"); // LV silver
  });
  it("accepts hex without a leading # and is case-insensitive", () => {
    expect(textColorForBackground("00338d")).toBe("#ffffff");
    expect(textColorForBackground("#fb4f14")).toBe("#0f172a");
  });
});

// Spec A §4.1: a player's EPA is coloured against the season's league average
// for that kind of play, not against zero. The average RB carry is below zero
// (2026: -0.10) and the average target well above it (+0.23), so the old sign
// split painted most backs red and most receivers green.
describe("epaVsAverageClass", () => {
  it("greys a value that is not a finite number", () => {
    for (const v of [null, undefined, NaN, Infinity, -Infinity]) {
      expect(epaVsAverageClass(v, -0.1, 0.03), String(v)).toBe("text-gray-400");
    }
  });

  it("shows no colour (dark grey) when the season has no average yet", () => {
    expect(epaVsAverageClass(0.5, null, 0.03)).toBe("text-gray-700");
    expect(epaVsAverageClass(-0.5, undefined, 0.03)).toBe("text-gray-700");
    expect(epaVsAverageClass(-0.5, NaN, 0.03)).toBe("text-gray-700");
  });

  it("colours against the average, so a negative value can be green", () => {
    expect(epaVsAverageClass(-0.03, -0.1, 0.03)).toBe("text-green-600");
    expect(epaVsAverageClass(-0.14, -0.1, 0.03)).toBe("text-red-600");
    // ...and a positive target below the target average is red.
    expect(epaVsAverageClass(0.1, 0.23, 0.06)).toBe("text-red-600");
  });

  it("is grey inside the band, boundaries included", () => {
    expect(epaVsAverageClass(-0.07, -0.1, 0.03)).toBe("text-gray-700");
    expect(epaVsAverageClass(-0.13, -0.1, 0.03)).toBe("text-gray-700");
    expect(epaVsAverageClass(-0.1, -0.1, 0.03)).toBe("text-gray-700");
    expect(epaVsAverageClass(-0.12, -0.1, 0.03)).toBe("text-gray-700");
    expect(epaVsAverageClass(-0.08, -0.1, 0.03)).toBe("text-gray-700");
    expect(epaVsAverageClass(0.29, 0.23, 0.06)).toBe("text-gray-700");
    expect(epaVsAverageClass(0.17, 0.23, 0.06)).toBe("text-gray-700");
  });

  it("uses the bands the spec sets", () => {
    expect(EPA_BAND).toEqual({ carry: 0.03, dropback: 0.03, play: 0.03, target: 0.06, qbRush: 0.06 });
    expect(EPA_AVERAGE_MIN_PLAYS).toEqual({ carry: 350, dropback: 600, play: 600, target: 500, qbRush: 60 });
  });
});

describe("leagueEpaAverage", () => {
  type Row = { rate: number | null | undefined; n: number | null | undefined };
  const avg = (rows: Row[], floor = 0) =>
    leagueEpaAverage(rows, (r) => r.rate, (r) => r.n, floor);

  it("is null for no rows", () => {
    expect(avg([])).toBeNull();
  });

  it("weights each rate by its plays", () => {
    // (0.2 x 100 + -0.4 x 300) / 400 = -0.25
    expect(avg([{ rate: 0.2, n: 100 }, { rate: -0.4, n: 300 }])).toBeCloseTo(-0.25, 12);
  });

  it("skips rows with no rate or no plays, and is never NaN", () => {
    const rows: Row[] = [
      { rate: 0.2, n: 100 },
      { rate: null, n: 500 },
      { rate: NaN, n: 500 },
      { rate: undefined, n: 500 },
      { rate: 9, n: 0 },
      { rate: 9, n: null },
      { rate: 9, n: NaN },
      { rate: -0.4, n: 300 },
    ];
    expect(avg(rows)).toBeCloseTo(-0.25, 12);
    expect(avg([{ rate: NaN, n: 10 }])).toBeNull();
  });

  it("is null just under the floor and a value at it", () => {
    expect(avg([{ rate: 0.1, n: 349 }], 350)).toBeNull();
    expect(avg([{ rate: 0.1, n: 350 }], 350)).toBeCloseTo(0.1, 12);
  });
});

describe("season averages by play type", () => {
  const rb = (epa: number | null, carries: number) => ({ epa_per_carry: epa, carries } as unknown as RBSeasonStat);
  const rec = (epa: number | null, targets: number, position = "WR") =>
    ({ epa_per_target: epa, targets, position } as unknown as ReceiverSeasonStat);
  const qb = (over: Partial<QBSeasonStat>) => over as unknown as QBSeasonStat;

  it("RB carries: EPA/carry weighted by carries, 350-carry floor", () => {
    expect(rbCarryEpaAverage([rb(-0.2, 200), rb(0.1, 200)])).toBeCloseTo(-0.05, 12);
    expect(rbCarryEpaAverage([rb(-0.2, 200), rb(0.1, 149)])).toBeNull();
    expect(rbCarryEpaAverage([rb(-0.2, 200), rb(null, 500), rb(0.1, 150)])).toBeCloseTo((-40 + 15) / 350, 12);
  });

  it("targets: every row whatever the position, 500-target floor", () => {
    const rows = [rec(0.3, 300, "WR"), rec(0.25, 100, "TE"), rec(-0.05, 100, "RB")];
    expect(targetEpaAverage(rows)).toBeCloseTo((90 + 25 - 5) / 500, 12);
    expect(targetEpaAverage(rows.slice(0, 2))).toBeNull();
  });

  it("QBs: dropbacks, plays (dropbacks + rushes - scrambles) and QB rushes, each with its floor", () => {
    const rows = [
      qb({ epa_per_db: 0.1, dropbacks: 400, epa_per_play: 0.12, rush_attempts: 40, scramble_pct: 5, rush_epa_per_play: 0.3 }),
      qb({ epa_per_db: -0.1, dropbacks: 200, epa_per_play: -0.05, rush_attempts: 30, scramble_pct: null, rush_epa_per_play: 0.2 }),
    ];
    const a = qbEpaAverages(rows);
    expect(a.dropback).toBeCloseTo((40 - 20) / 600, 12);
    // Play weight: 400 + 40 - 20 scrambles = 420; 200 + 30 - 0 = 230 (a null
    // scramble rate counts as none, as lib/stats/tecmo-card.ts does).
    expect(a.play).toBeCloseTo((0.12 * 420 - 0.05 * 230) / 650, 12);
    expect(a.qbRush).toBeCloseTo((0.3 * 40 + 0.2 * 30) / 70, 12);
    // Under each floor: 599 dropbacks, 599 plays, 59 rushes.
    const small = qbEpaAverages([
      qb({ epa_per_db: 0.1, dropbacks: 559, epa_per_play: 0.1, rush_attempts: 40, scramble_pct: 0, rush_epa_per_play: 0.3 }),
      qb({ epa_per_db: 0.1, dropbacks: 40, epa_per_play: 0.1, rush_attempts: 19, scramble_pct: 0, rush_epa_per_play: 0.3 }),
    ]);
    expect(small.dropback).toBeNull();
    expect(small.qbRush).toBeNull();
    expect(small.play).not.toBeNull(); // 559 + 40 + 40 + 19 = 658 plays
    expect(qbEpaAverages([])).toEqual({ dropback: null, play: null, qbRush: null });
  });

  it("no longer exports the sign-split epaLeaderboardColor", () => {
    expect("epaLeaderboardColor" in formatters).toBe(false);
  });
});
