// fetchAllRows (team stats spec §2.1): the optional 4th argument adds a stable
// order and an abort signal; without it the query is call-for-call what every
// existing caller has always sent.
import { describe, it, expect, beforeEach, vi } from "vitest";

type Res = { data: unknown; error: unknown };
const chains: unknown[][][] = [];
let respond: (pageIndex: number) => Res = () => ({ data: [], error: null });

vi.mock("@/lib/supabase/server", () => ({
  createServerClient: () => ({
    from: (table: string) => {
      const calls: unknown[][] = [["from", table]];
      const page = chains.length;
      chains.push(calls);
      const builder: Record<string, unknown> = {};
      for (const m of ["select", "eq", "order", "range", "abortSignal"]) {
        builder[m] = (...a: unknown[]) => {
          calls.push([m, ...a]);
          return builder;
        };
      }
      builder.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
        Promise.resolve(respond(page)).then(res, rej);
      return builder;
    },
  }),
}));

import { fetchAllRows } from "@/lib/data/utils";

const rows = (n: number, start = 0) => Array.from({ length: n }, (_, i) => ({ id: start + i }));

beforeEach(() => {
  chains.length = 0;
  respond = () => ({ data: [], error: null });
});

describe("fetchAllRows", () => {
  it("with no options sends exactly select, range, eq — no order, no abortSignal", async () => {
    respond = () => ({ data: rows(3), error: null });
    const out = await fetchAllRows("t", "a,b", { season: 2026, team_id: "SF" });
    expect(out).toHaveLength(3);
    expect(chains).toEqual([
      [
        ["from", "t"],
        ["select", "a,b"],
        ["range", 0, 999],
        ["eq", "season", 2026],
        ["eq", "team_id", "SF"],
      ],
    ]);
  });

  it("an empty options object is the same as none", async () => {
    await fetchAllRows("t", "a", { season: 2026 }, {});
    expect(chains[0].map((c) => c[0])).toEqual(["from", "select", "range", "eq"]);
  });

  it("with options: every order column ascending before range, abortSignal on every page", async () => {
    respond = (p) => ({ data: p === 0 ? rows(1000) : rows(1, 1000), error: null });
    const signal = new AbortController().signal;
    const out = await fetchAllRows("t", "a", { season: 2026 }, { signal, order: ["game_id", "team_id"] });
    expect(out).toHaveLength(1001);
    expect(chains).toHaveLength(2);
    chains.forEach((calls, i) => {
      const names = calls.map((c) => c[0]);
      expect(names.indexOf("order")).toBeLessThan(names.indexOf("range"));
      expect(calls.filter((c) => c[0] === "order")).toEqual([
        ["order", "game_id", { ascending: true }],
        ["order", "team_id", { ascending: true }],
      ]);
      expect(calls.filter((c) => c[0] === "abortSignal")).toEqual([["abortSignal", signal]]);
      expect(calls.find((c) => c[0] === "range")).toEqual(["range", i * 1000, i * 1000 + 999]);
    });
  });

  it("paginates 1000 + 1 rows without options", async () => {
    respond = (p) => ({ data: p === 0 ? rows(1000) : rows(1, 1000), error: null });
    const out = await fetchAllRows("t", "a", {});
    expect(out).toHaveLength(1001);
    expect(out[1000]).toEqual({ id: 1000 });
    expect(chains).toHaveLength(2);
  });

  it("rejects with the raw PostgREST error object (unchanged)", async () => {
    const err = { message: "boom", code: "42P01" };
    respond = () => ({ data: null, error: err });
    await expect(fetchAllRows("t", "a", {})).rejects.toBe(err);
  });
});
