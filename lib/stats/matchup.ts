// lib/stats/matchup.ts — the team matchup's pure half (team matchup spec
// 2026-10-10 §3, §6.4, §7, §8.5).
//
// One team's offense against the other team's defense, and the reverse, by
// league rank. No Supabase, nothing from lib/data, no React or Next (a test
// checks): the server loader (lib/data/matchup.ts) hands this module rows and
// gets plain data back, null for every missing value, never NaN.
//
// Like /team-stats and the team radar this is a documented exception to "all
// stat computation happens in scripts/ingest.py": it adds up stored per-game
// team_game_stats rows on the server at request time, through the two existing
// builders (buildTeamStats, buildTeamRadar), which are not changed. The rules
// are the Python reference's
// (docs/superpowers/specs/matchup-reference/make_matchup_expected.py) and the
// golden test holds the two together.
//
// Browser code must NOT import this file (it pulls the team stat modules into
// the bundle): links and URL words live in lib/stats/matchup-links.ts.
import type { QBSeasonStat, RBSeasonStat, ReceiverSeasonStat } from "@/lib/types";
import { MINUS, fmtFixed, isNum, normalizeGameType, type WinLossTie } from "@/lib/stats/box-score";
import { EM_DASH } from "@/lib/stats/formatters";
import {
  RADAR_AXES,
  RADAR_MIN_TEAMS,
  RADAR_RATES_NOTE,
  RADAR_STUFF_NOTE,
  RADAR_TIE_EPSILON,
  buildTeamRadar,
  canDrawRadar,
  rankCellLabel,
  spokeRankLabel,
  type RadarAxisKey,
  type RadarSideModel,
  type TeamRadarModel,
} from "@/lib/stats/team-radar";
import { EXPLOSIVE_NOTE, TEAM_TIERS_LINK_TEXT, buildTeamStats, num, type TeamStatsModel } from "@/lib/stats/team-stats";
import { playerHref } from "@/lib/utils";

/* ─── Ranks (spec §3.2) ─── */

export interface RankedValue {
  value: number | null;
  /** competition rank, 1 = best */
  rank: number | null;
  tied: boolean;
  /** how many teams were ranked */
  pool: number;
}

/**
 * Competition ranking by the radar's pairwise count
 * (lib/stats/team-radar.ts, buildTeamRadar): for a team with a value,
 * rank = 1 + the number of pool values better than its own by at least
 * RADAR_TIE_EPSILON; tied = some OTHER pool value is within RADAR_TIE_EPSILON
 * of its own; pool = the number of values. Ties share the better place and the
 * next place is skipped.
 *
 * Not sort-then-group: the tie test is a tolerance, so on a chain of near-ties
 * (a, a + 0.6e-9, a + 1.2e-9) a grouped sort gives different answers.
 *
 * An entry whose value is not a finite number (null, NaN, Infinity, a string)
 * is outside the pool: no rank, and it is not counted.
 */
export function competitionRank(
  values: ReadonlyArray<{ id: string; value: number | null }>,
  higherIsBetter: boolean,
): Map<string, RankedValue> {
  const out = new Map<string, RankedValue>();
  const entries = (Array.isArray(values) ? values : []).filter(
    (e): e is { id: string; value: number | null } => e !== null && typeof e === "object" && typeof e.id === "string",
  );
  const pool: number[] = [];
  for (const e of entries) if (isNum(e.value)) pool.push(e.value);
  for (const e of entries) {
    const mine = e.value;
    if (!isNum(mine)) {
      out.set(e.id, { value: null, rank: null, tied: false, pool: pool.length });
      continue;
    }
    let ahead = 0;
    let same = 0;
    for (const v of pool) {
      if (Math.abs(v - mine) < RADAR_TIE_EPSILON) same += 1;
      else if (higherIsBetter ? v > mine : v < mine) ahead += 1;
    }
    // `same` counts the team itself.
    out.set(e.id, { value: mine, rank: ahead + 1, tied: same > 1, pool: pool.length });
  }
  return out;
}

export type TeamStatField = "epa" | "pass_epa" | "rush_epa" | "sr" | "early_epa" | "late_epa";

/**
 * One Team Stats number ranked for every team on one side. The pool is the
 * radar's: teams that have played (a row of their own, off.gp > 0), with at
 * least one game on the side being ranked, and a value. A team outside the
 * pool has no value and no rank here (a team with only an opponent's row has
 * a defense number in the Team Stats model, but it has not played).
 */
export function rankTeamStat(
  model: TeamStatsModel,
  field: TeamStatField,
  side: "off" | "def",
  offHigherBetter: boolean,
): Map<string, RankedValue> {
  const higher = side === "off" ? offHigherBetter : !offHigherBetter;
  return competitionRank(
    (model?.teams ?? []).map((t) => {
      const v = t[side][field];
      return { id: t.team, value: t.off.gp > 0 && t[side].gp > 0 && isPlausibleTeamStat(field, v) ? v : null };
    }),
    higher,
  );
}

/** The largest EPA per play a team's season can plausibly hold, either way (real values sit within about ±0.5). */
export const MATCHUP_MAX_EPA_PER_PLAY = 5;

/**
 * Can this Team Stats number be printed and ranked (chaos F4)? buildTeamStats
 * does not bound what it adds up, so one bad stored value (a success rate of
 * 12, an EPA per play of 900) would otherwise rank that team 1st or last on
 * the line and move every other team's rank and edge. The same treatment the
 * radar gives its rates: a success rate must be a share of plays (0-1), an EPA
 * per play within ±MATCHUP_MAX_EPA_PER_PLAY. Anything else is no value: a
 * dash, the row `na`, out of the pool, and listed in `rejected`.
 */
export function isPlausibleTeamStat(field: TeamStatField, v: unknown): v is number {
  if (!isNum(v)) return false;
  return field === "sr" ? v >= 0 && v <= 1 : Math.abs(v) <= MATCHUP_MAX_EPA_PER_PLAY;
}

/* ─── The 13 lines (spec §3.1) ─── */

export type MatchupStatKey =
  | "epa" | "sr" | "pass_epa" | "pass_sr" | "expl_pass" | "sack"
  | "rush_epa" | "rush_sr" | "expl_rush" | "stuff" | "to" | "early_epa" | "late_epa";
export type MatchupGroup = "Overall" | "Passing" | "Rushing" | "Turnovers" | "Downs";

