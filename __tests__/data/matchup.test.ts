import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// lib/data/matchup.ts (team matchup spec 2026-10-10 §6): the one loader behind
// /matchup/[away]/[home] and its metadata, and the one behind /matchup. Every
// read goes through a one-minute memo keyed only by a season (or `seasons`,
// `slugs`, `GROUP:season`): nothing is ever read, or keyed, per team or pair.
// The lowest loaders are replaced here, so the real memos are exercised.
vi.mock("@/lib/data/queries", () => ({
  getSeasonWeeks: vi.fn(),
  getQBStats: vi.fn(),
  getAvailableSeasons: vi.fn(),
  fallbackSeason: () => 2026,
}));
vi.mock("@/lib/data/receivers", () => ({ getReceiverStats: vi.fn() }));
vi.mock("@/lib/data/rushing", () => ({ getRBSeasonStats: vi.fn() }));
vi.mock("@/lib/data/players", () => ({ getPlayerBySlug: vi.fn(), getPlayerSlugIndex: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ hasNoDatabase: vi.fn(() => false), createServerClient: vi.fn() }));
vi.mock("@/lib/data/utils", async (original) => ({
  ...(await original<typeof import("@/lib/data/utils")>()),
  fetchAllRows: vi.fn(),
}));
vi.mock("@/lib/data/games", async (original) => ({
  ...(await original<typeof import("@/lib/data/games")>()),
  getSeasonGames: vi.fn(),
}));
vi.mock("@/lib/data/box-score", async (original) => ({
  ...(await original<typeof import("@/lib/data/box-score")>()),
  getBoxScoreSeasonsCached: vi.fn(),
}));

import statsRowsJson from "../stats/fixtures/team-game-stats-2026-w1-3.json";
import radarRowsJson from "../stats/fixtures/team-radar-2026-w1-3.json";
import playerRowsJson from "../stats/fixtures/compare-2026-w4-rows.json";
import {
  MATCHUP_COLUMNS,
  MATCHUP_NUMERIC,
  clearMatchupMemo,
  easternToday,
  getMatchupRows,
  getMatchupRowsCached,
  getSeasonGamesCached,
  loadMatchup,
  loadMatchupIndex,
  matchupMemoKeys,
} from "@/lib/data/matchup";
import { TEAM_STATS_COLUMNS } from "@/lib/data/team-stats";
import { TEAM_RADAR_COLUMNS } from "@/lib/data/team-radar";
import { TEAM_GAME_NUMERIC, getBoxScoreSeasonsCached } from "@/lib/data/box-score";
import { clearCompareCardMemo, compareCardMemoKeys } from "@/lib/data/compare-card";
import { getSeasonGames, type GameRecord } from "@/lib/data/games";
import { getSeasonWeeks, getQBStats } from "@/lib/data/queries";
import { getReceiverStats } from "@/lib/data/receivers";
import { getRBSeasonStats } from "@/lib/data/rushing";
import { getPlayerSlugIndex } from "@/lib/data/players";
import { fetchAllRows } from "@/lib/data/utils";
import { hasNoDatabase } from "@/lib/supabase/server";
import { buildMatchup, currentSlate } from "@/lib/stats/matchup";

type Row = Record<string, unknown>;
const RADAR_BY_KEY = new Map((radarRowsJson as Row[]).map((r) => [`${r.game_id}|${r.team_id}`, r]));
/** The 35-column rows: the two frozen fixtures joined by (game_id, team_id). */
const ROWS: Row[] = (statsRowsJson as Row[]).map((r) => ({ ...r, ...RADAR_BY_KEY.get(`${r.game_id}|${r.team_id}`) }));
const QB = playerRowsJson.qb as unknown as Row[];
const REC = playerRowsJson.receivers as unknown as Row[];
const RB = playerRowsJson.rb as unknown as Row[];
const WEEKS = [{ season: 2026, through_week: 4 }, { season: 2025, through_week: 22 }, { season: 2024, through_week: 22 }];
const NOW = "2026-10-08T16:00:00Z";

const game = (over: Partial<GameRecord>): GameRecord => ({
  game_id: "2026_05_BUF_LA", season: 2026, game_type: "REG", week: 5, gameday: "2026-10-11", weekday: "Sunday",
  gametime: "13:00", home_team: "LA", away_team: "BUF", home_score: null, away_score: null, ...over,
});
const GAMES: GameRecord[] = [
  game({ game_id: "2026_01_BUF_HOU", week: 1, gameday: "2026-09-13", away_team: "BUF", home_team: "HOU", away_score: 27, home_score: 20 }),
  game({ game_id: "2026_04_DET_NO", week: 4, gameday: "2026-10-04", away_team: "DET", home_team: "NO", away_score: 31, home_score: 17 }),
  game({ game_id: "2026_05_NE_BUF", week: 5, away_team: "NE", home_team: "BUF" }),
  game({ game_id: "2026_05_KC_DEN", week: 5, gametime: "16:25", away_team: "KC", home_team: "DEN" }),
  game({ game_id: "2026_15_BUF_NE", week: 15, gameday: "2026-12-20", away_team: "BUF", home_team: "NE" }),
];

const slug = (s: string, player_id: string, player_name: string, position: string, current_team_id: string) =>
  ({ slug: s, player_id, player_name, position, current_team_id });
const INDEX = new Map(
  [
    slug("josh-allen", "00-0034857", "Josh Allen", "QB", "BUF"),
    slug("james-cook", "00-0037248", "James Cook", "RB", "BUF"),
    slug("jared-goff", "00-0033106", "Jared Goff", "QB", "DET"),
  ].map((p) => [p.slug, p]),
);

