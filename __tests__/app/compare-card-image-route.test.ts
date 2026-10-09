import { describe, it, expect, beforeEach, vi } from "vitest";

// /api/compare-card/[a]/[b] — the 1200×630 PNG of one comparison share card:
// the link preview, and with &download=1 the Download button's file (compare
// card spec 2026-10-09 §4 "Image route, in order", PR 2).
//
// @vercel/og cannot render on Windows, so next/og is replaced by a class that
// records what it was given and answers 200 with its headers built exactly the
// way the real one builds them: a LOWERCASE one-year `cache-control` default
// with the caller's headers spread on top. Only a lowercase key replaces that
// default. The assertions below read what would go out.
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
vi.mock("@/lib/og/compare-card-image", () => ({
  compareCardImage: vi.fn((model: unknown) => ({ card: model })),
  comparePlateImage: vi.fn((props: unknown) => ({ plate: props })),
}));
vi.mock("@/lib/data/queries", () => ({
  getSeasonWeeks: vi.fn(), getQBStats: vi.fn(), getAvailableSeasons: vi.fn(), fallbackSeason: () => 2026,
}));
vi.mock("@/lib/data/receivers", () => ({ getReceiverStats: vi.fn() }));
vi.mock("@/lib/data/rushing", () => ({ getRBSeasonStats: vi.fn() }));
vi.mock("@/lib/data/players", () => ({ getPlayerBySlug: vi.fn(), getPlayerSlugIndex: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ hasNoDatabase: vi.fn(() => false) }));

import rowsJson from "../stats/fixtures/compare-2026-w4-rows.json";
import * as route from "@/app/api/compare-card/[a]/[b]/route";
import { GET } from "@/app/api/compare-card/[a]/[b]/route";
import { getSeasonWeeks, getQBStats } from "@/lib/data/queries";
import { getReceiverStats } from "@/lib/data/receivers";
import { getRBSeasonStats } from "@/lib/data/rushing";
import { getPlayerBySlug, getPlayerSlugIndex } from "@/lib/data/players";
import { hasNoDatabase } from "@/lib/supabase/server";
import { clearCompareCardMemo } from "@/lib/data/compare-card";
import { compareCardImage, comparePlateImage } from "@/lib/og/compare-card-image";
import { radarImageFonts } from "@/lib/og/team-radar-image";
import type { CompareCardModel } from "@/lib/stats/compare-card";

type Row = Record<string, unknown>;
const WEEKS = [{ season: 2026, through_week: 4 }, { season: 2025, through_week: 22 }];
const P = (slug: string, player_id: string, player_name: string, position: string) => ({ slug, player_id, player_name, position, current_team_id: "BUF" });
const INDEX = new Map([
  P("josh-allen", "00-0034857", "Josh Allen", "QB"),
  P("matthew-stafford", "00-0026498", "Matthew Stafford", "QB"),
  P("ceedee-lamb", "00-0036358", "CeeDee Lamb", "WR"),
  P("trey-mcbride", "00-0037744", "Trey McBride", "TE"),
  P("rookie-qb", "00-0099999", "Rookie Quarterback", "QB"),
  P("some-kicker", "00-0088888", "Some Kicker", "K"),
].map((p) => [p.slug, p]));

const STORED = "public, max-age=0, s-maxage=3600";
const get = (a: string, b: string, query = "") =>
  GET(new Request(`https://yardsperpass.com/api/compare-card/${a}/${b}${query}`), { params: Promise.resolve({ a, b }) });

const READS = [getSeasonWeeks, getQBStats, getReceiverStats, getRBSeasonStats, getPlayerBySlug, getPlayerSlugIndex];
const readCount = () => READS.reduce((n, fn) => n + vi.mocked(fn).mock.calls.length, 0);

async function expectNotFound(res: Response, cache: string) {
  expect(res.status).toBe(404);
  expect(await res.text()).toBe("Not found");
  expect(res.headers.get("cache-control")).toBe(cache);
  expect(images).toHaveLength(0);
  expect(compareCardImage).not.toHaveBeenCalled();
  expect(comparePlateImage).not.toHaveBeenCalled();
}

