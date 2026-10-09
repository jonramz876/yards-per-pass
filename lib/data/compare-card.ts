// lib/data/compare-card.ts — what one comparison share card needs (compare
// card spec 2026-10-09 §4, §6.1; PR 2). Server-only: never import it from a
// "use client" file.
//
// Two loaders, one decision. The share page (and its metadata) and the image
// route read differently on purpose, then hand what they read to the same
// `decide`, so they cannot disagree about a pair's state:
//
//   loadCompareCardForPage   seasons + two per-player reads in one wave, then
//                            the season table. Its reads sit in Next's data
//                            cache (the page exports revalidate = 3600); the
//                            player reads are per PLAYER, shared with
//                            /card/[slug] and /player/[slug], never per pair.
//   loadCompareCardForImage  no per-pair read at all. About 850,000 ordered
//                            pairs are valid URLs, so the route resolves both
//                            players from a memoised list of every slug and the
//                            numbers from a memoised season table: zero database
//                            requests while the three memos are warm.
//
// A failed read rejects (the page shows its error page, the image answers 503):
// it is never a 404 and never an empty card.
import { getSeasonWeeks, getQBStats, fallbackSeason, type SeasonWeek } from "@/lib/data/queries";
import { getReceiverStats } from "@/lib/data/receivers";
import { getRBSeasonStats } from "@/lib/data/rushing";
import { getPlayerBySlug, getPlayerSlugIndex, type PlayerSlugEntry } from "@/lib/data/players";
import { memoised } from "@/lib/data/team-radar-card";
import { hasNoDatabase } from "@/lib/supabase/server";
import { compareGroup, type CompareGroup, type ComparePlayerRow } from "@/lib/stats/compare";
import { buildCompareCard, compareNoStatsMessage, type CompareCardModel } from "@/lib/stats/compare-card";

/** A player as both loaders know him. */
export interface ComparePlayerRef {
  slug: string;
  player_id: string;
  player_name: string | null;
  position: string | null;
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

const nameOf = (p: ComparePlayerRef): string => {
  const name = typeof p.player_name === "string" ? p.player_name.trim() : "";
  return name || p.slug.split("-").filter(Boolean).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
};

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
  return { season, defaultSeason, throughWeek: row?.through_week ?? null, listed: row !== undefined };
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
  const nameA = nameOf(a);
  const nameB = nameOf(b);

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
      a: { slug: a.slug, fullName: a.player_name, row: rowA },
      b: { slug: b.slug, fullName: b.player_name, row: rowB },
      all, season: when.season, throughWeek: when.throughWeek,
    }),
  };
}

/* ─── The share page ─── */

/**
 * The card for a share page URL. `slugs` have passed parseCompareSlugs and
 * `requested` is a plausible season or null. One wave (the seasons and both
 * players), then the season table.
 */
export async function loadCompareCardForPage(
  slugs: { a: string; b: string }, requested: number | null,
): Promise<CompareCardLoad> {
  const what = `Compare card page (${slugs.a} vs ${slugs.b})`;
  const [weeks, a, b] = await Promise.all([getSeasonWeeks(), getPlayerBySlug(slugs.a), getPlayerBySlug(slugs.b)]);
  const when = resolveSeason(weeks, requested, what);
  if ("state" in when) return when;
  if (!a || !b) return { state: "not-found", stored: false, why: `no player for ${!a ? slugs.a : slugs.b}` };
  return decide(what, { ...a, slug: slugs.a }, { ...b, slug: slugs.b }, when, readTable);
}

/* ─── The image route: three memos, no per-pair read ─── */

type Entry<T> = { at: number; promise: Promise<T> };
const weeksMemo = new Map<"seasons", Entry<SeasonWeek[]>>();
const slugsMemo = new Map<"slugs", Entry<Map<string, PlayerSlugEntry>>>();
const tableMemo = new Map<string, Entry<ComparePlayerRow[]>>();

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

/** The season table behind the one-minute memo, keyed by group and season. Call it only with a season already checked against data_freshness (or with no database): the keys must stay bounded. */
function readTableCached(group: CompareGroup, season: number): Promise<ComparePlayerRow[]> {
  return memoised(tableMemo, `${group}:${season}`, () => readTable(group, season));
}

/**
 * The card for an image URL. In order: the seasons (memo); the season is
 * checked BEFORE any player is looked up; the slug list (memo); the season
 * table (memo). Warm, that is no database request.
 */
export async function loadCompareCardForImage(
  slugs: { a: string; b: string }, requested: number | null,
): Promise<CompareCardLoad> {
  const what = `Compare card image (${slugs.a} vs ${slugs.b})`;
  const weeks = await memoised(weeksMemo, "seasons", () => getSeasonWeeks());
  const when = resolveSeason(weeks, requested, what);
  if ("state" in when) return when;

  const index = await memoised(slugsMemo, "slugs", () => getPlayerSlugIndex());
  if (index.size === 0 && !hasNoDatabase()) {
    // The read succeeded with no rows: never a minute of 404s for every player.
    throw new Error(`${what}: the player slug list came back empty`);
  }
  const a = index.get(slugs.a);
  const b = index.get(slugs.b);
  if (!a || !b) return { state: "not-found", stored: false, why: `no player for ${!a ? slugs.a : slugs.b}` };
  return decide(what, a, b, when, readTableCached);
}
