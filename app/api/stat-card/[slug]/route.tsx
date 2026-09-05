// app/api/stat-card/[slug]/route.tsx — downloadable PNG of the Tecmo card.
// Unlike the OG image (file convention, latest season only) this route honors
// ?season= so the Download button matches whatever season the page is showing.
import { ImageResponse } from "next/og";
import { getPlayerBySlug } from "@/lib/data/players";
import { getTeam } from "@/lib/data/teams";
import { getAvailableSeasons, fallbackSeason } from "@/lib/data/queries";
import { getCardDataForPlayer } from "@/lib/data/card";
import {
  loadHeadshotDataUri,
  pixelFontOptions,
  tecmoCardImage,
} from "@/lib/og/tecmo-card-image";

export const runtime = "nodejs";

const SIZE = { width: 1200, height: 630 };

/** Strip anything that isn't safe in a filename / header value. */
function safeName(slug: string): string {
  return slug.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 80) || "stat";
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  const seasonParam = new URL(req.url).searchParams.get("season");
  const parsed = seasonParam ? parseInt(seasonParam, 10) : NaN;

  let season: number;
  if (!Number.isNaN(parsed)) {
    season = parsed;
  } else {
    try {
      season = (await getAvailableSeasons())[0] ?? fallbackSeason();
    } catch {
      season = fallbackSeason();
    }
  }

  const player = await getPlayerBySlug(slug);
  if (!player) return new Response("Not found", { status: 404 });

  const card = await getCardDataForPlayer(player, season);
  if (!card) return new Response("Not found", { status: 404 });

  const team = getTeam(player.current_team_id);
  const headshot = await loadHeadshotDataUri(player.headshot_url);

  // ImageResponse IS a Response; its options take a plain `headers` object that
  // is spread AFTER the defaults, so these win without re-wrapping the stream.
  // The Cache-Control override matters: the default is `immutable, max-age=1yr`,
  // which would freeze a downloaded card at whatever mid-season stats it had.
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
    {
      ...SIZE,
      fonts: await pixelFontOptions(),
      headers: {
        // Sanitized: a raw slug in a header value is a header-injection vector.
        "Content-Disposition": `attachment; filename="${safeName(slug)}-${season}-card.png"`,
        "Cache-Control": "public, max-age=0, s-maxage=3600",
      },
    },
  );
}
