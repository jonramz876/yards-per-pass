/**
 * Shared stat formatting utilities used by stat card modals.
 *
 * Each stat card has its own formatChipValue function because the stat keys
 * and formatting rules differ per position. This module provides shared
 * helpers for common formatting patterns.
 */

import type { QBSeasonStat, RBSeasonStat, ReceiverSeasonStat } from "@/lib/types";

/** Format a rate (0–1) as a percentage string, e.g. 0.876 → "87.6%". */
export function formatRate(val: number, decimals = 1): string {
  // isFinite, not isNaN: a rate of Infinity would otherwise render "Infinity%".
  if (!Number.isFinite(val)) return "\u2014";
  return (val * 100).toFixed(decimals) + "%";
}

/** Format a per-play stat to 2 decimal places. */
export function formatPerPlay(val: number): string {
  if (isNaN(val)) return "\u2014";
  return val.toFixed(2);
}

/** Format a stat to 1 decimal place (e.g. yards, ADOT). */
export function formatOneDecimal(val: number): string {
  if (isNaN(val)) return "\u2014";
  return val.toFixed(1);
}

/** The em-dash used as a placeholder for missing values. */
export const EM_DASH = "\u2014";

/**
 * Canonical 6-step EPA background color scale.
 * Maps an EPA value to a hex color string for heatmaps, bars, and diagrams.
 */
export function epaColor(epa: number): string {
  if (isNaN(epa)) return "#f3f4f6";
  if (epa >= 0.10) return "#22c55e";  // strong green
  if (epa >= 0.05) return "#4ade80";  // green
  if (epa >= 0.02) return "#86efac";  // light green
  if (epa >= -0.02) return "#fbbf24"; // amber (neutral)
  if (epa >= -0.05) return "#fca5a5"; // light red
  return "#ef4444";                    // red
}

/**
 * EPA text color as Tailwind class — for leaderboard tables & dashboards.
 */
export function epaTextColor(epa: number): string {
  if (isNaN(epa)) return "text-gray-400";
  if (epa >= 0.02) return "text-green-700";
  if (epa >= -0.02) return "text-amber-600";
  return "text-red-600";
}

/**
 * Contrast text color (hex) for overlaying text on epaColor backgrounds.
 * Returns white for the two darkest tiers, dark gray for the rest.
 */
export function epaContrastColor(epa: number): string {
  if (isNaN(epa)) return "#9ca3af";
  if (epa >= 0.10 || epa < -0.05) return "#ffffff";
  return "#1f2937";
}

/* ─── Player EPA colour: against the season's league average ─── */
//
// A player's EPA is coloured against the league average for the same kind of
// play that season, never against zero: the average running-back carry is
// below zero (2026: about -0.10 EPA) and the average target well above it
// (+0.23), so a sign split painted most backs red and most receivers green.
// Used by the QB, RB and receiver leaderboards, the Game Log and the run-gap
// player cards (spec A §4.1). The box score's player tables are uncoloured
// until that page reads season averages (lib/stats/box-score.ts).

/** Half-width of the grey "about average" band, in EPA per play. */
export const EPA_BAND = { carry: 0.03, dropback: 0.03, play: 0.03, target: 0.06, qbRush: 0.06 } as const;

/** Plays a season needs before its average is used (about half a normal week). */
export const EPA_AVERAGE_MIN_PLAYS = { carry: 350, dropback: 600, play: 600, target: 500, qbRush: 60 } as const;

function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

/**
 * Σ(rate × volume) / Σ volume over rows whose rate is finite and volume > 0;
 * null when Σ volume < minPlays (or no rows). Never NaN.
 */
export function leagueEpaAverage<T>(
  rows: T[],
  rate: (r: T) => number | null | undefined,
  volume: (r: T) => number | null | undefined,
  minPlays: number,
): number | null {
  let sum = 0;
  let plays = 0;
  for (const row of rows ?? []) {
    const x = rate(row);
    const n = volume(row);
    if (!isFiniteNumber(x) || !isFiniteNumber(n) || n <= 0) continue;
    sum += x * n;
    plays += n;
  }
  if (plays <= 0 || plays < minPlays) return null;
  const avg = sum / plays;
  return Number.isFinite(avg) ? avg : null;
}

/** League EPA per RB carry: epa_per_carry weighted by carries, every row of rb_season_stats. */
export function rbCarryEpaAverage(rbs: RBSeasonStat[]): number | null {
  return leagueEpaAverage(rbs, (r) => r.epa_per_carry, (r) => r.carries, EPA_AVERAGE_MIN_PLAYS.carry);
}

/** League EPA per target: epa_per_target weighted by targets, every row (WR, TE, RB, FB). */
export function targetEpaAverage(recs: ReceiverSeasonStat[]): number | null {
  return leagueEpaAverage(recs, (r) => r.epa_per_target, (r) => r.targets, EPA_AVERAGE_MIN_PLAYS.target);
}

/**
 * QB play count behind epa_per_play: dropbacks + rushes − scrambles (a scramble
 * is both). scramble_pct is 0–100; a missing rate counts as no scrambles, as in
 * lib/stats/tecmo-card.ts.
 */
function qbPlays(q: QBSeasonStat): number {
  const scramblePct = isFiniteNumber(q.scramble_pct) ? q.scramble_pct : 0;
  return q.dropbacks + q.rush_attempts - (scramblePct / 100) * q.dropbacks;
}

