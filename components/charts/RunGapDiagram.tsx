"use client";

import { useRef, useEffect, useState, useMemo } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import Image from "next/image";
import { select } from "d3-selection";
import "d3-transition";
import type { RBGapStat, RBGapStatWeekly, DefGapStat } from "@/lib/types";
import type { GapLeagueAvg, TeamGapEpa } from "@/lib/data/run-gaps";
import { getTeam } from "@/lib/data/teams";
import PlayerGapCards from "./PlayerGapCards";
import GapBarChart from "./GapBarChart";

interface RunGapDiagramProps {
  data: RBGapStat[];
  weeklyData: RBGapStatWeekly[];
  teams: string[];
  selectedTeam: string | null;
  selectedGap: string | null;
  selectedOpp: string | null;
  season: number;
  leagueAvgs: GapLeagueAvg[];
  teamGapEpas: TeamGapEpa[];
  defStats: DefGapStat[];
}

const SITUATION_OPTIONS = [
  { value: "all", label: "All Downs" },
  { value: "early", label: "Early Downs (1st-2nd)" },
  { value: "short_yardage", label: "Short Yardage (3rd/4th, \u22642 yds)" },
  { value: "passing", label: "Passing Downs (2nd/3rd long)" },
] as const;

const FIELD_ZONE_OPTIONS = [
  { value: "all", label: "All Field" },
  { value: "redzone", label: "Red Zone (inside 20)" },
  { value: "goalline", label: "Goal Line (inside 5)" },
] as const;

/** Re-aggregate weekly rows (player-level) into RBGapStat-shaped data */
function aggregateWeeklyToPlayerGap(rows: RBGapStatWeekly[]): RBGapStat[] {
  const key = (r: RBGapStatWeekly) => `${r.player_id}|${r.gap}`;
  const map = new Map<string, {
    player_id: string; player_name: string; team_id: string;
    season: number; gap: string; carries: number;
    epaSum: number; ypcSum: number; srSum: number; stuffSum: number; explSum: number;
  }>();

  for (const r of rows) {
    const k = key(r);
    const c = r.carries || 0;
    const prev = map.get(k) || {
      player_id: r.player_id, player_name: r.player_name,
      team_id: r.team_id, season: r.season, gap: r.gap,
      carries: 0, epaSum: 0, ypcSum: 0, srSum: 0, stuffSum: 0, explSum: 0,
    };
    prev.carries += c;
    if (r.epa_per_carry !== null && !isNaN(r.epa_per_carry)) prev.epaSum += r.epa_per_carry * c;
    if (r.yards_per_carry !== null && !isNaN(r.yards_per_carry)) prev.ypcSum += r.yards_per_carry * c;
    if (r.success_rate !== null && !isNaN(r.success_rate)) prev.srSum += r.success_rate * c;
    if (r.stuff_rate !== null && !isNaN(r.stuff_rate)) prev.stuffSum += r.stuff_rate * c;
    if (r.explosive_rate !== null && !isNaN(r.explosive_rate)) prev.explSum += r.explosive_rate * c;
    map.set(k, prev);
  }

  return Array.from(map.values()).map((d) => {
    const c = d.carries || 1;
    return {
      id: `${d.player_id}-${d.gap}`,
      player_id: d.player_id,
      player_name: d.player_name,
      team_id: d.team_id,
      season: d.season,
      gap: d.gap,
      carries: d.carries,
      epa_per_carry: d.epaSum / c,
      yards_per_carry: d.ypcSum / c,
      success_rate: d.srSum / c,
      stuff_rate: d.stuffSum / c,
      explosive_rate: d.explSum / c,
    };
  });
}

// Gap ordering left-to-right from offense perspective
const GAPS = ["LE", "LT", "LG", "M", "RG", "RT", "RE"] as const;

// OL positions: LT, LG, C, RG, RT
const OL_POSITIONS = [
  { label: "LT", cx: 100, cy: 100 },
  { label: "LG", cx: 200, cy: 100 },
  { label: "C",  cx: 300, cy: 100 },
  { label: "RG", cx: 400, cy: 100 },
  { label: "RT", cx: 500, cy: 100 },
];