export interface MatchupStat {
  key: MatchupStatKey;
  group: MatchupGroup;
  label: string;
  shortLabel?: string;
  /** Where the value and its rank come from: buildTeamStats (ranked here) or a radar spoke (ranked by buildTeamRadar). */
  source: "team-stats" | "radar";
  format: "epa" | "pct";
  /** Offense: a higher value ranks higher. Defense is the reverse on every line. */
  offHigherBetter: boolean;
  /** The word under the defense rank. */
  defWord: "allowed" | "made" | "takeaways";
}

const line = (
  key: MatchupStatKey,
  group: MatchupGroup,
  label: string,
  source: MatchupStat["source"],
  format: MatchupStat["format"],
  extra: Partial<MatchupStat> = {},
): MatchupStat => ({ key, group, label, source, format, offHigherBetter: true, defWord: "allowed", ...extra });

/**
 * The 13 ladder lines, in page order. Lines 4, 5, 8 and 9 read the radar
 * spoke, not Team Stats (S2): the numbers are the same to the digit, and the
 * rank in the ladder is then the same object as the rank on the radar's label.
 */
export const MATCHUP_STATS: readonly MatchupStat[] = [
  line("epa", "Overall", "EPA / play", "team-stats", "epa"),
  line("sr", "Overall", "Success rate", "team-stats", "pct"),
  line("pass_epa", "Passing", "Pass EPA / play", "team-stats", "epa"),
  line("pass_sr", "Passing", "Pass success rate", "radar", "pct"),
  line("expl_pass", "Passing", "Explosive pass rate", "radar", "pct"),
  line("sack", "Passing", "Sack rate", "radar", "pct", { offHigherBetter: false, defWord: "made" }),
  line("rush_epa", "Rushing", "Rush EPA / play", "team-stats", "epa"),
  line("rush_sr", "Rushing", "Run success rate", "radar", "pct"),
  line("expl_rush", "Rushing", "Explosive run rate", "radar", "pct"),
  line("stuff", "Rushing", "Stuff rate", "radar", "pct", { offHigherBetter: false, defWord: "made" }),
  line("to", "Turnovers", "Turnover rate vs takeaway rate", "radar", "pct", {
    shortLabel: "Turnovers", offHigherBetter: false, defWord: "takeaways",
  }),
  line("early_epa", "Downs", "Early downs EPA (1st–2nd)", "team-stats", "epa"),
  line("late_epa", "Downs", "Late downs EPA (3rd–4th)", "team-stats", "epa"),
];

/* ─── The edge rule (spec §3.3). The constants live here and nowhere else. ─── */

/** 5–12 places apart: a lean. */
export const EDGE_LEAN_MIN_GAP = 5;
/** 13 or more: a clear edge. */
export const EDGE_CLEAR_MIN_GAP = 13;
/** "Strength on strength": both units this rank or better. */
export const EDGE_STRENGTH_MAX_RANK = 8;
/** "Weakness on weakness": both units this rank or worse. */
export const EDGE_WEAKNESS_MIN_RANK = 25;
/** S3: the two named even-labels are used only when both pools are this large (the smallest pool with a 25th place). */
export const EDGE_NAMED_MIN_POOL = 25;
/** The tug marker's travel: 32 teams − 1. */
export const EDGE_TUG_SCALE = 31;

export type EdgeSide = "off" | "def" | "even" | "na";
export interface Edge {
  side: EdgeSide;
  /** 0 even / na, 1 lean, 2 clear */
  level: 0 | 1 | 2;
  /** defense rank − offense rank: positive = the offense ranks higher */
  gap: number | null;
  places: number | null;
  tag: "Even" | "Strength on strength" | "Weakness on weakness" | "Lean" | "Clear edge" | "Not enough data";
}

/** A rank the rule can use: a whole number from 1 up. */
const isRank = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 1;
const isNamedPool = (v: unknown): boolean => typeof v === "number" && Number.isFinite(v) && v >= EDGE_NAMED_MIN_POOL;

/**
 * The edge between an offense's ranked cell and a defense's. It only compares
 * two season ranks; it is not a prediction. The two ranks may come from pools
 * of different size: the gap is still rank minus rank, and the lean / clear
 * cut-offs are the same in any pool.
 */
export function edgeOf(
  off: Pick<RankedValue, "rank" | "pool"> | null | undefined,
  def: Pick<RankedValue, "rank" | "pool"> | null | undefined,
): Edge {
  const offRank = off?.rank;
  const defRank = def?.rank;
  if (!isRank(offRank) || !isRank(defRank)) {
    return { side: "na", level: 0, gap: null, places: null, tag: "Not enough data" };
  }
  const gap = defRank - offRank;
  const places = Math.abs(gap);
  if (places < EDGE_LEAN_MIN_GAP) {
    const named = isNamedPool(off?.pool) && isNamedPool(def?.pool);
    let tag: Edge["tag"] = "Even";
    if (named && offRank <= EDGE_STRENGTH_MAX_RANK && defRank <= EDGE_STRENGTH_MAX_RANK) tag = "Strength on strength";
    else if (named && offRank >= EDGE_WEAKNESS_MIN_RANK && defRank >= EDGE_WEAKNESS_MIN_RANK) tag = "Weakness on weakness";
    return { side: "even", level: 0, gap, places, tag };
  }
  const side: EdgeSide = gap > 0 ? "off" : "def";
  return places < EDGE_CLEAR_MIN_GAP
    ? { side, level: 1, gap, places, tag: "Lean" }
    : { side, level: 2, gap, places, tag: "Clear edge" };
}

/**
 * Where the tug marker sits, 0–100 (% from the left). The offense is on the
 * left, so a positive gap slides the marker left. 50 when there is no gap to
 * show.
 */
export function tugPosition(edge: Edge): number {
  const gap = edge?.gap;
  if (typeof gap !== "number" || !Number.isFinite(gap)) return 50;
  return Math.min(100, Math.max(0, 50 - (gap / EDGE_TUG_SCALE) * 50));
}

const placesWord = (n: number) => `${n} ${n === 1 ? "place" : "places"}`;

/** The line under the marker. `offId` / `defId` are team ids (BUF, LA). */
export function verdictText(edge: Edge, offId: string, defId: string): string {
  if (!edge || edge.side === "na" || edge.places === null) return "Not enough data";
  if (edge.side === "even") {
    return edge.places === 0 ? `${edge.tag} · same rank` : `${edge.tag} · ${placesWord(edge.places)} apart`;
  }
  const unit = edge.side === "off" ? `${offId} offense` : `${defId} defense`;
  const base = `${unit} by ${placesWord(edge.places)}`;
  return edge.level === 2 ? `${base} · clear edge` : base;
}

