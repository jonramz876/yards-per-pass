// app/card/team/[team_id]/[side]/page.tsx — one team's offense OR defense
// radar as a shareable page (team radar spec 2026-10-06 §7-§8, PR 3; decision
// J6: a separate card per side). HTML built from the team page's own chart and
// table, so it reads on a phone; the 1200×630 picture of the same card is
// /api/team-radar/[team_id]/[side], which this page names as its preview image
// with the season in the URL (a file-convention opengraph-image gets no query
// string, so there is none in this folder).
//
// No loading.tsx on purpose: an unknown team, side or season is a real 404 and
// a failed read is a real 500 (app/error.tsx), as on /card/[slug].
import { cache } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTeam } from "@/lib/data/teams";
import { getAvailableSeasons, fallbackSeason } from "@/lib/data/queries";
import { loadTeamRadarCard } from "@/lib/data/team-radar-card";
import { hasNoDatabase } from "@/lib/supabase/server";
import { textColorForBackground } from "@/lib/stats/formatters";
import type { Team } from "@/lib/types";
import TeamRadarChart from "@/components/team/TeamRadarChart";
import TeamRadarTable from "@/components/team/TeamRadarTable";
import TeamRadarActions from "./TeamRadarActions";
import {
  RADAR_CARD_SITE_LINE,
  RADAR_CARD_SUBTITLE,
  RADAR_NOT_FOUND_TITLE,
  canDrawRadar,
  parseRadarSide,
  parseRadarTeamId,
  radarCardBandAside,
  radarCardFooter,
  radarCardHref,
  radarImageAlt,
  radarImageHref,
  radarOtherSideLinkText,
  radarShareDescription,
  radarShareHeading,
  radarShareTitle,
  radarSideSlug,
  radarStateMessage,
  radarTableOnlyNote,
  radarTeamPageHref,
  radarTeamPageLinkText,
  resolveRadarCardSeason,
  type RadarSide,
  type TeamRadarSlice,
} from "@/lib/stats/team-radar";

export const revalidate = 3600;

type RouteParams = { team_id: string; side: string };
type SearchParams = { season?: string | string[] };
interface PageProps {
  params: Promise<RouteParams>;
  searchParams: Promise<SearchParams>;
}

const PIXEL = "font-[family-name:var(--font-pixel)]";
const NOT_FOUND: Metadata = { title: { absolute: RADAR_NOT_FOUND_TITLE }, robots: { index: false, follow: true } };

/** The team and side a share URL names, or null. Reads nothing: both come from fixed lists. */
function parseShareParams(p: RouteParams): { team: Team; side: RadarSide } | null {
  const side = parseRadarSide(p?.side);
  // Two or three ASCII letters, then upper-cased like the team hub, so
  // /card/team/buf/offense is the Bills (and a look-alike letter is no team).
  const teamId = parseRadarTeamId(p?.team_id);
  const team = teamId ? getTeam(teamId) : undefined;
  return side && team ? { team, side } : null;
}

interface Share {
  slice: TeamRadarSlice;
  seasons: number[];
  season: number;
  /** The season the canonical URL names; null = the bare URL (the newest season). */
  canonicalParam: number | null;
}

/**
 * Everything the page and its metadata both need, loaded ONCE per request.
 *
 * React's cache() gives generateMetadata and the page body the same promise,
 * so the title, the preview image URL and the body can never name different
 * seasons or weeks when a refresh lands between the two (chaos W1). cache()
 * compares arguments by identity, so both are plain values: the team id and
 * the season number asked for (null = none). Never pass the team object or
 * the raw searchParams value.
 *
 * `null` = a season the site does not have (a 404, decided before any row is
 * read). Rejects when a read fails, when data_freshness is empty on a real
 * database (the team page's rule), when the coverage probe failed and the
 * answer depended on it, and when the newest season's rows come back empty: a
 * failed read never looks like an empty card, a guessed season or a 404.
 */
