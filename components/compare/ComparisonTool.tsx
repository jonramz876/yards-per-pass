// components/compare/ComparisonTool.tsx
"use client";

import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import { getSupabaseClient } from "@/lib/supabase/client";
import type { QBSeasonStat, ReceiverSeasonStat, RBSeasonStat } from "@/lib/types";
import { getTeamColor } from "@/lib/data/teams";
import { computePercentile } from "@/lib/stats/percentiles";
import PlayerSearchInput, { type SelectedPlayer } from "./PlayerSearchInput";
import OverlayRadarChart from "./OverlayRadarChart";

interface ComparisonToolProps {
  qbs: QBSeasonStat[];
  receivers: ReceiverSeasonStat[];
  rbs: RBSeasonStat[];
  season: number;
}

// Position-specific radar configurations
const QB_AXES = [
  { label: "EPA/DB" }, { label: "CPOE" }, { label: "DB/Game" },
  { label: "aDOT" }, { label: "INT Rate" }, { label: "Success%" },
];
const QB_KEYS = ["epa_per_db", "cpoe", "dropbacks_game", "adot", "inv_int_pct", "success_rate"];

const WR_AXES = [
  { label: "Tgt/Game" }, { label: "EPA/Tgt" }, { label: "CROE" },
  { label: "aDOT" }, { label: "YAC/Rec" }, { label: "YPRR" },
];
const WR_KEYS = ["targets_game", "epa_per_target", "croe", "air_yards_per_target", "yac_per_reception", "yards_per_route_run"];

const RB_AXES = [
  { label: "Car/Game" }, { label: "EPA/Car" }, { label: "Stuff Avoid" },
  { label: "Explosive%" }, { label: "Tgt/Game" }, { label: "Success%" },
];
const RB_KEYS = ["carries_game", "epa_per_carry", "stuff_avoid", "explosive_rate", "targets_game", "success_rate"];

type CompStat = { label: string; key: string; format: (v: number) => string; higherBetter: boolean };

const QB_COMP_STATS: CompStat[] = [
  // Radar axes
  { label: "EPA/DB", key: "epa_per_db", format: (v) => v.toFixed(2), higherBetter: true },
  { label: "CPOE", key: "cpoe", format: (v) => (v >= 0 ? "+" : "") + v.toFixed(1), higherBetter: true },
  { label: "aDOT", key: "adot", format: (v) => v.toFixed(1), higherBetter: true },
  { label: "Success%", key: "success_rate", format: (v) => (v * 100).toFixed(1) + "%", higherBetter: true },
  // Volume + efficiency
  { label: "Pass Yds", key: "passing_yards", format: (v) => v.toFixed(0), higherBetter: true },
  { label: "Pass TD", key: "touchdowns", format: (v) => v.toFixed(0), higherBetter: true },
  { label: "INT", key: "interceptions", format: (v) => v.toFixed(0), higherBetter: false },
  { label: "ANY/A", key: "any_a", format: (v) => v.toFixed(2), higherBetter: true },
  { label: "Rating", key: "passer_rating", format: (v) => v.toFixed(1), higherBetter: true },
  { label: "TD%", key: "td_pct", format: (v) => v.toFixed(1), higherBetter: true },
  { label: "INT%", key: "int_pct", format: (v) => v.toFixed(1), higherBetter: false },
  { label: "Total EPA", key: "total_epa", format: (v) => v.toFixed(1), higherBetter: true },
  { label: "Rush Yds", key: "rush_yards", format: (v) => v.toFixed(0), higherBetter: true },
  { label: "Rush TD", key: "rush_tds", format: (v) => v.toFixed(0), higherBetter: true },
  { label: "SCR%", key: "scramble_pct", format: (v) => v.toFixed(1), higherBetter: true },
  { label: "Games", key: "games", format: (v) => v.toFixed(0), higherBetter: true },
];

