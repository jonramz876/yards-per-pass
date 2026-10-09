// The comparison share pages, /card/compare/[a]/[b] (compare card spec
// 2026-10-09 §4-§5, PR 2). Covers route validation (junk never reads), every
// state, the metadata (own-order og:url, alphabetical canonical, noindex, the
// explicit preview image URL with the season and week), and the two levels
// above the page that must stay 404s.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";

// React's cache() exists only in the react-server build, so under vitest
// `import { cache } from "react"` is undefined and the page module could not
// load. This stands in for it: one result per argument list per "request".
// newRequest() starts a new request (React does that itself on the server).
const requestCache = vi.hoisted(() => ({ stores: [] as Map<string, unknown>[] }));
const newRequest = () => requestCache.stores.forEach((m) => m.clear());
vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    cache: <A extends unknown[], T>(fn: (...args: A) => T) => {
      const store = new Map<string, unknown>();
      requestCache.stores.push(store);
      return (...args: A): T => {
        // Primitives only: React compares cache() arguments by identity.
        for (const a of args) {
          if (a !== null && !["string", "number", "boolean", "undefined"].includes(typeof a)) {
            throw new Error("cache() was called with a non-primitive argument");
          }
        }
        const key = JSON.stringify(args);
        if (!store.has(key)) store.set(key, fn(...args));
        return store.get(key) as T;
      };
    },
  };
});

vi.mock("next/navigation", () => ({
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
}));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock("@/lib/data/queries", () => ({
  getSeasonWeeks: vi.fn(), getQBStats: vi.fn(), getAvailableSeasons: vi.fn(), fallbackSeason: () => 2026,
}));
vi.mock("@/lib/data/receivers", () => ({ getReceiverStats: vi.fn() }));
vi.mock("@/lib/data/rushing", () => ({ getRBSeasonStats: vi.fn() }));
vi.mock("@/lib/data/players", () => ({ getPlayerBySlug: vi.fn(), getPlayerSlugIndex: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ hasNoDatabase: vi.fn(() => false) }));

import rowsJson from "../stats/fixtures/compare-2026-w4-rows.json";
import { notFound } from "next/navigation";
import SharePage, { generateMetadata } from "@/app/card/compare/[a]/[b]/page";
import * as pageModule from "@/app/card/compare/[a]/[b]/page";
import OnePlayerPage from "@/app/card/compare/[a]/page";
import NoPlayerPage from "@/app/card/compare/page";
import { getSeasonWeeks, getQBStats } from "@/lib/data/queries";
import { getReceiverStats } from "@/lib/data/receivers";
import { getRBSeasonStats } from "@/lib/data/rushing";
import { getPlayerBySlug, getPlayerSlugIndex } from "@/lib/data/players";
import { hasNoDatabase } from "@/lib/supabase/server";
import { clearCompareCardMemo } from "@/lib/data/compare-card";
import { buildComparison, type ComparePlayerRow } from "@/lib/stats/compare";
import { CARD_STAT_KEYS } from "@/lib/stats/compare-card";

type Row = Record<string, unknown>;
const QB = rowsJson.qb as Row[];
const REC = rowsJson.receivers as Row[];
const WEEKS = [{ season: 2026, through_week: 4 }, { season: 2025, through_week: 22 }];
const BASE = "https://yardsperpass.com";
const P = (slug: string, player_id: string, player_name: string, position: string, current_team_id: string) =>
  ({ slug, player_id, player_name, position, current_team_id, headshot_url: null, jersey_number: null });
