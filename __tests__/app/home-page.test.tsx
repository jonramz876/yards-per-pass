import fs from "fs";
import path from "path";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render } from "@testing-library/react";
import type {
  TeamSeasonStat,
  QBSeasonStat,
  ReceiverSeasonStat,
  RBSeasonStat,
  DataFreshness,
  PlayerSlug,
} from "@/lib/types";

vi.mock("@/lib/data/queries", () => ({
  getAvailableSeasons: vi.fn(),
  getDataFreshness: vi.fn(),
  getTeamStats: vi.fn(),
  getQBStats: vi.fn(),
  fallbackSeason: () => 2026,
}));
vi.mock("@/lib/data/receivers", () => ({ getReceiverStats: vi.fn() }));
vi.mock("@/lib/data/rushing", () => ({ getRBSeasonStats: vi.fn() }));
vi.mock("@/lib/data/players", () => ({ getPlayerSlugsByIds: vi.fn() }));
vi.mock("@/lib/data/games", () => ({ hasScheduleForSeason: vi.fn() }));

import HomePage from "@/app/page";
import {
  getAvailableSeasons,
  getDataFreshness,
  getTeamStats,
  getQBStats,
} from "@/lib/data/queries";
import { getReceiverStats } from "@/lib/data/receivers";
import { getRBSeasonStats } from "@/lib/data/rushing";
import { getPlayerSlugsByIds } from "@/lib/data/players";
import { hasScheduleForSeason } from "@/lib/data/games";

/** A team_season_stats row (same shape as the TecmoStandings test helper). */
function stat(teamId: string, over: Partial<TeamSeasonStat> = {}): TeamSeasonStat {
  return {
    id: `${teamId}-2026`,
    team_id: teamId,
    season: 2026,
    off_epa_play: 0,
    def_epa_play: 0,
    off_pass_epa: 0,
    off_rush_epa: 0,
    def_pass_epa: 0,
    def_rush_epa: 0,
    off_success_rate: 0.45,
    def_success_rate: 0.45,
    pass_rate: 0.6,
    plays: 1000,
    wins: 0,
    losses: 0,
    ties: 0,
    takeaways: null,
    giveaways: null,
    turnover_diff: null,
    ...over,
  };
}

/** The live week-1 2026 rows. */
const TEAMS: TeamSeasonStat[] = [
  stat("SEA", { wins: 1, losses: 0, def_epa_play: -0.25 }),
  stat("SF", { wins: 1, losses: 0, def_epa_play: -0.1 }),
  stat("NE", { wins: 0, losses: 1, def_epa_play: 0.12 }),
  stat("LA", { wins: 0, losses: 1, def_epa_play: 0.2 }),
];

const FRESH = { season: 2026, through_week: 1, last_updated: "2026-09-14T13:22:00+00:00" };

const REAL_URL = "https://abcdefghijklmnop.supabase.co";

/** The four stats reads (freshness and seasons are checked separately). */
function statsMocks() {
  return [
    vi.mocked(getTeamStats),
    vi.mocked(getQBStats),
    vi.mocked(getReceiverStats),
    vi.mocked(getRBSeasonStats),
  ];
}

function expectEmptyShell(container: HTMLElement) {
  const rows = Array.from(container.querySelectorAll("[data-team-id]"));
  expect(rows).toHaveLength(32);
  for (const row of rows) expect(row.textContent).toContain("0-0");
  expect(container.textContent).not.toContain("Through Week");
  expect(container.querySelector("h1")?.textContent).toContain("Yards Per Pass");
  expect(container.textContent).toMatch(/2026 Standings/i);
}

