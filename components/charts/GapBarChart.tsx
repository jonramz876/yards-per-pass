"use client";

import { epaColor } from "@/lib/stats/formatters";

interface GapData {
  gap: string;
  carries: number;
  epa_per_carry: number;
}

interface GapBarChartProps {
  gaps: GapData[];
  maxCarries: number;
  onGapClick: (gap: string) => void;
  selectedGap: string | null;
}

const GAP_ORDER = ['LE', 'LT', 'LG', 'M', 'RG', 'RT', 'RE'];

export default function GapBarChart({ gaps, maxCarries, onGapClick, selectedGap }: GapBarChartProps) {
  const sorted = GAP_ORDER.map((g) => gaps.find((d) => d.gap === g)).filter(Boolean) as GapData[];

  return (
    <div className="space-y-2">
      {sorted.map((g) => {
        const widthPct = maxCarries > 0 ? (g.carries / maxCarries) * 100 : 0;
        const color = isNaN(g.epa_per_carry) ? '#9ca3af' : epaColor(g.epa_per_carry);
        const isSelected = selectedGap === g.gap;

        return (
          <button
            key={g.gap}
            onClick={() => onGapClick(g.gap)}
            className={`w-full flex items-center gap-3 p-2 rounded-md text-left transition-colors ${
              isSelected ? 'bg-blue-50 ring-1 ring-navy' : 'hover:bg-gray-50'
            }`}
          >
            <span className="w-8 text-xs font-bold text-navy flex items-center gap-0.5">
              {g.gap}
              {g.carries < 5 && (
                <span className="text-amber-500 text-[10px]" title={`Low sample (${g.carries} carries)`}>&#9888;</span>
              )}
            </span>
            <div className="flex-1 h-6 bg-gray-100 rounded overflow-hidden">
              <div
                className="h-full rounded"
                style={{ width: `${widthPct}%`, backgroundColor: color }}
              />
            </div>
            <span className="w-16 text-right text-xs text-gray-500">{g.carries} car</span>
            <span
              className="w-14 text-right text-xs font-semibold"
              style={{ color }}
            >
              {isNaN(g.epa_per_carry) ? '—' : `${g.epa_per_carry > 0 ? '+' : ''}${g.epa_per_carry.toFixed(2)}`}
            </span>
          </button>
        );
      })}
    </div>
  );
}
