// app/team-stats/page.tsx — every team's season, added up from its box scores
// (team stats spec 2026-09-28 §5.2).
import type { Metadata } from "next";
import { getAvailableSeasons, getDataFreshness, fallbackSeason } from "@/lib/data/queries";
import { getTeamStatsSeason } from "@/lib/data/team-stats";
import { getBoxScoreSeasonsCached } from "@/lib/data/box-score";
import { canonicalSeason } from "@/lib/utils";
import {
  UNCOVERED_BODY,
  buildTeamStats,
  parseSeasonParam,
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
  const s = parseSeasonParam(season) ?? seasons[0] ?? fallbackSeason();
  // The canonical the other season pages got in PR #24: bare, or ?season= for
  // a real past season in data_freshness.
  const base = process.env.NEXT_PUBLIC_SITE_URL || "https://yardsperpass.com";
  const cs = canonicalSeason(season, seasons);
  const alternates = { canonical: `${base}/team-stats${cs != null ? `?season=${cs}` : ""}` };

  // No seasons from data_freshness: coverage is unknown. The body throws only
  // if the team_game_stats read is also empty (J4); otherwise it renders the
  // table for this season with no meta description. Either way the metadata
  // makes no claim: title only, no probe, no noindex.
  if (seasons.length === 0) return { title: teamStatsTitle(s), alternates };

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
      alternates,
    };
  }
  return { title: teamStatsTitle(s), description: teamStatsDescription(s), alternates };
}

export default async function TeamStatsPage({
  searchParams,
}: {
  searchParams: Promise<{ season?: string }>;
}) {
  const { season } = await searchParams;
  const seasons = await getAvailableSeasons();
  // An implausible ?season= (outside 1999-2100) is treated as absent, here and
  // in generateMetadata, so it can never reach the database.
  const currentSeason = parseSeasonParam(season) ?? (seasons[0] || fallbackSeason());

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
