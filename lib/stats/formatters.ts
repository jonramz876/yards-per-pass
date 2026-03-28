/**
 * Shared stat formatting utilities used by stat card modals.
 *
 * Each stat card has its own formatChipValue function because the stat keys
 * and formatting rules differ per position. This module provides shared
 * helpers for common formatting patterns.
 */

/** Format a rate (0–1) as a percentage string, e.g. 0.876 → "87.6%". */
export function formatRate(val: number, decimals = 1): string {
  if (isNaN(val)) return "\u2014";
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
    // Already percentage-scale (1 decimal)
    case "completion_pct":
    case "passer_rating":
    case "td_pct":
    case "int_pct":
    case "sack_pct":
    case "scramble_pct":
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
