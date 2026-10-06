// app/api/team-radar/[team_id]/[side]/route.tsx — the 1200×630 PNG of one
// team radar share card (team radar spec 2026-10-06 §7, PR 3). It is the
// share page's link-preview image (the page names this URL, season included,
// in og:image and twitter:image) and, with &download=1, the Download button's
// file.
//
// In order: (1) the team and the side are checked against fixed lists and
// (2) an implausible ?season= is rejected, both before any database read;
// (3) the season is resolved exactly as the share page resolves it, and one
// the site does not have is a 404 with no row read and nothing rendered;
// (4) the card's state comes from the same loader as the page (coverage
// decided before the season-wide read, which is memoised for a minute).
//
// A failed read is a 503 the browser can retry, never stored: never a 404
// (which says the card does not exist) and never a picture drawn from nothing.
import { ImageResponse } from "next/og";
import { getTeam } from "@/lib/data/teams";
import { getAvailableSeasons, fallbackSeason } from "@/lib/data/queries";
import { loadTeamRadarCard } from "@/lib/data/team-radar-card";
import { hasNoDatabase } from "@/lib/supabase/server";
import { radarImageFonts, teamRadarCardImage, teamRadarPlateImage } from "@/lib/og/team-radar-image";
import {
  RADAR_IMAGE_UNAVAILABLE,
  parseRadarSide,
  radarDownloadFilename,
  radarSideSlug,
  radarStateMessage,
  resolveRadarCardSeason,
  type TeamRadarSlice,
} from "@/lib/stats/team-radar";

// The fonts are read with fs.
export const runtime = "nodejs";
// A route handler that reads Supabase needs an explicit revalidate: without
// one its reads can be pinned in Next's data cache for a year.
export const revalidate = 0;

const SIZE = { width: 1200, height: 630 };

// Header keys are LOWERCASE on purpose. next/og's ImageResponse spreads the
// caller's headers over its own lowercase one-year `cache-control` default, so
// only a lowercase key replaces it; "Cache-Control" would send both, joined.
/** A drawn image: the CDN may keep it for an hour; browsers always ask again. */
const IMAGE_CACHE = "public, max-age=0, s-maxage=3600";

function notFound(): Response {
  return new Response("Not found", {
    status: 404,
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
  });
}

function unavailable(): Response {
  return new Response(RADAR_IMAGE_UNAVAILABLE, {
    status: 503,
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store", "retry-after": "60" },
  });
}

export async function GET(req: Request, { params }: { params: Promise<{ team_id: string; side: string }> }) {
  const { team_id, side: sideParam } = await params;
  const side = parseRadarSide(sideParam);
  // Upper-cased like the share page and the team hub.
  const team = typeof team_id === "string" ? getTeam(team_id.toUpperCase()) : undefined;
  if (!side || !team) return notFound();

  const query = new URL(req.url).searchParams;
  const seasonParam = query.get("season") ?? undefined;
  // With no seasons list the only invalid answer is a number no season can be
  // (outside 1999-2100): rejected here, before the first read.
  if (resolveRadarCardSeason(seasonParam, [], 0).invalid) return notFound();

  let season: number;
  let slice: TeamRadarSlice;
  try {
    const seasons = await getAvailableSeasons();
    if (seasons.length === 0 && !hasNoDatabase()) {
      throw new Error("no seasons from data_freshness (table empty)");
    }
    const resolved = resolveRadarCardSeason(seasonParam, seasons, fallbackSeason());
    if (resolved.invalid) return notFound();
    season = resolved.season;
    slice = await loadTeamRadarCard(team.id, season, seasons);
    if (slice.state === "unavailable") {
      throw new Error(`the read returned no rows for ${season}, a season that has them`);
    }
  } catch (err) {
    console.error(`Team radar image: data unavailable for ${team.id} ${radarSideSlug(side)}`, err);
    return unavailable();
  }

  const fonts = await radarImageFonts();

  if (slice.state !== "ready") {
    // No radar to draw for this team and season: a plate that says why, in
    // the page's own sentence. Never an attachment (the page has no Download
    // button in these states).
    return new ImageResponse(teamRadarPlateImage({ team, side, season, message: radarStateMessage(slice, team.name) }), {
      ...SIZE,
      fonts,
      headers: { "cache-control": IMAGE_CACHE },
    });
  }

  const download = query.get("download") === "1";
  return new ImageResponse(teamRadarCardImage({ team, side, slice }), {
    ...SIZE,
    fonts,
    headers: {
      "cache-control": IMAGE_CACHE,
      // Built from the validated team id and side only: nothing typed into the
      // URL reaches this header value.
      ...(download ? { "content-disposition": `attachment; filename="${radarDownloadFilename(team.id, side, season)}"` } : {}),
    },
  });
}
