// components/tables/RBLeaderboard.tsx
"use client";

import React, { useState, useMemo, useCallback, useRef } from "react";
import Link from "next/link";
import type { RBSeasonStat } from "@/lib/types";
import { getTeamColor } from "@/lib/data/teams";
import MetricTooltip from "@/components/ui/MetricTooltip";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import { computePercentile } from "@/lib/stats/percentiles";
import { classifyRB } from "@/lib/stats/archetypes";
import { rbFantasyPoints } from "@/lib/stats/fantasy";

interface RBLeaderboardProps {
  data: RBSeasonStat[];
  throughWeek: number;
  season: number;
  slugMap?: Record<string, string>;
}

type ColumnDef = {
  key: string;
  label: string;
  group: string;
  tooltip?: string;
};

const ADVANCED_COLUMNS: ColumnDef[] = [
  { key: "games", label: "GP", group: "core" },
  { key: "rush_fpts", label: "Rush FPts", group: "core" },
  { key: "epa_per_carry", label: "EPA/Car", tooltip: "EPA/Car", group: "core" },
  { key: "success_rate", label: "Success%", tooltip: "Success%", group: "efficiency" },
  { key: "stuff_rate", label: "Stuff%", tooltip: "Stuff%", group: "efficiency" },
  { key: "explosive_rate", label: "Explosive%", tooltip: "Explosive%", group: "efficiency" },
  { key: "carries_per_game", label: "Car/G", group: "efficiency" },
];

const STANDARD_COLUMNS: ColumnDef[] = [
  { key: "games", label: "GP", group: "core" },
  { key: "rush_fpts", label: "Rush FPts", group: "core" },
  { key: "carries", label: "Carries", group: "rushing" },
  { key: "rushing_yards", label: "Yards", group: "rushing" },
  { key: "yards_per_carry", label: "YPC", group: "rushing" },
  { key: "rushing_tds", label: "TD", group: "rushing" },
  { key: "yards_per_game", label: "Yds/G", group: "rushing" },
  { key: "fumbles_lost", label: "FL", tooltip: "FL", group: "rushing" },
];

const VALID_ADVANCED_KEYS = new Set(ADVANCED_COLUMNS.map((c) => c.key));
const VALID_STANDARD_KEYS = new Set(STANDARD_COLUMNS.map((c) => c.key));

type Tab = "advanced" | "standard";
type SortDir = "asc" | "desc";

// Header background tints for column groups
const GROUP_COLORS: Record<string, string> = {
  core: "bg-navy",
  rushing: "bg-navy/[0.92]",
  efficiency: "bg-navy/[0.78]",
};

function getVal(rb: RBSeasonStat, key: string): number {
  switch (key) {
    case "yards_per_game":
      return rb.games ? rb.rushing_yards / rb.games : NaN;
    case "carries_per_game":
      return rb.games ? rb.carries / rb.games : NaN;
    case "rush_fpts":
      return rbFantasyPoints({
        rushing_yards: rb.rushing_yards,
        rushing_tds: rb.rushing_tds,
        fumbles_lost: rb.fumbles_lost,
      });
    default: {
      const val = rb[key as keyof RBSeasonStat] as number;
      return val ?? NaN;
    }
  }
}

// Columns that receive percentile-based conditional formatting
const HEATMAP_COLS_ADVANCED = new Set([
  "epa_per_carry", "success_rate", "stuff_rate", "explosive_rate",
]);
const HEATMAP_COLS_STANDARD = new Set([
  "yards_per_carry",
]);

// For stuff_rate, lower is better
const INVERTED_COLS = new Set(["stuff_rate"]);

function getPercentile(sortedValues: number[], value: number): number {
  if (isNaN(value) || sortedValues.length === 0) return -1;
  const rank = sortedValues.filter((v) => v < value).length;
  return (rank / sortedValues.length) * 100;
}

