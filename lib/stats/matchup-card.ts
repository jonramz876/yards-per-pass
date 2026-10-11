// lib/stats/matchup-card.ts — the matchup share card's pure half (matchup card
// spec 2026-10-11 §4, §6.1, §6.3, §6.4, §7, §9).
//
// One 1200×630 picture per game: both overlay radars side by side, each team
// in ONE colour of its own, the stat and the league rank for both units on
// every spoke. This module holds everything about it that is not a database
// read and not a drawing: the image query and the hrefs, the ONE model the
// image, the share page and both metadata functions print (so the three cannot
// disagree), the layout numbers, and every sentence.
//
// Pure: no React, no Next, no Supabase, nothing imported out of the data
// folder (a test walks the imports). The loader's answer is described here by
// MatchupCardLoad, the part of it this module reads. Server-side only: browser
// code takes the share links and words out of matchup-links.ts, never this
// file (it brings the team stat modules with it).
import type { Team } from "@/lib/types";
import { formatRecord, normalizeGameType, type WinLossTie } from "@/lib/stats/box-score";
import { EM_DASH, textColorForBackground } from "@/lib/stats/formatters";
import { canonicalImageQuery, compareWeek } from "@/lib/stats/compare-links";
import { parseCompareImageQuery } from "@/lib/stats/compare-card";
import { parseMatchupSeason } from "@/lib/stats/matchup-links";
import {
  MATCHUP_NO_OVERLAY_NOTE,
  MATCHUP_SMALL_POOL_NOTE,
  OVERLAY_LABELS,
  formatKickoff,
  gameWeekLabel,
  matchupNoGameText,
  matchupNoGamesNote,
  matchupUncoveredHeading,
  type MatchupGame,
  type MatchupModel,
  type OverlayModel,
} from "@/lib/stats/matchup";
import {
  MATCHUP_RING_GREY,
  matchupCardColours,
  type MatchupCardColours,
  type MatchupColourSource,
} from "@/lib/stats/matchup-colours";
import {
  RADAR_AXES,
  fmtRadarPct,
  plottableScore,
  radarAngle,
  radarPoint,
  radarRadius,
  spokeRankLabel,
  type RadarAxisKey,
  type RadarGeometry,
  type RadarSpoke,
} from "@/lib/stats/team-radar";

// The share page's path and href and the Share block's words live in
// matchup-links.ts (a module with no imports, for the browser); the image
// query's raw-string helper is the compare card's. Re-exported: one place to look.
export {
  matchupCardPath, matchupCardHref,
  MATCHUP_SHARE_HEADING, MATCHUP_COPY_LINK_TEXT, MATCHUP_COPIED_TEXT, MATCHUP_DOWNLOAD_TEXT, MATCHUP_OPEN_CARD_TEXT,
  MATCHUP_COPY_FAILED_TEXT,
} from "@/lib/stats/matchup-links";
export { rawQueryOf } from "@/lib/stats/compare-card";

/* ─── URLs (§4.2 row 3, §4.3) ─── */

/**
 * The image route's query, or null for anything but its one spelling. `raw`
 * is the query string exactly as typed, "?" included (rawQueryOf(req.url)).
 * The compare card's rule, as it is: nothing, or `season` (four digits,
 * 1999-2100), then `w` (1-22, no leading zero; it only makes each week a new
 * URL), then `download=1`, once each, no other key, in that order.
 */
export function parseMatchupImageQuery(raw: string): { season: number | null; download: boolean } | null {
  return parseCompareImageQuery(raw);
}

/** A team id as it may appear in a header value: its letters, upper-cased, three at most. */
function safeId(id: unknown): string {
  return String(id ?? "").replace(/[^A-Za-z]/g, "").slice(0, 3).toUpperCase() || "TEAM";
}

