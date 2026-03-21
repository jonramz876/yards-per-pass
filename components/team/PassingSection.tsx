// components/team/PassingSection.tsx
"use client";

import Link from "next/link";
import type { QBSeasonStat, ReceiverSeasonStat, TeamSeasonStat, DataFreshness } from "@/lib/types";

interface PassingSectionProps {
  teamQBs: QBSeasonStat[];
  teamReceivers: ReceiverSeasonStat[];
  slugMap: Record<string, string>;
  allTeamStats: TeamSeasonStat[];
  teamId: string;
  freshness: DataFreshness | null;
}

function ordinalSuffix(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

function fmt(val: number | null, decimals = 2): string {
  if (val == null || isNaN(val)) return "\u2014";
  return val.toFixed(decimals);
}

function fmtPct(val: number | null): string {
  if (val == null || isNaN(val)) return "\u2014";
  return (val * 100).toFixed(1) + "%";
}

function fmtSigned(val: number | null, decimals = 2): string {
  if (val == null || isNaN(val)) return "\u2014";
  return (val >= 0 ? "+" : "") + val.toFixed(decimals);
}

export default function PassingSection({
  teamQBs,
  teamReceivers,
  slugMap,
  allTeamStats,
  teamId,
  freshness,
}: PassingSectionProps) {
  // Compute pass EPA rank
  const sorted = [...allTeamStats].sort((a, b) => b.off_pass_epa - a.off_pass_epa);
  const teamStat = allTeamStats.find((t) => t.team_id === teamId);
  const rank = sorted.findIndex((t) => t.team_id === teamId) + 1;
  const epaVal = teamStat?.off_pass_epa;
  const week = freshness?.through_week ?? null;

  // Starting QB = most dropbacks
  const startingQB = teamQBs.length > 0
    ? [...teamQBs].sort((a, b) => b.dropbacks - a.dropbacks)[0]
    : null;

  // Receivers sorted by targets desc
  const sortedReceivers = [...teamReceivers].sort((a, b) => b.targets - a.targets);

  return (
    <div className="bg-white rounded-xl border border-gray-100 p-6">
      <h3 className="text-lg font-bold text-navy mb-4">Passing Attack</h3>

      {/* Programmatic summary */}
      {teamStat && (
        <p className="text-sm text-gray-600 mb-4">
          The passing offense ranks {ordinalSuffix(rank)} in EPA/play ({fmtSigned(epaVal ?? null, 3)})
          {week ? ` through Week ${week}` : ""}.
        </p>
      )}

      {/* Starting QB card */}
      {startingQB && (
        <div className="bg-gray-50 rounded-lg p-4 mb-5">
          <div className="flex items-center justify-between mb-3">
            <Link
              href={`/player/${slugMap[startingQB.player_id] || startingQB.player_id}`}
              className="text-base font-bold text-navy hover:text-nflred hover:underline"
            >
              {startingQB.player_name}
            </Link>
            <span className="text-xs text-gray-400 font-medium">
              {startingQB.games} GP &middot; {startingQB.dropbacks} DB
            </span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <StatChip label="EPA/DB" value={fmtSigned(startingQB.epa_per_db)} />
            <StatChip label="CPOE" value={fmtSigned(startingQB.cpoe)} />
            <StatChip label="Success%" value={fmtPct(startingQB.success_rate)} />
            <StatChip label="Passer Rtg" value={fmt(startingQB.passer_rating, 1)} />
          </div>
        </div>
      )}

      {/* Receivers table */}
      {sortedReceivers.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-navy text-white text-xs uppercase">
                <th className="px-3 py-2 text-left font-semibold">Pos</th>
                <th className="px-3 py-2 text-left font-semibold">Name</th>
                <th className="px-3 py-2 text-right font-semibold">Tgt</th>
                <th className="px-3 py-2 text-right font-semibold">Rec</th>
                <th className="px-3 py-2 text-right font-semibold">Yards</th>
                <th className="px-3 py-2 text-right font-semibold">TD</th>
                <th className="px-3 py-2 text-right font-semibold">Tgt Share</th>
                <th className="px-3 py-2 text-right font-semibold">EPA/Tgt</th>
                <th className="px-3 py-2 text-right font-semibold">YPRR</th>
              </tr>
            </thead>
            <tbody>
              {sortedReceivers.map((rec) => (
                <tr key={rec.id} className="border-b border-gray-100 hover:bg-gray-50">
                  <td className="px-3 py-2">
                    <PositionBadge position={rec.position} />
                  </td>
                  <td className="px-3 py-2 text-left font-medium">
                    <Link
                      href={`/player/${slugMap[rec.player_id] || rec.player_id}`}
                      className="text-navy hover:text-nflred hover:underline"
                    >
                      {rec.player_name}
                    </Link>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{rec.targets}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{rec.receptions}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{rec.receiving_yards}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{rec.receiving_tds}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmtPct(rec.target_share)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmtSigned(rec.epa_per_target)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmt(rec.yards_per_route_run)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Cross-link */}
      <Link
        href="/qb-leaderboard"
        className="text-sm text-navy font-semibold hover:underline mt-4 inline-block"
      >
        See full QB Rankings &rarr;
      </Link>
    </div>
  );
}

function StatChip({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-white rounded-md px-3 py-2 text-center border border-gray-200">
      <div className="text-xs text-gray-500 font-medium">{label}</div>
      <div className="text-sm font-bold text-navy tabular-nums mt-0.5">{value}</div>
    </div>
  );
}

function PositionBadge({ position }: { position: string }) {
  const colors: Record<string, string> = {
    WR: "bg-blue-100 text-blue-800",
    TE: "bg-amber-100 text-amber-800",
    RB: "bg-green-100 text-green-800",
  };
  const cls = colors[position] || "bg-gray-100 text-gray-700";
  return (
    <span className={`inline-block px-1.5 py-0.5 text-[10px] font-bold rounded ${cls}`}>
      {position}
    </span>
  );
}
