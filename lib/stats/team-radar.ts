// lib/stats/team-radar.ts — the team radar's pure pieces (team radar spec
// 2026-10-06 §3-§4, §7-§9).
//
// No Supabase here, and nothing from lib/data: this module is pulled into the
// "use client" team hub's graph (a test asserts it). Like /team-stats it is a
// documented exception to "all stat computation happens in scripts/ingest.py":
// it adds up stored per-game team_game_stats rows on the server at request
// time. The rules are the Python reference's
// (docs/superpowers/specs/team-radar-reference/make_radar_expected.py) and the
// golden test holds the two together.
import { EM_DASH } from "@/lib/stats/formatters";
import { ordinal } from "@/lib/stats/percentiles";
import { earlySeasonNote, num, total, wavg } from "@/lib/stats/team-stats";

/* ─── Axes and sides ─── */

export type RadarSide = "off" | "def";
export type RadarAxisKey = "expl_pass" | "pass_sr" | "sack" | "to" | "stuff" | "rush_sr" | "expl_rush";

export interface RadarAxis {
  key: RadarAxisKey;
  /** Spoke and table label (offense). */
  label: string;
  /** Defense label when it differs ("Takeaway rate"). */
  defLabel?: string;
  /** Offense: a higher value ranks higher. Defense is the reverse on every axis. */
  offHigherBetter: boolean;
  /** Numerator column; for a weighted axis, the stored per-game rate. */
  num: string;
  /** Denominator columns, added together. */
  den: readonly string[];
  /** true: Σ(rate × den) ÷ Σ den. false: Σ num ÷ Σ den. */
  weighted: boolean;
  /** true: a NULL in either column on any row means "unknown", so the spoke is missing (never 0). */
  nullable: boolean;
  /** Table sub-line (R7). */
  subline: string;
  defSubline?: string;
  /** MetricTooltip / glossary key (R17-R19). */
  tooltip?: string;
}

/** The seven spokes, clockwise from the top (spec §4). */
export const RADAR_AXES: readonly RadarAxis[] = [
  {
    key: "expl_pass", label: "Explosive pass", offHigherBetter: true,
    num: "explosive_pass", den: ["pass_plays"], weighted: false, nullable: false,
    subline: "Completions of 20+ yards ÷ pass plays",
  },
  {
    key: "pass_sr", label: "Pass success", offHigherBetter: true,
    num: "pass_success_rate", den: ["pass_plays"], weighted: true, nullable: false,
    subline: "Pass plays with EPA above zero",
  },
  {
    key: "sack", label: "Sack rate", offHigherBetter: false,
    num: "sacks", den: ["attempts", "sacks"], weighted: false, nullable: false,
    subline: "Sacks ÷ (pass attempts + sacks)",
    tooltip: "Team sack rate",
  },
  {
    key: "to", label: "Turnover rate", defLabel: "Takeaway rate", offHigherBetter: false,
    num: "turnovers", den: ["total_drives"], weighted: false, nullable: false,
    subline: "Turnovers ÷ drives",
    defSubline: "Opponent turnovers ÷ opponent drives",
    tooltip: "Team turnover rate",
  },
  {
    key: "stuff", label: "Stuff rate", offHigherBetter: false,
    num: "stuffed_runs", den: ["designed_runs"], weighted: false, nullable: true,
    subline: "Runs for no gain or a loss ÷ designed runs",
    tooltip: "Team stuff rate",
  },
  {
    key: "rush_sr", label: "Run success", offHigherBetter: true,
    num: "rush_success_rate", den: ["rush_plays"], weighted: true, nullable: false,
    subline: "Designed runs with EPA above zero",
  },
  {
    key: "expl_rush", label: "Explosive run", offHigherBetter: true,
    num: "explosive_rush", den: ["rush_plays"], weighted: false, nullable: false,
    subline: "Runs of 10+ yards ÷ designed runs",
  },
];

