// lib/data/matchup-season.ts (matchup card spec 2026-10-11 §3, §4.1 step 3):
// the season a 308 keeps, shared by the matchup page and the matchup share
// page. It is the matchup page's own `listedSeason`, moved out unchanged, in a
// module of its own so a test that mocks lib/data/matchup still runs the real
// function.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

vi.mock("@/lib/data/compare-card", () => ({ getSeasonWeeksCached: vi.fn() }));

import { listedMatchupSeason } from "@/lib/data/matchup-season";
import { getSeasonWeeksCached } from "@/lib/data/compare-card";

const WHAT = "Matchup card (BUF at LA)";
let errorSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  vi.mocked(getSeasonWeeksCached).mockReset();
  vi.mocked(getSeasonWeeksCached).mockResolvedValue([{ season: 2026, through_week: 4 }, { season: 2025, through_week: 22 }] as never);
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  errorSpy.mockRestore();
});

describe("listedMatchupSeason", () => {
  it("no season asked for: null, and nothing is read", async () => {
    expect(await listedMatchupSeason(null, WHAT)).toBeNull();
    expect(getSeasonWeeksCached).not.toHaveBeenCalled();
  });

  it("a season the site lists is kept; one it does not list is dropped; one read of the memoised list each", async () => {
    expect(await listedMatchupSeason(2025, WHAT)).toBe(2025);
    expect(await listedMatchupSeason(2026, WHAT)).toBe(2026);
    expect(await listedMatchupSeason(2031, WHAT)).toBeNull();
    expect(getSeasonWeeksCached).toHaveBeenCalledTimes(3);
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it("the list cannot be read: the season is dropped and one line is logged under the caller's label", async () => {
    vi.mocked(getSeasonWeeksCached).mockRejectedValue(new Error("Failed to fetch season weeks"));
    expect(await listedMatchupSeason(2025, WHAT)).toBeNull();
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(String(errorSpy.mock.calls[0][0])).toBe(
      "Matchup card (BUF at LA): the season list could not be read for a redirect; the season was left out of the address",
    );
  });

  it("an empty or junk list drops the season, without throwing", async () => {
    for (const answer of [[], null, undefined, "x", 7, [null, { season: "2025" }], [{ through_week: 4 }]]) {
      vi.mocked(getSeasonWeeksCached).mockResolvedValue(answer as never);
      expect(await listedMatchupSeason(2025, WHAT)).toBeNull();
    }
    expect(errorSpy).not.toHaveBeenCalled();
  });
});

describe("where it lives", () => {
  const read = (rel: string) => readFileSync(join(process.cwd(), rel), "utf8");

  it("imports only getSeasonWeeksCached from lib/data/compare-card (so a test that mocks lib/data/matchup still runs it)", () => {
    const specs = Array.from(read("lib/data/matchup-season.ts").matchAll(/from\s+["']([^"']+)["']/g)).map((m) => m[1]);
    expect(specs).toEqual(["@/lib/data/compare-card"]);
  });

  it("the matchup page uses it and no longer has a copy of its own", () => {
    const page = read("app/matchup/[away]/[home]/page.tsx");
    expect(page).toContain('from "@/lib/data/matchup-season"');
    expect(page).not.toMatch(/function listedSeason\(/);
    expect(page).not.toContain('from "@/lib/data/compare-card"');
  });
});
