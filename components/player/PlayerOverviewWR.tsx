// components/player/PlayerOverviewWR.tsx
"use client";

import { useMemo } from "react";
import Link from "next/link";
import type { ReceiverSeasonStat, CrossLinkQB } from "@/lib/types";
import { getTeam, getTeamColor } from "@/lib/data/teams";
import { computePercentile, computeRank, ordinal, chipColor } from "@/lib/stats/percentiles";
import RadarChart from "@/components/qb/RadarChart";
import { classifyWR, classifyTE } from "@/lib/stats/archetypes";
import { wrFantasyPoints } from "@/lib/stats/fantasy";

interface PlayerOverviewWRProps {
  stats: ReceiverSeasonStat;
  allReceivers: ReceiverSeasonStat[];
  season: number;
  teamId: string;
  teamQBData?: CrossLinkQB;
}

const RADAR_AXES = [
  { label: "Tgt/Game" },
  { label: "EPA/Tgt" },
  { label: "Catch%" },
  { label: "aDOT" },
  { label: "YAC/Rec" },
  { label: "YPRR" },
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
  { key: "fantasy_pts", label: "FPts", pct: false },
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
    case "fantasy_pts": return wrFantasyPoints({
      receiving_yards: rec.receiving_yards,
      receiving_tds: rec.receiving_tds,
      receptions: rec.receptions,
      fumbles_lost: rec.fumbles_lost,
    }, "ppr");
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

export default function PlayerOverviewWR({ stats, allReceivers, season, teamId, teamQBData }: PlayerOverviewWRProps) {
  const team = getTeam(teamId);
  const teamColor = getTeamColor(teamId);

  const isTE = stats.position === "TE";

  // For TEs, compute percentiles against TE-only pool; for WRs, against WR-only pool
  // Filter to qualified players by routes run (better than targets — measures opportunity not results)
  const MIN_ROUTES_WR = 200;
  const MIN_ROUTES_TE = 100;
  const positionPool = useMemo(
    () => {
      const minRoutes = isTE ? MIN_ROUTES_TE : MIN_ROUTES_WR;
      return allReceivers
        .filter((r) => isTE ? r.position === "TE" : r.position === "WR")
        .filter((r) => r.routes_run >= minRoutes);
    },
    [allReceivers, isTE]
  );
  const total = positionPool.length;

  const radarValues = useMemo(
    () =>
      RADAR_KEYS.map((key) => {
        const allVals = positionPool
          .map((r) => getStatValue(r, key))
          .filter((v) => !isNaN(v))
          .sort((a, b) => a - b);
        return computePercentile(allVals, getStatValue(stats, key));
      }),
    [stats, positionPool]
  );

  const archetype = useMemo(() => isTE ? classifyTE(radarValues) : classifyWR(radarValues), [radarValues, isTE]);

  const chipData = useMemo(
    () =>
      RADAR_KEYS.map((key) => {
        const val = getStatValue(stats, key);
        const allVals = positionPool.map((r) => getStatValue(r, key)).filter((v) => !isNaN(v));
        const rank = computeRank(allVals, val);
        return { key, val, rank };
      }),
    [stats, positionPool]
  );

  const barData = useMemo(
    () =>
      BAR_STATS.map((stat) => {
        const val = getBarValue(stats, stat.key);
        const allVals = positionPool.map((r) => getBarValue(r, stat.key)).filter((v) => !isNaN(v));
        const avg = allVals.length ? allVals.reduce((a, b) => a + b, 0) / allVals.length : 0;
        const delta = val - avg;
        const barWidth = avg !== 0 ? Math.min(Math.abs(delta / avg) * 100, 45) : 0;
        return { ...stat, val, avg, delta, barWidth };
      }),
    [stats, positionPool]
  );

  const minRoutes = isTE ? MIN_ROUTES_TE : MIN_ROUTES_WR;
  const meetsThreshold = stats.routes_run >= minRoutes;

  if (!meetsThreshold) {
    return (
      <div className="rounded-xl border border-gray-200 bg-white p-8 text-center">
        <p className="text-gray-400 text-sm mb-1">Not enough data to qualify</p>
        <p className="text-gray-300 text-xs">
          {stats.routes_run} routes run — minimum {minRoutes} required for {isTE ? "TE" : "WR"} rankings
        </p>
      </div>
    );
  }

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
        <p className="text-[10px] text-gray-400 text-center mb-3">
          Percentiles vs. {total} {isTE ? "TEs" : "WRs"} ({isTE ? "100" : "200"}+ routes) &middot; {season}
        </p>

        {archetype && (
          <div className="text-center mb-4">
            <Link href={`/glossary#${archetype.glossaryAnchor}`} className="group">
              <span className="text-lg font-bold text-navy group-hover:text-nflred transition-colors">
                {archetype.icon} {archetype.label}
              </span>
              <p className="text-xs text-gray-500 mt-0.5 group-hover:text-gray-700 transition-colors">
                {archetype.description}
              </p>
            </Link>
          </div>
        )}

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
          <h3 className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide mb-1">
            vs. League Average
          </h3>
          <p className="text-[9px] text-gray-300 mb-4">
            {isTE ? "100" : "200"}+ routes · {total} {isTE ? "TEs" : "WRs"}
          </p>
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
        {teamQBData && (
          <div className="rounded-xl border border-gray-200 bg-white p-6">
            <h3 className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide mb-3">
              Catches From
            </h3>
            <div className="flex items-center justify-between text-sm">
              {teamQBData.slug ? (
                <Link href={`/player/${teamQBData.slug}`} className="text-navy hover:text-nflred hover:underline transition-colors font-medium">
                  {teamQBData.player_name}
                </Link>
              ) : (
                <span className="text-gray-700 font-medium">{teamQBData.player_name}</span>
              )}
              <span className="text-gray-400 text-xs tabular-nums">
                {teamQBData.passing_yards} yds &middot; {teamQBData.touchdowns} TD
              </span>
            </div>
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
