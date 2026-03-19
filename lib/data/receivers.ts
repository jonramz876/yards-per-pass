import { createServerClient } from "@/lib/supabase/server";
import { parseNumericFields } from "@/lib/utils";
import type { ReceiverSeasonStat } from "@/lib/types";

const RECEIVER_NUMERIC_FIELDS = [
  "catch_rate",
  "yards_per_target",
  "yards_per_reception",
  "epa_per_target",
  "yac",
  "yac_per_reception",
  "air_yards",
  "air_yards_per_target",
  "target_share",
  "yards_per_route_run",
  "targets_per_route_run",
];

export async function getReceiverStats(
  season: number,
  position?: string
): Promise<ReceiverSeasonStat[]> {
  const supabase = createServerClient();
  let query = supabase
    .from("receiver_season_stats")
    .select("*")
    .eq("season", season);

  if (position) {
    query = query.eq("position", position);
  }

  const { data, error } = await query;
  if (error) throw new Error(`Failed to fetch receiver stats: ${error.message}`);
  if (!data) return [];

  return data.map((row) =>
    parseNumericFields<ReceiverSeasonStat>(
      row as unknown as ReceiverSeasonStat,
      RECEIVER_NUMERIC_FIELDS
    )
  );
}
