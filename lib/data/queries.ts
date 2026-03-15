// lib/data/queries.ts
import { createServerClient } from "@/lib/supabase/server";
import { parseNumericFields } from "@/lib/utils";
import type { TeamSeasonStat, QBSeasonStat, DataFreshness } from "@/lib/types";

const TEAM_NUMERIC_FIELDS = [
  "off_epa_play",
  "def_epa_play",
  "off_pass_epa",
  "off_rush_epa",
  "def_pass_epa",
  "def_rush_epa",
  "off_success_rate",
  "def_success_rate",
  "pass_rate",
];

const QB_NUMERIC_FIELDS = [
  "epa_per_db",
  "epa_per_play",
  "cpoe",
  "completion_pct",
  "success_rate",
  "adot",
  "ypa",
  "passer_rating",
  "any_a",
  "rush_epa_per_play",
];

export async function getTeamStats(
  season: number
): Promise<TeamSeasonStat[]> {
  const supabase = createServerClient();
  const { data, error } = await supabase
    .from("team_season_stats")
    .select("*")
    .eq("season", season);

  if (error) throw new Error(`Failed to fetch team stats: ${error.message}`);
  if (!data) return [];

  return data.map(
    (row) => parseNumericFields<TeamSeasonStat>(row as TeamSeasonStat, TEAM_NUMERIC_FIELDS)
  );
}

export async function getQBStats(
  season: number
): Promise<QBSeasonStat[]> {
  const supabase = createServerClient();
  const { data, error } = await supabase
    .from("qb_season_stats")
    .select("*")
    .eq("season", season);

  if (error) throw new Error(`Failed to fetch QB stats: ${error.message}`);
  if (!data) return [];

  return data.map(
    (row) => parseNumericFields<QBSeasonStat>(row as QBSeasonStat, QB_NUMERIC_FIELDS)
  );
}

export async function getDataFreshness(season?: number): Promise<DataFreshness | null> {
  const supabase = createServerClient();
  let query = supabase.from("data_freshness").select("*");
  if (season) {
    query = query.eq("season", season);
  } else {
    query = query.order("season", { ascending: false }).limit(1);
  }
  const { data, error } = await query.single();

  if (error) return null;
  return data as DataFreshness;
}

export async function getAvailableSeasons(): Promise<number[]> {
  const supabase = createServerClient();
  const { data, error } = await supabase
    .from("team_season_stats")
    .select("season")
    .order("season", { ascending: false });

  if (error) return [];
  return Array.from(
    new Set((data || []).map((r: { season: number }) => r.season))
  );
}