/**
 * The image route, away first, with the season; `week` (1-22 only) makes each
 * week a new URL; `download` asks for an attachment. The ids are the caller's
 * validated upper-case ones.
 *
 * A season the route's own parser would refuse (not a whole number from 1999
 * to 2100: matchupCardHref's guard) is left out, never printed: the URL then
 * names no season, which the route reads as the newest, instead of being a
 * link the site printed that answers a stored 404 (chaos F5). Callers pass
 * `load.season`, so this does not happen today.
 */
export function matchupCardImageHref(
  awayId: string, homeId: string, season: number, options: { week?: number | null; download?: boolean } = {},
): string {
  const named = typeof season === "number" && Number.isSafeInteger(season) && parseMatchupSeason(String(season)) === season;
  const query = canonicalImageQuery(named ? season : null, compareWeek(options?.week), options?.download === true);
  return `/api/matchup-card/${awayId}/${homeId}${query}`;
}

/** The downloaded file's name: "BUF-at-LA-2026-matchup.png", "-vs-" when the pair has no game. */
export function matchupCardDownloadFilename(awayId: string, homeId: string, season: number, hasGame: boolean): string {
  return `${safeId(awayId)}-${hasGame ? "at" : "vs"}-${safeId(homeId)}-${Math.trunc(Number(season)) || 0}-matchup.png`;
}

/* ─── Layout (§6.3, §6.4). Every number the drawing needs, in one place. ─── */

/**
 * The 1200×630 card, top to bottom: band, rule, sub-band, body, footer (their
 * heights sum to 630). The plate keeps the same five blocks.
 */
export const MATCHUP_CARD_LAYOUT = {
  width: 1200,
  height: 630,
  /** two halves in the two card colours */
  band: 76,
  /** the 5 px rule under the band, each half in that team's colour not in use */
  rule: 5,
  subBand: 32,
  body: 397,
  footer: 120,
  /** one band half, and one rule half */
  half: 600,
  /** left and right padding of the band, the sub-band and the footer */
  padX: 40,
  /** the team name's box in a band half (Press Start 2P, nowrap, cut at its end) */
  // 40 tall, as the compare card's: the pixel font's glyphs sit high in their
  // line on the live renderer, and a 32 px box cut their tops off (seen live).
  nameBox: { width: 520, height: 40 },
  /** the AT / VS box over the seam */
  seam: { left: 568, top: 11, width: 64, height: 54 },
  /**
   * the sub-band's left line: its max-width beside K4, and alone (a playoff
   * game). 512, not the mockup's 500: the widest regular-season line there can
   * be is 498.5 px (a test searches for it), and 512 + K4's 432 + the site
   * name's 160 = 1,104 of the 1,120 between the paddings, so the three items
   * cannot meet even at their caps
   */
  subLineMaxWidth: 512,
  subLineMaxWidthAlone: 900,
  /** a pane: a legend row, then the radar area */
  pane: { width: 599, legend: 34, radar: 363 },
  /** between the two panes */
  divider: 2,
  /** a spoke label: a fixed column of three rows (name, offense line, defense line) */
  label: { height: 60, rows: [18, 21, 21], nameSize: 14, statSize: 17, mark: 11, markGap: 6, topWidth: 180 },
  /**
   * the vertex markers as drawn: an offense dot (radius, stroke width) and a
   * defense square (half-side, stroke width). A 1st-place square on Pass
   * success or Explosive run ends 1.02 px from that spoke's own label box (a
   * test holds 1 px), so none of the four may grow without re-deriving the boxes
   */
  marker: { dot: 6, dotStroke: 1.3, square: 5.5, squareStroke: 2.6 },
  /** the sentence of a pane that cannot be drawn, and of a plate */
  paneMessageWidth: 460,
  plateMessageWidth: 900,
} as const;

/**
 * Nothing a reader needs is below this line (band + rule + sub-band + body):
 * X's title label covers the bottom of a shared picture. The lowest label box
 * ends half a pixel above it, so any change to the block heights above, to
 * the radar's cy / r / gap or to the label height must re-derive the boxes
 * (spec §6.4; the geometry test fails first).
 */
export const MATCHUP_CARD_KEEP_CLEAR_Y = 510;

