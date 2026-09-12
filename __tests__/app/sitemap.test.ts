import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/lib/data/players", () => ({ getAllPlayerSlugs: vi.fn() }));
vi.mock("@/lib/data/queries", () => ({ getDataFreshness: vi.fn() }));

import sitemap from "@/app/sitemap";
import { getAllPlayerSlugs } from "@/lib/data/players";
import { getDataFreshness } from "@/lib/data/queries";

const SLUGS = [
  { slug: "patrick-mahomes" },
  { slug: "brandon-aubrey" },
  { slug: "drake-maye" },
];

const FRESH = { season: 2026, through_week: 1, last_updated: "2026-09-10T16:42:00+00:00" };

beforeEach(() => {
  vi.mocked(getAllPlayerSlugs).mockReset();
  vi.mocked(getDataFreshness).mockReset();
  // The sitemap reads only .slug, so the fixtures stay slug-only.
  vi.mocked(getAllPlayerSlugs).mockResolvedValue(SLUGS as never);
  vi.mocked(getDataFreshness).mockResolvedValue(FRESH as never);
});

describe("sitemap", () => {
  it("regression: no /card/ URLs, one /player/ URL per slug", async () => {
    const entries = await sitemap();
    expect(entries.filter((e) => e.url.includes("/card/"))).toHaveLength(0);
    expect(entries.filter((e) => e.url.includes("/player/"))).toHaveLength(3);
    expect(entries).toHaveLength(10 + 32 + 3);
  });

  it("lastmod is data_freshness.last_updated, not request time", async () => {
    const entries = await sitemap();
    const stamped = entries.filter(
      (e) =>
        e.url.includes("/player/") ||
        e.url.includes("/team/") ||
        e.url === "https://yardsperpass.com" ||
        e.url.endsWith("/qb-leaderboard"),
    );
    expect(stamped.length).toBeGreaterThan(0);
    for (const e of stamped) {
      expect((e.lastModified as Date).toISOString()).toBe("2026-09-10T16:42:00.000Z");
    }
    for (const page of ["/glossary", "/privacy"]) {
      expect(entries.find((e) => e.url.endsWith(page))?.lastModified).toBeUndefined();
    }
  });

  it("missing, invalid or failed freshness → no lastModified, no throw", async () => {
    const cases = [
      () => vi.mocked(getDataFreshness).mockResolvedValue(null),
      () => vi.mocked(getDataFreshness).mockResolvedValue({ last_updated: "not-a-date" } as never),
      () => vi.mocked(getDataFreshness).mockRejectedValue(new Error("boom")),
    ];
    for (const setup of cases) {
      setup();
      const entries = await sitemap();
      expect(entries.every((e) => e.lastModified === undefined)).toBe(true);
    }
  });

  it("Supabase down for slugs → static + team pages only", async () => {
    vi.mocked(getAllPlayerSlugs).mockRejectedValue(new Error("boom"));
    const entries = await sitemap();
    expect(entries).toHaveLength(10 + 32);
  });

  it("1,250 slugs (past the 1,000-row cap) → 1,250 player URLs, no duplicates", async () => {
    const many = Array.from({ length: 1250 }, (_, i) => ({ slug: `player-${i}` }));
    vi.mocked(getAllPlayerSlugs).mockResolvedValue(many as never);
    const entries = await sitemap();
    const players = entries.filter((e) => e.url.includes("/player/"));
    expect(players).toHaveLength(1250);
    expect(new Set(players.map((e) => e.url)).size).toBe(1250);
    expect(entries.filter((e) => e.url.includes("/card/"))).toHaveLength(0);
  });
});
