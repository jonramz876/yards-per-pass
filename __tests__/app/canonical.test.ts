import { describe, it, expect, beforeEach, vi } from "vitest";
import type { Metadata } from "next";

const SEASONS = [2026, 2025, 2024, 2023, 2022, 2021, 2020];

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
}));

vi.mock("next/dynamic", () => ({ default: () => () => null }));

vi.mock("@/lib/data/queries", () => ({
  getAvailableSeasons: vi.fn(),
  fallbackSeason: vi.fn(() => 2026),
  getDataFreshness: vi.fn(async () => null),
  getQBStats: vi.fn(async () => []),
  getTeamStats: vi.fn(async () => []),
}));

vi.mock("@/lib/data/players", () => ({
  getAllPlayerSlugs: vi.fn(async () => []),
  getPlayerBySlug: vi.fn(async () => null),
  getPlayerSlugsByIds: vi.fn(async () => []),
}));
vi.mock("@/lib/data/receivers", () => ({ getReceiverStats: vi.fn(async () => []) }));
vi.mock("@/lib/data/rushing", () => ({ getRBSeasonStats: vi.fn(async () => []) }));
vi.mock("@/lib/data/run-gaps", () => ({
  getRBGapStats: vi.fn(async () => []),
  getAllGapData: vi.fn(async () => ({ allGapStats: [], teams: [], leagueAvgs: { averages: [], teamGapEpas: [] } })),
  getRBGapStatsWeekly: vi.fn(async () => []),
  getDefGapStats: vi.fn(async () => []),
}));
vi.mock("@/lib/data/trends", () => ({
  getAllSurgeData: vi.fn(async () => new Map()),
  SURGE_STATS: [],
}));
vi.mock("@/lib/data/games", () => ({ hasScheduleForSeason: vi.fn(async () => false) }));

import { getAvailableSeasons } from "@/lib/data/queries";
import { metadata as homeMetadata } from "@/app/page";
import { metadata as glossaryMetadata } from "@/app/glossary/page";
import { metadata as privacyMetadata } from "@/app/privacy/page";
import { metadata as compareMetadata } from "@/app/compare/page";
import { generateMetadata as teamsMeta } from "@/app/teams/page";
import { generateMetadata as qbMeta } from "@/app/qb-leaderboard/page";
import { generateMetadata as receiversMeta } from "@/app/receivers/page";
import { generateMetadata as rushingMeta } from "@/app/rushing/page";
import { generateMetadata as trendsMeta } from "@/app/trends/page";
import { generateMetadata as runGapsMeta } from "@/app/run-gaps/page";

const BASE = "https://yardsperpass.com";

type Gen = (args: { searchParams: Promise<Record<string, string>> }) => Promise<Metadata>;

const SEASON_PAGES: [string, Gen][] = [
  ["/teams", teamsMeta as Gen],
  ["/qb-leaderboard", qbMeta as Gen],
  ["/receivers", receiversMeta as Gen],
  ["/rushing", rushingMeta as Gen],
  ["/trends", trendsMeta as Gen],
  ["/run-gaps", runGapsMeta as Gen],
];

const meta = (gen: Gen, params: Record<string, string> = {}) =>
  gen({ searchParams: Promise.resolve(params) });

beforeEach(() => {
  vi.mocked(getAvailableSeasons).mockReset();
  vi.mocked(getAvailableSeasons).mockResolvedValue(SEASONS);
});

describe("canonical tags on the static pages", () => {
  it("home points to the bare origin (matches the sitemap's <loc>)", () => {
    expect(homeMetadata?.alternates?.canonical).toBe(BASE);
  });

  it("home sets no title or openGraph, so the layout's apply", () => {
    expect(homeMetadata).toBeDefined();
    expect("title" in (homeMetadata ?? {})).toBe(false);
    expect("openGraph" in (homeMetadata ?? {})).toBe(false);
  });

  it("glossary, privacy and compare point to themselves", () => {
    expect(glossaryMetadata.alternates?.canonical).toBe(`${BASE}/glossary`);
    expect(privacyMetadata.alternates?.canonical).toBe(`${BASE}/privacy`);
    expect(compareMetadata.alternates?.canonical).toBe(`${BASE}/compare`);
  });

  it("glossary, privacy and compare keep their titles (guard)", () => {
    expect(glossaryMetadata.title).toBe("NFL Analytics Glossary");
    expect(privacyMetadata.title).toBe("Privacy Policy");
    expect(compareMetadata.title).toBe("Player Comparison");
  });
});

describe("canonical tags on the season pages (D2)", () => {
  it.each(SEASON_PAGES)("%s is bare with no params, the default season or junk", async (path, gen) => {
    const cases: Record<string, string>[] = [{}, { season: "2026" }, { season: "abc" }, { season: "1999" }, { season: "99999999999" }];
    for (const params of cases) {
      expect((await meta(gen, params)).alternates?.canonical).toBe(`${BASE}${path}`);
    }
  });

  it.each(SEASON_PAGES)("%s carries a real past season", async (path, gen) => {
    expect((await meta(gen, { season: "2025" })).alternates?.canonical).toBe(`${BASE}${path}?season=2025`);
  });

  it.each(SEASON_PAGES)("%s is bare when the season list is empty", async (path, gen) => {
    vi.mocked(getAvailableSeasons).mockResolvedValue([]);
    expect((await meta(gen, { season: "2025" })).alternates?.canonical).toBe(`${BASE}${path}`);
  });
});

describe("run-gaps canonical (D3)", () => {
  it("keeps team then season, drops the view state", async () => {
    const m = await meta(runGapsMeta as Gen, {
      team: "BUF", season: "2025", gap: "LT", opp: "MIA", situation: "early", zone: "rz",
    });
    expect(m.alternates?.canonical).toBe(`${BASE}/run-gaps?team=BUF&season=2025`);
  });

  it("a known team alone", async () => {
    expect((await meta(runGapsMeta as Gen, { team: "BUF" })).alternates?.canonical).toBe(`${BASE}/run-gaps?team=BUF`);
  });

  it("an unknown or lower-case team is dropped", async () => {
    for (const team of ["XYZ", "buf"]) {
      expect((await meta(runGapsMeta as Gen, { team })).alternates?.canonical).toBe(`${BASE}/run-gaps`);
    }
  });
});

describe("titles are unchanged (guards)", () => {
  it("QB Rankings follows the season param, else the newest season, else the fallback", async () => {
    expect((await meta(qbMeta as Gen, { season: "2025" })).title).toBe("QB Rankings 2025");
    expect((await meta(qbMeta as Gen)).title).toBe("QB Rankings 2026");
    vi.mocked(getAvailableSeasons).mockResolvedValue([]);
    expect((await meta(qbMeta as Gen)).title).toBe("QB Rankings 2026");
  });

  it("past-season titles on the other season pages", async () => {
    expect((await meta(teamsMeta as Gen, { season: "2024" })).title).toBe("NFL Team Tiers 2024");
    expect((await meta(receiversMeta as Gen, { season: "2024" })).title).toBe("Receiver Rankings 2024");
    expect((await meta(rushingMeta as Gen, { season: "2024" })).title).toBe("Rushing Stats 2024");
    expect((await meta(trendsMeta as Gen, { season: "2024" })).title).toBe("Stat Surge Detector 2024");
  });

  it("run-gaps title names the team and season", async () => {
    expect((await meta(runGapsMeta as Gen, { team: "BUF", season: "2025" })).title).toBe(
      "Buffalo Bills Run Gap Analysis 2025",
    );
  });
});