const loadShare = cache(async (teamId: string, requested: number | null): Promise<Share | null> => {
  const seasons = await getAvailableSeasons();
  if (seasons.length === 0 && !hasNoDatabase()) {
    throw new Error("Team radar share page: no seasons from data_freshness (table empty)");
  }
  if (requested !== null && seasons.length > 0 && !seasons.includes(requested)) return null;
  const season = requested ?? seasons[0] ?? fallbackSeason();

  const slice = await loadTeamRadarCard(teamId, season, seasons);
  if (slice.state === "unavailable") {
    const message = `Team radar share page: the read for ${teamId} returned no rows for ${season}, a season that has them`;
    console.error(message);
    throw new Error(message);
  }
  // The canonicalSeason rule: only a real season other than the newest gets a
  // URL of its own; ?season=<newest> is the bare page.
  const canonicalParam = requested !== null && seasons.includes(requested) && requested !== seasons[0] ? requested : null;
  return { slice, seasons, season, canonicalParam };
});

/**
 * The share for a URL's ?season=. The site-wide rule stays: absent or not a
 * number is the newest season; a number outside 1999-2100 is a 404 with no
 * read. (The IMAGE route is stricter: see parseRadarImageQuery.)
 */
function shareFor(team: Team, rawSeason: string | string[] | undefined): Promise<Share | null> {
  const asked = resolveRadarCardSeason(rawSeason, [], 0);
  return asked.invalid ? Promise.resolve(null) : loadShare(team.id, asked.requested);
}

// -------------------------------------------------------------------
// Metadata
// -------------------------------------------------------------------
export async function generateMetadata({ params, searchParams }: PageProps): Promise<Metadata> {
  const parsed = parseShareParams(await params);
  if (!parsed) return NOT_FOUND;
  const { team, side } = parsed;
  const { season: rawSeason } = await searchParams;

  // Not caught (read resilience 1A): a failed read rejects here too.
  const share = await shareFor(team, rawSeason);
  if (!share) return NOT_FOUND;
  const { slice, season, canonicalParam } = share;

  const base = process.env.NEXT_PUBLIC_SITE_URL || "https://yardsperpass.com";
  const path = `/card/team/${team.id}/${radarSideSlug(side)}`;
  // Bare for the newest season, ?season= for a real past one (the canonicalSeason rule).
  const url = `${base}${path}${canonicalParam != null ? `?season=${canonicalParam}` : ""}`;
  const ready = slice.state === "ready";
  const title = radarShareTitle(team.name, side, season);
  const description = ready
    ? radarShareDescription(team.name, side, slice.throughWeek, slice.teamsPlayed, slice[side])
    : radarStateMessage(slice, team.name);
  // The image route, always WITH the season, so the preview shows the season
  // the link names. The week only makes each week a new URL for caches.
  const image = `${base}${radarImageHref(team.id, side, season, { week: ready ? slice.throughWeek : null })}`;

  return {
    title: { absolute: title },
    description,
    alternates: { canonical: url },
    // A message page (no radar for this season yet) stays out of search results.
    ...(ready ? {} : { robots: { index: false, follow: true } }),
    openGraph: {
      title,
      description,
      url,
      type: "website",
      images: [{ url: image, width: 1200, height: 630, alt: radarImageAlt(team.name, side, season) }],
    },
    twitter: { card: "summary_large_image", title, description, images: [image] },
  };
}

// -------------------------------------------------------------------
// Page
// -------------------------------------------------------------------
const LINK = "mt-3 text-sm text-slate-500 hover:text-slate-900";

