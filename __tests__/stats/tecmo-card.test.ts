import { describe, it, expect } from "vitest";
import {
  buildQBCardData, buildWRCardData, buildRBCardData,
  qbEligible, wrEligible, rbEligible, tierColor,
} from "@/lib/stats/tecmo-card";
import type { QBSeasonStat, ReceiverSeasonStat, RBSeasonStat } from "@/lib/types";
// Frozen 2025 WR/TE pool (347 rows) + labels/OVRs captured before the
// missing-participation fix. It pins the FORMULA, not the data: never
// re-capture it to make a failing test pass.
import wrTePool from "./fixtures/wr-te-2025-pool.json";

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
    // Quality (weighted): EPA/DB 75th, success rate + ANY/A + rush EPA 0th
    // (identical across the pool), CPOE dropped along with ITS WEIGHT ->
    // (75 + 0 + 0 + 0) / 4 = 18.75. Rush weight is a full 1 (102 att / 16 g =
    // 6.4 per game). Production (per-game EPA, yards and TDs all identical
    // across the pool) = 0. Blend halves: 0.5*18.75 + 0.5*0 = 9.375, and all
    // attempts are equal so CAP = 542 and the sqrt regression weight is 1.
    // OVR = round(77 + (9.375 - 50)*0.45) = round(58.71875) = 59.
    // Counting CPOE as a 0 would give quality 15 -> blend 7.5 -> 58.
    expect(d.ovr).toBe(59);
    expect(d.ovr).not.toBe(58);
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
    // blend = 0.5*25 + 0.5*0 = 12.5
    // OVR   = round(77 + (12.5 - 50)*0.45) = round(60.125) = 60.
    // Counting CROE as a 0 would give mean 18.75 -> blend 9.375 -> 59.
    expect(d.ovr).toBe(60);
    expect(d.ovr).not.toBe(59);
  });

  it("a missing receiving_success_rate is excluded from OVR too", () => {
    const noSucc = wr({ player_id: "ns", epa_per_target: 0.40, receiving_success_rate: null });
    const p = [pool[0], pool[1], pool[2], noSucc];
    // EPA/Tgt 75th, CROE + YPRR 0th, success dropped: quality mean 25,
    // production 0 -> blend 12.5 -> 60.
    expect(buildWRCardData(noSucc, p, 2026).ovr).toBe(60);
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

  it("2025 golden: every WR/TE card archetype and OVR is unchanged", () => {
    const fx = wrTePool as unknown as {
      rows: ReceiverSeasonStat[];
      cardLabels: Record<string, string | null>;
      cardOvr: Record<string, number | null>;
    };
    expect(fx.rows).toHaveLength(347);
    const labels: Record<string, string | null> = {};
    const ovrs: Record<string, number | null> = {};
    for (const r of fx.rows) {
      const d = buildWRCardData(r, fx.rows, 2025);
      labels[r.player_id] = d.archetypeLabel;
      ovrs[r.player_id] = d.ovr;
    }
    expect(labels).toEqual(fx.cardLabels);
    expect(ovrs).toEqual(fx.cardOvr);
    expect(Object.values(ovrs).filter((v) => v != null)).toHaveLength(247);
  });

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
  const week1Card = (name: string) =>
    buildWRCardData(WEEK1_2026.find((r) => r.player_name === name)!, WEEK1_2026, 2026);

  it("2026 week 1 (no participation file): no TE is a Blocking TE", () => {
    // Regression: the old code returned "Blocking TE" for Barner, Higbee,
    // Parkinson, Farrell, Raridon and Ferguson (missing YPRR scored as 0th).
    const expected: Record<string, string | null> = {
      "G.Kittle": "Target Hog",
      "H.Henry": "Security Blanket",
      "A.Barner": null,
      "T.Higbee": null,
      "C.Parkinson": null,
      "L.Farrell": "Complementary TE",
      "E.Raridon": "Complementary TE",
      "T.Ferguson": "Complementary TE",
      "D.Allen": "YAC Weapon",
    };
    for (const [name, label] of Object.entries(expected)) {
      expect(week1Card(name).archetypeLabel, name).toBe(label);
    }
    for (const r of WEEK1_2026) {
      expect(buildWRCardData(r, WEEK1_2026, 2026).archetypeLabel, r.player_name).not.toBe("Blocking TE");
    }
  });

  it("missing participation: ROUTES, SNAP % and YPRR render an em dash", () => {
    const d = week1Card("J.Smith-Njigba");
    const cell = (l: string) => d.statCells.find((c) => c.label === l)!.value;
    expect(cell("ROUTES")).toBe("—");
    expect(cell("SNAP %")).toBe("—");
    expect(cell("YPRR")).toBe("—");
    expect(d.abilityRows.find((r) => r.label === "YPRR")!.missing).toBe(true);
  });

  it("missing axes are flagged for the radar, and radarValues stay NaN-free", () => {
    expect(week1Card("J.Smith-Njigba").radarMissing).toEqual([false, false, false, false, false, true]);
    expect(week1Card("T.Ferguson").radarMissing).toEqual([false, false, false, false, true, true]);
    // radarValues is serialized server -> client on /card/[slug]: no NaN allowed.
    for (const r of WEEK1_2026) {
      expect(buildWRCardData(r, WEEK1_2026, 2026).radarValues.some(Number.isNaN), r.player_name).toBe(false);
    }
  });

  it("full data: no radar axis is missing", () => {
    expect(buildWRCardData(pool[3], pool, 2026).radarMissing).toEqual([false, false, false, false, false, false]);
  });

  it("a real zero routes count still renders 0", () => {
    const d = buildWRCardData(wr({ player_id: "z", routes_run: 0 }), pool, 2026);
    expect(d.statCells.find((c) => c.label === "ROUTES")!.value).toBe("0");
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
    // blend = 0.5*25 + 0.5*0 = 12.5
    // OVR   = round(77 + (12.5 - 50)*0.45) = round(60.125) = 60.
    // Counting explosive as a 0 would give mean 18.75 -> blend 9.375 -> 59.
    expect(d.ovr).toBe(60);
    expect(d.ovr).not.toBe(59);
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
// WR/TE/RB blend (v2 "REG50"), per the "OVR score" section of
// docs/superpowers/specs/2026-09-05-tecmo-player-card-design.md:
//   blend       = 0.5 * quality_reg + 0.5 * production
//   quality_reg = 50 + (mean quality pctl - 50) * min(volume / CAP, 1)
//   CAP         = 70th-percentile pool volume, linearly interpolated
//   production  = mean of the season total-EPA and total-yards percentiles
// and then the v3 Madden display map, which owns the only round and the cap:
//   OVR = min(99, round(77 + (blend - 50) * 0.45))
// Every expected number below is hand-computed in the comment above it.
// ---------------------------------------------------------------------------
describe("WR/TE/RB blend (REG50) + Madden map", () => {
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
    //   hi: w = min(300/200,1) = 1 -> reg 60 -> blend 0.5*60 + 0.5*60 = 60
    //       -> round(77 + 10*0.45) = round(81.5) = 82
    //   lo: w = 120/200 = 0.6      -> reg 56 -> blend 0.5*56 + 0.5*60 = 58
    //       -> round(77 + 8*0.45) = round(80.6) = 81
    expect(buildRBCardData(hi, p, 2026).ovr).toBe(82);
    expect(buildRBCardData(lo, p, 2026).ovr).toBe(81);
  });

  it("pulls a low-volume disaster UP toward 50", () => {
    const fillers = [1, 2, 3].map((i) => r("f" + i, 200, ELITE_Q, BIG_PROD));
    const hi = r("hi", 300, BAD_Q, SMALL_PROD);
    const lo = r("lo", 120, BAD_Q, SMALL_PROD);
    const p = [...fillers, hi, lo];
    // Same CAP = 200. Quality and production percentiles are both 0 (nobody
    // ranks below them).
    //   hi: w = 1   -> reg 0  -> blend 0.5*0 + 0.5*0  = 0
    //       -> round(77 - 50*0.45) = round(54.5) = 55 (the scale's floor)
    //   lo: w = 0.6 -> reg 20 -> blend 0.5*20 + 0.5*0 = 10
    //       -> round(77 - 40*0.45) = round(59) = 59
    expect(buildRBCardData(hi, p, 2026).ovr).toBe(55);
    expect(buildRBCardData(lo, p, 2026).ovr).toBe(59);
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
    //   lowProd:  blend 0.5*33.33 + 0.5*0     = 16.667
    //             -> round(77 - 33.333*0.45) = round(62) = 62
    //   highProd: blend 0.5*33.33 + 0.5*83.33 = 58.333
    //             -> round(77 + 8.333*0.45) = round(80.75) = 81
    expect(buildRBCardData(p[4], p, 2026).ovr).toBe(62);
    expect(buildRBCardData(p[5], p, 2026).ovr).toBe(81);
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
    //          blend 0.5*40 + 0.5*80 = 60 -> round(77 + 10*0.45) = 82
    //   corum: quality 80, w = 100/240 = .4167 -> reg 62.5; production (20,60) = 40
    //          blend 0.5*62.5 + 0.5*40 = 51.25
    //          -> round(77 + 1.25*0.45) = round(77.5625) = 78
    // v1 (quality only) had this backwards: henry 40, corum 80.
    const henry = buildRBCardData(p[3], p, 2026).ovr!;
    const corum = buildRBCardData(p[4], p, 2026).ovr!;
    expect(henry).toBe(82);
    expect(corum).toBe(78);
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
    // Quality 75 on all four inputs, carries all 200 -> CAP 200, w = 1, so the
    // blend is 75 alone -> round(77 + 25*0.45) = round(88.25) = 88.
    // Blending a missing production in as a 0 would give blend 37.5 -> 71.
    expect(buildRBCardData(me, p, 2026).ovr).toBe(88);
    expect(buildRBCardData(me, p, 2026).ovr).not.toBe(71);
  });

  it("quality entirely missing -> production alone", () => {
    const me = rb({
      player_id: "me", games: 16, carries: 200,
      epa_per_carry: NaN, success_rate: NaN, stuff_rate: NaN, explosive_rate: NaN,
      rushing_yards: 1000, total_rushing_epa: 20,
    });
    const p = [...DEG_POOL, me];
    // Both production percentiles are 75, so the blend is 75 alone -> 88.
    // Treating an absent quality half as a 50 would give a blend of
    // 0.5*50 + 0.5*75 = 62.5 -> round(82.625) = 83.
    expect(buildRBCardData(me, p, 2026).ovr).toBe(88);
    expect(buildRBCardData(me, p, 2026).ovr).not.toBe(83);
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
    // Volumes [10,20,30,300,500] -> fractional index 0.7*(5-1) = 2.8
    //   -> 30 + 0.8*(300-30) = 246   (a nearest-rank CAP would be 300)
    // The gap between the 3rd and 4th volume is deliberately huge: the Madden
    // map scales blend differences by 0.45, so a closely-spaced pool would
    // round the two CAP conventions to the same display number.
    // Every other field is identical, so all quality and production
    // percentiles are 0 and blend = 0.5 * (50 - 50*w).
    const q: Quality = { epa: 0.05, sr: 0.45, stuff: 0.20, expl: 0.10 };
    const prod: Production = { yards: 900, epa: 5 };
    const p = [10, 20, 30, 300, 500].map((c) => r("c" + c, c, q, prod, 1));
    const ovr = (i: number) => buildRBCardData(p[i], p, 2026).ovr;
    // w = 30/246 = .12195 -> reg 43.902 -> blend 21.951
    //   -> round(77 - 28.049*0.45) = round(64.378) = 64
    //   (a nearest-rank CAP of 300 gives w = .1 -> blend 22.5 -> 65)
    expect(ovr(2)).toBe(64);
    expect(ovr(2)).not.toBe(65);
    // w = min(500/246,1) = 1 -> reg 0 -> blend 0 -> round(54.5) = 55
    expect(ovr(4)).toBe(55);
  });

  // ---- range / null guards ----

  it("clamps to 99 and stays an integer at the very top", () => {
    const others = [1, 2, 3, 4].map((i) => r("f" + i, 200, BAD_Q, SMALL_PROD));
    const monster = r("monster", 400, ELITE_Q, BIG_PROD);
    // `monster` is not in the pool, so every percentile is a true 100:
    // quality_reg 100 (w = 1) and production 100 -> blend 100
    // -> round(77 + 50*0.45) = round(99.5) = 100, clamped to 99.
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
    // Targets [60,100,100,100,150] -> CAP 100. Quality and production are both
    // 60 for the two good receivers (3 of 5 below on every input).
    //   hi: w = 1   -> blend 0.5*60 + 0.5*60 = 60 -> round(81.5) = 82
    //   lo: w = 0.6 -> blend 0.5*56 + 0.5*60 = 58 -> round(80.6) = 81
    expect(buildWRCardData(hi, p, 2026).ovr).toBe(82);
    expect(buildWRCardData(lo, p, 2026).ovr).toBe(81);
  });
});

// ---------------------------------------------------------------------------
// OVR v3, per the "OVR score — Amended 2026-09-06 (v3)" section of
// docs/superpowers/specs/2026-09-05-tecmo-player-card-design.md.
//
// Display map (ALL positions, the only round and the only clamp):
//   OVR = min(99, round(77 + (blend - 50) * 0.45))
//
// QB blend ("Ability"):
//   quality    = WEIGHTED mean of the EPA/DB, ANY/A, CPOE and success-rate
//                percentiles (weight 1) plus regressed rush EPA at weight
//                min((rush att/game)/3, 1)
//   production = mean of the PER-GAME percentiles of total value EPA,
//                total yards (pass + rush) and total TDs (pass + rush)
//   blend      = 50 + (0.5*quality + 0.5*production - 50)
//                   * min(attempts/CAP, 1) ^ 0.5
//
// Every expected number below is hand-computed in the comment above it.
// ---------------------------------------------------------------------------
describe("OVR v3 Madden display map", () => {
  /**
   * A QB whose every OVR input rises with `k`, so a four-rung ladder of them
   * lands on the 0th / 25th / 50th / 75th percentile of its own pool. Attempts
   * are identical (400 over 16 games), so CAP = 400 and the regression weight
   * is exactly 1 — the blend IS the percentile mean.
   */
  const lvl = (k: number) => qb({
    player_id: "k" + k, player_name: "k" + k, games: 16, attempts: 400,
    epa_per_db: 0.05 * k, cpoe: 2 * k, success_rate: 0.10 * k, any_a: 2 * k,
    rush_epa_per_play: 0.05 * k, rush_attempts: 96,
    epa_per_play: 0.05 * k, passing_yards: 800 * k,
    touchdowns: 6 * k, rush_yards: 100 * k, rush_tds: 2 * k,
  });
  const ladder = [1, 2, 3, 4].map(lvl);
  const rung = (k: number) => buildQBCardData(ladder[k - 1], ladder, 2026).ovr;

  it("maps an average blend of 50 to 77", () => {
    // k=3 has 2 of 4 below him on every quality and production input -> every
    // percentile is 50 -> quality 50, production 50, blend 50.
    // round(77 + (50 - 50)*0.45) = 77.
    expect(rung(3)).toBe(77);
  });

  it("floors a 0 blend at ~55 rather than 0", () => {
    // k=1 is last on every input -> every percentile 0 -> blend 0.
    // round(77 + (0 - 50)*0.45) = round(54.5) = 55. The v2 scale showed a 0.
    expect(rung(1)).toBe(55);
    expect(rung(1)).not.toBe(0);
  });

  it("scales evenly between the rungs (25 -> 66, 75 -> 88)", () => {
    // k=2: 1 of 4 below -> 25 on everything -> blend 25
    //      round(77 - 25*0.45) = round(65.75) = 66
    // k=4: 3 of 4 below -> 75 on everything -> blend 75
    //      round(77 + 25*0.45) = round(88.25) = 88
    expect(rung(2)).toBe(66);
    expect(rung(4)).toBe(88);
  });

  it("caps at 99 for a QB who beats the pool on every input", () => {
    // `beast` is outside the pool, so every percentile is a true 100 ->
    // quality 100, production 100, attempts 400 = CAP -> weight 1 -> blend 100.
    // round(77 + 50*0.45) = round(99.5) = 100, clamped to 99.
    const pool = [1, 2, 3, 4].map((i) => qb({
      player_id: "p" + i, games: 16, attempts: 400,
      epa_per_db: 0.05, cpoe: 0, success_rate: 0.40, any_a: 5,
      rush_epa_per_play: -0.1, rush_attempts: 102,
      epa_per_play: 0.0, passing_yards: 2000, touchdowns: 10,
      rush_yards: 100, rush_tds: 0,
    }));
    const beast = qb({ player_id: "beast", games: 16, attempts: 400 });
    const d = buildQBCardData(beast, pool, 2026);
    expect(d.ovr).toBe(99);
    expect(Number.isInteger(d.ovr)).toBe(true);
  });
});

describe("OVR v3 QB blend (Ability)", () => {
  /** Four identical, unremarkable QBs the subjects below are graded against. */
  const POOL = [1, 2, 3, 4].map((i) => qb({
    player_id: "p" + i, games: 16, attempts: 400,
    epa_per_db: 0.05, cpoe: 0, success_rate: 0.40, any_a: 5,
    rush_epa_per_play: 0.18, rush_attempts: 102,
    epa_per_play: 0.2, passing_yards: 4306, touchdowns: 29,
    rush_yards: 523, rush_tds: 15,
  }));

  // ---- weighted quality: renormalization + volume-scaled rush weight ----

  /**
   * Beats the pool on EPA/DB, CPOE and success rate (100th on each), is last on
   * ANY/A and on rush EPA (0th on each), and is last on all three production
   * inputs (production 0). Only his rush VOLUME varies, which is the only thing
   * the rush weight reads.
   */
  const rusher = (id: string, rushAttempts: number) => qb({
    player_id: id, games: 16, attempts: 400,
    epa_per_db: 0.9, cpoe: 20, success_rate: 0.9, any_a: 1,
    rush_epa_per_play: -1, rush_attempts: rushAttempts,
    epa_per_play: -1, passing_yards: 100, touchdowns: 0,
    rush_yards: 0, rush_tds: 0,
  });
  const ovrOf = (q: QBSeasonStat) => buildQBCardData(q, POOL, 2026).ovr;

  it("weights rush EPA by rush volume and renormalizes the rest", () => {
    // Weight-1 inputs contribute 100 + 100 + 100 + 0 = 300 over weight 4.
    // Rush EPA is 0th; its weight is min((rush att / 16) / 3, 1). Production is
    // 0 and attempts (400) equal CAP, so the sqrt regression weight is 1 and
    // blend = 0.5 * quality.
    //   96 att -> 6.0/game -> weight 1   : quality 300/5      = 60
    //             blend 30 -> round(77 - 20*0.45)       = round(68)     = 68
    //   32 att -> 2.0/game -> weight 2/3 : quality 300/(14/3) = 64.286
    //             blend 32.143 -> round(77 - 17.857*0.45) = round(68.964) = 69
    //    0 att -> 0.0/game -> weight 0   : quality 300/4      = 75
    //             blend 37.5 -> round(77 - 12.5*0.45)   = round(71.375) = 71
    // The denominator SHRINKS with the weight (4 + w, not a fixed 5), so a
    // pocket passer is not quietly charged for a dropped rushing input.
    expect(ovrOf(rusher("full", 96))).toBe(68);
    expect(ovrOf(rusher("some", 32))).toBe(69);
    expect(ovrOf(rusher("none", 0))).toBe(71);
  });

  it("a QB who never runs is graded on his passing alone", () => {
    // Same fixture, but his rush EPA is now the best in the league instead of
    // the worst. At zero rush volume the input is dropped either way, so the
    // grade cannot move.
    const neverRuns = qb({ ...rusher("nr", 0), rush_epa_per_play: 9 });
    expect(ovrOf(neverRuns)).toBe(ovrOf(rusher("nr", 0)));
  });

  it("ANY/A is an OVR input (it replaced ball security)", () => {
    // Identical apart from ANY/A: last in the league vs best in the league.
    // Interceptions are equal, so v2's ball-security input cannot explain it.
    const lowAnyA = qb({ ...rusher("la", 96), any_a: 1 });
    const highAnyA = qb({ ...rusher("ha", 96), any_a: 99 });
    expect(ovrOf(highAnyA)!).toBeGreaterThan(ovrOf(lowAnyA)!);
    // ANY/A goes from 0th to 100th: quality (100*3 + 100 + 0) / 5 = 80,
    // blend 40 -> round(77 - 10*0.45) = round(72.5) = 73.
    expect(ovrOf(highAnyA)).toBe(73);
  });

  // ---- per-game production ----

  it("production is per-game, so a half season is not punished for length", () => {
    // `half` played 8 games at exactly `full`'s per-game rates (every total
    // halved, and both rush enough for a full-weight, unregressed rush EPA):
    //   EPA/game   full 0.2*(580+100)/16 = 8.5   half 0.2*(280+60)/8 = 8.5
    //   yards/game full (4000+400)/16    = 275   half (1900+300)/8   = 275
    //   TDs/game   full (30+6)/16        = 2.25  half (15+3)/8       = 2.25
    // The three fillers are worse on every input, so both land at 60 on all
    // five quality inputs and all three production inputs.
    // Attempts [224,224,224,250,500] -> CAP = 224 + 0.8*26 = 244.8, and both
    // clear it, so both regression weights are 1.
    //   blend 0.5*60 + 0.5*60 = 60 -> round(77 + 10*0.45) = round(81.5) = 82
    // Under v2's SEASON-TOTAL production, `half` would rank last on passing
    // yards (1900 < the fillers' 2000) and score far below `full`.
    const base = {
      games: 16, dropbacks: 580, scramble_pct: 0, rush_attempts: 100,
      epa_per_db: 0.0, cpoe: -2, success_rate: 0.40, any_a: 5,
      rush_epa_per_play: -0.1, epa_per_play: 0.0,
      passing_yards: 2000, rush_yards: 100, touchdowns: 10, rush_tds: 0,
    };
    const fillers = [1, 2, 3].map((i) => qb({ player_id: "f" + i, attempts: 224, ...base }));
    const good = { epa_per_db: 0.30, cpoe: 5, success_rate: 0.55, any_a: 8, rush_epa_per_play: 0.3 };
    const full = qb({
      player_id: "full", attempts: 500, games: 16, dropbacks: 580, scramble_pct: 0,
      rush_attempts: 100, epa_per_play: 0.2, passing_yards: 4000, rush_yards: 400,
      touchdowns: 30, rush_tds: 6, ...good,
    });
    const half = qb({
      player_id: "half", attempts: 250, games: 8, dropbacks: 280, scramble_pct: 0,
      rush_attempts: 60, epa_per_play: 0.2, passing_yards: 1900, rush_yards: 300,
      touchdowns: 15, rush_tds: 3, ...good,
    });
    const p = [...fillers, full, half];
    expect(buildQBCardData(half, p, 2026).ovr).toBe(82);
    expect(buildQBCardData(half, p, 2026).ovr).toBe(buildQBCardData(full, p, 2026).ovr);
  });

  it("production EPA counts rushing, unlike the v2 total_epa column", () => {
    // Two QBs identical on every rate stat and on passing volume; one gains
    // 600 rushing yards and 8 rushing TDs, the other none. total_epa (a
    // passing-only column) is identical, so under v2 they scored the same.
    const runner = qb({
      player_id: "run", games: 16, attempts: 400, rush_attempts: 96,
      rush_yards: 600, rush_tds: 8,
    });
    const statue = qb({
      player_id: "sit", games: 16, attempts: 400, rush_attempts: 96,
      rush_yards: 0, rush_tds: 0,
    });
    const p = [...POOL, runner, statue];
    expect(buildQBCardData(runner, p, 2026).ovr!)
      .toBeGreaterThan(buildQBCardData(statue, p, 2026).ovr!);
  });

  // ---- square-root volume regression ----

  it("regresses toward average on the SQUARE ROOT of attempts / CAP", () => {
    // `me` is outside the pool and beats it on every input, so quality and
    // production are both a clean 100 and the blend before regression is 100.
    // Pool attempts are all 400 -> CAP 400. At 100 attempts (over 4 games, so
    // still 25/game and eligible) the ratio is 0.25:
    //   sqrt:   w = 0.5  -> blend 50 + 50*0.5  = 75   -> round(88.25)  = 88
    //   linear: w = 0.25 -> blend 50 + 50*0.25 = 62.5 -> round(82.625) = 83
    const pool = [1, 2, 3, 4].map((i) => qb({
      player_id: "p" + i, games: 16, attempts: 400,
      epa_per_db: 0.05, cpoe: 0, success_rate: 0.40, any_a: 5,
      rush_epa_per_play: -0.1, rush_attempts: 102,
      epa_per_play: 0.0, passing_yards: 2000, touchdowns: 10,
      rush_yards: 100, rush_tds: 0,
    }));
    const me = qb({ player_id: "me", games: 4, attempts: 100 });
    const d = buildQBCardData(me, pool, 2026);
    expect(d.ovr).toBe(88);
    expect(d.ovr).not.toBe(83);
  });

  // ---- degradation (spec 4b: half-level rules carry over from v2) ----

  it("production entirely missing -> the quality half alone", () => {
    const me = qb({
      player_id: "me", games: 16, attempts: 400,
      epa_per_db: 0.9, cpoe: 20, success_rate: 0.9, any_a: 99,
      rush_epa_per_play: 9, rush_attempts: 96,
      epa_per_play: NaN, passing_yards: NaN, rush_yards: NaN,
      touchdowns: NaN, rush_tds: NaN,
    });
    // Quality is 100 on all five inputs; all three per-game production values
    // are NaN and drop out. Attempts 400 = CAP -> weight 1 -> blend 100 -> 99.
    // Counting the missing half as a 0 would give a blend of 50 -> 77.
    expect(buildQBCardData(me, POOL, 2026).ovr).toBe(99);
    expect(buildQBCardData(me, POOL, 2026).ovr).not.toBe(77);
  });

  it("quality entirely missing -> the production half alone", () => {
    const me = qb({
      player_id: "me", games: 16, attempts: 400,
      epa_per_db: null, cpoe: null, success_rate: null, any_a: NaN,
      rush_epa_per_play: null, rush_attempts: 96,
      epa_per_play: 9, passing_yards: 9000, rush_yards: 900,
      touchdowns: 90, rush_tds: 20,
    });
    // Every quality input is missing; production is 100 on all three.
    // Attempts 400 = CAP -> weight 1 -> blend 100 -> 99.
    // Treating an absent quality half as a 50 would give a blend of 75 -> 88.
    expect(buildQBCardData(me, POOL, 2026).ovr).toBe(99);
    expect(buildQBCardData(me, POOL, 2026).ovr).not.toBe(88);
  });

  it("quality and production both missing -> null OVR", () => {
    const me = qb({
      player_id: "me", games: 16, attempts: 400,
      epa_per_db: null, cpoe: null, success_rate: null, any_a: NaN,
      rush_epa_per_play: null, rush_attempts: 96,
      epa_per_play: NaN, passing_yards: NaN, rush_yards: NaN,
      touchdowns: NaN, rush_tds: NaN,
    });
    const d = buildQBCardData(me, POOL, 2026);
    expect(d.eligible).toBe(true); // 25 attempts/game — there is just no data
    expect(d.ovr).toBeNull();
  });
});
