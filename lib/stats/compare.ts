// lib/stats/compare.ts
//
// The maths of a two-player comparison, as a pure module (compare card spec
// 2026-10-09, PR 1). Moved out of components/compare/ComparisonTool.tsx
// unchanged so that the Compare page and, later, the comparison share card and
// its image all get their numbers from one place.
//
// Pure: no React, no Supabase, nothing from lib/data except the static team
// list (a test checks the imports). It runs in the browser today and will run
// on the server for the card.
//
// The pool (PR 1b): each player is ranked against the stat card's pool for his
// own position, through the pool functions lib/stats/tecmo-card.ts exports
// and its card builders call. So a player has one radar shape on the site.
// The stat table has no percentiles: the pool never touches it.
import type { QBSeasonStat, ReceiverSeasonStat, RBSeasonStat } from "@/lib/types";
import { getTeam } from "@/lib/data/teams";
import {
  getQBRadarVal, getWRRadarVal, getRBRadarVal, computeRadarValues, radarHasTooFewAxes,
  QB_RADAR_AXES, QB_RADAR_KEYS, WR_RADAR_AXES, WR_RADAR_KEYS, RB_RADAR_AXES, RB_RADAR_KEYS,
} from "@/lib/stats/radar";
import { qbFantasyPoints, wrFantasyPoints, rbFantasyPoints } from "@/lib/stats/fantasy";
import {
  qbCardPool, rbCardPool, wrCardPool, qbEligible, rbEligible, wrEligible,
  QB_MIN_ATT_PER_GAME, WR_MIN_TGT_PER_GAME, RB_MIN_CAR_PER_GAME,
} from "@/lib/stats/tecmo-card";
import { radarStrokeColor } from "@/lib/stats/team-radar";

const HEX6 = /^#[0-9a-fA-F]{6}$/;
/** The dark neutral a colour that cannot be read falls back to (the team radar's neutral outline). */
export const COMPARE_NEUTRAL_COLOR = "#0f172a";
/** Is this a colour the functions below can work with: exactly #RRGGBB? */
export function isHexColor(v: unknown): v is string {
  return typeof v === "string" && HEX6.test(v);
}

// Perceptual color distance (weighted Euclidean, green-sensitive).
// Inputs must be 7-character #RRGGBB (what getTeamColor returns); anything
// else gives NaN. ensureContrast checks its inputs before it calls this.
export function colorDistance(hex1: string, hex2: string): number {
  const r1 = parseInt(hex1.slice(1, 3), 16), g1 = parseInt(hex1.slice(3, 5), 16), b1 = parseInt(hex1.slice(5, 7), 16);
  const r2 = parseInt(hex2.slice(1, 3), 16), g2 = parseInt(hex2.slice(3, 5), 16), b2 = parseInt(hex2.slice(5, 7), 16);
  return Math.sqrt(2 * (r1 - r2) ** 2 + 4 * (g1 - g2) ** 2 + 3 * (b1 - b2) ** 2);
}

export const CONTRAST_PALETTE = ["#dc2626", "#2563eb", "#16a34a", "#d97706", "#9333ea", "#0891b2"];
export const MIN_DISTANCE = 150;

/**
 * Player 2's colour, moved to a palette colour when it is too close to player 1's. Player 1's is never moved.
 * A colour that is not #RRGGBB never comes back out: a bad c1 is measured as
 * the dark neutral, and a bad c2 is replaced by a palette colour.
 */
export function ensureContrast(c1: string, c2: string): string {
  const base = isHexColor(c1) ? c1 : COMPARE_NEUTRAL_COLOR;
  if (isHexColor(c2) && colorDistance(base, c2) >= MIN_DISTANCE) return c2;
  for (const alt of CONTRAST_PALETTE) {
    if (colorDistance(base, alt) >= MIN_DISTANCE) return alt;
  }
  return CONTRAST_PALETTE[1]; // terminal fallback: blue
}

/**
 * The two colours of a comparison, on /compare and on the share card alike:
 * each team's outline colour by the team radar's rule (the primary when it
 * shows on white, else the secondary, else a dark neutral: Pittsburgh's and
 * New Orleans' golds do not), then player B's moved away from player A's when
 * the two are too close. An unknown team is the dark neutral. Always two
 * #RRGGBB values, whatever comes in.
 */
