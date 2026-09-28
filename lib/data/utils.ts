// lib/data/utils.ts
import { createServerClient } from "@/lib/supabase/server";

/**
 * Fetch all rows from a table, paginating past Supabase's 1000-row server limit.
 *
 * `options` is optional and additive (team stats spec §2.1): `order` sorts by
 * each column ascending before paging (unordered pages can skip or repeat
 * rows), and `signal` puts a deadline on every page. With no options the query
 * is exactly what it always was. A query error still rejects with the raw
 * PostgREST object, not an Error.
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
