// components/team/SituationalDashboard.tsx
"use client";

import type { TeamSituationalStat } from "@/lib/types";
import { epaTextColor } from "@/lib/stats/formatters";
import { ordinal } from "@/lib/stats/percentiles";
import TecmoSectionCard from "@/components/team/TecmoSectionCard";

interface SituationalDashboardProps {
  teamStats: TeamSituationalStat[];
  allTeamStats: TeamSituationalStat[]; // all 32 teams for ranking
  teamName: string;
  primaryColor: string;
  secondaryColor: string;
}

const SITUATION_META: Record<string, { label: string; description: string }> = {
  all: { label: "All Plays", description: "Overall offensive efficiency" },
  early_down: { label: "Early Downs", description: "1st & 2nd down" },
  passing_down: { label: "Passing Downs", description: "2nd & 7+ or 3rd & 5+" },
  short_yardage: { label: "Short Yardage", description: "3rd/4th & 2 or less" },
  redzone: { label: "Red Zone", description: "Inside the 20" },
  goalline: { label: "Goal Line", description: "Inside the 5" },
  late_close: { label: "Late & Close", description: "WP 25-75%, last 15 min" },
};

const DISPLAY_ORDER = ["all", "early_down", "passing_down", "short_yardage", "redzone", "goalline", "late_close"];

function computeRank(allTeams: TeamSituationalStat[], situation: string, value: number): number {
  const pool = allTeams.filter((s) => s.situation === situation && s.team_id !== "NFL");
  const better = pool.filter((s) => s.epa_per_play > value).length;
  return better + 1;
}

// epaColor for text styling now uses shared epaTextColor from formatters

function rankColor(rank: number): string {
  if (rank <= 8) return "border-l-green-500";
  if (rank >= 25) return "border-l-red-500";
  return "border-l-gray-300";
}

// A situation with 0 rushes (or 0 passes) is stored as 'NaN'; parseNumericFields
// turns that into null, and isNaN(null) is false — so check null explicitly.
function formatPct(val: number | null): string {
  if (val == null || Number.isNaN(val)) return "—";
  return (val * 100).toFixed(0) + "%";
}

function formatEpa(val: number | null): string {
  if (val == null || Number.isNaN(val)) return "—";
  return (val >= 0 ? "+" : "") + val.toFixed(2);
}

// Horizontal bar showing rush vs pass split
function SplitBar({ rushEpa, passEpa }: { rushEpa: number; passEpa: number }) {
  // A side with zero plays arrives as null (DB 'NaN' → parseNumericFields → null).
  const hasRush = !(rushEpa == null || Number.isNaN(rushEpa));
  const hasPass = !(passEpa == null || Number.isNaN(passEpa));
  if (!hasRush && !hasPass) return null;

  const maxAbs = Math.max(Math.abs(rushEpa || 0), Math.abs(passEpa || 0), 0.15);

  return (
    <div className="flex gap-2 items-center mt-1.5">
      <div className="flex-1 flex items-center gap-1">
        <span className="text-[10px] text-gray-400 w-7 text-right shrink-0">Run</span>
        <div className="flex-1 h-3 bg-gray-100 rounded relative overflow-hidden">
          {hasRush && (
            <div
              className="absolute top-0 h-full rounded"
              style={{
                left: rushEpa >= 0 ? "50%" : undefined,
                right: rushEpa < 0 ? "50%" : undefined,
                width: `${Math.min(Math.abs(rushEpa) / maxAbs * 50, 50)}%`,
                backgroundColor: rushEpa >= 0 ? "#22c55e" : "#ef4444",
              }}
            />
          )}
          <div className="absolute left-1/2 top-0 h-full w-px bg-gray-300" />
        </div>
        <span className={`text-[10px] font-mono w-10 ${!hasRush ? "text-gray-400" : rushEpa >= 0 ? "text-green-700" : "text-red-600"}`}>
          {hasRush ? formatEpa(rushEpa) : "—"}
        </span>
      </div>
      <div className="flex-1 flex items-center gap-1">
        <span className="text-[10px] text-gray-400 w-7 text-right shrink-0">Pass</span>
        <div className="flex-1 h-3 bg-gray-100 rounded relative overflow-hidden">
          {hasPass && (
            <div
              className="absolute top-0 h-full rounded"
              style={{
                left: passEpa >= 0 ? "50%" : undefined,
                right: passEpa < 0 ? "50%" : undefined,
                width: `${Math.min(Math.abs(passEpa) / maxAbs * 50, 50)}%`,
                backgroundColor: passEpa >= 0 ? "#3b82f6" : "#ef4444",
              }}
            />
          )}
          <div className="absolute left-1/2 top-0 h-full w-px bg-gray-300" />
        </div>
        <span className={`text-[10px] font-mono w-10 ${!hasPass ? "text-gray-400" : passEpa >= 0 ? "text-blue-700" : "text-red-600"}`}>
          {hasPass ? formatEpa(passEpa) : "—"}
        </span>
      </div>
    </div>
  );
}

export default function SituationalDashboard({
  teamStats,
  allTeamStats,
  primaryColor,
  secondaryColor,
}: SituationalDashboardProps) {
  if (teamStats.length === 0) return null;

  const statMap = new Map(teamStats.map((s) => [s.situation, s]));

  return (
    <TecmoSectionCard
      title="Situational Efficiency"
      primaryColor={primaryColor}
      secondaryColor={secondaryColor}
      bodyClassName="p-6 space-y-3"
    >
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
        {DISPLAY_ORDER.map((sit) => {
          const stat = statMap.get(sit);
          const meta = SITUATION_META[sit];
          if (!stat || !meta) return null;

          const rank = computeRank(allTeamStats, sit, stat.epa_per_play);

          return (
            <div
              key={sit}
              className={`border border-gray-200 rounded-lg p-3 border-l-4 ${rankColor(rank)}`}
            >
              {/* Header */}
              <div className="flex items-start justify-between mb-1">
                <div>
                  <div className="text-sm font-bold text-gray-900">{meta.label}</div>
                  <div className="text-[10px] text-gray-400">{meta.description}</div>
                </div>
                <div className="text-right">
                  <div className="text-xs font-bold text-gray-500">
                    {ordinal(rank)}
                  </div>
                  <div className="text-[10px] text-gray-400">{stat.plays} plays</div>
                </div>
              </div>

              {/* Main EPA */}
              <div className={`text-2xl font-black tabular-nums ${epaTextColor(stat.epa_per_play)}`}>
                {formatEpa(stat.epa_per_play)}
              </div>
              <div className="text-[10px] text-gray-400 -mt-0.5 mb-1">EPA/Play</div>

              {/* Key stats row */}
              <div className="flex gap-3 text-xs">
                <div>
                  <span className="text-gray-400">SR: </span>
                  <span className="font-semibold">{formatPct(stat.success_rate)}</span>
                </div>
                <div>
                  <span className="text-gray-400">Pass%: </span>
                  <span className="font-semibold">{formatPct(stat.pass_rate)}</span>
                </div>
              </div>

              {/* Rush vs Pass split bars */}
              <SplitBar rushEpa={stat.rush_epa_per_play} passEpa={stat.pass_epa_per_play} />
            </div>
          );
        })}
      </div>
    </TecmoSectionCard>
  );
}
