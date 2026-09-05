import { describe, it, expect } from "vitest";
import {
  buildQBCardData, buildWRCardData, buildRBCardData,
  qbEligible, wrEligible, rbEligible, tierColor,
} from "@/lib/stats/tecmo-card";
import type { QBSeasonStat, ReceiverSeasonStat, RBSeasonStat } from "@/lib/types";

function qb(over: Partial<QBSeasonStat>): QBSeasonStat {
  return {
    player_id: "x", player_name: "X", team_id: "BUF", season: 2026, games: 16,
    completions: 359, attempts: 542, dropbacks: 580, epa_per_db: 0.21,
    epa_per_play: 0.2, cpoe: 2.4, completion_pct: 66.2, success_rate: 0.498,
    passing_yards: 4306, touchdowns: 29, interceptions: 12, sacks: 28,
    sack_yards_lost: 180, adot: 8.9, ypa: 7.9, passer_rating: 104.6, any_a: 7.4,
    rush_attempts: 102, rush_yards: 523, rush_tds: 15, rush_epa_per_play: 0.18,
    fumbles: 6, fumbles_lost: 3, td_pct: 5.4, int_pct: 2.2, sack_pct: 4.8,
    scramble_pct: 8, total_epa: 120,
    ...over,
  } as QBSeasonStat;
}

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

function rb(over: Partial<RBSeasonStat>): RBSeasonStat {
  return {
    player_id: "b", player_name: "B", position: "RB", team_id: "BUF", season: 2026,
    games: 16, carries: 272, rushing_yards: 1256, rushing_tds: 11,
    yards_per_carry: 4.6, epa_per_carry: 0.05, success_rate: 0.451,
    stuff_rate: 0.168, explosive_rate: 0.112, fumbles: 3, fumbles_lost: 1,
    targets: 58, receptions: 46, receiving_yards: 384, receiving_tds: 2,
    total_touches: 318, touches_per_game: 19.9, total_rushing_epa: 13.6,
    ...over,
  } as RBSeasonStat;
}

describe("eligibility", () => {
  it("QB with 14+ att/game is eligible", () => {
    expect(qbEligible(qb({ attempts: 224, games: 16 }))).toBe(true);
  });
  it("QB below 14 att/game is not", () => {
    expect(qbEligible(qb({ attempts: 100, games: 16 }))).toBe(false);
  });
  it("zero games is not eligible (no NaN)", () => {
    expect(qbEligible(qb({ games: 0 }))).toBe(false);
  });
  it("WR at 2+ tgt/game is eligible, below is not, zero games is not", () => {
    expect(wrEligible(wr({ targets: 32, games: 16 }))).toBe(true);
    expect(wrEligible(wr({ targets: 20, games: 16 }))).toBe(false);
    expect(wrEligible(wr({ games: 0 }))).toBe(false);
  });
  it("RB at 6+ car/game is eligible, below is not, zero games is not", () => {
    expect(rbEligible(rb({ carries: 96, games: 16 }))).toBe(true);
    expect(rbEligible(rb({ carries: 40, games: 16 }))).toBe(false);
    expect(rbEligible(rb({ games: 0 }))).toBe(false);
  });
});

