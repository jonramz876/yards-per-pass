// components/tables/QBLeaderboard.tsx
"use client";

import React, { useState, useMemo, useCallback, useRef } from "react";
import Link from "next/link";
import type { QBSeasonStat } from "@/lib/types";
import { getTeamColor, getTeamLogo } from "@/lib/data/teams";
import MetricTooltip from "@/components/ui/MetricTooltip";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import { computePercentile, getHeatmapPercentile, getHeatmapStyle } from "@/lib/stats/percentiles";
import { classifyQB } from "@/lib/stats/archetypes";
import { qbFantasyPoints, type ScoringFormat } from "@/lib/stats/fantasy";

interface QBLeaderboardProps {
  data: QBSeasonStat[];
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

type TabConfig = {
  label: string;
  columns: ColumnDef[];
  heatmapCols: Set<string>;
  defaultSort: string;
  rankBy: string;
  defaultHeatmap: boolean;
  showRank: boolean;
};

const QB_TABS: Record<string, TabConfig> = {
  overview: {
    label: "Overview",
    columns: [
      { key: "games", label: "GP", group: "core" },
      { key: "fantasy_pts", label: "FPts", group: "core" },
      { key: "epa_per_db", label: "EPA/DB", tooltip: "EPA/DB", group: "core" },
      { key: "cpoe", label: "CPOE", tooltip: "CPOE", group: "passing" },
      { key: "success_rate", label: "Success%", tooltip: "Success%", group: "passing" },
      { key: "any_a", label: "ANY/A", tooltip: "ANY/A", group: "efficiency" },
      { key: "passer_rating", label: "Rating", tooltip: "Rating", group: "efficiency" },
    ],
    heatmapCols: new Set(["epa_per_db", "cpoe", "success_rate", "any_a", "passer_rating"]),
    defaultSort: "epa_per_db",
    rankBy: "epa_per_db",
    defaultHeatmap: true,
    showRank: true,
  },
  passing: {
    label: "Passing",
    columns: [
      { key: "games", label: "GP", group: "core" },
      { key: "completions", label: "Cmp", group: "passing" },
      { key: "attempts", label: "Att", group: "passing" },
      { key: "completion_pct", label: "Comp%", tooltip: "Comp%", group: "passing" },
      { key: "passing_yards", label: "Yards", group: "passing" },
      { key: "yards_per_game", label: "Yds/G", group: "passing" },
      { key: "ypa", label: "YPA", tooltip: "YPA", group: "passing" },
      { key: "adot", label: "aDOT", tooltip: "aDOT", group: "efficiency" },
      { key: "touchdowns", label: "TD", group: "passing" },
      { key: "interceptions", label: "INT", group: "passing" },
    ],
    heatmapCols: new Set(["completion_pct", "ypa", "adot"]),
    defaultSort: "passing_yards",
    rankBy: "passing_yards",
    defaultHeatmap: false,
    showRank: false,
  },
  rates: {
    label: "Rates",
    columns: [
      { key: "games", label: "GP", group: "core" },
      { key: "td_pct", label: "TD%", tooltip: "TD%", group: "passing" },
      { key: "int_pct", label: "INT%", tooltip: "INT%", group: "passing" },
      { key: "sack_pct", label: "SK%", tooltip: "SK%", group: "passing" },
      { key: "scramble_pct", label: "SCR%", tooltip: "SCR%", group: "passing" },
      { key: "completion_pct", label: "Comp%", tooltip: "Comp%", group: "passing" },
      { key: "success_rate", label: "Success%", tooltip: "Success%", group: "efficiency" },
    ],
    heatmapCols: new Set(["td_pct", "int_pct", "sack_pct", "completion_pct", "success_rate"]),
    defaultSort: "td_pct",
    rankBy: "td_pct",
    defaultHeatmap: false,
    showRank: false,
  },
  epa: {
    label: "EPA",
    columns: [
      { key: "games", label: "GP", group: "core" },
      { key: "total_epa", label: "Total EPA", tooltip: "Total EPA", group: "core" },
      { key: "epa_per_db", label: "EPA/DB", tooltip: "EPA/DB", group: "core" },
      { key: "epa_per_play", label: "EPA/Play", tooltip: "EPA/Play", group: "core" },
      { key: "rush_epa_per_play", label: "Rush EPA", tooltip: "Rush EPA", group: "rushing" },
      { key: "cpoe", label: "CPOE", tooltip: "CPOE", group: "passing" },
    ],
    heatmapCols: new Set(["total_epa", "epa_per_db", "epa_per_play", "rush_epa_per_play", "cpoe"]),
    defaultSort: "total_epa",
    rankBy: "total_epa",
    defaultHeatmap: false,
    showRank: false,
  },
  fantasy: {
    label: "Fantasy",
    columns: [
      { key: "games", label: "GP", group: "core" },
      { key: "fantasy_pts", label: "FPts", group: "core" },
      { key: "pts_per_game", label: "Pts/G", group: "core" },
      { key: "passing_yards", label: "Pass Yds", group: "passing" },
      { key: "touchdowns", label: "Pass TD", group: "passing" },
      { key: "rush_yards", label: "Rush Yds", group: "rushing" },
      { key: "rush_tds", label: "Rush TD", group: "rushing" },
      { key: "interceptions", label: "INT", group: "passing" },
      { key: "fumbles_lost", label: "FL", tooltip: "FL", group: "passing" },
    ],
    heatmapCols: new Set(["fantasy_pts", "pts_per_game"]),
    defaultSort: "fantasy_pts",
    rankBy: "fantasy_pts",
    defaultHeatmap: false,
    showRank: true,
  },
};

type QBTab = keyof typeof QB_TABS;
const TAB_KEYS = Object.keys(QB_TABS) as QBTab[];
type SortDir = "asc" | "desc";

// PFR qualification: 14 attempts per team game
const PFR_ATT_PER_GAME = 14;

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
    case "fantasy_pts": return qbFantasyPoints({
      passing_yards: qb.passing_yards,
      touchdowns: qb.touchdowns,
      interceptions: qb.interceptions,
      rush_yards: qb.rush_yards,
      rush_tds: qb.rush_tds,
      fumbles_lost: qb.fumbles_lost,
    });
    case "pts_per_game": {
      const fpts = qbFantasyPoints({ passing_yards: qb.passing_yards, touchdowns: qb.touchdowns, interceptions: qb.interceptions, rush_yards: qb.rush_yards, rush_tds: qb.rush_tds, fumbles_lost: qb.fumbles_lost });
      return qb.games ? fpts / qb.games : NaN;
    }
    default: {
      const val = qb[key as keyof QBSeasonStat] as number;
      return val ?? NaN;
    }
  }
}

