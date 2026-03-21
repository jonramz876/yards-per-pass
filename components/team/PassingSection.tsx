// components/team/PassingSection.tsx
"use client";

import type { QBSeasonStat, ReceiverSeasonStat } from "@/lib/types";

interface PassingSectionProps {
  teamQBs: QBSeasonStat[];
  teamReceivers: ReceiverSeasonStat[];
  slugMap: Record<string, string>;
}

export default function PassingSection({
  teamQBs,
  teamReceivers,
  slugMap: _slugMap,
}: PassingSectionProps) {
  void _slugMap; // used in Part 2
  return (
    <div className="rounded-lg border border-gray-200 p-6">
      <h3 className="text-lg font-bold text-navy mb-2">Passing Attack</h3>
      <p className="text-sm text-gray-400">
        {teamQBs.length} QB{teamQBs.length !== 1 ? "s" : ""},{" "}
        {teamReceivers.length} receiver{teamReceivers.length !== 1 ? "s" : ""}
      </p>
      <p className="text-sm text-gray-400 mt-1">Coming in Part 2</p>
    </div>
  );
}