const PLAYERS = new Map([
  P("josh-allen", "00-0034857", "Josh Allen", "QB", "BUF"),
  P("matthew-stafford", "00-0026498", "Matthew Stafford", "QB", "LA"),
  P("tyler-huntley", "00-0035993", "Tyler Huntley", "QB", "BAL"),
  P("ceedee-lamb", "00-0036358", "CeeDee Lamb", "WR", "DAL"),
  P("jaxon-smith-njigba", "00-0038543", "Jaxon Smith-Njigba", "WR", "SEA"),
  P("trey-mcbride", "00-0037744", "Trey McBride", "TE", "ARI"),
  P("marquez-valdes-scantling", "00-0034272", "Marquez Valdes-Scantling", "WR", "LAC"),
  P("rookie-qb", "00-0099999", "Rookie Quarterback", "QB", "NYJ"),
  P("some-kicker", "00-0088888", "Some Kicker", "K", "BUF"),
].map((p) => [p.slug, p]));

const args = (a: string, b: string, season?: string | string[]) => ({
  params: Promise.resolve({ a, b }),
  searchParams: Promise.resolve(season === undefined ? {} : { season }),
});
const renderPage = async (a: string, b: string, season?: string) => render(await SharePage(args(a, b, season))).container;
/** The page body alone, as its own request. */
const page = (a: string, b: string, season?: string) => {
  newRequest();
  return renderPage(a, b, season);
};
/** The metadata alone, as its own request. */
const md = (a: string, b: string, season?: string) => {
  newRequest();
  return generateMetadata(args(a, b, season));
};
const READS = [getSeasonWeeks, getQBStats, getReceiverStats, getRBSeasonStats, getPlayerBySlug, getPlayerSlugIndex];
const readCount = () => READS.reduce((n, fn) => n + vi.mocked(fn).mock.calls.length, 0);
const ogImage = (meta: Awaited<ReturnType<typeof md>>) =>
  (meta.openGraph?.images as { url: string; width: number; height: number; alt: string }[])[0];
const txt = (el: Element | null) => el?.textContent ?? "";

beforeEach(() => {
  newRequest();
  clearCompareCardMemo();
  vi.mocked(notFound).mockClear();
  for (const fn of READS) vi.mocked(fn).mockReset();
  vi.mocked(hasNoDatabase).mockReturnValue(false);
  vi.mocked(getSeasonWeeks).mockResolvedValue(WEEKS);
  vi.mocked(getPlayerBySlug).mockImplementation(async (slug: string) => (PLAYERS.get(slug) ?? null) as never);
  vi.mocked(getQBStats).mockResolvedValue(QB as never);
  vi.mocked(getReceiverStats).mockResolvedValue(REC as never);
  vi.mocked(getRBSeasonStats).mockResolvedValue(rowsJson.rb as never);
  vi.spyOn(console, "error").mockImplementation(() => {});
  delete process.env.NEXT_PUBLIC_SITE_URL;
});

describe("route config", () => {
  it("the page's reads live in Next's data cache for an hour, as on the other card pages", () => {
    expect(pageModule.revalidate).toBe(3600);
  });
});

describe("route validation: junk is a 404 before any database read", () => {
  it.each([
    ["Josh-Allen", "matthew-stafford"], ["josh.allen", "matthew-stafford"], ["d'andre-swift", "josh-allen"],
    ["josh allen", "matthew-stafford"], ["josh-allen", ""], ["", "josh-allen"], ["josh--allen", "x"],
    ["josh-allen", "x".repeat(101)], ["<script>", "josh-allen"], ["josh-allen", "josh-allen"],
  ])("/card/compare/%s/%s", async (a, b) => {
    await expect(SharePage(args(a, b))).rejects.toThrow("NEXT_NOT_FOUND");
    expect((await generateMetadata(args(a, b))).title).toEqual({ absolute: "Comparison Not Found — Yards Per Pass" });
    expect(readCount()).toBe(0);
  });

  it.each(["1998", "2101", "99999999999999999999", "-3", "0"])("?season=%s can be no season: a 404 with no read", async (season) => {
    await expect(SharePage(args("josh-allen", "matthew-stafford", season))).rejects.toThrow("NEXT_NOT_FOUND");
    expect(await generateMetadata(args("josh-allen", "matthew-stafford", season))).toMatchObject({ robots: { index: false, follow: true } });
    expect(readCount()).toBe(0);
  });

  it("/card/compare and /card/compare/<one player> are 404s that read nothing (they would fall through to the player card route)", () => {
    expect(() => NoPlayerPage()).toThrow("NEXT_NOT_FOUND");
    expect(() => OnePlayerPage()).toThrow("NEXT_NOT_FOUND");
    expect(readCount()).toBe(0);
  });
});