function getHeatmapStyle(percentile: number, inverted: boolean = false): React.CSSProperties {
  if (percentile < 0) return {};
  const p = inverted ? 100 - percentile : percentile;
  if (p >= 90)
    return { background: "rgba(34,197,94,0.25)", color: "#15803d", fontWeight: 600 };
  if (p >= 75)
    return { background: "rgba(34,197,94,0.12)", color: "#16a34a" };
  if (p <= 10)
    return { background: "rgba(239,68,68,0.25)", color: "#dc2626", fontWeight: 600 };
  if (p <= 25)
    return { background: "rgba(239,68,68,0.12)", color: "#dc2626" };
  return {};
}

function formatVal(key: string, rb: RBSeasonStat): string {
  const val = getVal(rb, key);
  if (val == null || isNaN(val)) return "\u2014";
  switch (key) {
    case "epa_per_carry":
    case "yards_per_carry":
      return val.toFixed(2);
    case "success_rate":
    case "stuff_rate":
    case "explosive_rate":
      return (val * 100).toFixed(1) + "%";
    case "yards_per_game":
    case "carries_per_game":
      return val.toFixed(1);
    case "rush_fpts":
      return val.toFixed(1);
    default:
      return Number.isInteger(val) ? val.toString() : val.toFixed(1);
  }
}

// Format a raw numeric value (used for NFL AVG row where there's no RB object)
function formatAvg(key: string, val: number): string {
  if (val == null || isNaN(val)) return "\u2014";
  switch (key) {
    case "epa_per_carry":
    case "yards_per_carry":
      return val.toFixed(2);
    case "success_rate":
    case "stuff_rate":
    case "explosive_rate":
      return (val * 100).toFixed(1) + "%";
    case "yards_per_game":
    case "carries_per_game":
      return val.toFixed(1);
    case "rush_fpts":
      return val.toFixed(1);
    default:
      return Number.isInteger(val) ? val.toString() : val.toFixed(1);
  }
}

