import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor, act, cleanup } from "@testing-library/react";

// Compare card spec 2026-10-09, PR 3: the entry points on /compare.
//   - the Share block under the radar ("Share this comparison": Copy Link,
//     Download Image, Open share card), shown exactly when the pair has a share
//     card;
//   - the sentence that says why nothing is compared when a chosen player has
//     no stats for the season (the page used to show nothing at all).

let params = new URLSearchParams();
vi.mock("next/navigation", () => ({
  useSearchParams: () => params,
  useRouter: () => ({ replace: () => undefined }),
  usePathname: () => "/compare",
}));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

type Result = { data: unknown; error: unknown };
let tables: Record<string, Result> = {};
vi.mock("@/lib/supabase/client", () => ({
  getSupabaseClient: () => ({
    from: (table: string) => {
      const builder: Record<string, unknown> = {};
      for (const m of ["select", "ilike", "order", "limit", "eq", "in"]) builder[m] = () => builder;
      builder.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
        Promise.resolve(tables[table] ?? { data: [], error: null }).then(res, rej);
      return builder;
    },
  }),
}));

import ComparisonTool from "@/components/compare/ComparisonTool";
import type { QBSeasonStat, ReceiverSeasonStat, RBSeasonStat } from "@/lib/types";
// Real 2026 season rows through Week 4 (see the file's _provenance line).
import rowsJson from "../stats/fixtures/compare-2026-w4-rows.json";

type Row = Record<string, unknown>;
const QB = rowsJson.qb as Row[];
const REC = rowsJson.receivers as Row[];
const RB = rowsJson.rb as Row[];

type Slug = { player_id: string; slug: string; player_name: string; position: string; current_team_id: string };
const P = (slug: string, player_id: string, player_name: string, position: string, team: string): Slug =>
  ({ slug, player_id, player_name, position, current_team_id: team });
const ALLEN = P("josh-allen", "00-0034857", "Josh Allen", "QB", "BUF");
const STAFFORD = P("matthew-stafford", "00-0026498", "Matthew Stafford", "QB", "LA");
const HUNTLEY = P("tyler-huntley", "00-0035993", "Tyler Huntley", "QB", "BAL");
const LAMB = P("ceedee-lamb", "00-0036358", "CeeDee Lamb", "WR", "DAL");
const MCBRIDE = P("trey-mcbride", "00-0037744", "Trey McBride", "TE", "ARI");
const ROOKIE = P("rookie-qb", "00-0099999", "Rookie Quarterback", "QB", "NYJ");
const ROOKIE2 = P("other-rookie", "00-0099998", "Other Rookie", "QB", "NYG");
// A running back who also has a row in the receiver table (A.Jones, MIN).
const JONES_RB = P("aaron-jones", REC.find((r) => r.player_name === "A.Jones" && r.team_id === "MIN")!.player_id as string, "Aaron Jones", "RB", "MIN");

const SHARE = "Share this comparison";
const share = (el: HTMLElement) => el.querySelector("[data-compare-share]") as HTMLElement | null;
const txt = (el: Element | null) => el?.textContent ?? "";

interface Opts { qb?: Row[]; receivers?: Row[]; rb?: Row[]; season?: number; defaultSeason?: number; siteUrl?: string; wait?: "table" | "none" }
async function show(p1: Slug | null, p2: Slug | null, o: Opts = {}) {
  cleanup(); // one tool on the page at a time; an earlier container keeps its content for reading
  params = new URLSearchParams([...(p1 ? [["p1", p1.slug]] : []), ...(p2 ? [["p2", p2.slug]] : [])]);
  tables.player_slugs = { data: [p1, p2].filter(Boolean), error: null };
  const view = render(
    <ComparisonTool
      qbs={(o.qb ?? []) as unknown as QBSeasonStat[]}
      receivers={(o.receivers ?? []) as unknown as ReceiverSeasonStat[]}
      rbs={(o.rb ?? []) as unknown as RBSeasonStat[]}
      season={o.season ?? 2026}
      defaultSeason={o.defaultSeason ?? 2026}
      siteUrl={o.siteUrl ?? "https://yardsperpass.com"}
    />,
  );
  if (o.wait !== "none") await screen.findByRole("table", {}, { timeout: 3000 });
  else await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
  return view.container;
}

