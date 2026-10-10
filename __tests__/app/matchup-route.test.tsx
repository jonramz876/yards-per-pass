// /matchup/[away]/[home] (team matchup spec 2026-10-10 §4.1, §4.3, §4.4,
// §10): validation and both redirects before any read, the states, and the
// metadata. The loader is replaced here, so each test states `game`, `swap`
// and the model itself (no clock to pin); matchup-real-loader.test.tsx runs
// the page over the real loader with the date fixed.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

vi.mock("next/navigation", () => ({
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT 307 ${url}`);
  }),
  permanentRedirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT 308 ${url}`);
  }),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("next/link", () => ({
  default: ({ href, children, prefetch, ...rest }: { href: string; children: React.ReactNode; prefetch?: boolean }) => (
    <a href={href} data-prefetch={prefetch === undefined ? undefined : String(prefetch)} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock("@/lib/data/matchup", () => ({ loadMatchup: vi.fn(), loadMatchupIndex: vi.fn() }));
// The 308 looks a requested season up in the memoised season list (one shared
// read, never per pair) so it can drop a season the site does not have.
vi.mock("@/lib/data/compare-card", () => ({ getSeasonWeeksCached: vi.fn() }));

import MatchupPage, * as pageModule from "@/app/matchup/[away]/[home]/page";
import { generateMetadata } from "@/app/matchup/[away]/[home]/page";
import { notFound, permanentRedirect, redirect } from "next/navigation";
import { loadMatchup, type MatchupLoad } from "@/lib/data/matchup";
import { getSeasonWeeksCached } from "@/lib/data/compare-card";
import playerRowsJson from "../stats/fixtures/compare-2026-w4-rows.json";
import {
  MATCHUP_NO_OVERLAY_NOTE, MATCHUP_PLAYERS_UNAVAILABLE, MATCHUP_SMALL_POOL_NOTE, matchupNoGamesNote, matchupUncoveredHeading,
  pairLineups, pickMainPlayers,
} from "@/lib/stats/matchup";
import { ROWS, model, rowsWithout } from "../components/matchup/helpers";

type Search = Record<string, string | string[] | undefined>;
const args = (away: string, home: string, search: Search = {}) => ({
  params: Promise.resolve({ away, home }),
  searchParams: Promise.resolve(search),
});
const BASE = "https://yardsperpass.com";

const pick = (teamId: string, season = 2026) =>
  pickMainPlayers({
    teamId, season, defaultSeason: 2026,
    qbs: playerRowsJson.qb as never, rbs: playerRowsJson.rb as never, receivers: playerRowsJson.receivers as never,
    slugByPlayerId: new Map([["00-0034857", { slug: "josh-allen", player_name: "Josh Allen" }]]),
  });
const game = (away: string, home: string) => ({
  game_id: `2026_05_${away}_${home}`, season: 2026, game_type: "REG", week: 5, gameday: "2026-10-12", weekday: "Monday",
  gametime: "20:15", home_team: home, away_team: away, home_score: null, away_score: null,
});
const RECORDS = { away: { wins: 3, losses: 1, ties: 0 }, home: { wins: 2, losses: 2, ties: 0 } };
const ready = (away = "BUF", home = "LA", over: Record<string, unknown> = {}): MatchupLoad =>
  ({
    state: "ready", season: 2026, defaultSeason: 2026, isLatestSeason: true, swap: false,
    game: game(away, home), records: RECORDS, lineup: pairLineups(pick(away), pick(home)),
    playersAvailable: true, gamesAvailable: true, model: model(away, home), ...over,
  }) as unknown as MatchupLoad;
const SEVEN = Array.from(new Set(ROWS.map((r) => r.team_id as string))).sort().slice(0, 7);
const smallPool = (): MatchupLoad => {
  const m = model("BUF", "LA", ROWS.filter((r) => SEVEN.includes(r.team_id as string)));
  return ready("BUF", "LA", { state: m.state, model: m });
};
const uncovered = (over: Record<string, unknown> = {}): MatchupLoad =>
  ready("BUF", "LA", { state: "uncovered", season: 2025, isLatestSeason: false, model: null, firstSeason: 2026, game: null, ...over });

/** The page's server-rendered HTML, as a detached element to query. */
async function html(away: string, home: string, search: Search = {}): Promise<HTMLElement> {
  const el = document.createElement("div");
  el.innerHTML = renderToStaticMarkup(await MatchupPage(args(away, home, search)));
  return el;
}
const outcome = (away: string, home: string, search: Search = {}) =>
  MatchupPage(args(away, home, search)).then(() => "200", (e: Error) => e.message);
const md = (away: string, home: string, search: Search = {}) => generateMetadata(args(away, home, search));
const slotHidden = (el: HTMLElement, ball: "away" | "home") =>
  (el.querySelector(`[data-ball-slot="${ball}"]`)?.getAttribute("class") ?? "").split(/\s+/).includes("hidden");

let errorSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  vi.mocked(loadMatchup).mockReset();
  vi.mocked(loadMatchup).mockImplementation(async (a, h) => ready(a, h));
  vi.mocked(getSeasonWeeksCached).mockReset();
  vi.mocked(getSeasonWeeksCached).mockResolvedValue([{ season: 2026, through_week: 4 }, { season: 2025, through_week: 22 }]);
  for (const fn of [notFound, redirect, permanentRedirect]) vi.mocked(fn).mockClear();
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  errorSpy.mockRestore();
});

describe("/matchup/[away]/[home]: the module", () => {
  it("revalidates hourly and is never pre-rendered", () => {
    expect(pageModule.revalidate).toBe(3600);
    expect("generateStaticParams" in pageModule).toBe(false);
    expect("dynamic" in pageModule).toBe(false);
  });

  it("no loading.tsx, no opengraph-image and no not-found anywhere under app/matchup/", () => {
    const walk = (dir: string): string[] =>
      readdirSync(dir).flatMap((name) => (statSync(join(dir, name)).isDirectory() ? walk(join(dir, name)) : [name]));
    const files = walk(join(process.cwd(), "app", "matchup"));
    expect(files.filter((f) => /^(loading|opengraph-image|twitter-image|not-found)\./.test(f))).toEqual([]);
    expect(existsSync(join(process.cwd(), "app", "matchup", "error.tsx"))).toBe(true);
  });
});

describe("steps 1-4: decided with no read", () => {
  it.each([
    ["BUF", "BUF"], ["buf", "BUF"], ["BUF", "LAR"], ["BUF", "XX"], ["BUF", "L.A"], ["XXX", "LA"], ["ſf", "BUF"], ["pıt", "BUF"],
    ["BUF", ""], ["BUFF", "LA"], ["B", "LA"], ["BUF", "L A"], ["BUF", "%00"],
  ])("/matchup/%s/%s is a 404, with no redirect first", async (away, home) => {
    expect(await outcome(away, home)).toBe("NEXT_NOT_FOUND");
    expect(loadMatchup).not.toHaveBeenCalled();
    expect(getSeasonWeeksCached).not.toHaveBeenCalled();
    expect(redirect).not.toHaveBeenCalled();
    expect(permanentRedirect).not.toHaveBeenCalled();
  });

  it("mixed case is a 308 to the upper-case address, keeping only a valid season", async () => {
    expect(await outcome("buf", "La", { season: "2026", x: "1" })).toBe("NEXT_REDIRECT 308 /matchup/BUF/LA?season=2026");
    expect(permanentRedirect).toHaveBeenCalledTimes(1);
    expect(redirect).not.toHaveBeenCalled();
    expect(loadMatchup).not.toHaveBeenCalled();
  });

  it.each([
    [{}, "/matchup/BUF/LA"],
    [{ ball: "home" }, "/matchup/BUF/LA?ball=home"],
    [{ ball: "HOME" }, "/matchup/BUF/LA"],
    [{ ball: ["home", "away"] }, "/matchup/BUF/LA"],
    // chaos 9: a season the site does not list is dropped here too, as the 307 drops it
    [{ season: "2031", ball: "home" }, "/matchup/BUF/LA?ball=home"],
    [{ season: "2031" }, "/matchup/BUF/LA"],
    [{ season: "1999" }, "/matchup/BUF/LA"],
    [{ season: "2100" }, "/matchup/BUF/LA"],
    [{ season: "2025", ball: "home" }, "/matchup/BUF/LA?season=2025&ball=home"],
    [{ season: "2026" }, "/matchup/BUF/LA?season=2026"],
    [{ season: "2025abc" }, "/matchup/BUF/LA"],
    [{ season: "1998" }, "/matchup/BUF/LA"],
    [{ season: ["2026", "2025"] }, "/matchup/BUF/LA"],
    [{ season: "99999999999999999999" }, "/matchup/BUF/LA"],
    [{ utm_source: "x", season: "2025" }, "/matchup/BUF/LA?season=2025"],
  ] as [Search, string][])("the 308's query is rebuilt from validated values: %j → %s", async (search, target) => {
    expect(await outcome("buf", "la", search)).toBe(`NEXT_REDIRECT 308 ${target}`);
    expect(loadMatchup).not.toHaveBeenCalled();
  });
});

describe("the 308 and the season list (chaos 9)", () => {
  it("with no season in the address the 308 reads nothing at all", async () => {
    expect(await outcome("buf", "la")).toBe("NEXT_REDIRECT 308 /matchup/BUF/LA");
    expect(await outcome("buf", "la", { ball: "home", season: "abc" })).toBe("NEXT_REDIRECT 308 /matchup/BUF/LA?ball=home");
    expect(getSeasonWeeksCached).not.toHaveBeenCalled();
    expect(loadMatchup).not.toHaveBeenCalled();
  });

  it("with a plausible season it asks the memoised season list once, and never loads the pair", async () => {
    expect(await outcome("buf", "la", { season: "2025" })).toBe("NEXT_REDIRECT 308 /matchup/BUF/LA?season=2025");
    expect(getSeasonWeeksCached).toHaveBeenCalledTimes(1);
    expect(loadMatchup).not.toHaveBeenCalled();
  });

  it("when the season list cannot be read the season is dropped (the bare address is always right) and one line is logged", async () => {
    vi.mocked(getSeasonWeeksCached).mockRejectedValue(new Error("Failed to fetch season weeks"));
    expect(await outcome("buf", "la", { season: "2025", ball: "home" })).toBe("NEXT_REDIRECT 308 /matchup/BUF/LA?ball=home");
    expect(errorSpy).toHaveBeenCalledTimes(1);
  });

  it("an empty or junk season list drops the season too", async () => {
    for (const answer of [[], null, "x", [null, { season: "2025" }]]) {
      vi.mocked(getSeasonWeeksCached).mockResolvedValue(answer as never);
      expect(await outcome("buf", "la", { season: "2025" })).toBe("NEXT_REDIRECT 308 /matchup/BUF/LA");
    }
  });

  it("the metadata of a URL about to 308 still reads nothing", async () => {
    await md("buf", "la", { season: "2025" });
    expect(getSeasonWeeksCached).not.toHaveBeenCalled();
    expect(loadMatchup).not.toHaveBeenCalled();
  });
});

describe("steps 5-7: the season handed to the loader, and the order redirect", () => {
  it("hands the loader upper-case ids and the validated season (null when absent or junk)", async () => {
    await outcome("BUF", "LA");
    expect(loadMatchup).toHaveBeenLastCalledWith("BUF", "LA", null);
    await outcome("BUF", "LA", { season: "2025" });
    expect(loadMatchup).toHaveBeenLastCalledWith("BUF", "LA", 2025);
    for (const season of ["1998", "abc", "2025.9", "2025abc", " 2025", "", ["2026", "2025"]]) {
      await outcome("BUF", "LA", { season });
      expect(loadMatchup).toHaveBeenLastCalledWith("BUF", "LA", null);
    }
  });

  it("the only game is the other way round: a 307 to the swapped order, with ball flipped", async () => {
    vi.mocked(loadMatchup).mockImplementation(async (a, h) => ready(a, h, { swap: true, game: null }));
    expect(await outcome("LA", "BUF")).toBe("NEXT_REDIRECT 307 /matchup/BUF/LA?ball=home");
    expect(await outcome("LA", "BUF", { ball: "home" })).toBe("NEXT_REDIRECT 307 /matchup/BUF/LA");
    expect(redirect).toHaveBeenCalledTimes(2);
    expect(permanentRedirect).not.toHaveBeenCalled();
  });

  it("the 307's season is the RESOLVED one: an unlisted ?season=2031 is dropped, a real past season kept", async () => {
    vi.mocked(loadMatchup).mockImplementation(async (a, h) => ready(a, h, { swap: true, game: null }));
    expect(await outcome("LA", "BUF", { season: "2031" })).toBe("NEXT_REDIRECT 307 /matchup/BUF/LA?ball=home");
    vi.mocked(loadMatchup).mockImplementation(async (a, h) => ready(a, h, { swap: true, game: null, season: 2025, isLatestSeason: false }));
    expect(await outcome("LA", "BUF", { season: "2025", x: "1" })).toBe("NEXT_REDIRECT 307 /matchup/BUF/LA?season=2025&ball=home");
    expect(await outcome("LA", "BUF", { season: "2025", ball: "home" })).toBe("NEXT_REDIRECT 307 /matchup/BUF/LA?season=2025");
  });

  it("both orders are real games (division rivals), or no game at all: no redirect", async () => {
    expect(await outcome("NE", "BUF")).toBe("200");
    expect(await outcome("BUF", "NE")).toBe("200");
    vi.mocked(loadMatchup).mockImplementation(async (a, h) => ready(a, h, { game: null }));
    expect(await outcome("BUF", "DAL")).toBe("200");
    expect(redirect).not.toHaveBeenCalled();
  });

  it("a failed core read rejects from the page (the route's error card), never a 404 or an empty page", async () => {
    vi.mocked(loadMatchup).mockRejectedValue(new Error("Failed to fetch matchup rows for 2026"));
    expect(await outcome("BUF", "LA")).toBe("Failed to fetch matchup rows for 2026");
    expect(notFound).not.toHaveBeenCalled();
  });
});

describe("the ready page", () => {
  it("header, toggle, both sides' ladder + panel, players, footnotes, in that order", async () => {
    const el = await html("BUF", "LA");
    const order = ["[data-matchup-header]", "[data-ball-toggle]", "[data-matchup-players]", "[data-matchup-notes]"].map((s) => el.querySelector(s));
    for (const node of order) expect(node).not.toBeNull();
    for (let i = 1; i < order.length; i++) {
      expect(order[i - 1]!.compareDocumentPosition(order[i]!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
    expect(el.querySelectorAll("[data-ball-view]")).toHaveLength(2);
    expect(el.querySelectorAll("[data-ladder]")).toHaveLength(2);
    expect(el.querySelectorAll("[data-matchup-panel]")).toHaveLength(2);
    expect(el.querySelectorAll("[data-ladder-row]")).toHaveLength(26);
    expect(el.querySelectorAll("[data-tile]")).toHaveLength(14);
    expect(el.querySelector("[data-at]")?.textContent).toBe("AT");
    expect(el.querySelector("h1")?.textContent).toBe("Buffalo Bills at Los Angeles Rams");
  });

  it("each slot holds its own side: away = away offense, home = home offense, ladder and radar together", async () => {
    const el = await html("BUF", "LA");
    for (const [ball, off, def] of [["away", "BUF", "LA"], ["home", "LA", "BUF"]] as const) {
      const slot = el.querySelector(`[data-ball-slot="${ball}"]`)!;
      expect(slot.querySelector('[data-unit="off"] [data-unit-title]')?.textContent).toBe(`${off} OFFENSE`);
      expect(slot.querySelector("[data-panel-pairing]")?.textContent).toBe(`${off} offense over ${def} defense`);
    }
  });

  it("the bare URL hides the home wrapper; ?ball=home hides the away wrapper (the server's first paint)", async () => {
    const bare = await html("BUF", "LA");
    expect([slotHidden(bare, "away"), slotHidden(bare, "home")]).toEqual([false, true]);
    const homeBall = await html("BUF", "LA", { ball: "home" });
    expect([slotHidden(homeBall, "away"), slotHidden(homeBall, "home")]).toEqual([true, false]);
    for (const junk of ["HOME", "away", ["home", "away"]]) {
      const el = await html("BUF", "LA", { ball: junk });
      expect([slotHidden(el, "away"), slotHidden(el, "home")]).toEqual([false, true]);
    }
  });

  it("a past season: team and player links carry ?season=, and the toggle is told the season", async () => {
    vi.mocked(loadMatchup).mockImplementation(async (a, h) =>
      ready(a, h, { season: 2025, isLatestSeason: false, lineup: pairLineups(pick(a, 2025), pick(h, 2025)) }));
    const el = await html("BUF", "LA", { season: "2025" });
    expect(el.querySelector('[data-slab="away"]')?.getAttribute("href")).toBe("/team/BUF?season=2025");
    expect(el.querySelector("[data-tile-name][href]")?.getAttribute("href")).toBe("/player/josh-allen?season=2025");
  });

  it("no game between the two (or only a stale never-played row): VS, the sentence, no redirect", async () => {
    vi.mocked(loadMatchup).mockImplementation(async (a, h) => ready(a, h, { game: null }));
    const el = await html("BUF", "DAL");
    expect(el.querySelector("[data-at]")?.textContent).toBe("VS");
    expect(el.querySelector("[data-no-game]")?.textContent).toBe("No 2026 game between these teams");
    expect(el.querySelectorAll("[data-slab-record]")).toHaveLength(2);
    expect(el.querySelector("h1")?.textContent).toBe("Buffalo Bills vs Dallas Cowboys");
    expect(redirect).not.toHaveBeenCalled();
  });

  it("the games read failed: no week, date or records, and never the no-game sentence", async () => {
    vi.mocked(loadMatchup).mockImplementation(async (a, h) => ready(a, h, { game: null, records: null, gamesAvailable: false }));
    const el = await html("BUF", "LA");
    expect(el.textContent).not.toContain("game between these teams");
    expect(el.querySelectorAll("[data-slab-record]")).toHaveLength(0);
    expect(el.querySelectorAll("[data-ladder-row]")).toHaveLength(26);
  });

  it("the player tables failed: the heading and M12, no tile; the ladders are unaffected", async () => {
    vi.mocked(loadMatchup).mockImplementation(async (a, h) => ready(a, h, { lineup: null, playersAvailable: false }));
    const el = await html("BUF", "LA");
    expect(el.querySelector("[data-players-unavailable]")?.textContent).toBe(MATCHUP_PLAYERS_UNAVAILABLE);
    expect(el.querySelector("[data-tile]")).toBeNull();
    expect(el.querySelectorAll("[data-ladder-row]")).toHaveLength(26);
  });

  it("a team with no games: M2 between the header and the toggle, and M3 in both tabs' panels", async () => {
    vi.mocked(loadMatchup).mockImplementation(async (a, h) => ready(a, h, { model: model(a, h, rowsWithout("BUF")) }));
    const el = await html("BUF", "LA");
    const note = el.querySelector("[data-no-games-note]")!;
    expect(note.textContent).toBe(matchupNoGamesNote("Buffalo Bills", 2026));
    expect(el.querySelector("[data-matchup-header]")!.compareDocumentPosition(note) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(note.compareDocumentPosition(el.querySelector("[data-ball-toggle]")!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(Array.from(el.querySelectorAll("[data-panel-empty]")).map((p) => p.textContent)).toEqual([MATCHUP_NO_OVERLAY_NOTE, MATCHUP_NO_OVERLAY_NOTE]);
    expect(el.querySelectorAll("[data-no-games-note]")).toHaveLength(1);
  });

  it("logs model.rejected once, in one console.error, radar and Team Stats names as they are", async () => {
    const m = { ...model("BUF", "LA"), rejected: ["BUF off sack", "BUF off sr"] };
    vi.mocked(loadMatchup).mockImplementation(async (a, h) => ready(a, h, { model: m }));
    await html("BUF", "LA");
    expect(errorSpy).toHaveBeenCalledTimes(1);
    const line = errorSpy.mock.calls[0].map(String).join(" ");
    expect(line).toContain("BUF off sack");
    expect(line).toContain("BUF off sr");
    expect(line).toContain("BUF at LA");
  });

  it("logs nothing when nothing was rejected, and metadata never logs the list", async () => {
    await html("BUF", "LA");
    expect(errorSpy).not.toHaveBeenCalled();
    const m = { ...model("BUF", "LA"), rejected: ["BUF off sack"] };
    vi.mocked(loadMatchup).mockImplementation(async (a, h) => ready(a, h, { model: m }));
    await md("BUF", "LA");
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it("no win probability, projected score or named winner anywhere", async () => {
    expect((await html("BUF", "LA")).textContent).not.toMatch(/win probability:|projected score|favou?red to|will win/i);
  });
});

// New with the matchup card (spec 2026-10-11 §8.2): the Share block.
describe("the Share block: shown exactly when the share page is a card", () => {
  const share = (el: HTMLElement) => el.querySelector("[data-matchup-share]");

  it("a ready pair: between the header and the possession tabs, in normal flow, with its three URLs", async () => {
    const el = await html("BUF", "LA");
    const block = share(el)!;
    expect(block).not.toBeNull();
    const header = el.querySelector("[data-matchup-header]")!;
    const toggle = el.querySelector("[data-ball-toggle]")!;
    expect(header.compareDocumentPosition(block) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(block.compareDocumentPosition(toggle) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // Not inside the header, the toggle or either tab's content: it does not change with the tab.
    expect(header.contains(block)).toBe(false);
    expect(toggle.contains(block)).toBe(false);
    expect(el.querySelectorAll("[data-matchup-share]")).toHaveLength(1);
    expect(block.getAttribute("data-share-url")).toBe(`${BASE}/card/matchup/BUF/LA`);
    expect(block.getAttribute("data-download-href")).toBe("/api/matchup-card/BUF/LA?season=2026&w=3&download=1");
    const open = block.querySelector("a")!;
    expect([open.getAttribute("href"), open.getAttribute("data-prefetch"), open.textContent]).toEqual(["/card/matchup/BUF/LA", "false", "Open share card →"]);
    expect(block.querySelector("[data-matchup-share-heading]")?.textContent).toBe("Share this matchup");
    // Nothing floats: no class on it or inside it positions it out of the flow.
    for (const node of [block, ...Array.from(block.querySelectorAll("*"))]) {
      expect(node.getAttribute("class") ?? "").not.toMatch(/(^|\s)(\S+:)?(fixed|sticky|absolute)(\s|$)|red-\d00/);
    }
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it("the same block whichever team has the ball, and for a pair with no game", async () => {
    const away = share(await html("BUF", "LA"))!.outerHTML;
    expect(share(await html("BUF", "LA", { ball: "home" }))!.outerHTML).toBe(away);
    vi.mocked(loadMatchup).mockImplementation(async (a, h) => ready(a, h, { game: null }));
    const vs = share(await html("BUF", "DAL"))!;
    expect(vs.getAttribute("data-share-url")).toBe(`${BASE}/card/matchup/BUF/DAL`);
  });

  it("a past season: ?season= on the share URLs and the season on the download", async () => {
    vi.mocked(loadMatchup).mockImplementation(async (a, h) =>
      ready(a, h, { season: 2025, isLatestSeason: false, lineup: pairLineups(pick(a, 2025), pick(h, 2025)) }));
    const block = share(await html("BUF", "LA", { season: "2025" }))!;
    expect(block.getAttribute("data-share-url")).toBe(`${BASE}/card/matchup/BUF/LA?season=2025`);
    expect(block.querySelector("a")?.getAttribute("href")).toBe("/card/matchup/BUF/LA?season=2025");
    expect(block.getAttribute("data-download-href")).toBe("/api/matchup-card/BUF/LA?season=2025&w=3&download=1");
  });

  it("the copied address is built on the server from NEXT_PUBLIC_SITE_URL", async () => {
    process.env.NEXT_PUBLIC_SITE_URL = "https://preview.example";
    try {
      expect(share(await html("BUF", "LA"))!.getAttribute("data-share-url")).toBe("https://preview.example/card/matchup/BUF/LA");
    } finally {
      delete process.env.NEXT_PUBLIC_SITE_URL;
    }
  });

  it("one radar that cannot be drawn is still a card, so the block is still there", async () => {
    const three = ROWS.map((r) => (r.team_id === "BUF" ? { ...r, pass_plays: 0, attempts: 0, sacks: 0, total_drives: 0 } : r));
    vi.mocked(loadMatchup).mockImplementation(async (a, h) => ready(a, h, { model: model(a, h, three) }));
    expect(share(await html("BUF", "LA"))).not.toBeNull();
  });

  it("hidden where the share page is a message page: small-pool, uncovered, a team with no games, the games read failed", async () => {
    vi.mocked(loadMatchup).mockResolvedValue(smallPool());
    expect(share(await html("BUF", "LA"))).toBeNull();
    vi.mocked(loadMatchup).mockResolvedValue(uncovered());
    expect(share(await html("BUF", "LA", { season: "2025" }))).toBeNull();
    // A team with no games: neither radar can be drawn, so the card is a plate.
    vi.mocked(loadMatchup).mockImplementation(async (a, h) => ready(a, h, { model: model(a, h, rowsWithout("BUF")) }));
    const idle = await html("BUF", "LA");
    expect(share(idle)).toBeNull();
    expect(idle.querySelector("[data-no-games-note]")).not.toBeNull();
    // The games read failed: the image would be a 503, so nothing is offered to share.
    vi.mocked(loadMatchup).mockImplementation(async (a, h) => ready(a, h, { game: null, records: null, gamesAvailable: false }));
    const degraded = await html("BUF", "LA");
    expect(share(degraded)).toBeNull();
    expect(degraded.querySelectorAll("[data-ladder-row]")).toHaveLength(26);
  });

  it("with a no-games note the order would be header, note, Share block, tabs; the block is keyed by its card so Copied! never carries to another pair", async () => {
    const source = readFileSync(join(process.cwd(), "app", "matchup", "[away]", "[home]", "page.tsx"), "utf8");
    expect(source).toMatch(/<MatchupShare\s+key=\{cardHref\}/);
    expect(source.indexOf("data-no-games-note")).toBeLessThan(source.indexOf("<MatchupShare"));
    expect(source.indexOf("<MatchupShare")).toBeLessThan(source.indexOf("<MatchupBallToggle"));
  });
});

describe("small-pool and uncovered", () => {
  it("small-pool: header, M1, players; no toggle, no ladder, no panel, no rank", async () => {
    vi.mocked(loadMatchup).mockResolvedValue(smallPool());
    const el = await html("BUF", "LA", { ball: "home" });
    expect(el.querySelector("[data-matchup-header]")).not.toBeNull();
    expect(el.querySelector("[data-small-pool]")?.textContent).toBe(MATCHUP_SMALL_POOL_NOTE);
    expect(el.querySelector("[data-matchup-players]")).not.toBeNull();
    for (const s of ["[data-ball-toggle]", "[data-ball-tab]", "[data-ladder]", "[data-matchup-panel]", "svg"]) expect(el.querySelector(s)).toBeNull();
    expect(el.textContent).not.toMatch(/\b\d+(st|nd|rd|th)\b/);
  });

  it("uncovered: the header (records when available), M13, a link to the pair in the newest season; no toggle, ladder, panel, tile or footnote", async () => {
    vi.mocked(loadMatchup).mockResolvedValue(uncovered());
    const el = await html("BUF", "LA", { season: "2025" });
    expect(el.querySelector("[data-matchup-header]")).not.toBeNull();
    expect(el.querySelectorAll("[data-slab-record]")).toHaveLength(2);
    expect(el.querySelector("[data-uncovered]")?.textContent).toContain(matchupUncoveredHeading(2025, 2026));
    expect(el.querySelector("[data-uncovered] a")?.getAttribute("href")).toBe("/matchup/BUF/LA");
    // chaos 9: the link keeps the side the visitor was looking at
    const home = await html("BUF", "LA", { season: "2025", ball: "home" });
    expect(home.querySelector("[data-uncovered] a")?.getAttribute("href")).toBe("/matchup/BUF/LA?ball=home");
    for (const s of ["[data-ball-toggle]", "[data-ladder]", "[data-matchup-panel]", "[data-tile]", "[data-matchup-players]", "[data-matchup-notes]"]) {
      expect(el.querySelector(s), s).toBeNull();
    }
  });

  it("uncovered with no first season: the neutral heading", async () => {
    vi.mocked(loadMatchup).mockResolvedValue(uncovered({ firstSeason: null }));
    const el = await html("BUF", "LA", { season: "2025" });
    expect(el.querySelector("[data-uncovered]")?.textContent).toContain(matchupUncoveredHeading(2025, null));
  });

  it("an uncovered pair in the other order still redirects", async () => {
    vi.mocked(loadMatchup).mockResolvedValue(uncovered({ swap: true }));
    expect(await outcome("LA", "BUF", { season: "2025" })).toBe("NEXT_REDIRECT 307 /matchup/BUF/LA?season=2025&ball=home");
  });
});

describe("generateMetadata (§4.4)", () => {
  const NOT_FOUND = { title: { absolute: "Matchup Not Found — Yards Per Pass" }, robots: { index: false, follow: true } };

  it("an invalid pair: the absolute Not Found title, noindex, no read", async () => {
    for (const [a, h] of [["BUF", "BUF"], ["XXX", "LA"], ["ſf", "BUF"], ["BUF", "L.A"]]) {
      expect(await md(a, h)).toEqual(NOT_FOUND);
    }
    expect(loadMatchup).not.toHaveBeenCalled();
  });

  it("a URL about to 308 gets the same plain object, with no read", async () => {
    expect(await md("buf", "LA")).toEqual(NOT_FOUND);
    expect(loadMatchup).not.toHaveBeenCalled();
  });

  it("a URL about to 307 (swap) gets it too: never an \"A at B\" title for the wrong order", async () => {
    vi.mocked(loadMatchup).mockImplementation(async (a, h) => ready(a, h, { swap: true, game: null }));
    expect(await md("LA", "BUF")).toEqual(NOT_FOUND);
  });

  it("a scheduled pair: the \"at\" title, the description with the week, the bare canonical, indexable", async () => {
    const meta = await md("BUF", "LA");
    expect(meta.title).toBe("Buffalo Bills at Los Angeles Rams: Team Matchup 2026");
    expect(meta.description).toBe(
      "BUF offense against the LA defense, and LA offense against the BUF defense, by league rank through Week 3: EPA per play, success rate, explosive plays, sacks, stuffs and turnovers.",
    );
    expect(meta.alternates?.canonical).toBe(`${BASE}/matchup/BUF/LA`);
    expect(meta.robots).toBeUndefined();
  });

  it("the description drops the week when it is unknown", async () => {
    vi.mocked(loadMatchup).mockImplementation(async (a, h) => ready(a, h, { model: { ...model(a, h), throughWeek: null } }));
    expect((await md("BUF", "LA")).description).toBe(
      "BUF offense against the LA defense, and LA offense against the BUF defense, by league rank: EPA per play, success rate, explosive plays, sacks, stuffs and turnovers.",
    );
  });

  it("no game in this order: the \"vs\" title and noindex, follow", async () => {
    vi.mocked(loadMatchup).mockImplementation(async (a, h) => ready(a, h, { game: null }));
    const meta = await md("BUF", "DAL");
    expect(meta.title).toBe("Buffalo Bills vs Dallas Cowboys: Team Matchup 2026");
    expect(meta.robots).toEqual({ index: false, follow: true });
  });

  it("small-pool and uncovered are noindex even with a game", async () => {
    vi.mocked(loadMatchup).mockResolvedValue(smallPool());
    expect((await md("BUF", "LA")).robots).toEqual({ index: false, follow: true });
    vi.mocked(loadMatchup).mockResolvedValue(uncovered({ game: game("BUF", "LA") }));
    const meta = await md("BUF", "LA", { season: "2025" });
    expect(meta.robots).toEqual({ index: false, follow: true });
    expect(meta.title).toBe("Buffalo Bills at Los Angeles Rams: Team Matchup 2025");
  });

  it("the canonical carries ?season= only for a real season other than the newest, and never ball", async () => {
    expect((await md("BUF", "LA", { ball: "home" })).alternates?.canonical).toBe(`${BASE}/matchup/BUF/LA`);
    expect((await md("BUF", "LA", { season: "2026" })).alternates?.canonical).toBe(`${BASE}/matchup/BUF/LA`);
    // the loader answers the default season for junk or an unlisted season
    for (const season of ["2025.9", "2025abc", "2031", "1998"]) {
      expect((await md("BUF", "LA", { season })).alternates?.canonical).toBe(`${BASE}/matchup/BUF/LA`);
    }
    vi.mocked(loadMatchup).mockImplementation(async (a, h) => ready(a, h, { season: 2025, isLatestSeason: false }));
    const past = await md("BUF", "LA", { season: "2025", ball: "home" });
    expect(past.alternates?.canonical).toBe(`${BASE}/matchup/BUF/LA?season=2025`);
    expect(past.title).toBe("Buffalo Bills at Los Angeles Rams: Team Matchup 2025");
  });

  // Rewritten on purpose by the matchup card spec (2026-10-11 §8.3): this test
  // used to assert "no preview image of its own" (the team matchup spec's line
  // 30 and 243, superseded). The page now names the matchup card's image.
  it("the preview image is the matchup card's: the card for a ready pair, the plate's URL for small-pool, none when the games could not be read", async () => {
    const meta = await md("BUF", "LA");
    const image = `${BASE}/api/matchup-card/BUF/LA?season=2026&w=3`;
    expect(meta.openGraph?.images).toEqual([{ url: image, width: 1200, height: 630, alt: "Buffalo Bills at Los Angeles Rams matchup card, 2026" }]);
    expect(meta.twitter).toEqual({ card: "summary_large_image", title: meta.title, description: meta.description, images: [image] });
    // og:url and the canonical stay the matchup page's own.
    expect(meta.openGraph?.url).toBe(`${BASE}/matchup/BUF/LA`);
    expect(meta.alternates?.canonical).toBe(`${BASE}/matchup/BUF/LA`);
    // ?ball=home previews the same card (one card per game).
    expect((await md("BUF", "LA", { ball: "home" })).openGraph?.images).toEqual(meta.openGraph?.images);

    // small-pool: the same route draws the plate there, never a broken image.
    vi.mocked(loadMatchup).mockResolvedValue(smallPool());
    const small = await md("BUF", "LA");
    expect((small.openGraph?.images as { url: string }[])[0].url).toMatch(/^https:\/\/yardsperpass\.com\/api\/matchup-card\/BUF\/LA\?season=2026(&w=\d+)?$/);
    expect(small.twitter?.images).toEqual([(small.openGraph?.images as { url: string }[])[0].url]);

    // the games read failed: the image route would answer 503, so no image is named (as before this spec).
    vi.mocked(loadMatchup).mockImplementation(async (a, h) => ready(a, h, { game: null, records: null, gamesAvailable: false }));
    const degraded = await md("BUF", "LA");
    expect(degraded.openGraph?.images).toBeUndefined();
    expect(degraded.twitter?.images).toBeUndefined();
    expect(degraded.twitter).toBeUndefined();
    expect(degraded.openGraph?.url).toBe(`${BASE}/matchup/BUF/LA`);
  });

  it("the preview image names the season shown and the week; a past season and a pair with no game", async () => {
    vi.mocked(loadMatchup).mockImplementation(async (a, h) => ready(a, h, { season: 2025, isLatestSeason: false }));
    const past = await md("BUF", "LA", { season: "2025" });
    expect((past.openGraph?.images as { url: string }[])[0].url).toBe(`${BASE}/api/matchup-card/BUF/LA?season=2025&w=3`);
    vi.mocked(loadMatchup).mockImplementation(async (a, h) => ready(a, h, { game: null }));
    const vs = await md("BUF", "DAL");
    expect(vs.openGraph?.images).toEqual([
      { url: `${BASE}/api/matchup-card/BUF/DAL?season=2026&w=3`, width: 1200, height: 630, alt: "Buffalo Bills vs Dallas Cowboys matchup card, 2026" },
    ]);
    // uncovered: no model, so no week; the route draws the plate
    vi.mocked(loadMatchup).mockResolvedValue(uncovered());
    expect(((await md("BUF", "LA", { season: "2025" })).openGraph?.images as { url: string }[])[0].url).toBe(`${BASE}/api/matchup-card/BUF/LA?season=2025`);
    // a week outside 1-22 sends no w
    vi.mocked(loadMatchup).mockImplementation(async (a, h) => ready(a, h, { model: { ...model(a, h), throughWeek: 23 } }));
    expect(((await md("BUF", "LA")).openGraph?.images as { url: string }[])[0].url).toBe(`${BASE}/api/matchup-card/BUF/LA?season=2026`);
  });

  it("a failed core read rejects here too (read resilience 1A)", async () => {
    vi.mocked(loadMatchup).mockRejectedValue(new Error("Failed to fetch season weeks"));
    await expect(md("BUF", "LA")).rejects.toThrow("Failed to fetch season weeks");
  });
});
