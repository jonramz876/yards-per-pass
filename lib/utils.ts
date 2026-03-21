import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/** Parse Supabase NUMERIC fields (returned as strings) to JavaScript numbers.
 *  Supabase returns NUMERIC columns as strings; this converts them to JS numbers.
 *  null/undefined → null (NOT NaN — NaN can't be serialized by Next.js server→client).
 *  UI code should check for null with `val == null || Number.isNaN(val)`. */
export function parseNumericFields<T>(
  row: T,
  fields: string[]
): T {
  const parsed: Record<string, unknown> = { ...(row as Record<string, unknown>) };
  for (const field of fields) {
    if (typeof parsed[field] === "string") {
      const num = parseFloat(parsed[field] as string);
      parsed[field] = Number.isNaN(num) ? null : num;
    } else if (parsed[field] === undefined) {
      parsed[field] = null;
    }
    // null stays as null — serializable by Next.js
  }
  return parsed as T;
}