const writeText = vi.fn();
beforeEach(() => {
  params = new URLSearchParams();
  tables = {};
  writeText.mockReset();
  writeText.mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("the Share block on /compare", () => {
  it("two players with stats: the heading, Copy Link, Download Image and a link to the share card, in the order the visitor chose", async () => {
    const el = await show(ALLEN, STAFFORD, { qb: QB });
    const block = share(el)!;
    expect(block).not.toBeNull();
    expect(txt(block.querySelector("[data-compare-share-heading]"))).toBe(SHARE);
    expect(Array.from(block.querySelectorAll("button")).map(txt)).toEqual(["Copy Link", "Download Image"]);
    const open = block.querySelector("a")!;
    expect(txt(open)).toBe("Open share card →");
    expect(open.getAttribute("href")).toBe("/card/compare/josh-allen/matthew-stafford");
    expect(block.getAttribute("data-share-url")).toBe("https://yardsperpass.com/card/compare/josh-allen/matthew-stafford");
    expect(block.getAttribute("data-download-href")).toBe("/api/compare-card/josh-allen/matthew-stafford?season=2026&download=1");
  });

  it("the other order is the other card", async () => {
    const block = share(await show(STAFFORD, ALLEN, { qb: QB }))!;
    expect(block.getAttribute("data-share-url")).toBe("https://yardsperpass.com/card/compare/matthew-stafford/josh-allen");
    expect(block.querySelector("a")!.getAttribute("href")).toBe("/card/compare/matthew-stafford/josh-allen");
    expect(block.getAttribute("data-download-href")).toBe("/api/compare-card/matthew-stafford/josh-allen?season=2026&download=1");
  });

  it("it sits under the radar and its sentences, above the stat table", async () => {
    const el = await show(HUNTLEY, ALLEN, { qb: QB });
    const all = txt(el);
    expect(all.indexOf("Small sample:")).toBeGreaterThan(-1);
    expect(all.indexOf("Small sample:")).toBeLessThan(all.indexOf(SHARE));
    expect(all.indexOf(SHARE)).toBeLessThan(all.indexOf("Pass Yds"));
    const table = el.querySelector("table")!;
    expect(share(el)!.compareDocumentPosition(table) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("Copy Link copies the ABSOLUTE share page address built from the site URL the server passed, and says Copied!", async () => {
    const el = await show(ALLEN, STAFFORD, { qb: QB, siteUrl: "https://preview.example" });
    fireEvent.click(screen.getByText("Copy Link"));
    await screen.findByText("Copied!");
    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText).toHaveBeenCalledWith("https://preview.example/card/compare/josh-allen/matthew-stafford");
    expect(share(el)!.getAttribute("data-share-url")).toBe("https://preview.example/card/compare/josh-allen/matthew-stafford");
  });

  it("when nothing reaches the clipboard it says so, and never says Copied!", async () => {
    writeText.mockRejectedValue(new Error("NotAllowedError"));
    (document as unknown as { execCommand: () => boolean }).execCommand = () => false;
    await show(ALLEN, STAFFORD, { qb: QB });
    fireEvent.click(screen.getByText("Copy Link"));
    await screen.findByText("Copy failed: open the share card and copy its address");
    expect(screen.queryByText("Copied!")).toBeNull();
  });

  it("Download Image opens the image route with download=1", async () => {
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    await show(ALLEN, STAFFORD, { qb: QB });
    fireEvent.click(screen.getByText("Download Image"));
    expect(open).toHaveBeenCalledWith("/api/compare-card/josh-allen/matthew-stafford?season=2026&download=1", "_blank");
  });

  it("a past season: ?season= on the share link, the card link and the download; the newest season stays bare", async () => {
    const block = share(await show(ALLEN, STAFFORD, { qb: QB, season: 2025, defaultSeason: 2026 }))!;
    expect(block.getAttribute("data-share-url")).toBe("https://yardsperpass.com/card/compare/josh-allen/matthew-stafford?season=2025");
    expect(block.querySelector("a")!.getAttribute("href")).toBe("/card/compare/josh-allen/matthew-stafford?season=2025");
    expect(block.getAttribute("data-download-href")).toBe("/api/compare-card/josh-allen/matthew-stafford?season=2025&download=1");
  });

  it("shown for every pair that has a card: a WR against a TE, a player under the line, and too few qualified players (the card still has the table and the sentence)", async () => {
    const wrTe = await show(LAMB, MCBRIDE, { receivers: REC });
    expect(share(wrTe)!.getAttribute("data-share-url")).toBe("https://yardsperpass.com/card/compare/ceedee-lamb/trey-mcbride");
    const low = await show(HUNTLEY, ALLEN, { qb: QB });
    expect(share(low)).not.toBeNull();
    const fewRows = QB.filter((r) => ["J.Allen", "T.Huntley"].includes(r.player_name as string));
    const few = await show(ALLEN, HUNTLEY, { qb: fewRows });
    expect(txt(few)).toContain("Not enough qualified quarterbacks to draw the radar");
    expect(share(few)).not.toBeNull();
  });
});

describe("no Share block when there is no card to share", () => {
  it("nobody chosen, or one player", async () => {
    expect(share(await show(null, null, { wait: "none" }))).toBeNull();
    expect(share(await show(ALLEN, null, { qb: QB, wait: "none" }))).toBeNull();
  });

  it("a player with no stats for the season", async () => {
    const el = await show(ALLEN, ROOKIE, { qb: QB, wait: "none" });
    expect(share(el)).toBeNull();
    expect(txt(el)).not.toContain(SHARE);
  });

  it("two players the tool can show side by side but whose positions are different groups (a hand-typed link): the comparison shows, the block does not (that card is a 404)", async () => {
    const el = await show(LAMB, JONES_RB, { receivers: REC });
    expect(el.querySelector("table")).not.toBeNull();
    expect(share(el)).toBeNull();
  });

  it("a slug the share URL grammar would refuse", async () => {
    const odd = { ...STAFFORD, slug: "Matthew.Stafford" };
    const el = await show(ALLEN, odd, { qb: QB });
    expect(el.querySelector("table")).not.toBeNull();
    expect(share(el)).toBeNull();
  });
});

describe("a chosen player with no stats: /compare says so (it used to show nothing)", () => {
  const sentence = (el: HTMLElement) => txt(el.querySelector("[data-compare-no-stats]"));

  it("one player, the newest season", async () => {
    const el = await show(ALLEN, ROOKIE, { qb: QB, wait: "none" });
    expect(sentence(el)).toBe("Rookie Quarterback has no 2026 stats yet, so there is nothing to compare. Comparisons update the day after each game.");
    expect(el.querySelector("table")).toBeNull();
    const first = await show(ROOKIE, ALLEN, { qb: QB, wait: "none" });
    expect(sentence(first)).toBe("Rookie Quarterback has no 2026 stats yet, so there is nothing to compare. Comparisons update the day after each game.");
  });

  it("both players", async () => {
    const el = await show(ROOKIE, ROOKIE2, { qb: QB, wait: "none" });
    expect(sentence(el)).toBe("Rookie Quarterback and Other Rookie have no 2026 stats yet, so there is nothing to compare. Comparisons update the day after each game.");
  });

  it("a past season makes no promise", async () => {
    const el = await show(ALLEN, ROOKIE, { qb: QB, season: 2025, defaultSeason: 2026, wait: "none" });
    expect(sentence(el)).toBe("Rookie Quarterback has no stats for the 2025 season, so there is nothing to compare.");
  });

  it("not while the season table is still on its way, and not when it failed to load (that has its own sentence)", async () => {
    // The server sent no table and the browser's read answers with no rows yet.
    const loading = await show(ALLEN, ROOKIE, { wait: "none" });
    expect(loading.querySelector("[data-compare-no-stats]")).toBeNull();
    tables.qb_season_stats = { data: null, error: { message: "TypeError: Failed to fetch" } };
    const failed = await show(ALLEN, ROOKIE, { wait: "none" });
    await waitFor(() => expect(txt(failed)).toContain("Couldn't load stats for this comparison."));
    expect(failed.querySelector("[data-compare-no-stats]")).toBeNull();
  });

  it("not for two players of different position groups (the missing row there means 'wrong table', not 'no stats')", async () => {
    const el = await show(ALLEN, LAMB, { qb: QB, wait: "none" });
    expect(el.querySelector("[data-compare-no-stats]")).toBeNull();
    expect(share(el)).toBeNull();
  });

  it("not when both have stats, and not for the same player twice", async () => {
    expect((await show(ALLEN, STAFFORD, { qb: QB })).querySelector("[data-compare-no-stats]")).toBeNull();
    const same = await show(ALLEN, { ...ALLEN, slug: "josh-allen-2" }, { qb: QB, wait: "none" });
    expect(same.querySelector("[data-compare-no-stats]")).toBeNull();
  });
});
