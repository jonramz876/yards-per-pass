// The matchup link on a team page's schedule tiles (team matchup spec
// 2026-10-10 §9): an unplayed tile's kickoff line opens /matchup/AWAY/HOME.
// Only with the OPTIONAL `defaultSeason` prop: without it no tile links and
// the section renders exactly as before (ScheduleSection.test.tsx, untouched,
// proves that; none of its tests passes the prop).
import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";

vi.mock("next/link", () => ({
  default: ({ href, children, prefetch, ...rest }: { href: string; children: React.ReactNode; prefetch?: boolean }) => (
    <a href={href} data-prefetch={prefetch === undefined ? undefined : String(prefetch)} {...rest}>
      {children}
    </a>
  ),
}));

import ScheduleSection from "@/components/team/ScheduleSection";
import type { TeamGame, TeamSeasonStat } from "@/lib/types";

function game(week: number, o: Partial<TeamGame> = {}): TeamGame {
  const opponent = o.opponent_id ?? "HOU";
  const homeAway = o.home_away ?? "home";
  const base: TeamGame = {
    game_id: `2026_${String(week).padStart(2, "0")}_BUF_${opponent}`,
    season: 2026, game_type: "REG", week, gameday: "2026-10-11", weekday: "Sunday", gametime: "13:00",
    home_team: homeAway === "home" ? "BUF" : opponent,
    away_team: homeAway === "home" ? opponent : "BUF",
    home_score: null, away_score: null, opponent_id: opponent, home_away: homeAway,
    played: false, result: null, team_score: null, opponent_score: null,
  };
  return { ...base, ...o };
}
const played = (week: number, o: Partial<TeamGame> = {}): TeamGame => ({
  ...game(week, o), played: true, result: "W", team_score: 27, opponent_score: 20, home_score: 27, away_score: 20,
});

type Props = Partial<React.ComponentProps<typeof ScheduleSection>>;
const show = (schedule: TeamGame[], over: Props = {}) =>
  render(
    <ScheduleSection
      schedule={schedule}
      teamName="Buffalo Bills"
      primaryColor="#00338D"
      secondaryColor="#C60C30"
      teamStats={{ wins: 1, losses: 0, ties: 0 } as TeamSeasonStat}
      boxScoreSeasons={[2026]}
      defaultSeason={2026}
      {...over}
    />,
  ).container;
const tile = (el: HTMLElement, i = 0) => el.querySelectorAll("[data-game-id]")[i] as HTMLElement;
const link = (el: HTMLElement, i = 0) => tile(el, i).querySelector("a[data-matchup-link]") as HTMLAnchorElement | null;

