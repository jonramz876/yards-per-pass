// app/card/[slug]/opengraph-image.tsx — social share image: the Tecmo card.
// File convention, so no searchParams: this is always the latest season.
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
} from "@/lib/og/tecmo-card-image";

export const runtime = "nodejs";
export const alt = "Player Stat Card — Yards Per Pass";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

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

  const fallback = () => new ImageResponse(brandedFallbackImage(), { ...size, fonts });

  let player = null;
  try {
    player = await getPlayerBySlug(slug);
  } catch {
    return fallback();
  }
  if (!player) return fallback();

  let card = null;
  try {
    card = await getCardDataForPlayer(player, season);
  } catch {
    return fallback();
  }
  if (!card) return fallback();

  const team = getTeam(player.current_team_id);
  const headshot = await loadHeadshotDataUri(player.headshot_url);

  return new ImageResponse(
    tecmoCardImage(
      card,
      {
        name: team?.name || player.current_team_id,
        primaryColor: team?.primaryColor || "#0f172a",
        secondaryColor: team?.secondaryColor || "#334155",
      },
      headshot,
      player.jersey_number ?? null,
    ),
    { ...size, fonts },
  );
}
