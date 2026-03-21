// components/player/GameLogTab.tsx
"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { QBWeeklyStat, ReceiverWeeklyStat, RBWeeklyStat } from "@/lib/types";
import { getTeamColor } from "@/lib/data/teams";
import { qbFantasyPoints, wrFantasyPoints, rbFantasyPoints } from "@/lib/stats/fantasy";

type WeeklyRow = QBWeeklyStat | ReceiverWeeklyStat | RBWeeklyStat;

interface GameLogTabProps {
  weeklyStats: WeeklyRow[];
  position: string;
  season: number;
  teamId: string;
}

// ─── Column definitions per position ─────────────────────────────────────────

interface ColDef {
  key: string;
  label: string;
  align?: "left" | "right" | "center";
  format?: (v: number) => string;
  getValue: (row: WeeklyRow) => number | string;
  sortable?: boolean;
  numeric?: boolean;
}

const fmtDec1 = (v: number) => (isNaN(v) ? "\u2014" : v.toFixed(1));
const fmtDec2 = (v: number) => (isNaN(v) ? "\u2014" : v.toFixed(2));
const fmtPct = (v: number) => (isNaN(v) ? "\u2014" : (v * 100).toFixed(1) + "%");
const fmtInt = (v: number) => (isNaN(v) ? "\u2014" : String(Math.round(v)));

function resultStr(row: WeeklyRow): string {
  const ts = row.team_score;
  const os = row.opponent_score;
  if (ts == null || os == null) return "\u2014";
  const w = ts > os ? "W" : ts < os ? "L" : "T";
  return `${w} ${ts}-${os}`;
}

function homeAway(row: WeeklyRow): string {
  return row.home_away === "away" ? "@" : "vs";
}

const COMMON_COLS: ColDef[] = [
  { key: "week", label: "Wk", numeric: true, sortable: true, getValue: (r) => r.week },
  { key: "opponent", label: "Opp", getValue: (r) => r.opponent_id, sortable: true },
  { key: "home_away", label: "H/A", getValue: (r) => homeAway(r) },
  { key: "result", label: "Result", getValue: (r) => resultStr(r) },
];

const QB_COLS: ColDef[] = [
  {
    key: "comp_att",
    label: "C/A",
    getValue: (r) => {
      const qb = r as QBWeeklyStat;
      return `${qb.completions}/${qb.attempts}`;
    },
  },
  { key: "passing_yards", label: "Yds", numeric: true, sortable: true, getValue: (r) => (r as QBWeeklyStat).passing_yards, format: fmtInt },
  { key: "touchdowns", label: "TD", numeric: true, sortable: true, getValue: (r) => (r as QBWeeklyStat).touchdowns, format: fmtInt },
  { key: "interceptions", label: "INT", numeric: true, sortable: true, getValue: (r) => (r as QBWeeklyStat).interceptions, format: fmtInt },
  { key: "passer_rating", label: "Rating", numeric: true, sortable: true, getValue: (r) => (r as QBWeeklyStat).passer_rating, format: fmtDec1 },
  { key: "epa_per_dropback", label: "EPA/DB", numeric: true, sortable: true, getValue: (r) => (r as QBWeeklyStat).epa_per_dropback, format: fmtDec2 },
  { key: "cpoe", label: "CPOE", numeric: true, sortable: true, getValue: (r) => (r as QBWeeklyStat).cpoe, format: fmtDec1 },
  { key: "sacks", label: "Sck", numeric: true, sortable: true, getValue: (r) => (r as QBWeeklyStat).sacks, format: fmtInt },
  { key: "rush_yards", label: "RuYd", numeric: true, sortable: true, getValue: (r) => (r as QBWeeklyStat).rush_yards, format: fmtInt },
  { key: "rush_tds", label: "RuTD", numeric: true, sortable: true, getValue: (r) => (r as QBWeeklyStat).rush_tds, format: fmtInt },
  { key: "fantasy_pts", label: "FPts", numeric: true, sortable: true, getValue: (r) => {
    const qb = r as QBWeeklyStat;
    return qbFantasyPoints({
      passing_yards: qb.passing_yards,
      touchdowns: qb.touchdowns,
      interceptions: qb.interceptions,
      rush_yards: qb.rush_yards,
      rush_tds: qb.rush_tds,
      fumbles_lost: qb.fumbles_lost,
    });
  }, format: fmtDec1 },
];

