import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createClient as createRealClient } from "@supabase/supabase-js";

// Read resilience PR 1B (spec §1.3): every Supabase read gets a time limit.
// 5 s on the server, 15 s in the browser. Supabase's REST gateway stalls for
// an hour or two most days; without a limit a stalled read holds the page
// open until Vercel's 300 s function limit.
import {
  SUPABASE_READ_TIMEOUT_MS,
  SUPABASE_BROWSER_READ_TIMEOUT_MS,
  withReadTimeout,
} from "@/lib/supabase/timeout";
import { queryError, summarizeUpstreamError } from "@/lib/data/utils";

type Init = RequestInit | undefined;

/**
 * A database that accepts the request and never answers: the promise never
 * resolves, and rejects with the signal's reason when the signal aborts, the
 * way a real fetch does. A signal that is ALREADY aborted never fires "abort"
 * again, so that case rejects at once (spec review M8).
 */
function hangingFetch() {
  const seen: { input: unknown; init: Init }[] = [];
  const fn = ((input: unknown, init?: RequestInit) => {
    seen.push({ input, init });
    const signal = init?.signal;
    if (signal?.aborted) return Promise.reject(signal.reason);
    return new Promise<Response>((_resolve, reject) => {
      signal?.addEventListener("abort", () => reject(signal.reason), { once: true });
    });
  }) as unknown as typeof fetch;
  return { fn, seen };
}

