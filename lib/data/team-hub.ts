// lib/data/team-hub.ts
// Data utilities for the team hub page.
// Reuses getTeamStats from queries.ts for the "all teams" fetch.

import { getTeamStats, getQBStats, getDataFreshness, getAvailableSeasons } from "@/lib/data/queries";
import { getReceiverStats } from "@/lib/data/receivers";
import { getRBGapStats, getDefGapStats } from "@/lib/data/run-gaps";
import { getAllPlayerSlugs } from "@/lib/data/players";
import type {
  TeamSeasonStat,
  QBSeasonStat,
  ReceiverSeasonStat,
  RBGapStat,
  DefGapStat,
  DataFreshness,
} from "@/lib/types";

export interface TeamHubData {
  teamStats: TeamSeasonStat | null;
  allTeamStats: TeamSeasonStat[];
  teamQBs: QBSeasonStat[];
  teamReceivers: ReceiverSeasonStat[];
  teamRBGaps: RBGapStat[];
  teamDefGaps: DefGapStat[];
  slugMap: Record<string, string>;
  freshness: DataFreshness | null;
  seasons: number[];
  currentSeason: number;
}

/**
 * Fetch all data needed for a team hub page in parallel.
 * Filters QB/receiver/RB data to the specified team.
 */
export async function getTeamHubData(
  teamId: string,
  season: number
): Promise<TeamHubData> {
  const [
    allTeamStats,
    allQBs,
    allReceivers,
    teamRBGaps,
    teamDefGaps,
    slugs,
    freshness,
    seasons,
  ] = await Promise.all([
    getTeamStats(season),
    getQBStats(season),
    getReceiverStats(season),
    getRBGapStats(season, teamId),
    getDefGapStats(season, teamId),
    getAllPlayerSlugs(),
    getDataFreshness(season),
    getAvailableSeasons(),
  ]);

  const teamStats = allTeamStats.find((t) => t.team_id === teamId) ?? null;
  const teamQBs = allQBs.filter((qb) => qb.team_id === teamId);
  const teamReceivers = allReceivers.filter((r) => r.team_id === teamId);
  const slugMap = Object.fromEntries(slugs.map((s) => [s.player_id, s.slug]));

  return {
    teamStats,
    allTeamStats,
    teamQBs,
    teamReceivers,
    teamRBGaps,
    teamDefGaps,
    slugMap,
    freshness,
    seasons,
    currentSeason: season,
  };
}
