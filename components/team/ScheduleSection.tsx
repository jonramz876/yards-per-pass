// components/team/ScheduleSection.tsx — "Tecmo Season Grid" schedule & results.
// One chunky tile per game: green won, red lost, navy upcoming (the next game
// gets a bright border), dashed for the bye. Mirrors the Tecmo conventions from
// PlayerFieldHeatMap — team-color pixel band, dark navy panel, pixel font for
// LABELS only (numbers stay in the regular font), auto text color everywhere.
"use client";

import Link from "next/link";
import type { TeamGame, TeamSeasonStat } from "@/lib/types";
import { textColorForBackground } from "@/lib/stats/formatters";
import { getTeam } from "@/lib/data/teams";

interface ScheduleSectionProps {
  schedule: TeamGame[];
  teamName: string;
  primaryColor: string;
  secondaryColor: string;
  /** Null before week 1 — the record segment of the band is then omitted. */
  teamStats: TeamSeasonStat | null;
  /**
   * Set when `schedule` is NEXT season's slate (pre-surfaced before week 1).
   * The band then reads `SCHEDULE · {year}` and drops the record entirely — the
   * record belongs to the viewed stats season, not to the season being shown.
   */
  upcomingSeason?: number;
}

const PIXEL = "font-[family-name:var(--font-pixel)]";
const PANEL_BG = "#0f172a";

/* ─── Tile palettes (fixed constants, so their paired accents are safe) ─── */
interface TileSkin {
  bg: string;
  border: string;
  /** Color of the score line; only used by played tiles. */
  accent?: string;
}

const WIN_TILE: TileSkin = { bg: "#14532d", border: "#4ade80", accent: "#4ade80" };
const LOSS_TILE: TileSkin = { bg: "#7f1d1d", border: "#f87171", accent: "#f87171" };
// Ties get a lighter slate than `upcoming` so a played tie never reads as a
// game that hasn't kicked off yet.
const TIE_TILE: TileSkin = { bg: "#334155", border: "#64748b", accent: "#e2e8f0" };
const UPCOMING_TILE: TileSkin = { bg: "#1e293b", border: "#334155" };
const BYE_TILE: TileSkin = { bg: "#111c30", border: "#334155" };
/** Border that marks the next unplayed game. */
const NEXT_BORDER = "#60a5fa";