const reads = () => ({
  weeks: vi.mocked(getSeasonWeeks).mock.calls.length,
  index: vi.mocked(getPlayerSlugIndex).mock.calls.length,
  rows: vi.mocked(fetchAllRows).mock.calls.length,
  games: vi.mocked(getSeasonGames).mock.calls.length,
  qb: vi.mocked(getQBStats).mock.calls.length,
  rb: vi.mocked(getRBSeasonStats).mock.calls.length,
  rec: vi.mocked(getReceiverStats).mock.calls.length,
  probe: vi.mocked(getBoxScoreSeasonsCached).mock.calls.length,
});
const NONE = { weeks: 0, index: 0, rows: 0, games: 0, qb: 0, rb: 0, rec: 0, probe: 0 };
const COLD = { ...NONE, weeks: 1, index: 1, rows: 1, games: 1, qb: 1, rb: 1, rec: 1 };

let errorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  clearMatchupMemo();
  clearCompareCardMemo();
  for (const fn of [getSeasonWeeks, getQBStats, getReceiverStats, getRBSeasonStats, getPlayerSlugIndex, fetchAllRows, getSeasonGames, getBoxScoreSeasonsCached]) {
    vi.mocked(fn).mockReset();
  }
  vi.mocked(hasNoDatabase).mockReturnValue(false);
  vi.mocked(getSeasonWeeks).mockResolvedValue(WEEKS);
  vi.mocked(getPlayerSlugIndex).mockResolvedValue(INDEX as never);
  vi.mocked(getQBStats).mockResolvedValue(QB as never);
  vi.mocked(getReceiverStats).mockResolvedValue(REC as never);
  vi.mocked(getRBSeasonStats).mockResolvedValue(RB as never);
  // team_game_stats holds 2026 only; the schedule has every season.
  vi.mocked(fetchAllRows).mockImplementation(async (_table, _select, filters) => (filters.season === 2026 ? ROWS : []));
  vi.mocked(getSeasonGames).mockResolvedValue(GAMES);
  vi.mocked(getBoxScoreSeasonsCached).mockResolvedValue([2026]);
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  // The loader hands the schedule rules today's date (US Eastern), so the
  // clock is pinned: Thursday of week 5, before any of GAMES' unplayed games.
  // Only Date is faked; setTimeout stays real.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(NOW));
});

afterEach(() => {
  errorSpy.mockRestore();
  vi.useRealTimers();
});

describe("MATCHUP_COLUMNS (§6.1)", () => {
  it("is the union of the Team Stats list and the radar list: 35 names, none twice", () => {
    const union = Array.from(new Set<string>([...TEAM_STATS_COLUMNS, ...TEAM_RADAR_COLUMNS]));
    expect(MATCHUP_COLUMNS).toHaveLength(35);
    expect(new Set(MATCHUP_COLUMNS).size).toBe(35);
    expect([...MATCHUP_COLUMNS].sort()).toEqual(union.sort());
  });

  it("is the Team Stats list plus the five radar-only columns, in that order", () => {
    expect(MATCHUP_COLUMNS.slice(0, TEAM_STATS_COLUMNS.length)).toEqual([...TEAM_STATS_COLUMNS]);
    expect(MATCHUP_COLUMNS.slice(TEAM_STATS_COLUMNS.length)).toEqual(["attempts", "sacks", "total_drives", "designed_runs", "stuffed_runs"]);
  });

  it("is what the joined fixture rows hold", () => {
    for (const r of ROWS) expect(Object.keys(r).sort()).toEqual([...MATCHUP_COLUMNS].sort());
  });

  it("the numeric-parse list is the filtered one, never the full list", () => {
    expect(MATCHUP_NUMERIC).toEqual(TEAM_GAME_NUMERIC.filter((c) => (MATCHUP_COLUMNS as readonly string[]).includes(c)));
    expect(MATCHUP_NUMERIC.length).toBeGreaterThan(0);
    expect(MATCHUP_NUMERIC.length).toBeLessThan(TEAM_GAME_NUMERIC.length);
    for (const c of MATCHUP_NUMERIC) expect(MATCHUP_COLUMNS as readonly string[]).toContain(c);
  });
});

describe("getMatchupRows (§6.1)", () => {
  it("reads team_game_stats for the season: the 35 columns, both order columns and a signal", async () => {
    await getMatchupRows(2026);
    expect(fetchAllRows).toHaveBeenCalledTimes(1);
    const [table, select, filters, options] = vi.mocked(fetchAllRows).mock.calls[0];
    expect(table).toBe("team_game_stats");
    expect(select).toBe(MATCHUP_COLUMNS.join(","));
    expect(filters).toEqual({ season: 2026 });
    expect(options!.order).toEqual(["game_id", "team_id"]);
    expect(options!.signal).toBeInstanceOf(AbortSignal);
  });

  it("passes a caller's own signal on", async () => {
    const signal = AbortSignal.timeout(5000);
    await getMatchupRows(2026, { signal });
    expect(vi.mocked(fetchAllRows).mock.calls[0][3]!.signal).toBe(signal);
  });

  it("parses the NUMERIC columns (strings from PostgREST) and adds no column the read did not select", async () => {
    const asStrings = ROWS.map((r) => ({ ...r, epa_per_play: String(r.epa_per_play), pass_success_rate: "NaN" }));
    vi.mocked(fetchAllRows).mockResolvedValue(asStrings);
    const got = (await getMatchupRows(2026)) as unknown as Row[];
    expect(got).toHaveLength(94);
    expect(got[0].epa_per_play).toBe(ROWS[0].epa_per_play);
    expect(got[0].pass_success_rate).toBeNull();
    for (const r of got) expect(Object.keys(r).sort()).toEqual([...MATCHUP_COLUMNS].sort());
  });

  it("[] when the read succeeds with no rows", async () => {
    expect(await getMatchupRows(2025)).toEqual([]);
  });

  it("a rejection (the raw PostgREST object) becomes an Error through queryError", async () => {
    vi.mocked(fetchAllRows).mockRejectedValue({ message: "TypeError: fetch failed", code: "" });
    const err = await getMatchupRows(2026).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toBe("Failed to fetch matchup rows for 2026: TypeError: fetch failed");
  });
});

