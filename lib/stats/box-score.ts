// lib/stats/box-score.ts — pure builders for the box score page (spec §6).
//
// No Supabase here: the page's server component, its components and the tests
// all import this module. Every number comes from team_game_stats and the
// weekly player tables exactly as scripts/ingest.py wrote them; the only
// arithmetic is presentation the spec defines from stored columns (toxic
// differential, the pass/rush explosive rates, target share, Y/TGT, a QB's
// yards per carry) and the records counted from the schedule.
import type {
  GamePlayerLines,
  QBWeeklyStat,
  RBWeeklyStat,
  ReceiverWeeklyStat,
  TeamGame,
  TeamGameStat,
} from "@/lib/types";
import { EM_DASH, epaTextColor } from "@/lib/stats/formatters";
import { getTeam, getTeamColor } from "@/lib/data/teams";

/* ─── Numbers ─── */

/** Typographic minus for negatives — the approved mockup's "−0.26". */
export const MINUS = "\u2212";

/**
 * A number a visitor can read. parseNumericFields turns a stored "NaN" into
 * null and leaves NULL as null, so every guard is `val == null ||
 * Number.isNaN(val)` — an isNaN-only check lets null through to .toFixed()
 * (the 2026-09-11 F1 crash). Infinity is excluded too.
 */
