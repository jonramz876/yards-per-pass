"use client";

import React, { useState, useMemo } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import Image from "next/image";
import type { RBGapStat } from "@/lib/types";
import { getTeam } from "@/lib/data/teams";

const GAP_ORDER = ["LE", "LT", "LG", "M", "RG", "RT", "RE"] as const;

const GAP_LABELS: Record<string, string> = {
  LE: "Left End",
  LT: "Left Tackle",
  LG: "Left Guard",
  M: "Middle",
  RG: "Right Guard",
  RT: "Right Tackle",
  RE: "Right End",
};

interface TeamGapRow {
  teamId: string;
  teamName: string;
  teamLogo: string;
  primaryColor: string;
  totalCarries: number;
  totalEpa: number;
  gaps: Record<string, { carries: number; epa: number }>;
}

interface GapHeatmapProps {
  allGapStats: RBGapStat[];
  teams: string[];
}

/** Smooth EPA color scale — 5-step diverging green/red */
function epaColor(epa: number): string {
  if (isNaN(epa)) return "#f3f4f6";
  if (epa > 0.05) return "#16a34a";
  if (epa > 0.02) return "#4ade80";
  if (epa > 0) return "#bbf7d0";
  if (epa > -0.02) return "#fecaca";
  if (epa > -0.05) return "#f87171";
  return "#dc2626";
}

function epaTextColor(epa: number): string {
  if (isNaN(epa)) return "#9ca3af";
  if (epa > 0.05 || epa < -0.05) return "#ffffff";
  return "#1f2937";
}

type SortDir = "asc" | "desc";

