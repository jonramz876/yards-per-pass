// components/tables/RBLeaderboard.tsx
"use client";

import React, { useState, useMemo, useCallback, useRef } from "react";
import Link from "next/link";
import type { RBSeasonStat } from "@/lib/types";
import { getTeamColor, getTeamLogo } from "@/lib/data/teams";
import MetricTooltip from "@/components/ui/MetricTooltip";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import { computePercentile, getHeatmapPercentile, getHeatmapStyle } from "@/lib/stats/percentiles";
import { classifyRB } from "@/lib/stats/archetypes";
import { rbFantasyPoints, type ScoringFormat } from "@/lib/stats/fantasy";

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

type TabConfig = {
  label: string;
  columns: ColumnDef[];
  heatmapCols: Set<string>;
  defaultSort: string;
  rankBy: string;
  defaultHeatmap: boolean;
  showRank: boolean;
};

const RB_TABS: Record<string, TabConfig> = {
  overview: {
    label: "Overview",
    columns: [
      { key: "games", label: "GP", group: "core" },
      { key: "fantasy_pts", label: "FPts", group: "core" },
      { key: "epa_per_carry", label: "EPA/Car", tooltip: "EPA/Car", group: "core" },
      { key: "success_rate", label: "Success%", tooltip: "Success%", group: "efficiency" },
      { key: "stuff_rate", label: "Stuff%", tooltip: "Stuff%", group: "efficiency" },
      { key: "explosive_rate", label: "Explosive%", tooltip: "Explosive%", group: "efficiency" },
      { key: "yards_per_carry", label: "YPC", group: "efficiency" },
    ],
    heatmapCols: new Set(["epa_per_carry", "success_rate", "stuff_rate", "explosive_rate", "yards_per_carry"]),
    defaultSort: "epa_per_carry",
    rankBy: "epa_per_carry",
    defaultHeatmap: true,
    showRank: true,
  },
  rushing: {
    label: "Rushing",
    columns: [
      { key: "games", label: "GP", group: "core" },
      { key: "carries", label: "Car", group: "rushing" },
      { key: "rushing_yards", label: "Yds", group: "rushing" },
      { key: "yards_per_game", label: "Yds/G", group: "rushing" },
      { key: "yards_per_carry", label: "YPC", group: "rushing" },
      { key: "rushing_tds", label: "TD", group: "rushing" },
      { key: "fumbles_lost", label: "FL", tooltip: "FL", group: "rushing" },
    ],
    heatmapCols: new Set(["yards_per_carry"]),
    defaultSort: "rushing_yards",
    rankBy: "rushing_yards",
    defaultHeatmap: false,
    showRank: false,
  },
  epa: {
    label: "EPA",
    columns: [
      { key: "games", label: "GP", group: "core" },
      { key: "total_rushing_epa", label: "Total EPA", tooltip: "Total EPA", group: "core" },
      { key: "epa_per_carry", label: "EPA/Car", tooltip: "EPA/Car", group: "core" },
      { key: "success_rate", label: "Success%", tooltip: "Success%", group: "efficiency" },
      { key: "stuff_rate", label: "Stuff%", tooltip: "Stuff%", group: "efficiency" },
      { key: "explosive_rate", label: "Explosive%", tooltip: "Explosive%", group: "efficiency" },
    ],
    heatmapCols: new Set(["total_rushing_epa", "epa_per_carry", "success_rate", "stuff_rate", "explosive_rate"]),
    defaultSort: "total_rushing_epa",
    rankBy: "total_rushing_epa",
    defaultHeatmap: false,
    showRank: false,
  },
  fantasy: {
    label: "Fantasy",
    columns: [
      { key: "games", label: "GP", group: "core" },
      { key: "fantasy_pts", label: "PPR", group: "core" },
      { key: "half_pts", label: "Half", group: "core" },
      { key: "std_pts", label: "Std", group: "core" },
      { key: "pts_per_game", label: "Pts/G", group: "core" },
      { key: "carries", label: "Car", group: "rushing" },
      { key: "rushing_yards", label: "Rush Yds", group: "rushing" },
      { key: "rushing_tds", label: "Rush TD", group: "rushing" },
      { key: "receptions", label: "Rec", group: "receiving" },
      { key: "receiving_yards_display", label: "Rec Yds", group: "receiving" },
      { key: "receiving_tds_display", label: "Rec TD", group: "receiving" },
      { key: "fumbles_lost", label: "FL", tooltip: "FL", group: "rushing" },
    ],
    heatmapCols: new Set(["fantasy_pts", "pts_per_game"]),
    defaultSort: "fantasy_pts",
    rankBy: "fantasy_pts",
    defaultHeatmap: false,
    showRank: true,
  },
};

