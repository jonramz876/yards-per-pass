import { describe, it, expect } from "vitest";
import { getQBRadarVal, seasonHasRouteData } from "@/lib/stats/radar";
import type { QBSeasonStat, ReceiverSeasonStat } from "@/lib/types";

function rec(targets: number, routes: number | null, yprr: number | null): ReceiverSeasonStat {
  return {
    targets,
    routes_run: routes as unknown as number,
    yards_per_route_run: yprr as unknown as number,
  } as ReceiverSeasonStat;
}

// Spec A §4.11: the one rule the homepage strip and the /receivers Efficiency
// tab share for "does this season have route data?" (moved verbatim from
// app/page.tsx). Route data counts when >= 90% of the target-qualified pool has
// routes_run > 0 and a finite YPRR.
describe("seasonHasRouteData", () => {
  const pool = (routed: number, total = 10) =>
    Array.from({ length: total }, (_, i) => (i < routed ? rec(10, 40, 1.5) : rec(10, 0, null)));

  it("is false for no rows", () => {
    expect(seasonHasRouteData([], 4)).toBe(false);
  });

  it("is true at 10 of 10 and 9 of 10 (exactly 90%), false at 8 of 10", () => {
    expect(seasonHasRouteData(pool(10), 4)).toBe(true);
    expect(seasonHasRouteData(pool(9), 4)).toBe(true);
    expect(seasonHasRouteData(pool(8), 4)).toBe(false);
  });

  it("ignores rows under the target minimum", () => {
    const unroutedQualifiers = Array.from({ length: 10 }, () => rec(10, null, null));
    const routedNonQualifiers = Array.from({ length: 100 }, () => rec(3, 40, 2));
    expect(seasonHasRouteData([...unroutedQualifiers, ...routedNonQualifiers], 4)).toBe(false);
    // ...and a pool with no qualifier at all has no route data.
    expect(seasonHasRouteData(routedNonQualifiers, 4)).toBe(false);
  });

  it("does not count null or zero routes, or a YPRR that is not a finite number", () => {
    for (const bad of [rec(10, null, 1), rec(10, 0, 1), rec(10, 40, NaN), rec(10, 40, null), rec(10, 40, Infinity)]) {
      const rows = [...Array.from({ length: 9 }, () => rec(10, 40, 1)), bad, bad];
      // 9 good of 11 qualified = 82% < 90%
      expect(seasonHasRouteData(rows, 4)).toBe(false);
    }
    // Zero or negative YPRR on real routes is real route data.
    expect(seasonHasRouteData([rec(10, 40, 0), rec(10, 40, -0.2)], 4)).toBe(true);
  });
});

// The glossary's Complete Passer entry says the Rush EPA axis is shrunk toward
// zero for quarterbacks with fewer than 60 rushes (fully counted at 60). This
// passes today by design; it pins MIN_RUSH (= 60) and the cube in radar.ts.
describe("getQBRadarVal rush_epa shrinkage", () => {
  const qb = (rushes: number, raw: number) =>
    ({ rush_attempts: rushes, rush_epa_per_play: raw } as unknown as QBSeasonStat);

  it("is raw x (30/60)^3 = raw x 0.125 at 30 rushes, and raw at 60", () => {
    expect(getQBRadarVal(qb(30, 0.4), "rush_epa")).toBeCloseTo(0.4 * 0.125, 12);
    expect(getQBRadarVal(qb(60, 0.4), "rush_epa")).toBeCloseTo(0.4, 12);
    expect(getQBRadarVal(qb(90, 0.4), "rush_epa")).toBeCloseTo(0.4, 12);
  });
});
