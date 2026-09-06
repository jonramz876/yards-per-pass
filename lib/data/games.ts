// lib/data/games.ts
// Schedule + results for one team-season, from the `games` table
// (nflverse schedules; see ingest_schedules in scripts/ingest.py).
import { createServerClient } from "@/lib/supabase/server";
import type { TeamGame } from "@/lib/types";

/** Raw shape of a `games` row before per-team fields are derived. */
interface GameRow {
  game_id: string;
  season: number;
  game_type: string | null;
  week: number | null;
  gameday: string | null;
  weekday: string | null;
  gametime: string | null;
  home_team: string;
  away_team: string;
  home_score: number | null;
  away_score: number | null;
}

/**
 * Scores stay NULL (not NaN) here on purpose — `played` is "both scores
 * present", so parseNumericFields' null → NaN convention would erase the one
 * signal that separates a future game from a 0-0 one.
 */
function score(v: unknown): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function toTeamGame(row: GameRow, teamId: string): TeamGame {
  const isHome = row.home_team === teamId;
  const homeScore = score(row.home_score);
  const awayScore = score(row.away_score);
  const teamScore = isHome ? homeScore : awayScore;
  const oppScore = isHome ? awayScore : homeScore;
  const played = teamScore !== null && oppScore !== null;

  let result: TeamGame["result"] = null;
  if (played) {
    result = teamScore! > oppScore! ? "W" : teamScore! < oppScore! ? "L" : "T";
  }

  return {
    game_id: row.game_id,
    season: row.season,
    game_type: row.game_type ?? "REG",
    week: row.week ?? 0,
    gameday: row.gameday ?? null,
    weekday: row.weekday ?? null,
    gametime: row.gametime ?? null,
    home_team: row.home_team,
    away_team: row.away_team,
    home_score: homeScore,
    away_score: awayScore,
    opponent_id: isHome ? row.away_team : row.home_team,
    home_away: isHome ? "home" : "away",
    played,
    result,
    team_score: teamScore,
    opponent_score: oppScore,
  };
}

/**
 * Every game a team plays in a season — past and future — in week order.
 * Playoff rows (weeks 19+) sort naturally after the regular season.
 */
export async function getTeamSchedule(
  teamId: string,
  season: number
): Promise<TeamGame[]> {
  const supabase = createServerClient();
  // .or() takes a raw PostgREST filter string, so the id is interpolated, not
  // bound — team codes are alphanumeric, and anything else is stripped.
  const safeId = teamId.replace(/[^A-Za-z0-9]/g, "");
  const { data, error } = await supabase
    .from("games")
    .select("*")
    .eq("season", season)
    .or(`home_team.eq.${safeId},away_team.eq.${safeId}`)
    .order("week", { ascending: true })
    .order("gameday", { ascending: true });

  if (error) throw new Error(`Failed to fetch schedule: ${error.message}`);
  if (!data) return [];

  // Derive against the same id the query filtered on, so home/away can't flip.
  return (data as unknown as GameRow[]).map((row) => toTeamGame(row, safeId));
}
