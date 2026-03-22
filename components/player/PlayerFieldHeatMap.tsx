// components/player/PlayerFieldHeatMap.tsx
"use client";

import { useState } from "react";
import type { QBPassLocationStat } from "@/lib/types";

/* ─── Props ─── */
interface PlayerFieldHeatMapProps {
  stats: QBPassLocationStat[];
  playerName: string;
  season: number;
}

/* ─── Tab definitions ─── */
type TabKey = "epa" | "cpoe" | "ypa" | "yards";

const TABS: { key: TabKey; label: string }[] = [
  { key: "epa", label: "EPA/Att" },
  { key: "cpoe", label: "CPOE" },
  { key: "ypa", label: "Yds/Att" },
  { key: "yards", label: "Yards" },
];

/* ─── Zone grid (depth × direction) ─── */
const DEPTH_BINS = ["deep", "intermediate", "short"] as const;
const DIR_BINS = ["left", "middle", "right"] as const;

const ZONES: { depth: string; dir: string }[] = [];
for (const depth of DEPTH_BINS) {
  for (const dir of DIR_BINS) {
    ZONES.push({ depth, dir });
  }
}

/* ─── Layout constants ─── */
// 24px gaps between rows for yard-line pill labels
const ROWS: Record<string, { y: number; h: number }> = {
  deep: { y: 30, h: 76 },
  intermediate: { y: 132, h: 82 },
  short: { y: 240, h: 82 },
};
const COLS: Record<string, { x: number; w: number }> = {
  left: { x: 48, w: 96 },
  middle: { x: 152, w: 96 },
  right: { x: 256, w: 96 },
};

const DEPTH_LABELS: { depth: string; label: string }[] = [
  { depth: "deep", label: "DEEP (20+)" },
  { depth: "intermediate", label: "INTERMEDIATE" },
  { depth: "short", label: "SHORT (0-9)" },
];

const DIR_LABELS: { dir: string; label: string; x: number }[] = [
  { dir: "left", label: "\u2190 LEFT", x: 96 },
  { dir: "middle", label: "MIDDLE", x: 200 },
  { dir: "right", label: "RIGHT \u2192", x: 304 },
];

/* ─── Color helpers ─── */
function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function getCellColor(
  tab: TabKey,
  zone: QBPassLocationStat | undefined,
  maxAttempts: number,
  maxYards: number,
): string {
  if (!zone || zone.pass_attempts === 0) return "rgba(255,255,255,0.03)";

  switch (tab) {
    case "epa": {
      // Blue/red intensity based on attempt volume — more attempts = more saturated
      const ratio = maxAttempts > 0 ? zone.pass_attempts / maxAttempts : 0;
      const t = clamp(ratio, 0.08, 0.55);
      // Blue tint for volume (EPA number itself shows green/red for efficiency)
      return `rgba(37, 99, 235, ${t})`;
    }
    case "cpoe": {
      // Blue-to-red divergent: positive CPOE = blue, negative = red
      const cpoe = zone.cpoe ?? 0;
      if (cpoe >= 0) {
        const t = clamp(cpoe / 15, 0.08, 0.55); // 15 CPOE = max saturation
        return `rgba(37, 99, 235, ${t})`; // blue
      }
      const t = clamp(Math.abs(cpoe) / 15, 0.08, 0.55);
      return `rgba(220, 38, 38, ${t})`; // red
    }
    case "ypa": {
      const ypa = zone.yards_per_attempt ?? 0;
      const intensity = clamp(ypa / 15, 0.08, 0.55); // 15 Y/A = max
      return `rgba(16, 185, 129, ${intensity})`; // green
    }
    case "yards": {
      const intensity = clamp(maxYards > 0 ? zone.passing_yards / maxYards : 0, 0.08, 0.55);
      return `rgba(16, 185, 129, ${intensity})`;
    }
    default:
      return "rgba(255,255,255,0.03)";
  }
}

/** EPA number text color: green for positive, red for negative, white for zero */
function epaTextColor(epa: number | null): string {
  if (epa == null) return "white";
  if (epa > 0.05) return "#4ade80";
  if (epa < -0.05) return "#f87171";
  return "white";
}

function getBigNumber(tab: TabKey, zone: QBPassLocationStat | undefined): string {
  if (!zone || zone.pass_attempts === 0) return "\u2014";

  switch (tab) {
    case "epa": {
      const v = zone.epa_per_attempt;
      if (v == null) return "\u2014";
      return v >= 0 ? `+${v.toFixed(2)}` : v.toFixed(2);
    }
    case "cpoe": {
      const v = zone.cpoe;
      if (v == null) return "\u2014";
      return v >= 0 ? `+${v.toFixed(1)}%` : `${v.toFixed(1)}%`;
    }
    case "ypa":
      return zone.yards_per_attempt != null ? zone.yards_per_attempt.toFixed(1) : "\u2014";
    case "yards":
      return String(Math.round(zone.passing_yards));
    default:
      return "\u2014";
  }
}

