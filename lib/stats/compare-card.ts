// lib/stats/compare-card.ts
//
// The comparison share card (compare card spec 2026-10-09, PR 2): everything
// about it that is not a database read and not a drawing. URL grammar, the
// card's model (who, which colours, which numbers, which sentences), every
// sentence, and the image's layout numbers.
//
// Pure, like lib/stats/compare.ts, which does the maths: no React, no Next, no
// Supabase, nothing from lib/data except the static team list (the purity
// test in __tests__/stats/compare.test.ts walks this file's imports too). The
// share page, its metadata and the image route all build ONE model with
// buildCompareCard and print from it, so the three cannot disagree, and every
// number on the card is buildComparison's: the same as on /compare.
import type { QBSeasonStat, ReceiverSeasonStat, RBSeasonStat } from "@/lib/types";
import { getTeam } from "@/lib/data/teams";
import {
  buildComparison, comparePoolSentence, compareTooFewSentence, compareSmallSampleSentence,
  compareNotDrawnSentences, compareRadarIsDrawn, comparePlotColors, COMPARE_RADAR_LEGEND,
  type CompareGroup, type ComparePlayerRow, type Comparison, type ComparisonTableRow,
} from "@/lib/stats/compare";
import { buildQBCardData, buildWRCardData, buildRBCardData } from "@/lib/stats/tecmo-card";
import { RADAR_CARD_SITE_LINE } from "@/lib/stats/team-radar";
import { parseSeasonParam } from "@/lib/stats/team-stats";
import { textColorForBackground } from "@/lib/stats/formatters";
import {
  COMPARE_SLUG_MAX_LENGTH, canonicalImageQuery, compareCardPath, compareWeek,
} from "@/lib/stats/compare-links";

// The links and the Share block's words live in compare-links.ts, a module
// with no imports, so the Compare page's browser code can use them without
// downloading the card's model code. Everything is re-exported here.
export {
  COMPARE_SLUG_PATTERN, COMPARE_SLUG_MAX_LENGTH, COMPARE_MAX_WEEK,
  parseCompareSlugs, canonicalImageQuery, compareWeek, compareCardPath, compareCardHref, compareImageHref,
  compareNoStatsMessage,
  COMPARE_SHARE_HEADING, COMPARE_OPEN_CARD_TEXT, COMPARE_COPY_LINK_TEXT, COMPARE_COPIED_TEXT, COMPARE_DOWNLOAD_TEXT,
  COMPARE_COPY_FAILED_TEXT,
} from "@/lib/stats/compare-links";

/* ─── URLs ─── */

/**
 * The query string of a URL as the handler received it, "?" included; "" when
 * the URL has none. (`new URL(...).search` is "" for a bare "?" as well; note
 * that Next rebuilds req.url from the parsed URL, so in production a bare "?"
 * has usually gone before a handler sees it.)
 */
export function rawQueryOf(url: string): string {
  const text = String(url ?? "");
  const hash = text.indexOf("#");
  const path = hash === -1 ? text : text.slice(0, hash);
  const q = path.indexOf("?");
  return q === -1 ? "" : path.slice(q);
}

/**
 * The image route's query, or null for anything but its one exact form AND
 * spelling. `raw` is the query string exactly as typed, "?" included
 * (rawQueryOf(req.url)); "" when the URL has none.
 *
 * Every distinct URL is its own CDN entry and its own render, so the route
 * draws only for: no query, or `season` (four digits, 1999-2100), `w` (1-22,
 * no leading zero; ignored, it only makes each week a new URL) and
 * `download=1`, each at most once, no other key, IN THAT ORDER, and spelled
 * exactly as the share page prints them: "?&", a trailing "&",
 * percent-encoded digits or another key order are other spellings of the same
 * picture and are refused. This rule is this route's ONLY: the live team
 * radar image route keeps reading its parsed query in any order until the
 * rule has been seen working on Vercel here (code review I1). `w` is never tied to the current week: the page
 * (cached up to an hour) and the image (a minute) can be a week apart, and a
 * link the page printed must not become a stored 404.
 */
