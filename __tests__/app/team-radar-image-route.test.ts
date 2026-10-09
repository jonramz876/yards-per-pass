import { describe, it, expect, beforeEach, vi } from "vitest";

// /api/team-radar/[team_id]/[side] — the 1200×630 PNG of one share card: the
// link preview, and with &download=1 the Download button's file (team radar
// spec 2026-10-06 §7 "The image route, in order", PR 3).
//
// @vercel/og cannot render on Windows, so next/og is replaced by a class that
// records what it was given and answers 200 with its headers built exactly the
// way the real one builds them (next/dist/server/og/image-response.js): a
// LOWERCASE one-year `cache-control` default with the caller's headers spread
// on top. Only a lowercase key replaces that default; a "Cache-Control" key
// would leave both, joined. The assertions below read what would go out.
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
  radarImageFonts: vi.fn(async () => [{ name: "F", data: new ArrayBuffer(1), style: "normal" }]),
  teamRadarCardImage: vi.fn(() => "CARD"),
  teamRadarPlateImage: vi.fn(() => "PLATE"),
}));
vi.mock("@/lib/data/queries", () => ({ getAvailableSeasons: vi.fn(), fallbackSeason: () => 2026 }));
vi.mock("@/lib/data/team-radar", () => ({ getTeamRadarRows: vi.fn() }));
vi.mock("@/lib/data/box-score", () => ({ getBoxScoreSeasonsCached: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ hasNoDatabase: vi.fn(() => false) }));

import rowsJson from "../stats/fixtures/team-radar-2026-w1-3.json";
import * as route from "@/app/api/team-radar/[team_id]/[side]/route";
import { GET } from "@/app/api/team-radar/[team_id]/[side]/route";
import { getAvailableSeasons } from "@/lib/data/queries";
import { getTeamRadarRows } from "@/lib/data/team-radar";
import { getBoxScoreSeasonsCached } from "@/lib/data/box-score";
import { hasNoDatabase } from "@/lib/supabase/server";
import { clearTeamRadarCardMemo } from "@/lib/data/team-radar-card";
import { teamRadarCardImage, teamRadarPlateImage, radarImageFonts } from "@/lib/og/team-radar-image";
import { getTeam } from "@/lib/data/teams";

type Row = Record<string, unknown>;
const ROWS = rowsJson as Row[];
const SEASONS = [2026, 2025, 2024];
const SUCCESS_CACHE = "public, max-age=0, s-maxage=3600";

const get = (team_id: string, side: string, query = "") =>
  GET(new Request(`https://yardsperpass.com/api/team-radar/${team_id}/${side}${query}`), {
    params: Promise.resolve({ team_id, side }),
  });

const noRead = () => {
  expect(getAvailableSeasons).not.toHaveBeenCalled();
  expect(getBoxScoreSeasonsCached).not.toHaveBeenCalled();
  expect(getTeamRadarRows).not.toHaveBeenCalled();
};

const JUNK_CACHE = "public, max-age=0, s-maxage=3600";

async function expectNotFound(res: Response) {
  expect(res.status).toBe(404);
  expect(await res.text()).toBe("Not found");
  expect(images).toHaveLength(0);
  expect(teamRadarCardImage).not.toHaveBeenCalled();
  expect(teamRadarPlateImage).not.toHaveBeenCalled();
}

/** The answer every failed read must get: retryable, never stored, no image drawn. */
async function expectUnavailable(res: Response) {
  expect(res.status).toBe(503);
  expect(await res.text()).toBe("Team radar image temporarily unavailable. Try again in a few minutes.");
  expect(res.headers.get("cache-control")).toBe("no-store");
  expect(res.headers.get("retry-after")).toBe("60");
  expect(res.headers.get("content-type")).toBe("text/plain; charset=utf-8");
  expect(images).toHaveLength(0);
}