/* ─── Playoff rounds (nflverse game_type codes) ─── */
const ROUND_NAMES: Record<string, string> = {
  WC: "Wild Card",
  DIV: "Divisional",
  CON: "Conference Championship",
  SB: "Super Bowl",
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-09-13" → [2026, 9, 13]. Parsed by hand: `new Date("2026-09-13")` is
 *  UTC midnight, which renders as the PREVIOUS day for anyone west of London. */
function dateParts(gameday: string | null): { m: number; d: number } | null {
  if (!gameday) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(gameday.trim());
  if (!match) return null;
  const m = Number(match[2]);
  const d = Number(match[3]);
  if (!m || m > 12 || !d || d > 31) return null;
  return { m, d };
}

/** "2026-09-13" → "9/13" */
function shortDate(gameday: string | null): string | null {
  const p = dateParts(gameday);
  return p ? `${p.m}/${p.d}` : null;
}

/** "2026-09-27" → "Sep 27" */
function longDate(gameday: string | null): string | null {
  const p = dateParts(gameday);
  return p ? `${MONTHS[p.m - 1]} ${p.d}` : null;
}

/**
 * "13:00" (24h ET) → "1:00". TIME FORMAT CHOICE: 12-hour, minutes kept, NO
 * am/pm — matching the mockup's `SUN 1:00` / `MON 8:15`. NFL kickoffs are
 * unambiguous at a glance and the tile is 6px wide-ish; ET is implied site-wide.
 * The tooltip spells out the full `1:00 PM ET` for anyone who wants it.
 */
function kickoffShort(gametime: string | null): string | null {
  const parsed = parseTime(gametime);
  return parsed ? `${parsed.h12}:${parsed.min}` : null;
}

/** "20:15" → "8:15 PM ET" (tooltip form). */
function kickoffLong(gametime: string | null): string | null {
  const parsed = parseTime(gametime);
  return parsed ? `${parsed.h12}:${parsed.min} ${parsed.meridiem} ET` : null;
}

function parseTime(gametime: string | null): { h12: number; min: string; meridiem: string } | null {
  if (!gametime) return null;
  const match = /^(\d{1,2}):(\d{2})/.exec(gametime.trim());
  if (!match) return null;
  const h24 = Number(match[1]);
  if (!Number.isFinite(h24) || h24 > 23) return null;
  return {
    h12: h24 % 12 === 0 ? 12 : h24 % 12,
    min: match[2],
    meridiem: h24 < 12 ? "AM" : "PM",
  };
}

/** "Sunday" → "SUN" (tile) / "Sun" (tooltip). */
function shortWeekday(weekday: string | null): string | null {
  if (!weekday) return null;
  const trimmed = weekday.trim();
  return trimmed ? trimmed.slice(0, 3) : null;
}

/** "12-5" / "9-7-1" — null when the record isn't usable yet. */
function formatRecord(stats: TeamSeasonStat | null): string | null {
  if (!stats) return null;
  const { wins, losses, ties } = stats;
  if (!Number.isFinite(wins) || !Number.isFinite(losses)) return null;
  const t = Number.isFinite(ties) ? ties : 0;
  return t > 0 ? `${wins}-${losses}-${t}` : `${wins}-${losses}`;
}

/** Tile's short label: `W1` for a regular-season week, `WC`/`SB` for playoffs. */
function tileLabel(game: TeamGame): string {
  return game.game_type === "REG" ? `W${game.week}` : game.game_type.toUpperCase();
}

/** Tooltip's long label: `Week 3` / `Wild Card`. */
function longLabel(game: TeamGame): string {
  if (game.game_type === "REG") return `Week ${game.week}`;
  return ROUND_NAMES[game.game_type.toUpperCase()] ?? game.game_type.toUpperCase();
}

/** "Week 3 · Sun Sep 27, 1:00 PM ET · vs Los Angeles Chargers · Final: W 27-20" */
function gameTitle(game: TeamGame): string {
  const parts: string[] = [longLabel(game)];

  const day = shortWeekday(game.weekday);
  const date = longDate(game.gameday);
  const time = kickoffLong(game.gametime);
  const when = [day, date].filter(Boolean).join(" ");
  if (when && time) parts.push(`${when}, ${time}`);
  else if (when) parts.push(when);
  else if (time) parts.push(time);

  const oppName = getTeam(game.opponent_id)?.name ?? game.opponent_id;
  parts.push(`${game.home_away === "home" ? "vs" : "at"} ${oppName}`);

  if (game.played) {
    parts.push(`Final: ${game.result} ${game.team_score}-${game.opponent_score}`);
  }
  return parts.join(" · ");
}

function skinFor(game: TeamGame): TileSkin {
  if (!game.played) return UPCOMING_TILE;
  if (game.result === "W") return WIN_TILE;
  if (game.result === "L") return LOSS_TILE;
  return TIE_TILE;
}

function stateFor(game: TeamGame): string {
  if (!game.played) return "upcoming";
  if (game.result === "W") return "win";
  if (game.result === "L") return "loss";
  return "tie";
}

/* ─── Tiles ─── */

function GameTile({ game, isNext }: { game: TeamGame; isNext: boolean }) {
  const skin = skinFor(game);
  const fg = textColorForBackground(skin.bg);
  const border = isNext && !game.played ? NEXT_BORDER : skin.border;
  const date = shortDate(game.gameday);
  const day = shortWeekday(game.weekday);
  const time = kickoffShort(game.gametime);

  return (
    <div
      data-game-id={game.game_id}
      data-state={stateFor(game)}
      data-next={isNext ? "true" : undefined}
      title={gameTitle(game)}
      className="rounded-md border-2 px-1 py-1.5 lg:py-2 text-center overflow-hidden"
      style={{ background: skin.bg, borderColor: border, color: fg }}
    >
      {/* Week label (pixel) + date (regular font — it's a number) */}
      <div className="flex items-baseline justify-center gap-1 leading-none">
        <span className={`${PIXEL} text-[6px] lg:text-[8px] opacity-80`}>{tileLabel(game)}</span>
        {date && <span className="text-[8px] lg:text-[10px] opacity-70">{date}</span>}
      </div>

      {/* Opponent — links to their team page */}
      <div className={`${PIXEL} mt-1.5 text-[8px] lg:text-[10px] leading-none`}>
        <Link href={`/team/${game.opponent_id}`} className="hover:underline">
          {game.home_away === "away" ? "@" : ""}
          {game.opponent_id}
        </Link>
      </div>

      {game.played ? (
        <div
          className="mt-1.5 flex items-baseline justify-center gap-1 leading-none"
          style={{ color: skin.accent }}
        >
          <span className={`${PIXEL} text-[7px] lg:text-[9px]`}>{game.result}</span>
          <span className="text-[10px] lg:text-xs font-bold">
            {game.team_score}-{game.opponent_score}
          </span>
        </div>
      ) : (
        // Kickoff line is dropped entirely when the game has no scheduled time.
        time && (
          <div className="mt-1.5 flex items-baseline justify-center gap-1 leading-none opacity-75">
            {day && <span className={`${PIXEL} text-[6px] lg:text-[8px]`}>{day.toUpperCase()}</span>}
            <span className="text-[8px] lg:text-[10px]">{time}</span>
          </div>
        )
      )}
    </div>
  );
}

function ByeTile({ week }: { week: number }) {
  const fg = textColorForBackground(BYE_TILE.bg);
  return (
    <div
      data-bye-week={week}
      title={`Week ${week} · Bye week`}
      className="rounded-md border-2 border-dashed px-1 py-1.5 lg:py-2 text-center overflow-hidden"
      style={{ background: BYE_TILE.bg, borderColor: BYE_TILE.border, color: fg }}
    >
      <div className={`${PIXEL} text-[6px] lg:text-[8px] opacity-50 leading-none`}>W{week}</div>
      <div className={`${PIXEL} mt-1.5 text-[8px] lg:text-[10px] opacity-60 leading-none`}>BYE</div>
    </div>
  );
}

/* ─── Component ─── */
export default function ScheduleSection({
  schedule,
  teamName,
  primaryColor,
  secondaryColor,
  teamStats,
  upcomingSeason,
}: ScheduleSectionProps) {
  // No schedule rows (pre-backfill season) → the section is omitted entirely.
  if (schedule.length === 0) return null;

  const regGames = schedule.filter((g) => g.game_type === "REG");
  const postGames = schedule
    .filter((g) => g.game_type !== "REG")
    .sort((a, b) => a.week - b.week);

  // BYE RULE: weeks 1..max(REG week) that the team has no REG game in. Scoped
  // to REG rows so playoff weeks (19-22) can't invent phantom byes, and so a
  // 17-week season (2020) needs no hardcoded 18.
  const regWeeks = new Set(regGames.map((g) => g.week));
  const maxRegWeek = regGames.reduce((max, g) => Math.max(max, g.week), 0);

  // The next unplayed game in schedule order gets the bright border.
  const ordered = [...regGames.sort((a, b) => a.week - b.week), ...postGames];
  const nextGameId = ordered.find((g) => !g.played)?.game_id ?? null;

  // Regular-season tiles in week order, with byes interleaved at their week.
  const regTiles: React.ReactNode[] = [];
  for (let week = 1; week <= maxRegWeek; week++) {
    if (regWeeks.has(week)) {
      for (const game of regGames.filter((g) => g.week === week)) {
        regTiles.push(
          <GameTile key={game.game_id} game={game} isNext={game.game_id === nextGameId} />
        );
      }
    } else {
      regTiles.push(<ByeTile key={`bye-${week}`} week={week} />);
    }
  }

  // Showing next season's slate: no games are scored yet in it, so the record —
  // which belongs to the viewed stats season — would be misleading beside it.
  const isUpcoming = upcomingSeason !== undefined;
  const record = isUpcoming ? null : formatRecord(teamStats);
  const bandText = textColorForBackground(primaryColor);

  return (
    <div className="bg-white rounded-xl shadow overflow-hidden">
      {/* Team band */}
      <div
        className={`${PIXEL} flex items-center justify-between gap-2 px-3 py-2.5 lg:px-5 lg:py-3 text-[7px] sm:text-[9px] lg:text-[11px] uppercase tracking-wide`}
        style={{ background: primaryColor, color: bandText, borderBottom: `2px solid ${secondaryColor}` }}
      >
        <span className="shrink-0">
          {isUpcoming ? `Schedule · ${upcomingSeason}` : "Schedule & Results"}
        </span>
        {/* Record omitted before any games are scored (teamStats null pre-season)
            and always on an upcoming-season slate. */}
        {record && <span className="shrink-0 text-right">{record}</span>}
      </div>

      {/* Dark season grid */}
      <div
        className="p-3 lg:p-4 grid grid-cols-3 sm:grid-cols-6 gap-1.5 lg:gap-2"
        style={{ background: PANEL_BG }}
        aria-label={`${teamName} schedule and results`}
      >
        {regTiles}
        {/* Playoff tiles append after the regular-season grid */}
        {postGames.map((game) => (
          <GameTile key={game.game_id} game={game} isNext={game.game_id === nextGameId} />
        ))}
      </div>
    </div>
  );
}
