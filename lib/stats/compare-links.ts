// lib/stats/compare-links.ts
//
// The comparison share card's links and the words of the Share block: the part
// of lib/stats/compare-card.ts that the Compare page's BROWSER code needs
// (compare card PR 3). It imports nothing, on purpose: compare-card.ts builds
// the card's model and brings the stat card's and the team radar's modules
// with it, about 16 kB of JavaScript that /compare's visitors would download
// for a link and six strings. Server code may import from either file;
// compare-card.ts re-exports everything here, so there is still one place to
// look and one definition of each rule.

/* ─── URLs ─── */

/**
 * A player slug as scripts/ingest.py's make_slug (and its three collision
 * suffixes) can write one: lower-case letters and digits in groups joined by
 * single hyphens. Stricter than the player page's own check on purpose: an
 * upper-case letter, a dot or an apostrophe is not a card URL.
 */
export const COMPARE_SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;
export const COMPARE_SLUG_MAX_LENGTH = 100;

/**
 * The two players a share URL names, in the URL's order (A = left / solid,
 * B = right / dashed), or null: a slug outside the grammar, longer than 100
 * characters, or the same player twice. Reads nothing.
 */
export function parseCompareSlugs(a: unknown, b: unknown): { a: string; b: string } | null {
  const ok = (s: unknown): s is string =>
    typeof s === "string" && s.length >= 1 && s.length <= COMPARE_SLUG_MAX_LENGTH && COMPARE_SLUG_PATTERN.test(s);
  return ok(a) && ok(b) && a !== b ? { a, b } : null;
}

/** The weeks a season can have (18 regular-season weeks and the playoffs). */
export const COMPARE_MAX_WEEK = 22;

/** The one spelling of the image query: "" for none, else "?" + season, w, download in that order. */
export function canonicalImageQuery(season: number | null, week: number | null, download: boolean): string {
  const parts = [
    ...(season === null ? [] : [`season=${season}`]),
    ...(week === null ? [] : [`w=${week}`]),
    ...(download ? ["download=1"] : []),
  ];
  return parts.length === 0 ? "" : `?${parts.join("&")}`;
}

/** A week a season can have (1-22), or null: nothing else is ever printed as "Through Week N" or sent as `w`. */
export function compareWeek(week: unknown): number | null {
  return typeof week === "number" && Number.isInteger(week) && week >= 1 && week <= COMPARE_MAX_WEEK ? week : null;
}

/** The share page's path, order kept. */
export function compareCardPath(a: string, b: string): string {
  return `/card/compare/${a}/${b}`;
}

/** The share page for a season: bare for the default season, ?season= for another. */
export function compareCardHref(a: string, b: string, season: number, defaultSeason: number): string {
  return `${compareCardPath(a, b)}${season !== defaultSeason ? `?season=${season}` : ""}`;
}

/** The image route, always with the season; `week` only makes each week a new URL; `download` asks for an attachment. */
export function compareImageHref(
  a: string, b: string, season: number, options: { week?: number | null; download?: boolean } = {},
): string {
  return `/api/compare-card/${a}/${b}${canonicalImageQuery(season, compareWeek(options.week), options.download === true)}`;
}

/* ─── Sentences ─── */

/**
 * C10: a real pair with nothing to compare, because one or both have no row
 * for the season. For the newest season the stats may still come.
 */
export function compareNoStatsMessage(i: {
  nameA: string; nameB: string; missingA: boolean; missingB: boolean; season: number; isNewestSeason: boolean;
}): string {
  const both = i.missingA && i.missingB;
  const who = both ? `${i.nameA} and ${i.nameB}` : i.missingA ? i.nameA : i.nameB;
  const verb = both ? "have" : "has";
  return i.isNewestSeason
    ? `${who} ${verb} no ${i.season} stats yet, so there is nothing to compare. Comparisons update the day after each game.`
    : `${who} ${verb} no stats for the ${i.season} season, so there is nothing to compare.`;
}

/** C13 and C13b: the Share block on /compare. */
export const COMPARE_SHARE_HEADING = "Share this comparison";
export const COMPARE_OPEN_CARD_TEXT = "Open share card \u2192";
export const COMPARE_COPY_LINK_TEXT = "Copy Link";
export const COMPARE_COPIED_TEXT = "Copied!";
export const COMPARE_DOWNLOAD_TEXT = "Download Image";
/** On /compare the address bar holds the Compare page, not the card, so the advice differs from the card pages' own. */
export const COMPARE_COPY_FAILED_TEXT = "Copy failed: open the share card and copy its address";
