// components/player/PlayerOverviewQB.tsx
"use client";

import { useMemo } from "react";
import Link from "next/link";
import type { QBSeasonStat, CrossLinkReceiver } from "@/lib/types";
import { getTeam } from "@/lib/data/teams";
import TecmoPlayerCard from "@/components/player/TecmoPlayerCard";
import { buildQBCardData, qbEligible, QB_MIN_ATT_PER_GAME } from "@/lib/stats/tecmo-card";

interface PlayerOverviewQBProps {
  stats: QBSeasonStat;
  /** Full, unfiltered QB pool for the season — buildQBCardData applies eligibility itself. */
  allQBs: QBSeasonStat[];
  season: number;
  teamId: string;
  topReceivers?: CrossLinkReceiver[];
  headshotUrl?: string | null;
  jerseyNumber?: number | null;
}

export default function PlayerOverviewQB({
  stats,
  allQBs,
  season,
  teamId,
  topReceivers = [],
  headshotUrl = null,
  jerseyNumber = null,
}: PlayerOverviewQBProps) {
  const team = getTeam(teamId);

  const card = useMemo(() => buildQBCardData(stats, allQBs, season), [stats, allQBs, season]);

  return (
    <div className="max-w-2xl lg:max-w-4xl mx-auto space-y-6">
      {!qbEligible(stats) && (
        <div className="mb-4 px-3 py-2 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-700">
          Small sample: below {QB_MIN_ATT_PER_GAME} attempts per game. Percentiles are noisy and OVR is hidden.
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

      {/* Team context: top receivers */}
      {topReceivers.length > 0 && (
        <div className="rounded-xl border border-gray-200 bg-white p-6">
          <h3 className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide mb-3">
            Throws To
          </h3>
          <div className="space-y-2">
            {topReceivers.map((r) => (
              <div key={r.player_id} className="flex items-center justify-between text-sm">
                {r.slug ? (
                  <Link href={`/player/${r.slug}`} className="text-navy hover:text-nflred hover:underline transition-colors font-medium">
                    {r.player_name}
                  </Link>
                ) : (
                  <span className="text-gray-700 font-medium">{r.player_name}</span>
                )}
                <span className="text-gray-400 text-xs tabular-nums">
                  {r.targets} tgt &middot; {r.receiving_yards} yds &middot; {r.receiving_tds} TD
                </span>
              </div>
            ))}
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
