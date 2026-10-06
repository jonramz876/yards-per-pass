import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

// Read resilience spec §1.5, sentence S3. The Compare tool makes two kinds of
// read from the browser and ignored `error` on both:
//   1. restoring the players named in the URL (?p1=&p2=): on failure nobody
//      was selected and the page looked as if the link named no players;
//   2. the season table for the chosen position, when the server did not send
//      it: on failure both players stayed selected over a blank area.
// Either now shows S3 directly under the two pickers.
let params = new URLSearchParams();
const replace = vi.fn();
vi.mock("next/navigation", () => ({
  useSearchParams: () => params,
  useRouter: () => ({ replace }),
  usePathname: () => "/compare",
}));

vi.mock("@/components/compare/OverlayRadarChart", () => ({ default: () => null }));

type Result = { data: unknown; error: unknown };
let tables: Record<string, Result> = {};
const fromCalls: string[] = [];
const getSupabaseClient = vi.fn();

vi.mock("@/lib/supabase/client", () => ({
  getSupabaseClient: () => getSupabaseClient(),
}));

function fakeClient() {
  return {
    from: (table: string) => {
      fromCalls.push(table);
      const builder: Record<string, unknown> = {};
      for (const m of ["select", "ilike", "order", "limit", "eq", "in"]) builder[m] = () => builder;
      builder.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
        Promise.resolve(tables[table] ?? { data: [], error: null }).then(res, rej);
      return builder;
    },
  };
}

import ComparisonTool from "@/components/compare/ComparisonTool";
import type { QBSeasonStat } from "@/lib/types";

const S3 = "Couldn't load stats for this comparison. Try again in a moment.";
const FAIL: Result = { data: null, error: { message: "TypeError: Failed to fetch" } };

const ALLEN = { player_id: "00-0034857", slug: "josh-allen", player_name: "Josh Allen", position: "QB", current_team_id: "BUF" };
const MAHOMES = { player_id: "00-0033873", slug: "patrick-mahomes", player_name: "Patrick Mahomes", position: "QB", current_team_id: "KC" };
const qb = (p: typeof ALLEN, epa: number) =>
  ({ player_id: p.player_id, player_name: p.player_name, team_id: p.current_team_id, epa_per_db: epa, games: 4 }) as unknown as QBSeasonStat;
const QB_ROWS = [qb(ALLEN, 0.25), qb(MAHOMES, 0.15)];

const tool = (qbs: QBSeasonStat[] = []) => <ComparisonTool qbs={qbs} receivers={[]} rbs={[]} season={2026} />;

beforeEach(() => {
  params = new URLSearchParams();
  tables = {};
  fromCalls.length = 0;
  replace.mockReset();
  getSupabaseClient.mockReset();
  getSupabaseClient.mockImplementation(fakeClient);
});

describe("ComparisonTool", () => {
  it("with no players in the URL: the empty state, no read, no S3", async () => {
    render(tool());
    expect(screen.getByText("Select two players to compare")).toBeTruthy();
    expect(fromCalls).toHaveLength(0);
    expect(screen.queryByText(S3)).toBeNull();
  });

  it("the URL-restore read fails → S3, and the visitor can still pick players by hand", async () => {
    params = new URLSearchParams("p1=josh-allen&p2=patrick-mahomes");
    tables.player_slugs = FAIL;
    render(tool());
    expect(await screen.findByText(S3, {}, { timeout: 2000 })).toBeTruthy();
    expect(screen.getByText("Select two players to compare")).toBeTruthy();
    expect(screen.getAllByPlaceholderText("Search players...")).toHaveLength(2);
  });

  it("the season-table read fails → S3 where the comparison would be", async () => {
    params = new URLSearchParams("p1=josh-allen&p2=patrick-mahomes");
    tables.player_slugs = { data: [ALLEN, MAHOMES], error: null };
    tables.qb_season_stats = FAIL;
    render(tool());
    expect(await screen.findByText(S3, {}, { timeout: 2000 })).toBeTruthy();
    // Both players are selected; no stat table rendered.
    expect(screen.getByText("Josh Allen")).toBeTruthy();
    expect(screen.getByText("Patrick Mahomes")).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
    expect(fromCalls).toContain("qb_season_stats");
  });

  it("a thrown client (missing env vars) shows S3 instead of crashing the page", async () => {
    params = new URLSearchParams("p1=josh-allen");
    getSupabaseClient.mockImplementation(() => {
      throw new Error("Missing Supabase env vars");
    });
    render(tool());
    expect(await screen.findByText(S3, {}, { timeout: 2000 })).toBeTruthy();
  });

  it("healthy: players restored from the URL and the table loaded in the browser → the comparison, no S3", async () => {
    params = new URLSearchParams("p1=josh-allen&p2=patrick-mahomes");
    tables.player_slugs = { data: [ALLEN, MAHOMES], error: null };
    tables.qb_season_stats = { data: QB_ROWS, error: null };
    render(tool());
    expect(await screen.findByRole("table", {}, { timeout: 2000 })).toBeTruthy();
    expect(screen.getByText("EPA/DB")).toBeTruthy();
    expect(screen.queryByText(S3)).toBeNull();
  });

  it("healthy: the server sent the table, so the browser reads only the players", async () => {
    params = new URLSearchParams("p1=josh-allen&p2=patrick-mahomes");
    tables.player_slugs = { data: [ALLEN, MAHOMES], error: null };
    render(tool(QB_ROWS));
    expect(await screen.findByRole("table", {}, { timeout: 2000 })).toBeTruthy();
    expect(fromCalls).toEqual(["player_slugs"]);
    expect(screen.queryByText(S3)).toBeNull();
  });

  it("a slug in the URL that matches nobody is not an error: no S3", async () => {
    params = new URLSearchParams("p1=no-such-player");
    tables.player_slugs = { data: [], error: null };
    render(tool());
    await waitFor(() => expect(fromCalls).toEqual(["player_slugs"]), { timeout: 2000 });
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByText(S3)).toBeNull();
    expect(screen.getByText("Select two players to compare")).toBeTruthy();
  });

  it("S3 clears when Player 1 is changed", async () => {
    params = new URLSearchParams("p1=josh-allen&p2=patrick-mahomes");
    tables.player_slugs = { data: [ALLEN, MAHOMES], error: null };
    tables.qb_season_stats = FAIL;
    render(tool());
    expect(await screen.findByText(S3, {}, { timeout: 2000 })).toBeTruthy();
    fireEvent.click(screen.getAllByLabelText("Clear selection")[0]);
    await waitFor(() => expect(screen.queryByText(S3)).toBeNull(), { timeout: 2000 });
    expect(screen.getByText("Select two players to compare")).toBeTruthy();
  });

  it("renders the sentence with a real apostrophe, not an escape sequence", async () => {
    params = new URLSearchParams("p1=josh-allen");
    tables.player_slugs = FAIL;
    const { container } = render(tool());
    await screen.findByText(S3, {}, { timeout: 2000 });
    expect(container.textContent).toContain("Couldn't");
    expect(container.textContent).not.toMatch(/\\u|&apos;|&#39;/);
  });
});
