// components/team/TeamIdentityCard.tsx
"use client";

import Image from "next/image";
import type { Team, TeamSeasonStat } from "@/lib/types";

interface TeamIdentityCardProps {
  team: Team;
  teamStats: TeamSeasonStat | null;
  allTeamStats: TeamSeasonStat[];
}

function ordinalSuffix(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

function computeRank(
  allStats: TeamSeasonStat[],
  teamId: string,
  getValue: (t: TeamSeasonStat) => number,
  ascending: boolean = false
): number {
  const sorted = [...allStats].sort((a, b) =>
    ascending ? getValue(a) - getValue(b) : getValue(b) - getValue(a)
  );
  const idx = sorted.findIndex((t) => t.team_id === teamId);
  return idx >= 0 ? idx + 1 : 0;
}

export default function TeamIdentityCard({
  team,
  teamStats,
  allTeamStats,
}: TeamIdentityCardProps) {
  const record = teamStats
    ? `${teamStats.wins}-${teamStats.losses}${teamStats.ties > 0 ? `-${teamStats.ties}` : ""}`
    : null;

  // Offensive EPA rank: higher is better
  const offEpaRank = teamStats
    ? computeRank(allTeamStats, team.id, (t) => t.off_epa_play, false)
    : 0;

  // Defensive EPA rank: lower (more negative) is better
  const defEpaRank = teamStats
    ? computeRank(allTeamStats, team.id, (t) => t.def_epa_play, true)
    : 0;

  return (
    <div className="rounded-lg border border-gray-200 overflow-hidden">
      {/* Team-colored accent bar */}
      <div className="h-1.5" style={{ backgroundColor: team.primaryColor }} />

      <div className="p-6 flex flex-col sm:flex-row sm:items-center gap-6">
        {/* Team logo */}
        <div className="flex-shrink-0">
          <Image
            src={team.logo}
            alt={team.name}
            width={80}
            height={80}
            className="object-contain"
          />
        </div>

        {/* Team info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3 flex-wrap">
            <h2 className="text-2xl font-extrabold text-navy tracking-tight">
              {team.name}
            </h2>
            {record && (
              <span className="inline-flex items-center px-2.5 py-0.5 text-sm font-semibold text-gray-600 bg-gray-100 rounded-full">
                {record}
              </span>
            )}
          </div>

          {/* Division / Conference labels */}
          <div className="flex items-center gap-3 mt-2">
            <span className="text-sm text-gray-500">{team.conference}</span>
            <span className="text-gray-300">&middot;</span>
            <span className="text-sm text-gray-500">{team.division}</span>
          </div>

          {/* EPA rank badges */}
          {teamStats && (
            <div className="flex items-center gap-3 mt-3 flex-wrap">
              <EpaRankBadge
                label="Off EPA"
                rank={offEpaRank}
                value={teamStats.off_epa_play}
              />
              <EpaRankBadge
                label="Def EPA"
                rank={defEpaRank}
                value={teamStats.def_epa_play}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function EpaRankBadge({
  label,
  rank,
  value,
}: {
  label: string;
  rank: number;
  value: number;
}) {
  // Top 10 = green, 11-22 = gray, 23-32 = red
  // For defense (invertColor), the logic is the same since rank is already
  // computed with ascending sort (lower def_epa = better rank)
  let colorClass = "bg-gray-100 text-gray-700";
  if (rank > 0 && rank <= 10) {
    colorClass = "bg-emerald-50 text-emerald-700";
  } else if (rank > 22) {
    colorClass = "bg-red-50 text-red-700";
  }

  return (
    <span
      className={`inline-flex items-center gap-1.5 px-3 py-1 text-sm font-medium rounded-md ${colorClass}`}
    >
      <span className="font-bold">{ordinalSuffix(rank)}</span>
      <span className="text-gray-400">in</span>
      <span>{label}</span>
      <span className="text-xs text-gray-400 ml-1">
        ({value >= 0 ? "+" : ""}
        {value.toFixed(3)})
      </span>
    </span>
  );
}
