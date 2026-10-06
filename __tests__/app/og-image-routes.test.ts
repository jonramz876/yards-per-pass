import { describe, it, expect, beforeEach, vi } from "vitest";

// The two share-image routes (app/player/[slug] and app/card/[slug]
// opengraph-image.tsx). Read resilience spec §1.2: an image built after ANY
// read in the route threw is sent with Cache-Control: no-store, so a share
// card drawn during a database stall is not kept by a CDN or a social
// network's crawler as that player's image. An image built with no failed
// read is returned exactly as before: no headers option at all.
//
// @vercel/og cannot render on Windows, so next/og is replaced by a class that
// records what it was given.
const images: { element: unknown; options: Record<string, unknown> }[] = [];
vi.mock("next/og", () => ({
  ImageResponse: class {
    constructor(element: unknown, options: Record<string, unknown> = {}) {
      images.push({ element, options });
    }
  },
}));

vi.mock("@/lib/og/tecmo-card-image", () => ({
  loadHeadshotDataUri: vi.fn(async () => null),
  pixelFontOptions: vi.fn(async () => undefined),
  tecmoCardImage: vi.fn(() => "CARD"),
  brandedFallbackImage: vi.fn(() => "BRAND PLATE"),
  namePlateImage: vi.fn(() => "NAME PLATE"),
}));

vi.mock("@/lib/data/players", () => ({ getPlayerBySlug: vi.fn() }));
vi.mock("@/lib/data/queries", () => ({ getAvailableSeasons: vi.fn(), fallbackSeason: () => 2026 }));
vi.mock("@/lib/data/card", () => ({ getCardDataForPlayer: vi.fn() }));

import PlayerImage from "@/app/player/[slug]/opengraph-image";
import CardImage from "@/app/card/[slug]/opengraph-image";
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

type ImageRoute = (args: { params: Promise<{ slug: string }> }) => Promise<unknown>;

const ROUTES: [string, ImageRoute][] = [
  ["player OG image", PlayerImage as ImageRoute],
  ["card OG image", CardImage as ImageRoute],
];

/** Run a route and return the one image it built. */
async function draw(route: ImageRoute, slug = "josh-allen") {
  await route({ params: Promise.resolve({ slug }) });
  expect(images).toHaveLength(1);
  return images[0];
}

const NO_STORE = { "Cache-Control": "no-store" };

beforeEach(() => {
  images.length = 0;
  vi.mocked(getPlayerBySlug).mockReset();
  vi.mocked(getAvailableSeasons).mockReset();
  vi.mocked(getCardDataForPlayer).mockReset();
  vi.mocked(getPlayerBySlug).mockResolvedValue(ALLEN);
  vi.mocked(getAvailableSeasons).mockResolvedValue([2026, 2025]);
  vi.mocked(getCardDataForPlayer).mockResolvedValue(CARD);
});

describe.each(ROUTES)("%s — no read failed: built exactly as before, cacheable", (_name, route) => {
  it("the real card has no headers option", async () => {
    const image = await draw(route);
    expect(image.element).toBe("CARD");
    expect("headers" in image.options).toBe(false);
    expect(image.options).toMatchObject({ width: 1200, height: 630 });
    expect(vi.mocked(getCardDataForPlayer)).toHaveBeenCalledWith(ALLEN, 2026);
  });

  it("unknown slug: the brand plate, no headers option", async () => {
    vi.mocked(getPlayerBySlug).mockResolvedValue(null);
    const image = await draw(route, "no-such-player");
    expect(image.element).toBe("BRAND PLATE");
    expect("headers" in image.options).toBe(false);
  });

  it("real player with no card: the name plate, no headers option", async () => {
    vi.mocked(getCardDataForPlayer).mockResolvedValue(null);
    const image = await draw(route);
    expect(image.element).toBe("NAME PLATE");
    expect("headers" in image.options).toBe(false);
  });

  it("an empty seasons list (a read that succeeded) is not a failure", async () => {
    vi.mocked(getAvailableSeasons).mockResolvedValue([]);
    const image = await draw(route);
    expect(image.element).toBe("CARD");
    expect("headers" in image.options).toBe(false);
  });
});

describe.each(ROUTES)("%s — a read failed: the image is no-store", (_name, route) => {
  it("player row read fails: the brand plate, no-store", async () => {
    vi.mocked(getPlayerBySlug).mockRejectedValue(FAILED("player josh-allen"));
    const image = await draw(route);
    expect(image.element).toBe("BRAND PLATE");
    expect(image.options.headers).toEqual(NO_STORE);
  });

  it("card data read fails: the name plate, no-store", async () => {
    vi.mocked(getCardDataForPlayer).mockRejectedValue(FAILED("QB stats"));
    const image = await draw(route);
    expect(image.element).toBe("NAME PLATE");
    expect(image.options.headers).toEqual(NO_STORE);
  });

  it("seasons read fails, then the card draws for the fallback season: still no-store (it may be the wrong season)", async () => {
    vi.mocked(getAvailableSeasons).mockRejectedValue(FAILED("seasons"));
    const image = await draw(route);
    expect(image.element).toBe("CARD");
    expect(vi.mocked(getCardDataForPlayer)).toHaveBeenCalledWith(ALLEN, 2026);
    expect(image.options.headers).toEqual(NO_STORE);
  });

  it("seasons read fails and the slug is unknown: the brand plate, no-store", async () => {
    vi.mocked(getAvailableSeasons).mockRejectedValue(FAILED("seasons"));
    vi.mocked(getPlayerBySlug).mockResolvedValue(null);
    const image = await draw(route, "no-such-player");
    expect(image.element).toBe("BRAND PLATE");
    expect(image.options.headers).toEqual(NO_STORE);
  });

  it("seasons read fails and the player has no card: the name plate, no-store", async () => {
    vi.mocked(getAvailableSeasons).mockRejectedValue(FAILED("seasons"));
    vi.mocked(getCardDataForPlayer).mockResolvedValue(null);
    const image = await draw(route);
    expect(image.element).toBe("NAME PLATE");
    expect(image.options.headers).toEqual(NO_STORE);
  });

  it("never throws: a share embed always gets an image", async () => {
    vi.mocked(getAvailableSeasons).mockRejectedValue(FAILED("seasons"));
    vi.mocked(getPlayerBySlug).mockRejectedValue({ message: "raw object" });
    await expect(route({ params: Promise.resolve({ slug: "josh-allen" }) })).resolves.toBeDefined();
  });
});