export function isNum(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

/**
 * Fixed decimals with a real minus sign. A value that rounds to zero prints
 * unsigned ("0.0", never "-0.0" or "+0.00"); `signed` adds "+" to positives.
 */
export function fmtFixed(v: number | null | undefined, decimals: number, signed = false): string {
  if (!isNum(v)) return EM_DASH;
  const abs = Math.abs(v).toFixed(decimals);
  if (Number(abs) === 0) return abs;
  if (v < 0) return `${MINUS}${abs}`;
  return signed ? `+${abs}` : abs;
}

export const fmtSigned2 = (v: number | null | undefined): string => fmtFixed(v, 2, true);
export const fmtSigned1 = (v: number | null | undefined): string => fmtFixed(v, 1, true);
export const fmtDec1 = (v: number | null | undefined): string => fmtFixed(v, 1);
export const fmtDec2 = (v: number | null | undefined): string => fmtFixed(v, 2);
export const fmtInt = (v: number | null | undefined): string =>
  isNum(v) ? fmtFixed(Math.round(v), 0) : EM_DASH;
export const fmtSignedInt = (v: number | null | undefined): string =>
  isNum(v) ? fmtFixed(Math.round(v), 0, true) : EM_DASH;

/** A 0–1 rate as a percentage: 0.4107 → "41%"; 0.2142 → "21.4%" with one decimal. */
export const fmtPct = (v: number | null | undefined, decimals = 0): string =>
  isNum(v) ? `${fmtFixed(v * 100, decimals)}%` : EM_DASH;

/** "3-9", "2-11", "20/29" — two whole numbers joined. */
export const fmtPair = (
  a: number | null | undefined,
  b: number | null | undefined,
  sep = "-"
): string => (isNum(a) && isNum(b) ? `${fmtInt(a)}${sep}${fmtInt(b)}` : EM_DASH);

/** Seconds → "23:43"; the minutes run past 59 in overtime ("68:26"). */
export function fmtClock(seconds: number | null | undefined): string {
  if (!isNum(seconds) || seconds < 0) return EM_DASH;
  const s = Math.round(seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/**
 * Tailwind text colour for an EPA cell at the site's thresholds (≥ +0.02
 * green, ≥ −0.02 amber, else red). null / NaN → grey, never amber:
 * epaTextColor guards isNaN only, and isNaN(null) is false (spec §6).
 */
export function epaCellClass(v: number | null | undefined): string {
  return isNum(v) ? epaTextColor(v) : "text-gray-400";
}

/* ─── Game identity: the one rule per `games` column ─── */

/**
 * nflverse game id: season_week_AWAY_HOME, e.g. 2026_01_BUF_HOU.
 *
 * Lives here, not in lib/data/box-score.ts, because both link gates
 * (components/team/ScheduleSection.tsx, components/player/GameLogTab.tsx) are
 * "use client" files and must not pull the Supabase server client in to ask
 * whether an id can have a page. lib/data/box-score.ts re-exports it.
 */
export const GAME_ID_PATTERN = /^\d{4}_\d{2}_[A-Z]{2,3}_[A-Z]{2,3}$/;

/**
 * The id as the database stores it (upper case), or null when the value cannot
 * be a game id — so junk never reaches a query, and nothing ever links to an
 * address that has no page (spec §7).
 */
export function normalizeGameId(raw: string | null | undefined): string | null {
  const id = String(raw ?? "").trim().toUpperCase();
  return GAME_ID_PATTERN.test(id) ? id : null;
}

/**
 * `games.game_type` as every module must read it: trimmed, upper case, and
 * blank ⇒ "REG".
 *
 * The one rule, deliberately: three modules used to apply three (getGame
 * coalesced only null, getBoxScore compared `!== "REG"`, gameLabel coalesced
 * `""` but never upper-cased), so an empty or lower-case value rendered the
 * scoreboard band "WEEK 1" above the message "Box scores cover regular-season
 * games for now" — the page contradicting itself on one screen. Every reader
 * of the column goes through here; do not add a fourth rule.
 */
export function normalizeGameType(raw: string | null | undefined): string {
  return String(raw ?? "").trim().toUpperCase() || "REG";
}

/* ─── Records (spec §6: `games` stores no record column) ─── */

export interface WinLossTie {
  wins: number;
  losses: number;
  ties: number;
}

/**
 * A team's record through `week` of one regular season, counted from its
 * `games` rows: played REG games with a week at or before `week`. Playoff
 * rows and later weeks are ignored, so a playoff game shows the full
 * regular-season record.
 */
export function recordThroughWeek(schedule: TeamGame[], week: number): WinLossTie {
  const rec: WinLossTie = { wins: 0, losses: 0, ties: 0 };
  for (const g of schedule ?? []) {
    if (!g || normalizeGameType(g.game_type) !== "REG" || !g.played || !isNum(g.week) || g.week > week) continue;
    if (g.result === "W") rec.wins += 1;
    else if (g.result === "L") rec.losses += 1;
    else if (g.result === "T") rec.ties += 1;
  }
  return rec;
}

/** "1-0", "9-7-1" — the ties leg only once there is one (site convention). */
export function formatRecord(rec: WinLossTie): string {
  return rec.ties > 0 ? `${rec.wins}-${rec.losses}-${rec.ties}` : `${rec.wins}-${rec.losses}`;
}

/* ─── Scoreboard ─── */

/** The `games` row fields the scoreboard reads (lib/data/games.ts's GameRecord, once played). */
export interface ScoreboardGame {
  game_id: string;
  season: number;
  game_type: string;
  week: number;
  gameday: string | null;
  weekday: string | null;
  home_team: string;
  away_team: string;
  home_score: number;
  away_score: number;
}

export interface ScoreboardTeam {
  id: string;
  abbreviation: string;
  name: string;
  /** "Bills" — the last word of the team name. */
  nickname: string;
  logo: string;
  primaryColor: string;
  secondaryColor: string;
  score: number;
  /** Record after this game, e.g. "1-0". */
  record: string;
  winner: boolean;
}

export interface ScoreboardModel {
  /** "WEEK 1", or the playoff round. */
  label: string;
  /** "SUN SEP 13" ("MON DEC 8, 2025" for another calendar year); "" when unknown. */
  dateLabel: string;
  away: ScoreboardTeam;
  home: ScoreboardTeam;
}

const ROUND_LABELS: Record<string, string> = {
  WC: "WILD CARD",
  DIV: "DIVISIONAL",
  CON: "CONFERENCE CHAMPIONSHIP",
  SB: "SUPER BOWL",
};

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

/**
 * "SUN SEP 13" from the schedule's weekday and ISO gameday. The date is parsed
 * by hand: `new Date("2026-09-13")` is UTC midnight and reads as the previous
 * day west of London (ScheduleSection carries the same guard). The year is
 * appended when the game was played in another calendar year than `today`.
 */
export function formatGameDate(gameday: string | null, weekday: string | null, today: Date = new Date()): string {
  const parts: string[] = [];
  const day = String(weekday ?? "").trim().slice(0, 3).toUpperCase();
  if (day) parts.push(day);
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(gameday ?? "").trim());
  if (m) {
    const year = Number(m[1]);
    const month = Number(m[2]);
    const d = Number(m[3]);
    if (month >= 1 && month <= 12 && d >= 1 && d <= 31) {
      parts.push(`${MONTHS[month - 1]} ${d}${year !== today.getFullYear() ? `, ${year}` : ""}`);
    }
  }
  return parts.join(" ");
}

/** "WEEK 1" for the regular season; the round name ("WILD CARD") for playoffs. */
export function gameLabel(game: Pick<ScoreboardGame, "game_type" | "week">): string {
  const type = normalizeGameType(game.game_type);
  return type === "REG" ? `WEEK ${fmtInt(game.week)}` : (ROUND_LABELS[type] ?? type);
}

function scoreboardTeam(id: string, score: number, record: WinLossTie, winner: boolean): ScoreboardTeam {
  const team = getTeam(id);
  const name = team?.name ?? id;
  return {
    id,
    abbreviation: team?.abbreviation ?? id,
    name,
    nickname: name.split(" ").pop() ?? name,
    logo: team?.logo ?? "",
    primaryColor: team?.primaryColor ?? "#0f172a",
    secondaryColor: team?.secondaryColor ?? "#334155",
    score,
    record: formatRecord(record),
    winner,
  };
}

/** Scoreboard model for a played game; a tie leaves neither score in gold. */
export function buildScoreboard(
  game: ScoreboardGame,
  awayRecord: WinLossTie,
  homeRecord: WinLossTie,
  today: Date = new Date()
): ScoreboardModel {
  return {
    label: gameLabel(game),
    dateLabel: formatGameDate(game.gameday, game.weekday, today),
    away: scoreboardTeam(game.away_team, game.away_score, awayRecord, game.away_score > game.home_score),
    home: scoreboardTeam(game.home_team, game.home_score, homeRecord, game.home_score > game.away_score),
  };
}

/* ─── Team comparison sections ─── */

export type Side = "away" | "home";

export interface StatCell {
  /** "+0.28", "41%", "3-9", "23:43" */
  main: string;
  /** Muted detail after the value: "(56)", "(TO +2, expl 0)". */
  detail?: string;
}

export interface ComparisonRow {
  key: string;
  label: string;
  /** Muted text after the label: "(plays)", "(1st–2nd)". */
  labelDetail?: string;
  /** Plain text after the detail: the "EPA / play" of "Early downs (1st–2nd) EPA / play". */
  labelSuffix?: string;
  /** Sub-row: "↳ " prefix and lighter type. */
  sub?: boolean;
  /** MetricTooltip key when the row has an info tooltip. */
  tooltip?: string;
  away: StatCell;
  home: StatCell;
  /** The shaded side; null when equal, missing, or the row has no better side. */
  better: Side | null;
}

export interface ComparisonSectionModel {
  key: "efficiency" | "team-stats" | "cost" | "downs";
  title: string;
  rows: ComparisonRow[];
}

type Quantize = (v: number) => number;
const Q_INT: Quantize = (v) => Math.round(v);
// Round the magnitude the same way fmtFixed's toFixed does, then restore the
// sign: plain Math.round(v * 10) rounds negatives toward +Infinity, which can
// disagree with fmtFixed's printed digit at the halfway point.
const Q_DEC1: Quantize = (v) => Math.sign(v) * Math.round(Math.abs(v) * 10);
const Q_DEC2: Quantize = (v) => Math.sign(v) * Math.round(Math.abs(v) * 100);
const Q_PCT0: Quantize = (v) => Math.round(v * 100);

/**
 * Which side is better, compared at the precision the cell shows (`q`), so two
 * cells that read the same are never shaded apart. null when either value is
 * missing or they are equal.
 */
export function betterSide(
  away: number | null | undefined,
  home: number | null | undefined,
  higherIsBetter: boolean,
  q: Quantize = Q_INT
): Side | null {
  if (!isNum(away) || !isNum(home)) return null;
  const a = q(away);
  const h = q(home);
  if (a === h) return null;
  return a > h === higherIsBetter ? "away" : "home";
}

/** numerator ÷ denominator, or null when the denominator is missing or 0. */
export function rate(
  numerator: number | null | undefined,
  denominator: number | null | undefined
): number | null {
  return isNum(numerator) && isNum(denominator) && denominator > 0 ? numerator / denominator : null;
}

type Get = (t: TeamGameStat) => number | null | undefined;
type RowOpts = Partial<Pick<ComparisonRow, "labelDetail" | "labelSuffix" | "sub" | "tooltip">>;

/**
 * The four comparison sections in page order (spec §6), every row labelled
 * as the approved mockup has it. Higher is better for EPA, rates, yards and
 * first downs; lower for turnovers, interceptions, sacks and the "EPA lost
 * to" rows (less bad is better); plays, drives, attempts, penalties and
 * possession have no better side.
 */
export function buildComparison(away: TeamGameStat, home: TeamGameStat): ComparisonSectionModel[] {
  const a = away;
  const h = home;

  const epa = (key: string, label: string, value: Get, plays: Get, opts: RowOpts = {}): ComparisonRow => ({
    key,
    label,
    ...opts,
    away: { main: fmtSigned2(value(a)), detail: `(${fmtInt(plays(a))})` },
    home: { main: fmtSigned2(value(h)), detail: `(${fmtInt(plays(h))})` },
    better: betterSide(value(a), value(h), true, Q_DEC2),
  });
  const pct = (key: string, label: string, value: Get, opts: RowOpts = {}): ComparisonRow => ({
    key,
    label,
    ...opts,
    away: { main: fmtPct(value(a)) },
    home: { main: fmtPct(value(h)) },
    better: betterSide(value(a), value(h), true, Q_PCT0),
  });
  const count = (
    key: string,
    label: string,
    value: Get,
    higherIsBetter: boolean | null,
    opts: RowOpts = {}
  ): ComparisonRow => ({
    key,
    label,
    ...opts,
    away: { main: fmtInt(value(a)) },
    home: { main: fmtInt(value(h)) },
    better: higherIsBetter === null ? null : betterSide(value(a), value(h), higherIsBetter),
  });
  const dec1 = (key: string, label: string, value: Get, opts: RowOpts = {}): ComparisonRow => ({
    key,
    label,
    ...opts,
    away: { main: fmtDec1(value(a)) },
    home: { main: fmtDec1(value(h)) },
    better: betterSide(value(a), value(h), true, Q_DEC1),
  });
  const madeAtt = (key: string, label: string, made: Get, att: Get, opts: RowOpts = {}): ComparisonRow => ({
    key,
    label,
    ...opts,
    away: { main: fmtPair(made(a), att(a)) },
    home: { main: fmtPair(made(h), att(h)) },
    better: betterSide(rate(made(a), att(a)), rate(made(h), att(h)), true, Q_PCT0),
  });
  const text = (
    key: string,
    label: string,
    value: (t: TeamGameStat) => string,
    better: Side | null,
    opts: RowOpts = {}
  ): ComparisonRow => ({
    key,
    label,
    ...opts,
    away: { main: value(a) },
    home: { main: value(h) },
    better,
  });
  // Explosive rows compare the count; the split rates divide by that split's plays.
  const explosive = (
    key: string,
    label: string,
    n: Get,
    explosiveRate: (t: TeamGameStat) => number | null,
    opts: RowOpts = {}
  ): ComparisonRow => ({
    key,
    label,
    ...opts,
    away: { main: fmtInt(n(a)), detail: `(${fmtPct(explosiveRate(a))})` },
    home: { main: fmtInt(n(h)), detail: `(${fmtPct(explosiveRate(h))})` },
    better: betterSide(n(a), n(h), true),
  });
  // Toxic differential (spec §4): (opponent turnovers − own) + (own explosives − opponent's).
  const toxic = (own: TeamGameStat, opp: TeamGameStat): { total: number | null; cell: StatCell } => {
    const to = isNum(own.turnovers) && isNum(opp.turnovers) ? opp.turnovers - own.turnovers : null;
    const ex =
      isNum(own.explosive_plays) && isNum(opp.explosive_plays)
        ? own.explosive_plays - opp.explosive_plays
        : null;
    const total = to !== null && ex !== null ? to + ex : null;
    return {
      total,
      cell: {
        main: fmtSignedInt(total),
        detail: total === null ? undefined : `(TO ${fmtSignedInt(to)}, expl ${fmtSignedInt(ex)})`,
      },
    };
  };
  const toxicAway = toxic(a, h);
  const toxicHome = toxic(h, a);
  // Fewer sacks is better; the same number of sacks, then fewer yards lost.
  // A missing sack count must not fall through to the yards tiebreak - a
  // dashed cell is never shaded, same as every other row in this file.
  const sacksBetter =
    isNum(a.sacks) && isNum(h.sacks)
      ? betterSide(a.sacks, h.sacks, false) ?? betterSide(a.sack_yards, h.sack_yards, false)
      : null;

  return [
    {
      key: "efficiency",
      title: "Efficiency",
      rows: [
        epa("epa", "EPA / play", (t) => t.epa_per_play, (t) => t.plays, {
          labelDetail: "(plays)",
          tooltip: "EPA / play",
        }),
        epa("epa-pass", "Passing", (t) => t.pass_epa_per_play, (t) => t.pass_plays, { sub: true }),
        epa("epa-rush", "Rushing", (t) => t.rush_epa_per_play, (t) => t.rush_plays, { sub: true }),
        pct("success", "Success rate", (t) => t.success_rate, { tooltip: "Success rate" }),
        pct("success-pass", "Passing", (t) => t.pass_success_rate, { sub: true }),
        pct("success-rush", "Rushing", (t) => t.rush_success_rate, { sub: true }),
        pct("first-down-rate", "1st down rate", (t) => t.first_down_rate, { tooltip: "1st down rate" }),
        pct("first-down-rate-pass", "Passing", (t) => t.pass_first_down_rate, { sub: true }),
        pct("first-down-rate-rush", "Rushing", (t) => t.rush_first_down_rate, { sub: true }),
        explosive("explosive", "Explosive plays", (t) => t.explosive_plays, (t) => (isNum(t.explosive_rate) ? t.explosive_rate : null), {
          labelDetail: "(rate)",
          tooltip: "Explosive plays",
        }),
        explosive("explosive-pass", "Passing", (t) => t.explosive_pass, (t) => rate(t.explosive_pass, t.pass_plays), {
          sub: true,
          labelDetail: "(20+ yd completion)",
        }),
        // explosive_rush counts (rush == 1 or qb_scramble == 1) with
        // yards_gained >= 10 (spec §4), but rush_plays is the rush == 1
        // split only - scrambles sit in pass_plays. So a team with few
        // designed runs and several long scrambles can show a rate over
        // 100% here (an explosive scramble inflates the numerator with no
        // matching denominator). The honest denominator (rush_plays plus
        // scrambles) is not a stored column, so fixing this needs a new
        // ingest column, not a page-side patch.
        explosive("explosive-rush", "Rushing", (t) => t.explosive_rush, (t) => rate(t.explosive_rush, t.rush_plays), {
          sub: true,
          labelDetail: "(10+ yd run)",
        }),
        {
          key: "toxic",
          label: "Toxic differential",
          labelDetail: "(turnovers + explosives)",
          tooltip: "Toxic differential",
          away: toxicAway.cell,
          home: toxicHome.cell,
          better: betterSide(toxicAway.total, toxicHome.total, true),
        },
      ],
    },
    {
      key: "team-stats",
      title: "Team stats",
      rows: [
        count("first-downs", "1st downs", (t) => t.first_downs, true),
        count("first-downs-pass", "Passing 1st downs", (t) => t.first_downs_pass, true, { sub: true }),
        count("first-downs-rush", "Rushing 1st downs", (t) => t.first_downs_rush, true, { sub: true }),
        count("first-downs-penalty", "1st downs from penalties", (t) => t.first_downs_penalty, true, { sub: true }),
        madeAtt("third-down", "3rd down efficiency", (t) => t.third_down_conv, (t) => t.third_down_att, { sub: true }),
        madeAtt("fourth-down", "4th down efficiency", (t) => t.fourth_down_conv, (t) => t.fourth_down_att, { sub: true }),
        count("total-plays", "Total plays", (t) => t.total_plays, null),
        count("total-yards", "Total yards", (t) => t.total_yards, true),
        count("total-drives", "Total drives", (t) => t.total_drives, null),
        dec1("yards-per-play", "Yards per play", (t) => t.yards_per_play),
        count("passing", "Passing", (t) => t.net_passing_yards, true),
        text("comp-att", "Comp/Att", (t) => fmtPair(t.completions, t.attempts, "/"), null, { sub: true }),
        dec1("yards-per-pass", "Yards per pass", (t) => t.yards_per_pass, { sub: true }),
        count("interceptions", "Interceptions thrown", (t) => t.interceptions, false, { sub: true }),
        text("sacks", "Sacks-yards lost", (t) => fmtPair(t.sacks, t.sack_yards), sacksBetter, { sub: true }),
        count("rushing", "Rushing", (t) => t.rushing_yards, true),
        count("rushing-attempts", "Rushing attempts", (t) => t.rushing_attempts, null, { sub: true }),
        dec1("yards-per-rush", "Yards per rush", (t) => t.yards_per_rush, { sub: true }),
        madeAtt("red-zone", "Red zone", (t) => t.red_zone_tds, (t) => t.red_zone_trips, { labelDetail: "(made-att)" }),
        text("penalties", "Penalties", (t) => fmtPair(t.penalties, t.penalty_yards), null),
        count("turnovers", "Turnovers", (t) => t.turnovers, false),
        count("fumbles-lost", "Fumbles lost", (t) => t.fumbles_lost, false, { sub: true }),
        count("turnovers-int", "Interceptions thrown", (t) => t.interceptions, false, { sub: true }),
        count("def-st-tds", "Defensive / special teams TDs", (t) => t.def_st_tds, true),
        text("possession", "Possession", (t) => fmtClock(t.time_of_possession_seconds), null),
      ],
    },
    {
      key: "cost",
      title: "What it cost them",
      rows: [
        dec1("cost-turnovers", "EPA lost to turnovers", (t) => t.epa_lost_turnovers),
        dec1("cost-sacks", "EPA lost to sacks", (t) => t.epa_lost_sacks),
        dec1("cost-penalties", "EPA lost to penalties", (t) => t.epa_lost_penalties),
      ],
    },
    {
      key: "downs",
      title: "Early vs late downs",
      rows: [
        epa("early-epa", "Early downs", (t) => t.early_epa_per_play, (t) => t.early_plays, {
          labelDetail: "(1st–2nd)",
          labelSuffix: "EPA / play",
        }),
        pct("early-success", "Success rate", (t) => t.early_success_rate, { sub: true }),
        epa("late-epa", "Late downs", (t) => t.late_epa_per_play, (t) => t.late_plays, {
          labelDetail: "(3rd–4th)",
          labelSuffix: "EPA / play",
        }),
        pct("late-success", "Success rate", (t) => t.late_success_rate, { sub: true }),
      ],
    },
  ];
}

/* ─── On-page notes (spec §12: things that look odd on purpose) ─── */

/** Legend above the first section; the page renders the "Shaded" chip before it. */
export const LEGEND_TEXT =
  "= the better side of each row. Rows with no clear \u201cbetter\u201d (plays, drives, attempts, penalties, possession) aren\u2019t shaded. These numbers use the nflfastR/rbsdm play filter, so a team\u2019s EPA/play here can differ from its season figure on the team pages.";

export const STRIP_SACK_NOTE = "A strip-sack counts in both the sack row and the turnover row.";

/**
 * "Why the play counts differ", worded from this game's own numbers: the
 * efficiency plays, the official total plays, and rush plays beside rushing
 * attempts. Illustrated with the team whose counts differ (away first).
 */
export function playCountNote(away: TeamGameStat, home: TeamGameStat): string {
  const pick =
    [away, home].find((t) => t.plays !== t.total_plays || t.rushing_attempts !== t.rush_plays) ?? away;
  const id = pick.team_id;
  return (
    `Efficiency counts every run and dropback the way nflfastR and rbsdm.com do, including sacks, scrambles, ` +
    `plays wiped out by penalties and 2-point tries, so ${id} has ${fmtInt(pick.plays)} plays there and ` +
    `${fmtInt(pick.total_plays)} in the official total above. Rushing attempts count kneel-downs and QB scrambles, ` +
    `while rush plays are the designed runs in that efficiency set, which is why ${id} shows ` +
    `${fmtInt(pick.rushing_attempts)} attempts and ${fmtInt(pick.rush_plays)} rush plays.`
  );
}

/**
 * Why the receiving lines need not add up to team totals (spec §10.3): a
 * team's QB passing yards minus its receivers' yards, when positive, is the
 * yardage no receiver was credited with (a lateral, or a catch by a player
 * outside the receiving positions). Always ends with the rushing-table half.
 */
export function receivingNote(lines: GamePlayerLines, awayId: string, homeId: string): string {
  const gaps: string[] = [];
  for (const team of [awayId, homeId]) {
    const qbs = lines.qbs.filter((q) => q.team_id === team);
    if (qbs.length === 0) continue;
    const passing = qbs.reduce((sum, q) => sum + (isNum(q.passing_yards) ? q.passing_yards : 0), 0);
    const receiving = lines.receivers
      .filter((r) => r.team_id === team)
      .reduce((sum, r) => sum + (isNum(r.receiving_yards) ? r.receiving_yards : 0), 0);
    const diff = passing - receiving;
    if (diff <= 0) continue;
    const who = qbs.length === 1 ? (lines.players?.[qbs[0].player_id]?.player_name || team) : team;
    gaps.push(
      `${fmtInt(diff)} of ${who}\u2019s ${fmtInt(passing)} passing yards aren\u2019t credited to a receiver above ` +
        `(yards after a lateral, or a catch by a lineman or quarterback)`
    );
  }
  const lead =
    gaps.length > 0 ? `${gaps.join("; ")}, and runs` : "Yards gained after a lateral belong to no receiver, and runs";
  return `${lead} by receivers and kneel-downs don\u2019t appear in the rushing table.`;
}

/* ─── Player tables (type A: one table per stat type, both teams inside) ─── */

export interface PlayerCell {
  text: string;
  /** Present on EPA cells: the raw value, for the colour thresholds (null → grey). */
  epa?: number | null;
}

export interface PlayerTableRow {
  player_id: string;
  name: string;
  slug: string | null;
  /** Small grey tag after the name; null on the passing table (all QBs). */
  position: string | null;
  cells: PlayerCell[];
}

export interface PlayerTableTeam {
  team_id: string;
  color: string;
  /** "28 team targets" on the receiving table. */
  note?: string;
  rows: PlayerTableRow[];
}

export interface PlayerTableModel {
  key: "passing" | "rushing" | "receiving";
  title: string;
  /** Header labels; the first is the player column. */
  columns: string[];
  /** Away team first, then home. */
  teams: PlayerTableTeam[];
}

function who(lines: GamePlayerLines, playerId: string, fallbackPosition: string | null) {
  const p = lines.players?.[playerId];
  return {
    name: p?.player_name || playerId,
    slug: p?.slug ?? null,
    position: p?.position || fallbackPosition,
  };
}

/** Yards descending, then volume descending, then name A→Z — one stable order for ties. */
function orderRows<T>(
  rows: T[],
  yards: (r: T) => number | null | undefined,
  volume: (r: T) => number | null | undefined,
  name: (r: T) => string
): T[] {
  const n = (v: number | null | undefined) => (isNum(v) ? v : Number.NEGATIVE_INFINITY);
  return [...rows].sort(
    (x, y) => n(yards(y)) - n(yards(x)) || n(volume(y)) - n(volume(x)) || name(x).localeCompare(name(y))
  );
}

const PASSING_COLUMNS = ["Player", "C/ATT", "YDS", "TD", "INT", "SCK", "RTG", "EPA/DB", "CPOE", "SUCC%", "aDOT"];
const RUSHING_COLUMNS = ["Player", "CAR", "YDS", "TD", "YPC", "EPA/CAR", "SUCC%"];
const RECEIVING_COLUMNS = ["Player", "TGT", "REC", "YDS", "TD", "TGT%", "YAC", "EPA/TGT", "CATCH%", "aDOT", "Y/TGT"];

/** Passing: every qb_weekly_stats row of each team, most passing yards first. */
export function buildPassingTable(lines: GamePlayerLines, awayId: string, homeId: string): PlayerTableModel {
  const teams = [awayId, homeId].map((team): PlayerTableTeam => {
    const rows = orderRows(
      lines.qbs.filter((q) => q.team_id === team),
      (q) => q.passing_yards,
      (q) => q.attempts,
      (q) => who(lines, q.player_id, "QB").name
    );
    return {
      team_id: team,
      color: getTeamColor(team),
      rows: rows.map((q): PlayerTableRow => {
        const id = who(lines, q.player_id, "QB");
        return {
          player_id: q.player_id,
          name: id.name,
          slug: id.slug,
          position: null,
          cells: [
            { text: fmtPair(q.completions, q.attempts, "/") },
            { text: fmtInt(q.passing_yards) },
            { text: fmtInt(q.touchdowns) },
            { text: fmtInt(q.interceptions) },
            { text: fmtInt(q.sacks) },
            { text: fmtDec1(q.passer_rating) },
            { text: fmtSigned2(q.epa_per_dropback), epa: isNum(q.epa_per_dropback) ? q.epa_per_dropback : null },
            { text: fmtSigned1(q.cpoe) },
            { text: fmtPct(q.success_rate) },
            { text: fmtDec1(q.adot) },
          ],
        };
      }),
    };
  });
  return { key: "passing", title: "Passing", columns: PASSING_COLUMNS, teams };
}

interface RushLine {
  player_id: string;
  yards: number | null;
  carries: number | null;
  row: PlayerTableRow;
}

/**
 * Rushing: rb_weekly_stats rows plus QB rushing from qb_weekly_stats (spec
 * §6, §10.1), only players with a carry, most rushing yards first. QB rows use
 * the PR 2 columns rush_epa_per_carry / rush_success_rate; yards per carry for
 * a QB is rush_yards ÷ rush_attempts (the QB table stores no YPC).
 */
export function buildRushingTable(lines: GamePlayerLines, awayId: string, homeId: string): PlayerTableModel {
  const teams = [awayId, homeId].map((team): PlayerTableTeam => {
    const rbLines: RushLine[] = lines.rbs
      .filter((r) => r.team_id === team && isNum(r.carries) && r.carries > 0)
      .map((r) => {
        const id = who(lines, r.player_id, "RB");
        return {
          player_id: r.player_id,
          yards: isNum(r.rushing_yards) ? r.rushing_yards : null,
          carries: r.carries,
          row: {
            player_id: r.player_id,
            name: id.name,
            slug: id.slug,
            position: id.position,
            cells: [
              { text: fmtInt(r.carries) },
              { text: fmtInt(r.rushing_yards) },
              { text: fmtInt(r.rushing_tds) },
              { text: fmtDec1(r.yards_per_carry) },
              { text: fmtSigned2(r.epa_per_carry), epa: isNum(r.epa_per_carry) ? r.epa_per_carry : null },
              { text: fmtPct(r.success_rate) },
            ],
          },
        };
      });
    const qbLines: RushLine[] = lines.qbs
      .filter((q) => q.team_id === team && isNum(q.rush_attempts) && q.rush_attempts > 0)
      .map((q) => {
        const id = who(lines, q.player_id, "QB");
        return {
          player_id: q.player_id,
          yards: isNum(q.rush_yards) ? q.rush_yards : null,
          carries: q.rush_attempts,
          row: {
            player_id: q.player_id,
            name: id.name,
            slug: id.slug,
            position: id.position,
            cells: [
              { text: fmtInt(q.rush_attempts) },
              { text: fmtInt(q.rush_yards) },
              { text: fmtInt(q.rush_tds) },
              { text: fmtDec1(rate(q.rush_yards, q.rush_attempts)) },
              { text: fmtSigned2(q.rush_epa_per_carry), epa: isNum(q.rush_epa_per_carry) ? q.rush_epa_per_carry : null },
              { text: fmtPct(q.rush_success_rate) },
            ],
          },
        };
      });
    // One line per player. scripts/ingest.py builds qb_ids (:1990) and rb_ids
    // (:2288) from the WHOLE season's weekly rosters, so a player listed QB in
    // one week and RB/FB in another is in both sets all season and a single
    // game can write him a qb_weekly_stats row AND an rb_weekly_stats row.
    // Rendering both double-counts his carries on screen and hands PlayerTable
    // two rows with the same React key. The two rows are not even the same
    // numbers: the QB aggregator counts designed runs PLUS scrambles (spec
    // §10.1) while the RB one filters scrambles out (`qb_scramble != 1`,
    // ingest.py:2293), so keep the line with more carries — and the QB line on
    // a tie, because by construction it is the more complete of the two.
    // rbLines are inserted first and `>=` lets a qbLine take the slot.
    const byPlayer = new Map<string, RushLine>();
    for (const line of [...rbLines, ...qbLines]) {
      const kept = byPlayer.get(line.player_id);
      if (!kept || (line.carries ?? 0) >= (kept.carries ?? 0)) byPlayer.set(line.player_id, line);
    }
    const ordered = orderRows(
      // Array.from, not a spread: the tsconfig target predates downlevelIteration.
      Array.from(byPlayer.values()),
      (l) => l.yards,
      (l) => l.carries,
      (l) => l.row.name
    );
    return { team_id: team, color: getTeamColor(team), rows: ordered.map((l) => l.row) };
  });
  return { key: "rushing", title: "Rushing", columns: RUSHING_COLUMNS, teams };
}

/**
 * Receiving: receiver_weekly_stats only (its position filter already includes
 * RB/FB), most receiving yards first. TGT% divides by the team's team_targets
 * from team_game_stats (spec §5), never by a sum of rows; Y/TGT is yards ÷
 * targets. YPRR is appended only when any row in the game has route data
 * (nflverse publishes participation after the season, so 2026 has none).
 */
export function buildReceivingTable(
  lines: GamePlayerLines,
  awayId: string,
  homeId: string,
  teamTargets: Record<string, number | null | undefined>
): PlayerTableModel {
  const hasRoutes = lines.receivers.some((r) => isNum(r.routes_run));
  const columns = hasRoutes ? [...RECEIVING_COLUMNS, "YPRR"] : RECEIVING_COLUMNS;
  const teams = [awayId, homeId].map((team): PlayerTableTeam => {
    const targets = teamTargets[team];
    const rows = orderRows(
      lines.receivers.filter((r) => r.team_id === team),
      (r) => r.receiving_yards,
      (r) => r.targets,
      (r) => who(lines, r.player_id, null).name
    );
    return {
      team_id: team,
      color: getTeamColor(team),
      note: isNum(targets) && targets > 0 ? `${fmtInt(targets)} team targets` : undefined,
      rows: rows.map((r): PlayerTableRow => {
        const id = who(lines, r.player_id, null);
        const cells: PlayerCell[] = [
          { text: fmtInt(r.targets) },
          { text: fmtInt(r.receptions) },
          { text: fmtInt(r.receiving_yards) },
          { text: fmtInt(r.receiving_tds) },
          { text: fmtPct(rate(r.targets, targets), 1) },
          { text: fmtInt(r.yac) },
          { text: fmtSigned2(r.epa_per_target), epa: isNum(r.epa_per_target) ? r.epa_per_target : null },
          { text: fmtPct(r.catch_rate) },
          { text: fmtDec1(r.adot) },
          { text: fmtDec1(rate(r.receiving_yards, r.targets)) },
        ];
        if (hasRoutes) cells.push({ text: fmtDec2(r.yards_per_route_run) });
        return { player_id: r.player_id, name: id.name, slug: id.slug, position: id.position, cells };
      }),
    };
  });
  return { key: "receiving", title: "Receiving", columns, teams };
}

// Re-exported so callers can type their inputs without importing lib/types twice.
export type { QBWeeklyStat, RBWeeklyStat, ReceiverWeeklyStat, TeamGameStat, GamePlayerLines };
