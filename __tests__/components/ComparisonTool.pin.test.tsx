import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { readFileSync } from "fs";
import { createHash } from "crypto";
import path from "path";

// THE PIN for the Compare page (compare card spec 2026-10-09, section 10).
//
// What it is: everything a visitor of /compare can see for a pair of players.
// It was written down in PR 1 from the component AS IT WAS BEFORE its maths
// moved to lib/stats/compare.ts, and stayed byte-identical through that move.
//
// What it records, per pair and per data path:
//   radar  what OverlayRadarChart receives: values1 / values2 (0-100, never
//          NaN) and missing1 / missing2 (true where an axis has no data)
//   chart  both colours (after the contrast rule), both names, the axes
//   table  every cell's text and class (bg-green-50 marks the better value)
//          and both header colours
//
// The two data paths: the server hands the season table in (rows went through
// parseNumericFields: a missing number is null), or the browser reads it
// itself (raw rows: a missing number can be the string "NaN").
//
// PR 1b (the radar now ranks each player in the stat card's pool) replaced the
// "radar" parts ONLY: new numbers, and a mask in place of NaN. The "chart" and
// "table" parts are PR 1's, byte for byte; a test below holds their hash.
//
// RULES. Never edit the expected file to make this test pass, and never
// re-capture it.

const captured = vi.hoisted(() => ({ calls: [] as Record<string, unknown>[] }));

let params = new URLSearchParams();
vi.mock("next/navigation", () => ({
  useSearchParams: () => params,
  useRouter: () => ({ replace: () => undefined }),
  usePathname: () => "/compare",
}));

// A capturing stand-in for the chart: it draws nothing and keeps every prop.
vi.mock("@/components/compare/OverlayRadarChart", () => ({
  default: (props: Record<string, unknown>) => {
    captured.calls.push(props);
    return null;
  },
}));

type Result = { data: unknown; error: unknown };
let tables: Record<string, Result> = {};
const fromCalls: string[] = [];
vi.mock("@/lib/supabase/client", () => ({
  getSupabaseClient: () => ({
    from: (table: string) => {
      fromCalls.push(table);
      const builder: Record<string, unknown> = {};
      for (const m of ["select", "ilike", "order", "limit", "eq", "in"]) builder[m] = () => builder;
      builder.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
        Promise.resolve(tables[table] ?? { data: [], error: null }).then(res, rej);
      return builder;
    },
  }),
}));

import ComparisonTool from "@/components/compare/ComparisonTool";
import type { QBSeasonStat, ReceiverSeasonStat, RBSeasonStat } from "@/lib/types";
// Real 2026 season rows through Week 4 (all 49 QBs, 362 receiver rows, 97
// RBs), saved from the live leaderboard pages on 2026-10-07. See the file's
// own _provenance line. The whole tables are needed: the page ranks each
// player against every row of his table.
import rowsJson from "../stats/fixtures/compare-2026-w4-rows.json";
// Independent check: the same numbers computed by the Python reference
// (docs/superpowers/specs/compare-card-reference/build_data.py), unrounded.
import goldJson from "../stats/fixtures/compare-card-pool.expected.json";
import { buildQBCardData, buildWRCardData, buildRBCardData, rbCardPool } from "@/lib/stats/tecmo-card";

type Row = Record<string, unknown>;
const QB_ROWS = rowsJson.qb as Row[];
const REC_ROWS = rowsJson.receivers as Row[];
const RB_ROWS = rowsJson.rb as Row[];

/** The browser's raw form of the same rows: a missing number is the string "NaN". */
const raw = (rows: Row[]): Row[] =>
  rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v === null ? "NaN" : v])));