describe("a real URL that is not a card: 404, never an error and never a card", () => {
  it.each([
    ["an unknown slug", "josh-allen", "nobody-at-all", undefined],
    ["different position groups", "josh-allen", "ceedee-lamb", undefined],
    ["a kicker", "some-kicker", "josh-allen", undefined],
    ["a season the site does not have", "josh-allen", "matthew-stafford", "2019"],
  ])("%s", async (_what, a, b, season) => {
    await expect(page(a, b, season)).rejects.toThrow("NEXT_NOT_FOUND");
    const meta = await md(a, b, season);
    expect(meta.title).toEqual({ absolute: "Comparison Not Found — Yards Per Pass" });
    expect(meta.robots).toEqual({ index: false, follow: true });
  });
});

describe("the card: both players have stats", () => {
  it("the band: both full names, each player's meta line and OVR, VS between them, each half in his colour", async () => {
    const el = await page("josh-allen", "matthew-stafford");
    expect(txt(el.querySelector('[data-compare-name="a"]'))).toBe("Josh Allen");
    expect(txt(el.querySelector('[data-compare-name="b"]'))).toBe("Matthew Stafford");
    expect(txt(el.querySelector('[data-compare-meta="a"]'))).toBe("QB · Buffalo Bills · 4 games");
    expect(txt(el.querySelector('[data-compare-meta="b"]'))).toBe("QB · Los Angeles Rams · 4 games");
    expect(txt(el.querySelector('[data-compare-ovr="a"]'))).toBe("91OVR");
    expect(txt(el.querySelector('[data-compare-ovr="b"]'))).toBe("76OVR");
    expect(txt(el.querySelector("[data-compare-band]"))).toContain("VS");
    const half = (side: string) => el.querySelector(`[data-compare-band-half="${side}"]`) as HTMLElement;
    expect(half("a").style.backgroundColor).toBe("rgb(0, 51, 141)");
    // BUF and LA are nearly the same blue: player B is moved to red.
    expect(half("b").style.backgroundColor).toBe("rgb(220, 38, 38)");
    expect(txt(el.querySelector("h1"))).toBe("Josh Allen vs Matthew Stafford — 2026");
  });

  it("the season line, the pool line (the sentence /compare prints) and the legend, once each", async () => {
    const el = await page("josh-allen", "matthew-stafford");
    expect(txt(el.querySelector("[data-compare-season-line]"))).toBe("2026 season · Through Week 4");
    expect(txt(el.querySelector("[data-compare-pool-line]"))).toBe("Radar: percentile among the 42 qualified quarterbacks (14+ pass attempts a game).");
    const all = txt(el);
    expect(all.split("Farther out = higher percentile · dashed ring = 50th percentile").length - 1).toBe(1);
    expect(all).not.toMatch(/Small sample|No outline|is not available|Not enough qualified/);
    expect(txt(el.querySelector("[data-compare-site]"))).toBe("YARDSPERPASS.COM · DATA: NFLVERSE");
  });

  it("the radar is drawn from buildComparison's values: solid for A, dashed for B, in the band's colours", async () => {
    const el = await page("josh-allen", "matthew-stafford");
    const outlines = Array.from(el.querySelectorAll("svg polygon")).filter((p) => p.getAttribute("stroke-width") === "2");
    expect(outlines.map((p) => [p.getAttribute("stroke"), p.getAttribute("stroke-dasharray")])).toEqual([["#dc2626", "6,3"], ["#00338D", null]]);
    // Read the corners back: Allen's percentiles among the 42 qualified quarterbacks (spec section 6.4).
    const pct = (points: string) => points.trim().split(/\s+/).map((s) => {
      const [x, y] = s.split(",").map(Number);
      return Math.round((Math.hypot(x - 150, y - 130) / 90) * 1000) / 10;
    });
    expect(pct(outlines[1].getAttribute("points")!)).toEqual([83.3, 81.0, 42.9, 88.1, 35.7, 42.9, 97.6]);
    expect(pct(outlines[0].getAttribute("points")!)).toEqual([45.2, 31.0, 88.1, 83.3, 16.7, 47.6, 9.8]);
  });

  it("the table: seven rows, every cell and highlight equal to the Compare page's row for that stat", async () => {
    const el = await page("josh-allen", "matthew-stafford");
    const find = (name: string) => QB.find((r) => r.player_name === name) as unknown as ComparePlayerRow;
    const onCompare = buildComparison({ group: "QB", rowA: find("J.Allen"), rowB: find("M.Stafford"), all: QB as unknown as ComparePlayerRow[], teamA: "BUF", teamB: "LA" });
    const rows = Array.from(el.querySelectorAll("[data-compare-row]"));
    expect(rows.map((r) => r.getAttribute("data-compare-row"))).toEqual([...CARD_STAT_KEYS.QB]);
    for (const r of rows) {
      const want = onCompare.rows.find((x) => x.key === r.getAttribute("data-compare-row"))!;
      const [a, label, b] = Array.from(r.querySelectorAll("td"));
      expect([txt(a), txt(label), txt(b)]).toEqual([want.a, want.label, want.b]);
      const won = (td: Element) => td.querySelector("span")!.className.includes("bg-green-100");
      expect([won(a), won(b)]).toEqual([want.winner === 1, want.winner === 2]);
    }
    const heads = Array.from(el.querySelectorAll("[data-compare-table] th")).map(txt);
    expect(heads).toEqual(["J.Allen", "STAT", "M.Stafford"]);
  });

  it("Copy Link and Download Image, and the three links on", async () => {
    const el = await page("josh-allen", "matthew-stafford");
    const actions = el.querySelector("[data-radar-actions]")!;
    expect(actions.getAttribute("data-page-path")).toBe("/card/compare/josh-allen/matthew-stafford");
    expect(actions.getAttribute("data-download-href")).toBe("/api/compare-card/josh-allen/matthew-stafford?season=2026&download=1");
    expect(Array.from(actions.querySelectorAll("button")).map(txt)).toEqual(["Copy Link", "Download Image"]);
    const link = (sel: string) => el.querySelector(sel) as HTMLAnchorElement;
    expect([txt(link("[data-compare-full]")), link("[data-compare-full]").getAttribute("href")]).toEqual(
      ["See the full comparison →", "/compare?p1=josh-allen&p2=matthew-stafford"]);
    expect([txt(link('[data-compare-stat-card="a"]')), link('[data-compare-stat-card="a"]').getAttribute("href")]).toEqual(
      ["Josh Allen stat card →", "/card/josh-allen"]);
    expect([txt(link('[data-compare-stat-card="b"]')), link('[data-compare-stat-card="b"]').getAttribute("href")]).toEqual(
      ["Matthew Stafford stat card →", "/card/matthew-stafford"]);
  });

  it("order is kept: the mirrored URL is the mirrored page", async () => {
    const el = await page("matthew-stafford", "josh-allen");
    expect(txt(el.querySelector('[data-compare-name="a"]'))).toBe("Matthew Stafford");
    expect(txt(el.querySelector('[data-compare-ovr="a"]'))).toBe("76OVR");
    expect(el.querySelector("[data-radar-actions]")!.getAttribute("data-page-path")).toBe("/card/compare/matthew-stafford/josh-allen");
  });

  it("a WR against a TE: each in his own pool, both counts; YPRR named as not available", async () => {
    const el = await page("ceedee-lamb", "trey-mcbride");
    expect(txt(el.querySelector("[data-compare-pool-line]"))).toBe(
      "Radar: each player against qualified players at his position (2+ targets a game): 129 WRs, 56 TEs.");
    expect(Array.from(el.querySelectorAll("[data-compare-note]")).map(txt)).toEqual(["YPRR is not available for 2026."]);
    expect(txt(el.querySelector('[data-compare-meta="b"]'))).toBe("TE · Arizona Cardinals · 4 games");
  });

  it("a player under the line: his OVR is a dash and the small-sample line says why", async () => {
    const el = await page("tyler-huntley", "josh-allen");
    expect(txt(el.querySelector('[data-compare-ovr="a"]'))).toBe("—OVR");
    expect(txt(el.querySelector('[data-compare-ovr="b"]'))).toBe("91OVR");
    expect(txt(el.querySelector("[data-compare-small-sample]"))).toBe(
      "Small sample: T.Huntley has 9 pass attempts in 1 game (under 14 a game). OVR hidden.");
  });

  it("a player with too few radar stats: no outline for him, and the sentence that says so", async () => {
    vi.mocked(getReceiverStats).mockResolvedValue(REC.map((r) => (r.player_name === "M.Valdes-Scantling" ? { ...r, croe: null } : r)) as never);
    const el = await page("marquez-valdes-scantling", "ceedee-lamb");
    const corners = Array.from(el.querySelectorAll("svg polygon")).filter((p) => p.getAttribute("stroke-width") === "2")
      .map((p) => (p.getAttribute("points") ?? "").trim().split(/\s+/).filter(Boolean).length);
    expect(corners).toEqual([5, 0]);
    expect(Array.from(el.querySelectorAll("[data-compare-note]")).map(txt)).toEqual([
      "No outline for M.Valdes-Scantling: 3 of his 6 radar stats are not available.", "YPRR is not available for 2026.",
    ]);
  });

  it("too few qualified players: the sentence where the radar would be; the table and the buttons stay", async () => {
    vi.mocked(getQBStats).mockResolvedValue(QB.filter((r) => ["J.Allen", "T.Huntley"].includes(r.player_name as string)) as never);
    const el = await page("josh-allen", "tyler-huntley");
    expect(el.querySelector("svg polygon")).toBeNull();
    expect(txt(el.querySelector("[data-compare-no-radar]"))).toBe("Not enough qualified quarterbacks to draw the radar (14+ pass attempts a game).");
    expect(el.querySelector("[data-compare-pool-line]")).toBeNull();
    expect(el.querySelectorAll("[data-compare-row]")).toHaveLength(7);
    expect(el.querySelector("[data-radar-actions]")).not.toBeNull();
  });

  it("a past season: its rows, its week, and ?season= on every link", async () => {
    const el = await page("josh-allen", "matthew-stafford", "2025");
    expect(vi.mocked(getQBStats)).toHaveBeenCalledWith(2025);
    expect(txt(el.querySelector("[data-compare-season-line]"))).toBe("2025 season · Through Week 22");
    const actions = el.querySelector("[data-radar-actions]")!;
    expect(actions.getAttribute("data-page-path")).toBe("/card/compare/josh-allen/matthew-stafford?season=2025");
    expect(actions.getAttribute("data-download-href")).toBe("/api/compare-card/josh-allen/matthew-stafford?season=2025&download=1");
    expect(el.querySelector("[data-compare-full]")!.getAttribute("href")).toBe("/compare?p1=josh-allen&p2=matthew-stafford&season=2025");
    expect(el.querySelector('[data-compare-stat-card="a"]')!.getAttribute("href")).toBe("/card/josh-allen?season=2025");
  });

  it("a junk ?season= is the newest season, as everywhere on the site; ?season=<newest> is the bare page", async () => {
    for (const season of ["abc", "", "2026"]) {
      const el = await page("josh-allen", "matthew-stafford", season);
      expect(el.querySelector("[data-radar-actions]")!.getAttribute("data-page-path")).toBe("/card/compare/josh-allen/matthew-stafford");
    }
  });
});

