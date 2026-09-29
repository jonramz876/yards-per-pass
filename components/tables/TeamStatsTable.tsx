// components/tables/TeamStatsTable.tsx — the /team-stats leaderboard (team
// stats spec 2026-09-28 §5.3). The numbers arrive already aggregated from the
// server (buildTeamStats); this component only sorts, formats and colours,
// with every rule and sentence taken from lib/stats/team-stats.ts.
"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import MetricTooltip from "@/components/ui/MetricTooltip";
import { getTeam, getTeamLogo } from "@/lib/data/teams";
import {
  SIDE_LABELS,
  SUBTITLE,
  TEAM_STATS_TABS,
  TEAM_STATS_TAB_LABELS,
  TEAM_TIERS_LINK_TEXT,
  TEAM_TIERS_NOTE,
  averageCell,
  betterFirstDir,
  buildTeamStatsQuery,
  cellClass,
  cellValue,
  colourOn,
  defaultSortKey,
  parseTeamStatsParams,
  sortTeamRows,
  teamStatsColumns,
  teamStatsFootnotes,
  type TeamStatsColumn,
  type TeamStatsModel,
  type TeamStatsSide,
  type TeamStatsState,
  type TeamStatsTab,
} from "@/lib/stats/team-stats";

interface TeamStatsTableProps {
  model: TeamStatsModel;
  season: number;
  throughWeek: number | null;
  isLatestSeason: boolean;
}

const SIDES: readonly TeamStatsSide[] = ["off", "def"];
const EM_DASH = "—";

/** Column groups for the header's top row: label, tooltip and span. */
function groupsOf(cols: TeamStatsColumn[]): { label: string; tooltip?: string; span: number }[] {
  const out: { label: string; tooltip?: string; span: number }[] = [];
  for (const c of cols) {
    if (c.group || out.length === 0) out.push({ label: c.group ?? "", tooltip: c.tooltip, span: 1 });
    else out[out.length - 1].span += 1;
  }
  return out;
}

