// components/tables/QBLeaderboard.tsx
"use client";

import React, { useState, useMemo, useEffect, useCallback, useRef } from "react";
import type { QBSeasonStat } from "@/lib/types";
import { getTeamColor } from "@/lib/data/teams";
import MetricTooltip from "@/components/ui/MetricTooltip";
import QBStatCard from "@/components/qb/QBStatCard";
import { useSearchParams, useRouter, usePathname } from "next/navigation";

interface QBLeaderboardProps {
  data: QBSeasonStat[];
  throughWeek: number;
  season: number;
}

type ColumnDef = {
  key: string;
  label: string;
  group: string;
  tooltip?: string;
};

const ADVANCED_COLUMNS: ColumnDef[] = [
  { key: "games", label: "GP", group: "core" },
  { key: "epa_per_play", label: "EPA/Play", tooltip: "EPA/Play", group: "core" },
  { key: "epa_per_db", label: "EPA/DB", tooltip: "EPA/DB", group: "core" },
  { key: "cpoe", label: "CPOE", tooltip: "CPOE", group: "passing" },
  { key: "success_rate", label: "Success%", tooltip: "Success%", group: "passing" },
  { key: "any_a", label: "ANY/A", tooltip: "ANY/A", group: "efficiency" },
  { key: "td_int_ratio", label: "TD:INT", tooltip: "TD:INT", group: "efficiency" },
  { key: "adot", label: "aDOT", tooltip: "aDOT", group: "efficiency" },
  { key: "rush_epa_per_play", label: "Rush EPA", tooltip: "Rush EPA", group: "rushing" },
];

const STANDARD_COLUMNS: ColumnDef[] = [
  { key: "games", label: "GP", group: "core" },
  { key: "completions", label: "Cmp", group: "passing" },
  { key: "attempts", label: "Att", group: "passing" },
  { key: "completion_pct", label: "Comp%", tooltip: "Comp%", group: "passing" },
  { key: "passing_yards", label: "Yards", group: "passing" },
  { key: "yards_per_game", label: "Yds/G", group: "passing" },
  { key: "touchdowns", label: "TD", group: "passing" },
  { key: "tds_per_game", label: "TD/G", group: "passing" },
  { key: "interceptions", label: "INT", group: "passing" },
  { key: "fumbles_lost", label: "FL", tooltip: "FL", group: "passing" },
  { key: "sacks", label: "Sk", tooltip: "Sk", group: "passing" },
  { key: "sack_yards_lost", label: "Sk Yds", tooltip: "Sk Yds", group: "passing" },
  { key: "ypa", label: "YPA", tooltip: "YPA", group: "efficiency" },
  { key: "passer_rating", label: "Rating", tooltip: "Rating", group: "efficiency" },
  { key: "rush_attempts", label: "Rush Att", tooltip: "Rush Att", group: "rushing" },
  { key: "rush_yards", label: "Rush Yds", group: "rushing" },
  { key: "rush_tds", label: "Rush TD", group: "rushing" },
  { key: "total_tds", label: "Tot TD", group: "rushing" },
];

const VALID_ADVANCED_KEYS = new Set(ADVANCED_COLUMNS.map((c) => c.key));
const VALID_STANDARD_KEYS = new Set(STANDARD_COLUMNS.map((c) => c.key));

type Tab = "advanced" | "standard";
type SortDir = "asc" | "desc";

// Header background tints for column groups
const GROUP_COLORS: Record<string, string> = {
  core: "bg-navy",
  passing: "bg-navy/[0.92]",
  rushing: "bg-navy/[0.85]",
  efficiency: "bg-navy/[0.78]",
};

function getVal(qb: QBSeasonStat, key: string): number {
  switch (key) {
    case "yards_per_game": return qb.games ? qb.passing_yards / qb.games : NaN;
    case "tds_per_game": return qb.games ? qb.touchdowns / qb.games : NaN;
    case "total_tds": return qb.touchdowns + qb.rush_tds;
    case "td_int_ratio": return qb.interceptions > 0 ? qb.touchdowns / qb.interceptions : Infinity;
    default: {
      const val = qb[key as keyof QBSeasonStat] as number;
      return val ?? NaN;
    }
  }
}