const WR_COMP_STATS: CompStat[] = [
  // Radar axes
  { label: "EPA/Tgt", key: "epa_per_target", format: (v) => v.toFixed(2), higherBetter: true },
  { label: "CROE", key: "croe", format: (v) => (v >= 0 ? "+" : "") + (v * 100).toFixed(1) + "%", higherBetter: true },
  { label: "aDOT", key: "air_yards_per_target", format: (v) => v.toFixed(1), higherBetter: true },
  { label: "YAC/Rec", key: "yac_per_reception", format: (v) => v.toFixed(1), higherBetter: true },
  { label: "YPRR", key: "yards_per_route_run", format: (v) => v.toFixed(2), higherBetter: true },
  // Volume + rates
  { label: "Targets", key: "targets", format: (v) => v.toFixed(0), higherBetter: true },
  { label: "Receptions", key: "receptions", format: (v) => v.toFixed(0), higherBetter: true },
  { label: "Yards", key: "receiving_yards", format: (v) => v.toFixed(0), higherBetter: true },
  { label: "TDs", key: "receiving_tds", format: (v) => v.toFixed(0), higherBetter: true },
  { label: "Catch%", key: "catch_rate", format: (v) => (v * 100).toFixed(1) + "%", higherBetter: true },
  { label: "Tgt Share", key: "target_share", format: (v) => (v * 100).toFixed(1) + "%", higherBetter: true },
  { label: "AY%", key: "air_yards_share", format: (v) => (v * 100).toFixed(1) + "%", higherBetter: true },
  { label: "Games", key: "games", format: (v) => v.toFixed(0), higherBetter: true },
];

const RB_COMP_STATS: CompStat[] = [
  // Radar axes
  { label: "EPA/Car", key: "epa_per_carry", format: (v) => v.toFixed(2), higherBetter: true },
  { label: "Success%", key: "success_rate", format: (v) => (v * 100).toFixed(1) + "%", higherBetter: true },
  { label: "Stuff%", key: "stuff_rate", format: (v) => (v * 100).toFixed(1) + "%", higherBetter: false },
  { label: "Explosive%", key: "explosive_rate", format: (v) => (v * 100).toFixed(1) + "%", higherBetter: true },
  // Volume + efficiency
  { label: "Carries", key: "carries", format: (v) => v.toFixed(0), higherBetter: true },
  { label: "Rush Yds", key: "rushing_yards", format: (v) => v.toFixed(0), higherBetter: true },
  { label: "Rush TD", key: "rushing_tds", format: (v) => v.toFixed(0), higherBetter: true },
  { label: "YPC", key: "yards_per_carry", format: (v) => v.toFixed(1), higherBetter: true },
  { label: "TCH", key: "total_touches", format: (v) => v.toFixed(0), higherBetter: true },
  { label: "Total EPA", key: "total_rushing_epa", format: (v) => v.toFixed(1), higherBetter: true },
  { label: "Games", key: "games", format: (v) => v.toFixed(0), higherBetter: true },
];

