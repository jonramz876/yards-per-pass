// lib/data/players.ts
import { createServerClient } from "@/lib/supabase/server";
import { parseNumericFields } from "@/lib/utils";
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
  const supabase = createServerClient();
  const { data, error } = await supabase
    .from("player_slugs")
    .select("*")
    .order("player_name");
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
