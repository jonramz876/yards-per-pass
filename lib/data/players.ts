// lib/data/players.ts
import { createServerClient } from "@/lib/supabase/server";
import { parseNumericFields } from "@/lib/utils";
import { fetchAllRows } from "@/lib/data/utils";
import type {
  PlayerSlug,
  QBWeeklyStat,
  ReceiverWeeklyStat,
  RBWeeklyStat,
} from "@/lib/types";

const QB_WEEKLY_NUMERIC = [
  "epa_per_dropback",
  "cpoe",
  "success_rate",
  "adot",
  "passer_rating",
  "ypa",
];
const RECEIVER_WEEKLY_NUMERIC = [
  "epa_per_target",
  "catch_rate",
  "yac",
  "yac_per_reception",
  "adot",
  "air_yards",
  "yards_per_route_run",
];
const RB_WEEKLY_NUMERIC = [
  "epa_per_carry",
  "success_rate",
  "yards_per_carry",
  "stuff_rate",
  "explosive_rate",
];

export async function getPlayerBySlug(
  slug: string
): Promise<PlayerSlug | null> {
  const supabase = createServerClient();
  const { data, error } = await supabase
    .from("player_slugs")
    .select("*")
    .eq("slug", slug)
    .single();
  if (error || !data) return null;
  return data as PlayerSlug;
}

export async function getAllPlayerSlugs(): Promise<PlayerSlug[]> {
  // Must paginate — table has 1200+ rows, Supabase silently caps at 1000
  const rows = await fetchAllRows("player_slugs", "*", {});
  return rows as unknown as PlayerSlug[];
}

export async function getPlayerSlugsByIds(playerIds: string[]): Promise<PlayerSlug[]> {
  if (playerIds.length === 0) return [];
  const supabase = createServerClient();
  const { data, error } = await supabase
    .from("player_slugs")
    .select("*")
    .in("player_id", playerIds);
  if (error || !data) return [];
  return data as PlayerSlug[];
}

export async function getQBWeeklyStats(
  playerId: string,
  season: number
): Promise<QBWeeklyStat[]> {
  const supabase = createServerClient();
  const { data, error } = await supabase
    .from("qb_weekly_stats")
    .select("*")
    .eq("player_id", playerId)
    .eq("season", season)
    .order("week");
  if (error || !data) return [];
  return data.map((row) =>
    parseNumericFields<QBWeeklyStat>(
      row as unknown as QBWeeklyStat,
      QB_WEEKLY_NUMERIC
    )
  );
}

export async function getReceiverWeeklyStats(
  playerId: string,
  season: number
): Promise<ReceiverWeeklyStat[]> {
  const supabase = createServerClient();
  const { data, error } = await supabase
    .from("receiver_weekly_stats")
    .select("*")
    .eq("player_id", playerId)
    .eq("season", season)
    .order("week");
  if (error || !data) return [];
  return data.map((row) =>
    parseNumericFields<ReceiverWeeklyStat>(
      row as unknown as ReceiverWeeklyStat,
      RECEIVER_WEEKLY_NUMERIC
    )
  );
}

export async function getRBWeeklyStats(
  playerId: string,
  season: number
): Promise<RBWeeklyStat[]> {
  const supabase = createServerClient();
  const { data, error } = await supabase
    .from("rb_weekly_stats")
    .select("*")
    .eq("player_id", playerId)
    .eq("season", season)
    .order("week");
  if (error || !data) return [];
  return data.map((row) =>
    parseNumericFields<RBWeeklyStat>(
      row as unknown as RBWeeklyStat,
      RB_WEEKLY_NUMERIC
    )
  );
}

/** Fetch ALL RB weekly stats for a season (for percentile pool).
 *  Uses pagination to handle Supabase's 1000-row limit. */
export async function getAllRBWeeklyStats(
  season: number
): Promise<RBWeeklyStat[]> {
  const supabase = createServerClient();
  const all: RBWeeklyStat[] = [];
  const PAGE_SIZE = 1000;
  let offset = 0;
  let done = false;

  while (!done) {
    const { data, error } = await supabase
      .from("rb_weekly_stats")
      .select("*")
      .eq("season", season)
      .range(offset, offset + PAGE_SIZE - 1);
    if (error || !data || data.length === 0) {
      done = true;
      break;
    }
    for (const row of data) {
      all.push(
        parseNumericFields<RBWeeklyStat>(
          row as unknown as RBWeeklyStat,
          RB_WEEKLY_NUMERIC
        )
      );
    }
    if (data.length < PAGE_SIZE) {
      done = true;
    } else {
      offset += PAGE_SIZE;
    }
  }
  return all;
}
