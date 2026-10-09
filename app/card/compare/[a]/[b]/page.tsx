// app/card/compare/[a]/[b]/page.tsx — two players side by side as one
// shareable page (compare card spec 2026-10-09 §4-§5, PR 2). Order is kept:
// /a/b shows A on the left with the solid outline, /b/a is its mirror.
// HTML built from the Compare page's own chart, so it reads on a phone; the
// 1200×630 picture of the same card is /api/compare-card/[a]/[b], which this
// page names as its preview image with the season and week in the URL (a
// file-convention opengraph-image gets no query string, so there is none in
// this folder).
//
// Linked from the Share block on /compare (components/compare/CompareShare.tsx,
// PR 3). Every share page is noindex (decision J3).
//
// No loading.tsx on purpose: an unknown pair or season is a real 404 and a
// failed read is a real 500 (app/error.tsx), as on /card/[slug].
import { cache } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { loadCompareCardForPage, type CompareCardLoad } from "@/lib/data/compare-card";
import OverlayRadarChart from "@/components/compare/OverlayRadarChart";
import TeamRadarActions from "@/app/card/team/[team_id]/[side]/TeamRadarActions";
import { compareChartMask } from "@/lib/stats/compare";
import { resolveRadarCardSeason } from "@/lib/stats/team-radar";
import {
  COMPARE_CARD_SITE_LINE,
  COMPARE_CARD_STAT_HEADER,
  COMPARE_FULL_LINK_TEXT,
  COMPARE_NOT_FOUND_TITLE,
  COMPARE_OVR_LABEL,
  COMPARE_VS_LABEL,
  compareCanonicalPath,
  compareCardHref,
  compareCardPath,
  compareImageAlt,
  compareImageHref,
  compareOvrText,
  comparePreviewTitle,
  compareShareDescription,
  compareShareHeading,
  compareShareTitle,
  compareStatCardHref,
  compareStatCardLinkText,
  compareToolHref,
  parseCompareSlugs,
  type CompareCardPlayer,
} from "@/lib/stats/compare-card";

export const revalidate = 3600;

type RouteParams = { a: string; b: string };
type SearchParams = { season?: string | string[] };
interface PageProps {
  params: Promise<RouteParams>;
  searchParams: Promise<SearchParams>;
}

const PIXEL = "font-[family-name:var(--font-pixel)]";
const NOT_FOUND: Metadata = { title: { absolute: COMPARE_NOT_FOUND_TITLE }, robots: { index: false, follow: true } };
const NOINDEX = { index: false, follow: true } as const;

/**
 * Everything the page and its metadata both need, loaded ONCE per request.
 *
 * React's cache() gives generateMetadata and the page body the same promise,
 * so the title, the preview image URL and the body can never name different
 * seasons or weeks when a refresh lands between the two. cache() compares
 * arguments by identity, so all three are plain values: the two slugs and the
 * season number asked for (null = none). Never pass an object.
 *
 * Rejects when a read fails: a failed read never looks like a 404 or an
 * empty card. cache() only spans one render pass, and a failed page view has
 * more than one (Next renders the error page separately): what keeps the
 * failed read from being made again is the loader's own ten-second memory of
 * a failure (lib/data/compare-card.ts), not this wrapper.
 */
const loadShare = cache((a: string, b: string, requested: number | null): Promise<CompareCardLoad> =>
  loadCompareCardForPage({ a, b }, requested));

/**
 * The share for a URL, or null for one that names no card before anything is
 * read: a slug outside the grammar, the same player twice, or a ?season=
 * outside 1999-2100. The site-wide rule stays: an absent or non-numeric
 * ?season= is the newest season. (The IMAGE route is stricter.)
 */
function shareFor(p: RouteParams, rawSeason: string | string[] | undefined): Promise<CompareCardLoad> | null {
  const slugs = parseCompareSlugs(p?.a, p?.b);
  if (!slugs) return null;
  const asked = resolveRadarCardSeason(rawSeason, [], 0);
  return asked.invalid ? null : loadShare(slugs.a, slugs.b, asked.requested);
}

