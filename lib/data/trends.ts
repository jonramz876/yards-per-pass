/**
 * Data layer for the Stat Surge Detector.
 * Fetches all weekly stats for a season and converts to WeeklyValue format.
 */

import { fetchAllRows } from "./utils";
import type { PlayerSlug } from "@/lib/types";
import type { WeeklyValue } from "@/lib/stats/surge";

function parseNum(v: unknown): number {
  if (v === null || v === undefined) return NaN;
  const n = typeof v === "string" ? parseFloat(v) : Number(v);
  return isNaN(n) ? NaN : n;
}

/** Build WeeklyValue[] from raw rows grouped by player */
function buildWeeklyValues(
  rows: Record<string, unknown>[],
  statColumn: string,
  slugMap: Map<string, PlayerSlug>,
  positionFilter: string[],
): WeeklyValue[] {
  const byPlayer = new Map<string, { week: number; value: number }[]>();

  for (const row of rows) {
    const pid = row.player_id as string;
    const week = row.week as number;
    const val = parseNum(row[statColumn]);
    if (isNaN(val)) continue;
    if (!byPlayer.has(pid)) byPlayer.set(pid, []);
    byPlayer.get(pid)!.push({ week, value: val });
  }

  const result: WeeklyValue[] = [];
  byPlayer.forEach((weeks, pid) => {
    const info = slugMap.get(pid);
    if (!info || !positionFilter.includes(info.position)) return;
    result.push({
      playerId: pid,
      playerName: info.player_name,
      teamId: info.current_team_id,
      position: info.position,
      slug: info.slug,
      weeks,
    });
  });
  return result;
}

/** Stat definitions available for surge detection */
export interface StatDef {
  key: string;
  label: string;
  table: string;
  column: string;
  positions: string[];
  format: "epa" | "pct" | "rate" | "yards";
}

export const SURGE_STATS: StatDef[] = [
  { key: "qb_epa",       label: "EPA/Dropback",   table: "qb_weekly_stats",       column: "epa_per_dropback", positions: ["QB"],           format: "epa" },
  { key: "qb_cpoe",      label: "CPOE",           table: "qb_weekly_stats",       column: "cpoe",             positions: ["QB"],           format: "epa" },
  { key: "qb_rating",    label: "Passer Rating",  table: "qb_weekly_stats",       column: "passer_rating",    positions: ["QB"],           format: "rate" },
  { key: "qb_ypa",       label: "Yards/Attempt",  table: "qb_weekly_stats",       column: "ypa",              positions: ["QB"],           format: "rate" },
  { key: "wr_epa",       label: "EPA/Target",     table: "receiver_weekly_stats", column: "epa_per_target",   positions: ["WR", "TE"],     format: "epa" },
  { key: "wr_yprr",      label: "YPRR",           table: "receiver_weekly_stats", column: "yards_per_route_run", positions: ["WR", "TE"],  format: "rate" },
  { key: "wr_catch",     label: "Catch Rate",     table: "receiver_weekly_stats", column: "catch_rate",       positions: ["WR", "TE"],     format: "pct" },
  { key: "rb_epa",       label: "EPA/Carry",      table: "rb_weekly_stats",       column: "epa_per_carry",    positions: ["RB"],           format: "epa" },
  { key: "rb_success",   label: "Success Rate",   table: "rb_weekly_stats",       column: "success_rate",     positions: ["RB"],           format: "pct" },
  { key: "rb_ypc",       label: "Yards/Carry",    table: "rb_weekly_stats",       column: "yards_per_carry",  positions: ["RB"],           format: "rate" },
];

/** Fetch weekly values for a given stat definition */
export async function getWeeklyForStat(
  stat: StatDef,
  season: number,
  slugMap: Map<string, PlayerSlug>,
): Promise<WeeklyValue[]> {
  const rows = await fetchAllRows(stat.table, `player_id,week,${stat.column}`, { season });
  return buildWeeklyValues(rows, stat.column, slugMap, stat.positions);
}

/** Fetch all weekly values for all stats — returns a map keyed by stat key */
export async function getAllSurgeData(
  season: number,
  slugMap: Map<string, PlayerSlug>,
): Promise<Map<string, WeeklyValue[]>> {
  // Group stats by table to avoid redundant fetches
  const tableStats: Record<string, StatDef[]> = {};
  for (const stat of SURGE_STATS) {
    if (!tableStats[stat.table]) tableStats[stat.table] = [];
    tableStats[stat.table].push(stat);
  }

  const result = new Map<string, WeeklyValue[]>();

  // Fetch each table once, extract multiple stats from it
  const tableKeys = Object.keys(tableStats);
  const tableRows = await Promise.all(
    tableKeys.map((table) => fetchAllRows(table, "*", { season }))
  );

  for (let i = 0; i < tableKeys.length; i++) {
    const stats = tableStats[tableKeys[i]];
    const rows = tableRows[i];
    for (const stat of stats) {
      result.set(stat.key, buildWeeklyValues(rows, stat.column, slugMap, stat.positions));
    }
  }

  return result;
}