/* ─── The model (spec §7.2) ─── */

/** One ladder line, already formatted: client components print strings only. */
export interface LadderRow {
  key: MatchupStatKey;
  group: MatchupGroup;
  label: string;
  shortLabel: string;
  /** "+0.195", "10.3%", "—" */
  offValue: string;
  /** "2nd", "T-2nd of 31", "—" */
  offRank: string;
  defValue: string;
  defRank: string;
  defWord: string;
  edge: Edge;
  tug: number;
  verdict: string;
}
/** Always 13 rows, in MATCHUP_STATS order. */
export interface LadderModel { offId: string; defId: string; rows: LadderRow[] }

export interface OverlaySpoke {
  key: RadarAxisKey;
  label: string;
  /** "2nd v T-14th", "2nd v —": offense rank v defense rank */
  rankLine: string;
  /** both ranks present and EDGE_LEAN_MIN_GAP or more places apart */
  gapBar: boolean;
}
export interface OverlayModel {
  offId: string;
  defId: string;
  /** null: that team has not played */
  off: RadarSideModel | null;
  def: RadarSideModel | null;
  /** both sides pass canDrawRadar */
  drawn: boolean;
  /** RADAR_AXES order */
  spokes: OverlaySpoke[];
  /** null when not drawn. Counts only spokes with both ranks; `ranked` says how many. */
  tally: { off: number; def: number; even: number; ranked: number } | null;
}

export interface MatchupSide { ladder: LadderModel; overlay: OverlayModel }
export interface MatchupModel {
  state: "ready" | "small-pool";
  season: number;
  teamsPlayed: number;
  /** buildTeamRadar's (the largest week in the rows), never a second read */
  throughWeek: number | null;
  /** games = rows of its own */
  away: { id: string; games: number };
  home: { id: string; games: number };
  /** away offense v home defense; null in small-pool */
  awayBall: MatchupSide | null;
  /** home offense v away defense */
  homeBall: MatchupSide | null;
  /** buildTeamRadar's, for the page's one log line */
  rejected: string[];
}

type Row = Record<string, unknown>;
const isId = (v: unknown): v is string => typeof v === "string" && v !== "";
const hasText = (v: unknown): v is string => typeof v === "string" && v.trim() !== "";

/**
 * The rows both builders stand on: objects, of the season asked for, the first
 * of a repeated (game_id, team_id). buildTeamRadar applies this filter itself
 * (lib/stats/team-radar.ts, the top of buildTeamRadar); buildTeamStats does
 * not filter or de-duplicate, so buildMatchup applies it once and hands both
 * the same rows. It repeats private code, so a test holds the two together
 * (this function's length equals buildTeamRadar(rows, season).rowCount).
 */
export function matchupSeasonRows(rows: ReadonlyArray<Record<string, unknown>> | null | undefined, season: number): Row[] {
  const seen = new Set<string>();
  return (Array.isArray(rows) ? rows : []).filter((r): r is Row => {
    if (r === null || typeof r !== "object") return false;
    const s = num(r.season);
    if (s !== null && s !== season) return false;
    if (isId(r.game_id) && isId(r.team_id)) {
      const key = `${r.game_id}|${r.team_id}`;
      if (seen.has(key)) return false;
      seen.add(key);
    }
    return true;
  });
}

const NO_CELL: RankedValue = { value: null, rank: null, tied: false, pool: 0 };

/** The spoke labels on the overlay radar: short, and the same word for both sides. (Exported for the matchup card's label fallback.) */
export const OVERLAY_LABELS: Record<RadarAxisKey, string> = {
  expl_pass: "Explosive pass",
  pass_sr: "Pass success",
  sack: "Sacks",
  to: "Turnovers",
  stuff: "Stuffs",
  rush_sr: "Run success",
  expl_rush: "Explosive run",
};

function radarSide(radar: TeamRadarModel, teamId: string, side: "off" | "def"): RadarSideModel | null {
  const team = radar.teams.find((t) => t.team === teamId);
  // "Played" is a row of the team's own; an opponent's row alone is not a game played.
  return team && team.off.gp > 0 ? team[side] : null;
}

/**
 * The whole matchup from one season's team_game_stats rows: both ladders and
 * both overlays, as plain data. Calls buildTeamStats once and buildTeamRadar
 * once. Never throws on bad rows, an unknown team id or a team with no games.
 */
