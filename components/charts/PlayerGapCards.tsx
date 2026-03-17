"use client";

import { useState, useMemo } from "react";
import type { RBGapStat } from "@/lib/types";

interface PlayerGapCardsProps {
  gap: string;
  stats: RBGapStat[];
  teamAvgEpa: number;
  leagueRank: number | null;
}

const GAP_LABELS: Record<string, string> = {
  LE: "Left End",
  LT: "Left Tackle",
  LG: "Left Guard",
  M: "Middle",
  RG: "Right Guard",
  RT: "Right Tackle",
  RE: "Right End",
};

const MIN_CARRY_OPTIONS = [5, 10, 15, 20];

function fmt(val: number | null, decimals: number): string {
  return val != null && !isNaN(val) ? val.toFixed(decimals) : "\u2014";
}

function fmtPct(val: number | null): string {
  return val != null && !isNaN(val) ? `${(val * 100).toFixed(1)}%` : "\u2014";
}

function csvVal(val: number | null, decimals: number): string {
  return val != null && !isNaN(val) ? val.toFixed(decimals) : "";
}

function csvPct(val: number | null): string {
  return val != null && !isNaN(val) ? (val * 100).toFixed(1) : "";
}

export default function PlayerGapCards({
  gap,
  stats,
  teamAvgEpa,
  leagueRank,
}: PlayerGapCardsProps) {
  const [minCarries, setMinCarries] = useState(10);

  // Filter to selected gap, apply min carry threshold, sort by carries desc
  const filtered = useMemo(() => {
    return stats
      .filter((r) => r.gap === gap && r.carries >= minCarries)
      .sort((a, b) => b.carries - a.carries);
  }, [stats, gap, minCarries]);

  // Aggregate totals for header
  const totals = useMemo(() => {
    const gapPlayers = stats.filter((r) => r.gap === gap);
    const totalCarries = gapPlayers.reduce((s, r) => s + r.carries, 0);
    let epaSum = 0;
    let epaCarries = 0;
    for (const r of gapPlayers) {
      if (r.epa_per_carry != null && !isNaN(r.epa_per_carry)) {
        epaSum += r.epa_per_carry * r.carries;
        epaCarries += r.carries;
      }
    }
    const epa = epaCarries > 0 ? epaSum / epaCarries : NaN;
    return { carries: totalCarries, epa };
  }, [stats, gap]);

  // Max divergence for bar scaling (capped at 0.15 EPA)
  const maxDivergence = useMemo(() => {
    let max = 0.05; // minimum scale
    for (const r of filtered) {
      if (r.epa_per_carry != null && !isNaN(r.epa_per_carry)) {
        max = Math.max(max, Math.abs(r.epa_per_carry - teamAvgEpa));
      }
    }
    return Math.min(max, 0.15);
  }, [filtered, teamAvgEpa]);

  function handleExportCSV() {
    const header = "Player,Carries,EPA/Carry,Yards/Carry,Success Rate %,Stuff Rate %,Explosive Rate %";
    const rows = filtered.map((r) =>
      [
        `"${r.player_name}"`,
        r.carries,
        csvVal(r.epa_per_carry, 3),
        csvVal(r.yards_per_carry, 1),
        csvPct(r.success_rate),
        csvPct(r.stuff_rate),
        csvPct(r.explosive_rate),
      ].join(",")
    );
    const csv = [header, ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${gap}_gap_players.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const gapLabel = GAP_LABELS[gap] || gap;

  return (
    <div>
      {/* Header bar */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
        <div>
          <h3 className="text-lg font-bold text-navy">
            {gapLabel} Gap
            {leagueRank != null && (
              <span className="ml-2 text-sm font-medium text-gray-500">
                Rank {leagueRank}/32
              </span>
            )}
          </h3>
          <p className="text-sm text-gray-500">
            {totals.carries} carries &middot; {fmt(totals.epa, 3)} EPA/carry
          </p>
        </div>
        <div className="flex items-center gap-3">
          <label htmlFor="min-carries" className="text-xs font-medium text-gray-500">
            Min carries
          </label>
          <select
            id="min-carries"
            value={minCarries}
            onChange={(e) => setMinCarries(Number(e.target.value))}
            className="px-2 py-1 text-sm border border-gray-200 rounded-md bg-white text-navy font-medium focus:outline-none focus:ring-2 focus:ring-navy/20"
          >
            {MIN_CARRY_OPTIONS.map((n) => (
              <option key={n} value={n}>{n}+</option>
            ))}
          </select>
          <button
            onClick={handleExportCSV}
            className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-gray-500 border border-gray-200 rounded-md hover:bg-gray-50 transition-colors"
            title="Export CSV"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5">
              <path d="M10.75 2.75a.75.75 0 0 0-1.5 0v8.614L6.295 8.235a.75.75 0 1 0-1.09 1.03l4.25 4.5a.75.75 0 0 0 1.09 0l4.25-4.5a.75.75 0 0 0-1.09-1.03l-2.955 3.129V2.75Z" />
              <path d="M3.5 12.75a.75.75 0 0 0-1.5 0v2.5A2.75 2.75 0 0 0 4.75 18h10.5A2.75 2.75 0 0 0 18 15.25v-2.5a.75.75 0 0 0-1.5 0v2.5c0 .69-.56 1.25-1.25 1.25H4.75c-.69 0-1.25-.56-1.25-1.25v-2.5Z" />
            </svg>
            CSV
          </button>
        </div>
      </div>

      {/* Empty state */}
      {filtered.length === 0 ? (
        <div className="bg-gray-50 border border-gray-200 rounded-lg p-12 text-center">
          <p className="text-gray-400 text-sm">
            No players meet the minimum carry threshold ({minCarries}+ carries).
          </p>
          <p className="text-gray-400 text-xs mt-1">
            Try lowering the minimum carry filter above.
          </p>
        </div>
      ) : (
        /* Card grid */
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {filtered.map((r) => {
            const epa = r.epa_per_carry != null && !isNaN(r.epa_per_carry) ? r.epa_per_carry : null;
            const divergence = epa !== null ? epa - teamAvgEpa : null;
            const isPositive = divergence !== null && divergence >= 0;
            const barPct = divergence !== null
              ? Math.min(Math.abs(divergence) / maxDivergence, 1) * 50
              : 0;

            return (
              <div
                key={r.id}
                className="bg-white border border-gray-200 rounded-lg p-4 hover:shadow-md transition-shadow"
              >
                {/* Player name + carries */}
                <div className="flex items-center justify-between mb-3">
                  <span className="font-bold text-navy text-sm">{r.player_name}</span>
                  <span className="text-xs text-gray-400">{r.carries} carries</span>
                </div>

                {/* EPA divergence bar */}
                <div className="mb-3">
                  <div className="text-xs text-gray-500 mb-1">
                    EPA vs team avg: {divergence !== null ? (
                      <span className={isPositive ? "text-green-600 font-medium" : "text-red-600 font-medium"}>
                        {isPositive ? "+" : ""}{divergence.toFixed(3)}
                      </span>
                    ) : "\u2014"}
                  </div>
                  <div className="relative h-4 bg-gray-100 rounded-full overflow-hidden">
                    {/* Center line */}
                    <div className="absolute left-1/2 top-0 bottom-0 w-px bg-gray-300" />
                    {/* Bar */}
                    {divergence !== null && barPct > 0 && (
                      <div
                        className={`absolute top-0.5 bottom-0.5 rounded-full ${
                          isPositive ? "bg-green-500" : "bg-red-500"
                        }`}
                        style={{
                          left: isPositive ? "50%" : `${50 - barPct}%`,
                          width: `${barPct}%`,
                        }}
                      />
                    )}
                  </div>
                </div>

                {/* 2x2 stat grid */}
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="bg-gray-50 rounded px-2 py-1.5">
                    <div className="text-gray-400">Yards/carry</div>
                    <div className="font-semibold text-navy">{fmt(r.yards_per_carry, 1)}</div>
                  </div>
                  <div className="bg-gray-50 rounded px-2 py-1.5">
                    <div className="text-gray-400">Success%</div>
                    <div className="font-semibold text-navy">{fmtPct(r.success_rate)}</div>
                  </div>
                  <div className="bg-gray-50 rounded px-2 py-1.5">
                    <div className="text-gray-400">Stuff%</div>
                    <div className="font-semibold text-navy">{fmtPct(r.stuff_rate)}</div>
                  </div>
                  <div className="bg-gray-50 rounded px-2 py-1.5">
                    <div className="text-gray-400">Explosive%</div>
                    <div className="font-semibold text-navy">{fmtPct(r.explosive_rate)}</div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