type RBTab = keyof typeof RB_TABS;
const TAB_KEYS = Object.keys(RB_TABS) as RBTab[];
type SortDir = "asc" | "desc";

// PFR qualification: 6.25 carries per team game
const PFR_CAR_PER_GAME = 6.25;

// Header background tints for column groups
const GROUP_COLORS: Record<string, string> = {
  core: "bg-navy",
  rushing: "bg-navy/[0.92]",
  receiving: "bg-navy/[0.85]",
  efficiency: "bg-navy/[0.78]",
};

function getVal(rb: RBSeasonStat, key: string, scoringFmt?: ScoringFormat): number {
  const fpts = (fmt: ScoringFormat) => rbFantasyPoints({
    rushing_yards: rb.rushing_yards,
    rushing_tds: rb.rushing_tds,
    receiving_yards: rb.receiving_yards,
    receiving_tds: rb.receiving_tds,
    receptions: rb.receptions,
    fumbles_lost: rb.fumbles_lost,
  }, fmt);
  switch (key) {
    case "yards_per_game":
      return rb.games ? rb.rushing_yards / rb.games : NaN;
    case "carries_per_game":
      return rb.games ? rb.carries / rb.games : NaN;
    case "fantasy_pts":
      return fpts(scoringFmt ?? "ppr");
    case "half_pts":
      return fpts("half");
    case "std_pts":
      return fpts("std");
    case "pts_per_game":
      return rb.games ? fpts(scoringFmt ?? "ppr") / rb.games : NaN;
    case "total_touches":
      return rb.total_touches ?? (rb.carries + rb.receptions);
    case "touches_per_game":
      if (rb.touches_per_game != null) return rb.touches_per_game;
      return rb.games ? (rb.carries + rb.receptions) / rb.games : NaN;
    case "total_rushing_epa":
      return rb.total_rushing_epa ?? NaN;
    case "receiving_yards_display":
      return rb.receiving_yards ?? NaN;
    case "receiving_tds_display":
      return rb.receiving_tds ?? NaN;
    default: {
      const val = rb[key as keyof RBSeasonStat] as number;
      return val ?? NaN;
    }
  }
}

// Inverted heatmap columns (lower = better)
const INVERTED_COLS = new Set(["stuff_rate"]);

