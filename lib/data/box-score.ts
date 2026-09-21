// lib/data/box-score.ts — server-side reads for /game/[game_id] and the box
// score links (box score spec §6, §7). Imports the Supabase server client:
// never import this module from a "use client" file.
//
// Every read here throws on a query error. The page turns that into a thrown
// render (ISR keeps the last good copy) instead of a cached empty shell; the
// team and player pages catch the seasons probe and simply render no links.
import { createServerClient } from "@/lib/supabase/server";
import { parseNumericFields } from "@/lib/utils";
import { getGame, getTeamSchedule, type GameRecord } from "@/lib/data/games";
import { getAvailableSeasons } from "@/lib/data/queries";
import { QB_WEEKLY_NUMERIC, RECEIVER_WEEKLY_NUMERIC, RB_WEEKLY_NUMERIC } from "@/lib/data/players";
import { normalizeGameType, recordThroughWeek, type WinLossTie } from "@/lib/stats/box-score";
import type {
  GamePlayerLines,
  PlayerIdentity,
  QBWeeklyStat,
  RBWeeklyStat,
  ReceiverWeeklyStat,
  TeamGameStat,
} from "@/lib/types";

/**
 * The NUMERIC columns of team_game_stats (PR 2's TEAM_GAME_STATS_RATE_COLS
 * and TEAM_GAME_STATS_SUM_COLS). PostgREST sends NUMERIC as strings;
 * parseNumericFields makes them numbers, or null for NULL and "NaN".
 */
export const TEAM_GAME_NUMERIC = [
  "epa_per_play",
  "success_rate",
  "first_down_rate",
  "pass_epa_per_play",
  "pass_success_rate",
  "pass_first_down_rate",
  "rush_epa_per_play",
  "rush_success_rate",
  "rush_first_down_rate",
  "early_epa_per_play",
  "early_success_rate",
  "late_epa_per_play",
  "late_success_rate",
  "explosive_rate",
  "yards_per_play",
  "yards_per_pass",
  "yards_per_rush",
  "epa_lost_turnovers",
  "epa_lost_sacks",
  "epa_lost_penalties",
];

// The address rule itself lives in lib/stats/box-score.ts so the two "use
// client" link gates can import it without pulling the Supabase server client
// into the browser bundle. Re-exported here: this is still where the server
// reads it from, and moving the definition must not move every import.
export { GAME_ID_PATTERN, normalizeGameId } from "@/lib/stats/box-score";

/** A `games` row with both scores present. */
export type PlayedGame = GameRecord & { home_score: number; away_score: number };

export interface GameRecords {
  away: WinLossTie;
  home: WinLossTie;
}

/**
 * Everything the page needs, in one of five states (spec §6):
 * - not-found: no such game id
 * - unplayed: scheduled, no final score yet (the page 404s; nothing links to it)
 * - uncovered: played, but no box score will come — a season with no rows of
 *   its own, older than the newest covered one (2020–2025 until the backfill), or a playoff game
 * - pending: played in a covered season, team_game_stats rows not written yet
 * - ready: both teams' rows and the player lines
 */
export type BoxScoreData =
  | { state: "not-found" }
  | { state: "unplayed"; game: GameRecord }
  | {
      state: "uncovered";
      game: PlayedGame;
      records: GameRecords;
      reason: "season" | "playoffs";
      /** The earliest season with box scores ("Box scores start with the 2026 season"). */
      firstSeason: number | null;
    }
  | { state: "pending"; game: PlayedGame; records: GameRecords }
  | {
      state: "ready";
      game: PlayedGame;
      records: GameRecords;
      away: TeamGameStat;
      home: TeamGameStat;
      lines: GamePlayerLines;
    };

/**
 * Which of `candidates` have team_game_stats rows — the box score link gate
 * (spec §7). One `limit(1)` probe per season, in parallel, so the answer can
 * never be cut off by PostgREST's 1000-row cap (a bare `select season` over
 * the table would be, once the backfill lands). Newest first. Throws on a
 * query error.
 */
