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

/**
 * The longest limit the wrapper will honour. setTimeout cannot hold 2^31 ms or
 * more (Node sets such a delay to 1 ms, which would fail every read at once),
 * and no read on this site has any business waiting longer than a minute.
 */
export const SUPABASE_READ_TIMEOUT_MAX_MS = 60_000;

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

/** Join the chunks of a body that has been read to its end. */
function concat(chunks: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.byteLength, 0));
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

/**
 * Wrap a fetch so a request that has no deadline gets one.
 *
 * - The caller passed NO `init.signal`: the read rejects with a TimeoutError
 *   `ms` after it starts. The limit covers the whole read, body included (the
 *   body is read here, before the answer is handed on), and the timer is
 *   always cleared when the read ends, so nothing is left running.
 * - The caller passed a signal (the box score assembly, /team-stats, the box
 *   score link probe: `.abortSignal(...)`): the call goes through UNCHANGED.
 *   That deadline is the only deadline. Never shortened, never combined.
 *
 * The limit is a RACE, not only an abort. At the limit the timer itself
 * rejects the read; the request is also aborted, which frees the socket
 * wherever the fetch underneath is listening. It is not always listening:
 * Next removes the signal from a fetch it makes to refresh a stale data-cache
 * entry (next/dist/server/lib/patch-fetch.js, `signal: isStale ? undefined :
 * signal`), which is every read of an ISR regeneration of the homepage.
 * Aborting alone left that read open until undici's own 300 s limit. Whatever
 * the abandoned request does later (fails, or answers) is swallowed here: its
 * late rejection is handled, and a late answer's body is cancelled.
 *
 * Only the timer produces the TimeoutError. A read that fails on its own
 * keeps its own error, whenever that happens.
 *
 * A nonsense `ms` (zero, negative, not finite) falls back to the server
 * default rather than failing every read at once; one above
 * SUPABASE_READ_TIMEOUT_MAX_MS is capped there.
 *
 * Known cost, by design: Next 14 skips its per-render request dedupe for any
 * fetch that carries a signal (next/dist/server/lib/dedupe-fetch.js), so two
 * identical reads in one render are now two requests, and a retry in the same
 * render is no longer a replay of the first failure.
 */
export function withReadTimeout(fetchImpl: typeof fetch, ms: number = SUPABASE_READ_TIMEOUT_MS): typeof fetch {
  const limit = Math.min(Number.isFinite(ms) && ms > 0 ? ms : SUPABASE_READ_TIMEOUT_MS, SUPABASE_READ_TIMEOUT_MAX_MS);

  const limited = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    // The caller's own deadline wins: pass the call through exactly as given.
    if (init?.signal) return fetchImpl(input, init);

    return new Promise<Response>((resolve, reject) => {
      const controller = new AbortController();
      let over = false; // the caller has its answer (or its error); nothing below may settle it again
      let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;

      const timer = setTimeout(() => {
        if (over) return;
        over = true;
        const timeout = readTimeoutError(limit);
        reject(timeout);
        // Free the socket where the fetch is listening, and stop a body read
        // that is under way. Neither can throw into the caller any more.
        controller.abort(timeout);
        reader?.cancel(timeout).catch(() => {});
      }, limit);

      /** Settle the caller once, and stop the clock. False if the timer got there first. */
      const finish = (settle: () => void): boolean => {
        if (over) return false;
        over = true;
        clearTimeout(timer);
        settle();
        return true;
      };

      const read = async (): Promise<void> => {
        const response = await fetchImpl(input, { ...init, signal: controller.signal });
        if (over) {
          // Answered after the limit: nobody is waiting. Let go of the body.
          response.body?.cancel().catch(() => {});
          return;
        }
        // Read the body inside the limit: a gateway that sends headers and
        // then stalls is still a stalled read. supabase-js reads the whole
        // body next anyway, so nothing is buffered that would not have been.
        let body: Uint8Array | null = null;
        if (!NULL_BODY_STATUS.has(response.status) && response.body) {
          reader = response.body.getReader();
          const chunks: Uint8Array[] = [];
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            if (value) chunks.push(value);
          }
          if (over) return;
          body = concat(chunks);
        }
        finish(() =>
          resolve(
            new Response(body as BodyInit | null, {
              status: response.status,
              statusText: response.statusText,
              headers: response.headers,
            })
          )
        );
      };

      // An error before the limit reaches the caller as itself. After the
      // limit `finish` is a no-op, and this handler is what keeps the
      // abandoned request's late rejection from being an unhandled one.
      read().catch((err: unknown) => {
        finish(() => reject(err));
      });
    });
  };

  return limited as typeof fetch;
}
