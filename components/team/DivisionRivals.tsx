// components/team/DivisionRivals.tsx
"use client";

import type { TeamSeasonStat } from "@/lib/types";

interface DivisionRivalsProps {
  allTeamStats: TeamSeasonStat[];
  division: string;
  currentTeamId: string;
}

export default function DivisionRivals({
  allTeamStats,
  division,
  currentTeamId: _currentTeamId,
}: DivisionRivalsProps) {
  void _currentTeamId; // used in Part 2

  const divisionLabel = division;

  return (
    <div className="rounded-lg border border-gray-200 p-6">
      <h3 className="text-lg font-bold text-navy mb-2">{divisionLabel}</h3>
      <p className="text-sm text-gray-400">
        {allTeamStats.length} total teams loaded
      </p>
      <p className="text-sm text-gray-400 mt-1">Coming in Part 2</p>
    </div>
  );
}
