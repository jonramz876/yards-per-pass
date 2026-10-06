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
  "td_pct",
  "int_pct",
  "sack_pct",
  "scramble_pct",
  "total_epa",
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
  // maybeSingle, not single: a season with no row is `data: null, error: null`
  // (a real answer: null), so an `error` here always means the read failed.
  const { data, error } = await query.maybeSingle();

  if (error) throw new Error(`Failed to fetch data freshness: ${error.message}`);
  return (data as DataFreshness | null) ?? null;
}

/** Date-based fallback when the DB has no seasons (a read that succeeded with no rows, never a failed one): NFL season year rolls over in September (getMonth() is 0-indexed). */
export function fallbackSeason(): number {
  const now = new Date();
  return now.getMonth() >= 8 ? now.getFullYear() : now.getFullYear() - 1;
}

export async function getAvailableSeasons(): Promise<number[]> {
  const supabase = createServerClient();
  const { data, error } = await supabase
    .from("data_freshness")
    .select("season")
    .order("season", { ascending: false });

  // A failed read throws; [] means the table really has no rows (read
  // resilience spec §1.2). Callers used to guess "empty means it failed".
  if (error) throw new Error(`Failed to fetch seasons: ${error.message}`);
  // Coerced, not trusted: this is the single place a season leaves the
  // database, and every downstream gate asks Number.isInteger of it. If
  // data_freshness.season ever arrived as text (a column type change, a view
  // swap), an uncoerced value would make every one of those checks false and
  // take every box score link on the site dark — with no query fired and
  // nothing logged. getBoxScoreSeasons logs whatever still fails here.
  return (data || [])
    .map((r: { season: unknown }) => Number(r.season))
    .filter((s: number) => Number.isInteger(s) && s > 0);
}