describe("the two memos (§6.1, §6.5)", () => {
  it("getMatchupRowsCached reads a season once a minute", async () => {
    expect(await getMatchupRowsCached(2026)).toHaveLength(94);
    await getMatchupRowsCached(2026);
    expect(reads().rows).toBe(1);
    await getMatchupRowsCached(2025);
    expect(reads().rows).toBe(2);
  });

  it("getSeasonGamesCached reads a season's games once a minute", async () => {
    expect(await getSeasonGamesCached(2026)).toEqual(GAMES);
    await getSeasonGamesCached(2026);
    expect(reads().games).toBe(1);
    expect(getSeasonGames).toHaveBeenCalledWith(2026);
  });

  it("callers arriving together share one read", async () => {
    await Promise.all([getMatchupRowsCached(2026), getMatchupRowsCached(2026), getSeasonGamesCached(2026), getSeasonGamesCached(2026)]);
    expect(reads()).toMatchObject({ rows: 1, games: 1 });
  });

  it("a minute later the read is made again", async () => {
    vi.useFakeTimers();
    await getMatchupRowsCached(2026);
    vi.setSystemTime(Date.now() + 59_000);
    await getMatchupRowsCached(2026);
    expect(reads().rows).toBe(1);
    vi.setSystemTime(Date.now() + 2_000);
    await getMatchupRowsCached(2026);
    expect(reads().rows).toBe(2);
  });
});

describe("loadMatchup: the ready page (§6.3)", () => {
  it("returns plain data for the newest season when none is asked for", async () => {
    const got = await loadMatchup("BUF", "HOU", null);
    expect(got.state).toBe("ready");
    expect(got).toMatchObject({
      season: 2026, defaultSeason: 2026, isLatestSeason: true, swap: false, playersAvailable: true, gamesAvailable: true,
    });
    expect(got.game).toEqual(GAMES[0]);
    expect(got.records).toEqual({ away: { wins: 1, losses: 0, ties: 0 }, home: { wins: 0, losses: 1, ties: 0 } });
    expect(JSON.parse(JSON.stringify(got))).toEqual(got);
  });

  it("the model is buildMatchup over the season's rows", async () => {
    const got = await loadMatchup("BUF", "HOU", null);
    expect(got.model).toEqual(buildMatchup({ rows: ROWS, season: 2026, awayId: "BUF", homeId: "HOU" }));
    expect(got.model!.awayBall!.ladder.rows).toHaveLength(13);
  });

  it("the lineup: 7 mirrored rows, names and links from the slug list (by player id), unlinked without a slug", async () => {
    const got = await loadMatchup("BUF", "DET", null);
    expect(got.lineup).toHaveLength(7);
    expect(got.lineup![0].away).toMatchObject({ name: "Josh Allen", href: "/player/josh-allen", pos: "QB" });
    expect(got.lineup![0].home).toMatchObject({ name: "Jared Goff", href: "/player/jared-goff" });
    expect(got.lineup![1].away).toMatchObject({ name: "James Cook", href: "/player/james-cook" });
    expect(got.lineup![1].home).toMatchObject({ name: "J.Gibbs", href: null });
    expect(got.lineup!.map((r) => r.pos)).toEqual(["QB", "RB", "RB", "WR", "WR/TE", "TE/WR", "WR"]);
  });

  it("the order asked for is kept: the mirrored URL is the mirrored page", async () => {
    const ab = await loadMatchup("BUF", "DET", null);
    const ba = await loadMatchup("DET", "BUF", null);
    expect(ba.model!.awayBall).toEqual(ab.model!.homeBall);
    expect(ba.lineup!.map((r) => r.away?.playerId)).toEqual(ab.lineup!.map((r) => r.home?.playerId));
  });

  it("the only game is in the other order: swap, no game for this order", async () => {
    const got = await loadMatchup("HOU", "BUF", null);
    expect(got).toMatchObject({ swap: true, game: null, gamesAvailable: true });
    expect(got.records).toEqual({ away: { wins: 0, losses: 1, ties: 0 }, home: { wins: 1, losses: 0, ties: 0 } });
  });

  it("both orders exist (division rivals): no swap, each order its own game", async () => {
    expect(await loadMatchup("NE", "BUF", null)).toMatchObject({ swap: false, game: { game_id: "2026_05_NE_BUF" } });
    expect(await loadMatchup("BUF", "NE", null)).toMatchObject({ swap: false, game: { game_id: "2026_15_BUF_NE" } });
  });

  it("no game between the two: no swap, no game, the records still there", async () => {
    const got = await loadMatchup("BUF", "DET", null);
    expect(got).toMatchObject({ swap: false, game: null, gamesAvailable: true });
    expect(got.records).toEqual({ away: { wins: 1, losses: 0, ties: 0 }, home: { wins: 1, losses: 0, ties: 0 } });
  });

  it("fewer than 8 teams played: small-pool, with the header, the lineup and no ladders", async () => {
    const ids = Array.from(new Set(ROWS.map((r) => r.team_id as string))).sort().slice(0, 7);
    vi.mocked(fetchAllRows).mockResolvedValue(ROWS.filter((r) => ids.includes(r.team_id as string)));
    const got = await loadMatchup("BUF", "HOU", null);
    expect(got.state).toBe("small-pool");
    expect(got.model).toMatchObject({ state: "small-pool", awayBall: null, homeBall: null, teamsPlayed: 7 });
    expect(got.lineup).toHaveLength(7);
    expect(got.game).toEqual(GAMES[0]);
  });

  it("a team id that is not a team does not throw (the route answers 404 before this)", async () => {
    const got = await loadMatchup("XXX", "HOU", null);
    expect(got.state).toBe("ready");
    expect(got.model!.away).toEqual({ id: "XXX", games: 0 });
    expect(got.lineup![0].away).toBeNull();
  });
});

