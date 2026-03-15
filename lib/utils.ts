import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/** Parse Supabase NUMERIC fields (returned as strings) to JavaScript numbers.
 *  Supabase returns NUMERIC columns as strings; this converts them to JS numbers.
 *  null/undefined → NaN (rendered as em-dash in the UI). */
export function parseNumericFields<T>(
  row: T,
  fields: string[]
): T {
  const parsed: Record<string, unknown> = { ...(row as Record<string, unknown>) };
  for (const field of fields) {
    if (typeof parsed[field] === "string") {
      parsed[field] = parseFloat(parsed[field] as string);
    } else if (parsed[field] === null || parsed[field] === undefined) {
      parsed[field] = NaN;
    }
  }
  return parsed as T;
}
