// components/matchup/MatchupHeader.tsx — direction A's header (team matchup
// spec 2026-10-10 §8): two team slabs in team colour (big id, nickname,
// record), and between them "AT" with the week and the kickoff, or "VS" when
// the two teams have no game in the season. No logo. Server component.
//
// Colour: a slab is the team's own primary, passed in as data (a red team's
// slab is red because it is that team). "AT" is navy: the site's red has one
// job on these pages, a rank gap of 5 or more, and it has no job here.
import Link from "next/link";
import { formatRecord, type WinLossTie } from "@/lib/stats/box-score";
import { textColorForBackground } from "@/lib/stats/formatters";
import { formatKickoff, gameWeekLabel, matchupNoGameText, type MatchupGame } from "@/lib/stats/matchup";
import type { Team } from "@/lib/types";

const BARLOW = "font-[family-name:var(--font-barlow)]";
const PIXEL = "font-[family-name:var(--font-pixel)]";

/**
 * The team id's size in px, below md and from md (spec §8.4). Barlow
 * Condensed capitals are held to 0.60 em: "WAS" is 90 px in a slab with
 * 124 px of text room at 320, and 130 px in 189 px at 768. The class string
 * below carries the same two numbers as literals.
 */
export const HEADER_ID_SM = 50;
export const HEADER_ID_MD = 72;

const BACK_TEXT = "← This week’s matchups";

interface MatchupHeaderProps {
  away: Team;
  home: Team;
  season: number;
  defaultSeason: number;
  /** The pair's game in this order in the season; null when there is none, or the games could not be read. */
  game: MatchupGame | null;
  /** Played regular-season records; null when the games could not be read. */
  records: { away: WinLossTie; home: WinLossTie } | null;
  gamesAvailable: boolean;
}

/** "Buffalo Bills" → "Bills", "San Francisco 49ers" → "49ers" (the box score page's rule). */
const nickname = (name: string) => name.trim().split(/\s+/).pop() ?? name;

function Slab({
  team,
  side,
  href,
  record,
  venue,
}: {
  team: Team;
  side: "away" | "home";
  href: string;
  record: WinLossTie | null;
  /** Print "· away" / "· home" after the record: only when the pair has a game (a "VS" page has no venue). */
  venue: boolean;
}) {
  return (
    <Link
      data-slab={side}
      href={href}
      prefetch={false}
      className={`block min-w-0 border-b-[5px] border-solid px-3 pb-[10px] pt-3 no-underline md:px-[22px] md:pb-[14px] md:pt-4 ${side === "home" ? "text-right" : ""}`}
      style={{ backgroundColor: team.primaryColor, color: textColorForBackground(team.primaryColor), borderBottomColor: team.secondaryColor }}
    >
      <span data-slab-id className={`${BARLOW} block text-[50px] md:text-[72px] font-bold leading-[0.86] tracking-[0.01em]`}>
        {team.id}
      </span>
      <span data-slab-nick className={`${BARLOW} mt-1.5 block break-words text-[15px] font-semibold uppercase tracking-[0.05em] md:text-[21px]`}>
        {nickname(team.name)}
      </span>
      {record && (
        <span data-slab-record className="mt-0.5 block text-[13px] font-semibold opacity-90">
          {venue ? `${formatRecord(record)} · ${side}` : formatRecord(record)}
        </span>
      )}
    </Link>
  );
}

export default function MatchupHeader({ away, home, season, defaultSeason, game, records, gamesAvailable }: MatchupHeaderProps) {
  const teamHref = (id: string) => `/team/${id}${season === defaultSeason ? "" : `?season=${season}`}`;
  const week = game ? gameWeekLabel(game) : "";
  const kickoff = game ? formatKickoff(game) : "";

  return (
    <div>
      <Link data-matchup-back href="/matchup" className="text-[13px] font-medium text-slate-500 hover:text-navy">
        {BACK_TEXT}
      </Link>
      <div data-matchup-header className="mt-2 grid grid-cols-2 bg-white md:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]">
        <Slab team={away} side="away" href={teamHref(away.id)} record={records?.away ?? null} venue={game !== null} />
        <div
          data-middle
          className="order-last col-span-2 flex min-w-0 flex-row flex-wrap items-center justify-center gap-x-[10px] gap-y-1 border-b border-slate-200 px-[10px] py-[9px] text-center md:order-none md:col-span-1 md:flex-col md:gap-0 md:border-t md:px-[18px] md:py-2"
        >
          <b data-at className={`${PIXEL} text-[13px] font-normal text-navy`}>{game ? "AT" : "VS"}</b>
          {week && (
            <span data-week className={`${BARLOW} text-[17px] font-semibold uppercase tracking-[0.04em] text-navy md:mt-2`}>{week}</span>
          )}
          {kickoff && (
            <small data-kickoff className="text-[12px] text-slate-500 md:mt-0.5 md:whitespace-nowrap">{kickoff}</small>
          )}
          {!game && gamesAvailable && (
            <small data-no-game className="max-w-[16ch] text-[12px] leading-snug text-slate-500 md:mt-2">{matchupNoGameText(season)}</small>
          )}
        </div>
        <Slab team={home} side="home" href={teamHref(home.id)} record={records?.home ?? null} venue={game !== null} />
      </div>
    </div>
  );
}
