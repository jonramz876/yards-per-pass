// app/card/matchup/[away]/[home]/page.tsx — one game's matchup card as a
// shareable page (matchup card spec 2026-10-11 §4.1, §7, §8.1; PR 2). Away
// first, as on /matchup/[away]/[home]. One card per game: `ball` means nothing
// here.
//
// The page shows the 1200×630 PNG itself (/api/matchup-card/[away]/[home], the
// very URL it names as og:image, so one CDN entry) and does NOT redraw the
// chart in HTML: one drawing, one truth. On a phone the picture is about 340
// px wide and its numbers cannot be read, so under the picture and its buttons
// the page prints the same 14 lines per pane as two plain tables, built from
// the same model the picture is drawn from (buildMatchupCard).
//
// It reads searchParams, so it renders on every request; `revalidate` only
// bounds its Supabase reads in Next's data cache. Every read goes through
// loadMatchup's memos, keyed by season only: nothing is read per team or pair.
//
// NO loading.tsx, not-found.tsx or opengraph-image.tsx in this folder (a test
// fails): with a loading file a redirect becomes a meta refresh, a 404 a soft
// 200 and every prefetch a render; a file-convention image gets no query
// string, so it could not carry the season. No React cache() either: the
// loader's memo already gives the metadata and the body the same reads.
//
// Linked from the Share block on the matchup page
// (app/matchup/[away]/[home]/MatchupShare.tsx). Every share page is noindex.
import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound, permanentRedirect, redirect } from "next/navigation";
import TeamRadarActions from "@/app/card/team/[team_id]/[side]/TeamRadarActions";
import { getTeam } from "@/lib/data/teams";
import { loadMatchup } from "@/lib/data/matchup";
import { listedMatchupSeason } from "@/lib/data/matchup-season";
import { MATCHUP_FORMULA_LINE, matchupRankNote } from "@/lib/stats/matchup";
import {
  MATCHUP_CARD_FULL_LINK_TEXT,
  MATCHUP_CARD_NOT_FOUND_TITLE,
  MATCHUP_CARD_UNAVAILABLE,
  buildMatchupCard,
  matchupCardColourNote,
  matchupCardHeading,
  matchupCardImageHref,
  matchupCardLegendWords,
  matchupCardPaneCaption,
  matchupCardTeamLinkText,
  type MatchupCardPane,
} from "@/lib/stats/matchup-card";
import { matchupCardHref, matchupHref, parseMatchupSeason, parseMatchupTeamId } from "@/lib/stats/matchup-links";
import type { Team } from "@/lib/types";

export const revalidate = 3600;

type RouteParams = { away: string; home: string };
type SearchParams = { season?: string | string[] };
interface PageProps {
  params: Promise<RouteParams>;
  searchParams: Promise<SearchParams>;
}

const NOT_FOUND: Metadata = { title: { absolute: MATCHUP_CARD_NOT_FOUND_TITLE }, robots: { index: false, follow: true } };
const NOINDEX = { index: false, follow: true } as const;

interface Parsed {
  away: Team;
  home: Team;
  /** A season the URL named and the rule accepts (four digits, 1999-2100); null = none. */
  requested: number | null;
  /** Each raw segment is already its upper-case id; false = the page answers 308. */
  canonicalCase: boolean;
}

/**
 * Steps 1-2 of the spec's §4.1, reading nothing: two real, different teams
 * (the id rule is checked BEFORE upper-casing, so a look-alike letter is no
 * team), then the one query value the card reads. null = a 404.
 */
function parseRequest(p: RouteParams, q: SearchParams): Parsed | null {
  const awayId = parseMatchupTeamId(p?.away);
  const homeId = parseMatchupTeamId(p?.home);
  const away = awayId ? getTeam(awayId) : undefined;
  const home = homeId ? getTeam(homeId) : undefined;
  if (!away || !home || away.id === home.id) return null;
  return { away, home, requested: parseMatchupSeason(q?.season), canonicalCase: p.away === away.id && p.home === home.id };
}

