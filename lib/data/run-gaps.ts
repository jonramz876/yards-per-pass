// lib/data/run-gaps.ts
import { createServerClient } from "@/lib/supabase/server";
import { parseNumericFields } from "@/lib/utils";
import type { RBGapStat, RBGapStatWeekly } from "@/lib/types";

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
  const supabase = createServerClient();
  let query = supabase
    .from("rb_gap_stats")
    .select("*")
    .eq("season", season);

  if (teamId) {
    query = query.eq("team_id", teamId);
  }

  const { data, error } = await query;
  if (error) throw new Error(`Failed to fetch RB gap stats: ${error.message}`);
  if (!data) return [];

  return data.map((row) =>
    parseNumericFields<RBGapStat>(row as RBGapStat, RB_GAP_NUMERIC_FIELDS)
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
  const supabase = createServerClient();
  const { data, error } = await supabase
    .from("rb_gap_stats")
    .select("team_id, gap, carries, epa_per_carry, yards_per_carry, success_rate, stuff_rate, explosive_rate")
    .eq("season", season);

  if (error || !data) return { averages: [], teamGapEpas: [] };

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
    parseNumericFields<RBGapStatWeekly>(row as RBGapStatWeekly, RB_GAP_NUMERIC_FIELDS)
  );
}

export async function getTeamsWithGapData(
  season: number
): Promise<string[]> {
  const supabase = createServerClient();
  const { data, error } = await supabase
    .from("rb_gap_stats")
    .select("team_id")
    .eq("season", season);

  if (error) return [];
  const unique = Array.from(new Set((data || []).map((r: { team_id: string }) => r.team_id)));
  return unique.sort();
}