/** URL word ↔ model side (the share pages of PR 3 use the slugs). */
export const RADAR_SIDES: readonly { side: RadarSide; slug: "offense" | "defense"; label: string }[] = [
  { side: "off", slug: "offense", label: "Offense" },
  { side: "def", slug: "defense", label: "Defense" },
];

export function higherIsBetter(axis: RadarAxis, side: RadarSide): boolean {
  return side === "off" ? axis.offHigherBetter : !axis.offHigherBetter;
}

export function axisLabel(axis: RadarAxis, side: RadarSide): string {
  return side === "def" && axis.defLabel ? axis.defLabel : axis.label;
}

export function axisSubline(axis: RadarAxis, side: RadarSide): string {
  return side === "def" && axis.defSubline ? axis.defSubline : axis.subline;
}

/* ─── Scale (spec §4, J5) ─── */

/** Last place sits on an inner ring this far out, not on the centre point. */
export const RADAR_HUB = 0.12;
/** The dashed ring: the middle of the league. */
export const RADAR_MID_SCORE = 0.5;
/** No radar until this many teams have played (J9). Drives the rule and R11's sentence. */
export const RADAR_MIN_TEAMS = 8;
/** A side with fewer real spokes than this shows its table only (R20). */
export const RADAR_MIN_SPOKES = 4;

/**
 * Rank → 0..1: 1st = 1 (outer ring), last = 0 (inner ring). A pool of 1 scores
 * 1 (never NaN or Infinity from pool − 1 = 0); a pool of 0, or no rank, has
 * nothing to score.
 */
export function radarScore(rank: number | null | undefined, pool: number): number | null {
  if (rank == null || !Number.isFinite(rank) || !Number.isFinite(pool) || pool < 1) return null;
  if (pool === 1) return 1;
  return (pool - rank) / (pool - 1);
}

/** Score → share of the outer radius. */
export function radarRadius(score: number): number {
  return RADAR_HUB + score * (1 - RADAR_HUB);
}

/* ─── Aggregation (spec §3) ─── */

export interface RadarSpoke {
  key: RadarAxisKey;
  /** The season rate, 0-1; null when it cannot be computed. */
  value: number | null;
  /** Competition rank in this spoke's pool (1 = best; ties share the better place). */
  rank: number | null;
  /** Another team in the pool has exactly this value. */
  tied: boolean;
  /** Teams with a value for this spoke on this side. */
  pool: number;
  /** radarScore(rank, pool). */
  score: number | null;
  /** [numerator, denominator] behind a plain ratio; null for a weighted rate or a missing spoke. */
  count: [number, number] | null;
}

/** One side of one team's season, spokes in RADAR_AXES order. */
export interface RadarSideModel {
  /** team-games on this side */
  gp: number;
  spokes: RadarSpoke[];
}

export interface TeamRadarTeam {
  team: string;
  /** rows where team_id is the team */
  off: RadarSideModel;
  /** rows where opponent_id is the team (what opponents did) */
  def: RadarSideModel;
}

export interface TeamRadarModel {
  /** every id seen as team_id or opponent_id, sorted */
  teams: TeamRadarTeam[];
  /** each spoke over all rows: the NFL average column */
  league: Record<RadarAxisKey, number | null>;
  /** teams with at least one row of their own: the N every sentence prints */
  teamsPlayed: number;
  /** the largest week in the rows ("Through Week N", review M3) */
  throughWeek: number | null;
  /** rows used: objects, of the season asked for, one per (game_id, team_id) */
  rowCount: number;
  /** "BUF off stuff"-style names of rates that came out impossible (outside 0-1) and were dropped */
  rejected: string[];
}

type Row = Readonly<Record<string, unknown>>;

interface RawValue {
  value: number | null;
  count: [number, number] | null;
  /** the inputs gave an impossible rate: dropped, and reported */
  rejected: boolean;
}

const MISSING: RawValue = { value: null, count: null, rejected: false };
const REJECTED: RawValue = { value: null, count: null, rejected: true };
const isRate = (v: number | null): v is number => v !== null && Number.isFinite(v) && v >= 0 && v <= 1;

