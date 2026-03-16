// app/teams/page.tsx
import dynamic from "next/dynamic";
import type { Metadata } from "next";
import DashboardShell from "@/components/layout/DashboardShell";
import MobileTeamList from "@/components/charts/MobileTeamList";
import { getTeamStats, getDataFreshness, getAvailableSeasons } from "@/lib/data/queries";

// CRITICAL: D3 accesses window/document — must disable SSR
const TeamScatterPlot = dynamic(
  () => import("@/components/charts/TeamScatterPlot"),
  {
    ssr: false,
    loading: () => (
      <div className="flex items-center justify-center bg-gray-50 rounded-md border border-gray-200" style={{ height: 560 }}>
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-navy border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          <p className="text-sm text-gray-400">Loading chart...</p>
        </div>
      </div>
    ),
  }
);

export const revalidate = 3600; // Revalidate hourly

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<{ season?: string }>;
}): Promise<Metadata> {
  const { season } = await searchParams;
  const s = season || "2025";
  return {
    title: `NFL Team Tiers ${s}`,
    description: `See where all 32 NFL teams rank by offensive and defensive EPA for the ${s} season.`,
  };
}

export default async function TeamsPage({
  searchParams,
}: {
  searchParams: Promise<{ season?: string }>;
}) {
  const { season } = await searchParams;
  const seasons = await getAvailableSeasons();
  const parsed = season ? parseInt(season) : NaN;
  const currentSeason = Number.isNaN(parsed) ? (seasons[0] || 2025) : parsed;
  const [teamStats, freshness] = await Promise.all([
    getTeamStats(currentSeason),
    getDataFreshness(currentSeason),
  ]);

  return (
    <DashboardShell
      title="Team Tiers"
      seasons={seasons}
      currentSeason={currentSeason}
      freshness={freshness}
    >
      {teamStats.length === 0 ? (
        <div className="text-center py-16 text-gray-500">
          No data available for the {currentSeason} season yet.
        </div>
      ) : (
        <>
          {/* Desktop: D3 scatter plot */}
          <div className="hidden md:block">
            <TeamScatterPlot data={teamStats} />
          </div>
          {/* Mobile: sorted list */}
          <div className="md:hidden">
            <MobileTeamList data={teamStats} />
          </div>
          <p className="mt-3 text-xs text-gray-400">
            EPA values are not adjusted for strength of schedule. Teams that played easier schedules may appear stronger than their true level.
          </p>
        </>
      )}
    </DashboardShell>
  );
}
