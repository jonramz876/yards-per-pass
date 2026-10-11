// app/matchup/[away]/[home]/page.tsx — one team's offense against the other
// team's defense, and the reverse, by league rank (team matchup spec
// 2026-10-10). Direction A as drawn (team slabs, possession tabs, the stat
// ladder with one overlay radar in a side panel) with direction C's Tecmo
// player tiles.
//
// It reads searchParams, so it renders on every request; `revalidate` only
// bounds its Supabase reads in Next's data cache. Every read goes through
// loadMatchup's memos, keyed by season only: nothing is read per team or pair.
//
// NO loading.tsx anywhere under app/matchup/, on purpose: with one, a redirect
// becomes a meta refresh, a 404 becomes a soft 200, and every link's prefetch
// would render the whole page. No React cache() either (the memo already
// gives the metadata and the body the same reads).
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, permanentRedirect, redirect } from "next/navigation";
import { getTeam } from "@/lib/data/teams";
import { loadMatchup, type MatchupLoad } from "@/lib/data/matchup";
import { listedMatchupSeason } from "@/lib/data/matchup-season";
import { MATCHUP_SMALL_POOL_NOTE, matchupNoGamesNote, matchupUncoveredHeading } from "@/lib/stats/matchup";
import { buildMatchupCard, matchupCardAlt, matchupCardImageHref, matchupRingWord } from "@/lib/stats/matchup-card";
import { matchupCardColours } from "@/lib/stats/matchup-colours";
import { flipBall, matchupCardHref, matchupHref, parseBall, parseMatchupSeason, parseMatchupTeamId, type Ball } from "@/lib/stats/matchup-links";
import type { Team } from "@/lib/types";
import MatchupShare from "./MatchupShare";
import MatchupBallToggle from "@/components/matchup/MatchupBallToggle";
import MatchupBallView from "@/components/matchup/MatchupBallView";
import MatchupHeader from "@/components/matchup/MatchupHeader";
import MatchupNotes from "@/components/matchup/MatchupNotes";
import MatchupPlayers from "@/components/matchup/MatchupPlayers";

export const revalidate = 3600;

type RouteParams = { away: string; home: string };
type SearchParams = { season?: string | string[]; ball?: string | string[] };
interface PageProps {
  params: Promise<RouteParams>;
  searchParams: Promise<SearchParams>;
}

const NOT_FOUND: Metadata = { title: { absolute: "Matchup Not Found — Yards Per Pass" }, robots: { index: false, follow: true } };

interface Parsed {
  away: Team;
  home: Team;
  /** A season the URL named and the rule accepts (four digits, 1999-2100); null = none. */
  requested: number | null;
  ball: Ball;
  /** Each raw segment is already its upper-case id; false = the page answers 308. */
  canonicalCase: boolean;
}

/**
 * Steps 1-4 of the spec's §4.1, reading nothing: two real, different teams
 * (the id rule is checked BEFORE upper-casing, so a look-alike letter is no
 * team), then the two query values. null = a 404.
 */
function parseRequest(p: RouteParams, q: SearchParams): Parsed | null {
  const awayId = parseMatchupTeamId(p?.away);
  const homeId = parseMatchupTeamId(p?.home);
  const away = awayId ? getTeam(awayId) : undefined;
  const home = homeId ? getTeam(homeId) : undefined;
  if (!away || !home || away.id === home.id) return null;
  return {
    away,
    home,
    requested: parseMatchupSeason(q?.season),
    ball: parseBall(q?.ball),
    canonicalCase: p.away === away.id && p.home === home.id,
  };
}

const hasGame = (load: MatchupLoad): boolean => load.game !== null;

