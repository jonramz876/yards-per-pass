// app/team-stats/page.tsx — every team's season, added up from its box scores
// (team stats spec 2026-09-28 §5.2).
import type { Metadata } from "next";
import { getAvailableSeasons, getDataFreshness, fallbackSeason } from "@/lib/data/queries";
import { getTeamStatsSeason } from "@/lib/data/team-stats";
import { getBoxScoreSeasonsCached } from "@/lib/data/box-score";
import {
  UNCOVERED_BODY,
  buildTeamStats,
  teamStatsDescription,
  teamStatsTitle,
  uncoveredHeading,
} from "@/lib/stats/team-stats";
import DashboardShell from "@/components/layout/DashboardShell";
import TeamStatsTable from "@/components/tables/TeamStatsTable";

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

  // An uncovered season is a 200 message page: keep it out of search results,
  // like the box score's message pages. Fail-open on purpose: a probe error
  // leaves the page indexable rather than failing the metadata of a page whose
  // body may be fine; the body's own read decides whether it errors. The
  // newest season never probes.
  let covered: number[] | null = null;
  if (s !== seasons[0]) {
    try {
      covered = await getBoxScoreSeasonsCached(seasons);
    } catch (err) {
      console.error(`Team stats metadata: box score seasons probe failed for ${s}`, err);
      covered = null;
    }
  }
  const uncovered = covered !== null && !covered.includes(s);
  if (uncovered) {
    const first = covered!.length > 0 ? Math.min(...covered!) : null;
    return {
      title: teamStatsTitle(s),
      description: `${uncoveredHeading(s, first !== null && s < first ? first : null)}.`,
      robots: { index: false, follow: true },
    };
  }
  return { title: teamStatsTitle(s), description: teamStatsDescription(s) };
}

export default async function TeamStatsPage({
  searchParams,
}: {
  searchParams: Promise<{ season?: string }>;
}) {
  const { season } = await searchParams;
  const seasons = await getAvailableSeasons();
  const parsed = season ? parseInt(season) : NaN;
  const currentSeason = Number.isNaN(parsed) ? (seasons[0] || fallbackSeason()) : parsed;

  const [data, freshness] = await Promise.all([
    getTeamStatsSeason(currentSeason, seasons),
    getDataFreshness(currentSeason),
  ]);

  return (
    <DashboardShell title="Team Stats" seasons={seasons} currentSeason={currentSeason} freshness={freshness}>
      {data.state === "ready" ? (
        <TeamStatsTable
          key={currentSeason}
          model={buildTeamStats(data.rows as unknown as Record<string, unknown>[])}
          season={currentSeason}
          throughWeek={freshness?.through_week ?? null}
          isLatestSeason={currentSeason === seasons[0]}
        />
      ) : (
        <div className="text-center py-16">
          <p className="text-lg font-semibold text-navy">{uncoveredHeading(currentSeason, data.firstSeason)}</p>
          {data.firstSeason != null && <p className="mt-2 text-gray-500">{UNCOVERED_BODY}</p>}
        </div>
      )}
    </DashboardShell>
  );
}
