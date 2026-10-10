// Direction C's Tecmo player tiles under direction A's section heading (team
// matchup spec §8, §7.3a): one group per team, away first; QB, RB, RB, then
// the four receivers. The name is the link; nothing is cut short.
import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";

vi.mock("next/link", () => ({
  default: ({ href, children, prefetch, ...rest }: { href: string; children: React.ReactNode; prefetch?: boolean }) => (
    <a href={href} data-prefetch={prefetch === undefined ? undefined : String(prefetch)} {...rest}>
      {children}
    </a>
  ),
}));

import playerRowsJson from "../../stats/fixtures/compare-2026-w4-rows.json";
import MatchupPlayers from "@/components/matchup/MatchupPlayers";
import { getTeam } from "@/lib/data/teams";
import {
  MATCHUP_PLAYERS_UNAVAILABLE, matchupNoPlayersNote, pairLineups, pickMainPlayers, type LineupPlayer,
} from "@/lib/stats/matchup";
import type { Team } from "@/lib/types";
import { classes, code } from "./helpers";

const team = (id: string) => getTeam(id) as Team;
const SLUGS = new Map([
  ["00-0034857", { slug: "josh-allen", player_name: "Josh Allen" }],
  ["00-0037248", { slug: "james-cook", player_name: "James Cook" }],
]);
const pick = (teamId: string, season = 2026): LineupPlayer[] =>
  pickMainPlayers({
    teamId, season, defaultSeason: 2026,
    qbs: playerRowsJson.qb as never, rbs: playerRowsJson.rb as never, receivers: playerRowsJson.receivers as never,
    slugByPlayerId: SLUGS,
  });
const BUF = pick("BUF");
const DET = pick("DET");

type Props = Partial<Parameters<typeof MatchupPlayers>[0]>;
const show = (over: Props = {}) =>
  render(
    <MatchupPlayers away={team("BUF")} home={team("DET")} season={2026} lineup={pairLineups(BUF, DET)} playersAvailable {...over} />,
  ).container;
const group = (el: HTMLElement, id: string) => el.querySelector(`[data-team-group="${id}"]`) as HTMLElement;
const tiles = (el: HTMLElement, id: string) => Array.from(group(el, id).querySelectorAll("[data-tile]")) as HTMLElement[];

