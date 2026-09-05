// lib/stats/tecmo-card.ts — data builders for the Tecmo player card.
// Eligibility (per-game, unified), OVR (quality metrics only), ability rows.
//
// OVR design intent: style metrics (aDOT, air yards/target, YAC/rec) and volume
// metrics (dropbacks/targets/carries per game) show up as ability bars but are
// deliberately EXCLUDED from the OVR average — OVR grades quality, not usage.
import type { QBSeasonStat, ReceiverSeasonStat, RBSeasonStat } from "@/lib/types";
import { computePercentile } from "./percentiles";
import {
  QB_RADAR_KEYS, QB_RADAR_AXES, getQBRadarVal,
  WR_RADAR_KEYS, WR_RADAR_AXES, getWRRadarVal,
  RB_RADAR_KEYS, RB_RADAR_AXES, getRBRadarVal,
  computeRadarValues,
} from "./radar";
import { classifyQB, classifyWR, classifyTE, classifyRB } from "./archetypes";
import { qbFantasyPoints, wrFantasyPoints, rbFantasyPoints } from "./fantasy";
import { formatRate, EM_DASH } from "./formatters";

export interface StatCell { label: string; value: string; }
export interface AbilityRow {
  label: string;
  raw: string;
  percentile: number;
  /**
   * True when the player has no value for this metric (raw is NaN/null).
   * `percentile` is a meaningless 0 in that case — render the row as a gray
   * dot with a zero-width bar and an em-dash instead of "raw / NTH".
   */
  missing: boolean;
}
export interface TecmoCardData {
  playerName: string;
  position: string;
  season: number;
  games: number;
  archetypeLabel: string | null;
  eligible: boolean;
  ovr: number | null; // null renders as "—"
  statCells: StatCell[];
  abilityRows: AbilityRow[];
  radarValues: number[];
  radarLabels: string[];
}

// ---- Unified per-game eligibility (pools + OVR + banner) ----
export const QB_MIN_ATT_PER_GAME = 14;
export const WR_MIN_TGT_PER_GAME = 2;
export const RB_MIN_CAR_PER_GAME = 6;

export function qbEligible(q: QBSeasonStat): boolean {
  return q.games > 0 && q.attempts / q.games >= QB_MIN_ATT_PER_GAME;
}
export function wrEligible(r: ReceiverSeasonStat): boolean {
  return r.games > 0 && r.targets / r.games >= WR_MIN_TGT_PER_GAME;
}
export function rbEligible(r: RBSeasonStat): boolean {
  return r.games > 0 && r.carries / r.games >= RB_MIN_CAR_PER_GAME;
}

export function tierColor(percentile: number): string {
  if (percentile >= 75) return "#16a34a";
  if (percentile >= 40) return "#ca8a04";
  return "#dc2626";
}

// ---- shared formatting ----
const num = (v: number | null | undefined, d = 0) =>
  v == null || !Number.isFinite(v) ? EM_DASH : v.toFixed(d);
const signed = (v: number | null | undefined, d = 2) =>
  v == null || !Number.isFinite(v) ? EM_DASH : `${v >= 0 ? "+" : ""}${v.toFixed(d)}`;
/** CROE is stored 0–1 (see formatStat / PlayerOverviewWR) → render as a signed %. */
const signedRate = (v: number | null | undefined, d = 1) =>
  v == null || !Number.isFinite(v) ? EM_DASH : `${v >= 0 ? "+" : ""}${(v * 100).toFixed(d)}%`;

/**
 * Average the supplied percentiles into a 0–99 OVR.
 *
 * Callers must pass NaN (not the computed 0) for any metric the player is
 * missing: `computePercentile` returns 0 for a NaN value, and averaging that
 * in would punish a missing metric as if it were dead-last in the league.
 * The NaN filter below drops those inputs so OVR is the mean of what we
 * actually know. All inputs missing → null.
 */