/** The base of every absolute URL the server prints (canonical, og:url, the preview image, the Share block's link). */
const siteBase = (): string => process.env.NEXT_PUBLIC_SITE_URL || "https://yardsperpass.com";

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

  const base = siteBase();
  // Only a real season other than the newest gets a URL of its own; `ball` is
  // a view of one page and never part of the canonical.
  const url = `${base}${matchupHref(away.id, home.id, { season: load.season, defaultSeason: load.defaultSeason })}`;
  const title = `${away.name} ${hasGame(load) ? "at" : "vs"} ${home.name}: Team Matchup ${load.season}`;
  const week = load.model?.throughWeek;
  const through = typeof week === "number" && Number.isFinite(week) ? ` through Week ${week}` : "";
  const description = `${away.id} offense against the ${home.id} defense, and ${home.id} offense against the ${away.id} defense, by league rank${through}: EPA per play, success rate, explosive plays, sacks, stuffs and turnovers.`;
  // 992 ordered pairs, most never played: only a scheduled pair with ranks is indexable.
  const indexable = load.state === "ready" && hasGame(load);

  // The link preview is the matchup card's picture (matchup card spec
  // 2026-10-11 §8.3): one card per game, so `ball` changes nothing. Always
  // with the season; the week only makes each week a new URL for caches. In
  // the small-pool and uncovered states the same URL draws the plate. When the
  // games could not be read no image is named: the image route answers 503
  // there rather than draw a "VS" card for a game that may be scheduled.
  const image = load.gamesAvailable
    ? `${base}${matchupCardImageHref(away.id, home.id, load.season, { week: load.model?.throughWeek ?? null })}`
    : null;

  return {
    title,
    description,
    alternates: { canonical: url },
    ...(indexable ? {} : { robots: { index: false, follow: true } }),
    openGraph: {
      title,
      description,
      url,
      type: "website",
      ...(image ? { images: [{ url: image, width: 1200, height: 630, alt: matchupCardAlt(away.name, home.name, load.season, hasGame(load)) }] } : {}),
    },
    ...(image ? { twitter: { card: "summary_large_image" as const, title, description, images: [image] } } : {}),
  };
}

// -------------------------------------------------------------------
// Page
// -------------------------------------------------------------------
const CONTAINER = "mx-auto w-full max-w-7xl min-w-0 px-3 py-6 md:px-6";
const MESSAGE = "m-0 mt-4 border border-slate-200 bg-white px-4 py-3 text-[14px] leading-relaxed text-slate-700";

