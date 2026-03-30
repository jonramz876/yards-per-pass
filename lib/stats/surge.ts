/**
 * Stat Surge Detector — z-score-based breakout/collapse detection.
 * Pure computation — no database dependencies.
 */

export interface WeeklyValue {
  playerId: string;
  playerName: string;
  teamId: string;
  position: string;
  slug: string;
  weeks: { week: number; value: number }[];
}

export interface SurgeEntry {
  playerId: string;
  playerName: string;
  teamId: string;
  position: string;
  slug: string;
  zScore: number;
  seasonAvg: number;
  recentAvg: number;
  delta: number;
  weeks: { week: number; value: number }[];
}

export interface SurgeResult {
  rising: SurgeEntry[];
  falling: SurgeEntry[];
}

export interface SurgeOptions {
  window: number;    // number of recent weeks to average (e.g. 4)
  minGames: number;  // minimum total games to be eligible (e.g. 6)
  threshold: number; // z-score threshold (e.g. 1.5)
}

/**
 * Compute z-score of the last `window` values vs the full array.
 * Returns 0 if insufficient data or zero variance.
 */
export function computeZScore(values: number[], window: number, minGames = 6): number {
  if (values.length < minGames || values.length < window + 2) return 0;

  const n = values.length;
  const mean = values.reduce((a, b) => a + b, 0) / n;
  const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / n;
  const stdev = Math.sqrt(variance);

  if (stdev === 0) return 0;

  const recentSlice = values.slice(-window);
  const recentMean = recentSlice.reduce((a, b) => a + b, 0) / recentSlice.length;

  return (recentMean - mean) / stdev;
}

/**
 * Detect surging and collapsing players from weekly values.
 * Returns entries sorted by absolute z-score descending.
 */
export function detectSurges(
  players: WeeklyValue[],
  options: SurgeOptions,
): SurgeResult {
  const { window, minGames, threshold } = options;
  const rising: SurgeEntry[] = [];
  const falling: SurgeEntry[] = [];

  for (const player of players) {
    const sorted = [...player.weeks].sort((a, b) => a.week - b.week);
    const values = sorted.map((w) => w.value);

    const z = computeZScore(values, window, minGames);
    if (Math.abs(z) < threshold) continue;

    const seasonAvg = values.reduce((a, b) => a + b, 0) / values.length;
    const recentSlice = values.slice(-window);
    const recentAvg = recentSlice.reduce((a, b) => a + b, 0) / recentSlice.length;

    const entry: SurgeEntry = {
      playerId: player.playerId,
      playerName: player.playerName,
      teamId: player.teamId,
      position: player.position,
      slug: player.slug,
      zScore: z,
      seasonAvg,
      recentAvg,
      delta: recentAvg - seasonAvg,
      weeks: sorted,
    };

    if (z >= threshold) rising.push(entry);
    else falling.push(entry);
  }

  rising.sort((a, b) => b.zScore - a.zScore);
  falling.sort((a, b) => a.zScore - b.zScore);

  return { rising, falling };
}
