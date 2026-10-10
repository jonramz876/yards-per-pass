// The matchup share page, /card/matchup/[away]/[home] (matchup card spec
// 2026-10-11 §4.1, §7, §8.1; PR 2): validation and both redirects before any
// read, the card state (the PNG, its buttons, the 14 lines per pane as two
// plain tables, the rank note), every message state, the metadata, and the two
// levels above the page that must stay 404s. The loader is replaced here, so
// each test states `game`, `swap` and the model itself (no clock to pin).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { ReactElement } from "react";

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
}));
vi.mock("next/link", () => ({
  default: ({ href, children, prefetch, ...rest }: { href: string; children: React.ReactNode; prefetch?: boolean }) => (
    <a href={href} data-prefetch={prefetch === undefined ? undefined : String(prefetch)} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock("next/image", () => ({
  default: ({ unoptimized, alt, ...rest }: { unoptimized?: boolean; alt: string }) => (
    // eslint-disable-next-line @next/next/no-img-element -- the test's stand-in for next/image
    <img alt={alt} data-unoptimized={unoptimized === undefined ? undefined : String(unoptimized)} {...rest} />
  ),
}));
vi.mock("@/lib/data/matchup", () => ({ loadMatchup: vi.fn(), loadMatchupIndex: vi.fn() }));
// The 308 looks a requested season up in the memoised season list (lib/data/matchup-season.ts, not mocked).
vi.mock("@/lib/data/compare-card", () => ({ getSeasonWeeksCached: vi.fn() }));

import SharePage, * as pageModule from "@/app/card/matchup/[away]/[home]/page";
import { generateMetadata } from "@/app/card/matchup/[away]/[home]/page";
import OneTeamPage from "@/app/card/matchup/[away]/page";
import NoTeamPage from "@/app/card/matchup/page";
import { notFound, permanentRedirect, redirect } from "next/navigation";
import { loadMatchup } from "@/lib/data/matchup";
import { getSeasonWeeksCached } from "@/lib/data/compare-card";
import { matchupCardImage } from "@/lib/og/matchup-card-image";
import { MATCHUP_FORMULA_LINE, MATCHUP_NO_OVERLAY_NOTE, MATCHUP_SMALL_POOL_NOTE, matchupRankNote, type MatchupModel } from "@/lib/stats/matchup";
import { MATCHUP_CARD_UNAVAILABLE } from "@/lib/stats/matchup-card";
import { RADAR_AXES } from "@/lib/stats/team-radar";
import {
  ROWS_SMALL_POOL, asCard, cardGame, cardLoad, cardModelOf, drawnPane, rowsMissingSpokes, rowsUndrawn,
} from "../stats/helpers/matchup-card-loads";

type Search = Record<string, string | string[] | undefined>;
const args = (away: string, home: string, search: Search = {}) => ({
  params: Promise.resolve({ away, home }),
  searchParams: Promise.resolve(search),
});
const BASE = "https://yardsperpass.com";

/** The page's server-rendered HTML, as a detached element to query. */
async function html(away: string, home: string, search: Search = {}): Promise<HTMLElement> {
  const el = document.createElement("div");
  el.innerHTML = renderToStaticMarkup(await SharePage(args(away, home, search)));
  return el;
}
const outcome = (away: string, home: string, search: Search = {}) =>
  SharePage(args(away, home, search)).then(() => "200", (e: Error) => e.message);
const md = (away: string, home: string, search: Search = {}) => generateMetadata(args(away, home, search));
const ogImage = (meta: Awaited<ReturnType<typeof md>>) =>
  (meta.openGraph?.images as { url: string; width: number; height: number; alt: string }[] | undefined)?.[0];
const txt = (el: Element | null | undefined) => el?.textContent ?? "";
const follows = (a: Element, b: Element) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);

const NOT_FOUND = { title: { absolute: "Matchup Card Not Found — Yards Per Pass" }, robots: { index: false, follow: true } };
const uncovered = (over: Record<string, unknown> = {}) =>
  cardLoad("BUF", "LA", { state: "uncovered", season: 2025, isLatestSeason: false, model: null, firstSeason: 2026, game: null, ...over });

let errorSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  vi.mocked(loadMatchup).mockReset();
  vi.mocked(loadMatchup).mockImplementation(async (a, h) => cardLoad(a, h));
  vi.mocked(getSeasonWeeksCached).mockReset();
  vi.mocked(getSeasonWeeksCached).mockResolvedValue([{ season: 2026, through_week: 4 }, { season: 2025, through_week: 22 }] as never);
  for (const fn of [notFound, redirect, permanentRedirect]) vi.mocked(fn).mockClear();
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  delete process.env.NEXT_PUBLIC_SITE_URL;
});
afterEach(() => {
  errorSpy.mockRestore();
});

describe("/card/matchup/[away]/[home]: the module and its folder", () => {
  it("its reads live in Next's data cache for an hour; it is never pre-rendered", () => {
    expect(pageModule.revalidate).toBe(3600);
    expect("generateStaticParams" in pageModule).toBe(false);
    expect("dynamic" in pageModule).toBe(false);
  });

  it("no loading, not-found or opengraph-image file anywhere under app/card/matchup/", () => {
    const walk = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : [e.name]));
    const files = walk(join(process.cwd(), "app", "card", "matchup"));
    expect(files.filter((f) => /^(loading|opengraph-image|twitter-image|not-found|error)\./.test(f))).toEqual([]);
    expect(files.sort()).toEqual(["page.tsx", "page.tsx", "page.tsx"]);
  });

  it("a server component with no client file of its own: its buttons are the team radar card's", () => {
    const source = readFileSync(join(process.cwd(), "app", "card", "matchup", "[away]", "[home]", "page.tsx"), "utf8");
    expect(source).not.toMatch(/^\s*["']use client["']/m);
    expect(source).toContain('from "@/app/card/team/[team_id]/[side]/TeamRadarActions"');
    expect(existsSync(join(process.cwd(), "app", "card", "matchup", "[away]", "[home]", "MatchupCardActions.tsx"))).toBe(false);
    // Not wrapped in React cache(): the loader's memo already gives metadata and body the same reads.
    expect(source).not.toMatch(/import\s*\{[^}]*\bcache\b[^}]*\}\s*from\s*["']react["']/);
  });
});

describe("§4.1 steps 1-3: decided before the pair is loaded", () => {
  it.each([
    ["BUF", "BUF"], ["buf", "BUF"], ["BUF", "LAR"], ["BUF", "XX"], ["BUF", "L.A"], ["XXX", "LA"], ["ſf", "BUF"], ["pıt", "BUF"],
    ["BUF", ""], ["BUFF", "LA"], ["B", "LA"], ["BUF", "L A"], ["BUF", "%00"], ["BUF", "x".repeat(300)],
  ])("/card/matchup/%s/%s is a 404 with no read and no redirect, and its metadata is the plain not-found object", async (away, home) => {
    expect(await outcome(away, home)).toBe("NEXT_NOT_FOUND");
    expect(await md(away, home)).toEqual(NOT_FOUND);
    expect(loadMatchup).not.toHaveBeenCalled();
    expect(getSeasonWeeksCached).not.toHaveBeenCalled();
    expect(redirect).not.toHaveBeenCalled();
    expect(permanentRedirect).not.toHaveBeenCalled();
  });

  it.each([
    [{}, "/card/matchup/BUF/LA"],
    [{ ball: "home" }, "/card/matchup/BUF/LA"],
    [{ season: "2025" }, "/card/matchup/BUF/LA?season=2025"],
    [{ season: "2026" }, "/card/matchup/BUF/LA?season=2026"],
    [{ season: "2025", ball: "home", utm_source: "x" }, "/card/matchup/BUF/LA?season=2025"],
    [{ season: "2031" }, "/card/matchup/BUF/LA"],
    [{ season: "2025abc" }, "/card/matchup/BUF/LA"],
    [{ season: ["2026", "2025"] }, "/card/matchup/BUF/LA"],
    [{ season: "1998" }, "/card/matchup/BUF/LA"],
  ] as [Search, string][])("mixed case is a 308 to the upper-case address; the query is rebuilt, never echoed: %j → %s", async (search, target) => {
    expect(await outcome("buf", "La", search)).toBe(`NEXT_REDIRECT 308 ${target}`);
    expect(permanentRedirect).toHaveBeenCalledTimes(1);
    expect(redirect).not.toHaveBeenCalled();
    expect(loadMatchup).not.toHaveBeenCalled();
  });

  it("the 308 reads the memoised season list only when the address names a season, and logs under its own name when that read fails", async () => {
    await outcome("buf", "la");
    await outcome("buf", "la", { ball: "home", season: "abc" });
    expect(getSeasonWeeksCached).not.toHaveBeenCalled();
    await outcome("buf", "la", { season: "2025" });
    expect(getSeasonWeeksCached).toHaveBeenCalledTimes(1);
    vi.mocked(getSeasonWeeksCached).mockRejectedValue(new Error("Failed to fetch season weeks"));
    expect(await outcome("buf", "la", { season: "2025" })).toBe("NEXT_REDIRECT 308 /card/matchup/BUF/LA");
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(String(errorSpy.mock.calls[0][0])).toMatch(/^Matchup card \(BUF at LA\): the season list could not be read/);
  });

  it("the metadata of a URL about to 308 is the plain not-found object, with no read", async () => {
    expect(await md("buf", "LA", { season: "2025" })).toEqual(NOT_FOUND);
    expect(getSeasonWeeksCached).not.toHaveBeenCalled();
    expect(loadMatchup).not.toHaveBeenCalled();
  });
});

describe("§4.1 steps 4-6: the load, the order redirect, the season", () => {
  it("hands the loader upper-case ids and the validated season (null when absent or junk); ball and every other key are ignored", async () => {
    await outcome("BUF", "LA");
    expect(loadMatchup).toHaveBeenLastCalledWith("BUF", "LA", null);
    await outcome("BUF", "LA", { season: "2025", ball: "home", x: "1" });
    expect(loadMatchup).toHaveBeenLastCalledWith("BUF", "LA", 2025);
    for (const season of ["1998", "abc", "2025.9", "2025abc", " 2025", "", ["2026", "2025"]]) {
      await outcome("BUF", "LA", { season });
      expect(loadMatchup).toHaveBeenLastCalledWith("BUF", "LA", null);
    }
  });

  it("the only game is the other way round: a 307 to the swapped order, with the RESOLVED season and no ball", async () => {
    vi.mocked(loadMatchup).mockImplementation(async (a, h) => cardLoad(a, h, { swap: true, game: null }));
    expect(await outcome("LA", "BUF")).toBe("NEXT_REDIRECT 307 /card/matchup/BUF/LA");
    expect(await outcome("LA", "BUF", { ball: "home", season: "2031" })).toBe("NEXT_REDIRECT 307 /card/matchup/BUF/LA");
    expect(redirect).toHaveBeenCalledTimes(2);
    expect(permanentRedirect).not.toHaveBeenCalled();
    vi.mocked(loadMatchup).mockImplementation(async (a, h) => cardLoad(a, h, { swap: true, game: null, season: 2025, isLatestSeason: false }));
    expect(await outcome("LA", "BUF", { season: "2025" })).toBe("NEXT_REDIRECT 307 /card/matchup/BUF/LA?season=2025");
    expect(await md("LA", "BUF")).toEqual(NOT_FOUND);
  });

  it("both orders are real games, or no game at all: no redirect", async () => {
    expect(await outcome("NE", "BUF")).toBe("200");
    expect(await outcome("BUF", "NE")).toBe("200");
    vi.mocked(loadMatchup).mockImplementation(async (a, h) => cardLoad(a, h, { game: null }));
    expect(await outcome("BUF", "DAL")).toBe("200");
    expect(redirect).not.toHaveBeenCalled();
  });

  it("a season the site does not list: the newest season is shown, the canonical is the bare URL, and the image URL names the season shown", async () => {
    // The loader answers the newest season for an unlisted one (lib/data/matchup.ts).
    const el = await html("BUF", "LA", { season: "2031" });
    expect(el.querySelector("h1")?.textContent).toBe("Buffalo Bills at Los Angeles Rams: matchup card, 2026");
    expect(el.querySelector("[data-matchup-card-image] img")?.getAttribute("src")).toBe("/api/matchup-card/BUF/LA?season=2026&w=3");
    const meta = await md("BUF", "LA", { season: "2031" });
    expect(meta.alternates?.canonical).toBe(`${BASE}/card/matchup/BUF/LA`);
    expect(meta.openGraph?.url).toBe(`${BASE}/card/matchup/BUF/LA`);
    expect(ogImage(meta)?.url).toBe(`${BASE}/api/matchup-card/BUF/LA?season=2026&w=3`);
  });

  it("a failed core read rejects from the page and from the metadata (a real 500), never a 404 or an empty page", async () => {
    vi.mocked(loadMatchup).mockRejectedValue(new Error("Failed to fetch matchup rows for 2026"));
    expect(await outcome("BUF", "LA")).toBe("Failed to fetch matchup rows for 2026");
    await expect(md("BUF", "LA")).rejects.toThrow("Failed to fetch matchup rows for 2026");
    expect(notFound).not.toHaveBeenCalled();
  });
});

describe("the card page (§8.1)", () => {
  const MODEL = asCard(cardModelOf("BUF", "LA", cardLoad("BUF", "LA")));

  it("a visually hidden h1 (K6), then the picture, its buttons, the two tables, the rank note, the links: in that order", async () => {
    const el = await html("BUF", "LA");
    const h1 = el.querySelector("h1")!;
    expect(h1.textContent).toBe("Buffalo Bills at Los Angeles Rams: matchup card, 2026");
    expect(h1.getAttribute("class")).toBe("sr-only");
    const order = [
      h1, el.querySelector("[data-matchup-card-image]"), el.querySelector("[data-radar-actions]"), el.querySelector("[data-matchup-card-tables]"),
      el.querySelector("[data-rank-note]"), el.querySelector("[data-legend-line]"), el.querySelector("[data-formula-line]"),
      el.querySelector("[data-colour-note]"), el.querySelector("[data-full-matchup]"),
    ];
    for (const node of order) expect(node).not.toBeNull();
    for (let i = 1; i < order.length; i++) expect(follows(order[i - 1]!, order[i]!), String(i)).toBe(true);
    expect(el.querySelectorAll("table")).toHaveLength(2);
    expect(follows(el.querySelector("[data-radar-actions]")!, el.querySelector("table")!)).toBe(true);
    expect(follows(el.querySelectorAll("table")[1], el.querySelector("[data-rank-note]")!)).toBe(true);
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it("the picture is the image route's PNG, the very URL og:image names (one CDN entry), unoptimized, 1200×630, with K7 as its alt", async () => {
    const el = await html("BUF", "LA");
    const img = el.querySelector("[data-matchup-card-image] img")!;
    const meta = await md("BUF", "LA");
    expect(img.getAttribute("src")).toBe("/api/matchup-card/BUF/LA?season=2026&w=3");
    expect(`${BASE}${img.getAttribute("src")}`).toBe(ogImage(meta)!.url);
    expect([img.getAttribute("width"), img.getAttribute("height")]).toEqual(["1200", "630"]);
    expect(img.getAttribute("alt")).toBe("Buffalo Bills at Los Angeles Rams matchup card, 2026");
    expect(img.getAttribute("alt")).toBe(ogImage(meta)!.alt);
    expect(img.getAttribute("data-unoptimized")).toBe("true");
    expect(img.getAttribute("class")).toBe("h-auto w-full");
    expect(el.querySelectorAll("img")).toHaveLength(1);
    // No second chart on the page: one drawing, one truth.
    expect(el.querySelectorAll("[data-matchup-card-page] svg")).toHaveLength(0);
  });

  it("Copy Link is this page's own path and Download the image route with download=1", async () => {
    const el = await html("BUF", "LA");
    const actions = el.querySelector("[data-radar-actions]")!;
    expect(actions.getAttribute("data-page-path")).toBe("/card/matchup/BUF/LA");
    expect(actions.getAttribute("data-download-href")).toBe("/api/matchup-card/BUF/LA?season=2026&w=3&download=1");
    expect(Array.from(actions.querySelectorAll("button")).map(txt)).toEqual(["Copy Link", "Download Image"]);
  });

  it("a past season: ?season= on the copied path, the season on both image URLs, on the matchup link and on the team links", async () => {
    vi.mocked(loadMatchup).mockImplementation(async (a, h) => cardLoad(a, h, { season: 2025, defaultSeason: 2026, isLatestSeason: false }));
    const el = await html("BUF", "LA", { season: "2025" });
    const actions = el.querySelector("[data-radar-actions]")!;
    expect(actions.getAttribute("data-page-path")).toBe("/card/matchup/BUF/LA?season=2025");
    expect(actions.getAttribute("data-download-href")).toBe("/api/matchup-card/BUF/LA?season=2025&w=3&download=1");
    expect(el.querySelector("[data-matchup-card-image] img")?.getAttribute("src")).toBe("/api/matchup-card/BUF/LA?season=2025&w=3");
    expect(el.querySelector("[data-full-matchup]")?.getAttribute("href")).toBe("/matchup/BUF/LA?season=2025");
    expect(el.querySelector('[data-team-link="away"]')?.getAttribute("href")).toBe("/team/BUF?season=2025");
  });

  it("the links: the full matchup and each team's page, none prefetched", async () => {
    const el = await html("BUF", "LA");
    const full = el.querySelector("[data-full-matchup]")!;
    expect([full.getAttribute("href"), txt(full), full.getAttribute("data-prefetch")]).toEqual(["/matchup/BUF/LA", "See the full matchup →", "false"]);
    const away = el.querySelector('[data-team-link="away"]')!;
    const home = el.querySelector('[data-team-link="home"]')!;
    expect([away.getAttribute("href"), txt(away)]).toEqual(["/team/BUF", "Buffalo Bills team page →"]);
    expect([home.getAttribute("href"), txt(home)]).toEqual(["/team/LA", "Los Angeles Rams team page →"]);
    for (const a of Array.from(el.querySelectorAll("a"))) expect(a.getAttribute("data-prefetch"), a.getAttribute("href")!).toBe("false");
  });

  it("the explanatory lines: the rank note (M6) directly under the tables, then K5, then the formula line", async () => {
    const el = await html("BUF", "LA");
    const m = cardLoad("BUF", "LA").model as MatchupModel;
    expect(txt(el.querySelector("[data-rank-note]"))).toBe(
      matchupRankNote({ teamsPlayed: m.teamsPlayed, season: 2026, throughWeek: m.throughWeek, awayId: "BUF", homeId: "LA", awayGames: m.away.games, homeGames: m.home.games }),
    );
    expect(txt(el.querySelector("[data-rank-note]"))).toMatch(/for sacks, takeaways and stuffs, making more ranks higher\.$/);
    expect(txt(el.querySelector("[data-legend-line]"))).toBe(MODEL.legendLine);
    expect(txt(el.querySelector("[data-formula-line]"))).toBe(MATCHUP_FORMULA_LINE);
    const next = el.querySelector("[data-matchup-card-tables]")!.nextElementSibling!;
    expect(next.querySelector("[data-rank-note]") ?? (next.matches("[data-rank-note]") ? next : null)).not.toBeNull();
  });

  it("K8: a line for each team that is not in its primary colour (BUF at LA: the Rams), none when both are (TB at DAL)", async () => {
    const la = await html("BUF", "LA");
    expect(Array.from(la.querySelectorAll("[data-colour-note]")).map(txt)).toEqual([
      "Los Angeles Rams are drawn in their second colour on this card so the two teams never share one.",
    ]);
    const dal = await html("TB", "DAL");
    expect(dal.querySelectorAll("[data-colour-note]")).toHaveLength(0);
    const pit = await html("PIT", "NO");
    expect(Array.from(pit.querySelectorAll("[data-colour-note]")).map(txt)).toEqual([
      "Pittsburgh Steelers are drawn in a darker shade of their colour on this card so the two teams never share one.",
      "New Orleans Saints are drawn in their second colour on this card so the two teams never share one.",
    ]);
  });

  it("a pair with no game: 'vs' in the heading and the alt text", async () => {
    vi.mocked(loadMatchup).mockImplementation(async (a, h) => cardLoad(a, h, { game: null }));
    const el = await html("KC", "TB");
    expect(el.querySelector("h1")?.textContent).toBe("Kansas City Chiefs vs Tampa Bay Buccaneers: matchup card, 2026");
    expect(el.querySelector("img")?.getAttribute("alt")).toBe("Kansas City Chiefs vs Tampa Bay Buccaneers matchup card, 2026");
  });

  it("the page is never wider than the window: one column capped at 1080 px, nothing with a fixed width, no sideways scroller", async () => {
    const el = await html("BUF", "LA");
    const column = el.querySelector("[data-matchup-card-page]")!;
    expect(column.getAttribute("class")).toMatch(/\bw-full\b/);
    expect(column.getAttribute("class")).toMatch(/\bmax-w-\[1080px\]/);
    expect(column.getAttribute("class")).toMatch(/\bmin-w-0\b/);
    const classes = Array.from(el.querySelectorAll("[class]")).flatMap((n) => (n.getAttribute("class") ?? "").split(/\s+/));
    expect(classes.filter((c) => /(^|:)(w|min-w)-\[\d+px\]$/.test(c))).toEqual([]);
    expect(classes.filter((c) => /overflow-(x-)?(auto|scroll)/.test(c))).toEqual([]);
  });
});

describe("the 14 lines as two readable tables (§8.1 item 4)", () => {
  const cells = (table: Element) =>
    Array.from(table.querySelectorAll("tbody tr")).map((tr) => Array.from(tr.children).map((c) => txt(c)));

  it("exactly two tables of seven body rows, in pane order; each caption is '{OFF} offense over {DEF} defense'", async () => {
    const el = await html("BUF", "LA");
    const tables = Array.from(el.querySelectorAll("table"));
    expect(tables).toHaveLength(2);
    expect(tables.map((t) => t.getAttribute("data-pane-table"))).toEqual(["0", "1"]);
    expect(tables.map((t) => txt(t.querySelector("caption")))).toEqual(["BUF offense over LA defense", "LA offense over BUF defense"]);
    for (const t of tables) {
      expect(t.querySelectorAll("tbody tr")).toHaveLength(7);
      expect(Array.from(t.querySelectorAll("tbody tr")).map((tr) => tr.getAttribute("data-spoke"))).toEqual(RADAR_AXES.map((a) => a.key));
    }
    expect(Array.from(tables[0].querySelectorAll("thead th")).map(txt)).toEqual(["", "BUF offense", "LA defense"]);
    expect(Array.from(tables[1].querySelectorAll("thead th")).map(txt)).toEqual(["", "LA offense", "BUF defense"]);
  });

  it("every cell is the model's own line, verbatim: the spoke name, the offense line, the defense line", async () => {
    for (const [away, home] of [["BUF", "LA"], ["TB", "DAL"], ["KC", "TB"], ["WAS", "JAX"]]) {
      const model = asCard(cardModelOf(away, home, cardLoad(away, home)));
      const el = await html(away, home);
      const tables = Array.from(el.querySelectorAll("table"));
      model.panes.forEach((pane, n) => {
        const p = drawnPane(pane);
        expect(cells(tables[n]), `${away} at ${home} pane ${n}`).toEqual(p.labels.map((l) => [l.name, l.offLine, l.defLine]));
      });
    }
  });

  it("the 28 strings on the page are the 28 strings on the picture, for the same model", async () => {
    const model = asCard(cardModelOf("BUF", "LA", cardLoad("BUF", "LA")));
    type El = ReactElement<Record<string, unknown>>;
    const flatten = (node: unknown, out: El[] = []): El[] => {
      if (Array.isArray(node)) node.forEach((n) => flatten(n, out));
      else if (node !== null && typeof node === "object" && "props" in (node as object)) {
        out.push(node as El);
        flatten((node as El).props.children, out);
      }
      return out;
    };
    const text = (node: unknown): string =>
      node === null || node === undefined || typeof node === "boolean" ? ""
        : typeof node === "string" || typeof node === "number" ? String(node)
        : Array.isArray(node) ? node.map(text).join("") : text((node as El).props.children);
    const onPicture = flatten(matchupCardImage(model)).filter((e) => e.props["data-label-row"] !== undefined).map(text);
    const el = await html("BUF", "LA");
    const onPage = Array.from(el.querySelectorAll("table tbody td")).map(txt);
    expect(onPicture).toHaveLength(28);
    expect(onPage).toEqual(onPicture);
    for (const s of onPage) expect(s).toMatch(/^\d{1,3}\.\d% · (T-)?\d{1,2}(st|nd|rd|th)$/);
  });

  it("the header cells carry each unit's mark in that team's card colour: a round dot for the offense, an outlined square for the defense", async () => {
    const model = asCard(cardModelOf("BUF", "LA", cardLoad("BUF", "LA")));
    const el = await html("BUF", "LA");
    const tables = Array.from(el.querySelectorAll("table"));
    model.panes.forEach((pane, n) => {
      const off = tables[n].querySelector('[data-unit-mark="off"]') as HTMLElement;
      const def = tables[n].querySelector('[data-unit-mark="def"]') as HTMLElement;
      expect(off.getAttribute("class")).toMatch(/\brounded-full\b/);
      expect(off.style.backgroundColor).toBeTruthy();
      expect(off.getAttribute("style")!.toUpperCase()).toContain(pane.offColor);
      expect(def.getAttribute("class")).not.toMatch(/rounded-full/);
      expect(def.getAttribute("style")!.toUpperCase()).toContain(pane.defColor);
      expect(def.getAttribute("class")).toMatch(/\bbg-white\b/);
    });
    // A team's mark is the same colour in both tables.
    expect(model.panes[0].offColor).toBe(model.panes[1].defColor);
  });

  it("a missing spoke's cell is a dash, and the rest of the table stands", async () => {
    vi.mocked(loadMatchup).mockImplementation(async (a, h) => cardLoad(a, h, { rows: rowsMissingSpokes("BUF") }));
    const el = await html("BUF", "LA");
    const table = el.querySelector('table[data-pane-table="0"]')!;
    expect(txt(table.querySelector('tr[data-spoke="to"] td'))).toBe("—");
    expect(txt(table.querySelector('tr[data-spoke="stuff"] td'))).toBe("—");
    expect(txt(table.querySelector('tr[data-spoke="sack"] td'))).toMatch(/% · /);
    expect(el.querySelectorAll("table tbody tr")).toHaveLength(14);
  });

  it("one pane that cannot be drawn: its sentence where its table would be; the other pane keeps its table", async () => {
    vi.mocked(loadMatchup).mockImplementation(async (a, h) => cardLoad(a, h, { rows: rowsUndrawn("BUF") }));
    const el = await html("BUF", "LA");
    const tables = Array.from(el.querySelectorAll("table"));
    expect(tables.map((t) => t.getAttribute("data-pane-table"))).toEqual(["1"]);
    const slots = Array.from(el.querySelector("[data-matchup-card-tables]")!.children);
    expect(slots).toHaveLength(2);
    expect(txt(slots[0].querySelector("[data-pane-message]"))).toBe(MATCHUP_NO_OVERLAY_NOTE);
    expect(txt(slots[0])).toContain("BUF offense over LA defense");
    expect(slots[1].querySelector("table")).not.toBeNull();
    expect(el.querySelector("[data-radar-actions]")).not.toBeNull();
  });

  it("plain markup: ink text, tabular numbers, the two value columns never wrap, no red, no overflow wrapper, no client code", async () => {
    const el = await html("BUF", "LA");
    const block = el.querySelector("[data-matchup-card-tables]")!;
    const all = [block, ...Array.from(block.querySelectorAll("*"))];
    for (const node of all) {
      const cls = node.getAttribute("class") ?? "";
      expect(cls, cls).not.toMatch(/red-\d00/);
      expect(cls, cls).not.toMatch(/overflow-/);
    }
    for (const table of Array.from(block.querySelectorAll("table"))) {
      const cls = table.getAttribute("class") ?? "";
      expect(cls).toMatch(/\bw-full\b/);
      expect(cls).toMatch(/\btext-slate-900\b/);
      expect(cls).toMatch(/\btabular-nums\b/);
      expect(cls).toMatch(/\btext-\[13px\]/);
      expect(cls).toMatch(/\bsm:text-\[14px\]/);
      expect(table.querySelector("caption")!.getAttribute("class")).toMatch(/text-left.*font-semibold|font-semibold.*text-left/);
      for (const td of Array.from(table.querySelectorAll("tbody td"))) {
        expect(td.getAttribute("class")).toMatch(/\bwhitespace-nowrap\b/);
        expect(td.getAttribute("class")).toMatch(/\bpx-1\.5\b/);
        expect(td.getAttribute("class")).toMatch(/\bsm:px-2\b/);
      }
      // The name column may wrap: it is the only one without nowrap.
      for (const th of Array.from(table.querySelectorAll("tbody th"))) expect(th.getAttribute("class")).not.toMatch(/whitespace-nowrap/);
    }
    expect(block.getAttribute("class")).toMatch(/\bmd:grid-cols-2\b/);
    expect(block.querySelectorAll("button, script")).toHaveLength(0);
  });
});

describe("message states (§7): HTTP 200, the sentence, the links; no picture, no buttons, no table", () => {
  const expectMessagePage = (el: HTMLElement, sentence: string) => {
    expect(txt(el.querySelector("h1"))).toMatch(/: matchup card, \d{4}$/);
    expect(el.querySelector("h1")?.getAttribute("class")).not.toBe("sr-only");
    expect(txt(el.querySelector("[data-card-message]"))).toBe(sentence);
    for (const s of ["table", "img", "button", "[data-radar-actions]", "[data-matchup-card-image]", "[data-rank-note]", "svg"]) {
      expect(el.querySelector(s), s).toBeNull();
    }
    expect(el.querySelector("[data-full-matchup]")).not.toBeNull();
    expect(el.querySelectorAll("[data-team-link]")).toHaveLength(2);
  };

  it("small-pool: the page's own sentence", async () => {
    vi.mocked(loadMatchup).mockImplementation(async (a, h) => cardLoad(a, h, { rows: ROWS_SMALL_POOL }));
    expectMessagePage(await html("BUF", "HOU"), MATCHUP_SMALL_POOL_NOTE);
  });

  it("neither radar can be drawn: the overlay sentence", async () => {
    vi.mocked(loadMatchup).mockImplementation(async (a, h) => cardLoad(a, h, { rows: rowsUndrawn("BUF", "HOU") }));
    expectMessagePage(await html("BUF", "HOU"), MATCHUP_NO_OVERLAY_NOTE);
  });

  it("uncovered: the heading sentence, and the matchup page's 'See AWAY and HOME in {default}' link, to this card in the newest season", async () => {
    vi.mocked(loadMatchup).mockResolvedValue(uncovered());
    const el = await html("BUF", "LA", { season: "2025" });
    expectMessagePage(el, "Team matchups start with the 2026 season");
    const link = el.querySelector("[data-default-season-link]")!;
    expect([link.getAttribute("href"), txt(link), link.getAttribute("data-prefetch")]).toEqual(["/card/matchup/BUF/LA", "See BUF and LA in 2026", "false"]);
    expect(txt(el.querySelector("h1"))).toBe("Buffalo Bills vs Los Angeles Rams: matchup card, 2025");
    expect(el.querySelector("[data-full-matchup]")?.getAttribute("href")).toBe("/matchup/BUF/LA?season=2025");
  });

  it("only the uncovered page has that link", async () => {
    vi.mocked(loadMatchup).mockImplementation(async (a, h) => cardLoad(a, h, { rows: ROWS_SMALL_POOL }));
    expect((await html("BUF", "HOU")).querySelector("[data-default-season-link]")).toBeNull();
  });

  it("the games could not be read (any state): K11 and a link to the matchup page; never a card that says VS", async () => {
    vi.mocked(loadMatchup).mockImplementation(async (a, h) => cardLoad(a, h, { game: null, records: null, gamesAvailable: false }));
    const el = await html("BUF", "LA");
    expectMessagePage(el, MATCHUP_CARD_UNAVAILABLE);
    expect(txt(el.querySelector("[data-card-message]"))).toBe("The matchup card is unavailable right now. Try again in a few minutes.");
    expect(el.querySelector("[data-full-matchup]")?.getAttribute("href")).toBe("/matchup/BUF/LA");
    vi.mocked(loadMatchup).mockResolvedValue(uncovered({ gamesAvailable: false, records: null }));
    expectMessagePage(await html("BUF", "LA", { season: "2025" }), MATCHUP_CARD_UNAVAILABLE);
  });
});

describe("generateMetadata (§8.1)", () => {
  it("a card: the absolute title K1, K2, noindex, canonical = og:url = this page, the image with season and week, the short preview title", async () => {
    const meta = await md("BUF", "LA");
    expect(meta.title).toEqual({ absolute: "Buffalo Bills at Los Angeles Rams: Matchup Card 2026 — Yards Per Pass" });
    expect(meta.description).toBe(
      "BUF offense over the LA defense and LA offense over the BUF defense, by league rank through Week 3: the rate and the rank for seven stats.",
    );
    expect(meta.robots).toEqual({ index: false, follow: true });
    expect(meta.alternates?.canonical).toBe(`${BASE}/card/matchup/BUF/LA`);
    expect(meta.openGraph).toMatchObject({
      title: "Buffalo Bills at Los Angeles Rams", description: meta.description, url: `${BASE}/card/matchup/BUF/LA`, type: "website",
    });
    expect(ogImage(meta)).toEqual({
      url: `${BASE}/api/matchup-card/BUF/LA?season=2026&w=3`, width: 1200, height: 630, alt: "Buffalo Bills at Los Angeles Rams matchup card, 2026",
    });
    expect(meta.twitter).toEqual({
      card: "summary_large_image", title: "Buffalo Bills at Los Angeles Rams", description: meta.description,
      images: [`${BASE}/api/matchup-card/BUF/LA?season=2026&w=3`],
    });
  });

  it("ball and other keys change nothing; a real past season has a URL of its own", async () => {
    expect((await md("BUF", "LA", { ball: "home", x: "1" })).alternates?.canonical).toBe(`${BASE}/card/matchup/BUF/LA`);
    expect((await md("BUF", "LA", { season: "2026" })).alternates?.canonical).toBe(`${BASE}/card/matchup/BUF/LA`);
    vi.mocked(loadMatchup).mockImplementation(async (a, h) => cardLoad(a, h, { season: 2025, defaultSeason: 2026, isLatestSeason: false }));
    const past = await md("BUF", "LA", { season: "2025" });
    expect(past.alternates?.canonical).toBe(`${BASE}/card/matchup/BUF/LA?season=2025`);
    expect(past.openGraph?.url).toBe(`${BASE}/card/matchup/BUF/LA?season=2025`);
    expect(ogImage(past)?.url).toBe(`${BASE}/api/matchup-card/BUF/LA?season=2025&w=3`);
    expect(past.title).toEqual({ absolute: "Buffalo Bills at Los Angeles Rams: Matchup Card 2025 — Yards Per Pass" });
  });

  it("no game: 'vs' in both titles and the alt; a week outside 1-22: no w on the image and no week in the description", async () => {
    vi.mocked(loadMatchup).mockImplementation(async (a, h) => cardLoad(a, h, { game: null }));
    const meta = await md("KC", "TB");
    expect(meta.title).toEqual({ absolute: "Kansas City Chiefs vs Tampa Bay Buccaneers: Matchup Card 2026 — Yards Per Pass" });
    expect(meta.openGraph?.title).toBe("Kansas City Chiefs vs Tampa Bay Buccaneers");
    expect(ogImage(meta)?.alt).toBe("Kansas City Chiefs vs Tampa Bay Buccaneers matchup card, 2026");
    vi.mocked(loadMatchup).mockImplementation(async (a, h) => {
      const l = cardLoad(a, h);
      return { ...l, model: { ...(l.model as MatchupModel), throughWeek: 23 } } as never;
    });
    const odd = await md("BUF", "LA");
    expect(ogImage(odd)?.url).toBe(`${BASE}/api/matchup-card/BUF/LA?season=2026`);
    expect(odd.description).toBe("BUF offense over the LA defense and LA offense over the BUF defense, by league rank: the rate and the rank for seven stats.");
  });

  it("NEXT_PUBLIC_SITE_URL is the base of every absolute URL", async () => {
    process.env.NEXT_PUBLIC_SITE_URL = "https://preview.example";
    const meta = await md("BUF", "LA");
    expect(meta.alternates?.canonical).toBe("https://preview.example/card/matchup/BUF/LA");
    expect(meta.openGraph?.url).toBe("https://preview.example/card/matchup/BUF/LA");
    expect(ogImage(meta)?.url).toBe("https://preview.example/api/matchup-card/BUF/LA?season=2026&w=3");
  });

  it("a plate state: title K1, the sentence as the description, and the image (the route draws the plate)", async () => {
    vi.mocked(loadMatchup).mockImplementation(async (a, h) => cardLoad(a, h, { rows: ROWS_SMALL_POOL }));
    const small = await md("BUF", "HOU");
    expect(small.title).toEqual({ absolute: "Buffalo Bills at Houston Texans: Matchup Card 2026 — Yards Per Pass" });
    expect(small.description).toBe(MATCHUP_SMALL_POOL_NOTE);
    expect(small.robots).toEqual({ index: false, follow: true });
    expect(ogImage(small)?.url).toBe(`${BASE}/api/matchup-card/BUF/HOU?season=2026&w=1`);
    vi.mocked(loadMatchup).mockResolvedValue(uncovered());
    const un = await md("BUF", "LA", { season: "2025" });
    expect(un.description).toBe("Team matchups start with the 2026 season");
    expect(ogImage(un)?.url).toBe(`${BASE}/api/matchup-card/BUF/LA?season=2025`);
    expect(un.alternates?.canonical).toBe(`${BASE}/card/matchup/BUF/LA?season=2025`);
  });

  it("the games could not be read: title K1, description K11, and NO image (the image route would answer 503)", async () => {
    vi.mocked(loadMatchup).mockImplementation(async (a, h) => cardLoad(a, h, { game: null, records: null, gamesAvailable: false }));
    const meta = await md("BUF", "LA");
    expect(meta.title).toEqual({ absolute: "Buffalo Bills vs Los Angeles Rams: Matchup Card 2026 — Yards Per Pass" });
    expect(meta.description).toBe(MATCHUP_CARD_UNAVAILABLE);
    expect(meta.robots).toEqual({ index: false, follow: true });
    expect(meta.openGraph?.images).toBeUndefined();
    expect(meta.twitter?.images).toBeUndefined();
    expect(JSON.stringify(meta)).not.toContain("/api/matchup-card/");
  });
});

describe("the two levels above the page name no card", () => {
  it("/card/matchup and /card/matchup/BUF are real 404s with no read (else they fall through to the player card route and read)", () => {
    expect(() => NoTeamPage()).toThrow("NEXT_NOT_FOUND");
    expect(() => OneTeamPage()).toThrow("NEXT_NOT_FOUND");
    expect(loadMatchup).not.toHaveBeenCalled();
    expect(getSeasonWeeksCached).not.toHaveBeenCalled();
    for (const rel of [["app", "card", "matchup", "page.tsx"], ["app", "card", "matchup", "[away]", "page.tsx"]]) {
      const source = readFileSync(join(process.cwd(), ...rel), "utf8");
      const specs = Array.from(source.matchAll(/from\s+["']([^"']+)["']/g)).map((m) => m[1]);
      expect(specs).toEqual(["next/navigation"]);
    }
  });
});

describe("a played game and a game line", () => {
  it("the page does not print the game line itself: the picture carries it, and its alt text names the pair", async () => {
    vi.mocked(loadMatchup).mockImplementation(async (a, h) => cardLoad(a, h, { game: cardGame(a, h, { away_score: 24, home_score: 16 }) }));
    const el = await html("TB", "DAL");
    expect(el.querySelector("h1")?.textContent).toBe("Tampa Bay Buccaneers at Dallas Cowboys: matchup card, 2026");
    expect(el.querySelectorAll("table")).toHaveLength(2);
  });
});