export function buildMatchup(input: {
  rows: ReadonlyArray<Record<string, unknown>>;
  season: number;
  awayId: string;
  homeId: string;
}): MatchupModel {
  const { season, awayId, homeId } = input;
  const rows = matchupSeasonRows(input.rows, season);
  const stats = buildTeamStats(rows);
  const radar = buildTeamRadar(rows, season);
  const games = (id: string) => stats.teams.find((t) => t.team === id)?.off.gp ?? 0;

  // The radar reports the rates it dropped; the six Team Stats lines are
  // checked here (chaos F4), named the same way ("BUF off sr").
  const rejected = [...radar.rejected];
  for (const stat of MATCHUP_STATS) {
    if (stat.source !== "team-stats") continue;
    for (const t of stats.teams) {
      for (const side of ["off", "def"] as const) {
        const v = t[side][stat.key as TeamStatField];
        // null is "no data"; a number that is out of range or not finite (an overflowing sum) is a broken value.
        if (typeof v === "number" && !isPlausibleTeamStat(stat.key as TeamStatField, v)) rejected.push(`${t.team} ${side} ${stat.key}`);
      }
    }
  }

  const base = {
    season,
    teamsPlayed: radar.teamsPlayed,
    throughWeek: radar.throughWeek,
    away: { id: awayId, games: games(awayId) },
    home: { id: homeId, games: games(homeId) },
    rejected,
  };
  // Under RADAR_MIN_TEAMS teams a rank is noise (S4): no ladder, no radar, no rank anywhere.
  if (radar.teamsPlayed < RADAR_MIN_TEAMS) {
    return { state: "small-pool", ...base, awayBall: null, homeBall: null };
  }

  const ranked = new Map<string, Map<string, RankedValue>>();
  for (const stat of MATCHUP_STATS) {
    if (stat.source !== "team-stats") continue;
    for (const side of ["off", "def"] as const) {
      ranked.set(`${stat.key}|${side}`, rankTeamStat(stats, stat.key as TeamStatField, side, stat.offHigherBetter));
    }
  }

  const cellOf = (stat: MatchupStat, teamId: string, side: "off" | "def"): RankedValue => {
    if (stat.source === "team-stats") return ranked.get(`${stat.key}|${side}`)?.get(teamId) ?? NO_CELL;
    const spoke = radarSide(radar, teamId, side)?.spokes.find((s) => s.key === stat.key);
    return spoke ? { value: spoke.value, rank: spoke.rank, tied: spoke.tied, pool: spoke.pool } : NO_CELL;
  };
  const fmt = (stat: MatchupStat, v: number | null) => (stat.format === "epa" ? fmtFixed(v, 3, true) : fmtRate(v));

  const sideOf = (offId: string, defId: string): MatchupSide => {
    const ladderRows: LadderRow[] = MATCHUP_STATS.map((stat) => {
      const off = cellOf(stat, offId, "off");
      const def = cellOf(stat, defId, "def");
      const edge = edgeOf(off, def);
      return {
        key: stat.key,
        group: stat.group,
        label: stat.label,
        shortLabel: stat.shortLabel ?? stat.label,
        offValue: fmt(stat, off.value),
        offRank: rankCellLabel(off, radar.teamsPlayed),
        defValue: fmt(stat, def.value),
        defRank: rankCellLabel(def, radar.teamsPlayed),
        defWord: stat.defWord,
        edge,
        tug: tugPosition(edge),
        verdict: verdictText(edge, offId, defId),
      };
    });

    const off = radarSide(radar, offId, "off");
    const def = radarSide(radar, defId, "def");
    const drawn = off !== null && def !== null && canDrawRadar(off) && canDrawRadar(def);
    const tally = { off: 0, def: 0, even: 0, ranked: 0 };
    const spokes: OverlaySpoke[] = RADAR_AXES.map((axis, i) => {
      const o = off?.spokes[i] ?? NO_CELL;
      const d = def?.spokes[i] ?? NO_CELL;
      const edge = edgeOf(o, d);
      if (edge.side !== "na") {
        tally.ranked += 1;
        if (edge.side === "off") tally.off += 1;
        else if (edge.side === "def") tally.def += 1;
        else tally.even += 1;
      }
      return {
        key: axis.key,
        label: OVERLAY_LABELS[axis.key],
        rankLine: `${spokeRankLabel(o)} v ${spokeRankLabel(d)}`,
        gapBar: edge.places !== null && edge.places >= EDGE_LEAN_MIN_GAP,
      };
    });

    return {
      ladder: { offId, defId, rows: ladderRows },
      overlay: { offId, defId, off, def, drawn, spokes, tally: drawn ? tally : null },
    };
  };

  return { state: "ready", ...base, awayBall: sideOf(awayId, homeId), homeBall: sideOf(homeId, awayId) };
}

/* ─── Main players (spec §7.3) ─── */

export interface LineupStat { label: string; value: string }
export interface LineupPlayer {
  slot: "QB" | "RB" | "REC";
  /** "QB", "RB", "WR", "TE" */
  pos: string;
  playerId: string;
  /** the full name from the slug list, else the season row's name */
  name: string;
  /** playerHref(slug, season, defaultSeason); null with no slug */
  href: string | null;
  /** four, already formatted */
  stats: LineupStat[];
}

