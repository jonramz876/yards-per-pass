// app/api/compare-card/[a]/[b]/route.tsx — the 1200×630 PNG of one
// comparison share card (compare card spec 2026-10-09 §4, PR 2). It is the
// share page's link-preview image (the page names this URL, season and week
// included, in og:image and twitter:image) and, with &download=1, the Download
// button's file. Order is kept: /a/b draws A on the left, /b/a is its mirror.
//
// In order: (1) both slugs must fit the slug grammar and differ, and (2) the
// query string must be the route's one exact form AND spelling (parseCompareImageQuery),
// both before any read: about 850,000 ordered pairs are valid URLs and every
// distinct URL is its own CDN entry and its own render, so junk gets a 404 the
// CDN keeps for an hour instead of a picture. (3)-(5) Seasons, the slug list
// and the season table all come through one-minute memos
// (loadCompareCardForImage): no database request at all while they are warm,
// and never one per pair.
//
// A failed read is a 503 the browser can retry, never stored: never a 404
// (which says the card does not exist) and never a picture drawn from nothing.
import { ImageResponse } from "next/og";
import { loadCompareCardForImage, type CompareCardLoad } from "@/lib/data/compare-card";
import { radarImageFonts } from "@/lib/og/team-radar-image";
import { rawQueryOf } from "@/lib/stats/team-radar";
import { compareCardImage, comparePlateImage } from "@/lib/og/compare-card-image";
import {
  COMPARE_IMAGE_UNAVAILABLE,
  compareDownloadFilename,
  parseCompareImageQuery,
  parseCompareSlugs,
} from "@/lib/stats/compare-card";

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
 * 404. `stored`: a URL that can never be a card (a slug outside the grammar,
 * the same player twice, a query string outside the route's exact form, two
 * players of different position groups) is kept by the CDN for an hour, so
 * repeating it costs nothing. An unknown slug or a season the site does not
 * have is not stored: either may exist after the next refresh.
 */
function notFound(stored: boolean): Response {
  return new Response("Not found", {
    status: 404,
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": stored ? STORED : "no-store" },
  });
}

function unavailable(): Response {
  return new Response(COMPARE_IMAGE_UNAVAILABLE, {
    status: 503,
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store", "retry-after": "60" },
  });
}

export async function GET(req: Request, { params }: { params: Promise<{ a: string; b: string }> }) {
  const raw = await params;
  const slugs = parseCompareSlugs(raw?.a, raw?.b);
  if (!slugs) return notFound(true);

  const query = parseCompareImageQuery(rawQueryOf(req.url));
  if (!query) return notFound(true);

  let card: CompareCardLoad;
  try {
    card = await loadCompareCardForImage(slugs, query.season);
  } catch (err) {
    console.error(`Compare card image: data unavailable for ${slugs.a} vs ${slugs.b}`, err);
    return unavailable();
  }
  if (card.state === "not-found") return notFound(card.stored);

  const fonts = await radarImageFonts();

  if (card.state === "no-stats") {
    // A real pair with nothing to compare this season: a plate that says so in
    // the page's own sentence. Never an attachment (the page has no Download
    // button in this state).
    return new ImageResponse(
      comparePlateImage({ nameA: card.nameA, nameB: card.nameB, season: card.season, message: card.message }),
      { ...SIZE, fonts, headers: { "cache-control": STORED } },
    );
  }

  return new ImageResponse(compareCardImage(card.model), {
    ...SIZE,
    fonts,
    headers: {
      "cache-control": STORED,
      // Built from the two validated slugs and the validated season only:
      // nothing else typed into the URL reaches this header value.
      ...(query.download
        ? { "content-disposition": `attachment; filename="${compareDownloadFilename(slugs.a, slugs.b, card.season)}"` }
        : {}),
    },
  });
}
