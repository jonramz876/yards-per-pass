// lib/data/team-stats.ts — the server-side read for /team-stats (team stats
// spec 2026-09-28 §2.2). Imports the Supabase-backed helpers: never import
// this module from a "use client" file. The pure aggregator and presentation
// pieces live in lib/stats/team-stats.ts.
import { parseNumericFields } from "@/lib/utils";
import { fetchAllRows } from "@/lib/data/utils";
import { TEAM_GAME_NUMERIC, boxScoreDeadline, getBoxScoreSeasonsCached } from "@/lib/data/box-score";
import type { TeamGameStat } from "@/lib/types";

/** The columns the page reads — not "*": 30 of team_game_stats' 62 columns. */
export const TEAM_STATS_COLUMNS = [
  "game_id", "team_id", "opponent_id", "season", "week",
  "plays", "pass_plays", "rush_plays", "early_plays", "late_plays",
  "epa_per_play", "success_rate", "first_down_rate",
  "pass_epa_per_play", "pass_success_rate", "pass_first_down_rate",
  "rush_epa_per_play", "rush_success_rate", "rush_first_down_rate",
  "early_epa_per_play", "early_success_rate", "late_epa_per_play", "late_success_rate",
  "explosive_plays", "explosive_pass", "explosive_rush",
  "turnovers", "epa_lost_turnovers", "epa_lost_sacks", "epa_lost_penalties",
] as const;

export type TeamStatsGameRow = Pick<TeamGameStat, (typeof TEAM_STATS_COLUMNS)[number]>;

/**
 * The NUMERIC columns among the ones selected. Only these: parseNumericFields
 * adds every listed field that is undefined as null, so the full list would
 * bolt explosive_rate and yards_per_* onto rows that never selected them.
 */
const TEAM_STATS_NUMERIC = TEAM_GAME_NUMERIC.filter((c) => (TEAM_STATS_COLUMNS as readonly string[]).includes(c));

export type TeamStatsSeason =
  | { state: "ready"; rows: TeamStatsGameRow[] }
  | { state: "uncovered"; firstSeason: number | null };

/**
 * One season's team_game_stats rows, or why there are none.
 *
 * `seasons` is getAvailableSeasons() (data_freshness, newest first). An empty
 * read throws when it can only mean a broken read (J4): no seasons at all
 * (getAvailableSeasons swallows its own error into []), the newest season
 * (its rows and its data_freshness row are written in one transaction), or a
 * season the box score probe says has rows. Every other empty season is a
 * message page.
 */
export async function getTeamStatsSeason(season: number, seasons: number[]): Promise<TeamStatsSeason> {
  let raw: Record<string, unknown>[];
  try {
    raw = await fetchAllRows(
      "team_game_stats",
      TEAM_STATS_COLUMNS.join(","),
      { season },
      { signal: boxScoreDeadline(), order: ["game_id", "team_id"] }
    );
  } catch (err) {
    // fetchAllRows rejects with the raw PostgREST object; make it a real Error
    // so error.tsx and the logs get a message (lib/data/games.ts:292-303).
    const e = err as { message?: unknown } | null;
    const message = typeof e?.message === "string" ? e.message : JSON.stringify(err);
    throw new Error(`Failed to fetch team_game_stats for ${season}: ${message}`);
  }

  if (raw.length > 0) {
    const rows = raw.map((r) => parseNumericFields(r, TEAM_STATS_NUMERIC) as unknown as TeamStatsGameRow);
    return { state: "ready", rows };
  }

  if (seasons.length === 0) {
    throw new Error("Team stats: no seasons from data_freshness (query failed or table empty)");
  }
  if (season === seasons[0]) {
    throw new Error(
      `Team stats: ${season} is the newest season in data_freshness but has no team_game_stats rows; the read is failing silently`
    );
  }
  const covered = await getBoxScoreSeasonsCached(seasons);
  if (covered.includes(season)) {
    throw new Error(
      `Team stats: team_game_stats has rows for ${season} but the season read returned none; the read is failing silently`
    );
  }
  const first = covered.length > 0 ? Math.min(...covered) : null;
  return { state: "uncovered", firstSeason: first !== null && season < first ? first : null };
}
