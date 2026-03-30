// lib/data/run-gaps.ts
import { createServerClient } from "@/lib/supabase/server";
import { parseNumericFields } from "@/lib/utils";
import { fetchAllRows } from "@/lib/data/utils";
import type { RBGapStat, RBGapStatWeekly, DefGapStat } from "@/lib/types";

const RB_GAP_NUMERIC_FIELDS = [
  "epa_per_carry",
  "yards_per_carry",
  "success_rate",
  "stuff_rate",
  "explosive_rate",
];

export async function getRBGapStats(
  season: number,
  teamId?: string
): Promise<RBGapStat[]> {
  if (teamId) {
    // Single team: always under 1000 rows, no pagination needed
    const supabase = createServerClient();
    const { data, error } = await supabase
      .from("rb_gap_stats")
      .select("*")
      .eq("season", season)
      .eq("team_id", teamId);
    if (error) throw new Error(`Failed to fetch RB gap stats: ${error.message}`);
    if (!data) return [];
    return data.map((row) =>
      parseNumericFields<RBGapStat>(row as unknown as RBGapStat, RB_GAP_NUMERIC_FIELDS)
    );
  }

  // All teams: paginate past 1000-row server limit
  const rows = await fetchAllRows("rb_gap_stats", "*", { season });
  return rows.map((row) =>
    parseNumericFields<RBGapStat>(row as unknown as RBGapStat, RB_GAP_NUMERIC_FIELDS)
  );
}

export interface GapLeagueAvg {
  gap: string;
  avg_epa: number;
  avg_yards: number;
  avg_success: number;
  avg_stuff: number;
  avg_explosive: number;
}

export interface TeamGapEpa {
  team_id: string;
  gap: string;
  epa_per_carry: number;
}

export async function getLeagueGapAverages(
  season: number
): Promise<{ averages: GapLeagueAvg[]; teamGapEpas: TeamGapEpa[] }> {
  let data: Record<string, unknown>[];
  try {
    data = await fetchAllRows(
      "rb_gap_stats",
      "team_id, gap, carries, epa_per_carry, yards_per_carry, success_rate, stuff_rate, explosive_rate",
      { season }
    );
  } catch {
    return { averages: [], teamGapEpas: [] };
  }
  if (!data || data.length === 0) return { averages: [], teamGapEpas: [] };

  // Accumulate per-team per-gap totals (for ranking) and league-wide totals (for averages)
  const teamGapMap = new Map<string, { carries: number; epaSum: number }>();
  const gapMap = new Map<string, { totalCarries: number; weightedEpa: number; weightedYards: number; weightedSuccess: number; weightedStuff: number; weightedExplosive: number }>();

  for (const row of data) {
    const carries = row.carries as number;
    const g = row.gap as string;
    const teamId = row.team_id as string;
    const epa = parseFloat(row.epa_per_carry as string);
    const yards = parseFloat(row.yards_per_carry as string);
    const success = parseFloat(row.success_rate as string);
    const stuff = parseFloat(row.stuff_rate as string);
    const explosive = parseFloat(row.explosive_rate as string);

    // Per-team per-gap accumulation (for ranking)
    const tgKey = `${teamId}|${g}`;
    const tgPrev = teamGapMap.get(tgKey) || { carries: 0, epaSum: 0 };
    tgPrev.carries += carries;
    if (!isNaN(epa)) tgPrev.epaSum += carries * epa;
    teamGapMap.set(tgKey, tgPrev);

    // League-wide accumulation
    const prev = gapMap.get(g) || { totalCarries: 0, weightedEpa: 0, weightedYards: 0, weightedSuccess: 0, weightedStuff: 0, weightedExplosive: 0 };
    prev.totalCarries += carries;
    if (!isNaN(epa)) prev.weightedEpa += carries * epa;
    if (!isNaN(yards)) prev.weightedYards += carries * yards;
    if (!isNaN(success)) prev.weightedSuccess += carries * success;
    if (!isNaN(stuff)) prev.weightedStuff += carries * stuff;
    if (!isNaN(explosive)) prev.weightedExplosive += carries * explosive;
    gapMap.set(g, prev);
  }

  const averages = Array.from(gapMap.entries()).map(([gap, v]) => ({
    gap,
    avg_epa: v.totalCarries > 0 ? v.weightedEpa / v.totalCarries : 0,
    avg_yards: v.totalCarries > 0 ? v.weightedYards / v.totalCarries : 0,
    avg_success: v.totalCarries > 0 ? v.weightedSuccess / v.totalCarries : 0,
    avg_stuff: v.totalCarries > 0 ? v.weightedStuff / v.totalCarries : 0,
    avg_explosive: v.totalCarries > 0 ? v.weightedExplosive / v.totalCarries : 0,
  }));

  // Build per-team per-gap EPA list for ranking
  const teamGapEpas: TeamGapEpa[] = [];
  teamGapMap.forEach((val, key) => {
    const [team_id, gap] = key.split("|");
    if (val.carries > 0) {
      teamGapEpas.push({ team_id, gap, epa_per_carry: val.epaSum / val.carries });
    }
  });

  return { averages, teamGapEpas };
}

