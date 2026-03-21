// components/player/PlayerOverviewWR.tsx
"use client";

import { useMemo } from "react";
import Link from "next/link";
import type { ReceiverSeasonStat } from "@/lib/types";
import { getTeam, getTeamColor } from "@/lib/data/teams";
import { computePercentile, computeRank, ordinal, chipColor } from "@/lib/stats/percentiles";
import RadarChart from "@/components/qb/RadarChart";

interface PlayerOverviewWRProps {
  stats: ReceiverSeasonStat;
  allReceivers: ReceiverSeasonStat[];
  season: number;
  teamId: string;
}

const RADAR_AXES = [
  { label: "Volume" },
  { label: "Efficiency" },
  { label: "Catch" },
  { label: "Downfield" },
  { label: "After Catch" },
  { label: "Consistency" },
];

const RADAR_KEYS = [
  "targets_game",          // Volume — Targets/Game
  "epa_per_target",        // Efficiency — EPA/Target
  "catch_rate",            // Catch — Catch Rate
  "air_yards_per_target",  // Downfield — ADOT
  "yac_per_reception",     // After Catch — YAC/Rec
  "yards_per_route_run",   // Consistency — YPRR
] as const;

const RADAR_LABELS: Record<string, string> = {
  targets_game: "Tgt/G",
  epa_per_target: "EPA/Tgt",
  catch_rate: "Catch%",
  air_yards_per_target: "ADOT",
  yac_per_reception: "YAC/Rec",
  yards_per_route_run: "YPRR",
};

const BAR_STATS: { key: string; label: string; pct: boolean }[] = [
  { key: "yards_per_game", label: "Yds/G", pct: false },
  { key: "tds_per_game", label: "TD/G", pct: false },
  { key: "receptions_per_game", label: "Rec/G", pct: false },
  { key: "yards_per_reception", label: "YPR", pct: false },
  { key: "snap_share", label: "Snap%", pct: true },
  { key: "route_participation_rate", label: "Route%", pct: true },
];

function getStatValue(rec: ReceiverSeasonStat, key: string): number {
  switch (key) {
    case "targets_game": return rec.games ? rec.targets / rec.games : NaN;
    case "epa_per_target": return rec.epa_per_target;
    case "catch_rate": return rec.catch_rate;
    case "air_yards_per_target": return rec.air_yards_per_target;
    case "yac_per_reception": return rec.yac_per_reception;
    case "yards_per_route_run": return rec.yards_per_route_run;
    default: return NaN;
  }
}

function getBarValue(rec: ReceiverSeasonStat, key: string): number {
  switch (key) {
    case "yards_per_game": return rec.games ? rec.receiving_yards / rec.games : NaN;
    case "tds_per_game": return rec.games ? rec.receiving_tds / rec.games : NaN;
    case "receptions_per_game": return rec.games ? rec.receptions / rec.games : NaN;
    default: return (rec[key as keyof ReceiverSeasonStat] as number) ?? NaN;
  }
}

function formatChipValue(key: string, val: number): string {
  if (isNaN(val)) return "\u2014";
  switch (key) {
    case "targets_game": return val.toFixed(1);
    case "epa_per_target": return val.toFixed(2);
    case "catch_rate": return (val * 100).toFixed(1) + "%";
    case "air_yards_per_target": return val.toFixed(1);
    case "yac_per_reception": return val.toFixed(1);
    case "yards_per_route_run": return val.toFixed(2);
    default: return val.toFixed(2);
  }
}