function getQBRadarVal(qb: QBSeasonStat, key: string): number {
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

function getWRRadarVal(rec: ReceiverSeasonStat, key: string): number {
  switch (key) {
    case "targets_game": return rec.games ? rec.targets / rec.games : NaN;
    case "epa_per_target": return rec.epa_per_target ?? NaN;
    case "croe": return rec.croe ?? NaN;
    case "air_yards_per_target": return rec.air_yards_per_target ?? NaN;
    case "yac_per_reception": return rec.yac_per_reception ?? NaN;
    case "yards_per_route_run": return rec.yards_per_route_run ?? NaN;
    default: return NaN;
  }
}

function getRBRadarVal(rb: RBSeasonStat, key: string): number {
  switch (key) {
    case "carries_game": return rb.games ? rb.carries / rb.games : NaN;
    case "epa_per_carry": return rb.epa_per_carry ?? NaN;
    case "stuff_avoid": return rb.stuff_rate != null ? 1 - rb.stuff_rate : NaN;
    case "explosive_rate": return rb.explosive_rate ?? NaN;
    case "targets_game": return rb.games ? rb.targets / rb.games : NaN;
    case "success_rate": return rb.success_rate ?? NaN;
    default: return NaN;
  }
}

function getStatVal(player: QBSeasonStat | ReceiverSeasonStat | RBSeasonStat, key: string): number {
  const v = (player as unknown as Record<string, unknown>)[key];
  return typeof v === "number" ? v : NaN;
}

export default function ComparisonTool({ qbs, receivers, rbs }: ComparisonToolProps) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const [player1, setPlayer1] = useState<SelectedPlayer | null>(null);
  const [player2, setPlayer2] = useState<SelectedPlayer | null>(null);
  const initializedRef = useRef(false);

  // Restore players from URL params on mount
  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;
    const p1Slug = searchParams.get("p1");
    const p2Slug = searchParams.get("p2");
    if (!p1Slug) return;

    const supabase = getSupabaseClient();
    const slugs = [p1Slug, p2Slug].filter(Boolean) as string[];
    supabase
      .from("player_slugs")
      .select("player_id, slug, player_name, position, current_team_id")
      .in("slug", slugs)
      .then(({ data }) => {
        if (!data) return;
        const p1Data = data.find((p) => p.slug === p1Slug);
        const p2Data = p2Slug ? data.find((p) => p.slug === p2Slug) : null;
        if (p1Data) setPlayer1(p1Data as SelectedPlayer);
        if (p2Data) setPlayer2(p2Data as SelectedPlayer);
      });
  }, [searchParams]);

  // Determine position from first player (normalize FB → RB for pool selection)
  const rawPosition = player1?.position || null;
  const position = rawPosition === "FB" ? "RB" : rawPosition;
  const isQB = position === "QB";
  const isRB = position === "RB";

  // Get the right data pool and config
  type StatPool = { pool: (QBSeasonStat | ReceiverSeasonStat | RBSeasonStat)[]; radarKeys: string[]; radarAxes: { label: string }[]; compStats: CompStat[]; getRadarVal: (p: QBSeasonStat | ReceiverSeasonStat | RBSeasonStat, k: string) => number };
  const { pool, radarKeys, radarAxes, compStats, getRadarVal } = useMemo((): StatPool => {
    if (isQB) return {
      pool: qbs,
      radarKeys: QB_KEYS, radarAxes: QB_AXES, compStats: QB_COMP_STATS,
      getRadarVal: (p, k) => getQBRadarVal(p as QBSeasonStat, k),
    };
    if (isRB) return {
      pool: rbs,
      radarKeys: RB_KEYS, radarAxes: RB_AXES, compStats: RB_COMP_STATS,
      getRadarVal: (p, k) => getRBRadarVal(p as RBSeasonStat, k),
    };
    return {
      pool: receivers,
      radarKeys: WR_KEYS, radarAxes: WR_AXES, compStats: WR_COMP_STATS,
      getRadarVal: (p, k) => getWRRadarVal(p as ReceiverSeasonStat, k),
    };
  }, [isQB, isRB, qbs, receivers, rbs]);

  // Find full stat objects for selected players
  const stats1 = useMemo(() => {
    if (!player1) return null;
    return pool.find((p) => p.player_id === player1.player_id) || null;
  }, [player1, pool]);

  const stats2 = useMemo(() => {
    if (!player2) return null;
    return pool.find((p) => p.player_id === player2.player_id) || null;
  }, [player2, pool]);

  // Compute percentiles for radar
  const { values1, values2 } = useMemo(() => {
    if (!stats1 || !stats2) return { values1: [], values2: [] };
    const sortedPools = radarKeys.map((key) =>
      pool.map((p) => getRadarVal(p, key)).filter((v) => !isNaN(v)).sort((a, b) => a - b)
    );
    return {
      values1: radarKeys.map((key, i) => computePercentile(sortedPools[i], getRadarVal(stats1, key))),
      values2: radarKeys.map((key, i) => computePercentile(sortedPools[i], getRadarVal(stats2, key))),
    };
  }, [stats1, stats2, pool, radarKeys, getRadarVal]);

  // Colors
  const color1 = player1 ? getTeamColor(player1.current_team_id) : "#1e3a5f";
  const color2 = player2 ? getTeamColor(player2.current_team_id) : "#dc2626";
  // If same team, use a contrasting color for player 2
  const finalColor2 = (player1 && player2 && player1.current_team_id === player2.current_team_id)
    ? "#dc2626" : color2;

  // Update URL
  const updateURL = useCallback((p1: SelectedPlayer | null, p2: SelectedPlayer | null) => {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("p1");
    params.delete("p2");
    if (p1) params.set("p1", p1.slug);
    if (p2) params.set("p2", p2.slug);
    const qs = params.toString();
    router.replace(pathname + (qs ? "?" + qs : ""), { scroll: false });
  }, [searchParams, router, pathname]);

  const handleSelect1 = (p: SelectedPlayer | null) => {
    setPlayer1(p);
    if (!p) setPlayer2(null); // Clear p2 if p1 cleared (position changes)
    updateURL(p, p ? player2 : null);
  };

  const handleSelect2 = (p: SelectedPlayer | null) => {
    setPlayer2(p);
    updateURL(player1, p);
  };

  const samePlayer = player1 && player2 && player1.player_id === player2.player_id;

  return (
    <div className="space-y-6">
      {/* Player selectors */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <PlayerSearchInput
          label="Player 1"
          selected={player1}
          onSelect={handleSelect1}
          excludePlayerId={player2?.player_id}
        />
        <PlayerSearchInput
          label="Player 2"
          selected={player2}
          onSelect={handleSelect2}
          positionFilter={position || undefined}
          excludePlayerId={player1?.player_id}
        />
      </div>

      {samePlayer && (
        <p className="text-center text-amber-600 text-sm font-medium">Select two different players to compare.</p>
      )}

      {/* Empty state */}
      {!player1 && !player2 && (
        <div className="text-center py-16 text-gray-400">
          <p className="text-lg font-semibold mb-2">Select two players to compare</p>
          <p className="text-sm">Choose a player on the left, then pick a same-position player on the right.</p>
        </div>
      )}

      {/* Waiting for second player */}
      {player1 && !player2 && (
        <div className="text-center py-12 text-gray-400">
          <p className="text-sm">Now select a {position} to compare against {player1.player_name}.</p>
        </div>
      )}

      {/* Comparison view */}
      {stats1 && stats2 && !samePlayer && (
        <div className="space-y-6">
          {/* Overlay Radar */}
          <div className="max-w-md mx-auto">
            <OverlayRadarChart
              values1={values1}
              values2={values2}
              color1={color1}
              color2={finalColor2}
              name1={player1!.player_name}
              name2={player2!.player_name}
              axes={radarAxes}
            />
          </div>

          {/* Stat Comparison Table */}
          <div className="border border-gray-200 rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200">
                  <th className="px-4 py-2 text-left font-semibold text-gray-600" style={{ color: color1 }}>{player1!.player_name}</th>
                  <th className="px-4 py-2 text-center font-semibold text-gray-500">Stat</th>
                  <th className="px-4 py-2 text-right font-semibold text-gray-600" style={{ color: finalColor2 }}>{player2!.player_name}</th>
                </tr>
              </thead>
              <tbody>
                {compStats.map((stat) => {
                  const v1 = getStatVal(stats1, stat.key);
                  const v2 = getStatVal(stats2, stat.key);
                  const valid1 = !isNaN(v1);
                  const valid2 = !isNaN(v2);
                  let winner: 0 | 1 | 2 = 0;
                  if (valid1 && valid2) {
                    if (stat.higherBetter) winner = v1 > v2 ? 1 : v2 > v1 ? 2 : 0;
                    else winner = v1 < v2 ? 1 : v2 < v1 ? 2 : 0;
                  }

                  return (
                    <tr key={stat.key} className="border-t border-gray-100">
                      <td className={`px-4 py-2 text-left tabular-nums ${winner === 1 ? "font-bold bg-green-50" : ""}`}>
                        {valid1 ? stat.format(v1) : "\u2014"}
                      </td>
                      <td className="px-4 py-2 text-center text-xs text-gray-500 font-medium">{stat.label}</td>
                      <td className={`px-4 py-2 text-right tabular-nums ${winner === 2 ? "font-bold bg-green-50" : ""}`}>
                        {valid2 ? stat.format(v2) : "\u2014"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
