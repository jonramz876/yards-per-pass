// app/player/[slug]/page.tsx
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import { getPlayerBySlug, getQBWeeklyStats, getReceiverWeeklyStats, getRBWeeklyStats } from "@/lib/data/players";
import { getQBStats, getAvailableSeasons } from "@/lib/data/queries";
import { getReceiverStats } from "@/lib/data/receivers";
import Breadcrumbs from "@/components/ui/Breadcrumbs";
import PlayerPageContent from "@/components/player/PlayerPageContent";

export const revalidate = 3600;
export const dynamicParams = true;
export async function generateStaticParams() {
  return [];
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const player = await getPlayerBySlug(slug);
  if (!player) {
    return { title: "Player Not Found — Yards Per Pass" };
  }
  return {
    title: `${player.player_name} Stats — ${player.position} | Yards Per Pass`,
    description: `${player.player_name} advanced stats, game log, and performance metrics for the NFL ${player.position}.`,
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
        { label: "Run Gaps", href: "/run-gaps" },
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

  // Fetch position-specific data in parallel
  let seasonStats: unknown[] = [];
  let weeklyStats: unknown[] = [];
  let allPlayers: unknown[] = [];

  if (player.position === "QB") {
    const [allQBs, weekly] = await Promise.all([
      getQBStats(currentSeason),
      getQBWeeklyStats(player.player_id, currentSeason),
    ]);
    const playerSeason = allQBs.filter((qb) => qb.player_id === player.player_id);
    seasonStats = playerSeason;
    weeklyStats = weekly;
    allPlayers = allQBs;
  } else if (player.position === "WR" || player.position === "TE") {
    const [allReceivers, weekly] = await Promise.all([
      getReceiverStats(currentSeason),
      getReceiverWeeklyStats(player.player_id, currentSeason),
    ]);
    const playerSeason = allReceivers.filter((r) => r.player_id === player.player_id);
    seasonStats = playerSeason;
    weeklyStats = weekly;
    allPlayers = allReceivers;
  } else if (player.position === "RB") {
    const weekly = await getRBWeeklyStats(player.player_id, currentSeason);
    seasonStats = [];
    weeklyStats = weekly;
    allPlayers = [];
  }

  const breadcrumbs = getBreadcrumbs(player.position, player.player_name);

  return (
    <div className="max-w-7xl mx-auto px-6 md:px-12 py-8">
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
        />
      </Suspense>
    </div>
  );
}
