"use client";

import { useRef, useEffect, useState, useMemo } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import Image from "next/image";
import { select } from "d3-selection";
import "d3-transition";
import type { RBGapStat } from "@/lib/types";
import { getTeam } from "@/lib/data/teams";
import PlayerGapCards from "./PlayerGapCards";

interface RunGapDiagramProps {
  data: RBGapStat[];
  teams: string[];
  selectedTeam: string | null;
  selectedGap: string | null;
  season: number;
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
  teams,
  selectedTeam,
  selectedGap,
  season,
}: RunGapDiagramProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(600);
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

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
    router.push(`${pathname}?${params.toString()}`);
  }

  // Aggregate player-level data to team-level gap stats
  const gapStats = useMemo(() => aggregateByGap(data), [data]);

  // Build gap-keyed lookup for quick access
  const gapAggregates = useMemo(() => {
    const map: Record<string, AggregatedGap> = {};
    for (const g of gapStats) map[g.gap] = g;
    return map;
  }, [gapStats]);

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

      // Carries count below gap label
      g.append("text")
        .attr("x", target.x)
        .attr("y", target.y + 4)
        .attr("text-anchor", "middle")
        .style("font-size", "9px")
        .style("fill", "#94a3b8")
        .text(`${gs.carries} att`);
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
        if (clickedGap) {
          const params = new URLSearchParams(searchParams.toString());
          params.set("gap", clickedGap);
          router.push(`${pathname}?${params.toString()}#player-drilldown`);
        }
      });

    // Cleanup for React strict mode
    return () => {
      svg.selectAll("*").remove();
    };
  }, [gapStats, selectedTeam, teamColor, containerWidth, searchParams, pathname, router]);

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

      {/* SVG diagram */}
      <div ref={containerRef} className="relative w-full bg-white border border-gray-200 rounded-lg overflow-hidden">
        {gapStats.length === 0 ? (
          <div className="text-center py-16 text-gray-400 text-sm">
            No gap data available for this team in {season}.
          </div>
        ) : (
          <svg ref={svgRef} className="w-full" style={{ maxHeight: 480 }} />
        )}
      </div>

      {/* Player drilldown anchor */}
      {selectedGap && gapStats.length > 0 && (
        <div id="player-drilldown" className="mt-6">
          <PlayerGapCards
            gap={selectedGap}
            stats={data}
            teamAvgEpa={gapAggregates[selectedGap]?.epa_per_carry ?? 0}
            leagueRank={null}
          />
        </div>
      )}
    </div>
  );
}
