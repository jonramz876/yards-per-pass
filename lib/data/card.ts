// lib/data/card.ts — server-side assembly of a Tecmo card for one player/season.
//
// Lives in the data layer (not lib/stats/tecmo-card.ts) because it fetches via
// the Supabase server client. The card builders are imported by "use client"
// overview components, so keeping this fetch out of that module stops the
// server data layer from being pulled into the client module graph.
import type { PlayerSlug } from "@/lib/types";
import { createServerClient } from "@/lib/supabase/server";
import { getQBStats } from "@/lib/data/queries";
import { getReceiverStats } from "@/lib/data/receivers";
import { getRBSeasonStats } from "@/lib/data/rushing";
import {
  buildQBCardData,
  buildWRCardData,
  buildRBCardData,
  isCardPosition,
} from "@/lib/stats/tecmo-card";
import type { TecmoCardData } from "@/lib/stats/tecmo-card";

/**
 * Assemble the card for one player/season. Shared by the card page, the OG
 * image and the download route so the position branching lives in one place.
 *
 * Returns null when the position isn't supported or the player has no stat row
 * for that season; callers decide what that means (card page → "no card"
 * message, OG images → name plate, download route → 404). Query errors are NOT
 * swallowed here — they propagate to the caller.
 */
export async function getCardDataForPlayer(
  player: PlayerSlug,
  season: number,
): Promise<TecmoCardData | null> {
  // FBs are carried in the RB stat tables.
  const pos = player.position === "FB" ? "RB" : player.position;

  if (pos === "QB") {
    const all = await getQBStats(season);
    const me = all.find((q) => q.player_id === player.player_id);
    return me ? buildQBCardData(me, all, season) : null;
  }
  if (pos === "WR" || pos === "TE") {
    const all = await getReceiverStats(season);
    const me = all.find((r) => r.player_id === player.player_id);
    return me ? buildWRCardData(me, all, season) : null;
  }
  if (pos === "RB") {
    const all = await getRBSeasonStats(season);
    const me = all.find((r) => r.player_id === player.player_id);
    return me ? buildRBCardData(me, all, season) : null;
  }
  return null;
}

/** Season-stat table behind each card position (FBs live in the RB table). */
const CARD_STAT_TABLE: Record<string, string> = {
  QB: "qb_season_stats",
  WR: "receiver_season_stats",
  TE: "receiver_season_stats",
  RB: "rb_season_stats",
  FB: "rb_season_stats",
};

/**
 * Newest season this player has a card for (a row in his position's season
 * table), or null: non-card positions (K/P/...), no rows at all, or a failed
 * lookup. The /card "no card" message uses it to link to a real card. It never
 * changes which season a page shows (no silent fallback).
 */
export async function getLatestCardSeason(player: PlayerSlug): Promise<number | null> {
  if (!isCardPosition(player.position)) return null;
  const table = CARD_STAT_TABLE[player.position];
  try {
    const supabase = createServerClient();
    const { data, error } = await supabase
      .from(table)
      .select("season")
      .eq("player_id", player.player_id)
      .order("season", { ascending: false })
      .limit(1);
    if (error || !data || data.length === 0) return null;
    const season = Number((data[0] as { season: unknown }).season);
    return Number.isInteger(season) && season > 0 ? season : null;
  } catch {
    return null;
  }
}
