import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/** Parse Supabase NUMERIC fields (returned as strings) to JavaScript numbers */
export function parseNumericFields(
  row: Record<string, unknown>,
  fields: string[]
): Record<string, unknown> {
  const parsed = { ...row };
  for (const field of fields) {
    if (typeof parsed[field] === "string") {
      parsed[field] = parseFloat(parsed[field] as string);
    } else if (parsed[field] === null || parsed[field] === undefined) {
      parsed[field] = 0;
    }
  }
  return parsed;
}
