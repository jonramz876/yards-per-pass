// app/rushing/page.tsx
import type { Metadata } from "next";
import { getRBSeasonStats } from "@/lib/data/rushing";
import { getAvailableSeasons, getDataFreshness, fallbackSeason } from "@/lib/data/queries";
import { getAllPlayerSlugs } from "@/lib/data/players";
import { canonicalSeason } from "@/lib/utils";
import DashboardShell from "@/components/layout/DashboardShell";
import RBLeaderboard from "@/components/tables/RBLeaderboard";

export const revalidate = 3600;

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<{ season?: string }>;
}): Promise<Metadata> {
  const { season } = await searchParams;
  const seasons = await getAvailableSeasons();
  const parsed = season ? parseInt(season) : NaN;
  const s = Number.isNaN(parsed) ? (seasons[0] ?? fallbackSeason()) : parsed;
  const base = process.env.NEXT_PUBLIC_SITE_URL || "https://yardsperpass.com";
  const cs = canonicalSeason(season, seasons);
  return {
    title: `Rushing Stats ${s}`,
    description: `NFL rushing stats with EPA/carry, success rate, stuff rate, and explosive rate for the ${s} season.`,
    alternates: { canonical: `${base}/rushing${cs != null ? `?season=${cs}` : ""}` },
  };
}

export default async function RushingPage({
  searchParams,
}: {
  searchParams: Promise<{ season?: string }>;
}) {
  const { season } = await searchParams;
  const seasons = await getAvailableSeasons();
  const parsed = season ? parseInt(season) : NaN;
  const currentSeason = Number.isNaN(parsed) ? (seasons[0] || fallbackSeason()) : parsed;

  const [data, freshness, slugs] = await Promise.all([
    getRBSeasonStats(currentSeason),
    getDataFreshness(currentSeason),
    getAllPlayerSlugs(),
  ]);
  const slugMap = Object.fromEntries(slugs.map((s) => [s.player_id, s.slug]));

  const throughWeek = freshness?.through_week ?? 18;

  return (
    <DashboardShell
      title="Rushing"
      seasons={seasons}
      currentSeason={currentSeason}
      freshness={freshness}
    >
      <RBLeaderboard data={data} throughWeek={throughWeek} season={currentSeason} defaultSeason={seasons[0] || fallbackSeason()} slugMap={slugMap} />
    </DashboardShell>
  );
}
