// lib/stats/compare.ts
//
// The maths of a two-player comparison, as a pure module (compare card spec
// 2026-10-09, PR 1). Moved out of components/compare/ComparisonTool.tsx
// unchanged so that the Compare page and, later, the comparison share card and
// its image all get their numbers from one place.
//
// Pure: no React, no Supabase, nothing from lib/data except the static team
// list (a test checks the imports). It runs in the browser today and will run
// on the server for the card.
//
// PR 1 = no visible change. The pool is still "every row of the position's
// season table", exactly as /compare has always ranked. Switching to the stat
// card's qualified pools is PR 1b and changes only the pool step below.
import type { QBSeasonStat, ReceiverSeasonStat, RBSeasonStat } from "@/lib/types";
import { getTeamColor } from "@/lib/data/teams";
import {
  getQBRadarVal, getWRRadarVal, getRBRadarVal, computeRadarValues,
  QB_RADAR_AXES, QB_RADAR_KEYS, WR_RADAR_AXES, WR_RADAR_KEYS, RB_RADAR_AXES, RB_RADAR_KEYS,
} from "@/lib/stats/radar";
import { qbFantasyPoints, wrFantasyPoints, rbFantasyPoints } from "@/lib/stats/fantasy";

// Perceptual color distance (weighted Euclidean, green-sensitive)
export function colorDistance(hex1: string, hex2: string): number {
  const r1 = parseInt(hex1.slice(1, 3), 16), g1 = parseInt(hex1.slice(3, 5), 16), b1 = parseInt(hex1.slice(5, 7), 16);
  const r2 = parseInt(hex2.slice(1, 3), 16), g2 = parseInt(hex2.slice(3, 5), 16), b2 = parseInt(hex2.slice(5, 7), 16);
  return Math.sqrt(2 * (r1 - r2) ** 2 + 4 * (g1 - g2) ** 2 + 3 * (b1 - b2) ** 2);
}

export const CONTRAST_PALETTE = ["#dc2626", "#2563eb", "#16a34a", "#d97706", "#9333ea", "#0891b2"];
export const MIN_DISTANCE = 150;

/** Player 2's colour, moved to a palette colour when it is too close to player 1's. Player 1's is never moved. */
export function ensureContrast(c1: string, c2: string): string {
  if (colorDistance(c1, c2) >= MIN_DISTANCE) return c2;
  for (const alt of CONTRAST_PALETTE) {
    if (colorDistance(c1, alt) >= MIN_DISTANCE) return alt;
  }
  return CONTRAST_PALETTE[1]; // terminal fallback: blue
}

/** The three stat tables a comparison can come from. TE rows live in the WR table; FB counts as RB. */
export type CompareGroup = "QB" | "WR" | "RB";
export type ComparePlayerRow = QBSeasonStat | ReceiverSeasonStat | RBSeasonStat;
export type CompStat = {
  label: string;
  key: string;
  format: (v: number) => string;
  higherBetter: boolean;
  getValue?: (p: ComparePlayerRow) => number;
};

export const QB_COMP_STATS: CompStat[] = [
  // Radar axes
  { label: "EPA/DB", key: "epa_per_db", format: (v) => v.toFixed(2), higherBetter: true },
  { label: "CPOE", key: "cpoe", format: (v) => (v >= 0 ? "+" : "") + v.toFixed(1), higherBetter: true },
  { label: "aDOT", key: "adot", format: (v) => v.toFixed(1), higherBetter: true },
  { label: "Success%", key: "success_rate", format: (v) => (v * 100).toFixed(1) + "%", higherBetter: true },
  // Volume + efficiency
  { label: "Pass Yds", key: "passing_yards", format: (v) => v.toFixed(0), higherBetter: true },
  { label: "Pass TD", key: "touchdowns", format: (v) => v.toFixed(0), higherBetter: true },
  { label: "INT", key: "interceptions", format: (v) => v.toFixed(0), higherBetter: false },
  { label: "ANY/A", key: "any_a", format: (v) => v.toFixed(2), higherBetter: true },
  { label: "Rating", key: "passer_rating", format: (v) => v.toFixed(1), higherBetter: true },
  { label: "TD%", key: "td_pct", format: (v) => v.toFixed(1), higherBetter: true },
  { label: "INT%", key: "int_pct", format: (v) => v.toFixed(1), higherBetter: false },
  { label: "SK%", key: "sack_pct", format: (v) => v.toFixed(1), higherBetter: false },
  { label: "Total EPA", key: "total_epa", format: (v) => v.toFixed(1), higherBetter: true },
  { label: "Rush Yds", key: "rush_yards", format: (v) => v.toFixed(0), higherBetter: true },
  { label: "Rush TD", key: "rush_tds", format: (v) => v.toFixed(0), higherBetter: true },
  { label: "SCR%", key: "scramble_pct", format: (v) => v.toFixed(1), higherBetter: true },
  { label: "FPts", key: "fantasy_pts", format: (v) => v.toFixed(1), higherBetter: true,
    getValue: (p) => qbFantasyPoints(p as QBSeasonStat) },
  { label: "Games", key: "games", format: (v) => v.toFixed(0), higherBetter: true },
];

