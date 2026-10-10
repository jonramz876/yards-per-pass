// lib/data/matchup.ts — what the team matchup pages read (team matchup spec
// 2026-10-10 §6). Server-only: never import it from a "use client" file. The
// pure half (ranks, edges, the model, player and schedule rules, the copy) is
// lib/stats/matchup.ts; links and URL words are lib/stats/matchup-links.ts.
//
// ONE loader for /matchup/[away]/[home] and its metadata (loadMatchup) and one
// for /matchup (loadMatchupIndex), and NO read per team or per pair: 992
// ordered pairs are valid URLs in every season. Everything comes through
// one-minute memos whose keys are only
//
//   seasons        data_freshness            (shared with the compare card)
//   slugs          every player slug         (shared with the compare card)
//   GROUP:season   one season table a group  (shared with the compare card)
//   rows:season    team_game_stats, 35 columns
//   games:season   the season's schedule
//
// so a cold instance makes 8 PostgREST requests for a matchup page (the slug
// list is two pages) and a warm one makes none, whatever the pair. A failed
// read is remembered for ten seconds (memoised), so an outage is one attempt
// per key per ten seconds, never the visitor's rate. An answer that resolves
// but cannot be used (no rows for a season that has them, an empty schedule or
// player table) is turned into a failed read in its memo, so it gets the same
// ten seconds and not the minute (failMemo, failCompareTable).
//
// What the memos hold is the READS, never anything worked out from the date:
// the slate and a pair's game are computed on every call from the memoised
// games and today's date (US Eastern), so no answer is wrong across midnight.
import { parseNumericFields } from "@/lib/utils";
import { fetchAllRows, queryError } from "@/lib/data/utils";
import { TEAM_GAME_NUMERIC, boxScoreDeadline, getBoxScoreSeasonsCached } from "@/lib/data/box-score";
import { getSeasonGames, type GameRecord } from "@/lib/data/games";
import { fallbackSeason } from "@/lib/data/queries";
import { failCompareTable, getCompareTableCached, getPlayerSlugIndexCached, getSeasonWeeksCached } from "@/lib/data/compare-card";
import { memoised, type MemoEntry } from "@/lib/data/team-radar-card";
import type { PlayerSlugEntry } from "@/lib/data/players";
import { hasNoDatabase } from "@/lib/supabase/server";
import type { WinLossTie } from "@/lib/stats/box-score";
import {
  buildMatchup,
  currentSlate,
  findPairGame,
  matchupSeasonRows,
  pairLineups,
  pickMainPlayers,
  teamRecord,
  type LineupPlayer,
  type MatchupModel,
} from "@/lib/stats/matchup";
import type { QBSeasonStat, RBSeasonStat, ReceiverSeasonStat, TeamGameStat } from "@/lib/types";

/**
 * The 35 columns the matchup reads: the Team Stats list (30) plus the five
 * only the radar reads. One read feeds both builders (each ignores the
 * columns it does not use). A literal list, with a test that it equals the
 * union of TEAM_STATS_COLUMNS and TEAM_RADAR_COLUMNS, so a column added to
 * either is noticed here. Those two lists and their frozen goldens are not
 * touched. PostgREST rejects a select naming an unknown column: never add a
 * column here before it exists in the live table (all 35 do).
 */
export const MATCHUP_COLUMNS = [
  "game_id", "team_id", "opponent_id", "season", "week",
  "plays", "pass_plays", "rush_plays", "early_plays", "late_plays",
  "epa_per_play", "success_rate", "first_down_rate",
  "pass_epa_per_play", "pass_success_rate", "pass_first_down_rate",
  "rush_epa_per_play", "rush_success_rate", "rush_first_down_rate",
  "early_epa_per_play", "early_success_rate", "late_epa_per_play", "late_success_rate",
  "explosive_plays", "explosive_pass", "explosive_rush",
  "turnovers", "epa_lost_turnovers", "epa_lost_sacks", "epa_lost_penalties",
  "attempts", "sacks", "total_drives", "designed_runs", "stuffed_runs",
] as const;

export type MatchupGameRow = Pick<TeamGameStat, (typeof MATCHUP_COLUMNS)[number]>;

/**
 * The NUMERIC columns among the ones selected. Only these, never the full
 * list: parseNumericFields adds every listed field that is undefined as null,
 * so the full list would bolt nulls onto columns the read never selected.
 */
