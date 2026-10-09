// app/compare/page.tsx
import type { Metadata } from "next";
import { Suspense } from "react";
import ComparisonTool from "@/components/compare/ComparisonTool";
import { getPlayerBySlug } from "@/lib/data/players";
import { getQBStats, getAvailableSeasons, fallbackSeason } from "@/lib/data/queries";
import { getReceiverStats } from "@/lib/data/receivers";
import { getRBSeasonStats } from "@/lib/data/rushing";
import { loadCompareCardForPage } from "@/lib/data/compare-card";
import {
  compareImageAlt,
  compareImageHref,
  comparePreviewTitle,
  compareShareDescription,
  compareToolHref,
  compareToolTitle,
  parseCompareSlugs,
} from "@/lib/stats/compare-card";
import type { QBSeasonStat, ReceiverSeasonStat, RBSeasonStat, PlayerSlug } from "@/lib/types";

type SearchParams = { season?: string; p1?: string; p2?: string };

const siteUrl = (): string => process.env.NEXT_PUBLIC_SITE_URL || "https://yardsperpass.com";

/** The page's own metadata: what every /compare URL had before a pair could preview, and still has without one. */
function standardMetadata(): Metadata {
  return {
    title: "Player Comparison",
    description:
      "Compare NFL players head-to-head with overlaid radar charts and stat breakdowns. EPA, CPOE, CROE, and 30+ metrics side by side.",
    alternates: { canonical: `${siteUrl()}/compare` },
  };
}

/** ?season= as this page has always read it: the number it starts with, or NaN for none. The body and the metadata share it so they name one season. */
function seasonInUrl(seasonParam: string | undefined): number {
  return seasonParam ? parseInt(seasonParam, 10) : NaN;
}

/**
 * A pasted /compare?p1=&p2= link previews the comparison picture (compare card
 * spec 2026-10-09 §7, J6). Only for a pair that has a share card: two slugs of
 * the share URL's grammar, both in the slug list, one stat table, a season the
 * site has. Anything else is the standard metadata. The canonical is bare
 * /compare whatever the query says.
 *
 * The reads are the share card's three memoised ones (seasons, the slug list,
 * one season table): none per slug or per pair, so made-up links cost nothing.
 * This is a read that may degrade (read resilience spec §1.2): if it fails the
 * page keeps its standard title, which is true whatever the database says, and
 * the failure is logged. It never rejects, so it can never turn a page that
 * would have rendered into an error page.
 */
export async function generateMetadata({ searchParams }: { searchParams: Promise<SearchParams> }): Promise<Metadata> {
  const { season: seasonParam, p1, p2 } = await searchParams;
  const standard = standardMetadata();
  const slugs = parseCompareSlugs(p1, p2);
  if (!slugs) return standard;
  const parsed = seasonInUrl(seasonParam);
  // No season in the URL: the newest. One no season table can have: no read.
  if (!Number.isNaN(parsed) && (parsed < 1999 || parsed > 2100)) return standard;

  const load = await loadCompareCardForPage(slugs, Number.isNaN(parsed) ? null : parsed).catch((err: unknown) => {
    console.error(`Compare page: link preview read failed for ${slugs.a} vs ${slugs.b}; using the standard metadata`, err);
    return null;
  });
  if (!load || load.state === "not-found") return standard;

  const base = siteUrl();
  const { season, defaultSeason } = load;
  const ready = load.state === "ready";
  const nameA = ready ? load.model.a.fullName : load.nameA;
  const nameB = ready ? load.model.b.fullName : load.nameB;
  const previewTitle = comparePreviewTitle(nameA, nameB);
  // No stats for one of them: the picture is the plate with the same sentence.
  const description = ready ? compareShareDescription(load.model) : load.message;
  const week = ready ? load.model.throughWeek : load.throughWeek;
  const image = `${base}${compareImageHref(slugs.a, slugs.b, season, { week })}`;

  return {
    title: compareToolTitle(nameA, nameB),
    description,
    alternates: standard.alternates,
    openGraph: {
      title: previewTitle,
      description,
      // This pair, order kept: a re-scrape of og:url must find the same preview.
      url: `${base}${compareToolHref(slugs.a, slugs.b, season, defaultSeason)}`,
      type: "website",
      images: [{ url: image, width: 1200, height: 630, alt: compareImageAlt(nameA, nameB, season) }],
    },
    twitter: { card: "summary_large_image", title: previewTitle, description, images: [image] },
  };
}

export default async function ComparePage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const { season: seasonParam, p1 } = await searchParams;
  const parsed = seasonInUrl(seasonParam);
  let season: number;
  // The newest season the site has: the Share block's links are bare for it.
  let defaultSeason: number;
  if (Number.isNaN(parsed)) {
    season = defaultSeason = (await getAvailableSeasons())[0] ?? fallbackSeason();
  } else {
    season = parsed;
    // With a season in the URL the page does not depend on the seasons list,
    // so here that read may degrade: the calendar's guess stands in.
    try {
      defaultSeason = (await getAvailableSeasons())[0] ?? fallbackSeason();
    } catch (err: unknown) {
      console.error("Compare page: seasons read failed; taking the calendar's season as the newest for share links", err);
      defaultSeason = fallbackSeason();
    }
  }

  // Only fetch the position we need based on p1's position (if present)
  let qbs: QBSeasonStat[] = [];
  let receivers: ReceiverSeasonStat[] = [];
  let rbs: RBSeasonStat[] = [];

  if (p1) {
    // The one read here that may degrade (read resilience spec §1.2): if the
    // p1 lookup fails, render the tool with nothing preloaded. The browser
    // restores both players from the URL itself and says so if it cannot.
    // The seasons read above (when the URL names no season) and the position
    // table below are core: a failure throws to app/compare/error.tsx.
    let player: PlayerSlug | null = null;
    try {
      player = await getPlayerBySlug(p1);
    } catch (err: unknown) {
      console.error(`Compare page: player lookup failed for ${p1}; rendering with nothing preloaded`, err);
    }
    if (player) {
      const pos = player.position;
      if (pos === "QB") {
        qbs = await getQBStats(season);
      } else if (pos === "WR" || pos === "TE") {
        receivers = await getReceiverStats(season);
      } else if (pos === "RB" || pos === "FB") {
        rbs = await getRBSeasonStats(season);
      }
    }
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="space-y-2 mb-6">
        <h1 className="text-2xl font-extrabold text-navy tracking-tight">
          Player Comparison
        </h1>
        <p className="text-sm text-gray-500">
          Compare two same-position players with overlaid radar charts and detailed stat breakdowns.
        </p>
      </div>
      <Suspense fallback={<div className="text-center py-12 text-gray-400">Loading comparison tool...</div>}>
        <ComparisonTool qbs={qbs} receivers={receivers} rbs={rbs} season={season} defaultSeason={defaultSeason} siteUrl={siteUrl()} />
      </Suspense>
    </div>
  );
}
