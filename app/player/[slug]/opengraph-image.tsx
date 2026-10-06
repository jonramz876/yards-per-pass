// app/player/[slug]/opengraph-image.tsx — social share image for the player
// page: the same Tecmo card the /card page embeds (spec 3a).
//
// File convention, so no searchParams: this is always the latest season.
// Satori rules apply to everything rendered here — inline styles only, and
// every element with children needs an explicit `display: flex`.
import { ImageResponse } from "next/og";
import { getPlayerBySlug } from "@/lib/data/players";
import { getTeam } from "@/lib/data/teams";
import { getAvailableSeasons, fallbackSeason } from "@/lib/data/queries";
import { getCardDataForPlayer } from "@/lib/data/card";
import {
  loadHeadshotDataUri,
  pixelFontOptions,
  tecmoCardImage,
  brandedFallbackImage,
  namePlateImage,
} from "@/lib/og/tecmo-card-image";
import type { PlayerSlug } from "@/lib/types";

export const runtime = "nodejs";
export const alt = "Player Stats — Yards Per Pass";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const NAVY = "#0f172a";

export default async function Image({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const fonts = await pixelFontOptions();

  // A failed read must never break the embed, so each one below falls back to
  // something drawable. But an image built after a failed read is not this
  // player's real share image (a brand plate for a real player, a name plate
  // for a player who has a card, or a card for a guessed season), so it is
  // sent `no-store`: nothing in between may keep it (read resilience spec
  // §1.2). An image built with no failed read gets the options it always had.
  let readFailed = false;
  const options = () =>
    readFailed ? { ...size, fonts, headers: { "Cache-Control": "no-store" } } : { ...size, fonts };

  // A DB hiccup must never break the embed — fall back to the current season.
  let season: number;
  try {
    season = (await getAvailableSeasons())[0] ?? fallbackSeason();
  } catch {
    readFailed = true;
    season = fallbackSeason();
  }

  const branded = () => new ImageResponse(brandedFallbackImage(), options());

  // Unknown slug (or a failed lookup) — nothing to draw but the brand.
  let found: PlayerSlug | null = null;
  try {
    found = await getPlayerBySlug(slug);
  } catch {
    readFailed = true;
    return branded();
  }
  if (!found) return branded();

  const player = found;
  const team = getTeam(player.current_team_id);
  const plate = () => new ImageResponse(namePlateImage(player, team), options());

  // Card if we can build one; otherwise the plate — the player row is already
  // in hand, so a branded fallback would waste it.
  let card: Awaited<ReturnType<typeof getCardDataForPlayer>>;
  try {
    card = await getCardDataForPlayer(player, season);
  } catch {
    readFailed = true;
    return plate();
  }
  if (!card) return plate();

  try {
    return new ImageResponse(
      tecmoCardImage(
        card,
        {
          name: team?.name || player.current_team_id,
          primaryColor: team?.primaryColor || NAVY,
          secondaryColor: team?.secondaryColor || "#334155",
        },
        await loadHeadshotDataUri(player.headshot_url),
        player.jersey_number ?? null,
      ),
      options(),
    );
  } catch {
    // Building the card image itself failed (not a database read): the plate,
    // as before.
    return plate();
  }
}
