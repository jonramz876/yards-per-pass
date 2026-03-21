/**
 * Shared percentile/rank utilities used by QB, Receiver, and RB stat cards.
 */

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