const WR_COLS: ColDef[] = [
  { key: "targets", label: "Tgt", numeric: true, sortable: true, getValue: (r) => (r as ReceiverWeeklyStat).targets, format: fmtInt },
  { key: "receptions", label: "Rec", numeric: true, sortable: true, getValue: (r) => (r as ReceiverWeeklyStat).receptions, format: fmtInt },
  { key: "receiving_yards", label: "Yds", numeric: true, sortable: true, getValue: (r) => (r as ReceiverWeeklyStat).receiving_yards, format: fmtInt },
  { key: "receiving_tds", label: "TD", numeric: true, sortable: true, getValue: (r) => (r as ReceiverWeeklyStat).receiving_tds, format: fmtInt },
  { key: "epa_per_target", label: "EPA/Tgt", numeric: true, sortable: true, getValue: (r) => (r as ReceiverWeeklyStat).epa_per_target, format: fmtDec2 },
  { key: "catch_rate", label: "Catch%", numeric: true, sortable: true, getValue: (r) => (r as ReceiverWeeklyStat).catch_rate, format: fmtPct },
  { key: "adot", label: "ADOT", numeric: true, sortable: true, getValue: (r) => (r as ReceiverWeeklyStat).adot, format: fmtDec1 },
  { key: "yac", label: "YAC", numeric: true, sortable: true, getValue: (r) => (r as ReceiverWeeklyStat).yac, format: fmtInt },
  { key: "routes_run", label: "Routes", numeric: true, sortable: true, getValue: (r) => (r as ReceiverWeeklyStat).routes_run, format: fmtInt },
  { key: "fantasy_pts", label: "FPts", numeric: true, sortable: true, getValue: (r) => {
    const wr = r as ReceiverWeeklyStat;
    return wrFantasyPoints({
      receiving_yards: wr.receiving_yards,
      receiving_tds: wr.receiving_tds,
      receptions: wr.receptions,
      fumbles_lost: 0,
    }, "ppr");
  }, format: fmtDec1 },
];

const RB_COLS: ColDef[] = [
  { key: "carries", label: "Car", numeric: true, sortable: true, getValue: (r) => (r as RBWeeklyStat).carries, format: fmtInt },
  { key: "rushing_yards", label: "Yds", numeric: true, sortable: true, getValue: (r) => (r as RBWeeklyStat).rushing_yards, format: fmtInt },
  { key: "yards_per_carry", label: "YPC", numeric: true, sortable: true, getValue: (r) => (r as RBWeeklyStat).yards_per_carry, format: fmtDec1 },
  { key: "rushing_tds", label: "TD", numeric: true, sortable: true, getValue: (r) => (r as RBWeeklyStat).rushing_tds, format: fmtInt },
  { key: "epa_per_carry", label: "EPA/Car", numeric: true, sortable: true, getValue: (r) => (r as RBWeeklyStat).epa_per_carry, format: fmtDec2 },
  { key: "success_rate", label: "Succ%", numeric: true, sortable: true, getValue: (r) => (r as RBWeeklyStat).success_rate, format: fmtPct },
  { key: "targets", label: "Tgt", numeric: true, sortable: true, getValue: (r) => (r as RBWeeklyStat).targets, format: fmtInt },
  { key: "receptions", label: "Rec", numeric: true, sortable: true, getValue: (r) => (r as RBWeeklyStat).receptions, format: fmtInt },
  { key: "receiving_yards", label: "RcYd", numeric: true, sortable: true, getValue: (r) => (r as RBWeeklyStat).receiving_yards, format: fmtInt },
  { key: "receiving_tds", label: "RcTD", numeric: true, sortable: true, getValue: (r) => (r as RBWeeklyStat).receiving_tds, format: fmtInt },
  { key: "fantasy_pts", label: "FPts", numeric: true, sortable: true, getValue: (r) => {
    const rb = r as RBWeeklyStat;
    return rbFantasyPoints({
      rushing_yards: rb.rushing_yards,
      rushing_tds: rb.rushing_tds,
      receiving_yards: rb.receiving_yards,
      receiving_tds: rb.receiving_tds,
      receptions: rb.receptions,
      fumbles_lost: rb.fumbles_lost,
    }, "ppr");
  }, format: fmtDec1 },
];