/** Where a pane's radar area starts on the card: under the band, the rule, the sub-band and the legend row. */
export const MATCHUP_CARD_PANE_TOP =
  MATCHUP_CARD_LAYOUT.band + MATCHUP_CARD_LAYOUT.rule + MATCHUP_CARD_LAYOUT.subBand + MATCHUP_CARD_LAYOUT.pane.legend;

/** The radar inside one pane (pane coordinates), for radarPoint / radarAngle / radarPathD. */
export const MATCHUP_CARD_RADAR: RadarGeometry = { w: 599, h: 363, cx: 300, cy: 189, r: 116, gap: 10, lh: 21, f: 17, sw: 1.5, dot: 6 };

export interface MatchupCardLabelBox {
  left: number;
  top: number;
  width: number;
  height: number;
  /** how each of the three rows is aligned inside the box */
  align: "start" | "center" | "end";
}

/**
 * Spoke `i`'s label box in pane coordinates, from the point at r + gap on the
 * spoke: to its right on the right-hand spokes, to its left (ending at the
 * point) on the left-hand ones, centred over it at the top; above the point
 * on the upper spokes, below it on the lower ones, level with it otherwise.
 */
export function matchupCardLabelBox(i: number): MatchupCardLabelBox {
  const g = MATCHUP_CARD_RADAR;
  const { height, topWidth } = MATCHUP_CARD_LAYOUT.label;
  const [x, y] = radarPoint(g, g.r + g.gap, i);
  const cos = Math.cos(radarAngle(i));
  const sin = Math.sin(radarAngle(i));
  const top = sin < -0.3 ? y - height : sin > 0.3 ? y : y - height / 2;
  if (cos > 0.3) return { left: x, top, width: g.w - x, height, align: "start" };
  if (cos < -0.3) return { left: 0, top, width: x, height, align: "end" };
  return { left: x - topWidth / 2, top, width: topWidth, height, align: "center" };
}

/** The seven boxes, RADAR_AXES order. */
export const MATCHUP_CARD_LABEL_BOXES: readonly MatchupCardLabelBox[] = RADAR_AXES.map((_, i) => matchupCardLabelBox(i));

/**
 * The band name's size. Press Start 2P is one em per character and the box is
 * 520 px: 24 px up to 16 characters, 20 px up to 26, 16 px beyond (no team
 * needs the third step today; it is there for a renamed one).
 */
export function matchupBandNameSize(name: string): 24 | 20 | 16 {
  const length = Array.from(String(name ?? "")).length;
  return length <= 16 ? 24 : length <= 26 ? 20 : 16;
}

/* ─── Copy (§9). K12 is in matchup-links.ts; there is no K13. ─── */

const joiner = (hasGame: boolean) => (hasGame ? "at" : "vs");

/** K1 — the share page's <title>, absolute. */
export function matchupCardTitle(awayName: string, homeName: string, season: number, hasGame: boolean): string {
  return `${awayName} ${joiner(hasGame)} ${homeName}: Matchup Card ${season} — Yards Per Pass`;
}

/** K1b — og:title and twitter:title: no season and no site name, so X's label stays short. */
export function matchupCardPreviewTitle(awayName: string, homeName: string, hasGame: boolean): string {
  return `${awayName} ${joiner(hasGame)} ${homeName}`;
}

/** K2 — the share page's description; the week clause is dropped when the week is unknown. */
export function matchupCardDescription(awayId: string, homeId: string, throughWeek: number | null): string {
  const week = throughWeek === null ? "" : ` through Week ${throughWeek}`;
  return `${awayId} offense over the ${homeId} defense and ${homeId} offense over the ${awayId} defense, by league rank${week}: the rate and the rank for seven stats.`;
}

/** The season part of K3, and the whole of a plate's sub-band line: "2026 through Week 5" / "2026 season". */
export function matchupCardSeasonLine(season: number, throughWeek: number | null): string {
  return throughWeek === null ? `${season} season` : `${season} through Week ${throughWeek}`;
}