/** A whole number with thousands separators and a real minus ("1,039", "−5"); a dash when missing. */
function whole(v: unknown): string {
  const n = sane(v);
  if (n === null) return EM_DASH;
  const r = Math.round(n);
  const body = String(Math.abs(r)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return r < 0 ? `${MINUS}${body}` : body;
}
const signed = (v: unknown, decimals: number) => fmtFixed(sane(v), decimals, true);

/** No stat on the page is this large: beyond it a number is a broken value, printed as a dash (chaos F11). */
const ABSURD = 1e9;
/** A number that can be printed: finite and not absurd; a numeric string counts. Else null. */
function sane(v: unknown): number | null {
  const n = num(v);
  return n !== null && Math.abs(n) <= ABSURD ? n : null;
}

/**
 * A 0-1 rate as "10.3%". The radar's own formatter (fmtRadarPct) prints the
 * same digits for every real rate; this one also uses the site's true minus
 * for a negative value and prints a dash, never "Infinity%", for an absurd one.
 */
function fmtRate(v: unknown): string {
  const n = sane(v);
  return n === null ? EM_DASH : `${fmtFixed(n * 100, 1)}%`;
}

/** A team's rows of one season table: its own team_id (strict), a usable player_id, each player once (first kept). */
function teamRows(rows: unknown, teamId: string): Row[] {
  const seen = new Set<string>();
  const out: Row[] = [];
  for (const r of Array.isArray(rows) ? (rows as unknown[]) : []) {
    if (r === null || typeof r !== "object") continue;
    const row = r as Row;
    if (row.team_id !== teamId || !isId(row.player_id) || seen.has(row.player_id)) continue;
    seen.add(row.player_id);
    out.push(row);
  }
  return out;
}

/** Most of `first`, then most of `second`, then player_id ascending. A non-finite value counts as 0. */
function byVolume(first: string, second: string) {
  const n = (r: Row, col: string) => num(r[col]) ?? 0;
  return (a: Row, b: Row): number =>
    n(b, first) - n(a, first) || n(b, second) - n(a, second) ||
    ((a.player_id as string) < (b.player_id as string) ? -1 : (a.player_id as string) > (b.player_id as string) ? 1 : 0);
}

/**
 * A team's main players for the mirrored lineup: the quarterback with the most
 * dropbacks, the two backs with the most carries, the four wide receivers or
 * tight ends with the most targets. Up to 7, in that order; fewer when the
 * team has fewer (never a throw). The season tables hold one row per
 * player-season under one team, so a traded player is listed with the team he
 * has played most for (M10 says so on the page).
 */
export function pickMainPlayers(input: {
  teamId: string;
  season: number;
  defaultSeason: number;
  qbs: readonly QBSeasonStat[];
  rbs: readonly RBSeasonStat[];
  receivers: readonly ReceiverSeasonStat[];
  slugByPlayerId: ReadonlyMap<string, { slug: string; player_name: string }>;
}): LineupPlayer[] {
  const { teamId, season, defaultSeason } = input;
  const positive = (r: Row, col: string) => (num(r[col]) ?? 0) > 0;
  const pos = (r: Row) => (typeof r.position === "string" ? r.position : "");

  const player = (slot: LineupPlayer["slot"], position: string, r: Row, stats: LineupStat[]): LineupPlayer => {
    const playerId = r.player_id as string;
    const known = input.slugByPlayerId?.get?.(playerId);
    // A name of only spaces is no name (chaos F10); a real one is kept as it is.
    const name = hasText(known?.player_name) ? known.player_name : hasText(r.player_name) ? r.player_name : EM_DASH;
    return {
      slot,
      pos: position,
      playerId,
      name,
      href: hasText(known?.slug) ? playerHref(known.slug, season, defaultSeason) : null,
      stats,
    };
  };

  const qbs = teamRows(input.qbs, teamId)
    .filter((r) => positive(r, "dropbacks"))
    .sort(byVolume("dropbacks", "attempts"))
    .slice(0, 1)
    .map((r) => {
      const td = sane(r.touchdowns);
      const int = sane(r.interceptions);
      return player("QB", "QB", r, [
        { label: "EPA / dropback", value: signed(r.epa_per_db, 2) },
        { label: "CPOE", value: signed(r.cpoe, 1) },
        { label: "Pass yards", value: whole(r.passing_yards) },
        { label: "TD–INT", value: td === null || int === null ? EM_DASH : `${whole(td)}-${whole(int)}` },
      ]);
    });

  const rbs = teamRows(input.rbs, teamId)
    .filter((r) => (pos(r) === "RB" || pos(r) === "FB") && positive(r, "carries"))
    .sort(byVolume("carries", "rushing_yards"))
    .slice(0, 2)
    .map((r) =>
      // A fullback is a running back everywhere on the site.
      player("RB", "RB", r, [
        { label: "Carries", value: whole(r.carries) },
        { label: "Rush yards", value: whole(r.rushing_yards) },
        { label: "EPA / carry", value: signed(r.epa_per_carry, 2) },
        { label: "Success", value: fmtRate(r.success_rate) },
      ]),
    );

  // The receiver table carries running backs too: filter on position.
  const receivers = teamRows(input.receivers, teamId)
    .filter((r) => (pos(r) === "WR" || pos(r) === "TE") && positive(r, "targets"))
    .sort(byVolume("targets", "receiving_yards"))
    .slice(0, 4)
    .map((r) =>
      player("REC", pos(r), r, [
        { label: "Targets", value: whole(r.targets) },
        { label: "Rec yards", value: whole(r.receiving_yards) },
        { label: "TD", value: whole(r.receiving_tds) },
        { label: "EPA / target", value: signed(r.epa_per_target, 2) },
      ]),
    );

  return [...qbs, ...rbs, ...receivers];
}

const LINEUP_SLOTS: readonly { slot: LineupPlayer["slot"]; count: number; label: string }[] = [
  { slot: "QB", count: 1, label: "QB" },
  { slot: "RB", count: 2, label: "RB" },
  { slot: "REC", count: 4, label: "WR/TE" },
];

/**
 * The mirrored lineup: always 7 rows (QB, RB, RB, four receivers), each side a
 * player or null. The centre label is the shared position, "WR/TE"-style
 * "{away}/{home}" when the two differ, the one present, or the slot's own
 * label when neither side has a player.
 */
export function pairLineups(
  away: LineupPlayer[],
  home: LineupPlayer[],
): { pos: string; away: LineupPlayer | null; home: LineupPlayer | null }[] {
  const of = (list: LineupPlayer[], slot: LineupPlayer["slot"]) =>
    (Array.isArray(list) ? list : []).filter((p) => p && p.slot === slot);
  const out: { pos: string; away: LineupPlayer | null; home: LineupPlayer | null }[] = [];
  for (const { slot, count, label } of LINEUP_SLOTS) {
    const a = of(away, slot);
    const h = of(home, slot);
    for (let i = 0; i < count; i++) {
      const left = a[i] ?? null;
      const right = h[i] ?? null;
      const pos = left && right ? (left.pos === right.pos ? left.pos : `${left.pos}/${right.pos}`) : (left ?? right)?.pos ?? label;
      out.push({ pos, away: left, home: right });
    }
  }
  return out;
}

/**
 * Each team's players in tile order (QB, RB, RB, WR/TE ×4), from the paired
 * rows loadMatchup returns (spec §7.3a). pairLineups keeps each side's order
 * and only adds null where a side has fewer, so reading one side down the rows
 * and dropping the empty slots gives back that team's pickMainPlayers list.
 * Anything that is not a list of rows is two empty lists.
 */
export function lineupByTeam(
  rows: ReadonlyArray<{ away: LineupPlayer | null; home: LineupPlayer | null }> | null | undefined,
): { away: LineupPlayer[]; home: LineupPlayer[] } {
  const out: { away: LineupPlayer[]; home: LineupPlayer[] } = { away: [], home: [] };
  if (!Array.isArray(rows)) return out;
  const isPlayer = (p: unknown): p is LineupPlayer => p !== null && typeof p === "object";
  for (const row of rows as unknown[]) {
    if (row === null || typeof row !== "object") continue;
    const { away, home } = row as { away?: unknown; home?: unknown };
    if (isPlayer(away)) out.away.push(away);
    if (isPlayer(home)) out.home.push(home);
  }
  return out;
}

/* ─── Schedule rules (spec §6.4). `today` is injected; this module never reads the clock. ─── */

/**
 * A `games` row as these rules read it: the fields of lib/data/games.ts's
 * GameRecord, declared again because this module imports nothing from
 * lib/data (the ScoreboardGame precedent in lib/stats/box-score.ts). A
 * GameRecord is one of these.
 */
export interface MatchupGame {
  game_id: string;
  season: number;
  /** REG, or WC / DIV / CON / SB */
  game_type: string;
  week: number;
  gameday: string | null;
  weekday: string | null;
  gametime: string | null;
  home_team: string;
  away_team: string;
  /** null until the game is played */
  home_score: number | null;
  away_score: number | null;
}

const isGame = (g: unknown): g is MatchupGame => {
  if (g === null || typeof g !== "object") return false;
  const row = g as Row;
  return isId(row.home_team) && isId(row.away_team) && row.home_team !== row.away_team;
};
const isPlayed = (g: MatchupGame): boolean => isNum(g.home_score) && isNum(g.away_score);
const gameList = <G extends MatchupGame>(games: readonly G[] | null | undefined): G[] =>
  (Array.isArray(games) ? (games as G[]) : []).filter(isGame);

/**
 * "2026-10-11" → { y, m, d }, read by hand. The Date constructor reads an ISO
 * date as UTC midnight, which is the PREVIOUS day for anyone west of London
 * (the ScheduleSection trap); nothing here goes through it.
 */
function dateParts(gameday: unknown): { y: number; m: number; d: number } | null {
  if (typeof gameday !== "string") return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(gameday.trim());
  if (!match) return null;
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  if (m < 1 || m > 12 || d < 1) return null;
  // A day the month does not have ("2026-02-31") is no date (chaos F11).
  const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];
  return d <= days ? { y, m, d } : null;
}
/**
 * A calendar date as a count of days (days since 1970-01-01, by arithmetic:
 * the "days from civil" formula), so two dates can be compared and
 * subtracted without a Date object or a time zone.
 */
