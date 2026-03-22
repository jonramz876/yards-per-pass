/**
 * Shared percentile/rank utilities used by QB, Receiver, and RB stat cards + leaderboards.
 */
import type React from "react";

/** Compute the percentile (0–100) of `value` within `allValues`. */
export function computePercentile(allValues: number[], value: number): number {
  if (isNaN(value) || allValues.length === 0) return 0;
  const rank = allValues.filter((v) => v < value).length;
  return (rank / allValues.length) * 100;
}

/** Compute 1-based rank (1 = best/highest) of `value` within `allValues`. */
export function computeRank(allValues: number[], value: number): number {
  if (isNaN(value)) return allValues.length;
  return allValues.filter((v) => v > value).length + 1;
}

/** Convert a number to its ordinal string (1st, 2nd, 3rd, 4th, …). */
export function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

/** Return a color hex string based on rank within a group:
 *  - Top 10% → green (#16a34a)
 *  - Bottom 10% → red (#dc2626)
 *  - Middle → dark slate (#1e293b)
 */
export function chipColor(rank: number, total: number): string {
  if (rank <= Math.ceil(total * 0.1)) return "#16a34a";
  if (rank > total - Math.ceil(total * 0.1)) return "#dc2626";
  return "#1e293b";
}

/** Leaderboard heatmap percentile: returns -1 for NaN/empty (sentinel for "no styling"). */
export function getHeatmapPercentile(sortedValues: number[], value: number): number {
  if (isNaN(value) || sortedValues.length === 0) return -1;
  const rank = sortedValues.filter((v) => v < value).length;
  return (rank / sortedValues.length) * 100;
}

/** Conditional cell styling based on percentile tier. Supports inverted columns (lower = better). */
export function getHeatmapStyle(percentile: number, inverted: boolean = false): React.CSSProperties {
  if (percentile < 0) return {};
  const p = inverted ? 100 - percentile : percentile;
  if (p >= 90)
    return { background: "rgba(34,197,94,0.25)", color: "#15803d", fontWeight: 600 };
  if (p >= 75)
    return { background: "rgba(34,197,94,0.12)", color: "#16a34a" };
  if (p <= 10)
    return { background: "rgba(239,68,68,0.25)", color: "#dc2626", fontWeight: 600 };
  if (p <= 25)
    return { background: "rgba(239,68,68,0.12)", color: "#dc2626" };
  return {};
}
