// components/player/PlayerOverviewRB.tsx
"use client";

import { useMemo } from "react";
import Link from "next/link";
import type { RBWeeklyStat } from "@/lib/types";
import { getTeam, getTeamColor } from "@/lib/data/teams";
import { computePercentile, computeRank, ordinal, chipColor } from "@/lib/stats/percentiles";
import RadarChart from "@/components/qb/RadarChart";
import { classifyRB } from "@/lib/stats/archetypes";
import { rbFantasyPoints } from "@/lib/stats/fantasy";

interface PlayerOverviewRBProps {
  weeklyStats: RBWeeklyStat[];
  allRBWeekly: RBWeeklyStat[];
  season: number;
  teamId: string;
  playerName: string;
}

interface AggregatedRB {
  player_id: string;
  games: number;
  carries: number;
  rushing_yards: number;
  rushing_tds: number;
  epa_per_carry: number;
  success_rate: number;
  stuff_rate: number;
  explosive_rate: number;
  yards_per_carry: number;
  targets: number;
  receptions: number;
  receiving_yards: number;
  receiving_tds: number;
  fumbles_lost: number;
}

const RADAR_AXES = [
  { label: "Car/Game" },
  { label: "EPA/Car" },
  { label: "Stuff Avoid" },
  { label: "Explosive%" },
  { label: "Tgt/Game" },
  { label: "Success%" },
];

const RADAR_KEYS = [
  "carries_game",      // Volume — Carries/Game
  "epa_per_carry",     // Efficiency — EPA/Carry
  "stuff_avoidance",   // Power — 1 - stuff_rate
  "explosive_rate",    // Explosiveness
  "targets_game",      // Receiving — Targets/Game
  "success_rate",      // Consistency
] as const;

const RADAR_LABELS: Record<string, string> = {
  carries_game: "Car/G",
  epa_per_carry: "EPA/Car",
  stuff_avoidance: "Stuff Avoid%",
  explosive_rate: "Explosive%",
  targets_game: "Tgt/G",
  success_rate: "Success%",
};

const BAR_STATS = [
  { key: "rush_yards_game", label: "Yds/G" },
  { key: "rush_tds_game", label: "TD/G" },
  { key: "yards_per_carry", label: "YPC" },
  { key: "success_rate", label: "Success%" },
  { key: "fantasy_pts", label: "FPts" },
];

/** Aggregate weekly rows into a season summary for one player */
function aggregateWeekly(rows: RBWeeklyStat[]): AggregatedRB {
  const games = rows.length;
  let carries = 0, rushYds = 0, rushTds = 0;
  let epaSum = 0, srSum = 0, stuffSum = 0, explSum = 0, ypcSum = 0;
  let epaCount = 0, srCount = 0, stuffCount = 0, explCount = 0, ypcCount = 0;
  let targets = 0, receptions = 0, recYds = 0, recTds = 0;

  let fumblesLost = 0;

  for (const r of rows) {
    const c = r.carries || 0;
    carries += c;
    rushYds += r.rushing_yards || 0;
    rushTds += r.rushing_tds || 0;
    targets += r.targets || 0;
    receptions += r.receptions || 0;
    recYds += r.receiving_yards || 0;
    recTds += r.receiving_tds || 0;
    fumblesLost += r.fumbles_lost || 0;
    if (c > 0) {
      if (!isNaN(r.epa_per_carry)) { epaSum += r.epa_per_carry * c; epaCount += c; }
      if (!isNaN(r.success_rate)) { srSum += r.success_rate * c; srCount += c; }
      if (!isNaN(r.stuff_rate)) { stuffSum += r.stuff_rate * c; stuffCount += c; }
      if (!isNaN(r.explosive_rate)) { explSum += r.explosive_rate * c; explCount += c; }
      if (!isNaN(r.yards_per_carry)) { ypcSum += r.yards_per_carry * c; ypcCount += c; }
    }
  }

  return {
    player_id: rows[0]?.player_id ?? "",
    games,
    carries,
    rushing_yards: rushYds,
    rushing_tds: rushTds,
    epa_per_carry: epaCount > 0 ? epaSum / epaCount : NaN,
    success_rate: srCount > 0 ? srSum / srCount : NaN,
    stuff_rate: stuffCount > 0 ? stuffSum / stuffCount : NaN,
    explosive_rate: explCount > 0 ? explSum / explCount : NaN,
    yards_per_carry: ypcCount > 0 ? ypcSum / ypcCount : NaN,
    targets,
    receptions,
    receiving_yards: recYds,
    receiving_tds: recTds,
    fumbles_lost: fumblesLost,
  };
}

function getStatValue(agg: AggregatedRB, key: string): number {
  switch (key) {
    case "carries_game": return agg.games ? agg.carries / agg.games : NaN;
    case "epa_per_carry": return agg.epa_per_carry;
    case "stuff_avoidance": return !isNaN(agg.stuff_rate) ? 1 - agg.stuff_rate : NaN;
    case "explosive_rate": return agg.explosive_rate;
    case "targets_game": return agg.games ? agg.targets / agg.games : NaN;
    case "success_rate": return agg.success_rate;
    default: return NaN;
  }
}

