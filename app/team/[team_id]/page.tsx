// app/team/[team_id]/page.tsx
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { NFL_TEAMS, getTeam } from "@/lib/data/teams";
import { getTeamHubData } from "@/lib/data/team-hub";
import { getAvailableSeasons } from "@/lib/data/queries";
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
  const parsed = season ? parseInt(season) : NaN;
  const currentSeason = Number.isNaN(parsed) ? (seasons[0] || 2025) : parsed;

  const data = await getTeamHubData(teamId, currentSeason);

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
      />
    </>
  );
}
