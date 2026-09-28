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
function wavg(rows: readonly Row[], rate: string, den: string): number | null {
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
function total(rows: readonly Row[], col: string): number {
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