function dayNumber(p: { y: number; m: number; d: number }): number {
  const y = p.m <= 2 ? p.y - 1 : p.y;
  const era = Math.floor(y / 400);
  const yoe = y - era * 400;
  const doy = Math.floor((153 * (p.m > 2 ? p.m - 3 : p.m + 9) + 2) / 5) + p.d - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}
/** A game's day number, or null when the row has no readable date. */
function dayKey(g: MatchupGame): number | null {
  const p = dateParts(g.gameday);
  return p ? dayNumber(p) : null;
}
/** `today` ("YYYY-MM-DD") as a day number; null when it was not given or is not a date (the date rule is then off). */
function todayKey(today: unknown): number | null {
  const p = dateParts(today);
  return p ? dayNumber(p) : null;
}

/** A never-played row this many days past its date is still a game (scores land the morning after; Monday night's on Tuesday). */
export const STALE_GAME_GRACE_DAYS = 2;

/**
 * A never-played row whose date is more than STALE_GAME_GRACE_DAYS before
 * `today`: postponed, cancelled, or the old row of a rescheduled game (a
 * cross-week reschedule gets a new game_id and the old row is never deleted).
 * It is not a game to show. Always false with no `today` or no readable date.
 */
function isStale(g: MatchupGame, today: number | null): boolean {
  if (today === null || isPlayed(g)) return false;
  const day = dayKey(g);
  return day !== null && today - day > STALE_GAME_GRACE_DAYS;
}

/**
 * A kickoff time: nflverse's 24-hour "13:00" (seconds allowed), or a 12-hour
 * "1:00 PM". Any other shape is no time at all, never a guess (chaos F11: the
 * suffix of "1:00 PM" used to be ignored and printed as AM).
 */
function timeParts(gametime: unknown): { h: number; min: number } | null {
  if (typeof gametime !== "string") return null;
  const text = gametime.trim();
  const half = /^(\d{1,2}):(\d{2})(?::\d{2})?\s*([AaPp])\.?[Mm]\.?$/.exec(text);
  if (half) {
    const h12 = Number(half[1]);
    const min = Number(half[2]);
    if (h12 < 1 || h12 > 12 || min > 59) return null;
    const pm = half[3].toLowerCase() === "p";
    return { h: (h12 % 12) + (pm ? 12 : 0), min };
  }
  const full = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(text);
  if (!full) return null;
  const h = Number(full[1]);
  const min = Number(full[2]);
  return h <= 23 && min <= 59 ? { h, min } : null;
}
const weekOf = (g: MatchupGame): number | null => (isNum(g.week) ? g.week : null);
const idOrder = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
/** Ascending, with a missing value before every real one. */
const nullFirst = (a: number | null, b: number | null) => (a === b ? 0 : a === null ? -1 : b === null ? 1 : a - b);
/** Ascending, with a missing value after every real one. */
const nullLast = (a: number | null, b: number | null) => (a === b ? 0 : a === null ? 1 : b === null ? -1 : a - b);

/**
 * The game to show for a pair in the order asked for (away at home), and
 * whether the page should swap the order.
 *
 * Both rules must survive a stale rescheduled row: a cross-week reschedule
 * gets a new game_id and the old row is never deleted, so it stays "unplayed"
 * for the rest of the season.
 *
 *  1. An unplayed candidate is ignored when a played candidate of the same
 *     pair and order has a later-or-equal gameday or a higher week.
 *  2. Of the unplayed candidates left: the latest gameday, then the larger
 *     game_id (two unplayed rows for one pair in one order are always a
 *     reschedule, and the stale row keeps the old date). A missing gameday
 *     sorts before any date, so a dated row wins.
 *  3. If none is left: the latest played one (gameday, then week, then game_id).
 *
 * `swap` is true only when there is no candidate at all in the order asked
 * for and at least one in the other order. Division rivals play once in each
 * building, so both orders are real games and neither swaps.
 *
 * `today` ("YYYY-MM-DD", US Eastern; the loader supplies it) adds a date to
 * the rule (chaos F1): a never-played row more than STALE_GAME_GRACE_DAYS
 * past its date is stale and is not a candidate in either order, so it is
 * never chosen over anything else, and a pair whose only row is stale has no
 * game. That also covers what rule 1 cannot see (a game moved to an EARLIER
 * week, once the stale row's own date has passed). With no `today` the date
 * rule is off. An unplayed row with no gameday cannot go stale by date, so it
 * is ignored whenever a played row of the same pair and order is in the same
 * or a later week (chaos F7).
 */
export function findPairGame<G extends MatchupGame>(
  games: readonly G[],
  awayId: string,
  homeId: string,
  today?: string | null,
): { game: G | null; swap: boolean } {
  if (awayId === homeId) return { game: null, swap: false };
  const now = todayKey(today);
  const list = gameList(games).filter((g) => !isStale(g, now));
  const inOrder = list.filter((g) => g.away_team === awayId && g.home_team === homeId);
  if (inOrder.length === 0) {
    return { game: null, swap: list.some((g) => g.away_team === homeId && g.home_team === awayId) };
  }

  const done = inOrder.filter(isPlayed);
  const supersededBy = (u: G, p: G): boolean => {
    const ud = dayKey(u);
    const pd = dayKey(p);
    if (ud !== null && pd !== null && pd >= ud) return true;
    const uw = weekOf(u);
    const pw = weekOf(p);
    if (uw === null || pw === null) return false;
    // An undated row loses to a played game of its own week too.
    return ud === null ? pw >= uw : pw > uw;
  };
  const upcoming = inOrder.filter((g) => !isPlayed(g) && !done.some((p) => supersededBy(g, p)));

  const latest = (candidates: G[], useWeek: boolean): G =>
    candidates.reduce((best, g) => {
      const order =
        nullFirst(dayKey(g), dayKey(best)) ||
        (useWeek ? nullFirst(weekOf(g), weekOf(best)) : 0) ||
        idOrder(String(g.game_id), String(best.game_id));
      return order > 0 ? g : best;
    });

  if (upcoming.length > 0) return { game: latest(upcoming, false), swap: false };
  return { game: latest(done, true), swap: false };
}