/** The four playoff rounds gameWeekLabel has a name for. */
const PLAYOFF_ROUNDS: readonly string[] = ["WC", "DIV", "CON", "SB"];

/**
 * A game's week as the card prints it: "Week 5" for a regular-season week
 * 1-22, the round's name for one of the four playoff rounds, and "" for
 * anything else. The header's gameWeekLabel prints an unknown game type as it
 * is; on the image that would be unchecked text (any length, any character:
 * chaos F10), so the card prints no name at all.
 */
function cardWeekLabel(game: MatchupGame): string {
  const type = normalizeGameType(game.game_type);
  if (PLAYOFF_ROUNDS.includes(type)) return gameWeekLabel(game);
  return type === "REG" && compareWeek(game.week) !== null ? gameWeekLabel(game) : "";
}

/**
 * K3 — the sub-band's left line. A game: its week (or playoff round), its
 * kickoff or final score as the matchup page's header prints them, then the
 * season part; empty parts are dropped. No game: the header's sentence, then
 * the season part.
 *
 * Nothing of the game row is printed as it came: the week and the round go
 * through cardWeekLabel, the date and the time through formatKickoff's own
 * parsing, and the two ids of a "Final:" line are reduced to their letters
 * (buildMatchupCard only ever passes a row whose ids are the two validated
 * team ids).
 */
export function matchupCardSubLine(i: { game: MatchupGame | null; season: number; throughWeek: number | null }): string {
  const seasonLine = matchupCardSeasonLine(i.season, i.throughWeek);
  const game = i.game;
  if (game === null || typeof game !== "object") return `${matchupNoGameText(i.season)} · ${seasonLine}`;
  const kickoff = formatKickoff({ ...game, away_team: safeId(game.away_team), home_team: safeId(game.home_team) });
  return [cardWeekLabel(game), kickoff, seasonLine].filter((part) => part !== "").join(" · ");
}

/** K4 — the sub-band's middle line (left out for a playoff game: the left line would not fit beside it). */
export const MATCHUP_CARD_HOW_TO = "Each label: the stat · its league rank · farther out = better rank";

/** The middle ring's colour as a word, for K5. */
export function matchupRingWord(ring: string): "amber" | "grey" {
  return ring === MATCHUP_RING_GREY ? "grey" : "amber";
}

/** K5 — the image's footer line and the share page's legend: the ring's own word, the real pool. */
export function matchupCardLegendLine(teamsPlayed: number, ring: string): string {
  return `Solid line, round dots = offense. Dashed line, squares = defense. Outer ring = 1st of ${teamsPlayed}, ${matchupRingWord(ring)} dotted ring = middle of the league.`;
}

/** K6 — the share page's <h1>. */
export function matchupCardHeading(awayName: string, homeName: string, season: number, hasGame: boolean): string {
  return `${awayName} ${joiner(hasGame)} ${homeName}: matchup card, ${season}`;
}

/** K7 — the image's alt text. */
export function matchupCardAlt(awayName: string, homeName: string, season: number, hasGame: boolean): string {
  return `${awayName} ${joiner(hasGame)} ${homeName} matchup card, ${season}`;
}

/**
 * K8 — the share page's line for a team that is not in its primary colour;
 * null for a team that is (and for the two neutrals, which no real pair uses).
 */
export function matchupCardColourNote(teamName: string, from: MatchupColourSource): string | null {
  if (from === "primary" || from === "grey" || from === "ink") return null;
  const what = from === "primary-darkened" ? "a darker shade of their colour" : "their second colour";
  return `${teamName} are drawn in ${what} on this card so the two teams never share one.`;
}

/** K9 — the share page's links (HTML only: the arrow is not in the image's font). */
export const MATCHUP_CARD_FULL_LINK_TEXT = "See the full matchup →";
export function matchupCardTeamLinkText(teamName: string): string {
  return `${teamName} team page →`;
}

/** K10 — the 404 title, absolute. */
export const MATCHUP_CARD_NOT_FOUND_TITLE = "Matchup Card Not Found — Yards Per Pass";