export async function getBoxScoreSeasons(candidates: number[]): Promise<number[]> {
  const usable = (s: unknown): s is number => Number.isInteger(s) && (s as number) > 0;
  const seasons = Array.from(new Set((candidates ?? []).filter(usable)));
  // Dropping a candidate fires no query, so without this line the whole site's
  // box score links can go dark with nothing logged anywhere — the failure
  // 4159ca7 closed from the other side. Name the value AND its type: the way
  // this happens for real is data_freshness.season arriving as text.
  const dropped = (candidates ?? []).filter((s) => !usable(s));
  if (dropped.length > 0) {
    console.warn(
      `getBoxScoreSeasons: ignoring ${dropped.length} unusable season candidate(s) ` +
        `[${dropped.map((s) => `${JSON.stringify(s) ?? String(s)} (${typeof s})`).join(", ")}]; ` +
        "box score links for them will not render"
    );
  }
  if (seasons.length === 0) return [];
  const supabase = createServerClient();
  const found = await Promise.all(
    seasons.map(async (season) => {
      const { data, error } = await supabase
        .from("team_game_stats")
        .select("game_id")
        .eq("season", season)
        .limit(1);
      if (error) throw new Error(`Failed to fetch box score seasons: ${error.message}`);
      return (data?.length ?? 0) > 0 ? season : null;
    })
  );
  return found.filter((s): s is number => s !== null).sort((a, b) => b - a);
}

/** One hour, matching the site's ISR cadence. */
const BOX_SCORE_SEASONS_TTL_MS = 60 * 60 * 1000;
/** key = JSON of the candidate list, so two lists can never collide. */
const boxScoreSeasonsMemo = new Map<string, { at: number; value: number[] }>();

/**
 * getBoxScoreSeasons for the link gate on pages that render per request.
 *
 * The team and player pages both read `searchParams`, which opts their routes
 * into dynamic rendering, so the gate is not amortised by ISR the way the
 * comment there once claimed: without this memo one team-page view costs one
 * `limit(1)` query per season in `data_freshness` — 5 to 7 today, one more
 * every year — and the team hub is among the most-visited pages on the site.
 * The gate only decides whether a score line is a link, so an answer up to an
 * hour stale (a newly covered season linking late) is a fair trade against
 * that; the ingest runs far less often than page views.
 *
 * Module scope, deliberately: per server instance, empty on a cold start,
 * never persisted, no dependency and no cache abstraction.
 *
 * Not for `getBoxScore`'s own `getBoxScoreSeasons([game.season])` probe — that
 * one decides what a visitor is told about one specific game (pending vs
 * uncovered) and must stay live.
 */
export async function getBoxScoreSeasonsCached(candidates: number[]): Promise<number[]> {
  const list = candidates ?? [];
  // An empty list fires no query, so there is nothing to memoise — and letting
  // it through keeps each caller's "no seasons" log firing every render.
  if (list.length === 0) return getBoxScoreSeasons(list);
  const key = JSON.stringify(list);
  const now = Date.now();
  const hit = boxScoreSeasonsMemo.get(key);
  // A copy on the way out, on both paths. The stored array would otherwise be
  // the same instance in every team and player render for up to an hour, so
  // one .sort() or .push() on it anywhere in a component would corrupt the
  // gate for every later request on that server instance — and the symptom
  // (box score links quietly wrong, on one instance, for an hour) is close to
  // undebuggable. Both consumers only call .includes() today; this makes that
  // structural instead of a convention.
  if (hit && now - hit.at < BOX_SCORE_SEASONS_TTL_MS) return [...hit.value];
  // Awaited rather than stored as a promise: a rejection propagates to the
  // caller's .catch and nothing is written, so the next render tries again.
  const value = await getBoxScoreSeasons(list);
  for (const k of Array.from(boxScoreSeasonsMemo.keys())) {
    const entry = boxScoreSeasonsMemo.get(k);
    if (entry && now - entry.at >= BOX_SCORE_SEASONS_TTL_MS) boxScoreSeasonsMemo.delete(k);
  }
  boxScoreSeasonsMemo.set(key, { at: now, value });
  return [...value];
}