export const MATCHUP_NUMERIC = TEAM_GAME_NUMERIC.filter((c) => (MATCHUP_COLUMNS as readonly string[]).includes(c));

/**
 * Every team's team_game_stats rows for one season (at most 544, one page),
 * ordered so paging is stable, under a deadline. Throws an Error when the read
 * fails; returns [] when it succeeds with no rows (what an empty season means
 * is loadMatchup's decision). Anything in the answer that is not an object is
 * dropped before use.
 */
export async function getMatchupRows(season: number, options: { signal?: AbortSignal } = {}): Promise<MatchupGameRow[]> {
  let raw: Record<string, unknown>[];
  try {
    raw = await fetchAllRows(
      "team_game_stats",
      MATCHUP_COLUMNS.join(","),
      { season },
      { signal: options.signal ?? boxScoreDeadline(), order: ["game_id", "team_id"] }
    );
  } catch (err) {
    // fetchAllRows rejects with the raw PostgREST object; make it a real Error.
    throw queryError(`matchup rows for ${season}`, err);
  }
  return objects(raw).map((r) => parseNumericFields(r, MATCHUP_NUMERIC) as unknown as MatchupGameRow);
}

type Row = Record<string, unknown>;
const isObject = (v: unknown): v is Row => v !== null && typeof v === "object" && !Array.isArray(v);
/** The objects of a list; [] for anything that is not a list (chaos F6: a wrong-shaped answer is never a throw). */
const objects = (v: unknown): Row[] => (Array.isArray(v) ? (v as unknown[]).filter(isObject) : []);
const isText = (v: unknown): v is string => typeof v === "string" && v.trim() !== "";

/* ─── Two memos of this module's own; the other three are the compare card's ─── */

const rowsMemo = new Map<number, MemoEntry<MatchupGameRow[]>>();
const gamesMemo = new Map<number, MemoEntry<GameRecord[]>>();

/** Tests only: forget this module's memoised reads (the compare card's three have clearCompareCardMemo). */
export function clearMatchupMemo(): void {
  rowsMemo.clear();
  gamesMemo.clear();
}

/** Tests only: the memo keys in use, to show nothing is ever keyed by a team or a pair. */
export function matchupMemoKeys(): string[] {
  return [
    ...Array.from(rowsMemo.keys()).map((season) => `rows:${season}`),
    ...Array.from(gamesMemo.keys()).map((season) => `games:${season}`),
  ].sort();
}

/**
 * getMatchupRows behind the memo, per season. Call it only with a season
 * already checked against the seasons list (or the fallback season with no
 * database), so the keys stay bounded. The array is shared between callers:
 * treat it as read-only (the builders do).
 */
export function getMatchupRowsCached(season: number): Promise<MatchupGameRow[]> {
  return memoised(rowsMemo, season, () => getMatchupRows(season));
}

/** getSeasonGames behind the memo, per season. Same rule for the key; same read-only rule for the array. */
export function getSeasonGamesCached(season: number): Promise<GameRecord[]> {
  return memoised(gamesMemo, season, () => getSeasonGames(season));
}

/**
 * Turn a memoised answer into a failed read (chaos F5). A read that RESOLVES
 * with something the loader cannot use (no rows for a season that has them,
 * rows that are not rows, an empty schedule) would otherwise be handed out for
 * the full minute: a minute of error pages from one bad answer. Marked,
 * everyone gets `err` for MEMO_FAILURE_TTL_MS (ten seconds, the window a
 * rejected read gets) and then the read is made again. Same key, no new shape.
 *
 * `read` is the promise this load was handed for the key. The entry is
 * replaced only while the memo still holds that promise: a load kept open by a
 * slow sibling read must not overwrite a newer, good answer another request
 * has read in the meantime (PR 1 code review, nit 2).
 */
function failMemo<T>(store: Map<number, MemoEntry<T>>, season: number, err: Error, read: Promise<unknown>): void {
  if (store.get(season)?.promise !== read) return;
  const promise = Promise.reject<T>(err);
  promise.catch(() => {});
  const now = Date.now();
  store.set(season, { at: now, promise, failedAt: now });
}

/**
 * Today's calendar date in US Eastern time, "YYYY-MM-DD": the clock the NFL
 * schedule (gameday, gametime) is written in. The schedule rules in
 * lib/stats/matchup.ts take it as an argument and never read the clock
 * themselves. It is worked out on every call, from the memoised games, so an
 * answer never goes wrong across midnight because of the memo.
 */
