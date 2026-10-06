import { describe, it, expect, beforeEach, vi } from "vitest";

// /api/stat-card/[slug] (the Download button's PNG). Read resilience spec
// §1.2: a read that throws is a 503 the browser may retry, never a 404 (which
// says the card does not exist) and never a card for a guessed season.
//
// @vercel/og cannot render on Windows, so next/og is replaced by a class that
// records what it was given and answers 200, with its headers built exactly
// the way the real one builds them (next/dist/server/og/image-response.js:
// 38-42): a LOWERCASE one-year default with the caller's headers spread on
// top. A caller's mixed-case "Cache-Control" therefore does not replace the
// default; the Response joins the two.
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

vi.mock("@/lib/og/tecmo-card-image", () => ({
  loadHeadshotDataUri: vi.fn(async () => null),
  pixelFontOptions: vi.fn(async () => undefined),
  tecmoCardImage: vi.fn(() => "CARD"),
}));

vi.mock("@/lib/data/players", () => ({ getPlayerBySlug: vi.fn() }));
vi.mock("@/lib/data/queries", () => ({ getAvailableSeasons: vi.fn(), fallbackSeason: () => 2026 }));
vi.mock("@/lib/data/card", () => ({ getCardDataForPlayer: vi.fn() }));

import { GET } from "@/app/api/stat-card/[slug]/route";
import { getPlayerBySlug } from "@/lib/data/players";
import { getAvailableSeasons } from "@/lib/data/queries";
import { getCardDataForPlayer } from "@/lib/data/card";
import type { TecmoCardData } from "@/lib/stats/tecmo-card";

const ALLEN = {
  player_id: "00-0034857",
  slug: "josh-allen",
  player_name: "Josh Allen",
  position: "QB",
  current_team_id: "BUF",
  headshot_url: null,
  jersey_number: 17,
};
const CARD = { playerName: "Josh Allen" } as unknown as TecmoCardData;
const FAILED = (what: string) => new Error(`Failed to fetch ${what}: TypeError: fetch failed`);

const get = (slug: string, query = "") =>
  GET(new Request(`https://yardsperpass.com/api/stat-card/${slug}${query}`), {
    params: Promise.resolve({ slug }),
  });

/** The 503 every failed read must produce (sentence S4 in the spec). */
async function expectUnavailable(res: Response) {
  expect(res.status).toBe(503);
  expect(await res.text()).toBe("Stat card temporarily unavailable. Try again in a few minutes.");
  expect(res.headers.get("Cache-Control")).toBe("no-store");
  expect(res.headers.get("Retry-After")).toBe("60");
  expect(images).toHaveLength(0);
}

beforeEach(() => {
  images.length = 0;
  vi.mocked(getPlayerBySlug).mockReset();
  vi.mocked(getAvailableSeasons).mockReset();
  vi.mocked(getCardDataForPlayer).mockReset();
  vi.mocked(getPlayerBySlug).mockResolvedValue(ALLEN);
  vi.mocked(getAvailableSeasons).mockResolvedValue([2026, 2025]);
  vi.mocked(getCardDataForPlayer).mockResolvedValue(CARD);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("/api/stat-card/[slug] — healthy", () => {
  it("draws the newest season's card as a download", async () => {
    const res = await get("josh-allen");
    expect(res.status).toBe(200);
    expect(vi.mocked(getCardDataForPlayer)).toHaveBeenCalledWith(ALLEN, 2026);
    expect(res.headers.get("Content-Disposition")).toBe('attachment; filename="josh-allen-2026-card.png"');
  });

  // KNOWN DEBT, pinned as it really is (memory/MEMORY.md, audit "Smaller"
  // list): the route passes a mixed-case "Cache-Control", which does not
  // replace next/og's lowercase default, so the download leaves with both.
  // Unchanged by read resilience PR 1A (the success path is out of its scope);
  // the fix is a lowercase key, and this assertion then becomes the one line
  // "public, max-age=0, s-maxage=3600".
  it("success path: sends next/og's one-year default joined with the route's own value (known debt)", async () => {
    const res = await get("josh-allen");
    expect(res.headers.get("cache-control")).toBe(
      "public, immutable, no-transform, max-age=31536000, public, max-age=0, s-maxage=3600",
    );
  });

  it("honours a plausible ?season= without reading the seasons list", async () => {
    const res = await get("josh-allen", "?season=2025");
    expect(res.status).toBe(200);
    expect(getAvailableSeasons).not.toHaveBeenCalled();
    expect(vi.mocked(getCardDataForPlayer)).toHaveBeenCalledWith(ALLEN, 2025);
  });

  it("unknown slug is still a 404", async () => {
    vi.mocked(getPlayerBySlug).mockResolvedValue(null);
    const res = await get("no-such-player");
    expect(res.status).toBe(404);
    expect(await res.text()).toBe("Not found");
  });

  it("a real player with no card is still a 404", async () => {
    vi.mocked(getCardDataForPlayer).mockResolvedValue(null);
    const res = await get("josh-allen");
    expect(res.status).toBe(404);
  });

  it("an empty seasons list (a read that succeeded) still uses the fallback season", async () => {
    vi.mocked(getAvailableSeasons).mockResolvedValue([]);
    const res = await get("josh-allen");
    expect(res.status).toBe(200);
    expect(vi.mocked(getCardDataForPlayer)).toHaveBeenCalledWith(ALLEN, 2026);
  });
});

describe("/api/stat-card/[slug] — a failed read is a 503, never a 404 or a guessed card", () => {
  it("the player row read fails", async () => {
    vi.mocked(getPlayerBySlug).mockRejectedValue(FAILED("player josh-allen"));
    await expectUnavailable(await get("josh-allen"));
  });

  it("the card data read fails", async () => {
    vi.mocked(getCardDataForPlayer).mockRejectedValue(FAILED("QB stats"));
    await expectUnavailable(await get("josh-allen"));
  });

  // Review M10: this one used to be caught and the card drawn for
  // fallbackSeason(), which can be the wrong season.
  it("the seasons read fails: no card for a guessed season", async () => {
    vi.mocked(getAvailableSeasons).mockRejectedValue(FAILED("seasons"));
    await expectUnavailable(await get("josh-allen"));
    expect(getCardDataForPlayer).not.toHaveBeenCalled();
  });

  it("a junk ?season= falls back to the seasons read, so its failure is a 503 too", async () => {
    vi.mocked(getAvailableSeasons).mockRejectedValue(FAILED("seasons"));
    await expectUnavailable(await get("josh-allen", "?season=99999999999999999999"));
  });

  it("a non-Error rejection is a 503 too, and the failure is logged with the slug", async () => {
    vi.mocked(console.error).mockClear();
    vi.mocked(getCardDataForPlayer).mockRejectedValue({ message: "TypeError: fetch failed" });
    await expectUnavailable(await get("josh-allen"));
    expect(console.error).toHaveBeenCalledTimes(1);
    expect(String(vi.mocked(console.error).mock.calls[0][0])).toContain("josh-allen");
  });
});