export default async function MatchupPage({ params, searchParams }: PageProps) {
  const parsed = parseRequest(await params, await searchParams);
  if (!parsed) notFound(); // steps 1-2: no read
  const { away, home, requested, ball, canonicalCase } = parsed;

  // Step 4: mixed case is a permanent redirect. The query is rebuilt from the
  // validated values, never echoed, and a season the site does not list is
  // left out (no read at all unless the address names a season).
  if (!canonicalCase) {
    const season = await listedMatchupSeason(requested, `Matchup (${away.id} at ${home.id})`);
    permanentRedirect(matchupHref(away.id, home.id, { season, ball }));
  }

  // Steps 5-6. A failed core read rejects: app/matchup/error.tsx, a real 500.
  const load = await loadMatchup(away.id, home.id, requested);

  // Step 7: no game in the order asked for and one the other way round. A 307
  // (which order is scheduled depends on the season), built from the RESOLVED
  // season, with `ball` flipped so the visitor keeps the same team with the ball.
  if (load.swap) {
    redirect(matchupHref(home.id, away.id, { season: load.season, defaultSeason: load.defaultSeason, ball: flipBall(ball) }));
  }

  const { season, defaultSeason } = load;
  // The page wears the share card's colours for this pair (page colours
  // amendment 2026-10-10): one call, here, from the two teams alone (no read,
  // so every state below has them), in the order the card passes them. The
  // components take the strings; none of them works a colour out.
  const colours = matchupCardColours(away, home);
  const heading =`${away.name} ${hasGame(load) ? "at" : "vs"} ${home.name}`;
  const header = (
    <>
      <h1 className="sr-only">{heading}</h1>
      <MatchupHeader
        away={away}
        home={home}
        season={season}
        defaultSeason={defaultSeason}
        game={load.game}
        records={load.records}
        gamesAvailable={load.gamesAvailable}
        colours={colours}
      />
    </>
  );

  if (load.state === "uncovered") {
    // A listed season with no team_game_stats rows: say so (HTTP 200, noindex).
    // The lineup is loaded in every state; this page does not print it.
    return (
      <div className={CONTAINER}>
        {header}
        <div data-uncovered className={MESSAGE}>
          <p className="m-0 font-semibold text-slate-900">{matchupUncoveredHeading(season, load.firstSeason)}</p>
          <Link href={matchupHref(away.id, home.id, { ball })} className="mt-1 inline-block font-semibold text-navy underline underline-offset-2">
            {`See ${away.id} and ${home.id} in ${defaultSeason}`}
          </Link>
        </div>
      </div>
    );
  }

  const { model } = load;
  // Rates the builders refused (outside 0-1, an impossible EPA): one line, the list as it is.
  if (model.rejected.length > 0) {
    console.error(`Matchup ${away.id} at ${home.id} (${season}): values left out as impossible: ${model.rejected.join(", ")}`);
  }

  const players = <MatchupPlayers away={away} home={home} season={season} lineup={load.lineup} playersAvailable={load.playersAvailable} colours={colours} />;
  const notes = <MatchupNotes model={model} isLatestSeason={load.isLatestSeason} />;

  if (model.state === "small-pool" || !model.awayBall || !model.homeBall) {
    // Fewer than 8 teams have played: a rank among so few is noise. No tabs,
    // no ladder, no radar, no rank anywhere.
    return (
      <div className={CONTAINER}>
        {header}
        <p data-small-pool className={MESSAGE}>{MATCHUP_SMALL_POOL_NOTE}</p>
        <div className="mt-[30px]">{players}</div>
        <div className="mt-6">{notes}</div>
      </div>
    );
  }

  const idle = [
    { team: away, games: model.away.games },
    { team: home, games: model.home.games },
  ].filter((t) => t.games === 0);

  // The Share block is offered exactly when the share page is a card (matchup
  // card spec 2026-10-11 §8.2): the games were read, and the card's own model
  // says at least one of the two radars can be drawn.
  const shareCard = load.gamesAvailable && buildMatchupCard({ away, home, load }).kind === "card";
  const cardHref = matchupCardHref(away.id, home.id, { season, defaultSeason });

  // Each side of the ball's radar colours, as the card's two panes: the team
  // with the ball in its colour, the defense in the OTHER team's, one ring.
  const ring = { ringColor: colours.ring, ringWord: matchupRingWord(colours.ring) };
  const awayPaint = { offColor: colours.away, defColor: colours.home, ...ring };
  const homePaint = { offColor: colours.home, defColor: colours.away, ...ring };

  return (
    <div className={CONTAINER}>
      {header}
      {idle.map(({ team }) => (
        <p key={team.id} data-no-games-note className={MESSAGE}>{matchupNoGamesNote(team.name, season)}</p>
      ))}
      {/* In normal flow, above the tabs: it pushes them down and covers nothing.
          One card per game, so it is the same block whichever tab is open. Keyed
          by its card, so "Copied!" never carries over to another pair. */}
      {shareCard && (
        <MatchupShare
          key={cardHref}
          shareUrl={`${siteBase()}${cardHref}`}
          cardHref={cardHref}
          downloadHref={matchupCardImageHref(away.id, home.id, season, { week: model.throughWeek, download: true })}
        />
      )}
      <div className="mt-4">
        {/* Both sides are rendered here, on the server, and handed to the client
            toggle as finished markup: it shows one whole side and hides the other. */}
        <MatchupBallToggle
          awayId={away.id}
          homeId={home.id}
          season={season}
          defaultSeason={defaultSeason}
          initialBall={ball}
          away={<MatchupBallView side={model.awayBall} paint={awayPaint} />}
          home={<MatchupBallView side={model.homeBall} paint={homePaint} />}
        />
      </div>
      <div className="mt-[30px]">{players}</div>
      <div className="mt-6">{notes}</div>
    </div>
  );
}
