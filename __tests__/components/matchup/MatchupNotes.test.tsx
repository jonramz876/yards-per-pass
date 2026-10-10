// The footnotes (team matchup spec §8.5, M6-M11): what the ranks are among,
// the edge rule, which EPA family, the formulas, who the players are, and the
// early-season line. Every sentence is a tested constant printed as it is.
import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

import MatchupNotes from "@/components/matchup/MatchupNotes";
import {
  MATCHUP_FAMILY_NOTE, MATCHUP_FORMULA_LINE, MATCHUP_FORMULA_NOTES, MATCHUP_PLAYERS_NOTE, MATCHUP_TIES_NOTE,
  matchupEdgeNote, matchupRankNote, type MatchupModel,
} from "@/lib/stats/matchup";
import { earlySeasonNote } from "@/lib/stats/team-stats";
import { ROWS, model } from "./helpers";

const show = (m: MatchupModel, isLatestSeason = true) => render(<MatchupNotes model={m} isLatestSeason={isLatestSeason} />).container;
const text = (el: HTMLElement) => Array.from(el.querySelectorAll("[data-note]")).map((p) => p.textContent);
const M = model("BUF", "HOU");

describe("MatchupNotes (ready)", () => {
  it("M6 with its numbers: teams played, the week, both teams' game counts", () => {
    const el = show(M);
    const expected = matchupRankNote({
      teamsPlayed: M.teamsPlayed, season: 2026, throughWeek: M.throughWeek, awayId: "BUF", homeId: "HOU",
      awayGames: M.away.games, homeGames: M.home.games,
    });
    expect(el.querySelector('[data-note="ranks"]')?.textContent).toBe(expected);
    expect(expected).toContain("all 32 teams in 2026, through Week 3");
    expect(expected).toContain("(BUF has played 3 games, HOU 3)");
  });

  it("M6 says how many teams have played when it is fewer than 32", () => {
    const some = Array.from(new Set(ROWS.map((r) => r.team_id as string))).sort().slice(0, 20);
    const m = model("BUF", "HOU", ROWS.filter((r) => some.includes(r.team_id as string)));
    expect(m.state).toBe("ready");
    expect(show(m).querySelector('[data-note="ranks"]')?.textContent).toContain(`the ${m.teamsPlayed} teams that have played in 2026`);
  });

  it("the ties sentence sits right after M6, then M7", () => {
    const el = show(M);
    const order = Array.from(el.querySelectorAll("[data-note]")).map((p) => p.getAttribute("data-note"));
    expect(order.slice(0, 3)).toEqual(["ranks", "ties", "edge"]);
    expect(el.querySelector('[data-note="ties"]')?.textContent).toBe(MATCHUP_TIES_NOTE);
    expect(el.querySelector('[data-note="edge"]')?.textContent).toBe(matchupEdgeNote());
  });

  it("M8 whole, with its two links: Team Stats → /team-stats, Team Tiers → /teams", () => {
    const el = show(M);
    const p = el.querySelector('[data-note="family"]')!;
    expect(p.textContent).toBe(MATCHUP_FAMILY_NOTE);
    const links = Array.from(p.querySelectorAll("a")).map((a) => [a.textContent, a.getAttribute("href")]);
    expect(links).toEqual([["Team Stats", "/team-stats"], ["Team Tiers", "/teams"]]);
  });

  it("M9: the three existing notes and the formula line, unchanged", () => {
    const got = text(show(M));
    for (const note of MATCHUP_FORMULA_NOTES) expect(got).toContain(note);
    expect(MATCHUP_FORMULA_NOTES).toHaveLength(3);
    expect(got).toContain(MATCHUP_FORMULA_LINE);
  });

  it("M10: who the players are", () => {
    expect(show(M).querySelector('[data-note="players"]')?.textContent).toBe(MATCHUP_PLAYERS_NOTE);
  });

  it("M11 only in weeks 1-4 of the newest season", () => {
    expect(M.throughWeek).toBe(3);
    expect(show(M, true).querySelector('[data-note="early"]')?.textContent).toBe(earlySeasonNote(3, true));
    expect(show(M, false).querySelector('[data-note="early"]')).toBeNull();
    expect(show({ ...M, throughWeek: 5 }, true).querySelector('[data-note="early"]')).toBeNull();
    expect(show({ ...M, throughWeek: null }, true).querySelector('[data-note="early"]')).toBeNull();
  });

  it("never promises a result", () => {
    expect(show(M).textContent).not.toMatch(/projected|will win|favou?red/i);
  });
});

describe("MatchupNotes (small-pool): no rank is printed on the page, so no rank or edge note", () => {
  const seven = Array.from(new Set(ROWS.map((r) => r.team_id as string))).sort().slice(0, 7);
  const m = model("BUF", "HOU", ROWS.filter((r) => seven.includes(r.team_id as string)));
  it("only the players note and the early-season line", () => {
    expect(m.state).toBe("small-pool");
    const el = show(m);
    const order = Array.from(el.querySelectorAll("[data-note]")).map((p) => p.getAttribute("data-note"));
    expect(order).toEqual(["players", "early"]);
  });
});