export function parseCompareImageQuery(raw: string): { season: number | null; download: boolean } | null {
  if (typeof raw !== "string") return null;
  const seen = new Set<string>();
  let season: number | null = null;
  let week: number | null = null;
  let download = false;
  for (const [key, value] of Array.from(new URLSearchParams(raw).entries())) {
    if (seen.has(key)) return null;
    seen.add(key);
    if (key === "season") {
      if (!/^\d{4}$/.test(value)) return null;
      season = parseSeasonParam(value);
      if (season === null) return null;
    } else if (key === "w") {
      if (!/^[1-9]\d?$/.test(value)) return null;
      week = compareWeek(Number(value));
      if (week === null) return null;
    } else if (key === "download") {
      if (value !== "1") return null;
      download = true;
    } else {
      return null;
    }
  }
  return raw === canonicalImageQuery(season, week, download) ? { season, download } : null;
}

/**
 * The canonical path: the two slugs in alphabetical order, so the two mirrored
 * pages of a pair name one. It differs from og:url (the page's own order) on
 * purpose, and only matters if these pages are ever indexed.
 */
export function compareCanonicalPath(a: string, b: string): string {
  const [first, second] = [a, b].sort();
  return compareCardPath(first, second);
}

/** The downloaded file's name. Only what the slug grammar allows survives: it goes into a header value. */
export function compareDownloadFilename(a: string, b: string, season: number): string {
  const safe = (s: string) => String(s ?? "").replace(/[^a-z0-9-]/g, "").slice(0, COMPARE_SLUG_MAX_LENGTH) || "player";
  return `${safe(a)}-vs-${safe(b)}-${Math.trunc(Number(season)) || 0}.png`;
}

/** The Compare page for the same pair and season. */
export function compareToolHref(a: string, b: string, season: number, defaultSeason: number): string {
  return `/compare?p1=${a}&p2=${b}${season !== defaultSeason ? `&season=${season}` : ""}`;
}

/** A player's own stat card page for the season. */
export function compareStatCardHref(slug: string, season: number, defaultSeason: number): string {
  return `/card/${slug}${season !== defaultSeason ? `?season=${season}` : ""}`;
}

/* ─── The rows on the card ─── */

/** Seven of the Compare table's rows per group, by key: the ones the card has room for. */
export const CARD_STAT_KEYS: Record<CompareGroup, readonly string[]> = {
  QB: ["passing_yards", "touchdowns", "interceptions", "epa_per_db", "cpoe", "any_a", "fantasy_pts"],
  WR: ["targets", "receptions", "receiving_yards", "receiving_tds", "epa_per_target", "croe", "fantasy_pts"],
  RB: ["carries", "rushing_yards", "rushing_tds", "yards_per_carry", "epa_per_carry", "success_rate", "fantasy_pts"],
};

/* ─── Colours ─── */

// The card's two colours are buildComparison's own (comparePlotColors in
// lib/stats/compare.ts): /compare and the card draw a player in one colour.
export { comparePlotColors };

/* ─── Sentences (the spec's copy table; each has a test) ─── */

/** C1: the share page's <title>, used as `absolute` (the site name is already in it). */
export function compareShareTitle(nameA: string, nameB: string, season: number): string {
  return `${nameA} vs ${nameB} — ${season} — Yards Per Pass`;
}

/** C1b: og:title and twitter:title. No season and no site name: X prints it over the picture. */
export function comparePreviewTitle(nameA: string, nameB: string): string {
  return `${nameA} vs ${nameB}`;
}

/** C18: /compare's <title> for a pair. A plain title: the layout's template adds the site name. */
export function compareToolTitle(nameA: string, nameB: string): string {
  return `${nameA} vs ${nameB} — Player Comparison`;
}

