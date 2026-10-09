import { describe, it, expect, beforeEach, vi } from "vitest";

// lib/data/compare-card.ts (compare card spec 2026-10-09 §4, §6.1; PR 2): the
// two loaders behind the comparison share card. The page reads per player; the
// image route reads NOTHING per pair (three one-minute memos). Both hand what
// they read to one decision, so they agree about every pair's state.
vi.mock("@/lib/data/queries", () => ({
  getSeasonWeeks: vi.fn(),
  getQBStats: vi.fn(),
  getAvailableSeasons: vi.fn(),
  fallbackSeason: () => 2026,
}));
vi.mock("@/lib/data/receivers", () => ({ getReceiverStats: vi.fn() }));
vi.mock("@/lib/data/rushing", () => ({ getRBSeasonStats: vi.fn() }));
vi.mock("@/lib/data/players", () => ({ getPlayerBySlug: vi.fn(), getPlayerSlugIndex: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ hasNoDatabase: vi.fn(() => false) }));

import rowsJson from "../stats/fixtures/compare-2026-w4-rows.json";
import {
  loadCompareCardForImage, loadCompareCardForPage, clearCompareCardMemo, compareCardMemoKeys,
} from "@/lib/data/compare-card";
import { getSeasonWeeks, getQBStats } from "@/lib/data/queries";
import { getReceiverStats } from "@/lib/data/receivers";
import { getRBSeasonStats } from "@/lib/data/rushing";
import { getPlayerBySlug, getPlayerSlugIndex } from "@/lib/data/players";
import { hasNoDatabase } from "@/lib/supabase/server";

type Row = Record<string, unknown>;
const QB = rowsJson.qb as Row[];
const REC = rowsJson.receivers as Row[];
const RB = rowsJson.rb as Row[];
const WEEKS = [{ season: 2026, through_week: 4 }, { season: 2025, through_week: 22 }, { season: 2024, through_week: 22 }];

const P = (slug: string, player_id: string, player_name: string, position: string, current_team_id: string) =>
  ({ slug, player_id, player_name, position, current_team_id });
const PLAYERS = [
  P("josh-allen", "00-0034857", "Josh Allen", "QB", "BUF"),
  P("matthew-stafford", "00-0026498", "Matthew Stafford", "QB", "LA"),
  P("tyler-huntley", "00-0035993", "Tyler Huntley", "QB", "BAL"),
  P("ceedee-lamb", "00-0036358", "CeeDee Lamb", "WR", "DAL"),
  P("jaxon-smith-njigba", "00-0038543", "Jaxon Smith-Njigba", "WR", "SEA"),
  P("trey-mcbride", "00-0037744", "Trey McBride", "TE", "ARI"),
  P("bijan-robinson", "00-0038542", "Bijan Robinson", "RB", "ATL"),
  P("jahmyr-gibbs", "00-0039139", "Jahmyr Gibbs", "RB", "DET"),
  // Real players with no 2026 row in these tables.
  P("rookie-qb", "00-0099999", "Rookie Quarterback", "QB", "NYJ"),
  P("other-rookie", "00-0099998", "Other Rookie", "QB", "NYG"),
  P("some-kicker", "00-0088888", "Some Kicker", "K", "BUF"),
  P("some-fullback", "00-0038542", "Some Fullback", "FB", "ATL"),
];
const INDEX = new Map(PLAYERS.map((p) => [p.slug, p]));

const reads = () => ({
  weeks: vi.mocked(getSeasonWeeks).mock.calls.length,
  index: vi.mocked(getPlayerSlugIndex).mock.calls.length,
  bySlug: vi.mocked(getPlayerBySlug).mock.calls.length,
  qb: vi.mocked(getQBStats).mock.calls.length,
  rec: vi.mocked(getReceiverStats).mock.calls.length,
  rb: vi.mocked(getRBSeasonStats).mock.calls.length,
});
const NONE = { weeks: 0, index: 0, bySlug: 0, qb: 0, rec: 0, rb: 0 };