export default function TeamStatsTable({ model, season, throughWeek, isLatestSeason }: TeamStatsTableProps) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const [state, setState] = useState<TeamStatsState>(() => parseTeamStatsParams(searchParams));
  const { side, tab } = state;

  const columns = teamStatsColumns(tab, side);
  const sortCol = columns.find((c) => c.key === state.sort) ?? columns[0];
  const rows = sortTeamRows(model.teams, sortCol, side, state.dir);
  const colour = colourOn(model);
  const notes = teamStatsFootnotes({ side, tab, colourOn: colour, season, throughWeek, isLatestSeason });

  function go(next: TeamStatsState) {
    setState(next);
    const qs = buildTeamStatsQuery(next, searchParams);
    router.push(pathname + (qs ? "?" + qs : ""), { scroll: false });
  }

  function handleSort(c: TeamStatsColumn) {
    if (c.key === state.sort) {
      go({ ...state, dir: state.dir === "desc" ? "asc" : "desc" });
    } else {
      go({ ...state, sort: c.key, dir: betterFirstDir(c, side) });
    }
  }

  function switchSide(next: TeamStatsSide) {
    if (next === side) return;
    const cols = teamStatsColumns(tab, next);
    const keep = cols.find((c) => c.key === state.sort) ?? cols.find((c) => c.key === defaultSortKey(tab))!;
    go({ side: next, tab, sort: keep.key, dir: betterFirstDir(keep, next) });
  }

  function switchTab(next: TeamStatsTab) {
    if (next === tab) return;
    const key = defaultSortKey(next);
    const c = teamStatsColumns(next, side).find((x) => x.key === key)!;
    go({ side, tab: next, sort: key, dir: betterFirstDir(c, side) });
  }

  const teamHref = (id: string) => `/team/${id}${isLatestSeason ? "" : `?season=${season}`}`;
  const [noteBefore, noteAfter] = (() => {
    const i = TEAM_TIERS_NOTE.indexOf(TEAM_TIERS_LINK_TEXT);
    return [TEAM_TIERS_NOTE.slice(0, i), TEAM_TIERS_NOTE.slice(i + TEAM_TIERS_LINK_TEXT.length)];
  })();

  const stickyRank = "sticky left-0 z-10 w-10";
  const stickyTeam = "sticky left-10 z-10";

  return (
    <div>
      {/* Controls: side toggle, then tabs */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-3 mb-3">
        <div className="flex rounded-lg border border-gray-200 overflow-hidden self-start">
          {SIDES.map((s) => (
            <button
              key={s}
              type="button"
              aria-pressed={side === s}
              onClick={() => switchSide(s)}
              className={`px-3 py-1.5 text-sm font-medium transition-colors ${
                side === s ? "bg-navy text-white" : "bg-white text-gray-600 hover:bg-gray-50"
              }`}
            >
              {SIDE_LABELS[s]}
            </button>
          ))}
        </div>
        <div className="relative min-w-0">
          <div className="flex gap-1 overflow-x-auto scrollbar-hide" style={{ scrollSnapType: "x mandatory" }}>
            {TEAM_STATS_TABS.map((t) => (
              <button
                key={t}
                type="button"
                aria-pressed={tab === t}
                onClick={() => switchTab(t)}
                style={{ scrollSnapAlign: "start" }}
                className={`px-3 py-1.5 text-sm font-medium rounded-md whitespace-nowrap transition-colors ${
                  tab === t ? "bg-navy text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                }`}
              >
                {TEAM_STATS_TAB_LABELS[t]}
              </button>
            ))}
          </div>
        </div>
      </div>

      <p className="text-sm text-gray-500 mb-2">{SUBTITLE[side]}</p>

      <p className="bg-blue-50 text-navy text-xs rounded-md px-3 py-2 mb-4">
        {noteBefore}
        <Link href="/teams" className="font-semibold underline hover:text-nflred">
          {TEAM_TIERS_LINK_TEXT}
        </Link>
        {noteAfter}
      </p>

      {/* Table */}
      <div className="border border-gray-200 rounded-md overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr>
              <th colSpan={2} className="bg-navy sticky left-0 z-20" />
              <th className="bg-navy" />
              {groupsOf(columns).map((g, i) => (
                <th
                  key={`${g.label}-${i}`}
                  colSpan={g.span}
                  className="bg-navy text-white px-2 pt-2 pb-1 text-center text-[11px] font-semibold uppercase tracking-wide whitespace-nowrap border-l border-white/20"
                >
                  <span className="inline-flex items-center gap-0.5">
                    {g.label}
                    {g.tooltip && <MetricTooltip metric={g.tooltip} />}
                  </span>
                </th>
              ))}
            </tr>
            <tr>
              <th className={`bg-navy text-white px-2 py-2 text-left text-xs font-semibold ${stickyRank} z-20`}><div className="w-6 whitespace-nowrap">#</div></th>
              <th className={`bg-navy text-white px-2 py-2 text-left text-xs font-semibold ${stickyTeam} z-20`}>Team</th>
              <th className="bg-navy text-white px-2 py-2 text-right text-xs font-semibold">GP</th>
              {columns.map((c) => {
                const sorted = c.key === sortCol.key;
                return (
                  <th
                    key={c.key}
                    data-key={c.key}
                    onClick={() => handleSort(c)}
                    className={`${sorted ? "bg-navy/60" : "bg-navy"} text-white px-2 py-2 text-right text-xs font-semibold cursor-pointer hover:bg-navy/70 transition-colors whitespace-nowrap${
                      c.group ? " border-l border-white/20" : ""
                    }`}
                  >
                    {c.label}
                    {sorted && <span className="ml-1">{state.dir === "desc" ? "▼" : "▲"}</span>}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {rows.map((t, i) => {
              const known = getTeam(t.team) !== undefined;
              const rankValue = cellValue(t, sortCol, side);
              const label = (
                <>
                  {known && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={getTeamLogo(t.team)} width={20} height={20} alt="" loading="lazy" className="inline-block" />
                  )}
                  <span className="font-semibold text-navy">{t.team}</span>
                  {known && <span className="hidden sm:inline text-gray-500 font-normal">{t.name}</span>}
                </>
              );
              return (
                <tr key={t.team} data-team={t.team} className="group border-t border-gray-100 hover:bg-gray-50/50">
                  <td className={`px-2 py-2 text-gray-400 font-bold tabular-nums text-xs bg-white group-hover:bg-gray-50 ${stickyRank}`}>
                    <div className="w-6 whitespace-nowrap">{rankValue === null ? EM_DASH : i + 1}</div>
                  </td>
                  <td className={`px-2 py-2 whitespace-nowrap bg-white group-hover:bg-gray-50 ${stickyTeam}`}>
                    {known ? (
                      <Link href={teamHref(t.team)} className="inline-flex items-center gap-1.5 hover:underline">
                        {label}
                      </Link>
                    ) : (
                      <span className="inline-flex items-center gap-1.5">{label}</span>
                    )}
                  </td>
                  <td data-key="gp" className="px-2 py-2 text-right tabular-nums text-gray-700">
                    {t[side].gp}
                  </td>
                  {columns.map((c) => {
                    const v = cellValue(t, c, side);
                    return (
                      <td
                        key={c.key}
                        data-key={c.key}
                        className={`px-2 py-2 text-right tabular-nums ${cellClass(model, c, v, side)}${
                          c.key === sortCol.key ? " font-semibold" : ""
                        }`}
                      >
                        {c.format(v)}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
            <tr data-average="" className="border-t border-gray-200 bg-gray-50 font-semibold text-gray-600">
              <td className={`px-2 py-2 bg-gray-50 ${stickyRank}`}><div className="w-6 whitespace-nowrap" /></td>
              <td className={`px-2 py-2 whitespace-nowrap bg-gray-50 ${stickyTeam}`}>NFL average</td>
              <td className="px-2 py-2" />
              {columns.map((c) => (
                <td key={c.key} data-key={c.key} className="px-2 py-2 text-right tabular-nums">
                  {averageCell(model, c)}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>

      <div data-footnotes="" className="mt-4 text-xs text-gray-400 space-y-1 border-t border-gray-100 pt-3">
        {notes.map((n) => (
          <p key={n}>{n}</p>
        ))}
      </div>
    </div>
  );
}
