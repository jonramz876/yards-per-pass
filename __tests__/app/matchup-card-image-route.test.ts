import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// /api/matchup-card/[away]/[home] — the 1200×630 PNG of one game's matchup
// card: the link preview, and with &download=1 the Download button's file
// (matchup card spec 2026-10-11 §4.2, PR 2). Every row of the spec's table,
// with its status and its exact cache-control.
//
// The REAL loader runs (lib/data/matchup.ts); only the lowest reads are
// replaced, as in matchup-real-loader.test.tsx. THE CLOCK IS PINNED: the
// loader hands the schedule rules today's date, and a never-played game more
// than two days past its date is stale.
//
// @vercel/og cannot render on Windows, so next/og is replaced by a class that
// records what it was given and answers 200 with its headers built exactly the
// way the real one builds them: a LOWERCASE one-year `cache-control` default
// with the caller's headers spread on top. Only a lowercase key replaces it.
const NEXT_OG_DEFAULT_CACHE = "public, immutable, no-transform, max-age=31536000";
const images: { element: unknown; options: Record<string, unknown> }[] = [];
vi.mock("next/og", () => ({
  ImageResponse: class extends Response {
    constructor(element: unknown, options: Record<string, unknown> = {}) {
      super("png", {
        status: 200,
        headers: {
          "content-type": "image/png",
          "cache-control": "public, immutable, no-transform, max-age=31536000",
          ...(options.headers as Record<string, string> | undefined),
        },
      });
      images.push({ element, options });
    }
  },
}));
vi.mock("@/lib/og/team-radar-image", () => ({
  PIXEL: "PressStart",
  SANS: "RadarSans",
  radarImageFonts: vi.fn(async () => [{ name: "F", data: new ArrayBuffer(1), style: "normal" }]),
}));
vi.mock("@/lib/og/matchup-card-image", () => ({
  matchupCardImage: vi.fn((model: unknown) => ({ card: model })),
  matchupPlateImage: vi.fn((model: unknown) => ({ plate: model })),
}));
vi.mock("@/lib/data/queries", () => ({
  getSeasonWeeks: vi.fn(), getQBStats: vi.fn(), getAvailableSeasons: vi.fn(), fallbackSeason: () => 2026,
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

import * as route from "@/app/api/matchup-card/[away]/[home]/route";
import { GET } from "@/app/api/matchup-card/[away]/[home]/route";
import playerRowsJson from "../stats/fixtures/compare-2026-w4-rows.json";
import { clearMatchupMemo, matchupMemoKeys } from "@/lib/data/matchup";
import { clearCompareCardMemo, compareCardMemoKeys } from "@/lib/data/compare-card";
import { getBoxScoreSeasonsCached } from "@/lib/data/box-score";
import { getSeasonGames, type GameRecord } from "@/lib/data/games";
import { getSeasonWeeks, getQBStats } from "@/lib/data/queries";
import { getReceiverStats } from "@/lib/data/receivers";
import { getRBSeasonStats } from "@/lib/data/rushing";
import { getPlayerSlugIndex } from "@/lib/data/players";
import { hasNoDatabase } from "@/lib/supabase/server";
import { fetchAllRows } from "@/lib/data/utils";
import { matchupCardImage, matchupPlateImage } from "@/lib/og/matchup-card-image";
import { radarImageFonts } from "@/lib/og/team-radar-image";
import { MATCHUP_SMALL_POOL_NOTE } from "@/lib/stats/matchup";
import type { MatchupCardModel } from "@/lib/stats/matchup-card";
import { NFL_TEAMS } from "@/lib/data/teams";
import { ROWS } from "../components/matchup/helpers";

const NOW = "2026-10-08T16:00:00Z"; // Thursday of week 5, before the unplayed games below
const game = (over: Partial<GameRecord>): GameRecord => ({
  game_id: "2026_05_BUF_LA", season: 2026, game_type: "REG", week: 5, gameday: "2026-10-12", weekday: "Monday",
  gametime: "20:15", home_team: "LA", away_team: "BUF", home_score: null, away_score: null, ...over,
});
const GAMES: GameRecord[] = [
  game({ game_id: "2026_01_BUF_HOU", week: 1, gameday: "2026-09-13", weekday: "Sunday", gametime: "13:00", away_team: "BUF", home_team: "HOU", away_score: 27, home_score: 20 }),
  game({}),
  game({ game_id: "2026_06_NE_BUF", week: 6, gameday: "2026-10-18", weekday: "Sunday", gametime: "13:00", away_team: "NE", home_team: "BUF" }),
  game({ game_id: "2026_15_BUF_NE", week: 15, gameday: "2026-12-20", weekday: "Sunday", gametime: "13:00", away_team: "BUF", home_team: "NE" }),
];
const WEEKS = [{ season: 2026, through_week: 4 }, { season: 2025, through_week: 22 }];
const SEVEN = Array.from(new Set(ROWS.map((r) => r.team_id as string))).sort().slice(0, 7);

const STORED = "public, max-age=0, s-maxage=3600";
const get = (away: string, home: string, query = "") =>
  GET(new Request(`https://yardsperpass.com/api/matchup-card/${away}/${home}${query}`), { params: Promise.resolve({ away, home }) });

const READS = [getSeasonWeeks, getPlayerSlugIndex, getQBStats, getReceiverStats, getRBSeasonStats, fetchAllRows, getSeasonGames, getBoxScoreSeasonsCached];
const readCount = () => READS.reduce((n, fn) => n + vi.mocked(fn as never as () => unknown).mock.calls.length, 0);

async function expectNotFound(res: Response, cache: string) {
  expect(res.status).toBe(404);
  expect(await res.text()).toBe("Not found");
  expect(res.headers.get("cache-control")).toBe(cache);
  expect(res.headers.get("content-type")).toBe("text/plain; charset=utf-8");
  expect(images).toHaveLength(0);
  expect(matchupCardImage).not.toHaveBeenCalled();
  expect(matchupPlateImage).not.toHaveBeenCalled();
}

/** The answer every failed read must get: retryable, never stored, no image drawn. */
async function expectUnavailable(res: Response) {
  expect(res.status).toBe(503);
  expect(await res.text()).toBe("Matchup card image temporarily unavailable. Try again in a few minutes.");
  expect(res.headers.get("cache-control")).toBe("no-store");
  expect(res.headers.get("retry-after")).toBe("60");
  expect(res.headers.get("content-type")).toBe("text/plain; charset=utf-8");
  expect(images).toHaveLength(0);
  expect(matchupCardImage).not.toHaveBeenCalled();
  expect(matchupPlateImage).not.toHaveBeenCalled();
}

let errorSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  images.length = 0;
  clearMatchupMemo();
  clearCompareCardMemo();
  for (const fn of READS) vi.mocked(fn as never as () => unknown).mockReset();
  vi.mocked(matchupCardImage).mockClear();
  vi.mocked(matchupPlateImage).mockClear();
  vi.mocked(radarImageFonts).mockClear();
  vi.mocked(hasNoDatabase).mockReturnValue(false);
  vi.mocked(getSeasonWeeks).mockResolvedValue(WEEKS);
  vi.mocked(getPlayerSlugIndex).mockResolvedValue(new Map() as never);
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

describe("route config", () => {
  it("runs on Node (the fonts are read with fs) and is never cached by Next itself", () => {
    expect(route.runtime).toBe("nodejs");
    expect(route.revalidate).toBe(0);
  });
});

describe("rows 1-3: junk is a 404 before any read and before any render, kept by the CDN so it is not re-run", () => {
  it.each([
    ["buf", "LA"], ["Buf", "LA"], ["BUF", "la"], ["BUF", "La"], ["XXX", "LA"], ["BUF", "LAR"], ["BUF", "XX"],
    ["ſf", "BUF"], ["pıt", "BUF"], ["ΒUF", "LA"], ["BUF", ""], ["", "LA"], ["BUFF", "LA"], ["B", "LA"], ["BUF", "L.A"], ["BUF", "L A"],
    ["BUF", "%00"], ["BUF", "LA%00"], ["BUF", "x".repeat(300)], ["<script>", "LA"], ["BUF", "BUF/LA"],
  ])("row 1, a segment that is not exactly an upper-case team id: /api/matchup-card/%s/%s", async (away, home) => {
    await expectNotFound(await get(away, home), STORED);
    expect(readCount()).toBe(0);
  });

  it("row 1: every one of the 32 ids is drawn in upper case and refused in lower case (case is strict: no redirect on an image)", async () => {
    // Dallas has no game in this test's schedule, so no order is "the other way round".
    for (const t of NFL_TEAMS.filter((x) => x.id !== "DAL")) {
      expect((await get(t.id, "DAL")).status, t.id).toBe(200);
      expect((await get(t.id.toLowerCase(), "DAL")).status, t.id).toBe(404);
      expect((await get("DAL", t.id.toLowerCase())).status, t.id).toBe(404);
    }
  });

  it("row 1: params that are missing altogether are junk too, not a crash", async () => {
    for (const params of [undefined, {}, { away: "BUF" }, { home: "LA" }, { away: null, home: null }, { away: ["BUF"], home: "LA" }]) {
      const res = await GET(new Request("https://yardsperpass.com/api/matchup-card/x/y"), { params: Promise.resolve(params as never) });
      expect(res.status).toBe(404);
      expect(res.headers.get("cache-control")).toBe(STORED);
    }
    expect(readCount()).toBe(0);
  });

  it("row 2: the same team twice", async () => {
    await expectNotFound(await get("BUF", "BUF"), STORED);
    expect(readCount()).toBe(0);
  });

  it.each([
    "?x=1", "?season=2026&x=1", "?Season=2025", "?utm_source=share", "?ball=home", "?season=2026&ball=home", "?season=abc", "?season=",
    "?season=2025abc", "?season=02025", "?season=2025&season=2024", "?w=1&w=2", "?w=0", "?w=23", "?w=99", "?w=-5", "?w=zzz", "?w=05",
    "?download=0", "?download=true", "?download=", "?Download=1", "?download=1&download=1",
    "?season=1998", "?season=2101", "?season=99999999999999999999",
    // another spelling of a valid query is junk too: each would be its own CDN entry and its own render
    "?", "?&", "?&&&&", "?season=2026&", "?&season=2026", "?season=%32%30%32%36", "?season=2026&w=%34",
    "?w=4&season=2026", "?download=1&season=2026", "?season=2026&download=1&w=4", "?season=2026&&w=4",
  ])("row 3, a query that is not the one spelling the page prints (%s)", async (query) => {
    await expectNotFound(await get("BUF", "LA", query), STORED);
    expect(readCount()).toBe(0);
  });

  it("row 3: the spellings the page prints are all drawn", async () => {
    for (const query of ["", "?season=2026", "?season=2026&w=4", "?season=2026&download=1", "?season=2026&w=4&download=1"]) {
      expect((await get("BUF", "LA", query)).status, query).toBe(200);
    }
  });

  // Decided for PR 2 (spec §17 item 9): the query is parsed EXACTLY as the compare card's is.
  it("row 3: ?w=5 and ?download=1 with no season are valid and mean the newest season, as on the compare card", async () => {
    const week = await get("BUF", "LA", "?w=5");
    expect(week.status).toBe(200);
    expect(week.headers.get("cache-control")).toBe(STORED);
    expect((vi.mocked(matchupCardImage).mock.calls[0][0] as MatchupCardModel).season).toBe(2026);
    const download = await get("BUF", "LA", "?download=1");
    expect(download.status).toBe(200);
    expect(download.headers.get("content-disposition")).toBe('attachment; filename="BUF-at-LA-2026-matchup.png"');
    expect((await get("BUF", "LA", "?w=5&download=1")).status).toBe(200);
    // any week a season can have, whatever the current week is
    for (const w of [1, 9, 10, 22]) expect((await get("BUF", "LA", `?season=2026&w=${w}`)).status, String(w)).toBe(200);
  });
});

describe("row 4: the seasons read", () => {
  it("fails: 503, not stored, retry in a minute; the pair is never loaded", async () => {
    vi.mocked(getSeasonWeeks).mockRejectedValue(new Error("Failed to fetch season weeks: timeout"));
    await expectUnavailable(await get("BUF", "LA"));
    expect(fetchAllRows).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalled();
  });

  it("an empty list on a real database: 503", async () => {
    vi.mocked(getSeasonWeeks).mockResolvedValue([]);
    await expectUnavailable(await get("BUF", "LA"));
    await expectUnavailable(await get("BUF", "LA", "?season=2025"));
    expect(fetchAllRows).not.toHaveBeenCalled();
  });

  it("an answer that is not a list: 503, never a crash", async () => {
    for (const junk of [null, "x", { season: 2026 }]) {
      clearCompareCardMemo();
      vi.mocked(getSeasonWeeks).mockResolvedValue(junk as never);
      await expectUnavailable(await get("BUF", "LA"));
    }
  });
});

describe("row 5: a season the site does not list", () => {
  it("404, not stored (it may exist after the next refresh), decided from the season list alone", async () => {
    await expectNotFound(await get("BUF", "LA", "?season=2019"), "no-store");
    await expectNotFound(await get("BUF", "LA", "?season=2031&w=4&download=1"), "no-store");
    expect(getSeasonWeeks).toHaveBeenCalledTimes(1);
    expect(fetchAllRows).not.toHaveBeenCalled();
    expect(getSeasonGames).not.toHaveBeenCalled();
  });

  it("the image never draws the newest season under a URL that names another (the page does; the image must not)", async () => {
    const res = await get("BUF", "LA", "?season=2031");
    expect(res.status).toBe(404);
    expect(matchupCardImage).not.toHaveBeenCalled();
  });
});

describe("row 6: the loader rejects", () => {
  it.each([
    ["the rows read fails", () => vi.mocked(fetchAllRows).mockRejectedValue({ message: "upstream" })],
    ["no rows for the newest season (a read failing silently)", () => vi.mocked(fetchAllRows).mockResolvedValue([])],
    ["rows of another season only", () => vi.mocked(fetchAllRows).mockResolvedValue(ROWS.map((r) => ({ ...r, season: 2024 })) as never)],
  ])("%s: 503", async (_what, breakIt) => {
    breakIt();
    await expectUnavailable(await get("BUF", "LA"));
    expect(errorSpy).toHaveBeenCalled();
  });

  it("a failed coverage probe for a past season: 503", async () => {
    vi.mocked(getBoxScoreSeasonsCached).mockRejectedValue(new Error("probe failed"));
    await expectUnavailable(await get("BUF", "LA", "?season=2025"));
  });
});

describe("row 7: the games could not be read", () => {
  it.each([
    ["the games read fails", () => vi.mocked(getSeasonGames).mockRejectedValue(new Error("Failed to fetch games"))],
    ["an empty schedule for a season that has stats", () => vi.mocked(getSeasonGames).mockResolvedValue([])],
    ["a schedule answer that is not a list", () => vi.mocked(getSeasonGames).mockResolvedValue("x" as never)],
  ])("%s: 503, never a stored VS card for a scheduled game", async (_what, breakIt) => {
    breakIt();
    await expectUnavailable(await get("BUF", "LA"));
    await expectUnavailable(await get("BUF", "LA", "?season=2026&w=4&download=1"));
  });
});

describe("row 8: the pair is scheduled the other way round", () => {
  it("404, not stored (which order is scheduled depends on the season's schedule); no redirect on an image", async () => {
    const res = await get("LA", "BUF");
    await expectNotFound(res, "no-store");
    expect(res.headers.get("location")).toBeNull();
  });

  it("division rivals play both ways: each order is its own card", async () => {
    expect((await get("NE", "BUF")).status).toBe(200);
    expect((await get("BUF", "NE")).status).toBe(200);
    const [a, b] = vi.mocked(matchupCardImage).mock.calls.map((c) => c[0] as Extract<MatchupCardModel, { kind: "card" }>);
    expect(a.subLine).toMatch(/^Week 6 · /);
    expect(b.subLine).toMatch(/^Week 15 · /);
  });
});

describe("row 9: a plate", () => {
  it("small-pool: a PNG of the plate with the page's own sentence, stored, never an attachment even with download=1", async () => {
    vi.mocked(fetchAllRows).mockResolvedValue(ROWS.filter((r) => SEVEN.includes(r.team_id as string)) as never);
    const res = await get("BUF", "LA", "?season=2026&w=4&download=1");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("cache-control")).toBe(STORED);
    expect(res.headers.get("content-disposition")).toBeNull();
    expect(matchupCardImage).not.toHaveBeenCalled();
    const model = vi.mocked(matchupPlateImage).mock.calls[0][0] as MatchupCardModel;
    expect(model).toMatchObject({ kind: "plate", message: MATCHUP_SMALL_POOL_NOTE, season: 2026 });
    expect(images[0].element).toEqual({ plate: model });
    expect(images[0].options).toMatchObject({ width: 1200, height: 630 });
    expect(Object.keys(images[0].options.headers as object)).toEqual(["cache-control"]);
  });

  it("uncovered (a listed season with no rows): the plate, stored", async () => {
    const res = await get("BUF", "LA", "?season=2025");
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe(STORED);
    expect(vi.mocked(matchupPlateImage).mock.calls[0][0]).toMatchObject({ kind: "plate", message: "Team matchups start with the 2026 season", season: 2025 });
  });

  it("neither radar drawable: the plate", async () => {
    const dead = { pass_plays: 0, attempts: 0, sacks: 0, total_drives: 0 };
    vi.mocked(fetchAllRows).mockResolvedValue(ROWS.map((r) => (["BUF", "LA"].includes(r.team_id as string) ? { ...r, ...dead } : r)) as never);
    const res = await get("BUF", "LA", "?download=1");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-disposition")).toBeNull();
    expect((vi.mocked(matchupPlateImage).mock.calls[0][0] as MatchupCardModel).kind).toBe("plate");
  });
});

describe("row 10: the card", () => {
  it("a PNG of the card, 1200×630, with the fonts, kept by the CDN for an hour", async () => {
    const res = await get("BUF", "LA");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("cache-control")).toBe(STORED);
    expect(res.headers.get("cache-control")).not.toContain(NEXT_OG_DEFAULT_CACHE);
    expect(res.headers.get("content-disposition")).toBeNull();
    expect(images).toHaveLength(1);
    expect(images[0].options).toMatchObject({ width: 1200, height: 630 });
    expect(images[0].options.fonts).toHaveLength(1);
    // A font that cannot be read is logged under this route's own name.
    expect(radarImageFonts).toHaveBeenCalledTimes(1);
    expect(radarImageFonts).toHaveBeenCalledWith(undefined, "Matchup card image");
    const model = vi.mocked(matchupCardImage).mock.calls[0][0] as Extract<MatchupCardModel, { kind: "card" }>;
    expect(images[0].element).toEqual({ card: model });
    expect(model.kind).toBe("card");
    expect([model.band.away.id, model.band.home.id, model.season, model.throughWeek, model.band.seam]).toEqual(["BUF", "LA", 2026, 3, "AT"]);
    expect(model.subLine).toBe("Week 5 · Mon Oct 12 · 8:15 PM ET · 2026 through Week 3");
    expect(model.band.away.meta).toBe("1-0 · away");
    expect(matchupPlateImage).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it("a pair with no game is a card too: VS", async () => {
    const res = await get("BUF", "DAL");
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe(STORED);
    expect((vi.mocked(matchupCardImage).mock.calls[0][0] as MatchupCardModel).band.seam).toBe("VS");
  });

  it("download=1: an attachment named from the two validated ids and the resolved season, -vs- when the pair has no game", async () => {
    const res = await get("BUF", "LA", "?season=2026&w=4&download=1");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-disposition")).toBe('attachment; filename="BUF-at-LA-2026-matchup.png"');
    expect((await get("BUF", "DAL", "?season=2026&download=1")).headers.get("content-disposition")).toBe(
      'attachment; filename="BUF-vs-DAL-2026-matchup.png"',
    );
    expect((await get("BUF", "LA", "?season=2026&w=4")).headers.get("content-disposition")).toBeNull();
  });

  it("exactly one cache-control goes out, and every header key the route sets is lowercase", async () => {
    const res = await get("BUF", "LA", "?season=2026&download=1");
    expect(res.headers.get("cache-control")).toBe(STORED);
    const sent = Object.keys(images[0].options.headers as Record<string, string>);
    expect(sent.sort()).toEqual(["cache-control", "content-disposition"]);
    for (const key of sent) expect(key).toBe(key.toLowerCase());
    // and on the answers that are not images
    for (const other of [await get("buf", "LA"), await get("BUF", "LA", "?season=2019")]) {
      expect(Array.from(other.headers.keys()).filter((k) => k.toLowerCase() === "cache-control")).toHaveLength(1);
    }
  });
});

describe("an outage is not retried at the visitor's rate", () => {
  it("20 image requests while the rows read fails are ONE read of it; ten seconds later the next request reads again and draws", async () => {
    vi.mocked(fetchAllRows).mockRejectedValueOnce({ message: "upstream 500" });
    const start = Date.parse(NOW);
    for (let i = 0; i < 20; i++) {
      vi.setSystemTime(new Date(start + i * 400));
      await expectUnavailable(await get(i % 2 ? "BUF" : "KC", i % 2 ? "LA" : "TB"));
    }
    expect(fetchAllRows).toHaveBeenCalledTimes(1);
    vi.setSystemTime(new Date(start + 10_000));
    expect((await get("BUF", "LA")).status).toBe(200);
    expect(fetchAllRows).toHaveBeenCalledTimes(2);
  });

  it("20 requests while the seasons read fails are one read of it", async () => {
    vi.mocked(getSeasonWeeks).mockRejectedValue(new Error("down"));
    const start = Date.parse(NOW);
    for (let i = 0; i < 20; i++) {
      vi.setSystemTime(new Date(start + i * 400));
      await expectUnavailable(await get("BUF", "LA"));
    }
    expect(getSeasonWeeks).toHaveBeenCalledTimes(1);
  });
});

describe("reads do not scale with pairs", () => {
  it("the first image pays the loader's reads; every image after it, for any pair, costs none and adds no memo key", async () => {
    await get("BUF", "LA");
    const cold = readCount();
    // seasons, slug list, rows, games and the three player tables: one call each at this level
    expect(cold).toBe(7);
    const keys = [matchupMemoKeys(), compareCardMemoKeys()];
    expect(keys[0]).toEqual(["games:2026", "rows:2026"]);
    await get("KC", "TB");
    await get("LA", "BUF");
    await get("NE", "BUF", "?season=2026&w=4&download=1");
    await get("BUF", "LA", "?w=4");
    await get("buf", "la");
    await get("BUF", "LA", "?season=2019");
    for (const t of NFL_TEAMS.filter((x) => x.id !== "DAL")) await get(t.id, "DAL");
    expect(readCount()).toBe(cold);
    expect([matchupMemoKeys(), compareCardMemoKeys()]).toEqual(keys);
    for (const key of [...matchupMemoKeys(), ...compareCardMemoKeys()]) expect(key).not.toMatch(/BUF|KC|DAL|LA\b/);
  });
});

describe("no database at all (CI, a placeholder build)", () => {
  it("answers 503: the seasons list is empty and nothing can be drawn (the compare image answers 404 there; this route follows its own loader)", async () => {
    vi.mocked(hasNoDatabase).mockReturnValue(true);
    vi.mocked(getSeasonWeeks).mockResolvedValue([]);
    vi.mocked(fetchAllRows).mockRejectedValue({ message: "no database" });
    await expectUnavailable(await get("BUF", "LA"));
  });
});