/** The answer every failed read must get: retryable, never stored, no image drawn. */
async function expectUnavailable(res: Response) {
  expect(res.status).toBe(503);
  expect(await res.text()).toBe("Comparison image temporarily unavailable. Try again in a few minutes.");
  expect(res.headers.get("cache-control")).toBe("no-store");
  expect(res.headers.get("retry-after")).toBe("60");
  expect(res.headers.get("content-type")).toBe("text/plain; charset=utf-8");
  expect(images).toHaveLength(0);
}

beforeEach(() => {
  images.length = 0;
  clearCompareCardMemo();
  for (const fn of READS) vi.mocked(fn).mockReset();
  vi.mocked(compareCardImage).mockClear();
  vi.mocked(comparePlateImage).mockClear();
  vi.mocked(radarImageFonts).mockClear();
  vi.mocked(hasNoDatabase).mockReturnValue(false);
  vi.mocked(getSeasonWeeks).mockResolvedValue(WEEKS);
  vi.mocked(getPlayerSlugIndex).mockResolvedValue(INDEX as never);
  vi.mocked(getQBStats).mockResolvedValue(rowsJson.qb as never);
  vi.mocked(getReceiverStats).mockResolvedValue(rowsJson.receivers as never);
  vi.mocked(getRBSeasonStats).mockResolvedValue(rowsJson.rb as never);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("route config", () => {
  it("runs on Node (the fonts are read with fs) and is never cached by Next itself", () => {
    expect(route.runtime).toBe("nodejs");
    expect(route.revalidate).toBe(0);
  });
});

describe("junk is a 404 before any read and before any render, kept by the CDN so it is not re-run", () => {
  it.each([
    ["Josh-Allen", "matthew-stafford"], ["josh-allen", "Matthew-Stafford"], ["josh.allen", "matthew-stafford"],
    ["d'andre-swift", "josh-allen"], ["josh allen", "matthew-stafford"], ["josh-allen", ""], ["", "josh-allen"],
    ["josh--allen", "matthew-stafford"], ["-josh-allen", "matthew-stafford"], ["josh-allen-", "matthew-stafford"],
    ["josh-allen", "x".repeat(101)], ["josh-allen%00", "matthew-stafford"], ["<script>", "matthew-stafford"],
    ["jösh", "matthew-stafford"], ["josh_allen", "matthew-stafford"],
  ])("a slug outside the grammar: /api/compare-card/%s/%s", async (a, b) => {
    await expectNotFound(await get(a, b), STORED);
    expect(readCount()).toBe(0);
  });

  it("the same player twice", async () => {
    await expectNotFound(await get("josh-allen", "josh-allen"), STORED);
    expect(readCount()).toBe(0);
  });

  it.each([
    "?x=1", "?season=2026&x=1", "?Season=2025", "?utm_source=share", "?season=abc", "?season=", "?season=2025abc", "?season=02025",
    "?season=2025&season=2024", "?w=1&w=2", "?w=0", "?w=23", "?w=99", "?w=-5", "?w=zzz", "?w=05",
    "?download=0", "?download=true", "?download=", "?Download=1", "?download=1&download=1",
    "?season=1998", "?season=2101", "?season=99999999999999999999",
  ])("a query string that is not the route's exact form (%s)", async (query) => {
    await expectNotFound(await get("josh-allen", "matthew-stafford", query), STORED);
    expect(readCount()).toBe(0);
  });

  it("params that are missing altogether are junk too, not a crash", async () => {
    const res = await GET(new Request("https://yardsperpass.com/api/compare-card/x/y"), { params: Promise.resolve(undefined as never) });
    await expectNotFound(res, STORED);
  });
});

// Chaos R2: every spelling of a query is its own CDN entry and its own render
// of the same picture. Only the spelling the page prints is drawn.
describe("another spelling of a valid query is junk too", () => {
  it.each([
    "?", "?&", "?&&&&", "?season=2026&", "?&season=2026", "?season=%32%30%32%36", "?season=2026&w=%34",
    "?w=4&season=2026", "?download=1&season=2026", "?season=2026&download=1&w=4", "?season=2026&&w=4",
  ])("%s: the 404 the CDN keeps, no read, no render", async (query) => {
    await expectNotFound(await get("josh-allen", "matthew-stafford", query), STORED);
    expect(readCount()).toBe(0);
  });

  it("the spellings the page prints are all drawn", async () => {
    for (const query of ["", "?season=2026", "?season=2026&w=4", "?season=2026&download=1", "?season=2026&w=4&download=1"]) {
      expect((await get("josh-allen", "matthew-stafford", query)).status, query).toBe(200);
    }
  });
});

describe("a real URL that is not a card", () => {
  it("two players of different position groups, or a kicker: 404 the CDN keeps (it can never be a card)", async () => {
    await expectNotFound(await get("josh-allen", "ceedee-lamb"), STORED);
    await expectNotFound(await get("some-kicker", "josh-allen"), STORED);
    expect(getQBStats).not.toHaveBeenCalled();
    expect(getReceiverStats).not.toHaveBeenCalled();
  });

  it("an unknown slug: 404 that is NOT stored (a rookie gets his row at the next refresh), and no season table is read", async () => {
    await expectNotFound(await get("josh-allen", "nobody-at-all"), "no-store");
    await expectNotFound(await get("nobody-at-all", "josh-allen"), "no-store");
    expect(getQBStats).not.toHaveBeenCalled();
  });

  it("a season the site does not have: 404, not stored, decided from the seasons; no season table is read", async () => {
    await expectNotFound(await get("josh-allen", "matthew-stafford", "?season=2019"), "no-store");
    expect(getSeasonWeeks).toHaveBeenCalledTimes(1);
    // The slug list is started alongside the seasons (code review I3); it is memoised, never per URL.
    expect(getPlayerSlugIndex).toHaveBeenCalledTimes(1);
    await expectNotFound(await get("josh-allen", "matthew-stafford", "?season=2018"), "no-store");
    expect(getPlayerSlugIndex).toHaveBeenCalledTimes(1);
    expect(getQBStats).not.toHaveBeenCalled();
  });
});

describe("the card", () => {
  it("both players have stats: a PNG of the card, 1200×630, with the fonts, kept by the CDN for an hour", async () => {
    const res = await get("josh-allen", "matthew-stafford");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("cache-control")).toBe(STORED);
    expect(res.headers.get("cache-control")).not.toContain(NEXT_OG_DEFAULT_CACHE);
    expect(res.headers.get("content-disposition")).toBeNull();
    expect(images).toHaveLength(1);
    expect(images[0].options).toMatchObject({ width: 1200, height: 630 });
    expect(images[0].options.fonts).toHaveLength(1);
    expect(radarImageFonts).toHaveBeenCalledTimes(1);
    // A font that cannot be read is logged under this route's own name.
    expect(radarImageFonts).toHaveBeenCalledWith(undefined, "Compare card image");
    const model = vi.mocked(compareCardImage).mock.calls[0][0] as CompareCardModel;
    expect(images[0].element).toEqual({ card: model });
    expect([model.a.fullName, model.b.fullName, model.season, model.throughWeek]).toEqual(["Josh Allen", "Matthew Stafford", 2026, 4]);
    expect([model.a.ovr, model.b.ovr]).toEqual([91, 76]);
    expect(comparePlateImage).not.toHaveBeenCalled();
  });

  it("order is kept: /b/a draws b on the left", async () => {
    await get("matthew-stafford", "josh-allen");
    const model = vi.mocked(compareCardImage).mock.calls[0][0] as CompareCardModel;
    expect([model.a.fullName, model.b.fullName]).toEqual(["Matthew Stafford", "Josh Allen"]);
  });

  it("a WR against a TE is a card; ?season= picks the season; &w= changes nothing but the URL", async () => {
    expect((await get("ceedee-lamb", "trey-mcbride")).status).toBe(200);
    const res = await get("josh-allen", "matthew-stafford", "?season=2025&w=18");
    expect(res.status).toBe(200);
    expect(getQBStats).toHaveBeenCalledWith(2025);
    const model = vi.mocked(compareCardImage).mock.calls[1][0] as CompareCardModel;
    expect([model.season, model.throughWeek]).toEqual([2025, 22]);
    // Any week a season can have is accepted, whatever the current week is.
    for (const w of [1, 5, 22]) expect((await get("josh-allen", "matthew-stafford", `?w=${w}`)).status, String(w)).toBe(200);
  });

  it("download=1: an attachment named from the two validated slugs and the season, and nothing else", async () => {
    const res = await get("josh-allen", "matthew-stafford", "?season=2026&w=4&download=1");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-disposition")).toBe('attachment; filename="josh-allen-vs-matthew-stafford-2026.png"');
    const newest = await get("matthew-stafford", "josh-allen", "?download=1");
    expect(newest.headers.get("content-disposition")).toBe('attachment; filename="matthew-stafford-vs-josh-allen-2026.png"');
  });

  it("exactly one cache-control goes out, and every header key the route sets is lowercase", async () => {
    const res = await get("josh-allen", "matthew-stafford", "?download=1");
    expect(res.headers.get("cache-control")).toBe(STORED);
    const sent = Object.keys(images[0].options.headers as Record<string, string>);
    expect(sent.sort()).toEqual(["cache-control", "content-disposition"]);
    for (const key of sent) expect(key).toBe(key.toLowerCase());
  });
});

describe("a real pair with nothing to compare", () => {
  it("one player has no stats this season: a plate with the page's own sentence, stored, never an attachment", async () => {
    const res = await get("josh-allen", "rookie-qb", "?download=1");
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe(STORED);
    expect(res.headers.get("content-disposition")).toBeNull();
    expect(compareCardImage).not.toHaveBeenCalled();
    expect(vi.mocked(comparePlateImage).mock.calls[0][0]).toEqual({
      nameA: "Josh Allen", nameB: "Rookie Quarterback", season: 2026,
      message: "Rookie Quarterback has no 2026 stats yet, so there is nothing to compare. Comparisons update the day after each game.",
    });
  });
});

describe("a failed read is a 503 the browser can retry: never a 404, never a picture, never stored", () => {
  it.each([
    ["the seasons", () => vi.mocked(getSeasonWeeks).mockRejectedValue(new Error("Failed to fetch season weeks: timeout"))],
    ["the slug list", () => vi.mocked(getPlayerSlugIndex).mockRejectedValue(new Error("Failed to fetch player slug index: boom"))],
    ["the season table", () => vi.mocked(getQBStats).mockRejectedValue(new Error("Failed to fetch QB stats: boom"))],
    ["an empty seasons list on a real database", () => vi.mocked(getSeasonWeeks).mockResolvedValue([])],
    ["an empty slug list on a real database", () => vi.mocked(getPlayerSlugIndex).mockResolvedValue(new Map() as never)],
    ["no rows for a season the site has", () => vi.mocked(getQBStats).mockResolvedValue([])],
  ])("%s", async (_what, breakIt) => {
    breakIt();
    await expectUnavailable(await get("josh-allen", "matthew-stafford"));
    expect(console.error).toHaveBeenCalled();
  });

  // Chaos COST-2: the failure is kept ten seconds (never as a success), so an
  // outage is not retried once per image request.
  it("20 image requests during an outage are ONE read of the failing table; ten seconds later the next request reads again and draws", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-10-09T12:00:00Z"));
      vi.mocked(getQBStats).mockRejectedValueOnce(new Error("Failed to fetch QB stats: upstream 500"));
      for (let i = 0; i < 20; i++) {
        vi.setSystemTime(new Date(Date.parse("2026-10-09T12:00:00Z") + i * 400));
        await expectUnavailable(await get("josh-allen", i % 2 ? "matthew-stafford" : "rookie-qb"));
      }
      expect(getQBStats).toHaveBeenCalledTimes(1);
      vi.setSystemTime(new Date("2026-10-09T12:00:10Z"));
      expect((await get("josh-allen", "matthew-stafford")).status).toBe(200);
      expect(getQBStats).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

});

describe("reads do not scale with pairs", () => {
  it("the first image costs three reads; every image after it, for any pair of the group, costs none; the per-player loader is never used", async () => {
    await get("josh-allen", "matthew-stafford");
    expect(readCount()).toBe(3);
    await get("josh-allen", "matthew-stafford");
    await get("matthew-stafford", "josh-allen", "?w=4");
    await get("josh-allen", "rookie-qb");
    await get("josh-allen", "nobody-at-all");
    await get("josh-allen", "matthew-stafford", "?download=1");
    expect(readCount()).toBe(3);
    expect(getPlayerBySlug).not.toHaveBeenCalled();
  });
});

describe("no database at all (CI, a placeholder build)", () => {
  it("answers 404 rather than 503 or a crash", async () => {
    vi.mocked(hasNoDatabase).mockReturnValue(true);
    vi.mocked(getSeasonWeeks).mockResolvedValue([]);
    vi.mocked(getPlayerSlugIndex).mockResolvedValue(new Map() as never);
    await expectNotFound(await get("josh-allen", "matthew-stafford"), "no-store");
  });
});
