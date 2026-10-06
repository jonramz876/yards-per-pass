// lib/stats/team-stats.ts — the /team-stats page's pure pieces (team stats
// spec 2026-09-28 §3, §5.3-5.4).
//
// No Supabase here: the server page, the client table and the tests all import
// this module. The page is the documented exception to "all stat computation
// happens in scripts/ingest.py": it adds up stored per-game team_game_stats
// rows on the server at request time. Every rule below is the reference
// aggregator's (docs/superpowers/specs/team-stats-reference/aggregate.py),
// line for line, and the golden test holds the two together.
import { NFL_TEAMS, getTeam } from "@/lib/data/teams";
import { fmtFixed, fmtInt, fmtPct, fmtSignedInt, isNum } from "@/lib/stats/box-score";
import { EM_DASH, EPA_AVERAGE_MIN_PLAYS, EPA_BAND, epaVsAverageClass } from "@/lib/stats/formatters";

/* ─── Aggregation (spec §3) ─── */

/** One side of one team's season (offense = its own rows, defense = its opponents' rows). */
export interface TeamSideStats {
  /** team-games on this side */
  gp: number;
  plays: number;
  pass_plays: number;
  rush_plays: number;
  early_plays: number;
  late_plays: number;
  epa: number | null;
  pass_epa: number | null;
  rush_epa: number | null;
  sr: number | null;
  pass_sr: number | null;
  rush_sr: number | null;
  fd: number | null;
  pass_fd: number | null;
  rush_fd: number | null;
  early_epa: number | null;
  early_sr: number | null;
  late_epa: number | null;
  late_sr: number | null;
  expl: number;
  expl_rate: number | null;
  expl_pass: number;
  expl_pass_rate: number | null;
  expl_rush: number;
  expl_rush_rate: number | null;
  cost_to: number | null;
  cost_sack: number | null;
  cost_pen: number | null;
  cost_total: number | null;
}

export interface TeamStatsRow {
  /** team_id */
  team: string;
  /** getTeam(id)?.name ?? id */
  name: string;
  /** rows where team_id === team */
  off: TeamSideStats;
  /** rows where opponent_id === team (what it allowed) */
  def: TeamSideStats;
  toxic: number | null;
  to_margin: number | null;
  ex_margin: number | null;
}

export interface TeamStatsModel {
  /** sorted by team id */
  teams: TeamStatsRow[];
  /** side(all rows); its gp is the number of team-game rows */
  league: TeamSideStats;
  /** mean toxic over teams with off.gp > 0 (0 by construction) */
  leagueToxic: number | null;
  /** teams with off.gp > 0 — the divisor for the average-team count cells */
  teamsPlayed: number;
}

type Row = Readonly<Record<string, unknown>>;

/**
 * aggregate.py's num(): a finite number, or a numeric string parsed to one;
 * anything else (null, undefined, "", "NaN", Infinity, objects) is null.
 */