// ─── Sparkline Components ────────────────────────────────────────────────────

function EPASparkline({ data, teamColor }: { data: { week: number; epa: number }[]; teamColor: string }) {
  if (data.length < 2) return null;
  const W = 480, H = 80, PX = 28, PY = 14;
  const epas = data.map((d) => d.epa);
  const seasonAvg = epas.reduce((a, b) => a + b, 0) / epas.length;
  const minE = Math.min(...epas, seasonAvg, 0);
  const maxE = Math.max(...epas, seasonAvg, 0);
  const range = maxE - minE || 0.1;
  const xScale = (i: number) => PX + (i / (data.length - 1)) * (W - PX * 2);
  const yScale = (e: number) => PY + (1 - (e - minE) / range) * (H - PY * 2);
  const avgY = yScale(seasonAvg);
  const zeroY = yScale(0);
  const pathD = data.map((d, i) => `${i === 0 ? "M" : "L"}${xScale(i).toFixed(1)},${yScale(d.epa).toFixed(1)}`).join(" ");

  return (
    <div>
      <div className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide mb-1">
        EPA Trend
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ maxHeight: 80 }}>
        {/* Zero line */}
        <line x1={PX} y1={zeroY} x2={W - PX} y2={zeroY} stroke="#e2e8f0" strokeWidth={1} strokeDasharray="4,3" />
        {/* Season avg line */}
        <line x1={PX} y1={avgY} x2={W - PX} y2={avgY} stroke="#f59e0b" strokeWidth={1} strokeDasharray="3,4" />
        <text x={W - PX + 4} y={avgY + 3} fontSize={8} fill="#f59e0b">avg</text>
        {/* Trend line */}
        <path d={pathD} fill="none" stroke={teamColor} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
        {/* Points colored by above/below avg */}
        {data.map((d, i) => (
          <circle
            key={d.week}
            cx={xScale(i)}
            cy={yScale(d.epa)}
            r={3.5}
            fill={d.epa >= seasonAvg ? "#16a34a" : "#dc2626"}
          >
            <title>Week {d.week}: {d.epa >= 0 ? "+" : ""}{d.epa.toFixed(2)}</title>
          </circle>
        ))}
        {/* Week labels */}
        {data.map((d, i) => (
          <text key={d.week} x={xScale(i)} y={H - 1} textAnchor="middle" fontSize={8} fill="#94a3b8">{d.week}</text>
        ))}
      </svg>
    </div>
  );
}

