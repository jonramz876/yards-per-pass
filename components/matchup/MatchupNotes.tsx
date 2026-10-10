// components/matchup/MatchupNotes.tsx — the footnotes under a matchup (team
// matchup spec 2026-10-10 §8.5, M6-M11): what every rank is among, how ties
// are numbered, the edge rule, which EPA family the numbers are, the
// formulas, who the players are, and the early-season line. Server component.
// Every sentence is a tested constant from lib/stats, printed as it is.
import type { ReactNode } from "react";
import Link from "next/link";
import {
  MATCHUP_FAMILY_NOTE,
  MATCHUP_FORMULA_LINE,
  MATCHUP_FORMULA_NOTES,
  MATCHUP_PLAYERS_NOTE,
  MATCHUP_TEAM_STATS_LINK_TEXT,
  MATCHUP_TEAM_TIERS_LINK_TEXT,
  MATCHUP_TIES_NOTE,
  matchupEdgeNote,
  matchupRankNote,
  type MatchupModel,
} from "@/lib/stats/matchup";
import { earlySeasonNote } from "@/lib/stats/team-stats";

const LINK = "font-semibold text-slate-700 underline decoration-slate-300 underline-offset-2 hover:decoration-slate-700";

/** M8 with its two link texts turned into links; the sentence itself is unchanged. */
function familyNote(): ReactNode[] {
  const links: [string, string][] = [
    [MATCHUP_TEAM_STATS_LINK_TEXT, "/team-stats"],
    [MATCHUP_TEAM_TIERS_LINK_TEXT, "/teams"],
  ];
  const out: ReactNode[] = [];
  let rest = MATCHUP_FAMILY_NOTE;
  for (const [text, href] of links) {
    const at = rest.indexOf(text);
    if (at < 0) continue;
    out.push(rest.slice(0, at));
    out.push(
      <Link key={href} href={href} className={LINK}>
        {text}
      </Link>,
    );
    rest = rest.slice(at + text.length);
  }
  out.push(rest);
  return out;
}

export default function MatchupNotes({ model, isLatestSeason }: { model: MatchupModel; isLatestSeason: boolean }) {
  // Under 8 teams the page prints no rank and no edge, so the notes about them are left out.
  const ranked = model.state === "ready";
  const early = earlySeasonNote(model.throughWeek, isLatestSeason);
  return (
    <div data-matchup-notes className="grid max-w-[100ch] gap-[6px] text-[12.5px] leading-relaxed text-slate-500">
      {ranked && (
        <>
          <p data-note="ranks" className="m-0">
            {matchupRankNote({
              teamsPlayed: model.teamsPlayed,
              season: model.season,
              throughWeek: model.throughWeek,
              awayId: model.away.id,
              homeId: model.home.id,
              awayGames: model.away.games,
              homeGames: model.home.games,
            })}
          </p>
          <p data-note="ties" className="m-0">{MATCHUP_TIES_NOTE}</p>
          <p data-note="edge" className="m-0">{matchupEdgeNote()}</p>
          <p data-note="family" className="m-0">{familyNote()}</p>
          {MATCHUP_FORMULA_NOTES.map((note, i) => (
            <p key={i} data-note="formula" className="m-0">{note}</p>
          ))}
          <p data-note="formula-line" className="m-0">{MATCHUP_FORMULA_LINE}</p>
        </>
      )}
      <p data-note="players" className="m-0">{MATCHUP_PLAYERS_NOTE}</p>
      {early && <p data-note="early" className="m-0">{early}</p>}
    </div>
  );
}
