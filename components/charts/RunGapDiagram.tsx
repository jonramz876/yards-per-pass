"use client";

import type { RBGapStat } from "@/lib/types";

interface RunGapDiagramProps {
  data: RBGapStat[];
  teams: string[];
  selectedTeam: string | null;
  selectedGap: string | null;
  season: number;
}

export default function RunGapDiagram({
  data,
  teams,
  selectedTeam,
  selectedGap,
  season,
}: RunGapDiagramProps) {
  return (
    <div className="text-center py-16 text-gray-400">
      Run Gap Diagram — {data.length} rows loaded for {selectedTeam || "no team"} ({season})
      {selectedGap && ` | Gap: ${selectedGap}`} | {teams.length} teams available
    </div>
  );
}
