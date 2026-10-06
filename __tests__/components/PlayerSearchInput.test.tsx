import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

// Read resilience spec §1.5, sentence S2 (the Compare page's player picker).
// The picker ignored the query's `error`: a failed search closed the
// "Searching..." box and showed nothing, exactly like a name nobody has.
// It has no "No results" text of its own, so S2 is the only message here and
// a healthy empty search must still show nothing.
type Result = { data: unknown; error: unknown };
let nextResult: Result = { data: [], error: null };
const filters: unknown[][] = [];
const getSupabaseClient = vi.fn();

vi.mock("@/lib/supabase/client", () => ({
  getSupabaseClient: () => getSupabaseClient(),
}));

function fakeClient() {
  const builder: Record<string, unknown> = {};
  for (const m of ["select", "ilike", "order", "limit", "eq", "in"]) {
    builder[m] = (...a: unknown[]) => {
      filters.push([m, ...a]);
      return builder;
    };
  }
  builder.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
    Promise.resolve(nextResult).then(res, rej);
  return { from: () => builder };
}

import PlayerSearchInput from "@/components/compare/PlayerSearchInput";

const S2 = "Player search isn't responding right now. Try again in a moment.";
const FAIL: Result = { data: null, error: { message: "TypeError: Failed to fetch" } };
const ALLEN = { player_id: "00-0034857", slug: "josh-allen", player_name: "Josh Allen", position: "QB", current_team_id: "BUF" };

function type(value: string) {
  fireEvent.change(screen.getByPlaceholderText("Search players..."), { target: { value } });
}

/** Wait for the debounced search to be sent and its "Searching..." box to close. */
async function searchSettled() {
  await waitFor(() => expect(filters.some((f) => f[0] === "ilike")).toBe(true), { timeout: 2000 });
  await waitFor(() => expect(screen.queryByText("Searching...")).toBeNull(), { timeout: 2000 });
}

beforeEach(() => {
  nextResult = { data: [], error: null };
  filters.length = 0;
  getSupabaseClient.mockReset();
  getSupabaseClient.mockImplementation(fakeClient);
});

describe("PlayerSearchInput", () => {
  it("a failed search shows S2 where the results would be", async () => {
    nextResult = FAIL;
    render(<PlayerSearchInput label="Player 1" selected={null} onSelect={vi.fn()} />);
    type("allen");
    expect(await screen.findByText(S2, {}, { timeout: 2000 })).toBeTruthy();
    expect(screen.queryByText("Searching...")).toBeNull();
  });

  it("a thrown client counts as a failed search, and the 'Searching...' box does not stick", async () => {
    getSupabaseClient.mockImplementation(() => {
      throw new Error("Missing Supabase env vars");
    });
    render(<PlayerSearchInput label="Player 1" selected={null} onSelect={vi.fn()} />);
    type("allen");
    expect(await screen.findByText(S2, {}, { timeout: 2000 })).toBeTruthy();
    expect(screen.queryByText("Searching...")).toBeNull();
  });

  it("a healthy search with no matches shows nothing (unchanged), and never S2", async () => {
    render(<PlayerSearchInput label="Player 1" selected={null} onSelect={vi.fn()} />);
    type("zzzzqq");
    await searchSettled();
    expect(screen.queryByText(S2)).toBeNull();
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });

  it("a healthy search lists the players, and picking one works", async () => {
    nextResult = { data: [ALLEN], error: null };
    const onSelect = vi.fn();
    render(<PlayerSearchInput label="Player 1" selected={null} onSelect={onSelect} />);
    type("allen");
    fireEvent.click(await screen.findByText("Josh Allen", {}, { timeout: 2000 }));
    expect(onSelect).toHaveBeenCalledWith(ALLEN);
    expect(screen.queryByText(S2)).toBeNull();
  });

  it("the position filter still reaches the query (RB includes FB)", async () => {
    render(<PlayerSearchInput label="Player 2" selected={null} onSelect={vi.fn()} positionFilter="RB" />);
    type("cook");
    await searchSettled();
    expect(filters).toContainEqual(["in", "position", ["RB", "FB"]]);
  });

  it("S2 clears on the next successful search, and when the text drops under two letters", async () => {
    nextResult = FAIL;
    render(<PlayerSearchInput label="Player 1" selected={null} onSelect={vi.fn()} />);
    type("allen");
    expect(await screen.findByText(S2, {}, { timeout: 2000 })).toBeTruthy();

    nextResult = { data: [ALLEN], error: null };
    type("josh");
    expect(await screen.findByText("Josh Allen", {}, { timeout: 2000 })).toBeTruthy();
    expect(screen.queryByText(S2)).toBeNull();

    nextResult = FAIL;
    type("allen");
    expect(await screen.findByText(S2, {}, { timeout: 2000 })).toBeTruthy();
    type("a");
    await waitFor(() => expect(screen.queryByText(S2)).toBeNull(), { timeout: 2000 });
  });
});
