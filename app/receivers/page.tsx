// app/receivers/page.tsx
import type { Metadata } from "next";
import { getReceiverStats } from "@/lib/data/receivers";
import { getAvailableSeasons, getDataFreshness, fallbackSeason } from "@/lib/data/queries";
import { getAllPlayerSlugs } from "@/lib/data/players";
import DashboardShell from "@/components/layout/DashboardShell";
import ReceiverLeaderboard from "@/components/tables/ReceiverLeaderboard";

export const revalidate = 3600;

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<{ season?: string }>;
}): Promise<Metadata> {
  const { season } = await searchParams;
  const parsed = season ? parseInt(season) : NaN;
  const s = Number.isNaN(parsed) ? ((await getAvailableSeasons())[0] ?? fallbackSeason()) : parsed;
  return {
    title: `Receiver Rankings ${s}`,
    description: `NFL receiver stats with EPA/target, catch rate, YAC, air yards, and target share for the ${s} season.`,
  };
}

export default async function ReceiversPage({
  searchParams,
}: {
  searchParams: Promise<{ season?: string }>;
}) {
  const { season } = await searchParams;
  const seasons = await getAvailableSeasons();
  const parsed = season ? parseInt(season) : NaN;
  const currentSeason = Number.isNaN(parsed) ? (seasons[0] || fallbackSeason()) : parsed;

  const [data, freshness, slugs] = await Promise.all([
    getReceiverStats(currentSeason),
    getDataFreshness(currentSeason),
    getAllPlayerSlugs(),
  ]);
  const slugMap = Object.fromEntries(slugs.map((s) => [s.player_id, s.slug]));

  const throughWeek = freshness?.through_week ?? 18;

  return (
    <DashboardShell
      title="Receivers"
      seasons={seasons}
      currentSeason={currentSeason}
      freshness={freshness}
    >
      <ReceiverLeaderboard data={data} throughWeek={throughWeek} season={currentSeason} slugMap={slugMap} />
    </DashboardShell>
  );
}