beforeEach(() => {
  clearCompareCardMemo();
  for (const fn of [getSeasonWeeks, getQBStats, getReceiverStats, getRBSeasonStats, getPlayerBySlug, getPlayerSlugIndex]) vi.mocked(fn).mockReset();
  vi.mocked(hasNoDatabase).mockReturnValue(false);
  vi.mocked(getSeasonWeeks).mockResolvedValue(WEEKS);
  vi.mocked(getPlayerSlugIndex).mockResolvedValue(INDEX as never);
  vi.mocked(getPlayerBySlug).mockImplementation(async (slug: string) => (INDEX.get(slug) ?? null) as never);
  vi.mocked(getQBStats).mockResolvedValue(QB as never);
  vi.mocked(getReceiverStats).mockResolvedValue(REC as never);
  vi.mocked(getRBSeasonStats).mockResolvedValue(RB as never);
});

const image = (a: string, b: string, season: number | null = null) => loadCompareCardForImage({ a, b }, season);
const page = (a: string, b: string, season: number | null = null) => loadCompareCardForPage({ a, b }, season);

describe.each([["image", image], ["page", page]] as const)("the %s loader: every state", (_name, load) => {
  it("both players have stats: the card, for the newest season when none is asked for", async () => {
    const got = await load("josh-allen", "matthew-stafford");
    if (got.state !== "ready") throw new Error(got.state);
    expect(got.season).toBe(2026);
    expect(got.defaultSeason).toBe(2026);
    expect(got.model.a.fullName).toBe("Josh Allen");
    expect(got.model.b.fullName).toBe("Matthew Stafford");
    expect(got.model.throughWeek).toBe(4);
    expect([got.model.a.ovr, got.model.b.ovr]).toEqual([91, 76]);
    expect(got.model.subBandLine).toBe(
      "2026 season · Through Week 4 · Radar: percentile among the 42 qualified quarterbacks (14+ pass attempts a game).");
  });

  it("order is kept: the mirrored URL is the mirrored card", async () => {
    const ab = await load("josh-allen", "matthew-stafford");
    const ba = await load("matthew-stafford", "josh-allen");
    if (ab.state !== "ready" || ba.state !== "ready") throw new Error("not ready");
    expect(ba.model.a.fullName).toBe("Matthew Stafford");
    expect(ba.model.comparison.a.values).toEqual(ab.model.comparison.b.values);
    expect(ba.model.rows.map((r) => r.a)).toEqual(ab.model.rows.map((r) => r.b));
  });

  it("a WR and a TE share a table: a card, each in his own pool", async () => {
    const got = await load("ceedee-lamb", "trey-mcbride");
    if (got.state !== "ready") throw new Error(got.state);
    expect(got.model.poolLine).toBe("Radar: each player against qualified players at his position (2+ targets a game): 129 WRs, 56 TEs.");
  });

  it("a fullback is compared in the running back table", async () => {
    const got = await load("some-fullback", "jahmyr-gibbs");
    expect(got.state).toBe("ready");
  });

  it("a past season: that season's rows and week", async () => {
    const got = await load("josh-allen", "matthew-stafford", 2025);
    if (got.state !== "ready") throw new Error(got.state);
    expect(got.season).toBe(2025);
    expect(got.defaultSeason).toBe(2026);
    expect(got.model.seasonLine).toBe("2025 season · Through Week 22");
    expect(vi.mocked(getQBStats)).toHaveBeenCalledWith(2025);
  });

  it("one player has no stats for the season: a message, never a card", async () => {
    const got = await load("josh-allen", "rookie-qb");
    expect(got).toMatchObject({
      state: "no-stats", season: 2026, nameA: "Josh Allen", nameB: "Rookie Quarterback", missingA: false, missingB: true,
      message: "Rookie Quarterback has no 2026 stats yet, so there is nothing to compare. Comparisons update the day after each game.",
    });
  });

  it("neither has: both are named; for a past season the sentence makes no promise", async () => {
    expect(await load("rookie-qb", "other-rookie")).toMatchObject({
      state: "no-stats", missingA: true, missingB: true,
      message: "Rookie Quarterback and Other Rookie have no 2026 stats yet, so there is nothing to compare. Comparisons update the day after each game.",
    });
    expect(await load("josh-allen", "rookie-qb", 2025)).toMatchObject({
      state: "no-stats", season: 2025,
      message: "Rookie Quarterback has no stats for the 2025 season, so there is nothing to compare.",
    });
  });

  it("different position groups, or a position with no table: no card, and it never can be one (stored)", async () => {
    for (const [a, b] of [["josh-allen", "ceedee-lamb"], ["ceedee-lamb", "bijan-robinson"], ["some-kicker", "josh-allen"], ["josh-allen", "some-kicker"]]) {
      expect(await load(a, b), `${a}/${b}`).toMatchObject({ state: "not-found", stored: true });
    }
    // No season table was read for any of them.
    expect([reads().qb, reads().rec, reads().rb]).toEqual([0, 0, 0]);
  });

  it("two slugs that name one player: no card", async () => {
    expect(await load("bijan-robinson", "some-fullback")).toMatchObject({ state: "not-found", stored: true });
  });

  it("an unknown slug: no card today, but it may be one tomorrow (not stored), and no season table is read", async () => {
    expect(await load("josh-allen", "nobody-at-all")).toMatchObject({ state: "not-found", stored: false });
    expect(await load("nobody-at-all", "josh-allen")).toMatchObject({ state: "not-found", stored: false });
    expect([reads().qb, reads().rec, reads().rb]).toEqual([0, 0, 0]);
  });

  it("a season the site does not have: not found, not stored, no season table read", async () => {
    expect(await load("josh-allen", "matthew-stafford", 2019)).toMatchObject({ state: "not-found", stored: false });
    expect([reads().qb, reads().rec, reads().rb]).toEqual([0, 0, 0]);
  });

  it("a failed read rejects: seasons, the players, or the season table", async () => {
    vi.mocked(getQBStats).mockRejectedValue(new Error("Failed to fetch QB stats: TypeError: fetch failed"));
    await expect(load("josh-allen", "matthew-stafford")).rejects.toThrow(/Failed to fetch QB stats/);
    clearCompareCardMemo();
    vi.mocked(getSeasonWeeks).mockRejectedValue(new Error("Failed to fetch season weeks: timeout"));
    await expect(load("josh-allen", "matthew-stafford")).rejects.toThrow(/season weeks/);
    clearCompareCardMemo();
    vi.mocked(getSeasonWeeks).mockResolvedValue(WEEKS);
    vi.mocked(getPlayerSlugIndex).mockRejectedValue(new Error("Failed to fetch player slug index: boom"));
    vi.mocked(getPlayerBySlug).mockRejectedValue(new Error("Failed to fetch player josh-allen: boom"));
    await expect(load("josh-allen", "matthew-stafford")).rejects.toThrow(/Failed to fetch player/);
  });

  it("an empty answer that cannot be true is a failed read too: no seasons, or no rows for a season the site has", async () => {
    vi.mocked(getQBStats).mockResolvedValue([]);
    await expect(load("josh-allen", "matthew-stafford")).rejects.toThrow(/returned no rows for 2026/);
    clearCompareCardMemo();
    vi.mocked(getSeasonWeeks).mockResolvedValue([]);
    await expect(load("josh-allen", "matthew-stafford")).rejects.toThrow(/no seasons from data_freshness/);
  });

  it("with no database at all (CI, a placeholder build) nothing throws: an unknown pair is just not found", async () => {
    vi.mocked(hasNoDatabase).mockReturnValue(true);
    vi.mocked(getSeasonWeeks).mockResolvedValue([]);
    vi.mocked(getPlayerSlugIndex).mockResolvedValue(new Map() as never);
    vi.mocked(getPlayerBySlug).mockResolvedValue(null);
    expect(await load("josh-allen", "matthew-stafford")).toMatchObject({ state: "not-found", stored: false });
  });
});