export const WR_COMP_STATS: CompStat[] = [
  // Radar axes
  { label: "EPA/Tgt", key: "epa_per_target", format: (v) => v.toFixed(2), higherBetter: true },
  { label: "CROE", key: "croe", format: (v) => (v >= 0 ? "+" : "") + (v * 100).toFixed(1) + "%", higherBetter: true },
  { label: "aDOT", key: "air_yards_per_target", format: (v) => v.toFixed(1), higherBetter: true },
  { label: "YAC/Rec", key: "yac_per_reception", format: (v) => v.toFixed(1), higherBetter: true },
  { label: "YPRR", key: "yards_per_route_run", format: (v) => v.toFixed(2), higherBetter: true },
  // Volume + rates
  { label: "Targets", key: "targets", format: (v) => v.toFixed(0), higherBetter: true },
  { label: "Receptions", key: "receptions", format: (v) => v.toFixed(0), higherBetter: true },
  { label: "Yards", key: "receiving_yards", format: (v) => v.toFixed(0), higherBetter: true },
  { label: "TDs", key: "receiving_tds", format: (v) => v.toFixed(0), higherBetter: true },
  { label: "Catch%", key: "catch_rate", format: (v) => (v * 100).toFixed(1) + "%", higherBetter: true },
  { label: "Tgt Share", key: "target_share", format: (v) => (v * 100).toFixed(1) + "%", higherBetter: true },
  { label: "AY%", key: "air_yards_share", format: (v) => (v * 100).toFixed(1) + "%", higherBetter: true },
  { label: "FPts (PPR)", key: "fantasy_pts", format: (v) => v.toFixed(1), higherBetter: true,
    getValue: (p) => wrFantasyPoints(p as ReceiverSeasonStat, "ppr") },
  { label: "Games", key: "games", format: (v) => v.toFixed(0), higherBetter: true },
];

export const RB_COMP_STATS: CompStat[] = [
  // Radar axes
  { label: "EPA/Car", key: "epa_per_carry", format: (v) => v.toFixed(2), higherBetter: true },
  { label: "Success%", key: "success_rate", format: (v) => (v * 100).toFixed(1) + "%", higherBetter: true },
  { label: "Stuff%", key: "stuff_rate", format: (v) => (v * 100).toFixed(1) + "%", higherBetter: false },
  { label: "Explosive%", key: "explosive_rate", format: (v) => (v * 100).toFixed(1) + "%", higherBetter: true },
  // Volume + efficiency
  { label: "Carries", key: "carries", format: (v) => v.toFixed(0), higherBetter: true },
  { label: "Rush Yds", key: "rushing_yards", format: (v) => v.toFixed(0), higherBetter: true },
  { label: "Rush TD", key: "rushing_tds", format: (v) => v.toFixed(0), higherBetter: true },
  { label: "YPC", key: "yards_per_carry", format: (v) => v.toFixed(1), higherBetter: true },
  { label: "TCH", key: "total_touches", format: (v) => v.toFixed(0), higherBetter: true },
  { label: "Total EPA", key: "total_rushing_epa", format: (v) => v.toFixed(1), higherBetter: true },
  { label: "FPts (PPR)", key: "fantasy_pts", format: (v) => v.toFixed(1), higherBetter: true,
    getValue: (p) => rbFantasyPoints(p as RBSeasonStat, "ppr") },
  { label: "Games", key: "games", format: (v) => v.toFixed(0), higherBetter: true },
];

/** A stat as a number, or NaN when the row does not hold a number there (null, undefined, the raw string "NaN"). */
export function getStatVal(player: ComparePlayerRow, key: string): number {
  const v = (player as unknown as Record<string, unknown>)[key];
  return typeof v === "number" ? v : NaN;
}

type GroupConfig = {
  radarKeys: readonly string[];
  radarAxes: { label: string }[];
  compStats: CompStat[];
  getRadarVal: (p: ComparePlayerRow, key: string) => number;
  /** WR/TE: an axis with no data is left out of the outline. QB/RB: it plots at the centre (0). */
  missingAxisIsGap: boolean;
};