function ovrFrom(pcts: number[], eligible: boolean): number | null {
  if (!eligible) return null;
  const valid = pcts.filter((p) => !Number.isNaN(p));
  if (valid.length === 0) return null;
  return Math.min(99, Math.round(valid.reduce((a, b) => a + b, 0) / valid.length));
}

/**
 * Percentile of `me` within `pool` for a non-radar metric.
 *
 * Note: a pool of one (the player himself) yields 0 for every percentile,
 * since nobody ranks below him. That is inherent to a rank-based percentile
 * and is accepted — real season pools are league-wide, and the single-player
 * case only arises in tests or a position with one qualifier.
 */
function pctOf<T>(pool: T[], get: (t: T) => number, me: T): number {
  const vals = pool.map(get).filter((v) => !Number.isNaN(v)).sort((a, b) => a - b);
  return computePercentile(vals, get(me)); // returns 0 on NaN/empty
}

// ---------------------------------------------------------------- QB
type QBRadarKey = (typeof QB_RADAR_KEYS)[number];

/** OVR inputs: quality only — no aDOT (style) and no dropbacks/game (volume). */
const QB_OVR_KEYS: readonly QBRadarKey[] =
  ["epa_per_db", "cpoe", "success_rate", "inv_int_pct", "rush_epa"];

export function buildQBCardData(
  me: QBSeasonStat, all: QBSeasonStat[], season: number,
): TecmoCardData {
  const pool = all.filter(qbEligible);
  const radarValues = computeRadarValues(QB_RADAR_KEYS, getQBRadarVal, me, pool);
  const eligible = qbEligible(me);

  const pct = (key: QBRadarKey) => radarValues[QB_RADAR_KEYS.indexOf(key)];
  const missing = (key: QBRadarKey) => Number.isNaN(getQBRadarVal(me, key));
  // A metric the player doesn't have contributes NaN, not a 0th-percentile 0.
  const ovr = ovrFrom(
    QB_OVR_KEYS.map((k) => (missing(k) ? NaN : pct(k))),
    eligible && pool.length > 0,
  );

  const intPct = me.attempts > 0 ? (me.interceptions / me.attempts) * 100 : NaN;

  return {
    playerName: me.player_name,
    position: "QB",
    season,
    games: me.games,
    archetypeLabel: classifyQB(radarValues)?.label ?? null,
    eligible,
    ovr,
    statCells: [
      { label: "COMP", value: num(me.completions) },
      { label: "ATT", value: num(me.attempts) },
      { label: "PCT", value: num(me.completion_pct, 1) },
      { label: "YDS", value: num(me.passing_yards) },
      { label: "TD", value: num(me.touchdowns) },
      { label: "INT", value: num(me.interceptions) },
      { label: "SACK", value: num(me.sacks) },
      { label: "RTG", value: num(me.passer_rating, 1) },
      { label: "RU YDS", value: num(me.rush_yards) },
      { label: "RU TD", value: num(me.rush_tds) },
      { label: "FUM", value: num(me.fumbles) },
      { label: "FPTS", value: num(qbFantasyPoints(me), 0) },
    ],
    abilityRows: [
      {
        label: "EPA/DROPBACK",
        raw: signed(me.epa_per_db),
        percentile: pct("epa_per_db"),
        missing: missing("epa_per_db"),
      },
      {
        label: "CPOE",
        raw: signed(me.cpoe, 1),
        percentile: pct("cpoe"),
        missing: missing("cpoe"),
      },
      {
        label: "DROPBACKS/GM",
        raw: num(getQBRadarVal(me, "dropbacks_game"), 1),
        percentile: pct("dropbacks_game"),
        missing: missing("dropbacks_game"),
      },
      {
        label: "ADOT",
        raw: num(me.adot, 1),
        percentile: pct("adot"),
        missing: missing("adot"),
      },
      {
        label: "BALL SECURITY",
        raw: Number.isNaN(intPct) ? EM_DASH : `${intPct.toFixed(1)}% INT`,
        percentile: pct("inv_int_pct"),
        missing: Number.isNaN(intPct),
      },
      {
        label: "SUCCESS RATE",
        raw: formatRate(me.success_rate ?? NaN),
        percentile: pct("success_rate"),
        missing: missing("success_rate"),
      },
      {
        label: "RUSH EPA",
        raw: signed(getQBRadarVal(me, "rush_epa")),
        percentile: pct("rush_epa"),
        missing: missing("rush_epa"),
      },
    ],
    radarValues,
    radarLabels: QB_RADAR_AXES.map((a) => a.label),
  };
}

