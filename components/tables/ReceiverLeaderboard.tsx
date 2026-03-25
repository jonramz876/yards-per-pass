// components/tables/ReceiverLeaderboard.tsx
"use client";

import React, { useState, useMemo, useCallback, useRef } from "react";
import Link from "next/link";
import type { ReceiverSeasonStat } from "@/lib/types";
import { getTeamColor, getTeamLogo } from "@/lib/data/teams";
import MetricTooltip from "@/components/ui/MetricTooltip";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import { computePercentile, getHeatmapPercentile, getHeatmapStyle } from "@/lib/stats/percentiles";
import { classifyWR, classifyTE } from "@/lib/stats/archetypes";
import { wrFantasyPoints, type ScoringFormat } from "@/lib/stats/fantasy";

interface ReceiverLeaderboardProps {
  data: ReceiverSeasonStat[];
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

const REC_TABS: Record<string, TabConfig> = {
  overview: {
    label: "Overview",
    columns: [
      { key: "games", label: "GP", group: "core" },
      { key: "fantasy_pts", label: "FPts", group: "core" },
      { key: "epa_per_target", label: "EPA/Tgt", tooltip: "EPA/Tgt", group: "core" },
      { key: "croe", label: "CROE", tooltip: "CROE", group: "efficiency" },
      { key: "yards_per_route_run", label: "YPRR", tooltip: "YPRR", group: "efficiency" },
      { key: "air_yards_per_target", label: "aDOT", tooltip: "ADOT", group: "receiving" },
      { key: "yac_per_reception", label: "YAC/Rec", group: "receiving" },
      { key: "target_share", label: "Tgt Share", tooltip: "Tgt Share", group: "efficiency" },
    ],
    heatmapCols: new Set(["epa_per_target", "croe", "yards_per_route_run", "air_yards_per_target", "yac_per_reception", "target_share"]),
    defaultSort: "epa_per_target",
    rankBy: "epa_per_target",
    defaultHeatmap: true,
    showRank: true,
  },
  receiving: {
    label: "Receiving",
    columns: [
      { key: "games", label: "GP", group: "core" },
      { key: "targets", label: "Tgt", group: "receiving" },
      { key: "receptions", label: "Rec", group: "receiving" },
      { key: "receiving_yards", label: "Yds", group: "receiving" },
      { key: "yards_per_game", label: "Yds/G", group: "receiving" },
      { key: "receiving_tds", label: "TD", group: "receiving" },
      { key: "catch_rate", label: "Catch%", tooltip: "Catch%", group: "receiving" },
      { key: "yards_per_reception", label: "YPR", tooltip: "YPR", group: "efficiency" },
      { key: "fumbles_lost", label: "FL", tooltip: "FL", group: "efficiency" },
    ],
    heatmapCols: new Set(["catch_rate", "yards_per_reception"]),
    defaultSort: "receiving_yards",
    rankBy: "receiving_yards",
    defaultHeatmap: false,
    showRank: false,
  },
  efficiency: {
    label: "Efficiency",
    columns: [
      { key: "games", label: "GP", group: "core" },
      { key: "yards_per_route_run", label: "YPRR", tooltip: "YPRR", group: "efficiency" },
      { key: "targets_per_route_run", label: "TPRR", tooltip: "TPRR", group: "efficiency" },
      { key: "croe", label: "CROE", tooltip: "CROE", group: "efficiency" },
      { key: "receiving_success_rate", label: "Recv SR%", tooltip: "Success%", group: "efficiency" },
      { key: "air_yards_share", label: "AY%", tooltip: "AY%", group: "efficiency" },
      { key: "total_receiving_epa", label: "Total EPA", tooltip: "Total EPA", group: "core" },
      { key: "snap_share", label: "Snap%", tooltip: "Snap%", group: "efficiency" },
      { key: "route_participation_rate", label: "Route%", tooltip: "Route%", group: "efficiency" },
    ],
    heatmapCols: new Set(["yards_per_route_run", "targets_per_route_run", "croe", "receiving_success_rate", "air_yards_share", "total_receiving_epa", "snap_share", "route_participation_rate"]),
    defaultSort: "yards_per_route_run",
    rankBy: "yards_per_route_run",
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
      { key: "targets", label: "Tgt", group: "receiving" },
      { key: "receptions", label: "Rec", group: "receiving" },
      { key: "receiving_yards", label: "Yds", group: "receiving" },
      { key: "receiving_tds", label: "TD", group: "receiving" },
      { key: "fumbles_lost", label: "FL", tooltip: "FL", group: "efficiency" },
    ],
    heatmapCols: new Set(["fantasy_pts", "pts_per_game"]),
    defaultSort: "fantasy_pts",
    rankBy: "fantasy_pts",
    defaultHeatmap: false,
    showRank: true,
  },
};