export function easternToday(now: Date = new Date()): string {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
    }).formatToParts(now);
    const part = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
    const text = `${part("year")}-${part("month")}-${part("day")}`;
    if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  } catch {
    // No time zone data in this runtime: fall through to UTC, at most a few hours off.
  }
  return now.toISOString().slice(0, 10);
}

/* ─── The loaders ─── */

export type MatchupLineupRow = { pos: string; away: LineupPlayer | null; home: LineupPlayer | null };

interface MatchupLoadCommon {
  /** the season shown: the one asked for when the site has it, else the newest */
  season: number;
  /** the newest season in data_freshness (the bare URL's season) */
  defaultSeason: number;
  isLatestSeason: boolean;
  /** no game in the order asked for and at least one the other way round: the page redirects */
  swap: boolean;
  /** the game of this pair in this order in the season, when there is one */
  game: GameRecord | null;
  /** played regular-season records, counted from `games`; null when the games read failed */
  records: { away: WinLossTie; home: WinLossTie } | null;
  /** the mirrored lineup, always 7 rows; null when the player tables could not be read */
  lineup: MatchupLineupRow[] | null;
  playersAvailable: boolean;
  gamesAvailable: boolean;
}

export type MatchupLoad =
  | (MatchupLoadCommon & { state: "ready" | "small-pool"; model: MatchupModel })
  /** A listed season with no team_game_stats rows (before the first covered season): a message page. */
  | (MatchupLoadCommon & { state: "uncovered"; model: null; firstSeason: number | null });

type SlugNames = Map<string, { slug: string; player_name: string }>;

/** player_id → slug and full name, built once per slug list (the memo hands every caller the same Map). */
const byPlayerId = new WeakMap<object, SlugNames>();
function slugsByPlayerId(index: Map<string, PlayerSlugEntry>): SlugNames {
  let out = byPlayerId.get(index);
  if (!out) {
    const built: SlugNames = new Map();
    index.forEach((entry: unknown) => {
      if (!isObject(entry) || !isText(entry.player_id) || !isText(entry.slug) || built.has(entry.player_id)) return;
      built.set(entry.player_id, { slug: entry.slug, player_name: typeof entry.player_name === "string" ? entry.player_name : "" });
    });
    byPlayerId.set(index, built);
    out = built;
  }
  return out;
}

/** The rows of a schedule answer that can be a game: an object naming two different teams. */
function usableGames(value: unknown): GameRecord[] {
  return objects(value).filter((g) => isText(g.home_team) && isText(g.away_team) && g.home_team !== g.away_team) as unknown as GameRecord[];
}

/** The rows of a season table that can be a player: an object with a player id. */
function usablePlayers(value: unknown): Row[] {
  return objects(value).filter((r) => isText(r.player_id));
}

/**
 * Everything /matchup/[away]/[home] and its metadata need, as plain data
 * (spec §6.3). `awayId` / `homeId` are canonical team ids the route has
 * already checked; `requestedSeason` is a plausible season number or null
 * (none asked for).
 *
 * Two waves: the seasons and the slug list together, then the season's rows,
 * games and three player tables together.
 *
 * Core reads reject the load (the route's error.tsx, never an empty page):
 * the seasons, and the team_game_stats rows, including an answer for a season
 * that must have rows which is empty or holds nothing usable. Reads that may
 * degrade, each with one console.error: the games (no week, date, records or
 * order redirect), the three player tables as one block (no lineup at all,
 * never one with a position missing), and the slug list (names unlinked). A
 * may-degrade read that RESOLVES with the wrong kind of thing, or with nothing
 * usable where there must be something, degrades the same way (chaos F2, F6).
 */
