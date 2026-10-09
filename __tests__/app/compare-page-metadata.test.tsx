// /compare's own link preview (compare card spec 2026-10-09 §7 "J6", PR 3).
// A pasted /compare?p1=&p2= link previews the comparison image; everything
// else keeps the page's standard metadata. The canonical is always bare
// /compare. The reads go through the share card's memoised loader, so no
// request is made per slug or per pair, and a failed read never breaks the
// page: the standard metadata is true whatever the database says.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import type { ReactElement } from "react";
import type { Metadata } from "next";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/compare",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/lib/data/queries", () => ({
  getSeasonWeeks: vi.fn(), getQBStats: vi.fn(), getAvailableSeasons: vi.fn(), fallbackSeason: () => 2026,
}));
vi.mock("@/lib/data/receivers", () => ({ getReceiverStats: vi.fn() }));
vi.mock("@/lib/data/rushing", () => ({ getRBSeasonStats: vi.fn() }));
vi.mock("@/lib/data/players", () => ({ getPlayerBySlug: vi.fn(), getPlayerSlugIndex: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ hasNoDatabase: vi.fn(() => false) }));
vi.mock("@/components/compare/ComparisonTool", () => ({ default: vi.fn(() => null) }));

import rowsJson from "../stats/fixtures/compare-2026-w4-rows.json";
import ComparePage, { generateMetadata } from "@/app/compare/page";
import * as pageModule from "@/app/compare/page";
import ComparisonTool from "@/components/compare/ComparisonTool";
import { getSeasonWeeks, getQBStats, getAvailableSeasons } from "@/lib/data/queries";
import { getReceiverStats } from "@/lib/data/receivers";
import { getRBSeasonStats } from "@/lib/data/rushing";
import { getPlayerBySlug, getPlayerSlugIndex } from "@/lib/data/players";
import { hasNoDatabase } from "@/lib/supabase/server";
import { clearCompareCardMemo, compareCardMemoKeys } from "@/lib/data/compare-card";
import { compareToolTitle } from "@/lib/stats/compare-card";

const WEEKS = [{ season: 2026, through_week: 4 }, { season: 2025, through_week: 22 }];
const BASE = "https://yardsperpass.com";
const P = (slug: string, player_id: string, player_name: string, position: string, current_team_id: string) =>
  ({ slug, player_id, player_name, position, current_team_id, headshot_url: null, jersey_number: null });
const PLAYERS = new Map([
  P("josh-allen", "00-0034857", "Josh Allen", "QB", "BUF"),
  P("matthew-stafford", "00-0026498", "Matthew Stafford", "QB", "LA"),
  P("ceedee-lamb", "00-0036358", "CeeDee Lamb", "WR", "DAL"),
  P("trey-mcbride", "00-0037744", "Trey McBride", "TE", "ARI"),
  P("rookie-qb", "00-0099999", "Rookie Quarterback", "QB", "NYJ"),
  P("some-kicker", "00-0088888", "Some Kicker", "K", "BUF"),
].map((p) => [p.slug, p]));

type Params = Record<string, string | string[]>;
const md = (params: Params = {}): Promise<Metadata> =>
  (generateMetadata as (a: { searchParams: Promise<Params> }) => Promise<Metadata>)({ searchParams: Promise.resolve(params) });
const READS = [getSeasonWeeks, getQBStats, getReceiverStats, getRBSeasonStats, getPlayerBySlug, getPlayerSlugIndex, getAvailableSeasons];
const readCount = () => READS.reduce((n, fn) => n + vi.mocked(fn).mock.calls.length, 0);
const ogImage = (meta: Metadata) =>
  (meta.openGraph?.images as { url: string; width: number; height: number; alt: string }[])[0];

const STATIC_TITLE = "Player Comparison";
const STATIC_DESCRIPTION =
  "Compare NFL players head-to-head with overlaid radar charts and stat breakdowns. EPA, CPOE, CROE, and 30+ metrics side by side.";
