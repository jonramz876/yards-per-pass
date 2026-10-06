// app/team/[team_id]/page.tsx
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { NFL_TEAMS, getTeam } from "@/lib/data/teams";
import { getTeamHubData } from "@/lib/data/team-hub";
import { getAvailableSeasons, fallbackSeason } from "@/lib/data/queries";
import { getBoxScoreSeasonsCached } from "@/lib/data/box-score";
import { hasNoDatabase } from "@/lib/supabase/server";
import { parseSeasonParam } from "@/lib/stats/team-stats";
import TeamHubContent from "@/components/team/TeamHubContent";

export const revalidate = 3600;
export const dynamicParams = true;

export async function generateStaticParams() {
  return NFL_TEAMS.map((team) => ({ team_id: team.id }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ team_id: string }>;
}): Promise<Metadata> {
  const { team_id } = await params;
  const base = process.env.NEXT_PUBLIC_SITE_URL || "https://yardsperpass.com";
  const teamId = team_id.toUpperCase();
  const team = getTeam(teamId);
  if (!team) {
    return { title: "Team Not Found — Yards Per Pass" };
  }
  return {
    title: `${team.name} Stats | Yards Per Pass`,
    description: `${team.name} advanced stats, EPA rankings, passing attack, ground game, and defensive metrics.`,
    alternates: {
      canonical: `${base}/team/${teamId}`,
    },
  };
}

export default async function TeamPage({
  params,
  searchParams,
}: {
  params: Promise<{ team_id: string }>;
  searchParams: Promise<{ season?: string }>;
}) {
  const { team_id } = await params;
  const teamId = team_id.toUpperCase();
  const team = getTeam(teamId);
  if (!team) notFound();

  const { season } = await searchParams;
  const seasons = await getAvailableSeasons();
  // An implausible ?season= (outside 1999-2100, or not a number) is treated as
  // absent, so it can never reach the database: the season columns are
  // INTEGER, and ?season=99999999999 made the hub's reads fail, which since
  // those reads became core showed the error card for a mistyped link.
  const currentSeason = parseSeasonParam(season) ?? (seasons[0] || fallbackSeason());

  // getAvailableSeasons throws on a query error (the route's error card
  // shows), so [] is a table with no rows. A real database always has
  // data_freshness rows, so that is broken too: throw rather than render a
  // team page on a guessed season (the homepage's rule). Only with no
  // database at all (CI / local placeholder build) does the fallback stand.
  if (seasons.length === 0 && !hasNoDatabase()) {
    throw new Error("Team page: no seasons from data_freshness (table empty)");
  }

  // Only the latest season pre-surfaces next season's schedule. The box score
  // link gate (spec §7) is fetched here — TeamHubContent is a client
  // component — and passed down as a plain array.
  //
  // This route is dynamic, not ISR: it reads searchParams, so it renders on
  // every request (the build prerenders no team HTML despite
  // generateStaticParams). The probe is therefore memoised for an hour rather
  // than costing one limit(1) query per covered season on every view. A failed
  // probe logs and renders no links this render — a rejection is never
  // memoised, so the next render retries — never a crash. It is the one read
  // here that may degrade; getTeamHubData rejects when a core read fails
  // (read resilience spec §1.2) and that reaches error.tsx.
  //
  // try/catch, not .catch(): a .catch() hangs off the call's RETURN value, so a
  // throw that happens BEFORE the promise exists escapes it and 500s the whole
  // team hub with nothing logged. That was safe only by the probe's `async`
  // keyword — one refactor away from an outage. The Game Log hit this exact
  // bug in an earlier PR and was fixed the same way.
  const [data, boxScoreSeasons] = await Promise.all([
    getTeamHubData(teamId, currentSeason, currentSeason === seasons[0]),
    (async (): Promise<number[]> => {
      try {
        return await getBoxScoreSeasonsCached(seasons);
      } catch (err: unknown) {
        console.error(`Team page: box score seasons unavailable for ${teamId}; schedule tiles will not link`, err);
        return [];
      }
    })(),
  ]);

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "SportsTeam",
    "name": team.name,
    "sport": "American Football",
    "url": `${process.env.NEXT_PUBLIC_SITE_URL || "https://yardsperpass.com"}/team/${team.id}`,
    "memberOf": {
      "@type": "SportsOrganization",
      "name": "National Football League",
    },
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <TeamHubContent
        team={team}
        data={data}
        boxScoreSeasons={boxScoreSeasons}
        defaultSeason={seasons[0] || fallbackSeason()}
      />
    </>
  );
}
