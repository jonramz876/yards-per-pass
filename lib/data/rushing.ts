import { fetchAllRows, queryError } from "@/lib/data/utils";
import { parseNumericFields } from "@/lib/utils";
import type { RBSeasonStat } from "@/lib/types";

const RB_NUMERIC_FIELDS = [
  "yards_per_carry",
  "epa_per_carry",
  "success_rate",
  "stuff_rate",
  "explosive_rate",
  "touches_per_game",
  "total_rushing_epa",
];

export async function getRBSeasonStats(
  season: number
): Promise<RBSeasonStat[]> {
  let rows: Record<string, unknown>[];
  try {
    rows = await fetchAllRows("rb_season_stats", "*", { season });
  } catch (err) {
    // fetchAllRows rejects with the raw PostgREST object; loaders throw Errors.
    throw queryError("RB season stats", err);
  }
  return rows.map((row) =>
    parseNumericFields<RBSeasonStat>(
      row as unknown as RBSeasonStat,
      RB_NUMERIC_FIELDS
    )
  );
}