/** The page's visible heading and the plate's: the pair and the season. */
export function compareShareHeading(nameA: string, nameB: string, season: number): string {
  return `${nameA} vs ${nameB} — ${season}`;
}

/** C3: the season line of the sub-band. */
export function compareSeasonLine(season: number, throughWeek: number | null): string {
  const week = compareWeek(throughWeek);
  return week !== null ? `${season} season · Through Week ${week}` : `${season} season`;
}

/** C7: one sentence per radar axis neither player has data for. */
export function compareMissingAxisNote(axisLabel: string, season: number): string {
  return `${axisLabel} is not available for ${season}.`;
}

/** C8, short form: the site name in the sub-band. The long form is the team radar card's RADAR_CARD_SITE_LINE. */
export const COMPARE_CARD_SITE_SHORT = "YARDSPERPASS.COM";
export const COMPARE_CARD_SITE_LINE = RADAR_CARD_SITE_LINE;

/** C9: the table's middle header. */
export const COMPARE_CARD_STAT_HEADER = "STAT";

/** C12: the links under the card. */
export const COMPARE_FULL_LINK_TEXT = "See the full comparison →";
export function compareStatCardLinkText(name: string): string {
  return `${name} stat card →`;
}

/** C14: the image route's 503 body. */
export const COMPARE_IMAGE_UNAVAILABLE = "Comparison image temporarily unavailable. Try again in a few minutes.";

/** C15: the 404 title, used as `absolute`. */
export const COMPARE_NOT_FOUND_TITLE = "Comparison Not Found — Yards Per Pass";

/** C16: the preview image's alt text. */
export function compareImageAlt(nameA: string, nameB: string, season: number): string {
  return `${nameA} vs ${nameB} comparison card, ${season}`;
}

/** The OVR badge: the stat card's number, or a dash for a player under the line. */
export function compareOvrText(ovr: number | null): string {
  return ovr == null || !Number.isFinite(ovr) ? "—" : String(ovr);
}
/**
 * The badge number's size in the pixel font (one em per character, in a badge
 * 76 px wide): 24 px for up to two characters, 18 px for three (an OVR of
 * 100), so the number never runs edge to edge.
 */
export function compareOvrFontSize(text: string): number {
  return String(text).length >= 3 ? 18 : 24;
}
export const COMPARE_OVR_LABEL = "OVR";
export const COMPARE_VS_LABEL = "VS";

/* ─── The card's model ─── */

export interface CompareCardPlayer {
  slug: string;
  /** His full name (player_slugs); the band prints it. */
  fullName: string;
  /** The name over his table column: the season row's short name, or his full name when the two short names are equal or one is missing. */
  headerName: string;
  /** The season row's position ("QB", "WR", "TE", "RB"). */
  position: string;
  /** The team he played for THAT season (the season row's team), never today's. */
  teamId: string;
  teamName: string;
  games: number | null;
  /** "QB · Buffalo Bills · 4 games". */
  meta: string;
  /** The stat card's OVR for the season; null (printed as a dash) for a player under the line. */
  ovr: number | null;
  /** His line colour: the band half, the outline, the table's line sample. Always #RRGGBB. */
  color: string;
  /** Black or white, whichever reads on `color`. */
  textColor: string;
}