type RecTab = keyof typeof REC_TABS;
const TAB_KEYS = Object.keys(REC_TABS) as RecTab[];
type SortDir = "asc" | "desc";

// PFR qualification: 1.875 targets per team game
const PFR_TGT_PER_GAME = 1.875;

// Header background tints for column groups
const GROUP_COLORS: Record<string, string> = {
  core: "bg-navy",
  receiving: "bg-navy/[0.92]",
  efficiency: "bg-navy/[0.78]",
};

function getVal(rec: ReceiverSeasonStat, key: string, scoringFmt?: ScoringFormat): number {
  const fpts = (fmt: ScoringFormat) => wrFantasyPoints({
    receiving_yards: rec.receiving_yards,
    receiving_tds: rec.receiving_tds,
    receptions: rec.receptions,
    fumbles_lost: rec.fumbles_lost,
  }, fmt);
  switch (key) {
    case "yards_per_game":
      return rec.games ? rec.receiving_yards / rec.games : NaN;
    case "fantasy_pts":
      return fpts(scoringFmt ?? "ppr");
    case "half_pts":
      return fpts("half");
    case "std_pts":
      return fpts("std");
    case "pts_per_game":
      return rec.games ? fpts(scoringFmt ?? "ppr") / rec.games : NaN;
    case "croe":
      return rec.croe ?? NaN;
    case "air_yards_share":
      return rec.air_yards_share ?? NaN;
    case "receiving_success_rate":
      return rec.receiving_success_rate ?? NaN;
    case "total_receiving_epa":
      return rec.total_receiving_epa ?? NaN;
    default: {
      const val = rec[key as keyof ReceiverSeasonStat] as number;
      return val ?? NaN;
    }
  }
}

