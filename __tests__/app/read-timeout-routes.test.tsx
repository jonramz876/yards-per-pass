import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// Read resilience PR 1B, end to end below the network: the REAL server client
// (lib/supabase/server.ts), the real supabase-js, the real loaders and the
// real routes, over a global fetch that accepts the request and never answers
// (a stalled Supabase gateway). Nothing here mocks a loader.
//
// The rule being pinned: a read that times out surfaces exactly like a read
// that fails (PR 1A). Each route class ends at about 5 seconds as an error
// (a rejected page function, which Next hands to error.tsx, or a 503), never
// as a 404, never as an empty page, never as a hang.
vi.mock("next/navigation", () => ({
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
  redirect: vi.fn((url: string) => {
    throw new Error("NEXT_REDIRECT:" + url);
  }),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("next/dynamic", () => ({ default: () => () => null }));
vi.mock("next/og", () => ({
  ImageResponse: class extends Response {
    constructor() {
      super("png", { status: 200 });
    }
  },
}));
vi.mock("@/lib/og/tecmo-card-image", () => ({
  loadHeadshotDataUri: vi.fn(async () => null),
  pixelFontOptions: vi.fn(async () => undefined),
  tecmoCardImage: vi.fn(() => "CARD"),
  brandedFallbackImage: vi.fn(() => "BRAND PLATE"),
  namePlateImage: vi.fn(() => "NAME PLATE"),
}));

import { notFound } from "next/navigation";
import { GET as health } from "@/app/api/health/route";
import { GET as statCard } from "@/app/api/stat-card/[slug]/route";
import PlayerPage, { generateMetadata as playerMetadata } from "@/app/player/[slug]/page";
import CardPage from "@/app/card/[slug]/page";
import TeamPage from "@/app/team/[team_id]/page";
import QBPage, { generateMetadata as qbMetadata } from "@/app/qb-leaderboard/page";
import HomePage from "@/app/page";
import { getAvailableSeasons, getDataFreshness } from "@/lib/data/queries";
import { getAllPlayerSlugs, getPlayerBySlug } from "@/lib/data/players";
import { hasScheduleForSeason } from "@/lib/data/games";
import { getAllGapData } from "@/lib/data/run-gaps";

const TIMED_OUT = "TimeoutError: read timed out after 5 s";

let requests: string[] = [];

/** A gateway that accepts every request and never answers. */
function stalledFetch(input: unknown, init?: RequestInit): Promise<Response> {
  requests.push(String(input instanceof Request ? input.url : input));
  const signal = init?.signal;
  if (signal?.aborted) return Promise.reject(signal.reason);
  return new Promise<Response>((_resolve, reject) => {
    signal?.addEventListener("abort", () => reject(signal.reason), { once: true });
  });
}

type Outcome<T> = { ok: true; value: T } | { ok: false; error: unknown };

/**
 * Run something against the stalled gateway and report how it ended, checking
 * the two things every row cares about: it is still waiting shortly before
 * 5 s (the limit is not shorter), and it has ended shortly after (not a hang).
 * 100 ms of slack each side: supabase-js does a little async work of its own
 * before it calls fetch.
 */
async function endsAtFiveSeconds<T>(start: () => Promise<T>): Promise<Outcome<T>> {
  let outcome: Outcome<T> | null = null;
  start().then(
    (value) => {
      outcome = { ok: true, value };
    },
    (error: unknown) => {
      outcome = { ok: false, error };
    },
  );
  await vi.advanceTimersByTimeAsync(4900);
  expect(outcome, "ended before 4.9 s: the limit is shorter than 5 s").toBeNull();
  expect(requests.length, "no request was sent").toBeGreaterThan(0);
  await vi.advanceTimersByTimeAsync(200);
  expect(outcome, "still waiting at 5.1 s: this read hangs").not.toBeNull();
  return outcome as unknown as Outcome<T>;
}

function rejection(outcome: Outcome<unknown>): Error {
  expect(outcome.ok, "expected a rejection, but it resolved").toBe(false);
  const error = (outcome as { ok: false; error: unknown }).error;
  expect(error).toBeInstanceOf(Error);
  return error as Error;
}

beforeEach(() => {
  requests = [];
  vi.useFakeTimers();
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://abcdefghijklmnop.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon-key");
  vi.stubGlobal("fetch", stalledFetch);
  vi.mocked(notFound).mockClear();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("loaders: a timeout is a thrown Error, never an empty answer", () => {
  it("plain select ({ error } shape): getAvailableSeasons", async () => {
    const err = rejection(await endsAtFiveSeconds(() => getAvailableSeasons()));
    expect(err.message).toBe(`Failed to fetch seasons: ${TIMED_OUT}`);
    expect(requests[0]).toContain("/rest/v1/data_freshness");
  });

  it("maybeSingle: getDataFreshness does not answer null, getPlayerBySlug does not answer 'no such player'", async () => {
    expect(rejection(await endsAtFiveSeconds(() => getDataFreshness(2026))).message).toBe(
      `Failed to fetch data freshness: ${TIMED_OUT}`,
    );
    expect(rejection(await endsAtFiveSeconds(() => getPlayerBySlug("josh-allen"))).message).toBe(
      `Failed to fetch player josh-allen: ${TIMED_OUT}`,
    );
  });

  it("paginated read (fetchAllRows' raw throw): getAllPlayerSlugs and getAllGapData", async () => {
    expect(rejection(await endsAtFiveSeconds(() => getAllPlayerSlugs())).message).toBe(
      `Failed to fetch player slugs: ${TIMED_OUT}`,
    );
    expect(rejection(await endsAtFiveSeconds(() => getAllGapData(2026))).message).toBe(
      `Failed to fetch run gap stats: ${TIMED_OUT}`,
    );
  });

  it("the homepage's schedule probe does not answer 'no schedule'", async () => {
    expect(rejection(await endsAtFiveSeconds(() => hasScheduleForSeason(2027))).message).toBe(
      `Failed to fetch schedule probe for 2027: ${TIMED_OUT}`,
    );
  });
});

describe("API routes: 503, not a hang", () => {
  it("/api/health: 503, no-store, and a short message that says it timed out after 5 s", async () => {
    const outcome = await endsAtFiveSeconds(() => health());
    expect(outcome.ok).toBe(true);
    const res = (outcome as { ok: true; value: Response }).value;
    expect(res.status).toBe(503);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({ status: "error", message: TIMED_OUT });
    expect(text.length).toBeLessThan(100);
  });

  it("/api/stat-card/[slug]: 503 with its sentence, no-store, Retry-After; never a 404", async () => {
    const outcome = await endsAtFiveSeconds(() =>
      statCard(new Request("https://yardsperpass.com/api/stat-card/josh-allen"), {
        params: Promise.resolve({ slug: "josh-allen" }),
      }),
    );
    expect(outcome.ok).toBe(true);
    const res = (outcome as { ok: true; value: Response }).value;
    expect(res.status).toBe(503);
    expect(await res.text()).toBe("Stat card temporarily unavailable. Try again in a few minutes.");
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(res.headers.get("Retry-After")).toBe("60");
  });
});

describe("pages: the page function rejects (Next shows the route's error card), never Not Found, never an empty page", () => {
  it("/player/[slug]: rejects on the player row; notFound is not called", async () => {
    const err = rejection(
      await endsAtFiveSeconds(() =>
        PlayerPage({ params: Promise.resolve({ slug: "josh-allen" }), searchParams: Promise.resolve({}) }),
      ),
    );
    expect(err.message).toBe(`Failed to fetch player josh-allen: ${TIMED_OUT}`);
    expect(notFound).not.toHaveBeenCalled();
  });

  it("/player/[slug] generateMetadata: rejects; no 'Player Not Found' title", async () => {
    const err = rejection(
      await endsAtFiveSeconds(() => playerMetadata({ params: Promise.resolve({ slug: "josh-allen" }) })),
    );
    expect(err.message).toContain(TIMED_OUT);
  });

  it("/card/[slug]: rejects; notFound is not called", async () => {
    const err = rejection(
      await endsAtFiveSeconds(() =>
        CardPage({ params: Promise.resolve({ slug: "josh-allen" }), searchParams: Promise.resolve({}) }),
      ),
    );
    expect(err.message).toContain(TIMED_OUT);
    expect(notFound).not.toHaveBeenCalled();
  });

  it("/team/[team_id]: rejects on the seasons read", async () => {
    const err = rejection(
      await endsAtFiveSeconds(() =>
        TeamPage({ params: Promise.resolve({ team_id: "BUF" }), searchParams: Promise.resolve({}) }),
      ),
    );
    expect(err.message).toBe(`Failed to fetch seasons: ${TIMED_OUT}`);
  });

  it("a season page (/qb-leaderboard): the page and its generateMetadata both reject", async () => {
    expect(
      rejection(await endsAtFiveSeconds(() => QBPage({ searchParams: Promise.resolve({}) }))).message,
    ).toBe(`Failed to fetch seasons: ${TIMED_OUT}`);
    expect(
      rejection(await endsAtFiveSeconds(() => qbMetadata({ searchParams: Promise.resolve({}) }))).message,
    ).toBe(`Failed to fetch seasons: ${TIMED_OUT}`);
  });

  it("the homepage: rejects (ISR keeps the last good copy), never renders an empty board", async () => {
    const err = rejection(await endsAtFiveSeconds(() => HomePage()));
    expect(err.message).toBe(`Failed to fetch seasons: ${TIMED_OUT}`);
  });
});
