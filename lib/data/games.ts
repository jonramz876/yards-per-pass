// lib/data/games.ts
// Schedule + results for one team-season, from the `games` table
// (nflverse schedules; see ingest_schedules in scripts/ingest.py).
import { createServerClient } from "@/lib/supabase/server";
import { fetchAllRows } from "@/lib/data/utils";
import { normalizeGameType } from "@/lib/stats/box-score";
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

/**
 * The week of a `games` row. `week` is INT in the schema and nflverse always
 * supplies it, but a NULL (or otherwise unusable) value used to be coalesced
 * to 0, and week 0 silently renders a whole box score wrong: recordThroughWeek
 * skips every game so both records read "0-0", the band reads "WEEK 0", and
 * the weekly reads filter `week = 0` so all three player tables come back
 * empty — a full stat sheet with no players.
 *
 * The fallback reads the week out of the row's own primary key. That is NOT
 * the spec §6 rule "the week comes from the `games` row, never by parsing the
 * URL": this id is the row's own PK read back from the database, not visitor
 * input, and the address was already validated against GAME_ID_PATTERN before
 * the query ran — a row in hand therefore means a parseable id. We are filling
 * a hole in the row, not trusting the address. If the id does not parse either
 * there is nothing honest left to render, so throw with a diagnostic rather
 * than serve a half-right page.
 */
function weekFor(row: GameRow): number {
  const stored = Number(row.week);
  if (Number.isInteger(stored) && stored > 0) return stored;
  const m = /^\d{4}_(\d{2})_/.exec(String(row.game_id ?? ""));
  if (!m) {
    throw new Error(
      `Game ${JSON.stringify(row.game_id)} has an unusable week (${JSON.stringify(row.week)}) and an id that carries no week`
    );
  }
  const derived = Number(m[1]);
  // The id's own week is checked against the same rule as the stored one.
  // GAME_ID_PATTERN allows any two digits, so "2026_00_BUF_HOU" parses and
  // would hand back the very 0 this function exists to prevent.
  if (!Number.isInteger(derived) || derived <= 0) {
    throw new Error(
      `Game ${JSON.stringify(row.game_id)} has an unusable week (${JSON.stringify(row.week)}) and an id week of ${JSON.stringify(m[1])}`
    );
  }
  console.warn(
    `Game ${row.game_id}: week is ${JSON.stringify(row.week)} in the games row; using week ${derived} from the game id`
  );
  return derived;
}

/**
 * The season of a `games` row. Exactly weekFor's hole one column over —
 * ensure_games_table declares BOTH `season INT` and `week INT` nullable, same
 * type, same nflverse source — and a worse page when it opens.
 *
 * A bare `Number(row.season)` turns NULL into 0, and 0 is quieter than week 0
 * was, because getTeamGameStats is keyed on `game_id` alone: both stat rows
 * are still found, so `!away || !home` is false and the whole coverage branch
 * is skipped. The page renders state "ready" — a complete, correct-looking
 * team comparison, 0-0 records for two teams that have played (getTeamSchedule
 * finds no season-0 rows) and no passing, rushing or receiving lines at all
 * (getGamePlayerLines filters `season = 0`), with nothing on the page hinting
 * that anything is missing.
 *
 * The fallback is weekFor's, for weekFor's reason: the id is the row's own
 * primary key read back from the database, not visitor input, and the address
 * was validated against GAME_ID_PATTERN before the query ran, so a row in hand
 * means a parseable id. This fills a hole in the row rather than trusting the
 * address (spec §6). If the id carries no usable season either, there is
 * nothing honest left to render, so throw with a diagnostic.
 */
function seasonFor(row: GameRow): number {
  const stored = Number(row.season);
  if (Number.isInteger(stored) && stored > 0) return stored;
  const m = /^(\d{4})_\d{2}_/.exec(String(row.game_id ?? ""));
  if (!m) {
    throw new Error(
      `Game ${JSON.stringify(row.game_id)} has an unusable season (${JSON.stringify(row.season)}) and an id that carries no season`
    );
  }
  const derived = Number(m[1]);
  if (!Number.isInteger(derived) || derived <= 0) {
    throw new Error(
      `Game ${JSON.stringify(row.game_id)} has an unusable season (${JSON.stringify(row.season)}) and an id season of ${JSON.stringify(m[1])}`
    );
  }
  console.warn(
    `Game ${row.game_id}: season is ${JSON.stringify(row.season)} in the games row; using season ${derived} from the game id`
  );
  return derived;
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
    game_type: normalizeGameType(row.game_type),
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
      if (game.game_type !== "REG" || game.result === null) continue; // toTeamGame normalised it
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
 * One `games` row as the box score page reads it — both teams, scores parsed
 * to numbers, null until the game is played (never NaN: see `score`).
 */
export interface GameRecord {
  game_id: string;
  season: number;
  /** REG, or WC / DIV / CON / SB — through normalizeGameType, so it is always
   * trimmed and upper case, and a missing or blank value reads REG. */
  game_type: string;
  week: number;
  gameday: string | null;
  weekday: string | null;
  gametime: string | null;
  home_team: string;
  away_team: string;
  home_score: number | null;
  away_score: number | null;
}

/**
 * The `games` row for one nflverse game id, or null when there is none.
 * Throws on a query error (box score spec §6: a failed read must not render
 * as "not found").
 */
export async function getGame(gameId: string): Promise<GameRecord | null> {
  const supabase = createServerClient();
  const { data, error } = await supabase.from("games").select("*").eq("game_id", gameId).limit(1);
  if (error) throw new Error(`Failed to fetch game ${gameId}: ${error.message}`);
  const row = ((data ?? []) as unknown as GameRow[])[0];
  if (!row) return null;
  return {
    game_id: row.game_id,
    season: seasonFor(row),
    game_type: normalizeGameType(row.game_type),
    week: weekFor(row),
    gameday: row.gameday ?? null,
    weekday: row.weekday ?? null,
    gametime: row.gametime ?? null,
    home_team: row.home_team,
    away_team: row.away_team,
    home_score: score(row.home_score),
    away_score: score(row.away_score),
  };
}

/**
 * Ids of every played regular-season game of one season (both scores
 * present), for the sitemap's box score URLs. Paginated with fetchAllRows:
 * one season is 272 rows, under the 1000-row cap, but the helper costs
 * nothing and keeps this safe if it is ever called across seasons.
 *
 * Rejects with fetchAllRows' raw PostgREST object rather than an Error, like
 * every other caller of that helper. A handler must therefore use a bare
 * `catch {}` (app/sitemap.ts) or app/page.tsx's wrapping idiom; a
 * `catch (e) { if (e instanceof Error) ... }` would silently take the wrong branch.
 */
export async function getPlayedRegularSeasonGameIds(season: number): Promise<string[]> {
  const rows = await fetchAllRows("games", "game_id,game_type,home_score,away_score", { season });
  return rows
    .filter(
      (r) =>
        normalizeGameType(r.game_type as string | null) === "REG" &&
        score(r.home_score) !== null &&
        score(r.away_score) !== null
    )
    .map((r) => String(r.game_id));
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