// Inverted heatmap columns (lower = better)
const INVERTED_COLS = new Set(["int_pct", "sack_pct"]);

// Shared stat formatting (used by both formatVal and NFL AVG row)
function formatStat(key: string, val: number): string {
  if (val == null || isNaN(val)) return "\u2014";
  switch (key) {
    case "epa_per_play":
    case "epa_per_db":
    case "cpoe":
    case "adot":
    case "ypa":
    case "any_a":
    case "rush_epa_per_play":
    case "total_epa":
      return val.toFixed(2);
    case "success_rate":
      return (val * 100).toFixed(1) + "%";
    case "completion_pct":
    case "passer_rating":
    case "td_pct":
    case "int_pct":
    case "sack_pct":
    case "scramble_pct":
      return val.toFixed(1);
    case "td_int_ratio":
      return val === Infinity ? "\u221E" : val.toFixed(1) + ":1";
    case "yards_per_game":
    case "tds_per_game":
      return val.toFixed(1);
    case "fantasy_pts":
    case "pts_per_game":
      return val.toFixed(1);
    default:
      return Number.isInteger(val) ? val.toString() : val.toFixed(1);
  }
}

export default function QBLeaderboard({ data, throughWeek, season, slugMap = {} }: QBLeaderboardProps) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  // Read URL params with validation
  const urlTab = searchParams.get("tab");
  // Backwards compat: map old tab values to new ones
  const TAB_MIGRATION: Record<string, QBTab> = { advanced: "overview", standard: "passing" };
  const resolvedTab = TAB_MIGRATION[urlTab ?? ""] ?? urlTab;
  const initialTab: QBTab = TAB_KEYS.includes(resolvedTab as QBTab) ? (resolvedTab as QBTab) : "overview";

  const urlSort = searchParams.get("sort");
  const tabConfig = QB_TABS[initialTab];
  const validKeys = new Set(tabConfig.columns.map((c) => c.key));
  const initialSortKey = (() => {
    if (!urlSort) return tabConfig.defaultSort;
    return validKeys.has(urlSort) ? urlSort : tabConfig.defaultSort;
  })();

  const urlDir = searchParams.get("dir");
  const initialSortDir: SortDir = urlDir === "asc" ? "asc" : "desc";

  const urlSearch = searchParams.get("q") || "";

  // PFR uses team games (17), not weeks — throughWeek can be 18 (bye week)
  const teamGames = Math.min(throughWeek, 17);
  const pfrMinAttempts = Math.round(PFR_ATT_PER_GAME * teamGames);
  const urlQualified = searchParams.get("qualified");
  const initialQualified = urlQualified !== "0";

  const urlMin = searchParams.get("min");
  const computedDefaultMin = initialQualified ? pfrMinAttempts : Math.max(50, Math.round(200 * (throughWeek / 18)));
  const initialMin = (() => {
    if (initialQualified) return pfrMinAttempts;
    if (!urlMin) return computedDefaultMin;
    const parsed = parseInt(urlMin, 10);
    return isNaN(parsed) || parsed < 0 ? computedDefaultMin : parsed;
  })();

  const [tab, setTab] = useState<QBTab>(initialTab);
  const [sortKey, setSortKey] = useState<string>(initialSortKey);
  const [sortDir, setSortDir] = useState<SortDir>(initialSortDir);
  const [search, setSearch] = useState(urlSearch);
  const [minDropbacks, setMinDropbacks] = useState(initialMin);
  const [qualified, setQualified] = useState(initialQualified);

  // Build URL from current state, omitting defaults. Clones existing params to preserve unknowns.
  const buildParams = useCallback(
    (overrides: { tab?: QBTab; sort?: string; dir?: SortDir; q?: string; min?: number; qualified?: boolean }) => {
      const params = new URLSearchParams(searchParams.toString());
      // Remove our managed keys, then re-add non-defaults
      ["tab", "sort", "dir", "q", "min", "qualified"].forEach((k) => params.delete(k));

      const newTab = overrides.tab ?? tab;
      const defaultSort = QB_TABS[newTab].defaultSort;
      const newSort = overrides.sort ?? sortKey;
      const newDir = overrides.dir ?? sortDir;
      const newQ = overrides.q ?? search;
      const newQualified = overrides.qualified ?? qualified;
      const newMin = overrides.min ?? minDropbacks;

      if (newTab !== "overview") params.set("tab", newTab);
      if (newSort !== defaultSort) params.set("sort", newSort);
      if (newDir !== "desc") params.set("dir", newDir);
      if (newQ) params.set("q", newQ);
      if (!newQualified) {
        params.set("qualified", "0");
        if (newMin !== pfrMinAttempts) params.set("min", String(newMin));
      }

      const qs = params.toString();
      return pathname + (qs ? "?" + qs : "");
    },
    [searchParams, tab, sortKey, sortDir, search, minDropbacks, qualified, pfrMinAttempts, pathname]
  );

  const pushURL = useCallback(
    (overrides: { tab?: QBTab; sort?: string; dir?: SortDir; min?: number; qualified?: boolean }) => {
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

  const activeTabConfig = QB_TABS[tab];
  const columns = activeTabConfig.columns;
  const [showHeatmap, setShowHeatmap] = useState(activeTabConfig.defaultHeatmap);
  const [archFilter, setArchFilter] = useState("");
  const [scoringFormat, setScoringFormat] = useState<ScoringFormat>("ppr");

  const heatmapCols = activeTabConfig.heatmapCols;

  // When switching tabs, reset sort to tab default and revalidate
  function switchTab(newTab: QBTab) {
    const cfg = QB_TABS[newTab];
    setTab(newTab);
    setSortKey(cfg.defaultSort);
    setSortDir("desc");
    setShowHeatmap(cfg.defaultHeatmap);
    pushURL({ tab: newTab, sort: cfg.defaultSort, dir: "desc" });
  }

  // Compute archetype for each QB based on percentiles against ALL QBs (not filtered)
  // Must match the player page pool to ensure consistent archetype labels
  const archetypeMap = useMemo(() => {
    // Filter to qualified QBs (100+ dropbacks) to match player page percentile pool
    const pool = data.filter((qb) => qb.dropbacks >= 100);
    const radarKeys = ["epa_per_db", "cpoe", "dropbacks_game", "adot", "inv_int_pct", "success_rate"] as const;

    function getRadarVal(qb: QBSeasonStat, key: string): number {
      switch (key) {
        case "epa_per_db": return qb.epa_per_db ?? NaN;
        case "cpoe": return qb.cpoe ?? NaN;
        case "dropbacks_game": return qb.games ? qb.dropbacks / qb.games : NaN;
        case "adot": return qb.adot ?? NaN;
        case "inv_int_pct": return qb.attempts > 0 ? 1 - (qb.interceptions / qb.attempts) : NaN;
        case "success_rate": return qb.success_rate ?? NaN;
        default: return NaN;
      }
    }

    // Pre-sort all pools once
    const sortedPools = radarKeys.map((key) =>
      pool.map((q) => getRadarVal(q, key)).filter((v) => !isNaN(v)).sort((a, b) => a - b)
    );

    const map: Record<string, { icon: string; label: string }> = {};
    for (const qb of pool) {
      const percentiles = radarKeys.map((key, i) =>
        computePercentile(sortedPools[i], getRadarVal(qb, key))
      );
      const arch = classifyQB(percentiles);
      if (arch) map[qb.player_id] = { icon: arch.icon, label: arch.label };
    }
    return map;
  }, [data]);

  const uniqueArchetypes = useMemo(
    () => Array.from(new Set(Object.values(archetypeMap).map((a) => a.label))).sort(),
    [archetypeMap]
  );

  const filtered = useMemo(() => {
    let result = data.filter((qb) => qb.attempts >= minDropbacks);
    if (search) {
      const term = search.toLowerCase();
      result = result.filter((qb) => qb.player_name.toLowerCase().includes(term));
    }
    if (archFilter) {
      result = result.filter((qb) => archetypeMap[qb.player_id]?.label === archFilter);
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
  }, [data, sortKey, sortDir, search, minDropbacks, archFilter, archetypeMap]);

  // Position rank: fixed by tab's rankBy stat, independent of user sort
  const rankMap = useMemo(() => {
    const rankByKey = activeTabConfig.rankBy;
    const ranked = [...filtered].sort((a, b) => {
      const aVal = getVal(a, rankByKey);
      const bVal = getVal(b, rankByKey);
      const aNull = aVal == null || Number.isNaN(aVal);
      const bNull = bVal == null || Number.isNaN(bVal);
      if (aNull && bNull) return 0;
      if (aNull) return 1;
      if (bNull) return -1;
      return bVal - aVal; // Always desc for rank
    });
    const map: Record<string, number> = {};
    ranked.forEach((qb, i) => { map[qb.player_id] = i + 1; });
    return map;
  }, [filtered, activeTabConfig.rankBy]);

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
    // Special case for td_int_ratio with infinity
    if (key === "td_int_ratio" && !Number.isFinite(val)) return `${qb.touchdowns}:0`;
    return formatStat(key, val);
  }

  function epaColor(val: number): string {
    return val > 0 ? "text-green-600" : val < 0 ? "text-red-600" : "text-gray-700";
  }

  const isEpaCol = (key: string) =>
    key === "epa_per_play" || key === "epa_per_db" || key === "rush_epa_per_play" || key === "total_epa";

  return (
    <div>
      {/* Tab bar + Controls */}
      <div className="flex flex-col gap-4 mb-4">
        <div className="flex flex-col sm:flex-row sm:items-center gap-4">
          {/* Tabs — scrollable on mobile */}
          <div className="relative">
            <div className="flex gap-1 overflow-x-auto scrollbar-hide" style={{ scrollSnapType: "x mandatory" }}>
              {TAB_KEYS.map((t) => (
                <button
                  key={t}
                  onClick={() => switchTab(t)}
                  style={{ scrollSnapAlign: "start" }}
                  className={`px-3 py-1.5 text-sm font-medium rounded-md whitespace-nowrap transition-colors ${
                    tab === t
                      ? "bg-navy text-white"
                      : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                  }`}
                >
                  {QB_TABS[t].label}
                </button>
              ))}
            </div>
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
              <label className="flex items-center gap-2 text-sm text-gray-500 whitespace-nowrap cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={qualified}
                  onChange={(e) => {
                    const isQ = e.target.checked;
                    setQualified(isQ);
                    if (isQ) {
                      setMinDropbacks(pfrMinAttempts);
                      pushURL({ qualified: true, min: pfrMinAttempts });
                    } else {
                      pushURL({ qualified: false });
                    }
                  }}
                  className="rounded border-gray-300 text-navy focus:ring-navy/20"
                />
                PFR Qualified
              </label>
              {qualified ? (
                <span className="text-xs font-medium text-navy bg-navy/10 px-2 py-0.5 rounded-full whitespace-nowrap">
                  {pfrMinAttempts}+ att
                </span>
              ) : (
                <>
                  <label className="text-sm text-gray-500 whitespace-nowrap">
                    Min att: <span className="font-semibold text-navy">{minDropbacks}</span>
                  </label>
                  <input
                    type="range"
                    min={10}
                    max={500}
                    step={10}
                    value={minDropbacks}
                    onChange={(e) => {
                      const val = parseInt(e.target.value);
                      setMinDropbacks(val);
                      replaceURLDebounced({ min: val });
                    }}
                    className="w-full sm:w-32"
                  />
                </>
              )}
            </div>
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
            <div className="flex rounded-lg border border-gray-200 overflow-hidden">
              {([["ppr", "PPR"], ["half", "Half"], ["std", "Std"]] as const).map(([val, label]) => (
                <button
                  key={val}
                  onClick={() => setScoringFormat(val)}
                  className={`px-2 py-1 text-xs font-medium transition-colors ${
                    scoringFormat === val
                      ? "bg-navy text-white"
                      : "bg-white text-gray-600 hover:bg-gray-50"
                  }`}
                >
                  {label}
                </button>
              ))}
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
              {activeTabConfig.showRank && <th className="bg-navy text-white px-2 py-2.5 text-left text-xs font-semibold w-14 sticky left-0 z-20">Rank</th>}
              <th className={`bg-navy text-white px-2 py-2.5 text-left text-xs font-semibold min-w-[130px] sticky ${activeTabConfig.showRank ? "left-14" : "left-0"} z-20`}>Player</th>
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
                      {activeTabConfig.showRank && <td className="px-2 py-2 sticky left-0 z-10" style={{ background: "#fef3c7" }}></td>}
                      <td className={`px-2 py-2 sticky ${activeTabConfig.showRank ? "left-14" : "left-0"} z-10`} style={{ background: "#fef3c7", color: "#92400e", fontWeight: 700, fontStyle: "italic" }}>
                        NFL AVG
                      </td>
                      <td className="px-2 py-2" style={{ background: "#fef3c7", color: "#92400e" }}>&mdash;</td>
                      {columns.map((col) => (
                        <td
                          key={col.key}
                          className="px-2 py-2 text-right tabular-nums"
                          style={{ background: "#fef3c7", color: "#92400e", fontWeight: 600, borderBottom: "2px solid #f59e0b" }}
                        >
                          {formatStat(col.key, averages[col.key])}
                        </td>
                      ))}
                    </tr>
                  ) : null;

                  return (
                    <React.Fragment key={qb.player_id}>
                      {avgRow}
                      <tr
                        className="group border-t border-gray-100 hover:bg-gray-50/50 transition-colors"
                      >
                        {activeTabConfig.showRank && (
                          <td className="px-2 py-2 text-gray-400 font-bold tabular-nums text-xs w-14 sticky left-0 z-10 bg-white group-hover:bg-gray-50/50 font-mono">
                            QB{rankMap[qb.player_id] ?? idx + 1}
                          </td>
                        )}
                        <td className={`px-2 py-2 sticky ${activeTabConfig.showRank ? "left-14" : "left-0"} z-10 bg-white group-hover:bg-gray-50/50`}>
                          <div className="flex items-center gap-2">
                            <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: getTeamColor(qb.team_id) }} />
                            <Link
                              href={`/player/${slugMap[qb.player_id] || qb.player_id}`}
                              className="font-semibold text-navy hover:text-nflred hover:underline transition-colors"
                            >
                              {qb.player_name}
                            </Link>
                            {archetypeMap[qb.player_id] && (
                              <span className="text-xs ml-1" title={archetypeMap[qb.player_id].label}>
                                {archetypeMap[qb.player_id].icon}
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-2 py-2 text-xs">
                          <Link
                            href={`/team/${qb.team_id}`}
                            className="text-gray-500 hover:text-navy hover:underline transition-colors inline-flex items-center gap-1"
                          >
                            <img src={getTeamLogo(qb.team_id)} width={20} height={20} alt={qb.team_id} loading="eager" className="inline-block" />
                            {qb.team_id}
                          </Link>
                        </td>
                        {columns.map((col) => {
                          const val = getVal(qb, col.key);
                          const isHeatmapCol = showHeatmap && heatmapCols.has(col.key);
                          let pct = isHeatmapCol ? getHeatmapPercentile(sortedByCol[col.key] || [], val) : -1;
                          if (isHeatmapCol && INVERTED_COLS.has(col.key)) pct = 100 - pct;
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
                      {activeTabConfig.showRank && <td className="px-2 py-2 sticky left-0 z-10" style={{ background: "#fef3c7" }}></td>}
                      <td className={`px-2 py-2 sticky ${activeTabConfig.showRank ? "left-14" : "left-0"} z-10`} style={{ background: "#fef3c7", color: "#92400e", fontWeight: 700, fontStyle: "italic" }}>
                        NFL AVG
                      </td>
                      <td className="px-2 py-2" style={{ background: "#fef3c7", color: "#92400e" }}>&mdash;</td>
                      {columns.map((col) => (
                        <td
                          key={col.key}
                          className="px-2 py-2 text-right tabular-nums"
                          style={{ background: "#fef3c7", color: "#92400e", fontWeight: 600, borderBottom: "2px solid #f59e0b" }}
                        >
                          {formatStat(col.key, averages[col.key])}
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
        Showing {filtered.length} of {data.length} quarterbacks with &ge;{minDropbacks} attempts{qualified && " (PFR qualified)"}
      </p>

      <div className="mt-4 text-xs text-gray-400 space-y-1 border-t border-gray-100 pt-3">
        <p><span className="font-semibold text-gray-500">Data source:</span> nflverse play-by-play. Stats may differ slightly from Pro Football Reference.</p>
        <p><span className="font-semibold text-gray-500">Rush Att</span> counts designed rushes and scrambles but excludes kneels. PFR includes kneels in rush attempts.</p>
        <p><span className="font-semibold text-gray-500">Success%</span> excludes sacks from the denominator. Sacks reflect offensive line failure, not QB decision-making. PFR includes sacks, which lowers the number.</p>
        {season === 2020 && (
          <p className="text-amber-600"><span className="font-semibold text-amber-700">Note:</span> 2020 CPOE values may be less reliable due to COVID-impacted season conditions (no preseason, limited practice, opt-outs).</p>
        )}
      </div>

    </div>
  );
}
