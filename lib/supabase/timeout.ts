// lib/supabase/timeout.ts
// A time limit on every Supabase read (read resilience spec §1.3, PR 1B).
// Pure: no Supabase import, so both the server client and the browser client
// can use it.
//
// Why: Supabase's REST gateway stalls for an hour or two most days. A stalled
// read has no limit of its own, and Vercel's function limit on Hobby is 300 s,
// so a page hung for minutes. With the limit, the read fails after a few
// seconds, and since PR 1A a failed read is the route's error card (or a 503,
// or a message), never a 404 or an empty page.

/** Server reads: 5 s. About 20x the slowest healthy read measured (~250 ms). */
export const SUPABASE_READ_TIMEOUT_MS = 5000;

/**
 * Browser reads (site search, Compare): 15 s. The limit covers downloading
 * the body, and Compare downloads a whole season table to the visitor's
 * device; on a slow phone connection that can pass 5 s with nothing wrong.
 */
export const SUPABASE_BROWSER_READ_TIMEOUT_MS = 15000;

/** Statuses a Response may not carry a body for. */
const NULL_BODY_STATUS = new Set([101, 204, 205, 304]);

/**
 * What a read that ran out of time rejects with. supabase-js turns a rejected
 * fetch into `error.message = "<name>: <message>"`, so logs and /api/health
 * read "TimeoutError: read timed out after 5 s".
 */
function readTimeoutError(ms: number): Error {
  const error = new Error(`read timed out after ${ms / 1000} s`);
  error.name = "TimeoutError";
  return error;
}

/**
 * Wrap a fetch so a request that has no deadline gets one.
 *
 * - The caller passed NO `init.signal`: the request is aborted `ms` after it
 *   starts and rejects with a TimeoutError. The limit covers the whole read,
 *   body included (the body is read here, before the answer is handed on), and
 *   the timer is always cleared when the read ends, so nothing is left running.
 * - The caller passed a signal (the box score assembly, /team-stats, the box
 *   score link probe: `.abortSignal(...)`): the call goes through UNCHANGED.
 *   That deadline is the only deadline. Never shortened, never combined.
 *
 * A nonsense `ms` (zero, negative, not finite) falls back to the server
 * default rather than failing every read at once.
 *
 * Known cost, by design: Next 14 skips its per-render request dedupe for any
 * fetch that carries a signal (next/dist/server/lib/dedupe-fetch.js), so two
 * identical reads in one render are now two requests, and a retry in the same
 * render is no longer a replay of the first failure.
 */
export function withReadTimeout(fetchImpl: typeof fetch, ms: number = SUPABASE_READ_TIMEOUT_MS): typeof fetch {
  const limit = Number.isFinite(ms) && ms > 0 ? ms : SUPABASE_READ_TIMEOUT_MS;

  const limited = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    // The caller's own deadline wins: pass the call through exactly as given.
    if (init?.signal) return fetchImpl(input, init);

    const controller = new AbortController();
    const timeout = readTimeoutError(limit);
    const timer = setTimeout(() => controller.abort(timeout), limit);
    try {
      const response = await fetchImpl(input, { ...init, signal: controller.signal });
      // Read the body inside the limit: a gateway that sends headers and then
      // stalls is still a stalled read. supabase-js reads the whole body next
      // anyway, so nothing is buffered that would not have been.
      const body = NULL_BODY_STATUS.has(response.status) ? null : await response.arrayBuffer();
      return new Response(body, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      });
    } catch (err) {
      // Whatever the platform's fetch threw when we aborted it (the reason, an
      // AbortError, a stream error), the caller gets the one clear message.
      if (controller.signal.aborted) throw timeout;
      throw err;
    } finally {
      clearTimeout(timer);
    }
  };

  return limited as typeof fetch;
}