describe("a real pair with nothing to compare this season", () => {
  it("HTTP 200 with the sentence and the links on; no card and no buttons", async () => {
    const el = await page("josh-allen", "rookie-qb");
    expect(notFound).not.toHaveBeenCalled();
    expect(txt(el.querySelector("h1"))).toBe("Josh Allen vs Rookie Quarterback — 2026");
    expect(txt(el.querySelector("[data-compare-message]"))).toBe(
      "Rookie Quarterback has no 2026 stats yet, so there is nothing to compare. Comparisons update the day after each game.");
    expect(el.querySelector("[data-compare-card]")).toBeNull();
    expect(el.querySelector("[data-radar-actions]")).toBeNull();
    expect(el.querySelector("[data-compare-full]")!.getAttribute("href")).toBe("/compare?p1=josh-allen&p2=rookie-qb");
    expect(el.querySelector('[data-compare-stat-card="b"]')!.getAttribute("href")).toBe("/card/rookie-qb");
  });

  it("its metadata: the title, the sentence as the description, noindex, and the plate as the preview image", async () => {
    const meta = await md("josh-allen", "rookie-qb");
    expect(meta.title).toEqual({ absolute: "Josh Allen vs Rookie Quarterback — 2026 — Yards Per Pass" });
    expect(meta.description).toBe("Rookie Quarterback has no 2026 stats yet, so there is nothing to compare. Comparisons update the day after each game.");
    expect(meta.robots).toEqual({ index: false, follow: true });
    expect(ogImage(meta).url).toBe(`${BASE}/api/compare-card/josh-allen/rookie-qb?season=2026&w=4`);
  });
});

