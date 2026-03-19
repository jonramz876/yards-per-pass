"use client";

import { useEffect, useCallback, useMemo } from "react";
import { createPortal } from "react-dom";
import type { RBGapStat, RBGapStatWeekly } from "@/lib/types";
import { getTeam, getTeamColor } from "@/lib/data/teams";
import RadarChart from "@/components/qb/RadarChart";

interface RBStatCardProps {
  /** Player's gap stats for the selected team (all 7 gaps) */
  playerGapStats: RBGapStat[];
  /** All RBs league-wide (for percentile computation) */
  allLeagueStats: RBGapStat[];
  /** Weekly data for trend sparkline */
  weeklyData?: RBGapStatWeekly[];
  onClose: () => void;
}

const RB_RADAR_AXES = [
  { label: "EPA/Carry" },
  { label: "Yds/Carry" },
  { label: "Success%" },
  { label: "Explosive%" },
  { label: "Stuff Avoid%" },
  { label: "Volume" },
];

const RB_RADAR_KEYS = [
  "epa_per_carry",
  "yards_per_carry",
  "success_rate",
  "explosive_rate",
  "stuff_avoidance", // computed: 1 - stuff_rate
  "carries",
];

const GAP_ORDER = ["LE", "LT", "LG", "M", "RG", "RT", "RE"];

/** Aggregate a player's per-gap rows into overall stats */
function aggregatePlayer(rows: RBGapStat[]): {
  player_id: string;
  player_name: string;
  team_id: string;
  carries: number;
  epa_per_carry: number;
  yards_per_carry: number;
  success_rate: number;
  stuff_rate: number;
  explosive_rate: number;
  stuff_avoidance: number;
} {
  let totalCarries = 0;
  let epaSum = 0, ypcSum = 0, srSum = 0, stuffSum = 0, explSum = 0;

  for (const r of rows) {
    const c = r.carries || 0;
    totalCarries += c;
    if (r.epa_per_carry != null && !isNaN(r.epa_per_carry)) epaSum += r.epa_per_carry * c;
    if (r.yards_per_carry != null && !isNaN(r.yards_per_carry)) ypcSum += r.yards_per_carry * c;
    if (r.success_rate != null && !isNaN(r.success_rate)) srSum += r.success_rate * c;
    if (r.stuff_rate != null && !isNaN(r.stuff_rate)) stuffSum += r.stuff_rate * c;
    if (r.explosive_rate != null && !isNaN(r.explosive_rate)) explSum += r.explosive_rate * c;
  }

  const epa = totalCarries > 0 ? epaSum / totalCarries : NaN;
  const ypc = totalCarries > 0 ? ypcSum / totalCarries : NaN;
  const sr = totalCarries > 0 ? srSum / totalCarries : NaN;
  const stuff = totalCarries > 0 ? stuffSum / totalCarries : NaN;
  const expl = totalCarries > 0 ? explSum / totalCarries : NaN;

  return {
    player_id: rows[0]?.player_id ?? "",
    player_name: rows[0]?.player_name ?? "",
    team_id: rows[0]?.team_id ?? "",
    carries: totalCarries,
    epa_per_carry: epa,
    yards_per_carry: ypc,
    success_rate: sr,
    stuff_rate: stuff,
    explosive_rate: expl,
    stuff_avoidance: !isNaN(stuff) ? 1 - stuff : NaN,
  };
}

/** Build league-wide per-player aggregated stats for percentile computation */
function buildLeaguePool(allStats: RBGapStat[]): Map<string, ReturnType<typeof aggregatePlayer>> {
  const byPlayer = new Map<string, RBGapStat[]>();
  for (const r of allStats) {
    const rows = byPlayer.get(r.player_id) || [];
    rows.push(r);
    byPlayer.set(r.player_id, rows);
  }
  const pool = new Map<string, ReturnType<typeof aggregatePlayer>>();
  byPlayer.forEach((rows, pid) => {
    const agg = aggregatePlayer(rows);
    if (agg.carries >= 50) pool.set(pid, agg); // min 50 carries for percentile pool
  });
  return pool;
}

function computePercentile(sortedValues: number[], value: number): number {
  if (isNaN(value) || sortedValues.length === 0) return 0;
  const rank = sortedValues.filter((v) => v < value).length;
  return (rank / sortedValues.length) * 100;
}

function getStatValue(player: ReturnType<typeof aggregatePlayer>, key: string): number {
  switch (key) {
    case "epa_per_carry": return player.epa_per_carry;
    case "yards_per_carry": return player.yards_per_carry;
    case "success_rate": return player.success_rate;
    case "explosive_rate": return player.explosive_rate;
    case "stuff_avoidance": return player.stuff_avoidance;
    case "carries": return player.carries;
    default: return NaN;
  }
}

