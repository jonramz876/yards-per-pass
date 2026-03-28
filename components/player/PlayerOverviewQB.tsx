// components/player/PlayerOverviewQB.tsx
"use client";

import { useMemo } from "react";
import Link from "next/link";
import type { QBSeasonStat, CrossLinkReceiver } from "@/lib/types";
import { getTeam, getTeamColor } from "@/lib/data/teams";
import { computeRank, ordinal, chipColor } from "@/lib/stats/percentiles";
import RadarChart from "@/components/qb/RadarChart";
import { classifyQB } from "@/lib/stats/archetypes";
import { qbFantasyPoints } from "@/lib/stats/fantasy";
import { QB_RADAR_AXES, QB_RADAR_KEYS, QB_RADAR_LABELS, getQBRadarVal, computeRadarValues } from "@/lib/stats/radar";

interface PlayerOverviewQBProps {
  stats: QBSeasonStat;
  allQBs: QBSeasonStat[];
  season: number;
  teamId: string;
  topReceivers?: CrossLinkReceiver[];
}

const RADAR_AXES = QB_RADAR_AXES;
const RADAR_KEYS = QB_RADAR_KEYS;
const RADAR_LABELS = QB_RADAR_LABELS;

const BAR_STATS = [
  { key: "yards_per_game", label: "Yds/G" },
  { key: "tds_per_game", label: "TD/G" },
  { key: "passer_rating", label: "Rating" },
  { key: "any_a", label: "ANY/A" },
  { key: "fantasy_pts", label: "FPts" },
];


function getBarValue(qb: QBSeasonStat, key: string): number {
  switch (key) {
    case "yards_per_game": return qb.games ? qb.passing_yards / qb.games : NaN;
    case "tds_per_game": return qb.games ? qb.touchdowns / qb.games : NaN;
    case "passer_rating": return qb.passer_rating;
    case "any_a": return qb.any_a;
    case "fantasy_pts": return qbFantasyPoints({
      passing_yards: qb.passing_yards,
      touchdowns: qb.touchdowns,
      interceptions: qb.interceptions,
      rush_yards: qb.rush_yards,
      rush_tds: qb.rush_tds,
      fumbles_lost: qb.fumbles_lost,
    });
    default: return NaN;
  }
}

function formatChipValue(key: string, val: number): string {
  if (isNaN(val)) return "\u2014";
  switch (key) {
    case "epa_per_db": return val.toFixed(2);
    case "cpoe": return (val >= 0 ? "+" : "") + val.toFixed(1);
    case "dropbacks_game": return val.toFixed(1);
    case "adot": return val.toFixed(1);
    case "inv_int_pct": return ((1 - val) * 100).toFixed(1) + "%"; // show raw INT rate (lower = better)
    case "success_rate": return (val * 100).toFixed(1) + "%";
    default: return val.toFixed(2);
  }
}

export default function PlayerOverviewQB({ stats, allQBs, season, teamId, topReceivers = [] }: PlayerOverviewQBProps) {
  const team = getTeam(teamId);
  const teamColor = getTeamColor(teamId);
  const total = allQBs.length;

  const radarValues = useMemo(
    () => computeRadarValues(RADAR_KEYS, getQBRadarVal, stats, allQBs),
    [stats, allQBs]
  );

  const archetype = useMemo(() => classifyQB(radarValues), [radarValues]);

  const chipData = useMemo(
    () =>
      RADAR_KEYS.map((key) => {
        const val = getQBRadarVal(stats, key);
        const allVals = allQBs.map((q) => getQBRadarVal(q, key)).filter((v) => !isNaN(v));
        const rank = computeRank(allVals, val);
        return { key, val, rank };
      }),
    [stats, allQBs]
  );

  const barData = useMemo(
    () =>
      BAR_STATS.map((stat) => {
        const val = getBarValue(stats, stat.key);
        const allVals = allQBs.map((q) => getBarValue(q, stat.key)).filter((v) => !isNaN(v));
        const avg = allVals.length ? allVals.reduce((a, b) => a + b, 0) / allVals.length : 0;
        const delta = val - avg;
        const barWidth = avg !== 0 ? Math.min(Math.abs(delta / avg) * 100, 45) : 0;
        return { ...stat, val, avg, delta, barWidth };
      }),
    [stats, allQBs]
  );

  // PFR qualified: 14 att/game × 17 = 238 attempts
  const PFR_MIN_ATT = 238;
  const meetsThreshold = stats.attempts >= PFR_MIN_ATT;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {/* Left column: Radar + chips */}
      <div className="rounded-xl border border-gray-200 bg-white p-6">
        {!meetsThreshold && (
          <div className="mb-4 px-3 py-2 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-700">
            {stats.attempts} attempts — below PFR minimum of {PFR_MIN_ATT}. Stats shown but not PFR-qualified.
          </div>
        )}
        <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wide mb-4">
          Performance Profile
        </h3>
        <div className="flex justify-center mb-1">
          <RadarChart values={radarValues} color={teamColor} axes={RADAR_AXES} />
        </div>
        <p className="text-[10px] text-gray-400 text-center mb-3">
          Percentiles vs. {total} PFR-qualified QBs ({PFR_MIN_ATT}+ att) &middot; {season}
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

        {/* Stat chips — 3x2 grid */}
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
            {PFR_MIN_ATT}+ att &middot; {total} QBs
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
                {/* Center line */}
                <div
                  className="absolute top-0 bottom-0 w-0.5 z-[2]"
                  style={{ left: "50%", background: "#94a3b8" }}
                />
                {/* Avg label */}
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
                  avg: {isNaN(bar.avg) ? "\u2014" : bar.avg < 10 ? bar.avg.toFixed(1) : bar.avg.toFixed(0)}
                </div>
                {/* Delta bar */}
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
                  {isNaN(bar.val) ? "\u2014" : bar.val.toFixed(1)}
                </div>
                <div
                  className="text-[10px]"
                  style={{ color: bar.delta >= 0 ? "#16a34a" : "#dc2626" }}
                >
                  {isNaN(bar.delta)
                    ? ""
                    : (bar.delta >= 0 ? "+" : "") + bar.delta.toFixed(1)}
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Team context: top receivers */}
        {topReceivers.length > 0 && (
          <div className="rounded-xl border border-gray-200 bg-white p-6">
            <h3 className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide mb-3">
              Throws To
            </h3>
            <div className="space-y-2">
              {topReceivers.map((r) => (
                <div key={r.player_id} className="flex items-center justify-between text-sm">
                  {r.slug ? (
                    <Link href={`/player/${r.slug}`} className="text-navy hover:text-nflred hover:underline transition-colors font-medium">
                      {r.player_name}
                    </Link>
                  ) : (
                    <span className="text-gray-700 font-medium">{r.player_name}</span>
                  )}
                  <span className="text-gray-400 text-xs tabular-nums">
                    {r.targets} tgt &middot; {r.receiving_yards} yds &middot; {r.receiving_tds} TD
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Cross-link to team hub */}
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