export function comparePlotColors(teamIdA: unknown, teamIdB: unknown): { a: string; b: string } {
  const stroke = (id: unknown): string => {
    const team = typeof id === "string" ? getTeam(id) : undefined;
    return radarStrokeColor(team?.primaryColor ?? "", team?.secondaryColor ?? "");
  };
  const a = stroke(teamIdA);
  return { a, b: ensureContrast(a, stroke(teamIdB)) };
}

/** The three stat tables a comparison can come from. TE rows live in the WR table; FB counts as RB. */
export type CompareGroup = "QB" | "WR" | "RB";

/**
 * The stat table a position is compared in, from player_slugs.position: QB;
 * WR and TE share the receiver table; FB counts as RB. Anything else (K, P, a
 * defender, null, a mis-cased value) has no table: null, and no comparison.
 */
export function compareGroup(position: unknown): CompareGroup | null {
  if (position === "QB") return "QB";
  if (position === "WR" || position === "TE") return "WR";
  if (position === "RB" || position === "FB") return "RB";
  return null;
}
export type ComparePlayerRow = QBSeasonStat | ReceiverSeasonStat | RBSeasonStat;
export type CompStat = {
  label: string;
  key: string;
  format: (v: number) => string;
  higherBetter: boolean;
  getValue?: (p: ComparePlayerRow) => number;
};

export const QB_COMP_STATS: CompStat[] = [
  // Radar axes
  { label: "EPA/DB", key: "epa_per_db", format: (v) => v.toFixed(2), higherBetter: true },
  { label: "CPOE", key: "cpoe", format: (v) => (v >= 0 ? "+" : "") + v.toFixed(1), higherBetter: true },
  { label: "aDOT", key: "adot", format: (v) => v.toFixed(1), higherBetter: true },
  { label: "Success%", key: "success_rate", format: (v) => (v * 100).toFixed(1) + "%", higherBetter: true },
  // Volume + efficiency
  { label: "Pass Yds", key: "passing_yards", format: (v) => v.toFixed(0), higherBetter: true },
  { label: "Pass TD", key: "touchdowns", format: (v) => v.toFixed(0), higherBetter: true },
  { label: "INT", key: "interceptions", format: (v) => v.toFixed(0), higherBetter: false },
  { label: "ANY/A", key: "any_a", format: (v) => v.toFixed(2), higherBetter: true },
  { label: "Rating", key: "passer_rating", format: (v) => v.toFixed(1), higherBetter: true },
  { label: "TD%", key: "td_pct", format: (v) => v.toFixed(1), higherBetter: true },
  { label: "INT%", key: "int_pct", format: (v) => v.toFixed(1), higherBetter: false },
  { label: "SK%", key: "sack_pct", format: (v) => v.toFixed(1), higherBetter: false },
  { label: "Total EPA", key: "total_epa", format: (v) => v.toFixed(1), higherBetter: true },
  { label: "Rush Yds", key: "rush_yards", format: (v) => v.toFixed(0), higherBetter: true },
  { label: "Rush TD", key: "rush_tds", format: (v) => v.toFixed(0), higherBetter: true },
  { label: "SCR%", key: "scramble_pct", format: (v) => v.toFixed(1), higherBetter: true },
  { label: "FPts", key: "fantasy_pts", format: (v) => v.toFixed(1), higherBetter: true,
    getValue: (p) => qbFantasyPoints(p as QBSeasonStat) },
  { label: "Games", key: "games", format: (v) => v.toFixed(0), higherBetter: true },
];

