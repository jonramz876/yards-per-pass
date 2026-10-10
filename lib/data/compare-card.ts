// lib/data/compare-card.ts — what one comparison share card needs (compare
// card spec 2026-10-09 §4, §6.1; PR 2). Server-only: never import it from a
// "use client" file.
//
// ONE loader for the share page, its metadata and the image route, so the three
// cannot disagree about a pair's state, and NO read per slug or per pair:
// about 850,000 ordered pairs are valid URLs and any made-up slug is a URL too.
// Everything comes through three one-minute memos:
//
//   seasons   data_freshness (season + through_week)
//   slugs     every player slug (a narrow, ordered read of player_slugs)
//   GROUP:season   one season table per group, the season already checked
//
// Warm, a card costs no database request at all; a made-up slug is a 404 from
// the slug list in memory. A failed read rejects (the page shows its error
// page, the image answers 503), is never a 404 or an empty card, and is
// remembered for ten seconds (memoised), so a page view that runs the loader
// three times (metadata, body, and Next's error-page pass) reads once, and an
// outage is not retried at the visitor's rate.
//
// (Until chaos R1 / COST-1 the page read player_slugs once per slug in the URL
// instead: 200 made-up pairs were 400 requests, and a failed read was made
// twice per page view.)
import { getSeasonWeeks, getQBStats, fallbackSeason, type SeasonWeek } from "@/lib/data/queries";
import { getReceiverStats } from "@/lib/data/receivers";
import { getRBSeasonStats } from "@/lib/data/rushing";
import { getPlayerSlugIndex, type PlayerSlugEntry } from "@/lib/data/players";
import { memoised, type MemoEntry } from "@/lib/data/team-radar-card";
import { hasNoDatabase } from "@/lib/supabase/server";
import { compareDisplayName, compareGroup, type CompareGroup, type ComparePlayerRow } from "@/lib/stats/compare";
import { buildCompareCard, compareNoStatsMessage, compareWeek, type CompareCardModel } from "@/lib/stats/compare-card";

/** A player as both loaders know him. */
export interface ComparePlayerRef {
  slug: string;
  player_id: string;
  player_name: string | null;
  position: string | null;
  /** player_slugs' team today: only the colour fallback for a season row with no team. */
  current_team_id?: string | null;
}

export type CompareCardLoad =
  /**
   * No such card. `stored`: can this URL never be a card (two players of
   * different position groups, a kicker)? Then the image route lets the CDN
   * keep the 404. An unknown slug or a season the site lacks is not stored:
   * a rookie gets his row, and a season its data, at the next refresh.
   */
  | { state: "not-found"; stored: boolean; why: string }
  /** A real, comparable pair, but one or both have no row for the season: a message, never a card. */
  | {
      state: "no-stats";
      season: number;
      defaultSeason: number;
      throughWeek: number | null;
      nameA: string;
      nameB: string;
      missingA: boolean;
      missingB: boolean;
      message: string;
    }
  | { state: "ready"; season: number; defaultSeason: number; model: CompareCardModel };

/** The season table of a group: the loaders /compare's server path and the stat card use. */
function readTable(group: CompareGroup, season: number): Promise<ComparePlayerRow[]> {
  if (group === "QB") return getQBStats(season);
  if (group === "RB") return getRBSeasonStats(season);
  return getReceiverStats(season);
}

/** A player's name by the one chain /compare uses: full name, his season row's short name (when he has a row), a name from the slug, "Player N". */
const nameOf = (p: ComparePlayerRef, row: ComparePlayerRow | undefined, fallback: string): string =>
  compareDisplayName({ fullName: p.player_name, slug: p.slug }, (row as { player_name?: unknown } | undefined)?.player_name, fallback);

/**
 * The season a request means, or a "not-found" for one the site does not
 * have. `requested` is already a plausible season number or null (none
 * asked for: the newest). An empty list is a failed read on a real database.
 */
