// components/matchup/MatchupPlayers.tsx — "MAIN PLAYERS": direction C's Tecmo
// player tiles under direction A's section heading (team matchup spec
// 2026-10-10 §8, §7.3a; Jon's pick: "A but with option C's main players
// design"). One group per team, away first: QB, RB, RB, then the four
// receivers. Server component; it prints the model's strings.
//
// The name is the link (it opens the player page) and is never cut short: it
// wraps inside its tile. The tile grid uses counted columns (2 / 4 / 7), not
// auto-fill, so a tile can never push the page wider than the window.
import Link from "next/link";
import { textColorForBackground } from "@/lib/stats/formatters";
import {
  MATCHUP_PLAYERS_UNAVAILABLE,
  lineupByTeam,
  matchupNoPlayersNote,
  type LineupPlayer,
} from "@/lib/stats/matchup";
import type { Team } from "@/lib/types";

const BARLOW = "font-[family-name:var(--font-barlow)]";
const PIXEL = "font-[family-name:var(--font-pixel)]";
const INK = "#0f172a";

interface MatchupPlayersProps {
  away: Team;
  home: Team;
  season: number;
  /** loadMatchup's paired rows; null exactly when the player tables could not be read. */
  lineup: ReadonlyArray<{ away: LineupPlayer | null; home: LineupPlayer | null }> | null;
  playersAvailable: boolean;
}

function Tile({ player, team }: { player: LineupPlayer; team: Team }) {
  const name = "break-words px-[9px] pt-2 text-[15px] font-extrabold leading-tight text-slate-900";
  return (
    <div data-tile className="min-w-0 border-2 border-solid bg-white" style={{ borderColor: INK }}>
      <div
        data-tile-band
        className={`${PIXEL} flex justify-between gap-[6px] border-b-2 border-solid px-2 pb-[6px] pt-2 text-[8.5px] leading-normal`}
        style={{ backgroundColor: team.primaryColor, color: textColorForBackground(team.primaryColor), borderBottomColor: team.secondaryColor }}
      >
        <span data-tile-pos>{player.pos}</span>
        <span data-tile-team>{team.id}</span>
      </div>
      {player.href ? (
        <Link data-tile-name href={player.href} className={`${name} block underline decoration-slate-300 underline-offset-[3px] hover:decoration-slate-900`}>
          {player.name}
        </Link>
      ) : (
        <div data-tile-name className={name}>{player.name}</div>
      )}
      <dl className="m-0 grid grid-cols-2 gap-x-2 gap-y-[6px] px-[9px] pb-[10px] pt-2">
        {player.stats.map((stat) => (
          <div key={stat.label} className="min-w-0">
            <dt className="text-[11.5px] leading-tight text-slate-500">{stat.label}</dt>
            <dd className="m-0 text-[14.5px] font-bold tabular-nums text-slate-900">{stat.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function TeamGroup({ team, players, season }: { team: Team; players: LineupPlayer[]; season: number }) {
  return (
    <div data-team-group={team.id} className="mt-4">
      <div className="mb-[10px] flex items-center gap-2">
        <i className="inline-block h-[14px] w-[14px] shrink-0 border-2 border-solid" style={{ backgroundColor: team.primaryColor, borderColor: INK }} />
        <span data-team-heading className={`${BARLOW} min-w-0 text-[20px] font-bold leading-none tracking-[0.02em] text-slate-900`}>{team.name}</span>
      </div>
      {players.length > 0 ? (
        <div data-tiles className="grid grid-cols-2 gap-[10px] md:grid-cols-4 md:gap-3 xl:grid-cols-7 xl:gap-[10px]">
          {players.map((player) => (
            <Tile key={`${player.slot}-${player.playerId}`} player={player} team={team} />
          ))}
        </div>
      ) : (
        <p data-no-players className="m-0 text-[14px] text-slate-600">{matchupNoPlayersNote(team.name, season)}</p>
      )}
    </div>
  );
}

export default function MatchupPlayers({ away, home, season, lineup, playersAvailable }: MatchupPlayersProps) {
  const teams = lineupByTeam(lineup);
  return (
    <section data-matchup-players>
      <h2 className={`${BARLOW} m-0 border-b-2 border-navy pb-2 text-[28px] font-bold leading-none tracking-[0.03em] text-navy`}>MAIN PLAYERS</h2>
      {playersAvailable && lineup ? (
        <>
          <TeamGroup team={away} players={teams.away} season={season} />
          <TeamGroup team={home} players={teams.home} season={season} />
        </>
      ) : (
        <p data-players-unavailable className="m-0 mt-4 text-[14px] text-slate-600">{MATCHUP_PLAYERS_UNAVAILABLE}</p>
      )}
    </section>
  );
}