/** K11 — the share page when the games could not be read (the image answers 503 there). */
export const MATCHUP_CARD_UNAVAILABLE = "The matchup card is unavailable right now. Try again in a few minutes.";

/** K14 — the image route's 503 body. */
export const MATCHUP_CARD_IMAGE_UNAVAILABLE = "Matchup card image temporarily unavailable. Try again in a few minutes.";

/** K15 — a pane's legend row, in its three parts, and as the share page's table caption. */
export function matchupCardLegendWords(offId: string, defId: string): { off: string; over: string; def: string } {
  return { off: `${offId} offense`, over: "over", def: `${defId} defense` };
}
export function matchupCardPaneCaption(offId: string, defId: string): string {
  const words = matchupCardLegendWords(offId, defId);
  return `${words.off} ${words.over} ${words.def}`;
}

/** K16 — the seam box. */
export const MATCHUP_CARD_SEAM_AT = "AT";
export const MATCHUP_CARD_SEAM_VS = "VS";

/** The sub-band's right-hand text (the footer's is RADAR_CARD_SITE_LINE). */
export const MATCHUP_CARD_SITE_NAME = "YARDSPERPASS.COM";

/* ─── The model (§6.1, §7) ─── */

/**
 * What buildMatchupCard reads of the loader's answer (lib/data/matchup.ts
 * MatchupLoad is assignable to it; a test holds that).
 */
export interface MatchupCardLoad {
  state: "ready" | "small-pool" | "uncovered";
  /** null in the uncovered state */
  model: MatchupModel | null;
  season: number;
  defaultSeason: number;
  /** the pair's game in this order; null when there is none (or the games could not be read) */
  game: MatchupGame | null;
  records: { away: WinLossTie; home: WinLossTie } | null;
  gamesAvailable: boolean;
  /** uncovered only */
  firstSeason?: number | null;
}

export interface MatchupCardBandHalf {
  id: string;
  /** upper-cased (capitals are typed, not styled) */
  name: string;
  nameSize: 24 | 20 | 16;
  /** the team's card colour */
  color: string;
  textColor: string;
  /** the 5 px rule under this half */
  ruleColor: string;
  /** "3-1 · away"; the venue only when the pair has a game; "" with no records */
  meta: string;
}

/** A plotted spoke, in pane coordinates. */
export interface MatchupCardVertex { key: RadarAxisKey; x: number; y: number }

export interface MatchupCardSpokeLabel {
  key: RadarAxisKey;
  name: string;
  /** "11.3% · 1st", or a dash */
  offLine: string;
  defLine: string;
  box: MatchupCardLabelBox;
}

export type MatchupCardPane =
  | {
      drawn: true;
      offId: string;
      defId: string;
      offColor: string;
      defColor: string;
      /** plottable spokes only; the outline bridges a missing one */
      off: MatchupCardVertex[];
      def: MatchupCardVertex[];
      /** always 7, RADAR_AXES order */
      labels: MatchupCardSpokeLabel[];
    }
  | { drawn: false; offId: string; defId: string; offColor: string; defColor: string; message: string };

interface MatchupCardCommon {
  season: number;
  defaultSeason: number;
  /** 1-22, or null: no week is printed and no `w` is sent */
  throughWeek: number | null;
  hasGame: boolean;
  colours: MatchupCardColours;
  band: { away: MatchupCardBandHalf; home: MatchupCardBandHalf; seam: "AT" | "VS" };
  /** K1, K1b, K2 (a plate: its sentence), K7 */
  title: string;
  previewTitle: string;
  description: string;
  alt: string;
}

export type MatchupCardModel =
  | (MatchupCardCommon & {
      kind: "card";
      /** K3 */
      subLine: string;
      /** K4 is printed */
      showHowTo: boolean;
      /** the away team's ball, then the home team's */
      panes: [MatchupCardPane, MatchupCardPane];
      /** K5 */
      legendLine: string;
    })
  | (MatchupCardCommon & { kind: "plate"; message: string; reason: MatchupPlateReason });

