// lib/data/run-gaps.ts
import { createServerClient } from "@/lib/supabase/server";
import { parseNumericFields } from "@/lib/utils";
import type { RBGapStat } from "@/lib/types";

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
