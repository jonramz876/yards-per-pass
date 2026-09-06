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
import { textColorForBackground } from "@/lib/stats/formatters";
import {
  loadHeadshotDataUri,
  pixelFontOptions,
  tecmoCardImage,
  brandedFallbackImage,
} from "@/lib/og/tecmo-card-image";
import type { PlayerSlug, Team } from "@/lib/types";

export const runtime = "nodejs";
export const alt = "Player Stats — Yards Per Pass";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/**
 * Family name registered by pixelFontOptions(). When that returns undefined
 * (bundled TTF unreadable) next/og falls back to its built-in font — the
 * unknown family is harmless and no font is ever fetched at runtime.
 */
const PIXEL = "PressStart";
const NAVY = "#0f172a";

/** Long names in a monospace pixel font need a smaller size to stay on one line. */
function nameFontSize(len: number): number {
  if (len <= 12) return 52;
  if (len <= 18) return 40;
  if (len <= 24) return 30;
  return 24;
}

/**
 * Fallback picture for a real player with no card — kickers, punters, or
 * anyone without a stat row this season. Team-colored plate with the name,
 * position · team and the site footer.
 */
function namePlateImage(player: PlayerSlug, team: Team | undefined): JSX.Element {
  const bg = team?.primaryColor || NAVY;
  const text = textColorForBackground(bg);
  const name = (player.player_name || "PLAYER").toUpperCase();
  const capped = name.length > 28 ? `${name.slice(0, 27)}…` : name;
  // Team omitted when the id doesn't match a known team.
  const subline = [player.position?.toUpperCase(), team?.name?.toUpperCase()]
    .filter(Boolean)
    .join(" · ");

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: bg,
        fontFamily: PIXEL,
        color: text,
        padding: "0 60px",
      }}
    >
      <div style={{ display: "flex", fontSize: 16, opacity: 0.7 }}>YARDS PER PASS</div>
      <div
        style={{
          display: "flex",
          fontSize: nameFontSize(capped.length),
          marginTop: 34,
          textAlign: "center",
        }}
      >
        {capped}
      </div>
      {subline ? (
        <div style={{ display: "flex", fontSize: 20, marginTop: 30, opacity: 0.85 }}>
          {subline}
        </div>
      ) : null}
      <div style={{ display: "flex", fontSize: 14, marginTop: 44, opacity: 0.6 }}>
        YARDSPERPASS.COM
      </div>
    </div>
  );
}

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
