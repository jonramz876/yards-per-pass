// app/card/[slug]/opengraph-image.tsx — social share image: the Tecmo card.
// File convention, so no searchParams: this is always the latest season. A real player with no card in it gets the pixel name plate.
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
  if (!player) return fallback(); // unknown slug: brand plate, unchanged

  // Real player but no card this season — K/P, or no stat row yet (week 1
  // before his team plays). Same name plate the player OG uses; the player row
  // is already in hand, so the anonymous brand plate would waste it.
  const found = player; // const copy keeps TS narrowing inside the closure
  const team = getTeam(found.current_team_id);
  const plate = () => new ImageResponse(namePlateImage(found, team), { ...size, fonts });

  let card = null;
  try {
    card = await getCardDataForPlayer(found, season);
  } catch {
    return plate();
  }
  if (!card) return plate();

  const headshot = await loadHeadshotDataUri(found.headshot_url);

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
