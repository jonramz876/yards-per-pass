// components/team/DownDistanceHeatmap.tsx
"use client";

import { useState, useMemo } from "react";
import type { TeamDownDistanceStat } from "@/lib/types";

interface DownDistanceHeatmapProps {
  stats: TeamDownDistanceStat[];
  nflAvg: TeamDownDistanceStat[];
  teamName: string;
}

const DOWNS = [1, 2, 3, 4];
const DISTANCE_BINS = ["1-2", "3-4", "5-7", "8-10", "11+"];
const DISTANCE_LABELS = ["1-2 yds", "3-4 yds", "5-7 yds", "8-10 yds", "11+ yds"];

type Metric = "epa_per_carry" | "success_rate" | "yards_per_carry";
const METRICS: { key: Metric; label: string; format: (v: number) => string }[] = [
  { key: "epa_per_carry", label: "EPA/Carry", format: (v) => v.toFixed(2) },
  { key: "success_rate", label: "Success%", format: (v) => (v * 100).toFixed(0) + "%" },
  { key: "yards_per_carry", label: "YPC", format: (v) => v.toFixed(1) },
];

// Fixed EPA scale: -0.3 (red) → 0 (white) → +0.3 (green)
function epaColor(val: number): string {
  if (isNaN(val)) return "#f8fafc";
  const clamped = Math.max(-0.3, Math.min(0.3, val));
  const t = (clamped + 0.3) / 0.6; // 0 = worst, 1 = best
  if (t < 0.5) {
    const r = 220 + Math.round((255 - 220) * (t / 0.5));
    const g = 50 + Math.round((255 - 50) * (t / 0.5));
    const b = 50 + Math.round((255 - 50) * (t / 0.5));
    return `rgb(${r},${g},${b})`;
  }
  const r = 255 - Math.round((255 - 34) * ((t - 0.5) / 0.5));
  const g = 255 - Math.round((255 - 197) * ((t - 0.5) / 0.5));
  const b = 255 - Math.round((255 - 94) * ((t - 0.5) / 0.5));
  return `rgb(${r},${g},${b})`;
}

// Success rate: 0% (red) → 50% (white) → 70%+ (green)
function successColor(val: number): string {
  if (isNaN(val)) return "#f8fafc";
  const pct = val * 100;
  const clamped = Math.max(20, Math.min(70, pct));
  const t = (clamped - 20) / 50;
  if (t < 0.5) {
    const r = 220 + Math.round(35 * (t / 0.5));
    const g = 50 + Math.round(205 * (t / 0.5));
    const b = 50 + Math.round(205 * (t / 0.5));
    return `rgb(${r},${g},${b})`;
  }
  const r = 255 - Math.round(221 * ((t - 0.5) / 0.5));
  const g = 255 - Math.round(58 * ((t - 0.5) / 0.5));
  const b = 255 - Math.round(161 * ((t - 0.5) / 0.5));
  return `rgb(${r},${g},${b})`;
}

// YPC: 2 (red) → 4 (white) → 6+ (green)
function ypcColor(val: number): string {
  if (isNaN(val)) return "#f8fafc";
  const clamped = Math.max(2, Math.min(6, val));
  const t = (clamped - 2) / 4;
  if (t < 0.5) {
    const r = 220 + Math.round(35 * (t / 0.5));
    const g = 50 + Math.round(205 * (t / 0.5));
    const b = 50 + Math.round(205 * (t / 0.5));
    return `rgb(${r},${g},${b})`;
  }
  const r = 255 - Math.round(221 * ((t - 0.5) / 0.5));
  const g = 255 - Math.round(58 * ((t - 0.5) / 0.5));
  const b = 255 - Math.round(161 * ((t - 0.5) / 0.5));
  return `rgb(${r},${g},${b})`;
}

function getColor(metric: Metric, val: number): string {
  if (metric === "epa_per_carry") return epaColor(val);
  if (metric === "success_rate") return successColor(val);
  return ypcColor(val);
}

function textColor(bg: string): string {
  // Simple luminance check — if background is light, use dark text
  const match = bg.match(/\d+/g);
  if (!match) return "#0f172a";
  const [r, g, b] = match.map(Number);
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return lum > 0.6 ? "#0f172a" : "#ffffff";
}