// Shared stat formatting (used by both player rows and NFL AVG row)
function formatStat(key: string, val: number): string {
  if (val == null || isNaN(val)) return "\u2014";
  switch (key) {
    case "epa_per_target":
    case "yards_per_target":
    case "yac_per_reception":
    case "air_yards_per_target":
    case "yards_per_route_run":
    case "targets_per_route_run":
      return val.toFixed(2);
    case "croe": {
      const pct = (val * 100).toFixed(1);
      return (val >= 0 ? "+" : "") + pct + "%";
    }
    case "catch_rate":
    case "target_share":
    case "snap_share":
    case "route_participation_rate":
    case "air_yards_share":
    case "receiving_success_rate":
      return (val * 100).toFixed(1) + "%";
    case "total_receiving_epa":
      return val.toFixed(2);
    case "yards_per_reception":
    case "yards_per_game":
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

export default function ReceiverLeaderboard({ data, throughWeek, season, slugMap = {} }: ReceiverLeaderboardProps) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  // Read URL params with validation
  const urlTab = searchParams.get("tab");
  const TAB_MIGRATION: Record<string, RecTab> = { advanced: "overview", standard: "receiving" };
  const resolvedTab = TAB_MIGRATION[urlTab ?? ""] ?? urlTab;
  const initialTab: RecTab = TAB_KEYS.includes(resolvedTab as RecTab) ? (resolvedTab as RecTab) : "overview";

  const urlSort = searchParams.get("sort");
  const tabConfig = REC_TABS[initialTab];
  const validKeys = new Set(tabConfig.columns.map((c) => c.key));
  const initialSortKey = (() => {
    if (!urlSort) return tabConfig.defaultSort;
    return validKeys.has(urlSort) ? urlSort : tabConfig.defaultSort;
  })();

  const urlDir = searchParams.get("dir");
  const initialSortDir: SortDir = urlDir === "asc" ? "asc" : "desc";

  const urlSearch = searchParams.get("q") || "";

  const pfrMinTargets = Math.round(PFR_TGT_PER_GAME * throughWeek);
  const urlQualified = searchParams.get("qualified");
  const initialQualified = urlQualified !== "0";

  const urlMin = searchParams.get("min");
  const computedDefaultMin = initialQualified ? pfrMinTargets : Math.max(10, Math.round(100 * (throughWeek / 18)));
  const initialMin = (() => {
    if (initialQualified) return pfrMinTargets;
    if (!urlMin) return computedDefaultMin;
    const parsed = parseInt(urlMin, 10);
    return isNaN(parsed) || parsed < 0 ? computedDefaultMin : parsed;
  })();

  const urlPos = searchParams.get("pos") || "";
  const urlTeam = searchParams.get("team") || "";

  const [tab, setTab] = useState<RecTab>(initialTab);
  const [sortKey, setSortKey] = useState<string>(initialSortKey);
  const [sortDir, setSortDir] = useState<SortDir>(initialSortDir);
  const [search, setSearch] = useState(urlSearch);
  const [minTargets, setMinTargets] = useState(initialMin);
  const [qualified, setQualified] = useState(initialQualified);
  const [posFilter, setPosFilter] = useState(urlPos);
  const [teamFilter, setTeamFilter] = useState(urlTeam);

  // Unique teams sorted alphabetically for the dropdown
  const teams = useMemo(() => {
    const set = new Set(data.map((r) => r.team_id));
    return Array.from(set).sort();
  }, [data]);

  // Build URL from current state, omitting defaults. Clones existing params to preserve unknowns.
  const buildParams = useCallback(
    (overrides: { tab?: RecTab; sort?: string; dir?: SortDir; q?: string; min?: number; qualified?: boolean; pos?: string; team?: string }) => {
      const params = new URLSearchParams(searchParams.toString());
      // Remove our managed keys, then re-add non-defaults
      ["tab", "sort", "dir", "q", "min", "qualified", "pos", "team"].forEach((k) => params.delete(k));

      const newTab = overrides.tab ?? tab;
      const defaultSort = REC_TABS[newTab].defaultSort;
      const newSort = overrides.sort ?? sortKey;
      const newDir = overrides.dir ?? sortDir;
      const newQ = overrides.q ?? search;
      const newQualified = overrides.qualified ?? qualified;
      const newMin = overrides.min ?? minTargets;
      const newPos = overrides.pos ?? posFilter;
      const newTeam = overrides.team ?? teamFilter;

      if (newTab !== "overview") params.set("tab", newTab);
      if (newSort !== defaultSort) params.set("sort", newSort);
      if (newDir !== "desc") params.set("dir", newDir);
      if (newQ) params.set("q", newQ);
      if (!newQualified) {
        params.set("qualified", "0");
        if (newMin !== pfrMinTargets) params.set("min", String(newMin));
      }
      if (newPos) params.set("pos", newPos);
      if (newTeam) params.set("team", newTeam);

      const qs = params.toString();
      return pathname + (qs ? "?" + qs : "");
    },
    [searchParams, tab, sortKey, sortDir, search, minTargets, qualified, pfrMinTargets, posFilter, teamFilter, pathname]
  );

  const pushURL = useCallback(
    (overrides: { tab?: RecTab; sort?: string; dir?: SortDir; min?: number; qualified?: boolean; pos?: string; team?: string }) => {
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

  const activeTabConfig = REC_TABS[tab];
  const columns = activeTabConfig.columns;
  const [showHeatmap, setShowHeatmap] = useState(activeTabConfig.defaultHeatmap);
  const [archFilter, setArchFilter] = useState("");
  const [scoringFormat, setScoringFormat] = useState<ScoringFormat>("ppr");

  const heatmapCols = activeTabConfig.heatmapCols;

  // When switching tabs, reset sort to tab default and revalidate
  function switchTab(newTab: RecTab) {
    const cfg = REC_TABS[newTab];
    setTab(newTab);
    setSortKey(cfg.defaultSort);
    setSortDir("desc");
    setShowHeatmap(cfg.defaultHeatmap);
    pushURL({ tab: newTab, sort: cfg.defaultSort, dir: "desc" });
  }

  // Compute archetype for each receiver — TEs get their own pool and classifier
  const archetypeMap = useMemo(() => {
    // Filter to qualified players to match player page percentile pools (routes run, not targets)
    const wrPool = data.filter((r) => r.position === "WR" && r.routes_run >= 200);
    const tePool = data.filter((r) => r.position === "TE" && r.routes_run >= 100);
    const radarKeys = ["tgt_game", "epa_per_target", "catch_rate", "air_yards_per_target", "yac_per_reception", "yards_per_route_run"] as const;

    function getRadarVal(rec: ReceiverSeasonStat, key: string): number {
      switch (key) {
        case "tgt_game": return rec.games ? rec.targets / rec.games : NaN;
        case "epa_per_target": return rec.epa_per_target ?? NaN;
        case "catch_rate": return rec.catch_rate ?? NaN;
        case "air_yards_per_target": return rec.air_yards_per_target ?? NaN;
        case "yac_per_reception": return rec.yac_per_reception ?? NaN;
        case "yards_per_route_run": return rec.yards_per_route_run ?? NaN;
        default: return NaN;
      }
    }

    // Pre-sort pools for WRs and TEs separately
    const wrSorted = radarKeys.map((key) =>
      wrPool.map((r) => getRadarVal(r, key)).filter((v) => !isNaN(v)).sort((a, b) => a - b)
    );
    const teSorted = radarKeys.map((key) =>
      tePool.map((r) => getRadarVal(r, key)).filter((v) => !isNaN(v)).sort((a, b) => a - b)
    );

    const map: Record<string, { icon: string; label: string }> = {};
    for (const rec of data) {
      // Only classify WRs and TEs — RBs get their archetype on the /rushing page
      if (rec.position !== "WR" && rec.position !== "TE") continue;
      const isTE = rec.position === "TE";
      const pools = isTE ? teSorted : wrSorted;
      const percentiles = radarKeys.map((key, i) =>
        computePercentile(pools[i], getRadarVal(rec, key))
      );
      const arch = isTE ? classifyTE(percentiles) : classifyWR(percentiles);
      if (arch) map[rec.player_id] = { icon: arch.icon, label: arch.label };
    }
    return map;
  }, [data]);

  const uniqueArchetypes = useMemo(
    () => Array.from(new Set(Object.values(archetypeMap).map((a) => a.label))).sort(),
    [archetypeMap]
  );

  const filtered = useMemo(() => {
    let result = data.filter((rec) => rec.targets >= minTargets);
    if (posFilter) {
      result = result.filter((rec) => rec.position === posFilter);
    }
    if (teamFilter) {
      result = result.filter((rec) => rec.team_id === teamFilter);
    }
    if (search) {
      const term = search.toLowerCase();
      result = result.filter((rec) => rec.player_name.toLowerCase().includes(term));
    }
    if (archFilter) {
      result = result.filter((rec) => archetypeMap[rec.player_id]?.label === archFilter);
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
  }, [data, sortKey, sortDir, search, minTargets, posFilter, teamFilter, archFilter, archetypeMap, scoringFormat]);

  // Position rank: fixed by tab's rankBy stat, independent of user sort
  const rankMap = useMemo(() => {
    const rankByKey = activeTabConfig.rankBy;
    const byPos: Record<string, ReceiverSeasonStat[]> = {};
    for (const rec of filtered) {
      const pos = rec.position;
      if (!byPos[pos]) byPos[pos] = [];
      byPos[pos].push(rec);
    }
    const map: Record<string, { rank: number; pos: string }> = {};
    for (const [pos, players] of Object.entries(byPos)) {
      const ranked = [...players].sort((a, b) => {
        const aVal = getVal(a, rankByKey, scoringFormat);
        const bVal = getVal(b, rankByKey, scoringFormat);
        const aNull = aVal == null || Number.isNaN(aVal);
        const bNull = bVal == null || Number.isNaN(bVal);
        if (aNull && bNull) return 0;
        if (aNull) return 1;
        if (bNull) return -1;
        return bVal - aVal; // Always desc for rank
      });
      ranked.forEach((r, i) => { map[r.player_id] = { rank: i + 1, pos }; });
    }
    return map;
  }, [filtered, activeTabConfig.rankBy, scoringFormat]);

  const sortedByCol = useMemo(() => {
    if (!showHeatmap) return {};
    const sorted: Record<string, number[]> = {};
    Array.from(heatmapCols).forEach((col) => {
      const values = filtered.map((rec) => getVal(rec, col)).filter((v) => !isNaN(v));
      values.sort((a, b) => a - b);
      sorted[col] = values;
    });
    return sorted;
  }, [filtered, heatmapCols, showHeatmap]);

  // NFL-wide averages (always from full dataset, ignoring team/position filters)
  const nflAverages = useMemo(() => {
    if (!showHeatmap) return {};
    const pool = data.filter((rec) => rec.targets >= minTargets);
    const avgs: Record<string, number> = {};
    for (const col of columns) {
      const values = pool.map((rec) => getVal(rec, col.key, scoringFormat)).filter((v) => !isNaN(v));
      avgs[col.key] = values.length
        ? values.reduce((a, b) => a + b, 0) / values.length
        : NaN;
    }
    return avgs;
  }, [data, minTargets, columns, showHeatmap, scoringFormat]);

  // Team averages (only shown when team filter is active)
  const teamAverages = useMemo(() => {
    if (!showHeatmap || !teamFilter) return {};
    const avgs: Record<string, number> = {};
    for (const col of columns) {
      const values = filtered.map((rec) => getVal(rec, col.key, scoringFormat)).filter((v) => !isNaN(v));
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

  const isEpaCol = (key: string) => key === "epa_per_target" || key === "total_receiving_epa";

  // suppress unused variable warning — season reserved for future footnotes
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
                  {REC_TABS[t].label}
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
              value={posFilter}
              onChange={(e) => {
                setPosFilter(e.target.value);
                pushURL({ pos: e.target.value });
              }}
              className="border border-gray-200 rounded-md px-2 py-1 text-sm text-gray-600 w-full sm:w-auto"
            >
              <option value="">All Positions</option>
              <option value="WR">WR</option>
              <option value="TE">TE</option>
              <option value="RB">RB</option>
            </select>
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
              <label className="flex items-center gap-2 text-sm text-gray-500 whitespace-nowrap cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={qualified}
                  onChange={(e) => {
                    const isQ = e.target.checked;
                    setQualified(isQ);
                    if (isQ) {
                      setMinTargets(pfrMinTargets);
                      pushURL({ qualified: true, min: pfrMinTargets });
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
                  {pfrMinTargets}+ tgt
                </span>
              ) : (
                <>
                  <label className="text-sm text-gray-500 whitespace-nowrap">
                    Min tgt: <span className="font-semibold text-navy">{minTargets}</span>
                  </label>
                  <input
                    type="range"
                    min={5}
                    max={200}
                    step={5}
                    value={minTargets}
                    onChange={(e) => {
                      const val = parseInt(e.target.value);
                      setMinTargets(val);
                      replaceURLDebounced({ min: val });
                    }}
                    className="w-full sm:w-32"
                  />
                </>
              )}
            </div>
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
                <td colSpan={columns.length + (activeTabConfig.showRank ? 3 : 2)} className="text-center py-12 text-gray-500">
                  {search ? "No players match your search." : "No data available."}
                </td>
              </tr>
            ) : (
              <>
                {filtered.map((rec, idx) => {
                  // Determine if NFL AVG row should appear before this receiver
                  let showAvgBefore = false;
                  if (showHeatmap && idx === 0) {
                    const avgVal = nflAverages[sortKey];
                    if (!isNaN(avgVal)) {
                      const recVal = getVal(rec, sortKey, scoringFormat);
                      if (sortDir === "desc" ? avgVal >= recVal : avgVal <= recVal) {
                        showAvgBefore = true;
                      }
                    }
                  } else if (showHeatmap && idx > 0) {
                    const avgVal = nflAverages[sortKey];
                    if (!isNaN(avgVal)) {
                      const prevVal = getVal(filtered[idx - 1], sortKey, scoringFormat);
                      const currVal = getVal(rec, sortKey, scoringFormat);
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
                    <React.Fragment key={rec.player_id}>
                      {teamAvgRow}
                      {avgRow}
                      <tr className="group border-t border-gray-100 hover:bg-gray-50/50 transition-colors">
                        {activeTabConfig.showRank && (
                        <td className="px-2 py-2 text-gray-400 font-bold tabular-nums text-xs w-14 sticky left-0 z-10 bg-white group-hover:bg-gray-50/50 font-mono">
                          {rankMap[rec.player_id] ? `${rankMap[rec.player_id].pos}${rankMap[rec.player_id].rank}` : idx + 1}
                        </td>
                        )}
                        <td className={`px-2 py-2 sticky ${activeTabConfig.showRank ? "left-14" : "left-0"} z-10 bg-white group-hover:bg-gray-50/50`}>
                          <div className="flex items-center gap-2">
                            <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: getTeamColor(rec.team_id) }} />
                            <Link
                              href={`/player/${slugMap[rec.player_id] || rec.player_id}`}
                              className="font-semibold text-navy hover:text-nflred hover:underline transition-colors"
                            >
                              {rec.player_name}
                            </Link>
                            {archetypeMap[rec.player_id] && (
                              <span className="text-xs ml-0.5" title={archetypeMap[rec.player_id].label}>
                                {archetypeMap[rec.player_id].icon}
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-2 py-2 text-xs">
                          <Link
                            href={`/team/${rec.team_id}`}
                            className="text-gray-500 hover:text-navy hover:underline transition-colors inline-flex items-center gap-1"
                          >
                            <img src={getTeamLogo(rec.team_id)} width={20} height={20} alt={rec.team_id} loading="eager" className="inline-block" />
                            {rec.team_id}
                          </Link>
                        </td>
                        {columns.map((col) => {
                          const val = getVal(rec, col.key, scoringFormat);
                          const isHeatmapCol = showHeatmap && heatmapCols.has(col.key);
                          const pct = isHeatmapCol ? getHeatmapPercentile(sortedByCol[col.key] || [], val) : -1;
                          const heatStyle = isHeatmapCol ? getHeatmapStyle(pct) : {};

                          const cellClass = isHeatmapCol
                            ? "px-2 py-2 text-right tabular-nums"
                            : `px-2 py-2 text-right tabular-nums ${
                                isEpaCol(col.key) ? `font-bold ${epaColor(val)}` : "text-gray-700"
                              }`;

                          return (
                            <td key={col.key} className={cellClass} style={heatStyle}>
                              {formatStat(col.key, val)}
                            </td>
                          );
                        })}
                      </tr>
                    </React.Fragment>
                  );
                })}
                {/* If avg belongs after the last receiver (below all rows) */}
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
        Showing {filtered.length} of {data.length} receivers with &ge;{minTargets} targets{qualified && " (PFR qualified)"}
        {posFilter ? ` (${posFilter} only)` : ""}{teamFilter ? ` (${teamFilter})` : ""}
      </p>

      <div className="mt-4 text-xs text-gray-400 space-y-1 border-t border-gray-100 pt-3">
        <p><span className="font-semibold text-gray-500">Data source:</span> nflverse play-by-play. Stats may differ slightly from Pro Football Reference.</p>
        <p><span className="font-semibold text-gray-500">Catch%</span> = receptions / targets. <span className="font-semibold text-gray-500">ADOT</span> = average depth of target. <span className="font-semibold text-gray-500">YAC/Rec</span> = yards after catch per reception.</p>
        <p><span className="font-semibold text-gray-500">Tgt Share</span> = player targets / team pass attempts. Values may exceed typical ranges for players who changed teams mid-season.</p>
        <p><span className="font-semibold text-gray-500">Snap%</span> = player snaps / team offensive snaps. <span className="font-semibold text-gray-500">Route%</span> = routes run / total snaps (pass catchers &gt; blockers).</p>
      </div>

    </div>
  );
}