/**
 * Why a model is a plate. "uncovered", "small-pool" and "no-radar" (neither
 * radar can be drawn: a team with no games, or too few rates) are real states
 * of the season and their plate is an image worth keeping. "unavailable" is
 * not: the games could not be read, or the builder was handed a load that is
 * not this pair's. The image route answers 503 for it and must never store it
 * (it checks `gamesAvailable` before building; this field is the second lock).
 */
export type MatchupPlateReason = "uncovered" | "small-pool" | "no-radar" | "unavailable";

const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/**
 * ONE rule for a missing spoke, used by the label and by the vertex (spec §7,
 * chaos F2): a spoke with no value, no rank or no score (null, or anything
 * that is not a finite number) is missing: a dash for its line and no vertex.
 * Otherwise the score the chart plots, clamped to 0-1 as plottableScore does.
 */
function spokeScore(spoke: Pick<RadarSpoke, "value" | "rank" | "score"> | null | undefined): number | null {
  if (!spoke || !finite(spoke.value) || !finite(spoke.rank) || !finite(spoke.score)) return null;
  return plottableScore(spoke);
}

/** One label line: the rate and the rank, or a dash for a missing spoke. */
function labelLine(spoke: RadarSpoke | undefined): string {
  if (!spoke || spokeScore(spoke) === null) return EM_DASH;
  return `${fmtRadarPct(spoke.value)} · ${spokeRankLabel(spoke)}`;
}

/** The vertices of one unit: every spoke that is not missing, at its own pool's radius (spec F7). */
function vertices(spokes: readonly RadarSpoke[]): MatchupCardVertex[] {
  const g = MATCHUP_CARD_RADAR;
  const out: MatchupCardVertex[] = [];
  RADAR_AXES.forEach((axis, i) => {
    const score = spokeScore(spokes[i]);
    if (score === null) return;
    const [x, y] = radarPoint(g, g.r * radarRadius(score), i);
    out.push({ key: axis.key, x, y });
  });
  return out;
}

/**
 * The card for one pair, as plain data. `load` is the loader's answer with
 * `gamesAvailable === true`; callers check first (the image answers 503, the
 * page shows a message), and the builder returns the "unavailable" plate if
 * handed one without.
 *
 * It does not throw on a load that fits MatchupCardLoad, whatever state it is
 * in, and its numbers are finite. A value outside the types (no load at all, a
 * team that is null, a model that is not a model) can still throw or print
 * "NaN" (chaos F4): the two callers pass a validated Team and the loader's
 * own answer.
 *
 * A plate (the band, then one sentence) when there is nothing to draw: the
 * season is not covered, too few teams have played, or neither radar can be
 * drawn. One pane that cannot be drawn is still a card: that pane carries its
 * sentence.
 *
 * Two checks on what it is handed, because every name and colour comes from
 * `away` / `home` and every number from `load.model` (review should-fix 2,
 * chaos F10): a model that is not these two teams in this order is the
 * "unavailable" plate, never a card with one team's numbers under the other's
 * name; and `load.game` counts as the pair's game only when it is this pair in
 * this order, else the card says VS and prints nothing of that row.
 */
