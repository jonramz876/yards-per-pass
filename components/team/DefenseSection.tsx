// components/team/DefenseSection.tsx
"use client";

import type { TeamSeasonStat, DefGapStat } from "@/lib/types";

interface DefenseSectionProps {
  teamStats: TeamSeasonStat | null;
  teamDefGaps: DefGapStat[];
}

export default function DefenseSection({
  teamStats,
  teamDefGaps,
}: DefenseSectionProps) {
  return (
    <div className="rounded-lg border border-gray-200 p-6">
      <h3 className="text-lg font-bold text-navy mb-2">Defense</h3>
      <p className="text-sm text-gray-400">
        {teamStats ? "Team stats loaded" : "No team stats"},{" "}
        {teamDefGaps.length} defensive gap stat{teamDefGaps.length !== 1 ? "s" : ""}
      </p>
      <p className="text-sm text-gray-400 mt-1">Coming in Part 2</p>
    </div>
  );
}