/** The page's standard metadata, exactly: nothing about a pair, so the layout's preview applies. */
const expectStatic = (meta: Metadata, base = BASE) => {
  expect(meta).toEqual({ title: STATIC_TITLE, description: STATIC_DESCRIPTION, alternates: { canonical: `${base}/compare` } });
};

let logged: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  clearCompareCardMemo();
  for (const fn of READS) vi.mocked(fn).mockReset();
  vi.mocked(ComparisonTool).mockReset();
  vi.mocked(ComparisonTool).mockReturnValue(null as never);
  vi.mocked(hasNoDatabase).mockReturnValue(false);
  vi.mocked(getSeasonWeeks).mockResolvedValue(WEEKS);
  vi.mocked(getAvailableSeasons).mockResolvedValue([2026, 2025]);
  vi.mocked(getPlayerSlugIndex).mockResolvedValue(PLAYERS as never);
  vi.mocked(getPlayerBySlug).mockResolvedValue(null);
  vi.mocked(getQBStats).mockResolvedValue(rowsJson.qb as never);
  vi.mocked(getReceiverStats).mockResolvedValue(rowsJson.receivers as never);
  vi.mocked(getRBSeasonStats).mockResolvedValue(rowsJson.rb as never);
  logged = vi.spyOn(console, "error").mockImplementation(() => {});
  logged.mockClear();
  delete process.env.NEXT_PUBLIC_SITE_URL;
});

describe("C18: the pair's <title> on /compare", () => {
  it("is the two names and the page's name; the layout's template adds the site name", () => {
    expect(compareToolTitle("Josh Allen", "Matthew Stafford")).toBe("Josh Allen vs Matthew Stafford — Player Comparison");
  });
});

describe("/compare metadata: no pair, the standard metadata and no read", () => {
  it("the page no longer exports a static `metadata` (Next allows one or the other)", () => {
    expect("metadata" in pageModule).toBe(false);
  });

  it.each([
    ["no players", {}],
    ["one player", { p1: "josh-allen" }],
    ["only the second player", { p2: "josh-allen" }],
    ["the same player twice", { p1: "josh-allen", p2: "josh-allen" }],
    ["a slug that is not a slug", { p1: "Josh Allen", p2: "matthew-stafford" }],
    ["a path in a slug", { p1: "josh-allen", p2: "../../etc" }],
    ["an empty slug", { p1: "josh-allen", p2: "" }],
    ["a repeated parameter", { p1: ["josh-allen", "ceedee-lamb"], p2: "matthew-stafford" }],
    ["a season before the data starts", { p1: "josh-allen", p2: "matthew-stafford", season: "1998" }],
    ["a season no one will see", { p1: "josh-allen", p2: "matthew-stafford", season: "99999999999" }],
    ["a negative season", { p1: "josh-allen", p2: "matthew-stafford", season: "-2026" }],
  ] as [string, Params][])("%s", async (_name, params) => {
    expectStatic(await md(params));
    expect(readCount()).toBe(0);
    expect(logged).not.toHaveBeenCalled();
  });

  it("the canonical follows NEXT_PUBLIC_SITE_URL", async () => {
    process.env.NEXT_PUBLIC_SITE_URL = "https://preview.example";
    expectStatic(await md(), "https://preview.example");
  });
});

