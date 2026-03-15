// components/tables/QBLeaderboard.tsx
"use client";

import { useState, useMemo, useRef, useEffect, useCallback } from "react";
import type { QBSeasonStat } from "@/lib/types";
import { getTeamColor } from "@/lib/data/teams";
import MetricTooltip from "@/components/ui/MetricTooltip";

interface QBLeaderboardProps {
  data: QBSeasonStat[];
  throughWeek: number;
}

const COLUMNS = [
  { key: "games", label: "GP", group: "core" },
  { key: "epa_per_play", label: "EPA/Play", tooltip: "EPA/Play", group: "core" },
  { key: "epa_per_db", label: "EPA/DB", tooltip: "EPA/DB", group: "core" },
  { key: "completion_pct", label: "Comp%", tooltip: "Comp%", group: "passing" },
  { key: "attempts", label: "Att", group: "passing" },
  { key: "cpoe", label: "CPOE", tooltip: "CPOE", group: "passing" },
  { key: "success_rate", label: "Success%", tooltip: "Success%", group: "passing" },
  { key: "passing_yards", label: "Yards", group: "passing" },
  { key: "touchdowns", label: "TD", group: "passing" },
  { key: "interceptions", label: "INT", group: "passing" },
  { key: "sacks", label: "Sk", tooltip: "Sk", group: "passing", hideMobile: true },
  { key: "rush_attempts", label: "Rush Att", tooltip: "Rush Att", group: "rushing", hideMobile: true },
  { key: "rush_yards", label: "Rush Yds", group: "rushing", hideMobile: true },
  { key: "rush_tds", label: "Rush TD", group: "rushing", hideMobile: true },
  { key: "rush_epa_per_play", label: "Rush EPA", tooltip: "Rush EPA", group: "rushing", hideMobile: true },
  { key: "adot", label: "aDOT", tooltip: "aDOT", group: "efficiency", hideMobile: true },
  { key: "ypa", label: "YPA", tooltip: "YPA", group: "efficiency" },
  { key: "any_a", label: "ANY/A", tooltip: "ANY/A", group: "efficiency" },
  { key: "passer_rating", label: "Rating", tooltip: "Rating", group: "efficiency" },
] as const;

type SortKey = typeof COLUMNS[number]['key'];
type SortDir = "asc" | "desc";

// Widen column type so optional fields (tooltip, hideMobile) are always accessible
type ColumnDef = {
  key: SortKey;
  label: string;
  group: string;
  tooltip?: string;
  hideMobile?: boolean;
};
const typedColumns: readonly ColumnDef[] = COLUMNS;

// Header background tints for column groups
const GROUP_COLORS: Record<string, string> = {
  core: "bg-navy",
  passing: "bg-navy/[0.92]",
  rushing: "bg-navy/[0.85]",
  efficiency: "bg-navy/[0.78]",
};

