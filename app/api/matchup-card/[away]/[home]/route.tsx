// app/api/matchup-card/[away]/[home]/route.tsx — the 1200×630 PNG of one
// game's matchup card (matchup card spec 2026-10-11 §4.2, PR 2). It is the
// share page's and the matchup page's link-preview image (both name this URL,
// season and week included, in og:image and twitter:image) and, with
// &download=1, the Download button's file. Away first, as on /matchup.
//
// In the spec's order: (1) each segment must be EXACTLY an upper-case team id
// (nothing but the site prints image URLs, and it prints upper case: a
// redirect on an image would be a second stored object per card), (2) the two
// teams must differ, and (3) the query string must be the one spelling the
// page prints, all before any read: junk gets a 404 the CDN keeps for an hour
// instead of a render. (4) The season list, (5) a named season must be in it:
// the image never draws the newest season under a URL that names another (it
// would be stored for an hour under the wrong name; the PAGE shows the newest
// season there, the image must not). (6) loadMatchup, the matchup page's own
// loader: every read through memos keyed by season only, none per pair.
// (7) Games that could not be read are a 503, never a stored "VS" card for a
// scheduled game. (8) A pair scheduled the other way round is a 404 (the page
// redirects; a preview fetcher has followed that and read the right og:image).
//
// A failed read is a 503 the browser can retry, never stored: never a 404
// (which says the card does not exist) and never a picture drawn from nothing.
import { ImageResponse } from "next/og";
import { getSeasonWeeksCached } from "@/lib/data/compare-card";
import { loadMatchup, type MatchupLoad } from "@/lib/data/matchup";
import { getTeam } from "@/lib/data/teams";
import { matchupCardImage, matchupPlateImage } from "@/lib/og/matchup-card-image";
import { radarImageFonts } from "@/lib/og/team-radar-image";
import {
  MATCHUP_CARD_IMAGE_UNAVAILABLE,
  buildMatchupCard,
  matchupCardDownloadFilename,
  parseMatchupImageQuery,
  rawQueryOf,
} from "@/lib/stats/matchup-card";
import { parseMatchupTeamId } from "@/lib/stats/matchup-links";
import type { Team } from "@/lib/types";

// The fonts are read with fs.
export const runtime = "nodejs";
// A route handler that reads Supabase needs an explicit revalidate: without
// one its reads can be pinned in Next's data cache for a year.
export const revalidate = 0;

const SIZE = { width: 1200, height: 630 };

// Header keys are LOWERCASE on purpose. next/og's ImageResponse spreads the
// caller's headers over its own lowercase one-year `cache-control` default, so
// only a lowercase key replaces it; "Cache-Control" would send both, joined.
/** A drawn image, or a URL that can never be one: the CDN may keep it for an hour; browsers always ask again. */
const STORED = "public, max-age=0, s-maxage=3600";

/**
 * 404. `stored`: a URL that can never be a card (a segment that is not an
 * upper-case team id, the same team twice, a query outside the one spelling)
 * is kept by the CDN for an hour, so repeating it costs nothing. A season the
 * site does not list, or a pair scheduled the other way round, is not stored:
 * either answer depends on data that changes.
 */
function notFound(stored: boolean): Response {
  return new Response("Not found", {
    status: 404,
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": stored ? STORED : "no-store" },
  });
}

function unavailable(): Response {
  return new Response(MATCHUP_CARD_IMAGE_UNAVAILABLE, {
    status: 503,
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store", "retry-after": "60" },
  });
}

/** The team a segment names, only when the segment is already that team's upper-case id. */
function teamOf(segment: unknown): Team | null {
  if (typeof segment !== "string") return null;
  const id = parseMatchupTeamId(segment);
  if (id === null || id !== segment) return null;
  return getTeam(id) ?? null;
}

/**
 * The request's path exactly as it was sent: no query, no fragment, nothing
 * decoded. "" for a URL that cannot be read.
 */
function rawPathOf(url: unknown): string {
  if (typeof url !== "string") return "";
  const end = url.search(/[?#]/);
  return end === -1 ? url : url.slice(0, end);
}

export async function GET(req: Request, { params }: { params: Promise<{ away: string; home: string }> }) {
  const raw = await params;
  const away = teamOf(raw?.away);
  const home = teamOf(raw?.home);
  if (!away || !home || away.id === home.id) return notFound(true);

  // Next decodes a path segment before it reaches `params`, so `%42UF` arrives
  // as "BUF" (PR 2 chaos F1): dozens of spellings per card, each its own CDN
  // entry and its own render. The RAW path must end in the one canonical
  // spelling; anything else (an encoded letter, a doubled or trailing slash)
  // is the stored 404, with no read.
  if (!rawPathOf(req?.url).endsWith(`/api/matchup-card/${away.id}/${home.id}`)) return notFound(true);

  const query = parseMatchupImageQuery(rawQueryOf(req.url));
  if (!query) return notFound(true);

  const what = `Matchup card image (${away.id} at ${home.id})`;

  // The season list first: a named season is checked against it before the
  // pair is loaded, because the loader shows the newest season for one it does
  // not list. Memoised, shared with the loader: never a read of its own.
  let listed: number[];
  try {
    const weeks: unknown = await getSeasonWeeksCached();
    listed = Array.isArray(weeks)
      ? weeks.flatMap((w) => (w !== null && typeof w === "object" && typeof (w as { season?: unknown }).season === "number" ? [(w as { season: number }).season] : []))
      : [];
  } catch (err) {
    console.error(`${what}: the season list could not be read`, err);
    return unavailable();
  }
  if (listed.length === 0) {
    // An empty list is a read failing silently (or no database at all): nothing can be drawn from it.
    console.error(`${what}: the season list came back empty`);
    return unavailable();
  }
  if (query.season !== null && !listed.includes(query.season)) return notFound(false);

  let load: MatchupLoad;
  try {
    load = await loadMatchup(away.id, home.id, query.season);
  } catch (err) {
    console.error(`${what}: data unavailable`, err);
    return unavailable();
  }
  // Without the schedule the card would say "VS" for a game that may be
  // scheduled, for an hour. Not logged here: the loader has already logged the
  // failed games read for this request, once.
  if (!load.gamesAvailable) return unavailable();
  if (load.swap) return notFound(false);

  const model = buildMatchupCard({ away, home, load });
  // The second lock: an "unavailable" plate (no model, or a model that is not
  // this pair's) is an error, not a state of the season. Retryable, never
  // stored, never drawn. The other plates (uncovered, small-pool, no radar
  // drawable) are real answers and are kept. The reason decides, never the sentence.
  if (model.kind === "plate" && model.reason === "unavailable") {
    console.error(`${what}: the card model is unavailable for this pair, so no image is drawn`);
    return unavailable();
  }
  const fonts = await radarImageFonts(undefined, "Matchup card image");

  if (model.kind === "plate") {
    // Nothing to rank for this pair and season: a plate that says so in the
    // page's own sentence. Never an attachment (the page has no Download
    // button in these states).
    return new ImageResponse(matchupPlateImage(model), { ...SIZE, fonts, headers: { "cache-control": STORED } });
  }

  return new ImageResponse(matchupCardImage(model), {
    ...SIZE,
    fonts,
    headers: {
      "cache-control": STORED,
      // Built from the two validated ids and the resolved season only:
      // nothing else typed into the URL reaches this header value.
      ...(query.download
        ? { "content-disposition": `attachment; filename="${matchupCardDownloadFilename(away.id, home.id, model.season, model.hasGame)}"` }
        : {}),
    },
  });
}
