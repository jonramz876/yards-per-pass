// Direction A's header (team matchup spec §8): two team slabs in team colour
// with "AT" (or "VS" when the pair has no game) between them. No logo. The
// only red allowed is a red team's own colour, passed in as data.
import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";

vi.mock("next/link", () => ({
  default: ({ href, children, prefetch, ...rest }: { href: string; children: React.ReactNode; prefetch?: boolean }) => (
    <a href={href} data-prefetch={prefetch === undefined ? undefined : String(prefetch)} {...rest}>
      {children}
    </a>
  ),
}));

import MatchupHeader, { HEADER_ID_MD, HEADER_ID_SM } from "@/components/matchup/MatchupHeader";
import { getTeam } from "@/lib/data/teams";
import { textColorForBackground } from "@/lib/stats/formatters";
import { formatKickoff, type MatchupGame } from "@/lib/stats/matchup";
import { matchupCardColours } from "@/lib/stats/matchup-colours";
import type { Team } from "@/lib/types";
import { classes, code } from "./helpers";

const team = (id: string) => getTeam(id) as Team;
const GAME: MatchupGame = {
  game_id: "2026_05_BUF_LA", season: 2026, game_type: "REG", week: 5, gameday: "2026-10-12", weekday: "Monday",
  gametime: "20:15", home_team: "LA", away_team: "BUF", home_score: null, away_score: null,
};
const RECORDS = { away: { wins: 3, losses: 1, ties: 0 }, home: { wins: 2, losses: 2, ties: 1 } };

type Props = Partial<Parameters<typeof MatchupHeader>[0]>;
// The colours are the share card's for the two teams actually rendered: worked
// out AFTER the overrides, as the page works them out from its own two teams.
const show = (over: Props = {}) => {
  const away = over.away ?? team("BUF");
  const home = over.home ?? team("LA");
  return render(
    <MatchupHeader
      away={away}
      home={home}
      season={2026}
      defaultSeason={2026}
      game={GAME}
      records={RECORDS}
      gamesAvailable
      colours={matchupCardColours(away, home)}
      {...over}
    />,
  ).container;
};
const rgb = (hex: string) => `rgb(${parseInt(hex.slice(1, 3), 16)}, ${parseInt(hex.slice(3, 5), 16)}, ${parseInt(hex.slice(5, 7), 16)})`;
const INK = "#0f172a";
const WHITE = "#ffffff";
const paintOf = (s: HTMLElement) => [s.style.backgroundColor, s.style.color, s.style.borderBottomColor];
const slab = (el: HTMLElement, side: "away" | "home") => el.querySelector(`[data-slab="${side}"]`) as HTMLAnchorElement;

