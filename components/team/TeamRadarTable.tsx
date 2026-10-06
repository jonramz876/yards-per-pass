// components/team/TeamRadarTable.tsx — one side's stat table: value, rank and
// NFL average for each of the seven spokes (team radar spec 2026-10-06 §4,
// §8 R7). Used under each radar on the team page and beside the large radar
// on a share page (PR 3), so the two can never print different numbers.
"use client";

import MetricTooltip from "@/components/ui/MetricTooltip";
import {
  RADAR_AXES,
  axisLabel,
  axisSubline,
  fmtRadarPct,
  rankCellLabel,
  rankTone,
  type RadarAxisKey,
  type RadarSide,
  type RadarSideModel,
  type RankTone,
} from "@/lib/stats/team-radar";

const TONE_CLASS: Record<RankTone, string> = {
  good: "bg-emerald-50 text-emerald-700",
  bad: "bg-red-50 text-red-700",
  mid: "bg-slate-100 text-slate-600",
  none: "text-slate-300",
};

const TH = "border-b border-slate-200 py-[7px] text-[10.5px] font-bold uppercase tracking-wider text-slate-500";
const TD = "border-b border-slate-100 py-[7px] align-top";
const NUM = "px-1.5 text-right";
const FIRST = "pl-0 pr-1.5 text-left";

interface TeamRadarTableProps {
  side: RadarSideModel;
  sideKey: RadarSide;
  teamId: string;
  /** N: teams with at least one game. A spoke whose pool is smaller prints the pool beside its rank. */
  teamsPlayed: number;
  league: Record<RadarAxisKey, number | null>;
  /** First column header. "Stat" on the team page; the side's subtitle on a share card. */
  statHeader?: string;
}

export default function TeamRadarTable({ side, sideKey, teamId, teamsPlayed, league, statHeader = "Stat" }: TeamRadarTableProps) {
  return (
    <table className="mt-1 w-full border-collapse text-[13px] tabular-nums">
      <thead>
        <tr>
          <th className={`${TH} ${FIRST}`}>{statHeader}</th>
          <th className={`${TH} ${NUM} whitespace-nowrap`}>{teamId}</th>
          <th className={`${TH} ${NUM} whitespace-nowrap`}>Rank</th>
          <th className={`${TH} ${NUM} whitespace-nowrap`}>NFL avg</th>
        </tr>
      </thead>
      <tbody>
        {RADAR_AXES.map((axis, i) => {
          const spoke = side.spokes[i];
          const missing = spoke.value === null;
          const tone = rankTone(spoke.rank, spoke.pool);
          return (
            <tr key={axis.key} data-axis={axis.key} data-missing={missing ? "true" : undefined}>
              <td className={`${TD} ${FIRST} ${missing ? "text-slate-400" : "text-slate-900"}`}>
                {axisLabel(axis, sideKey)}
                {axis.tooltip && <MetricTooltip metric={axis.tooltip} />}
                <span className="mt-px block text-[11.5px] font-normal text-slate-400">
                  {axisSubline(axis, sideKey)}
                  {spoke.count ? ` (${spoke.count[0]} of ${spoke.count[1]})` : ""}
                </span>
              </td>
              <td className={`${TD} ${NUM} whitespace-nowrap ${missing ? "text-slate-400" : "font-bold text-slate-900"}`}>
                {fmtRadarPct(spoke.value)}
              </td>
              <td className={`${TD} ${NUM} whitespace-nowrap`}>
                <span
                  data-rank-tone={tone}
                  className={`inline-block min-w-[38px] rounded px-1.5 py-0.5 text-center text-[11px] font-bold ${TONE_CLASS[tone]}`}
                >
                  {rankCellLabel(spoke, teamsPlayed)}
                </span>
              </td>
              <td className={`${TD} ${NUM} whitespace-nowrap text-slate-500`}>{fmtRadarPct(league[axis.key])}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
