/**
 * Shared radar chart value extraction and percentile computation.
 * Eliminates duplication across PlayerOverview*, card/[slug], and ComparisonTool.
 */

import type { QBSeasonStat, ReceiverSeasonStat } from "@/lib/types";
import { computePercentile } from "./percentiles";

// ---- QB Radar (7 axes: 6 passing + 1 rushing) ----
export const QB_RADAR_KEYS = ["epa_per_db", "cpoe", "dropbacks_game", "adot", "inv_int_pct", "success_rate", "rush_epa"] as const;
export const QB_RADAR_AXES = [
  { label: "EPA/DB" }, { label: "CPOE" }, { label: "DB/Game" },
  { label: "aDOT" }, { label: "INT Rate" }, { label: "Success%" },
  { label: "Rush EPA" },
];
export const QB_RADAR_LABELS: Record<string, string> = {
  epa_per_db: "EPA/DB", cpoe: "CPOE", dropbacks_game: "DB/G",
  adot: "aDOT", inv_int_pct: "INT Rate", success_rate: "Success%",
  rush_epa: "Rush EPA",
};

export function getQBRadarVal(qb: QBSeasonStat, key: string): number {
  switch (key) {
    case "epa_per_db": return qb.epa_per_db ?? NaN;
    case "cpoe": return qb.cpoe ?? NaN;
    case "dropbacks_game": return qb.games ? qb.dropbacks / qb.games : NaN;
    case "adot": return qb.adot ?? NaN;
    case "inv_int_pct": return qb.attempts > 0 ? 1 - (qb.interceptions / qb.attempts) : NaN;
    case "success_rate": return qb.success_rate ?? NaN;
    case "rush_epa": return qb.rush_epa_per_play ?? NaN;
    default: return NaN;
  }
}

// ---- WR/TE Radar ----
export const WR_RADAR_KEYS = ["targets_game", "epa_per_target", "croe", "air_yards_per_target", "yac_per_reception", "yards_per_route_run"] as const;
export const WR_RADAR_AXES = [
  { label: "Tgt/Game" }, { label: "EPA/Tgt" }, { label: "CROE" },
  { label: "aDOT" }, { label: "YAC/Rec" }, { label: "YPRR" },
];
export const WR_RADAR_LABELS: Record<string, string> = {
  targets_game: "Tgt/G", epa_per_target: "EPA/Tgt", croe: "CROE",
  air_yards_per_target: "ADOT", yac_per_reception: "YAC/Rec", yards_per_route_run: "YPRR",
};

export function getWRRadarVal(rec: ReceiverSeasonStat, key: string): number {
  switch (key) {
    case "targets_game": return rec.games ? rec.targets / rec.games : NaN;
    case "epa_per_target": return rec.epa_per_target ?? NaN;
    case "croe": return rec.croe ?? NaN;
    case "air_yards_per_target": return rec.air_yards_per_target ?? NaN;
    case "yac_per_reception": return rec.yac_per_reception ?? NaN;
    case "yards_per_route_run": return rec.yards_per_route_run ?? NaN;
    default: return NaN;
  }
}

// ---- RB Radar ----
// Minimal interface so both AggregatedRB (from weekly) and RBSeasonStat work
export interface RBRadarInput {
  games: number;
  carries: number;
  epa_per_carry: number;
  stuff_rate: number;
  explosive_rate: number;
  targets: number;
  success_rate: number;
}

export const RB_RADAR_KEYS = ["carries_game", "epa_per_carry", "stuff_avoidance", "explosive_rate", "targets_game", "success_rate"] as const;
export const RB_RADAR_AXES = [
  { label: "Car/Game" }, { label: "EPA/Car" }, { label: "Stuff Avoid" },
  { label: "Explosive%" }, { label: "Tgt/Game" }, { label: "Success%" },
];
export const RB_RADAR_LABELS: Record<string, string> = {
  carries_game: "Car/G", epa_per_carry: "EPA/Car", stuff_avoidance: "Stuff Avoid%",
  explosive_rate: "Explosive%", targets_game: "Tgt/G", success_rate: "Success%",
};

export function getRBRadarVal(rb: RBRadarInput, key: string): number {
  switch (key) {
    case "carries_game": return rb.games ? rb.carries / rb.games : NaN;
    case "epa_per_carry": return rb.epa_per_carry ?? NaN;
    case "stuff_avoidance": return !isNaN(rb.stuff_rate) ? 1 - rb.stuff_rate : NaN;
    case "explosive_rate": return rb.explosive_rate ?? NaN;
    case "targets_game": return rb.games ? rb.targets / rb.games : NaN;
    case "success_rate": return rb.success_rate ?? NaN;
    default: return NaN;
  }
}

// ---- Generic percentile computation ----
/**
 * Compute radar percentile values for a player against a league pool.
 * Returns an array of 0–100 values, one per radar key.
 */
export function computeRadarValues<T>(
  keys: readonly string[],
  getValue: (item: T, key: string) => number,
  player: T,
  pool: T[],
): number[] {
  return keys.map((key) => {
    const allVals = pool
      .map((p) => getValue(p, key))
      .filter((v) => !isNaN(v))
      .sort((a, b) => a - b);
    return computePercentile(allVals, getValue(player, key));
  });
}