export async function loadMatchup(awayId: string, homeId: string, requestedSeason: number | null): Promise<MatchupLoad> {
  const what = `Matchup (${awayId} at ${homeId})`;

  const weeksRead = getSeasonWeeksCached();
  const slugsRead = getPlayerSlugIndexCached();
  // If this load ends before it looks at the slug list (a failed seasons
  // read), a failure of that read must not go unhandled. The memo keeps it.
  slugsRead.catch(() => {});

  const weeks = await weeksRead;
  if (weeks.length === 0 && !hasNoDatabase()) {
    throw new Error(`${what}: no seasons from data_freshness (table empty)`);
  }
  const seasons = weeks.map((w) => w.season);
  const defaultSeason = seasons[0] ?? fallbackSeason();
  // A season the site does not list is the default season (decisions.md; not the share cards' 404).
  const season = requestedSeason !== null && seasons.includes(requestedSeason) ? requestedSeason : defaultSeason;
  const isLatestSeason = season === defaultSeason;

  // The promises are kept: failing an answer in its memo is done only while
  // the memo still holds the very promise this load read (failMemo).
  const rowsPromise = getMatchupRowsCached(season);
  const gamesPromise = getSeasonGamesCached(season);
  const tablePromise = {
    QB: getCompareTableCached("QB", season),
    RB: getCompareTableCached("RB", season),
    WR: getCompareTableCached("WR", season),
  };
  const [rowsRead, gamesRead, qbRead, rbRead, recRead, slugRead] = await Promise.allSettled([
    rowsPromise,
    gamesPromise,
    tablePromise.QB,
    tablePromise.RB,
    tablePromise.WR,
    slugsRead,
  ]);

  // Core: the rows.
  if (rowsRead.status === "rejected") throw rowsRead.reason;
  const rows = objects(rowsRead.value);
  /** A core answer that resolved but cannot be right: fail it in the memo too (ten seconds, not sixty), then throw. */
  const failRows = (message: string): never => {
    const err = new Error(`${what}: ${message}`);
    failMemo(rowsMemo, season, err, rowsPromise);
    throw err;
  };

  let uncovered: { firstSeason: number | null } | null = null;
  if (rows.length === 0) {
    // The rule of getTeamStatsSeason (lib/data/team-stats.ts): an empty read
    // throws when it can only mean a read failing silently.
    if (seasons.length === 0) {
      failRows(`no seasons from data_freshness and no team_game_stats rows for ${season}`);
    }
    if (season === seasons[0]) {
      failRows(`${season} is the newest season in data_freshness but has no team_game_stats rows; the read is failing silently`);
    }
    // Only on this path; a failed probe is a failed read (it rejects the load).
    const covered = await getBoxScoreSeasonsCached(seasons);
    if (covered.includes(season)) {
      failRows(`team_game_stats has rows for ${season} but the season read returned none; the read is failing silently`);
    }
    const first = covered.length > 0 ? Math.min(...covered) : null;
    uncovered = { firstSeason: first !== null && season < first ? first : null };
  } else {
    // Rows came back, but are any of them this season's rows of a team (chaos
    // F3)? The guard is on what the builders can use, not on the raw count:
    // rows of another season, or with no team, would otherwise be filtered to
    // nothing and render as "fewer than 8 teams have played".
    const usable = matchupSeasonRows(rows, season).filter((r) => isText(r.team_id));
    if (usable.length === 0) {
      failRows(`the season read returned ${rows.length} team_game_stats row(s) for ${season} but none of them is usable (another season's, or no team_id); the read is failing silently`);
    }
  }

  // The date the schedule rules compare against: per call, never memoised.
  const today = easternToday();

  // May degrade: the games. An empty (or wholly unusable) schedule for a
  // season that HAS stats is a failed read too (chaos F2): its games exist.
  let game: GameRecord | null = null;
  let swap = false;
  let records: MatchupLoadCommon["records"] = null;
  let gamesAvailable = false;
  if (gamesRead.status === "rejected") {
    console.error(`${what}: the games read failed for ${season}; no week, date, records or order redirect`, gamesRead.reason);
  } else {
    const games = usableGames(gamesRead.value);
    if (!Array.isArray(gamesRead.value) || (games.length === 0 && !uncovered)) {
      const err = new Error(`${what}: the games read for ${season} returned no usable game although the season has stats`);
      failMemo(gamesMemo, season, err, gamesPromise);
      console.error(`${what}: the games read returned nothing usable for ${season}; no week, date, records or order redirect`, err);
    } else {
      gamesAvailable = true;
      const found = findPairGame(games, awayId, homeId, today);
      game = found.game;
      swap = found.swap;
      records = { away: teamRecord(games, awayId), home: teamRecord(games, homeId) };
    }
  }

  // May degrade: the slug list (names render unlinked).
  let slugByPlayerId: SlugNames = new Map();
  if (slugRead.status === "rejected") {
    console.error(`${what}: the player slug list could not be read; names are unlinked`, slugRead.reason);
  } else if (!(slugRead.value instanceof Map)) {
    console.error(`${what}: the player slug list came back as something that is not a list; names are unlinked`);
  } else {
    slugByPlayerId = slugsByPlayerId(slugRead.value);
  }

  // May degrade, as one block: the three player tables. A table that is not a
  // list, or holds no usable row for a season the site has, is a failed read
  // too (the compare card's rule for an empty one), and is failed in the memo.
  let lineup: MatchupLineupRow[] | null = null;
  const tables = [
    { name: "QB", group: "QB", read: qbRead },
    { name: "RB", group: "RB", read: rbRead },
    { name: "receiver", group: "WR", read: recRead },
  ] as const;
  const players: Row[][] = [];
  const failed: string[] = [];
  let reason: unknown = "(empty or unusable)";
  for (const { name, group, read } of tables) {
    if (read.status === "rejected") {
      failed.push(name);
      reason = read.reason;
      continue;
    }
    const usable = usablePlayers(read.value);
    if (!Array.isArray(read.value) || (usable.length === 0 && !hasNoDatabase())) {
      failed.push(name);
      // The compare card shares this memo, so the message names no pair (PR 1 code review, nit 4).
      failCompareTable(
        group,
        season,
        new Error(`The ${name} season table for ${season} came back empty or unusable (marked failed by the matchup loader)`),
        tablePromise[group]
      );
      continue;
    }
    players.push(usable);
  }
  if (failed.length > 0) {
    console.error(
      `${what}: main players unavailable for ${season}: the ${failed.join(", ")} season table could not be read or came back empty`,
      reason
    );
  } else {
    const pick = (teamId: string) =>
      pickMainPlayers({
        teamId,
        season,
        defaultSeason,
        qbs: players[0] as unknown as QBSeasonStat[],
        rbs: players[1] as unknown as RBSeasonStat[],
        receivers: players[2] as unknown as ReceiverSeasonStat[],
        slugByPlayerId,
      });
    lineup = pairLineups(pick(awayId), pick(homeId));
  }

  const common: MatchupLoadCommon = {
    season,
    defaultSeason,
    isLatestSeason,
    swap,
    game,
    records,
    lineup,
    playersAvailable: lineup !== null,
    gamesAvailable,
  };
  if (uncovered) return { ...common, state: "uncovered", model: null, firstSeason: uncovered.firstSeason };

  const model = buildMatchup({ rows, season, awayId, homeId });
  return { ...common, state: model.state, model };
}

