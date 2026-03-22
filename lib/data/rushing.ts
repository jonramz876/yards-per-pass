import { fetchAllRows } from "@/lib/data/utils";
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
  const rows = await fetchAllRows("rb_season_stats", "*", { season });
  return rows.map((row) =>
    parseNumericFields<RBSeasonStat>(
      row as unknown as RBSeasonStat,
      RB_NUMERIC_FIELDS
    )
  );
}