beforeEach(() => {
  vi.mocked(getAvailableSeasons).mockReset();
  vi.mocked(getDataFreshness).mockReset();
  for (const m of statsMocks()) m.mockReset();
  vi.mocked(getPlayerSlugsByIds).mockReset();
  vi.mocked(hasScheduleForSeason).mockReset();

  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", REAL_URL);

  vi.mocked(getAvailableSeasons).mockResolvedValue([2026, 2025]);
  vi.mocked(getDataFreshness).mockResolvedValue(FRESH);
  vi.mocked(getTeamStats).mockResolvedValue(TEAMS);
  vi.mocked(getQBStats).mockResolvedValue([]);
  vi.mocked(getReceiverStats).mockResolvedValue([]);
  vi.mocked(getRBSeasonStats).mockResolvedValue([]);
  vi.mocked(hasScheduleForSeason).mockResolvedValue(false);
  vi.mocked(getPlayerSlugsByIds).mockResolvedValue([]);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("HomePage", () => {
  it("week-1 state renders; empty player strips are not errors", async () => {
    const { container } = render(await HomePage());
    // Never assert the "Updated" date: it depends on the machine's timezone.
    expect(container.textContent).toContain("Through Week 1");
    expect(container.textContent).toContain("2026 Season");
    expect(container.querySelector('[data-team-id="SEA"]')?.textContent).toContain("1-0");
    expect(container.querySelectorAll("[data-team-id]")).toHaveLength(32);
    // Team Defense strip links use the uppercase id (standings rows are lowercase).
    expect(container.querySelector('a[href="/team/SEA"]')).not.toBeNull();
    expect(vi.mocked(getDataFreshness)).toHaveBeenCalledWith(2026);
    for (const m of statsMocks()) expect(m).toHaveBeenCalledWith(2026);
  });

  it("INCIDENT 2026-09-14: one failing query must not produce a blank board", async () => {
    vi.mocked(getQBStats).mockRejectedValue(
      new Error("Failed to fetch QB stats: TypeError: fetch failed"),
    );
    // Before the fix this resolved to a page with no freshness line and 32
    // rows of 0-0, which ISR cached for an hour.
    await expect(HomePage()).rejects.toThrow("Failed to fetch QB stats");

    // The blip clears; the next render (Vercel's retry) is the full page.
    vi.mocked(getQBStats).mockResolvedValue([]);
    const { container } = render(await HomePage());
    expect(container.textContent).toContain("Through Week 1");
    expect(container.textContent).toContain("2026 Season");
  });

  it.each([
    [
      "getTeamStats rejects",
      () =>
        vi.mocked(getTeamStats).mockRejectedValue(
          new Error("Failed to fetch team stats: TypeError: fetch failed"),
        ),
      "Failed to fetch team stats",
    ],
    [
      "getReceiverStats rejects",
      () =>
        vi.mocked(getReceiverStats).mockRejectedValue(
          new Error("Failed to fetch receiver stats: TypeError: fetch failed"),
        ),
      "Failed to fetch receiver stats",
    ],
    [
      "getRBSeasonStats rejects",
      () =>
        vi.mocked(getRBSeasonStats).mockRejectedValue(
          new Error("rb_season_stats: TypeError: fetch failed"),
        ),
      "rb_season_stats: TypeError: fetch failed",
    ],
    [
      "getDataFreshness resolves null",
      () => vi.mocked(getDataFreshness).mockResolvedValue(null),
      /no data_freshness row for 2026/,
    ],
    [
      "getAvailableSeasons resolves []",
      () => vi.mocked(getAvailableSeasons).mockResolvedValue([]),
      /no seasons/,
    ],
    [
      "getQBStats rejects",
      () =>
        vi.mocked(getQBStats).mockRejectedValue(
          new Error("Failed to fetch QB stats: TypeError: fetch failed"),
        ),
      "Failed to fetch QB stats",
    ],
  ] as const)("%s → throws; no partial or blank page is returned", async (_name, setup, expected) => {
    setup();
    await expect(HomePage()).rejects.toThrow(expected);
  });

  it("rushing's raw PostgREST error object becomes an Error", async () => {
    vi.mocked(getRBSeasonStats).mockRejectedValue({
      message: "TypeError: fetch failed",
      details: "",
      hint: "",
      code: "",
    });
    const err = await HomePage().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toContain("fetch failed");
    expect((err as Error).message).toContain("Homepage data unavailable");
  });

  it("CI placeholder build renders the empty shell, as today", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://placeholder.supabase.co");
    vi.mocked(getAvailableSeasons).mockResolvedValue([]);
    vi.mocked(getDataFreshness).mockResolvedValue(null);
    vi.mocked(getTeamStats).mockRejectedValue(new Error("Failed to fetch team stats: TypeError: fetch failed"));
    vi.mocked(getQBStats).mockRejectedValue(new Error("Failed to fetch QB stats: TypeError: fetch failed"));
    vi.mocked(getReceiverStats).mockRejectedValue(
      new Error("Failed to fetch receiver stats: TypeError: fetch failed"),
    );
    vi.mocked(getRBSeasonStats).mockRejectedValue({ message: "TypeError: fetch failed", details: "", hint: "", code: "" });

    const { container } = render(await HomePage());
    expectEmptyShell(container);
    // The empty seasons list stops the page before the stats reads.
    for (const m of statsMocks()) expect(m).not.toHaveBeenCalled();
  });

  it("no Supabase URL behaves like the placeholder build", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.mocked(getAvailableSeasons).mockRejectedValue(
      new Error(
        "Missing Supabase env vars. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local",
      ),
    );
    const { container } = render(await HomePage());
    expectEmptyShell(container);
  });

  it("look-alike placeholder URLs count as real databases", async () => {
    vi.mocked(getQBStats).mockRejectedValue(new Error("Failed to fetch QB stats: TypeError: fetch failed"));
    for (const url of [
      "https://notplaceholder.supabase.co",
      "https://placeholder.supabase.co.example.com",
      "https://abc.supabase.co/?placeholder",
    ]) {
      vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", url);
      await expect(HomePage(), url).rejects.toThrow("Failed to fetch QB stats");
    }

    // The real placeholder, uppercase with a trailing slash, still renders.
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "HTTPS://PLACEHOLDER.SUPABASE.CO/");
    const { container } = render(await HomePage());
    expect(container.querySelectorAll("[data-team-id]")).toHaveLength(32);
  });

  it("next-season board still renders when next-season team stats fail (unchanged)", async () => {
    vi.mocked(hasScheduleForSeason).mockResolvedValue(true);
    vi.mocked(getTeamStats).mockImplementation(async (s) => {
      if (s === 2027) throw new Error("boom");
      return TEAMS;
    });
    const { container } = render(await HomePage());
    expect(container.textContent).toMatch(/2027 Standings/i);
    expect(container.querySelector('[data-team-id="SEA"]')?.textContent).toContain("0-0");
    // The Team Defense strip keeps using the 2026 rows.
    expect(container.querySelector('a[href="/team/SEA"]')).not.toBeNull();
  });

  it("missing slugs leave leader cards unlinked (unchanged)", async () => {
    // EPA order q1..q6; CPOE order puts q6 first, so the two top-5 lists
    // together cover all six players.
    const qbs = [
      { player_id: "q1", player_name: "D'Andre Test", team_id: "KC", attempts: 150, dropbacks: 150, epa_per_play: 0.3, cpoe: 1 },
      { player_id: "q2", player_name: "Amon-Ra St. Test", team_id: "DET", attempts: 150, dropbacks: 150, epa_per_play: 0.25, cpoe: 2 },
      { player_id: "q3", player_name: "Third Passer", team_id: "BUF", attempts: 150, dropbacks: 150, epa_per_play: 0.2, cpoe: 3 },
      { player_id: "q4", player_name: "Fourth Passer", team_id: "BAL", attempts: 150, dropbacks: 150, epa_per_play: 0.15, cpoe: 4 },
      { player_id: "q5", player_name: "Fifth Passer", team_id: "CIN", attempts: 150, dropbacks: 150, epa_per_play: 0.1, cpoe: 5 },
      { player_id: "q6", player_name: "Sixth Passer", team_id: "LAC", attempts: 150, dropbacks: 150, epa_per_play: 0.05, cpoe: 6 },
    ].map((q) => q as unknown as QBSeasonStat);
    vi.mocked(getQBStats).mockResolvedValue(qbs);

    const { container } = render(await HomePage());
    for (const q of qbs) expect(container.textContent).toContain(q.player_name);
    expect(container.querySelectorAll('a[href^="/player/"]')).toHaveLength(0);

    expect(vi.mocked(getPlayerSlugsByIds)).toHaveBeenCalledTimes(1);
    const ids = vi.mocked(getPlayerSlugsByIds).mock.calls[0][0];
    expect(ids).toHaveLength(6);
    expect(ids).toEqual(expect.arrayContaining(["q1", "q2", "q3", "q4", "q5", "q6"]));
  });
});