export default function DownDistanceHeatmap({ stats, nflAvg, teamName }: DownDistanceHeatmapProps) {
  const [metric, setMetric] = useState<Metric>("epa_per_carry");
  const currentMetric = METRICS.find((m) => m.key === metric)!;

  // Build lookup: down-bin → stat
  const lookup = useMemo(() => {
    const map = new Map<string, TeamDownDistanceStat>();
    for (const s of stats) map.set(`${s.down}-${s.distance_bin}`, s);
    return map;
  }, [stats]);

  const nflLookup = useMemo(() => {
    const map = new Map<string, TeamDownDistanceStat>();
    for (const s of nflAvg) map.set(`${s.down}-${s.distance_bin}`, s);
    return map;
  }, [nflAvg]);

  if (stats.length === 0) return null;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h3 className="text-lg font-bold text-gray-900">Rushing by Down & Distance</h3>
        <div className="flex gap-1">
          {METRICS.map((m) => (
            <button
              key={m.key}
              onClick={() => setMetric(m.key)}
              className={`px-3 py-1 text-xs font-medium rounded-full transition-colors ${
                metric === m.key
                  ? "bg-gray-900 text-white"
                  : "bg-gray-100 text-gray-600 hover:bg-gray-200"
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>

      {/* Heatmap grid */}
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr>
              <th className="px-3 py-2 text-left text-xs font-semibold text-gray-500 w-20">Down</th>
              {DISTANCE_BINS.map((bin, i) => (
                <th key={bin} className="px-2 py-2 text-center text-xs font-semibold text-gray-500">
                  {DISTANCE_LABELS[i]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {DOWNS.map((down) => (
              <tr key={down}>
                <td className="px-3 py-1 font-bold text-gray-700 text-sm">
                  {down === 1 ? "1st" : down === 2 ? "2nd" : down === 3 ? "3rd" : "4th"}
                </td>
                {DISTANCE_BINS.map((bin) => {
                  const cell = lookup.get(`${down}-${bin}`);
                  const nfl = nflLookup.get(`${down}-${bin}`);
                  const val = cell ? cell[metric] : NaN;
                  const nflVal = nfl ? nfl[metric] : NaN;
                  const carries = cell?.carries ?? 0;
                  const lowSample = carries < 5;
                  const bg = lowSample ? "#f8fafc" : getColor(metric, val);
                  const fg = textColor(bg);

                  return (
                    <td
                      key={bin}
                      className="px-2 py-2 text-center relative"
                      style={{
                        backgroundColor: bg,
                        color: fg,
                        border: lowSample ? "1px dashed #cbd5e1" : "1px solid #e2e8f0",
                        minWidth: 80,
                      }}
                    >
                      {carries === 0 ? (
                        <span className="text-xs text-gray-400">—</span>
                      ) : (
                        <div>
                          <div className={`text-sm font-bold ${lowSample ? "text-gray-400" : ""}`}>
                            {currentMetric.format(val)}
                          </div>
                          <div className="text-[10px] opacity-70">
                            {carries} car
                            {!isNaN(nflVal) && !lowSample && (
                              <span className="ml-1">
                                (NFL: {currentMetric.format(nflVal)})
                              </span>
                            )}
                          </div>
                        </div>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Legend */}
      <div className="flex items-center gap-2 text-[10px] text-gray-400 flex-wrap">
        <span className="inline-block w-3 h-3 rounded" style={{ backgroundColor: getColor(metric, metric === "epa_per_carry" ? -0.3 : metric === "success_rate" ? 0.2 : 2) }} />
        <span>Poor</span>
        <span className="inline-block w-3 h-3 rounded bg-white border border-gray-200" />
        <span>Break-even{metric === "epa_per_carry" ? " (0.00)" : ""}</span>
        <span className="inline-block w-3 h-3 rounded" style={{ backgroundColor: getColor(metric, metric === "epa_per_carry" ? 0.3 : metric === "success_rate" ? 0.7 : 6) }} />
        <span>Elite</span>
        <span className="ml-2 border border-dashed border-gray-300 px-1 rounded">Dashed = &lt;5 carries</span>
        {metric === "epa_per_carry" && (
          <span className="ml-1">NFL avg rush EPA ~-0.06</span>
        )}
      </div>
    </div>
  );
}