describe("loadMatchup: the season (§4.1 step 5)", () => {
  it("a requested season in the list is used", async () => {
    vi.mocked(fetchAllRows).mockImplementation(async (_t, _s, filters) => (filters.season === 2025 ? ROWS.map((r) => ({ ...r, season: 2025 })) : []));
    const got = await loadMatchup("BUF", "HOU", 2025);
    expect(got).toMatchObject({ state: "ready", season: 2025, defaultSeason: 2026, isLatestSeason: false });
    expect(vi.mocked(fetchAllRows).mock.calls[0][2]).toEqual({ season: 2025 });
    expect(getSeasonGames).toHaveBeenCalledWith(2025);
    expect(getQBStats).toHaveBeenCalledWith(2025);
    expect(getRBSeasonStats).toHaveBeenCalledWith(2025);
    expect(getReceiverStats).toHaveBeenCalledWith(2025);
  });

  it("a past season's player links carry ?season=", async () => {
    vi.mocked(fetchAllRows).mockImplementation(async () => ROWS.map((r) => ({ ...r, season: 2025 })));
    const got = await loadMatchup("BUF", "HOU", 2025);
    expect(got.lineup![0].away!.href).toBe("/player/josh-allen?season=2025");
  });

  it.each([[2031], [1999], [2100], [0], [NaN], [-2026], [2025.5]])(
    "a requested season that is not in the list (%s) is the default season, and nothing is read or keyed for it",
    async (requested) => {
      const got = await loadMatchup("BUF", "HOU", requested);
      expect(got).toMatchObject({ state: "ready", season: 2026, defaultSeason: 2026, isLatestSeason: true });
      expect(vi.mocked(fetchAllRows).mock.calls.map((c) => c[2])).toEqual([{ season: 2026 }]);
      expect(matchupMemoKeys()).toEqual(["games:2026", "rows:2026"]);
    },
  );

  it("the requested newest season is the default season", async () => {
    expect(await loadMatchup("BUF", "HOU", 2026)).toMatchObject({ season: 2026, isLatestSeason: true });
  });
});

describe("loadMatchup: reads counted (§6.5)", () => {
  it("cold: seven loader calls, one of each, in two waves; warm: none", async () => {
    await loadMatchup("BUF", "HOU", null);
    expect(reads()).toEqual(COLD);
    await loadMatchup("BUF", "HOU", null);
    expect(reads()).toEqual(COLD);
  });

  it("the seasons and the slug list are started together, before either answers; then everything else at once", async () => {
    let releaseWeeks: (v: typeof WEEKS) => void = () => {};
    vi.mocked(getSeasonWeeks).mockReturnValue(new Promise((r) => { releaseWeeks = r; }));
    const pending = loadMatchup("BUF", "HOU", null);
    await Promise.resolve();
    expect(reads()).toEqual({ ...NONE, weeks: 1, index: 1 });
    releaseWeeks(WEEKS);
    await pending;
    expect(reads()).toEqual(COLD);
  });

  it("the second wave is one wave: the rows, the games and the three tables are all started before any answers", async () => {
    let releaseRows: (v: Row[]) => void = () => {};
    vi.mocked(fetchAllRows).mockReturnValue(new Promise((r) => { releaseRows = r; }));
    const pending = loadMatchup("BUF", "HOU", null);
    await new Promise((r) => setTimeout(r, 0));
    expect(reads()).toEqual(COLD);
    releaseRows(ROWS);
    expect((await pending).state).toBe("ready");
  });

  it("a second pair in the same season costs nothing", async () => {
    await loadMatchup("BUF", "HOU", null);
    await loadMatchup("DET", "NO", null);
    await loadMatchup("NO", "DET", null);
    await loadMatchup("KC", "DEN", 2026);
    expect(reads()).toEqual(COLD);
  });

  it("200 different pairs: still the same seven reads, and no memo key per team or pair", async () => {
    const ids = Array.from(new Set(ROWS.map((r) => r.team_id as string))).sort();
    let n = 0;
    for (const a of ids) {
      for (const b of ids) {
        if (a === b || n >= 200) continue;
        await loadMatchup(a, b, null);
        n += 1;
      }
    }
    expect(n).toBe(200);
    expect(reads()).toEqual(COLD);
    expect(matchupMemoKeys()).toEqual(["games:2026", "rows:2026"]);
    expect(compareCardMemoKeys()).toEqual(["QB:2026", "RB:2026", "WR:2026", "seasons", "slugs"]);
  });

  it("every memo key is season-shaped", async () => {
    await loadMatchup("BUF", "HOU", null);
    await loadMatchup("DET", "NO", 2025).catch(() => {});
    await loadMatchupIndex();
    for (const key of matchupMemoKeys()) expect(key).toMatch(/^(rows|games):\d{4}$/);
    for (const key of compareCardMemoKeys()) expect(key).toMatch(/^(seasons|slugs|(QB|RB|WR):\d{4})$/);
    for (const key of [...matchupMemoKeys(), ...compareCardMemoKeys()]) expect(key).not.toMatch(/BUF|HOU|DET|NO\b/);
  });

  it("it shares the compare card's memos: reads the compare card made are not made again", async () => {
    const { loadCompareCardForPage } = await import("@/lib/data/compare-card");
    await loadCompareCardForPage({ a: "josh-allen", b: "jared-goff" }, null);
    expect(reads()).toEqual({ ...NONE, weeks: 1, index: 1, qb: 1 });
    await loadMatchup("BUF", "HOU", null);
    expect(reads()).toEqual(COLD);
  });
});