// -------------------------------------------------------------------
// Metadata
// -------------------------------------------------------------------
export async function generateMetadata({ params, searchParams }: PageProps): Promise<Metadata> {
  const parsed = parseRequest(await params, await searchParams);
  // An invalid pair, and a URL the page is about to 308: the plain object, no read.
  if (!parsed || !parsed.canonicalCase) return NOT_FOUND;
  const { away, home, requested } = parsed;

  // Not caught (read resilience 1A): a failed core read rejects here too.
  const load = await loadMatchup(away.id, home.id, requested);
  // About to 307 to the other order: never an "A at B" title for the wrong order.
  if (load.swap) return NOT_FOUND;

  const model = buildMatchupCard({ away, home, load });
  const base = process.env.NEXT_PUBLIC_SITE_URL || "https://yardsperpass.com";
  // Canonical = og:url = this page: bare for the newest season, ?season= for a
  // real past one. Only one order of a scheduled pair survives the 307, so
  // there is no second address to choose between.
  const url = `${base}${matchupCardHref(away.id, home.id, { season: load.season, defaultSeason: load.defaultSeason })}`;
  const title = { absolute: model.title };
  // A plate's description is its sentence; with no games read it is K11.
  const description = model.description;

  if (!load.gamesAvailable) {
    // The image route answers 503 here (never a stored "VS" card), so no image is named.
    return {
      title,
      description,
      alternates: { canonical: url },
      robots: NOINDEX,
      openGraph: { title: model.previewTitle, description, url, type: "website" },
    };
  }

  // Always WITH the season, so the preview shows the season the link names;
  // the week only makes each week a new URL for caches. A plate state draws the plate.
  const image = `${base}${matchupCardImageHref(away.id, home.id, load.season, { week: model.throughWeek })}`;
  return {
    title,
    description,
    alternates: { canonical: url },
    robots: NOINDEX,
    openGraph: {
      title: model.previewTitle,
      description,
      url,
      type: "website",
      images: [{ url: image, width: 1200, height: 630, alt: model.alt }],
    },
    twitter: { card: "summary_large_image", title: model.previewTitle, description, images: [image] },
  };
}

// -------------------------------------------------------------------
// Page
// -------------------------------------------------------------------
const LINK = "text-sm text-slate-500 hover:text-slate-900";
const NOTE = "m-0 max-w-[80ch] text-[13px] leading-relaxed text-slate-600";
const CELL = "px-1.5 py-1.5 sm:px-2";

/**
 * One pane's seven spokes as a plain table: the spoke, the offense's line,
 * the defense's line, each cell the model's own string (what the picture
 * prints). A pane that cannot be drawn prints its sentence instead.
 */