describe("MatchupHeader", () => {
  it("two slabs, away first: the team id, the nickname and the record with away / home", () => {
    const el = show();
    expect(slab(el, "away").querySelector("[data-slab-id]")?.textContent).toBe("BUF");
    expect(slab(el, "away").querySelector("[data-slab-nick]")?.textContent).toBe("Bills");
    expect(slab(el, "away").querySelector("[data-slab-record]")?.textContent).toBe("3-1 · away");
    expect(slab(el, "home").querySelector("[data-slab-id]")?.textContent).toBe("LA");
    expect(slab(el, "home").querySelector("[data-slab-nick]")?.textContent).toBe("Rams");
    expect(slab(el, "home").querySelector("[data-slab-record]")?.textContent).toBe("2-2-1 · home");
    const order = Array.from(el.querySelectorAll("[data-slab]")).map((s) => s.getAttribute("data-slab"));
    expect(order).toEqual(["away", "home"]);
    expect(classes(slab(el, "home"))).toContain("text-right");
  });

  it("the nickname is the last word of the team name", () => {
    const nick = (id: string) => slab(show({ away: team(id) }), "away").querySelector("[data-slab-nick]")?.textContent;
    expect(nick("SF")).toBe("49ers");
    expect(nick("WAS")).toBe("Commanders");
    expect(nick("TB")).toBe("Buccaneers");
    expect(nick("NYJ")).toBe("Jets");
  });

  // Page colours amendment 2026-10-10: the slabs are the share card's two
  // colours for the pair, never two alike. BUF at LA was two blues.
  it("BUF at LA: a blue Bills slab with a red stripe, a GOLD Rams slab with ink text and a blue stripe", () => {
    const el = show();
    expect(paintOf(slab(el, "away"))).toEqual([rgb("#00338D"), rgb(WHITE), rgb("#C60C30")]);
    expect(paintOf(slab(el, "home"))).toEqual([rgb("#CC8200"), rgb(INK), rgb("#003594")]);
    // not the Rams' primary, which is a blue beside the Bills' blue
    expect(slab(el, "home").style.backgroundColor).not.toBe(rgb(team("LA").primaryColor));
  });

  it("the other order gives the other colours: LA at BUF is Rams blue and Bills red", () => {
    const el = show({ away: team("LA"), home: team("BUF") });
    expect(slab(el, "away").style.backgroundColor).toBe(rgb("#003594"));
    expect(slab(el, "home").style.backgroundColor).toBe(rgb("#C60C30"));
  });

  it("PIT at LA: the Steelers slab is the card's darkened gold (not their primary), ink text, a black stripe", () => {
    const s = slab(show({ away: team("PIT") }), "away");
    expect(paintOf(s)).toEqual([rgb("#BF890E"), rgb(INK), rgb("#101820")]);
    expect(s.style.backgroundColor).not.toBe(rgb(team("PIT").primaryColor));
  });

  it("a slab wears the `colours` it is handed and nothing of the team's own: background, stripe, and the text colour that reads on it", () => {
    const colours = { away: "#8C9295", home: "#203731", awayRule: "#111111", homeRule: "#EEEEEE" };
    const el = show({ colours });
    expect(paintOf(slab(el, "away"))).toEqual([rgb("#8C9295"), rgb(textColorForBackground("#8C9295")), rgb("#111111")]);
    expect(paintOf(slab(el, "home"))).toEqual([rgb("#203731"), rgb(textColorForBackground("#203731")), rgb("#EEEEEE")]);
    expect([textColorForBackground("#8C9295"), textColorForBackground("#203731")]).toEqual([INK, WHITE]);
    // the id, the nickname and the record set no colour of their own: they inherit the slab's text colour
    for (const part of Array.from(el.querySelectorAll("[data-slab] *"))) {
      expect((part as HTMLElement).style.color).toBe("");
      expect(classes(part).some((c) => /^text-(white|black|navy|slate|gray)/.test(c))).toBe(false);
    }
    const src = code("MatchupHeader.tsx");
    expect(src).not.toMatch(/primaryColor|secondaryColor/);
  });

  it("each slab links to its team page, carrying a past season", () => {
    expect(slab(show(), "away").getAttribute("href")).toBe("/team/BUF");
    expect(slab(show(), "home").getAttribute("href")).toBe("/team/LA");
    const past = show({ season: 2025, defaultSeason: 2026 });
    expect(slab(past, "away").getAttribute("href")).toBe("/team/BUF?season=2025");
    expect(slab(past, "home").getAttribute("href")).toBe("/team/LA?season=2025");
  });

  it("a game in this order: AT, the week, the kickoff", () => {
    const el = show();
    expect(el.querySelector("[data-at]")?.textContent).toBe("AT");
    expect(el.querySelector("[data-week]")?.textContent).toBe("Week 5");
    expect(el.querySelector("[data-kickoff]")?.textContent).toBe(formatKickoff(GAME));
    expect(formatKickoff(GAME)).toBe("Mon Oct 12 · 8:15 PM ET");
    expect(el.querySelector("[data-no-game]")).toBeNull();
  });

  it("a played game shows its final; a playoff game its round", () => {
    const played = { ...GAME, away_score: 27, home_score: 20 };
    expect(show({ game: played }).querySelector("[data-kickoff]")?.textContent).toBe("Mon Oct 12 · Final: BUF 27, LA 20");
    expect(show({ game: { ...GAME, game_type: "DIV", week: 20 } }).querySelector("[data-week]")?.textContent).toBe("Divisional");
  });

  it("no game between the two (games read fine): VS and the sentence; the records still print, without away / home", () => {
    const el = show({ game: null });
    expect(el.querySelector("[data-at]")?.textContent).toBe("VS");
    expect(el.querySelector("[data-no-game]")?.textContent).toBe("No 2026 game between these teams");
    expect(el.querySelector("[data-week]")).toBeNull();
    expect(el.querySelector("[data-kickoff]")).toBeNull();
    // "· away" / "· home" names a venue, and a pair with no game has none.
    expect(Array.from(el.querySelectorAll("[data-slab-record]")).map((r) => r.textContent)).toEqual(["3-1", "2-2-1"]);
    expect(el.textContent).not.toMatch(/· (away|home)/);
  });

  it("the team slabs do not prefetch", () => {
    for (const side of ["away", "home"] as const) expect(slab(show(), side).getAttribute("data-prefetch")).toBe("false");
  });

  it("the games read failed: no week, no date, no records, and NOT the no-game sentence", () => {
    const el = show({ game: null, records: null, gamesAvailable: false });
    expect(el.querySelector("[data-at]")?.textContent).toBe("VS");
    expect(el.querySelector("[data-no-game]")).toBeNull();
    expect(el.textContent).not.toContain("game between these teams");
    expect(el.querySelectorAll("[data-slab-record]")).toHaveLength(0);
  });

  it("a game with no readable date or time prints the week and no kickoff line", () => {
    const el = show({ game: { ...GAME, gameday: null, gametime: null } });
    expect(el.querySelector("[data-week]")?.textContent).toBe("Week 5");
    expect(el.querySelector("[data-kickoff]")).toBeNull();
  });

  it("one plain link back to this week's matchups", () => {
    const back = show().querySelector("[data-matchup-back]") as HTMLAnchorElement;
    expect(back.getAttribute("href")).toBe("/matchup");
    expect(back.textContent).toBe("← This week’s matchups");
  });

  it("no logo: no <img>", () => {
    expect(show().querySelector("img")).toBeNull();
    expect(code("MatchupHeader.tsx")).not.toMatch(/next\/image|<img/);
  });

  it("the accent is nobody's class or literal here: AT is navy (a red team's slab is its own colour, passed in as data)", () => {
    const src = code("MatchupHeader.tsx");
    expect(src).not.toMatch(/#D50A0A/i);
    expect(src).not.toMatch(/nflred|red-\d00/);
    expect(classes(show().querySelector("[data-at]"))).toContain("text-navy");
    // Tampa Bay's primary IS the accent red: on TB at LA its card colour is that
    // primary, so its slab is red because it is Tampa Bay.
    const tb = show({ away: team("TB") });
    expect(slab(tb, "away").style.backgroundColor).toBe("rgb(213, 10, 10)");
    expect(classes(tb.querySelector("[data-at]"))).toContain("text-navy");
  });

  it("the grid: two columns below md, 1fr / auto / 1fr from md; only the kickoff line may be nowrap, and only from md", () => {
    const el = show();
    const grid = classes(el.querySelector("[data-matchup-header]"));
    expect(grid).toContain("grid-cols-2");
    expect(grid).toContain("md:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]");
    expect(classes(el.querySelector("[data-middle]"))).toEqual(expect.arrayContaining(["col-span-2", "md:col-span-1"]));
    const nowrap = Array.from(el.querySelectorAll("*")).filter((n) => classes(n).some((c) => c.endsWith("whitespace-nowrap")));
    expect(nowrap.map((n) => n.getAttribute("data-kickoff") !== null)).toEqual([true]);
    expect(classes(nowrap[0])).toContain("md:whitespace-nowrap");
    expect(classes(nowrap[0])).not.toContain("whitespace-nowrap");
  });
});

describe("header team ids fit their slabs (§8.4): Barlow Condensed capitals at 0.60 em", () => {
  it("three letters (WAS) fit 124 px at 320 and 189 px at 768", () => {
    expect([HEADER_ID_SM, HEADER_ID_MD]).toEqual([50, 72]);
    expect(3 * 0.6 * HEADER_ID_SM).toBeLessThanOrEqual(124);
    expect(3 * 0.6 * HEADER_ID_MD).toBeLessThanOrEqual(189);
  });
  it("the class string carries exactly those sizes", () => {
    expect(code("MatchupHeader.tsx")).toContain(`text-[${HEADER_ID_SM}px]`);
    expect(code("MatchupHeader.tsx")).toContain(`md:text-[${HEADER_ID_MD}px]`);
  });
});