describe("loadMatchup: core reads throw (§6.3 step 4, read resilience)", () => {
  it("the seasons read rejects: the load rejects, and nothing else is awaited into a page", async () => {
    vi.mocked(getSeasonWeeks).mockRejectedValue(new Error("Failed to fetch season weeks: 500"));
    await expect(loadMatchup("BUF", "HOU", null)).rejects.toThrow(/season weeks/);
    expect(reads()).toMatchObject({ rows: 0, games: 0, qb: 0 });
  });

  it("the seasons list is empty on a real database: throws", async () => {
    vi.mocked(getSeasonWeeks).mockResolvedValue([]);
    await expect(loadMatchup("BUF", "HOU", null)).rejects.toThrow(/no seasons from data_freshness/);
    expect(reads().rows).toBe(0);
  });

  it("the rows read rejects: throws an Error naming the read", async () => {
    vi.mocked(fetchAllRows).mockRejectedValue({ message: "TypeError: fetch failed" });
    await expect(loadMatchup("BUF", "HOU", null)).rejects.toThrow("Failed to fetch matchup rows for 2026: TypeError: fetch failed");
  });

  it("no rows for the newest season: throws (a read failing silently), without probing", async () => {
    vi.mocked(fetchAllRows).mockResolvedValue([]);
    await expect(loadMatchup("BUF", "HOU", null)).rejects.toThrow(/2026 is the newest season .* no team_game_stats rows/);
    expect(reads().probe).toBe(0);
  });

  it("no rows for a past season the probe says is covered: throws", async () => {
    vi.mocked(getBoxScoreSeasonsCached).mockResolvedValue([2026, 2025]);
    await expect(loadMatchup("BUF", "HOU", 2025)).rejects.toThrow(/team_game_stats has rows for 2025 but the season read returned none/);
    expect(reads().probe).toBe(1);
  });

  it("no rows for a past season and the probe fails: throws (never the vaguer message as a success)", async () => {
    vi.mocked(getBoxScoreSeasonsCached).mockRejectedValue(new Error("Failed to fetch box score seasons: 500"));
    await expect(loadMatchup("BUF", "HOU", 2025)).rejects.toThrow(/box score seasons/);
  });

  it("a failed core read is not retried within ten seconds, and is retried after", async () => {
    vi.useFakeTimers();
    vi.mocked(fetchAllRows).mockRejectedValue({ message: "TypeError: fetch failed" });
    await expect(loadMatchup("BUF", "HOU", null)).rejects.toThrow(/matchup rows/);
    await expect(loadMatchup("BUF", "HOU", null)).rejects.toThrow(/matchup rows/);
    await expect(loadMatchup("DET", "NO", null)).rejects.toThrow(/matchup rows/);
    expect(reads().rows).toBe(1);
    vi.setSystemTime(Date.now() + 10_001);
    vi.mocked(fetchAllRows).mockResolvedValue(ROWS);
    expect((await loadMatchup("BUF", "HOU", null)).state).toBe("ready");
    expect(reads().rows).toBe(2);
  });

  it("a rejected core read leaves no unhandled rejection behind from the reads it was started with", async () => {
    const seen: unknown[] = [];
    const onUnhandled = (e: unknown) => seen.push(e);
    process.on("unhandledRejection", onUnhandled);
    try {
      vi.mocked(getSeasonWeeks).mockRejectedValue(new Error("Failed to fetch season weeks: 500"));
      vi.mocked(getPlayerSlugIndex).mockRejectedValue(new Error("Failed to fetch player slug index: 500"));
      await expect(loadMatchup("BUF", "HOU", null)).rejects.toThrow(/season weeks/);
      clearCompareCardMemo();
      vi.mocked(getSeasonWeeks).mockResolvedValue(WEEKS);
      vi.mocked(fetchAllRows).mockRejectedValue({ message: "boom" });
      vi.mocked(getSeasonGames).mockRejectedValue(new Error("Failed to fetch games for 2026: 500"));
      vi.mocked(getQBStats).mockRejectedValue(new Error("Failed to fetch QB stats: 500"));
      await expect(loadMatchup("BUF", "HOU", null)).rejects.toThrow(/matchup rows/);
      await new Promise((r) => setTimeout(r, 10));
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
    expect(seen).toEqual([]);
  });
});

describe("loadMatchup: an uncovered season (§6.3 step 5)", () => {
  it("a listed past season with no rows that the probe does not cover: uncovered, with the first covered season", async () => {
    const got = await loadMatchup("BUF", "HOU", 2025);
    expect(got).toMatchObject({ state: "uncovered", season: 2025, defaultSeason: 2026, isLatestSeason: false, firstSeason: 2026, model: null });
    expect(reads().probe).toBe(1);
    expect(getBoxScoreSeasonsCached).toHaveBeenCalledWith([2026, 2025, 2024]);
  });

  it("without a first season when nothing is covered, or the season is after the first covered one", async () => {
    vi.mocked(getBoxScoreSeasonsCached).mockResolvedValue([]);
    expect(await loadMatchup("BUF", "HOU", 2025)).toMatchObject({ state: "uncovered", firstSeason: null });
    clearMatchupMemo();
    vi.mocked(getBoxScoreSeasonsCached).mockResolvedValue([2024]);
    expect(await loadMatchup("BUF", "HOU", 2025)).toMatchObject({ state: "uncovered", firstSeason: null });
  });

  it("still carries the header's data: the game, the swap flag and the records of that season", async () => {
    const got = await loadMatchup("HOU", "BUF", 2025);
    expect(got).toMatchObject({ state: "uncovered", swap: true, game: null, gamesAvailable: true });
    expect(getSeasonGames).toHaveBeenCalledWith(2025);
  });

  it("the probe is asked only on the empty-rows path", async () => {
    await loadMatchup("BUF", "HOU", null);
    expect(reads().probe).toBe(0);
  });
});

describe("loadMatchup: reads that may degrade (§6.3 step 4), each with a log line", () => {
  it("the games read rejects: gamesAvailable false, no game, no swap, no records; the page still loads", async () => {
    vi.mocked(getSeasonGames).mockRejectedValue(new Error("Failed to fetch games for 2026: 500"));
    const got = await loadMatchup("HOU", "BUF", null);
    expect(got).toMatchObject({ state: "ready", gamesAvailable: false, game: null, swap: false, records: null, playersAvailable: true });
    expect(got.model!.awayBall!.ladder.rows).toHaveLength(13);
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(String(errorSpy.mock.calls[0][0])).toMatch(/games/i);
  });

  it.each([
    ["QB", getQBStats], ["RB", getRBSeasonStats], ["receiver", getReceiverStats],
  ] as const)("the %s table rejects: playersAvailable false and no lineup at all (never a lineup with a position missing)", async (_name, fn) => {
    vi.mocked(fn).mockRejectedValue(new Error("Failed to fetch a season table: 500"));
    const got = await loadMatchup("BUF", "HOU", null);
    expect(got).toMatchObject({ state: "ready", playersAvailable: false, lineup: null, gamesAvailable: true });
    expect(got.game).toEqual(GAMES[0]);
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(String(errorSpy.mock.calls[0][0])).toMatch(/player/i);
  });

  it("an EMPTY season table for a listed season on a real database is that read failing", async () => {
    vi.mocked(getRBSeasonStats).mockResolvedValue([]);
    const got = await loadMatchup("BUF", "HOU", null);
    expect(got).toMatchObject({ playersAvailable: false, lineup: null });
    expect(errorSpy).toHaveBeenCalledTimes(1);
  });

  it("the slug list rejects: the players are there, with href null, and it is logged", async () => {
    vi.mocked(getPlayerSlugIndex).mockRejectedValue(new Error("Failed to fetch player slug index: 500"));
    const got = await loadMatchup("BUF", "HOU", null);
    expect(got).toMatchObject({ playersAvailable: true });
    expect(got.lineup).toHaveLength(7);
    for (const row of got.lineup!) {
      if (row.away) expect(row.away.href).toBeNull();
      if (row.home) expect(row.home.href).toBeNull();
    }
    expect(got.lineup![0].away!.name).toBe("J.Allen");
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(String(errorSpy.mock.calls[0][0])).toMatch(/slug/i);
  });

  it("everything that may degrade fails at once: still a ready page, three log lines", async () => {
    vi.mocked(getSeasonGames).mockRejectedValue(new Error("games"));
    vi.mocked(getQBStats).mockRejectedValue(new Error("qb"));
    vi.mocked(getPlayerSlugIndex).mockRejectedValue(new Error("slugs"));
    const got = await loadMatchup("BUF", "HOU", null);
    expect(got).toMatchObject({ state: "ready", gamesAvailable: false, playersAvailable: false, lineup: null, records: null });
    expect(errorSpy).toHaveBeenCalledTimes(3);
  });

  it("a healthy load logs nothing", async () => {
    await loadMatchup("BUF", "HOU", null);
    expect(errorSpy).not.toHaveBeenCalled();
  });
});

describe("loadMatchup: no database (CI, the placeholder build)", () => {
  it("an empty seasons list does not throw by itself: the season is the fallback, and the page's reads decide", async () => {
    vi.mocked(hasNoDatabase).mockReturnValue(true);
    vi.mocked(getSeasonWeeks).mockResolvedValue([]);
    vi.mocked(fetchAllRows).mockResolvedValue(ROWS);
    const got = await loadMatchup("BUF", "HOU", 2025);
    expect(got).toMatchObject({ state: "ready", season: 2026, defaultSeason: 2026 });
  });

  it("with no seasons and no rows it throws rather than render an empty matchup", async () => {
    vi.mocked(hasNoDatabase).mockReturnValue(true);
    vi.mocked(getSeasonWeeks).mockResolvedValue([]);
    vi.mocked(fetchAllRows).mockResolvedValue([]);
    await expect(loadMatchup("BUF", "HOU", null)).rejects.toThrow(/no seasons/);
  });
});

describe("loadMatchupIndex (§6.1): /matchup", () => {
  it("the slate of the newest season, from two reads", async () => {
    const got = await loadMatchupIndex();
    expect(got.season).toBe(2026);
    expect(got.gamesAvailable).toBe(true);
    expect(got.slate).toEqual(currentSlate(GAMES));
    expect(got.slate!.label).toBe("Week 5");
    expect(got.slate!.games.map((g) => g.game_id)).toEqual(["2026_05_NE_BUF", "2026_05_KC_DEN"]);
    expect(getSeasonGames).toHaveBeenCalledWith(2026);
    expect(reads()).toEqual({ ...NONE, weeks: 1, games: 1 });
  });

  it("warm, it reads nothing; and it shares both memos with the matchup page", async () => {
    await loadMatchupIndex();
    await loadMatchupIndex();
    expect(reads()).toEqual({ ...NONE, weeks: 1, games: 1 });
    await loadMatchup("BUF", "HOU", null);
    expect(reads()).toEqual(COLD);
  });

  it("no unplayed game in the season: no slate, with the games available", async () => {
    vi.mocked(getSeasonGames).mockResolvedValue(GAMES.slice(0, 2));
    expect(await loadMatchupIndex()).toEqual({ season: 2026, slate: null, gamesAvailable: true });
  });

  it("a failed seasons read rejects", async () => {
    vi.mocked(getSeasonWeeks).mockRejectedValue(new Error("Failed to fetch season weeks: 500"));
    await expect(loadMatchupIndex()).rejects.toThrow(/season weeks/);
    expect(reads().games).toBe(0);
  });

  it("an empty seasons list on a real database rejects", async () => {
    vi.mocked(getSeasonWeeks).mockResolvedValue([]);
    await expect(loadMatchupIndex()).rejects.toThrow(/no seasons from data_freshness/);
  });

  it("a failed games read resolves: no slate, gamesAvailable false, one console.error", async () => {
    vi.mocked(getSeasonGames).mockRejectedValue(new Error("Failed to fetch games for 2026: 500"));
    expect(await loadMatchupIndex()).toEqual({ season: 2026, slate: null, gamesAvailable: false });
    expect(errorSpy).toHaveBeenCalledTimes(1);
  });

  it("no database: the fallback season, and a failed games read still resolves", async () => {
    vi.mocked(hasNoDatabase).mockReturnValue(true);
    vi.mocked(getSeasonWeeks).mockResolvedValue([]);
    vi.mocked(getSeasonGames).mockRejectedValue(new Error("no database"));
    expect(await loadMatchupIndex()).toEqual({ season: 2026, slate: null, gamesAvailable: false });
  });
});

/* ─── Chaos pass, PR 1 (spec §17, findings F1-F3, F5, F6) ─── */

describe("chaos F1: the loader supplies the date, US Eastern, per call", () => {
  it("easternToday reads the calendar day in New York, not UTC and not the machine's zone", () => {
    expect(easternToday(new Date("2026-10-15T03:59:00Z"))).toBe("2026-10-14"); // 11:59 PM EDT
    expect(easternToday(new Date("2026-10-15T04:00:00Z"))).toBe("2026-10-15"); // midnight EDT
    expect(easternToday(new Date("2027-01-01T04:59:00Z"))).toBe("2026-12-31"); // 11:59 PM EST
    expect(easternToday(new Date("2027-01-01T05:00:00Z"))).toBe("2027-01-01");
    expect(easternToday()).toBe("2026-10-08");
  });

  it("a never-played row more than two days old is not the pair's game, and the answer follows the clock across midnight with the games still memoised", async () => {
    const old = game({ game_id: "2026_05_KC_DEN", week: 5, gameday: "2026-10-11", away_team: "KC", home_team: "DEN" });
    vi.mocked(getSeasonGames).mockResolvedValue([GAMES[0], old]);
    vi.setSystemTime(new Date("2026-10-14T03:59:40Z")); // Oct 13, 11:59:40 PM Eastern: two days after
    expect((await loadMatchup("KC", "DEN", null)).game).toEqual(old);
    vi.setSystemTime(new Date("2026-10-14T04:00:10Z")); // thirty seconds later, Oct 14 Eastern: three days after
    const got = await loadMatchup("KC", "DEN", null);
    expect(got).toMatchObject({ game: null, swap: false, gamesAvailable: true });
    expect(reads().games).toBe(1);
  });

  it("/matchup's slate moves on from a week that only holds a never-played row", async () => {
    const list = [
      game({ game_id: "p5", week: 5, gameday: "2026-10-11", away_team: "NYJ", home_team: "NE", away_score: 10, home_score: 20 }),
      game({ game_id: "stale5", week: 5, gameday: "2026-10-11", away_team: "SF", home_team: "SEA" }),
      game({ game_id: "u6", week: 6, gameday: "2026-10-18", away_team: "KC", home_team: "DEN" }),
    ];
    vi.mocked(getSeasonGames).mockResolvedValue(list);
    vi.setSystemTime(new Date("2026-10-12T16:00:00Z"));
    expect((await loadMatchupIndex()).slate!.label).toBe("Week 5");
    vi.setSystemTime(new Date("2026-10-12T16:00:30Z"));
    expect((await loadMatchupIndex()).slate!.label).toBe("Week 5");
    clearMatchupMemo();
    clearCompareCardMemo();
    vi.setSystemTime(new Date("2026-10-14T16:00:00Z"));
    const got = await loadMatchupIndex();
    expect(got.slate!.label).toBe("Week 6");
    expect(got.slate!.games.map((g) => g.game_id)).toEqual(["u6"]);
  });
});

describe("chaos F2: an empty games answer for a season that has stats is a failed read", () => {
  it.each([
    ["an empty list", []],
    ["rows that are not games", [null, {}, 5, { home_team: "BUF", away_team: "BUF" }]],
    ["not a list at all", null],
  ])("%s: gamesAvailable false, no records, one log line; the page still loads", async (_name, value) => {
    vi.mocked(getSeasonGames).mockResolvedValue(value as never);
    const got = await loadMatchup("BUF", "HOU", null);
    expect(got).toMatchObject({ state: "ready", gamesAvailable: false, game: null, swap: false, records: null, playersAvailable: true });
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(String(errorSpy.mock.calls[0][0])).toMatch(/games/i);
  });

  it("/matchup: no slate and gamesAvailable false (M16, never M14), one log line", async () => {
    vi.mocked(getSeasonGames).mockResolvedValue([]);
    expect(await loadMatchupIndex()).toEqual({ season: 2026, slate: null, gamesAvailable: false });
    expect(errorSpy).toHaveBeenCalledTimes(1);
  });

  it("a past season with no stats may really have no schedule rows: not a failure there", async () => {
    vi.mocked(getSeasonGames).mockResolvedValue([]);
    const got = await loadMatchup("BUF", "HOU", 2025);
    expect(got).toMatchObject({ state: "uncovered", gamesAvailable: true, game: null, swap: false });
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it("F5: the empty answer is kept ten seconds, not a minute", async () => {
    vi.mocked(getSeasonGames).mockResolvedValueOnce([]).mockResolvedValue(GAMES);
    expect((await loadMatchup("BUF", "HOU", null)).gamesAvailable).toBe(false);
    vi.setSystemTime(Date.now() + 5_000);
    expect((await loadMatchup("BUF", "HOU", null)).gamesAvailable).toBe(false);
    expect((await loadMatchupIndex()).gamesAvailable).toBe(false);
    expect(reads().games).toBe(1);
    vi.setSystemTime(Date.now() + 5_001);
    expect(await loadMatchup("BUF", "HOU", null)).toMatchObject({ gamesAvailable: true, game: { game_id: "2026_01_BUF_HOU" } });
    expect(reads().games).toBe(2);
  });
});

describe("chaos F3: rows that come back but cannot be used are a failed read, never the early-season page", () => {
  it.each([
    ["every row is another season's", ROWS.map((r) => ({ ...r, season: 2025 }))],
    ["every row is empty", ROWS.map(() => ({}))],
    ["no row names a team", ROWS.map((r) => ({ ...r, team_id: null }))],
    ["the rows are not objects", [null, 5, "row"]],
  ])("%s: throws", async (_name, rows) => {
    vi.mocked(fetchAllRows).mockResolvedValue(rows as never);
    await expect(loadMatchup("BUF", "HOU", null)).rejects.toThrow(/none of them is usable|no team_game_stats rows/);
  });

  it("a real early season (rows for 7 teams) is still the small-pool page", async () => {
    const ids = Array.from(new Set(ROWS.map((r) => r.team_id as string))).sort().slice(0, 7);
    vi.mocked(fetchAllRows).mockResolvedValue(ROWS.filter((r) => ids.includes(r.team_id as string)));
    expect((await loadMatchup("BUF", "HOU", null)).state).toBe("small-pool");
  });

  it("junk rows among good ones are dropped, not fatal", async () => {
    vi.mocked(fetchAllRows).mockResolvedValue([null, {}, 7, ...ROWS] as never);
    const got = await loadMatchup("BUF", "HOU", null);
    expect(got.state).toBe("ready");
    expect(got.model!.teamsPlayed).toBe(32);
  });
});

describe("chaos F5: a resolved-but-unusable answer is not kept for the success window", () => {
  it("empty rows for the newest season: ten seconds of the same error with no new read, then recovery", async () => {
    vi.mocked(fetchAllRows).mockResolvedValueOnce([]).mockResolvedValue(ROWS);
    await expect(loadMatchup("BUF", "HOU", null)).rejects.toThrow(/newest season/);
    vi.setSystemTime(Date.now() + 9_000);
    await expect(loadMatchup("DET", "NO", null)).rejects.toThrow(/newest season/);
    expect(reads().rows).toBe(1);
    vi.setSystemTime(Date.now() + 1_001);
    expect((await loadMatchup("BUF", "HOU", null)).state).toBe("ready");
    expect(reads().rows).toBe(2);
  });

  it("unusable rows: the same", async () => {
    vi.mocked(fetchAllRows).mockResolvedValueOnce(ROWS.map(() => ({}))).mockResolvedValue(ROWS);
    await expect(loadMatchup("BUF", "HOU", null)).rejects.toThrow(/usable/);
    await expect(loadMatchup("BUF", "HOU", null)).rejects.toThrow(/usable/);
    expect(reads().rows).toBe(1);
    vi.setSystemTime(Date.now() + 10_001);
    expect((await loadMatchup("BUF", "HOU", null)).state).toBe("ready");
  });

  it("a legitimately empty past season (uncovered) is still kept for the minute", async () => {
    await loadMatchup("BUF", "HOU", 2025);
    vi.setSystemTime(Date.now() + 30_000);
    expect((await loadMatchup("BUF", "HOU", 2025)).state).toBe("uncovered");
    expect(reads().rows).toBe(1);
  });

  it("an empty player table: unavailable for ten seconds with no new read, then back", async () => {
    vi.mocked(getRBSeasonStats).mockResolvedValueOnce([]).mockResolvedValue(RB as never);
    expect((await loadMatchup("BUF", "HOU", null)).playersAvailable).toBe(false);
    vi.setSystemTime(Date.now() + 5_000);
    expect((await loadMatchup("BUF", "HOU", null)).playersAvailable).toBe(false);
    expect(reads().rb).toBe(1);
    vi.setSystemTime(Date.now() + 5_001);
    const got = await loadMatchup("BUF", "HOU", null);
    expect(got.playersAvailable).toBe(true);
    expect(got.lineup).toHaveLength(7);
    expect(reads()).toMatchObject({ rb: 2, qb: 1, rec: 1 });
  });
});

describe("chaos F6: a may-degrade read that resolves with the wrong kind of thing degrades", () => {
  it.each([
    ["QB", getQBStats], ["RB", getRBSeasonStats], ["receiver", getReceiverStats],
  ] as const)("the %s table resolves null, a string, or only junk rows: no lineup, one log line, the page loads", async (_name, fn) => {
    for (const value of [null, "rows", { length: 3 }, [null], [{}], [{ player_id: "" }, 7]]) {
      clearCompareCardMemo();
      errorSpy.mockClear();
      vi.mocked(fn).mockResolvedValue(value as never);
      const got = await loadMatchup("BUF", "HOU", null);
      expect(got, JSON.stringify(value)).toMatchObject({ state: "ready", playersAvailable: false, lineup: null, gamesAvailable: true });
      expect(errorSpy).toHaveBeenCalledTimes(1);
    }
  });

  it("junk rows among real ones are dropped before the lineup is built", async () => {
    vi.mocked(getQBStats).mockResolvedValue([null, {}, 7, ...QB] as never);
    vi.mocked(getReceiverStats).mockResolvedValue([undefined, "x", ...REC] as never);
    const got = await loadMatchup("BUF", "DET", null);
    expect(got.playersAvailable).toBe(true);
    expect(got.lineup![0].away).toMatchObject({ name: "Josh Allen" });
    expect(got.lineup!.map((r) => r.pos)).toEqual(["QB", "RB", "RB", "WR", "WR/TE", "TE/WR", "WR"]);
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it.each([[null], ["slugs"], [{}], [[]]])("the slug list resolves %j (not a Map): names unlinked, one log line", async (value) => {
    vi.mocked(getPlayerSlugIndex).mockResolvedValue(value as never);
    const got = await loadMatchup("BUF", "HOU", null);
    expect(got).toMatchObject({ state: "ready", playersAvailable: true });
    expect(got.lineup![0].away).toMatchObject({ name: "J.Allen", href: null });
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(String(errorSpy.mock.calls[0][0])).toMatch(/slug/i);
  });

  it("a slug list with junk entries: the good ones still link", async () => {
    const index = new Map<string, unknown>([...Array.from(INDEX.entries()), ["x", null], ["y", 5], ["z", { player_id: 7 }]]);
    vi.mocked(getPlayerSlugIndex).mockResolvedValue(index as never);
    const got = await loadMatchup("BUF", "HOU", null);
    expect(got.lineup![0].away).toMatchObject({ name: "Josh Allen", href: "/player/josh-allen" });
    expect(errorSpy).not.toHaveBeenCalled();
  });
});