describe("metadata of a card", () => {
  it("the title is absolute (the site name once), the preview title has no season and no site name", async () => {
    const meta = await md("josh-allen", "matthew-stafford");
    expect(meta.title).toEqual({ absolute: "Josh Allen vs Matthew Stafford — 2026 — Yards Per Pass" });
    expect(meta.openGraph?.title).toBe("Josh Allen vs Matthew Stafford");
    expect((meta.twitter as { title: string }).title).toBe("Josh Allen vs Matthew Stafford");
    expect(meta.description).toBe(
      "Josh Allen (QB, Buffalo Bills) vs Matthew Stafford (QB, Los Angeles Rams), 2026 through Week 4: overlaid radar and head-to-head stats.");
  });

  it("every share page is noindex, follow (decision J3)", async () => {
    expect((await md("josh-allen", "matthew-stafford")).robots).toEqual({ index: false, follow: true });
    expect((await md("josh-allen", "matthew-stafford", "2025")).robots).toEqual({ index: false, follow: true });
  });

  it("og:url is the page's OWN order; the canonical is the alphabetical order: a non-alphabetical pair shows the difference", async () => {
    const meta = await md("matthew-stafford", "josh-allen");
    expect(meta.openGraph?.url).toBe(`${BASE}/card/compare/matthew-stafford/josh-allen`);
    expect(meta.alternates?.canonical).toBe(`${BASE}/card/compare/josh-allen/matthew-stafford`);
    const alphabetical = await md("josh-allen", "matthew-stafford");
    expect(alphabetical.openGraph?.url).toBe(`${BASE}/card/compare/josh-allen/matthew-stafford`);
    expect(alphabetical.alternates?.canonical).toBe(`${BASE}/card/compare/josh-allen/matthew-stafford`);
  });

  it("the preview image is the image route, named explicitly with the season and the week, for og and twitter alike", async () => {
    const meta = await md("matthew-stafford", "josh-allen");
    expect(ogImage(meta)).toEqual({
      url: `${BASE}/api/compare-card/matthew-stafford/josh-allen?season=2026&w=4`, width: 1200, height: 630,
      alt: "Matthew Stafford vs Josh Allen comparison card, 2026",
    });
    expect(meta.twitter).toMatchObject({ card: "summary_large_image", images: [`${BASE}/api/compare-card/matthew-stafford/josh-allen?season=2026&w=4`] });
  });

  it("a past season keeps ?season= in og:url and the canonical, and names it in the image URL", async () => {
    const meta = await md("matthew-stafford", "josh-allen", "2025");
    expect(meta.openGraph?.url).toBe(`${BASE}/card/compare/matthew-stafford/josh-allen?season=2025`);
    expect(meta.alternates?.canonical).toBe(`${BASE}/card/compare/josh-allen/matthew-stafford?season=2025`);
    expect(ogImage(meta).url).toBe(`${BASE}/api/compare-card/matthew-stafford/josh-allen?season=2025&w=22`);
    expect(meta.title).toEqual({ absolute: "Matthew Stafford vs Josh Allen — 2025 — Yards Per Pass" });
  });

  it("the absolute URLs are built from NEXT_PUBLIC_SITE_URL when it is set", async () => {
    process.env.NEXT_PUBLIC_SITE_URL = "https://preview.example";
    const meta = await md("josh-allen", "matthew-stafford");
    expect(meta.openGraph?.url).toBe("https://preview.example/card/compare/josh-allen/matthew-stafford");
    expect(ogImage(meta).url).toBe("https://preview.example/api/compare-card/josh-allen/matthew-stafford?season=2026&w=4");
  });
});

