// lib/data/utils.ts
import { createServerClient } from "@/lib/supabase/server";

/** Fetch all rows from a table, paginating past Supabase's 1000-row server limit */
export async function fetchAllRows(
  table: string,
  select: string,
  filters: Record<string, unknown>
): Promise<Record<string, unknown>[]> {
  const supabase = createServerClient();
  const PAGE_SIZE = 1000;
  const allRows: Record<string, unknown>[] = [];
  let offset = 0;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    let query = supabase.from(table).select(select).range(offset, offset + PAGE_SIZE - 1);
    for (const [key, val] of Object.entries(filters)) {
      query = query.eq(key, val);
    }
    const { data, error } = await query;
    if (error) throw error;
    if (!data || data.length === 0) break;
    allRows.push(...(data as unknown as Record<string, unknown>[]));

    if (data.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }

  return allRows;
}
