import type { Metadata } from "next";
import { getAvailableSeasons, getDataFreshness } from "@/lib/data/queries";
import { getAllPlayerSlugs } from "@/lib/data/players";
import { getAllSurgeData, SURGE_STATS } from "@/lib/data/trends";
import DashboardShell from "@/components/layout/DashboardShell";
import SurgeDetector from "@/components/trends/SurgeDetector";
import type { PlayerSlug } from "@/lib/types";
import type { WeeklyValue } from "@/lib/stats/surge";

export const revalidate = 3600;

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<{ season?: string }>;
}): Promise<Metadata> {
  const { season } = await searchParams;
  const s = season || "2025";
  return {
    title: `Stat Surge Detector ${s}`,
    description: `Identify NFL players surging or collapsing based on z-score analysis of recent vs. season performance for the ${s} season.`,
  };
}

export default async function TrendsPage({
  searchParams,
}: {
  searchParams: Promise<{ season?: string }>;
}) {
  const { season } = await searchParams;
  const seasons = await getAvailableSeasons();
  const parsed = season ? parseInt(season) : NaN;
  const currentSeason = Number.isNaN(parsed) ? (seasons[0] || 2025) : parsed;

  const [freshness, slugs] = await Promise.all([
    getDataFreshness(currentSeason),
    getAllPlayerSlugs(),
  ]);

  // Build slug lookup map
  const slugMap = new Map<string, PlayerSlug>();
  for (const s of slugs) {
    slugMap.set(s.player_id, s);
  }

  // Fetch all weekly data in parallel (one request per table, not per stat)
  const surgeDataMap = await getAllSurgeData(currentSeason, slugMap);

  // Convert Map to plain object for RSC → client serialization
  const surgeData: Record<string, WeeklyValue[]> = {};
  surgeDataMap.forEach((values, key) => {
    surgeData[key] = values;
  });

  return (
    <DashboardShell
      title="Stat Surge Detector"
      seasons={seasons}
      currentSeason={currentSeason}
      freshness={freshness}
    >
      <SurgeDetector surgeData={surgeData} stats={SURGE_STATS} />
    </DashboardShell>
  );
}
