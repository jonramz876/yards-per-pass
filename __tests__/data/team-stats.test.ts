// getTeamStatsSeason (team stats spec §2.2): one ordered, deadlined read of a
// season's team_game_stats; an empty season is a message only when it really
// can be empty (J4), and a failed read is an Error.
import { describe, it, expect, beforeEach, vi } from "vitest";
import rowsJson from "../stats/fixtures/team-game-stats-2026-w1-3.json";

type Res = { data: unknown; error: unknown };
let respond: (calls: unknown[][]) => Res = () => ({ data: [], error: null });
const chains: { table: string; calls: unknown[][] }[] = [];

vi.mock("@/lib/supabase/server", () => ({
  createServerClient: () => ({
    from: (table: string) => {
      const calls: unknown[][] = [];
      chains.push({ table, calls });
      const builder: Record<string, unknown> = {};
      for (const m of ["select", "eq", "order", "range", "limit", "abortSignal"]) {
        builder[m] = (...a: unknown[]) => {
          calls.push([m, ...a]);
          return builder;
        };
      }
      builder.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
        Promise.resolve(respond(calls)).then(res, rej);
      return builder;
    },
  }),
}));

vi.mock("@/lib/data/box-score", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/data/box-score")>()),
  getBoxScoreSeasonsCached: vi.fn(async () => [2026]),
}));

import { getTeamStatsSeason, TEAM_STATS_COLUMNS } from "@/lib/data/team-stats";
import { getBoxScoreSeasonsCached, TEAM_GAME_NUMERIC } from "@/lib/data/box-score";

const ROWS = rowsJson as Record<string, unknown>[];

/** A row as PostgREST sends it: NUMERIC columns are strings. */
function wire(r: Record<string, unknown>): Record<string, unknown> {
  const out = { ...r };
  for (const c of TEAM_GAME_NUMERIC) if (c in out) out[c] = out[c] === null ? null : String(out[c]);
  return out;
}

beforeEach(() => {
  chains.length = 0;
  respond = () => ({ data: [], error: null });
  vi.mocked(getBoxScoreSeasonsCached).mockReset();
  vi.mocked(getBoxScoreSeasonsCached).mockResolvedValue([2026]);
});

describe("getTeamStatsSeason — ready", () => {
  it("reads the 30 columns, filtered by season, ordered by game_id then team_id, with a deadline", async () => {
    respond = () => ({ data: ROWS.map(wire), error: null });
    const out = await getTeamStatsSeason(2026, [2026, 2025]);
    expect(out.state).toBe("ready");
    expect(chains).toHaveLength(1);
    const { table, calls } = chains[0];
    expect(table).toBe("team_game_stats");
    expect(calls.find((c) => c[0] === "select")).toEqual(["select", TEAM_STATS_COLUMNS.join(",")]);
    expect(TEAM_STATS_COLUMNS).toHaveLength(30);
    expect(calls.filter((c) => c[0] === "eq")).toEqual([["eq", "season", 2026]]);
    expect(calls.filter((c) => c[0] === "order")).toEqual([
      ["order", "game_id", { ascending: true }],
      ["order", "team_id", { ascending: true }],
    ]);
    const signal = calls.find((c) => c[0] === "abortSignal")?.[1];
    expect(signal).toBeInstanceOf(AbortSignal);
    expect(getBoxScoreSeasonsCached).not.toHaveBeenCalled();
  });

  it("NUMERIC strings come back as numbers; NULL and 'NaN' as null; nothing unselected is added", async () => {
    const first = wire(ROWS[0]);
    first.late_epa_per_play = "NaN";
    first.early_epa_per_play = null;
    respond = () => ({ data: [first], error: null });
    const out = await getTeamStatsSeason(2026, [2026]);
    if (out.state !== "ready") throw new Error("not ready");
    const r = out.rows[0];
    expect(r.epa_per_play).toBe(ROWS[0].epa_per_play);
    expect(typeof r.epa_lost_penalties).toBe("number");
    expect(r.late_epa_per_play).toBeNull();
    expect(r.early_epa_per_play).toBeNull();
    expect(Object.keys(r).sort()).toEqual([...TEAM_STATS_COLUMNS].sort());
  });

  it("a PostgREST error rejects with an Error naming the season", async () => {
    respond = () => ({ data: null, error: { message: "permission denied", code: "42501" } });
    const err = await getTeamStatsSeason(2026, [2026]).catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe("Failed to fetch team_game_stats for 2026: permission denied");
  });

  it("an error without a string message is JSON-stringified", async () => {
    respond = () => ({ data: null, error: { code: 500 } });
    const err = await getTeamStatsSeason(2026, [2026]).catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe('Failed to fetch team_game_stats for 2026: {"code":500}');
  });
});

describe("getTeamStatsSeason — no rows (J4)", () => {
  it("no seasons at all → throws", async () => {
    await expect(getTeamStatsSeason(2026, [])).rejects.toThrow("no seasons from data_freshness");
  });

  it("the newest season empty → throws (the read is failing silently)", async () => {
    await expect(getTeamStatsSeason(2026, [2026, 2025])).rejects.toThrow(
      "Team stats: 2026 is the newest season in data_freshness but has no team_game_stats rows",
    );
    expect(getBoxScoreSeasonsCached).not.toHaveBeenCalled();
  });

  it("an older season with covered [2026] → uncovered, firstSeason 2026", async () => {
    await expect(getTeamStatsSeason(2025, [2026, 2025])).resolves.toEqual({ state: "uncovered", firstSeason: 2026 });
    expect(getBoxScoreSeasonsCached).toHaveBeenCalledWith([2026, 2025]);
  });

  it("a season outside data_freshness: 1999 → firstSeason 2026; 2030 → null", async () => {
    await expect(getTeamStatsSeason(1999, [2026, 2025])).resolves.toEqual({ state: "uncovered", firstSeason: 2026 });
    await expect(getTeamStatsSeason(2030, [2026, 2025])).resolves.toEqual({ state: "uncovered", firstSeason: null });
  });

  it("no covered season at all → firstSeason null", async () => {
    vi.mocked(getBoxScoreSeasonsCached).mockResolvedValue([]);
    await expect(getTeamStatsSeason(2025, [2026, 2025])).resolves.toEqual({ state: "uncovered", firstSeason: null });
  });

  it("the probe says 2025 has rows but the read returned none → throws", async () => {
    vi.mocked(getBoxScoreSeasonsCached).mockResolvedValue([2026, 2025]);
    await expect(getTeamStatsSeason(2025, [2026, 2025])).rejects.toThrow(
      "Team stats: team_game_stats has rows for 2025 but the season read returned none",
    );
  });

  it("a probe rejection rejects", async () => {
    vi.mocked(getBoxScoreSeasonsCached).mockRejectedValue(new Error("Failed to fetch box score seasons: boom"));
    await expect(getTeamStatsSeason(2025, [2026, 2025])).rejects.toThrow("boom");
  });
});