// -------------------------------------------------------------------
// Metadata
// -------------------------------------------------------------------
export async function generateMetadata({ params, searchParams }: PageProps): Promise<Metadata> {
  const p = await params;
  const { season: rawSeason } = await searchParams;
  // Not caught (read resilience 1A): a failed read rejects here too.
  const share = await (shareFor(p, rawSeason) ?? Promise.resolve(null));
  if (!share || share.state === "not-found") return NOT_FOUND;

  const base = process.env.NEXT_PUBLIC_SITE_URL || "https://yardsperpass.com";
  const { season, defaultSeason } = share;
  // Bare for the newest season, ?season= for a real past one.
  const query = season !== defaultSeason ? `?season=${season}` : "";
  // og:url is THIS page, order kept: Facebook and LinkedIn re-scrape og:url,
  // and the mirrored page would preview as the other card. The canonical is
  // the alphabetical order and differs on purpose; never point og:url at it.
  const url = `${base}${compareCardPath(p.a, p.b)}${query}`;
  const canonical = `${base}${compareCanonicalPath(p.a, p.b)}${query}`;

  const ready = share.state === "ready";
  const nameA = ready ? share.model.a.fullName : share.nameA;
  const nameB = ready ? share.model.b.fullName : share.nameB;
  const title = compareShareTitle(nameA, nameB, season);
  const previewTitle = comparePreviewTitle(nameA, nameB);
  const description = ready ? compareShareDescription(share.model) : share.message;
  const week = ready ? share.model.throughWeek : share.throughWeek;
  // The image route, always WITH the season, so the preview shows the season
  // the link names. The week only makes each week a new URL for caches.
  const image = `${base}${compareImageHref(p.a, p.b, season, { week })}`;

  return {
    title: { absolute: title },
    description,
    alternates: { canonical },
    robots: NOINDEX,
    openGraph: {
      title: previewTitle,
      description,
      url,
      type: "website",
      images: [{ url: image, width: 1200, height: 630, alt: compareImageAlt(nameA, nameB, season) }],
    },
    twitter: { card: "summary_large_image", title: previewTitle, description, images: [image] },
  };
}

// -------------------------------------------------------------------
// Page
// -------------------------------------------------------------------
const LINK = "text-sm text-slate-500 hover:text-slate-900";

/** One half of the name band: the player's line colour, so the band is the radar's legend. */
function BandHalf({ player, side }: { player: CompareCardPlayer; side: "a" | "b" }) {
  const right = side === "b";
  return (
    <div
      data-compare-band-half={side}
      className={`flex min-w-0 items-center gap-2 px-3 py-3 sm:gap-4 sm:px-6 sm:py-4 ${right ? "flex-row-reverse text-right" : ""}`}
      style={{ backgroundColor: player.color, color: player.textColor }}
    >
      <div className="min-w-0 flex-1">
        <div data-compare-name={side} className={`${PIXEL} break-words text-[9px] uppercase leading-relaxed sm:text-[13px] lg:text-[15px]`}>
          {player.fullName}
        </div>
        <div data-compare-meta={side} className="mt-1 text-[11px] opacity-90 sm:text-sm">
          {player.meta}
        </div>
      </div>
      <div
        data-compare-ovr={side}
        // The margin is on the seam side: it keeps the badge clear of the VS block that sits on the seam.
        className={`${PIXEL} flex-none rounded-md bg-white px-2 pb-1 pt-2 text-center text-slate-900 sm:px-3 ${right ? "ml-4 sm:ml-6" : "mr-4 sm:mr-6"}`}
      >
        <div className="text-[13px] sm:text-[20px]">{compareOvrText(player.ovr)}</div>
        <div className="mt-1 text-[6px] sm:text-[8px]">{COMPARE_OVR_LABEL}</div>
      </div>
    </div>
  );
}