/** "pending" | "resolved" | "rejected", without waiting. */
async function stateOf(p: Promise<unknown>): Promise<string> {
  let state = "pending";
  p.then(
    () => {
      state = "resolved";
    },
    () => {
      state = "rejected";
    },
  );
  // A settled promise reports within a few microtasks; a pending one never does.
  for (let i = 0; i < 20; i++) await Promise.resolve();
  return state;
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("the two limits", () => {
  it("are 5 seconds on the server and 15 seconds in the browser", () => {
    expect(SUPABASE_READ_TIMEOUT_MS).toBe(5000);
    expect(SUPABASE_BROWSER_READ_TIMEOUT_MS).toBe(15000);
  });
});

describe("withReadTimeout — a read that never answers", () => {
  it("server default: still waiting at 4.999 s, rejected at 5 s with a short message that says so", async () => {
    const { fn } = hangingFetch();
    const read = withReadTimeout(fn)("https://x.supabase.co/rest/v1/t");
    const settled = read.catch((e: unknown) => e);

    await vi.advanceTimersByTimeAsync(4999);
    expect(await stateOf(read)).toBe("pending");

    await vi.advanceTimersByTimeAsync(1);
    const err = (await settled) as Error;
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("TimeoutError");
    expect(err.message).toBe("read timed out after 5 s");
  });

  it("browser limit: still waiting at 14.999 s, rejected at 15 s", async () => {
    const { fn } = hangingFetch();
    const read = withReadTimeout(fn, SUPABASE_BROWSER_READ_TIMEOUT_MS)("https://x.supabase.co/rest/v1/t");
    const settled = read.catch((e: unknown) => e);

    await vi.advanceTimersByTimeAsync(14999);
    expect(await stateOf(read)).toBe("pending");

    await vi.advanceTimersByTimeAsync(1);
    const err = (await settled) as Error;
    expect(err.name).toBe("TimeoutError");
    expect(err.message).toBe("read timed out after 15 s");
  });

  it("really cancels the request: the inner fetch's signal is aborted, and no timer is left", async () => {
    const { fn, seen } = hangingFetch();
    const settled = withReadTimeout(fn)("https://x.supabase.co/rest/v1/t").catch((e: unknown) => e);
    expect(seen[0].init?.signal).toBeInstanceOf(AbortSignal);
    expect(seen[0].init?.signal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(5000);
    await settled;
    expect(seen[0].init?.signal?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("covers the body too: headers arrive, the body stalls, and the read still ends at 5 s", async () => {
    const stalledBody = ((_input: unknown, init?: RequestInit) => {
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('[{"season":'));
          init?.signal?.addEventListener("abort", () => controller.error(init.signal!.reason), { once: true });
        },
      });
      return Promise.resolve(new Response(body, { status: 200 }));
    }) as unknown as typeof fetch;

    const read = withReadTimeout(stalledBody)("https://x.supabase.co/rest/v1/t");
    const settled = read.catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(4999);
    expect(await stateOf(read)).toBe("pending");
    await vi.advanceTimersByTimeAsync(1);
    const err = (await settled) as Error;
    expect(err.name).toBe("TimeoutError");
    expect(err.message).toBe("read timed out after 5 s");
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([0, -1, NaN, Infinity])("a nonsense limit (%s) falls back to 5 s instead of failing every read at once", async (ms) => {
    const { fn } = hangingFetch();
    const read = withReadTimeout(fn, ms)("https://x.supabase.co/rest/v1/t");
    const settled = read.catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(4999);
    expect(await stateOf(read)).toBe("pending");
    await vi.advanceTimersByTimeAsync(1);
    expect(((await settled) as Error).message).toBe("read timed out after 5 s");
  });
});

describe("withReadTimeout — a caller that brought its own deadline keeps it", () => {
  it("passes the caller's signal through untouched: same object, no timer of ours, never shortened", async () => {
    const { fn, seen } = hangingFetch();
    const caller = new AbortController();
    const init = { signal: caller.signal, method: "GET" };
    const read = withReadTimeout(fn)("https://x.supabase.co/rest/v1/t", init);
    const settled = read.catch((e: unknown) => e);

    expect(seen[0].init).toBe(init);
    expect(seen[0].init?.signal).toBe(caller.signal);
    expect(vi.getTimerCount()).toBe(0);

    // Far past our 5 s: the explicit deadline is the only deadline.
    await vi.advanceTimersByTimeAsync(60_000);
    expect(await stateOf(read)).toBe("pending");

    const reason = new Error("the caller's own deadline");
    caller.abort(reason);
    expect(await settled).toBe(reason);
  });

  it("the caller's shorter deadline wins, with the caller's reason", async () => {
    const { fn } = hangingFetch();
    const caller = new AbortController();
    const reason = new Error("box score deadline");
    setTimeout(() => caller.abort(reason), 1000);
    const read = withReadTimeout(fn)("https://x.supabase.co/rest/v1/t", { signal: caller.signal });
    const settled = read.catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(999);
    expect(await stateOf(read)).toBe("pending");
    await vi.advanceTimersByTimeAsync(1);
    expect(await settled).toBe(reason);
  });

  it("a signal that is already aborted rejects at once (it never fires 'abort' again)", async () => {
    const { fn } = hangingFetch();
    const reason = new Error("aborted before the call");
    const read = withReadTimeout(fn)("https://x.supabase.co/rest/v1/t", { signal: AbortSignal.abort(reason) });
    await expect(read).rejects.toBe(reason);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("withReadTimeout — a healthy read is unaffected", () => {
  it("the answer comes through whole (status, headers, body) and no timer is left behind", async () => {
    const seen: Init[] = [];
    const fast = ((_input: unknown, init?: RequestInit) => {
      seen.push(init);
      return Promise.resolve(
        new Response('[{"season":2026}]', {
          status: 206,
          statusText: "Partial Content",
          headers: { "content-type": "application/json", "content-range": "0-0/7" },
        }),
      );
    }) as unknown as typeof fetch;

    const headers = { apikey: "k", Accept: "application/json" };
    const res = await withReadTimeout(fast)("https://x.supabase.co/rest/v1/t", { method: "GET", headers });
    expect(res.status).toBe(206);
    expect(res.statusText).toBe("Partial Content");
    expect(res.headers.get("content-range")).toBe("0-0/7");
    expect(await res.json()).toEqual([{ season: 2026 }]);

    // Everything the caller passed arrives unchanged; only a signal is added.
    expect(seen[0]?.method).toBe("GET");
    expect(seen[0]?.headers).toBe(headers);
    expect(seen[0]?.signal).toBeInstanceOf(AbortSignal);

    expect(vi.getTimerCount()).toBe(0);
    // Nothing fires later.
    await vi.advanceTimersByTimeAsync(60_000);
    expect(seen[0]?.signal?.aborted).toBe(false);
  });

  it.each([204, 304])("a %s answer (no body allowed) comes through", async (status) => {
    const fast = (() => Promise.resolve(new Response(null, { status }))) as unknown as typeof fetch;
    const res = await withReadTimeout(fast)("https://x.supabase.co/rest/v1/t", { method: "HEAD" });
    expect(res.status).toBe(status);
    expect(await res.text()).toBe("");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("an error answer (503 with a text body) comes through as an answer, not a rejection", async () => {
    const down = (() => Promise.resolve(new Response("upstream down", { status: 503 }))) as unknown as typeof fetch;
    const res = await withReadTimeout(down)("https://x.supabase.co/rest/v1/t");
    expect(res.status).toBe(503);
    expect(await res.text()).toBe("upstream down");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("a fetch that fails fast keeps its own error, and no timer is left behind", async () => {
    const failure = new TypeError("fetch failed");
    const failing = (() => Promise.reject(failure)) as unknown as typeof fetch;
    await expect(withReadTimeout(failing)("https://x.supabase.co/rest/v1/t")).rejects.toBe(failure);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("a fetch that throws before returning a promise becomes a rejection, and no timer is left behind", async () => {
    const failure = new TypeError("Invalid URL");
    const throwing = (() => {
      throw failure;
    }) as unknown as typeof fetch;
    await expect(withReadTimeout(throwing)("not a url")).rejects.toBe(failure);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("a Request object with no init still gets the limit", async () => {
    const { fn, seen } = hangingFetch();
    const request = new Request("https://x.supabase.co/rest/v1/t");
    const settled = withReadTimeout(fn)(request).catch((e: unknown) => e);
    expect(seen[0].input).toBe(request);
    expect(seen[0].init?.signal).toBeInstanceOf(AbortSignal);
    await vi.advanceTimersByTimeAsync(5000);
    expect(((await settled) as Error).name).toBe("TimeoutError");
  });
});

describe("through the real supabase-js client: both shapes a timeout arrives in", () => {
  const client = (fetchImpl: typeof fetch) =>
    createRealClient("https://x.supabase.co", "anon-key", {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { fetch: withReadTimeout(fetchImpl) },
    });

  it("a plain select resolves to { data: null, error } with a short message that says 'timed out after 5 s'", async () => {
    const { fn } = hangingFetch();
    const pending = client(fn).from("data_freshness").select("season");
    const settled = Promise.resolve(pending);
    await vi.advanceTimersByTimeAsync(5000);
    const { data, error } = await settled;
    expect(data).toBeNull();
    expect(error?.message).toBe("TimeoutError: read timed out after 5 s");
    // What a loader then throws, and what /api/health sends.
    expect(queryError("seasons", error).message).toBe("Failed to fetch seasons: TimeoutError: read timed out after 5 s");
    expect(summarizeUpstreamError(error)).toBe("TimeoutError: read timed out after 5 s");
  });

  it("each page of a paginated read (fetchAllRows' .range()) gets its own 5 s", async () => {
    // Page 1 answers at once with a full page; page 2 never answers.
    let calls = 0;
    const hang = hangingFetch();
    const secondPageHangs = ((input: unknown, init?: RequestInit) => {
      calls += 1;
      if (calls === 1) {
        return Promise.resolve(
          new Response(JSON.stringify(Array.from({ length: 2 }, (_, i) => ({ player_id: `p${i}` }))), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
        );
      }
      return hang.fn(input as RequestInfo, init);
    }) as unknown as typeof fetch;

    const supabase = client(secondPageHangs);
    const page1 = await supabase.from("player_slugs").select("*").range(0, 1);
    expect(page1.error).toBeNull();
    expect(page1.data).toHaveLength(2);
    expect(vi.getTimerCount()).toBe(0);

    const page2 = Promise.resolve(supabase.from("player_slugs").select("*").range(2, 3));
    await vi.advanceTimersByTimeAsync(5000);
    const { data, error } = await page2;
    expect(data).toBeNull();
    // fetchAllRows does `throw error` with this raw object; loaders wrap it.
    expect(queryError("player slugs", error).message).toBe(
      "Failed to fetch player slugs: TimeoutError: read timed out after 5 s",
    );
  });

  it("a caller's .abortSignal() is the only deadline on that read", async () => {
    const { fn, seen } = hangingFetch();
    const caller = new AbortController();
    const pending = Promise.resolve(client(fn).from("games").select("*").abortSignal(caller.signal));
    await vi.advanceTimersByTimeAsync(60_000);
    expect(seen[0].init?.signal).toBe(caller.signal);
    expect(await stateOf(pending)).toBe("pending");
    caller.abort(new DOMException("The operation was aborted due to timeout", "TimeoutError"));
    const { error } = await pending;
    expect(error?.message).toBe("TimeoutError: The operation was aborted due to timeout");
  });
});

describe("the two client factories use it", () => {
  const createClient = vi.fn((..._args: unknown[]) => ({ fake: "client" }));

  beforeEach(() => {
    createClient.mockClear();
    vi.doMock("@supabase/supabase-js", () => ({ createClient }));
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://abcdefghijklmnop.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon-key");
  });

  // This describe is last in the file on purpose: the doMock stays registered
  // (un-mocking between tests made the next import fall back to the real
  // supabase-js), and the tests above use the statically imported real client.

  /** The fetch the factory handed to createClient. */
  function factoryFetch(): typeof fetch {
    expect(createClient).toHaveBeenCalledTimes(1);
    const [url, key, options] = createClient.mock.calls[0] as [string, string, { global?: { fetch?: typeof fetch } }];
    expect(url).toBe("https://abcdefghijklmnop.supabase.co");
    expect(key).toBe("anon-key");
    expect(typeof options?.global?.fetch).toBe("function");
    return options.global!.fetch!;
  }

  it("server client: every read is limited to 5 s, using whatever global fetch is current at call time", async () => {
    const { createServerClient } = await import("@/lib/supabase/server");
    createServerClient();
    const limited = factoryFetch();

    // Stubbed AFTER the client exists: Next patches global fetch, so the
    // factory must not capture it early.
    const { fn, seen } = hangingFetch();
    vi.stubGlobal("fetch", fn);
    const read = limited("https://abcdefghijklmnop.supabase.co/rest/v1/t");
    const settled = read.catch((e: unknown) => e);
    expect(seen).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(4999);
    expect(await stateOf(read)).toBe("pending");
    await vi.advanceTimersByTimeAsync(1);
    expect(((await settled) as Error).message).toBe("read timed out after 5 s");
  });

  it("server client: still one singleton", async () => {
    const { createServerClient } = await import("@/lib/supabase/server");
    expect(createServerClient()).toBe(createServerClient());
    expect(createClient).toHaveBeenCalledTimes(1);
  });

  it("browser client: every read is limited to 15 s (a slow phone connection is not an outage)", async () => {
    const { getSupabaseClient } = await import("@/lib/supabase/client");
    getSupabaseClient();
    const limited = factoryFetch();

    const { fn } = hangingFetch();
    vi.stubGlobal("fetch", fn);
    const read = limited("https://abcdefghijklmnop.supabase.co/rest/v1/t");
    const settled = read.catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(14999);
    expect(await stateOf(read)).toBe("pending");
    await vi.advanceTimersByTimeAsync(1);
    expect(((await settled) as Error).message).toBe("read timed out after 15 s");
  });
});
