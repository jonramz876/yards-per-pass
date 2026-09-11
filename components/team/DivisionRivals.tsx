// components/team/DivisionRivals.tsx
"use client";

import Link from "next/link";
import Image from "next/image";
import type { Team, TeamSeasonStat } from "@/lib/types";
import { NFL_TEAMS, compareRecords } from "@/lib/data/teams";
import { ordinal } from "@/lib/stats/percentiles";
import TecmoSectionCard from "@/components/team/TecmoSectionCard";

interface DivisionRivalsProps {
  allTeamStats: TeamSeasonStat[];
  division: string;
  currentTeamId: string;
  primaryColor: string;
  secondaryColor: string;
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

/** One rival card: the team, plus its stats row (null until it has played). */
interface Rival {
  team: Team;
  stats: TeamSeasonStat | null;
}

/** Offensive EPA for the tiebreak — a rival without a usable number sorts last. */
function offEpaForSort(stats: TeamSeasonStat | null): number {
  return stats && Number.isFinite(stats.off_epa_play)
    ? stats.off_epa_play
    : Number.NEGATIVE_INFINITY;
}

/**
 * Standings order (compareRecords: win %, a tie as half a win, 0-0 = .500),
 * then offensive EPA between rivals with level records (this strip's existing
 * tiebreak), then abbreviation A→Z so the order never depends on row order.
 */
function compareRivals(a: Rival, b: Rival): number {
  const byRecord = compareRecords(a.stats, b.stats);
  if (byRecord !== 0) return byRecord;
  const epaA = offEpaForSort(a.stats);
  const epaB = offEpaForSort(b.stats);
  if (epaA !== epaB) return epaA > epaB ? -1 : 1;
  return a.team.id < b.team.id ? -1 : a.team.id > b.team.id ? 1 : 0;
}

export default function DivisionRivals({
  allTeamStats,
  division,
  currentTeamId,
  primaryColor,
  secondaryColor,
}: DivisionRivalsProps) {
  // Every division rival, straight from NFL_TEAMS. A rival that hasn't played
  // yet has no stats row — it still gets a card (0-0, rank pills "—") instead
  // of vanishing from the strip.
  const rivals: Rival[] = NFL_TEAMS.filter(
    (t) => t.division === division && t.id !== currentTeamId
  ).map((team) => ({
    team,
    stats: allTeamStats.find((ts) => ts.team_id === team.id) ?? null,
  }));

  const sorted = [...rivals].sort(compareRivals);

  return (
    <TecmoSectionCard
      title={division}
      primaryColor={primaryColor}
      secondaryColor={secondaryColor}
    >
      {sorted.length === 0 ? (
        <p className="text-sm text-gray-400">No division rival stats available.</p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {sorted.map(({ team, stats }) => {
            const rec = stats ?? { wins: 0, losses: 0, ties: 0 };
            const record = `${rec.wins}-${rec.losses}${rec.ties > 0 ? `-${rec.ties}` : ""}`;
            // computeRank returns 0 for a rival missing from the pool — RankPill shows "—".
            const offRank = computeRank(allTeamStats, team.id, (t) => t.off_epa_play, false);
            const defRank = computeRank(allTeamStats, team.id, (t) => t.def_epa_play, true);

            return (
              <Link
                key={team.id}
                href={`/team/${team.id.toLowerCase()}`}
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
    </TecmoSectionCard>
  );
}

function RankPill({ label, rank }: { label: string; rank: number }) {
  let cls = "bg-gray-100 text-gray-700";
  if (rank > 0 && rank <= 10) cls = "bg-emerald-50 text-emerald-700";
  else if (rank > 22) cls = "bg-red-50 text-red-700";

  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-semibold rounded-full ${cls}`}>
      {label}:
      <span className="font-bold">{rank > 0 ? ordinal(rank) : "—"}</span>
    </span>
  );
}
