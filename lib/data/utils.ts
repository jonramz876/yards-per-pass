// lib/data/utils.ts
import { createServerClient } from "@/lib/supabase/server";

/**
 * The one way a loader reports a failed read (read resilience spec §1.2): an
 * Error that says what was being read. `err` is whatever the read gave back,
 * usually the raw PostgREST object that fetchAllRows rejects with, sometimes
 * an Error (a missing env var). Never throws itself, whatever `err` is.
 */
export function queryError(what: string, err: unknown): Error {
  const detail = summarizeUpstreamError(err);
  // The raw error rides along as `cause` for the logs, unless its text had to
  // be shortened: then the cause is shortened too, or the oversized body would
  // be printed in full with every logged Error anyway.
  const raw = rawErrorText(err);
  const cause = raw.length > UPSTREAM_ERROR_MAX_CHARS || looksLikeHtml(raw) ? { message: detail } : err;
  return new Error(`Failed to fetch ${what}: ${detail}`, { cause });
}

/** Longest upstream error text that is logged or echoed as it came. */
const UPSTREAM_ERROR_MAX_CHARS = 300;

function looksLikeHtml(text: string): boolean {
  return /<\s*(!doctype|html|head|body|title|script)\b/i.test(text);
}

/** The text an error carries: its string `message`, else the whole thing as JSON (so `code` and `details` still show). */
function rawErrorText(err: unknown): string {
  const message = (err as { message?: unknown } | null | undefined)?.message;
  if (typeof message === "string") return message;
  try {
    return String(JSON.stringify(err));
  } catch {
    return String(err);
  }
}

/**
 * One short line for whatever a failed read gave back, safe to log and to
 * send to a caller (/api/health). Never throws, always a string.
 *
 * - An error with no string `message` is shown as JSON, so its `code` and
 *   `details` are not lost (it used to read "undefined").
 * - When the gateway answers with a web page instead of JSON (a Cloudflare
 *   522, say), postgrest-js puts the whole page in `message`. That becomes
 *   "upstream returned an HTML error page" plus the HTTP status when the
 *   caller knows it and the page's own title when it has one. No markup.
 * - Anything else longer than 300 characters is cut, with a count of the rest.
 */
export function summarizeUpstreamError(err: unknown, status?: number): string {
  const raw = rawErrorText(err);
  if (looksLikeHtml(raw)) {
    const title = /<title[^>]*>([^<]*)<\/title>/i.exec(raw)?.[1]?.replace(/\s+/g, " ").trim().slice(0, 120);
    const parts = [
      typeof status === "number" && Number.isFinite(status) ? `HTTP ${status}` : "",
      title ?? "",
    ].filter((p) => p.length > 0);
    return `upstream returned an HTML error page${parts.length > 0 ? ` (${parts.join(", ")})` : ""}`;
  }
  if (raw.length > UPSTREAM_ERROR_MAX_CHARS) {
    return `${raw.slice(0, UPSTREAM_ERROR_MAX_CHARS)}... (${raw.length - UPSTREAM_ERROR_MAX_CHARS} more characters)`;
  }
  return raw;
}

/**
 * Fetch all rows from a table, paginating past Supabase's 1000-row server limit.
 *
 * `options` is optional and additive (team stats spec §2.1): `order` sorts by
 * each column ascending before paging (unordered pages can skip or repeat
 * rows), and `signal` puts a deadline on every page. With no options the query
 * is exactly what it always was. A query error still rejects with the raw
 * PostgREST object, not an Error: callers rethrow it through queryError.
 */
export async function fetchAllRows(
  table: string,
  select: string,
  filters: Record<string, unknown>,
  options: { signal?: AbortSignal; order?: readonly string[] } = {}
): Promise<Record<string, unknown>[]> {
  const supabase = createServerClient();
  const PAGE_SIZE = 1000;
  const allRows: Record<string, unknown>[] = [];
  let offset = 0;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    let ordered = supabase.from(table).select(select);
    for (const col of options.order ?? []) {
      ordered = ordered.order(col, { ascending: true });
    }
    let query = ordered.range(offset, offset + PAGE_SIZE - 1);
    for (const [key, val] of Object.entries(filters)) {
      query = query.eq(key, val);
    }
    if (options.signal) query = query.abortSignal(options.signal);
    const { data, error } = await query;
    if (error) throw error;
    if (!data || data.length === 0) break;
    allRows.push(...(data as unknown as Record<string, unknown>[]));

    if (data.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }

  return allRows;
}