export default function RBLeaderboard({ data, throughWeek, season, slugMap = {} }: RBLeaderboardProps) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  // Read URL params with validation
  const urlTab = searchParams.get("tab");
  const initialTab: Tab = urlTab === "standard" ? "standard" : "advanced";

  const urlSort = searchParams.get("sort");
  const initialSortKey = (() => {
    if (!urlSort) return initialTab === "advanced" ? "epa_per_carry" : "rushing_yards";
    const validKeys = initialTab === "advanced" ? VALID_ADVANCED_KEYS : VALID_STANDARD_KEYS;
    return validKeys.has(urlSort) ? urlSort : (initialTab === "advanced" ? "epa_per_carry" : "rushing_yards");
  })();

  const urlDir = searchParams.get("dir");
  const initialSortDir: SortDir = urlDir === "asc" ? "asc" : "desc";

  const urlSearch = searchParams.get("q") || "";

  const computedDefaultMin = Math.max(20, Math.round(100 * (throughWeek / 18)));
  const urlMin = searchParams.get("min");
  const initialMin = (() => {
    if (!urlMin) return computedDefaultMin;
    const parsed = parseInt(urlMin, 10);
    return isNaN(parsed) || parsed < 0 ? computedDefaultMin : parsed;
  })();

  const urlTeam = searchParams.get("team") || "";

  const [tab, setTab] = useState<Tab>(initialTab);
  const [sortKey, setSortKey] = useState<string>(initialSortKey);
  const [sortDir, setSortDir] = useState<SortDir>(initialSortDir);
  const [search, setSearch] = useState(urlSearch);
  const [minCarries, setMinCarries] = useState(initialMin);
  const [teamFilter, setTeamFilter] = useState(urlTeam);

  // Unique teams sorted alphabetically for the dropdown
  const teams = useMemo(() => {
    const set = new Set(data.map((r) => r.team_id));
    return Array.from(set).sort();
  }, [data]);

  // Build URL from current state, omitting defaults
  const buildParams = useCallback(
    (overrides: { tab?: Tab; sort?: string; dir?: SortDir; q?: string; min?: number; team?: string }) => {
      const params = new URLSearchParams(searchParams.toString());
      ["tab", "sort", "dir", "q", "min", "team"].forEach((k) => params.delete(k));

      const newTab = overrides.tab ?? tab;
      const defaultSort = newTab === "advanced" ? "epa_per_carry" : "rushing_yards";
      const newSort = overrides.sort ?? sortKey;
      const newDir = overrides.dir ?? sortDir;
      const newQ = overrides.q ?? search;
      const newMin = overrides.min ?? minCarries;
      const newTeam = overrides.team ?? teamFilter;

      if (newTab !== "advanced") params.set("tab", newTab);
      if (newSort !== defaultSort) params.set("sort", newSort);
      if (newDir !== "desc") params.set("dir", newDir);
      if (newQ) params.set("q", newQ);
      if (newMin !== computedDefaultMin) params.set("min", String(newMin));
      if (newTeam) params.set("team", newTeam);

      const qs = params.toString();
      return pathname + (qs ? "?" + qs : "");
    },
    [searchParams, tab, sortKey, sortDir, search, minCarries, teamFilter, computedDefaultMin, pathname]
  );

  const pushURL = useCallback(
    (overrides: { tab?: Tab; sort?: string; dir?: SortDir; min?: number; team?: string }) => {
      router.push(buildParams(overrides), { scroll: false });
    },
    [buildParams, router]
  );

  // Debounced URL update for continuous inputs
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const replaceURLDebounced = useCallback(
    (overrides: { q?: string; min?: number }) => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        router.replace(buildParams(overrides), { scroll: false });
      }, 300);
    },
    [buildParams, router]
  );

  const columns = tab === "advanced" ? ADVANCED_COLUMNS : STANDARD_COLUMNS;
  const [showHeatmap, setShowHeatmap] = useState(true);
  const [archFilter, setArchFilter] = useState("");

  const heatmapCols = tab === "advanced" ? HEATMAP_COLS_ADVANCED : HEATMAP_COLS_STANDARD;

  // When switching tabs, reset sort to a sensible default for that tab
  function switchTab(newTab: Tab) {
    setTab(newTab);
    const newSort = newTab === "advanced" ? "epa_per_carry" : "rushing_yards";
    setSortKey(newSort);
    setSortDir("desc");
    pushURL({ tab: newTab, sort: newSort, dir: "desc" });
  }

  // Compute archetype for each RB
  // RB axes: [Volume, Efficiency, Power, Explosiveness, Receiving, Consistency]
  // Since we don't have receiving data in this table, receiving percentile will be 0
  const archetypeMap = useMemo(() => {
    const radarKeys = ["car_game", "epa_per_carry", "stuff_rate_inv", "explosive_rate", "receiving_proxy", "success_rate"] as const;

    function getRadarVal(rb: RBSeasonStat, key: string): number {
      switch (key) {
        case "car_game": return rb.games ? rb.carries / rb.games : NaN;
        case "epa_per_carry": return rb.epa_per_carry ?? NaN;
        case "stuff_rate_inv": return rb.stuff_rate != null ? (1 - rb.stuff_rate) : NaN; // invert: lower stuff = better power
        case "explosive_rate": return rb.explosive_rate ?? NaN;
        case "receiving_proxy": return 0; // no receiving data on this table
        case "success_rate": return rb.success_rate ?? NaN;
        default: return NaN;
      }
    }

    // Pre-sort pools
    const sorted = radarKeys.map((key) =>
      data.map((r) => getRadarVal(r, key)).filter((v) => !isNaN(v)).sort((a, b) => a - b)
    );

    const map: Record<string, { icon: string; label: string }> = {};
    for (const rb of data) {
      const percentiles = radarKeys.map((key, i) =>
        computePercentile(sorted[i], getRadarVal(rb, key))
      );
      const arch = classifyRB(percentiles);
      if (arch) map[rb.player_id] = { icon: arch.icon, label: arch.label };
    }
    return map;
  }, [data]);

  const uniqueArchetypes = useMemo(
    () => Array.from(new Set(Object.values(archetypeMap).map((a) => a.label))).sort(),
    [archetypeMap]
  );

  const filtered = useMemo(() => {
    let result = data.filter((rb) => rb.carries >= minCarries);
    if (teamFilter) {
      result = result.filter((rb) => rb.team_id === teamFilter);
    }
    if (search) {
      const term = search.toLowerCase();
      result = result.filter((rb) => rb.player_name.toLowerCase().includes(term));
    }
    if (archFilter) {
      result = result.filter((rb) => archetypeMap[rb.player_id]?.label === archFilter);
    }
    result.sort((a, b) => {
      const aVal = getVal(a, sortKey);
      const bVal = getVal(b, sortKey);
      const aNull = aVal == null || Number.isNaN(aVal);
      const bNull = bVal == null || Number.isNaN(bVal);
      if (aNull && bNull) return 0;
      if (aNull) return 1;
      if (bNull) return -1;
      return sortDir === "desc" ? bVal - aVal : aVal - bVal;
    });
    return result;
  }, [data, sortKey, sortDir, search, minCarries, teamFilter, archFilter, archetypeMap]);

  const sortedByCol = useMemo(() => {
    if (!showHeatmap) return {};
    const sorted: Record<string, number[]> = {};
    Array.from(heatmapCols).forEach((col) => {
      const values = filtered.map((rb) => getVal(rb, col)).filter((v) => !isNaN(v));
      values.sort((a, b) => a - b);
      sorted[col] = values;
    });
    return sorted;
  }, [filtered, heatmapCols, showHeatmap]);

  // NFL-wide averages (always from full dataset, ignoring team filters)
  const nflAverages = useMemo(() => {
    if (!showHeatmap) return {};
    const pool = data.filter((rb) => rb.carries >= minCarries);
    const avgs: Record<string, number> = {};
    for (const col of columns) {
      const values = pool.map((rb) => getVal(rb, col.key)).filter((v) => !isNaN(v));
      avgs[col.key] = values.length
        ? values.reduce((a, b) => a + b, 0) / values.length
        : NaN;
    }
    return avgs;
  }, [data, minCarries, columns, showHeatmap]);

  // Team averages (only shown when team filter is active)
  const teamAverages = useMemo(() => {
    if (!showHeatmap || !teamFilter) return {};
    const avgs: Record<string, number> = {};
    for (const col of columns) {
      const values = filtered.map((rb) => getVal(rb, col.key)).filter((v) => !isNaN(v));
      avgs[col.key] = values.length
        ? values.reduce((a, b) => a + b, 0) / values.length
        : NaN;
    }
    return avgs;
  }, [filtered, columns, showHeatmap, teamFilter]);

  function handleSort(key: string) {
    if (sortKey === key) {
      const newDir = sortDir === "desc" ? "asc" : "desc";
      setSortDir(newDir);
      pushURL({ dir: newDir });
    } else {
      setSortKey(key);
      setSortDir("desc");
      pushURL({ sort: key, dir: "desc" });
    }
  }

  function epaColor(val: number): string {
    return val > 0 ? "text-green-600" : val < 0 ? "text-red-600" : "text-gray-700";
  }

  const isEpaCol = (key: string) => key === "epa_per_carry";

  // suppress unused variable warning
  void season;

  return (
    <div>
      {/* Tab bar + Controls */}
      <div className="flex flex-col gap-4 mb-4">
        {/* Row 1: Tabs */}
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex rounded-lg border border-gray-200 overflow-hidden">
            <button
              onClick={() => switchTab("advanced")}
              className={`px-4 py-2 text-sm font-medium transition-colors ${
                tab === "advanced"
                  ? "bg-navy text-white"
                  : "bg-white text-gray-600 hover:bg-gray-50"
              }`}
            >
              Advanced
            </button>
            <button
              onClick={() => switchTab("standard")}
              className={`px-4 py-2 text-sm font-medium transition-colors ${
                tab === "standard"
                  ? "bg-navy text-white"
                  : "bg-white text-gray-600 hover:bg-gray-50"
              }`}
            >
              Standard
            </button>
          </div>
        </div>

        {/* Row 2: Filters */}
        <div className="flex flex-col sm:flex-row sm:items-center gap-4">
          <div className="flex flex-col sm:flex-row gap-4 flex-1">
            <input
              type="text"
              placeholder="Search players..."
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                replaceURLDebounced({ q: e.target.value });
              }}
              className="px-3 py-2 text-sm border border-gray-200 rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-navy/20 w-full sm:w-64"
            />
            <select
              value={teamFilter}
              onChange={(e) => {
                setTeamFilter(e.target.value);
                pushURL({ team: e.target.value });
              }}
              className="border border-gray-200 rounded-md px-2 py-1 text-sm text-gray-600 w-full sm:w-auto"
            >
              <option value="">All Teams</option>
              {teams.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
            <select
              value={archFilter}
              onChange={(e) => setArchFilter(e.target.value)}
              className="border border-gray-200 rounded-md px-2 py-1 text-sm text-gray-600 w-full sm:w-auto"
            >
              <option value="">All Archetypes</option>
              {uniqueArchetypes.map((a) => (
                <option key={a} value={a}>{a}</option>
              ))}
            </select>
            <div className="flex items-center gap-3">
              <label className="text-sm text-gray-500 whitespace-nowrap">
                Min carries: <span className="font-semibold text-navy">{minCarries}</span>
              </label>
              <input
                type="range"
                min={10}
                max={300}
                step={10}
                value={minCarries}
                onChange={(e) => {
                  const val = parseInt(e.target.value);
                  setMinCarries(val);
                  replaceURLDebounced({ min: val });
                }}
                className="w-full sm:w-32"
              />
            </div>
            <label className="flex items-center gap-2 text-sm text-gray-500 whitespace-nowrap cursor-pointer select-none">
              <input
                type="checkbox"
                checked={showHeatmap}
                onChange={(e) => setShowHeatmap(e.target.checked)}
                className="rounded border-gray-300 text-navy focus:ring-navy/20"
              />
              Heatmap
            </label>
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="border border-gray-200 rounded-md overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr>
              <th className="bg-navy text-white px-2 py-2.5 text-left text-xs font-semibold w-8 sticky left-0 z-20">#</th>
              <th className="bg-navy text-white px-2 py-2.5 text-left text-xs font-semibold min-w-[130px] sticky left-8 z-20">Player</th>
              <th className="bg-navy text-white px-2 py-2.5 text-left text-xs font-semibold">Team</th>
              {columns.map((col) => (
                <th
                  key={col.key}
                  onClick={() => handleSort(col.key)}
                  className={`${sortKey === col.key ? "bg-navy/60" : GROUP_COLORS[col.group]} text-white px-2 py-2.5 text-right text-xs font-semibold cursor-pointer hover:bg-navy/70 transition-colors whitespace-nowrap`}
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
                <td colSpan={columns.length + 3} className="text-center py-12 text-gray-500">
                  {search ? "No players match your search." : "No data available."}
                </td>
              </tr>
            ) : (
              <>
                {filtered.map((rb, idx) => {
                  // Determine if NFL AVG row should appear before this player
                  let showAvgBefore = false;
                  if (showHeatmap && idx === 0) {
                    const avgVal = nflAverages[sortKey];
                    if (!isNaN(avgVal)) {
                      const rbVal = getVal(rb, sortKey);
                      if (sortDir === "desc" ? avgVal >= rbVal : avgVal <= rbVal) {
                        showAvgBefore = true;
                      }
                    }
                  } else if (showHeatmap && idx > 0) {
                    const avgVal = nflAverages[sortKey];
                    if (!isNaN(avgVal)) {
                      const prevVal = getVal(filtered[idx - 1], sortKey);
                      const currVal = getVal(rb, sortKey);
                      if (sortDir === "desc") {
                        showAvgBefore = avgVal < prevVal && avgVal >= currVal;
                      } else {
                        showAvgBefore = avgVal > prevVal && avgVal <= currVal;
                      }
                    }
                  }

                  // Team AVG row (only when team filter active, shown once before first player)
                  const teamAvgRow = (showHeatmap && teamFilter && idx === 0) ? (
                    <tr key="team-avg" className="border-t border-blue-300">
                      <td className="px-2 py-2 sticky left-0 z-10" style={{ background: "#eff6ff" }}></td>
                      <td className="px-2 py-2 sticky left-8 z-10" style={{ background: "#eff6ff", color: "#1e40af", fontWeight: 700, fontStyle: "italic" }}>
                        {teamFilter} AVG
                      </td>
                      <td className="px-2 py-2" style={{ background: "#eff6ff", color: "#1e40af" }}>&mdash;</td>
                      {columns.map((col) => (
                        <td
                          key={col.key}
                          className="px-2 py-2 text-right tabular-nums"
                          style={{ background: "#eff6ff", color: "#1e40af", fontWeight: 600, borderBottom: "2px solid #3b82f6" }}
                        >
                          {formatAvg(col.key, teamAverages[col.key])}
                        </td>
                      ))}
                    </tr>
                  ) : null;

                  const avgRow = showAvgBefore ? (
                    <tr key="nfl-avg" className="border-t border-amber-400">
                      <td className="px-2 py-2 sticky left-0 z-10" style={{ background: "#fef3c7" }}></td>
                      <td className="px-2 py-2 sticky left-8 z-10" style={{ background: "#fef3c7", color: "#92400e", fontWeight: 700, fontStyle: "italic" }}>
                        NFL AVG
                      </td>
                      <td className="px-2 py-2" style={{ background: "#fef3c7", color: "#92400e" }}>&mdash;</td>
                      {columns.map((col) => (
                        <td
                          key={col.key}
                          className="px-2 py-2 text-right tabular-nums"
                          style={{ background: "#fef3c7", color: "#92400e", fontWeight: 600, borderBottom: "2px solid #f59e0b" }}
                        >
                          {formatAvg(col.key, nflAverages[col.key])}
                        </td>
                      ))}
                    </tr>
                  ) : null;

                  return (
                    <React.Fragment key={rb.player_id}>
                      {teamAvgRow}
                      {avgRow}
                      <tr className="group border-t border-gray-100 hover:bg-gray-50/50 transition-colors">
                        <td className="px-2 py-2 text-gray-400 font-bold tabular-nums w-8 sticky left-0 z-10 bg-white group-hover:bg-gray-50/50">{idx + 1}</td>
                        <td className="px-2 py-2 sticky left-8 z-10 bg-white group-hover:bg-gray-50/50">
                          <div className="flex items-center gap-2">
                            <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: getTeamColor(rb.team_id) }} />
                            <Link
                              href={`/player/${slugMap[rb.player_id] || rb.player_id}`}
                              className="font-semibold text-navy hover:text-nflred hover:underline transition-colors"
                            >
                              {rb.player_name}
                            </Link>
                            {archetypeMap[rb.player_id] && (
                              <span className="text-xs ml-0.5" title={archetypeMap[rb.player_id].label}>
                                {archetypeMap[rb.player_id].icon}
                              </span>
                            )}
                            <span className="text-[10px] text-gray-400 ml-1">{rb.position}</span>
                          </div>
                        </td>
                        <td className="px-2 py-2 text-xs">
                          <Link
                            href={`/team/${rb.team_id}`}
                            className="text-gray-500 hover:text-navy hover:underline transition-colors"
                          >
                            {rb.team_id}
                          </Link>
                        </td>
                        {columns.map((col) => {
                          const val = getVal(rb, col.key);
                          const isHeatmapCol = showHeatmap && heatmapCols.has(col.key);
                          const pct = isHeatmapCol ? getPercentile(sortedByCol[col.key] || [], val) : -1;
                          const inverted = INVERTED_COLS.has(col.key);
                          const heatStyle = isHeatmapCol ? getHeatmapStyle(pct, inverted) : {};

                          const cellClass = isHeatmapCol
                            ? "px-2 py-2 text-right tabular-nums"
                            : `px-2 py-2 text-right tabular-nums ${
                                isEpaCol(col.key) ? `font-bold ${epaColor(val)}` : "text-gray-700"
                              }`;

                          return (
                            <td key={col.key} className={cellClass} style={heatStyle}>
                              {formatVal(col.key, rb)}
                            </td>
                          );
                        })}
                      </tr>
                    </React.Fragment>
                  );
                })}
                {/* If avg belongs after the last player (below all rows) */}
                {showHeatmap && filtered.length > 0 && (() => {
                  const avgVal = nflAverages[sortKey];
                  if (isNaN(avgVal)) return null;
                  const lastVal = getVal(filtered[filtered.length - 1], sortKey);
                  const belongsAfterLast = sortDir === "desc" ? avgVal < lastVal : avgVal > lastVal;
                  if (!belongsAfterLast) return null;
                  return (
                    <tr key="nfl-avg" className="border-t border-amber-400">
                      <td className="px-2 py-2 sticky left-0 z-10" style={{ background: "#fef3c7" }}></td>
                      <td className="px-2 py-2 sticky left-8 z-10" style={{ background: "#fef3c7", color: "#92400e", fontWeight: 700, fontStyle: "italic" }}>
                        NFL AVG
                      </td>
                      <td className="px-2 py-2" style={{ background: "#fef3c7", color: "#92400e" }}>&mdash;</td>
                      {columns.map((col) => (
                        <td
                          key={col.key}
                          className="px-2 py-2 text-right tabular-nums"
                          style={{ background: "#fef3c7", color: "#92400e", fontWeight: 600, borderBottom: "2px solid #f59e0b" }}
                        >
                          {formatAvg(col.key, nflAverages[col.key])}
                        </td>
                      ))}
                    </tr>
                  );
                })()}
              </>
            )}
          </tbody>
        </table>
      </div>

      <p className="mt-2 text-xs text-gray-400">
        Showing {filtered.length} of {data.length} rushers with &ge;{minCarries} carries
        {teamFilter ? ` (${teamFilter})` : ""}
      </p>

      <div className="mt-4 text-xs text-gray-400 space-y-1 border-t border-gray-100 pt-3">
        <p><span className="font-semibold text-gray-500">Data source:</span> nflverse play-by-play. Stats may differ slightly from Pro Football Reference.</p>
        <p><span className="font-semibold text-gray-500">EPA/Car</span> = expected points added per carry. <span className="font-semibold text-gray-500">Success%</span> = carries gaining enough yards to stay on schedule.</p>
        <p><span className="font-semibold text-gray-500">Stuff%</span> = carries stopped at or behind the line of scrimmage. <span className="font-semibold text-gray-500">Explosive%</span> = carries gaining 10+ yards.</p>
        <p><span className="font-semibold text-gray-500">Rush FPts</span> = rushing-only fantasy points (yards/10 + TDs&times;6 &minus; fumbles lost). Does not include receiving stats.</p>
      </div>

    </div>
  );
}