function resolveSeason(
  weeks: SeasonWeek[], requested: number | null, what: string,
): { season: number; defaultSeason: number; throughWeek: number | null; listed: boolean } | Extract<CompareCardLoad, { state: "not-found" }> {
  if (weeks.length === 0 && !hasNoDatabase()) {
    throw new Error(`${what}: no seasons from data_freshness (table empty)`);
  }
  if (requested !== null && weeks.length > 0 && !weeks.some((w) => w.season === requested)) {
    return { state: "not-found", stored: false, why: `season ${requested} is not in data_freshness` };
  }
  const defaultSeason = weeks[0]?.season ?? fallbackSeason();
  const season = requested ?? defaultSeason;
  const row = weeks.find((w) => w.season === season);
  // A week no season can have (bad data) is no week: it is never printed and never sent as `w`.
  return { season, defaultSeason, throughWeek: compareWeek(row?.through_week), listed: row !== undefined };
}

/** Everything after the players are known: the group check, the season table, the state. */
async function decide(
  what: string,
  a: ComparePlayerRef,
  b: ComparePlayerRef,
  when: { season: number; defaultSeason: number; throughWeek: number | null; listed: boolean },
  table: (group: CompareGroup, season: number) => Promise<ComparePlayerRow[]>,
): Promise<CompareCardLoad> {
  const group = compareGroup(a.position);
  if (group === null || group !== compareGroup(b.position)) {
    // Different stat tables, or a position with none (K, P, a defender): no
    // button makes this URL and it can never be a card.
    return { state: "not-found", stored: true, why: `${a.position ?? "?"} and ${b.position ?? "?"} are not comparable` };
  }
  if (a.player_id === b.player_id) {
    return { state: "not-found", stored: true, why: "both slugs name one player" };
  }

  const all = await table(group, when.season);
  if (all.length === 0 && when.listed && !hasNoDatabase()) {
    // A season the site has always has rows in the three season tables: an
    // empty answer is a failed read, not "nobody played".
    throw new Error(`${what}: the ${group} table returned no rows for ${when.season}, a season the site has`);
  }
  const rowA = all.find((r) => r.player_id === a.player_id);
  const rowB = all.find((r) => r.player_id === b.player_id);
  const nameA = nameOf(a, rowA, "Player 1");
  const nameB = nameOf(b, rowB, "Player 2");

  if (!rowA || !rowB) {
    const missing = { missingA: !rowA, missingB: !rowB };
    return {
      state: "no-stats", season: when.season, defaultSeason: when.defaultSeason, throughWeek: when.throughWeek,
      nameA, nameB, ...missing,
      message: compareNoStatsMessage({ nameA, nameB, ...missing, season: when.season, isNewestSeason: when.season === when.defaultSeason }),
    };
  }
  return {
    state: "ready", season: when.season, defaultSeason: when.defaultSeason,
    model: buildCompareCard({
      group,
      a: { slug: a.slug, fullName: a.player_name, row: rowA, teamId: a.current_team_id },
      b: { slug: b.slug, fullName: b.player_name, row: rowB, teamId: b.current_team_id },
      all, season: when.season, throughWeek: when.throughWeek,
    }),
  };
}

/* ─── Three memos, no per-pair read ─── */

const weeksMemo = new Map<"seasons", MemoEntry<SeasonWeek[]>>();
const slugsMemo = new Map<"slugs", MemoEntry<Map<string, PlayerSlugEntry>>>();
const tableMemo = new Map<string, MemoEntry<ComparePlayerRow[]>>();

/** Tests only: forget every memoised read. */
export function clearCompareCardMemo(): void {
  weeksMemo.clear();
  slugsMemo.clear();
  tableMemo.clear();
}

/** Tests only: the memo keys in use, to show nothing is ever keyed by a slug or a pair. */
export function compareCardMemoKeys(): string[] {
  return [...Array.from(weeksMemo.keys()), ...Array.from(slugsMemo.keys()), ...Array.from(tableMemo.keys())].sort();
}

/** The season table behind the memo, keyed by group and season. Call it only with a season already checked against data_freshness (or with no database): the keys must stay bounded. */
function readTableCached(group: CompareGroup, season: number): Promise<ComparePlayerRow[]> {
  return memoised(tableMemo, `${group}:${season}`, () => readTable(group, season));
}

