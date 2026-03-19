// components/receivers/ReceiverStatCard.tsx
"use client";

import { useEffect, useCallback, useMemo } from "react";
import { createPortal } from "react-dom";
import type { ReceiverSeasonStat } from "@/lib/types";
import { getTeam, getTeamColor } from "@/lib/data/teams";
import RadarChart from "@/components/qb/RadarChart";

interface ReceiverStatCardProps {
  receiver: ReceiverSeasonStat;
  allReceivers: ReceiverSeasonStat[];
  minTargets: number;
  onClose: () => void;
}

const RADAR_AXES = [
  { label: "EPA/Tgt" },
  { label: "Catch%" },
  { label: "ADOT" },
  { label: "YAC/Rec" },
  { label: "Tgt Share" },
  { label: "YPRR" },
];

const RADAR_KEYS = [
  "epa_per_target",
  "catch_rate",
  "air_yards_per_target",
  "yac_per_reception",
  "target_share",
  "yards_per_route_run",
];

const RADAR_LABELS: Record<string, string> = {
  epa_per_target: "EPA/Tgt",
  catch_rate: "Catch%",
  air_yards_per_target: "ADOT",
  yac_per_reception: "YAC/Rec",
  target_share: "Tgt Share",
  yards_per_route_run: "YPRR",
};

const BAR_STATS = [
  { key: "yards_per_game", label: "Yds/G" },
  { key: "tds_per_game", label: "TD/G" },
  { key: "receptions_per_game", label: "Rec/G" },
  { key: "yards_per_reception", label: "YPR" },
];

function getStatValue(rec: ReceiverSeasonStat, key: string): number {
  switch (key) {
    case "epa_per_target": return rec.epa_per_target;
    case "catch_rate": return rec.catch_rate;
    case "air_yards_per_target": return rec.air_yards_per_target;
    case "yac_per_reception": return rec.yac_per_reception;
    case "target_share": return rec.target_share;
    case "yards_per_route_run": return rec.yards_per_route_run;
    default: return NaN;
  }
}

function formatChipValue(key: string, val: number): string {
  if (isNaN(val)) return "\u2014";
  switch (key) {
    case "epa_per_target": return val.toFixed(2);
    case "catch_rate":
    case "target_share": return (val * 100).toFixed(1) + "%";
    case "air_yards_per_target":
    case "yac_per_reception": return val.toFixed(1);
    case "yards_per_route_run": return val.toFixed(2);
    default: return val.toFixed(2);
  }
}

function getBarVal(rec: ReceiverSeasonStat, key: string): number {
  switch (key) {
    case "yards_per_game": return rec.games ? rec.receiving_yards / rec.games : NaN;
    case "tds_per_game": return rec.games ? rec.receiving_tds / rec.games : NaN;
    case "receptions_per_game": return rec.games ? rec.receptions / rec.games : NaN;
    default: return (rec[key as keyof ReceiverSeasonStat] as number) ?? NaN;
  }
}

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

function chipColor(rank: number, total: number): string {
  if (rank <= Math.ceil(total * 0.1)) return "#16a34a";
  if (rank > total - Math.ceil(total * 0.1)) return "#dc2626";
  return "#1e293b";
}

export default function ReceiverStatCard({ receiver, allReceivers, minTargets, onClose }: ReceiverStatCardProps) {
  const team = getTeam(receiver.team_id);
  const teamColor = getTeamColor(receiver.team_id);

  // Percentile pool: already filtered by leaderboard's min targets slider
  const pool = useMemo(() => allReceivers, [allReceivers]);
  const total = pool.length;

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

  const radarValues = useMemo(
    () =>
      RADAR_KEYS.map((key) => {
        const allVals = pool
          .map((r) => getStatValue(r, key))
          .filter((v) => !isNaN(v))
          .sort((a, b) => a - b);
        return computePercentile(allVals, getStatValue(receiver, key));
      }),
    [receiver, pool]
  );

  const chipData = useMemo(
    () =>
      RADAR_KEYS.map((key) => {
        const val = getStatValue(receiver, key);
        const allVals = pool.map((r) => getStatValue(r, key)).filter((v) => !isNaN(v));
        const rank = computeRank(allVals, val);
        return { key, val, rank };
      }),
    [receiver, pool]
  );

  const barData = useMemo(
    () =>
      BAR_STATS.map((stat) => {
        const val = getBarVal(receiver, stat.key);
        const allVals = pool.map((r) => getBarVal(r, stat.key)).filter((v) => !isNaN(v));
        const avg = allVals.length
          ? allVals.reduce((a, b) => a + b, 0) / allVals.length
          : 0;
        const delta = val - avg;
        const barWidth = avg !== 0 ? Math.min(Math.abs(delta / avg) * 100, 45) : 0;
        return { ...stat, val, avg, delta, barWidth };
      }),
    [receiver, pool]
  );

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

        {/* Header */}
        <div className="flex items-center gap-3.5 mb-5">
          <div
            className="w-11 h-11 rounded-full flex items-center justify-center text-white font-bold text-xs"
            style={{ backgroundColor: teamColor }}
          >
            {receiver.team_id}
          </div>
          <div>
            <div className="text-xl font-bold text-gray-900">{receiver.player_name}</div>
            <div className="text-xs text-gray-400">
              {team?.name ?? receiver.team_id} &middot; {receiver.position} &middot; {receiver.season}
            </div>
          </div>
        </div>

        {/* Radar Chart */}
        <div className="flex justify-center mb-1">
          <RadarChart values={radarValues} color={teamColor} axes={RADAR_AXES} />
        </div>
        <p className="text-[10px] text-gray-400 text-center mb-4">
          Percentiles vs. {total} receivers with {minTargets}+ targets
        </p>

        {/* Stat Chips */}
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

        {/* vs. League Average Bars */}
        <div className="border-t border-gray-100 pt-4">
          <div className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide mb-3">
            vs. League Average ({minTargets}+ targets)
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

        {/* Footer */}
        <div className="text-center text-[11px] text-gray-300 font-medium mt-4">
          yardsperpass.com
        </div>
      </div>
    </div>
  );

  return createPortal(modal, document.body);
}