export default async function TeamRadarSharePage({ params, searchParams }: PageProps) {
  const parsed = parseShareParams(await params);
  if (!parsed) notFound(); // unknown team or side: a 404 before any read
  const { team, side } = parsed;
  const { season: rawSeason } = await searchParams;

  // The same promise generateMetadata awaited: one load per request.
  const share = await shareFor(team, rawSeason);
  if (!share) notFound(); // a season the site does not have: no row read
  const { slice, seasons, season } = share;
  const defaultSeason = seasons[0] ?? fallbackSeason();
  const teamPage = (
    <Link data-radar-team-page href={radarTeamPageHref(team.id, season, defaultSeason)} className={LINK}>
      {radarTeamPageLinkText(team.name)}
    </Link>
  );

  if (slice.state !== "ready") {
    // A real team with no radar to draw for this season: say why (HTTP 200,
    // noindex) and link to the team page. No card, so no Copy / Download.
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center bg-slate-50 px-4 py-10">
        <div className="w-full max-w-[480px] rounded-xl border border-slate-200 bg-white px-7 py-8 text-center">
          <h1 className="text-[22px] font-extrabold text-slate-900">{radarShareHeading(team.name, side, season)}</h1>
          <p data-radar-message className="mt-3 text-[15px] leading-relaxed text-slate-600">
            {radarStateMessage(slice, team.name)}
          </p>
        </div>
        {teamPage}
      </div>
    );
  }

  const model = slice[side];
  const other: RadarSide = side === "off" ? "def" : "off";

  return (
    <div className="flex flex-col items-center bg-slate-50 px-3 py-6 sm:px-4 sm:py-8">
      <article data-radar-card className="w-full max-w-[1080px] overflow-hidden rounded-xl border border-slate-200 bg-white shadow">
        <h1
          data-radar-card-band
          className={`${PIXEL} flex items-center justify-between gap-3 px-3.5 py-3 text-[8px] uppercase leading-relaxed tracking-wide sm:text-[10px] lg:px-6 lg:py-4 lg:text-[13px]`}
          style={{
            backgroundColor: team.primaryColor,
            color: textColorForBackground(team.primaryColor),
            borderBottom: `4px solid ${team.secondaryColor}`,
          }}
        >
          <span>{team.name}</span>
          <span className="text-right text-[7px] sm:text-[8px] lg:text-[10px]">
            {radarCardBandAside(side, season, slice.throughWeek)}
          </span>
        </h1>

        <div className="grid grid-cols-1 gap-x-7 gap-y-3 px-3.5 pb-3 pt-4 md:px-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] lg:items-center">
          <div className="min-w-0">
            {canDrawRadar(model) ? (
              <TeamRadarChart
                side={model}
                sideKey={side}
                color={team.primaryColor}
                secondaryColor={team.secondaryColor}
                label={`${team.name} ${radarSideSlug(side)} radar`}
                size="lg"
              />
            ) : (
              <p data-radar-table-only className="my-4 rounded-md bg-slate-50 px-3 py-2 text-[13px] text-slate-600">
                {radarTableOnlyNote(side)}
              </p>
            )}
          </div>
          <div className="min-w-0 lg:border-l lg:border-slate-200 lg:pl-7">
            <TeamRadarTable
              side={model}
              sideKey={side}
              teamId={team.id}
              teamsPlayed={slice.teamsPlayed}
              league={slice.league}
              statHeader={RADAR_CARD_SUBTITLE[side]}
            />
          </div>
        </div>

        <div className="px-3.5 pb-4 pt-1 text-center md:px-6">
          <p data-radar-card-footer className="text-[13px] text-slate-500">
            {radarCardFooter(slice.teamsPlayed)}
          </p>
          <p data-radar-card-site className={`${PIXEL} mt-2 text-[7px] text-slate-400 sm:text-[8px]`}>
            {RADAR_CARD_SITE_LINE}
          </p>
        </div>
      </article>

      <TeamRadarActions
        pagePath={radarCardHref(team.id, side, season, defaultSeason)}
        downloadHref={radarImageHref(team.id, side, season, { download: true })}
      />

      <Link data-radar-other-side href={radarCardHref(team.id, other, season, defaultSeason)} className={LINK}>
        {radarOtherSideLinkText(team.name, other)}
      </Link>
      {teamPage}
    </div>
  );
}
