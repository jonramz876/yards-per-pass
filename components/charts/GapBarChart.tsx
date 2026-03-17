"use client";

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
        const color = isNaN(g.epa_per_carry) ? '#9ca3af' : g.epa_per_carry > 0.02 ? '#16a34a' : g.epa_per_carry < -0.02 ? '#dc2626' : '#f59e0b';
        const isSelected = selectedGap === g.gap;

        return (
          <button
            key={g.gap}
            onClick={() => onGapClick(g.gap)}
            className={`w-full flex items-center gap-3 p-2 rounded-md text-left transition-colors ${
              isSelected ? 'bg-blue-50 ring-1 ring-navy' : 'hover:bg-gray-50'
            }`}
          >
            <span className="w-8 text-xs font-bold text-navy">{g.gap}</span>
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