describe("reads", () => {
  it("one page view (metadata, then the body) loads once: the seasons, two per-player reads, one season table", async () => {
    newRequest();
    await generateMetadata(args("josh-allen", "matthew-stafford"));
    await renderPage("josh-allen", "matthew-stafford");
    expect(vi.mocked(getSeasonWeeks)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(getPlayerBySlug).mock.calls.map((c) => c[0])).toEqual(["josh-allen", "matthew-stafford"]);
    expect(vi.mocked(getQBStats)).toHaveBeenCalledTimes(1);
    expect(readCount()).toBe(4);
    // The slug list is the image route's: the page never reads it.
    expect(getPlayerSlugIndex).not.toHaveBeenCalled();
  });

  it("the title and the body can never name different weeks: a refresh between the two does not split them", async () => {
    newRequest();
    const meta = await generateMetadata(args("josh-allen", "matthew-stafford"));
    vi.mocked(getSeasonWeeks).mockResolvedValue([{ season: 2026, through_week: 5 }, { season: 2025, through_week: 22 }]);
    const el = render(await SharePage(args("josh-allen", "matthew-stafford"))).container;
    expect(ogImage(meta).url).toContain("&w=4");
    expect(txt(el.querySelector("[data-compare-season-line]"))).toBe("2026 season · Through Week 4");
  });
});

describe("a failed read is an error, for the page and for its metadata: never a 404, never an empty card", () => {
  it.each([
    ["the seasons", () => vi.mocked(getSeasonWeeks).mockRejectedValue(new Error("Failed to fetch season weeks: timeout"))],
    ["a player", () => vi.mocked(getPlayerBySlug).mockRejectedValue(new Error("Failed to fetch player josh-allen: timeout"))],
    ["the season table", () => vi.mocked(getQBStats).mockRejectedValue(new Error("Failed to fetch QB stats: timeout"))],
    ["an empty seasons list on a real database", () => vi.mocked(getSeasonWeeks).mockResolvedValue([])],
    ["no rows for a season the site has", () => vi.mocked(getQBStats).mockResolvedValue([])],
  ])("%s", async (_what, breakIt) => {
    breakIt();
    await expect(page("josh-allen", "matthew-stafford")).rejects.not.toThrow("NEXT_NOT_FOUND");
    await expect(page("josh-allen", "matthew-stafford")).rejects.toThrow();
    await expect(md("josh-allen", "matthew-stafford")).rejects.toThrow();
    expect(notFound).not.toHaveBeenCalled();
  });
});