beforeEach(() => {
  images.length = 0;
  clearTeamRadarCardMemo();
  vi.mocked(teamRadarCardImage).mockClear();
  vi.mocked(teamRadarPlateImage).mockClear();
  vi.mocked(radarImageFonts).mockClear();
  vi.mocked(getAvailableSeasons).mockReset();
  vi.mocked(getTeamRadarRows).mockReset();
  vi.mocked(getBoxScoreSeasonsCached).mockReset();
  vi.mocked(hasNoDatabase).mockReturnValue(false);
  vi.mocked(getAvailableSeasons).mockResolvedValue(SEASONS);
  vi.mocked(getTeamRadarRows).mockResolvedValue(ROWS as never[]);
  vi.mocked(getBoxScoreSeasonsCached).mockResolvedValue([2026]);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

// Compare card PR 2, chaos R2: the same weakness was here. A query that
// parses to a valid card but is spelled another way is its own CDN entry and
// its own render; only the spelling the share page prints is drawn.
describe("another spelling of a valid query is a 404 the CDN keeps, with no read", () => {
  it.each(["?", "?&", "?season=2026&", "?&season=2026", "?season=%32%30%32%36", "?w=4&season=2026", "?download=1&season=2026", "?season=2026&&w=4"])(
    "%s",
    async (query) => {
      const res = await get("BUF", "offense", query);
      expect(res.headers.get("cache-control")).toBe(JUNK_CACHE);
      await expectNotFound(res);
      noRead();
    },
  );

  it("the spellings the share page prints are all drawn", async () => {
    for (const query of ["", "?season=2026", "?season=2026&w=3", "?season=2026&download=1", "?season=2026&w=3&download=1"]) {
      expect((await get("BUF", "offense", query)).status, query).toBe(200);
    }
  });
});

describe("route config", () => {
  it("runs on Node (the fonts are read with fs) and is never cached by Next itself", () => {
    expect(route.runtime).toBe("nodejs");
    expect(route.revalidate).toBe(0);
  });
});

describe("junk is a 404 before any database read and before any render", () => {
  it.each([
    ["BUF", "sideways"],
    ["BUF", "Offense"],
    ["BUF", "DEFENSE"],
    ["BUF", ""],
    ["XXX", "offense"],
    ["", "defense"],
    ["buffalo-bills", "offense"],
    // Chaos N3: these upper-case to SF, PIT and MIA.
    ["ſf", "offense"],
    ["pıt", "offense"],
    ["mıa", "defense"],
    ["BUFF", "offense"],
    ["B", "offense"],
  ])("/api/team-radar/%s/%s", async (team, side) => {
    const res = await get(team, side);
    expect(res.headers.get("cache-control")).toBe(JUNK_CACHE);
    await expectNotFound(res);
    noRead();
  });

  // Chaos R1: every distinct query string is its own CDN entry and its own
  // render. Only the route's one exact form is drawn.
  it.each([
    "?x=1", "?season=2026&x=1", "?Season=2025", "?utm_source=share",
    "?season=abc", "?season=", "?season=NaN", "?season=2025abc", "?season=2025.9", "?season=%202025", "?season=02025",
    "?season=2025&season=2024", "?w=1&w=2", "?w=-5", "?w=zzz", "?w=123",
    "?download=0", "?download=true", "?download=", "?Download=1", "?download=1&download=1",
  ])("a query string that is not the route's exact form (%s): 404 with no read, kept by the CDN so it is not re-run", async (query) => {
    const res = await get("BUF", "offense", query);
    expect(res.headers.get("cache-control")).toBe(JUNK_CACHE);
    await expectNotFound(res);
    noRead();
  });

  it.each(["?season=99999999999999999999", "?season=1998", "?season=2101", "?season=-3", "?season=0"])(
    "a number no season can be (%s): 404 with no read at all",
    async (query) => {
      await expectNotFound(await get("BUF", "offense", query));
      noRead();
    },
  );

  it.each(["?season=2099", "?season=2019", "?season=2027"])(
    "a season the site does not have (%s): 404 after the seasons list, with no row read and no render",
    async (query) => {
      await expectNotFound(await get("BUF", "offense", query));
      expect(getAvailableSeasons).toHaveBeenCalledTimes(1);
      expect(getBoxScoreSeasonsCached).not.toHaveBeenCalled();
      expect(getTeamRadarRows).not.toHaveBeenCalled();
      expect(radarImageFonts).not.toHaveBeenCalled();
    },
  );

  it("a season the site does not have YET is a 404 that is not stored (it may exist tomorrow); junk that can never be a card is stored for an hour", async () => {
    expect((await get("BUF", "offense", "?season=2027")).headers.get("cache-control")).toBe("no-store");
    expect((await get("BUF", "sideways")).headers.get("cache-control")).toBe(JUNK_CACHE);
    expect((await get("BUF", "offense", "?season=1998")).headers.get("cache-control")).toBe(JUNK_CACHE);
  });
});

describe("ready: the card PNG", () => {
  it("1200×630, the newest season when none is asked for, the spec's cache header and nothing else joined to it", async () => {
    const res = await get("BUF", "offense");
    expect(res.status).toBe(200);
    expect(images).toHaveLength(1);
    expect(images[0].element).toBe("CARD");
    expect(images[0].options).toMatchObject({ width: 1200, height: 630 });
    expect(res.headers.get("cache-control")).toBe(SUCCESS_CACHE);
    expect(res.headers.get("cache-control")).not.toContain(NEXT_OG_DEFAULT_CACHE);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("content-disposition")).toBeNull();
    expect(vi.mocked(getTeamRadarRows).mock.calls).toEqual([[2026]]);
  });

  it("the header keys the route passes are lowercase (a mixed-case key would not replace next/og's one-year default)", async () => {
    await get("BUF", "offense", "?download=1");
    const headers = images[0].options.headers as Record<string, string>;
    for (const key of Object.keys(headers)) expect(key).toBe(key.toLowerCase());
    expect(Object.keys(headers).sort()).toEqual(["cache-control", "content-disposition"]);
  });

  it("the image is drawn from the team, the validated side and that team's ready slice", async () => {
    await get("BUF", "defense");
    const arg = vi.mocked(teamRadarCardImage).mock.calls[0][0];
    expect(arg.team).toBe(getTeam("BUF"));
    expect(arg.side).toBe("def");
    expect(arg.slice.state).toBe("ready");
    expect(arg.slice.season).toBe(2026);
    expect(arg.slice.teamsPlayed).toBe(32);
    expect(arg.slice.throughWeek).toBe(3);
  });

  it("the fonts it loaded are handed to the renderer", async () => {
    await get("BUF", "offense");
    expect(radarImageFonts).toHaveBeenCalledTimes(1);
    expect((images[0].options.fonts as { name: string }[])[0].name).toBe("F");
  });

  it("?season= picks the season; the preview's &w= is ignored", async () => {
    vi.mocked(getBoxScoreSeasonsCached).mockResolvedValue([2026, 2025]);
    vi.mocked(getTeamRadarRows).mockResolvedValue(ROWS.map((r) => ({ ...r, season: 2025 })) as never[]);
    const res = await get("BUF", "offense", "?season=2025&w=3");
    expect(res.status).toBe(200);
    expect(vi.mocked(getTeamRadarRows).mock.calls).toEqual([[2025]]);
    expect(vi.mocked(teamRadarCardImage).mock.calls[0][0].slice.season).toBe(2025);
  });

  it("a lower-case team id is the same team", async () => {
    const res = await get("buf", "offense");
    expect(res.status).toBe(200);
    expect(vi.mocked(teamRadarCardImage).mock.calls[0][0].team.id).toBe("BUF");
  });

  it("requests inside a minute (preview, download, another team) share one row read AND one seasons read", async () => {
    await get("BUF", "offense");
    await get("BUF", "defense", "?download=1");
    await get("KC", "offense", "?season=2026&w=3");
    expect(getTeamRadarRows).toHaveBeenCalledTimes(1);
    expect(getAvailableSeasons).toHaveBeenCalledTimes(1);
    expect(images).toHaveLength(3);
  });
});

describe("download=1", () => {
  it("adds the attachment header with the file name, and keeps the cache header", async () => {
    const res = await get("BUF", "offense", "?season=2026&download=1");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-disposition")).toBe('attachment; filename="BUF-offense-2026-radar.png"');
    expect(res.headers.get("cache-control")).toBe(SUCCESS_CACHE);
  });

  it("names the side and the resolved season; a lower-case id still downloads as BUF", async () => {
    const res = await get("buf", "defense", "?download=1");
    expect(res.headers.get("content-disposition")).toBe('attachment; filename="BUF-defense-2026-radar.png"');
  });

  it("only the exact value 1 is a download; any other value is not a picture at all", async () => {
    for (const q of ["?download=0", "?download=true", "?download=", "?Download=1"]) {
      const res = await get("BUF", "offense", q);
      expect(res.status, q).toBe(404);
      expect(res.headers.get("content-disposition"), q).toBeNull();
    }
    expect(images).toHaveLength(0);
  });
});

describe("no radar to draw: a plate (never the card, never an attachment)", () => {
  it("uncovered past season: the plate with R12, and no row read", async () => {
    const res = await get("BUF", "offense", "?season=2025&download=1");
    expect(res.status).toBe(200);
    expect(images[0].element).toBe("PLATE");
    expect(getTeamRadarRows).not.toHaveBeenCalled();
    const arg = vi.mocked(teamRadarPlateImage).mock.calls[0][0];
    expect(arg).toMatchObject({ side: "off", season: 2025, message: "Team radars start with the 2026 season." });
    expect(arg.team.id).toBe("BUF");
    expect(res.headers.get("content-disposition")).toBeNull();
    expect(res.headers.get("cache-control")).toBe(SUCCESS_CACHE);
    expect(teamRadarCardImage).not.toHaveBeenCalled();
  });

  it("no-games: the plate with R10", async () => {
    const eight = ROWS.filter((r) => r.week === 1 && r.team_id !== "KC" && r.opponent_id !== "KC").slice(0, 8);
    vi.mocked(getTeamRadarRows).mockResolvedValue(eight as never[]);
    await get("KC", "defense");
    expect(images[0].element).toBe("PLATE");
    expect(vi.mocked(teamRadarPlateImage).mock.calls[0][0].message).toBe(
      "The Kansas City Chiefs have not played a 2026 game yet. Their radar appears after their first game.",
    );
  });

  it("small-pool: the plate with R11", async () => {
    vi.mocked(getTeamRadarRows).mockResolvedValue(ROWS.filter((r) => r.game_id === "2026_01_BUF_HOU") as never[]);
    await get("BUF", "offense");
    expect(vi.mocked(teamRadarPlateImage).mock.calls[0][0].message).toBe(
      "Team radars start once 8 teams have played this season. Until then there are too few teams to rank against.",
    );
  });
});

describe("a failed read is a 503 the browser can retry: never a 404, never a stored broken image", () => {
  it("the seasons read fails", async () => {
    vi.mocked(getAvailableSeasons).mockRejectedValue(new Error("Failed to fetch seasons: TypeError: fetch failed"));
    await expectUnavailable(await get("BUF", "offense"));
    expect(getTeamRadarRows).not.toHaveBeenCalled();
  });

  it("the row read fails", async () => {
    vi.mocked(getTeamRadarRows).mockRejectedValue(new Error("Failed to fetch team radar rows for 2026: TimeoutError"));
    await expectUnavailable(await get("BUF", "offense"));
  });

  it("the row read comes back empty for the newest season (failing silently)", async () => {
    vi.mocked(getTeamRadarRows).mockResolvedValue([]);
    await expectUnavailable(await get("BUF", "offense"));
  });

  it("data_freshness is empty on a real database", async () => {
    vi.mocked(getAvailableSeasons).mockResolvedValue([]);
    await expectUnavailable(await get("BUF", "offense"));
    expect(getTeamRadarRows).not.toHaveBeenCalled();
  });

  it("a non-Error rejection is a 503 too, and the failure is logged with the team and side", async () => {
    vi.mocked(console.error).mockClear();
    vi.mocked(getTeamRadarRows).mockRejectedValue({ message: "TypeError: fetch failed" });
    await expectUnavailable(await get("BUF", "defense", "?download=1"));
    expect(String(vi.mocked(console.error).mock.calls[0][0])).toContain("BUF");
    expect(String(vi.mocked(console.error).mock.calls[0][0])).toContain("defense");
  });

  // Compare card PR 2, chaos COST-2: the failure is kept ten seconds (never as
  // a success), so an outage is not retried once per image request.
  it("a failed read is answered 503 for ten seconds without reading again, then the next request draws the card", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-10-06T12:00:00Z"));
      vi.mocked(getTeamRadarRows).mockRejectedValueOnce(new Error("Failed to fetch team radar rows for 2026: timeout"));
      await expectUnavailable(await get("BUF", "offense"));
      for (let i = 1; i <= 5; i++) {
        vi.setSystemTime(new Date(`2026-10-06T12:00:0${i}Z`));
        await expectUnavailable(await get("BUF", "offense"));
        await expectUnavailable(await get("KC", "defense"));
      }
      expect(getTeamRadarRows).toHaveBeenCalledTimes(1);
      vi.setSystemTime(new Date("2026-10-06T12:00:11Z"));
      const res = await get("BUF", "offense");
      expect(res.status).toBe(200);
      expect(getTeamRadarRows).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("a failed coverage probe on a past season with no rows is a 503, not a cacheable plate", async () => {
    vi.mocked(getBoxScoreSeasonsCached).mockRejectedValue(new Error("probe failed"));
    vi.mocked(getTeamRadarRows).mockResolvedValue([]);
    await expectUnavailable(await get("BUF", "offense", "?season=2025"));
    expect(teamRadarPlateImage).not.toHaveBeenCalled();
  });

  it("a failed coverage probe alone does not fail the image (the newest season is still read)", async () => {
    vi.mocked(getBoxScoreSeasonsCached).mockRejectedValue(new Error("probe failed"));
    const res = await get("BUF", "offense");
    expect(res.status).toBe(200);
    expect(images[0].element).toBe("CARD");
  });
});