/* ------------------------------------------------------------------ */
/*  Leader strips: PFR per-team-game qualifiers                        */
/* ------------------------------------------------------------------ */

/** Rows carry only the fields the homepage reads. */
function qb(id: string, name: string, over: Record<string, unknown>): QBSeasonStat {
  return { player_id: id, player_name: name, team_id: "KC", ...over } as unknown as QBSeasonStat;
}
function wr(id: string, name: string, over: Record<string, unknown>): ReceiverSeasonStat {
  return { player_id: id, player_name: name, team_id: "DET", ...over } as unknown as ReceiverSeasonStat;
}
function rb(id: string, name: string, over: Record<string, unknown>): RBSeasonStat {
  return { player_id: id, player_name: name, team_id: "BAL", ...over } as unknown as RBSeasonStat;
}
function slugRow(playerId: string, slug: string): PlayerSlug {
  return {
    player_id: playerId,
    slug,
    player_name: slug,
    position: "QB",
    current_team_id: "KC",
    headshot_url: null,
    jersey_number: null,
  };
}

/** Freshness through a given week; `undefined` leaves the field out entirely. */
function throughWeek(tw: unknown) {
  const row: Record<string, unknown> = { season: 2026, last_updated: FRESH.last_updated };
  if (tw !== undefined) row.through_week = tw;
  vi.mocked(getDataFreshness).mockResolvedValue(row as unknown as DataFreshness);
}

