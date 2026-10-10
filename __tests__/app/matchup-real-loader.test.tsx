// The matchup pages over the REAL loaders (lib/data/matchup.ts), with only
// the lowest reads replaced: proof that the pages fit the loader's actual
// answers, where matchup-route.test.tsx states them by hand.
//
// THE CLOCK IS PINNED. The loader hands the schedule rules today's date (US
// Eastern), and a never-played game more than two days past its date is
// stale: without a fixed date these fixture games would turn into "VS", no
// redirect and an empty slate as the calendar moves (spec §11).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

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
vi.mock("@/lib/data/queries", () => ({
  getSeasonWeeks: vi.fn(),
  getQBStats: vi.fn(),
  getAvailableSeasons: vi.fn(),
  fallbackSeason: () => 2026,
}));
vi.mock("@/lib/data/receivers", () => ({ getReceiverStats: vi.fn() }));
vi.mock("@/lib/data/rushing", () => ({ getRBSeasonStats: vi.fn() }));
vi.mock("@/lib/data/players", () => ({ getPlayerBySlug: vi.fn(), getPlayerSlugIndex: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ hasNoDatabase: vi.fn(() => false), createServerClient: vi.fn() }));
vi.mock("@/lib/data/utils", async (original) => ({
  ...(await original<typeof import("@/lib/data/utils")>()),
  fetchAllRows: vi.fn(),
}));
vi.mock("@/lib/data/games", async (original) => ({
  ...(await original<typeof import("@/lib/data/games")>()),
  getSeasonGames: vi.fn(),
}));
vi.mock("@/lib/data/box-score", async (original) => ({
  ...(await original<typeof import("@/lib/data/box-score")>()),
  getBoxScoreSeasonsCached: vi.fn(),
}));

import MatchupPage, { generateMetadata } from "@/app/matchup/[away]/[home]/page";
import MatchupIndexPage from "@/app/matchup/page";
import playerRowsJson from "../stats/fixtures/compare-2026-w4-rows.json";
import { clearMatchupMemo } from "@/lib/data/matchup";
import { clearCompareCardMemo } from "@/lib/data/compare-card";
import { getBoxScoreSeasonsCached } from "@/lib/data/box-score";
import { getSeasonGames, type GameRecord } from "@/lib/data/games";
import { getSeasonWeeks, getQBStats } from "@/lib/data/queries";
import { getReceiverStats } from "@/lib/data/receivers";
import { getRBSeasonStats } from "@/lib/data/rushing";
import { getPlayerSlugIndex } from "@/lib/data/players";
import { fetchAllRows } from "@/lib/data/utils";
import { ROWS } from "../components/matchup/helpers";

const NOW = "2026-10-08T16:00:00Z"; // Thursday of week 5, before any unplayed game below
const game = (over: Partial<GameRecord>): GameRecord => ({
  game_id: "2026_05_BUF_LA", season: 2026, game_type: "REG", week: 5, gameday: "2026-10-12", weekday: "Monday",
  gametime: "20:15", home_team: "LA", away_team: "BUF", home_score: null, away_score: null, ...over,
});
const GAMES: GameRecord[] = [
  game({ game_id: "2026_01_BUF_HOU", week: 1, gameday: "2026-09-13", weekday: "Sunday", gametime: "13:00", away_team: "BUF", home_team: "HOU", away_score: 27, home_score: 20 }),
  game({}),
  game({ game_id: "2026_05_NE_BUF_X", week: 5, gameday: "2026-10-11", weekday: "Sunday", gametime: "13:00", away_team: "KC", home_team: "DEN" }),
  game({ game_id: "2026_06_NE_BUF", week: 6, gameday: "2026-10-18", weekday: "Sunday", gametime: "13:00", away_team: "NE", home_team: "BUF" }),
  game({ game_id: "2026_15_BUF_NE", week: 15, gameday: "2026-12-20", weekday: "Sunday", gametime: "13:00", away_team: "BUF", home_team: "NE" }),
];
const INDEX = new Map([["josh-allen", { slug: "josh-allen", player_id: "00-0034857", player_name: "Josh Allen", position: "QB", current_team_id: "BUF" }]]);

type Search = Record<string, string | string[] | undefined>;
const args = (away: string, home: string, search: Search = {}) => ({ params: Promise.resolve({ away, home }), searchParams: Promise.resolve(search) });
const outcome = (away: string, home: string, search: Search = {}) => MatchupPage(args(away, home, search)).then(() => "200", (e: Error) => e.message);
async function html(away: string, home: string, search: Search = {}): Promise<HTMLElement> {
  const el = document.createElement("div");
  el.innerHTML = renderToStaticMarkup(await MatchupPage(args(away, home, search)));
  return el;
}

let errorSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  clearMatchupMemo();
  clearCompareCardMemo();
  vi.mocked(getSeasonWeeks).mockResolvedValue([{ season: 2026, through_week: 4 }, { season: 2025, through_week: 22 }]);
  vi.mocked(getPlayerSlugIndex).mockResolvedValue(INDEX as never);
  vi.mocked(getQBStats).mockResolvedValue(playerRowsJson.qb as never);
  vi.mocked(getReceiverStats).mockResolvedValue(playerRowsJson.receivers as never);
  vi.mocked(getRBSeasonStats).mockResolvedValue(playerRowsJson.rb as never);
  vi.mocked(fetchAllRows).mockImplementation(async (_table, _select, filters) => (filters.season === 2026 ? ROWS : []));
  vi.mocked(getSeasonGames).mockResolvedValue(GAMES);
  vi.mocked(getBoxScoreSeasonsCached).mockResolvedValue([2026]);
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(NOW));
});
afterEach(() => {
  errorSpy.mockRestore();
  vi.useRealTimers();
});

describe("the matchup page over the real loader (clock pinned to 2026-10-08)", () => {
  it("BUF at LA: AT, Week 5, the kickoff, records from the games, tiles with a linked name", async () => {
    const el = await html("BUF", "LA");
    expect(el.querySelector("[data-at]")?.textContent).toBe("AT");
    expect(el.querySelector("[data-week]")?.textContent).toBe("Week 5");
    expect(el.querySelector("[data-kickoff]")?.textContent).toBe("Mon Oct 12 · 8:15 PM ET");
    expect(el.querySelector('[data-slab="away"] [data-slab-record]')?.textContent).toBe("1-0 · away");
    expect(el.querySelector('[data-slab="home"] [data-slab-record]')?.textContent).toBe("0-0 · home");
    expect(el.querySelectorAll("[data-ladder-row]")).toHaveLength(26);
    expect(el.querySelector('[data-team-group="BUF"] [data-tile-name]')?.getAttribute("href")).toBe("/player/josh-allen");
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it("LA at BUF, when the only game is BUF at LA: a 307 to the scheduled order with the ball kept on the same team", async () => {
    expect(await outcome("LA", "BUF")).toBe("NEXT_REDIRECT 307 /matchup/BUF/LA?ball=home");
    expect(await outcome("LA", "BUF", { season: "2031", ball: "home" })).toBe("NEXT_REDIRECT 307 /matchup/BUF/LA");
    expect(await generateMetadata(args("LA", "BUF"))).toEqual({
      title: { absolute: "Matchup Not Found — Yards Per Pass" }, robots: { index: false, follow: true },
    });
  });

  it("NE at BUF and BUF at NE (two games): each URL is its own page", async () => {
    expect((await html("NE", "BUF")).querySelector("[data-week]")?.textContent).toBe("Week 6");
    expect((await html("BUF", "NE")).querySelector("[data-week]")?.textContent).toBe("Week 15");
  });

  it("a pair with no game: VS, the sentence, noindex and the vs title", async () => {
    const el = await html("BUF", "DAL");
    expect(el.querySelector("[data-at]")?.textContent).toBe("VS");
    expect(el.querySelector("[data-no-game]")?.textContent).toBe("No 2026 game between these teams");
    const meta = await generateMetadata(args("BUF", "DAL"));
    expect(meta.title).toBe("Buffalo Bills vs Dallas Cowboys: Team Matchup 2026");
    expect(meta.robots).toEqual({ index: false, follow: true });
  });

  it("three weeks later the same never-played row is stale: the pair has no game (why the clock is pinned)", async () => {
    vi.setSystemTime(new Date("2026-10-29T16:00:00Z"));
    const el = await html("BUF", "LA");
    expect(el.querySelector("[data-at]")?.textContent).toBe("VS");
  });

  it("?season=2025 (listed, no rows): the uncovered message page, noindex", async () => {
    const el = await html("BUF", "LA", { season: "2025" });
    expect(el.querySelector("[data-uncovered]")?.textContent).toContain("Team matchups start with the 2026 season");
    expect(el.querySelector("[data-tile]")).toBeNull();
    expect((await generateMetadata(args("BUF", "LA", { season: "2025" }))).robots).toEqual({ index: false, follow: true });
  });

  it("the games read fails: the page still renders, with no date, records or sentence", async () => {
    vi.mocked(getSeasonGames).mockRejectedValue(new Error("Failed to fetch games"));
    const el = await html("BUF", "LA");
    expect(el.querySelector("[data-week]")).toBeNull();
    expect(el.querySelector("[data-slab-record]")).toBeNull();
    expect(el.textContent).not.toContain("game between these teams");
    expect(el.querySelectorAll("[data-ladder-row]")).toHaveLength(26);
  });

  it("the rows read fails: the page rejects", async () => {
    vi.mocked(fetchAllRows).mockRejectedValue({ message: "upstream" });
    expect(await outcome("BUF", "LA")).toMatch(/matchup rows for 2026/);
  });
});

describe("/matchup over the real loader (clock pinned)", () => {
  it("lists the current week's games, linked away-first", async () => {
    const el = document.createElement("div");
    el.innerHTML = renderToStaticMarkup(await MatchupIndexPage());
    expect(el.querySelector("[data-matchup-slate] h2")?.textContent).toBe("Week 5");
    expect(Array.from(el.querySelectorAll("a[data-slate-row]")).map((a) => a.getAttribute("href"))).toEqual(["/matchup/KC/DEN", "/matchup/BUF/LA"]);
  });
});