describe("buildQBCardData", () => {
  const pool = [qb({ player_id: "a", epa_per_db: 0.05 }), qb({ player_id: "b", epa_per_db: 0.1 }),
                qb({ player_id: "c", epa_per_db: 0.15 }), qb({ player_id: "me", epa_per_db: 0.21 })];
  it("produces 12 stat cells and 7 ability rows", () => {
    const d = buildQBCardData(pool[3], pool, 2026);
    expect(d.statCells).toHaveLength(12);
    expect(d.abilityRows).toHaveLength(7);
  });
  it("OVR is 0-99 integer for an eligible QB", () => {
    const d = buildQBCardData(pool[3], pool, 2026);
    expect(d.ovr).not.toBeNull();
    expect(Number.isInteger(d.ovr)).toBe(true);
    expect(d.ovr!).toBeLessThanOrEqual(99);
  });
  it("OVR is null below threshold", () => {
    const scrub = qb({ player_id: "scrub", attempts: 40 });
    const d = buildQBCardData(scrub, pool, 2026);
    expect(d.ovr).toBeNull();
    expect(d.eligible).toBe(false);
  });
  it("aDOT and volume are NOT in the OVR inputs (style/volume excluded)", () => {
    const lowAdot = qb({ player_id: "l", adot: 6 });
    const highAdot = qb({ player_id: "h", adot: 12 });
    const p = [...pool, lowAdot, highAdot];
    expect(buildQBCardData(lowAdot, p, 2026).ovr).toBe(buildQBCardData(highAdot, p, 2026).ovr);
  });
  it("empty pool yields null OVR, no NaN in rows", () => {
    const d = buildQBCardData(qb({}), [], 2026);
    expect(d.ovr).toBeNull();
    d.abilityRows.forEach(r => expect(Number.isNaN(r.percentile)).toBe(false));
  });
  it("carries identity fields and radar labels through", () => {
    const d = buildQBCardData(pool[3], pool, 2026);
    expect(d.playerName).toBe("X");
    expect(d.position).toBe("QB");
    expect(d.season).toBe(2026);
    expect(d.games).toBe(16);
    expect(d.eligible).toBe(true);
    expect(d.radarValues).toHaveLength(7);
    expect(d.radarLabels).toHaveLength(7);
  });
});

describe("tierColor", () => {
  it("75+ green, 40-74 yellow, <40 red", () => {
    expect(tierColor(80)).toBe("#16a34a");
    expect(tierColor(50)).toBe("#ca8a04");
    expect(tierColor(10)).toBe("#dc2626");
  });
});

describe("buildWRCardData", () => {
  const pool = [
    wr({ player_id: "w1", epa_per_target: 0.10 }),
    wr({ player_id: "w2", epa_per_target: 0.20 }),
    wr({ player_id: "w3", epa_per_target: 0.30 }),
    wr({ player_id: "w4", epa_per_target: 0.40 }),
  ];

  it("produces 12 stat cells and 6 ability rows", () => {
    const d = buildWRCardData(pool[3], pool, 2026);
    expect(d.statCells).toHaveLength(12);
    expect(d.abilityRows).toHaveLength(6);
  });

  it("OVR is 0-99 integer for an eligible receiver", () => {
    const d = buildWRCardData(pool[3], pool, 2026);
    expect(d.ovr).not.toBeNull();
    expect(Number.isInteger(d.ovr)).toBe(true);
    expect(d.ovr!).toBeLessThanOrEqual(99);
    expect(d.ovr!).toBeGreaterThanOrEqual(0);
  });

  it("OVR is null below threshold (under 2 tgt/game)", () => {
    const scrub = wr({ player_id: "ws", targets: 20 });
    const d = buildWRCardData(scrub, pool, 2026);
    expect(d.ovr).toBeNull();
    expect(d.eligible).toBe(false);
  });

  it("a TE is ranked only against TEs (position-matched pool)", () => {
    // TEs are the three worst receivers overall, but te3 is the best TE.
    const wrs = [
      wr({ player_id: "w1", epa_per_target: 0.50 }),
      wr({ player_id: "w2", epa_per_target: 0.60 }),
      wr({ player_id: "w3", epa_per_target: 0.70 }),
    ];
    const tes = [
      wr({ player_id: "t1", position: "TE", epa_per_target: 0.10 }),
      wr({ player_id: "t2", position: "TE", epa_per_target: 0.20 }),
      wr({ player_id: "t3", position: "TE", epa_per_target: 0.30 }),
    ];
    const d = buildWRCardData(tes[2], [...wrs, ...tes], 2026);
    expect(d.position).toBe("TE");
    const epaRow = d.abilityRows.find(r => r.label === "EPA/TARGET")!;
    // 2 of 3 TEs below him -> 66.7 (an all-receiver pool would give 33.3)
    expect(epaRow.percentile).toBeCloseTo(66.67, 1);
  });

  it("volume and style are NOT in the OVR inputs", () => {
    const lowVol = wr({
      player_id: "lv", targets: 60, air_yards_per_target: 5, yac_per_reception: 2,
    });
    const highVol = wr({
      player_id: "hv", targets: 160, air_yards_per_target: 15, yac_per_reception: 9,
    });
    const p = [...pool, lowVol, highVol];
    expect(buildWRCardData(lowVol, p, 2026).ovr).toBe(buildWRCardData(highVol, p, 2026).ovr);
  });

  it("empty pool yields null OVR, no NaN in rows", () => {
    const d = buildWRCardData(wr({}), [], 2026);
    expect(d.ovr).toBeNull();
    d.abilityRows.forEach(r => expect(Number.isNaN(r.percentile)).toBe(false));
    d.statCells.forEach(c => expect(c.value).not.toContain("NaN"));
  });

  it("carries identity fields and radar labels through", () => {
    const d = buildWRCardData(pool[0], pool, 2026);
    expect(d.playerName).toBe("R");
    expect(d.position).toBe("WR");
    expect(d.season).toBe(2026);
    expect(d.games).toBe(16);
    expect(d.radarValues).toHaveLength(6);
    expect(d.radarLabels).toHaveLength(6);
  });
});

