// lib/stats/fantasy.ts — Fantasy points scoring utility

export type ScoringFormat = "ppr" | "half" | "std";

const PPR_BONUS: Record<ScoringFormat, number> = { ppr: 1.0, half: 0.5, std: 0 };

export function qbFantasyPoints(stats: {
  passing_yards: number; touchdowns: number; interceptions: number;
  rush_yards?: number; rush_tds?: number; fumbles_lost?: number;
}): number {
  return (
    (stats.passing_yards || 0) / 25 +
    (stats.touchdowns || 0) * 4 +
    (stats.interceptions || 0) * -2 +
    (stats.rush_yards || 0) / 10 +
    (stats.rush_tds || 0) * 6 +
    (stats.fumbles_lost || 0) * -1
  );
}

export function wrFantasyPoints(
  stats: { receiving_yards: number; receiving_tds: number; receptions: number; fumbles_lost?: number },
  format: ScoringFormat = "ppr"
): number {
  return (
    (stats.receiving_yards || 0) / 10 +
    (stats.receiving_tds || 0) * 6 +
    (stats.receptions || 0) * PPR_BONUS[format] +
    (stats.fumbles_lost || 0) * -1
  );
}

export function rbFantasyPoints(
  stats: {
    rushing_yards: number; rushing_tds: number;
    receiving_yards?: number; receiving_tds?: number;
    receptions?: number; fumbles_lost?: number;
  },
  format: ScoringFormat = "ppr"
): number {
  return (
    (stats.rushing_yards || 0) / 10 +
    (stats.rushing_tds || 0) * 6 +
    (stats.receiving_yards || 0) / 10 +
    (stats.receiving_tds || 0) * 6 +
    (stats.receptions || 0) * PPR_BONUS[format] +
    (stats.fumbles_lost || 0) * -1
  );
}