/** One leader strip, found by its h2 title: subtitle, then card names/values/links in order. */
function strip(container: HTMLElement, title: string) {
  const h2 = Array.from(container.querySelectorAll("h2")).find((h) => h.textContent === title);
  if (!h2) throw new Error(`no strip titled "${title}"`);
  const cards = Array.from(h2.parentElement!.nextElementSibling!.children);
  return {
    subtitle: h2.nextElementSibling?.textContent,
    names: cards.map((c) => c.querySelector("p")?.textContent),
    values: cards.map((c) => c.querySelector(".tabular-nums")?.textContent),
    hrefs: cards.map((c) => c.getAttribute("href")),
  };
}

/** The four bad values a rate can carry into the page (after the fetchers, or from a mock). */
const BAD_VALUES: unknown[] = [NaN, null, "NaN", Infinity];

describe("HomePage leader strips qualify like the leaderboard pages", () => {
  it("Week 2 QBs qualify on 28 attempts (14 per game), not dropbacks, and rank by the metric", async () => {
    throughWeek(2);
    vi.mocked(getQBStats).mockResolvedValue([
      qb("b", "Volume Passer", { team_id: "HOU", attempts: 140, dropbacks: 150, epa_per_play: 0.02, cpoe: -1.5 }),
      qb("a", "Efficient Passer", { team_id: "SF", attempts: 30, dropbacks: 33, epa_per_play: 0.412, cpoe: 6.2 }),
      qb("c", "Boundary Passer", { team_id: "BUF", attempts: 28, dropbacks: 31, epa_per_play: 0.15, cpoe: 2.1 }),
      // Best numbers on the board and 40 dropbacks, but 27 attempts: out.
      qb("d", "Short Passer", { team_id: "NO", attempts: 27, dropbacks: 40, epa_per_play: 0.6, cpoe: 9.9 }),
    ]);

    const { container } = render(await HomePage());
    const eff = strip(container, "QB Efficiency");
    expect(eff.names).toEqual(["Efficient Passer", "Boundary Passer", "Volume Passer"]);
    expect(eff.values[0]).toBe("0.412");
    const acc = strip(container, "QB Accuracy");
    expect(acc.names).toEqual(["Efficient Passer", "Boundary Passer", "Volume Passer"]);
    expect(eff.names).not.toContain("Short Passer");
    expect(acc.names).not.toContain("Short Passer");
  });

  it("Week 2 backs qualify on 13 carries (6.25 per game, rounded)", async () => {
    throughWeek(2);
    vi.mocked(getRBSeasonStats).mockResolvedValue([
      rb("r13", "Thirteen Carries", { carries: 13, epa_per_carry: 0.05 }),
      rb("r12", "Twelve Carries", { carries: 12, epa_per_carry: 0.3 }),
    ]);

    const { container } = render(await HomePage());
    const rush = strip(container, "Rushing Efficiency");
    expect(rush.names).toContain("Thirteen Carries");
    expect(rush.names).not.toContain("Twelve Carries");
  });

  it("Week 2 with no route data ranks receivers by EPA per Target and says so", async () => {
    throughWeek(2);
    const recs = [
      wr("w1", "Alpha Receiver", { targets: 20, routes_run: 0, yards_per_route_run: 0, epa_per_target: 0.2 }),
      wr("w2", "Slot Receiver", { targets: 12, routes_run: null, yards_per_route_run: null, epa_per_target: 0.61 }),
      wr("w3", "Four Targets", { targets: 4, routes_run: null, yards_per_route_run: null, epa_per_target: 0.35 }),
      wr("w4", "Deep Threat", { targets: 9, routes_run: 0, yards_per_route_run: 0, epa_per_target: -0.08 }),
      wr("w5", "Three Targets", { targets: 3, routes_run: null, yards_per_route_run: null, epa_per_target: 0.9 }),
    ];
    vi.mocked(getReceiverStats).mockResolvedValue(recs);

    const { container } = render(await HomePage());
    const rec = strip(container, "Receiving Efficiency");
    expect(rec.subtitle).toBe("EPA per Target");
    expect(container.textContent).not.toContain("Yards Per Route Run");
    expect(rec.names).toEqual(["Slot Receiver", "Four Targets", "Alpha Receiver", "Deep Threat"]);
    expect(rec.values).toEqual(["0.61", "0.35", "0.20", "-0.08"]);
    // The fixture's EPA order is not its targets order.
    const byTargets = recs
      .filter((r) => r.targets >= 4)
      .sort((a, b) => b.targets - a.targets)
      .map((r) => r.player_name);
    expect(rec.names).not.toEqual(byTargets);
    expect(rec.names).toContain("Four Targets");
    expect(rec.names).not.toContain("Three Targets");
  });

  it("Week 2 with route data ranks receivers by Yards Per Route Run, qualifying on targets", async () => {
    throughWeek(2);
    const recs = [
      wr("y1", "Route Runner", { targets: 15, routes_run: 70, yards_per_route_run: 2.1, epa_per_target: 0.2 }),
      wr("y2", "Chain Mover", { targets: 10, routes_run: 55, yards_per_route_run: 1.45, epa_per_target: 0.55 }),
      // 4 targets, 30 routes: in (today's 50-route gate kept it out).
      wr("y3", "Thirty Routes", { targets: 4, routes_run: 30, yards_per_route_run: 1.8, epa_per_target: -0.05 }),
      wr("y4", "Possession Target", { targets: 8, routes_run: 60, yards_per_route_run: 0.95, epa_per_target: 0.4 }),
      // 3 targets, 60 routes: out.
      wr("y5", "Sixty Routes", { targets: 3, routes_run: 60, yards_per_route_run: 3.5, epa_per_target: 0.9 }),
    ];
    vi.mocked(getReceiverStats).mockResolvedValue(recs);

    const { container } = render(await HomePage());
    const rec = strip(container, "Receiving Efficiency");
    expect(rec.subtitle).toBe("Yards Per Route Run");
    expect(rec.names).toEqual(["Route Runner", "Thirty Routes", "Chain Mover", "Possession Target"]);
    expect(rec.values).toEqual(["2.10", "1.80", "1.45", "0.95"]);
    // The fixture's YPRR order is not its EPA-per-target order.
    const byEpa = recs
      .filter((r) => r.targets >= 4)
      .sort((a, b) => b.epa_per_target - a.epa_per_target)
      .map((r) => r.player_name);
    expect(rec.names).not.toEqual(byEpa);
    expect(rec.names).toContain("Thirty Routes");
    expect(rec.names).not.toContain("Sixty Routes");
  });

  it("partial route data (5 of 10 qualified receivers) stays on EPA per Target", async () => {
    throughWeek(2);
    const covered = [2.5, 2.4, 2.3, 2.2, 2.1].map((yprr, i) =>
      wr(`cov${i}`, `Covered Receiver ${i + 1}`, {
        targets: 10,
        routes_run: 50 + i * 5,
        yards_per_route_run: yprr,
        epa_per_target: 0.01 * (i + 1),
      }),
    );
    const uncovered = [0.3, 0.4, 0.5, 0.6, 0.7].map((epa, i) =>
      wr(`unc${i}`, `Uncovered Receiver ${i + 1}`, {
        targets: 10,
        routes_run: i % 2 === 0 ? null : 0,
        yards_per_route_run: i % 2 === 0 ? null : 0,
        epa_per_target: epa,
      }),
    );
    vi.mocked(getReceiverStats).mockResolvedValue([...covered, ...uncovered]);

    const { container } = render(await HomePage());
    const rec = strip(container, "Receiving Efficiency");
    expect(rec.subtitle).toBe("EPA per Target");
    expect(rec.names).toEqual([
      "Uncovered Receiver 5",
      "Uncovered Receiver 4",
      "Uncovered Receiver 3",
      "Uncovered Receiver 2",
      "Uncovered Receiver 1",
    ]);
    expect(rec.values).toEqual(["0.70", "0.60", "0.50", "0.40", "0.30"]);
  });

  it.each([17, 18])(
    "through_week %i: minimums are 238 attempts, 106 carries, 32 targets",
    async (w) => {
      throughWeek(w);
      vi.mocked(getQBStats).mockResolvedValue([
        qb("q238", "Qualified Passer", { attempts: 238, dropbacks: 262, epa_per_play: 0.05, cpoe: 1.0 }),
        qb("q237", "One Short Passer", { team_id: "DAL", attempts: 237, dropbacks: 260, epa_per_play: 0.2, cpoe: 3.0 }),
      ]);
      vi.mocked(getRBSeasonStats).mockResolvedValue([
        rb("r106", "Qualified Back", { carries: 106, epa_per_carry: 0.01 }),
        rb("r105", "One Short Back", { team_id: "PHI", carries: 105, epa_per_carry: 0.1 }),
      ]);
      vi.mocked(getReceiverStats).mockResolvedValue([
        wr("t32", "Qualified Receiver", { targets: 32, routes_run: 400, yards_per_route_run: 1.9, epa_per_target: 0.1 }),
        wr("t31", "One Short Receiver", { team_id: "MIN", targets: 31, routes_run: 380, yards_per_route_run: 2.5, epa_per_target: 0.3 }),
      ]);

      const { container } = render(await HomePage());
      for (const title of ["QB Efficiency", "QB Accuracy"]) {
        const s = strip(container, title);
        expect(s.names, title).toContain("Qualified Passer");
        expect(s.names, title).not.toContain("One Short Passer");
      }
      const rush = strip(container, "Rushing Efficiency");
      expect(rush.names).toContain("Qualified Back");
      expect(rush.names).not.toContain("One Short Back");
      const rec = strip(container, "Receiving Efficiency");
      expect(rec.names).toContain("Qualified Receiver");
      expect(rec.names).not.toContain("One Short Receiver");
    },
  );

  it.each([
    ["undefined", undefined],
    ["null", null],
    ["0", 0],
  ] as const)("through_week %s: one game's minimums (14 attempts, 6 carries, 2 targets)", async (_label, tw) => {
    throughWeek(tw);
    vi.mocked(getQBStats).mockResolvedValue([
      qb("q14", "Fourteen Attempts", { attempts: 14, dropbacks: 16, epa_per_play: 0.05, cpoe: 1.0 }),
      qb("q13", "Thirteen Attempts", { team_id: "DAL", attempts: 13, dropbacks: 15, epa_per_play: 0.2, cpoe: 3.0 }),
    ]);
    vi.mocked(getRBSeasonStats).mockResolvedValue([
      rb("r6", "Six Carries", { carries: 6, epa_per_carry: 0.01 }),
      rb("r5", "Five Carries", { team_id: "PHI", carries: 5, epa_per_carry: 0.1 }),
    ]);
    vi.mocked(getReceiverStats).mockResolvedValue([
      wr("t2", "Two Targets", { targets: 2, routes_run: null, yards_per_route_run: null, epa_per_target: 0.1 }),
      wr("t1", "One Target", { team_id: "MIN", targets: 1, routes_run: null, yards_per_route_run: null, epa_per_target: 0.3 }),
    ]);

    const { container } = render(await HomePage());
    for (const title of ["QB Efficiency", "QB Accuracy"]) {
      const s = strip(container, title);
      expect(s.names, title).toContain("Fourteen Attempts");
      expect(s.names, title).not.toContain("Thirteen Attempts");
    }
    const rush = strip(container, "Rushing Efficiency");
    expect(rush.names).toContain("Six Carries");
    expect(rush.names).not.toContain("Five Carries");
    const rec = strip(container, "Receiving Efficiency");
    expect(rec.names).toContain("Two Targets");
    expect(rec.names).not.toContain("One Target");
  });

  /** Rows with null/NaN volume but clean rates: they must fail the qualifier in every strip. */
  const badVolumeQBs = [null, NaN].map((v, i) =>
    qb(`qv${i}`, `No Attempts Passer ${i + 1}`, { attempts: v, dropbacks: 150, epa_per_play: 0.3, cpoe: 5 }),
  );
  const badVolumeRBs = [null, NaN].map((v, i) =>
    rb(`rv${i}`, `No Carries Back ${i + 1}`, { carries: v, epa_per_carry: 0.3 }),
  );

  it("bad values with route data present: no throw, no bad rows, no NaN/Infinity text", async () => {
    throughWeek(2);
    const badEpaQBs = BAD_VALUES.map((v, i) =>
      qb(`qe${i}`, `Bad EPA Passer ${i + 1}`, { attempts: 120, dropbacks: 130, epa_per_play: v, cpoe: 1.0 }),
    );
    const badCpoeQBs = BAD_VALUES.map((v, i) =>
      qb(`qc${i}`, `Bad CPOE Passer ${i + 1}`, { attempts: 120, dropbacks: 130, epa_per_play: 0.05, cpoe: v }),
    );
    vi.mocked(getQBStats).mockResolvedValue([
      qb("qok", "Clean Passer", { attempts: 120, dropbacks: 130, epa_per_play: 0.1, cpoe: 2.0 }),
      ...badEpaQBs,
      ...badCpoeQBs,
      ...badVolumeQBs,
    ]);
    const badEpaRBs = BAD_VALUES.map((v, i) =>
      rb(`re${i}`, `Bad EPA Back ${i + 1}`, { carries: 60, epa_per_carry: v }),
    );
    vi.mocked(getRBSeasonStats).mockResolvedValue([
      rb("rok", "Clean Back", { carries: 60, epa_per_carry: 0.05 }),
      ...badEpaRBs,
      ...badVolumeRBs,
    ]);
    const badYprrRecs = BAD_VALUES.map((v, i) =>
      wr(`we${i}`, `Bad YPRR Receiver ${i + 1}`, {
        targets: 10,
        routes_run: 60,
        yards_per_route_run: v,
        epa_per_target: 0.2,
      }),
    );
    const badVolumeRecs = [null, NaN].map((v, i) =>
      wr(`wv${i}`, `No Targets Receiver ${i + 1}`, {
        targets: v,
        routes_run: 60,
        yards_per_route_run: 2.5,
        epa_per_target: 0.3,
      }),
    );
    vi.mocked(getReceiverStats).mockResolvedValue([
      wr("wok", "Clean Receiver", { targets: 10, routes_run: 60, yards_per_route_run: 1.5, epa_per_target: 0.1 }),
      ...badYprrRecs,
      ...badVolumeRecs,
    ]);

    const { container } = render(await HomePage());
    const eff = strip(container, "QB Efficiency");
    const acc = strip(container, "QB Accuracy");
    expect(eff.names).toContain("Clean Passer");
    expect(acc.names).toContain("Clean Passer");
    for (const q of badEpaQBs) expect(eff.names).not.toContain(q.player_name);
    for (const q of badCpoeQBs) expect(acc.names).not.toContain(q.player_name);
    for (const q of badVolumeQBs) {
      expect(eff.names).not.toContain(q.player_name);
      expect(acc.names).not.toContain(q.player_name);
    }
    expect(strip(container, "Rushing Efficiency").names).toEqual(["Clean Back"]);
    const rec = strip(container, "Receiving Efficiency");
    expect(rec.subtitle).toBe("Yards Per Route Run");
    expect(rec.names).toEqual(["Clean Receiver"]);
    expect(container.textContent).not.toMatch(/NaN|Infinity/);
  });

  it("bad values with no route data: no throw, no bad rows, no NaN/Infinity text", async () => {
    throughWeek(2);
    vi.mocked(getQBStats).mockResolvedValue([
      qb("qok", "Clean Passer", { attempts: 120, dropbacks: 130, epa_per_play: 0.1, cpoe: 2.0 }),
      ...badVolumeQBs,
    ]);
    vi.mocked(getRBSeasonStats).mockResolvedValue([
      rb("rok", "Clean Back", { carries: 60, epa_per_carry: 0.05 }),
      ...badVolumeRBs,
    ]);
    const badEpaRecs = BAD_VALUES.map((v, i) =>
      wr(`we${i}`, `Bad EPA Receiver ${i + 1}`, {
        targets: 10,
        routes_run: null,
        yards_per_route_run: null,
        epa_per_target: v,
      }),
    );
    const badVolumeRecs = [null, NaN].map((v, i) =>
      wr(`wv${i}`, `No Targets Receiver ${i + 1}`, {
        targets: v,
        routes_run: null,
        yards_per_route_run: null,
        epa_per_target: 0.3,
      }),
    );
    vi.mocked(getReceiverStats).mockResolvedValue([
      wr("wok", "Clean Receiver", { targets: 10, routes_run: null, yards_per_route_run: null, epa_per_target: 0.1 }),
      ...badEpaRecs,
      ...badVolumeRecs,
    ]);

    const { container } = render(await HomePage());
    const eff = strip(container, "QB Efficiency");
    const acc = strip(container, "QB Accuracy");
    expect(eff.names).toEqual(["Clean Passer"]);
    expect(acc.names).toEqual(["Clean Passer"]);
    expect(strip(container, "Rushing Efficiency").names).toEqual(["Clean Back"]);
    const rec = strip(container, "Receiving Efficiency");
    expect(rec.subtitle).toBe("EPA per Target");
    expect(rec.names).toEqual(["Clean Receiver"]);
    for (const r of [...badEpaRecs, ...badVolumeRecs]) expect(rec.names).not.toContain(r.player_name);
    expect(container.textContent).not.toMatch(/NaN|Infinity/);
  });

  it("receiving and rushing leaders are linked too (Week 2 volumes, no route data)", async () => {
    throughWeek(2);
    vi.mocked(getQBStats).mockResolvedValue([
      qb("qb-1", "Linked Passer", { attempts: 60, dropbacks: 66, epa_per_play: 0.2, cpoe: 3 }),
      qb("qb-2", "Other Passer", { team_id: "DAL", attempts: 55, dropbacks: 60, epa_per_play: 0.1, cpoe: 1 }),
    ]);
    vi.mocked(getReceiverStats).mockResolvedValue([
      wr("wr-1", "Linked Receiver", { targets: 12, routes_run: null, yards_per_route_run: null, epa_per_target: 0.4 }),
      wr("wr-2", "Other Receiver", { targets: 9, routes_run: null, yards_per_route_run: null, epa_per_target: 0.1 }),
    ]);
    vi.mocked(getRBSeasonStats).mockResolvedValue([
      rb("rb-1", "Linked Back", { carries: 30, epa_per_carry: 0.12 }),
      rb("rb-2", "Other Back", { carries: 25, epa_per_carry: 0.02 }),
    ]);
    // Answers only the ids it is asked for, as the real query does.
    const known = [
      slugRow("qb-1", "linked-passer"),
      slugRow("wr-1", "linked-receiver"),
      slugRow("rb-1", "linked-back"),
    ];
    vi.mocked(getPlayerSlugsByIds).mockImplementation(async (ids) =>
      known.filter((s) => ids.includes(s.player_id)),
    );

    const { container } = render(await HomePage());
    const cases: [string, string, string][] = [
      ["QB Efficiency", "Linked Passer", "/player/linked-passer"],
      ["Receiving Efficiency", "Linked Receiver", "/player/linked-receiver"],
      ["Rushing Efficiency", "Linked Back", "/player/linked-back"],
    ];
    for (const [title, name, href] of cases) {
      const s = strip(container, title);
      const i = s.names.indexOf(name);
      expect(i, `${name} in ${title}`).toBeGreaterThanOrEqual(0);
      expect(s.hrefs[i], `${name} in ${title}`).toBe(href);
    }

    expect(vi.mocked(getPlayerSlugsByIds)).toHaveBeenCalledTimes(1);
    const ids = vi.mocked(getPlayerSlugsByIds).mock.calls[0][0];
    expect(ids).toEqual(expect.arrayContaining(["wr-1", "wr-2", "rb-1", "rb-2"]));
  });
});

describe("homepage qualifier drift guard", () => {
  const ROOT = path.resolve(__dirname, "../..");
  const read = (p: string) => fs.readFileSync(path.resolve(ROOT, p), "utf8");
  const declared = (src: string, name: string) =>
    src.match(new RegExp(`\\bconst\\s+${name}\\s*=\\s*([\\d.]+)\\s*;`))?.[1];

  // app/page.tsx copies these rates (it cannot import them from "use client"
  // modules). If a leaderboard's rate changes, change the homepage's to match.
  it("leaderboard per-game rates are still 14 / 6.25 / 1.875, and the homepage does not import them", () => {
    expect(declared(read("components/tables/QBLeaderboard.tsx"), "PFR_ATT_PER_GAME")).toBe("14");
    expect(declared(read("components/tables/RBLeaderboard.tsx"), "PFR_CAR_PER_GAME")).toBe("6.25");
    expect(declared(read("components/tables/ReceiverLeaderboard.tsx"), "PFR_TGT_PER_GAME")).toBe("1.875");
    expect(read("app/page.tsx")).not.toMatch(/["'`](?:@\/|(?:\.{1,2}\/)+)components\/tables\//);
  });
});