/**
 * A team's record over played regular-season games, counted from `games` (the
 * box score page's rule; `games` stores no record column). Playoff games and
 * unplayed games are ignored. Print it with formatRecord.
 */
export function teamRecord(games: readonly MatchupGame[], teamId: string): WinLossTie {
  const rec: WinLossTie = { wins: 0, losses: 0, ties: 0 };
  for (const g of gameList(games)) {
    if (normalizeGameType(g.game_type) !== "REG" || !isPlayed(g)) continue;
    const isHome = g.home_team === teamId;
    if (!isHome && g.away_team !== teamId) continue;
    const mine = (isHome ? g.home_score : g.away_score) as number;
    const theirs = (isHome ? g.away_score : g.home_score) as number;
    if (mine > theirs) rec.wins += 1;
    else if (mine < theirs) rec.losses += 1;
    else rec.ties += 1;
  }
  return rec;
}

const ROUND_NAMES: Record<string, string> = {
  WC: "Wild Card",
  DIV: "Divisional",
  CON: "Conference Championship",
  SB: "Super Bowl",
};

/**
 * This week's games, from the `games` rows themselves (not from
 * data_freshness's through_week, which is the last week with stats, and not
 * from today's date).
 *
 * Let P be the highest week that has at least one played game (0 if none).
 * The slate is the lowest week W >= P that has an unplayed game: every game
 * of that week, played ones too (Thursday's), by gameday, kickoff, game_id.
 * Mid-week, with Thursday played, P is the current week, so it is still
 * chosen; a stale unplayed row in an earlier week is never gone back to.
 * No such week: null.
 *
 * Without a date that rule cannot tell a stale row in the highest played week
 * from Sunday's game that has not kicked off (chaos F1), so `today`
 * ("YYYY-MM-DD", US Eastern; the loader supplies it) is injected: a
 * never-played row more than STALE_GAME_GRACE_DAYS past its date is ignored,
 * for choosing the week and in the list. With no `today` the date rule is
 * off. An unplayed row with no gameday cannot go stale by date: it is ignored
 * when its week is below the highest week with a result, or its own week
 * already has a played game.
 */
export function currentSlate<G extends MatchupGame>(
  games: readonly G[],
  today?: string | null,
): { label: string; games: G[] } | null {
  const now = todayKey(today);
  const all = gameList(games).filter((g) => weekOf(g) !== null);
  let lastPlayed = 0;
  const playedWeeks = new Set<number>();
  for (const g of all) {
    if (!isPlayed(g)) continue;
    playedWeeks.add(g.week);
    if (g.week > lastPlayed) lastPlayed = g.week;
  }
  const list = all.filter((g) => {
    if (isPlayed(g)) return true;
    if (isStale(g, now)) return false;
    return dayKey(g) !== null || !(g.week < lastPlayed || playedWeeks.has(g.week));
  });
  let week: number | null = null;
  for (const g of list) {
    if (isPlayed(g) || g.week < lastPlayed) continue;
    if (week === null || g.week < week) week = g.week;
  }
  if (week === null) return null;

  const minutes = (g: G) => {
    const t = timeParts(g.gametime);
    return t ? t.h * 60 + t.min : null;
  };
  const slate = list
    .filter((g) => g.week === week)
    .sort((a, b) => nullLast(dayKey(a), dayKey(b)) || nullLast(minutes(a), minutes(b)) || idOrder(String(a.game_id), String(b.game_id)));
  const round = slate.map((g) => normalizeGameType(g.game_type)).find((t) => t !== "REG");
  return { label: round ? (ROUND_NAMES[round] ?? round) : `Week ${week}`, games: slate };
}

/**
 * One game's week as the header prints it: "Week 5" for a regular-season
 * game, the round's name for a playoff game (the names currentSlate uses).
 * "" when the row has no usable week, never "Week NaN".
 */
