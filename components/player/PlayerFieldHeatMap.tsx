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
type TabKey = "targets" | "catch_pct" | "yards" | "epa";

const TABS: { key: TabKey; label: string }[] = [
  { key: "targets", label: "Targets" },
  { key: "catch_pct", label: "Catch%" },
  { key: "yards", label: "Yards" },
  { key: "epa", label: "EPA/Att" },
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
const ROWS: Record<string, { y: number; h: number }> = {
  deep: { y: 35, h: 100 },
  intermediate: { y: 151, h: 124 },
  short: { y: 291, h: 122 },
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
  maxTargets: number,
  maxYards: number,
  maxEpaAbs: number
): string {
  if (!zone || zone.pass_attempts === 0) return "rgba(255,255,255,0.03)";

  switch (tab) {
    case "targets": {
      const intensity = clamp(maxTargets > 0 ? zone.pass_attempts / maxTargets : 0, 0.05, 0.6);
      return `rgba(16, 185, 129, ${intensity})`;
    }
    case "catch_pct": {
      const pct = (zone.completion_pct ?? 0) * 100; // stored as 0-1, convert to 0-100
      if (pct >= 65) {
        const t = clamp((pct - 65) / 35, 0.05, 0.6);
        return `rgba(16, 185, 129, ${t})`;
      }
      const t = clamp((65 - pct) / 65, 0.05, 0.6);
      return `rgba(239, 68, 68, ${t})`;
    }
    case "yards": {
      const intensity = clamp(maxYards > 0 ? zone.passing_yards / maxYards : 0, 0.05, 0.6);
      return `rgba(16, 185, 129, ${intensity})`;
    }
    case "epa": {
      const epa = zone.epa_per_attempt ?? 0;
      if (epa >= 0) {
        const opacity = clamp(maxEpaAbs > 0 ? epa / maxEpaAbs : 0, 0.05, 0.6);
        return `rgba(34, 197, 94, ${opacity})`;
      }
      const opacity = clamp(maxEpaAbs > 0 ? Math.abs(epa) / maxEpaAbs : 0, 0.05, 0.6);
      return `rgba(239, 68, 68, ${opacity})`;
    }
    default:
      return "rgba(255,255,255,0.03)";
  }
}

function getBigNumber(tab: TabKey, zone: QBPassLocationStat | undefined): string {
  if (!zone || zone.pass_attempts === 0) return "\u2014";

  switch (tab) {
    case "targets":
      return String(zone.pass_attempts);
    case "catch_pct":
      return zone.completion_pct != null ? `${(zone.completion_pct * 100).toFixed(1)}%` : "\u2014";
    case "yards":
      return String(zone.passing_yards);
    case "epa": {
      const v = zone.epa_per_attempt;
      if (v == null) return "\u2014";
      return v >= 0 ? `+${v.toFixed(2)}` : v.toFixed(2);
    }
    default:
      return "\u2014";
  }
}

/* ─── Component ─── */
export default function PlayerFieldHeatMap({
  stats,
  playerName,
  season,
}: PlayerFieldHeatMapProps) {
  const [activeTab, setActiveTab] = useState<TabKey>("targets");

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

  /* Compute max values for color normalization */
  const maxTargets = Math.max(...stats.map((s) => s.pass_attempts), 1);
  const maxYards = Math.max(...stats.map((s) => s.passing_yards), 1);
  const maxEpaAbs = Math.max(
    ...stats.map((s) => Math.abs(s.epa_per_attempt ?? 0)),
    0.01
  );

  return (
    <div>
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
      <div className="bg-[#1a2332] text-white rounded-lg px-4 py-2 mb-3 flex items-center justify-between text-xs">
        <span className="font-semibold">{season} Season Totals</span>
        <div className="flex gap-3">
          <span>{totalAttempts} att</span>
          <span>
            {totalCompletions}/{totalAttempts}
          </span>
          <span>{totalCompPct.toFixed(1)}%</span>
          <span>{totalYards} yds</span>
          <span className="text-green-400">{totalTds} TD</span>
          <span className="text-red-400">{totalInts} INT</span>
        </div>
      </div>

      {/* SVG Field Diagram */}
      <svg viewBox="0 0 360 440" className="w-full" role="img" aria-label={`${playerName} pass location heat map`}>
        {/* Turf background */}
        <rect x={40} y={0} width={320} height={440} rx={8} fill="#2d5a27" />

        {/* Top boundary */}
        <line x1={40} y1={8} x2={360} y2={8} stroke="rgba(255,255,255,0.3)" strokeWidth={1} />

        {/* 20-yard line */}
        <line x1={40} y1={143} x2={360} y2={143} stroke="rgba(255,255,255,0.35)" strokeWidth={1} strokeDasharray="6,4" />
        <rect x={170} y={133} width={40} height={16} rx={8} fill="rgba(0,0,0,0.45)" />
        <text x={190} y={145} textAnchor="middle" fontSize={9} fill="rgba(255,255,255,0.8)" fontWeight={600}>
          20 yds
        </text>

        {/* 10-yard line */}
        <line x1={40} y1={283} x2={360} y2={283} stroke="rgba(255,255,255,0.35)" strokeWidth={1} strokeDasharray="6,4" />
        <rect x={170} y={273} width={40} height={16} rx={8} fill="rgba(0,0,0,0.45)" />
        <text x={190} y={285} textAnchor="middle" fontSize={9} fill="rgba(255,255,255,0.8)" fontWeight={600}>
          10 yds
        </text>

        {/* Line of scrimmage */}
        <line x1={40} y1={420} x2={360} y2={420} stroke="#f59e0b" strokeWidth={2} />
        <rect x={160} y={424} width={60} height={14} rx={7} fill="rgba(0,0,0,0.45)" />
        <text x={190} y={434} textAnchor="middle" fontSize={8} fill="#f59e0b" fontWeight={700}>
          SCRIMMAGE
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
          const fillColor = getCellColor(activeTab, zone, maxTargets, maxYards, maxEpaAbs);
          const bigNum = getBigNumber(activeTab, zone);
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
                /* Empty zone — dash */
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
                    fontSize={20}
                    fill="white"
                    fontWeight={700}
                  >
                    {bigNum}
                  </text>

                  {/* Sub-line: completions/attempts */}
                  <text
                    x={cx}
                    y={cy + 8}
                    textAnchor="middle"
                    fontSize={11}
                    fill="rgba(255,255,255,0.7)"
                  >
                    {zone.completions}/{zone.pass_attempts}
                  </text>

                  {/* TD badge */}
                  {zone.pass_tds > 0 && (
                    <text
                      x={cx - (zone.interceptions > 0 ? 16 : 0)}
                      y={cy + 24}
                      textAnchor="middle"
                      fontSize={10}
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
                      y={cy + 24}
                      textAnchor="middle"
                      fontSize={10}
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
    </div>
  );
}