/** Both teams' team_game_stats rows for one game (0, 1 or 2 rows). */
export async function getTeamGameStats(gameId: string): Promise<TeamGameStat[]> {
  const supabase = createServerClient();
  const { data, error } = await supabase.from("team_game_stats").select("*").eq("game_id", gameId);
  if (error) throw new Error(`Failed to fetch team game stats for ${gameId}: ${error.message}`);
  return (data ?? []).map((row) =>
    parseNumericFields<TeamGameStat>(row as unknown as TeamGameStat, TEAM_GAME_NUMERIC)
  );
}

/**
 * The weekly rows behind the player tables: both teams' QB, receiver and RB
 * rows for `season` + `week` (spec §6: taken from the `games` row, never the
 * URL), plus name / position / slug for every player_id they name — the
 * weekly tables store none of those. A player with no player_slugs row is
 * left out of `players`; the table then shows his id, unlinked.
 */
export async function getGamePlayerLines(
  season: number,
  week: number,
  teamIds: string[]
): Promise<GamePlayerLines> {
  const supabase = createServerClient();
  const weekly = async <T,>(table: string, numeric: string[]): Promise<T[]> => {
    const { data, error } = await supabase
      .from(table)
      .select("*")
      .eq("season", season)
      .eq("week", week)
      .in("team_id", teamIds);
    if (error) throw new Error(`Failed to fetch ${table} for ${season} week ${week}: ${error.message}`);
    return (data ?? []).map((row) => parseNumericFields<T>(row as unknown as T, numeric));
  };
  const [qbs, receivers, rbs] = await Promise.all([
    weekly<QBWeeklyStat>("qb_weekly_stats", QB_WEEKLY_NUMERIC),
    weekly<ReceiverWeeklyStat>("receiver_weekly_stats", RECEIVER_WEEKLY_NUMERIC),
    weekly<RBWeeklyStat>("rb_weekly_stats", RB_WEEKLY_NUMERIC),
  ]);

  const ids = Array.from(
    new Set(
      [...qbs, ...receivers, ...rbs]
        .map((r) => r.player_id)
        .filter((id): id is string => typeof id === "string" && id.length > 0)
    )
  );
  const players: Record<string, PlayerIdentity> = {};
  if (ids.length > 0) {
    const { data, error } = await supabase
      .from("player_slugs")
      .select("player_id, player_name, position, slug")
      .in("player_id", ids);
    if (error) throw new Error(`Failed to fetch player identities: ${error.message}`);
    for (const row of (data ?? []) as PlayerIdentity[]) {
      if (typeof row?.player_id !== "string") continue;
      players[row.player_id] = {
        player_id: row.player_id,
        player_name: row.player_name,
        position: row.position,
        slug: row.slug ?? null,
      };
    }
  }
  return { qbs, receivers, rbs, players };
}

/**
 * Assemble one game's box score. Reads: the `games` row; then both teams'
 * schedules (records) and the team_game_stats rows in parallel; then, when the
 * rows exist, the player lines. When they don't, the covered-seasons probe
 * decides between "uncovered" and "pending". Every read throws on failure.
 */