/**
 * One spoke over one set of rows. A rate is a share of plays, so anything
 * outside 0-1 (stuffed > designed, a negative count, a stored rate of 12, an
 * overflowing sum) is a broken row, not a number to print or rank: the spoke
 * is missing and the caller reports it (chaos R3).
 */
function axisValue(rows: readonly Row[], axis: RadarAxis): RawValue {
  for (const r of rows) {
    const n = num(r[axis.num]);
    if (n !== null && (n < 0 || (axis.weighted && n > 1))) return REJECTED;
    for (const d of axis.den) {
      const v = num(r[d]);
      if (v !== null && v < 0) return REJECTED;
    }
  }
  if (axis.weighted) {
    const value = wavg(rows, axis.num, axis.den[0]);
    if (value === null) return MISSING;
    return isRate(value) ? { value, count: null, rejected: false } : REJECTED;
  }
  if (axis.nullable) {
    for (const r of rows) {
      if (num(r[axis.num]) === null) return MISSING;
      for (const d of axis.den) if (num(r[d]) === null) return MISSING;
    }
  }
  const top = total(rows, axis.num);
  let bot = 0;
  for (const d of axis.den) bot += total(rows, d);
  if (!bot) return MISSING;
  const value = top / bot;
  return isRate(value) ? { value, count: [top, bot], rejected: false } : REJECTED;
}

/**
 * Two season rates closer than this are the same rate. The weighted spokes
 * re-multiply each game's stored rate by its plays, so two teams with the same
 * season totals can differ in the last bits (0.4558823529411765 against
 * 0.45588235294117646); exact comparison ranked them 1st and 2nd with no "T-"
 * (chaos W1). Real rates differ by at least 1 / (plays × plays), far above this.
 */
export const RADAR_TIE_EPSILON = 1e-9;

const byId = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const isId = (v: unknown): v is string => typeof v === "string" && v !== "";

/**
 * Season radars for every team from team_game_stats rows (one per team per
 * game). Never the mean of game rates. Rank and pool are per spoke, per side.
 */
