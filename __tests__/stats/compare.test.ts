import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import path from "path";
import {
  buildComparison, ensureContrast, colorDistance, getStatVal,
  CONTRAST_PALETTE, MIN_DISTANCE, QB_COMP_STATS, WR_COMP_STATS, RB_COMP_STATS,
  type CompareGroup, type ComparePlayerRow,
} from "@/lib/stats/compare";
import { getTeamColor } from "@/lib/data/teams";
// Real 2026 season rows through Week 4 (see the file's _provenance line).
import rowsJson from "./fixtures/compare-2026-w4-rows.json";
// The Python reference's numbers for the pool /compare uses before PR 1b:
// every row of the position's table. PR 1b deletes this file with that pool.
import goldJson from "./fixtures/compare-pool-all.expected.json";

// lib/stats/compare.ts (compare card spec 2026-10-09, PR 1): the Compare page's
// maths as a pure module. The proof that moving it changed nothing visible is
// __tests__/components/ComparisonTool.pin.test.tsx; this file tests the module
// on its own.

type Row = Record<string, unknown>;
const TABLES: Record<CompareGroup, Row[]> = {
  QB: rowsJson.qb as Row[], WR: rowsJson.receivers as Row[], RB: rowsJson.rb as Row[],
};
const asRows = (rows: Row[]) => rows as unknown as ComparePlayerRow[];
const raw = (rows: Row[]): Row[] =>
  rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v === null ? "NaN" : v])));

function compare(group: CompareGroup, nameA: string, nameB: string, table: Row[] = TABLES[group]) {
  const find = (name: string) => {
    const hits = table.filter((r) => r.player_name === name);
    expect(hits, name).toHaveLength(1);
    return hits[0];
  };
  const rowA = find(nameA);
  const rowB = find(nameB);
  return buildComparison({
    group, rowA: rowA as unknown as ComparePlayerRow, rowB: rowB as unknown as ComparePlayerRow, all: asRows(table),
    teamA: rowA.team_id as string, teamB: rowB.team_id as string,
  });
}

type GoldPair = {
  group: CompareGroup;
  a: { color: string }; b: { color: string };
  axes: string[]; valuesA: (number | null)[]; valuesB: (number | null)[]; poolSize: number;
  rows: { key: string; label: string; a: string; b: string; winner: number }[];
};
const GOLD = goldJson.pairs as unknown as Record<string, GoldPair>;
// Short names as the season rows carry them.
const GOLD_NAMES: Record<string, [string, string]> = {
  QB: ["J.Allen", "M.Stafford"],
  WR: ["C.Lamb", "J.Smith-Njigba"],
  RB: ["Bi.Robinson", "J.Gibbs"],
  TE: ["T.McBride", "S.LaPorta"],
  WRTE: ["C.Lamb", "T.McBride"],
};

describe("buildComparison: the pool before PR 1b (every row of the table) against the Python reference", () => {
  for (const [key, [nameA, nameB]] of Object.entries(GOLD_NAMES)) {
    it(`${key}: ${nameA} vs ${nameB}`, () => {
      const gold = GOLD[key];
      const got = compare(gold.group, nameA, nameB);
      expect(TABLES[gold.group]).toHaveLength(gold.poolSize);
      // The reference rounds to 2 decimals and writes a missing axis as null.
      const round2 = (p: { values: number[]; missing: boolean[] }) =>
        p.values.map((v, i) => (p.missing[i] ? null : Math.round(v * 100) / 100));
      expect(round2(got.a)).toEqual(gold.valuesA);
      expect(round2(got.b)).toEqual(gold.valuesB);
      expect(got.axes.map((a) => a.label)).toEqual(gold.axes);
      expect(got.a.color).toBe(gold.a.color);
      expect(got.b.color).toBe(gold.b.color);
      expect(got.rows).toEqual(gold.rows);
    });
  }

  it("the reference file covers exactly those five pairs", () => {
    expect(Object.keys(GOLD).sort()).toEqual(Object.keys(GOLD_NAMES).sort());
  });
});

