// The team radar share pages, /card/team/[team_id]/[side] (team radar spec
// 2026-10-06 §7-§8, PR 3; decision J6: one page per side). Covers route
// validation (junk never reads), every state, the metadata (canonical, and
// the explicit preview image URL that carries the season), and the two
// levels above the page that must stay 404s.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent, act } from "@testing-library/react";
import { existsSync } from "node:fs";
import { join } from "node:path";
import rowsJson from "../stats/fixtures/team-radar-2026-w1-3.json";
import { TooltipProvider } from "@/components/ui/tooltip";

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
vi.mock("@/lib/data/queries", () => ({ getAvailableSeasons: vi.fn(), fallbackSeason: () => 2026 }));
vi.mock("@/lib/data/team-radar", () => ({ getTeamRadarRows: vi.fn() }));
vi.mock("@/lib/data/box-score", () => ({ getBoxScoreSeasonsCached: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ hasNoDatabase: vi.fn(() => false) }));

import { notFound } from "next/navigation";
import SharePage, { generateMetadata } from "@/app/card/team/[team_id]/[side]/page";
import TeamRadarActions from "@/app/card/team/[team_id]/[side]/TeamRadarActions";
import NoSidePage from "@/app/card/team/[team_id]/page";
import NoTeamPage from "@/app/card/team/page";
import { getAvailableSeasons } from "@/lib/data/queries";
import { getTeamRadarRows } from "@/lib/data/team-radar";
import { getBoxScoreSeasonsCached } from "@/lib/data/box-score";
import { hasNoDatabase } from "@/lib/supabase/server";
import { clearTeamRadarCardMemo } from "@/lib/data/team-radar-card";
import { getTeam } from "@/lib/data/teams";
import * as R from "@/lib/stats/team-radar";
import { RADAR_AXES, teamRadarSlice } from "@/lib/stats/team-radar";

type Row = Record<string, unknown>;
const ROWS = rowsJson as Row[];
const SEASONS = [2026, 2025, 2024];
const BASE = "https://yardsperpass.com";
const FAILED = new Error("Failed to fetch team radar rows for 2026: TypeError: fetch failed");

const args = (team_id: string, side: string, season?: string) => ({
  params: Promise.resolve({ team_id, side }),
  searchParams: Promise.resolve(season === undefined ? {} : { season }),
});
const renderPage = async (team_id: string, side: string, season?: string) =>
  render(<TooltipProvider>{await SharePage(args(team_id, side, season))}</TooltipProvider>).container;
/** The page body alone, as its own request. */
const page = (team_id: string, side: string, season?: string) => {
  newRequest();
  return renderPage(team_id, side, season);
};
/** The metadata alone, as its own request. */
const md = (team_id: string, side: string, season?: string) => {
  newRequest();
  return generateMetadata(args(team_id, side, season));
};
/** One real page view: Next runs generateMetadata, then the page, in the same request. `between` runs in the gap. */
async function request(team_id: string, side: string, season: string | undefined, between: () => void = () => {}) {
  newRequest();
  const meta = await generateMetadata(args(team_id, side, season));
  between();
  const el = await renderPage(team_id, side, season);
  return { meta, el };
}
const noRead = () => {
  expect(getAvailableSeasons).not.toHaveBeenCalled();
  expect(getBoxScoreSeasonsCached).not.toHaveBeenCalled();
  expect(getTeamRadarRows).not.toHaveBeenCalled();
};
const ogImage = (meta: Awaited<ReturnType<typeof md>>) => {
  const images = meta.openGraph?.images as { url: string; width: number; height: number; alt: string }[];
  return images[0];
};
const bufSlice = () => {
  const s = teamRadarSlice({ teamId: "BUF", season: 2026, rows: ROWS, newestSeason: 2026, covered: [2026] });
  if (s.state !== "ready") throw new Error(s.state);
  return s;
};