// ---------------------------------------------------------------- WR / TE
type WRRadarKey = (typeof WR_RADAR_KEYS)[number];

/**
 * OVR inputs: quality only — no targets/game (volume), aDOT or YAC/rec (style).
 * receiving_success_rate is a fourth input but is not a radar axis, so it is
 * percentiled separately below.
 */
const WR_OVR_RADAR_KEYS: readonly WRRadarKey[] =
  ["epa_per_target", "croe", "yards_per_route_run"];

export function buildWRCardData(
  me: ReceiverSeasonStat, all: ReceiverSeasonStat[], season: number,
): TecmoCardData {
  // Position-matched pool: TEs are ranked against TEs, WRs against WRs.
  const pool = all.filter((r) => r.position === me.position).filter(wrEligible);
  const radarValues = computeRadarValues(WR_RADAR_KEYS, getWRRadarVal, me, pool);
  const eligible = wrEligible(me);

  const pct = (key: WRRadarKey) => radarValues[WR_RADAR_KEYS.indexOf(key)];
  const missing = (key: WRRadarKey) => Number.isNaN(getWRRadarVal(me, key));

  // receiving_success_rate is not a radar axis, so percentile it directly.
  const succRaw = me.receiving_success_rate ?? NaN;
  const succPct = pctOf(pool, (r) => r.receiving_success_rate ?? NaN, me);
  // A metric the player doesn't have contributes NaN, not a 0th-percentile 0.
  const ovr = ovrFrom(
    [
      ...WR_OVR_RADAR_KEYS.map((k) => (missing(k) ? NaN : pct(k))),
      Number.isNaN(succRaw) ? NaN : succPct,
    ],
    eligible && pool.length > 0,
  );

  const classify = me.position === "TE" ? classifyTE : classifyWR;

  return {
    playerName: me.player_name,
    position: me.position,
    season,
    games: me.games,
    archetypeLabel: classify(radarValues)?.label ?? null,
    eligible,
    ovr,
    statCells: [
      { label: "TGT", value: num(me.targets) },
      { label: "REC", value: num(me.receptions) },
      { label: "YDS", value: num(me.receiving_yards) },
      { label: "TD", value: num(me.receiving_tds) },
      { label: "YPR", value: num(me.yards_per_reception, 1) },
      { label: "YAC", value: num(me.yac) },
      { label: "TGT %", value: formatRate(me.target_share ?? NaN) },
      { label: "SNAP %", value: formatRate(me.snap_share ?? NaN) },
      { label: "ROUTES", value: num(me.routes_run) },
      { label: "YPRR", value: num(me.yards_per_route_run, 2) },
      { label: "FUM", value: num(me.fumbles) },
      { label: "FPTS", value: num(wrFantasyPoints(me), 0) },
    ],
    abilityRows: [
      {
        label: "TGT/GAME",
        raw: num(getWRRadarVal(me, "targets_game"), 1),
        percentile: pct("targets_game"),
        missing: missing("targets_game"),
      },
      {
        label: "EPA/TARGET",
        raw: signed(me.epa_per_target),
        percentile: pct("epa_per_target"),
        missing: missing("epa_per_target"),
      },
      {
        label: "CROE",
        raw: signedRate(me.croe, 1),
        percentile: pct("croe"),
        missing: missing("croe"),
      },
      {
        label: "AIR YDS/TGT",
        raw: num(me.air_yards_per_target, 1),
        percentile: pct("air_yards_per_target"),
        missing: missing("air_yards_per_target"),
      },
      {
        label: "YAC/REC",
        raw: num(me.yac_per_reception, 1),
        percentile: pct("yac_per_reception"),
        missing: missing("yac_per_reception"),
      },
      {
        label: "YPRR",
        raw: num(me.yards_per_route_run, 2),
        percentile: pct("yards_per_route_run"),
        missing: missing("yards_per_route_run"),
      },
    ],
    radarValues,
    radarLabels: WR_RADAR_AXES.map((a) => a.label),
  };
}