export function buildTeamRadar(
  rows: ReadonlyArray<Record<string, unknown>> | null | undefined,
  season?: number,
): TeamRadarModel {
  // Defence in depth (chaos R4, R5): the read filters by season and the table's
  // key is (game_id, team_id), but the builder does not take either on trust.
  // A row of another season is ignored; a repeated key counts once (first kept).
  const seen = new Set<string>();
  const all = (Array.isArray(rows) ? rows : []).filter((r): r is Record<string, unknown> => {
    if (r === null || typeof r !== "object") return false;
    if (season !== undefined) {
      const s = num(r.season);
      if (s !== null && s !== season) return false;
    }
    if (isId(r.game_id) && isId(r.team_id)) {
      const key = `${r.game_id}|${r.team_id}`;
      if (seen.has(key)) return false;
      seen.add(key);
    }
    return true;
  }) as readonly Row[];

  const ids = new Set<string>();
  const played = new Set<string>();
  let throughWeek: number | null = null;
  for (const r of all) {
    if (isId(r.team_id)) {
      ids.add(r.team_id);
      played.add(r.team_id);
    }
    if (isId(r.opponent_id)) ids.add(r.opponent_id);
    const w = num(r.week);
    if (w !== null && (throughWeek === null || w > throughWeek)) throughWeek = w;
  }

  const sorted = Array.from(ids).sort(byId);
  const raw = sorted.map((team) => {
    const off = all.filter((r) => r.team_id === team);
    const def = all.filter((r) => r.opponent_id === team);
    return {
      team,
      off: { gp: off.length, values: RADAR_AXES.map((a) => axisValue(off, a)) },
      def: { gp: def.length, values: RADAR_AXES.map((a) => axisValue(def, a)) },
    };
  });

  const sideModel = (t: (typeof raw)[number], side: RadarSide): RadarSideModel => ({
    gp: t[side].gp,
    spokes: RADAR_AXES.map((axis, i) => {
      const mine = t[side].values[i];
      const hi = higherIsBetter(axis, side);
      let pool = 0;
      let ahead = 0;
      let same = 0;
      // The pool is teams that have played (a row of their own), so no pool
      // is ever larger than the N the sentences print (chaos R1).
      const has = mine.value !== null && t[side].gp > 0 && played.has(t.team);
      for (const o of raw) {
        const v = o[side].gp > 0 && played.has(o.team) ? o[side].values[i].value : null;
        if (v === null) continue;
        pool += 1;
        if (!has || mine.value === null) continue;
        if (Math.abs(v - mine.value) < RADAR_TIE_EPSILON) same += 1;
        else if (hi ? v > mine.value : v < mine.value) ahead += 1;
      }
      const rank = has ? ahead + 1 : null;
      return {
        key: axis.key,
        value: has ? mine.value : null,
        rank,
        tied: has && same > 1,
        pool,
        score: radarScore(rank, pool),
        count: has ? mine.count : null,
      };
    }),
  });

  const league = {} as Record<RadarAxisKey, number | null>;
  const rejected: string[] = [];
  RADAR_AXES.forEach((a, i) => {
    const v = axisValue(all, a);
    const before = rejected.length;
    for (const t of raw) {
      if (t.off.values[i].rejected) rejected.push(`${t.team} off ${a.key}`);
      if (t.def.values[i].rejected) rejected.push(`${t.team} def ${a.key}`);
    }
    // A broken row is diluted, not removed, by the league sum (600 stuffs in
    // one game still lands inside 0-1), so the NFL average is missing whenever
    // any team's rate for the spoke was dropped.
    const poisoned = v.rejected || rejected.length > before;
    league[a.key] = poisoned ? null : v.value;
    if (poisoned) rejected.push(`league ${a.key}`);
  });

  return {
    rejected,
    teams: raw.map((t) => ({ team: t.team, off: sideModel(t, "off"), def: sideModel(t, "def") })),
    league,
    teamsPlayed: played.size,
    throughWeek,
    rowCount: all.length,
  };
}

/** Spokes on a side that have a value. */
export function realSpokeCount(side: RadarSideModel): number {
  return side.spokes.filter((s) => s.value !== null && s.score !== null).length;
}

/** Fewer than RADAR_MIN_SPOKES real spokes: the table only, under R20. */
export function canDrawRadar(side: RadarSideModel): boolean {
  return realSpokeCount(side) >= RADAR_MIN_SPOKES;
}

/* ─── States (spec §7) ─── */

export type TeamRadarStateName = "ready" | "no-games" | "small-pool" | "uncovered" | "unavailable";

export interface TeamRadarStateInput {
  /** the radar read rejected */
  failed: boolean;
  rowCount: number;
  teamsPlayed: number;
  /** this team has a row on either side */
  teamHasRows: boolean;
  /** the season being viewed */
  season: number;
  /** the newest season in data_freshness; null when unknown */
  newestSeason: number | null;
  /** seasons the box score probe says have team_game_stats rows ([] when the probe failed or found none) */
  covered: readonly number[];
}

/**
 * Which state the section is in. Total: evaluated top to bottom, first match
 * wins (spec §7's table, rows 1-7). `small-pool` is checked before `no-games`
 * so R10's "appears after their first game" is never a false promise.
 */
export function teamRadarState(i: TeamRadarStateInput): { state: TeamRadarStateName; firstSeason: number | null } {
  const out = (state: TeamRadarStateName, firstSeason: number | null = null) => ({ state, firstSeason });
  if (i.failed) return out("unavailable");
  if (i.rowCount > 0) {
    if (i.teamsPlayed < RADAR_MIN_TEAMS) return out("small-pool");
    if (!i.teamHasRows) return out("no-games");
    return out("ready");
  }
  // No rows. For the newest data season (its rows and its data_freshness row
  // are written in one transaction) or a season the probe says has rows, that
  // can only be a read failing silently.
  if ((i.newestSeason !== null && i.season === i.newestSeason) || i.covered.includes(i.season)) return out("unavailable");
  if (i.newestSeason !== null && i.season > i.newestSeason) return out("small-pool");
  const first = i.covered.length > 0 ? Math.min(...i.covered) : null;
  return out("uncovered", first !== null && i.season < first ? first : null);
}

