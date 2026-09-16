// lib/data/games.ts
// Schedule + results for one team-season, from the `games` table
// (nflverse schedules; see ingest_schedules in scripts/ingest.py).
import { createServerClient } from "@/lib/supabase/server";
import type { TeamGame, GameResultsByTeam } from "@/lib/types";

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

/**
 * Final scores of the regular-season games a set of teams played in one
 * season, keyed by team then week: `results["TEN"][5]`. Feeds the player Game
 * Log (box score spec §9). `games` holds the official final score; a weekly
 * stat row's own team_score/opponent_score miss any points scored after the
 * game's last run or pass (31 of 2025's 272 games).
 *
 * Pass every team the player's weekly rows name: a traded player's rows span
 * teams, and his current team is not the one he played for. A team plays at
 * most 17 regular-season games, so even a three-team player stays far under
 * Supabase's 1000-row cap — no pagination. Games without both scores are left
 * out. Throws on a query error; the caller picks the fallback.
 */
export async function getGameResults(
  teamIds: string[],
  season: number
): Promise<GameResultsByTeam> {
  // Same sanitising as getTeamSchedule: the ids go into a raw .or() filter.
  const ids = Array.from(
    new Set(
      teamIds
        .map((id) => String(id ?? "").replace(/[^A-Za-z0-9]/g, ""))
        .filter((id) => id.length > 0)
    )
  );
  if (ids.length === 0) return {};

  const supabase = createServerClient();
  const list = ids.join(",");
  const { data, error } = await supabase
    .from("games")
    .select("*")
    .eq("season", season)
    .or(`home_team.in.(${list}),away_team.in.(${list})`);

  if (error) throw new Error(`Failed to fetch game results: ${error.message}`);

  const results: GameResultsByTeam = {};
  for (const row of (data ?? []) as unknown as GameRow[]) {
    for (const teamId of [row.home_team, row.away_team]) {
      if (!ids.includes(teamId)) continue;
      const game = toTeamGame(row, teamId);
      // Weekly stat rows are regular season only; an unscored game has no result.
      if (game.game_type !== "REG" || game.result === null) continue;
      if (!results[teamId]) results[teamId] = {};
      results[teamId][game.week] = {
        game_id: game.game_id,
        team_score: game.team_score as number,
        opponent_score: game.opponent_score as number,
        result: game.result,
        opponent_id: game.opponent_id,
      };
    }
  }
  return results;
}

/**
 * Has the league published this season's schedule yet? One row settles it, so
 * this stays a `limit(1)` probe rather than pulling 272 games.
 *
 * Answers FALSE on any failure (query error, missing table, no rows). Its only
 * caller uses it to decide whether the landing page shows next season's 0-0
 * board, and falling back to the completed season is the safe direction.
 */
export async function hasScheduleForSeason(season: number): Promise<boolean> {
  const supabase = createServerClient();
  const { data, error } = await supabase
    .from("games")
    .select("game_id")
    .eq("season", season)
    .limit(1);

  if (error) return false;
  return (data?.length ?? 0) > 0;
}