export function num(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** Σ(rate × den) / Σ den over rows with a rate and a non-zero denominator; null when Σ den is 0. */
export function wavg(rows: readonly Row[], rate: string, den: string): number | null {
  let top = 0;
  let bot = 0;
  for (const r of rows) {
    const v = num(r[rate]);
    const d = num(r[den]);
    if (v === null || !d) continue;
    top += v * d;
    bot += d;
  }
  return bot ? top / bot : null;
}

/** Σ (num(v) ?? 0). */
export function total(rows: readonly Row[], col: string): number {
  let s = 0;
  for (const r of rows) s += num(r[col]) ?? 0;
  return s;
}

/** The 13 play-weighted rates: [key, rate column, denominator column] (aggregate.py RATES). */
export const RATE_COLUMNS = [
  ["epa", "epa_per_play", "plays"],
  ["pass_epa", "pass_epa_per_play", "pass_plays"],
  ["rush_epa", "rush_epa_per_play", "rush_plays"],
  ["sr", "success_rate", "plays"],
  ["pass_sr", "pass_success_rate", "pass_plays"],
  ["rush_sr", "rush_success_rate", "rush_plays"],
  ["fd", "first_down_rate", "plays"],
  ["pass_fd", "pass_first_down_rate", "pass_plays"],
  ["rush_fd", "rush_first_down_rate", "rush_plays"],
  ["early_epa", "early_epa_per_play", "early_plays"],
  ["early_sr", "early_success_rate", "early_plays"],
  ["late_epa", "late_epa_per_play", "late_plays"],
  ["late_sr", "late_success_rate", "late_plays"],
] as const;

const COST_COLUMNS = [
  ["cost_to", "epa_lost_turnovers"],
  ["cost_sack", "epa_lost_sacks"],
  ["cost_pen", "epa_lost_penalties"],
] as const;

/** aggregate.py's side(), except gp = 0 gives null costs (not a false "0.00"). */
function side(rows: readonly Row[]): TeamSideStats {
  const gp = rows.length;
  const plays = total(rows, "plays");
  const pass_plays = total(rows, "pass_plays");
  const rush_plays = total(rows, "rush_plays");
  const rates = {} as Record<(typeof RATE_COLUMNS)[number][0], number | null>;
  for (const [key, rate, den] of RATE_COLUMNS) rates[key] = wavg(rows, rate, den);
  const expl = total(rows, "explosive_plays");
  const expl_pass = total(rows, "explosive_pass");
  const expl_rush = total(rows, "explosive_rush");
  const costs = {} as Record<(typeof COST_COLUMNS)[number][0], number | null>;
  for (const [key, col] of COST_COLUMNS) costs[key] = gp > 0 ? total(rows, col) / gp : null;
  const cost_total =
    costs.cost_to === null || costs.cost_sack === null || costs.cost_pen === null
      ? null
      : costs.cost_to + costs.cost_sack + costs.cost_pen;
  return {
    gp,
    plays,
    pass_plays,
    rush_plays,
    early_plays: total(rows, "early_plays"),
    late_plays: total(rows, "late_plays"),
    ...rates,
    expl,
    expl_rate: plays ? expl / plays : null,
    expl_pass,
    expl_pass_rate: pass_plays ? expl_pass / pass_plays : null,
    expl_rush,
    expl_rush_rate: rush_plays ? expl_rush / rush_plays : null,
    ...costs,
    cost_total,
  };
}

const byId = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Season team stats from team_game_stats rows (one per team per game).
 *
 * The team set is every row's team_id plus every NFL_TEAMS id, so a team that
 * hasn't played is a row with GP 0 rather than missing, and an unknown id
 * still appears (name = id). A row whose team_id is not a non-empty string
 * joins no team but still counts in the league row.
 */
export function buildTeamStats(rows: ReadonlyArray<Record<string, unknown>>): TeamStatsModel {
  const all = (rows ?? []) as readonly Row[];
  const byGame = new Map<string, Row[]>();
  const ids = new Set<string>(NFL_TEAMS.map((t) => t.id));
  for (const r of all) {
    const g = String(r.game_id);
    const list = byGame.get(g);
    if (list) list.push(r);
    else byGame.set(g, [r]);
    if (typeof r.team_id === "string" && r.team_id !== "") ids.add(r.team_id);
  }

  const teams: TeamStatsRow[] = Array.from(ids)
    .sort(byId)
    .map((team) => {
      const off = all.filter((r) => r.team_id === team);
      const dfn = all.filter((r) => r.opponent_id === team);
      let to_margin = 0;
      let ex_margin = 0;
      for (const r of off) {
        const opp = (byGame.get(String(r.game_id)) ?? []).find((o) => o.team_id !== team);
        if (!opp) continue; // no opponent row: skipped for toxic only
        to_margin += (num(opp.turnovers) ?? 0) - (num(r.turnovers) ?? 0);
        ex_margin += (num(r.explosive_plays) ?? 0) - (num(opp.explosive_plays) ?? 0);
      }
      const played = off.length > 0;
      return {
        team,
        name: getTeam(team)?.name ?? team,
        off: side(off),
        def: side(dfn),
        toxic: played ? to_margin + ex_margin : null,
        to_margin: played ? to_margin : null,
        ex_margin: played ? ex_margin : null,
      };
    });

  const playedTeams = teams.filter((t) => t.off.gp > 0);
  const leagueToxic =
    playedTeams.length > 0
      ? playedTeams.reduce((s, t) => s + (t.toxic ?? 0), 0) / playedTeams.length
      : null;

  return { teams, league: side(all), leagueToxic, teamsPlayed: playedTeams.length };
}

/* ─── Presentation (spec §5.3-5.4): columns, sort, colour, URL, copy ─── */

export type TeamStatsSide = "off" | "def";
export type TeamStatsTab = "eff" | "downs" | "cost";
export type SortDir = "asc" | "desc";

export const TEAM_STATS_TABS: readonly TeamStatsTab[] = ["eff", "downs", "cost"];
export const TEAM_STATS_TAB_LABELS: Record<TeamStatsTab, string> = {
  eff: "Efficiency",
  downs: "Early vs Late Downs",
  cost: "What It Cost Them",
};
export const SIDE_LABELS: Record<TeamStatsSide, string> = { off: "Offense", def: "Defense" };

/** The MetricTooltip keys this page may use (the only three whose text is true here). */
export type TeamStatsTooltip = "EPA / play" | "Success rate" | "Explosive plays";

export interface TeamStatsColumn {
  key: keyof TeamSideStats | "toxic";
  /** Column header. */
  label: string;
  /** Group header, set on the first column of each group. */
  group?: string;
  /** MetricTooltip key, on the group's first column. */
  tooltip?: TeamStatsTooltip;
  format: (v: number | null | undefined) => string;
  /** EPA/play: coloured against the league average. */
  colour: boolean;
  /** Plays: higher first on both sides, never a default sort. */
  neutral: boolean;
  /** A count: the average row shows the average team, and GP 0 shows a dash. */
  count: boolean;
  /** Read from the team row, not a side (toxic). */
  teamLevel: boolean;
  offOnly: boolean;
}

const f3 = (v: number | null | undefined) => fmtFixed(v, 3, true);
const f2 = (v: number | null | undefined) => fmtFixed(v, 2, true);
const pct = (v: number | null | undefined) => fmtPct(v);

function col(key: TeamStatsColumn["key"], label: string, format: TeamStatsColumn["format"], extra: Partial<TeamStatsColumn> = {}): TeamStatsColumn {
  return { key, label, format, colour: false, neutral: false, count: false, teamLevel: false, offOnly: false, ...extra };
}

export const TEAM_STATS_COLUMNS_BY_TAB: Record<TeamStatsTab, readonly TeamStatsColumn[]> = {
  eff: [
    col("epa", "All", f3, { group: "EPA / play", tooltip: "EPA / play", colour: true }),
    col("pass_epa", "Pass", f3, { colour: true }),
    col("rush_epa", "Rush", f3, { colour: true }),
    col("sr", "All", pct, { group: "Success rate", tooltip: "Success rate" }),
    col("pass_sr", "Pass", pct),
    col("rush_sr", "Rush", pct),
    col("fd", "All", pct, { group: "1st down rate" }),
    col("pass_fd", "Pass", pct),
    col("rush_fd", "Rush", pct),
    col("expl", "Plays", fmtInt, { group: "Explosive plays", tooltip: "Explosive plays", count: true }),
    col("expl_rate", "Rate", pct),
    col("expl_pass_rate", "Pass", pct),
    col("expl_rush_rate", "Rush", pct),
    col("toxic", "Diff", fmtSignedInt, { group: "Toxic", teamLevel: true, offOnly: true }),
  ],
  downs: [
    col("early_plays", "Plays", fmtInt, { group: "Early downs (1st–2nd)", neutral: true, count: true }),
    col("early_epa", "EPA/play", f3, { colour: true }),
    col("early_sr", "Success", pct),
    col("late_plays", "Plays", fmtInt, { group: "Late downs (3rd–4th)", neutral: true, count: true }),
    col("late_epa", "EPA/play", f3, { colour: true }),
    col("late_sr", "Success", pct),
  ],
  cost: [
    col("cost_to", "Turnovers", f2, { group: "EPA lost per game" }),
    col("cost_sack", "Sacks", f2),
    col("cost_pen", "Penalties", f2),
    col("cost_total", "Total", f2),
  ],
};

/** The columns shown for a tab on a side (Toxic is Offense only). */
export function teamStatsColumns(tab: TeamStatsTab, side: TeamStatsSide): TeamStatsColumn[] {
  return TEAM_STATS_COLUMNS_BY_TAB[tab].filter((c) => !(c.offOnly && side === "def"));
}

/** A tab's default sort: its first non-neutral column (the same on both sides). */
export function defaultSortKey(tab: TeamStatsTab): string {
  return TEAM_STATS_COLUMNS_BY_TAB[tab].find((c) => !c.neutral)!.key;
}

/**
 * Better first: Offense higher first on every column (costs too: a team's own
 * penalties can net positive EPA, so this is higher first, not closer to
 * zero); Defense lower first on every non-neutral column; Plays and the
 * team-level Toxic higher first.
 */
export function betterFirstDir(c: TeamStatsColumn, side: TeamStatsSide): SortDir {
  if (side === "off" || c.neutral || c.teamLevel) return "desc";
  return "asc";
}

/**
 * The value a cell shows and sorts by. A count on a side with no games is
 * null, not 0 (spec §3.2, I5): printed as a dash and sorted with the nulls.
 */
export function cellValue(t: TeamStatsRow, c: TeamStatsColumn, side: TeamStatsSide): number | null {
  if (c.teamLevel) return (t as unknown as Record<string, number | null>)[c.key] ?? null;
  const s = t[side];
  if (c.count && s.gp === 0) return null;
  const v = s[c.key as keyof TeamSideStats];
  return isNum(v) ? v : null;
}

export function formatCell(c: TeamStatsColumn, v: number | null | undefined): string {
  return c.format(v);
}

/** Sorted copy: nulls last in either direction; ties (and null-null) by team id ascending. */
export function sortTeamRows(
  teams: readonly TeamStatsRow[],
  c: TeamStatsColumn,
  side: TeamStatsSide,
  dir: SortDir,
): TeamStatsRow[] {
  return teams
    .map((t) => ({ t, v: cellValue(t, c, side) }))
    .sort((a, b) => {
      if (a.v === null || b.v === null) {
        if (a.v !== b.v) return a.v === null ? 1 : -1;
        return byId(a.t.team, b.t.team);
      }
      const d = dir === "desc" ? b.v - a.v : a.v - b.v;
      return d !== 0 ? d : byId(a.t.team, b.t.team);
    })
    .map((x) => x.t);
}

/**
 * EPA/play colour against the league row's value, the site's rule
 * (epaVsAverageClass: compared as printed at 3 dp, grey within 0.03). On
 * Defense lower is better, so both numbers are negated — toFixed is
 * sign-symmetric, so the printed difference just changes sign.
 */
export function teamEpaClass(v: number | null | undefined, avg: number | null | undefined, side: TeamStatsSide): string {
  return side === "off"
    ? epaVsAverageClass(v, avg, EPA_BAND.play, 3)
    : epaVsAverageClass(v == null ? v : -v, avg == null ? avg : -avg, EPA_BAND.play, 3);
}

/** Colour starts once the season has enough plays to set a league average. */
export function colourOn(model: TeamStatsModel): boolean {
  return model.league.plays >= EPA_AVERAGE_MIN_PLAYS.play;
}

/** Tailwind text class for a body cell. */
export function cellClass(model: TeamStatsModel, c: TeamStatsColumn, v: number | null, side: TeamStatsSide): string {
  if (v === null) return "text-gray-400";
  if (c.colour && colourOn(model)) {
    return teamEpaClass(v, model.league[c.key as keyof TeamSideStats] as number | null, side);
  }
  return "text-gray-700";
}

/**
 * The NFL average row's cell (J2): rates and costs league-wide; counts are the
 * average team (league total ÷ teams that have played, one decimal); Toxic is
 * the computed league mean.
 */
export function averageCell(model: TeamStatsModel, c: TeamStatsColumn): string {
  if (c.teamLevel) return c.format(model.leagueToxic);
  const v = model.league[c.key as keyof TeamSideStats];
  if (c.count) return model.teamsPlayed > 0 && isNum(v) ? fmtFixed(v / model.teamsPlayed, 1) : EM_DASH;
  return c.format(v as number | null);
}

/* The ?season= param */

/** Plausible seasons: nflverse play-by-play starts in 1999; 2100 is a generous ceiling. */
export const SEASON_PARAM_MIN = 1999;
export const SEASON_PARAM_MAX = 2100;

/**
 * `?season=` as the leaderboards read it (parseInt, so "2025.9" is 2025), but
 * only a whole number from 1999 to 2100 counts; anything else is absent (the
 * default season). Without the range, ?season=99999999999999999999 reached
 * Postgres as .eq("season", 1e20) and failed the page (chaos ERROR 2).
 */
export function parseSeasonParam(raw: string | undefined): number | null {
  if (!raw) return null;
  const n = parseInt(raw, 10);
  return Number.isInteger(n) && n >= SEASON_PARAM_MIN && n <= SEASON_PARAM_MAX ? n : null;
}

/* URL state (the leaderboards' pattern): side=def, tab=downs|cost, sort=<key>, dir=asc|desc; defaults omitted. */

export interface TeamStatsState {
  side: TeamStatsSide;
  tab: TeamStatsTab;
  sort: string;
  dir: SortDir;
}

type ParamReader = { get(name: string): string | null };

export function parseTeamStatsParams(params: ParamReader): TeamStatsState {
  const side: TeamStatsSide = params.get("side") === "def" ? "def" : "off";
  const rawTab = params.get("tab");
  const tab: TeamStatsTab = rawTab === "downs" || rawTab === "cost" ? rawTab : "eff";
  const cols = teamStatsColumns(tab, side);
  const rawSort = params.get("sort");
  const sortCol = cols.find((c) => c.key === rawSort) ?? cols.find((c) => c.key === defaultSortKey(tab))!;
  const rawDir = params.get("dir");
  const dir: SortDir = rawDir === "asc" || rawDir === "desc" ? rawDir : betterFirstDir(sortCol, side);
  return { side, tab, sort: sortCol.key, dir };
}

/** The query string for a state (no leading "?"), keeping every other param (season, …). */
export function buildTeamStatsQuery(state: TeamStatsState, params: ParamReader & { toString(): string }): string {
  const out = new URLSearchParams(params.toString());
  for (const k of ["side", "tab", "sort", "dir"]) out.delete(k);
  if (state.side !== "off") out.set("side", state.side);
  if (state.tab !== "eff") out.set("tab", state.tab);
  if (state.sort !== defaultSortKey(state.tab)) out.set("sort", state.sort);
  const c = teamStatsColumns(state.tab, state.side).find((x) => x.key === state.sort);
  if (!c || state.dir !== betterFirstDir(c, state.side)) out.set("dir", state.dir);
  return out.toString();
}

/* Visitor-facing copy (spec §5.4). Plain TS strings, rendered verbatim. */

/** C1 — shown above the table; "Team Tiers" is linked to /teams. */
export const TEAM_TIERS_NOTE =
  "These rankings add up every game’s box score, so they use the same play filter as the box scores and rbsdm.com. A team’s EPA/play here can differ from its figure on Team Tiers, which counts plays differently.";
export const TEAM_TIERS_LINK_TEXT = "Team Tiers";

/** C2 */
export const SUBTITLE: Record<TeamStatsSide, string> = {
  off: "What each offense did",
  def: "What opponents did against each team",
};

/** C3 — Defense, Efficiency and Downs tabs; each names only what its tab shows (Downs has no explosive column). */
export const DEFENSE_NOTE: Record<"eff" | "downs", string> = {
  eff: "Defense ranks what opponents did against each team, so lower EPA, success and explosive rates rank higher.",
  downs: "Defense ranks what opponents did against each team, so lower EPA and success rates rank higher.",
};

/** C4 — Efficiency tab. */
export const EXPLOSIVE_NOTE =
  "Explosive plays are completions of 20+ yards and runs of 10+ (QB scrambles count as runs). The rush explosive rate divides by designed runs only, so a team with long scrambles can run high.";

/** C5 — Efficiency tab, Offense only. */
export const TOXIC_NOTE =
  "Toxic differential is turnover margin plus explosive-play margin, one figure for the whole team.";

/** C6 (J1) — Cost tab. */
export const COST_NOTE: Record<TeamStatsSide, string> = {
  off: "EPA each team lost per game to its own turnovers, sacks and penalties. Penalties count the team’s flags on both sides of the ball, as in the box score. Higher (less negative) is better.",
  def: "EPA each team’s opponents lost per game to their own turnovers, sacks and penalties (their flags on both sides of the ball). More negative is better.",
};

/** C6b — Cost tab. */
export const STRIP_SACK_COST_NOTE =
  "A strip-sack counts in both the Turnovers and Sacks columns, as in the box score, so Total counts it twice.";

/** C7 — built from the band constant. */
export function colourNote(): string {
  return `EPA/play is green (better) or red (worse) against the NFL average in the bottom row, grey within ${EPA_BAND.play.toFixed(2)}.`;
}

/** C7b — when the league has too few plays to colour. */
export function colourPendingNote(season: number): string {
  return `EPA colours start once the ${season} season has enough plays to set a league average.`;
}

export const EARLY_SEASON_MAX_WEEK = 4;

/** C8 — the latest season, weeks 1-4. */
export function earlySeasonNote(throughWeek: number | null | undefined, isLatestSeason: boolean): string | null {
  if (!isLatestSeason || !isNum(throughWeek) || throughWeek < 1 || throughWeek > EARLY_SEASON_MAX_WEEK) return null;
  const n = throughWeek;
  return `With only ${n} ${n === 1 ? "week" : "weeks"} played, one game moves a team a long way.`;
}

/** C9 */
export function uncoveredHeading(season: number, firstSeason: number | null): string {
  return firstSeason != null
    ? `Team stats start with the ${firstSeason} season`
    : `Team stats aren’t available for the ${season} season`;
}
export const UNCOVERED_BODY = "Earlier seasons aren’t available yet.";

/** C10 */
export function teamStatsTitle(season: number): string {
  return `NFL Team Stats ${season}`;
}
export function teamStatsDescription(season: number): string {
  return `Every NFL team's offense and defense for the ${season} season: EPA per play, success rate, explosive plays, early and late downs, and what turnovers, sacks and penalties cost.`;
}

/** C11 (J2) — tabs with a count column. */
export const AVERAGE_ROW_NOTE =
  "In the NFL average row, rates are league-wide and counts are for the average team.";

export interface FootnoteState {
  side: TeamStatsSide;
  tab: TeamStatsTab;
  colourOn: boolean;
  season: number;
  throughWeek: number | null;
  isLatestSeason: boolean;
}

/** The footnotes under the table, in order, for one side × tab. */
export function teamStatsFootnotes(s: FootnoteState): string[] {
  const out: string[] = [];
  const epaTab = s.tab === "eff" || s.tab === "downs";
  if (s.side === "def" && (s.tab === "eff" || s.tab === "downs")) out.push(DEFENSE_NOTE[s.tab]);
  if (s.tab === "eff") out.push(EXPLOSIVE_NOTE);
  if (s.tab === "eff" && s.side === "off") out.push(TOXIC_NOTE);
  if (s.tab === "cost") out.push(COST_NOTE[s.side], STRIP_SACK_COST_NOTE);
  if (epaTab) out.push(AVERAGE_ROW_NOTE, s.colourOn ? colourNote() : colourPendingNote(s.season));
  const early = earlySeasonNote(s.throughWeek, s.isLatestSeason);
  if (early) out.push(early);
  return out;
}