export interface MatchupIndexLoad {
  /** always the newest stats season */
  season: number;
  /** this week's games; null when the season has no unplayed game, or the games read failed */
  slate: { label: string; games: GameRecord[] } | null;
  gamesAvailable: boolean;
}

/**
 * What /matchup needs: the newest season, then its slate. The seasons read is
 * core (a failed read, or an empty list on a real database, rejects). The
 * games read may degrade: logged, `slate: null`, `gamesAvailable: false`, and
 * the page still renders its two pickers. That is honest only because
 * /matchup is rendered per request, so a degraded render is never stored
 * (spec §4.2, S1). An empty or unusable schedule for the newest stats season
 * is a failed read as well (chaos F2), never "no upcoming games".
 */
export async function loadMatchupIndex(): Promise<MatchupIndexLoad> {
  const weeks = await getSeasonWeeksCached();
  if (weeks.length === 0 && !hasNoDatabase()) {
    throw new Error("Matchup index: no seasons from data_freshness (table empty)");
  }
  const season = weeks[0]?.season ?? fallbackSeason();
  try {
    const gamesPromise = getSeasonGamesCached(season);
    const answer: unknown = await gamesPromise;
    const games = usableGames(answer);
    if (games.length === 0) {
      const err = new Error(`Matchup index: the games read for ${season} returned no usable game`);
      failMemo(gamesMemo, season, err, gamesPromise);
      throw err;
    }
    // The date is taken per call, so the memoised games never pin yesterday's slate.
    return { season, slate: currentSlate(games, easternToday()), gamesAvailable: true };
  } catch (err) {
    console.error(`Matchup index: the games read failed for ${season}; this week's games are not shown`, err);
    return { season, slate: null, gamesAvailable: false };
  }
}
