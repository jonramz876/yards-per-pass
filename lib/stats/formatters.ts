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