export default async function CompareSharePage({ params, searchParams }: PageProps) {
  const p = await params;
  const { season: rawSeason } = await searchParams;
  const pending = shareFor(p, rawSeason);
  if (!pending) notFound(); // junk in the URL: a 404 before any read
  // The same promise generateMetadata awaited: one load per request.
  const share = await pending;
  if (share.state === "not-found") notFound();

  const { season, defaultSeason } = share;
  const fullComparison = (
    <Link data-compare-full href={compareToolHref(p.a, p.b, season, defaultSeason)} className={LINK}>
      {COMPARE_FULL_LINK_TEXT}
    </Link>
  );
  const statCard = (slug: string, name: string, side: "a" | "b") => (
    <Link data-compare-stat-card={side} href={compareStatCardHref(slug, season, defaultSeason)} className={LINK}>
      {compareStatCardLinkText(name)}
    </Link>
  );

  if (share.state === "no-stats") {
    // A real pair with nothing to compare this season: say why (HTTP 200,
    // noindex) and link on. No card, so no Copy / Download.
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center bg-slate-50 px-4 py-10">
        <div className="w-full max-w-[520px] rounded-xl border border-slate-200 bg-white px-7 py-8 text-center">
          <h1 className="text-[22px] font-extrabold text-slate-900">{compareShareHeading(share.nameA, share.nameB, season)}</h1>
          <p data-compare-message className="mt-3 text-[15px] leading-relaxed text-slate-600">
            {share.message}
          </p>
        </div>
        <div className="mt-4 flex flex-wrap justify-center gap-x-5 gap-y-2">
          {fullComparison}
          {statCard(p.a, share.nameA, "a")}
          {statCard(p.b, share.nameB, "b")}
        </div>
      </div>
    );
  }

  const m = share.model;
  const c = m.comparison;
  const notes = [...m.notDrawnLines, ...m.missingAxisNotes];

  return (
    <div className="flex flex-col items-center bg-slate-50 px-3 py-6 sm:px-4 sm:py-8">
      <article data-compare-card className="w-full max-w-[1080px] overflow-hidden rounded-xl border border-slate-200 bg-white shadow">
        <h1 className="sr-only">{compareShareHeading(m.a.fullName, m.b.fullName, season)}</h1>
        <div data-compare-band className="relative grid grid-cols-2 border-b-4 border-slate-900">
          <BandHalf player={m.a} side="a" />
          <BandHalf player={m.b} side="b" />
          <span
            className={`${PIXEL} absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded border-2 border-white bg-slate-900 px-2 pb-1.5 pt-2 text-[9px] text-white sm:px-3 sm:text-[13px]`}
          >
            {COMPARE_VS_LABEL}
          </span>
        </div>
        <p data-compare-season-line className="border-b border-slate-200 bg-slate-50 px-3 py-2 text-center text-[13px] text-slate-600">
          {m.seasonLine}
        </p>

        <div className="grid grid-cols-1 gap-x-7 gap-y-3 px-3.5 pb-3 pt-4 md:px-6 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)] lg:items-center">
          <div className="min-w-0">
            {m.radarDrawn ? (
              <div className="mx-auto max-w-md">
                <OverlayRadarChart
                  values1={c.a.values}
                  values2={c.b.values}
                  missing1={compareChartMask(c.a)}
                  missing2={compareChartMask(c.b)}
                  color1={m.a.color}
                  color2={m.b.color}
                  name1={m.a.fullName}
                  name2={m.b.fullName}
                  axes={c.axes}
                />
              </div>
            ) : (
              <div data-compare-no-radar className="my-4 space-y-1 rounded-md bg-slate-50 px-3 py-6 text-center text-sm text-slate-600">
                {(m.tooFewLine ? [m.tooFewLine] : m.notDrawnLines).map((line, i) => (
                  <p key={i}>{line}</p>
                ))}
              </div>
            )}
            <div className="mx-auto mt-2 max-w-2xl space-y-1 text-center text-xs text-slate-500">
              {m.poolLine && <p data-compare-pool-line>{m.poolLine}</p>}
              {m.radarDrawn && notes.map((line, i) => (
                <p key={i} data-compare-note>{line}</p>
              ))}
              {m.smallSampleLine && <p data-compare-small-sample className="text-amber-700">{m.smallSampleLine}</p>}
            </div>
          </div>

          <div className="min-w-0 lg:border-l lg:border-slate-200 lg:pl-7">
            <table data-compare-table className="w-full text-sm">
              <thead>
                <tr className="border-b-2 border-slate-200 text-[13px]">
                  <th className="px-2 py-2 text-left font-semibold" style={{ color: m.a.color }}>{m.a.headerName}</th>
                  <th className="px-2 py-2 text-center text-[11px] font-medium tracking-wider text-slate-500">{COMPARE_CARD_STAT_HEADER}</th>
                  <th className="px-2 py-2 text-right font-semibold" style={{ color: m.b.color }}>{m.b.headerName}</th>
                </tr>
              </thead>
              <tbody>
                {m.rows.map((row) => (
                  <tr key={row.key} data-compare-row={row.key} className="border-b border-slate-100">
                    <td className="px-2 py-1.5 text-left tabular-nums">
                      <span className={`inline-block min-w-[76px] rounded-lg px-2.5 py-1 text-center text-base ${row.winner === 1 ? "bg-green-100 font-semibold text-green-800 ring-1 ring-green-300" : "text-slate-900"}`}>
                        {row.a}
                      </span>
                    </td>
                    <td className="px-2 py-1.5 text-center text-xs font-medium text-slate-500">{row.label}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">
                      <span className={`inline-block min-w-[76px] rounded-lg px-2.5 py-1 text-center text-base ${row.winner === 2 ? "bg-green-100 font-semibold text-green-800 ring-1 ring-green-300" : "text-slate-900"}`}>
                        {row.b}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <p data-compare-site className={`${PIXEL} px-3.5 pb-4 pt-2 text-center text-[7px] text-slate-400 sm:text-[8px]`}>
          {COMPARE_CARD_SITE_LINE}
        </p>
      </article>

      <TeamRadarActions
        pagePath={compareCardHref(p.a, p.b, season, defaultSeason)}
        downloadHref={compareImageHref(p.a, p.b, season, { download: true })}
      />

      <div className="mt-4 flex flex-wrap justify-center gap-x-5 gap-y-2">
        {fullComparison}
        {statCard(p.a, m.a.fullName, "a")}
        {statCard(p.b, m.b.fullName, "b")}
      </div>
    </div>
  );
}