describe("MatchupPlayers", () => {
  it("the section heading, then two team headings, away first", () => {
    const el = show();
    expect(el.querySelector("h2")?.textContent).toBe("MAIN PLAYERS");
    expect(Array.from(el.querySelectorAll("[data-team-group]")).map((g) => g.getAttribute("data-team-group"))).toEqual(["BUF", "DET"]);
    expect(group(el, "BUF").querySelector("[data-team-heading]")?.textContent).toBe("Buffalo Bills");
    expect(group(el, "DET").querySelector("[data-team-heading]")?.textContent).toBe("Detroit Lions");
  });

  it("7 tiles per full team in the order QB, RB, RB, then the receivers", () => {
    const el = show();
    for (const [id, list] of [["BUF", BUF], ["DET", DET]] as const) {
      expect(list).toHaveLength(7);
      const got = tiles(el, id);
      expect(got.map((t) => t.querySelector("[data-tile-name]")?.textContent)).toEqual(list.map((p) => p.name));
      expect(got.map((t) => t.querySelector("[data-tile-pos]")?.textContent)).toEqual(list.map((p) => p.pos));
      expect(list.slice(0, 3).map((p) => p.pos)).toEqual(["QB", "RB", "RB"]);
    }
  });

  it("each band prints the position and the team id, in the team's colours", () => {
    const el = show();
    for (const t of tiles(el, "BUF")) {
      const band = t.querySelector("[data-tile-band]") as HTMLElement;
      expect(band.querySelector("[data-tile-team]")?.textContent).toBe("BUF");
      expect(band.style.backgroundColor).toBe("rgb(0, 51, 141)");
      expect(band.style.borderBottomColor).toBeTruthy();
    }
    expect(tiles(el, "DET")[0].querySelector("[data-tile-team]")?.textContent).toBe("DET");
  });

  it("a light primary gets dark band text (PIT)", () => {
    const el = show({ away: team("PIT"), lineup: pairLineups(pick("PIT"), DET) });
    const band = tiles(el, "PIT")[0].querySelector("[data-tile-band]") as HTMLElement;
    expect(band.style.color).not.toMatch(/255, 255, 255/);
  });

  it("a linked name is an anchor to the player page; an unlinked one is plain text", () => {
    const el = show();
    const [qb, rb1, rb2] = tiles(el, "BUF").map((t) => t.querySelector("[data-tile-name]") as HTMLElement);
    expect(qb.tagName).toBe("A");
    expect(qb.getAttribute("href")).toBe("/player/josh-allen");
    expect(qb.textContent).toBe("Josh Allen");
    expect(rb1.getAttribute("href")).toBe("/player/james-cook");
    expect(rb2.tagName).not.toBe("A");
    expect(rb2.querySelector("a")).toBeNull();
    expect(BUF[2].href).toBeNull();
  });

  it("a past season's name link carries ?season=", () => {
    const past = pick("BUF", 2025);
    const el = show({ season: 2025, lineup: pairLineups(past, []) });
    expect(tiles(el, "BUF")[0].querySelector("a")?.getAttribute("href")).toBe("/player/josh-allen?season=2025");
  });

  it("four label / value pairs per tile, in stats order", () => {
    const el = show();
    tiles(el, "BUF").forEach((t, i) => {
      const pairs = Array.from(t.querySelectorAll("dl > div")).map((d) => [d.querySelector("dt")?.textContent, d.querySelector("dd")?.textContent]);
      expect(pairs).toEqual(BUF[i].stats.map((s) => [s.label, s.value]));
      expect(pairs).toHaveLength(4);
    });
  });

  it("a team with 3 players renders 3 tiles and no empty tile", () => {
    const three = BUF.slice(0, 3);
    const el = show({ lineup: pairLineups(three, DET) });
    expect(tiles(el, "BUF")).toHaveLength(3);
    expect(tiles(el, "DET")).toHaveLength(7);
    expect(el.querySelectorAll("[data-tile]:empty")).toHaveLength(0);
  });

  it("a team with no player: its heading and M17, no grid; the other team as normal", () => {
    const el = show({ lineup: pairLineups([], DET) });
    expect(group(el, "BUF").querySelector("[data-team-heading]")?.textContent).toBe("Buffalo Bills");
    expect(group(el, "BUF").querySelector("[data-no-players]")?.textContent).toBe(matchupNoPlayersNote("Buffalo Bills", 2026));
    expect(group(el, "BUF").querySelector("[data-tiles]")).toBeNull();
    expect(tiles(el, "DET")).toHaveLength(7);
  });

  it("playersAvailable false: the heading and M12, no team group and no tile", () => {
    const el = show({ lineup: null, playersAvailable: false });
    expect(el.querySelector("h2")?.textContent).toBe("MAIN PLAYERS");
    expect(el.querySelector("[data-players-unavailable]")?.textContent).toBe(MATCHUP_PLAYERS_UNAVAILABLE);
    expect(el.querySelector("[data-team-group]")).toBeNull();
    expect(el.querySelector("[data-tile]")).toBeNull();
  });

  // Chaos 4: "−12,345,678" was painted across the value beside it.
  it("a stat value can always break inside its half of the tile, so it never paints over its neighbour", () => {
    const huge: LineupPlayer = { ...BUF[0], stats: BUF[0].stats.map((s, i) => ({ label: s.label, value: i === 2 ? "−12,345,678" : "9".repeat(300) })) };
    const el = show({ lineup: pairLineups([huge], []) });
    const t = tiles(el, "BUF")[0];
    expect(classes(t)).toContain("min-w-0");
    for (const pair of Array.from(t.querySelectorAll("dl > div"))) expect(classes(pair)).toContain("min-w-0");
    for (const node of Array.from(t.querySelectorAll("dd, dt"))) {
      expect(classes(node)).toEqual(expect.arrayContaining(["min-w-0", "[overflow-wrap:anywhere]"]));
    }
    expect(classes(t.querySelector("[data-tile-name]"))).toContain("[overflow-wrap:anywhere]");
    expect(t.querySelectorAll("dd")[2].textContent).toBe("−12,345,678");
  });

  it("name links do not prefetch (a matchup page has up to 14 of them, each a per-request page)", () => {
    const links = Array.from(show().querySelectorAll("a[data-tile-name]"));
    expect(links.length).toBeGreaterThan(0);
    for (const a of links) expect(a.getAttribute("data-prefetch")).toBe("false");
  });

  it("a player with every stat missing prints four dashes", () => {
    const blank: LineupPlayer = { ...BUF[0], stats: BUF[0].stats.map((s) => ({ label: s.label, value: "—" })) };
    const el = show({ lineup: pairLineups([blank], []) });
    expect(Array.from(tiles(el, "BUF")[0].querySelectorAll("dd")).map((d) => d.textContent)).toEqual(["—", "—", "—", "—"]);
  });

  it("names pass through untouched and are never cut short", () => {
    const named = (name: string): LineupPlayer => ({ ...BUF[3], name, href: null, playerId: name });
    const names = ["D'Andre Swift", "Amon-Ra St. Brown", "Marquez Valdes-Scantling"];
    const el = show({ lineup: pairLineups([BUF[0], ...names.map(named)], []) });
    const got = tiles(el, "BUF").slice(1).map((t) => t.querySelector("[data-tile-name]") as HTMLElement);
    expect(got.map((n) => n.textContent)).toEqual(names);
    for (const n of Array.from(el.querySelectorAll("[data-tile-name], [data-tile-name] *, [data-tile]"))) {
      expect(classes(n).some((c) => /truncate|whitespace-nowrap|line-clamp|text-ellipsis/.test(c))).toBe(false);
    }
  });

  it("the tile grid uses counted columns: 2, then 4 from md, then 7 from xl", () => {
    const cls = classes(show().querySelector("[data-tiles]"));
    expect(cls).toEqual(expect.arrayContaining(["grid", "grid-cols-2", "md:grid-cols-4", "xl:grid-cols-7"]));
    expect(code("MatchupPlayers.tsx")).not.toContain("auto-fill");
  });

  it("no navy band and no card frame around the section (the pixel font is for the tile bands only)", () => {
    const el = show();
    expect(classes(el.querySelector("h2")).join(" ")).toContain("var(--font-barlow)");
    expect(classes(el.querySelector("h2")).join(" ")).not.toContain("var(--font-pixel)");
    expect(classes(el.querySelector("[data-tile-band]")).join(" ")).toContain("var(--font-pixel)");
    expect(code("MatchupPlayers.tsx")).not.toMatch(/#D50A0A|nflred|red-\d00|shadow/i);
  });
});