/** League QB averages: per dropback (EPA/DB, Total EPA), per play (EPA/Play), per QB rush (Rush EPA). */
export function qbEpaAverages(qbs: QBSeasonStat[]): {
  dropback: number | null;
  play: number | null;
  qbRush: number | null;
} {
  return {
    dropback: leagueEpaAverage(qbs, (q) => q.epa_per_db, (q) => q.dropbacks, EPA_AVERAGE_MIN_PLAYS.dropback),
    play: leagueEpaAverage(qbs, (q) => q.epa_per_play, qbPlays, EPA_AVERAGE_MIN_PLAYS.play),
    qbRush: leagueEpaAverage(qbs, (q) => q.rush_epa_per_play, (q) => q.rush_attempts, EPA_AVERAGE_MIN_PLAYS.qbRush),
  };
}

/**
 * Float slack for the band edges, so a value exactly `band` from the average
 * (e.g. -0.13 against -0.10 ± 0.03, which is -0.030000000000000013 in
 * floating point) stays grey as the rule says.
 */
const BAND_EPSILON = 1e-9;

/**
 * Text colour for a player EPA rate against the league average.
 * Not a finite number → grey-400 (the dash); no average yet → grey-700 (no
 * colour); more than `band` above → green; more than `band` below → red;
 * otherwise, boundaries included → grey-700.
 */
export function epaVsAverageClass(
  value: number | null | undefined,
  average: number | null | undefined,
  band: number,
): string {
  if (!isFiniteNumber(value)) return "text-gray-400";
  if (!isFiniteNumber(average)) return "text-gray-700";
  const diff = value - average;
  if (diff > band + BAND_EPSILON) return "text-green-600";
  if (diff < -band - BAND_EPSILON) return "text-red-600";
  return "text-gray-700";
}

/**
 * Unified stat formatter used by all leaderboard tables and NFL AVG rows.
 * Merges QB, receiver, and RB formatting into a single function.
 */
export function formatStat(key: string, val: number): string {
  if (val == null || isNaN(val)) return EM_DASH;
  switch (key) {
    // EPA / per-play / advanced (2 decimals)
    case "epa_per_play":
    case "epa_per_db":
    case "cpoe":
    case "adot":
    case "ypa":
    case "any_a":
    case "rush_epa_per_play":
    case "total_epa":
    case "epa_per_target":
    case "yards_per_target":
    case "yac_per_reception":
    case "air_yards_per_target":
    case "yards_per_route_run":
    case "targets_per_route_run":
    case "total_receiving_epa":
    case "epa_per_carry":
    case "yards_per_carry":
    case "total_rushing_epa":
      return val.toFixed(2);
    // CROE (signed percentage)
    case "croe": {
      const pct = (val * 100).toFixed(1);
      return (val >= 0 ? "+" : "") + pct + "%";
    }
    // Rates stored as 0–1 → percentage
    case "success_rate":
    case "catch_rate":
    case "target_share":
    case "snap_share":
    case "route_participation_rate":
    case "air_yards_share":
    case "receiving_success_rate":
    case "stuff_rate":
    case "explosive_rate":
      return (val * 100).toFixed(1) + "%";
    // Already percentage-scale with % symbol
    case "completion_pct":
    case "td_pct":
    case "int_pct":
    case "sack_pct":
    case "scramble_pct":
      return val.toFixed(1) + "%";
    // Passer rating (no %)
    case "passer_rating":
      return val.toFixed(1);
    // TD:INT ratio
    case "td_int_ratio":
      return val === Infinity ? "\u221E" : val.toFixed(1) + ":1";
    // Per-game and general 1-decimal stats
    case "yards_per_game":
    case "tds_per_game":
    case "carries_per_game":
    case "touches_per_game":
    case "yards_per_reception":
      return val.toFixed(1);
    // Fantasy points
    case "fantasy_pts":
    case "half_pts":
    case "std_pts":
    case "pts_per_game":
      return val.toFixed(1);
    default:
      return Number.isInteger(val) ? val.toString() : val.toFixed(1);
  }
}

/** Text colors paired with a solid background by textColorForBackground. */
const LIGHT_TEXT = "#ffffff";
const DARK_TEXT = "#0f172a"; // slate-900, WCAG relative luminance 0.008815

/**
 * Luminance crossover between LIGHT_TEXT and DARK_TEXT.
 *
 * Contrast ratio is (Lmax + 0.05) / (Lmin + 0.05), so the two text colors are
 * equally readable when 1.05 / (L + 0.05) === (L + 0.05) / (0.008815 + 0.05),
 * i.e. L = sqrt(1.05 * 0.058815) - 0.05 = 0.1985. Above it dark text wins.
 *
 * Note this is NOT the familiar 0.179 crossover, which assumes pure black text.
 */
const LUMINANCE_CROSSOVER = 0.1985;

/** Convert one 0–255 sRGB channel to its linear-light value (WCAG 2.x). */
function linearizeChannel(channel: number): number {
  const s = channel / 255;
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

/**
 * WCAG relative luminance → readable text color for a solid background.
 *
 * Uses sRGB-linearized luminance rather than a raw weighted average of the
 * 0–255 channels: the naive version misjudges saturated mid-tones, calling
 * CIN/DEN orange (#FB4F14) dark when white text on it only reaches a 3.37
 * contrast ratio versus 5.30 for dark text. Verified against all 32 team
 * primary + secondary colors in lib/data/teams.ts — this picks the
 * higher-contrast option for every one of them.
 *
 * Malformed or missing input falls back to white text, matching the dark
 * neutral used when a team color is unavailable.
 */
export function textColorForBackground(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || "");
  if (!m) return LIGHT_TEXT;
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  const lum =
    0.2126 * linearizeChannel(r) +
    0.7152 * linearizeChannel(g) +
    0.0722 * linearizeChannel(b);
  return lum > LUMINANCE_CROSSOVER ? DARK_TEXT : LIGHT_TEXT;
}