export function buildMatchupCard(input: { away: Team; home: Team; load: MatchupCardLoad }): MatchupCardModel {
  const { away, home, load } = input;
  const model = load.model ?? null;
  const season = load.season;
  const row = load.game ?? null;
  const game = row !== null && typeof row === "object" && row.away_team === away.id && row.home_team === home.id ? row : null;
  const hasGame = game !== null;
  const colours = matchupCardColours(away, home);
  const throughWeek = compareWeek(model?.throughWeek ?? null);

  const half = (team: Team, side: "away" | "home"): MatchupCardBandHalf => {
    const name = String(team.name ?? "").toUpperCase();
    const record = load.records?.[side] ?? null;
    const color = side === "away" ? colours.away : colours.home;
    return {
      id: team.id,
      name,
      nameSize: matchupBandNameSize(name),
      color,
      // upper-case, like every other colour in the model (textColorForBackground answers in lower case)
      textColor: textColorForBackground(color).toUpperCase(),
      ruleColor: side === "away" ? colours.awayRule : colours.homeRule,
      meta: record === null ? "" : hasGame ? `${formatRecord(record)} · ${side}` : formatRecord(record),
    };
  };

  const common: MatchupCardCommon = {
    season,
    defaultSeason: load.defaultSeason,
    throughWeek,
    hasGame,
    colours,
    band: { away: half(away, "away"), home: half(home, "home"), seam: hasGame ? MATCHUP_CARD_SEAM_AT : MATCHUP_CARD_SEAM_VS },
    title: matchupCardTitle(away.name, home.name, season, hasGame),
    previewTitle: matchupCardPreviewTitle(away.name, home.name, hasGame),
    description: matchupCardDescription(away.id, home.id, throughWeek),
    alt: matchupCardAlt(away.name, home.name, season, hasGame),
  };
  const plate = (reason: MatchupPlateReason, message: string): MatchupCardModel => ({
    kind: "plate", ...common, description: message, message, reason,
  });

  if (!load.gamesAvailable) return plate("unavailable", MATCHUP_CARD_UNAVAILABLE);
  // The numbers below are the model's; the names and colours above are the two teams'. They must be the same pair.
  if (model !== null && (model.away?.id !== away.id || model.home?.id !== home.id)) return plate("unavailable", MATCHUP_CARD_UNAVAILABLE);
  if (load.state === "uncovered") return plate("uncovered", matchupUncoveredHeading(season, load.firstSeason ?? null));
  if (model === null) return plate("unavailable", MATCHUP_CARD_UNAVAILABLE);
  if (load.state === "small-pool" || model.state === "small-pool") return plate("small-pool", MATCHUP_SMALL_POOL_NOTE);

  // A pane that cannot be drawn: a team with no games (the away team's sentence when both), else too few rates.
  const undrawn =
    model.away.games === 0 ? matchupNoGamesNote(away.name, season)
    : model.home.games === 0 ? matchupNoGamesNote(home.name, season)
    : MATCHUP_NO_OVERLAY_NOTE;

  const pane = (overlay: OverlayModel | null, offTeam: Team, defTeam: Team, offColor: string, defColor: string): MatchupCardPane => {
    const ids = { offId: offTeam.id, defId: defTeam.id, offColor, defColor };
    if (overlay === null || !overlay.drawn || overlay.off === null || overlay.def === null) {
      return { drawn: false, ...ids, message: undrawn };
    }
    const off = overlay.off.spokes;
    const def = overlay.def.spokes;
    return {
      drawn: true,
      ...ids,
      off: vertices(off),
      def: vertices(def),
      labels: RADAR_AXES.map((axis, i) => ({
        key: axis.key,
        // the overlay's own word; never the radar's axis name ("Sack rate"), which the card's fit tests never saw
        name: overlay.spokes?.[i]?.label ?? OVERLAY_LABELS[axis.key],
        offLine: labelLine(off[i]),
        defLine: labelLine(def[i]),
        box: MATCHUP_CARD_LABEL_BOXES[i],
      })),
    };
  };

  // A team's colour is the same in both panes: the away team is the offense of pane 0 and the defense of pane 1.
  const panes: [MatchupCardPane, MatchupCardPane] = [
    pane(model.awayBall?.overlay ?? null, away, home, colours.away, colours.home),
    pane(model.homeBall?.overlay ?? null, home, away, colours.home, colours.away),
  ];
  if (!panes[0].drawn && !panes[1].drawn) return plate("no-radar", undrawn);

  return {
    kind: "card",
    ...common,
    subLine: matchupCardSubLine({ game, season, throughWeek }),
    // K4 beside every line but a playoff round's, which is too long to share the row (an unknown game type prints no name).
    showHowTo: game === null || !PLAYOFF_ROUNDS.includes(normalizeGameType(game.game_type)),
    panes,
    legendLine: matchupCardLegendLine(model.teamsPlayed, colours.ring),
  };
}