// Columns that receive percentile-based conditional formatting
const HEATMAP_COLS_ADVANCED = new Set([
  "epa_per_play", "epa_per_db", "cpoe", "success_rate",
  "any_a", "td_int_ratio", "adot", "rush_epa_per_play",
]);
const HEATMAP_COLS_STANDARD = new Set([
  "completion_pct", "ypa", "passer_rating", "td_int_ratio",
]);

function getPercentile(sortedValues: number[], value: number): number {
  if (isNaN(value) || sortedValues.length === 0) return -1;
  const rank = sortedValues.filter((v) => v < value).length;
  return (rank / sortedValues.length) * 100;
}

function getHeatmapStyle(percentile: number): React.CSSProperties {
  if (percentile < 0) return {};
  if (percentile >= 90)
    return { background: "rgba(34,197,94,0.25)", color: "#15803d", fontWeight: 600 };
  if (percentile >= 75)
    return { background: "rgba(34,197,94,0.12)", color: "#16a34a" };
  if (percentile <= 10)
    return { background: "rgba(239,68,68,0.25)", color: "#dc2626", fontWeight: 600 };
  if (percentile <= 25)
    return { background: "rgba(239,68,68,0.12)", color: "#dc2626" };
  return {};
}

// Format a raw numeric value (used for NFL AVG row where there's no QB object)
// Note: This duplicates formatting logic from formatVal(). If formatVal's
// formatting rules change, update this function too.
function formatAvg(key: string, val: number): string {
  if (val == null || isNaN(val)) return "\u2014";
  switch (key) {
    case "epa_per_play":
    case "epa_per_db":
    case "cpoe":
    case "adot":
    case "ypa":
    case "any_a":
    case "rush_epa_per_play":
      return val.toFixed(2);
    case "success_rate":
      return (val * 100).toFixed(1) + "%";
    case "completion_pct":
    case "passer_rating":
      return val.toFixed(1);
    case "td_int_ratio":
      return val === Infinity ? "\u221E" : val.toFixed(1) + ":1";
    case "yards_per_game":
    case "tds_per_game":
      return val.toFixed(1);
    default:
      return Number.isInteger(val) ? val.toString() : val.toFixed(1);
  }
}