// Gap label positions above the OL (y=50)
const GAP_TARGETS: Record<string, { x: number; y: number }> = {
  LE: { x: 40,  y: 50 },
  LT: { x: 150, y: 50 },
  LG: { x: 250, y: 50 },
  M:  { x: 300, y: 50 },
  RG: { x: 350, y: 50 },
  RT: { x: 450, y: 50 },
  RE: { x: 560, y: 50 },
};

// Arrow endpoint y-values (slightly below gap labels to connect nicely)
const ARROW_END_Y: Record<string, number> = {
  LE: 70,
  LT: 70,
  LG: 70,
  M:  70,
  RG: 70,
  RT: 70,
  RE: 70,
};

// RB position
const RB_CX = 300;
const RB_CY = 280;

interface AggregatedGap {
  gap: string;
  carries: number;
  epa_per_carry: number;
  yards_per_carry: number;
  success_rate: number;
  stuff_rate: number;
  explosive_rate: number;
}

function aggregateByGap(data: RBGapStat[]): AggregatedGap[] {
  const gapMap = new Map<string, { carries: number; epaSum: number; ypcSum: number; srSum: number; stuffSum: number; explSum: number }>();

  for (const row of data) {
    const existing = gapMap.get(row.gap) || { carries: 0, epaSum: 0, ypcSum: 0, srSum: 0, stuffSum: 0, explSum: 0 };
    const c = row.carries || 0;
    existing.carries += c;
    if (row.epa_per_carry !== null && !isNaN(row.epa_per_carry)) existing.epaSum += row.epa_per_carry * c;
    if (row.yards_per_carry !== null && !isNaN(row.yards_per_carry)) existing.ypcSum += row.yards_per_carry * c;
    if (row.success_rate !== null && !isNaN(row.success_rate)) existing.srSum += row.success_rate * c;
    if (row.stuff_rate !== null && !isNaN(row.stuff_rate)) existing.stuffSum += row.stuff_rate * c;
    if (row.explosive_rate !== null && !isNaN(row.explosive_rate)) existing.explSum += row.explosive_rate * c;
    gapMap.set(row.gap, existing);
  }

  return GAPS.filter((g) => gapMap.has(g)).map((g) => {
    const d = gapMap.get(g)!;
    const c = d.carries || 1;
    return {
      gap: g,
      carries: d.carries,
      epa_per_carry: d.epaSum / c,
      yards_per_carry: d.ypcSum / c,
      success_rate: d.srSum / c,
      stuff_rate: d.stuffSum / c,
      explosive_rate: d.explSum / c,
    };
  });
}

function epaColor(epa: number): string {
  if (epa > 0.02) return "#16a34a";
  if (epa < -0.02) return "#dc2626";
  return "#f59e0b";
}