describe("/compare metadata: a real pair previews the comparison", () => {
  const PAIR = { p1: "josh-allen", p2: "matthew-stafford" };

  it("title C18, description C2, the preview title C1b, og:url the pair's own URL, the image with the season and week", async () => {
    const meta = await md(PAIR);
    expect(meta.title).toBe("Josh Allen vs Matthew Stafford — Player Comparison");
    expect(meta.description).toBe(
      "Josh Allen (QB, Buffalo Bills) vs Matthew Stafford (QB, Los Angeles Rams), 2026 through Week 4: overlaid radar and head-to-head stats.");
    expect(meta.openGraph).toMatchObject({
      title: "Josh Allen vs Matthew Stafford",
      description: meta.description,
      url: `${BASE}/compare?p1=josh-allen&p2=matthew-stafford`,
      type: "website",
    });
    const image = `${BASE}/api/compare-card/josh-allen/matthew-stafford?season=2026&w=4`;
    expect(ogImage(meta)).toEqual({ url: image, width: 1200, height: 630, alt: "Josh Allen vs Matthew Stafford comparison card, 2026" });
    expect(meta.twitter).toMatchObject({
      card: "summary_large_image", title: "Josh Allen vs Matthew Stafford", description: meta.description, images: [image],
    });
    expect(logged).not.toHaveBeenCalled();
  });

  it("the canonical stays bare /compare, and the page is not marked noindex", async () => {
    const meta = await md(PAIR);
    expect(meta.alternates?.canonical).toBe(`${BASE}/compare`);
    expect("robots" in meta).toBe(false);
  });

  it("the order in the link is the order in the picture", async () => {
    const meta = await md({ p1: "matthew-stafford", p2: "josh-allen" });
    expect(meta.title).toBe("Matthew Stafford vs Josh Allen — Player Comparison");
    expect(ogImage(meta).url).toBe(`${BASE}/api/compare-card/matthew-stafford/josh-allen?season=2026&w=4`);
    expect(meta.openGraph?.url).toBe(`${BASE}/compare?p1=matthew-stafford&p2=josh-allen`);
  });

  it("a WR against a TE is a pair too", async () => {
    const meta = await md({ p1: "ceedee-lamb", p2: "trey-mcbride" });
    expect(meta.title).toBe("CeeDee Lamb vs Trey McBride — Player Comparison");
    expect(ogImage(meta).url).toBe(`${BASE}/api/compare-card/ceedee-lamb/trey-mcbride?season=2026&w=4`);
  });

  it("a past season: the image and og:url name it; an explicit newest season is the bare pair URL", async () => {
    const past = await md({ ...PAIR, season: "2025" });
    expect(ogImage(past).url).toBe(`${BASE}/api/compare-card/josh-allen/matthew-stafford?season=2025&w=22`);
    expect(past.openGraph?.url).toBe(`${BASE}/compare?p1=josh-allen&p2=matthew-stafford&season=2025`);
    expect(past.description).toContain("2025 through Week 22");
    expect(past.alternates?.canonical).toBe(`${BASE}/compare`);
    const newest = await md({ ...PAIR, season: "2026" });
    expect(newest.openGraph?.url).toBe(`${BASE}/compare?p1=josh-allen&p2=matthew-stafford`);
    expect(ogImage(newest).url).toBe(`${BASE}/api/compare-card/josh-allen/matthew-stafford?season=2026&w=4`);
  });

  it("the season is read the way the page body reads it: not a number is the newest, a leading number counts", async () => {
    expect(ogImage(await md({ ...PAIR, season: "abc" })).url).toContain("?season=2026&w=4");
    expect(ogImage(await md({ ...PAIR, season: "2025abc" })).url).toContain("?season=2025&w=22");
  });

  it("the absolute URLs follow NEXT_PUBLIC_SITE_URL", async () => {
    process.env.NEXT_PUBLIC_SITE_URL = "https://preview.example";
    const meta = await md(PAIR);
    expect(ogImage(meta).url).toBe("https://preview.example/api/compare-card/josh-allen/matthew-stafford?season=2026&w=4");
    expect(meta.openGraph?.url).toBe("https://preview.example/compare?p1=josh-allen&p2=matthew-stafford");
    expect(meta.alternates?.canonical).toBe("https://preview.example/compare");
  });

  it("a pair with nothing to compare this season previews the plate with its sentence, never a broken image", async () => {
    const meta = await md({ p1: "josh-allen", p2: "rookie-qb" });
    expect(meta.title).toBe("Josh Allen vs Rookie Quarterback — Player Comparison");
    expect(meta.description).toBe(
      "Rookie Quarterback has no 2026 stats yet, so there is nothing to compare. Comparisons update the day after each game.");
    expect(ogImage(meta).url).toBe(`${BASE}/api/compare-card/josh-allen/rookie-qb?season=2026&w=4`);
  });
});