/**
 * What the server page hands the "use client" hub: plain data, null for every
 * missing value (NaN and Infinity do not survive the server→client boundary).
 */
export type TeamRadarSlice =
  | {
      state: "ready";
      season: number;
      /** N: teams with at least one game */
      teamsPlayed: number;
      /** G: this team's own rows */
      games: number;
      throughWeek: number | null;
      isLatestSeason: boolean;
      off: RadarSideModel;
      def: RadarSideModel;
      league: Record<RadarAxisKey, number | null>;
    }
  | { state: "no-games" | "small-pool" | "unavailable"; season: number }
  | { state: "uncovered"; season: number; firstSeason: number | null };

export interface TeamRadarSliceInput {
  teamId: string;
  season: number;
  /** the season's radar rows; null when the read rejected */
  rows: ReadonlyArray<Record<string, unknown>> | null;
  newestSeason: number | null;
  covered: readonly number[];
  /** Called at most once, when a rate came out impossible and was dropped (the server page passes console.error). */
  log?: (message: string) => void;
}

export function teamRadarSlice(i: TeamRadarSliceInput): TeamRadarSlice {
  const failed = i.rows === null;
  const model = buildTeamRadar(i.rows ?? [], i.season);
  if (model.rejected.length > 0 && i.log) {
    const shown = model.rejected.slice(0, 12).join(", ");
    const more = model.rejected.length > 12 ? ` and ${model.rejected.length - 12} more` : "";
    i.log(`Team radar ${i.season}: ${model.rejected.length} rate(s) outside 0-1 dropped as missing (bad team_game_stats rows): ${shown}${more}`);
  }
  const mine = model.teams.find((t) => t.team === i.teamId);
  const { state, firstSeason } = teamRadarState({
    failed,
    rowCount: model.rowCount,
    teamsPlayed: model.teamsPlayed,
    // "Played" is a row of the team's own (§7 row 3). An opponent's row alone
    // (a half-written game) is not a radar "through 0 games" (chaos R1).
    teamHasRows: !!mine && mine.off.gp > 0,
    season: i.season,
    newestSeason: i.newestSeason,
    covered: i.covered,
  });
  if (state === "uncovered") return { state, season: i.season, firstSeason };
  if (state !== "ready" || !mine) return { state: state === "ready" ? "no-games" : state, season: i.season };
  return {
    state: "ready",
    season: i.season,
    teamsPlayed: model.teamsPlayed,
    games: mine.off.gp,
    throughWeek: model.throughWeek,
    isLatestSeason: i.newestSeason !== null && i.season === i.newestSeason,
    off: mine.off,
    def: mine.def,
    league: model.league,
  };
}

/* ─── Outline colour (chaos R2; the share card of PR 3 uses it too) ─── */

const HEX6 = /^#[0-9a-fA-F]{6}$/;
/** The outline when neither team colour can be read on white. */
export const RADAR_NEUTRAL_STROKE = "#0f172a";
/** WCAG's minimum contrast for graphical objects. */
export const RADAR_MIN_STROKE_CONTRAST = 3;

/** WCAG contrast ratio of a #rrggbb colour against white (1-21); 1 for anything that is not #rrggbb. */
export function contrastOnWhite(hex: string): number {
  if (typeof hex !== "string" || !HEX6.test(hex)) return 1;
  const channel = (i: number) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  const luminance = 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
  return 1.05 / (luminance + 0.05);
}

/**
 * The colour of the radar's outline and dots. The team's primary colour when
 * it shows on white (3:1 or better); otherwise the secondary if that does;
 * otherwise a dark neutral. Pittsburgh's and New Orleans' golds are under 2:1
 * and Pittsburgh's sat on top of the dashed middle ring. The light primary
 * stays as the fill tint.
 */