export interface CompareCardModel {
  group: CompareGroup;
  season: number;
  throughWeek: number | null;
  a: CompareCardPlayer;
  b: CompareCardPlayer;
  /** buildComparison's output for the pair: what /compare shows, colours included. */
  comparison: Comparison;
  /** Is any outline drawn? No when a pool is too small or both players have too few radar stats. */
  radarDrawn: boolean;
  /** The seven card rows, in the card's order: buildComparison's rows, picked by CARD_STAT_KEYS. */
  rows: ComparisonTableRow[];
  /** C3. */
  seasonLine: string;
  /** C4, or null when no radar is drawn. */
  poolLine: string | null;
  /** C4z, or null. */
  tooFewLine: string | null;
  /** C6 with " OVR hidden.", or null. */
  smallSampleLine: string | null;
  /** C4m, one per player whose outline is left out. */
  notDrawnLines: string[];
  /** C7, one per axis neither player has. */
  missingAxisNotes: string[];
  /** The image's one full-width line under the body: the small-sample line (it also explains a dash in an OVR badge), or null. */
  stripLine: string | null;
  /**
   * The image's line under the radar: the legend (C5), or, when one player's
   * outline is left out, the sentence that says so (C4m) in its place: a
   * reader who sees one outline needs that more than the legend. (With both
   * left out there is no radar and the sentences stand where it would be.)
   */
  paneLine: string;
  /** The sub-band's left text: C3, then C4 when a radar is drawn. */
  subBandLine: string;
}

/** What the builder needs to know about each player beyond his season row. */
export interface CompareCardPlayerInput {
  slug: string;
  /** player_slugs.player_name; a missing one falls back to the short name, then the slug. */
  fullName: string | null | undefined;
  row: ComparePlayerRow;
}

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
const titleFromSlug = (slug: string): string =>
  slug.split("-").filter(Boolean).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");

function ovrFor(group: CompareGroup, row: ComparePlayerRow, all: ComparePlayerRow[], season: number): number | null {
  const card =
    group === "QB" ? buildQBCardData(row as QBSeasonStat, all as QBSeasonStat[], season)
      : group === "RB" ? buildRBCardData(row as RBSeasonStat, all as RBSeasonStat[], season)
        : buildWRCardData(row as ReceiverSeasonStat, all as ReceiverSeasonStat[], season);
  return typeof card.ovr === "number" && Number.isFinite(card.ovr) ? card.ovr : null;
}

/**
 * The whole card for two players who both have a row in the season table
 * `all`. Throws what buildComparison throws for an unknown group or a missing
 * row: callers check compareGroup and the rows first.
 */
export function buildCompareCard(input: {
  group: CompareGroup;
  a: CompareCardPlayerInput;
  b: CompareCardPlayerInput;
  all: ComparePlayerRow[];
  season: number;
  throughWeek: number | null;
}): CompareCardModel {
  const { group, all, season } = input;
  const throughWeek = compareWeek(input.throughWeek);
  const rec = (p: CompareCardPlayerInput) => (p.row ?? {}) as unknown as Record<string, unknown>;
  const teamIdA = str(rec(input.a).team_id);
  const teamIdB = str(rec(input.b).team_id);

  const comparison = buildComparison({ group, rowA: input.a.row, rowB: input.b.row, all, teamA: teamIdA, teamB: teamIdB });
  const colors = { a: comparison.a.color, b: comparison.b.color };

  const fullName = (p: CompareCardPlayerInput, short: string, fallback: string) =>
    str(p.fullName) || short || titleFromSlug(str(p.slug)) || fallback;
  const fullA = fullName(input.a, comparison.a.shortName, "Player 1");
  const fullB = fullName(input.b, comparison.b.shortName, "Player 2");
  const useFull = !comparison.a.shortName || !comparison.b.shortName || comparison.a.shortName === comparison.b.shortName;

  const player = (
    p: CompareCardPlayerInput, side: "a" | "b", full: string, teamId: string, color: string,
  ): CompareCardPlayer => {
    const c = comparison[side];
    const rowPosition = str(rec(p).position);
    const position = group === "QB" ? "QB" : rowPosition || (group === "RB" ? "RB" : "WR");
    const teamName = getTeam(teamId)?.name ?? teamId;
    const games = c.games;
    const meta = [position, teamName, games === null ? "" : `${games} ${games === 1 ? "game" : "games"}`].filter(Boolean).join(" · ");
    return {
      slug: p.slug, fullName: full, headerName: useFull ? full : c.shortName, position, teamId, teamName, games, meta,
      ovr: ovrFor(group, p.row, all, season), color, textColor: textColorForBackground(color),
    };
  };
  const a = player(input.a, "a", fullA, teamIdA, colors.a);
  const b = player(input.b, "b", fullB, teamIdB, colors.b);

  const names = [{ fullName: fullA, slug: input.a.slug }, { fullName: fullB, slug: input.b.slug }] as const;
  const rows = CARD_STAT_KEYS[group].flatMap((key) => comparison.rows.filter((r) => r.key === key));
  const seasonLine = compareSeasonLine(season, throughWeek);
  const poolLine = comparePoolSentence(comparison);
  const smallSampleLine = compareSmallSampleSentence(comparison, names[0], names[1], { ovrHidden: true });
  const notDrawnLines = compareNotDrawnSentences(comparison, names[0], names[1]);
  const radarDrawn = compareRadarIsDrawn(comparison);
  const missingAxisNotes = radarDrawn
    ? comparison.axes.flatMap((axis, i) =>
      (comparison.a.missing[i] && comparison.b.missing[i] ? [compareMissingAxisNote(axis.label, season)] : []))
    : [];

  return {
    group, season, throughWeek, a, b, comparison, radarDrawn, rows,
    seasonLine, poolLine, tooFewLine: compareTooFewSentence(comparison),
    smallSampleLine, notDrawnLines, missingAxisNotes,
    stripLine: smallSampleLine,
    paneLine: radarDrawn && notDrawnLines.length > 0 ? notDrawnLines[0] : COMPARE_RADAR_LEGEND,
    subBandLine: poolLine ? `${seasonLine} · ${poolLine}` : seasonLine,
  };
}