// player_slugs rows as the page reads them. player_id and team are the season
// rows' own; names and slugs are the players' real ones.
type Slug = { player_id: string; slug: string; player_name: string; position: string; current_team_id: string };
const P: Record<string, Slug> = {
  allen: { player_id: "00-0034857", slug: "josh-allen", player_name: "Josh Allen", position: "QB", current_team_id: "BUF" },
  stafford: { player_id: "00-0026498", slug: "matthew-stafford", player_name: "Matthew Stafford", position: "QB", current_team_id: "LA" },
  // Penix: rush_epa_per_play is missing (0 rush attempts).
  penix: { player_id: "00-0039917", slug: "michael-penix", player_name: "Michael Penix Jr.", position: "QB", current_team_id: "ATL" },
  lamb: { player_id: "00-0036358", slug: "ceedee-lamb", player_name: "CeeDee Lamb", position: "WR", current_team_id: "DAL" },
  jsn: { player_id: "00-0038543", slug: "jaxon-smith-njigba", player_name: "Jaxon Smith-Njigba", position: "WR", current_team_id: "SEA" },
  // Valdes-Scantling: 2 targets, 0 receptions, so YAC/Rec is missing for him alone.
  mvs: { player_id: "00-0034272", slug: "marquez-valdes-scantling", player_name: "Marquez Valdes-Scantling", position: "WR", current_team_id: "LAC" },
  mcbride: { player_id: "00-0037744", slug: "trey-mcbride", player_name: "Trey McBride", position: "TE", current_team_id: "ARI" },
  laporta: { player_id: "00-0039065", slug: "sam-laporta", player_name: "Sam LaPorta", position: "TE", current_team_id: "DET" },
  bijan: { player_id: "00-0038542", slug: "bijan-robinson", player_name: "Bijan Robinson", position: "RB", current_team_id: "ATL" },
  gibbs: { player_id: "00-0039139", slug: "jahmyr-gibbs", player_name: "Jahmyr Gibbs", position: "RB", current_team_id: "DET" },
};
// Not a real listing: Bijan Robinson's real row, with player_slugs calling him
// a fullback. It pins that a fullback is compared in the running back table.
const BIJAN_AS_FB: Slug = { ...P.bijan, position: "FB" };

// F12 (spec §2): no 2026 running back has a missing stuff_rate, so this one
// row is edited for the test: Gibbs' real row with stuff_rate removed. As the
// server sends it (null) the Stuff Avoid axis plots as if it were the best
// possible value; as the browser reads it ("NaN") it plots at the centre. A
// known quirk the stat card shares, pinned as it is, not fixed here.
const RB_ROWS_GIBBS_NO_STUFF_RATE = RB_ROWS.map((r) =>
  r.player_id === P.gibbs.player_id ? { ...r, stuff_rate: null } : r);

type Table = "qb" | "receivers" | "rb";
type Case = { id: string; table: Table; p1: Slug; p2: Slug; rows: Row[]; gold?: string; pathsDiffer?: true };
const CASES: Case[] = [
  // One pair per position group, each in the Python reference too.
  { id: "qb-allen-stafford", table: "qb", p1: P.allen, p2: P.stafford, rows: QB_ROWS, gold: "QB" },
  { id: "wr-lamb-smith-njigba", table: "receivers", p1: P.lamb, p2: P.jsn, rows: REC_ROWS, gold: "WR" },
  { id: "rb-robinson-gibbs", table: "rb", p1: P.bijan, p2: P.gibbs, rows: RB_ROWS, gold: "RB" },
  { id: "te-mcbride-laporta", table: "receivers", p1: P.mcbride, p2: P.laporta, rows: REC_ROWS, gold: "TE" },
  { id: "wr-te-lamb-mcbride", table: "receivers", p1: P.lamb, p2: P.mcbride, rows: REC_ROWS, gold: "WRTE" },
  // The same pair the other way round: only player 2's colour is ever moved.
  { id: "qb-stafford-allen", table: "qb", p1: P.stafford, p2: P.allen, rows: QB_ROWS },
  // A missing value on one side only.
  { id: "qb-penix-allen", table: "qb", p1: P.penix, p2: P.allen, rows: QB_ROWS },
  { id: "wr-valdes-scantling-lamb", table: "receivers", p1: P.mvs, p2: P.lamb, rows: REC_ROWS },
  { id: "rb-fullback-robinson-gibbs", table: "rb", p1: BIJAN_AS_FB, p2: P.gibbs, rows: RB_ROWS },
  { id: "rb-robinson-gibbs-no-stuff-rate", table: "rb", p1: P.bijan, p2: P.gibbs, rows: RB_ROWS_GIBBS_NO_STUFF_RATE, pathsDiffer: true },
];
const PATHS = ["server", "browser"] as const;
type DataPath = (typeof PATHS)[number];
const SOURCE_TABLE: Record<Table, string> = { qb: "qb_season_stats", receivers: "receiver_season_stats", rb: "rb_season_stats" };