export function gameWeekLabel(game: MatchupGame): string {
  if (game === null || typeof game !== "object") return "";
  const type = normalizeGameType(game.game_type);
  if (type !== "REG") return ROUND_NAMES[type] ?? type;
  return isNum(game.week) ? `Week ${game.week}` : "";
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * "Sun Oct 11 · 1:00 PM ET"; a played game: "Sun Sep 27 · Final: BUF 27, LA 20"
 * (away team first). Missing parts are dropped: no time, no date (the weekday
 * is printed only beside a date), or nothing at all (""). Kickoff times are
 * Eastern, as nflverse stores them.
 */
export function formatKickoff(game: MatchupGame): string {
  if (game === null || typeof game !== "object") return "";
  const parts: string[] = [];
  const date = dateParts(game.gameday);
  if (date) {
    const day = typeof game.weekday === "string" ? game.weekday.trim().slice(0, 3) : "";
    const weekday = /^[A-Za-z]{3}$/.test(day) ? `${day[0].toUpperCase()}${day.slice(1).toLowerCase()} ` : "";
    parts.push(`${weekday}${MONTHS[date.m - 1]} ${date.d}`);
  }
  if (isGame(game) && isPlayed(game)) {
    parts.push(`Final: ${game.away_team} ${game.away_score}, ${game.home_team} ${game.home_score}`);
  } else {
    const time = timeParts(game.gametime);
    if (time) {
      const minutes = String(time.min).padStart(2, "0");
      parts.push(`${time.h % 12 || 12}:${minutes} ${time.h < 12 ? "AM" : "PM"} ET`);
    }
  }
  return parts.join(" · ");
}

/* ─── Visitor-facing copy (spec §8.5). Plain strings, rendered verbatim as {CONST}. ─── */

/** M1 — fewer than RADAR_MIN_TEAMS teams have played. */
export const MATCHUP_SMALL_POOL_NOTE = `Matchup ranks start once ${RADAR_MIN_TEAMS} teams have played this season. Until then there are too few teams to rank against.`;

/** M2 — a team with no games (the first sentence of the radar's R10). */
export function matchupNoGamesNote(teamName: string, season: number): string {
  return `The ${teamName} have not played a ${season} game yet.`;
}

/** M3 — a pane whose overlay cannot be drawn. */
export const MATCHUP_NO_OVERLAY_NOTE = "Not enough of these rates are available yet to draw this radar.";

/**
 * M4 — the count line over a drawn overlay. It never names a winner. The 5
 * and the 4 come from EDGE_LEAN_MIN_GAP. For the seven spokes only, never the
 * 13 ladder lines.
 */
export function overlayCountLine(tally: { off: number; def: number; even: number; ranked: number }): string {
  const all = tally.ranked === RADAR_AXES.length;
  const word = tally.ranked === 1 ? "spoke" : "spokes";
  const lead = all ? `Of the ${tally.ranked} ${word}` : `Of the ${tally.ranked} ${word} ranked`;
  return `${lead}: offense is ${EDGE_LEAN_MIN_GAP}+ places higher on ${tally.off}, defense on ${tally.def}, ${tally.even} within ${EDGE_LEAN_MIN_GAP - 1} places.`;
}

/**
 * M5 — the side panel's paragraph, under the count line. The middle ring is
 * amber, or grey beside a team colour close to amber (the share card's rule,
 * page colours amendment 2026-10-10): the caller passes the ring's word, so
 * this module imports nothing for it. "amber" is the sentence as first built.
 */
export function matchupRadarNote(ring: "amber" | "grey"): string {
  return `Both shapes are drawn by league rank, so the outer ring is 1st on every spoke and the ${ring} ring is the middle of the league. Where the solid shape reaches past the dashed one, the offense ranks higher. Each label shows offense rank v defense rank.`;
}

const gamesWord = (n: number) => `${n} ${n === 1 ? "game" : "games"}`;

/** M6 — what every rank is among. */
export function matchupRankNote(s: {
  teamsPlayed: number;
  season: number;
  throughWeek: number | null;
  awayId: string;
  homeId: string;
  awayGames: number;
  homeGames: number;
}): string {
  const among = s.teamsPlayed === 32 ? `all 32 teams in ${s.season}` : `the ${s.teamsPlayed} teams that have played in ${s.season}`;
  const week = isNum(s.throughWeek) ? `, through Week ${s.throughWeek}` : "";
  return `Every rank is among ${among}${week} (${s.awayId} has played ${gamesWord(s.awayGames)}, ${s.homeId} ${s.homeGames}). A defense is ranked on what its opponents did, so allowing less ranks higher; for sacks, takeaways and stuffs, making more ranks higher.`;
}

/**
 * Beside M6 (PR 1 code review): the ladder ranks ties the radar's way, the
 * Team Stats table numbers its sorted rows, so one team can carry two numbers.
 */
export const MATCHUP_TIES_NOTE =
  "Tied teams share a place here, as on the team radars (T-7th and T-7th, then 9th). The Team Stats table numbers its rows one by one, so a tied team can carry a different number there.";

/** M7 — the edge rule, with its numbers from the constants. */
export function matchupEdgeNote(): string {
  return `An edge only compares two season ranks: defense rank minus offense rank. 0 to ${EDGE_LEAN_MIN_GAP - 1} places apart is called even, ${EDGE_LEAN_MIN_GAP} to ${EDGE_CLEAR_MIN_GAP - 1} a lean, ${EDGE_CLEAR_MIN_GAP} or more a clear edge. It is not a prediction and not a win probability.`;
}

/** M8 — which EPA family. The two link texts below appear in it once each ("Team Stats" → /team-stats, "Team Tiers" → /teams). */
export const MATCHUP_FAMILY_NOTE =
  "These numbers add up every game’s box score, the same play filter as Team Stats and the team radars. A team’s EPA/play here can differ from the figure in its team page header and on Team Tiers, which count plays differently.";
export const MATCHUP_TEAM_STATS_LINK_TEXT = "Team Stats";
export const MATCHUP_TEAM_TIERS_LINK_TEXT = TEAM_TIERS_LINK_TEXT;

/**
 * M9 — no new wording. The existing tested notes, as they are (they carry the
 * scramble caveat), and the sack, turnover and stuff formulas as the radar's
 * own table sub-lines on one line.
 */
export const MATCHUP_FORMULA_NOTES: readonly string[] = [RADAR_RATES_NOTE, RADAR_STUFF_NOTE, EXPLOSIVE_NOTE];
export const MATCHUP_FORMULA_LINE: string = (["sack", "to", "stuff"] as const)
  .map((key) => RADAR_AXES.find((a) => a.key === key)?.subline ?? "")
  .join(" · ");

/** M10 — who the main players are. */
export const MATCHUP_PLAYERS_NOTE =
  "Players: the quarterback with the most dropbacks, the two backs with the most carries and the four wide receivers or tight ends with the most targets. A traded player is listed with the team he has played most for. Names open the player page.";

/** M17 — a team with no player to list (it has not played yet). */
export function matchupNoPlayersNote(teamName: string, season: number): string {
  return `No ${season} players to show for the ${teamName} yet.`;
}

/** M12 — the player tables could not be read. */
export const MATCHUP_PLAYERS_UNAVAILABLE = "Main players are unavailable right now.";

/** M13 — a season with no team_game_stats rows (the uncoveredHeading pattern of /team-stats). */
export function matchupUncoveredHeading(season: number, firstSeason: number | null): string {
  return firstSeason != null
    ? `Team matchups start with the ${firstSeason} season`
    : `Team matchups aren’t available for the ${season} season`;
}

/** M14 — /matchup when the season has no unplayed game. */
export function matchupNoUpcomingNote(season: number): string {
  return `No upcoming games in the ${season} schedule. Pick any two teams below.`;
}

/** M15 — the ladder's "how to read" line. */
export const MATCHUP_LADDER_NOTE =
  "The red marker slides toward the unit with the better league rank. The farther from the middle, the bigger the rank gap.";

/**
 * The header's line for a pair with no game in the season (it was a private
 * constant of components/matchup/MatchupHeader.tsx; the matchup share card
 * prints the same sentence, matchup card spec 2026-10-11 F6).
 */
export function matchupNoGameText(season: number): string {
  return `No ${season} game between these teams`;
}

/** M16 — /matchup when the games read failed. */
export const MATCHUP_GAMES_UNAVAILABLE = "This week’s games are unavailable right now.";
