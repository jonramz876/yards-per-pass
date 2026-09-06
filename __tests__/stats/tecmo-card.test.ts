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
  it("aDOT is NOT an OVR input (style excluded)", () => {
    // Same attempts, same passing totals — only the style metric differs, so
    // neither the quality half nor the production half of OVR may move.
    const lowAdot = qb({ player_id: "l", adot: 6 });
    const highAdot = qb({ player_id: "h", adot: 12 });
    const p = [...pool, lowAdot, highAdot];
    expect(buildQBCardData(lowAdot, p, 2026).ovr).toBe(buildQBCardData(highAdot, p, 2026).ovr);
  });
  it("empty pool yields null OVR, no NaN in rows", () => {
    const d = buildQBCardData(qb({}), [], 2026);
    expect(d.ovr).toBeNull();
    d.abilityRows.forEach(r => expect(Number.isNaN(r.percentile)).toBe(false));
    d.statCells.forEach(c => expect(c.value).not.toContain("NaN"));
  });
  it("a missing quality metric is excluded from OVR, not counted as 0th", () => {
    const noCpoe = qb({ player_id: "nc", epa_per_db: 0.21, cpoe: null });
    const p = [pool[0], pool[1], pool[2], noCpoe];
    const d = buildQBCardData(noCpoe, p, 2026);
    const cpoeRow = d.abilityRows.find(r => r.label === "CPOE")!;
    expect(cpoeRow.missing).toBe(true);
    expect(cpoeRow.raw).toBe("—");
    // Quality: EPA/DB 75th, three other inputs 0th (identical pool), CPOE
    // dropped -> mean([75,0,0,0]) = 18.75. All attempts equal so CAP = 542 and
    // the regression weight is 1 -> quality_reg = 18.75. Production (total EPA
    // + passing yards identical across the pool) = 0.
    // OVR = 0.5*18.75 + 0.5*0 = 9.375 -> 9.
    // Counting CPOE as a 0 would give mean 15 -> 7.5 -> 8.
    expect(d.ovr).toBe(9);
    expect(d.ovr).not.toBe(8);
  });
  it("present metrics are not flagged missing", () => {
    const d = buildQBCardData(pool[3], pool, 2026);
    d.abilityRows.forEach(r => expect(r.missing).toBe(false));
  });
  it("formats raw values on the stored scales (golden strings)", () => {
    const d = buildQBCardData(pool[3], pool, 2026);
    const row = (l: string) => d.abilityRows.find(r => r.label === l)!.raw;
    const cell = (l: string) => d.statCells.find(c => c.label === l)!.value;
    expect(row("SUCCESS RATE")).toBe("49.8%");   // success_rate stored 0-1
    expect(row("CPOE")).toBe("+2.4");            // cpoe stored on display scale
    expect(row("BALL SECURITY")).toBe("2.2% INT"); // 12 INT / 542 att
    expect(row("EPA/DROPBACK")).toBe("+0.21");
    expect(cell("PCT")).toBe("66.2");            // completion_pct stored on display scale
    expect(cell("ATT")).toBe("542");
    expect(cell("FPTS")).toBe("404");
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
  it("boundaries are inclusive at 75 and 40", () => {
    expect(tierColor(75)).toBe("#16a34a");
    expect(tierColor(74.9)).toBe("#ca8a04");
    expect(tierColor(40)).toBe("#ca8a04");
    expect(tierColor(39.9)).toBe("#dc2626");
    expect(tierColor(0)).toBe("#dc2626");
    expect(tierColor(100)).toBe("#16a34a");
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

  it("style metrics (air yds/tgt, YAC/rec) are NOT in the OVR inputs", () => {
    // Identical targets and identical receiving totals — only style differs.
    const lowStyle = wr({
      player_id: "ls", air_yards_per_target: 5, yac_per_reception: 2,
    });
    const highStyle = wr({
      player_id: "hs", air_yards_per_target: 15, yac_per_reception: 9,
    });
    const p = [...pool, lowStyle, highStyle];
    expect(buildWRCardData(lowStyle, p, 2026).ovr).toBe(buildWRCardData(highStyle, p, 2026).ovr);
  });

  it("empty pool yields null OVR, no NaN in rows", () => {
    const d = buildWRCardData(wr({}), [], 2026);
    expect(d.ovr).toBeNull();
    d.abilityRows.forEach(r => expect(Number.isNaN(r.percentile)).toBe(false));
    d.statCells.forEach(c => expect(c.value).not.toContain("NaN"));
  });

  it("a missing quality metric is excluded from OVR, not counted as 0th", () => {
    const noCroe = wr({ player_id: "nc", epa_per_target: 0.40, croe: null });
    const p = [pool[0], pool[1], pool[2], noCroe];
    const d = buildWRCardData(noCroe, p, 2026);
    const croeRow = d.abilityRows.find(r => r.label === "CROE")!;
    expect(croeRow.missing).toBe(true);
    expect(croeRow.raw).toBe("—");
    // Quality: EPA/Tgt 75th, YPRR + receiving success 0th, CROE dropped ->
    // mean([75,0,0]) = 25. Targets identical across the pool so the regression
    // weight is 1; production (receiving yards + EPA identical) = 0.
    // OVR = 0.5*25 + 0.5*0 = 12.5 -> 13.
    // Counting CROE as a 0 would give mean 18.75 -> 9.375 -> 9.
    expect(d.ovr).toBe(13);
    expect(d.ovr).not.toBe(9);
  });

  it("a missing receiving_success_rate is excluded from OVR too", () => {
    const noSucc = wr({ player_id: "ns", epa_per_target: 0.40, receiving_success_rate: null });
    const p = [pool[0], pool[1], pool[2], noSucc];
    // EPA/Tgt 75th, CROE + YPRR 0th, success dropped: quality mean 25,
    // production 0 -> 12.5 -> 13.
    expect(buildWRCardData(noSucc, p, 2026).ovr).toBe(13);
  });

  it("formats raw values on the stored scales (golden strings)", () => {
    const d = buildWRCardData(pool[0], pool, 2026);
    const row = (l: string) => d.abilityRows.find(r => r.label === l)!.raw;
    const cell = (l: string) => d.statCells.find(c => c.label === l)!.value;
    expect(row("CROE")).toBe("+2.4%");        // croe stored 0-1 -> signed percent
    expect(row("EPA/TARGET")).toBe("+0.10");
    expect(row("YPRR")).toBe("2.46");
    expect(cell("TGT %")).toBe("27.1%");      // target_share stored 0-1
    expect(cell("SNAP %")).toBe("84.2%");     // snap_share stored 0-1
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
    // True of both halves in v2: quality is rushing efficiency, production is
    // rushing EPA + rushing yards. Carries (the volume input) are identical.
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

  it("a missing quality metric is excluded from OVR, not counted as 0th", () => {
    // parseNumericFields turns a null DB value into NaN, so NaN is the
    // real-world "missing" representation for a non-nullable numeric column.
    const noExpl = rb({ player_id: "ne", epa_per_carry: 0.10, explosive_rate: NaN });
    const p = [pool[0], pool[1], pool[2], noExpl];
    const d = buildRBCardData(noExpl, p, 2026);
    const explRow = d.abilityRows.find(r => r.label === "EXPLOSIVE %")!;
    expect(explRow.missing).toBe(true);
    expect(explRow.raw).toBe("—");
    // Quality: EPA/Car 75th, success + stuff avoid 0th, explosive dropped ->
    // mean([75,0,0]) = 25. Carries identical across the pool so the regression
    // weight is 1; production (rushing yards + EPA identical) = 0.
    // OVR = 0.5*25 + 0.5*0 = 12.5 -> 13.
    // Counting explosive as a 0 would give mean 18.75 -> 9.375 -> 9.
    expect(d.ovr).toBe(13);
    expect(d.ovr).not.toBe(9);
  });

  it("formats raw values on the stored scales (golden strings)", () => {
    const d = buildRBCardData(pool[3], pool, 2026);
    const row = (l: string) => d.abilityRows.find(r => r.label === l)!.raw;
    const cell = (l: string) => d.statCells.find(c => c.label === l)!.value;
    expect(cell("SUCC %")).toBe("45.1%");     // success_rate stored 0-1
    expect(cell("EXPL %")).toBe("11.2%");     // explosive_rate stored 0-1
    expect(cell("YPC")).toBe("4.6");
    expect(row("STUFF AVOID")).toBe("83.2%"); // 1 - stuff_rate 0.168
    expect(row("EPA/CARRY")).toBe("+0.10");
    expect(row("CAR/GAME")).toBe("17.0");
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

// ---------------------------------------------------------------------------
// OVR v2 ("REG50"), per the "OVR score" section of
// docs/superpowers/specs/2026-09-05-tecmo-player-card-design.md:
//   OVR = min(99, round(0.5 * quality_reg + 0.5 * production))
//   quality_reg = 50 + (mean quality pctl - 50) * min(volume / CAP, 1)
//   CAP = 70th-percentile pool volume, linearly interpolated
//   production = mean of the season total-EPA and total-yards percentiles
// Every expected number below is hand-computed in the comment above it.
// ---------------------------------------------------------------------------
describe("OVR v2 (REG50)", () => {
  type Quality = { epa: number; sr: number; stuff: number; expl: number };
  type Production = { yards: number; epa: number };

  /** RB fixture spelling out only the fields OVR reads. */
  const r = (
    id: string, carries: number, q: Quality, prod: Production, games = 16,
  ): RBSeasonStat => rb({
    player_id: id, player_name: id, games, carries,
    epa_per_carry: q.epa, success_rate: q.sr, stuff_rate: q.stuff,
    explosive_rate: q.expl, rushing_yards: prod.yards, total_rushing_epa: prod.epa,
  });

  const ELITE_Q: Quality = { epa: 0.20, sr: 0.60, stuff: 0.10, expl: 0.20 };
  const BAD_Q: Quality = { epa: -0.10, sr: 0.35, stuff: 0.30, expl: 0.05 };
  const BIG_PROD: Production = { yards: 1500, epa: 20 };
  const SMALL_PROD: Production = { yards: 700, epa: -30 };

  // ---- volume regression toward 50, both directions ----

  it("pulls a low-volume elite DOWN toward 50", () => {
    const fillers = [1, 2, 3].map((i) => r("f" + i, 200, BAD_Q, SMALL_PROD));
    const hi = r("hi", 300, ELITE_Q, BIG_PROD);
    const lo = r("lo", 120, ELITE_Q, BIG_PROD);
    const p = [...fillers, hi, lo]; // identical in every field except carries
    // Pool carries [120,200,200,200,300] -> CAP = 200 (index 0.7*4 = 2.8).
    // Both elites: 3 of 5 below on every quality metric AND both production
    // metrics -> quality 60, production 60.
    //   hi: w = min(300/200,1) = 1 -> reg 60 -> 0.5*60 + 0.5*60 = 60
    //   lo: w = 120/200 = 0.6      -> reg 56 -> 0.5*56 + 0.5*60 = 58
    expect(buildRBCardData(hi, p, 2026).ovr).toBe(60);
    expect(buildRBCardData(lo, p, 2026).ovr).toBe(58);
  });

  it("pulls a low-volume disaster UP toward 50", () => {
    const fillers = [1, 2, 3].map((i) => r("f" + i, 200, ELITE_Q, BIG_PROD));
    const hi = r("hi", 300, BAD_Q, SMALL_PROD);
    const lo = r("lo", 120, BAD_Q, SMALL_PROD);
    const p = [...fillers, hi, lo];
    // Same CAP = 200. Quality and production percentiles are both 0 (nobody
    // ranks below them).
    //   hi: w = 1   -> reg 0  -> 0.5*0 + 0.5*0  = 0
    //   lo: w = 0.6 -> reg 20 -> 0.5*20 + 0.5*0 = 10
    expect(buildRBCardData(hi, p, 2026).ovr).toBe(0);
    expect(buildRBCardData(lo, p, 2026).ovr).toBe(10);
  });

  // ---- production half ----

  it("rewards bigger season totals at identical efficiency", () => {
    const same: Quality = { epa: 0.00, sr: 0.45, stuff: 0.20, expl: 0.10 };
    const p = [
      r("f1", 200, { epa: -0.10, sr: 0.38, stuff: 0.28, expl: 0.06 }, { yards: 700, epa: -20 }),
      r("f2", 200, { epa: -0.05, sr: 0.42, stuff: 0.24, expl: 0.08 }, { yards: 800, epa: -10 }),
      r("f3", 200, { epa: 0.05, sr: 0.48, stuff: 0.16, expl: 0.12 }, { yards: 900, epa: 10 }),
      r("f4", 200, { epa: 0.10, sr: 0.52, stuff: 0.12, expl: 0.14 }, { yards: 1000, epa: 20 }),
      r("lowProd", 200, same, { yards: 600, epa: -30 }),
      r("highProd", 200, same, { yards: 1400, epa: 40 }),
    ];
    // All carries equal -> CAP 200, w = 1, so quality_reg = quality = 33.33
    // (2 of 6 below) for both. Production: lowProd last on both totals -> 0;
    // highProd 5 of 6 below on both -> 83.33.
    //   lowProd:  0.5*33.33 + 0.5*0     = 16.67 -> 17
    //   highProd: 0.5*33.33 + 0.5*83.33 = 58.33 -> 58
    expect(buildRBCardData(p[4], p, 2026).ovr).toBe(17);
    expect(buildRBCardData(p[5], p, 2026).ovr).toBe(58);
  });

  it("a high-volume workhorse outranks a low-volume efficiency darling", () => {
    // The Henry/Corum shape from the 2025 study: mediocre per-carry numbers but
    // enormous totals must beat great per-carry numbers on 100 carries.
    const p = [
      r("f1", 150, { epa: -0.15, sr: 0.38, stuff: 0.28, expl: 0.06 }, { yards: 500, epa: -20 }),
      r("f2", 200, { epa: -0.05, sr: 0.42, stuff: 0.24, expl: 0.08 }, { yards: 750, epa: -10 }),
      r("f3", 250, { epa: 0.00, sr: 0.46, stuff: 0.20, expl: 0.10 }, { yards: 1000, epa: 0 }),
      r("henry", 350, { epa: -0.02, sr: 0.44, stuff: 0.22, expl: 0.09 }, { yards: 1600, epa: 5 }),
      r("corum", 100, { epa: 0.15, sr: 0.55, stuff: 0.12, expl: 0.16 }, { yards: 520, epa: 2 }),
    ];
    // CAP: carries [100,150,200,250,350], index 0.7*4 = 2.8 -> 200 + 0.8*50 = 240.
    //   henry: quality 40, w = 1            -> reg 40   ; production (80,80) = 80
    //          0.5*40 + 0.5*80 = 60
    //   corum: quality 80, w = 100/240 = .4167 -> reg 62.5; production (20,60) = 40
    //          0.5*62.5 + 0.5*40 = 51.25 -> 51
    // v1 (quality only) had this backwards: henry 40, corum 80.
    const henry = buildRBCardData(p[3], p, 2026).ovr!;
    const corum = buildRBCardData(p[4], p, 2026).ovr!;
    expect(henry).toBe(60);
    expect(corum).toBe(51);
    expect(henry).toBeGreaterThan(corum);
  });

  // ---- symmetric degradation ----

  // Three backs the degradation target is measured against: he beats all three
  // on every quality metric and both production totals -> 75th on each.
  const DEG_POOL = [
    r("d1", 200, { epa: -0.10, sr: 0.38, stuff: 0.28, expl: 0.06 }, { yards: 700, epa: -20 }),
    r("d2", 200, { epa: -0.05, sr: 0.42, stuff: 0.24, expl: 0.08 }, { yards: 800, epa: -10 }),
    r("d3", 200, { epa: 0.05, sr: 0.48, stuff: 0.16, expl: 0.12 }, { yards: 900, epa: 10 }),
  ];
  const GOOD_Q: Quality = { epa: 0.10, sr: 0.52, stuff: 0.12, expl: 0.14 };

  it("production entirely missing -> quality_reg alone", () => {
    const me = rb({
      player_id: "me", games: 16, carries: 200,
      epa_per_carry: GOOD_Q.epa, success_rate: GOOD_Q.sr,
      stuff_rate: GOOD_Q.stuff, explosive_rate: GOOD_Q.expl,
      rushing_yards: NaN, total_rushing_epa: null,
    });
    const p = [...DEG_POOL, me];
    // Quality 75 on all four inputs, carries all 200 -> CAP 200, w = 1 -> 75.
    // Blending a missing production in as a 0 would give 37.5 -> 38.
    expect(buildRBCardData(me, p, 2026).ovr).toBe(75);
    expect(buildRBCardData(me, p, 2026).ovr).not.toBe(38);
  });

  it("quality entirely missing -> production alone", () => {
    const me = rb({
      player_id: "me", games: 16, carries: 200,
      epa_per_carry: NaN, success_rate: NaN, stuff_rate: NaN, explosive_rate: NaN,
      rushing_yards: 1000, total_rushing_epa: 20,
    });
    const p = [...DEG_POOL, me];
    // Both production percentiles are 75. Treating an absent quality half as a
    // 50 would give 0.5*50 + 0.5*75 = 62.5 -> 63.
    expect(buildRBCardData(me, p, 2026).ovr).toBe(75);
    expect(buildRBCardData(me, p, 2026).ovr).not.toBe(63);
  });

  it("quality and production both missing -> null OVR", () => {
    const me = rb({
      player_id: "me", games: 16, carries: 200,
      epa_per_carry: NaN, success_rate: NaN, stuff_rate: NaN, explosive_rate: NaN,
      rushing_yards: NaN, total_rushing_epa: null,
    });
    const d = buildRBCardData(me, [...DEG_POOL, me], 2026);
    expect(d.eligible).toBe(true); // he clears 6 carries/game — there is just no data
    expect(d.ovr).toBeNull();
  });

  // ---- CAP quantile convention ----

  it("CAP is the pool's 70th-percentile volume, linearly interpolated", () => {
    // Volumes [10,20,30,40,50] -> fractional index 0.7*(5-1) = 2.8
    //   -> 30 + 0.8*(40-30) = 38   (a nearest-rank CAP would be 40)
    // Every other field is identical, so all quality and production
    // percentiles are 0 and OVR = round(0.5 * (50 - 50*w)).
    const q: Quality = { epa: 0.05, sr: 0.45, stuff: 0.20, expl: 0.10 };
    const prod: Production = { yards: 900, epa: 5 };
    const p = [10, 20, 30, 40, 50].map((c) => r("c" + c, c, q, prod, 1));
    const ovr = (i: number) => buildRBCardData(p[i], p, 2026).ovr;
    expect(ovr(0)).toBe(18); // w = 10/38 = .2632 -> reg 36.84 -> 18.42 (CAP 40 -> 19)
    expect(ovr(1)).toBe(12); // w = 20/38 = .5263 -> reg 23.68 -> 11.84 (CAP 40 -> 13)
    expect(ovr(4)).toBe(0);  // w = min(50/38,1) = 1 -> reg 0
  });

  // ---- range / null guards ----

  it("clamps to 99 and stays an integer at the very top", () => {
    const others = [1, 2, 3, 4].map((i) => r("f" + i, 200, BAD_Q, SMALL_PROD));
    const monster = r("monster", 400, ELITE_Q, BIG_PROD);
    // `monster` is not in the pool, so every percentile is a true 100:
    // quality_reg 100 (w = 1) and production 100 -> 100, clamped to 99.
    const d = buildRBCardData(monster, others, 2026);
    expect(d.ovr).toBe(99);
    expect(Number.isInteger(d.ovr)).toBe(true);
  });

  it("stays null for an ineligible player even with huge production", () => {
    const scrub = r("scrub", 40, ELITE_Q, BIG_PROD); // 2.5 carries/game
    const p = [...DEG_POOL, scrub];
    const d = buildRBCardData(scrub, p, 2026);
    expect(d.eligible).toBe(false);
    expect(d.ovr).toBeNull();
  });

  // ---- per-position wiring of the volume and production inputs ----

  it("QB volume is attempts; QB production is total EPA + passing yards", () => {
    const bad = {
      epa_per_db: 0.0, cpoe: -2, success_rate: 0.40, interceptions: 20,
      rush_epa_per_play: -0.1, rush_attempts: 80, total_epa: 10, passing_yards: 3000,
    };
    // interceptions 0 keeps ball security (1 - INT/att) identical despite the
    // different attempt counts, so attempts is the ONLY difference.
    const good = {
      epa_per_db: 0.30, cpoe: 5, success_rate: 0.55, interceptions: 0,
      rush_epa_per_play: 0.3, rush_attempts: 80, total_epa: 150, passing_yards: 4500,
    };
    const fillers = [1, 2, 3].map((i) => qb({ player_id: "f" + i, attempts: 500, ...bad }));
    const hi = qb({ player_id: "hi", attempts: 700, ...good });
    const lo = qb({ player_id: "lo", attempts: 300, ...good });
    const p = [...fillers, hi, lo];
    // Attempts [300,500,500,500,700] -> CAP 500. Quality and production are
    // both 60 for the two good passers (3 of 5 below on every input).
    //   hi: w = 1   -> 0.5*60 + 0.5*60 = 60
    //   lo: w = 0.6 -> 0.5*56 + 0.5*60 = 58
    expect(buildQBCardData(hi, p, 2026).ovr).toBe(60);
    expect(buildQBCardData(lo, p, 2026).ovr).toBe(58);
  });

  it("WR volume is targets; WR production is total receiving EPA + yards", () => {
    const bad = {
      epa_per_target: 0.0, croe: -0.02, yards_per_route_run: 1.2,
      receiving_success_rate: 0.42, total_receiving_epa: 5, receiving_yards: 600,
    };
    const good = {
      epa_per_target: 0.45, croe: 0.06, yards_per_route_run: 2.9,
      receiving_success_rate: 0.62, total_receiving_epa: 80, receiving_yards: 1400,
    };
    const fillers = [1, 2, 3].map((i) => wr({ player_id: "f" + i, targets: 100, ...bad }));
    const hi = wr({ player_id: "hi", targets: 150, ...good });
    const lo = wr({ player_id: "lo", targets: 60, ...good });
    const p = [...fillers, hi, lo];
    // Targets [60,100,100,100,150] -> CAP 100; same arithmetic as the QB case.
    expect(buildWRCardData(hi, p, 2026).ovr).toBe(60);
    expect(buildWRCardData(lo, p, 2026).ovr).toBe(58);
  });
});