function PaneLines({ pane, index }: { pane: MatchupCardPane; index: number }) {
  const caption = matchupCardPaneCaption(pane.offId, pane.defId);
  if (!pane.drawn) {
    return (
      <div className="min-w-0">
        <p className="m-0 pb-1.5 text-left text-[14px] font-semibold text-slate-900">{caption}</p>
        <p data-pane-message className="m-0 border-t border-slate-200 pt-2 text-[14px] leading-relaxed text-slate-600">
          {pane.message}
        </p>
      </div>
    );
  }
  const words = matchupCardLegendWords(pane.offId, pane.defId);
  return (
    <div className="min-w-0">
      <table data-pane-table={index} className="w-full border-collapse text-left text-[13px] tabular-nums text-slate-900 sm:text-[14px]">
        <caption className="pb-1.5 text-left text-[14px] font-semibold text-slate-900">{caption}</caption>
        <thead>
          <tr className="border-y border-slate-300">
            <th className={`${CELL} font-normal`} />
            <th className={`${CELL} whitespace-nowrap font-semibold`}>
              {/* The unit's mark, as on the picture: a round dot in the offense's card colour. */}
              <span data-unit-mark="off" className="mr-1.5 inline-block h-2.5 w-2.5 rounded-full align-baseline" style={{ backgroundColor: pane.offColor }} />
              {words.off}
            </th>
            <th className={`${CELL} whitespace-nowrap font-semibold`}>
              {/* An outlined square in the defense's card colour. */}
              <span data-unit-mark="def" className="mr-1.5 inline-block h-2.5 w-2.5 border-2 bg-white align-baseline" style={{ borderColor: pane.defColor }} />
              {words.def}
            </th>
          </tr>
        </thead>
        <tbody>
          {pane.labels.map((label) => (
            <tr key={label.key} data-spoke={label.key} className="border-b border-slate-200">
              <th scope="row" className={`${CELL} font-normal text-slate-600`}>{label.name}</th>
              <td className={`${CELL} whitespace-nowrap`}>{label.offLine}</td>
              <td className={`${CELL} whitespace-nowrap`}>{label.defLine}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default async function MatchupCardPage({ params, searchParams }: PageProps) {
  const parsed = parseRequest(await params, await searchParams);
  if (!parsed) notFound(); // steps 1-2: no read
  const { away, home, requested, canonicalCase } = parsed;

  // Step 3: mixed case is a permanent redirect. The query is rebuilt from the
  // validated value, never echoed, and a season the site does not list is left
  // out (no read at all unless the address names a season).
  if (!canonicalCase) {
    const season = await listedMatchupSeason(requested, `Matchup card (${away.id} at ${home.id})`);
    permanentRedirect(matchupCardHref(away.id, home.id, { season }));
  }

  // Step 4. A failed core read rejects: app/error.tsx, a real 500.
  const load = await loadMatchup(away.id, home.id, requested);

  // Step 5: no game in the order asked for and one the other way round. A 307
  // (which order is scheduled depends on the season), built from the RESOLVED season.
  if (load.swap) {
    redirect(matchupCardHref(home.id, away.id, { season: load.season, defaultSeason: load.defaultSeason }));
  }

  const { season, defaultSeason } = load;
  const model = buildMatchupCard({ away, home, load });
  const heading = matchupCardHeading(away.name, home.name, season, model.hasGame);
  const teamHref = (id: string) => `/team/${id}${season === defaultSeason ? "" : `?season=${season}`}`;
  // prefetch={false} on every link: none of these pages has a loading file, so
  // a prefetch reads nothing today, but one function run per link on screen is
  // still a cost (compare card spec §17 item 12).
  const links = (
    <div className="mt-5 flex flex-wrap justify-center gap-x-5 gap-y-2">
      <Link data-full-matchup href={matchupHref(away.id, home.id, { season, defaultSeason })} prefetch={false} className={LINK}>
        {MATCHUP_CARD_FULL_LINK_TEXT}
      </Link>
      <Link data-team-link="away" href={teamHref(away.id)} prefetch={false} className={LINK}>
        {matchupCardTeamLinkText(away.name)}
      </Link>
      <Link data-team-link="home" href={teamHref(home.id)} prefetch={false} className={LINK}>
        {matchupCardTeamLinkText(home.name)}
      </Link>
    </div>
  );

  if (model.kind === "plate" || !load.gamesAvailable || load.state !== "ready") {
    // Nothing to draw a card from (HTTP 200, noindex): the sentence and the
    // links. No picture, so no Copy / Download. With no games read the
    // sentence is K11: the image route answers 503 there.
    const message = model.kind === "plate" ? model.message : MATCHUP_CARD_UNAVAILABLE;
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center bg-slate-50 px-3 py-10">
        <div className="w-full max-w-[520px] min-w-0 border border-slate-200 bg-white px-6 py-8 text-center">
          <h1 className="m-0 text-[22px] font-extrabold leading-tight text-slate-900">{heading}</h1>
          <p data-card-message className="m-0 mt-3 text-[15px] leading-relaxed text-slate-600">{message}</p>
          {load.state === "uncovered" && load.gamesAvailable ? (
            <Link
              data-default-season-link
              href={matchupCardHref(away.id, home.id)}
              prefetch={false}
              className="mt-3 inline-block text-[15px] font-semibold text-navy underline underline-offset-2"
            >
              {`See ${away.id} and ${home.id} in ${defaultSeason}`}
            </Link>
          ) : null}
        </div>
        {links}
      </div>
    );
  }

  const ranked = load.model;
  const colourNotes = [
    matchupCardColourNote(away.name, model.colours.awayFrom),
    matchupCardColourNote(home.name, model.colours.homeFrom),
  ].filter((note): note is string => note !== null);

  return (
    <div className="flex flex-col items-center bg-slate-50 px-3 py-6 sm:px-4 sm:py-8">
      <div data-matchup-card-page className="w-full max-w-[1080px] min-w-0">
        <h1 className="sr-only">{heading}</h1>

        {/* The picture itself. Under `next dev` on Windows it is a broken image (next/og's
            loader fails there); the tables below carry the same strings. */}
        <div data-matchup-card-image className="border border-slate-200 bg-white">
          <Image
            src={matchupCardImageHref(away.id, home.id, season, { week: model.throughWeek })}
            alt={model.alt}
            width={1200}
            height={630}
            unoptimized
            className="h-auto w-full"
          />
        </div>

        <TeamRadarActions
          pagePath={matchupCardHref(away.id, home.id, { season, defaultSeason })}
          downloadHref={matchupCardImageHref(away.id, home.id, season, { week: model.throughWeek, download: true })}
        />

        {/* The picture's 14 lines per pane, readable on a phone. Side by side from md. */}
        <div data-matchup-card-tables className="mt-6 grid grid-cols-1 gap-x-8 gap-y-6 md:grid-cols-2">
          <PaneLines pane={model.panes[0]} index={0} />
          <PaneLines pane={model.panes[1]} index={1} />
        </div>

        <div className="mt-4 grid gap-1.5">
          <p data-rank-note className={NOTE}>
            {matchupRankNote({
              teamsPlayed: ranked.teamsPlayed,
              season: ranked.season,
              throughWeek: ranked.throughWeek,
              awayId: ranked.away.id,
              homeId: ranked.home.id,
              awayGames: ranked.away.games,
              homeGames: ranked.home.games,
            })}
          </p>
          <p data-legend-line className={NOTE}>{model.legendLine}</p>
          <p data-formula-line className={NOTE}>{MATCHUP_FORMULA_LINE}</p>
          {colourNotes.map((note) => (
            <p key={note} data-colour-note className={NOTE}>{note}</p>
          ))}
        </div>

        {links}
      </div>
    </div>
  );
}
