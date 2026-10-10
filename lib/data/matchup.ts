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
// per key per ten seconds, never the visitor's rate.
import { parseNumericFields } from "@/lib/utils";
import { fetchAllRows, queryError } from "@/lib/data/utils";
import { TEAM_GAME_NUMERIC, boxScoreDeadline, getBoxScoreSeasonsCached } from "@/lib/data/box-score";
import { getSeasonGames, type GameRecord } from "@/lib/data/games";
import { fallbackSeason } from "@/lib/data/queries";
import { getCompareTableCached, getPlayerSlugIndexCached, getSeasonWeeksCached } from "@/lib/data/compare-card";
import { memoised, type MemoEntry } from "@/lib/data/team-radar-card";
import type { PlayerSlugEntry } from "@/lib/data/players";
import { hasNoDatabase } from "@/lib/supabase/server";
import type { WinLossTie } from "@/lib/stats/box-score";
import {
  buildMatchup,
  currentSlate,
  findPairGame,
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
 * is loadMatchup's decision).
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
  return raw.map((r) => parseNumericFields(r, MATCHUP_NUMERIC) as unknown as MatchupGameRow);
}

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

/** player_id → slug and full name, built once per slug list (the memo hands every caller the same Map). */
const byPlayerId = new WeakMap<Map<string, PlayerSlugEntry>, Map<string, { slug: string; player_name: string }>>();
function slugsByPlayerId(index: Map<string, PlayerSlugEntry>): Map<string, { slug: string; player_name: string }> {
  let out = byPlayerId.get(index);
  if (!out) {
    out = new Map();
    index.forEach((entry) => {
      if (entry && typeof entry.player_id === "string" && entry.player_id !== "" && !out!.has(entry.player_id)) {
        out!.set(entry.player_id, { slug: entry.slug, player_name: entry.player_name });
      }
    });
    byPlayerId.set(index, out);
  }
  return out;
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
 * the seasons, and the team_game_stats rows, including an empty answer for a
 * season that must have rows. Reads that may degrade, each with one
 * console.error: the games (no week, date, records or order redirect), the
 * three player tables as one block (no lineup at all, never one with a
 * position missing), and the slug list (names unlinked).
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

  const [rowsRead, gamesRead, qbRead, rbRead, recRead, slugRead] = await Promise.allSettled([
    getMatchupRowsCached(season),
    getSeasonGamesCached(season),
    getCompareTableCached("QB", season),
    getCompareTableCached("RB", season),
    getCompareTableCached("WR", season),
    slugsRead,
  ]);

  // Core: the rows.
  if (rowsRead.status === "rejected") throw rowsRead.reason;
  const rows = rowsRead.value;

  let uncovered: { firstSeason: number | null } | null = null;
  if (rows.length === 0) {
    // The rule of getTeamStatsSeason (lib/data/team-stats.ts): an empty read
    // throws when it can only mean a read failing silently.
    if (seasons.length === 0) {
      throw new Error(`${what}: no seasons from data_freshness and no team_game_stats rows for ${season}`);
    }
    if (season === seasons[0]) {
      throw new Error(
        `${what}: ${season} is the newest season in data_freshness but has no team_game_stats rows; the read is failing silently`
      );
    }
    // Only on this path; a failed probe is a failed read (it rejects the load).
    const covered = await getBoxScoreSeasonsCached(seasons);
    if (covered.includes(season)) {
      throw new Error(
        `${what}: team_game_stats has rows for ${season} but the season read returned none; the read is failing silently`
      );
    }
    const first = covered.length > 0 ? Math.min(...covered) : null;
    uncovered = { firstSeason: first !== null && season < first ? first : null };
  }

  // May degrade: the games.
  let game: GameRecord | null = null;
  let swap = false;
  let records: MatchupLoadCommon["records"] = null;
  const gamesAvailable = gamesRead.status === "fulfilled";
  if (gamesRead.status === "fulfilled") {
    const found = findPairGame(gamesRead.value, awayId, homeId);
    game = found.game;
    swap = found.swap;
    records = { away: teamRecord(gamesRead.value, awayId), home: teamRecord(gamesRead.value, homeId) };
  } else {
    console.error(`${what}: the games read failed for ${season}; no week, date, records or order redirect`, gamesRead.reason);
  }

  // May degrade: the slug list (names render unlinked).
  let slugByPlayerId: Map<string, { slug: string; player_name: string }> = new Map();
  if (slugRead.status === "fulfilled") {
    slugByPlayerId = slugsByPlayerId(slugRead.value);
  } else {
    console.error(`${what}: the player slug list could not be read; names are unlinked`, slugRead.reason);
  }

  // May degrade, as one block: the three player tables. An empty table for a
  // season the site has is a failed read too (the compare card's rule).
  let lineup: MatchupLineupRow[] | null = null;
  const tables = [["QB", qbRead], ["RB", rbRead], ["receiver", recRead]] as const;
  const failed = tables.filter(([, read]) => read.status === "rejected" || (read.value.length === 0 && !hasNoDatabase()));
  if (failed.length > 0) {
    const first = failed[0][1];
    console.error(
      `${what}: main players unavailable for ${season}: the ${failed.map(([name]) => name).join(", ")} season table could not be read or came back empty`,
      first.status === "rejected" ? first.reason : "(empty)"
    );
  } else if (qbRead.status === "fulfilled" && rbRead.status === "fulfilled" && recRead.status === "fulfilled") {
    const pick = (teamId: string) =>
      pickMainPlayers({
        teamId,
        season,
        defaultSeason,
        qbs: qbRead.value as QBSeasonStat[],
        rbs: rbRead.value as RBSeasonStat[],
        receivers: recRead.value as ReceiverSeasonStat[],
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

  const model = buildMatchup({ rows: rows as unknown as Record<string, unknown>[], season, awayId, homeId });
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
 * (spec §4.2, S1).
 */
export async function loadMatchupIndex(): Promise<MatchupIndexLoad> {
  const weeks = await getSeasonWeeksCached();
  if (weeks.length === 0 && !hasNoDatabase()) {
    throw new Error("Matchup index: no seasons from data_freshness (table empty)");
  }
  const season = weeks[0]?.season ?? fallbackSeason();
  try {
    const games = await getSeasonGamesCached(season);
    return { season, slate: currentSlate(games), gamesAvailable: true };
  } catch (err) {
    console.error(`Matchup index: the games read failed for ${season}; this week's games are not shown`, err);
    return { season, slate: null, gamesAvailable: false };
  }
}
