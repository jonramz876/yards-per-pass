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

  // Chaos 5: a 300-character away_team made the page about 3,000 px too wide.
  it("an id that is not two or three letters is printed as a dash, never as the raw text", () => {
    const long = "X".repeat(300);
    const junk = [long, "<script>alert(1)</script>", "../x", "__proto__", "ſf", "", "L.A", "BUFF"];
    const el = show(junk.map((away_team, i) => game({ game_id: `g${i}`, away_team })));
    const pairs = Array.from(el.querySelectorAll("[data-slate-pair]")).map((p) => p.textContent);
    expect(pairs).toEqual(junk.map(() => "— at LA"));
    expect(el.textContent).not.toContain("XXXX");
    expect(el.querySelectorAll("a[data-slate-row]")).toHaveLength(0);
    // home side too
    expect(show([game({ home_team: long })]).querySelector("[data-slate-pair]")?.textContent).toBe("BUF at —");
  });

  it("letters that are not a team print as they are (upper-cased), unlinked", () => {
    const el = show([game({ away_team: "LAR" }), game({ game_id: "g2", away_team: "buf" })]);
    expect(Array.from(el.querySelectorAll("[data-slate-pair]")).map((p) => p.textContent)).toEqual(["LAR at LA", "BUF at LA"]);
    expect(el.querySelectorAll("a[data-slate-row]")).toHaveLength(0);
  });

  it("a row's text can always break inside its box", () => {
    const el = show();
    for (const node of Array.from(el.querySelectorAll("[data-slate-pair], [data-slate-when]"))) {
      expect(classes(node)).toEqual(expect.arrayContaining(["min-w-0", "[overflow-wrap:anywhere]"]));
    }
    for (const row of Array.from(el.querySelectorAll("[data-slate-row]"))) expect(classes(row)).toContain("min-w-0");
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

  // Chaos 2: the old swap rule fired on every `change`, and a closed select
  // fires one per arrow key, so walking the Home list with the keyboard past
  // the Away team rewrote the Away pick. Each select now changes only itself.
  it("each select changes only itself: picking the other side's team leaves the other side alone", () => {
    const el = show();
    choose(el, "away", "KC");
    choose(el, "home", "JAX");
    choose(el, "home", "KC"); // passing over Kansas City on the way down the list
    expect([sel(el, "away").value, sel(el, "home").value]).toEqual(["KC", "KC"]);
    choose(el, "home", "LV");
    expect([sel(el, "away").value, sel(el, "home").value]).toEqual(["KC", "LV"]);
    fireEvent.click(go(el));
    expect(router.push).toHaveBeenCalledWith("/matchup/KC/LV");
  });

  it("walking one list through all 32 teams never changes the other pick", () => {
    const el = show();
    choose(el, "away", "KC");
    for (const t of TEAMS) {
      choose(el, "home", t.id);
      expect(sel(el, "away").value).toBe("KC");
    }
    choose(el, "home", "BUF");
    for (const t of TEAMS) {
      choose(el, "away", t.id);
      expect(sel(el, "home").value).toBe("BUF");
    }
  });

  it("the same team on both sides is allowed in the selects: COMPARE is off and one plain line says why", () => {
    const el = show();
    expect(el.querySelector("[data-pick-same]")).toBeNull();
    choose(el, "away", "BUF");
    expect(el.querySelector("[data-pick-same]")).toBeNull();
    choose(el, "home", "BUF");
    expect([sel(el, "away").value, sel(el, "home").value]).toEqual(["BUF", "BUF"]);
    expect(go(el).disabled).toBe(true);
    expect(el.querySelector("[data-pick-same]")?.textContent).toBe("Pick two different teams.");
    fireEvent.click(go(el));
    expect(router.push).not.toHaveBeenCalled();
    choose(el, "home", "LA");
    expect(el.querySelector("[data-pick-same]")).toBeNull();
    expect(go(el).disabled).toBe(false);
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