/** Sub-line text varies by tab */
function getSubLine(tab: TabKey, zone: QBPassLocationStat): string {
  if (tab === "cpoe") {
    const pct = zone.completion_pct != null ? (zone.completion_pct * 100).toFixed(0) : "0";
    return `${zone.completions}/${zone.pass_attempts} \u2014 ${pct}%`;
  }
  if (tab === "ypa") {
    return `${zone.pass_attempts} att \u2014 ${Math.round(zone.passing_yards)} yds`;
  }
  if (tab === "yards") {
    return `${zone.completions} comp / ${zone.pass_attempts} att`;
  }
  return `${zone.completions}/${zone.pass_attempts}`;
}

/** Big number fill color depends on tab */
function getBigNumberColor(tab: TabKey, zone: QBPassLocationStat | undefined): string {
  if (!zone) return "white";
  if (tab === "epa") return epaTextColor(zone.epa_per_attempt);
  return "white";
}

/* ─── Component ─── */
export default function PlayerFieldHeatMap({
  stats,
  playerName,
  season,
}: PlayerFieldHeatMapProps) {
  const [activeTab, setActiveTab] = useState<TabKey>("epa");

  if (stats.length === 0) {
    return (
      <div className="text-gray-400 text-center py-12">
        No pass location data available for {playerName} ({season}).
      </div>
    );
  }

  /* Build lookup */
  const lookup: Record<string, QBPassLocationStat> = {};
  for (const s of stats) {
    lookup[`${s.depth_bin}-${s.direction_bin}`] = s;
  }

  /* Compute season totals */
  const totalAttempts = stats.reduce((a, s) => a + s.pass_attempts, 0);
  const totalCompletions = stats.reduce((a, s) => a + s.completions, 0);
  const totalYards = stats.reduce((a, s) => a + s.passing_yards, 0);
  const totalTds = stats.reduce((a, s) => a + s.pass_tds, 0);
  const totalInts = stats.reduce((a, s) => a + s.interceptions, 0);
  const totalCompPct = totalAttempts > 0 ? (totalCompletions / totalAttempts) * 100 : 0;
  const totalEpa = stats.reduce((a, s) => a + (s.epa_sum ?? 0), 0);

  /* Compute max values for color normalization */
  const maxAttempts = Math.max(...stats.map((s) => s.pass_attempts), 1);
  const maxYards = Math.max(...stats.map((s) => s.passing_yards), 1);

  return (
    <div className="max-w-lg mx-auto">
      {/* Tab bar */}
      <div className="flex gap-1 mb-3">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setActiveTab(t.key)}
            className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors ${
              activeTab === t.key
                ? "bg-[#1a2332] text-white"
                : "bg-gray-100 text-gray-500 hover:bg-gray-200"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Summary bar */}
      <div className="bg-[#1a2332] text-white rounded-lg px-4 py-2 mb-3 flex flex-wrap items-center justify-between text-xs gap-y-1">
        <span className="font-semibold">{playerName} <span className="font-normal opacity-70">| {season}</span></span>
        <div className="flex gap-3">
          <span className="text-yellow-400">{totalEpa >= 0 ? "+" : ""}{totalEpa.toFixed(1)} EPA</span>
          <span>{totalCompletions}/{totalAttempts}</span>
          <span>{totalCompPct.toFixed(1)}%</span>
          <span>{Math.round(totalYards)} yds</span>
          <span className="text-green-400">{totalTds} TD</span>
          <span className="text-red-400">{totalInts} INT</span>
        </div>
      </div>

      {/* SVG Field Diagram + Legend */}
      <div className="flex items-start gap-2">
        <svg viewBox="0 0 360 350" className="w-full flex-1" role="img" aria-label={`${playerName} pass location heat map`}>
          {/* Turf background */}
          <rect x={40} y={0} width={320} height={350} rx={8} fill="#2d5a27" />

          {/* Top boundary */}
          <line x1={40} y1={8} x2={360} y2={8} stroke="rgba(255,255,255,0.3)" strokeWidth={1} />

          {/* 20-yard line */}
          <line x1={40} y1={118} x2={360} y2={118} stroke="rgba(255,255,255,0.35)" strokeWidth={1} strokeDasharray="6,4" />
          <rect x={180} y={109} width={40} height={16} rx={8} fill="rgba(0,0,0,0.5)" />
          <text x={200} y={121} textAnchor="middle" fontSize={9} fill="rgba(255,255,255,0.85)" fontWeight={600}>
            20 yds
          </text>

          {/* 10-yard line */}
          <line x1={40} y1={226} x2={360} y2={226} stroke="rgba(255,255,255,0.35)" strokeWidth={1} strokeDasharray="6,4" />
          <rect x={180} y={217} width={40} height={16} rx={8} fill="rgba(0,0,0,0.5)" />
          <text x={200} y={229} textAnchor="middle" fontSize={9} fill="rgba(255,255,255,0.85)" fontWeight={600}>
            10 yds
          </text>

          {/* Line of scrimmage */}
          <line x1={40} y1={330} x2={360} y2={330} stroke="#f59e0b" strokeWidth={2} />
          <rect x={170} y={334} width={60} height={14} rx={7} fill="rgba(0,0,0,0.45)" />
          <text x={200} y={344} textAnchor="middle" fontSize={8} fill="#f59e0b" fontWeight={700}>
            SCRIMMAGE
          </text>

          {/* Source branding */}
          <text x={356} y={344} textAnchor="end" fontSize={8} fill="rgba(255,255,255,0.35)" fontFamily="system-ui, sans-serif">
            yardsperpass.com
          </text>

          {/* Direction labels at top */}
          {DIR_LABELS.map((d) => (
            <text
              key={d.dir}
              x={d.x}
              y={25}
              textAnchor="middle"
              fontSize={10}
              fill="rgba(255,255,255,0.6)"
              fontWeight={600}
            >
              {d.label}
            </text>
          ))}

          {/* Depth labels on left gutter (rotated 90°) */}
          {DEPTH_LABELS.map((d) => {
            const row = ROWS[d.depth];
            const cy = row.y + row.h / 2;
            return (
              <text
                key={d.depth}
                x={28}
                y={cy}
                textAnchor="middle"
                fontSize={9}
                fill="rgba(255,255,255,0.55)"
                fontWeight={700}
                transform={`rotate(-90, 28, ${cy})`}
              >
                {d.label}
              </text>
            );
          })}

          {/* Grid cells */}
          {ZONES.map(({ depth, dir }) => {
            const row = ROWS[depth];
            const col = COLS[dir];
            const zone = lookup[`${depth}-${dir}`];
            const fillColor = getCellColor(activeTab, zone, maxAttempts, maxYards);
            const bigNum = getBigNumber(activeTab, zone);
            const bigNumColor = getBigNumberColor(activeTab, zone);
            const isEmpty = !zone || zone.pass_attempts === 0;
            const cx = col.x + col.w / 2;
            const cy = row.y + row.h / 2;

            return (
              <g key={`${depth}-${dir}`}>
                {/* Cell background */}
                <rect
                  x={col.x}
                  y={row.y}
                  width={col.w}
                  height={row.h}
                  rx={6}
                  fill={fillColor}
                  stroke="rgba(255,255,255,0.12)"
                  strokeWidth={1}
                />

                {isEmpty ? (
                  <text
                    x={cx}
                    y={cy + 4}
                    textAnchor="middle"
                    fontSize={20}
                    fill="rgba(255,255,255,0.25)"
                    fontWeight={700}
                  >
                    {"\u2014"}
                  </text>
                ) : (
                  <>
                    {/* Big number */}
                    <text
                      x={cx}
                      y={cy - 10}
                      textAnchor="middle"
                      fontSize={18}
                      fill={bigNumColor}
                      fontWeight={700}
                    >
                      {bigNum}
                    </text>

                    {/* Sub-line */}
                    <text
                      x={cx}
                      y={cy + 6}
                      textAnchor="middle"
                      fontSize={10}
                      fill="rgba(255,255,255,0.7)"
                    >
                      {getSubLine(activeTab, zone)}
                    </text>

                    {/* TD badge */}
                    {zone.pass_tds > 0 && (
                      <text
                        x={cx - (zone.interceptions > 0 ? 16 : 0)}
                        y={cy + 20}
                        textAnchor="middle"
                        fontSize={9}
                        fill="#4ade80"
                        fontWeight={700}
                      >
                        {zone.pass_tds} TD
                      </text>
                    )}

                    {/* INT badge */}
                    {zone.interceptions > 0 && (
                      <text
                        x={cx + (zone.pass_tds > 0 ? 16 : 0)}
                        y={cy + 20}
                        textAnchor="middle"
                        fontSize={9}
                        fill="#f87171"
                        fontWeight={700}
                      >
                        {zone.interceptions} INT
                      </text>
                    )}
                  </>
                )}
              </g>
            );
          })}
        </svg>

        {/* Legend — EPA tab: volume scale; CPOE tab: divergent scale */}
        {activeTab === "epa" && (
          <div className="flex flex-col items-center pt-8 flex-shrink-0" style={{ width: 36 }}>
            <span className="text-[9px] text-gray-400 font-semibold mb-1">ATT</span>
            <span className="text-[9px] text-gray-400 mb-1">{maxAttempts}</span>
            <div
              className="rounded-sm"
              style={{
                width: 14,
                height: 80,
                background: "linear-gradient(to bottom, rgba(37,99,235,0.55), rgba(37,99,235,0.08))",
              }}
            />
            <span className="text-[9px] text-gray-400 mt-1">0</span>
          </div>
        )}
        {activeTab === "cpoe" && (
          <div className="flex flex-col items-center pt-8 flex-shrink-0" style={{ width: 36 }}>
            <span className="text-[9px] text-gray-400 font-semibold mb-1">CPOE</span>
            <div
              className="rounded-sm"
              style={{
                width: 14,
                height: 80,
                background: "linear-gradient(to bottom, rgba(37,99,235,0.55), rgba(255,255,255,0.1), rgba(220,38,38,0.55))",
              }}
            />
            <div className="flex flex-col items-center text-[9px] text-gray-400">
              <span>+</span>
              <span className="my-3">0</span>
              <span>&minus;</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
