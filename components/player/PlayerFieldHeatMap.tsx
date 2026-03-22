// components/player/PlayerFieldHeatMap.tsx (stub — replaced in Task 6)
"use client";
import type { QBPassLocationStat } from "@/lib/types";
export default function PlayerFieldHeatMap({ stats, playerName, season }: { stats: QBPassLocationStat[]; playerName: string; season: number }) {
  return <div className="text-gray-400 text-center py-12">Field Heat Map — coming soon ({stats.length} zones, {playerName}, {season})</div>;
}
