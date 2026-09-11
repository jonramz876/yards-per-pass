// components/team/TecmoStandings.tsx — the landing page's standings board,
// Tecmo Super Bowl style: eight division cards, conference-colored pixel bands
// (AFC red, NFC blue), dark navy bodies, four team rows apiece. Replaces the
// old 32-logo grid and keeps its navigation role — every abbreviation links to
// the team page.
//
// Purely presentational: it takes the season's team rows and does the sorting
// and record formatting itself, so the page just hands over what it fetched.
"use client";

import Link from "next/link";
import type { TeamSeasonStat, Team } from "@/lib/types";
import { NFL_TEAMS, DIVISIONS, compareRecords } from "@/lib/data/teams";
import { textColorForBackground } from "@/lib/stats/formatters";

interface TecmoStandingsProps {
  /** Year the records belong to — shown in the sub-label. */
  season: number;
  /**
   * Every team's row for `season`. Empty pre-season (nobody has played), which
   * is exactly the 0-0 board Tecmo would show.
   */
  teamStats: TeamSeasonStat[];
}

const PIXEL = "font-[family-name:var(--font-pixel)]";
const PANEL_BG = "#0f172a";
/** The classic conference colors — NFL AFC red / NFC blue. */
const AFC_BAND = "#C8102E";
const NFC_BAND = "#013369";

/** Record with no row behind it. Pre-season, that's all 32 teams. */
const DEFAULT_RECORD = { wins: 0, losses: 0, ties: 0 };

interface TeamRecord {
  wins: number;
  losses: number;
  ties: number;
}

/**
 * team_id → W/L/T. Non-finite counts (a null column, or parseNumericFields'
 * null → NaN) fall back to 0 so a half-populated row can never print `NaN-NaN`.
 */
function buildRecordMap(teamStats: TeamSeasonStat[]): Map<string, TeamRecord> {
  const map = new Map<string, TeamRecord>();
  for (const t of teamStats) {
    if (!t || typeof t.team_id !== "string") continue;
    map.set(t.team_id, {
      wins: Number.isFinite(t.wins) ? t.wins : 0,
      losses: Number.isFinite(t.losses) ? t.losses : 0,
      ties: Number.isFinite(t.ties) ? t.ties : 0,
    });
  }
  return map;
}

/** "12-5", or "10-6-1" once a tie exists. */
function formatRecord(rec: TeamRecord): string {
  return rec.ties > 0 ? `${rec.wins}-${rec.losses}-${rec.ties}` : `${rec.wins}-${rec.losses}`;
}

function bandColor(division: string): string {
  return division.startsWith("AFC") ? AFC_BAND : NFC_BAND;
}

/* ─── Division card ─── */

function DivisionCard({
  division,
  records,
}: {
  division: string;
  records: Map<string, TeamRecord>;
}) {
  const band = bandColor(division);
  const bandText = textColorForBackground(band);
  const bodyText = textColorForBackground(PANEL_BG);

  // The roster comes from NFL_TEAMS, not from the stats — all four teams show
  // up even when nobody has a row yet (no row = 0-0). Standings order is the
  // shared rule (compareRecords: win %, a tie as half a win, 0-0 = .500, then
  // games over .500); teams with level records fall back to abbreviation A→Z.
  const teams: Team[] = NFL_TEAMS.filter((t) => t.division === division).sort(
    (a, b) =>
      compareRecords(records.get(a.id) ?? DEFAULT_RECORD, records.get(b.id) ?? DEFAULT_RECORD) ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  );

  return (
    <div className="bg-white rounded-xl shadow overflow-hidden" data-division={division}>
      <h3
        className={`${PIXEL} px-2.5 py-2 lg:px-3.5 lg:py-2.5 text-[7px] sm:text-[9px] lg:text-[11px] uppercase tracking-wide`}
        style={{ background: band, color: bandText }}
      >
        {division}
      </h3>
      <div className="p-2 lg:p-3 space-y-1 lg:space-y-1.5" style={{ background: PANEL_BG }}>
        {teams.map((team) => {
          const record = formatRecord(records.get(team.id) ?? DEFAULT_RECORD);
          return (
            <Link
              key={team.id}
              href={`/team/${team.id.toLowerCase()}`}
              title={`${team.name} (${record})`}
              data-team-id={team.id}
              className="flex items-center gap-2 rounded px-1 py-1 hover:bg-white/10 transition-colors"
              style={{ color: bodyText }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={team.logo}
                alt={team.name}
                width={24}
                height={24}
                className="w-5 h-5 lg:w-6 lg:h-6 object-contain shrink-0"
              />
              <span className={`${PIXEL} flex-1 min-w-0 truncate text-[8px] lg:text-[10px]`}>
                {team.abbreviation}
              </span>
              {/* Numbers stay in the regular font (site convention). */}
              <span className="shrink-0 text-[10px] lg:text-xs font-bold tabular-nums">
                {record}
              </span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}

/* ─── Component ─── */

export default function TecmoStandings({ season, teamStats }: TecmoStandingsProps) {
  const records = buildRecordMap(teamStats);

  return (
    <section>
      {/* gray-500, not the gray-400 the old grid's headings used: at 8px pixel
          font this is the one label naming the board, and gray-400 on white
          misses the small-text contrast bar. */}
      <h2
        className={`${PIXEL} mb-3 text-[8px] lg:text-[10px] uppercase tracking-wide text-gray-500`}
      >
        {season} Standings
      </h2>
      {/* AFC divisions fill the first desktop row, NFC the second — DIVISIONS
          is alphabetical, which puts AFC East…NFC West in exactly that order. */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 lg:gap-4">
        {DIVISIONS.map((division) => (
          <DivisionCard key={division} division={division} records={records} />
        ))}
      </div>
    </section>
  );
}
