// components/charts/TeamScatterPlot.tsx
"use client";

import { useRef, useEffect, useState } from "react";
import * as d3 from "d3";
import type { TeamSeasonStat } from "@/lib/types";
import { getTeam, getTeamColor } from "@/lib/data/teams";

interface TeamScatterPlotProps {
  data: TeamSeasonStat[];
}

// Quadrant config
const QUADRANTS = [
  { key: "contenders", label: "Contenders", desc: "Elite on both sides of the ball", color: "rgba(34,197,94,0.06)" },
  { key: "defense", label: "Defense Carries", desc: "Strong defense, offense needs work", color: "rgba(234,179,8,0.06)" },
  { key: "offense_first", label: "Offense First", desc: "High-powered offense, defense needs work", color: "rgba(234,179,8,0.06)" },
  { key: "bottom", label: "Bottom Feeders", desc: "Struggling on both sides", color: "rgba(239,68,68,0.06)" },
];

export default function TeamScatterPlot({ data }: TeamScatterPlotProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ width: 800, height: 560 });

  // ResizeObserver for responsive width
  useEffect(() => {
    if (!containerRef.current) return;
    const observer = new ResizeObserver((entries) => {
      const { width } = entries[0].contentRect;
      setDimensions({ width: Math.max(400, width), height: 560 });
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  // D3 rendering
  useEffect(() => {
    if (!svgRef.current || !data.length) return;

    const svg = d3.select(svgRef.current);
    // CRITICAL: cleanup for React strict mode
    svg.selectAll("*").remove();

    const margin = { top: 50, right: 50, bottom: 60, left: 65 };
    const width = dimensions.width - margin.left - margin.right;
    const height = dimensions.height - margin.top - margin.bottom;

    const g = svg
      .attr("width", dimensions.width)
      .attr("height", dimensions.height)
      .append("g")
      .attr("transform", `translate(${margin.left},${margin.top})`);

    // Symmetric scale around 0
    const xVals = data.map((d) => d.off_epa_play);
    const yVals = data.map((d) => d.def_epa_play);
    const maxAbsX = Math.max(...xVals.map(Math.abs)) * 1.2;
    const maxAbsY = Math.max(...yVals.map(Math.abs)) * 1.2;

    const x = d3.scaleLinear().domain([-maxAbsX, maxAbsX]).range([0, width]);
    // Defense: more negative EPA = better defense = TOP of chart
    // CRITICAL: domain is [positive, negative] so negative values map to y=0 (top)
    const y = d3.scaleLinear().domain([maxAbsY, -maxAbsY]).range([height, 0]);

    // Quadrant backgrounds
    // Top-right: good offense (x>0) + good defense (def_epa<0, mapped to top)
    g.append("rect").attr("x", x(0)).attr("y", 0).attr("width", width - x(0)).attr("height", y(0))
      .attr("fill", QUADRANTS[0].color); // Contenders
    g.append("rect").attr("x", 0).attr("y", 0).attr("width", x(0)).attr("height", y(0))
      .attr("fill", QUADRANTS[1].color); // Defense Carries
    g.append("rect").attr("x", x(0)).attr("y", y(0)).attr("width", width - x(0)).attr("height", height - y(0))
      .attr("fill", QUADRANTS[2].color); // Offense First
    g.append("rect").attr("x", 0).attr("y", y(0)).attr("width", x(0)).attr("height", height - y(0))
      .attr("fill", QUADRANTS[3].color); // Bottom Feeders

    // Crosshair lines at 0,0
    g.append("line").attr("x1", 0).attr("x2", width).attr("y1", y(0)).attr("y2", y(0))
      .attr("stroke", "#CBD5E1").attr("stroke-width", 1).attr("stroke-dasharray", "6,4");
    g.append("line").attr("x1", x(0)).attr("x2", x(0)).attr("y1", 0).attr("y2", height)
      .attr("stroke", "#CBD5E1").attr("stroke-width", 1).attr("stroke-dasharray", "6,4");

    // Quadrant labels
    const labelStyle = { fontSize: "11px", fontWeight: "700", fill: "#94A3B8" };
    const descStyle = { fontSize: "9px", fontWeight: "400", fill: "#94A3B8" };

    g.append("text").attr("x", x(maxAbsX * 0.55)).attr("y", 20).attr("text-anchor", "middle")
      .style("font-size", labelStyle.fontSize).style("font-weight", labelStyle.fontWeight).style("fill", labelStyle.fill)
      .text("Contenders");
    g.append("text").attr("x", x(maxAbsX * 0.55)).attr("y", 33).attr("text-anchor", "middle")
      .style("font-size", descStyle.fontSize).style("fill", descStyle.fill)
      .text("Elite on both sides of the ball");

    g.append("text").attr("x", x(-maxAbsX * 0.55)).attr("y", 20).attr("text-anchor", "middle")
      .style("font-size", labelStyle.fontSize).style("font-weight", labelStyle.fontWeight).style("fill", labelStyle.fill)
      .text("Defense Carries");
    g.append("text").attr("x", x(-maxAbsX * 0.55)).attr("y", 33).attr("text-anchor", "middle")
      .style("font-size", descStyle.fontSize).style("fill", descStyle.fill)
      .text("Strong defense, offense needs work");

    g.append("text").attr("x", x(maxAbsX * 0.55)).attr("y", height - 15).attr("text-anchor", "middle")
      .style("font-size", labelStyle.fontSize).style("font-weight", labelStyle.fontWeight).style("fill", labelStyle.fill)
      .text("Offense First");
    g.append("text").attr("x", x(maxAbsX * 0.55)).attr("y", height - 3).attr("text-anchor", "middle")
      .style("font-size", descStyle.fontSize).style("fill", descStyle.fill)
      .text("High-powered offense, defense needs work");

    g.append("text").attr("x", x(-maxAbsX * 0.55)).attr("y", height - 15).attr("text-anchor", "middle")
      .style("font-size", labelStyle.fontSize).style("font-weight", labelStyle.fontWeight).style("fill", labelStyle.fill)
      .text("Bottom Feeders");
    g.append("text").attr("x", x(-maxAbsX * 0.55)).attr("y", height - 3).attr("text-anchor", "middle")
      .style("font-size", descStyle.fontSize).style("fill", descStyle.fill)
      .text("Struggling on both sides");

    // Axes
    const xAxis = d3.axisBottom(x).ticks(8).tickFormat((d) => d3.format("+.2f")(d as number));
    const yAxis = d3.axisLeft(y).ticks(8).tickFormat((d) => d3.format("+.2f")(d as number));

    g.append("g").attr("transform", `translate(0,${height})`).call(xAxis)
      .selectAll("text").style("font-size", "10px").style("fill", "#6B7280");
    g.append("g").call(yAxis)
      .selectAll("text").style("font-size", "10px").style("fill", "#6B7280");

    // Axis labels
    g.append("text").attr("x", width / 2).attr("y", height + 45).attr("text-anchor", "middle")
      .style("font-size", "12px").style("font-weight", "600").style("fill", "#374151")
      .text("Offensive EPA/Play \u2192");
    g.append("text").attr("transform", "rotate(-90)").attr("x", -height / 2).attr("y", -50)
      .attr("text-anchor", "middle")
      .style("font-size", "12px").style("font-weight", "600").style("fill", "#374151")
      .text("\u2190 Better Defense (Def EPA/Play)");

    // Y-axis annotation explaining inverted defense axis
    g.append("text").attr("x", 5).attr("y", -8)
      .style("font-size", "9px").style("fill", "#94A3B8").style("font-style", "italic")
      .text("Note: Negative defensive EPA = better defense (axis inverted)");

    // Pre-compute ranks for hover tooltip
    const ordinal = (n: number) => {
      const s = ["th", "st", "nd", "rd"];
      const v = n % 100;
      return n + (s[(v - 20) % 10] || s[v] || s[0]);
    };
    const offRanks = new Map(
      [...data].sort((a, b) => b.off_epa_play - a.off_epa_play).map((d, i) => [d.team_id, i + 1])
    );
    const defRanks = new Map(
      [...data].sort((a, b) => a.def_epa_play - b.def_epa_play).map((d, i) => [d.team_id, i + 1])
    );

    // Tooltip div
    const tooltip = d3.select(tooltipRef.current);

    // Team logos
    const logoSize = 32;
    const logoGroup = g.selectAll(".team-logo")
      .data(data)
      .enter()
      .append("g")
      .attr("class", "team-logo")
      .attr("transform", (d) => `translate(${x(d.off_epa_play) - logoSize / 2},${y(d.def_epa_play) - logoSize / 2})`)
      .style("cursor", "pointer");

    // Add logo images with fallback
    logoGroup.each(function (d) {
      const group = d3.select(this);
      const team = getTeam(d.team_id);
      if (!team) return;

      const img = group.append("image")
        .attr("width", logoSize)
        .attr("height", logoSize)
        .attr("href", team.logo)
        .attr("clip-path", "circle(16px at 16px 16px)");

      // Fallback: colored circle with abbreviation
      img.on("error", function () {
        d3.select(this).remove();
        group.append("circle")
          .attr("cx", logoSize / 2).attr("cy", logoSize / 2).attr("r", 14)
          .attr("fill", getTeamColor(d.team_id));
        group.append("text")
          .attr("x", logoSize / 2).attr("y", logoSize / 2 + 4)
          .attr("text-anchor", "middle").attr("fill", "white")
          .style("font-size", "9px").style("font-weight", "700")
          .text(d.team_id);
      });
    });

    // Hover behavior
    logoGroup
      .on("mouseenter", function (event, d) {
        d3.select(this).raise().transition().duration(150)
          .attr("transform", `translate(${x(d.off_epa_play) - logoSize * 0.7},${y(d.def_epa_play) - logoSize * 0.7}) scale(1.4)`);
        const team = getTeam(d.team_id);
        tooltip
          .style("opacity", "1")
          .style("left", `${event.clientX + 12}px`)
          .style("top", `${event.clientY - 28}px`)
          .html(`
            <div class="font-semibold text-navy">${team?.name ?? d.team_id}</div>
            <div class="text-xs text-gray-500 mt-1">
              Off EPA: ${d.off_epa_play.toFixed(3)} (${ordinal(offRanks.get(d.team_id) ?? 0)})<br/>
              Def EPA: ${d.def_epa_play.toFixed(3)} (${ordinal(defRanks.get(d.team_id) ?? 0)})<br/>
              Record: ${d.wins}-${d.losses}${d.ties > 0 ? `-${d.ties}` : ""}
            </div>
          `);
      })
      .on("mouseleave", function (_, d) {
        d3.select(this).transition().duration(150)
          .attr("transform", `translate(${x(d.off_epa_play) - logoSize / 2},${y(d.def_epa_play) - logoSize / 2}) scale(1)`);
        tooltip.style("opacity", "0");
      });

    // Watermark
    g.append("text")
      .attr("x", width - 5).attr("y", height - 5)
      .attr("text-anchor", "end")
      .style("font-size", "11px").style("fill", "#D1D5DB").style("font-weight", "500")
      .text("yardsperpass.com");

    // Cleanup function — CRITICAL for React strict mode
    return () => {
      svg.selectAll("*").remove();
    };
  }, [data, dimensions]);

  return (
    <div ref={containerRef} className="relative w-full bg-white border border-gray-200 rounded-md">
      <svg ref={svgRef} className="w-full" />
      <div
        ref={tooltipRef}
        className="fixed z-50 bg-white px-3 py-2 rounded-md shadow-lg border border-gray-200 pointer-events-none opacity-0 transition-opacity"
        style={{ maxWidth: 220 }}
      />
    </div>
  );
}
