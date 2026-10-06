// getTeamRadarRows (team radar spec 2026-10-06 §3.2, §6): one ordered,
// deadlined read of a season's team_game_stats with its own 17-column list.
// A failed read is an Error (the page turns it into the section's
// "unavailable" state); a read that succeeds with no rows is [].
import { describe, it, expect, beforeEach, vi } from "vitest";
import rowsJson from "../stats/fixtures/team-radar-2026-w1-3.json";

type Res = { data: unknown; error: unknown };
let respond: (calls: unknown[][]) => Res | Promise<Res> = () => ({ data: [], error: null });
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
        Promise.resolve()
          .then(() => respond(calls))
          .then(res, rej);
      return builder;
    },
  }),
}));

import { getTeamRadarRows, TEAM_RADAR_COLUMNS } from "@/lib/data/team-radar";
import { TEAM_STATS_COLUMNS } from "@/lib/data/team-stats";
import { TEAM_GAME_NUMERIC } from "@/lib/data/box-score";
import { RADAR_AXES, buildTeamRadar } from "@/lib/stats/team-radar";

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
});

describe("TEAM_RADAR_COLUMNS", () => {
  it("is the spec's 17 columns (§6)", () => {
    expect([...TEAM_RADAR_COLUMNS]).toEqual([
      "game_id", "team_id", "opponent_id", "season", "week",
      "pass_plays", "rush_plays", "pass_success_rate", "rush_success_rate",
      "explosive_pass", "explosive_rush", "attempts", "sacks", "turnovers", "total_drives",
      "designed_runs", "stuffed_runs",
    ]);
  });

  it("names every column RADAR_AXES reads, and is exactly the fixture's columns", () => {
    for (const a of RADAR_AXES) {
      expect(TEAM_RADAR_COLUMNS as readonly string[], a.key).toContain(a.num);
      for (const d of a.den) expect(TEAM_RADAR_COLUMNS as readonly string[], a.key).toContain(d);
    }
    expect(Object.keys(ROWS[0]).sort()).toEqual([...TEAM_RADAR_COLUMNS].sort());
  });

  it("the Team Stats column list is untouched: still 30, still without the radar's five", () => {
    expect(TEAM_STATS_COLUMNS).toHaveLength(30);
    for (const c of ["attempts", "sacks", "total_drives", "designed_runs", "stuffed_runs"]) {
      expect(TEAM_STATS_COLUMNS as readonly string[]).not.toContain(c);
    }
  });
});

describe("getTeamRadarRows", () => {
  it("one read: 17 columns, filtered by season, ordered by game_id then team_id, with a deadline", async () => {
    respond = () => ({ data: ROWS.map(wire), error: null });
    const rows = await getTeamRadarRows(2026);
    expect(rows).toHaveLength(94);
    expect(chains).toHaveLength(1);
    const { table, calls } = chains[0];
    expect(table).toBe("team_game_stats");
    expect(calls.find((c) => c[0] === "select")).toEqual(["select", TEAM_RADAR_COLUMNS.join(",")]);
    expect(calls.filter((c) => c[0] === "eq")).toEqual([["eq", "season", 2026]]);
    expect(calls.filter((c) => c[0] === "order")).toEqual([
      ["order", "game_id", { ascending: true }],
      ["order", "team_id", { ascending: true }],
    ]);
    expect(calls.find((c) => c[0] === "abortSignal")?.[1]).toBeInstanceOf(AbortSignal);
  });

  it("takes the caller's signal when one is given (the coming shared read limit)", async () => {
    const controller = new AbortController();
    await getTeamRadarRows(2026, { signal: controller.signal });
    expect(chains[0].calls.find((c) => c[0] === "abortSignal")?.[1]).toBe(controller.signal);
  });

  it("NUMERIC strings come back as numbers, NULL and 'NaN' as null, and nothing unselected is added", async () => {
    const first = wire(ROWS[0]);
    first.rush_success_rate = "NaN";
    const second = wire(ROWS[1]);
    second.pass_success_rate = null;
    second.designed_runs = null;
    second.stuffed_runs = null;
    respond = () => ({ data: [first, second], error: null });
    const rows = await getTeamRadarRows(2026);
    expect(rows[0].pass_success_rate).toBe(ROWS[0].pass_success_rate);
    expect(rows[0].rush_success_rate).toBeNull();
    expect(rows[1].pass_success_rate).toBeNull();
    expect(rows[1].designed_runs).toBeNull();
    expect(rows[1].stuffed_runs).toBeNull();
    expect(Object.keys(rows[0]).sort()).toEqual([...TEAM_RADAR_COLUMNS].sort());
  });

  it("the rows as read build the same radars as the fixture", async () => {
    respond = () => ({ data: ROWS.map(wire), error: null });
    const rows = await getTeamRadarRows(2026);
    expect(buildTeamRadar(rows as unknown as Record<string, unknown>[])).toEqual(buildTeamRadar(ROWS));
  });

  it("a season with no rows is [] (the state function decides what that means), in one read", async () => {
    await expect(getTeamRadarRows(2025)).resolves.toEqual([]);
    expect(chains).toHaveLength(1);
  });

  it("pages past the 1000-row cap", async () => {
    const page = Array.from({ length: 1000 }, (_, i) => wire({ ...ROWS[0], game_id: `g${i}` }));
    respond = (calls) => {
      const range = calls.find((c) => c[0] === "range") as [string, number, number];
      return { data: range[1] === 0 ? page : [wire(ROWS[1])], error: null };
    };
    const rows = await getTeamRadarRows(2026);
    expect(rows).toHaveLength(1001);
    expect(chains).toHaveLength(2);
  });

  it("a PostgREST error rejects with an Error naming the read and the season", async () => {
    respond = () => ({ data: null, error: { message: "column team_game_stats.designed_runs does not exist", code: "42703" } });
    const err = await getTeamRadarRows(2026).catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe("Failed to fetch team radar rows for 2026: column team_game_stats.designed_runs does not exist");
  });

  it("a thrown fetch failure or an abort also rejects with an Error", async () => {
    respond = () => {
      throw new TypeError("fetch failed");
    };
    const err = await getTeamRadarRows(2026).catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toContain("Failed to fetch team radar rows for 2026");

    respond = () => ({ data: null, error: { message: "AbortError: This operation was aborted" } });
    await expect(getTeamRadarRows(2026)).rejects.toThrow("Failed to fetch team radar rows for 2026");
  });
});