const GROUPS: Record<CompareGroup, GroupConfig> = {
  QB: {
    radarKeys: QB_RADAR_KEYS, radarAxes: QB_RADAR_AXES, compStats: QB_COMP_STATS,
    getRadarVal: (p, k) => getQBRadarVal(p as QBSeasonStat, k),
    missingAxisIsGap: false,
  },
  WR: {
    radarKeys: WR_RADAR_KEYS, radarAxes: WR_RADAR_AXES, compStats: WR_COMP_STATS,
    getRadarVal: (p, k) => getWRRadarVal(p as ReceiverSeasonStat, k),
    missingAxisIsGap: true,
  },
  RB: {
    radarKeys: RB_RADAR_KEYS, radarAxes: RB_RADAR_AXES, compStats: RB_COMP_STATS,
    getRadarVal: (p, k) => getRBRadarVal(p as RBSeasonStat, k),
    missingAxisIsGap: false,
  },
};

export interface ComparisonPlayer {
  /** One percentile (0-100) per radar axis. Never NaN: a missing axis is 0 here and true in `missing`. */
  values: number[];
  /** True where the axis has no data and must be left out of the outline (WR/TE only today). */
  missing: boolean[];
  /** The colour this player is drawn in. */
  color: string;
}

export interface ComparisonTableRow {
  key: string;
  label: string;
  /** Player A's value as printed; an em dash when he has none. */
  a: string;
  /** Player B's value as printed; an em dash when he has none. */
  b: string;
  /** 1 = A has the better value, 2 = B, 0 = a tie or a missing value (no highlight). */
  winner: 0 | 1 | 2;
}

export interface Comparison {
  group: CompareGroup;
  axes: { label: string }[];
  a: ComparisonPlayer;
  b: ComparisonPlayer;
  rows: ComparisonTableRow[];
}

const NO_VALUE = "—";

function radarFor(cfg: GroupConfig, row: ComparePlayerRow, pool: ComparePlayerRow[]): { values: number[]; missing: boolean[] } {
  const values = computeRadarValues(cfg.radarKeys, cfg.getRadarVal, row, pool);
  const missing = cfg.missingAxisIsGap
    ? computeRadarValues(cfg.radarKeys, cfg.getRadarVal, row, pool, true).map((v) => Number.isNaN(v))
    : values.map(() => false);
  return { values, missing };
}

/**
 * Everything the Compare page shows for two players of one stat table: the
 * radar percentiles and which axes are missing, the two colours, and the stat
 * table (printed values and which side is better).
 *
 * `all` is the whole season table of the group. `teamA` / `teamB` are the team
 * ids the colours come from (the Compare page passes player_slugs'
 * current_team_id, as it always has).
 *
 * null, undefined and the raw string "NaN" all count as "no value", with one
 * known exception kept as it is (spec F12): a running back's stuff_rate of
 * null plots as a 0% stuff rate, while "NaN" plots at the centre.
 */
export function buildComparison(input: {
  group: CompareGroup;
  rowA: ComparePlayerRow;
  rowB: ComparePlayerRow;
  all: ComparePlayerRow[];
  teamA: string;
  teamB: string;
}): Comparison {
  const { group, rowA, rowB, all, teamA, teamB } = input;
  const cfg = GROUPS[group];

  // The pool step. PR 1: every row of the table, for both players.
  const poolA = all;
  const poolB = all;

  const colorA = getTeamColor(teamA);
  const colorB = ensureContrast(colorA, getTeamColor(teamB));

  const rows = cfg.compStats.map((stat): ComparisonTableRow => {
    const v1 = stat.getValue ? stat.getValue(rowA) : getStatVal(rowA, stat.key);
    const v2 = stat.getValue ? stat.getValue(rowB) : getStatVal(rowB, stat.key);
    const valid1 = !isNaN(v1);
    const valid2 = !isNaN(v2);
    let winner: 0 | 1 | 2 = 0;
    if (valid1 && valid2) {
      if (stat.higherBetter) winner = v1 > v2 ? 1 : v2 > v1 ? 2 : 0;
      else winner = v1 < v2 ? 1 : v2 < v1 ? 2 : 0;
    }
    return {
      key: stat.key,
      label: stat.label,
      a: valid1 ? stat.format(v1) : NO_VALUE,
      b: valid2 ? stat.format(v2) : NO_VALUE,
      winner,
    };
  });

  return {
    group,
    axes: cfg.radarAxes,
    a: { ...radarFor(cfg, rowA, poolA), color: colorA },
    b: { ...radarFor(cfg, rowB, poolB), color: colorB },
    rows,
  };
}
