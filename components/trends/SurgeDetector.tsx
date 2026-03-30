"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { detectSurges, type SurgeEntry, type WeeklyValue } from "@/lib/stats/surge";
import { getTeamLogo } from "@/lib/data/teams";
import type { StatDef } from "@/lib/data/trends";

// --- Sparkline SVG ---
function Sparkline({
  weeks,
  window,
  rising,
}: {
  weeks: { week: number; value: number }[];
  window: number;
  rising: boolean;
}) {
  if (weeks.length < 2) return null;
  const W = 120;
  const H = 32;
  const pad = 2;

  const values = weeks.map((w) => w.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;

  const points = values.map((v, i) => {
    const x = pad + (i / (values.length - 1)) * (W - pad * 2);
    const y = H - pad - ((v - min) / range) * (H - pad * 2);
    return `${x},${y}`;
  });

  const splitIdx = values.length - window;
  const basePoints = points.slice(0, splitIdx + 1).join(" ");
  const recentPoints = points.slice(splitIdx).join(" ");
  const color = rising ? "#16a34a" : "#dc2626";

  return (
    <svg width={W} height={H} className="flex-shrink-0">
      <polyline
        points={basePoints}
        fill="none"
        stroke="#9ca3af"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <polyline
        points={recentPoints}
        fill="none"
        stroke={color}
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// --- Z-Score Badge ---
function ZBadge({ z, rising }: { z: number; rising: boolean }) {
  const absZ = Math.abs(z);
  const intensity = absZ >= 2.5 ? "font-bold" : absZ >= 2 ? "font-semibold" : "font-medium";
  const bg = rising
    ? absZ >= 2.5 ? "bg-green-600" : absZ >= 2 ? "bg-green-500" : "bg-green-400"
    : absZ >= 2.5 ? "bg-red-600" : absZ >= 2 ? "bg-red-500" : "bg-red-400";

  return (
    <span className={`${bg} text-white text-xs ${intensity} px-1.5 py-0.5 rounded`}>
      {rising ? "+" : ""}{z.toFixed(1)}z
    </span>
  );
}

// --- Delta Chip ---
function DeltaChip({ delta, format }: { delta: number; format: StatDef["format"] }) {
  const sign = delta >= 0 ? "+" : "";
  let text: string;
  if (format === "pct") {
    text = `${sign}${(delta * 100).toFixed(1)}%`;
  } else if (format === "epa") {
    text = `${sign}${delta.toFixed(3)}`;
  } else {
    text = `${sign}${delta.toFixed(1)}`;
  }
  const color = delta >= 0 ? "text-green-700" : "text-red-700";
  return <span className={`text-xs ${color} font-mono`}>{text}</span>;
}

// --- Surge Card ---
function SurgeCard({
  entry,
  window,
  rising,
  format,
}: {
  entry: SurgeEntry;
  window: number;
  rising: boolean;
  format: StatDef["format"];
}) {
  const logo = getTeamLogo(entry.teamId);

  return (
    <div className="flex items-center gap-3 py-2.5 px-3 rounded-lg hover:bg-gray-50 transition-colors">
      {/* Team logo */}
      {logo && (
        <Image
          src={logo}
          alt={entry.teamId}
          width={20}
          height={20}
          className="flex-shrink-0"
        />
      )}

      {/* Player info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <Link
            href={`/player/${entry.slug}`}
            className="text-sm font-semibold text-navy hover:underline truncate"
          >
            {entry.playerName}
          </Link>
          <span className="text-xs text-gray-400 flex-shrink-0">{entry.position}</span>
        </div>
        <div className="flex items-center gap-2 mt-0.5">
          <DeltaChip delta={entry.delta} format={format} />
          <span className="text-[10px] text-gray-400">
            {formatVal(entry.seasonAvg, format)} &rarr; {formatVal(entry.recentAvg, format)}
          </span>
        </div>
      </div>

      {/* Sparkline */}
      <Sparkline weeks={entry.weeks} window={window} rising={rising} />

      {/* Z-score badge */}
      <ZBadge z={entry.zScore} rising={rising} />
    </div>
  );
}

function formatVal(v: number, format: StatDef["format"]): string {
  if (format === "pct") return `${(v * 100).toFixed(1)}%`;
  if (format === "epa") return v.toFixed(3);
  return v.toFixed(1);
}

// --- Position filter ---
const POSITION_TABS = [
  { key: "all", label: "All" },
  { key: "QB", label: "QB" },
  { key: "WR", label: "WR" },
  { key: "TE", label: "TE" },
  { key: "RB", label: "RB" },
] as const;

// --- Main Component ---
export default function SurgeDetector({
  surgeData,
  stats,
}: {
  surgeData: Record<string, WeeklyValue[]>;
  stats: StatDef[];
}) {
  const [posFilter, setPosFilter] = useState<string>("all");
  const [statKey, setStatKey] = useState<string>(stats[0]?.key ?? "qb_epa");
  const [window, setWindow] = useState(4);

  // Filter stats by position
  const filteredStats = useMemo(() => {
    if (posFilter === "all") return stats;
    return stats.filter((s) => s.positions.includes(posFilter));
  }, [stats, posFilter]);

  // Auto-switch stat when position changes and current stat doesn't apply
  const activeStat = useMemo(() => {
    const found = filteredStats.find((s) => s.key === statKey);
    return found ?? filteredStats[0];
  }, [filteredStats, statKey]);

  // Compute surges for active stat
  const { rising, falling } = useMemo(() => {
    if (!activeStat) return { rising: [], falling: [] };
    let players = surgeData[activeStat.key] ?? [];

    // Position filter
    if (posFilter !== "all") {
      players = players.filter((p) => p.position === posFilter);
    }

    return detectSurges(players, { window, minGames: 6, threshold: 1.5 });
  }, [surgeData, activeStat, posFilter, window]);

  const topRising = rising.slice(0, 10);
  const topFalling = falling.slice(0, 10);

  return (
    <div className="space-y-6">
      {/* Controls */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
        {/* Position tabs */}
        <div className="flex gap-1 bg-gray-100 rounded-lg p-0.5">
          {POSITION_TABS.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setPosFilter(tab.key)}
              className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
                posFilter === tab.key
                  ? "bg-white text-navy shadow-sm"
                  : "text-gray-500 hover:text-gray-700"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Stat selector */}
        <select
          value={activeStat?.key ?? ""}
          onChange={(e) => setStatKey(e.target.value)}
          className="px-3 py-1.5 text-sm border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-navy/20"
        >
          {filteredStats.map((s) => (
            <option key={s.key} value={s.key}>
              {s.label}
            </option>
          ))}
        </select>

        {/* Window selector */}
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-500">Window:</span>
          {[3, 4, 5].map((w) => (
            <button
              key={w}
              onClick={() => setWindow(w)}
              className={`px-2 py-1 text-xs rounded-md transition-colors ${
                window === w
                  ? "bg-navy text-white"
                  : "bg-gray-100 text-gray-600 hover:bg-gray-200"
              }`}
            >
              {w}wk
            </button>
          ))}
        </div>
      </div>

      {/* Two-column layout */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Rising column */}
        <div className="border border-green-200 rounded-xl overflow-hidden">
          <div className="bg-green-50 px-4 py-2.5 border-b border-green-200">
            <h3 className="text-sm font-semibold text-green-800 flex items-center gap-2">
              <span className="text-lg">&#x2191;</span>
              Rising
              <span className="text-xs font-normal text-green-600">
                {activeStat?.label ?? ""} &middot; Last {window} weeks
              </span>
            </h3>
          </div>
          <div className="divide-y divide-gray-100">
            {topRising.length === 0 ? (
              <p className="text-sm text-gray-400 p-4 text-center">
                No significant surges detected
              </p>
            ) : (
              topRising.map((entry) => (
                <SurgeCard
                  key={entry.playerId}
                  entry={entry}
                  window={window}
                  rising={true}
                  format={activeStat?.format ?? "epa"}
                />
              ))
            )}
          </div>
        </div>

        {/* Falling column */}
        <div className="border border-red-200 rounded-xl overflow-hidden">
          <div className="bg-red-50 px-4 py-2.5 border-b border-red-200">
            <h3 className="text-sm font-semibold text-red-800 flex items-center gap-2">
              <span className="text-lg">&#x2193;</span>
              Falling
              <span className="text-xs font-normal text-red-600">
                {activeStat?.label ?? ""} &middot; Last {window} weeks
              </span>
            </h3>
          </div>
          <div className="divide-y divide-gray-100">
            {topFalling.length === 0 ? (
              <p className="text-sm text-gray-400 p-4 text-center">
                No significant collapses detected
              </p>
            ) : (
              topFalling.map((entry) => (
                <SurgeCard
                  key={entry.playerId}
                  entry={entry}
                  window={window}
                  rising={false}
                  format={activeStat?.format ?? "epa"}
                />
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