export const WR_COMP_STATS: CompStat[] = [
  // Radar axes
  { label: "EPA/Tgt", key: "epa_per_target", format: (v) => v.toFixed(2), higherBetter: true },
  { label: "CROE", key: "croe", format: (v) => (v >= 0 ? "+" : "") + (v * 100).toFixed(1) + "%", higherBetter: true },
  { label: "aDOT", key: "air_yards_per_target", format: (v) => v.toFixed(1), higherBetter: true },
  { label: "YAC/Rec", key: "yac_per_reception", format: (v) => v.toFixed(1), higherBetter: true },
  { label: "YPRR", key: "yards_per_route_run", format: (v) => v.toFixed(2), higherBetter: true },
  // Volume + rates
  { label: "Targets", key: "targets", format: (v) => v.toFixed(0), higherBetter: true },
  { label: "Receptions", key: "receptions", format: (v) => v.toFixed(0), higherBetter: true },
  { label: "Yards", key: "receiving_yards", format: (v) => v.toFixed(0), higherBetter: true },
  { label: "TDs", key: "receiving_tds", format: (v) => v.toFixed(0), higherBetter: true },
  { label: "Catch%", key: "catch_rate", format: (v) => (v * 100).toFixed(1) + "%", higherBetter: true },
  { label: "Tgt Share", key: "target_share", format: (v) => (v * 100).toFixed(1) + "%", higherBetter: true },
  { label: "AY%", key: "air_yards_share", format: (v) => (v * 100).toFixed(1) + "%", higherBetter: true },
  { label: "FPts (PPR)", key: "fantasy_pts", format: (v) => v.toFixed(1), higherBetter: true,
    getValue: (p) => wrFantasyPoints(p as ReceiverSeasonStat, "ppr") },
  { label: "Games", key: "games", format: (v) => v.toFixed(0), higherBetter: true },
];

export const RB_COMP_STATS: CompStat[] = [
  // Radar axes
  { label: "EPA/Car", key: "epa_per_carry", format: (v) => v.toFixed(2), higherBetter: true },
  { label: "Success%", key: "success_rate", format: (v) => (v * 100).toFixed(1) + "%", higherBetter: true },
  { label: "Stuff%", key: "stuff_rate", format: (v) => (v * 100).toFixed(1) + "%", higherBetter: false },
  { label: "Explosive%", key: "explosive_rate", format: (v) => (v * 100).toFixed(1) + "%", higherBetter: true },
  // Volume + efficiency
  { label: "Carries", key: "carries", format: (v) => v.toFixed(0), higherBetter: true },
  { label: "Rush Yds", key: "rushing_yards", format: (v) => v.toFixed(0), higherBetter: true },
  { label: "Rush TD", key: "rushing_tds", format: (v) => v.toFixed(0), higherBetter: true },
  { label: "YPC", key: "yards_per_carry", format: (v) => v.toFixed(1), higherBetter: true },
  { label: "TCH", key: "total_touches", format: (v) => v.toFixed(0), higherBetter: true },
  { label: "Total EPA", key: "total_rushing_epa", format: (v) => v.toFixed(1), higherBetter: true },
  { label: "FPts (PPR)", key: "fantasy_pts", format: (v) => v.toFixed(1), higherBetter: true,
    getValue: (p) => rbFantasyPoints(p as RBSeasonStat, "ppr") },
  { label: "Games", key: "games", format: (v) => v.toFixed(0), higherBetter: true },
];

/** A stat as a number, or NaN when the row does not hold a number there (null, undefined, the raw string "NaN"). */
export function getStatVal(player: ComparePlayerRow, key: string): number {
  const v = (player as unknown as Record<string, unknown>)[key];
  return typeof v === "number" ? v : NaN;
}

type GroupConfig = {
  radarKeys: readonly string[];
  radarAxes: { label: string }[];
  compStats: CompStat[];
  getRadarVal: (p: ComparePlayerRow, key: string) => number;
  /** WR/TE: an axis with no data is left out of the outline. QB/RB: it plots at the centre (0). */
  missingAxisIsGap: boolean;
  /** The stat card's pool for this player: the qualified players of his position. */
  pool: (row: ComparePlayerRow, all: ComparePlayerRow[]) => ComparePlayerRow[];
  /** Is this player himself over the stat card's line? */
  eligible: (row: ComparePlayerRow) => boolean;
  /** The position his pool is made of. Receiver table: the season row's own position. */
  poolPosition: (row: ComparePlayerRow) => string;
  /** The column the line is drawn on (attempts, targets, carries). */
  volumeKey: string;
  /** How that column is named in a sentence: [one, many]. */
  volumeWords: [string, string];
  /** The line: this many a game. */
  minPerGame: number;
  /** "14+ pass attempts", as the sentences print the line (the same noun as volumeWords). */
  thresholdWords: string;
};

