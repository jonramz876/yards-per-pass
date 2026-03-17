import type { Metadata } from "next";
import dynamic from "next/dynamic";
import { getRBGapStats, getTeamsWithGapData, getLeagueGapAverages, getRBGapStatsWeekly, getDefGapStats } from "@/lib/data/run-gaps";
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

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<{ season?: string; team?: string }>;
}): Promise<Metadata> {
  const { season, team } = await searchParams;
  const s = season || "2025";
  const teamName = team ? getTeam(team)?.name || team : "NFL";
  return {
    title: `${teamName} Run Gap Analysis ${s} | Yards Per Pass`,
    description: `Rushing EPA broken down by offensive line gap for ${teamName}.`,
  };
}

export default async function RunGapsPage({
  searchParams,
}: {
  searchParams: Promise<{ season?: string; team?: string; gap?: string; opp?: string }>;
}) {
  const { season, team, gap, opp } = await searchParams;
  const seasons = await getAvailableSeasons();
  const parsed = season ? parseInt(season) : NaN;
  const currentSeason = Number.isNaN(parsed) ? (seasons[0] || 2025) : parsed;

  const [gapStats, teams, freshness, leagueGapData, weeklyStats, defStats] = await Promise.all([
    team ? getRBGapStats(currentSeason, team) : Promise.resolve([]),
    getTeamsWithGapData(currentSeason),
    getDataFreshness(currentSeason),
    getLeagueGapAverages(currentSeason),
    team ? getRBGapStatsWeekly(currentSeason, team) : Promise.resolve([]),
    getDefGapStats(currentSeason),
  ]);

  return (
    <DashboardShell
      title="Run Gaps"
      seasons={seasons}
      currentSeason={currentSeason}
      freshness={freshness}
    >
      <RunGapDiagram
        data={gapStats}
        weeklyData={weeklyStats}
        teams={teams}
        selectedTeam={team || null}
        selectedGap={gap || null}
        selectedOpp={opp || null}
        season={currentSeason}
        leagueAvgs={leagueGapData.averages}
        teamGapEpas={leagueGapData.teamGapEpas}
        defStats={defStats}
      />
    </DashboardShell>
  );
}
