// components/player/PlayerOverviewWR.tsx
"use client";

import { useMemo } from "react";
import Link from "next/link";
import type { ReceiverSeasonStat, CrossLinkQB } from "@/lib/types";
import { getTeam } from "@/lib/data/teams";
import TecmoPlayerCard from "@/components/player/TecmoPlayerCard";
import { buildWRCardData, wrEligible, WR_MIN_TGT_PER_GAME } from "@/lib/stats/tecmo-card";

interface PlayerOverviewWRProps {
  stats: ReceiverSeasonStat;
  /** Full, unfiltered receiver pool for the season — buildWRCardData applies eligibility and position matching itself. */
  allReceivers: ReceiverSeasonStat[];
  season: number;
  teamId: string;
  teamQBData?: CrossLinkQB;
  headshotUrl?: string | null;
  jerseyNumber?: number | null;
}

export default function PlayerOverviewWR({
  stats,
  allReceivers,
  season,
  teamId,
  teamQBData,
  headshotUrl = null,
  jerseyNumber = null,
}: PlayerOverviewWRProps) {
  const team = getTeam(teamId);

  const card = useMemo(
    () => buildWRCardData(stats, allReceivers, season),
    [stats, allReceivers, season]
  );

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      {!wrEligible(stats) && (
        <div className="mb-4 px-3 py-2 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-700">
          Small sample: below {WR_MIN_TGT_PER_GAME} targets per game. Percentiles are noisy and OVR is hidden.
        </div>
      )}

      <TecmoPlayerCard
        data={card}
        teamName={team?.name ?? teamId}
        teamId={teamId}
        primaryColor={team?.primaryColor || "#0f172a"}
        secondaryColor={team?.secondaryColor || "#334155"}
        headshotUrl={headshotUrl}
        jerseyNumber={jerseyNumber}
      />

      {/* Team context: QB */}
      {teamQBData && (
        <div className="rounded-xl border border-gray-200 bg-white p-6">
          <h3 className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide mb-3">
            Catches From
          </h3>
          <div className="flex items-center justify-between text-sm">
            {teamQBData.slug ? (
              <Link href={`/player/${teamQBData.slug}`} className="text-navy hover:text-nflred hover:underline transition-colors font-medium">
                {teamQBData.player_name}
              </Link>
            ) : (
              <span className="text-gray-700 font-medium">{teamQBData.player_name}</span>
            )}
            <span className="text-gray-400 text-xs tabular-nums">
              {teamQBData.passing_yards} yds &middot; {teamQBData.touchdowns} TD
            </span>
          </div>
        </div>
      )}

      {/* Cross-link to team hub */}
      <Link
        href={`/team/${teamId}`}
        className="block rounded-xl border border-gray-200 bg-white p-4 text-center text-sm font-semibold text-navy hover:text-nflred hover:border-gray-300 transition-colors"
      >
        View {team?.name ?? teamId} Hub &rarr;
      </Link>
    </div>
  );
}
