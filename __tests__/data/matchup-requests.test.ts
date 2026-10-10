import { describe, it, expect, beforeEach, vi } from "vitest";

// Team matchup spec 2026-10-10 §6.5: the PostgREST request count of one
// matchup page, measured at the Supabase client itself (every real loader
// runs; only the client is a stand-in). Cold: 8 requests. Warm: 0. Per pair: 0.
//
//   data_freshness 1 · team_game_stats 1 · games 1 · qb_season_stats 1 ·
//   rb_season_stats 1 · receiver_season_stats 1 · player_slugs 2 pages
const requests: { table: string; range: [number, number] | null }[] = [];
const tables: Record<string, Record<string, unknown>[]> = {};

vi.mock("@/lib/supabase/server", () => ({
  hasNoDatabase: () => false,
  createServerClient: () => ({
    from: (table: string) => {
      let range: [number, number] | null = null;
      const builder: Record<string, unknown> = {};
      // Every filter and modifier chains; awaiting the builder is the request.
      const chain = new Proxy(builder, {
        get(_target, prop) {
          if (prop === "then") {
            return (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) => {
              requests.push({ table, range });
              const all = tables[table] ?? [];
              const data = range ? all.slice(range[0], range[1] + 1) : all;
              return Promise.resolve({ data, error: null }).then(resolve, reject);
            };
          }
          return (...args: unknown[]) => {
            if (prop === "range") range = [args[0] as number, args[1] as number];
            return chain;
          };
        },
      });
      return chain;
    },
  }),
}));

import statsRowsJson from "../stats/fixtures/team-game-stats-2026-w1-3.json";
import radarRowsJson from "../stats/fixtures/team-radar-2026-w1-3.json";
import playerRowsJson from "../stats/fixtures/compare-2026-w4-rows.json";
import { clearMatchupMemo, loadMatchup, loadMatchupIndex } from "@/lib/data/matchup";
import { clearCompareCardMemo } from "@/lib/data/compare-card";

type Row = Record<string, unknown>;
const RADAR_BY_KEY = new Map((radarRowsJson as Row[]).map((r) => [`${r.game_id}|${r.team_id}`, r]));
const ROWS: Row[] = (statsRowsJson as Row[]).map((r) => ({ ...r, ...RADAR_BY_KEY.get(`${r.game_id}|${r.team_id}`) }));

const count = () => {
  const by: Record<string, number> = {};
  for (const r of requests) by[r.table] = (by[r.table] ?? 0) + 1;
  return by;
};

beforeEach(() => {
  requests.length = 0;
  clearMatchupMemo();
  clearCompareCardMemo();
  tables.data_freshness = [{ season: 2026, through_week: 3 }, { season: 2025, through_week: 22 }];
  tables.team_game_stats = ROWS;
  tables.games = [
    { game_id: "2026_01_BUF_HOU", season: 2026, game_type: "REG", week: 1, gameday: "2026-09-13", weekday: "Sunday", gametime: "13:00", home_team: "HOU", away_team: "BUF", home_score: 20, away_score: 27 },
    { game_id: "2026_05_DET_NO", season: 2026, game_type: "REG", week: 5, gameday: "2026-10-11", weekday: "Sunday", gametime: "13:00", home_team: "NO", away_team: "DET", home_score: null, away_score: null },
  ];
  tables.qb_season_stats = playerRowsJson.qb as unknown as Row[];
  tables.rb_season_stats = playerRowsJson.rb as unknown as Row[];
  tables.receiver_season_stats = playerRowsJson.receivers as unknown as Row[];
  // About 1,300 slugs: over the 1,000-row page, so the list is two pages.
  tables.player_slugs = Array.from({ length: 1300 }, (_, i) => ({
    slug: `player-${String(i).padStart(4, "0")}`, player_id: i === 0 ? "00-0034857" : `id-${i}`, player_name: i === 0 ? "Josh Allen" : `Player ${i}`,
    position: "QB", current_team_id: "BUF",
  }));
});

describe("the matchup page's request count (§6.5)", () => {
  it("cold: 8 PostgREST requests", async () => {
    const got = await loadMatchup("BUF", "HOU", null);
    expect(got.state).toBe("ready");
    expect(count()).toEqual({
      data_freshness: 1, team_game_stats: 1, games: 1, qb_season_stats: 1, rb_season_stats: 1, receiver_season_stats: 1, player_slugs: 2,
    });
    expect(requests).toHaveLength(8);
    expect(requests.filter((r) => r.table === "player_slugs").map((r) => r.range)).toEqual([[0, 999], [1000, 1999]]);
    // the real loaders really ran: the game, the record and a linked name came through them
    expect(got.game).toMatchObject({ game_id: "2026_01_BUF_HOU", home_score: 20, away_score: 27 });
    expect(got.records!.away).toEqual({ wins: 1, losses: 0, ties: 0 });
    expect(got.lineup![0].away).toMatchObject({ name: "Josh Allen", href: "/player/player-0000" });
  });

  it("warm: 0", async () => {
    await loadMatchup("BUF", "HOU", null);
    requests.length = 0;
    await loadMatchup("BUF", "HOU", null);
    expect(requests).toEqual([]);
  });

  it("per pair: 0. 200 different pairs after the first cost nothing more", async () => {
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
    expect(requests).toHaveLength(8);
  });

  it("/matchup: 2 requests cold (seasons, games), 0 warm, and nothing more for a matchup page's share of them", async () => {
    const got = await loadMatchupIndex();
    expect(got).toMatchObject({ season: 2026, gamesAvailable: true });
    expect(got.slate!.label).toBe("Week 5");
    expect(count()).toEqual({ data_freshness: 1, games: 1 });
    await loadMatchupIndex();
    expect(requests).toHaveLength(2);
    await loadMatchup("BUF", "HOU", null);
    expect(requests).toHaveLength(8);
  });
});
