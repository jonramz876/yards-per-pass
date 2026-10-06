import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { createClient } from "@supabase/supabase-js";
import { withReadTimeout } from "@/lib/supabase/timeout";

// Read resilience PR 1B: the browser's own reads (site search, the Compare
// pickers, the Compare tool) run through the real supabase-js client with the
// read limit, over a fetch that never answers. When the limit passes, the
// visitor gets the same sentence a failed read gives (PR 1A's S1, S2, S3),
// not an endless spinner and not a false "No results".
//
// Real timers and a 40 ms limit: the production limit is 15 s
// (SUPABASE_BROWSER_READ_TIMEOUT_MS, pinned in supabase-timeout.test.ts) and
// React Testing Library's findBy does not mix with fake timers.
let params = new URLSearchParams();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => params,
  usePathname: () => "/compare",
}));
vi.mock("@/components/compare/OverlayRadarChart", () => ({ default: () => null }));

const requests: string[] = [];
function stalledFetch(input: unknown, init?: RequestInit): Promise<Response> {
  requests.push(String(input instanceof Request ? input.url : input));
  const signal = init?.signal;
  if (signal?.aborted) return Promise.reject(signal.reason);
  return new Promise<Response>((_resolve, reject) => {
    signal?.addEventListener("abort", () => reject(signal.reason), { once: true });
  });
}

const stalledClient = createClient("https://abcdefghijklmnop.supabase.co", "anon-key", {
  auth: { persistSession: false, autoRefreshToken: false },
  global: { fetch: withReadTimeout(stalledFetch as unknown as typeof fetch, 40) },
});

vi.mock("@/lib/supabase/client", () => ({
  getSupabaseClient: () => stalledClient,
}));

import SearchPalette from "@/components/search/SearchPalette";
import PlayerSearchInput from "@/components/compare/PlayerSearchInput";
import ComparisonTool from "@/components/compare/ComparisonTool";

const SEARCH_DOWN = "Player search isn't responding right now. Try again in a moment.";
const COMPARE_DOWN = "Couldn't load stats for this comparison. Try again in a moment.";

beforeEach(() => {
  requests.length = 0;
  params = new URLSearchParams();
});

describe("a browser read that times out shows the failed-read sentence", () => {
  it("site search: team matches still list, then S1; never 'No results'", async () => {
    render(<SearchPalette open onClose={vi.fn()} />);
    fireEvent.change(screen.getByPlaceholderText("Search players and teams..."), { target: { value: "buffalo" } });
    expect(await screen.findByText(SEARCH_DOWN, {}, { timeout: 3000 })).toBeTruthy();
    expect(screen.getByText("Buffalo Bills")).toBeTruthy();
    expect(screen.queryByText(/No results for/)).toBeNull();
    expect(requests.some((u) => u.includes("/rest/v1/player_slugs"))).toBe(true);
    // The spinner is gone: the read ended.
    expect(document.querySelector(".animate-spin")).toBeNull();
  });

  it("Compare picker: S2, and 'Searching...' does not stick", async () => {
    render(<PlayerSearchInput label="Player 1" selected={null} onSelect={vi.fn()} />);
    fireEvent.change(screen.getByPlaceholderText("Search players..."), { target: { value: "allen" } });
    expect(await screen.findByText(SEARCH_DOWN, {}, { timeout: 3000 })).toBeTruthy();
    expect(screen.queryByText("Searching...")).toBeNull();
  });

  it("Compare tool: restoring the players from the URL times out → S3 above the empty state", async () => {
    params = new URLSearchParams("p1=josh-allen&p2=patrick-mahomes");
    render(<ComparisonTool qbs={[]} receivers={[]} rbs={[]} season={2026} />);
    expect(await screen.findByText(COMPARE_DOWN, {}, { timeout: 3000 })).toBeTruthy();
    expect(screen.getByText("Select two players to compare")).toBeTruthy();
  });
});