export default function GapHeatmap({ allGapStats, teams }: GapHeatmapProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [sortGap, setSortGap] = useState<string | "total" | null>("total");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  // Aggregate player-level stats into team×gap rows
  const teamRows = useMemo(() => {
    // Map: teamId -> gap -> { carries, epaSum }
    const teamGapMap = new Map<
      string,
      Map<string, { carries: number; epaSum: number }>
    >();

    for (const row of allGapStats) {
      const c = row.carries || 0;
      if (c === 0) continue;

      let gapMap = teamGapMap.get(row.team_id);
      if (!gapMap) {
        gapMap = new Map();
        teamGapMap.set(row.team_id, gapMap);
      }

      const prev = gapMap.get(row.gap) || { carries: 0, epaSum: 0 };
      prev.carries += c;
      if (row.epa_per_carry !== null && !isNaN(row.epa_per_carry)) {
        prev.epaSum += row.epa_per_carry * c;
      }
      gapMap.set(row.gap, prev);
    }

    // Build row objects
    const rows: TeamGapRow[] = [];
    for (const teamId of teams) {
      const team = getTeam(teamId);
      if (!team) continue;

      const gapMap = teamGapMap.get(teamId);
      const gaps: Record<string, { carries: number; epa: number }> = {};
      let totalCarries = 0;
      let totalEpaSum = 0;

      for (const gap of GAP_ORDER) {
        const d = gapMap?.get(gap);
        if (d && d.carries > 0) {
          gaps[gap] = { carries: d.carries, epa: d.epaSum / d.carries };
          totalCarries += d.carries;
          totalEpaSum += d.epaSum;
        }
      }

      rows.push({
        teamId,
        teamName: team.name,
        teamLogo: team.logo,
        primaryColor: team.primaryColor,
        totalCarries,
        totalEpa: totalCarries > 0 ? totalEpaSum / totalCarries : NaN,
        gaps,
      });
    }

    return rows;
  }, [allGapStats, teams]);

  // Sort rows
  const sortedRows = useMemo(() => {
    if (!sortGap) return teamRows;

    return [...teamRows].sort((a, b) => {
      let aVal: number;
      let bVal: number;

      if (sortGap === "total") {
        aVal = isNaN(a.totalEpa) ? -999 : a.totalEpa;
        bVal = isNaN(b.totalEpa) ? -999 : b.totalEpa;
      } else {
        aVal = a.gaps[sortGap]?.epa ?? -999;
        bVal = b.gaps[sortGap]?.epa ?? -999;
      }

      return sortDir === "desc" ? bVal - aVal : aVal - bVal;
    });
  }, [teamRows, sortGap, sortDir]);

  // Compute NFL AVG row from team data
  const nflAvg = useMemo(() => {
    const gapAvgs: Record<string, number> = {};
    for (const gap of GAP_ORDER) {
      let sum = 0;
      let count = 0;
      for (const row of teamRows) {
        const d = row.gaps[gap];
        if (d && !isNaN(d.epa)) {
          sum += d.epa;
          count++;
        }
      }
      gapAvgs[gap] = count > 0 ? sum / count : NaN;
    }
    // Total avg
    let totalSum = 0;
    let totalCount = 0;
    for (const row of teamRows) {
      if (!isNaN(row.totalEpa)) {
        totalSum += row.totalEpa;
        totalCount++;
      }
    }
    return { gaps: gapAvgs, totalEpa: totalCount > 0 ? totalSum / totalCount : NaN };
  }, [teamRows]);

  function handleSort(gap: string | "total") {
    if (sortGap === gap) {
      setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    } else {
      setSortGap(gap);
      setSortDir("desc");
    }
  }

  function handleTeamClick(teamId: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("team", teamId);
    router.push(`${pathname}?${params.toString()}`);
  }

  function sortArrow(col: string | "total") {
    if (sortGap !== col) return null;
    return (
      <span className="ml-0.5 text-[10px]">
        {sortDir === "desc" ? "\u25BC" : "\u25B2"}
      </span>
    );
  }

  if (teamRows.length === 0) {
    return (
      <div className="bg-gray-50 border border-gray-200 rounded-lg p-16 text-center">
        <p className="text-gray-400 text-sm">
          No gap data available for this season.
        </p>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-4">
        <h2 className="text-lg font-bold text-navy">
          League-Wide Run Gap Efficiency
        </h2>
        <p className="text-xs text-gray-400 mt-1">
          EPA per carry by gap for all teams. Click a column header to sort.
          Click a team row to view their formation diagram.
        </p>
      </div>

      {/* Desktop table view */}
      <div className="hidden md:block overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b-2 border-gray-200">
              <th className="text-left py-2 px-3 text-xs font-semibold text-gray-500 w-52">
                <button
                  onClick={() => handleSort("total")}
                  className="flex items-center gap-1 hover:text-navy transition-colors"
                >
                  Team (Total EPA)
                  {sortArrow("total")}
                </button>
              </th>
              {GAP_ORDER.map((gap) => (
                <th
                  key={gap}
                  className="text-center py-2 px-1 text-xs font-semibold text-gray-500"
                >
                  <button
                    onClick={() => handleSort(gap)}
                    className="flex items-center justify-center gap-0.5 w-full hover:text-navy transition-colors"
                    title={GAP_LABELS[gap]}
                  >
                    {gap}
                    {sortArrow(gap)}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sortedRows.map((row, idx) => {
              // Determine if NFL AVG row should appear before this team
              let showAvgBefore = false;
              if (sortGap) {
                const avgVal = sortGap === "total" ? nflAvg.totalEpa : (nflAvg.gaps[sortGap] ?? NaN);
                if (!isNaN(avgVal)) {
                  const getRowVal = (r: TeamGapRow) =>
                    sortGap === "total" ? (isNaN(r.totalEpa) ? -999 : r.totalEpa) : (r.gaps[sortGap]?.epa ?? -999);

                  if (idx === 0) {
                    const currVal = getRowVal(row);
                    if (sortDir === "desc" ? avgVal >= currVal : avgVal <= currVal) {
                      showAvgBefore = true;
                    }
                  } else {
                    const prevVal = getRowVal(sortedRows[idx - 1]);
                    const currVal = getRowVal(row);
                    if (sortDir === "desc") {
                      showAvgBefore = avgVal < prevVal && avgVal >= currVal;
                    } else {
                      showAvgBefore = avgVal > prevVal && avgVal <= currVal;
                    }
                  }
                }
              }

              const avgRow = showAvgBefore ? (
                <tr key="nfl-avg" className="border-t border-amber-400">
                  <td className="py-1.5 px-3 flex items-center gap-2" style={{ background: "#fef3c7" }}>
                    <span style={{ color: "#92400e", fontWeight: 700, fontStyle: "italic" }}>
                      NFL AVG
                    </span>
                    {!isNaN(nflAvg.totalEpa) && (
                      <span
                        className="text-[10px] font-semibold ml-auto flex-shrink-0"
                        style={{ color: "#92400e" }}
                      >
                        {nflAvg.totalEpa >= 0 ? "+" : ""}
                        {nflAvg.totalEpa.toFixed(3)}
                      </span>
                    )}
                  </td>
                  {GAP_ORDER.map((gap) => {
                    const epa = nflAvg.gaps[gap] ?? NaN;
                    return (
                      <td
                        key={gap}
                        className="text-center py-1.5 px-1"
                        style={{ background: "#fef3c7", borderBottom: "2px solid #f59e0b" }}
                      >
                        <div
                          className="rounded px-1 py-1 text-xs font-mono font-semibold leading-tight"
                          style={{ backgroundColor: "#fef3c7", color: "#92400e" }}
                        >
                          {isNaN(epa) ? "\u2014" : `${epa >= 0 ? "+" : ""}${epa.toFixed(2)}`}
                        </div>
                      </td>
                    );
                  })}
                </tr>
              ) : null;

              // Also check if avg should appear after the last row
              let showAvgAfter = false;
              if (sortGap && idx === sortedRows.length - 1) {
                const avgVal = sortGap === "total" ? nflAvg.totalEpa : (nflAvg.gaps[sortGap] ?? NaN);
                if (!isNaN(avgVal)) {
                  const getRowVal = (r: TeamGapRow) =>
                    sortGap === "total" ? (isNaN(r.totalEpa) ? -999 : r.totalEpa) : (r.gaps[sortGap]?.epa ?? -999);
                  const currVal = getRowVal(row);
                  if (sortDir === "desc" ? avgVal < currVal : avgVal > currVal) {
                    showAvgAfter = true;
                  }
                }
              }

              const avgRowAfter = showAvgAfter ? (
                <tr key="nfl-avg" className="border-t border-amber-400">
                  <td className="py-1.5 px-3 flex items-center gap-2" style={{ background: "#fef3c7" }}>
                    <span style={{ color: "#92400e", fontWeight: 700, fontStyle: "italic" }}>
                      NFL AVG
                    </span>
                    {!isNaN(nflAvg.totalEpa) && (
                      <span
                        className="text-[10px] font-semibold ml-auto flex-shrink-0"
                        style={{ color: "#92400e" }}
                      >
                        {nflAvg.totalEpa >= 0 ? "+" : ""}
                        {nflAvg.totalEpa.toFixed(3)}
                      </span>
                    )}
                  </td>
                  {GAP_ORDER.map((gap) => {
                    const epa = nflAvg.gaps[gap] ?? NaN;
                    return (
                      <td
                        key={gap}
                        className="text-center py-1.5 px-1"
                        style={{ background: "#fef3c7", borderBottom: "2px solid #f59e0b" }}
                      >
                        <div
                          className="rounded px-1 py-1 text-xs font-mono font-semibold leading-tight"
                          style={{ backgroundColor: "#fef3c7", color: "#92400e" }}
                        >
                          {isNaN(epa) ? "\u2014" : `${epa >= 0 ? "+" : ""}${epa.toFixed(2)}`}
                        </div>
                      </td>
                    );
                  })}
                </tr>
              ) : null;

              return (
                <React.Fragment key={row.teamId}>
                  {avgRow}
                  <tr
                    onClick={() => handleTeamClick(row.teamId)}
                    className={`cursor-pointer transition-colors hover:bg-blue-50 ${
                      idx % 2 === 0 ? "bg-white" : "bg-gray-50/50"
                    }`}
                  >
                    <td className="py-1.5 px-3 flex items-center gap-2">
                      <Image
                        src={row.teamLogo}
                        alt={row.teamName}
                        width={20}
                        height={20}
                        className="rounded-full flex-shrink-0"
                        unoptimized
                      />
                      <span className="font-medium text-navy text-xs truncate">
                        {row.teamName}
                      </span>
                      {!isNaN(row.totalEpa) && (
                        <span
                          className={`text-[10px] font-semibold ml-auto flex-shrink-0 ${
                            row.totalEpa >= 0 ? "text-green-600" : "text-red-600"
                          }`}
                        >
                          {row.totalEpa >= 0 ? "+" : ""}
                          {row.totalEpa.toFixed(3)}
                        </span>
                      )}
                    </td>
                    {GAP_ORDER.map((gap) => {
                      const d = row.gaps[gap];
                      const epa = d?.epa ?? NaN;
                      const bg = epaColor(epa);
                      const fg = epaTextColor(epa);
                      return (
                        <td
                          key={gap}
                          className="text-center py-1.5 px-1"
                        >
                          <div
                            className="rounded px-1 py-1 text-xs font-mono font-semibold leading-tight"
                            style={{ backgroundColor: bg, color: fg }}
                          >
                            {isNaN(epa) ? (
                              <span className="text-gray-400">{"\u2014"}</span>
                            ) : (
                              <>
                                {epa >= 0 ? "+" : ""}
                                {epa.toFixed(2)}
                              </>
                            )}
                          </div>
                          {d && (
                            <div className="text-[9px] text-gray-400 mt-0.5">
                              {d.carries} att
                            </div>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                  {avgRowAfter}
                </React.Fragment>
              );
            })}
            {/* Show NFL AVG at bottom when unsorted */}
            {!sortGap && (
              <tr key="nfl-avg" className="border-t-2 border-amber-400">
                <td className="py-1.5 px-3 flex items-center gap-2" style={{ background: "#fef3c7" }}>
                  <span style={{ color: "#92400e", fontWeight: 700, fontStyle: "italic" }}>
                    NFL AVG
                  </span>
                  {!isNaN(nflAvg.totalEpa) && (
                    <span
                      className="text-[10px] font-semibold ml-auto flex-shrink-0"
                      style={{ color: "#92400e" }}
                    >
                      {nflAvg.totalEpa >= 0 ? "+" : ""}
                      {nflAvg.totalEpa.toFixed(3)}
                    </span>
                  )}
                </td>
                {GAP_ORDER.map((gap) => {
                  const epa = nflAvg.gaps[gap] ?? NaN;
                  return (
                    <td
                      key={gap}
                      className="text-center py-1.5 px-1"
                      style={{ background: "#fef3c7", borderBottom: "2px solid #f59e0b" }}
                    >
                      <div
                        className="rounded px-1 py-1 text-xs font-mono font-semibold leading-tight"
                        style={{ backgroundColor: "#fef3c7", color: "#92400e" }}
                      >
                        {isNaN(epa) ? "\u2014" : `${epa >= 0 ? "+" : ""}${epa.toFixed(2)}`}
                      </div>
                    </td>
                  );
                })}
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Mobile card view */}
      <div className="md:hidden space-y-2">
        <div className="flex items-center gap-2 mb-3 overflow-x-auto pb-1">
          <span className="text-[10px] text-gray-400 flex-shrink-0">
            Sort by:
          </span>
          <button
            onClick={() => handleSort("total")}
            className={`px-2 py-1 text-[10px] rounded border flex-shrink-0 ${
              sortGap === "total"
                ? "bg-navy text-white border-navy"
                : "bg-white text-gray-600 border-gray-200"
            }`}
          >
            Total {sortArrow("total")}
          </button>
          {GAP_ORDER.map((gap) => (
            <button
              key={gap}
              onClick={() => handleSort(gap)}
              className={`px-2 py-1 text-[10px] rounded border flex-shrink-0 ${
                sortGap === gap
                  ? "bg-navy text-white border-navy"
                  : "bg-white text-gray-600 border-gray-200"
              }`}
            >
              {gap} {sortArrow(gap)}
            </button>
          ))}
        </div>

        {sortedRows.map((row) => (
          <button
            key={row.teamId}
            onClick={() => handleTeamClick(row.teamId)}
            className="w-full text-left bg-white border border-gray-200 rounded-lg p-3 hover:border-navy/30 transition-colors"
          >
            <div className="flex items-center gap-2 mb-2">
              <Image
                src={row.teamLogo}
                alt={row.teamName}
                width={20}
                height={20}
                className="rounded-full flex-shrink-0"
                unoptimized
              />
              <span className="font-medium text-navy text-sm">
                {row.teamName}
              </span>
              {!isNaN(row.totalEpa) && (
                <span
                  className={`text-xs font-semibold ml-auto ${
                    row.totalEpa >= 0 ? "text-green-600" : "text-red-600"
                  }`}
                >
                  {row.totalEpa >= 0 ? "+" : ""}
                  {row.totalEpa.toFixed(3)} EPA
                </span>
              )}
            </div>
            <div className="grid grid-cols-7 gap-1">
              {GAP_ORDER.map((gap) => {
                const d = row.gaps[gap];
                const epa = d?.epa ?? NaN;
                const bg = epaColor(epa);
                const fg = epaTextColor(epa);
                return (
                  <div key={gap} className="text-center">
                    <div className="text-[9px] text-gray-400 mb-0.5">{gap}</div>
                    <div
                      className="rounded px-0.5 py-0.5 text-[11px] font-mono font-semibold"
                      style={{ backgroundColor: bg, color: fg }}
                    >
                      {isNaN(epa) ? "\u2014" : epa.toFixed(2)}
                    </div>
                  </div>
                );
              })}
            </div>
          </button>
        ))}

        {/* NFL AVG card (mobile) */}
        <div
          className="w-full text-left rounded-lg p-3 border-2 border-amber-400"
          style={{ background: "#fef3c7" }}
        >
          <div className="flex items-center gap-2 mb-2">
            <span className="font-bold text-sm" style={{ color: "#92400e", fontStyle: "italic" }}>
              NFL AVG
            </span>
            {!isNaN(nflAvg.totalEpa) && (
              <span
                className="text-xs font-semibold ml-auto"
                style={{ color: "#92400e" }}
              >
                {nflAvg.totalEpa >= 0 ? "+" : ""}
                {nflAvg.totalEpa.toFixed(3)} EPA
              </span>
            )}
          </div>
          <div className="grid grid-cols-7 gap-1">
            {GAP_ORDER.map((gap) => {
              const epa = nflAvg.gaps[gap] ?? NaN;
              return (
                <div key={gap} className="text-center">
                  <div className="text-[9px] mb-0.5" style={{ color: "#92400e" }}>{gap}</div>
                  <div
                    className="rounded px-0.5 py-0.5 text-[11px] font-mono font-semibold"
                    style={{ backgroundColor: "#fef3c7", color: "#92400e" }}
                  >
                    {isNaN(epa) ? "\u2014" : epa.toFixed(2)}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Legend */}
      <div className="mt-4 flex flex-wrap items-center gap-3 text-[10px] text-gray-400">
        <span className="font-medium">EPA/carry:</span>
        <div className="flex items-center gap-1">
          <div
            className="w-4 h-3 rounded"
            style={{ backgroundColor: "#16a34a" }}
          />
          <span>&gt; +0.05</span>
        </div>
        <div className="flex items-center gap-1">
          <div
            className="w-4 h-3 rounded"
            style={{ backgroundColor: "#4ade80" }}
          />
          <span>+0.02 to +0.05</span>
        </div>
        <div className="flex items-center gap-1">
          <div
            className="w-4 h-3 rounded"
            style={{ backgroundColor: "#bbf7d0" }}
          />
          <span>0 to +0.02</span>
        </div>
        <div className="flex items-center gap-1">
          <div
            className="w-4 h-3 rounded"
            style={{ backgroundColor: "#fecaca" }}
          />
          <span>-0.02 to 0</span>
        </div>
        <div className="flex items-center gap-1">
          <div
            className="w-4 h-3 rounded"
            style={{ backgroundColor: "#f87171" }}
          />
          <span>-0.05 to -0.02</span>
        </div>
        <div className="flex items-center gap-1">
          <div
            className="w-4 h-3 rounded"
            style={{ backgroundColor: "#dc2626" }}
          />
          <span>&lt; -0.05</span>
        </div>
      </div>

      <p className="mt-4 text-xs text-gray-400 border-t border-gray-100 pt-4">
        Gap data reflects ball carrier destination, not designed play direction.
        Source:{" "}
        <a
          href="https://github.com/nflverse"
          target="_blank"
          rel="noopener noreferrer"
          className="underline hover:text-navy"
        >
          nflverse
        </a>{" "}
        play-by-play (~85-90% of rush plays have gap data).
      </p>
    </div>
  );
}
