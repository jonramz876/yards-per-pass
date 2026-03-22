// app/player/[slug]/page.tsx
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import { getPlayerBySlug, getQBWeeklyStats, getReceiverWeeklyStats, getRBWeeklyStats, getAllRBWeeklyStats, getTeamTopReceivers, getTeamStartingQB, getQBPassLocationStats } from "@/lib/data/players";
import type { QBPassLocationStat } from "@/lib/types";
import { getQBStats, getAvailableSeasons } from "@/lib/data/queries";
import { getReceiverStats } from "@/lib/data/receivers";
import { getTeam } from "@/lib/data/teams";
import Breadcrumbs from "@/components/ui/Breadcrumbs";
import PlayerPageContent from "@/components/player/PlayerPageContent";

export const revalidate = 3600;
export const dynamicParams = true;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const player = await getPlayerBySlug(slug);
  const base = process.env.NEXT_PUBLIC_SITE_URL || "https://yardsperpass.com";
  if (!player) {
    return { title: "Player Not Found — Yards Per Pass" };
  }
  return {
    title: `${player.player_name} Stats — ${player.position} | Yards Per Pass`,
    description: `${player.player_name} advanced stats, game log, and performance metrics for the NFL ${player.position}.`,
    alternates: {
      canonical: `${base}/player/${slug}`,
    },
  };
}

function getBreadcrumbs(position: string, playerName: string) {
  switch (position) {
    case "QB":
      return [
        { label: "QB Rankings", href: "/qb-leaderboard" },
        { label: playerName },
      ];
    case "WR":
    case "TE":
      return [
        { label: "Receivers", href: "/receivers" },
        { label: playerName },
      ];
    case "RB":
      return [
        { label: "Rushing", href: "/rushing" },
        { label: playerName },
      ];
    default:
      return [
        { label: "Home", href: "/" },
        { label: playerName },
      ];
  }
}

export default async function PlayerPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ season?: string; tab?: string }>;
}) {
  const { slug } = await params;
  const { season, tab } = await searchParams;

  // Redirect uppercase slugs to lowercase
  if (slug !== slug.toLowerCase()) {
    const sp = new URLSearchParams();
    if (season) sp.set("season", season);
    if (tab) sp.set("tab", tab);
    const qs = sp.toString();
    redirect(`/player/${slug.toLowerCase()}${qs ? `?${qs}` : ""}`);
  }

  const player = await getPlayerBySlug(slug);
  if (!player) notFound();

  const seasons = await getAvailableSeasons();
  const parsed = season ? parseInt(season) : NaN;
  const currentSeason = Number.isNaN(parsed) ? (seasons[0] || 2025) : parsed;

  // Fetch position-specific data in parallel — catch errors so page doesn't 500
  let seasonStats: unknown[] = [];
  let weeklyStats: unknown[] = [];
  let allPlayers: unknown[] = [];
  let crossLinkReceivers: Awaited<ReturnType<typeof getTeamTopReceivers>> = [];
  let crossLinkQB: Awaited<ReturnType<typeof getTeamStartingQB>> = null;
  let passLocationStats: QBPassLocationStat[] = [];

  try {
    if (player.position === "QB") {
      const [allQBs, weekly, teamReceivers, passLocStats] = await Promise.all([
        getQBStats(currentSeason).catch(() => []),
        getQBWeeklyStats(player.player_id, currentSeason),
        getTeamTopReceivers(player.current_team_id, currentSeason, 5).catch(() => []),
        getQBPassLocationStats(player.player_id, currentSeason).catch(() => []),
      ]);
      const playerSeason = allQBs.filter((qb) => qb.player_id === player.player_id);
      seasonStats = playerSeason;
      weeklyStats = weekly;
      // Filter percentile pool to qualified QBs (100+ dropbacks) to avoid backup QB noise
      allPlayers = allQBs.filter((qb) => qb.dropbacks >= 100);
      crossLinkReceivers = teamReceivers;
      passLocationStats = passLocStats;
    } else if (player.position === "WR" || player.position === "TE") {
      const [allReceivers, weekly, teamQB] = await Promise.all([
        getReceiverStats(currentSeason).catch(() => []),
        getReceiverWeeklyStats(player.player_id, currentSeason),
        getTeamStartingQB(player.current_team_id, currentSeason).catch(() => null),
      ]);
      const playerSeason = allReceivers.filter((r) => r.player_id === player.player_id);
      seasonStats = playerSeason;
      weeklyStats = weekly;
      allPlayers = allReceivers;
      crossLinkQB = teamQB;
    } else if (player.position === "RB") {
      const [weekly, allRBWeekly] = await Promise.all([
        getRBWeeklyStats(player.player_id, currentSeason),
        getAllRBWeeklyStats(currentSeason),
      ]);
      seasonStats = [];
      weeklyStats = weekly;
      allPlayers = allRBWeekly;
    }
  } catch {
    // Data fetch failed — page will render with empty data
  }

  const breadcrumbs = getBreadcrumbs(player.position, player.player_name);

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Person",
    "name": player.player_name,
    "url": `${process.env.NEXT_PUBLIC_SITE_URL || "https://yardsperpass.com"}/player/${player.slug}`,
    "affiliation": {
      "@type": "SportsTeam",
      "name": getTeam(player.current_team_id)?.name || player.current_team_id,
    },
  };

  return (
    <div className="max-w-7xl mx-auto px-6 md:px-12 py-8">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <Breadcrumbs items={breadcrumbs} />
      <Suspense fallback={null}>
        <PlayerPageContent
          player={player}
          seasonStats={seasonStats}
          weeklyStats={weeklyStats}
          allPlayers={allPlayers}
          season={currentSeason}
          seasons={seasons}
          position={player.position}
          tab={tab || "overview"}
          crossLinkReceivers={crossLinkReceivers}
          crossLinkQB={crossLinkQB}
          passLocationStats={passLocationStats}
        />
      </Suspense>
    </div>
  );
}