export default function RunGapDiagram({
  data,
  weeklyData,
  teams,
  selectedTeam,
  selectedGap,
  selectedOpp,
  season,
  leagueAvgs: _leagueAvgs,
  teamGapEpas,
  defStats,
}: RunGapDiagramProps) {
  // leagueAvgs available for future use (e.g., vs-league comparison bars)
  void _leagueAvgs;
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(600);
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // Filter state from URL params
  const formParam = searchParams.get("form") || "full";
  const situationParam = searchParams.get("situation") || "all";
  const zoneParam = searchParams.get("zone") || "all";
  const isFiltered = formParam === "recent" || situationParam !== "all" || zoneParam !== "all";

  // Update a single URL param, preserving others
  function setFilterParam(key: string, value: string, defaultVal: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (value === defaultVal) {
      params.delete(key);
    } else {
      params.set(key, value);
    }
    router.push(`${pathname}?${params.toString()}`);
  }

  // Team selector navigation
  function handleTeamChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const params = new URLSearchParams(searchParams.toString());
    const val = e.target.value;
    if (val) {
      params.set("team", val);
    } else {
      params.delete("team");
    }
    params.delete("gap");
    params.delete("opp");
    // Reset filters on team change
    params.delete("form");
    params.delete("situation");
    params.delete("zone");
    router.push(`${pathname}?${params.toString()}`);
  }

  // Opponent selector navigation
  function handleOppChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const params = new URLSearchParams(searchParams.toString());
    const val = e.target.value;
    if (val) {
      params.set("opp", val);
    } else {
      params.delete("opp");
    }
    router.push(`${pathname}?${params.toString()}`);
  }

  // Filter weekly data by situation/zone, and optionally limit to last 4 weeks
  const filteredWeeklyData = useMemo(() => {
    if (!weeklyData || weeklyData.length === 0) return [];

    let filtered = weeklyData.filter(
      (r) => r.situation === situationParam && r.field_zone === zoneParam
    );

    if (formParam === "recent" && filtered.length > 0) {
      const maxWeek = Math.max(...filtered.map((r) => r.week));
      filtered = filtered.filter((r) => r.week >= maxWeek - 3);
    }

    return filtered;
  }, [weeklyData, formParam, situationParam, zoneParam]);

  // Re-aggregate weekly data to player-gap level for filtered views
  const filteredData = useMemo(() => {
    if (!isFiltered) return data;
    return aggregateWeeklyToPlayerGap(filteredWeeklyData);
  }, [isFiltered, data, filteredWeeklyData]);

  // Use filtered or full-season data for aggregation
  const activeData = isFiltered ? filteredData : data;

  // Aggregate player-level data to team-level gap stats
  const gapStats = useMemo(() => aggregateByGap(activeData), [activeData]);

  // Build gap-keyed lookup for quick access
  const gapAggregates = useMemo(() => {
    const map: Record<string, AggregatedGap> = {};
    for (const g of gapStats) map[g.gap] = g;
    return map;
  }, [gapStats]);

  // Compute per-gap league rank for selected team (1 = best EPA)
  const gapRanks = useMemo(() => {
    if (!selectedTeam || teamGapEpas.length === 0) return {} as Record<string, number>;
    const ranks: Record<string, number> = {};
    for (const gap of GAPS) {
      const allTeamsForGap = teamGapEpas
        .filter((t) => t.gap === gap)
        .sort((a, b) => b.epa_per_carry - a.epa_per_carry); // descending = rank 1 is best
      const idx = allTeamsForGap.findIndex((t) => t.team_id === selectedTeam);
      if (idx >= 0) ranks[gap] = idx + 1;
    }
    return ranks;
  }, [selectedTeam, teamGapEpas]);

  // Compute team-level rushing totals for the header
  const teamTotals = useMemo(() => {
    const totalCarries = gapStats.reduce((s, g) => s + g.carries, 0);
    const totalEpaSum = gapStats.reduce((s, g) => s + g.epa_per_carry * g.carries, 0);
    const totalYpcSum = gapStats.reduce((s, g) => s + g.yards_per_carry * g.carries, 0);
    const leftCarries = gapStats.filter((g) => g.gap.startsWith("L")).reduce((s, g) => s + g.carries, 0);
    const rightCarries = gapStats.filter((g) => g.gap.startsWith("R")).reduce((s, g) => s + g.carries, 0);
    const midCarries = gapStats.filter((g) => g.gap === "M").reduce((s, g) => s + g.carries, 0);
    return {
      carries: totalCarries,
      epa: totalCarries > 0 ? totalEpaSum / totalCarries : 0,
      ypc: totalCarries > 0 ? totalYpcSum / totalCarries : 0,
      leftPct: totalCarries > 0 ? (leftCarries / totalCarries) * 100 : 0,
      rightPct: totalCarries > 0 ? (rightCarries / totalCarries) * 100 : 0,
      midPct: totalCarries > 0 ? (midCarries / totalCarries) * 100 : 0,
    };
  }, [gapStats]);

  // Max carries across all gaps (for mobile bar chart scaling)
  const maxGapCarries = useMemo(
    () => Math.max(...gapStats.map((g) => g.carries), 1),
    [gapStats]
  );

  // Aggregate opponent's defensive gap stats (keyed by gap label)
  const oppDefGaps = useMemo(() => {
    if (!selectedOpp || !defStats || defStats.length === 0) return {} as Record<string, DefGapStat>;
    const map: Record<string, DefGapStat> = {};
    for (const row of defStats) {
      if (row.team_id === selectedOpp) map[row.gap] = row;
    }
    return map;
  }, [selectedOpp, defStats]);

  const oppTeam = selectedOpp ? getTeam(selectedOpp) : null;
  const isMatchupMode = !!selectedOpp && Object.keys(oppDefGaps).length > 0;

  // Gap click handler shared by SVG arrows and mobile bar chart
  function handleGapClick(gap: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("gap", gap);
    router.push(`${pathname}?${params.toString()}#player-drilldown`);
  }

  const team = selectedTeam ? getTeam(selectedTeam) : null;
  const teamColor = team?.primaryColor || "#1e3a5f";

  // ResizeObserver for responsive scaling
  useEffect(() => {
    if (!containerRef.current) return;
    let timer: ReturnType<typeof setTimeout>;
    const observer = new ResizeObserver((entries) => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        const { width } = entries[0].contentRect;
        setContainerWidth(Math.max(320, width));
      }, 150);
    });
    observer.observe(containerRef.current);
    return () => { clearTimeout(timer); observer.disconnect(); };
  }, []);

  // D3 SVG rendering
  useEffect(() => {
    if (!svgRef.current || !selectedTeam || gapStats.length === 0) return;

    const svg = select(svgRef.current);
    svg.selectAll("*").remove();

    const viewBoxW = 600;
    const viewBoxH = 400;
    svg.attr("viewBox", `0 0 ${viewBoxW} ${viewBoxH}`)
       .attr("preserveAspectRatio", "xMidYMid meet");

    const g = svg.append("g");

    // Background
    g.append("rect")
      .attr("width", viewBoxW)
      .attr("height", viewBoxH)
      .attr("fill", "#f8fafc")
      .attr("rx", 8);

    // Field-like subtle lines
    g.append("line")
      .attr("x1", 0).attr("x2", viewBoxW)
      .attr("y1", 100).attr("y2", 100)
      .attr("stroke", "#e2e8f0").attr("stroke-width", 1).attr("stroke-dasharray", "4 4");

    // Max carries for arrow thickness scaling
    const maxCarries = Math.max(...gapStats.map((d) => d.carries), 1);

    // Define arrowhead markers per gap (colored)
    const defs = svg.append("defs");
    for (const gs of gapStats) {
      const lowSample = gs.carries < 5;
      const color = lowSample ? "#9ca3af" : epaColor(gs.epa_per_carry);
      defs.append("marker")
        .attr("id", `arrow-${gs.gap}`)
        .attr("viewBox", "0 0 10 10")
        .attr("refX", 8)
        .attr("refY", 5)
        .attr("markerWidth", 6)
        .attr("markerHeight", 6)
        .attr("orient", "auto-start-reverse")
        .append("path")
        .attr("d", "M 0 0 L 10 5 L 0 10 z")
        .attr("fill", color);
    }

    // Draw bezier arrows from RB to each gap
    const arrowGroup = g.append("g").attr("class", "arrows");

    for (const gs of gapStats) {
      const target = GAP_TARGETS[gs.gap];
      if (!target) continue;

      const lowSample = gs.carries < 5;
      const color = lowSample ? "#9ca3af" : epaColor(gs.epa_per_carry);
      const strokeWidth = lowSample ? 2 : 2 + (gs.carries / maxCarries) * 10;
      const endY = ARROW_END_Y[gs.gap] || 70;

      // Bezier control points
      const startX = RB_CX;
      const startY = RB_CY - 22; // top of RB circle
      const endX = target.x;
      const cpY = startY - (startY - endY) * 0.6;

      const pathData = `M ${startX} ${startY} Q ${(startX + endX) / 2} ${cpY} ${endX} ${endY}`;

      const arrowPath = arrowGroup.append("path")
        .attr("d", pathData)
        .attr("fill", "none")
        .attr("stroke", color)
        .attr("stroke-width", strokeWidth)
        .attr("stroke-linecap", "round")
        .attr("opacity", 0.75)
        .attr("marker-end", `url(#arrow-${gs.gap})`)
        .attr("data-gap", gs.gap)
        .style("cursor", "pointer");

      if (lowSample) {
        arrowPath.attr("stroke-dasharray", "4 3");
        arrowPath.append("title").text(`Low sample (${gs.carries} carries)`);
      }

      // EPA label near arrow endpoint (skip for low-sample)
      if (!lowSample) {
        const labelOffsetY = endY - 14;
        arrowGroup.append("text")
          .attr("x", endX)
          .attr("y", labelOffsetY)
          .attr("text-anchor", "middle")
          .attr("fill", color)
          .style("font-size", "11px")
          .style("font-weight", "600")
          .attr("data-gap", gs.gap)
          .text(gs.epa_per_carry >= 0 ? `+${gs.epa_per_carry.toFixed(2)}` : gs.epa_per_carry.toFixed(2));
      }
    }

    // Gap labels at the top
    for (const gs of gapStats) {
      const target = GAP_TARGETS[gs.gap];
      if (!target) continue;

      g.append("text")
        .attr("x", target.x)
        .attr("y", target.y - 8)
        .attr("text-anchor", "middle")
        .style("font-size", "12px")
        .style("font-weight", "700")
        .style("fill", "#475569")
        .text(gs.gap);

      // Low sample warning icon next to gap label
      if (gs.carries < 5) {
        g.append("text")
          .attr("x", target.x + 14)
          .attr("y", target.y - 7)
          .attr("text-anchor", "start")
          .style("font-size", "10px")
          .style("fill", "#f59e0b")
          .append("tspan")
          .text("\u26A0");
      }

      // Carries count below gap label
      g.append("text")
        .attr("x", target.x)
        .attr("y", target.y + 4)
        .attr("text-anchor", "middle")
        .style("font-size", "9px")
        .style("fill", "#94a3b8")
        .text(`${gs.carries} att`);

      // Rank indicator below carries
      const rank = gapRanks[gs.gap];
      if (rank != null) {
        g.append("text")
          .attr("x", target.x)
          .attr("y", target.y + 15)
          .attr("text-anchor", "middle")
          .style("font-size", "8px")
          .style("font-weight", "600")
          .style("fill", rank <= 10 ? "#16a34a" : rank >= 23 ? "#dc2626" : "#94a3b8")
          .text(`#${rank}`);
      }

      // Defensive matchup indicator (only in matchup mode)
      const defGap = oppDefGaps[gs.gap];
      if (defGap && defGap.def_epa_per_carry !== null && !isNaN(defGap.def_epa_per_carry)) {
        const defEpa = defGap.def_epa_per_carry;
        const defColor = epaColor(defEpa); // green = offense-friendly (def allows high EPA)
        const offEpa = gs.epa_per_carry;
        const isMismatch = offEpa > 0 && defEpa > 0;
        const baseY = rank != null ? target.y + 26 : target.y + 15;

        // Small defensive EPA label
        g.append("text")
          .attr("x", target.x)
          .attr("y", baseY)
          .attr("text-anchor", "middle")
          .style("font-size", "8px")
          .style("font-weight", "500")
          .style("fill", defColor)
          .style("opacity", 0.85)
          .text(`DEF ${defEpa >= 0 ? "+" : ""}${defEpa.toFixed(2)}`);

        // Exploitable mismatch highlight
        if (isMismatch) {
          g.append("rect")
            .attr("x", target.x - 16)
            .attr("y", baseY - 8)
            .attr("width", 32)
            .attr("height", 11)
            .attr("rx", 3)
            .attr("fill", "#16a34a")
            .attr("opacity", 0.12);
        }
      }
    }

    // Draw OL circles
    for (const pos of OL_POSITIONS) {
      g.append("circle")
        .attr("cx", pos.cx)
        .attr("cy", pos.cy)
        .attr("r", 24)
        .attr("fill", "#1e3a5f")
        .attr("stroke", "#0f172a")
        .attr("stroke-width", 2);

      g.append("text")
        .attr("x", pos.cx)
        .attr("y", pos.cy + 5)
        .attr("text-anchor", "middle")
        .style("font-size", "12px")
        .style("font-weight", "700")
        .style("fill", "white")
        .text(pos.label);
    }

    // Draw RB circle
    g.append("circle")
      .attr("cx", RB_CX)
      .attr("cy", RB_CY)
      .attr("r", 22)
      .attr("fill", teamColor)
      .attr("stroke", "#0f172a")
      .attr("stroke-width", 2);

    g.append("text")
      .attr("x", RB_CX)
      .attr("y", RB_CY + 5)
      .attr("text-anchor", "middle")
      .style("font-size", "12px")
      .style("font-weight", "700")
      .style("fill", "white")
      .text("RB");

    // Legend
    const legendY = 340;
    const legendItems = [
      { color: "#16a34a", label: "EPA > +0.02" },
      { color: "#f59e0b", label: "Neutral" },
      { color: "#dc2626", label: "EPA < -0.02" },
    ];
    const legendStartX = viewBoxW / 2 - 120;
    legendItems.forEach((item, i) => {
      const lx = legendStartX + i * 90;
      g.append("rect")
        .attr("x", lx)
        .attr("y", legendY)
        .attr("width", 12)
        .attr("height", 4)
        .attr("rx", 2)
        .attr("fill", item.color);
      g.append("text")
        .attr("x", lx + 16)
        .attr("y", legendY + 5)
        .style("font-size", "9px")
        .style("fill", "#64748b")
        .text(item.label);
    });

    // Low sample legend
    g.append("line")
      .attr("x1", legendStartX)
      .attr("y1", legendY + 20)
      .attr("x2", legendStartX + 20)
      .attr("y2", legendY + 20)
      .attr("stroke", "#9ca3af")
      .attr("stroke-width", 2)
      .attr("stroke-dasharray", "4 3");
    g.append("text")
      .attr("x", legendStartX + 26)
      .attr("y", legendY + 23)
      .style("font-size", "9px")
      .style("fill", "#94a3b8")
      .text("< 5 carries (low sample)");

    // Watermark
    g.append("text")
      .attr("x", viewBoxW - 8)
      .attr("y", viewBoxH - 8)
      .attr("text-anchor", "end")
      .style("font-size", "10px")
      .style("fill", "#d1d5db")
      .style("font-weight", "500")
      .text("yardsperpass.com");

    // Hover/focus interaction: dim non-hovered arrows
    arrowGroup.selectAll<SVGPathElement, unknown>("path[data-gap]")
      .on("mouseenter", function () {
        const hoveredGap = select(this).attr("data-gap");
        arrowGroup.selectAll<SVGElement, unknown>("[data-gap]")
          .transition().duration(150)
          .attr("opacity", function () {
            return select(this).attr("data-gap") === hoveredGap ? 0.75 : 0.15;
          });
      })
      .on("mouseleave", function () {
        arrowGroup.selectAll<SVGElement, unknown>("[data-gap]")
          .transition().duration(150)
          .attr("opacity", 0.75);
      })
      .on("click", function () {
        const clickedGap = select(this).attr("data-gap");
        if (clickedGap) handleGapClick(clickedGap);
      });

    // Cleanup for React strict mode
    return () => {
      svg.selectAll("*").remove();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gapStats, selectedTeam, teamColor, containerWidth, searchParams, pathname, router, gapRanks, oppDefGaps]);

  // No team selected — show prompt
  if (!selectedTeam) {
    return (
      <div>
        <div className="mb-6">
          <label htmlFor="team-select" className="block text-sm font-medium text-gray-700 mb-1">
            Select a team
          </label>
          <select
            id="team-select"
            value=""
            onChange={handleTeamChange}
            className="px-3 py-2 text-sm border border-gray-200 rounded-md bg-white text-navy font-medium focus:outline-none focus:ring-2 focus:ring-navy/20"
          >
            <option value="">Choose a team...</option>
            {teams.map((t) => {
              const tm = getTeam(t);
              return (
                <option key={t} value={t}>
                  {tm?.name || t}
                </option>
              );
            })}
          </select>
        </div>
        <div className="bg-gray-50 border border-gray-200 rounded-lg p-16 text-center">
          <div className="flex justify-center gap-6 mb-6">
            {OL_POSITIONS.map((pos) => (
              <div key={pos.label} className="w-12 h-12 rounded-full bg-gray-300 flex items-center justify-center text-xs font-bold text-white">
                {pos.label}
              </div>
            ))}
          </div>
          <div className="w-11 h-11 rounded-full bg-gray-300 mx-auto mb-6 flex items-center justify-center text-xs font-bold text-white">
            RB
          </div>
          <p className="text-gray-400 text-sm">Select a team to view run gap analysis</p>
        </div>
      </div>
    );
  }

  return (
    <div>
      {/* Team selector */}
      <div className="mb-6 flex flex-col sm:flex-row sm:items-end gap-4">
        <div>
          <label htmlFor="team-select" className="block text-sm font-medium text-gray-700 mb-1">
            Team
          </label>
          <select
            id="team-select"
            value={selectedTeam}
            onChange={handleTeamChange}
            className="px-3 py-2 text-sm border border-gray-200 rounded-md bg-white text-navy font-medium focus:outline-none focus:ring-2 focus:ring-navy/20"
          >
            <option value="">Choose a team...</option>
            {teams.map((t) => {
              const tm = getTeam(t);
              return (
                <option key={t} value={t}>
                  {tm?.name || t}
                </option>
              );
            })}
          </select>
        </div>
        {selectedTeam && (
          <div>
            <label htmlFor="opp-select" className="block text-sm font-medium text-gray-700 mb-1">
              vs. Opponent Defense
            </label>
            <select
              id="opp-select"
              value={selectedOpp || ""}
              onChange={handleOppChange}
              className="px-3 py-2 text-sm border border-gray-200 rounded-md bg-white text-navy font-medium focus:outline-none focus:ring-2 focus:ring-navy/20"
            >
              <option value="">No matchup</option>
              {teams.filter((t) => t !== selectedTeam).map((t) => {
                const tm = getTeam(t);
                return (
                  <option key={t} value={t}>
                    {tm?.name || t}
                  </option>
                );
              })}
            </select>
          </div>
        )}
      </div>

      {/* Split header: team info left, rushing stats right */}
      {team && (
        <div className="bg-white border border-gray-200 rounded-lg p-4 mb-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="flex items-center gap-3">
            <Image
              src={team.logo}
              alt={team.name}
              width={40}
              height={40}
              className="rounded-full"
              unoptimized
            />
            <div>
              <h2 className="text-lg font-bold text-navy">{team.name}</h2>
              <p className="text-xs text-gray-400">{season} Rushing by Gap</p>
            </div>
          </div>
          <div className="flex flex-wrap gap-4 text-sm">
            <div className="text-center">
              <div className="text-xs text-gray-400">Rush EPA</div>
              <div className={`font-bold ${teamTotals.epa >= 0 ? "text-green-600" : "text-red-600"}`}>
                {teamTotals.epa >= 0 ? "+" : ""}{teamTotals.epa.toFixed(3)}
              </div>
            </div>
            <div className="text-center">
              <div className="text-xs text-gray-400">YPC</div>
              <div className="font-bold text-navy">{teamTotals.ypc.toFixed(1)}</div>
            </div>
            <div className="text-center">
              <div className="text-xs text-gray-400">Carries</div>
              <div className="font-bold text-navy">{teamTotals.carries}</div>
            </div>
            <div className="text-center">
              <div className="text-xs text-gray-400">L / M / R</div>
              <div className="font-bold text-navy text-xs">
                {teamTotals.leftPct.toFixed(0)}% / {teamTotals.midPct.toFixed(0)}% / {teamTotals.rightPct.toFixed(0)}%
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Filter controls */}
      {selectedTeam && (
        <div className="mb-4 flex flex-wrap items-center gap-3">
          {/* Full Season / Last 4 Weeks toggle */}
          <div className="inline-flex rounded-md border border-gray-200 overflow-hidden">
            <button
              onClick={() => setFilterParam("form", "full", "full")}
              className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                formParam === "full"
                  ? "bg-navy text-white"
                  : "bg-white text-gray-600 hover:bg-gray-50"
              }`}
            >
              Full Season
            </button>
            <button
              onClick={() => setFilterParam("form", "recent", "full")}
              className={`px-3 py-1.5 text-xs font-medium border-l border-gray-200 transition-colors ${
                formParam === "recent"
                  ? "bg-navy text-white"
                  : "bg-white text-gray-600 hover:bg-gray-50"
              }`}
            >
              Last 4 Weeks
            </button>
          </div>

          {/* Down/Distance dropdown */}
          <select
            value={situationParam}
            onChange={(e) => setFilterParam("situation", e.target.value, "all")}
            className="px-3 py-1.5 text-xs border border-gray-200 rounded-md bg-white text-navy font-medium focus:outline-none focus:ring-2 focus:ring-navy/20"
          >
            {SITUATION_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>

          {/* Field Zone dropdown */}
          <select
            value={zoneParam}
            onChange={(e) => setFilterParam("zone", e.target.value, "all")}
            className="px-3 py-1.5 text-xs border border-gray-200 rounded-md bg-white text-navy font-medium focus:outline-none focus:ring-2 focus:ring-navy/20"
          >
            {FIELD_ZONE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>

          {/* Active filter indicator */}
          {isFiltered && (
            <span className="text-xs text-amber-600 font-medium">
              Filtered view
              {filteredData.length === 0 && " — no data for this combination"}
            </span>
          )}
        </div>
      )}

      {/* SVG diagram (desktop) */}
      <div ref={containerRef} className="hidden md:block relative w-full bg-white border border-gray-200 rounded-lg overflow-hidden">
        {gapStats.length === 0 ? (
          <div className="text-center py-16 text-gray-400 text-sm">
            No gap data available for this team in {season}.
          </div>
        ) : (
          <svg ref={svgRef} className="w-full" style={{ maxHeight: 480 }} />
        )}
      </div>

      {/* Bar chart (mobile) */}
      <div className="md:hidden bg-white border border-gray-200 rounded-lg p-4">
        {gapStats.length === 0 ? (
          <div className="text-center py-16 text-gray-400 text-sm">
            No gap data available for this team in {season}.
          </div>
        ) : (
          <GapBarChart
            gaps={gapStats}
            maxCarries={maxGapCarries}
            onGapClick={handleGapClick}
            selectedGap={selectedGap}
          />
        )}
      </div>

      {/* Matchup summary bar */}
      {isMatchupMode && gapStats.length > 0 && (
        <div className="mt-4 bg-white border border-gray-200 rounded-lg p-4">
          <div className="flex items-center gap-2 mb-3">
            <h3 className="text-sm font-bold text-navy">
              Matchup: {team?.name} Offense vs. {oppTeam?.name} Defense
            </h3>
          </div>
          <div className="grid grid-cols-7 gap-1 text-center">
            {GAPS.map((gap) => {
              const off = gapAggregates[gap];
              const def = oppDefGaps[gap];
              const offEpa = off?.epa_per_carry ?? 0;
              const defEpa = def?.def_epa_per_carry ?? null;
              const isMismatch = offEpa > 0 && defEpa !== null && !isNaN(defEpa) && defEpa > 0;
              return (
                <button
                  key={gap}
                  onClick={() => handleGapClick(gap)}
                  className={`rounded-md p-2 transition-colors ${
                    isMismatch
                      ? "bg-green-50 border border-green-200 hover:bg-green-100"
                      : "bg-gray-50 border border-gray-100 hover:bg-gray-100"
                  }`}
                >
                  <div className="text-xs font-bold text-gray-500 mb-1">{gap}</div>
                  <div className={`text-xs font-semibold ${offEpa >= 0 ? "text-green-600" : "text-red-600"}`}>
                    OFF {offEpa >= 0 ? "+" : ""}{offEpa.toFixed(2)}
                  </div>
                  {defEpa !== null && !isNaN(defEpa) ? (
                    <div className={`text-xs font-medium mt-0.5 ${defEpa >= 0 ? "text-green-500" : "text-red-500"}`}>
                      DEF {defEpa >= 0 ? "+" : ""}{defEpa.toFixed(2)}
                    </div>
                  ) : (
                    <div className="text-xs text-gray-300 mt-0.5">--</div>
                  )}
                  {isMismatch && (
                    <div className="text-[10px] text-green-600 font-bold mt-0.5">EXPLOIT</div>
                  )}
                </button>
              );
            })}
          </div>
          <p className="mt-2 text-[10px] text-gray-400">
            Green highlight = offense runs well here AND defense allows positive EPA (exploitable mismatch)
          </p>
        </div>
      )}

      {/* Player drilldown anchor */}
      {selectedGap && gapStats.length > 0 && (
        <div id="player-drilldown" className="mt-6">
          <PlayerGapCards
            gap={selectedGap}
            stats={activeData}
            teamAvgEpa={gapAggregates[selectedGap]?.epa_per_carry ?? 0}
            leagueRank={gapRanks[selectedGap] ?? null}
          />
        </div>
      )}

      {/* Data disclaimer */}
      <p className="mt-8 text-xs text-gray-400 border-t border-gray-100 pt-4">
        Gap data reflects ball carrier destination, not designed play direction.
        Source: <a href="https://github.com/nflverse" target="_blank" rel="noopener noreferrer" className="underline hover:text-navy">nflverse</a> play-by-play (~85-90% of rush plays have gap data). Stats may differ from PFF/TruMedia due to methodology differences.
      </p>
    </div>
  );
}