const receiverPosition = (row: ComparePlayerRow): string => (row as ReceiverSeasonStat).position;

const GROUPS: Record<CompareGroup, GroupConfig> = {
  QB: {
    radarKeys: QB_RADAR_KEYS, radarAxes: QB_RADAR_AXES, compStats: QB_COMP_STATS,
    getRadarVal: (p, k) => getQBRadarVal(p as QBSeasonStat, k),
    missingAxisIsGap: false,
    pool: (_row, all) => qbCardPool(all as QBSeasonStat[]),
    eligible: (row) => qbEligible(row as QBSeasonStat),
    poolPosition: () => "QB",
    volumeKey: "attempts", volumeWords: ["pass attempt", "pass attempts"],
    minPerGame: QB_MIN_ATT_PER_GAME, thresholdWords: `${QB_MIN_ATT_PER_GAME}+ pass attempts`,
  },
  WR: {
    radarKeys: WR_RADAR_KEYS, radarAxes: WR_RADAR_AXES, compStats: WR_COMP_STATS,
    getRadarVal: (p, k) => getWRRadarVal(p as ReceiverSeasonStat, k),
    missingAxisIsGap: true,
    // The row's own position picks the pool, as on the stat card: a WR against
    // WRs, a TE against TEs, and a receiver-table row whose position is RB (or
    // anything else) against the qualified rows of that same position.
    pool: (row, all) => wrCardPool(all as ReceiverSeasonStat[], receiverPosition(row)),
    eligible: (row) => wrEligible(row as ReceiverSeasonStat),
    poolPosition: receiverPosition,
    volumeKey: "targets", volumeWords: ["target", "targets"],
    minPerGame: WR_MIN_TGT_PER_GAME, thresholdWords: `${WR_MIN_TGT_PER_GAME}+ targets`,
  },
  RB: {
    radarKeys: RB_RADAR_KEYS, radarAxes: RB_RADAR_AXES, compStats: RB_COMP_STATS,
    getRadarVal: (p, k) => getRBRadarVal(p as RBSeasonStat, k),
    missingAxisIsGap: false,
    pool: (_row, all) => rbCardPool(all as RBSeasonStat[]),
    eligible: (row) => rbEligible(row as RBSeasonStat),
    poolPosition: () => "RB",
    volumeKey: "carries", volumeWords: ["carry", "carries"],
    minPerGame: RB_MIN_CAR_PER_GAME, thresholdWords: `${RB_MIN_CAR_PER_GAME}+ carries`,
  },
};

export interface ComparisonPlayer {
  /** One percentile (0-100) per radar axis. Never NaN: a missing axis is 0 here and true in `missing`. */
  values: number[];
  /** True where the axis has no data and must be left out of the outline (WR/TE only today). */
  missing: boolean[];
  /** The colour this player is drawn in. */
  color: string;
  /** How many players his percentiles were ranked against (the stat card's pool for his position). */
  poolSize: number;
  /** The position that pool is made of: "QB", "RB", or the receiver row's own position ("WR", "TE", ...). */
  poolPosition: string;
  /** False when he is under the stat card's line (a small sample). He is still ranked against the pool. */
  eligible: boolean;
  /**
   * His attempts / targets / carries and his games, for the small-sample
   * sentence. A numeric string is read as its number; anything that is not a
   * finite number of 0 or more is null, and the sentence then leaves him out
   * rather than print a number the row does not hold.
   */
  volume: number | null;
  games: number | null;
  /** The name his season row carries ("J.Allen"); "" when it has none. */
  shortName: string;
  /**
   * False when half his radar axes or more are missing: his outline is not
   * drawn, by the stat card chart's own rule (radarHasTooFewAxes). His values
   * and mask are still filled in.
   */
  outline: boolean;
}