describe("the page loader's reads", () => {
  it("one wave of three (seasons and the two players), then the season table: four reads, none of the slug list", async () => {
    await page("josh-allen", "matthew-stafford");
    expect(reads()).toEqual({ ...NONE, weeks: 1, bySlug: 2, qb: 1 });
    expect(vi.mocked(getPlayerBySlug).mock.calls.map((c) => c[0])).toEqual(["josh-allen", "matthew-stafford"]);
  });

  it("the three first reads start together, before any of them answers", async () => {
    let release: (v: typeof WEEKS) => void = () => {};
    vi.mocked(getSeasonWeeks).mockReturnValue(new Promise((r) => { release = r; }));
    const pending = page("josh-allen", "matthew-stafford");
    await Promise.resolve();
    expect(reads()).toMatchObject({ weeks: 1, bySlug: 2, qb: 0 });
    release(WEEKS);
    expect((await pending).state).toBe("ready");
  });

  it("an unknown player, or a pair that is not comparable: the season table is never read", async () => {
    await page("josh-allen", "nobody-at-all");
    await page("josh-allen", "ceedee-lamb");
    expect([reads().qb, reads().rec, reads().rb]).toEqual([0, 0, 0]);
  });
});

describe("the image loader makes no per-pair read", () => {
  it("cold: the seasons, the slug list and one season table; never a per-player read", async () => {
    await image("josh-allen", "matthew-stafford");
    expect(reads()).toEqual({ ...NONE, weeks: 1, index: 1, qb: 1 });
  });

  it("warm: NO read at all, for the same pair, the mirrored pair, or any other pair of the group", async () => {
    await image("josh-allen", "matthew-stafford");
    const before = reads();
    await image("josh-allen", "matthew-stafford");
    await image("matthew-stafford", "josh-allen");
    await image("tyler-huntley", "josh-allen");
    await image("josh-allen", "rookie-qb");
    expect(reads()).toEqual(before);
  });

  it("the memo keys are the seasons, the slug list and (group, season): never a slug, never a pair", async () => {
    await image("josh-allen", "matthew-stafford");
    await image("tyler-huntley", "josh-allen");
    expect(compareCardMemoKeys()).toEqual(["QB:2026", "seasons", "slugs"]);
    await image("ceedee-lamb", "trey-mcbride");
    await image("bijan-robinson", "jahmyr-gibbs");
    await image("josh-allen", "matthew-stafford", 2025);
    expect(compareCardMemoKeys()).toEqual(["QB:2025", "QB:2026", "RB:2026", "WR:2026", "seasons", "slugs"]);
    for (const key of compareCardMemoKeys()) expect(key).not.toMatch(/allen|stafford|lamb|-/);
  });

  it("a season the site lacks: the seasons only; the slug list is not even read, and no key is added", async () => {
    expect((await image("josh-allen", "matthew-stafford", 2019)).state).toBe("not-found");
    expect(reads()).toEqual({ ...NONE, weeks: 1 });
    expect(compareCardMemoKeys()).toEqual(["seasons"]);
  });

  it("an unknown slug costs nothing once warm, and adds no key", async () => {
    await image("josh-allen", "matthew-stafford");
    const before = reads();
    const keys = compareCardMemoKeys();
    for (const slug of ["nobody-at-all", "another-nobody", "x", "zz-top"]) {
      expect((await image("josh-allen", slug)).state).toBe("not-found");
    }
    expect(reads()).toEqual(before);
    expect(compareCardMemoKeys()).toEqual(keys);
  });

  it("an empty slug list on a real database is a failed read, never a minute of 'not found' for every player", async () => {
    vi.mocked(getPlayerSlugIndex).mockResolvedValue(new Map() as never);
    await expect(image("josh-allen", "matthew-stafford")).rejects.toThrow(/player slug list came back empty/);
  });

  it("requests arriving together share one read of each; a failed read is not kept", async () => {
    const all = await Promise.all([
      image("josh-allen", "matthew-stafford"), image("matthew-stafford", "josh-allen"), image("tyler-huntley", "josh-allen"),
    ]);
    expect(all.map((r) => r.state)).toEqual(["ready", "ready", "ready"]);
    expect(reads()).toEqual({ ...NONE, weeks: 1, index: 1, qb: 1 });

    clearCompareCardMemo();
    vi.mocked(getQBStats).mockRejectedValueOnce(new Error("Failed to fetch QB stats: timeout"));
    await expect(image("josh-allen", "matthew-stafford")).rejects.toThrow(/timeout/);
    // The rejection was dropped: the next request reads again and succeeds.
    expect((await image("josh-allen", "matthew-stafford")).state).toBe("ready");
  });

  it("the memo lasts a minute", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-10-09T12:00:00Z"));
      await image("josh-allen", "matthew-stafford");
      vi.setSystemTime(new Date("2026-10-09T12:00:59Z"));
      await image("josh-allen", "matthew-stafford");
      expect(reads()).toEqual({ ...NONE, weeks: 1, index: 1, qb: 1 });
      vi.setSystemTime(new Date("2026-10-09T12:01:01Z"));
      await image("josh-allen", "matthew-stafford");
      expect(reads()).toEqual({ ...NONE, weeks: 2, index: 2, qb: 2 });
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("page and image agree", () => {
  it("the same model for the same pair, read two different ways", async () => {
    const a = await page("ceedee-lamb", "jaxon-smith-njigba");
    const b = await image("ceedee-lamb", "jaxon-smith-njigba");
    expect(b).toEqual(a);
  });
});