export function radarStrokeColor(primaryColor: string, secondaryColor: string): string {
  if (contrastOnWhite(primaryColor) >= RADAR_MIN_STROKE_CONTRAST) return primaryColor;
  if (contrastOnWhite(secondaryColor) >= RADAR_MIN_STROKE_CONTRAST) return secondaryColor;
  return RADAR_NEUTRAL_STROKE;
}

/* ─── Formatting ─── */

/** A 0-1 rate as "10.7%"; a dash when missing. */
export function fmtRadarPct(v: number | null | undefined): string {
  return typeof v === "number" && Number.isFinite(v) ? `${(v * 100).toFixed(1)}%` : EM_DASH;
}

/** "2nd", "T-30th" when another team shares the value, a dash when there is no rank. */
export function spokeRankLabel(s: Pick<RadarSpoke, "rank" | "tied">): string {
  if (s.rank == null || !Number.isFinite(s.rank)) return EM_DASH;
  return `${s.tied ? "T-" : ""}${ordinal(s.rank)}`;
}

/** The table's rank cell: the pool is printed beside the rank when it is smaller than N ("3rd of 31"). */
export function rankCellLabel(s: Pick<RadarSpoke, "rank" | "tied" | "pool">, teamsPlayed: number): string {
  const label = spokeRankLabel(s);
  if (label === EM_DASH) return label;
  return s.pool < teamsPlayed ? `${label} of ${s.pool}` : label;
}

export type RankTone = "good" | "mid" | "bad" | "none";

/**
 * The rank chip's colour. Among 32 teams it is the approved mockup's rule
 * (1st-10th green, 23rd-32nd red); a smaller pool uses the same positions on
 * the 0-1 scale, so "10th of 12" is not green.
 */
export function rankTone(rank: number | null | undefined, pool: number): RankTone {
  const score = radarScore(rank, pool);
  if (score === null) return "none";
  if (score >= 22 / 31) return "good";
  if (score <= 9 / 31) return "bad";
  return "mid";
}

/* ─── Visitor-facing copy (spec §8). Plain strings, rendered verbatim as {CONST}. ─── */

/** R1 — the section lead. */
export function radarLead(teamName: string, teamsPlayed: number, games: number): string {
  const among = teamsPlayed === 32 ? "all 32 teams" : `the ${teamsPlayed} teams that have played`;
  return `How the ${teamName} rank among ${among}, through ${games} ${games === 1 ? "game" : "games"}.`;
}

/** R2 — side subtitles. */
export const RADAR_SUBTITLE: Record<RadarSide, string> = {
  off: "What the offense did",
  def: "What opponents did against this defense",
};

/** R3 */
export function radarScaleNote(teamsPlayed: number): string {
  return `Each spoke shows the team’s rank among the ${teamsPlayed} teams that have played: 1st sits on the outer ring, last on the inner ring, and the dashed ring is the middle of the league. Farther out is always better.`;
}

/** R4 */
export const RADAR_DIRECTION_NOTE =
  "On offense a lower sack rate, stuff rate and turnover rate ranks higher. On defense it is the reverse: more sacks, stuffs and takeaways rank higher, and lower explosive and success rates allowed rank higher.";

/** R5 */
export const RADAR_RATES_NOTE =
  "Every rate adds up the team’s box scores for the season. A pass play is any dropback, including sacks and scrambles. QB scrambles of 10+ yards count as explosive runs but not as designed runs, so a team with long scrambles can run high on Explosive run.";

/** R5b */
export const RADAR_STUFF_NOTE =
  "Stuff rate leaves out kneel-downs, two-point tries and runs wiped out by a penalty; Run success and Explosive run keep two-point tries and penalty-wiped runs, as the Team Stats page does.";