export default function QBLeaderboard({ data, throughWeek }: QBLeaderboardProps) {
  const [sortKey, setSortKey] = useState<SortKey>("epa_per_play");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [search, setSearch] = useState("");
  const [minDropbacks, setMinDropbacks] = useState(() =>
    Math.max(50, Math.round(200 * (throughWeek / 18)))
  );

  // Synced top scrollbar
  const topScrollRef = useRef<HTMLDivElement>(null);
  const tableScrollRef = useRef<HTMLDivElement>(null);
  const [scrollWidth, setScrollWidth] = useState(0);
  const syncing = useRef(false);

  const filtered = useMemo(() => {
    let result = data.filter((qb) => qb.dropbacks >= minDropbacks);
    if (search) {
      const term = search.toLowerCase();
      result = result.filter((qb) => qb.player_name.toLowerCase().includes(term));
    }
    result.sort((a, b) => {
      const aVal = a[sortKey] as number;
      const bVal = b[sortKey] as number;
      const aNull = aVal == null || Number.isNaN(aVal);
      const bNull = bVal == null || Number.isNaN(bVal);
      if (aNull && bNull) return 0;
      if (aNull) return 1; // nulls to bottom
      if (bNull) return -1;
      return sortDir === "desc" ? bVal - aVal : aVal - bVal;
    });
    return result;
  }, [data, sortKey, sortDir, search, minDropbacks]);

  useEffect(() => {
    const el = tableScrollRef.current;
    if (!el) return;
    const update = () => setScrollWidth(el.scrollWidth);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [filtered]);

  const syncScroll = useCallback((source: "top" | "table") => {
    if (syncing.current) return;
    syncing.current = true;
    const from = source === "top" ? topScrollRef.current : tableScrollRef.current;
    const to = source === "top" ? tableScrollRef.current : topScrollRef.current;
    if (from && to) to.scrollLeft = from.scrollLeft;
    syncing.current = false;
  }, []);

  function handleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  }

  function formatVal(key: string, val: unknown): string {
    if (val == null || (typeof val === "number" && Number.isNaN(val))) return "\u2014";
    const n = val as number;
    switch (key) {
      case "epa_per_play":
      case "epa_per_db":
      case "cpoe":
      case "adot":
      case "ypa":
      case "any_a":
      case "rush_epa_per_play":
        return n.toFixed(2);
      case "completion_pct":
        return n.toFixed(1);
      case "success_rate":
        return n.toFixed(2);
      case "passer_rating":
        return n.toFixed(1);
      default:
        return Number.isInteger(n) ? n.toString() : n.toFixed(1);
    }
  }

  function epaColor(val: number): string {
    return val > 0 ? "text-green-600" : val < 0 ? "text-red-600" : "text-gray-700";
  }

  return (
    <div>
      {/* Controls bar */}
      <div className="flex flex-col sm:flex-row gap-4 mb-4">
        <input
          type="text"
          placeholder="Search players..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="px-3 py-2 text-sm border border-gray-200 rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-navy/20 w-full sm:w-64"
        />
        <div className="flex items-center gap-3">
          <label className="text-sm text-gray-500 whitespace-nowrap">
            Min dropbacks: <span className="font-semibold text-navy">{minDropbacks}</span>
          </label>
          <input
            type="range"
            min={50}
            max={500}
            step={10}
            value={minDropbacks}
            onChange={(e) => setMinDropbacks(parseInt(e.target.value))}
            className="w-32"
          />
        </div>
      </div>

      {/* Top scrollbar */}
      <div
        ref={topScrollRef}
        onScroll={() => syncScroll("top")}
        className="overflow-x-auto border border-gray-200 border-b-0 rounded-t-md"
        style={{ height: 12 }}
      >
        <div style={{ width: scrollWidth, height: 1 }} />
      </div>

      {/* Table */}
      <div
        ref={tableScrollRef}
        onScroll={() => syncScroll("table")}
        className="overflow-x-auto border border-gray-200 border-t-0 rounded-b-md"
      >
        <table className="w-full text-sm">
          <thead>
            <tr>
              <th className="bg-navy text-white px-3 py-2.5 text-left text-xs font-semibold w-10 sticky left-0 z-20">#</th>
              <th className="bg-navy text-white px-3 py-2.5 text-left text-xs font-semibold min-w-[160px] sticky left-10 z-20">Player</th>
              <th className="bg-navy text-white px-3 py-2.5 text-left text-xs font-semibold">Team</th>
              {typedColumns.map((col) => (
                <th
                  key={col.key}
                  onClick={() => handleSort(col.key)}
                  className={`${sortKey === col.key ? "bg-navy/60" : GROUP_COLORS[col.group]} text-white px-3 py-2.5 text-right text-xs font-semibold cursor-pointer hover:bg-navy/70 transition-colors whitespace-nowrap ${col.hideMobile ? "hidden sm:table-cell" : ""}`}
                >
                  <span className="inline-flex items-center gap-0.5">
                    {col.label}
                    {col.tooltip && <MetricTooltip metric={col.tooltip} />}
                    {sortKey === col.key && (
                      <span className="ml-1">{sortDir === "desc" ? "\u25BC" : "\u25B2"}</span>
                    )}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={COLUMNS.length + 3} className="text-center py-12 text-gray-500">
                  {search ? "No players match your search." : "No data available."}
                </td>
              </tr>
            ) : (
              filtered.map((qb, idx) => (
                <tr key={qb.player_id} className="group border-t border-gray-100 hover:bg-gray-50/50 transition-colors">
                  <td className="px-3 py-2 text-gray-400 font-bold tabular-nums w-10 sticky left-0 z-10 bg-white group-hover:bg-gray-50/50">{idx + 1}</td>
                  <td className="px-3 py-2 sticky left-10 z-10 bg-white group-hover:bg-gray-50/50">
                    <div className="flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: getTeamColor(qb.team_id) }} />
                      <span className="font-semibold text-navy">{qb.player_name}</span>
                    </div>
                  </td>
                  <td className="px-3 py-2 text-gray-500 text-xs">{qb.team_id}</td>
                  {typedColumns.map((col) => {
                    const val = qb[col.key as keyof typeof qb];
                    const isEpa = col.key === "epa_per_play" || col.key === "epa_per_db";
                    return (
                      <td
                        key={col.key}
                        className={`px-3 py-2 text-right tabular-nums ${
                          isEpa ? `font-bold ${epaColor(val as number)}` : "text-gray-700"
                        } ${col.hideMobile ? "hidden sm:table-cell" : ""}`}
                      >
                        {formatVal(col.key, val)}
                      </td>
                    );
                  })}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <p className="mt-2 text-xs text-gray-400">
        Showing {filtered.length} of {data.length} quarterbacks with &ge;{minDropbacks} dropbacks
      </p>

      <div className="mt-4 text-xs text-gray-400 space-y-1 border-t border-gray-100 pt-3">
        <p><span className="font-semibold text-gray-500">Data source:</span> nflverse play-by-play. Stats may differ slightly from Pro Football Reference.</p>
        <p><span className="font-semibold text-gray-500">Rush Att</span> counts designed rushes and scrambles but excludes kneels. PFR includes kneels in rush attempts.</p>
        <p><span className="font-semibold text-gray-500">Success%</span> excludes sacks from the denominator. Sacks reflect offensive line failure, not QB decision-making. PFR includes sacks, which lowers the number.</p>
      </div>
    </div>
  );
}