describe("ScheduleSection: the matchup link on an unplayed tile", () => {
  it("links the kickoff line to /matchup/AWAY/HOME, in away/home order whichever team's page it is on", () => {
    const el = show([game(5, { opponent_id: "LA", home_away: "away" }), game(6, { opponent_id: "NE", home_away: "home" })]);
    expect(link(el, 0)!.getAttribute("href")).toBe("/matchup/BUF/LA");
    expect(link(el, 1)!.getAttribute("href")).toBe("/matchup/NE/BUF");
    expect(link(el, 0)!.getAttribute("title")).toBe("Matchup: BUF at LA");
    expect(link(el, 1)!.getAttribute("title")).toBe("Matchup: NE at BUF");
  });

  it("the link is the kickoff line: weekday and time, prefetch off, dotted underline like the box score link", () => {
    const el = show([game(5, { opponent_id: "LA", home_away: "away", weekday: "Monday", gametime: "20:15" })]);
    const a = link(el)!;
    expect(a.textContent).toBe("MON8:15");
    expect(a.getAttribute("data-prefetch")).toBe("false");
    expect(a.className).toContain("decoration-dotted");
    // the opponent link above it is still there, a sibling (links cannot nest)
    const opponent = tile(el).querySelector('a[href="/team/LA"]')!;
    expect(opponent).not.toBeNull();
    expect(opponent.contains(a)).toBe(false);
    expect(a.contains(opponent)).toBe(false);
  });

  it("PREVIEW only on a linking tile with no kickoff time", () => {
    const el = show([game(5, { opponent_id: "LA", gametime: null }), game(6, { opponent_id: "NE" })]);
    expect(link(el, 0)!.textContent).toBe("PREVIEW");
    expect(link(el, 0)!.getAttribute("href")).toBe("/matchup/LA/BUF");
    expect(link(el, 1)!.textContent).not.toContain("PREVIEW");
  });

  it("a past season's link carries ?season=", () => {
    const el = show([game(5, { opponent_id: "LA", season: 2025 })], { defaultSeason: 2026 });
    expect(link(el)!.getAttribute("href")).toBe("/matchup/LA/BUF?season=2025");
  });

  it("a played tile does not link to a matchup (its score line is the box score link)", () => {
    const el = show([played(1, { opponent_id: "HOU" })]);
    expect(link(el)).toBeNull();
    expect(tile(el).querySelector("a[data-box-score-link]")).not.toBeNull();
  });

  it("the upcoming-season grid does not link (that season has no stats)", () => {
    const next = [game(1, { opponent_id: "LA", season: 2027, game_id: "2027_01_LA_BUF" })];
    const el = show(next, { upcomingSeason: 2027, defaultSeason: 2026 });
    expect(el.querySelector("[data-matchup-link]")).toBeNull();
    // even if the prop were the same year
    expect(show(next, { upcomingSeason: 2027, defaultSeason: 2027 }).querySelector("[data-matchup-link]")).toBeNull();
  });

  it("a game in a season after the newest stats season does not link", () => {
    const el = show([game(1, { opponent_id: "LA", season: 2027 })], { defaultSeason: 2026 });
    expect(el.querySelector("[data-matchup-link]")).toBeNull();
  });

  it.each([
    ["an id that is no team", { away_team: "XXX" }],
    ["a lower-case id", { away_team: "la" }],
    ["a look-alike letter", { away_team: "ſf" }],
    ["an empty id", { home_team: "" }],
    ["the same team twice", { away_team: "BUF", home_team: "BUF" }],
  ])("a tile with %s does not link", (_name, over) => {
    const el = show([game(5, { opponent_id: "LA", ...over })]);
    expect(el.querySelector("[data-matchup-link]")).toBeNull();
  });

  it("a tile that does not link renders exactly as it does without the prop", () => {
    const cases: [TeamGame[], Props][] = [
      [[played(1), game(5, { opponent_id: "LA", away_team: "XXX" })], {}],
      [[game(1, { opponent_id: "LA", season: 2027 })], { upcomingSeason: 2027 }],
      [[game(5, { opponent_id: "LA", season: 2027, gametime: null })], {}],
    ];
    for (const [schedule, over] of cases) {
      const withProp = show(schedule, { ...over, defaultSeason: 2026 }).innerHTML;
      const without = show(schedule, { ...over, defaultSeason: undefined }).innerHTML;
      expect(withProp).toBe(without);
    }
  });

  it("without defaultSeason no tile links: no PREVIEW, no kickoff line for a game with no time", () => {
    const el = show([game(5, { opponent_id: "LA", gametime: null }), game(6, { opponent_id: "NE" })], { defaultSeason: undefined });
    expect(el.querySelector("[data-matchup-link]")).toBeNull();
    expect(el.textContent).not.toContain("PREVIEW");
    expect(tile(el, 1).textContent).toContain("1:00");
  });
});

describe("the team page passes the prop", () => {
  it("TeamHubContent hands defaultSeason to both schedule sections", () => {
    const src = readFileSync(join(process.cwd(), "components", "team", "TeamHubContent.tsx"), "utf8");
    const sections = src.split("<ScheduleSection").slice(1).map((s) => s.slice(0, s.indexOf("/>")));
    expect(sections).toHaveLength(2);
    for (const s of sections) expect(s).toContain("defaultSeason={defaultSeason}");
  });

  it("ScheduleSection's new imports are matchup-links only", () => {
    const src = readFileSync(join(process.cwd(), "components", "team", "ScheduleSection.tsx"), "utf8");
    const imports = Array.from(src.matchAll(/from\s+["']([^"']+)["']/g)).map((m) => m[1]);
    expect(imports.sort()).toEqual(
      ["@/lib/data/teams", "@/lib/stats/box-score", "@/lib/stats/formatters", "@/lib/stats/matchup-links", "@/lib/types", "next/link"].sort(),
    );
  });
});