export interface ComparisonTableRow {
  key: string;
  label: string;
  /** Player A's value as printed; an em dash when he has none. */
  a: string;
  /** Player B's value as printed; an em dash when he has none. */
  b: string;
  /** 1 = A has the better value, 2 = B, 0 = a tie or a missing value (no highlight). */
  winner: 0 | 1 | 2;
}

export interface Comparison {
  group: CompareGroup;
  axes: { label: string }[];
  a: ComparisonPlayer;
  b: ComparisonPlayer;
  rows: ComparisonTableRow[];
  /** "too-few": one of the two pools has fewer than 2 players, so no radar is drawn (the table still is). */
  radar: "drawn" | "too-few";
}

/** A radar needs at least this many qualified players in each player's pool. */
export const COMPARE_MIN_POOL = 2;

const NO_VALUE = "—";

/** A count as a number: a number or a numeric string, finite and not negative. Anything else is null. */
function countOrNull(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function playerFor(cfg: GroupConfig, row: ComparePlayerRow, all: ComparePlayerRow[], color: string): ComparisonPlayer {
  // The same calls the stat card's builders make for radarValues / radarMissing.
  const pool = cfg.pool(row, all);
  const values = computeRadarValues(cfg.radarKeys, cfg.getRadarVal, row, pool);
  const missing = cfg.missingAxisIsGap
    ? computeRadarValues(cfg.radarKeys, cfg.getRadarVal, row, pool, true).map((v) => Number.isNaN(v))
    : values.map(() => false);
  const record = row as unknown as Record<string, unknown>;
  return {
    values, missing, color,
    poolSize: pool.length,
    poolPosition: cfg.poolPosition(row),
    eligible: cfg.eligible(row),
    volume: countOrNull(record[cfg.volumeKey]),
    games: countOrNull(record.games),
    shortName: typeof record.player_name === "string" ? record.player_name.trim() : "",
    outline: !radarHasTooFewAxes(missing.filter(Boolean).length, cfg.radarKeys.length),
  };
}

/**
 * Everything the Compare page shows for two players of one stat table: the
 * radar percentiles and which axes are missing, the two colours, and the stat
 * table (printed values and which side is better).
 *
 * `all` is the whole season table of the group; each player's pool is taken
 * from it here (the stat card's pool for his position, so two players of
 * different positions in the receiver table are each ranked in their own).
 * Colours: comparePlotColors of the two season rows' teams; `teamA` / `teamB`
 * are used only for a row with no team_id.
 * `radar` is "too-few" when either pool has fewer than 2 players: the caller
 * shows compareTooFewSentence in place of the radar. A player whose `outline`
 * is false is not drawn (compareNotDrawnSentences says so); with both false
 * there is no radar either. `teamA` / `teamB` are the team
 * ids the colours come from (the Compare page passes player_slugs'
 * current_team_id, as it always has).
 *
 * null, undefined and the raw string "NaN" all count as "no value", with one
 * known exception kept as it is (spec F12): a running back's stuff_rate of
 * null plots as a 0% stuff rate, while "NaN" plots at the centre.
 *
 * Preconditions, checked: `group` is one of the three tables (map
 * player_slugs.position with compareGroup first and turn a null away), and
 * `rowA` / `rowB` are real rows. Anything else throws an Error that says which,
 * so a caller's mistake can never come out as a comparison.
 */
export function buildComparison(input: {
  group: CompareGroup;
  rowA: ComparePlayerRow;
  rowB: ComparePlayerRow;
  all: ComparePlayerRow[];
  teamA: string;
  teamB: string;
}): Comparison {
  const { group, rowA, rowB, all, teamA, teamB } = input;
  const cfg = typeof group === "string" && Object.prototype.hasOwnProperty.call(GROUPS, group) ? GROUPS[group] : undefined;
  if (!cfg) throw new Error(`buildComparison: unknown group ${JSON.stringify(group) ?? String(group)} (expected QB, WR or RB)`);
  if (rowA == null || rowB == null) throw new Error("buildComparison: both players need a season row");
  if (!Array.isArray(all)) throw new Error("buildComparison: the season table must be an array");

  // Each player wears the team of his SEASON ROW (the team he played for that
  // season), as on the share card; the team the caller names (player_slugs'
  // current team) is only the fallback for a row that carries none.
  const rowTeam = (row: ComparePlayerRow, fallback: string): string => {
    const id = (row as unknown as Record<string, unknown>).team_id;
    return typeof id === "string" && id.trim() !== "" ? id : fallback;
  };
  const { a: colorA, b: colorB } = comparePlotColors(rowTeam(rowA, teamA), rowTeam(rowB, teamB));

  const rows = cfg.compStats.map((stat): ComparisonTableRow => {
    const v1 = stat.getValue ? stat.getValue(rowA) : getStatVal(rowA, stat.key);
    const v2 = stat.getValue ? stat.getValue(rowB) : getStatVal(rowB, stat.key);
    const valid1 = !isNaN(v1);
    const valid2 = !isNaN(v2);
    const a = valid1 ? stat.format(v1) : NO_VALUE;
    const b = valid2 ? stat.format(v2) : NO_VALUE;
    let winner: 0 | 1 | 2 = 0;
    // A highlight needs two values that PRINT differently: +9.12% and +9.07%
    // both print "+9.1%", and a reader of the table (or of a shared picture)
    // would see two equal numbers with one marked better.
    if (valid1 && valid2 && a !== b) {
      if (stat.higherBetter) winner = v1 > v2 ? 1 : v2 > v1 ? 2 : 0;
      else winner = v1 < v2 ? 1 : v2 < v1 ? 2 : 0;
    }
    return { key: stat.key, label: stat.label, a, b, winner };
  });

  const a = playerFor(cfg, rowA, all, colorA);
  const b = playerFor(cfg, rowB, all, colorB);
  return {
    group,
    axes: cfg.radarAxes,
    a,
    b,
    rows,
    radar: a.poolSize >= COMPARE_MIN_POOL && b.poolSize >= COMPARE_MIN_POOL ? "drawn" : "too-few",
  };
}

// ---- The sentences the Compare page prints with the radar ----

/** The radar's legend line (C5). */
export const COMPARE_RADAR_LEGEND = "Farther out = higher percentile \u00b7 dashed ring = 50th percentile";

/** The receiver table's position words. A closed list: anything else is "receivers". */
const RECEIVER_POSITION_WORDS: Record<string, string> = { WR: "WRs", TE: "TEs", RB: "RBs", FB: "FBs", QB: "QBs" };

/** "quarterbacks", "running backs", "WRs", "TEs": the players of a pool, in a sentence. */
function poolWord(group: CompareGroup, player: ComparisonPlayer): string {
  if (group === "QB") return "quarterbacks";
  if (group === "RB") return "running backs";
  const position: unknown = player.poolPosition;
  return (typeof position === "string" && Object.prototype.hasOwnProperty.call(RECEIVER_POSITION_WORDS, position)
    ? RECEIVER_POSITION_WORDS[position] : "receivers");
}

/** Is any outline drawn at all? No when a pool is too small, or when both players have too few radar stats. */
export function compareRadarIsDrawn(c: Comparison): boolean {
  return c.radar === "drawn" && (c.a.outline || c.b.outline);
}

/**
 * The mask a chart gets for a player: his missing axes, or every axis when
 * his outline is not drawn at all (no corners, no dots).
 */
export function compareChartMask(p: ComparisonPlayer): boolean[] {
  return p.outline ? p.missing : p.missing.map(() => true);
}

/**
 * C4: which players the radar ranks against, with the pool's own count.
 * null when no radar is drawn (so "the 1 qualified quarterbacks" cannot appear).
 */
export function comparePoolSentence(c: Comparison): string | null {
  if (!compareRadarIsDrawn(c)) return null;
  const line = GROUPS[c.group].thresholdWords;
  if (c.a.poolPosition !== c.b.poolPosition) {
    return `Radar: each player against qualified players at his position (${line} a game): ` +
      `${c.a.poolSize} ${poolWord(c.group, c.a)}, ${c.b.poolSize} ${poolWord(c.group, c.b)}.`;
  }
  return `Radar: percentile among the ${c.a.poolSize} qualified ${poolWord(c.group, c.a)} (${line} a game).`;
}

/**
 * C4z: shown in place of the radar when a pool has fewer than 2 players. For
 * two positions it names the one whose pool is short, or both in the pair's
 * order. null when the radar is drawn. It does not say "yet": the Compare page
 * does not know whether the season shown is the newest one, and a past season
 * can never fill up.
 */
export function compareTooFewSentence(c: Comparison): string | null {
  if (c.radar !== "too-few") return null;
  const short = [c.a, c.b].filter((p) => p.poolSize < COMPARE_MIN_POOL).map((p) => poolWord(c.group, p));
  const words = Array.from(new Set(short)).join(" or ");
  return `Not enough qualified ${words} to draw the radar (${GROUPS[c.group].thresholdWords} a game).`;
}

/** What the caller knows about a player's name: his full name (a plain string means that), and his slug as a last resort. */
export type CompareName = string | null | undefined | { fullName?: string | null; slug?: string | null };

const text = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

/** "josh-allen" as "Josh Allen". */
function nameFromSlug(slug: string): string {
  return slug.split("-").filter(Boolean).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}

/**
 * The two names as a sentence prints them: the season rows' short names; when
 * the two are the same, or one is missing, each player's full name instead,
 * falling back to his short name, then a name made from his slug, then
 * "Player 1" / "Player 2". Never empty and never "null".
 */
function sentenceNames(c: Comparison, nameA: CompareName, nameB: CompareName): [string, string] {
  const useFull = !c.a.shortName || !c.b.shortName || c.a.shortName === c.b.shortName;
  const pick = (p: ComparisonPlayer, name: CompareName, fallback: string): string => {
    if (!useFull) return p.shortName;
    const full = text(typeof name === "object" && name !== null ? name.fullName : name);
    const slug = text(typeof name === "object" && name !== null ? name.slug : "");
    return full || p.shortName || nameFromSlug(slug) || fallback;
  };
  return [pick(c.a, nameA, "Player 1"), pick(c.b, nameB, "Player 2")];
}

/**
 * C6: one line naming each player who is under the stat card's line. null when
 * neither is. Shown whether or not a radar is drawn. A player whose attempts /
 * targets / carries or games are not usable numbers, or who has 0 games, is
 * left out of the line (never a made-up number, never "in 0 games").
 * `ovrHidden` (the share card, where each player's OVR is shown and an
 * under-the-line player's is a dash) adds " OVR hidden." at the end.
 */
export function compareSmallSampleSentence(
  c: Comparison, nameA: CompareName, nameB: CompareName, options: { ovrHidden?: boolean } = {},
): string | null {
  const cfg = GROUPS[c.group];
  const names = sentenceNames(c, nameA, nameB);
  const part = (p: ComparisonPlayer, name: string): string[] =>
    p.eligible || p.volume === null || p.games === null || p.games === 0 ? [] : [
      `${name} has ${p.volume} ${cfg.volumeWords[p.volume === 1 ? 0 : 1]} in ${p.games} ${p.games === 1 ? "game" : "games"}`,
    ];
  const parts = [...part(c.a, names[0]), ...part(c.b, names[1])];
  if (parts.length === 0) return null;
  return `Small sample: ${parts.join("; ")} (under ${cfg.minPerGame} a game).${options.ovrHidden ? " OVR hidden." : ""}`;
}

/**
 * C4m: one sentence per player whose outline is not drawn because half his
 * radar stats or more are missing (the stat card chart's rule). Empty when
 * both are drawn, and when no radar is drawn for want of qualified players.
 */
export function compareNotDrawnSentences(c: Comparison, nameA: CompareName, nameB: CompareName): string[] {
  if (c.radar !== "drawn") return [];
  const names = sentenceNames(c, nameA, nameB);
  const one = (p: ComparisonPlayer, name: string): string[] =>
    p.outline ? [] : [`No outline for ${name}: ${p.missing.filter(Boolean).length} of his ${p.missing.length} radar stats are not available.`];
  return [...one(c.a, names[0]), ...one(c.b, names[1])];
}
