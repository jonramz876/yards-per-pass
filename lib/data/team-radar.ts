// lib/data/team-radar.ts — the server-side read for the team radar (team radar
// spec 2026-10-06 §3.2, §6). Imports the Supabase-backed helpers: never import
// this module from a "use client" file. The pure aggregator, the state
// function and the copy live in lib/stats/team-radar.ts.
import { parseNumericFields } from "@/lib/utils";
import { fetchAllRows, queryError } from "@/lib/data/utils";
import { TEAM_GAME_NUMERIC, boxScoreDeadline } from "@/lib/data/box-score";
import type { TeamGameStat } from "@/lib/types";

/**
 * The 17 columns the radar reads. Its own list, not TEAM_STATS_COLUMNS: the
 * Team Stats page does not read these five extra columns and its golden
 * fixtures stay frozen. `designed_runs` and `stuffed_runs` exist in production
 * since team radar PR 1; PostgREST rejects a select naming an unknown column,
 * so never add a column here before it exists in the live table.
 */
export const TEAM_RADAR_COLUMNS = [
  "game_id", "team_id", "opponent_id", "season", "week",
  "pass_plays", "rush_plays", "pass_success_rate", "rush_success_rate",
  "explosive_pass", "explosive_rush", "attempts", "sacks", "turnovers", "total_drives",
  "designed_runs", "stuffed_runs",
] as const;

export type TeamRadarGameRow = Pick<TeamGameStat, (typeof TEAM_RADAR_COLUMNS)[number]>;

/**
 * The NUMERIC columns among the ones selected (pass_success_rate and
 * rush_success_rate). Only these: parseNumericFields adds every listed field
 * that is undefined as null, so the full list would bolt nulls onto fields the
 * read never selected (review M1).
 */
const TEAM_RADAR_NUMERIC = TEAM_GAME_NUMERIC.filter((c) => (TEAM_RADAR_COLUMNS as readonly string[]).includes(c));

/**
 * Every team's team_game_stats rows for one season: all of them, because a
 * team's ranks need the other 31. One read per team-page view (at most 544
 * narrow rows), ordered so paging is stable, under a deadline.
 *
 * Throws an Error when the read fails (read resilience rule: a failed read
 * never looks like an empty one) and returns [] when it succeeds with no
 * rows. What an empty season means is decided by teamRadarState, not here.
 *
 * `signal` is optional so a caller with its own read limit can pass it; with
 * none, the read gets the box score's 5 s deadline.
 */
export async function getTeamRadarRows(
  season: number,
  options: { signal?: AbortSignal } = {}
): Promise<TeamRadarGameRow[]> {
  let raw: Record<string, unknown>[];
  try {
    raw = await fetchAllRows(
      "team_game_stats",
      TEAM_RADAR_COLUMNS.join(","),
      { season },
      { signal: options.signal ?? boxScoreDeadline(), order: ["game_id", "team_id"] }
    );
  } catch (err) {
    // fetchAllRows rejects with the raw PostgREST object; make it a real Error.
    throw queryError(`team radar rows for ${season}`, err);
  }
  return raw.map((r) => parseNumericFields(r, TEAM_RADAR_NUMERIC) as unknown as TeamRadarGameRow);
}
