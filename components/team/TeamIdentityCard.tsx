// components/team/TeamIdentityCard.tsx — Tecmo page header.
// Team-color pixel band (name left, division right) over a body row of logo +
// two pixel lines: the record with division rank, then league ranks and the
// turnover differential. Before week 1 `teamStats` is null (schedules backfill
// ahead of any stats) — the two pixel lines are then omitted entirely so the
// header never shows `undefined`/`NaN`.
"use client";

import Image from "next/image";
import type { Team, TeamSeasonStat } from "@/lib/types";
import { textColorForBackground } from "@/lib/stats/formatters";
import { ordinal } from "@/lib/stats/percentiles";
import { NFL_TEAMS, compareRecords } from "@/lib/data/teams";

interface TeamIdentityCardProps {
  team: Team;
  /** Null before the season's first game is scored. */
  teamStats: TeamSeasonStat | null;
  allTeamStats: TeamSeasonStat[];
}

const PIXEL = "font-[family-name:var(--font-pixel)]";

/** `+9` / `-3` — plain ASCII sign so the pixel font always has the glyph. */
function signed(value: number): string {
  return value >= 0 ? `+${value}` : `${value}`;
}

/**
 * League rank, 1 = best. `ascending` ranks lowest-first (defensive EPA).
 * Competition ranking: tied teams share the better rank. Returns null when the
 * team is missing from the pool or its value isn't a real number (`parseNumericFields`
 * turns nulls into NaN).
 */
function leagueRank(
  allStats: TeamSeasonStat[],
  teamId: string,
  getValue: (t: TeamSeasonStat) => number,
  ascending: boolean
): number | null {
  const self = allStats.find((t) => t.team_id === teamId);
  if (!self) return null;
  const value = getValue(self);
  if (!Number.isFinite(value)) return null;

  const ahead = allStats.filter((t) => {
    const other = getValue(t);
    if (!Number.isFinite(other)) return false;
    return ascending ? other < value : other > value;
  }).length;
  return ahead + 1;
}

/**
 * Place in the division, standings-style (compareRecords: win %, a tie as half
 * a win, 0-0 = .500). The field is all four teams from NFL_TEAMS — a rival
 * with no stats row yet counts as 0-0, so a partially-populated allTeamStats
 * can't shrink it. Competition ranking: teams with level records share the
 * better place — 11-6 / 9-7-1 / 9-8 / 9-8 reads 1st/2nd/3rd/3rd.
 */
function divisionRank(allStats: TeamSeasonStat[], team: Team): number | null {
  const self = allStats.find((t) => t.team_id === team.id);
  if (!self || !Number.isFinite(self.wins)) return null;

  const ahead = NFL_TEAMS.filter(
    (t) =>
      t.division === team.division &&
      t.id !== team.id &&
      compareRecords(allStats.find((s) => s.team_id === t.id), self) < 0
  ).length;
  return ahead + 1;
}

/** "12-5" / "9-7-1" — null when the W/L numbers aren't usable. */
function formatRecord(stats: TeamSeasonStat): string | null {
  const { wins, losses, ties } = stats;
  if (!Number.isFinite(wins) || !Number.isFinite(losses)) return null;
  const t = Number.isFinite(ties) ? ties : 0;
  return t > 0 ? `${wins}-${losses}-${t}` : `${wins}-${losses}`;
}

export default function TeamIdentityCard({
  team,
  teamStats,
  allTeamStats,
}: TeamIdentityCardProps) {
  const bandText = textColorForBackground(team.primaryColor);

  // Line 1: "12-5 · 2ND AFC EAST" — either half may drop out on its own.
  const record = teamStats ? formatRecord(teamStats) : null;
  const divRank = teamStats ? divisionRank(allTeamStats, team) : null;
  const recordLine =
    [record, divRank ? `${ordinal(divRank)} ${team.division}` : null]
      .filter(Boolean)
      .join(" · ") || null;

  // Line 2: "OFF EPA 3RD · DEF EPA 11TH · TO DIFF +9"
  const offEpaRank = teamStats
    ? leagueRank(allTeamStats, team.id, (t) => t.off_epa_play, false)
    : null;
  // Defense: lower (more negative) EPA is better, so rank ascending.
  const defEpaRank = teamStats
    ? leagueRank(allTeamStats, team.id, (t) => t.def_epa_play, true)
    : null;
  const toDiff = teamStats?.turnover_diff;
  const rankLine =
    [
      offEpaRank ? `Off EPA ${ordinal(offEpaRank)}` : null,
      defEpaRank ? `Def EPA ${ordinal(defEpaRank)}` : null,
      typeof toDiff === "number" && Number.isFinite(toDiff)
        ? `TO Diff ${signed(toDiff)}`
        : null,
    ]
      .filter(Boolean)
      .join(" · ") || null;

  return (
    <div className="bg-white rounded-xl shadow overflow-hidden">
      {/* Team band */}
      <div
        className={`${PIXEL} flex items-center justify-between gap-2 px-3 py-2.5 lg:px-5 lg:py-3 text-[7px] sm:text-[9px] lg:text-[11px] uppercase tracking-wide`}
        style={{
          background: team.primaryColor,
          color: bandText,
          borderBottom: `2px solid ${team.secondaryColor}`,
        }}
      >
        <h2 className="min-w-0 truncate">{team.name}</h2>
        {/* team.division already carries the conference ("AFC East") */}
        <span className="shrink-0 text-right">{team.division}</span>
      </div>

      <div className="flex items-center gap-4 p-4 lg:px-5 lg:py-5">
        <Image
          src={team.logo}
          alt={team.name}
          width={56}
          height={56}
          className="w-11 h-11 lg:w-14 lg:h-14 object-contain flex-shrink-0"
        />

        {(recordLine || rankLine) && (
          <div className="min-w-0">
            {recordLine && (
              <div className={`${PIXEL} text-[8px] sm:text-[9px] lg:text-[11px] text-navy uppercase leading-relaxed`}>
                {recordLine}
              </div>
            )}
            {rankLine && (
              <div className={`${PIXEL} mt-1.5 text-[6px] lg:text-[8px] text-slate-500 uppercase leading-relaxed`}>
                {rankLine}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
