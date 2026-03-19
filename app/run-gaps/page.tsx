import type { Metadata } from "next";
import dynamic from "next/dynamic";
import { getRBGapStats, getAllGapData, getRBGapStatsWeekly, getDefGapStats } from "@/lib/data/run-gaps";
import { getAvailableSeasons, getDataFreshness } from "@/lib/data/queries";
import { getTeam } from "@/lib/data/teams";
import DashboardShell from "@/components/layout/DashboardShell";

export const revalidate = 3600;

const RunGapDiagram = dynamic(
  () => import("@/components/charts/RunGapDiagram"),
  {
    ssr: false,
    loading: () => (
      <div className="flex items-center justify-center" style={{ height: 400 }}>
        <div className="w-8 h-8 border-2 border-navy border-t-transparent rounded-full animate-spin" />
      </div>
    ),
  }
);

const GapHeatmap = dynamic(
  () => import("@/components/charts/GapHeatmap"),
  {
    ssr: false,
    loading: () => (
      <div className="flex items-center justify-center" style={{ height: 400 }}>
        <div className="w-8 h-8 border-2 border-navy border-t-transparent rounded-full animate-spin" />
      </div>
    ),
  }
);

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<{ season?: string; team?: string }>;
}): Promise<Metadata> {
  const { season, team } = await searchParams;
  const s = season || "2025";
  const teamName = team ? getTeam(team)?.name || team : "NFL";
  return {
    title: `${teamName} Run Gap Analysis ${s}`,
    description: `Rushing EPA broken down by offensive line gap for ${teamName}.`,
  };
}

export default async function RunGapsPage({
  searchParams,
}: {
  searchParams: Promise<{ season?: string; team?: string; gap?: string; opp?: string; situation?: string; zone?: string }>;
}) {
  const { season, team, gap, opp, situation, zone } = await searchParams;
  const seasons = await getAvailableSeasons();
  const parsed = season ? parseInt(season) : NaN;
  const currentSeason = Number.isNaN(parsed) ? (seasons[0] || 2025) : parsed;

  // Single consolidated fetch for rb_gap_stats (replaces 3 separate paginated fetches)
  const [gapStats, allData, freshness, weeklyStats, defStats] = await Promise.all([
    team ? getRBGapStats(currentSeason, team) : Promise.resolve([]),
    getAllGapData(currentSeason),
    getDataFreshness(currentSeason),
    team ? getRBGapStatsWeekly(currentSeason, team, situation || "all", zone || "all") : Promise.resolve([]),
    getDefGapStats(currentSeason),
  ]);
  const { allGapStats, teams, leagueAvgs: leagueGapData } = allData;

  return (
    <DashboardShell
      title="Run Gaps"
      seasons={seasons}
      currentSeason={currentSeason}
      freshness={freshness}
    >
      {team ? (
        <RunGapDiagram
          data={gapStats}
          weeklyData={weeklyStats}
          teams={teams}
          selectedTeam={team}
          selectedGap={gap || null}
          selectedOpp={opp || null}
          season={currentSeason}
          leagueAvgs={leagueGapData.averages}
          teamGapEpas={leagueGapData.teamGapEpas}
          defStats={defStats}
          allGapStats={allGapStats}
        />
      ) : (
        <GapHeatmap
          allGapStats={allGapStats}
          teams={teams}
        />
      )}
    </DashboardShell>
  );
}
