// components/player/PlayerOverviewRB.tsx
"use client";

import { useMemo } from "react";
import Link from "next/link";
import type { RBSeasonStat } from "@/lib/types";
import { getTeam } from "@/lib/data/teams";
import TecmoPlayerCard from "@/components/player/TecmoPlayerCard";
import { buildRBCardData, rbEligible, RB_MIN_CAR_PER_GAME } from "@/lib/stats/tecmo-card";

interface PlayerOverviewRBProps {
  stats: RBSeasonStat;
  /** Full, unfiltered RB pool for the season — buildRBCardData applies eligibility itself. */
  allRBs: RBSeasonStat[];
  season: number;
  teamId: string;
  headshotUrl?: string | null;
  jerseyNumber?: number | null;
}

export default function PlayerOverviewRB({
  stats,
  allRBs,
  season,
  teamId,
  headshotUrl = null,
  jerseyNumber = null,
}: PlayerOverviewRBProps) {
  const team = getTeam(teamId);

  const card = useMemo(() => buildRBCardData(stats, allRBs, season), [stats, allRBs, season]);

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      {!rbEligible(stats) && (
        <div className="mb-4 px-3 py-2 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-700">
          Small sample: below {RB_MIN_CAR_PER_GAME} carries per game. Percentiles are noisy and OVR is hidden.
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

      {/* Cross-link */}
      <Link
        href={`/rushing?team=${teamId}`}
        className="block rounded-xl border border-gray-200 bg-white p-4 text-center text-sm font-semibold text-navy hover:text-nflred hover:border-gray-300 transition-colors"
      >
        View {team?.name ?? teamId} Rushing &rarr;
      </Link>
    </div>
  );
}
