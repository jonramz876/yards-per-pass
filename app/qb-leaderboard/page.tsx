// app/qb-leaderboard/page.tsx
import type { Metadata } from "next";
import DashboardShell from "@/components/layout/DashboardShell";
import QBLeaderboard from "@/components/tables/QBLeaderboard";
import { getQBStats, getDataFreshness, getAvailableSeasons } from "@/lib/data/queries";

export const revalidate = 3600;

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<{ season?: string }>;
}): Promise<Metadata> {
  const { season } = await searchParams;
  const s = season || "2025";
  return {
    title: `QB Rankings ${s}`,
    description: `NFL quarterback rankings by EPA, CPOE, success rate, and 10+ advanced metrics for the ${s} season.`,
  };
}

export default async function QBLeaderboardPage({
  searchParams,
}: {
  searchParams: Promise<{ season?: string }>;
}) {
  const { season } = await searchParams;
  const seasons = await getAvailableSeasons();
  const currentSeason = season ? parseInt(season) : (seasons[0] || 2025);
  const [qbStats, freshness] = await Promise.all([
    getQBStats(currentSeason),
    getDataFreshness(),
  ]);

  return (
    <DashboardShell
      title="QB Rankings"
      seasons={seasons}
      currentSeason={currentSeason}
      freshness={freshness}
    >
      {qbStats.length === 0 ? (
        <div className="text-center py-16 text-gray-500">
          No data available for the {currentSeason} season yet.
        </div>
      ) : (
        <QBLeaderboard
          data={qbStats}
          throughWeek={freshness?.through_week ?? 18}
        />
      )}
    </DashboardShell>
  );
}
