import { describe, it, expect } from "vitest";
import { classifyQB, classifyWR, classifyTE, classifyRB } from "@/lib/stats/archetypes";
import { receiverArchetypeMap } from "@/components/tables/ReceiverLeaderboard";
import type { ReceiverSeasonStat } from "@/lib/types";
import wrTePool from "./fixtures/wr-te-2025-pool.json";

// ---------------------------------------------------------------------------
// classifyQB
// ---------------------------------------------------------------------------
describe("classifyQB", () => {
  // Axes: [Efficiency, Accuracy, Volume, Depth, BallSecurity, Consistency, Rush]

  it("returns null for 6-element array (requires 7)", () => {
    expect(classifyQB([80, 80, 80, 80, 80, 80])).toBeNull();
  });

  it("returns Dual Threat for elite rusher with strong passing", () => {
    // rush >= 80, eff >= 50, above60 >= 4
    const result = classifyQB([60, 65, 70, 65, 50, 60, 85]);
    expect(result).not.toBeNull();
    expect(result!.label).toBe("Dual Threat");
  });

  it("returns Mobile Playmaker for good rusher with passing volume", () => {
    // rush >= 70, eff >= 55, vol >= 50, NOT Surgeon-level (acc < 70 or cons < 65)
    const result = classifyQB([58, 50, 55, 50, 50, 50, 70]);
    expect(result).not.toBeNull();
    expect(result!.label).toBe("Mobile Playmaker");
  });

  it("returns Surgeon (not Mobile Playmaker) for precise QB with moderate rush", () => {
    // Purdy-like: rush >= 70 but acc >= 70 && cons >= 65 → Surgeon exclusion on Mobile Playmaker
    const result = classifyQB([60, 75, 55, 50, 50, 70, 72]);
    expect(result).not.toBeNull();
    expect(result!.label).toBe("Surgeon");
  });

  it("returns Complete Passer when 4+ axes >= 70 and none below 30", () => {
    const result = classifyQB([80, 80, 80, 80, 80, 80, 40]);
    expect(result).not.toBeNull();
    expect(result!.label).toBe("Complete Passer");
  });

  it("returns null when all percentiles are at 20 (no match)", () => {
    expect(classifyQB([20, 20, 20, 20, 20, 20, 20])).toBeNull();
  });

  it("returns Gunslinger for high depth + volume + low ball security", () => {
    // depth >= 65, vol >= 55, ballSec <= 45
    const result = classifyQB([50, 40, 60, 75, 30, 40, 20]);
    expect(result).not.toBeNull();
    expect(result!.label).toBe("Gunslinger");
  });

  it("returns Surgeon for high accuracy + consistency + efficiency", () => {
    // acc >= 70, cons >= 65, eff >= 55
    const result = classifyQB([60, 75, 40, 40, 50, 70, 20]);
    expect(result).not.toBeNull();
    expect(result!.label).toBe("Surgeon");
  });

  it("returns Distributor for high volume + accuracy + low depth", () => {
    // vol >= 70, acc >= 60, depth <= 45
    const result = classifyQB([45, 65, 75, 40, 50, 50, 20]);
    expect(result).not.toBeNull();
    expect(result!.label).toBe("Distributor");
  });

  it("returns Game Manager for high consistency + ball security + low volume", () => {
    // cons >= 65, ballSec >= 65, vol <= 45
    const result = classifyQB([40, 40, 40, 40, 70, 70, 20]);
    expect(result).not.toBeNull();
    expect(result!.label).toBe("Game Manager");
  });

  it("returns Playmaker for high efficiency + volume + consistency", () => {
    // eff >= 70, vol >= 70, cons >= 60
    const result = classifyQB([75, 50, 75, 40, 50, 65, 20]);
    expect(result).not.toBeNull();
    expect(result!.label).toBe("Playmaker");
  });

  it("returns Sniper for high depth + ball security + adequate accuracy + low rush", () => {
    // depth >= 65, ballSec >= 65, acc >= 40, rush < 75
    const result = classifyQB([40, 45, 40, 70, 70, 40, 20]);
    expect(result).not.toBeNull();
    expect(result!.label).toBe("Sniper");
  });

  it("does NOT return Sniper when rush >= 75 (mobile QB exclusion)", () => {
    // Same as Sniper test but rush = 80 → should NOT match Sniper
    const result = classifyQB([40, 40, 40, 70, 70, 40, 80]);
    // With rush=80 but eff<60, won't match Dual Threat or Mobile Playmaker either
    // Falls through to Improviser or null
    expect(result === null || result.label !== "Sniper").toBe(true);
  });

  it("returns Pocket Passer fallback for QB with at least one axis above 60", () => {
    // No specific archetype matches, but above60 >= 1
    const result = classifyQB([45, 45, 45, 45, 45, 63, 30]);
    expect(result).not.toBeNull();
    expect(result!.label).toBe("Pocket Passer");
  });

  it("returns null for QB with all axes below 60", () => {
    expect(classifyQB([30, 30, 30, 30, 30, 30, 30])).toBeNull();
  });

  it("all archetypes have a glossaryAnchor field", () => {
    const completePasser = classifyQB([80, 80, 80, 80, 80, 80, 40]);
    expect(completePasser!.glossaryAnchor).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// classifyWR
// ---------------------------------------------------------------------------
describe("classifyWR", () => {
  // Axes: [Volume, Efficiency, Catch, Downfield, AfterCatch, Consistency]

  it("returns Alpha WR1 when 4+ axes >= 70, vol >= 65, none below 30", () => {
    const result = classifyWR([80, 80, 80, 80, 80, 80]);
    expect(result).not.toBeNull();
    expect(result!.label).toBe("Alpha WR1");
  });

  it("returns null when all percentiles are at 20", () => {
    expect(classifyWR([20, 20, 20, 20, 20, 20])).toBeNull();
  });

  it("returns Alpha WR1 via volume path (3+ axes 70, vol >= 80, above60 >= 4)", () => {
    // Chase-like: high volume, 3 axes at 70+, 1 below 30 allowed
    const result = classifyWR([99, 51, 64, 21, 81, 86]);
    expect(result).not.toBeNull();
    expect(result!.label).toBe("Alpha WR1");
  });

  it("returns YAC Monster for high YAC + low downfield + moderate volume", () => {
    // yac >= 75, downfield <= 40, vol <= 75
    const result = classifyWR([50, 50, 50, 30, 80, 50]);
    expect(result).not.toBeNull();
    expect(result!.label).toBe("YAC Monster");
  });

  it("returns Target Magnet for very high volume with 2+ axes at 60", () => {
    // vol >= 80, above60 >= 2
    const result = classifyWR([85, 40, 40, 40, 40, 65]);
    expect(result).not.toBeNull();
    expect(result!.label).toBe("Target Magnet");
  });

  it("returns Route Technician for high YPRR + volume", () => {
    // cons >= 70, vol >= 55, above60 >= 3
    const result = classifyWR([60, 65, 60, 50, 50, 75]);
    expect(result).not.toBeNull();
    expect(result!.label).toBe("Route Technician");
  });

  it("returns Contested Catch WR for high downfield + catch rate", () => {
    // downfield >= 65, catch >= 60
    const result = classifyWR([50, 50, 65, 70, 40, 50]);
    expect(result).not.toBeNull();
    expect(result!.label).toBe("Contested Catch WR");
  });

  it("returns Field Stretcher for high downfield + low catch rate", () => {
    // downfield >= 75, catch <= 50
    const result = classifyWR([50, 50, 45, 80, 40, 50]);
    expect(result).not.toBeNull();
    expect(result!.label).toBe("Field Stretcher");
  });

  it("returns Possession Receiver for high catch + consistency + low downfield", () => {
    // catch >= 70, cons >= 60, downfield <= 45
    const result = classifyWR([50, 50, 75, 40, 40, 65]);
    expect(result).not.toBeNull();
    expect(result!.label).toBe("Possession Receiver");
  });

  it("returns Role Player fallback for WR with at least one axis above 60", () => {
    // No specific archetype matches, but above60 >= 1
    const result = classifyWR([45, 45, 45, 45, 45, 63]);
    expect(result).not.toBeNull();
    expect(result!.label).toBe("Role Player");
  });

  it("returns null for WR with all axes below 60", () => {
    expect(classifyWR([30, 30, 30, 30, 30, 30])).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// classifyTE
// ---------------------------------------------------------------------------
describe("classifyTE", () => {
  // Axes: [Volume, Efficiency, Catch, Downfield, AfterCatch, Consistency]

  it("returns Elite TE1 when 4+ axes >= 70, vol >= 60, none below 30", () => {
    const result = classifyTE([80, 80, 80, 80, 80, 80]);
    expect(result).not.toBeNull();
    expect(result!.label).toBe("Elite TE1");
  });

  it("returns null when all percentiles are at 40 (no match)", () => {
    expect(classifyTE([40, 40, 40, 40, 40, 40])).toBeNull();
  });

  it("returns Seam Stretcher for high downfield + efficiency", () => {
    // downfield >= 70, eff >= 50
    const result = classifyTE([40, 55, 40, 75, 40, 40]);
    expect(result).not.toBeNull();
    expect(result!.label).toBe("Seam Stretcher");
  });

  it("returns YAC Weapon for high YAC + low downfield", () => {
    // yac >= 70, downfield <= 55
    const result = classifyTE([40, 40, 40, 50, 75, 40]);
    expect(result).not.toBeNull();
    expect(result!.label).toBe("YAC Weapon");
  });

  it("returns Security Blanket for high catch + volume", () => {
    // catch >= 70, vol >= 55
    const result = classifyTE([60, 40, 75, 40, 40, 40]);
    expect(result).not.toBeNull();
    expect(result!.label).toBe("Security Blanket");
  });

  it("returns Mismatch TE for high efficiency + catch + moderate volume", () => {
    // eff >= 70, catch >= 60, vol >= 40 (Kincaid-like profile)
    const result = classifyTE([45, 80, 65, 55, 50, 50]);
    expect(result).not.toBeNull();
    expect(result!.label).toBe("Mismatch TE");
  });

  it("returns Blocking TE for very low volume + consistency", () => {
    // vol <= 25, cons <= 35
    const result = classifyTE([20, 40, 40, 40, 40, 30]);
    expect(result).not.toBeNull();
    expect(result!.label).toBe("Blocking TE");
  });

  it("returns Complementary TE fallback for moderate volume TE", () => {
    // No specific match but vol >= 50
    const result = classifyTE([55, 45, 45, 45, 45, 45]);
    expect(result).not.toBeNull();
    expect(result!.label).toBe("Complementary TE");
  });
});

// ---------------------------------------------------------------------------
// classifyRB
// ---------------------------------------------------------------------------
describe("classifyRB", () => {
  // Axes: [Volume, Efficiency, Power, Explosiveness, Receiving, Consistency]

  it("returns Three-Down Back when all conditions met", () => {
    // vol >= 55, rec >= 60, cons >= 55, 2+ of [eff,power,explosive,cons] >= 55, none below 30
    const result = classifyRB([70, 60, 60, 60, 70, 60]);
    expect(result).not.toBeNull();
    expect(result!.label).toBe("Three-Down Back");
  });

  it("returns Rotational Back when all percentiles are at 40 (fallback)", () => {
    const result = classifyRB([40, 40, 40, 40, 40, 40]);
    expect(result).not.toBeNull();
    expect(result!.label).toBe("Rotational Back");
  });

  it("returns Elite Runner for 3+ rush axes >= 70 and vol >= 55", () => {
    // rushAxes = [eff, power, explosive, cons], 3+ >= 70
    const result = classifyRB([60, 75, 75, 75, 30, 75]);
    expect(result).not.toBeNull();
    expect(result!.label).toBe("Elite Runner");
  });

  it("returns Workhorse for high volume + moderate eff + low receiving", () => {
    // vol >= 70, eff >= 45, rec <= 45
    const result = classifyRB([75, 50, 50, 40, 35, 50]);
    expect(result).not.toBeNull();
    expect(result!.label).toBe("Workhorse");
  });

  it("returns Home Run Hitter for high explosiveness + low consistency", () => {
    // explosive >= 75, cons <= 45
    const result = classifyRB([40, 40, 40, 80, 40, 35]);
    expect(result).not.toBeNull();
    expect(result!.label).toBe("Home Run Hitter");
  });

  it("returns Pass-Catching Back for high receiving + low volume", () => {
    // rec >= 75, vol <= 50
    const result = classifyRB([45, 40, 40, 40, 80, 40]);
    expect(result).not.toBeNull();
    expect(result!.label).toBe("Pass-Catching Back");
  });

  it("returns Power Back for high power + vol + low explosiveness", () => {
    // power >= 70, vol >= 50, explosive <= 55
    const result = classifyRB([55, 40, 75, 50, 40, 40]);
    expect(result).not.toBeNull();
    expect(result!.label).toBe("Power Back");
  });

  it("returns Bell Cow for extreme volume", () => {
    // vol >= 85 (and doesn't match earlier patterns due to low other stats)
    const result = classifyRB([90, 30, 40, 40, 40, 40]);
    expect(result).not.toBeNull();
    expect(result!.label).toBe("Bell Cow");
  });

  it("returns Rotational Back fallback for committee RB", () => {
    // No specific match but vol >= 40
    const result = classifyRB([45, 45, 45, 45, 45, 45]);
    expect(result).not.toBeNull();
    expect(result!.label).toBe("Rotational Back");
  });

  it("returns null for RB with very low stats across the board", () => {
    expect(classifyRB([20, 20, 20, 20, 20, 20])).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Missing axes: a NaN percentile means "no data", never last place
// ---------------------------------------------------------------------------
describe("missing axes (NaN percentiles)", () => {
  it("classifyTE: a missing YPRR axis never triggers Blocking TE", () => {
    expect(classifyTE([20, 40, 40, 40, 40, NaN])).toBeNull();
    // A real low YPRR still does.
    expect(classifyTE([20, 40, 40, 40, 40, 30])?.label).toBe("Blocking TE");
  });

  it("classifyWR: a missing axis is not a weak axis (Alpha WR1 path 1)", () => {
    expect(classifyWR([70, 80, 80, 80, 80, NaN])?.label).toBe("Alpha WR1");
    // Control: a real 0th-percentile axis is weak.
    expect(classifyWR([70, 80, 80, 80, 80, 0])?.label).toBe("Contested Catch WR");
  });

  it("classifyWR: YPRR-defined archetypes need a real YPRR", () => {
    expect(classifyWR([60, 65, 60, 50, 50, NaN])?.label).toBe("Role Player");
    // Control: the same profile with a real high YPRR is a Route Technician.
    expect(classifyWR([60, 65, 60, 50, 50, 90])?.label).toBe("Route Technician");
  });

  it("all-NaN input yields null", () => {
    expect(classifyWR(Array(6).fill(NaN))).toBeNull();
    expect(classifyTE(Array(6).fill(NaN))).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// receiverArchetypeMap (leaderboard)
// ---------------------------------------------------------------------------
function wr(over: Partial<ReceiverSeasonStat>): ReceiverSeasonStat {
  return {
    player_id: "r", player_name: "R", position: "WR", team_id: "BUF", season: 2026,
    games: 16, targets: 140, receptions: 96, receiving_yards: 1281, receiving_tds: 9,
    catch_rate: 0.686, yards_per_target: 9.15, yards_per_reception: 13.3,
    epa_per_target: 0.32, yac: 480, yac_per_reception: 5.0, air_yards: 1450,
    air_yards_per_target: 10.4, target_share: 0.271, fumbles: 2, fumbles_lost: 1,
    routes_run: 520, yards_per_route_run: 2.46, targets_per_route_run: 0.269,
    total_snaps: 900, snap_share: 0.842, route_participation_rate: 0.78,
    air_yards_share: 0.35, croe: 0.024, receiving_success_rate: 0.552,
    total_receiving_epa: 44.8,
    ...over,
  } as ReceiverSeasonStat;
}

// 2026 has no participation file yet: every route/snap field is NULL.
const NO_PARTICIPATION = { routes_run: null, total_snaps: null, snap_share: null, route_participation_rate: null, yards_per_route_run: null, targets_per_route_run: null } as unknown as Partial<ReceiverSeasonStat>;
// Real 2026 week-1 receivers (NE-SEA and SF-LA games).
const WEEK1_2026 = [
  wr({ player_id: '00-0033288', player_name: 'G.Kittle', position: 'TE', games: 1, targets: 5, epa_per_target: -1.1161671683192254, croe: -0.2958020687103271, air_yards_per_target: 7.6, yac_per_reception: 8.5, ...NO_PARTICIPATION }),
  wr({ player_id: '00-0033090', player_name: 'H.Henry', position: 'TE', games: 1, targets: 3, epa_per_target: 0.03257922793272883, croe: 0.26544823249181115, air_yards_per_target: 4.0, yac_per_reception: 4.666666666666667, ...NO_PARTICIPATION }),
  wr({ player_id: '00-0039793', player_name: 'A.Barner', position: 'TE', games: 1, targets: 2, epa_per_target: 0.4385657471430022, croe: 0.16090834140777588, air_yards_per_target: -0.5, yac_per_reception: 7.0, ...NO_PARTICIPATION }),
  wr({ player_id: '00-0033110', player_name: 'T.Higbee', position: 'TE', games: 1, targets: 2, epa_per_target: -2.3662121596280485, croe: 0.18677937984466553, air_yards_per_target: 4.5, yac_per_reception: 1.5, ...NO_PARTICIPATION }),
  wr({ player_id: '00-0036244', player_name: 'C.Parkinson', position: 'TE', games: 1, targets: 2, epa_per_target: -0.12938752805348486, croe: -0.2827591001987457, air_yards_per_target: 4.5, yac_per_reception: 4.0, ...NO_PARTICIPATION }),
  wr({ player_id: '00-0036887', player_name: 'L.Farrell', position: 'TE', games: 1, targets: 2, epa_per_target: 0.7624222467420623, croe: 0.16920223832130432, air_yards_per_target: 1.5, yac_per_reception: 8.0, ...NO_PARTICIPATION }),
  wr({ player_id: '00-0041395', player_name: 'E.Raridon', position: 'TE', games: 1, targets: 1, epa_per_target: 0.8406261451600585, croe: 0.46012723445892334, air_yards_per_target: 2.0, yac_per_reception: 0.0, ...NO_PARTICIPATION }),
  wr({ player_id: '00-0039074', player_name: 'D.Allen', position: 'TE', games: 1, targets: 1, epa_per_target: 1.1979658557102084, croe: 0.1323910355567932, air_yards_per_target: -1.0, yac_per_reception: 14.0, ...NO_PARTICIPATION }),
  wr({ player_id: '00-0040737', player_name: 'T.Ferguson', position: 'TE', games: 1, targets: 1, epa_per_target: -2.7767381893936545, croe: -0.2940230965614319, air_yards_per_target: 24.0, yac_per_reception: null as unknown as number, ...NO_PARTICIPATION }),
  wr({ player_id: '00-0038543', player_name: 'J.Smith-Njigba', position: 'WR', games: 1, targets: 11, epa_per_target: 0.6979132208492171, croe: 0.05526326732202014, air_yards_per_target: 6.909090909090909, yac_per_reception: 7.75, ...NO_PARTICIPATION }),
  wr({ player_id: '00-0033908', player_name: 'C.Kupp', position: 'WR', games: 1, targets: 3, epa_per_target: 0.5744059124651054, croe: 0.17203072706858313, air_yards_per_target: 16.333333333333332, yac_per_reception: 2.5, ...NO_PARTICIPATION }),
];

describe("receiverArchetypeMap (leaderboard)", () => {
  // Frozen 2025 WR/TE pool + leaderboard labels captured before the fix.
  // It pins the FORMULA, not the data: never re-capture it to make this pass.
  const fixture = wrTePool as unknown as {
    rows: ReceiverSeasonStat[];
    leaderboardLabels: Record<string, string | null>;
  };

  it("2025 golden: every WR/TE leaderboard label is unchanged", () => {
    expect(fixture.rows).toHaveLength(347);
    const map = receiverArchetypeMap(fixture.rows);
    const actual = Object.fromEntries(
      fixture.rows.map((r) => [r.player_id, map[r.player_id]?.label ?? null]),
    );
    expect(Object.keys(actual)).toHaveLength(347);
    expect(actual).toEqual(fixture.leaderboardLabels);
  });

  it("week 1 (empty 32-target pools): no archetypes at all", () => {
    // Regression: the old code scored every axis against the empty pool as
    // 0th and tagged all nine TEs "Blocking TE".
    expect(receiverArchetypeMap(WEEK1_2026)).toEqual({});
  });

  it("no labels for a position until it has 10 qualifiers", () => {
    // Varied profiles, so the positive case is a real label rather than an
    // all-zero-percentile one.
    const te = (i: number) => wr({
      player_id: `te${i}`, position: "TE", games: 17, targets: 40 + i * 8,
      epa_per_target: 0.02 * i, croe: -0.05 + 0.01 * i,
      air_yards_per_target: 5 + 0.5 * i, yac_per_reception: 3 + 0.4 * i,
      yards_per_route_run: 1 + 0.1 * i,
    });
    const wrs = Array.from({ length: 10 }, (_, i) => wr({
      player_id: `wr${i}`, position: "WR", games: 17, targets: 50 + i * 10,
      epa_per_target: 0.03 * i, croe: -0.04 + 0.01 * i,
      air_yards_per_target: 7 + 0.6 * i, yac_per_reception: 3 + 0.3 * i,
      yards_per_route_run: 1.2 + 0.15 * i,
    }));
    const smallTE = wr({ player_id: "te-small", position: "TE", games: 17, targets: 5 });
    const nineTEs = [...Array.from({ length: 9 }, (_, i) => te(i)), smallTE];
    const nine = receiverArchetypeMap([...wrs, ...nineTEs]);
    expect(Object.keys(nine).filter((id) => id.startsWith("te"))).toEqual([]);

    const ten = receiverArchetypeMap([...wrs, ...nineTEs, te(9)]);
    expect(Object.keys(ten).filter((id) => id.startsWith("te")).length).toBeGreaterThan(0);
    // The best TE in the pool (90th on every axis) earns a real label.
    expect(ten["te9"]?.label).toBe("Elite TE1");

    // WRs do not depend on the TE count.
    const wrOnly = (m: Record<string, { icon: string; label: string }>) =>
      Object.fromEntries(Object.entries(m).filter(([id]) => id.startsWith("wr")));
    expect(Object.keys(wrOnly(nine)).length).toBeGreaterThan(0);
    expect(wrOnly(ten)).toEqual(wrOnly(nine));
  });

  it("missing YPRR is ignored, not scored 0th", () => {
    // 12 qualifying TEs with no route data, plus a 1-target TE whose other
    // axes sit mid-pool. The old code read his missing YPRR as 0th -> Blocking TE.
    const pool = Array.from({ length: 12 }, (_, i) => wr({
      player_id: `te${i}`, position: "TE", games: 3, targets: 40 + i,
      epa_per_target: -0.1 + 0.03 * i, croe: -0.06 + 0.01 * i,
      air_yards_per_target: 4 + 0.5 * i, yac_per_reception: 2 + 0.5 * i,
      ...NO_PARTICIPATION,
    }));
    const low = wr({
      player_id: "low", position: "TE", games: 1, targets: 1,
      epa_per_target: 0.08, croe: 0.0, air_yards_per_target: 7, yac_per_reception: 5,
      ...NO_PARTICIPATION,
    });
    const map = receiverArchetypeMap([...pool, low]);
    expect(map["low"]?.label).not.toBe("Blocking TE");
  });
});
