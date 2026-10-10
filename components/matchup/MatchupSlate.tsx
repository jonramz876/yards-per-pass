// components/matchup/MatchupSlate.tsx — /matchup's slate: this week's games
// as one-tap rows (team matchup spec 2026-10-10 §8). Each row is one link to
// that matchup, away team first. Server component.
//
// prefetch={false} on every row: /matchup/[away]/[home] renders per request,
// and without it next/link would ask the server for each row's page as soon
// as the row is on screen (up to 16 function runs per view of this page).
import Link from "next/link";
import { getTeam } from "@/lib/data/teams";
import { formatKickoff, type MatchupGame } from "@/lib/stats/matchup";
import { matchupHref, parseMatchupTeamId } from "@/lib/stats/matchup-links";

const BARLOW = "font-[family-name:var(--font-barlow)]";
const WRAP = "min-w-0 [overflow-wrap:anywhere]";
const ROW = "flex min-w-0 flex-col gap-0.5 border border-slate-200 border-l-4 border-l-navy bg-white px-3 py-2.5 no-underline";

const EM_DASH = "—";

/** A team id that is really a team, else null (a junk row is printed, never linked). */
const realTeam = (raw: string): string | null => {
  const id = parseMatchupTeamId(raw);
  return id !== null && id === raw && getTeam(id) ? id : null;
};
/**
 * What a row prints for one side: two or three letters, upper-cased, or a
 * dash. Never the raw text: a 300-character id once made this page about
 * 3,000 px too wide (chaos pass on PR 2, finding 5).
 */
const shownId = (raw: unknown): string => parseMatchupTeamId(typeof raw === "string" ? raw : null) ?? EM_DASH;

export default function MatchupSlate({ label, games }: { label: string; games: readonly MatchupGame[] }) {
  return (
    <section data-matchup-slate>
      <h2 className={`${BARLOW} m-0 border-b-2 border-navy pb-2 text-[28px] font-bold uppercase leading-none tracking-[0.03em] text-navy`}>{label}</h2>
      <div data-slate-grid className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3">
        {games.map((game) => {
          const away = realTeam(game.away_team);
          const home = realTeam(game.home_team);
          const when = formatKickoff(game);
          const body = (
            <>
              <span data-slate-pair className={`${BARLOW} ${WRAP} text-[22px] font-bold leading-none tracking-[0.02em] text-navy`}>
                {`${shownId(game.away_team)} at ${shownId(game.home_team)}`}
              </span>
              {when && <span data-slate-when className={`${WRAP} text-[12.5px] text-slate-500`}>{when}</span>}
            </>
          );
          return away && home && away !== home ? (
            <Link key={game.game_id} data-slate-row href={matchupHref(away, home)} prefetch={false} className={`${ROW} hover:border-slate-400 hover:border-l-navy`}>
              {body}
            </Link>
          ) : (
            <div key={game.game_id} data-slate-row className={ROW}>
              {body}
            </div>
          );
        })}
      </div>
    </section>
  );
}