describe("buildRBCardData", () => {
  const pool = [
    rb({ player_id: "r1", epa_per_carry: -0.10 }),
    rb({ player_id: "r2", epa_per_carry: -0.02 }),
    rb({ player_id: "r3", epa_per_carry: 0.02 }),
    rb({ player_id: "r4", epa_per_carry: 0.10 }),
  ];

  it("produces 12 stat cells and 6 ability rows", () => {
    const d = buildRBCardData(pool[3], pool, 2026);
    expect(d.statCells).toHaveLength(12);
    expect(d.abilityRows).toHaveLength(6);
  });

  it("OVR is 0-99 integer for an eligible RB", () => {
    const d = buildRBCardData(pool[3], pool, 2026);
    expect(d.ovr).not.toBeNull();
    expect(Number.isInteger(d.ovr)).toBe(true);
    expect(d.ovr!).toBeLessThanOrEqual(99);
    expect(d.ovr!).toBeGreaterThanOrEqual(0);
  });

  it("OVR is null below threshold (under 6 car/game)", () => {
    const scrub = rb({ player_id: "rs", carries: 40 });
    const d = buildRBCardData(scrub, pool, 2026);
    expect(d.ovr).toBeNull();
    expect(d.eligible).toBe(false);
  });

  it("OVR is rushing-only — receiving stats do not move it", () => {
    const lowRec = rb({
      player_id: "lr", targets: 8, receptions: 6, receiving_yards: 40, receiving_tds: 0,
    });
    const highRec = rb({
      player_id: "hr", targets: 90, receptions: 74, receiving_yards: 620, receiving_tds: 5,
    });
    const p = [...pool, lowRec, highRec];
    expect(buildRBCardData(lowRec, p, 2026).ovr).toBe(buildRBCardData(highRec, p, 2026).ovr);
  });

  it("empty pool yields null OVR, no NaN in rows", () => {
    const d = buildRBCardData(rb({}), [], 2026);
    expect(d.ovr).toBeNull();
    d.abilityRows.forEach(r => expect(Number.isNaN(r.percentile)).toBe(false));
    d.statCells.forEach(c => expect(c.value).not.toContain("NaN"));
  });

  it("carries identity fields and radar labels through", () => {
    const d = buildRBCardData(pool[0], pool, 2026);
    expect(d.playerName).toBe("B");
    expect(d.position).toBe("RB");
    expect(d.season).toBe(2026);
    expect(d.games).toBe(16);
    expect(d.radarValues).toHaveLength(6);
    expect(d.radarLabels).toHaveLength(6);
  });
});