// ---------------------------------------------------------------- RB
type RBRadarKey = (typeof RB_RADAR_KEYS)[number];

/** OVR inputs: rushing quality only — no carries/game or targets/game (volume). */
const RB_OVR_KEYS: readonly RBRadarKey[] =
  ["epa_per_carry", "success_rate", "stuff_avoidance", "explosive_rate"];

export function buildRBCardData(
  me: RBSeasonStat, all: RBSeasonStat[], season: number,
): TecmoCardData {
  const pool = all.filter(rbEligible);
  const radarValues = computeRadarValues(RB_RADAR_KEYS, getRBRadarVal, me, pool);
  const eligible = rbEligible(me);

  const pct = (key: RBRadarKey) => radarValues[RB_RADAR_KEYS.indexOf(key)];
  const missing = (key: RBRadarKey) => Number.isNaN(getRBRadarVal(me, key));
  // A metric the player doesn't have contributes NaN, not a 0th-percentile 0.
  const ovr = ovrFrom(
    RB_OVR_KEYS.map((k) => (missing(k) ? NaN : pct(k))),
    eligible && pool.length > 0,
  );

  return {
    playerName: me.player_name,
    position: "RB",
    season,
    games: me.games,
    archetypeLabel: classifyRB(radarValues)?.label ?? null,
    eligible,
    ovr,
    statCells: [
      { label: "CAR", value: num(me.carries) },
      { label: "YDS", value: num(me.rushing_yards) },
      { label: "YPC", value: num(me.yards_per_carry, 1) },
      { label: "TD", value: num(me.rushing_tds) },
      { label: "SUCC %", value: formatRate(me.success_rate ?? NaN) },
      { label: "EXPL %", value: formatRate(me.explosive_rate ?? NaN) },
      { label: "TGT", value: num(me.targets) },
      { label: "REC", value: num(me.receptions) },
      { label: "RC YDS", value: num(me.receiving_yards) },
      { label: "RC TD", value: num(me.receiving_tds) },
      { label: "FUM", value: num(me.fumbles) },
      { label: "FPTS", value: num(rbFantasyPoints(me), 0) },
    ],
    abilityRows: [
      {
        label: "CAR/GAME",
        raw: num(getRBRadarVal(me, "carries_game"), 1),
        percentile: pct("carries_game"),
        missing: missing("carries_game"),
      },
      {
        label: "EPA/CARRY",
        raw: signed(me.epa_per_carry),
        percentile: pct("epa_per_carry"),
        missing: missing("epa_per_carry"),
      },
      {
        label: "STUFF AVOID",
        raw: formatRate(getRBRadarVal(me, "stuff_avoidance")),
        percentile: pct("stuff_avoidance"),
        missing: missing("stuff_avoidance"),
      },
      {
        label: "EXPLOSIVE %",
        raw: formatRate(me.explosive_rate ?? NaN),
        percentile: pct("explosive_rate"),
        missing: missing("explosive_rate"),
      },
      {
        label: "TGT/GAME",
        raw: num(getRBRadarVal(me, "targets_game"), 1),
        percentile: pct("targets_game"),
        missing: missing("targets_game"),
      },
      {
        label: "SUCCESS RATE",
        raw: formatRate(me.success_rate ?? NaN),
        percentile: pct("success_rate"),
        missing: missing("success_rate"),
      },
    ],
    radarValues,
    radarLabels: RB_RADAR_AXES.map((a) => a.label),
  };
}