// Shared stat formatting (used by both player rows and NFL AVG row)
function formatStat(key: string, val: number): string {
  if (val == null || isNaN(val)) return "\u2014";
  switch (key) {
    case "epa_per_carry":
    case "yards_per_carry":
    case "total_rushing_epa":
      return val.toFixed(2);
    case "success_rate":
    case "stuff_rate":
    case "explosive_rate":
      return (val * 100).toFixed(1) + "%";
    case "yards_per_game":
    case "carries_per_game":
    case "touches_per_game":
      return val.toFixed(1);
    case "fantasy_pts":
    case "half_pts":
    case "std_pts":
    case "pts_per_game":
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
  const TAB_MIGRATION: Record<string, RBTab> = { advanced: "overview", standard: "rushing" };
  const resolvedTab = TAB_MIGRATION[urlTab ?? ""] ?? urlTab;
  const initialTab: RBTab = TAB_KEYS.includes(resolvedTab as RBTab) ? (resolvedTab as RBTab) : "overview";

  const urlSort = searchParams.get("sort");
  const tabConfig = RB_TABS[initialTab];
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
  const pfrMinCarries = Math.round(PFR_CAR_PER_GAME * teamGames);
  const urlQualified = searchParams.get("qualified");
  const initialQualified = urlQualified !== "0";

  const urlMin = searchParams.get("min");
  const computedDefaultMin = initialQualified ? pfrMinCarries : Math.max(20, Math.round(100 * (throughWeek / 18)));
  const initialMin = (() => {
    if (initialQualified) return pfrMinCarries;
    if (!urlMin) return computedDefaultMin;
    const parsed = parseInt(urlMin, 10);
    return isNaN(parsed) || parsed < 0 ? computedDefaultMin : parsed;
  })();

  const urlTeam = searchParams.get("team") || "";
  const urlArch = searchParams.get("arch") || "";
  const urlScoring = searchParams.get("scoring");
  const initialScoring: ScoringFormat = urlScoring === "half" ? "half" : urlScoring === "std" ? "std" : "ppr";

  const [tab, setTab] = useState<RBTab>(initialTab);
  const [sortKey, setSortKey] = useState<string>(initialSortKey);
  const [sortDir, setSortDir] = useState<SortDir>(initialSortDir);
  const [search, setSearch] = useState(urlSearch);
  const [minCarries, setMinCarries] = useState(initialMin);
  const [qualified, setQualified] = useState(initialQualified);
  const [teamFilter, setTeamFilter] = useState(urlTeam);
  const [archFilter, setArchFilter] = useState(urlArch);
  const [scoringFormat, setScoringFormat] = useState<ScoringFormat>(initialScoring);

  // Unique teams sorted alphabetically for the dropdown
  const teams = useMemo(() => {
    const set = new Set(data.map((r) => r.team_id));
    return Array.from(set).sort();
  }, [data]);

  // Build URL from current state, omitting defaults
  const buildParams = useCallback(
    (overrides: { tab?: RBTab; sort?: string; dir?: SortDir; q?: string; min?: number; qualified?: boolean; team?: string; arch?: string; scoring?: ScoringFormat }) => {
      const params = new URLSearchParams(searchParams.toString());
      ["tab", "sort", "dir", "q", "min", "qualified", "team", "arch", "scoring"].forEach((k) => params.delete(k));

      const newTab = overrides.tab ?? tab;
      const defaultSort = RB_TABS[newTab].defaultSort;
      const newSort = overrides.sort ?? sortKey;
      const newDir = overrides.dir ?? sortDir;
      const newQ = overrides.q ?? search;
      const newQualified = overrides.qualified ?? qualified;
      const newMin = overrides.min ?? minCarries;
      const newTeam = overrides.team ?? teamFilter;
      const newArch = overrides.arch ?? archFilter;
      const newScoring = overrides.scoring ?? scoringFormat;

      if (newTab !== "overview") params.set("tab", newTab);
      if (newSort !== defaultSort) params.set("sort", newSort);
      if (newDir !== "desc") params.set("dir", newDir);
      if (newQ) params.set("q", newQ);
      if (!newQualified) {
        params.set("qualified", "0");
        if (newMin !== pfrMinCarries) params.set("min", String(newMin));
      }
      if (newTeam) params.set("team", newTeam);
      if (newArch) params.set("arch", newArch);
      if (newScoring !== "ppr") params.set("scoring", newScoring);

      const qs = params.toString();
      return pathname + (qs ? "?" + qs : "");
    },
    [searchParams, tab, sortKey, sortDir, search, minCarries, qualified, pfrMinCarries, teamFilter, archFilter, scoringFormat, pathname]
  );

  const pushURL = useCallback(
    (overrides: { tab?: RBTab; sort?: string; dir?: SortDir; min?: number; qualified?: boolean; team?: string; arch?: string; scoring?: ScoringFormat }) => {
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

  const activeTabConfig = RB_TABS[tab];
  const columns = activeTabConfig.columns;
  const [showHeatmap, setShowHeatmap] = useState(activeTabConfig.defaultHeatmap);

  const heatmapCols = activeTabConfig.heatmapCols;

  // When switching tabs, reset sort to tab default and revalidate
  function switchTab(newTab: RBTab) {
    const cfg = RB_TABS[newTab];
    setTab(newTab);
    setSortKey(cfg.defaultSort);
    setSortDir("desc");
    setShowHeatmap(cfg.defaultHeatmap);
    pushURL({ tab: newTab, sort: cfg.defaultSort, dir: "desc" });
  }

  // Compute archetype for each RB
  // RB axes: [Volume, Efficiency, Power, Explosiveness, Receiving, Consistency]
  const archetypeMap = useMemo(() => {
    const radarKeys = ["car_game", "epa_per_carry", "stuff_rate_inv", "explosive_rate", "receiving_proxy", "success_rate"] as const;

    function getRadarVal(rb: RBSeasonStat, key: string): number {
      switch (key) {
        case "car_game": return rb.games ? rb.carries / rb.games : NaN;
        case "epa_per_carry": return rb.epa_per_carry ?? NaN;
        case "stuff_rate_inv": return rb.stuff_rate != null ? (1 - rb.stuff_rate) : NaN; // invert: lower stuff = better power
        case "explosive_rate": return rb.explosive_rate ?? NaN;
        case "receiving_proxy": return rb.games ? (rb.targets || 0) / rb.games : NaN;
        case "success_rate": return rb.success_rate ?? NaN;
        default: return NaN;
      }
    }

    // Filter to qualified RBs (30+ carries) to match player page percentile pool
    const qualified = data.filter((rb) => rb.carries >= 30);

    // Pre-sort pools
    const sorted = radarKeys.map((key) =>
      qualified.map((r) => getRadarVal(r, key)).filter((v) => !isNaN(v)).sort((a, b) => a - b)
    );

    const map: Record<string, { icon: string; label: string }> = {};
    for (const rb of qualified) {
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
      const aVal = getVal(a, sortKey, scoringFormat);
      const bVal = getVal(b, sortKey, scoringFormat);
      const aNull = aVal == null || Number.isNaN(aVal);
      const bNull = bVal == null || Number.isNaN(bVal);
      if (aNull && bNull) return 0;
      if (aNull) return 1;
      if (bNull) return -1;
      return sortDir === "desc" ? bVal - aVal : aVal - bVal;
    });
    return result;
  }, [data, sortKey, sortDir, search, minCarries, teamFilter, archFilter, archetypeMap, scoringFormat]);

  // Position rank: fixed by tab's rankBy stat, independent of user sort
  const rankMap = useMemo(() => {
    const rankByKey = activeTabConfig.rankBy;
    const ranked = [...filtered].sort((a, b) => {
      const aVal = getVal(a, rankByKey, scoringFormat);
      const bVal = getVal(b, rankByKey, scoringFormat);
      const aNull = aVal == null || Number.isNaN(aVal);
      const bNull = bVal == null || Number.isNaN(bVal);
      if (aNull && bNull) return 0;
      if (aNull) return 1;
      if (bNull) return -1;
      return bVal - aVal; // Always desc for rank
    });
    const map: Record<string, number> = {};
    ranked.forEach((rb, i) => { map[rb.player_id] = i + 1; });
    return map;
  }, [filtered, activeTabConfig.rankBy, scoringFormat]);

  // Heatmap percentiles use the min-carries-only pool (ignoring team/archetype filters)
  const heatmapPool = useMemo(() => data.filter((rb) => rb.carries >= minCarries), [data, minCarries]);

  const sortedByCol = useMemo(() => {
    if (!showHeatmap) return {};
    const sorted: Record<string, number[]> = {};
    Array.from(heatmapCols).forEach((col) => {
      const values = heatmapPool.map((rb) => getVal(rb, col, scoringFormat)).filter((v) => !isNaN(v));
      values.sort((a, b) => a - b);
      sorted[col] = values;
    });
    return sorted;
  }, [heatmapPool, heatmapCols, showHeatmap, scoringFormat]);

  // NFL-wide averages (always from full dataset, ignoring team filters)
  const nflAverages = useMemo(() => {
    if (!showHeatmap) return {};
    const pool = data.filter((rb) => rb.carries >= minCarries);
    const avgs: Record<string, number> = {};
    for (const col of columns) {
      const values = pool.map((rb) => getVal(rb, col.key, scoringFormat)).filter((v) => !isNaN(v));
      avgs[col.key] = values.length
        ? values.reduce((a, b) => a + b, 0) / values.length
        : NaN;
    }
    return avgs;
  }, [data, minCarries, columns, showHeatmap, scoringFormat]);

  // Team averages (only shown when team filter is active)
  const teamAverages = useMemo(() => {
    if (!showHeatmap || !teamFilter) return {};
    const avgs: Record<string, number> = {};
    for (const col of columns) {
      const values = filtered.map((rb) => getVal(rb, col.key, scoringFormat)).filter((v) => !isNaN(v));
      avgs[col.key] = values.length
        ? values.reduce((a, b) => a + b, 0) / values.length
        : NaN;
    }
    return avgs;
  }, [filtered, columns, showHeatmap, teamFilter, scoringFormat]);

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

  const isEpaCol = (key: string) => key === "epa_per_carry" || key === "total_rushing_epa";

  // suppress unused variable warning
  void season;

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
                  {RB_TABS[t].label}
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
            <div className="flex items-center gap-3">
              <label className="flex items-center gap-2 text-sm text-gray-500 whitespace-nowrap cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={qualified}
                  onChange={(e) => {
                    const isQ = e.target.checked;
                    setQualified(isQ);
                    if (isQ) {
                      setMinCarries(pfrMinCarries);
                      pushURL({ qualified: true, min: pfrMinCarries });
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
                  {pfrMinCarries}+ car
                </span>
              ) : (
                <>
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
                </>
              )}
            </div>
            <select
              value={archFilter}
              onChange={(e) => { setArchFilter(e.target.value); pushURL({ arch: e.target.value }); }}
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
                  onClick={() => { setScoringFormat(val); pushURL({ scoring: val }); }}
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
                {filtered.map((rb, idx) => {
                  // Determine if NFL AVG row should appear before this player
                  let showAvgBefore = false;
                  if (showHeatmap && idx === 0) {
                    const avgVal = nflAverages[sortKey];
                    if (!isNaN(avgVal)) {
                      const rbVal = getVal(rb, sortKey, scoringFormat);
                      if (sortDir === "desc" ? avgVal >= rbVal : avgVal <= rbVal) {
                        showAvgBefore = true;
                      }
                    }
                  } else if (showHeatmap && idx > 0) {
                    const avgVal = nflAverages[sortKey];
                    if (!isNaN(avgVal)) {
                      const prevVal = getVal(filtered[idx - 1], sortKey, scoringFormat);
                      const currVal = getVal(rb, sortKey, scoringFormat);
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
                      {activeTabConfig.showRank && <td className="px-2 py-2 sticky left-0 z-10" style={{ background: "#eff6ff" }}></td>}
                      <td className={`px-2 py-2 sticky ${activeTabConfig.showRank ? "left-14" : "left-0"} z-10`} style={{ background: "#eff6ff", color: "#1e40af", fontWeight: 700, fontStyle: "italic" }}>
                        {teamFilter} AVG
                      </td>
                      <td className="px-2 py-2" style={{ background: "#eff6ff", color: "#1e40af" }}>&mdash;</td>
                      {columns.map((col) => (
                        <td
                          key={col.key}
                          className="px-2 py-2 text-right tabular-nums"
                          style={{ background: "#eff6ff", color: "#1e40af", fontWeight: 600, borderBottom: "2px solid #3b82f6" }}
                        >
                          {formatStat(col.key, teamAverages[col.key])}
                        </td>
                      ))}
                    </tr>
                  ) : null;

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
                          {formatStat(col.key, nflAverages[col.key])}
                        </td>
                      ))}
                    </tr>
                  ) : null;

                  return (
                    <React.Fragment key={rb.player_id}>
                      {teamAvgRow}
                      {avgRow}
                      <tr className="group border-t border-gray-100 hover:bg-gray-50/50 transition-colors">
                        {activeTabConfig.showRank && (
                        <td className="px-2 py-2 text-gray-400 font-bold tabular-nums text-xs w-14 sticky left-0 z-10 bg-white group-hover:bg-gray-50/50 font-mono">
                          RB{rankMap[rb.player_id] ?? idx + 1}
                        </td>
                        )}
                        <td className={`px-2 py-2 sticky ${activeTabConfig.showRank ? "left-14" : "left-0"} z-10 bg-white group-hover:bg-gray-50/50`}>
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
                            className="text-gray-500 hover:text-navy hover:underline transition-colors inline-flex items-center gap-1"
                          >
                            <img src={getTeamLogo(rb.team_id)} width={20} height={20} alt={rb.team_id} loading="eager" className="inline-block" />
                            {rb.team_id}
                          </Link>
                        </td>
                        {columns.map((col) => {
                          const val = getVal(rb, col.key, scoringFormat);
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
                              {formatStat(col.key, getVal(rb, col.key, scoringFormat))}
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
                  const lastVal = getVal(filtered[filtered.length - 1], sortKey, scoringFormat);
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
                          {formatStat(col.key, nflAverages[col.key])}
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
        Showing {filtered.length} of {data.length} rushers with &ge;{minCarries} carries{qualified && " (PFR qualified)"}
        {teamFilter ? ` (${teamFilter})` : ""}
      </p>

      <div className="mt-4 text-xs text-gray-400 space-y-1 border-t border-gray-100 pt-3">
        <p><span className="font-semibold text-gray-500">Data source:</span> nflverse play-by-play. Stats may differ slightly from Pro Football Reference.</p>
        <p><span className="font-semibold text-gray-500">EPA/Car</span> = expected points added per carry. <span className="font-semibold text-gray-500">Success%</span> = carries gaining enough yards to stay on schedule.</p>
        <p><span className="font-semibold text-gray-500">Stuff%</span> = carries stopped at or behind the line of scrimmage. <span className="font-semibold text-gray-500">Explosive%</span> = carries gaining 10+ yards.</p>
        <p><span className="font-semibold text-gray-500">FPts</span> = total fantasy points (rushing + receiving). PPR: +1/rec, Half: +0.5/rec, Standard: 0.</p>
      </div>

    </div>
  );
}