function formatChipValue(key: string, val: number): string {
  if (isNaN(val)) return "\u2014";
  switch (key) {
    case "epa_per_carry": return val.toFixed(2);
    case "yards_per_carry": return val.toFixed(1);
    case "success_rate":
    case "explosive_rate":
    case "stuff_avoidance": return (val * 100).toFixed(1) + "%";
    case "carries": return val.toString();
    default: return val.toFixed(2);
  }
}

function chipColor(rank: number, total: number): string {
  if (rank <= Math.ceil(total * 0.1)) return "#16a34a";
  if (rank > total - Math.ceil(total * 0.1)) return "#dc2626";
  return "#1e293b";
}

function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

export default function RBStatCard({ playerGapStats, allLeagueStats, weeklyData, onClose }: RBStatCardProps) {
  const isEmpty = playerGapStats.length === 0;
  const player = isEmpty ? null : aggregatePlayer(playerGapStats);
  const team = player ? getTeam(player.team_id) : null;
  const teamColor = player ? getTeamColor(player.team_id) : "#94a3b8";

  const leaguePool = useMemo(() => buildLeaguePool(allLeagueStats), [allLeagueStats]);
  const poolArray = useMemo(() => Array.from(leaguePool.values()), [leaguePool]);
  const total = poolArray.length;

  // Weekly trend: aggregate player's weekly data across all gaps
  const weeklyTrend = useMemo(() => {
    if (!weeklyData || !player) return [];
    const playerWeekly = weeklyData.filter(
      (r) => r.player_id === player.player_id && r.situation === "all" && r.field_zone === "all"
    );
    const byWeek = new Map<number, { carries: number; epaSum: number }>();
    for (const r of playerWeekly) {
      const c = r.carries || 0;
      const prev = byWeek.get(r.week) || { carries: 0, epaSum: 0 };
      prev.carries += c;
      if (r.epa_per_carry != null && !isNaN(r.epa_per_carry)) prev.epaSum += r.epa_per_carry * c;
      byWeek.set(r.week, prev);
    }
    return Array.from(byWeek.entries())
      .map(([week, v]) => ({
        week,
        epa: v.carries > 0 ? v.epaSum / v.carries : NaN,
        carries: v.carries,
      }))
      .filter((d) => d.carries > 0 && !isNaN(d.epa))
      .sort((a, b) => a.week - b.week);
  }, [weeklyData, player]);

  const handleKey = useCallback(
    (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); },
    [onClose]
  );

  useEffect(() => {
    document.addEventListener("keydown", handleKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", handleKey);
      document.body.style.overflow = "";
    };
  }, [handleKey]);

  // Compute radar percentiles
  const radarValues = useMemo(() => {
    if (!player) return [0, 0, 0, 0, 0, 0];
    return RB_RADAR_KEYS.map((key) => {
      const allVals = poolArray.map((p) => getStatValue(p, key)).filter((v) => !isNaN(v)).sort((a, b) => a - b);
      return computePercentile(allVals, getStatValue(player, key));
    });
  }, [poolArray, player]);

  // Compute chip data (rank among league pool)
  const chipData = useMemo(() => {
    if (!player) return [];
    return RB_RADAR_KEYS.map((key) => {
      const val = getStatValue(player, key);
      const allVals = poolArray.map((p) => getStatValue(p, key)).filter((v) => !isNaN(v));
      const rank = allVals.filter((v) => v > val).length + 1;
      return { key, val, rank, label: RB_RADAR_AXES[RB_RADAR_KEYS.indexOf(key)].label };
    });
  }, [poolArray, player]);

  // Per-gap breakdown
  const gapBreakdown = GAP_ORDER.map((g) => {
    const row = playerGapStats.find((r) => r.gap === g);
    return {
      gap: g,
      carries: row?.carries ?? 0,
      epa: row?.epa_per_carry ?? NaN,
    };
  });

  const modal = (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: "rgba(15,23,42,0.5)", backdropFilter: "blur(4px)" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="relative bg-white rounded-2xl shadow-2xl overflow-y-auto animate-in slide-in-from-bottom-4 fade-in duration-200"
        style={{ width: 420, maxWidth: "95vw", maxHeight: "95vh", padding: 28 }}
      >
        <button
          onClick={onClose}
          className="absolute top-3 right-3 w-8 h-8 flex items-center justify-center rounded-full text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
          aria-label="Close"
        >
          &times;
        </button>

        {isEmpty && (
          <div className="text-center py-8">
            <p className="text-gray-500 mb-4">No gap data available for this player.</p>
          </div>
        )}

        {player && <>
        {/* Header */}
        <div className="flex items-center gap-3.5 mb-5">
          <div
            className="w-11 h-11 rounded-full flex items-center justify-center text-white font-bold text-xs"
            style={{ backgroundColor: teamColor }}
          >
            {player!.team_id}
          </div>
          <div>
            <div className="text-xl font-bold text-gray-900">{player!.player_name}</div>
            <div className="text-xs text-gray-400">
              {team?.name ?? player!.team_id} &middot; {player!.carries} carries
            </div>
          </div>
        </div>

        {/* Radar */}
        <div className="flex justify-center mb-1">
          <RadarChart values={radarValues} color={teamColor} axes={RB_RADAR_AXES} />
        </div>
        <p className="text-[10px] text-gray-400 text-center mb-4">
          Percentiles vs. {total} rushers with 50+ carries
        </p>

        {/* Weekly EPA sparkline */}
        {weeklyTrend.length >= 2 && (() => {
          const W = 360;
          const H = 80;
          const PAD_X = 24;
          const PAD_Y = 12;
          const minWeek = weeklyTrend[0].week;
          const maxWeek = weeklyTrend[weeklyTrend.length - 1].week;
          const epas = weeklyTrend.map((d) => d.epa);
          const minEpa = Math.min(...epas, 0);
          const maxEpa = Math.max(...epas, 0);
          const rangeEpa = maxEpa - minEpa || 0.1;
          const xScale = (w: number) => PAD_X + ((w - minWeek) / (maxWeek - minWeek || 1)) * (W - PAD_X * 2);
          const yScale = (e: number) => PAD_Y + (1 - (e - minEpa) / rangeEpa) * (H - PAD_Y * 2);
          const zeroY = yScale(0);
          const pathD = weeklyTrend.map((d, i) => `${i === 0 ? "M" : "L"}${xScale(d.week).toFixed(1)},${yScale(d.epa).toFixed(1)}`).join(" ");
          const lastIdx = weeklyTrend.length - 1;

          return (
            <div className="mb-5">
              <div className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide mb-2">
                EPA/Carry by Week
              </div>
              <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ maxHeight: 80 }}>
                {/* Zero line */}
                <line x1={PAD_X} y1={zeroY} x2={W - PAD_X} y2={zeroY} stroke="#e2e8f0" strokeWidth={1} strokeDasharray="4,3" />
                {/* Trend line */}
                <path d={pathD} fill="none" stroke={teamColor} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
                {/* Data points */}
                {weeklyTrend.map((d, i) => (
                  <g key={d.week}>
                    <circle cx={xScale(d.week)} cy={yScale(d.epa)} r={i === lastIdx ? 5 : 3} fill={teamColor}>
                      <title>Week {d.week}: {d.epa >= 0 ? "+" : ""}{d.epa.toFixed(2)} EPA/carry ({d.carries} carries)</title>
                    </circle>
                    <text x={xScale(d.week)} y={H - 1} textAnchor="middle" fontSize={8} fill="#94a3b8">{d.week}</text>
                  </g>
                ))}
                {/* Zero label */}
                <text x={PAD_X - 4} y={zeroY + 3} textAnchor="end" fontSize={8} fill="#94a3b8">0</text>
              </svg>
            </div>
          );
        })()}

        {/* Stat chips */}
        <div className="grid grid-cols-3 gap-2 mb-5">
          {chipData.map((chip) => (
            <div key={chip.key} className="rounded-lg p-2.5 text-center" style={{ background: "#f8fafc" }}>
              <div className="text-[10px] text-gray-400 uppercase tracking-wide">{chip.label}</div>
              <div className="text-base font-bold my-0.5" style={{ color: chipColor(chip.rank, total) }}>
                {formatChipValue(chip.key, chip.val)}
              </div>
              <div className="text-[10px] text-gray-400">{ordinal(chip.rank)} of {total}</div>
            </div>
          ))}
        </div>

        {/* Gap breakdown */}
        <div className="border-t border-gray-100 pt-4">
          <div className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide mb-3">
            EPA/Carry by Gap
          </div>
          <div className="flex gap-1 overflow-x-auto pb-1">
            {gapBreakdown.map((g) => (
              <div key={g.gap} className="text-center flex-1 min-w-[46px]">
                <div className="text-[10px] font-semibold text-gray-500">{g.gap}</div>
                <div
                  className="text-sm font-bold"
                  style={{ color: !isNaN(g.epa) && g.epa > 0 ? "#16a34a" : !isNaN(g.epa) && g.epa < 0 ? "#dc2626" : "#94a3b8" }}
                >
                  {!isNaN(g.epa) ? (g.epa >= 0 ? "+" : "") + g.epa.toFixed(2) : "\u2014"}
                </div>
                <div className="text-[9px] text-gray-400">{g.carries} car</div>
              </div>
            ))}
          </div>
        </div>

        </>}

        <div className="text-center text-[11px] text-gray-300 font-medium mt-4">
          yardsperpass.com
        </div>
      </div>
    </div>
  );

  return createPortal(modal, document.body);
}
