// lib/data/card.ts — server-side assembly of a Tecmo card for one player/season.
//
// Lives in the data layer (not lib/stats/tecmo-card.ts) because it fetches via
// the Supabase server client. The card builders are imported by "use client"
// overview components, so keeping this fetch out of that module stops the
// server data layer from being pulled into the client module graph.
import type { PlayerSlug } from "@/lib/types";
import { getQBStats } from "@/lib/data/queries";
import { getReceiverStats } from "@/lib/data/receivers";
import { getRBSeasonStats } from "@/lib/data/rushing";
import {
  buildQBCardData,
  buildWRCardData,
  buildRBCardData,
} from "@/lib/stats/tecmo-card";
import type { TecmoCardData } from "@/lib/stats/tecmo-card";

/**
 * Assemble the card for one player/season. Shared by the card page, the OG
 * image and the download route so the position branching lives in one place.
 *
 * Returns null when the position isn't supported or the player has no stat row
 * for that season; callers decide what that means (page → notFound(), routes →
 * 404). Query errors are NOT swallowed here — they propagate to the caller.
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