export default function QBLeaderboard({ data, throughWeek, season }: QBLeaderboardProps) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  // Read URL params with validation
  const urlTab = searchParams.get("tab");
  const initialTab: Tab = urlTab === "standard" ? "standard" : "advanced";

  const urlSort = searchParams.get("sort");
  const initialSortKey = (() => {
    if (!urlSort) return initialTab === "advanced" ? "epa_per_play" : "passing_yards";
    const validKeys = initialTab === "advanced" ? VALID_ADVANCED_KEYS : VALID_STANDARD_KEYS;
    return validKeys.has(urlSort) ? urlSort : (initialTab === "advanced" ? "epa_per_play" : "passing_yards");
  })();

  const urlDir = searchParams.get("dir");
  const initialSortDir: SortDir = urlDir === "asc" ? "asc" : "desc";

  const urlSearch = searchParams.get("q") || "";

  const urlMin = searchParams.get("min");
  const computedDefaultMin = Math.max(50, Math.round(200 * (throughWeek / 18)));
  const initialMin = (() => {
    if (!urlMin) return computedDefaultMin;
    const parsed = parseInt(urlMin, 10);
    return isNaN(parsed) || parsed < 0 ? computedDefaultMin : parsed;
  })();

  const [tab, setTab] = useState<Tab>(initialTab);
  const [sortKey, setSortKey] = useState<string>(initialSortKey);
  const [sortDir, setSortDir] = useState<SortDir>(initialSortDir);
  const [search, setSearch] = useState(urlSearch);
  const [minDropbacks, setMinDropbacks] = useState(initialMin);

  // Build URL from current state, omitting defaults. Clones existing params to preserve unknowns.
  const buildParams = useCallback(
    (overrides: { tab?: Tab; sort?: string; dir?: SortDir; q?: string; min?: number }) => {
      const params = new URLSearchParams(searchParams.toString());
      // Remove our managed keys, then re-add non-defaults
      ["tab", "sort", "dir", "q", "min"].forEach((k) => params.delete(k));

      const newTab = overrides.tab ?? tab;
      const defaultSort = newTab === "advanced" ? "epa_per_play" : "passing_yards";
      const newSort = overrides.sort ?? sortKey;
      const newDir = overrides.dir ?? sortDir;
      const newQ = overrides.q ?? search;
      const newMin = overrides.min ?? minDropbacks;

      if (newTab !== "advanced") params.set("tab", newTab);
      if (newSort !== defaultSort) params.set("sort", newSort);
      if (newDir !== "desc") params.set("dir", newDir);
      if (newQ) params.set("q", newQ);
      if (newMin !== computedDefaultMin) params.set("min", String(newMin));

      const qs = params.toString();
      return pathname + (qs ? "?" + qs : "");
    },
    [searchParams, tab, sortKey, sortDir, search, minDropbacks, computedDefaultMin, pathname]
  );

  const pushURL = useCallback(
    (overrides: { tab?: Tab; sort?: string; dir?: SortDir; min?: number }) => {
      router.push(buildParams(overrides), { scroll: false });
    },
    [buildParams, router]
  );

  // Debounced URL update for continuous inputs (search, slider) — uses replace to avoid flooding history
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
  const [selectedQB, setSelectedQB] = useState<QBSeasonStat | null>(null);

  const heatmapCols = tab === "advanced" ? HEATMAP_COLS_ADVANCED : HEATMAP_COLS_STANDARD;

  // When switching tabs, reset sort to a sensible default for that tab
  function switchTab(newTab: Tab) {
    setTab(newTab);
    const newSort = newTab === "advanced" ? "epa_per_play" : "passing_yards";
    setSortKey(newSort);
    setSortDir("desc");
    pushURL({ tab: newTab, sort: newSort, dir: "desc" });
  }

  const filtered = useMemo(() => {
    let result = data.filter((qb) => qb.dropbacks >= minDropbacks);
    if (search) {
      const term = search.toLowerCase();
      result = result.filter((qb) => qb.player_name.toLowerCase().includes(term));
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
  }, [data, sortKey, sortDir, search, minDropbacks]);

  useEffect(() => {
    setSelectedQB(null);
  }, [filtered]);

  const sortedByCol = useMemo(() => {
    if (!showHeatmap) return {};
    const sorted: Record<string, number[]> = {};
    Array.from(heatmapCols).forEach((col) => {
      const values = filtered.map((qb) => getVal(qb, col)).filter((v) => !isNaN(v));
      values.sort((a, b) => a - b);
      sorted[col] = values;
    });
    return sorted;
  }, [filtered, heatmapCols, showHeatmap]);

  const averages = useMemo(() => {
    if (!showHeatmap) return {};
    const avgs: Record<string, number> = {};
    for (const col of columns) {
      const values = filtered.map((qb) => getVal(qb, col.key)).filter((v) => !isNaN(v));
      avgs[col.key] = values.length
        ? values.reduce((a, b) => a + b, 0) / values.length
        : NaN;
    }
    return avgs;
  }, [filtered, columns, showHeatmap]);

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

  function formatVal(key: string, qb: QBSeasonStat): string {
    const val = getVal(qb, key);
    if (val == null || (typeof val === "number" && Number.isNaN(val))) return "\u2014";
    const n = val;
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
        return (n * 100).toFixed(1) + "%";
      case "passer_rating":
        return n.toFixed(1);
      case "yards_per_game":
      case "tds_per_game":
        return n.toFixed(1);
      case "total_tds":
        return n.toString();
      case "td_int_ratio":
        if (!Number.isFinite(n)) return `${qb.touchdowns}:0`;
        return n.toFixed(1) + ":1";
      default:
        return Number.isInteger(n) ? n.toString() : n.toFixed(1);
    }
  }

  function epaColor(val: number): string {
    return val > 0 ? "text-green-600" : val < 0 ? "text-red-600" : "text-gray-700";
  }

  const isEpaCol = (key: string) =>
    key === "epa_per_play" || key === "epa_per_db" || key === "rush_epa_per_play";

  return (
    <div>
      {/* Tab bar + Controls */}
      <div className="flex flex-col gap-4 mb-4">
        <div className="flex items-center gap-6">
          {/* Tabs */}
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

          {/* Search + Slider */}
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
                onChange={(e) => {
                  const val = parseInt(e.target.value);
                  setMinDropbacks(val);
                  replaceURLDebounced({ min: val });
                }}
                className="w-32"
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
                {filtered.map((qb, idx) => {
                  // Determine if NFL AVG row should appear before this QB
                  let showAvgBefore = false;
                  if (showHeatmap && idx === 0) {
                    // Check if avg belongs before the first row
                    const avgVal = averages[sortKey];
                    if (!isNaN(avgVal)) {
                      const qbVal = getVal(qb, sortKey);
                      if (sortDir === "desc" ? avgVal >= qbVal : avgVal <= qbVal) {
                        showAvgBefore = true;
                      }
                    }
                  } else if (showHeatmap && idx > 0) {
                    const avgVal = averages[sortKey];
                    if (!isNaN(avgVal)) {
                      const prevVal = getVal(filtered[idx - 1], sortKey);
                      const currVal = getVal(qb, sortKey);
                      if (sortDir === "desc") {
                        showAvgBefore = avgVal < prevVal && avgVal >= currVal;
                      } else {
                        showAvgBefore = avgVal > prevVal && avgVal <= currVal;
                      }
                    }
                  }

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
                          {formatAvg(col.key, averages[col.key])}
                        </td>
                      ))}
                    </tr>
                  ) : null;

                  return (
                    <React.Fragment key={qb.player_id}>
                      {avgRow}
                      <tr
                        className="group border-t border-gray-100 hover:bg-gray-50/50 transition-colors cursor-pointer"
                        onClick={() => setSelectedQB(qb)}
                      >
                        <td className="px-2 py-2 text-gray-400 font-bold tabular-nums w-8 sticky left-0 z-10 bg-white group-hover:bg-gray-50/50">{idx + 1}</td>
                        <td className="px-2 py-2 sticky left-8 z-10 bg-white group-hover:bg-gray-50/50">
                          <div className="flex items-center gap-2">
                            <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: getTeamColor(qb.team_id) }} />
                            <span className="font-semibold text-navy">{qb.player_name}</span>
                          </div>
                        </td>
                        <td className="px-2 py-2 text-gray-500 text-xs">{qb.team_id}</td>
                        {columns.map((col) => {
                          const val = getVal(qb, col.key);
                          const isHeatmapCol = showHeatmap && heatmapCols.has(col.key);
                          const pct = isHeatmapCol ? getPercentile(sortedByCol[col.key] || [], val) : -1;
                          const heatStyle = isHeatmapCol ? getHeatmapStyle(pct) : {};

                          const cellClass = isHeatmapCol
                            ? "px-2 py-2 text-right tabular-nums"
                            : `px-2 py-2 text-right tabular-nums ${
                                isEpaCol(col.key) ? `font-bold ${epaColor(val)}` : "text-gray-700"
                              }`;

                          return (
                            <td key={col.key} className={cellClass} style={heatStyle}>
                              {formatVal(col.key, qb)}
                            </td>
                          );
                        })}
                      </tr>
                    </React.Fragment>
                  );
                })}
                {/* If avg belongs after the last QB (below all rows) */}
                {showHeatmap && filtered.length > 0 && (() => {
                  const avgVal = averages[sortKey];
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
                          {formatAvg(col.key, averages[col.key])}
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
        Showing {filtered.length} of {data.length} quarterbacks with &ge;{minDropbacks} dropbacks
      </p>

      <div className="mt-4 text-xs text-gray-400 space-y-1 border-t border-gray-100 pt-3">
        <p><span className="font-semibold text-gray-500">Data source:</span> nflverse play-by-play. Stats may differ slightly from Pro Football Reference.</p>
        <p><span className="font-semibold text-gray-500">Rush Att</span> counts designed rushes and scrambles but excludes kneels. PFR includes kneels in rush attempts.</p>
        <p><span className="font-semibold text-gray-500">Success%</span> excludes sacks from the denominator. Sacks reflect offensive line failure, not QB decision-making. PFR includes sacks, which lowers the number.</p>
        {season === 2020 && (
          <p className="text-amber-600"><span className="font-semibold text-amber-700">Note:</span> 2020 CPOE values may be less reliable due to COVID-impacted season conditions (no preseason, limited practice, opt-outs).</p>
        )}
      </div>

      {selectedQB && (
        <QBStatCard
          qb={selectedQB}
          allQBs={filtered}
          getVal={getVal}
          onClose={() => setSelectedQB(null)}
          season={season}
          minDropbacks={minDropbacks}
        />
      )}
    </div>
  );
}