describe("buildComparison: values and the missing mask", () => {
  it("values are never NaN; a missing WR/TE axis is 0 in values and true in the mask", () => {
    const got = compare("WR", "C.Lamb", "J.Smith-Njigba");
    // No 2026 receiver has route data, so YPRR (the last axis) is missing for everyone.
    expect(got.a.missing).toEqual([false, false, false, false, false, true]);
    expect(got.b.missing).toEqual([false, false, false, false, false, true]);
    expect(got.a.values[5]).toBe(0);
    for (const p of [got.a, got.b]) for (const v of p.values) expect(Number.isNaN(v)).toBe(false);
  });

  it("missing for one receiver only: his mask alone is set", () => {
    // M.Valdes-Scantling: 2 targets, 0 receptions, so no YAC per reception.
    const got = compare("WR", "M.Valdes-Scantling", "C.Lamb");
    expect(got.a.missing[4]).toBe(true);
    expect(got.b.missing[4]).toBe(false);
    expect(got.rows.find((r) => r.label === "YAC/Rec")).toMatchObject({ a: "—", winner: 0 });
  });

  it("QB and RB: a missing axis plots at the centre (0) and the mask stays false", () => {
    // M.Penix: no rush attempts, so no rushing EPA (the last QB axis).
    const got = compare("QB", "M.Penix", "J.Allen");
    expect(got.a.values[6]).toBe(0);
    expect(got.a.missing).toEqual(Array(7).fill(false));
    expect(compare("RB", "Bi.Robinson", "J.Gibbs").a.missing).toEqual(Array(6).fill(false));
  });

  it("null, undefined and the string \"NaN\" all mean no value: one answer for all three", () => {
    for (const [group, [nameA, nameB]] of [
      ["QB", ["M.Penix", "J.Allen"]], ["WR", ["M.Valdes-Scantling", "C.Lamb"]], ["RB", ["Bi.Robinson", "J.Gibbs"]],
    ] as [CompareGroup, [string, string]][]) {
      const parsed = compare(group, nameA, nameB);
      expect(compare(group, nameA, nameB, raw(TABLES[group])), `${group} "NaN"`).toEqual(parsed);
      const withUndefined = TABLES[group].map((r) =>
        Object.fromEntries(Object.entries(r).filter(([, v]) => v !== null)));
      expect(compare(group, nameA, nameB, withUndefined), `${group} undefined`).toEqual(parsed);
    }
  });

  it("the one known exception (F12), kept as it is: a null stuff_rate plots as a 0% stuff rate, \"NaN\" at the centre", () => {
    const edit = (value: unknown) => TABLES.RB.map((r) => (r.player_name === "J.Gibbs" ? { ...r, stuff_rate: value } : r));
    const STUFF_AVOID = 2;
    const neverStuffed = edit(null).filter((r) => (r.stuff_rate as number) > 0).length / TABLES.RB.length * 100;
    const asNull = compare("RB", "Bi.Robinson", "J.Gibbs", edit(null));
    expect(asNull.b.values[STUFF_AVOID]).toBe(neverStuffed);
    expect(neverStuffed).toBeGreaterThan(80);
    expect(asNull.rows.find((r) => r.label === "Stuff%")).toMatchObject({ b: "—", winner: 0 });
    // Only null does this. undefined and "NaN" plot at the centre.
    for (const other of [undefined, "NaN"]) {
      const got = compare("RB", "Bi.Robinson", "J.Gibbs", edit(other));
      expect(got.b.values[STUFF_AVOID]).toBe(0);
      expect(got.rows.find((r) => r.label === "Stuff%")).toMatchObject({ b: "—", winner: 0 });
    }
  });

  it("rows that hold almost nothing (the shape other tests hand the Compare page) do not throw", () => {
    const a = { player_id: "a", player_name: "A", team_id: "BUF", epa_per_db: 0.25, games: 4 };
    const b = { player_id: "b", player_name: "B", team_id: "KC", epa_per_db: 0.15, games: 4 };
    const got = buildComparison({
      group: "QB", rowA: a as unknown as ComparePlayerRow, rowB: b as unknown as ComparePlayerRow,
      all: asRows([a, b]), teamA: "BUF", teamB: "KC",
    });
    expect(got.rows).toHaveLength(QB_COMP_STATS.length);
    expect(got.rows[0]).toEqual({ key: "epa_per_db", label: "EPA/DB", a: "0.25", b: "0.15", winner: 1 });
    expect(got.rows.find((r) => r.label === "CPOE")).toMatchObject({ a: "—", b: "—", winner: 0 });
    expect(got.a.values).toHaveLength(7);
  });

  it("a pool of one row, and an empty pool: numbers, never a crash", () => {
    const row = TABLES.WR.find((r) => r.player_name === "C.Lamb")!;
    const one = buildComparison({
      group: "WR", rowA: row as unknown as ComparePlayerRow, rowB: row as unknown as ComparePlayerRow,
      all: asRows([row]), teamA: "DAL", teamB: "DAL",
    });
    expect(one.a.values).toEqual([0, 0, 0, 0, 0, 0]);
    expect(one.a.missing).toEqual([false, false, false, false, false, true]);
    const none = buildComparison({
      group: "WR", rowA: row as unknown as ComparePlayerRow, rowB: row as unknown as ComparePlayerRow,
      all: [], teamA: "DAL", teamB: "DAL",
    });
    expect(none.a.missing).toEqual(Array(6).fill(true));
    expect(none.a.values).toEqual(Array(6).fill(0));
  });
});

