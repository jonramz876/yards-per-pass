// components/charts/TeamScatterPlot.tsx
"use client";

import { useRef, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { select } from "d3-selection";
import { scaleLinear } from "d3-scale";
import { axisBottom, axisLeft } from "d3-axis";
import { format as d3Format } from "d3-format";
import "d3-transition"; // Side-effect import: patches selection.transition()
import type { TeamSeasonStat } from "@/lib/types";
import { getTeam, getTeamColor } from "@/lib/data/teams";

interface TeamScatterPlotProps {
  data: TeamSeasonStat[];
}

// Quadrant config
const QUADRANTS = [
  { key: "contenders", label: "Contenders", desc: "Elite on both sides of the ball", color: "rgba(34,197,94,0.06)", swatch: "rgba(34,197,94,0.4)" },
  { key: "defense", label: "Defense Carries", desc: "Strong defense, offense needs work", color: "rgba(59,130,246,0.06)", swatch: "rgba(59,130,246,0.4)" },
  { key: "offense_first", label: "Offense First", desc: "High-powered offense, defense needs work", color: "rgba(249,115,22,0.06)", swatch: "rgba(249,115,22,0.4)" },
  { key: "bottom", label: "Bottom Feeders", desc: "Struggling on both sides", color: "rgba(239,68,68,0.06)", swatch: "rgba(239,68,68,0.4)" },
];

export default function TeamScatterPlot({ data }: TeamScatterPlotProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ width: 800, height: 560 });
  const router = useRouter();
  const searchParams = useSearchParams();

  // ResizeObserver for responsive width (debounced to prevent thrashing)
  useEffect(() => {
    if (!containerRef.current) return;
    let timer: ReturnType<typeof setTimeout>;
    const observer = new ResizeObserver((entries) => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        const { width } = entries[0].contentRect;
        setDimensions({ width: Math.max(400, width), height: 560 });
      }, 150);
    });
    observer.observe(containerRef.current);
    return () => { clearTimeout(timer); observer.disconnect(); };
  }, []);

  // D3 rendering
  useEffect(() => {
    if (!svgRef.current || !data.length) return;

    const svg = select(svgRef.current);
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

    const x = scaleLinear().domain([-maxAbsX, maxAbsX]).range([0, width]);
    // Defense: more negative EPA = better defense = TOP of chart
    // CRITICAL: domain is [positive, negative] so negative values map to y=0 (top)
    const y = scaleLinear().domain([maxAbsY, -maxAbsY]).range([height, 0]);

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
    const xAxis = axisBottom(x).ticks(8).tickFormat((d) => d3Format("+.2f")(d as number));
    const yAxis = axisLeft(y).ticks(8).tickFormat((d) => d3Format("+.2f")(d as number));

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
      .style("font-size", "11px").style("fill", "#64748B").style("font-style", "italic")
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
    const tooltip = select(tooltipRef.current);

    // Team logos
    const logoSize = 32;

    // SVG-native clipPath for Safari compatibility (CSS clip-path fails on SVG <image> in WebKit)
    const defs = svg.append("defs");
    defs.append("clipPath")
      .attr("id", "logo-circle-clip")
      .append("circle")
      .attr("cx", logoSize / 2)
      .attr("cy", logoSize / 2)
      .attr("r", logoSize / 2);

    const logoGroup = g.selectAll(".team-logo")
      .data(data)
      .enter()
      .append("g")
      .attr("class", "team-logo")
      .attr("transform", (d) => `translate(${x(d.off_epa_play) - logoSize / 2},${y(d.def_epa_play) - logoSize / 2})`)
      .style("cursor", "pointer");

    // Add logo images with fallback
    logoGroup.each(function (d) {
      const group = select(this);
      const team = getTeam(d.team_id);
      if (!team) return;

      const img = group.append("image")
        .attr("width", logoSize)
        .attr("height", logoSize)
        .attr("href", team.logo)
        .attr("clip-path", "url(#logo-circle-clip)");

      // Fallback: colored circle with abbreviation
      img.on("error", function () {
        select(this).remove();
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

    // Shared tooltip show/hide functions for mouse + touch
    let activeTeam: string | null = null;

    function showTooltip(event: MouseEvent | TouchEvent, d: TeamSeasonStat) {
      const el = select(event.currentTarget as Element);
      el.raise().transition().duration(150)
        .attr("transform", `translate(${x(d.off_epa_play) - logoSize * 0.7},${y(d.def_epa_play) - logoSize * 0.7}) scale(1.4)`);
      const team = getTeam(d.team_id);
      const tooltipEl = tooltipRef.current;
      if (tooltipEl) {
        tooltipEl.textContent = "";
        const nameDiv = document.createElement("div");
        nameDiv.className = "font-semibold text-navy";
        nameDiv.textContent = team?.name ?? d.team_id;
        const statsDiv = document.createElement("div");
        statsDiv.className = "text-xs text-gray-500 mt-1";
        statsDiv.textContent =
          `Off EPA: ${d.off_epa_play.toFixed(3)} (${ordinal(offRanks.get(d.team_id) ?? 0)}) | ` +
          `Def EPA: ${d.def_epa_play.toFixed(3)} (${ordinal(defRanks.get(d.team_id) ?? 0)}) | ` +
          `Record: ${d.wins}-${d.losses}${d.ties > 0 ? `-${d.ties}` : ""}`;
        const detailDiv = document.createElement("div");
        detailDiv.className = "text-xs text-gray-400 mt-0.5";
        const fmtPct = (v: number) => isNaN(v) ? "\u2014" : (v * 100).toFixed(1) + "%";
        const fmtEpa = (v: number) => isNaN(v) ? "\u2014" : v.toFixed(3);
        detailDiv.textContent =
          `Pass EPA: ${fmtEpa(d.off_pass_epa)} | Rush EPA: ${fmtEpa(d.off_rush_epa)} | ` +
          `Pass Rate: ${fmtPct(d.pass_rate)} | Success: ${fmtPct(d.off_success_rate)} (incl. sacks)`;
        const defDiv = document.createElement("div");
        defDiv.className = "text-xs text-gray-400 mt-0.5";
        defDiv.textContent =
          `Def Pass EPA: ${fmtEpa(d.def_pass_epa)} | Def Rush EPA: ${fmtEpa(d.def_rush_epa)} | ` +
          `Def Success: ${fmtPct(d.def_success_rate)}`;
        tooltipEl.appendChild(nameDiv);
        tooltipEl.appendChild(statsDiv);
        tooltipEl.appendChild(detailDiv);
        tooltipEl.appendChild(defDiv);
        const linkDiv = document.createElement("div");
        linkDiv.style.marginTop = "8px";
        linkDiv.style.paddingTop = "6px";
        linkDiv.style.borderTop = "1px solid #e2e8f0";
        linkDiv.style.display = "flex";
        linkDiv.style.justifyContent = "center";
        linkDiv.style.gap = "12px";
        const teamHubSpan = document.createElement("span");
        teamHubSpan.textContent = "Team Hub →";
        teamHubSpan.style.color = "#1e3a5f";
        teamHubSpan.style.fontSize = "12px";
        teamHubSpan.style.fontWeight = "600";
        teamHubSpan.style.cursor = "pointer";
        teamHubSpan.addEventListener("click", (e) => {
          e.stopPropagation();
          router.push(`/team/${d.team_id}`);
        });
        linkDiv.appendChild(teamHubSpan);
        const linkSpan = document.createElement("span");
        linkSpan.textContent = "Run Gaps →";
        linkSpan.style.color = "#1e3a5f";
        linkSpan.style.fontSize = "12px";
        linkSpan.style.fontWeight = "600";
        linkSpan.style.cursor = "pointer";
        linkSpan.addEventListener("click", (e) => {
          e.stopPropagation();
          const season = searchParams.get("season") || "";
          const url = `/run-gaps?team=${d.team_id}${season ? `&season=${season}` : ""}`;
          router.push(url);
        });
        linkDiv.appendChild(linkSpan);
        tooltipEl.appendChild(linkDiv);
      }
      // Use clientX/Y for mouse, touches[0] for touch
      const clientX = "touches" in event ? event.touches[0]?.clientX ?? 0 : event.clientX;
      const clientY = "touches" in event ? event.touches[0]?.clientY ?? 0 : event.clientY;
      // Position tooltip, flipping if it would overflow viewport
      const tipEl = tooltipRef.current;
      const tw = tipEl?.offsetWidth ?? 300;
      const th = tipEl?.offsetHeight ?? 80;
      const pad = 12;
      const left = Math.max(pad, clientX + pad + tw > window.innerWidth ? clientX - tw - pad : clientX + pad);
      const top = clientY + pad + th > window.innerHeight ? clientY - th - pad : clientY + pad;
      tooltip
        .style("opacity", "1")
        .style("left", `${left}px`)
        .style("top", `${top}px`);
      activeTeam = d.team_id;
    }

    function hideTooltip(d: TeamSeasonStat) {
      const logoEl = logoGroup.filter((dd) => dd.team_id === d.team_id);
      logoEl.transition().duration(150)
        .attr("transform", `translate(${x(d.off_epa_play) - logoSize / 2},${y(d.def_epa_play) - logoSize / 2}) scale(1)`);
      tooltip.style("opacity", "0");
      activeTeam = null;
    }

    // Mouse hover behavior + click to navigate to team hub
    logoGroup
      .on("mouseenter", function (event, d) { showTooltip(event, d); })
      .on("mouseleave", function (_, d) { hideTooltip(d); })
      .on("click", function (_, d) { router.push(`/team/${d.team_id}`); });

    // Touch behavior: tap to show, tap again or tap elsewhere to dismiss
    logoGroup
      .on("touchstart", function (event, d) {
        event.preventDefault(); // Prevent mouse event emulation
        if (activeTeam === d.team_id) {
          hideTooltip(d);
        } else {
          // Hide any previously active tooltip
          if (activeTeam) {
            const prevData = data.find((t) => t.team_id === activeTeam);
            if (prevData) hideTooltip(prevData);
          }
          showTooltip(event, d);
        }
      });

    // Tap on chart background dismisses tooltip
    svg.on("touchstart", function (event) {
      if (activeTeam && event.target === svgRef.current) {
        const prevData = data.find((t) => t.team_id === activeTeam);
        if (prevData) hideTooltip(prevData);
      }
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
  }, [data, dimensions, router, searchParams]);

  return (
    <div ref={containerRef} className="relative w-full bg-white border border-gray-200 rounded-md">
      <svg ref={svgRef} className="w-full" />
      <div className="flex flex-wrap justify-center gap-x-6 gap-y-1 px-4 py-2 border-t border-gray-100">
        {QUADRANTS.map((q) => (
          <div key={q.key} className="flex items-center gap-1.5">
            <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: q.swatch }} />
            <span className="text-xs text-gray-500">{q.label}</span>
          </div>
        ))}
      </div>
      <div
        ref={tooltipRef}
        className="fixed z-50 bg-white px-3 py-2 rounded-md shadow-lg border border-gray-200 pointer-events-auto opacity-0 transition-opacity"
        style={{ maxWidth: 340 }}
      />
    </div>
  );
}
