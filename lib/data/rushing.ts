import { createServerClient } from "@/lib/supabase/server";
import { parseNumericFields } from "@/lib/utils";
import type { RBSeasonStat } from "@/lib/types";

const RB_NUMERIC_FIELDS = [
  "yards_per_carry",
  "epa_per_carry",
  "success_rate",
  "stuff_rate",
  "explosive_rate",
];

export async function getRBSeasonStats(
  season: number
): Promise<RBSeasonStat[]> {
  const supabase = createServerClient();
  const { data, error } = await supabase
    .from("rb_season_stats")
    .select("*")
    .eq("season", season);

  if (error) throw new Error(`Failed to fetch RB season stats: ${error.message}`);
  if (!data) return [];

  return data.map((row) =>
    parseNumericFields<RBSeasonStat>(
      row as unknown as RBSeasonStat,
      RB_NUMERIC_FIELDS
    )
  );
}
