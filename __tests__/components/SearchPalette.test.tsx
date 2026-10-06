import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

// Read resilience spec §1.5, sentence S1. The palette ignored the query's
// `error`, so a failed (or timed-out) player search read as "No results for
// 'allen'", which is false. Team matches are computed in the browser and must
// keep listing either way.
//
// Real timers: the palette debounces 200 ms, and fake timers fight
// findBy/waitFor. The fake client resolves at once.
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

type Result = { data: unknown; error: unknown };
let nextResult: Result | (() => Result) = { data: [], error: null };
const fromCalls: string[] = [];
const getSupabaseClient = vi.fn();

vi.mock("@/lib/supabase/client", () => ({
  getSupabaseClient: () => getSupabaseClient(),
}));

function fakeClient() {
  const builder: Record<string, unknown> = {};
  for (const m of ["select", "ilike", "order", "limit", "eq", "in"]) builder[m] = () => builder;
  builder.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
    Promise.resolve(typeof nextResult === "function" ? nextResult() : nextResult).then(res, rej);
  return {
    from: (table: string) => {
      fromCalls.push(table);
      return builder;
    },
  };
}

import SearchPalette from "@/components/search/SearchPalette";

const S1 = "Player search isn't responding right now. Try again in a moment.";
const FAIL: Result = { data: null, error: { message: "TimeoutError: The operation was aborted due to timeout" } };
const ALLEN = { player_id: "00-0034857", slug: "josh-allen", player_name: "Josh Allen", position: "QB", current_team_id: "BUF" };

function type(value: string) {
  fireEvent.change(screen.getByPlaceholderText("Search players and teams..."), { target: { value } });
}

/** Wait until the debounced search for the current text has been sent and answered. */
async function searchSettled(calls: number) {
  await waitFor(() => expect(fromCalls).toHaveLength(calls), { timeout: 2000 });
  // let the awaited result and the state updates after it flush
  await waitFor(() => expect(document.querySelector(".animate-spin")).toBeNull(), { timeout: 2000 });
}

beforeEach(() => {
  nextResult = { data: [], error: null };
  fromCalls.length = 0;
  getSupabaseClient.mockReset();
  getSupabaseClient.mockImplementation(fakeClient);
});

describe("SearchPalette", () => {
  it("a failed player search shows S1 instead of a false 'No results'", async () => {
    nextResult = FAIL;
    render(<SearchPalette open onClose={vi.fn()} />);
    type("allen");
    expect(await screen.findByText(S1, {}, { timeout: 2000 })).toBeTruthy();
    expect(screen.queryByText(/No results for/)).toBeNull();
  });

  it("team matches still list above S1 when the player search fails", async () => {
    nextResult = FAIL;
    render(<SearchPalette open onClose={vi.fn()} />);
    type("buffalo");
    const sentence = await screen.findByText(S1, {}, { timeout: 2000 });
    const team = screen.getByText("Buffalo Bills");
    expect(team).toBeTruthy();
    // DOM order: the team row comes before the sentence.
    expect(team.compareDocumentPosition(sentence) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.queryByText(/No results for/)).toBeNull();
  });

  it("a thrown client (missing env vars) counts as a failed search", async () => {
    getSupabaseClient.mockImplementation(() => {
      throw new Error("Missing Supabase env vars");
    });
    render(<SearchPalette open onClose={vi.fn()} />);
    type("allen");
    expect(await screen.findByText(S1, {}, { timeout: 2000 })).toBeTruthy();
    expect(screen.queryByText(/No results for/)).toBeNull();
  });

  it("a healthy search with no matches still says 'No results', and never S1", async () => {
    render(<SearchPalette open onClose={vi.fn()} />);
    type("zzzzqq");
    expect(await screen.findByText(/No results for/, {}, { timeout: 2000 })).toBeTruthy();
    expect(screen.getByText(/No results for/).textContent).toBe("No results for “zzzzqq”");
    expect(screen.queryByText(S1)).toBeNull();
  });

  it("a healthy search lists the players and shows neither message", async () => {
    nextResult = { data: [ALLEN], error: null };
    render(<SearchPalette open onClose={vi.fn()} />);
    type("allen");
    expect(await screen.findByText("Josh Allen", {}, { timeout: 2000 })).toBeTruthy();
    expect(screen.queryByText(S1)).toBeNull();
    expect(screen.queryByText(/No results for/)).toBeNull();
  });

  it("one letter never searches players, so it can only say 'No results'", async () => {
    nextResult = FAIL;
    render(<SearchPalette open onClose={vi.fn()} />);
    type("q");
    expect(await screen.findByText(/No results for/, {}, { timeout: 2000 })).toBeTruthy();
    expect(fromCalls).toHaveLength(0);
    expect(screen.queryByText(S1)).toBeNull();
  });

  it("S1 clears when the next search succeeds, and when the box is emptied", async () => {
    nextResult = FAIL;
    render(<SearchPalette open onClose={vi.fn()} />);
    type("allen");
    expect(await screen.findByText(S1, {}, { timeout: 2000 })).toBeTruthy();

    nextResult = { data: [ALLEN], error: null };
    type("josh");
    expect(await screen.findByText("Josh Allen", {}, { timeout: 2000 })).toBeTruthy();
    expect(screen.queryByText(S1)).toBeNull();

    nextResult = FAIL;
    type("allen");
    await searchSettled(3);
    expect(screen.getByText(S1)).toBeTruthy();
    type("");
    await waitFor(() => expect(screen.queryByText(S1)).toBeNull(), { timeout: 2000 });
    expect(screen.queryByText(/No results for/)).toBeNull();
  });

  it("renders the sentence with a real apostrophe, not an escape sequence", async () => {
    nextResult = FAIL;
    const { container } = render(<SearchPalette open onClose={vi.fn()} />);
    type("allen");
    await screen.findByText(S1, {}, { timeout: 2000 });
    expect(container.textContent).toContain("isn't");
    expect(container.textContent).not.toMatch(/\\u|&apos;|&#39;/);
  });
});
