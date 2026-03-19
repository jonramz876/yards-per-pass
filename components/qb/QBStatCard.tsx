// components/qb/QBStatCard.tsx
"use client";

import { useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import type { QBSeasonStat } from "@/lib/types";
import { getTeam, getTeamColor } from "@/lib/data/teams";
import RadarChart from "./RadarChart";

interface QBStatCardProps {
  qb: QBSeasonStat;
  allQBs: QBSeasonStat[];
  getVal: (qb: QBSeasonStat, key: string) => number;
  onClose: () => void;
  season: number;
  minDropbacks?: number;
}

const RADAR_KEYS = [
  "epa_per_play",
  "cpoe",
  "adot",
  "td_int_ratio",
  "rush_epa_per_play",
  "success_rate",
];

const RADAR_LABELS: Record<string, string> = {
  epa_per_play: "EPA/Play",
  cpoe: "CPOE",
  adot: "aDOT",
  td_int_ratio: "TD:INT",
  rush_epa_per_play: "Rush EPA",
  success_rate: "Success%",
};

const BAR_STATS = [
  { key: "yards_per_game", label: "Yds/G" },
  { key: "tds_per_game", label: "TD/G" },
  { key: "completion_pct", label: "Comp%" },
  { key: "ypa", label: "YPA" },
];

const BAR_STATS_RUSHER = [
  { key: "yards_per_game", label: "Yds/G" },
  { key: "tds_per_game", label: "TD/G" },
  { key: "completion_pct", label: "Comp%" },
  { key: "rush_yards_per_game", label: "Rush Y/G" },
];

function computePercentile(allValues: number[], value: number): number {
  if (isNaN(value) || allValues.length === 0) return 0;
  const rank = allValues.filter((v) => v < value).length;
  return (rank / allValues.length) * 100;
}

function computeRank(allValues: number[], value: number): number {
  if (isNaN(value)) return allValues.length;
  return allValues.filter((v) => v > value).length + 1;
}

function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

function formatChipValue(key: string, val: number): string {
  if (isNaN(val)) return "\u2014";
  switch (key) {
    case "epa_per_play":
    case "rush_epa_per_play":
      return val.toFixed(2);
    case "success_rate":
      return (val * 100).toFixed(1) + "%";
    case "cpoe":
      return (val >= 0 ? "+" : "") + val.toFixed(1);
    case "adot":
      return val.toFixed(1);
    case "td_int_ratio":
      return val === Infinity ? "\u221E" : val.toFixed(1) + ":1";
    default:
      return val.toFixed(2);
  }
}

function chipColor(rank: number, total: number): string {
  if (rank <= Math.ceil(total * 0.1)) return "#16a34a";
  if (rank > total - Math.ceil(total * 0.1)) return "#dc2626";
  return "#1e293b";
}

export default function QBStatCard({ qb, allQBs, getVal: gv, onClose, season, minDropbacks }: QBStatCardProps) {
  const team = getTeam(qb.team_id);
  const teamColor = getTeamColor(qb.team_id);
  const total = allQBs.length;

  const handleKey = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    },
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

  const radarValues = RADAR_KEYS.map((key) => {
    const allVals = allQBs
      .map((q) => gv(q, key))
      .filter((v) => !isNaN(v))
      .sort((a, b) => a - b);
    return computePercentile(allVals, gv(qb, key));
  });

  const chipData = RADAR_KEYS.map((key) => {
    const val = gv(qb, key);
    const allVals = allQBs.map((q) => gv(q, key)).filter((v) => !isNaN(v));
    const rank = computeRank(allVals, val);
    return { key, val, rank };
  });

  const isDualThreat = gv(qb, "rush_epa_per_play") > 0;
  const barStats = isDualThreat ? BAR_STATS_RUSHER : BAR_STATS;

  const getBarVal = (q: QBSeasonStat, key: string): number => {
    if (key === "rush_yards_per_game") {
      return q.games ? q.rush_yards / q.games : NaN;
    }
    return gv(q, key);
  };

  const barData = barStats.map((stat) => {
    const val = getBarVal(qb, stat.key);
    const allVals = allQBs.map((q) => getBarVal(q, stat.key)).filter((v) => !isNaN(v));
    const avg = allVals.length
      ? allVals.reduce((a, b) => a + b, 0) / allVals.length
      : 0;
    const delta = val - avg;
    const barWidth = avg !== 0 ? Math.min(Math.abs(delta / avg) * 100, 45) : 0;
    return { ...stat, val, avg, delta, barWidth };
  });

  const modal = (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: "rgba(15,23,42,0.5)", backdropFilter: "blur(4px)" }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
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

        <div className="flex items-center gap-3.5 mb-5">
          <div
            className="w-11 h-11 rounded-full flex items-center justify-center text-white font-bold text-xs"
            style={{ backgroundColor: teamColor }}
          >
            {qb.team_id}
          </div>
          <div>
            <div className="text-xl font-bold text-gray-900">{qb.player_name}</div>
            <div className="text-xs text-gray-400">
              {team?.name ?? qb.team_id} &middot; {qb.season}
            </div>
          </div>
        </div>

        <div className="flex justify-center mb-1">
          <RadarChart values={radarValues} color={teamColor} />
        </div>
        <p className="text-[10px] text-gray-400 text-center mb-4">
          Percentiles vs. {total} QBs{minDropbacks ? ` with ${minDropbacks}+ dropbacks` : ""}
        </p>

        <div className="grid grid-cols-3 gap-2 mb-5">
          {chipData.map((chip) => (
            <div
              key={chip.key}
              className="rounded-lg p-2.5 text-center"
              style={{ background: "#f8fafc" }}
            >
              <div className="text-[10px] text-gray-400 uppercase tracking-wide">
                {RADAR_LABELS[chip.key]}
              </div>
              <div
                className="text-base font-bold my-0.5"
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

        <div className="border-t border-gray-100 pt-4">
          <div className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide mb-3">
            vs. League Average{minDropbacks ? ` (${minDropbacks}+ dropbacks)` : ""}
          </div>
          {barData.map((bar) => (
            <div key={bar.key} className="flex items-center gap-2 mb-2.5">
              <div className="text-[11px] text-gray-500 w-[50px] text-right">
                {bar.label}
              </div>
              <div
                className="flex-1 h-6 rounded relative overflow-hidden"
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
                  avg: {isNaN(bar.avg) ? "\u2014" : bar.avg < 10 ? bar.avg.toFixed(1) : bar.avg.toFixed(0)}
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
              <div className="w-[90px] text-right leading-tight">
                <div className="text-[11px] font-bold text-gray-900">
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

        <Link
          href={`/run-gaps?team=${qb.team_id}&season=${season}`}
          className="block text-center text-sm font-semibold text-navy hover:text-nflred transition-colors mt-4 py-2"
          onClick={onClose}
        >
          View {team?.name ?? qb.team_id} Run Gaps →
        </Link>

        <div className="text-center text-[11px] text-gray-300 font-medium mt-4">
          yardsperpass.com
        </div>
      </div>
    </div>
  );

  return createPortal(modal, document.body);
}