export async function getRBGapStatsWeekly(
  season: number,
  teamId: string,
  situation: string = "all",
  fieldZone: string = "all"
): Promise<RBGapStatWeekly[]> {
  const supabase = createServerClient();
  const { data, error } = await supabase
    .from("rb_gap_stats_weekly")
    .select("*")
    .eq("season", season)
    .eq("team_id", teamId)
    .eq("situation", situation)
    .eq("field_zone", fieldZone);

  if (error) throw new Error(`Failed to fetch weekly gap stats: ${error.message}`);
  if (!data) return [];

  return data.map((row) =>
    parseNumericFields<RBGapStatWeekly>(row as unknown as RBGapStatWeekly, RB_GAP_NUMERIC_FIELDS)
  );
}

const DEF_GAP_NUMERIC_FIELDS = [
  "def_epa_per_carry",
  "def_yards_per_carry",
  "def_success_rate",
  "def_stuff_rate",
  "def_explosive_rate",
];

export async function getDefGapStats(
  season: number,
  teamId?: string
): Promise<DefGapStat[]> {
  const filters: Record<string, unknown> = { season };
  if (teamId) filters.team_id = teamId;

  const rows = await fetchAllRows("def_gap_stats", "*", filters);

  return rows.map((row) =>
    parseNumericFields<DefGapStat>(row as unknown as DefGapStat, DEF_GAP_NUMERIC_FIELDS)
  );
}

export async function getTeamsWithGapData(
  season: number
): Promise<string[]> {
  let data: Record<string, unknown>[];
  try {
    data = await fetchAllRows("rb_gap_stats", "team_id", { season });
  } catch {
    return [];
  }
  const unique = Array.from(new Set(data.map((r) => r.team_id as string)));
  return unique.sort();
}

/**
 * Consolidated fetch: gets ALL rb_gap_stats once and derives three datasets.
 * Replaces 2-3 separate paginated fetches of the same table.
 */
export async function getAllGapData(season: number): Promise<{
  allGapStats: RBGapStat[];
  teams: string[];
  leagueAvgs: { averages: GapLeagueAvg[]; teamGapEpas: TeamGapEpa[] };
}> {
  let rawRows: Record<string, unknown>[];
  try {
    rawRows = await fetchAllRows("rb_gap_stats", "*", { season });
  } catch {
    return { allGapStats: [], teams: [], leagueAvgs: { averages: [], teamGapEpas: [] } };
  }
  if (!rawRows || rawRows.length === 0) {
    return { allGapStats: [], teams: [], leagueAvgs: { averages: [], teamGapEpas: [] } };
  }

  // 1. Derive unique team list
  const teams = Array.from(new Set(rawRows.map((r) => r.team_id as string))).sort();

  // 2. Compute league averages (same logic as getLeagueGapAverages)
  const teamGapMap = new Map<string, { carries: number; epaSum: number }>();
  const gapMap = new Map<string, { totalCarries: number; weightedEpa: number; weightedYards: number; weightedSuccess: number; weightedStuff: number; weightedExplosive: number }>();

  for (const row of rawRows) {
    const carries = row.carries as number;
    const g = row.gap as string;
    const teamId = row.team_id as string;
    const epa = parseFloat(row.epa_per_carry as string);
    const yards = parseFloat(row.yards_per_carry as string);
    const success = parseFloat(row.success_rate as string);
    const stuff = parseFloat(row.stuff_rate as string);
    const explosive = parseFloat(row.explosive_rate as string);

    const tgKey = `${teamId}|${g}`;
    const tgPrev = teamGapMap.get(tgKey) || { carries: 0, epaSum: 0 };
    tgPrev.carries += carries;
    if (!isNaN(epa)) tgPrev.epaSum += carries * epa;
    teamGapMap.set(tgKey, tgPrev);

    const prev = gapMap.get(g) || { totalCarries: 0, weightedEpa: 0, weightedYards: 0, weightedSuccess: 0, weightedStuff: 0, weightedExplosive: 0 };
    prev.totalCarries += carries;
    if (!isNaN(epa)) prev.weightedEpa += carries * epa;
    if (!isNaN(yards)) prev.weightedYards += carries * yards;
    if (!isNaN(success)) prev.weightedSuccess += carries * success;
    if (!isNaN(stuff)) prev.weightedStuff += carries * stuff;
    if (!isNaN(explosive)) prev.weightedExplosive += carries * explosive;
    gapMap.set(g, prev);
  }

  const averages = Array.from(gapMap.entries()).map(([gap, v]) => ({
    gap,
    avg_epa: v.totalCarries > 0 ? v.weightedEpa / v.totalCarries : 0,
    avg_yards: v.totalCarries > 0 ? v.weightedYards / v.totalCarries : 0,
    avg_success: v.totalCarries > 0 ? v.weightedSuccess / v.totalCarries : 0,
    avg_stuff: v.totalCarries > 0 ? v.weightedStuff / v.totalCarries : 0,
    avg_explosive: v.totalCarries > 0 ? v.weightedExplosive / v.totalCarries : 0,
  }));

  const teamGapEpas: TeamGapEpa[] = [];
  teamGapMap.forEach((val, key) => {
    const [team_id, gap] = key.split("|");
    if (val.carries > 0) {
      teamGapEpas.push({ team_id, gap, epa_per_carry: val.epaSum / val.carries });
    }
  });

  // 3. Parse numeric fields for the full RBGapStat[] result
  const allGapStats = rawRows.map((row) =>
    parseNumericFields<RBGapStat>(row as unknown as RBGapStat, RB_GAP_NUMERIC_FIELDS)
  );

  return { allGapStats, teams, leagueAvgs: { averages, teamGapEpas } };
}