/*
 * The three memoised reads, exported for /matchup (team matchup spec
 * 2026-10-10 §6.2) so both features share ONE memo: a matchup view warms the
 * compare card and the reverse. Each is the same memo call the loader below
 * makes, with the same key; no new key shape. What they return is shared
 * between callers: treat it as read-only.
 */

/** data_freshness (season + through_week, newest first) behind the `seasons` memo. */
export function getSeasonWeeksCached(): Promise<SeasonWeek[]> {
  return memoised(weeksMemo, "seasons", () => getSeasonWeeks());
}

/** Every player slug, by slug, behind the `slugs` memo. */
export function getPlayerSlugIndexCached(): Promise<Map<string, PlayerSlugEntry>> {
  return memoised(slugsMemo, "slugs", () => getPlayerSlugIndex());
}

/** One group's season table behind the `GROUP:season` memo. Only with a season already checked against data_freshness: the keys must stay bounded. */
export function getCompareTableCached(group: CompareGroup, season: number): Promise<ComparePlayerRow[]> {
  return readTableCached(group, season);
}

/**
 * Turn one season table's memoised answer into a failed read (team matchup
 * chaos F5). For a caller that found the answer unusable although the read
 * resolved (an empty table for a season the site has, rows that are not rows):
 * left alone it would be handed out for the full minute; marked, everyone gets
 * `err` for MEMO_FAILURE_TTL_MS (ten seconds) and then the table is read
 * again. Same key as the read, so no new key shape.
 */
export function failCompareTable(group: CompareGroup, season: number, err: Error): void {
  const promise = Promise.reject<ComparePlayerRow[]>(err);
  promise.catch(() => {});
  const now = Date.now();
  tableMemo.set(`${group}:${season}`, { at: now, promise, failedAt: now });
}

/**
 * The card for two slugs that have passed parseCompareSlugs and a season that
 * is plausible or null (none asked for: the newest). The seasons and the slug
 * list do not depend on each other, so both reads are STARTED together (code
 * review I3): on a slow database a cold instance waits once for the pair, not
 * twice in a row. The checks keep their order: the season is settled from the
 * seasons before the slug list's answer is looked at, so an unlisted season is
 * "not found" whatever the slug list read does. Then the season table. All
 * three through the memos.
 */
async function loadCompareCard(what: string, slugs: { a: string; b: string }, requested: number | null): Promise<CompareCardLoad> {
  const weeksRead = memoised(weeksMemo, "seasons", () => getSeasonWeeks());
  const indexRead = memoised(slugsMemo, "slugs", () => getPlayerSlugIndex());
  // If this request ends before it looks at the slug list (an unlisted season,
  // a failed seasons read), a failure of that read must not go unhandled. The
  // memo keeps it for the next caller either way.
  indexRead.catch(() => {});

  const weeks = await weeksRead;
  const when = resolveSeason(weeks, requested, what);
  if ("state" in when) return when;

  const index = await indexRead;
  if (index.size === 0 && !hasNoDatabase()) {
    // The read succeeded with no rows: never a minute of 404s for every player.
    throw new Error(`${what}: the player slug list came back empty`);
  }
  const a = index.get(slugs.a);
  const b = index.get(slugs.b);
  // Not stored anywhere per slug: a rookie is found as soon as the slug list is read again.
  if (!a || !b) return { state: "not-found", stored: false, why: `no player for ${!a ? slugs.a : slugs.b}` };
  return decide(what, a, b, when, readTableCached);
}

/** The card for a share page URL (and its metadata). */
export function loadCompareCardForPage(slugs: { a: string; b: string }, requested: number | null): Promise<CompareCardLoad> {
  return loadCompareCard(`Compare card page (${slugs.a} vs ${slugs.b})`, slugs, requested);
}

/** The card for an image URL. */
export function loadCompareCardForImage(slugs: { a: string; b: string }, requested: number | null): Promise<CompareCardLoad> {
  return loadCompareCard(`Compare card image (${slugs.a} vs ${slugs.b})`, slugs, requested);
}