describe("/compare metadata: a pair that has no card keeps the standard metadata", () => {
  it.each([
    ["an unknown player", { p1: "josh-allen", p2: "nobody-at-all" }],
    ["players of different groups", { p1: "josh-allen", p2: "ceedee-lamb" }],
    ["a kicker", { p1: "some-kicker", p2: "josh-allen" }],
    ["a season the site does not have", { p1: "josh-allen", p2: "matthew-stafford", season: "2019" }],
  ] as [string, Params][])("%s", async (_name, params) => {
    expectStatic(await md(params));
    expect(logged).not.toHaveBeenCalled();
  });
});

describe("/compare metadata: cost and failure", () => {
  it("one pair costs the three memoised reads and no per-player read; a second pair costs nothing", async () => {
    await md({ p1: "josh-allen", p2: "matthew-stafford" });
    expect(vi.mocked(getSeasonWeeks)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(getPlayerSlugIndex)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(getQBStats)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(getPlayerBySlug)).not.toHaveBeenCalled();
    await md({ p1: "matthew-stafford", p2: "josh-allen" });
    await md({ p1: "josh-allen", p2: "rookie-qb" });
    expect(readCount()).toBe(3);
  });

  it("two hundred made-up pairs make two reads in all, and nothing is remembered per slug", async () => {
    for (let i = 0; i < 200; i++) expectStatic(await md({ p1: `made-up-${i}`, p2: `nobody-${i}` }));
    expect(readCount()).toBe(2);
    expect(compareCardMemoKeys()).toEqual(["seasons", "slugs"]);
  });

  it.each([
    ["the seasons read", () => vi.mocked(getSeasonWeeks).mockRejectedValue(new Error("Failed to fetch seasons: TypeError: fetch failed"))],
    ["the slug list read", () => vi.mocked(getPlayerSlugIndex).mockRejectedValue(new Error("Failed to fetch player slugs: TypeError: fetch failed"))],
    ["the season table read", () => vi.mocked(getQBStats).mockRejectedValue(new Error("Failed to fetch QB stats: TypeError: fetch failed"))],
    ["an empty season table (a failed read in disguise)", () => vi.mocked(getQBStats).mockResolvedValue([])],
  ] as [string, () => void][])("%s fails: the standard metadata, logged once, never a rejected page", async (_name, breakIt) => {
    breakIt();
    expectStatic(await md({ p1: "josh-allen", p2: "matthew-stafford" }));
    expect(logged).toHaveBeenCalledTimes(1);
    expect(String(logged.mock.calls[0][0])).toContain("Compare page");
    expect(String(logged.mock.calls[0][0])).toContain("josh-allen");
    expect(logged.mock.calls[0][1]).toBeInstanceOf(Error);
  });
});

describe("/compare page body: what the Share block needs from the server", () => {
  type Page = (args: { searchParams: Promise<Record<string, string>> }) => Promise<unknown>;
  async function toolProps(params: Record<string, string> = {}) {
    render((await (ComparePage as Page)({ searchParams: Promise.resolve(params) })) as ReactElement);
    const calls = vi.mocked(ComparisonTool).mock.calls;
    return calls[calls.length - 1][0];
  }

  it("the newest season and the site URL are handed to the tool", async () => {
    expect(await toolProps()).toMatchObject({ season: 2026, defaultSeason: 2026, siteUrl: BASE });
  });

  it("on a past season the newest season is still the newest", async () => {
    expect(await toolProps({ season: "2025" })).toMatchObject({ season: 2025, defaultSeason: 2026 });
  });

  it("the site URL follows NEXT_PUBLIC_SITE_URL", async () => {
    process.env.NEXT_PUBLIC_SITE_URL = "https://preview.example";
    expect((await toolProps()).siteUrl).toBe("https://preview.example");
  });

  it("the page body makes no read for the link preview", async () => {
    await toolProps({ p1: "josh-allen", p2: "matthew-stafford" });
    expect(vi.mocked(getSeasonWeeks)).not.toHaveBeenCalled();
    expect(vi.mocked(getPlayerSlugIndex)).not.toHaveBeenCalled();
  });
});
