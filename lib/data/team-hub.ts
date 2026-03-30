// lib/data/team-hub.ts
// Data utilities for the team hub page.
// Reuses getTeamStats from queries.ts for the "all teams" fetch.

import { getTeamStats, getQBStats, getDataFreshness, getAvailableSeasons } from "@/lib/data/queries";
import { getReceiverStats } from "@/lib/data/receivers";
import { getRBGapStats, getDefGapStats } from "@/lib/data/run-gaps";
import { getAllPlayerSlugs } from "@/lib/data/players";
import { createServerClient } from "@/lib/supabase/server";
import { parseNumericFields } from "@/lib/utils";
import type {
  TeamSeasonStat,
  QBSeasonStat,
  ReceiverSeasonStat,
  RBGapStat,
  DefGapStat,
  TeamDownDistanceStat,
  TeamSituationalStat,
  DataFreshness,
} from "@/lib/types";

const DD_NUMERIC = ["carries", "epa_per_carry", "success_rate", "yards_per_carry", "stuff_rate", "explosive_rate"] as const;
const SIT_NUMERIC = ["plays", "epa_per_play", "success_rate", "pass_rate", "rush_epa_per_play", "pass_epa_per_play", "rush_success_rate", "pass_success_rate"] as const;

export interface TeamHubData {
  teamStats: TeamSeasonStat | null;
  allTeamStats: TeamSeasonStat[];
  teamQBs: QBSeasonStat[];
  teamReceivers: ReceiverSeasonStat[];
  teamRBGaps: RBGapStat[];
  teamDefGaps: DefGapStat[];
  downDistanceStats: TeamDownDistanceStat[];
  downDistanceNFL: TeamDownDistanceStat[];
  situationalStats: TeamSituationalStat[];
  allSituationalStats: TeamSituationalStat[];
  slugMap: Record<string, string>;
  freshness: DataFreshness | null;
  seasons: number[];
  currentSeason: number;
}

async function getDownDistanceStats(season: number, teamId: string): Promise<{ team: TeamDownDistanceStat[]; nfl: TeamDownDistanceStat[] }> {
  const supabase = createServerClient();
  const { data } = await supabase
    .from("team_down_distance_stats")
    .select("*")
    .eq("season", season)
    .in("team_id", [teamId, "NFL"]);
  if (!data) return { team: [], nfl: [] };
  const parsed = data.map((r: Record<string, unknown>) => parseNumericFields<TeamDownDistanceStat>(r as unknown as TeamDownDistanceStat, DD_NUMERIC as unknown as string[]));
  return {
    team: parsed.filter((r) => r.team_id === teamId),
    nfl: parsed.filter((r) => r.team_id === "NFL"),
  };
}

async function getSituationalStats(season: number): Promise<TeamSituationalStat[]> {
  const supabase = createServerClient();
  const { data } = await supabase
    .from("team_situational_stats")
    .select("*")
    .eq("season", season);
  if (!data) return [];
  return data.map((r: Record<string, unknown>) => parseNumericFields<TeamSituationalStat>(r as unknown as TeamSituationalStat, SIT_NUMERIC as unknown as string[]));
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
    ddResult,
    allSitStats,
    slugs,
    freshness,
    seasons,
  ] = await Promise.all([
    getTeamStats(season).catch(() => []),
    getQBStats(season).catch(() => []),
    getReceiverStats(season).catch(() => []),
    getRBGapStats(season, teamId).catch(() => []),
    getDefGapStats(season, teamId).catch(() => []),
    getDownDistanceStats(season, teamId).catch(() => ({ team: [], nfl: [] })),
    getSituationalStats(season).catch(() => []),
    getAllPlayerSlugs().catch(() => []),
    getDataFreshness(season).catch(() => null),
    getAvailableSeasons().catch(() => [season]),
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
    downDistanceStats: ddResult.team,
    downDistanceNFL: ddResult.nfl,
    situationalStats: allSitStats.filter((s) => s.team_id === teamId),
    allSituationalStats: allSitStats.filter((s) => s.team_id !== "NFL"),
    slugMap,
    freshness,
    seasons,
    currentSeason: season,
  };
}