beforeEach(() => {
  newRequest();
  clearTeamRadarCardMemo();
  vi.mocked(notFound).mockClear();
  vi.mocked(getAvailableSeasons).mockReset();
  vi.mocked(getTeamRadarRows).mockReset();
  vi.mocked(getBoxScoreSeasonsCached).mockReset();
  vi.mocked(hasNoDatabase).mockReturnValue(false);
  vi.mocked(getAvailableSeasons).mockResolvedValue(SEASONS);
  vi.mocked(getTeamRadarRows).mockResolvedValue(ROWS as never[]);
  vi.mocked(getBoxScoreSeasonsCached).mockResolvedValue([2026]);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("route validation: junk is a 404 before any database read", () => {
  it.each([
    ["BUF", "sideways"],
    ["BUF", "Offense"],
    ["BUF", "DEFENSE"],
    ["BUF", "off"],
    ["BUF", ""],
    ["BUF", "offense%20"],
    ["XXX", "offense"],
    ["", "offense"],
    ["buffalo", "defense"],
    ["BU F", "offense"],
    ["<script>", "offense"],
    // Chaos N3: letters that only upper-case INTO ASCII (long s, dotless i) are not a team.
    ["\u017Ff", "offense"],
    ["p\u0131t", "defense"],
    ["BUFF", "offense"],
  ])("/card/team/%s/%s", async (team, side) => {
    await expect(SharePage(args(team, side))).rejects.toThrow("NEXT_NOT_FOUND");
    expect((await generateMetadata(args(team, side))).title).toEqual({ absolute: "Team Radar Not Found — Yards Per Pass" });
    noRead();
  });

  it("the metadata of a junk URL reads nothing either, and is noindex", async () => {
    for (const [team, side] of [["BUF", "sideways"], ["XXX", "offense"], ["BUF", "Offense"]]) {
      const meta = await md(team, side);
      expect(meta.title).toEqual({ absolute: "Team Radar Not Found — Yards Per Pass" });
      expect(meta.robots).toEqual({ index: false, follow: true });
      expect(meta.openGraph).toBeUndefined();
    }
    noRead();
  });

  it("a lower-case team id is the same team (as on the team page); its canonical is the upper-case URL", async () => {
    const el = await page("buf", "offense");
    expect(el.querySelector("[data-radar-card]")).not.toBeNull();
    expect((await md("buf", "offense")).alternates?.canonical).toBe(`${BASE}/card/team/BUF/offense`);
  });

  it("/card/team/BUF (no side) and /card/team are 404s that read nothing", () => {
    expect(() => NoSidePage()).toThrow("NEXT_NOT_FOUND");
    expect(() => NoTeamPage()).toThrow("NEXT_NOT_FOUND");
    noRead();
    // No other page file may appear at those two levels.
    const app = join(__dirname, "..", "..", "app", "card", "team");
    expect(existsSync(join(app, "page.tsx"))).toBe(true);
    expect(existsSync(join(app, "[team_id]", "page.tsx"))).toBe(true);
    expect(existsSync(join(app, "[team_id]", "[side]", "opengraph-image.tsx"))).toBe(false);
  });
});

describe("season (?season=)", () => {
  it("no season: the newest; one read of the season's rows", async () => {
    const el = await page("BUF", "offense");
    expect(el.querySelector("[data-radar-card-band]")!.textContent).toContain("2026");
    expect(vi.mocked(getTeamRadarRows).mock.calls).toEqual([[2026]]);
  });

  it.each(["2099", "2019", "99999999999999999999", "1998", "-5"])(
    "?season=%s (a season the site does not have) is a 404 with no row read",
    async (season) => {
      await expect(SharePage(args("BUF", "offense", season))).rejects.toThrow("NEXT_NOT_FOUND");
      expect(getTeamRadarRows).not.toHaveBeenCalled();
      expect(getBoxScoreSeasonsCached).not.toHaveBeenCalled();
    },
  );

  it("a non-numeric ?season= is ignored (the newest season)", async () => {
    const el = await page("BUF", "offense", "abc");
    expect(el.querySelector("[data-radar-card]")).not.toBeNull();
    expect(vi.mocked(getTeamRadarRows).mock.calls).toEqual([[2026]]);
  });

  it("an empty data_freshness list with a real database throws (the team page's rule), and reads no rows", async () => {
    vi.mocked(getAvailableSeasons).mockResolvedValue([]);
    await expect(SharePage(args("BUF", "offense"))).rejects.toThrow(/no seasons/);
    await expect(md("BUF", "offense")).rejects.toThrow(/no seasons/);
    expect(notFound).not.toHaveBeenCalled();
    expect(getTeamRadarRows).not.toHaveBeenCalled();
  });

  it("with no database at all (placeholder build) the page renders a message, not an error", async () => {
    vi.mocked(hasNoDatabase).mockReturnValue(true);
    vi.mocked(getAvailableSeasons).mockResolvedValue([]);
    vi.mocked(getTeamRadarRows).mockResolvedValue([]);
    const el = await page("BUF", "offense");
    expect(el.querySelector("[data-radar-message]")!.textContent).toBe("Team radars are not available for the 2026 season.");
  });
});

describe("ready: the card", () => {
  it("offense: team-colour band, one large radar, the stat table, the footer line", async () => {
    const el = await page("BUF", "offense");
    const buf = getTeam("BUF")!;
    const band = el.querySelector<HTMLElement>("[data-radar-card-band]")!;
    expect(band.textContent).toContain("Buffalo Bills");
    expect(band.textContent).toContain("Offense Radar · 2026 · Through Week 3");
    expect(band.style.backgroundColor).toBe("rgb(0, 51, 141)");
    expect(buf.primaryColor.toLowerCase()).toBe("#00338d");
    expect(band.style.borderBottom).toContain("4px solid");

    const svgs = el.querySelectorAll("[data-radar-card] svg[role='img']");
    expect(svgs).toHaveLength(1);
    expect(svgs[0].getAttribute("viewBox")).toBe("0 0 680 520");
    expect(svgs[0].getAttribute("aria-label")).toBe("Buffalo Bills offense radar");

    expect(Array.from(el.querySelectorAll("thead th")).map((th) => th.textContent)).toEqual([
      "What the offense did", "BUF", "Rank", "NFL avg",
    ]);
    expect(el.querySelectorAll("tbody tr")).toHaveLength(7);
    expect(el.querySelector("[data-radar-card-footer]")!.textContent).toBe(
      "Farther out = better rank among the 32 teams · dashed ring = middle of the league",
    );
    expect(el.querySelector("[data-radar-card-site]")!.textContent).toBe("YARDSPERPASS.COM · DATA: NFLVERSE");
  });

  it("the table prints the team page's numbers: value, rank and NFL average for every spoke", async () => {
    const el = await page("BUF", "offense");
    const s = bufSlice();
    Array.from(el.querySelectorAll("tbody tr")).forEach((tr, i) => {
      const cells = Array.from(tr.querySelectorAll("td")).map((td) => td.textContent ?? "");
      expect(cells[0]).toContain(RADAR_AXES[i].label);
      expect(cells[0]).toContain(RADAR_AXES[i].subline);
      expect(cells[1]).toBe(R.fmtRadarPct(s.off.spokes[i].value));
      expect(cells[2]).toBe(R.spokeRankLabel(s.off.spokes[i]));
      expect(cells[3]).toBe(R.fmtRadarPct(s.league[RADAR_AXES[i].key]));
    });
    const first = Array.from(el.querySelectorAll("tbody tr")[0].querySelectorAll("td")).map((td) => td.textContent);
    expect(first.slice(1)).toEqual(["10.7%", "2nd", "7.3%"]);
  });

  it("defense: its own page — Takeaway rate, the opponents' sub-line, the short table header", async () => {
    const el = await page("BUF", "defense");
    expect(el.querySelector("[data-radar-card-band]")!.textContent).toContain("Defense Radar · 2026 · Through Week 3");
    expect(el.querySelector("svg[role='img']")!.getAttribute("aria-label")).toBe("Buffalo Bills defense radar");
    expect(el.querySelector("thead th")!.textContent).toBe("What opponents did");
    const row = el.querySelectorAll("tbody tr")[3].textContent!;
    expect(row).toContain("Takeaway rate");
    expect(row).toContain("Opponent turnovers ÷ opponent drives");
    const s = bufSlice();
    const value = el.querySelectorAll("tbody tr")[0].querySelectorAll("td")[1].textContent;
    expect(value).toBe(R.fmtRadarPct(s.def.spokes[0].value));
  });

  it("the outline uses radarStrokeColor: PIT's gold primary draws in its dark secondary; the band keeps the gold", async () => {
    const el = await page("PIT", "offense");
    const pit = getTeam("PIT")!;
    const outline = el.querySelector("path[data-radar-outline]")!;
    expect(outline.getAttribute("stroke")).toBe(R.radarStrokeColor(pit.primaryColor, pit.secondaryColor));
    expect(outline.getAttribute("stroke")).toBe(pit.secondaryColor);
    expect(outline.getAttribute("fill")).toBe(`${pit.primaryColor}22`);
    const band = el.querySelector<HTMLElement>("[data-radar-card-band]")!;
    expect(band.style.color).toBe("rgb(15, 23, 42)");
  });

  it("Copy Link and Download Image, the other side's link and the team page link", async () => {
    const el = await page("BUF", "offense");
    const buttons = Array.from(el.querySelectorAll("[data-radar-actions] button")).map((b) => b.textContent);
    expect(buttons).toEqual(["Copy Link", "Download Image"]);
    const other = el.querySelector<HTMLAnchorElement>("a[data-radar-other-side]")!;
    expect(other.textContent).toBe("See the Buffalo Bills defense radar →");
    expect(other.getAttribute("href")).toBe("/card/team/BUF/defense");
    const back = el.querySelector<HTMLAnchorElement>("a[data-radar-team-page]")!;
    expect(back.textContent).toBe("View the full Buffalo Bills page →");
    expect(back.getAttribute("href")).toBe("/team/BUF#team-radar");
  });

  it("on a past season every link carries it", async () => {
    vi.mocked(getBoxScoreSeasonsCached).mockResolvedValue([2026, 2025]);
    vi.mocked(getTeamRadarRows).mockResolvedValue(ROWS.map((r) => ({ ...r, season: 2025 })) as never[]);
    const el = await page("BUF", "defense", "2025");
    expect(el.querySelector("[data-radar-card-band]")!.textContent).toContain("Defense Radar · 2025 · Through Week 3");
    expect(el.querySelector("a[data-radar-other-side]")!.getAttribute("href")).toBe("/card/team/BUF/offense?season=2025");
    expect(el.querySelector("a[data-radar-team-page]")!.getAttribute("href")).toBe("/team/BUF?season=2025#team-radar");
    expect(el.querySelector("[data-radar-actions]")!.getAttribute("data-page-path")).toBe("/card/team/BUF/defense?season=2025");
    expect(el.querySelector("[data-radar-actions]")!.getAttribute("data-download-href")).toBe(
      "/api/team-radar/BUF/defense?season=2025&download=1",
    );
  });

  it("a side with fewer than 4 real spokes: R20 and the table, no radar (the page is still the card)", async () => {
    const rows = ROWS.map((r) => ({ ...r, rush_plays: 0, designed_runs: 0, total_drives: 0, rush_success_rate: null, attempts: 0, sacks: 0 }));
    vi.mocked(getTeamRadarRows).mockResolvedValue(rows as never[]);
    const el = await page("BUF", "offense");
    expect(el.querySelector("[data-radar-card] svg[role='img']")).toBeNull();
    expect(el.querySelector("[data-radar-table-only]")!.textContent).toBe(
      "Not enough of these rates are available yet to draw the offense radar.",
    );
    expect(el.querySelectorAll("tbody tr")).toHaveLength(7);
  });

  it("prints no NaN, undefined, null or Infinity, and no literal escape, for any team on either side", async () => {
    for (const id of ["BUF", "PHI", "SF", "PIT"]) {
      for (const side of ["offense", "defense"]) {
        const el = await page(id, side);
        expect(el.textContent, `${id} ${side}`).not.toMatch(/NaN|undefined|null|Infinity/);
        expect(el.textContent).not.toMatch(/\\u[0-9a-fA-F]{4}/);
        const attrs: string[] = [];
        el.querySelectorAll("svg, svg *").forEach((n) => Array.from(n.attributes).forEach((a) => attrs.push(a.value)));
        expect(attrs.join("\n")).not.toMatch(/NaN|undefined|Infinity/);
      }
    }
  });
});

// Chaos W1: generateMetadata and the page used to load separately, so a
// refresh landing between the two could put 2026 in the title and 2027 in the
// band. One load per request now (React cache(), keyed on the team id and the
// season number asked for).
describe("one load per request: the title and the body can never disagree", () => {
  const band = (el: HTMLElement) => el.querySelector("[data-radar-card-band]")!.textContent!;

  it("one seasons read, one probe and one row read for a whole page view", async () => {
    await request("BUF", "offense", undefined);
    expect(getAvailableSeasons).toHaveBeenCalledTimes(1);
    expect(getBoxScoreSeasonsCached).toHaveBeenCalledTimes(1);
    expect(getTeamRadarRows).toHaveBeenCalledTimes(1);
  });

  it("the seasons list gains 2027 between the metadata and the body: both still say 2026", async () => {
    const { meta, el } = await request("BUF", "offense", undefined, () => {
      vi.mocked(getAvailableSeasons).mockResolvedValue([2027, 2026, 2025]);
      vi.mocked(getTeamRadarRows).mockResolvedValue(ROWS.map((r) => ({ ...r, season: 2027 })) as never[]);
      clearTeamRadarCardMemo();
    });
    expect(meta.title).toEqual({ absolute: "Buffalo Bills Offense Radar 2026 — Yards Per Pass" });
    expect(ogImage(meta).url).toBe(`${BASE}/api/team-radar/BUF/offense?season=2026&w=3`);
    expect(band(el)).toContain("Offense Radar · 2026 · Through Week 3");
    expect(el.querySelector("[data-radar-actions]")!.getAttribute("data-download-href")).toBe(
      "/api/team-radar/BUF/offense?season=2026&download=1",
    );
  });

  it("the rows gain a week between the metadata and the body (the one-minute memo rolled over): both still say Week 3", async () => {
    const { meta, el } = await request("BUF", "defense", undefined, () => {
      vi.mocked(getTeamRadarRows).mockResolvedValue([...ROWS, ...ROWS.map((r) => ({ ...r, week: 4, game_id: `${r.game_id}_w4` }))] as never[]);
      clearTeamRadarCardMemo();
    });
    expect(meta.description).toContain("through Week 3");
    expect(ogImage(meta).url).toBe(`${BASE}/api/team-radar/BUF/defense?season=2026&w=3`);
    expect(band(el)).toContain("Through Week 3");
    expect(el.textContent).not.toContain("Week 4");
  });

  it("the database fails between the two: the body still renders what the title described", async () => {
    const { el } = await request("BUF", "offense", undefined, () => {
      vi.mocked(getAvailableSeasons).mockRejectedValue(new Error("Failed to fetch seasons: TypeError: fetch failed"));
      vi.mocked(getTeamRadarRows).mockRejectedValue(FAILED);
      clearTeamRadarCardMemo();
    });
    expect(el.querySelector("[data-radar-card]")).not.toBeNull();
  });

  it("a failed load fails both halves of the request the same way, and the next request loads again", async () => {
    vi.mocked(getTeamRadarRows).mockRejectedValueOnce(FAILED);
    newRequest();
    await expect(generateMetadata(args("BUF", "offense"))).rejects.toThrow("Failed to fetch team radar rows");
    await expect(SharePage(args("BUF", "offense"))).rejects.toThrow("Failed to fetch team radar rows");
    const el = await page("BUF", "offense");
    expect(el.querySelector("[data-radar-card]")).not.toBeNull();
  });

  it("the next request sees the new data", async () => {
    await request("BUF", "offense", undefined);
    vi.mocked(getAvailableSeasons).mockResolvedValue([2027, 2026, 2025]);
    vi.mocked(getBoxScoreSeasonsCached).mockResolvedValue([2027, 2026]);
    vi.mocked(getTeamRadarRows).mockResolvedValue(ROWS.map((r) => ({ ...r, season: 2027 })) as never[]);
    clearTeamRadarCardMemo();
    const { meta, el } = await request("BUF", "offense", undefined);
    expect(meta.title).toEqual({ absolute: "Buffalo Bills Offense Radar 2027 — Yards Per Pass" });
    expect(band(el)).toContain("2027");
  });

  it("?season=2025 and ?season=2025abc are the same load; both sides and a lower-case id share it too", async () => {
    vi.mocked(getBoxScoreSeasonsCached).mockResolvedValue([2026, 2025]);
    vi.mocked(getTeamRadarRows).mockResolvedValue(ROWS.map((r) => ({ ...r, season: 2025 })) as never[]);
    newRequest();
    await generateMetadata(args("BUF", "offense", "2025"));
    await generateMetadata(args("BUF", "defense", "2025abc"));
    await generateMetadata(args("buf", "offense", "2025"));
    expect(getAvailableSeasons).toHaveBeenCalledTimes(1);
  });
});

describe("TeamRadarActions", () => {
  // Chaos N6: "Copied!" used to show even when nothing reached the clipboard.
  const noClipboard = () => Object.assign(navigator, { clipboard: { writeText: vi.fn(async () => Promise.reject(new Error("denied"))) } });
  const clickCopy = async (container: HTMLElement) => {
    const [copy] = Array.from(container.querySelectorAll("button"));
    await act(async () => {
      fireEvent.click(copy);
    });
    return copy;
  };

  it("the clipboard refuses and the old copy command works: Copied!", async () => {
    noClipboard();
    document.execCommand = vi.fn(() => true);
    const { container } = render(<TeamRadarActions pagePath="/card/team/BUF/offense" downloadHref="/x" />);
    const copy = await clickCopy(container);
    expect(document.execCommand).toHaveBeenCalledWith("copy");
    expect(copy.textContent).toBe("Copied!");
    expect(document.querySelectorAll("body > input")).toHaveLength(0);
  });

  it("the old copy command returns false (nothing was copied): says so, never Copied!", async () => {
    noClipboard();
    document.execCommand = vi.fn(() => false);
    const { container } = render(<TeamRadarActions pagePath="/card/team/BUF/offense" downloadHref="/x" />);
    const copy = await clickCopy(container);
    expect(copy.textContent).toBe("Copy failed: use the address bar");
    expect(document.querySelectorAll("body > input")).toHaveLength(0);
  });

  it("the old copy command throws, or is missing: the same sentence, and no stray input is left in the page", async () => {
    noClipboard();
    document.execCommand = vi.fn(() => {
      throw new Error("not supported");
    });
    const first = render(<TeamRadarActions pagePath="/card/team/BUF/offense" downloadHref="/x" />);
    expect((await clickCopy(first.container)).textContent).toBe("Copy failed: use the address bar");
    expect(document.querySelectorAll("body > input")).toHaveLength(0);

    (document as unknown as { execCommand?: unknown }).execCommand = undefined;
    const second = render(<TeamRadarActions pagePath="/card/team/BUF/offense" downloadHref="/x" />);
    expect((await clickCopy(second.container)).textContent).toBe("Copy failed: use the address bar");
    expect(document.querySelectorAll("body > input")).toHaveLength(0);
  });

  it("Copy Link copies this origin + the page path (bare for the default season) and says Copied!", async () => {
    const writeText = vi.fn(async () => {});
    Object.assign(navigator, { clipboard: { writeText } });
    const { container } = render(
      <TeamRadarActions pagePath="/card/team/BUF/offense" downloadHref="/api/team-radar/BUF/offense?season=2026&download=1" />,
    );
    const [copy] = Array.from(container.querySelectorAll("button"));
    await act(async () => {
      fireEvent.click(copy);
    });
    expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/card/team/BUF/offense`);
    expect(copy.textContent).toBe("Copied!");
  });

  it("Download Image opens the image route with download=1 for the page's season", () => {
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    const { container } = render(
      <TeamRadarActions pagePath="/card/team/BUF/defense?season=2025" downloadHref="/api/team-radar/BUF/defense?season=2025&download=1" />,
    );
    fireEvent.click(container.querySelectorAll("button")[1]);
    expect(open).toHaveBeenCalledWith("/api/team-radar/BUF/defense?season=2025&download=1", "_blank");
    open.mockRestore();
  });
});

describe("message states: HTTP 200, one sentence, no card, no image buttons", () => {
  const bare = (el: HTMLElement) => {
    expect(el.querySelector("[data-radar-card]")).toBeNull();
    expect(el.querySelector("svg[role='img']")).toBeNull();
    expect(el.querySelector("table")).toBeNull();
    expect(el.querySelectorAll("button")).toHaveLength(0);
    expect(el.textContent).not.toMatch(/Copy Link|Download Image/);
    expect(el.querySelector("a[data-radar-team-page]")).not.toBeNull();
  };
  const message = (el: HTMLElement) => el.querySelector("[data-radar-message]")?.textContent;

  it("no-games → R10, with a link to the team page", async () => {
    const eight = ROWS.filter((r) => r.week === 1 && r.team_id !== "KC" && r.opponent_id !== "KC").slice(0, 8);
    vi.mocked(getTeamRadarRows).mockResolvedValue(eight as never[]);
    const el = await page("KC", "offense");
    expect(message(el)).toBe("The Kansas City Chiefs have not played a 2026 game yet. Their radar appears after their first game.");
    expect(el.querySelector("a[data-radar-team-page]")!.getAttribute("href")).toBe("/team/KC#team-radar");
    bare(el);
  });

  it("small-pool → R11", async () => {
    vi.mocked(getTeamRadarRows).mockResolvedValue(ROWS.filter((r) => r.game_id === "2026_01_BUF_HOU") as never[]);
    const el = await page("BUF", "defense");
    expect(message(el)).toBe("Team radars start once 8 teams have played this season. Until then there are too few teams to rank against.");
    bare(el);
  });

  it("uncovered → R12 for a season before the first covered one, with no row read", async () => {
    const el = await page("BUF", "offense", "2025");
    expect(message(el)).toBe("Team radars start with the 2026 season.");
    expect(getTeamRadarRows).not.toHaveBeenCalled();
    bare(el);
    expect(el.querySelector("a[data-radar-team-page]")!.getAttribute("href")).toBe("/team/BUF?season=2025#team-radar");
  });

  it("uncovered → R12b for a gap season (the probe answered: covered seasons on both sides)", async () => {
    vi.mocked(getBoxScoreSeasonsCached).mockResolvedValue([2026, 2024]);
    const el = await page("BUF", "offense", "2025");
    expect(message(el)).toBe("Team radars are not available for the 2025 season.");
    expect(getTeamRadarRows).not.toHaveBeenCalled();
    bare(el);
  });

  it("the message page still names the team, the side and the season", async () => {
    const el = await page("BUF", "defense", "2025");
    expect(el.querySelector("h1")!.textContent).toBe("Buffalo Bills Defense Radar 2025");
  });
});

describe("a failed read throws to the error card: never a 404, never an empty card", () => {
  it("the row read fails", async () => {
    vi.mocked(getTeamRadarRows).mockRejectedValue(FAILED);
    await expect(SharePage(args("BUF", "offense"))).rejects.toThrow("Failed to fetch team radar rows");
    expect(notFound).not.toHaveBeenCalled();
  });

  it("the seasons read fails", async () => {
    vi.mocked(getAvailableSeasons).mockRejectedValue(new Error("Failed to fetch seasons: TypeError: fetch failed"));
    await expect(SharePage(args("BUF", "offense"))).rejects.toThrow("Failed to fetch seasons");
    expect(notFound).not.toHaveBeenCalled();
    expect(getTeamRadarRows).not.toHaveBeenCalled();
  });

  // Chaos R3: with the probe down the page cannot say WHY 2025 has no radar.
  it("the coverage probe fails on a past season with no rows: throws (page and metadata), never the vaguer sentence", async () => {
    vi.mocked(getBoxScoreSeasonsCached).mockRejectedValue(new Error("probe failed"));
    vi.mocked(getTeamRadarRows).mockResolvedValue([]);
    await expect(page("BUF", "offense", "2025")).rejects.toThrow(/coverage probe failed/);
    await expect(md("BUF", "offense", "2025")).rejects.toThrow(/coverage probe failed/);
    expect(notFound).not.toHaveBeenCalled();
  });

  it("the coverage probe fails on the newest season: the card still renders (its rows are the proof)", async () => {
    vi.mocked(getBoxScoreSeasonsCached).mockRejectedValue(new Error("probe failed"));
    const el = await page("BUF", "offense");
    expect(el.querySelector("[data-radar-card]")).not.toBeNull();
  });

  it("no rows for the newest season (a read failing silently) throws too, and is logged", async () => {
    vi.mocked(getTeamRadarRows).mockResolvedValue([]);
    await expect(SharePage(args("BUF", "offense"))).rejects.toThrow(/returned no rows for 2026/);
    expect(notFound).not.toHaveBeenCalled();
  });
});

describe("generateMetadata", () => {
  it("R14 title and R14b description, per side", async () => {
    const off = await md("BUF", "offense");
    expect(off.title).toEqual({ absolute: "Buffalo Bills Offense Radar 2026 — Yards Per Pass" });
    expect(off.description).toBe(
      "Buffalo Bills offense through Week 3: explosive pass and run rates, pass and run success, sack rate, stuff rate and turnover rate, ranked against every NFL team.",
    );
    const def = await md("BUF", "defense");
    expect(def.title).toEqual({ absolute: "Buffalo Bills Defense Radar 2026 — Yards Per Pass" });
    expect(def.description).toBe(
      "Buffalo Bills defense through Week 3: the explosive plays and success rates it allowed, and its sack, stuff and takeaway rates, ranked against every NFL team.",
    );
    expect(off.openGraph?.title).toBe("Buffalo Bills Offense Radar 2026 — Yards Per Pass");
    expect(off.openGraph?.description).toBe(off.description);
    expect((off.twitter as { title: string }).title).toBe("Buffalo Bills Offense Radar 2026 — Yards Per Pass");
  });

  it("the description drops a missing spoke (the NULL window: no stuff rate)", async () => {
    vi.mocked(getTeamRadarRows).mockResolvedValue(ROWS.map((r) => ({ ...r, designed_runs: null, stuffed_runs: null })) as never[]);
    expect((await md("BUF", "offense")).description).toBe(
      "Buffalo Bills offense through Week 3: explosive pass and run rates, pass and run success, sack rate and turnover rate, ranked against every NFL team.",
    );
  });

  it("the preview image is the image route, absolute, WITH the season (and the week), 1200×630 — og and twitter", async () => {
    const meta = await md("BUF", "offense");
    const url = `${BASE}/api/team-radar/BUF/offense?season=2026&w=3`;
    expect(ogImage(meta)).toEqual({ url, width: 1200, height: 630, alt: "Buffalo Bills offense radar, 2026" });
    expect((meta.twitter as { images: string[]; card: string }).images).toEqual([url]);
    expect((meta.twitter as { card: string }).card).toBe("summary_large_image");
  });

  it("a past season's link previews that season, not the newest", async () => {
    vi.mocked(getBoxScoreSeasonsCached).mockResolvedValue([2026, 2025]);
    vi.mocked(getTeamRadarRows).mockResolvedValue(ROWS.map((r) => ({ ...r, season: 2025 })) as never[]);
    const meta = await md("BUF", "defense", "2025");
    expect(ogImage(meta).url).toBe(`${BASE}/api/team-radar/BUF/defense?season=2025&w=3`);
    expect(meta.title).toEqual({ absolute: "Buffalo Bills Defense Radar 2025 — Yards Per Pass" });
  });

  it("canonical and og:url: bare for the newest season (asked for or not), ?season= for a real past season", async () => {
    expect((await md("BUF", "offense")).alternates?.canonical).toBe(`${BASE}/card/team/BUF/offense`);
    expect((await md("BUF", "offense", "2026")).alternates?.canonical).toBe(`${BASE}/card/team/BUF/offense`);
    expect((await md("BUF", "offense", "abc")).alternates?.canonical).toBe(`${BASE}/card/team/BUF/offense`);
    const past = await md("BUF", "defense", "2025");
    expect(past.alternates?.canonical).toBe(`${BASE}/card/team/BUF/defense?season=2025`);
    expect(past.openGraph?.url).toBe(`${BASE}/card/team/BUF/defense?season=2025`);
    expect((await md("BUF", "offense")).openGraph?.url).toBe(`${BASE}/card/team/BUF/offense`);
  });

  it("the card is indexable; a message page is noindex, follow, and its description is the sentence on the page", async () => {
    expect("robots" in (await md("BUF", "offense"))).toBe(false);
    const past = await md("BUF", "offense", "2025");
    expect(past.robots).toEqual({ index: false, follow: true });
    expect(past.description).toBe("Team radars start with the 2026 season.");
    expect(ogImage(past).url).toBe(`${BASE}/api/team-radar/BUF/offense?season=2025`);
  });

  it("a season the site does not have: a not-found title, noindex, no image, and no row read", async () => {
    const meta = await md("BUF", "offense", "2099");
    expect(meta.title).toEqual({ absolute: "Team Radar Not Found — Yards Per Pass" });
    expect(meta.robots).toEqual({ index: false, follow: true });
    expect(meta.openGraph).toBeUndefined();
    expect(getTeamRadarRows).not.toHaveBeenCalled();
  });

  // Read resilience 1A: a failed read in generateMetadata is not caught, so a
  // real card never gets a guessed title, a "not found" title or a 404.
  it("a failed read rejects: seasons, rows, or rows that come back empty for the newest season", async () => {
    vi.mocked(getTeamRadarRows).mockRejectedValue(FAILED);
    await expect(md("BUF", "offense")).rejects.toThrow("Failed to fetch team radar rows");
    vi.mocked(getTeamRadarRows).mockResolvedValue([]);
    clearTeamRadarCardMemo();
    await expect(md("BUF", "offense")).rejects.toThrow(/returned no rows for 2026/);
    vi.mocked(getAvailableSeasons).mockRejectedValue(new Error("Failed to fetch seasons: TypeError: fetch failed"));
    await expect(md("BUF", "offense")).rejects.toThrow("Failed to fetch seasons");
    expect(notFound).not.toHaveBeenCalled();
  });

  it("the page and its metadata share one row read (the per-season memo)", async () => {
    await md("BUF", "offense");
    await page("BUF", "offense");
    await md("BUF", "defense");
    expect(getTeamRadarRows).toHaveBeenCalledTimes(1);
  });
});
