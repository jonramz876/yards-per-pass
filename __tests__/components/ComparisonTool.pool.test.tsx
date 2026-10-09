import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";

// Compare card spec 2026-10-09, PR 1b: the Compare page's radar ranks each
// player in the stat card's pool, and the page says so. Three sentences are
// new on /compare (C4 the pool, C4z too few qualified players, C6 a small
// sample) and the chart's legend line is reworded (C5). The real chart is
// rendered here, not a stand-in: these tests read what a visitor sees.

let params = new URLSearchParams();
vi.mock("next/navigation", () => ({
  useSearchParams: () => params,
  useRouter: () => ({ replace: () => undefined }),
  usePathname: () => "/compare",
}));

type Result = { data: unknown; error: unknown };
let tables: Record<string, Result> = {};
vi.mock("@/lib/supabase/client", () => ({
  getSupabaseClient: () => ({
    from: (table: string) => {
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
// Real 2026 season rows through Week 4 (see the file's _provenance line).
import rowsJson from "../stats/fixtures/compare-2026-w4-rows.json";

type Row = Record<string, unknown>;
const QB_ROWS = rowsJson.qb as Row[];
const REC_ROWS = rowsJson.receivers as Row[];
const RB_ROWS = rowsJson.rb as Row[];

type Slug = { player_id: string; slug: string; player_name: string; position: string; current_team_id: string };
const slug = (table: Row[], short: string, full: string, position: string): Slug => {
  const hits = table.filter((r) => r.player_name === short);
  expect(hits, short).toHaveLength(1);
  return {
    player_id: hits[0].player_id as string, slug: full.toLowerCase().replace(/[^a-z]+/g, "-"),
    player_name: full, position, current_team_id: hits[0].team_id as string,
  };
};

const LEGEND = "Farther out = higher percentile · dashed ring = 50th percentile";

async function show(p1: Slug, p2: Slug, rows: { qb?: Row[]; receivers?: Row[]; rb?: Row[] }) {
  params = new URLSearchParams(`p1=${p1.slug}&p2=${p2.slug}`);
  tables.player_slugs = { data: [p1, p2], error: null };
  const view = render(
    <ComparisonTool
      qbs={(rows.qb ?? []) as unknown as QBSeasonStat[]}
      receivers={(rows.receivers ?? []) as unknown as ReceiverSeasonStat[]}
      rbs={(rows.rb ?? []) as unknown as RBSeasonStat[]}
      season={2026}
    />,
  );
  await screen.findByRole("table", {}, { timeout: 3000 });
  const text = view.container.textContent ?? "";
  return {
    ...view, text,
    radarDrawn: view.container.querySelector("svg polygon") !== null,
    count: (sentence: string) => text.split(sentence).length - 1,
  };
}

beforeEach(() => {
  params = new URLSearchParams();
  tables = {};
});

describe("/compare says which players the radar ranks against (C4)", () => {
  it("two quarterbacks: the 42 qualified quarterbacks, once, under a drawn radar; the legend once; no small-sample line", async () => {
    const v = await show(slug(QB_ROWS, "J.Allen", "Josh Allen", "QB"), slug(QB_ROWS, "M.Stafford", "Matthew Stafford", "QB"), { qb: QB_ROWS });
    expect(v.radarDrawn).toBe(true);
    expect(v.count("Radar: percentile among the 42 qualified quarterbacks (14+ attempts a game)")).toBe(1);
    expect(v.count(LEGEND)).toBe(1);
    expect(v.text).not.toMatch(/league best/);
    expect(v.text).not.toMatch(/Small sample/);
    expect(v.text).not.toMatch(/Not enough qualified/);
  });

  it("two running backs, two WRs, two TEs", async () => {
    const rb = await show(slug(RB_ROWS, "Bi.Robinson", "Bijan Robinson", "RB"), slug(RB_ROWS, "J.Gibbs", "Jahmyr Gibbs", "RB"), { rb: RB_ROWS });
    expect(rb.count("Radar: percentile among the 54 qualified running backs (6+ carries a game)")).toBe(1);
    rb.unmount();
    const wr = await show(slug(REC_ROWS, "C.Lamb", "CeeDee Lamb", "WR"), slug(REC_ROWS, "J.Smith-Njigba", "Jaxon Smith-Njigba", "WR"), { receivers: REC_ROWS });
    expect(wr.count("Radar: percentile among the 129 qualified WRs (2+ targets a game)")).toBe(1);
    wr.unmount();
    const te = await show(slug(REC_ROWS, "T.McBride", "Trey McBride", "TE"), slug(REC_ROWS, "S.LaPorta", "Sam LaPorta", "TE"), { receivers: REC_ROWS });
    expect(te.count("Radar: percentile among the 56 qualified TEs (2+ targets a game)")).toBe(1);
  });

  it("a WR against a TE (a hand-typed link): each against his own position, both counts", async () => {
    const v = await show(slug(REC_ROWS, "C.Lamb", "CeeDee Lamb", "WR"), slug(REC_ROWS, "T.McBride", "Trey McBride", "TE"), { receivers: REC_ROWS });
    expect(v.radarDrawn).toBe(true);
    expect(v.count("Radar: each player against qualified players at his position (2+ targets a game): 129 WRs, 56 TEs")).toBe(1);
  });
});

describe("/compare flags a small sample (C6)", () => {
  it("a backup quarterback under 14 attempts a game: still drawn, with the sentence under the pool line", async () => {
    const v = await show(slug(QB_ROWS, "T.Huntley", "Tyler Huntley", "QB"), slug(QB_ROWS, "J.Allen", "Josh Allen", "QB"), { qb: QB_ROWS });
    expect(v.radarDrawn).toBe(true);
    expect(v.count("Small sample: T.Huntley has 9 pass attempts in 1 game (under 14 a game).")).toBe(1);
    expect(v.count("Radar: percentile among the 42 qualified quarterbacks (14+ attempts a game)")).toBe(1);
    // The stat card's OVR is not shown on /compare, so nothing is said about it here.
    expect(v.text).not.toMatch(/OVR/);
    expect(v.text.indexOf("Radar: percentile")).toBeLessThan(v.text.indexOf("Small sample"));
  });

  it("both under the line: one sentence", async () => {
    const v = await show(slug(REC_ROWS, "O.Zaccheaus", "Olamide Zaccheaus", "WR"), slug(REC_ROWS, "M.Valdes-Scantling", "Marquez Valdes-Scantling", "WR"), { receivers: REC_ROWS });
    expect(v.count("Small sample: O.Zaccheaus has 7 targets in 4 games; M.Valdes-Scantling has 2 targets in 2 games (under 2 a game).")).toBe(1);
  });

  const qb = (id: string, name: string, attempts: number, games: number, epa: number): Row =>
    ({ player_id: id, player_name: name, team_id: "BUF", attempts, games, dropbacks: attempts, epa_per_db: epa, interceptions: 1, rush_attempts: 0 });
  const as = (id: string, full: string): Slug => ({ player_id: id, slug: id, player_name: full, position: "QB", current_team_id: "BUF" });

  it("13.9 attempts a game shows it, 14.0 does not", async () => {
    const rows = [qb("a", "A.Low", 139, 10, 0.1), qb("b", "B.Line", 140, 10, 0.2), qb("c", "C.Starter", 300, 10, 0.3)];
    const under = await show(as("a", "Al Low"), as("c", "Cy Starter"), { qb: rows });
    expect(under.count("Small sample: A.Low has 139 pass attempts in 10 games (under 14 a game).")).toBe(1);
    under.unmount();
    const onTheLine = await show(as("b", "Bo Line"), as("c", "Cy Starter"), { qb: rows });
    expect(onTheLine.text).not.toMatch(/Small sample/);
    expect(onTheLine.count("Radar: percentile among the 2 qualified quarterbacks (14+ attempts a game)")).toBe(1);
  });

  it("two players with the same short name are written with their full names", async () => {
    const rows = [qb("a", "J.Williams", 6, 2, 0.1), qb("b", "J.Williams", 3, 2, 0.2), qb("c", "C.Starter", 300, 10, 0.3), qb("d", "D.Starter", 280, 10, 0.1)];
    const v = await show(as("a", "Jameson Williams"), as("b", "Javonte Williams"), { qb: rows });
    expect(v.count("Small sample: Jameson Williams has 6 pass attempts in 2 games; Javonte Williams has 3 pass attempts in 2 games (under 14 a game).")).toBe(1);
  });
});

describe("/compare with too few qualified players (C4z)", () => {
  const qb = (id: string, name: string, attempts: number, games: number): Row =>
    ({ player_id: id, player_name: name, team_id: "BUF", attempts, games, dropbacks: attempts, epa_per_db: 0.1, interceptions: 0, rush_attempts: 0, passing_yards: attempts * 7 });
  const as = (id: string, full: string): Slug => ({ player_id: id, slug: id, player_name: full, position: "QB", current_team_id: "BUF" });

  it("one qualified quarterback: the sentence replaces the radar, the table still shows, and no other radar sentence appears", async () => {
    const v = await show(as("a", "Al Starter"), as("b", "Bo Backup"), { qb: [qb("a", "A.Starter", 30, 1), qb("b", "B.Backup", 4, 1)] });
    expect(v.radarDrawn).toBe(false);
    expect(v.count("Not enough qualified quarterbacks yet to draw the radar (14+ attempts a game).")).toBe(1);
    expect(v.text).not.toMatch(/Radar: /);
    expect(v.text).not.toMatch(/qualified quarterbacks \(/);
    expect(v.text).not.toMatch(/Small sample/);
    expect(v.count(LEGEND)).toBe(0);
    expect(screen.getByText("Pass Yds")).toBeTruthy();
    expect(screen.getByText("210")).toBeTruthy();
  });

  it("two qualified: the radar is drawn", async () => {
    const v = await show(as("a", "Al Starter"), as("b", "Bo Starter"), { qb: [qb("a", "A.Starter", 30, 1), qb("b", "B.Starter", 14, 1)] });
    expect(v.radarDrawn).toBe(true);
    expect(v.text).not.toMatch(/Not enough qualified/);
    expect(v.count("Radar: percentile among the 2 qualified quarterbacks (14+ attempts a game)")).toBe(1);
  });

  it("a WR against a TE with both pools short names both positions", async () => {
    const rec = (id: string, position: string): Row => ({ player_id: id, player_name: id, team_id: "DAL", position, targets: 9, games: 1 });
    const as2 = (id: string, position: string): Slug => ({ player_id: id, slug: id, player_name: id.toUpperCase(), position, current_team_id: "DAL" });
    const v = await show(as2("w", "WR"), as2("t", "TE"), { receivers: [rec("w", "WR"), rec("t", "TE")] });
    expect(v.radarDrawn).toBe(false);
    expect(v.count("Not enough qualified WRs or TEs yet to draw the radar (2+ targets a game).")).toBe(1);
  });
});
