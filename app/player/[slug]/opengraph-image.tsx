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

  // A DB hiccup must never break the embed — fall back to the current season.
  let season: number;
  try {
    season = (await getAvailableSeasons())[0] ?? fallbackSeason();
  } catch {
    season = fallbackSeason();
  }

  const branded = () => new ImageResponse(brandedFallbackImage(), { ...size, fonts });

  // Unknown slug (or a failed lookup) — nothing to draw but the brand.
  let found: PlayerSlug | null = null;
  try {
    found = await getPlayerBySlug(slug);
  } catch {
    return branded();
  }
  if (!found) return branded();

  const player = found;
  const team = getTeam(player.current_team_id);
  const plate = () => new ImageResponse(namePlateImage(player, team), { ...size, fonts });

  // Card if we can build one; otherwise the plate — the player row is already
  // in hand, so a branded fallback would waste it.
  try {
    const card = await getCardDataForPlayer(player, season);
    if (!card) return plate();

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
      { ...size, fonts },
    );
  } catch {
    return plate();
  }
}
