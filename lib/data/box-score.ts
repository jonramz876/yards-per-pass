// lib/data/box-score.ts — server-side reads for /game/[game_id] and the box
// score links (box score spec §6, §7). Imports the Supabase server client:
// never import this module from a "use client" file.
//
// Every read here throws on a query error, and every read has a deadline
// (BOX_SCORE_READ_DEADLINE_MS) so a slow database is a caught error rather
// than a killed invocation. The page turns a throw into a failed render
// instead of a cached empty shell: what is known is that a failed render is
// never cached, so a Supabase blip cannot freeze "no stats" onto a game page.
// Whether Vercel then serves a previously rendered copy of that URL has NOT
// been measured (the route builds as a plain dynamic function) -- do not lean
// on it. The team and player pages catch the seasons probe and render no links.
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

/**
 * How long one box score assembly gets, in milliseconds.
 *
 * Nothing on this route had a deadline. A `ready` view is 8 PostgREST requests
 * in 4 serial waves, and there is deliberately no loading.tsx, so TTFB is the
 * whole chain: a merely SLOW Supabase (not a failed one -- pooler saturation,
 * a busy plan) ran past Vercel's function limit and the invocation was killed.
 * app/game/[game_id]/error.tsx only catches throws from inside the invocation,
 * so the one failure mode this route built an error boundary for was the one
 * it could not see; the visitor got Vercel's untemplated 504 after burning ten
 * seconds first.
 *
 * 5s is ONE budget for the whole assembly rather than one per request: the
 * waves are serial, so a per-request deadline would multiply by four and
 * overrun the same limit. Vercel's Node default is 10s (Hobby) / 15s (Pro), so
 * this leaves at least 5s for cold start, render and response, and no
 * maxDuration override is needed. It is far above any healthy read -- the
 * whole chain normally settles well under a second. The repo already had the
 * pattern: lib/og/tecmo-card-image.tsx uses AbortSignal.timeout(4000).
 *
 * supabase-js turns an aborted fetch into a PostgREST-shaped error rather than
 * a rejection, so every `if (error) throw` below is already the handler.
 */
export const BOX_SCORE_READ_DEADLINE_MS = 5000;

/** A fresh deadline for one assembly; give it to every read of that assembly. */
export const boxScoreDeadline = (): AbortSignal => AbortSignal.timeout(BOX_SCORE_READ_DEADLINE_MS);

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
export async function getBoxScoreSeasons(
  candidates: number[],
  signal: AbortSignal = boxScoreDeadline()
): Promise<number[]> {
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
        .limit(1)
        .abortSignal(signal);
      if (error) throw new Error(`Failed to fetch box score seasons: ${error.message}`);
      return (data?.length ?? 0) > 0 ? season : null;
    })
  );
  return found.filter((s): s is number => s !== null).sort((a, b) => b - a);
}

/** One hour, matching the site's ISR cadence. */
const BOX_SCORE_SEASONS_TTL_MS = 60 * 60 * 1000;
/** key = JSON of the candidate list, so two lists can never collide. */
const boxScoreSeasonsMemo = new Map<string, { at: number; promise: Promise<number[]> }>();

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
  if (hit && now - hit.at < BOX_SCORE_SEASONS_TTL_MS) return [...(await hit.promise)];
  // The PROMISE is stored, not the resolved value. Storing the value only
  // after awaiting it kept a rejection out of the memo -- the right goal --
  // but it also recorded nothing while the probe was in flight, so every
  // request arriving in that window was a miss and fired its own
  // seasons.length parallel limit(1) queries. On a cold lambda, or at the
  // instant the hour rolls over, 20 concurrent team-page views cost 20 x 7 =
  // 140 PostgREST requests for 7 answers, on the route this memo exists to
  // make cheap. Vercel spins instances up freely, so that window recurs often.
  const promise = getBoxScoreSeasons(list);
  boxScoreSeasonsMemo.set(key, { at: now, promise });
  // A rejection is still never memoised: the entry goes the moment the probe
  // fails, so the next render retries. The guard keeps a later entry under the
  // same key (a retry already in flight) from being deleted by this one's
  // failure, and attaching the handler here also marks the rejection handled,
  // so sharing the promise can never raise an unhandled rejection.
  promise.catch(() => {
    if (boxScoreSeasonsMemo.get(key)?.promise === promise) boxScoreSeasonsMemo.delete(key);
  });
  for (const k of Array.from(boxScoreSeasonsMemo.keys())) {
    const entry = boxScoreSeasonsMemo.get(k);
    if (entry && now - entry.at >= BOX_SCORE_SEASONS_TTL_MS) boxScoreSeasonsMemo.delete(k);
  }
  return [...(await promise)];
}

