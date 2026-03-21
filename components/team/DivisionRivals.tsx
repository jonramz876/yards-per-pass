// components/team/DivisionRivals.tsx
"use client";

import Link from "next/link";
import Image from "next/image";
import type { TeamSeasonStat } from "@/lib/types";
import { getTeam } from "@/lib/data/teams";

interface DivisionRivalsProps {
  allTeamStats: TeamSeasonStat[];
  division: string;
  currentTeamId: string;
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
  ascending: boolean
): number {
  const sorted = [...allStats].sort((a, b) =>
    ascending ? getValue(a) - getValue(b) : getValue(b) - getValue(a)
  );
  return sorted.findIndex((t) => t.team_id === teamId) + 1;
}

export default function DivisionRivals({
  allTeamStats,
  division,
  currentTeamId,
}: DivisionRivalsProps) {
  // Find division rivals (same division, not current team)
  const rivals = allTeamStats.filter((ts) => {
    const team = getTeam(ts.team_id);
    return team && team.division === division && ts.team_id !== currentTeamId;
  });

  // Sort by wins desc, then off_epa desc
  const sorted = [...rivals].sort((a, b) => b.wins - a.wins || b.off_epa_play - a.off_epa_play);

  return (
    <div className="bg-white rounded-xl border border-gray-100 p-6">
      <h3 className="text-lg font-bold text-navy mb-4">{division}</h3>

      {sorted.length === 0 ? (
        <p className="text-sm text-gray-400">No division rival stats available.</p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {sorted.map((rival) => {
            const team = getTeam(rival.team_id);
            if (!team) return null;

            const record = `${rival.wins}-${rival.losses}${rival.ties > 0 ? `-${rival.ties}` : ""}`;
            const offRank = computeRank(allTeamStats, rival.team_id, (t) => t.off_epa_play, false);
            const defRank = computeRank(allTeamStats, rival.team_id, (t) => t.def_epa_play, true);

            return (
              <Link
                key={rival.team_id}
                href={`/team/${rival.team_id.toLowerCase()}`}
                className="block rounded-lg border border-gray-200 overflow-hidden hover:shadow-md transition-shadow"
              >
                {/* Team color accent */}
                <div className="h-1" style={{ backgroundColor: team.primaryColor }} />

                <div className="p-4">
                  <div className="flex items-center gap-3 mb-3">
                    <Image
                      src={team.logo}
                      alt={team.name}
                      width={40}
                      height={40}
                      className="object-contain"
                    />
                    <div className="min-w-0">
                      <div className="text-sm font-bold text-navy truncate">{team.name}</div>
                      <div className="text-xs text-gray-500 font-medium">{record}</div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <RankPill label="Off" rank={offRank} />
                    <RankPill label="Def" rank={defRank} />
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

function RankPill({ label, rank }: { label: string; rank: number }) {
  let cls = "bg-gray-100 text-gray-700";
  if (rank > 0 && rank <= 10) cls = "bg-emerald-50 text-emerald-700";
  else if (rank > 22) cls = "bg-red-50 text-red-700";

  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-semibold rounded-full ${cls}`}>
      {label}:
      <span className="font-bold">{ordinalSuffix(rank)}</span>
    </span>
  );
}