type Cell = { text: string; className: string };
type Pin = {
  radar: { values1: number[]; values2: number[]; missing1: boolean[]; missing2: boolean[] };
  chart: { color1: unknown; color2: unknown; name1: unknown; name2: unknown; axes: unknown };
  table: {
    headers: { text: string; className: string; style: string | null }[];
    rows: { a: Cell; stat: Cell; b: Cell }[];
  };
};

async function capture(c: Case, dataPath: DataPath): Promise<Pin> {
  params = new URLSearchParams(`p1=${c.p1.slug}&p2=${c.p2.slug}`);
  tables.player_slugs = { data: [c.p1, c.p2], error: null };
  const server: Record<Table, Row[]> = { qb: [], receivers: [], rb: [] };
  if (dataPath === "server") server[c.table] = c.rows;
  else tables[SOURCE_TABLE[c.table]] = { data: raw(c.rows), error: null };

  const { container } = render(
    <ComparisonTool
      qbs={server.qb as unknown as QBSeasonStat[]}
      receivers={server.receivers as unknown as ReceiverSeasonStat[]}
      rbs={server.rb as unknown as RBSeasonStat[]}
      season={2026}
    />,
  );
  await screen.findByRole("table", {}, { timeout: 3000 });
  // The path really is the one named: the browser read the season table only
  // when the server did not send it.
  expect(fromCalls.includes(SOURCE_TABLE[c.table])).toBe(dataPath === "browser");

  const props = captured.calls[captured.calls.length - 1];
  const cell = (el: Element): Cell => ({ text: el.textContent ?? "", className: el.className });
  return {
    radar: {
      values1: props.values1 as number[], values2: props.values2 as number[],
      missing1: props.missing1 as boolean[], missing2: props.missing2 as boolean[],
    },
    chart: { color1: props.color1, color2: props.color2, name1: props.name1, name2: props.name2, axes: props.axes },
    table: {
      headers: Array.from(container.querySelectorAll("thead th")).map((th) => ({
        text: th.textContent ?? "", className: th.className, style: th.getAttribute("style"),
      })),
      rows: Array.from(container.querySelectorAll("tbody tr")).map((tr) => {
        const [a, stat, b] = Array.from(tr.querySelectorAll("td")).map(cell);
        return { a, stat, b };
      }),
    },
  };
}

const EXPECTED_FILE = path.join(__dirname, "fixtures", "comparison-tool-pin.expected.json");
const EXPECTED = JSON.parse(readFileSync(EXPECTED_FILE, "utf8")) as { _about: string; pins: Record<string, Pin> };

beforeEach(() => {
  params = new URLSearchParams();
  tables = {};
  fromCalls.length = 0;
  captured.calls.length = 0;
});

describe("ComparisonTool pin: what /compare shows", () => {
  for (const c of CASES) {
    for (const dataPath of PATHS) {
      it(`${c.id} (${dataPath} rows)`, async () => {
        const pin = await capture(c, dataPath);
        const want = EXPECTED.pins[`${c.id}/${dataPath}`];
        expect(want, "this pair has no entry in the expected file").toBeDefined();
        expect(pin.radar).toEqual(want.radar);
        expect(pin.chart).toEqual(want.chart);
        expect(pin.table).toEqual(want.table);
      });
    }
  }

  it("the expected file holds exactly these pairs, nothing more", () => {
    expect(Object.keys(EXPECTED.pins).sort()).toEqual(
      CASES.flatMap((c) => PATHS.map((p) => `${c.id}/${p}`)).sort());
  });
});