function VolumeSparkline({
  data,
  teamColor,
  label,
}: {
  data: { week: number; volume: number }[];
  teamColor: string;
  label: string;
}) {
  if (data.length < 2) return null;
  const W = 480, H = 60, PX = 28, PY = 6;
  const maxV = Math.max(...data.map((d) => d.volume), 1);
  const barW = Math.min(((W - PX * 2) / data.length) * 0.7, 18);
  const xScale = (i: number) => PX + (i / (data.length - 1)) * (W - PX * 2);
  const barH = (v: number) => ((v / maxV) * (H - PY * 2 - 10));

  return (
    <div>
      <div className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide mb-1">
        {label}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ maxHeight: 60 }}>
        {data.map((d, i) => {
          const x = xScale(i) - barW / 2;
          const h = barH(d.volume);
          const y = H - PY - 10 - h;
          return (
            <g key={d.week}>
              <rect x={x} y={y} width={barW} height={h} rx={2} fill={teamColor} opacity={0.6}>
                <title>Week {d.week}: {d.volume}</title>
              </rect>
              <text x={xScale(i)} y={H - 1} textAnchor="middle" fontSize={8} fill="#94a3b8">{d.week}</text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

// ─── Main Component ──────────────────────────────────────────────────────────

export default function GameLogTab({ weeklyStats, position, season, teamId }: GameLogTabProps) {
  const teamColor = getTeamColor(teamId);
  const [sortKey, setSortKey] = useState<string>("week");
  const [sortDesc, setSortDesc] = useState(false);

  const posCols = useMemo(
    () => position === "QB" ? QB_COLS : (position === "WR" || position === "TE") ? WR_COLS : RB_COLS,
    [position]
  );
  const allCols = useMemo(() => [...COMMON_COLS, ...posCols], [posCols]);

  // Build sparkline data
  const epaData = useMemo(() => {
    return weeklyStats.map((r) => {
      let epa: number;
      if (position === "QB") epa = (r as QBWeeklyStat).epa_per_dropback;
      else if (position === "WR" || position === "TE") epa = (r as ReceiverWeeklyStat).epa_per_target;
      else epa = (r as RBWeeklyStat).epa_per_carry;
      return { week: r.week, epa: isNaN(epa) ? 0 : epa };
    }).sort((a, b) => a.week - b.week);
  }, [weeklyStats, position]);

  const volumeData = useMemo(() => {
    return weeklyStats.map((r) => {
      let vol: number;
      if (position === "QB") vol = (r as QBWeeklyStat).attempts;
      else if (position === "WR" || position === "TE") vol = (r as ReceiverWeeklyStat).targets;
      else vol = (r as RBWeeklyStat).carries;
      return { week: r.week, volume: vol || 0 };
    }).sort((a, b) => a.week - b.week);
  }, [weeklyStats, position]);

  const volumeLabel = position === "QB" ? "Attempts by Week" : (position === "WR" || position === "TE") ? "Targets by Week" : "Carries by Week";

  // Detect BYE/DNP weeks. Build complete week list from 1..max
  const maxWeek = useMemo(() => Math.max(...weeklyStats.map((r) => r.week), 0), [weeklyStats]);

  // Rows: real games + BYE/DNP placeholders
  type DisplayRow = { type: "game"; data: WeeklyRow } | { type: "bye" | "dnp"; week: number };

  const displayRows = useMemo(() => {
    const rows: DisplayRow[] = [];
    let foundFirstGap = false;
    for (let w = 1; w <= maxWeek; w++) {
      const game = weeklyStats.find((r) => r.week === w);
      if (game) {
        rows.push({ type: "game", data: game });
      } else {
        if (!foundFirstGap) {
          rows.push({ type: "bye", week: w });
          foundFirstGap = true;
        } else {
          rows.push({ type: "dnp", week: w });
        }
      }
    }
    return rows;
  }, [weeklyStats, maxWeek]);

  // Sorted rows: only sort game rows, keep BYE/DNP in place
  const sortedRows = useMemo(() => {
    if (sortKey === "week") {
      // Default week order — BYE/DNP stay in place
      const sorted = [...displayRows];
      if (sortDesc) sorted.reverse();
      return sorted;
    }
    // When sorting by a stat column, pull games out, sort them, put them back
    const games = displayRows.filter((r): r is Extract<DisplayRow, { type: "game" }> => r.type === "game");
    const col = allCols.find((c) => c.key === sortKey);
    if (col) {
      games.sort((a, b) => {
        const av = col.getValue(a.data);
        const bv = col.getValue(b.data);
        const an = typeof av === "number" ? av : NaN;
        const bn = typeof bv === "number" ? bv : NaN;
        if (isNaN(an) && isNaN(bn)) return 0;
        if (isNaN(an)) return 1;
        if (isNaN(bn)) return -1;
        return sortDesc ? bn - an : an - bn;
      });
    }
    // Rebuild: non-games stay, games fill in order
    let gi = 0;
    return displayRows.map((r) => {
      if (r.type !== "game") return r;
      return games[gi++];
    });
  }, [displayRows, sortKey, sortDesc, allCols]);

  function handleSort(key: string) {
    if (sortKey === key) {
      setSortDesc(!sortDesc);
    } else {
      setSortKey(key);
      setSortDesc(true);
    }
  }

  if (weeklyStats.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-gray-300 p-12 text-center text-gray-400">
        <p className="text-lg font-medium mb-1">No game data available</p>
        <p className="text-sm">No weekly stats found for the {season} season.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Sparklines */}
      <div className="rounded-xl border border-gray-200 bg-white p-5">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <EPASparkline data={epaData} teamColor={teamColor} />
          <VolumeSparkline data={volumeData} teamColor={teamColor} label={volumeLabel} />
        </div>
      </div>

      {/* Weekly stats table */}
      <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50/80">
                {allCols.map((col) => (
                  <th
                    key={col.key}
                    className={`px-2.5 py-2 text-[11px] font-semibold text-gray-400 uppercase tracking-wide whitespace-nowrap ${
                      col.numeric ? "text-right" : "text-left"
                    } ${col.sortable ? "cursor-pointer hover:text-gray-600 select-none" : ""}`}
                    onClick={col.sortable ? () => handleSort(col.key) : undefined}
                  >
                    {col.label}
                    {sortKey === col.key && (
                      <span className="ml-0.5 text-navy">{sortDesc ? "\u25BC" : "\u25B2"}</span>
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sortedRows.map((row, idx) => {
                if (row.type === "bye") {
                  return (
                    <tr key={`bye-${row.week}`} className="bg-gray-50/50">
                      <td className="px-2.5 py-1.5 text-gray-400 font-medium">{row.week}</td>
                      <td colSpan={allCols.length - 1} className="px-2.5 py-1.5 text-gray-400 italic text-center">
                        BYE
                      </td>
                    </tr>
                  );
                }
                if (row.type === "dnp") {
                  return (
                    <tr key={`dnp-${row.week}`} className="bg-gray-50/50">
                      <td className="px-2.5 py-1.5 text-gray-400 font-medium">{row.week}</td>
                      <td colSpan={allCols.length - 1} className="px-2.5 py-1.5 text-gray-400 italic text-center">
                        DNP
                      </td>
                    </tr>
                  );
                }
                if (row.type !== "game") return null;
                const r = row.data;
                return (
                  <tr
                    key={`game-${r.week}-${idx}`}
                    className="border-b border-gray-100 last:border-b-0 hover:bg-gray-50/80 transition-colors"
                  >
                    {allCols.map((col) => {
                      const raw = col.getValue(r);
                      let display: string;
                      if (col.key === "opponent") {
                        // Link to team page
                        return (
                          <td key={col.key} className="px-2.5 py-1.5 text-left">
                            <Link
                              href={`/team/${raw}`}
                              className="text-navy hover:text-nflred font-medium transition-colors"
                            >
                              {String(raw)}
                            </Link>
                          </td>
                        );
                      }
                      if (typeof raw === "number" && col.format) {
                        display = col.format(raw);
                      } else {
                        display = String(raw ?? "\u2014");
                      }

                      // Color EPA columns
                      let textColor = "text-gray-900";
                      if (
                        col.key === "epa_per_dropback" ||
                        col.key === "epa_per_target" ||
                        col.key === "epa_per_carry"
                      ) {
                        const n = typeof raw === "number" ? raw : NaN;
                        if (!isNaN(n)) {
                          textColor = n >= 0 ? "text-green-600" : "text-red-600";
                        }
                      }

                      return (
                        <td
                          key={col.key}
                          className={`px-2.5 py-1.5 whitespace-nowrap ${
                            col.numeric ? "text-right" : "text-left"
                          } ${textColor}`}
                        >
                          {display}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