export async function getBoxScore(gameId: string): Promise<BoxScoreData> {
  const game = await getGame(gameId);
  if (!game) return { state: "not-found" };
  // A team cannot play itself. The row is corrupt, and every side of a box
  // score built from it would be a lie: .find below matches the SAME
  // team_game_stats row for both sides, so the page compares a team to itself,
  // each player table lists one team twice with duplicate React keys, and the
  // receiving footnote repeats its own sentence. "not-found" is the honest
  // state — there is no box score at this address and there never will be one,
  // so it 404s, stays out of search, and fires no further reads. "pending"
  // would promise stats that are not coming and "uncovered" would blame the
  // season; neither is true, and a visitor cannot act on either.
  if (game.home_team === game.away_team) {
    console.error(
      `Box score: games row ${game.game_id} has home_team === away_team (${game.home_team}); refusing to render`
    );
    return { state: "not-found" };
  }
  if (game.home_score === null || game.away_score === null) return { state: "unplayed", game };
  const played = game as PlayedGame;

  // A playoff game pays for a getTeamGameStats read the check below discards.
  // Deliberate: moving the game_type check above this Promise.all would cost
  // the common (regular-season) case a serial round trip. Leave it.
  const [awaySchedule, homeSchedule, statRows] = await Promise.all([
    getTeamSchedule(game.away_team, game.season),
    getTeamSchedule(game.home_team, game.season),
    getTeamGameStats(gameId),
  ]);
  const records: GameRecords = {
    away: recordThroughWeek(awaySchedule, game.week),
    home: recordThroughWeek(homeSchedule, game.week),
  };

  // Playoffs are out of scope (spec §2): the ingest skips them, so no rows ever
  // come. Through normalizeGameType, so an empty or lower-case value reads REG
  // here exactly as it does in gameLabel and in both link gates — never again a
  // "WEEK 1" band above a "playoff games aren't covered" message.
  if (normalizeGameType(game.game_type) !== "REG") {
    return { state: "uncovered", game: played, records, reason: "playoffs", firstSeason: null };
  }

  const away = statRows.find((r) => r.team_id === game.away_team);
  const home = statRows.find((r) => r.team_id === game.home_team);
  if (!away || !home) {
    // Does this game's own season have box scores at all? One limit(1) probe
    // settles the common case — a covered season whose rows for this game are
    // not written yet, every Sunday evening for ~16 games at once — without
    // the data_freshness read and the N probes below.
    const ownSeason = await getBoxScoreSeasons([game.season]);
    if (ownSeason.length > 0) return { state: "pending", game: played, records };

    const seasons = await getAvailableSeasons();
    // getAvailableSeasons returns [] on a query error; a real database always
    // has data_freshness rows, so empty means the read failed (homepage rule).
    if (seasons.length === 0) {
      throw new Error("Box score: no seasons from data_freshness (query failed or table empty)");
    }
    const covered = await getBoxScoreSeasons(seasons);
    // Same rule one table over: data_freshness lists seasons, yet not one of
    // them has a team_game_stats row. Since PR 2 shipped that cannot be true of
    // the real table, so the read is broken (a dropped read policy, a renamed
    // table, a bad key) and PostgREST reports exactly that as 200-with-no-rows.
    // Spec §6: a failed read throws, so ISR keeps the last good copy instead of
    // caching "stats arrive shortly" on every game page in every season.
    if (covered.length === 0) {
      throw new Error(
        `Box score: data_freshness lists ${seasons.length} season(s) (${seasons.join(", ")}) but none has a team_game_stats row; expected at least one, so the team_game_stats read is failing silently`
      );
    }
    // Coverage is membership, not a threshold (spec §6: "a season with no
    // team_game_stats"): a season missing from the middle of the backfill has
    // no box score coming. A season newer than every covered one is still
    // pending, though — `games` carries next season's schedule as soon as the
    // league publishes it, long before the ingest reaches it.
    const firstSeason = Math.min(...covered);
    const newest = Math.max(...covered);
    if (!covered.includes(game.season) && game.season < newest) {
      return { state: "uncovered", game: played, records, reason: "season", firstSeason };
    }
    return { state: "pending", game: played, records };
  }

  const lines = await getGamePlayerLines(game.season, game.week, [game.away_team, game.home_team]);
  return { state: "ready", game: played, records, away, home, lines };
}