function getBarValue(agg: AggregatedRB, key: string): number {
  switch (key) {
    case "rush_yards_game": return agg.games ? agg.rushing_yards / agg.games : NaN;
    case "rush_tds_game": return agg.games ? agg.rushing_tds / agg.games : NaN;
    case "yards_per_carry": return agg.yards_per_carry;
    case "success_rate": return agg.success_rate;
    case "fantasy_pts": return rbFantasyPoints({
      rushing_yards: agg.rushing_yards,
      rushing_tds: agg.rushing_tds,
      receiving_yards: agg.receiving_yards,
      receiving_tds: agg.receiving_tds,
      receptions: agg.receptions,
      fumbles_lost: agg.fumbles_lost,
    }, "ppr");
    default: return NaN;
  }
}

function formatChipValue(key: string, val: number): string {
  if (isNaN(val)) return "\u2014";
  switch (key) {
    case "carries_game":
    case "targets_game": return val.toFixed(1);
    case "epa_per_carry": return val.toFixed(2);
    case "stuff_avoidance":
    case "explosive_rate":
    case "success_rate": return (val * 100).toFixed(1) + "%";
    default: return val.toFixed(2);
  }
}

export default function PlayerOverviewRB({
  weeklyStats,
  allRBWeekly,
  season,
  teamId,
}: PlayerOverviewRBProps) {
  const team = getTeam(teamId);
  const teamColor = getTeamColor(teamId);

  // Aggregate this player's weekly data
  const playerAgg = useMemo(() => aggregateWeekly(weeklyStats), [weeklyStats]);

  // Build league pool: aggregate all RBs, PFR qualified (106+ carries)
  const PFR_MIN_CARRIES = 106;
  const leaguePool = useMemo(() => {
    const byPlayer = new Map<string, RBWeeklyStat[]>();
    for (const r of allRBWeekly) {
      const rows = byPlayer.get(r.player_id) || [];
      rows.push(r);
      byPlayer.set(r.player_id, rows);
    }
    const pool: AggregatedRB[] = [];
    byPlayer.forEach((rows) => {
      const agg = aggregateWeekly(rows);
      if (agg.carries >= PFR_MIN_CARRIES) pool.push(agg);
    });
    return pool;
  }, [allRBWeekly]);

  const total = leaguePool.length;

  const radarValues = useMemo(
    () =>
      RADAR_KEYS.map((key) => {
        const allVals = leaguePool
          .map((p) => getStatValue(p, key))
          .filter((v) => !isNaN(v))
          .sort((a, b) => a - b);
        return computePercentile(allVals, getStatValue(playerAgg, key));
      }),
    [playerAgg, leaguePool]
  );

  const archetype = useMemo(() => classifyRB(radarValues), [radarValues]);

  const chipData = useMemo(
    () =>
      RADAR_KEYS.map((key) => {
        const val = getStatValue(playerAgg, key);
        const allVals = leaguePool.map((p) => getStatValue(p, key)).filter((v) => !isNaN(v));
        const rank = computeRank(allVals, val);
        return { key, val, rank };
      }),
    [playerAgg, leaguePool]
  );

  const barData = useMemo(
    () =>
      BAR_STATS.map((stat) => {
        const val = getBarValue(playerAgg, stat.key);
        const allVals = leaguePool.map((p) => getBarValue(p, stat.key)).filter((v) => !isNaN(v));
        const avg = allVals.length ? allVals.reduce((a, b) => a + b, 0) / allVals.length : 0;
        const delta = val - avg;
        const barWidth = avg !== 0 ? Math.min(Math.abs(delta / avg) * 100, 45) : 0;
        const isPct = stat.key === "success_rate";
        return { ...stat, val, avg, delta, barWidth, isPct };
      }),
    [playerAgg, leaguePool]
  );

  const meetsThreshold = playerAgg.carries >= PFR_MIN_CARRIES;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {/* Left column: Radar + chips */}
      <div className="rounded-xl border border-gray-200 bg-white p-6">
        {!meetsThreshold && (
          <div className="mb-4 px-3 py-2 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-700">
            {playerAgg.carries} carries — below PFR minimum of {PFR_MIN_CARRIES}. Stats shown but not PFR-qualified.
          </div>
        )}
        <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wide mb-4">
          Performance Profile
        </h3>
        <div className="flex justify-center mb-1">
          <RadarChart values={radarValues} color={teamColor} axes={RADAR_AXES} />
        </div>
        <p className="text-[10px] text-gray-400 text-center mb-3">
          Percentiles vs. {total} PFR-qualified RBs ({PFR_MIN_CARRIES}+ car) &middot; {season}
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

      {/* Right column: Bars + cross-link */}
      <div className="space-y-6">
          <div className="rounded-xl border border-gray-200 bg-white p-6">
            <h3 className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide mb-1">
              vs. League Average
            </h3>
            <p className="text-[9px] text-gray-300 mb-4">
              {PFR_MIN_CARRIES}+ car &middot; {total} RBs
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
                      : bar.isPct
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
                      : bar.isPct
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
                        (bar.isPct
                          ? (bar.delta * 100).toFixed(1) + "%"
                          : bar.delta.toFixed(1))}
                  </div>
                </div>
              </div>
            ))}
          </div>

        {/* Cross-link */}
        <Link
          href={`/rushing?team=${teamId}`}
          className="block rounded-xl border border-gray-200 bg-white p-4 text-center text-sm font-semibold text-navy hover:text-nflred hover:border-gray-300 transition-colors"
        >
          View {team?.name ?? teamId} Rushing &rarr;
        </Link>
      </div>
    </div>
  );
}
