// components/team/GroundGameSection.tsx
"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import type { RBGapStat, DefGapStat, TeamSeasonStat, DataFreshness } from "@/lib/types";
import GapBarChart from "@/components/charts/GapBarChart";

interface GroundGameSectionProps {
  teamRBGaps: RBGapStat[];
  teamDefGaps: DefGapStat[];
  teamId: string;
  slugMap: Record<string, string>;
  allTeamStats: TeamSeasonStat[];
  season: number;
  freshness: DataFreshness | null;
}

const GAP_ORDER = ["LE", "LT", "LG", "M", "RG", "RT", "RE"];

function ordinalSuffix(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

function fmt(val: number | null, decimals = 2): string {
  if (val == null || isNaN(val)) return "\u2014";
  return val.toFixed(decimals);
}

function fmtSigned(val: number | null, decimals = 2): string {
  if (val == null || isNaN(val)) return "\u2014";
  return (val >= 0 ? "+" : "") + val.toFixed(decimals);
}

function fmtPct(val: number | null): string {
  if (val == null || isNaN(val)) return "\u2014";
  return (val * 100).toFixed(1) + "%";
}

export default function GroundGameSection({
  teamRBGaps,
  teamDefGaps: _teamDefGaps,
  teamId,
  slugMap,
  allTeamStats,
  season,
  freshness,
}: GroundGameSectionProps) {
  void _teamDefGaps; // defensive gaps not used in offense section
  const [selectedGap, setSelectedGap] = useState<string | null>(null);

  // Aggregate gap stats for the team (sum across RBs)
  const gapAgg = useMemo(() => {
    const map = new Map<string, { carries: number; epaSum: number }>();
    for (const r of teamRBGaps) {
      const prev = map.get(r.gap) ?? { carries: 0, epaSum: 0 };
      prev.carries += r.carries;
      prev.epaSum += (r.epa_per_carry ?? 0) * r.carries;
      map.set(r.gap, prev);
    }
    return GAP_ORDER.map((gap) => {
      const d = map.get(gap);
      if (!d || d.carries === 0) return { gap, carries: 0, epa_per_carry: 0 };
      return { gap, carries: d.carries, epa_per_carry: d.epaSum / d.carries };
    });
  }, [teamRBGaps]);

  const maxCarries = Math.max(...gapAgg.map((g) => g.carries), 1);

  // Best gap by EPA
  const bestGap = gapAgg.reduce(
    (best, g) => (g.carries >= 5 && g.epa_per_carry > (best?.epa_per_carry ?? -Infinity) ? g : best),
    gapAgg[0]
  );

  // Rush EPA rank
  const rushSorted = [...allTeamStats].sort((a, b) => b.off_rush_epa - a.off_rush_epa);
  const rushRank = rushSorted.findIndex((t) => t.team_id === teamId) + 1;
  const teamStat = allTeamStats.find((t) => t.team_id === teamId);
  const rushEpa = teamStat?.off_rush_epa;
  const week = freshness?.through_week ?? null;

  // Unique RBs aggregated
  const rbMap = useMemo(() => {
    const map = new Map<string, { name: string; playerId: string; carries: number; yardsSum: number; epaSum: number; successSum: number }>();
    for (const r of teamRBGaps) {
      const prev = map.get(r.player_id) ?? { name: r.player_name, playerId: r.player_id, carries: 0, yardsSum: 0, epaSum: 0, successSum: 0 };
      prev.carries += r.carries;
      prev.yardsSum += (r.yards_per_carry ?? 0) * r.carries;
      prev.epaSum += (r.epa_per_carry ?? 0) * r.carries;
      prev.successSum += (r.success_rate ?? 0) * r.carries;
      map.set(r.player_id, prev);
    }
    return Array.from(map.values())
      .map((rb) => ({
        ...rb,
        ypc: rb.carries > 0 ? rb.yardsSum / rb.carries : 0,
        epaCarry: rb.carries > 0 ? rb.epaSum / rb.carries : 0,
        successRate: rb.carries > 0 ? rb.successSum / rb.carries : 0,
      }))
      .sort((a, b) => b.carries - a.carries);
  }, [teamRBGaps]);

  return (
    <div className="bg-white rounded-xl border border-gray-100 p-6">
      <h3 className="text-lg font-bold text-navy mb-4">Ground Game</h3>

      {/* Programmatic summary */}
      {teamStat && (
        <p className="text-sm text-gray-600 mb-4">
          The rush offense ranks {ordinalSuffix(rushRank)} in EPA ({fmtSigned(rushEpa ?? null, 3)})
          {bestGap && bestGap.carries >= 5 ? `, running through the ${bestGap.gap} gap most effectively` : ""}
          {week ? ` through Week ${week}` : ""}.
        </p>
      )}

      {/* Gap mini-bar chart */}
      {gapAgg.some((g) => g.carries > 0) && (
        <div className="mb-5">
          <h4 className="text-sm font-semibold text-gray-700 mb-2">EPA by Run Gap</h4>
          <GapBarChart
            gaps={gapAgg}
            maxCarries={maxCarries}
            onGapClick={(gap) => setSelectedGap(selectedGap === gap ? null : gap)}
            selectedGap={selectedGap}
          />
        </div>
      )}

      {/* RBs table */}
      {rbMap.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-navy text-white text-xs uppercase">
                <th className="px-3 py-2 text-left font-semibold">Name</th>
                <th className="px-3 py-2 text-right font-semibold">Carries</th>
                <th className="px-3 py-2 text-right font-semibold">Yds/Carry</th>
                <th className="px-3 py-2 text-right font-semibold">EPA/Carry</th>
                <th className="px-3 py-2 text-right font-semibold">Success%</th>
              </tr>
            </thead>
            <tbody>
              {rbMap.map((rb) => (
                <tr key={rb.playerId} className="border-b border-gray-100 hover:bg-gray-50">
                  <td className="px-3 py-2 text-left font-medium">
                    <Link
                      href={`/player/${slugMap[rb.playerId] || rb.playerId}`}
                      className="text-navy hover:text-nflred hover:underline"
                    >
                      {rb.name}
                    </Link>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{rb.carries}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmt(rb.ypc, 1)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmtSigned(rb.epaCarry)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmtPct(rb.successRate)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Cross-link */}
      <Link
        href={`/run-gaps?team=${teamId}&season=${season}`}
        className="text-sm text-navy font-semibold hover:underline mt-4 inline-block"
      >
        Full Run Gap Breakdown &rarr;
      </Link>
    </div>
  );
}