describe("buildComparison: the stat table", () => {
  it("one row per stat of the group, in the page's order", () => {
    expect(compare("QB", "J.Allen", "M.Stafford").rows.map((r) => r.label)).toEqual(QB_COMP_STATS.map((s) => s.label));
    expect(compare("WR", "C.Lamb", "J.Smith-Njigba").rows.map((r) => r.label)).toEqual(WR_COMP_STATS.map((s) => s.label));
    expect(compare("RB", "Bi.Robinson", "J.Gibbs").rows.map((r) => r.label)).toEqual(RB_COMP_STATS.map((s) => s.label));
    expect([QB_COMP_STATS.length, WR_COMP_STATS.length, RB_COMP_STATS.length]).toEqual([18, 14, 12]);
  });

  it("higher wins, except where lower is better; a tie highlights neither", () => {
    const rows = compare("QB", "J.Allen", "M.Stafford").rows;
    const row = (label: string) => rows.find((r) => r.label === label)!;
    expect(row("Pass Yds")).toMatchObject({ a: "1039", b: "1189", winner: 2 });
    expect(row("INT")).toMatchObject({ a: "3", b: "6", winner: 1 }); // fewer is better
    expect(row("Pass TD")).toMatchObject({ a: "6", b: "6", winner: 0 });
  });

  it("swapping the players mirrors the table and the radar", () => {
    const ab = compare("RB", "Bi.Robinson", "J.Gibbs");
    const ba = compare("RB", "J.Gibbs", "Bi.Robinson");
    expect(ba.a.values).toEqual(ab.b.values);
    expect(ba.b.values).toEqual(ab.a.values);
    expect(ba.rows).toEqual(ab.rows.map((r) => ({ ...r, a: r.b, b: r.a, winner: r.winner === 0 ? 0 : 3 - r.winner })));
  });

  it("getStatVal: only a real number counts", () => {
    const row = { a: 1.5, b: null, c: "NaN", d: "2", e: 0 } as unknown as ComparePlayerRow;
    expect(getStatVal(row, "a")).toBe(1.5);
    expect(getStatVal(row, "e")).toBe(0);
    for (const key of ["b", "c", "d", "missing"]) expect(Number.isNaN(getStatVal(row, key))).toBe(true);
  });
});

describe("ensureContrast: only player 2's colour is ever moved", () => {
  it("the spec's table: BUF/LA and DAL/SEA go to red, ATL/DET is left alone", () => {
    expect(ensureContrast(getTeamColor("BUF"), getTeamColor("LA"))).toBe("#dc2626");
    expect(ensureContrast(getTeamColor("DAL"), getTeamColor("SEA"))).toBe("#dc2626");
    expect(ensureContrast(getTeamColor("ATL"), getTeamColor("DET"))).toBe(getTeamColor("DET"));
  });

  it("the same team twice: player 2 gets the first palette colour far enough from the team's", () => {
    for (const team of ["BUF", "KC", "GB", "PIT", "NO"]) {
      const c1 = getTeamColor(team);
      const c2 = ensureContrast(c1, c1);
      expect(CONTRAST_PALETTE).toContain(c2);
      expect(colorDistance(c1, c2)).toBeGreaterThanOrEqual(MIN_DISTANCE);
      expect(c2).toBe(CONTRAST_PALETTE.find((alt) => colorDistance(c1, alt) >= MIN_DISTANCE));
    }
    // KC is red, so the first palette colour (red) is too close and blue is used.
    expect(ensureContrast(getTeamColor("KC"), getTeamColor("KC"))).toBe("#2563eb");
  });

  it("for every pair of NFL teams the two colours end up at least 150 apart", () => {
    const teams = ["ARI", "ATL", "BAL", "BUF", "CAR", "CHI", "CIN", "CLE", "DAL", "DEN", "DET", "GB", "HOU", "IND", "JAX", "KC",
      "LA", "LAC", "LV", "MIA", "MIN", "NE", "NO", "NYG", "NYJ", "PHI", "PIT", "SEA", "SF", "TB", "TEN", "WAS"];
    for (const t1 of teams) for (const t2 of teams) {
      const c1 = getTeamColor(t1);
      expect(colorDistance(c1, ensureContrast(c1, getTeamColor(t2))), `${t1}/${t2}`).toBeGreaterThanOrEqual(MIN_DISTANCE);
    }
  });

  it("an unknown team id uses the site's neutral grey, as the page always did", () => {
    const got = buildComparison({
      group: "QB", rowA: TABLES.QB[0] as unknown as ComparePlayerRow, rowB: TABLES.QB[1] as unknown as ComparePlayerRow,
      all: asRows(TABLES.QB), teamA: "???", teamB: "BUF",
    });
    expect(got.a.color).toBe("#6B7280");
    expect(colorDistance(got.a.color, got.b.color)).toBeGreaterThanOrEqual(MIN_DISTANCE);
  });
});

describe("lib/stats/compare.ts stays pure", () => {
  it("imports nothing from lib/data except the static team list, and no React, Next or Supabase", () => {
    const source = readFileSync(path.join(__dirname, "..", "..", "lib", "stats", "compare.ts"), "utf8");
    const imports = Array.from(source.matchAll(/from\s+"([^"]+)"/g)).map((m) => m[1]);
    expect(imports.length).toBeGreaterThan(0);
    expect(imports.filter((i) => i.includes("lib/data"))).toEqual(["@/lib/data/teams"]);
    for (const i of imports) expect(i).not.toMatch(/supabase|^react|^next|components\//);
    expect(source).not.toContain("use client");
    expect(source).not.toMatch(/\brequire\(|\bimport\(/);
  });
});