export default function PlayerOverviewWR({ stats, allReceivers, season, teamId }: PlayerOverviewWRProps) {
  const team = getTeam(teamId);
  const teamColor = getTeamColor(teamId);
  const total = allReceivers.length;

  const radarValues = useMemo(
    () =>
      RADAR_KEYS.map((key) => {
        const allVals = allReceivers
          .map((r) => getStatValue(r, key))
          .filter((v) => !isNaN(v))
          .sort((a, b) => a - b);
        return computePercentile(allVals, getStatValue(stats, key));
      }),
    [stats, allReceivers]
  );

  const chipData = useMemo(
    () =>
      RADAR_KEYS.map((key) => {
        const val = getStatValue(stats, key);
        const allVals = allReceivers.map((r) => getStatValue(r, key)).filter((v) => !isNaN(v));
        const rank = computeRank(allVals, val);
        return { key, val, rank };
      }),
    [stats, allReceivers]
  );

  const barData = useMemo(
    () =>
      BAR_STATS.map((stat) => {
        const val = getBarValue(stats, stat.key);
        const allVals = allReceivers.map((r) => getBarValue(r, stat.key)).filter((v) => !isNaN(v));
        const avg = allVals.length ? allVals.reduce((a, b) => a + b, 0) / allVals.length : 0;
        const delta = val - avg;
        const barWidth = avg !== 0 ? Math.min(Math.abs(delta / avg) * 100, 45) : 0;
        return { ...stat, val, avg, delta, barWidth };
      }),
    [stats, allReceivers]
  );

  // Team context: find the team's QB
  const teamQB = useMemo(() => {
    // allReceivers only has receivers, so we can't look up QBs from it.
    // This will be blank unless a QB dataset is passed. Placeholder for now.
    return null as { name: string } | null;
  }, []);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {/* Left column: Radar + chips */}
      <div className="rounded-xl border border-gray-200 bg-white p-6">
        <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wide mb-4">
          Performance Profile
        </h3>
        <div className="flex justify-center mb-1">
          <RadarChart values={radarValues} color={teamColor} axes={RADAR_AXES} />
        </div>
        <p className="text-[10px] text-gray-400 text-center mb-5">
          Percentiles vs. {total} {stats.position === "TE" ? "TEs" : "WRs"} &middot; {season}
        </p>

        {/* Stat chips */}
        <div className="grid grid-cols-3 gap-2">
          {chipData.map((chip) => (
            <div
              key={chip.key}
              className="rounded-lg p-3 text-center"
              style={{ background: "#f8fafc" }}
            >
              <div className="text-[10px] text-gray-400 uppercase tracking-wide">
                {RADAR_LABELS[chip.key]}
              </div>
              <div
                className="text-lg font-bold my-0.5"
                style={{ color: chipColor(chip.rank, total) }}
              >
                {formatChipValue(chip.key, chip.val)}
              </div>
              <div className="text-[10px] text-gray-400">
                {ordinal(chip.rank)} of {total}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Right column: Bars + context */}
      <div className="space-y-6">
        {/* Vs-league bars */}
        <div className="rounded-xl border border-gray-200 bg-white p-6">
          <h3 className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide mb-4">
            vs. League Average
          </h3>
          {barData.map((bar) => (
            <div key={bar.key} className="flex items-center gap-2 mb-3.5">
              <div className="text-[11px] text-gray-500 w-[54px] text-right shrink-0">
                {bar.label}
              </div>
              <div
                className="flex-1 h-7 rounded relative overflow-hidden"
                style={{ background: "#f1f5f9" }}
              >
                <div
                  className="absolute top-0 bottom-0 w-0.5 z-[2]"
                  style={{ left: "50%", background: "#94a3b8" }}
                />
                <div
                  className="absolute whitespace-nowrap z-[3]"
                  style={{
                    top: -14,
                    left: "50%",
                    transform: "translateX(-50%)",
                    fontSize: 9,
                    color: "#94a3b8",
                  }}
                >
                  avg:{" "}
                  {isNaN(bar.avg)
                    ? "\u2014"
                    : bar.pct
                    ? (bar.avg * 100).toFixed(1) + "%"
                    : bar.avg < 10
                    ? bar.avg.toFixed(1)
                    : bar.avg.toFixed(0)}
                </div>
                {bar.delta >= 0 ? (
                  <div
                    className="absolute top-0.5 bottom-0.5 rounded-sm"
                    style={{
                      left: "50%",
                      width: `${bar.barWidth}%`,
                      background: "rgba(34,197,94,0.3)",
                      borderRight: "2px solid #16a34a",
                    }}
                  />
                ) : (
                  <div
                    className="absolute top-0.5 bottom-0.5 rounded-sm"
                    style={{
                      right: "50%",
                      width: `${bar.barWidth}%`,
                      background: "rgba(239,68,68,0.3)",
                      borderLeft: "2px solid #dc2626",
                    }}
                  />
                )}
              </div>
              <div className="w-[90px] text-right leading-tight shrink-0">
                <div className="text-[12px] font-bold text-gray-900">
                  {isNaN(bar.val)
                    ? "\u2014"
                    : bar.pct
                    ? (bar.val * 100).toFixed(1) + "%"
                    : bar.val.toFixed(1)}
                </div>
                <div
                  className="text-[10px]"
                  style={{ color: bar.delta >= 0 ? "#16a34a" : "#dc2626" }}
                >
                  {isNaN(bar.delta)
                    ? ""
                    : (bar.delta >= 0 ? "+" : "") +
                      (bar.pct
                        ? (bar.delta * 100).toFixed(1) + "%"
                        : bar.delta.toFixed(1))}
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Team context: QB */}
        {teamQB && (
          <div className="rounded-xl border border-gray-200 bg-white p-6">
            <h3 className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide mb-3">
              Catches From
            </h3>
            <div className="text-sm text-gray-700">{teamQB.name}</div>
          </div>
        )}

        {/* Cross-link */}
        <Link
          href={`/team/${teamId}`}
          className="block rounded-xl border border-gray-200 bg-white p-4 text-center text-sm font-semibold text-navy hover:text-nflred hover:border-gray-300 transition-colors"
        >
          View {team?.name ?? teamId} Hub &rarr;
        </Link>
      </div>
    </div>
  );
}
