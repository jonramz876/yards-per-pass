// /matchup's two parts (team matchup spec §8): this week's games as one-tap
// rows, and two team pickers for any other pair.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent } from "@testing-library/react";

const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
vi.mock("next/link", () => ({
  default: ({ href, children, prefetch, ...rest }: { href: string; children: React.ReactNode; prefetch?: boolean }) => (
    <a href={href} data-prefetch={prefetch === undefined ? undefined : String(prefetch)} {...rest}>
      {children}
    </a>
  ),
}));

import MatchupSlate from "@/components/matchup/MatchupSlate";
import MatchupPicker from "@/components/matchup/MatchupPicker";
import { NFL_TEAMS } from "@/lib/data/teams";
import type { MatchupGame } from "@/lib/stats/matchup";
import { classes } from "./helpers";

const game = (over: Partial<MatchupGame>): MatchupGame => ({
  game_id: "2026_05_BUF_LA", season: 2026, game_type: "REG", week: 5, gameday: "2026-10-12", weekday: "Monday",
  gametime: "20:15", home_team: "LA", away_team: "BUF", home_score: null, away_score: null, ...over,
});
const GAMES = [
  game({ game_id: "2026_05_LV_NE", away_team: "LV", home_team: "NE", gameday: "2026-10-08", weekday: "Thursday", away_score: 17, home_score: 24 }),
  game({ game_id: "2026_05_ARI_SF", away_team: "ARI", home_team: "SF", gameday: "2026-10-11", weekday: "Sunday", gametime: "13:00" }),
  game({}),
];

describe("MatchupSlate", () => {
  const show = (games = GAMES, label = "Week 5") => render(<MatchupSlate label={label} games={games} />).container;

  it("the week as a section heading, then one row per game in the order given", () => {
    const el = show();
    expect(el.querySelector("h2")?.textContent).toBe("Week 5");
    expect(classes(el.querySelector("h2")).join(" ")).toContain("var(--font-barlow)");
    expect(classes(el.querySelector("h2")).join(" ")).not.toContain("var(--font-pixel)");
    const rows = Array.from(el.querySelectorAll("[data-slate-row]"));
    expect(rows.map((r) => r.querySelector("[data-slate-pair]")?.textContent)).toEqual(["LV at NE", "ARI at SF", "BUF at LA"]);
    expect(rows.map((r) => r.querySelector("[data-slate-when]")?.textContent)).toEqual([
      "Thu Oct 8 · Final: LV 17, NE 24", "Sun Oct 11 · 1:00 PM ET", "Mon Oct 12 · 8:15 PM ET",
    ]);
  });

  it("every row is one link to that matchup, away team first, with prefetch off", () => {
    const rows = Array.from(show().querySelectorAll("a[data-slate-row]"));
    expect(rows.map((r) => r.getAttribute("href"))).toEqual(["/matchup/LV/NE", "/matchup/ARI/SF", "/matchup/BUF/LA"]);
    for (const r of rows) expect(r.getAttribute("data-prefetch")).toBe("false");
  });

  it("a row whose teams are not two real teams is printed without a link", () => {
    const el = show([game({ away_team: "XXX", home_team: "LA" }), game({ away_team: "buf", home_team: "LA" }), game({})]);
    const rows = Array.from(el.querySelectorAll("[data-slate-row]"));
    expect(rows.map((r) => r.tagName)).toEqual(["DIV", "DIV", "A"]);
  });

  it("the grid is one, two, then three games per row", () => {
    expect(classes(show().querySelector("[data-slate-grid]"))).toEqual(
      expect.arrayContaining(["grid", "grid-cols-1", "md:grid-cols-2", "xl:grid-cols-3"]),
    );
  });

  it("no games: no rows, no throw", () => {
    expect(show([]).querySelectorAll("[data-slate-row]")).toHaveLength(0);
  });
});

describe("MatchupPicker", () => {
  const TEAMS = NFL_TEAMS.map((t) => ({ id: t.id, name: t.name }));
  const show = () => render(<MatchupPicker teams={TEAMS} />).container;
  const sel = (el: HTMLElement, which: "away" | "home") => el.querySelector(`select[data-pick="${which}"]`) as HTMLSelectElement;
  const go = (el: HTMLElement) => el.querySelector("[data-pick-go]") as HTMLButtonElement;
  const choose = (el: HTMLElement, which: "away" | "home", id: string) => fireEvent.change(sel(el, which), { target: { value: id } });

  beforeEach(() => {
    for (const fn of Object.values(router)) fn.mockReset();
  });

  it("two labelled selects, both starting empty, with all 32 teams by name", () => {
    const el = show();
    expect(el.querySelector('label[for="matchup-pick-away"]')?.textContent).toBe("Away team");
    expect(el.querySelector('label[for="matchup-pick-home"]')?.textContent).toBe("Home team");
    for (const which of ["away", "home"] as const) {
      const s = sel(el, which);
      expect(s.value).toBe("");
      const options = Array.from(s.querySelectorAll("option"));
      expect(options[0].textContent).toBe("Pick a team");
      expect(options).toHaveLength(33);
      expect(options.slice(1).map((o) => o.value).sort()).toEqual(TEAMS.map((t) => t.id).sort());
      expect(options.find((o) => o.value === "BUF")?.textContent).toBe("Buffalo Bills");
    }
  });

  it("the button is disabled until two different teams are chosen", () => {
    const el = show();
    expect(go(el).disabled).toBe(true);
    choose(el, "away", "BUF");
    expect(go(el).disabled).toBe(true);
    choose(el, "home", "LA");
    expect(go(el).disabled).toBe(false);
  });

  it("Compare pushes the matchup's address: the first select is the away team", () => {
    const el = show();
    choose(el, "away", "BUF");
    choose(el, "home", "LA");
    fireEvent.click(go(el));
    expect(router.push).toHaveBeenCalledTimes(1);
    expect(router.push).toHaveBeenCalledWith("/matchup/BUF/LA");
  });

  it("picking the team already on the other side swaps the two", () => {
    const el = show();
    choose(el, "away", "BUF");
    choose(el, "home", "LA");
    choose(el, "away", "LA");
    expect([sel(el, "away").value, sel(el, "home").value]).toEqual(["LA", "BUF"]);
    choose(el, "home", "LA");
    expect([sel(el, "away").value, sel(el, "home").value]).toEqual(["BUF", "LA"]);
    fireEvent.click(go(el));
    expect(router.push).toHaveBeenCalledWith("/matchup/BUF/LA");
  });

  it("picking the other side's team while this side is empty leaves the other side empty, and the button off", () => {
    const el = show();
    choose(el, "away", "BUF");
    choose(el, "home", "BUF");
    expect([sel(el, "away").value, sel(el, "home").value]).toEqual(["", "BUF"]);
    expect(go(el).disabled).toBe(true);
  });

  it("a disabled button pushes nothing; an id that is not a team is never pushed", () => {
    const el = show();
    fireEvent.click(go(el));
    choose(el, "away", "BUF");
    choose(el, "home", "../x");
    fireEvent.click(go(el));
    expect(router.push).not.toHaveBeenCalled();
  });

  it("selects are stacked full width on a phone, in a row from md", () => {
    const el = show();
    const row = classes(el.querySelector("[data-pick-row]"));
    expect(row).toEqual(expect.arrayContaining(["flex", "flex-col", "md:flex-row"]));
    expect(classes(sel(el, "away"))).toContain("w-full");
  });
});