/** Both teams' team_game_stats rows for one game (0, 1 or 2 rows). */
export async function getTeamGameStats(
  gameId: string,
  signal: AbortSignal = boxScoreDeadline()
): Promise<TeamGameStat[]> {
  const supabase = createServerClient();
  const { data, error } = await supabase
    .from("team_game_stats")
    .select("*")
    .eq("game_id", gameId)
    .abortSignal(signal);
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
  teamIds: string[],
  signal: AbortSignal = boxScoreDeadline()
): Promise<GamePlayerLines> {
  const supabase = createServerClient();
  const weekly = async <T,>(table: string, numeric: string[]): Promise<T[]> => {
    const { data, error } = await supabase
      .from(table)
      .select("*")
      .eq("season", season)
      .eq("week", week)
      .in("team_id", teamIds)
      .abortSignal(signal);
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
      .in("player_id", ids)
      .abortSignal(signal);
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
  // One deadline for the whole assembly, threaded into every read below (and
  // into the two that live in lib/data/games.ts): the waves are serial, so a
  // deadline per request would multiply by four.
  const signal = boxScoreDeadline();
  const game = await getGame(gameId, signal);
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
    getTeamSchedule(game.away_team, game.season, signal),
    getTeamSchedule(game.home_team, game.season, signal),
    getTeamGameStats(gameId, signal),
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
    // One row rather than none: the ingest upserts both teams together, so the
    // aggregation already ran and produced something corrupt (or a team id no
    // longer matches after a relocation). "pending" stays the least wrong
    // state — there is nothing to render either way — but it promises stats
    // "within a few hours" that are never coming, and until now nothing
    // anywhere recorded that, on any game, for ever.
    if (statRows.length > 0) {
      console.warn(
        `Box score ${gameId}: ${statRows.length} team_game_stats row(s) but none for ` +
          `${!away ? game.away_team : game.home_team}; rendering as pending`
      );
    }
    // Does this game's own season have box scores at all? One limit(1) probe
    // settles the common case — a covered season whose rows for this game are
    // not written yet, every Sunday evening for ~16 games at once — without
    // the data_freshness read and the N probes below.
    const ownSeason = await getBoxScoreSeasons([game.season], signal);
    if (ownSeason.length > 0) return { state: "pending", game: played, records };

    const seasons = await getAvailableSeasons();
    // getAvailableSeasons returns [] on a query error; a real database always
    // has data_freshness rows, so empty means the read failed (homepage rule).
    if (seasons.length === 0) {
      throw new Error("Box score: no seasons from data_freshness (query failed or table empty)");
    }
    const covered = await getBoxScoreSeasons(seasons, signal);
    // Same rule one table over: data_freshness lists seasons, yet not one of
    // them has a team_game_stats row. Since PR 2 shipped that cannot be true of
    // the real table, so the read is broken (a dropped read policy, a renamed
    // table, a bad key) and PostgREST reports exactly that as 200-with-no-rows.
    // Spec §6: a failed read throws rather than caching "stats arrive shortly"
    // onto every game page in every season. (A failed render is never cached;
    // whether a previously rendered copy is then served is unmeasured.)
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
      return {
        state: "uncovered",
        game: played,
        records,
        reason: "season",
        // Name a first season only when the game really precedes it. Coverage
        // is membership, so a season missing from the MIDDLE of the backfill
        // lands here too — and with 2020-2024 and 2026 covered, a 2025 game
        // would read "Box scores start with the 2020 season", which is false
        // on its own screen (2025 is after 2020) and whose only takeaway
        // ("this game is too old") is wrong. The page already has a neutral
        // heading for null.
        firstSeason: game.season < firstSeason ? firstSeason : null,
      };
    }
    return { state: "pending", game: played, records };
  }

  const lines = await getGamePlayerLines(game.season, game.week, [game.away_team, game.home_team], signal);
  return { state: "ready", game: played, records, away, home, lines };
}

/** Everything generateMetadata needs, and nothing it does not (spec §6). */
export interface BoxScoreMeta {
  /** null when the address has no page: unknown id, a corrupt row, or no final score. */
  game: PlayedGame | null;
  /** True only when both team_game_stats rows are there — the one indexable state. */
  ready: boolean;
}

/**
 * The cheap read behind generateMetadata: the `games` row, plus — only for a
 * played regular-season game — whether both team_game_stats rows exist.
 *
 * generateMetadata used to call getBoxScore, which is 8 PostgREST requests in
 * 4 serial waves, and then read only the `games` row and the state off it:
 * both team schedules, both stat rows, three weekly tables and player_slugs
 * were fetched and thrown away on every render of a route that renders per
 * request. This is 1 request for an unknown, unplayed or playoff game and 2
 * for every other, and it answers exactly the two questions the title,
 * description, canonical and robots decision need.
 *
 * It applies getBoxScore's rules in getBoxScore's order, so the two cannot
 * disagree about which addresses have a page: a corrupt self-play row and a
 * game without both scores have none (the page 404s them), a playoff game has
 * a page but never a box score, and "ready" is both rows present. `ready` is
 * also exactly the indexable state: uncovered and pending are both a 200
 * message page, and the route marks both noindex.
 *
 * Every read throws on failure, on the same deadline as the full assembly.
 */
export async function getBoxScoreMeta(gameId: string): Promise<BoxScoreMeta> {
  const signal = boxScoreDeadline();
  const game = await getGame(gameId, signal);
  if (!game || game.home_team === game.away_team) return { game: null, ready: false };
  if (game.home_score === null || game.away_score === null) return { game: null, ready: false };
  const played = game as PlayedGame;
  // Playoffs are out of scope (spec §2): no rows ever come, so do not ask.
  if (normalizeGameType(game.game_type) !== "REG") return { game: played, ready: false };
  const statRows = await getTeamGameStats(gameId, signal);
  const ready =
    statRows.some((r) => r.team_id === game.away_team) &&
    statRows.some((r) => r.team_id === game.home_team);
  return { game: played, ready };
}