/** C2: the page's description. */
export function compareShareDescription(m: CompareCardModel): string {
  const who = (p: CompareCardPlayer) => `${p.fullName} (${p.position}, ${p.teamName})`;
  const when = m.throughWeek != null ? `${m.season} through Week ${m.throughWeek}` : `${m.season}`;
  return `${who(m.a)} vs ${who(m.b)}, ${when}: overlaid radar and head-to-head stats.`;
}

/* ─── The image's layout (1200 x 630), top to bottom ─── */

/**
 * X draws the link's title in a dark label over the bottom-left of the image;
 * on a phone it can reach most of the way across. Nothing a reader needs is
 * below this line, at any x: only the site line is.
 */
export const COMPARE_CARD_KEEP_CLEAR_Y = 546;

export const COMPARE_CARD_LAYOUT = {
  width: 1200,
  height: 630,
  /** The two-colour name band. */
  band: 92,
  /** The dark rule under it. */
  rule: 4,
  /** Season, pool line and site name. */
  subBand: 32,
  /** Radar (left) and table (right). */
  body: 390,
  /** The one full-width line: small sample, or a missing outline. */
  strip: 28,
  /** Kept clear: the site line only. 84 px (108 until the chaos pass: the body got the other 24). */
  footer: 84,
  /** Side padding of the card. */
  pad: 36,
  /** The radar pane's width; the table takes the rest. */
  pane: 590,
  /** The radar inside the pane (pane coordinates): centre, outer radius, label gap. */
  radar: { cx: 295, cy: 183, r: 140, gap: 18, labelFont: 17, labelHeight: 22, stroke: 3.5, dot: 5 },
  /** The legend line at the bottom of the pane. */
  legend: { height: 24, font: 13 },
  /** The table: header height, row height, rows. */
  table: { head: 40, row: 50, rows: 7 },
  /** The width a band name may take before it is cut (never under the OVR badge). */
  nameBox: 430,
} as const;

/** The band name's pixel-font size: a long name needs a smaller one to stay on its line. */
export function compareNameFontSize(length: number): number {
  return length <= 21 ? 20 : length <= 26 ? 16 : 13;
}