/** The footnotes under the radars, in order: R3, R4, R5, R5b, then R6 in weeks 1-4 of the newest season. */
export function teamRadarFootnotes(s: {
  teamsPlayed: number;
  throughWeek: number | null;
  isLatestSeason: boolean;
}): string[] {
  const out = [radarScaleNote(s.teamsPlayed), RADAR_DIRECTION_NOTE, RADAR_RATES_NOTE, RADAR_STUFF_NOTE];
  const early = earlySeasonNote(s.throughWeek, s.isLatestSeason);
  if (early) out.push(early);
  return out;
}

/** R9 — on /team-stats, only once RADAR_MIN_TEAMS teams have played. */
export const TEAM_STATS_RADAR_NOTE =
  "Each team’s page has a radar of its explosive, success, sack, stuff and turnover rates.";

/** R10 */
export function radarNoGamesNote(teamName: string, season: number): string {
  return `The ${teamName} have not played a ${season} game yet. Their radar appears after their first game.`;
}

/** R11 — also the state for a season later than the newest data season. */
export const RADAR_SMALL_POOL_NOTE = `Team radars start once ${RADAR_MIN_TEAMS} teams have played this season. Until then there are too few teams to rank against.`;

/** R12 (a first covered season is known and later than the viewed one) / R12b (otherwise; names no other year). */
export function radarUncoveredNote(season: number, firstSeason: number | null): string {
  return firstSeason != null
    ? `Team radars start with the ${firstSeason} season.`
    : `Team radars are not available for the ${season} season.`;
}

/** R13 */
export const RADAR_UNAVAILABLE_NOTE = "The team radar is unavailable right now.";

/** R17 — MetricTooltip + glossary, key "Team sack rate". */
export const TEAM_SACK_RATE_DEFINITION =
  "Sacks divided by pass attempts plus sacks, added up over the team’s games. Scrambles and two-point tries are not counted.";

/** R18 — key "Team turnover rate". */
export const TEAM_TURNOVER_RATE_DEFINITION =
  "Turnovers (interceptions plus fumbles lost) divided by the team’s drives. On defense it is the takeaway rate: opponents’ turnovers divided by opponents’ drives.";

/** R19 — key "Team stuff rate". */
export const TEAM_STUFF_RATE_DEFINITION =
  "Designed runs stopped for no gain or a loss, divided by designed runs. Kneel-downs, QB scrambles, two-point tries and runs wiped out by a penalty are left out. It counts every designed run, including those by quarterbacks and receivers, so it will not match the running backs’ stuff rates.";

/** The three new tooltip / glossary entries, keyed as RADAR_AXES names them. */
export const TEAM_RADAR_DEFINITIONS: Record<string, string> = {
  "Team sack rate": TEAM_SACK_RATE_DEFINITION,
  "Team turnover rate": TEAM_TURNOVER_RATE_DEFINITION,
  "Team stuff rate": TEAM_STUFF_RATE_DEFINITION,
};

/** R20 — a side with fewer than RADAR_MIN_SPOKES real spokes. */
export function radarTableOnlyNote(side: RadarSide): string {
  return `Not enough of these rates are available yet to draw the ${side === "off" ? "offense" : "defense"} radar.`;
}

/** The link beside the lead. */
export const COMPARE_TEAMS_LINK_TEXT = "Compare all teams on Team Stats";

/** /team-stats for the viewed season: bare for the default season, ?season= for a past one. */
export function teamStatsHref(season: number, defaultSeason: number): string {
  return season === defaultSeason ? "/team-stats" : `/team-stats?season=${season}`;
}

/** The share page for one side (PR 3): bare for the default season, ?season= for a past one (the playerHref rule). */
export function radarCardHref(teamId: string, side: RadarSide, season: number, defaultSeason: number): string {
  const slug = side === "off" ? "offense" : "defense";
  return `/card/team/${teamId}/${slug}${season === defaultSeason ? "" : `?season=${season}`}`;
}

/** The band's right-hand text: "2026 · Through Week 3". */
export function radarBandAside(season: number, throughWeek: number | null): string {
  return throughWeek != null && Number.isFinite(throughWeek) ? `${season} · Through Week ${throughWeek}` : `${season}`;
}