describe("ComparisonTool pin: the expected file itself is what the spec says it is", () => {
  const pin = (id: string, dataPath: DataPath) => EXPECTED.pins[`${id}/${dataPath}`];

  it("RADAR ONLY: the chart and table parts are PR 1's, byte for byte (every cell, every highlight, colours, names, axes)", () => {
    // sha256 of the chart + table parts of all 20 entries, computed from the
    // expected file as PR 1 committed it (main 8c1bb70), before the pool switch.
    const PR1_CHART_AND_TABLE = "35c01fce2b873cf02e96ec071761530ba5faadb90aa44dc5005b68e80a773210";
    const canon = JSON.stringify(Object.keys(EXPECTED.pins).sort().map((k) => [k, EXPECTED.pins[k].chart, EXPECTED.pins[k].table]));
    expect(createHash("sha256").update(canon, "utf8").digest("hex")).toBe(PR1_CHART_AND_TABLE);
  });

  it("no NaN reaches the chart any more: numbers plus a mask", () => {
    for (const [key, p] of Object.entries(EXPECTED.pins)) {
      for (const values of [p.radar.values1, p.radar.values2]) {
        for (const v of values) expect(typeof v === "number" && !Number.isNaN(v), key).toBe(true);
      }
      expect(p.radar.missing1, key).toHaveLength(p.radar.values1.length);
      expect(p.radar.missing2, key).toHaveLength(p.radar.values2.length);
    }
  });

  it("null and \"NaN\" rows give the same page, except the one known quirk (F12)", () => {
    for (const c of CASES) {
      if (c.pathsDiffer) expect(pin(c.id, "browser")).not.toEqual(pin(c.id, "server"));
      else expect(pin(c.id, "browser"), c.id).toEqual(pin(c.id, "server"));
    }
  });

  it("F12 as it is today: a null stuff_rate plots as a 0% stuff rate (the best value), the string \"NaN\" at the centre; the table shows a dash for both", () => {
    const real = pin("rb-robinson-gibbs", "server");
    const server = pin("rb-robinson-gibbs-no-stuff-rate", "server");
    const browser = pin("rb-robinson-gibbs-no-stuff-rate", "browser");
    const STUFF_AVOID = 2;
    expect((real.chart.axes as { label: string }[])[STUFF_AVOID].label).toBe("Stuff Avoid");
    // 1 - null = 1, the value of a back who was never stuffed: he outranks
    // every qualified back with a stuff rate above 0 (ties do not count as below).
    const pool = rbCardPool(RB_ROWS_GIBBS_NO_STUFF_RATE as unknown as RBSeasonStat[]);
    expect(pool).toHaveLength(54);
    const stuffedAtLeastOnce = pool.filter((r) => (r.stuff_rate as number) > 0).length;
    expect(server.radar.values2[STUFF_AVOID]).toBe((stuffedAtLeastOnce / 54) * 100);
    expect(server.radar.values2[STUFF_AVOID]).toBeGreaterThan(real.radar.values2[STUFF_AVOID]);
    expect(browser.radar.values2[STUFF_AVOID]).toBe(0);
    expect(server.radar.missing2).toEqual(Array(6).fill(false));
    expect(browser.radar.missing2).toEqual(Array(6).fill(false));
    for (const p of [server, browser]) {
      const row = p.table.rows.find((r) => r.stat.text === "Stuff%")!;
      expect(row.b.text).toBe("—");
      expect(row.a.className).not.toContain("bg-green-50");
      expect(row.b.className).not.toContain("bg-green-50");
    }
  });

  it("a missing WR/TE axis reaches the chart as a masked 0; a missing QB/RB axis as a plain 0", () => {
    const YPRR = 5;
    for (const id of ["wr-lamb-smith-njigba", "te-mcbride-laporta", "wr-te-lamb-mcbride"]) {
      for (const p of PATHS) {
        expect(pin(id, p).radar.missing1).toEqual([false, false, false, false, false, true]);
        expect(pin(id, p).radar.missing2).toEqual([false, false, false, false, false, true]);
        expect(pin(id, p).radar.values1[YPRR]).toBe(0);
      }
    }
    // Missing for one player only: his mask is set, the other's is not.
    const YAC = 4;
    expect(pin("wr-valdes-scantling-lamb", "server").radar.missing1[YAC]).toBe(true);
    expect(pin("wr-valdes-scantling-lamb", "server").radar.missing2[YAC]).toBe(false);
    const RUSH_EPA = 6;
    for (const p of PATHS) {
      expect(pin("qb-penix-allen", p).radar.values1[RUSH_EPA]).toBe(0);
      expect(pin("qb-penix-allen", p).radar.missing1).toEqual(Array(7).fill(false));
    }
  });

  it("near-identical team colours: player 2 is moved to red; different colours are left alone", () => {
    // BUF #00338D and LA #003594 are almost the same blue.
    expect(pin("qb-allen-stafford", "server").chart).toMatchObject({ color1: "#00338D", color2: "#dc2626" });
    expect(pin("qb-stafford-allen", "server").chart).toMatchObject({ color1: "#003594", color2: "#dc2626" });
    // DAL #041E42 and SEA #002244 are both dark navy.
    expect(pin("wr-lamb-smith-njigba", "server").chart).toMatchObject({ color1: "#041E42", color2: "#dc2626" });
    expect(pin("rb-robinson-gibbs", "server").chart).toMatchObject({ color1: "#A71930", color2: "#0076B6" });
    // The table headers wear the same two colours as the chart.
    const headers = pin("qb-allen-stafford", "server").table.headers;
    expect(headers.map((h) => h.text)).toEqual(["Josh Allen", "Stat", "Matthew Stafford"]);
    expect(headers[0].style).toBe("color: rgb(0, 51, 141);");
    expect(headers[2].style).toBe("color: rgb(220, 38, 38);");
    expect(headers[1].style).toBeNull();
  });

  it("a fullback is compared exactly as a running back is", () => {
    expect(pin("rb-fullback-robinson-gibbs", "server")).toEqual(pin("rb-robinson-gibbs", "server"));
  });

  it("the reversed pair is the same two radars, swapped", () => {
    const ab = pin("qb-allen-stafford", "server").radar;
    const ba = pin("qb-stafford-allen", "server").radar;
    expect(ba.values1).toEqual(ab.values2);
    expect(ba.values2).toEqual(ab.values1);
  });

  it("agrees exactly with the Python reference for the five reference pairs (radar, colours, every cell, every highlight)", () => {
    type GoldSide = { name: string; color: string; values: (number | null)[] };
    type GoldPair = { a: GoldSide; b: GoldSide; axes: string[]; rows: { label: string; a: string; b: string; winner: number }[] };
    const gold = goldJson.pairs as unknown as Record<string, GoldPair>;
    const masked = (values: number[], missing: boolean[]) => values.map((v, i) => (missing[i] ? null : v));
    for (const c of CASES.filter((x) => x.gold)) {
      const g = gold[c.gold!];
      const p = pin(c.id, "server");
      expect(masked(p.radar.values1, p.radar.missing1), c.id).toEqual(g.a.values);
      expect(masked(p.radar.values2, p.radar.missing2), c.id).toEqual(g.b.values);
      expect(p.chart, c.id).toEqual({
        color1: g.a.color, color2: g.b.color, name1: g.a.name, name2: g.b.name,
        axes: g.axes.map((label) => ({ label })),
      });
      expect(p.table.rows.map((r) => ({
        label: r.stat.text, a: r.a.text, b: r.b.text,
        winner: r.a.className.includes("bg-green-50") ? 1 : r.b.className.includes("bg-green-50") ? 2 : 0,
      })), c.id).toEqual(g.rows.map(({ label, a, b, winner }) => ({ label, a, b, winner })));
    }
  });

  it("each player's radar on /compare is the radar of his own stat card (same rows, the card's own builder)", () => {
    const card = (table: Table, slug: Slug) => {
      if (table === "qb") {
        const all = QB_ROWS as unknown as QBSeasonStat[];
        return buildQBCardData(all.find((r) => r.player_id === slug.player_id)!, all, 2026);
      }
      if (table === "rb") {
        const all = RB_ROWS as unknown as RBSeasonStat[];
        return buildRBCardData(all.find((r) => r.player_id === slug.player_id)!, all, 2026);
      }
      const all = REC_ROWS as unknown as ReceiverSeasonStat[];
      return buildWRCardData(all.find((r) => r.player_id === slug.player_id)!, all, 2026);
    };
    for (const c of CASES.filter((x) => !x.pathsDiffer)) {
      const p = pin(c.id, "server").radar;
      const [one, two] = [card(c.table, c.p1), card(c.table, c.p2)];
      expect(p.values1, c.id).toEqual(one.radarValues);
      expect(p.values2, c.id).toEqual(two.radarValues);
      expect(p.missing1, c.id).toEqual(one.radarMissing ?? one.radarValues.map(() => false));
      expect(p.missing2, c.id).toEqual(two.radarMissing ?? two.radarValues.map(() => false));
    }
  });

  it("every row of every table is pinned: 18 for quarterbacks, 14 for receivers, 12 for running backs", () => {
    expect(pin("qb-allen-stafford", "server").table.rows).toHaveLength(18);
    expect(pin("wr-lamb-smith-njigba", "server").table.rows).toHaveLength(14);
    expect(pin("rb-robinson-gibbs", "server").table.rows).toHaveLength(12);
  });
});
