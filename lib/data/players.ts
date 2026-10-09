// lib/data/players.ts
import { createServerClient } from "@/lib/supabase/server";
import { parseNumericFields } from "@/lib/utils";
import { fetchAllRows, queryError } from "@/lib/data/utils";
import type {
  PlayerSlug,
  QBWeeklyStat,
  ReceiverWeeklyStat,
  RBWeeklyStat,
  CrossLinkReceiver,
  CrossLinkQB,
  QBPassLocationStat,
} from "@/lib/types";

// Exported for lib/data/box-score.ts, which reads the same three tables by game.
export const QB_WEEKLY_NUMERIC = [
  "epa_per_dropback",
  "cpoe",
  "success_rate",
  "adot",
  "passer_rating",
  "ypa",
  "rush_epa_per_carry",
  "rush_success_rate",
];
export const RECEIVER_WEEKLY_NUMERIC = [
  "epa_per_target",
  "catch_rate",
  "yac",
  "yac_per_reception",
  "adot",
  "air_yards",
  "yards_per_route_run",
];
export const RB_WEEKLY_NUMERIC = [
  "epa_per_carry",
  "success_rate",
  "yards_per_carry",
  "stuff_rate",
  "explosive_rate",
];

// Every loader in this file follows the read resilience rule (spec §1.2): a
// query error throws an Error, and empty ([] / null) comes back only when the
// read succeeded with no rows. Callers decide what a throw means.

/**
 * The shape a player slug can have. scripts/ingest.py make_slug emits only
 * a-z, 0-9 and single hyphens (collision suffixes add a team code, a position
 * or a player id: same characters), and the longest real slug is far under 100
 * characters. Deliberately generous (capitals, apostrophes, dots, underscores)
 * so nothing real is ever refused here; the database still decides whether the
 * slug exists. Its job is only to stop input the database would reject.
 */
