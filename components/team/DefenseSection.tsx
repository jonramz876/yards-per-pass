// components/team/DefenseSection.tsx
"use client";

import { useMemo } from "react";
import type { TeamSeasonStat, DefGapStat } from "@/lib/types";

interface DefenseSectionProps {
  teamStats: TeamSeasonStat | null;
  allTeamStats: TeamSeasonStat[];
  teamDefGaps: DefGapStat[];
}

const GAP_ORDER = ["LE", "LT", "LG", "M", "RG", "RT", "RE"];

function ordinalSuffix(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

function computeRank(
  allStats: TeamSeasonStat[],
  teamId: string,
  getValue: (t: TeamSeasonStat) => number,
  ascending: boolean
): number {
  const sorted = [...allStats].sort((a, b) =>
    ascending ? getValue(a) - getValue(b) : getValue(b) - getValue(a)
  );
  return sorted.findIndex((t) => t.team_id === teamId) + 1;
}

function fmtSigned(val: number, decimals = 3): string {
  if (isNaN(val)) return "\u2014";
  return (val >= 0 ? "+" : "") + val.toFixed(decimals);
}

function fmtPct(val: number): string {
  if (isNaN(val)) return "\u2014";
  return (val * 100).toFixed(1) + "%";
}

export default function DefenseSection({
  teamStats,
  allTeamStats,
  teamDefGaps,
}: DefenseSectionProps) {
  // Defensive gap display — must be called before any early return (hooks rules)
  const gapDisplay = useMemo(() => {
    if (teamDefGaps.length === 0) return null;
    const sorted = GAP_ORDER.map((gap) => teamDefGaps.find((g) => g.gap === gap)).filter(Boolean) as DefGapStat[];
    // Most targeted gap (most carries faced)
    const mostTargeted = [...sorted].sort((a, b) => b.carries_faced - a.carries_faced)[0];
    // Best defended gap (lowest EPA — more negative is better for defense)
    const bestDefended = [...sorted].filter((g) => g.carries_faced >= 5).sort((a, b) => (a.def_epa_per_carry ?? 0) - (b.def_epa_per_carry ?? 0))[0];
    return { gaps: sorted, mostTargeted, bestDefended };
  }, [teamDefGaps]);

  if (!teamStats) {
    return (
      <div className="bg-white rounded-xl border border-gray-100 p-6">
        <h3 className="text-lg font-bold text-navy mb-4">Defense</h3>
        <p className="text-sm text-gray-400">No defensive stats available.</p>
      </div>
    );
  }

  const teamId = teamStats.team_id;

  // Defensive ranks — lower EPA is better for defense, so ascending sort
  const defEpaRank = computeRank(allTeamStats, teamId, (t) => t.def_epa_play, true);
  const defPassRank = computeRank(allTeamStats, teamId, (t) => t.def_pass_epa, true);
  const defRushRank = computeRank(allTeamStats, teamId, (t) => t.def_rush_epa, true);
  const defSrRank = computeRank(allTeamStats, teamId, (t) => t.def_success_rate, true);

  const statCards = [
    { label: "Def EPA/Play", value: fmtSigned(teamStats.def_epa_play), rank: defEpaRank },
    { label: "Def Pass EPA", value: fmtSigned(teamStats.def_pass_epa), rank: defPassRank },
    { label: "Def Rush EPA", value: fmtSigned(teamStats.def_rush_epa), rank: defRushRank },
    { label: "Def Success Rate", value: fmtPct(teamStats.def_success_rate), rank: defSrRank },
  ];

  return (
    <div className="bg-white rounded-xl border border-gray-100 p-6">
      <h3 className="text-lg font-bold text-navy mb-4">Defense</h3>

      {/* Stats grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
        {statCards.map((sc) => (
          <RankCard key={sc.label} label={sc.label} value={sc.value} rank={sc.rank} />
        ))}
      </div>

      {/* Defensive gap display */}
      {gapDisplay && (
        <div>
          <h4 className="text-sm font-semibold text-gray-700 mb-3">Run Defense by Gap</h4>

          {/* Mini summary */}
          <p className="text-sm text-gray-600 mb-3">
            {gapDisplay.mostTargeted && (
              <>Opponents target the <span className="font-semibold">{gapDisplay.mostTargeted.gap}</span> gap most ({gapDisplay.mostTargeted.carries_faced} carries).</>
            )}
            {gapDisplay.bestDefended && gapDisplay.bestDefended.gap !== gapDisplay.mostTargeted?.gap && (
              <> Best defended: <span className="font-semibold">{gapDisplay.bestDefended.gap}</span> ({fmtSigned(gapDisplay.bestDefended.def_epa_per_carry ?? 0)} EPA/carry).</>
            )}
          </p>

          {/* Gap bars */}
          <div className="space-y-1.5">
            {gapDisplay.gaps.map((g) => {
              const maxCarries = Math.max(...gapDisplay.gaps.map((x) => x.carries_faced), 1);
              const widthPct = maxCarries > 0 ? (g.carries_faced / maxCarries) * 100 : 0;
              const epa = g.def_epa_per_carry ?? 0;
              // For defense: negative EPA = good defense (green), positive = bad (red)
              const color = isNaN(epa) ? "#9ca3af" : epa < -0.02 ? "#16a34a" : epa > 0.02 ? "#dc2626" : "#f59e0b";
              return (
                <div key={g.gap} className="flex items-center gap-3 px-2 py-1">
                  <span className="w-8 text-xs font-bold text-navy">{g.gap}</span>
                  <div className="flex-1 h-5 bg-gray-100 rounded overflow-hidden">
                    <div className="h-full rounded" style={{ width: `${widthPct}%`, backgroundColor: color }} />
                  </div>
                  <span className="w-16 text-right text-xs text-gray-500">{g.carries_faced} car</span>
                  <span className="w-14 text-right text-xs font-semibold" style={{ color }}>
                    {isNaN(epa) ? "\u2014" : fmtSigned(epa, 2)}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function RankCard({ label, value, rank }: { label: string; value: string; rank: number }) {
  // Top 10 = green, 11-22 = gray, 23-32 = red
  let borderColor = "border-gray-200";
  let rankColor = "text-gray-600 bg-gray-100";
  if (rank > 0 && rank <= 10) {
    borderColor = "border-emerald-200";
    rankColor = "text-emerald-700 bg-emerald-50";
  } else if (rank > 22) {
    borderColor = "border-red-200";
    rankColor = "text-red-700 bg-red-50";
  }

  return (
    <div className={`rounded-lg border ${borderColor} p-3 text-center`}>
      <div className="text-xs text-gray-500 font-medium mb-1">{label}</div>
      <div className="text-base font-bold text-navy tabular-nums">{value}</div>
      <span className={`inline-block mt-1 px-1.5 py-0.5 text-[10px] font-bold rounded ${rankColor}`}>
        {ordinalSuffix(rank)}
      </span>
    </div>
  );
}
