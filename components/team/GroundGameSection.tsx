// components/team/GroundGameSection.tsx
"use client";

import type { RBGapStat, DefGapStat } from "@/lib/types";

interface GroundGameSectionProps {
  teamRBGaps: RBGapStat[];
  teamDefGaps: DefGapStat[];
  teamId: string;
}

export default function GroundGameSection({
  teamRBGaps,
  teamDefGaps,
  teamId: _teamId,
}: GroundGameSectionProps) {
  void _teamId; // used in Part 2
  // Count unique RBs
  const uniqueRBs = new Set(teamRBGaps.map((r) => r.player_id)).size;

  return (
    <div className="rounded-lg border border-gray-200 p-6">
      <h3 className="text-lg font-bold text-navy mb-2">Ground Game</h3>
      <p className="text-sm text-gray-400">
        {uniqueRBs} RB{uniqueRBs !== 1 ? "s" : ""},{" "}
        {teamRBGaps.length} gap stat{teamRBGaps.length !== 1 ? "s" : ""},{" "}
        {teamDefGaps.length} defensive gap stat{teamDefGaps.length !== 1 ? "s" : ""}
      </p>
      <p className="text-sm text-gray-400 mt-1">Coming in Part 2</p>
    </div>
  );
}