const PLAUSIBLE_SLUG = /^[A-Za-z0-9._'-]{1,100}$/;

/**
 * The player row for a slug, or null when no player has it. Throws on a query
 * error: a failed read must never look like an unknown player (a 404).
 */
export async function getPlayerBySlug(
  slug: string
): Promise<PlayerSlug | null> {
  // A slug no player can have is "no such player" without asking: Postgres
  // and the gateway refuse some of them outright (a NUL byte is a 400, an
  // absurd length a 414), and that refusal would otherwise come back as a
  // query error and read as "database down" instead of a 404.
  if (!PLAUSIBLE_SLUG.test(slug)) return null;
  const supabase = createServerClient();
  // maybeSingle, not single: no row is `data: null, error: null`, so an
  // `error` here always means the read failed.
  const { data, error } = await supabase
    .from("player_slugs")
    .select("*")
    .eq("slug", slug)
    .maybeSingle();
  if (error) throw queryError(`player ${slug}`, error);
  if (!data) return null;
  return data as PlayerSlug;
}

export async function getAllPlayerSlugs(): Promise<PlayerSlug[]> {
  // Must paginate — table has 1200+ rows, Supabase silently caps at 1000
  let rows: Record<string, unknown>[];
  try {
    rows = await fetchAllRows("player_slugs", "*", {});
  } catch (err) {
    throw queryError("player slugs", err);
  }
  return rows as unknown as PlayerSlug[];
}

export async function getPlayerSlugsByIds(playerIds: string[]): Promise<PlayerSlug[]> {
  if (playerIds.length === 0) return [];
  const supabase = createServerClient();
  const { data, error } = await supabase
    .from("player_slugs")
    .select("*")
    .in("player_id", playerIds);
  if (error) throw queryError("player slugs", error);
  if (!data) return [];
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
  if (error) throw queryError("QB weekly stats", error);
  if (!data) return [];
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
  if (error) throw queryError("receiver weekly stats", error);
  if (!data) return [];
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
  if (error) throw queryError("RB weekly stats", error);
  if (!data) return [];
  return data.map((row) =>
    parseNumericFields<RBWeeklyStat>(
      row as unknown as RBWeeklyStat,
      RB_WEEKLY_NUMERIC
    )
  );
}

/** Fetch top receivers on a team for a given season (for the QB page's "Team's Top Receivers" box: season totals from every QB). */
export async function getTeamTopReceivers(
  teamId: string,
  season: number,
  limit: number = 5
): Promise<CrossLinkReceiver[]> {
  const supabase = createServerClient();
  const { data, error } = await supabase
    .from("receiver_season_stats")
    .select("player_id, player_name, targets, receptions, receiving_yards, receiving_tds")
    .eq("team_id", teamId)
    .eq("season", season)
    .order("targets", { ascending: false })
    .limit(limit);
  if (error) throw queryError("team top receivers", error);
  if (!data) return [];

  // Fetch slugs for linking
  const playerIds = data.map((r) => r.player_id);
  const slugs = await getPlayerSlugsByIds(playerIds);
  const slugMap = Object.fromEntries(slugs.map((s) => [s.player_id, s.slug]));

  return data.map((r) => ({
    player_id: r.player_id,
    player_name: r.player_name,
    slug: slugMap[r.player_id] || null,
    targets: r.targets ?? 0,
    receptions: r.receptions ?? 0,
    receiving_yards: r.receiving_yards ?? 0,
    receiving_tds: r.receiving_tds ?? 0,
  }));
}

/** Fetch the starting QB on a team for a given season (for the WR/TE page's "Team QB" box: his season passing line, every team). */
export async function getTeamStartingQB(
  teamId: string,
  season: number
): Promise<CrossLinkQB | null> {
  const supabase = createServerClient();
  const { data, error } = await supabase
    .from("qb_season_stats")
    .select("player_id, player_name, dropbacks, passing_yards, touchdowns")
    .eq("team_id", teamId)
    .eq("season", season)
    .order("dropbacks", { ascending: false })
    .limit(1);
  if (error) throw queryError("team starting QB", error);
  if (!data || data.length === 0) return null;

  const row = data[0];
  const slugs = await getPlayerSlugsByIds([row.player_id]);
  const slug = slugs[0]?.slug || null;

  return {
    player_id: row.player_id,
    player_name: row.player_name,
    slug,
    dropbacks: row.dropbacks ?? 0,
    passing_yards: row.passing_yards ?? 0,
    touchdowns: row.touchdowns ?? 0,
  };
}

const QB_PASS_LOC_NUMERIC = [
  "passing_yards",
  "epa_sum",
  "epa_per_attempt",
  "completion_pct",
  "yards_per_attempt",
  "adot",
  "cpoe",
  "passer_rating",
];

export async function getQBPassLocationStats(
  playerId: string,
  season: number
): Promise<QBPassLocationStat[]> {
  const supabase = createServerClient();
  const { data, error } = await supabase
    .from("qb_pass_location_stats")
    .select("*")
    .eq("player_id", playerId)
    .eq("season", season);
  if (error) throw queryError("QB pass location stats", error);
  if (!data) return [];
  return data.map((row) =>
    parseNumericFields<QBPassLocationStat>(
      row as unknown as QBPassLocationStat,
      QB_PASS_LOC_NUMERIC
    )
  );
}

/** What the comparison image needs to know about a player: who he is, his position and his team. */
export interface PlayerSlugEntry {
  slug: string;
  player_id: string;
  player_name: string;
  position: string;
  current_team_id: string;
}

/** The columns getPlayerSlugIndex reads: narrow on purpose (about 1,300 rows). */
export const PLAYER_SLUG_INDEX_COLUMNS = "slug, player_id, player_name, position, current_team_id";

/**
 * Every player slug, as a Map by slug (compare card spec 2026-10-09 section
 * 6.1): the comparison image route looks both players up here, behind a
 * one-minute memo, so it makes no per-pair database read at all.
 *
 * Read in slug order: the table is over 1,000 rows, so it is paged, and
 * unordered pages can skip or repeat a row; a skipped row here would be a real
 * player answered "not found". Throws on a failed read.
 */
export async function getPlayerSlugIndex(): Promise<Map<string, PlayerSlugEntry>> {
  let rows: Record<string, unknown>[];
  try {
    rows = await fetchAllRows("player_slugs", PLAYER_SLUG_INDEX_COLUMNS, {}, { order: ["slug"] });
  } catch (err) {
    throw queryError("player slug index", err);
  }
  const index = new Map<string, PlayerSlugEntry>();
  for (const row of rows) {
    if (typeof row.slug === "string" && row.slug) index.set(row.slug, row as unknown as PlayerSlugEntry);
  }
  return index;
}
