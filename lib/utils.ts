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

/**
 * The season a canonical URL should name, or null for the bare path. Parsed
 * exactly as the season pages parse ?season= (parseInt), so the canonical
 * names the season the page shows. Only a real season (in `seasons`, newest
 * first) other than the newest gets a URL of its own: ?season=<newest> is the
 * bare page, and junk or out-of-range values must not become URLs.
 */
export function canonicalSeason(seasonParam: string | undefined, seasons: number[]): number | null {
  const parsed = seasonParam ? parseInt(seasonParam) : NaN;
  if (Number.isNaN(parsed) || !seasons.includes(parsed) || parsed === seasons[0]) return null;
  return parsed;
}

/**
 * Link to a player page from a page showing `season`. Carries ?season= only
 * when that differs from the default (newest) season, so default-season links
 * stay the canonical bare URL. An unknown default still carries the season (a
 * second URL for the right page beats a bare link to the wrong season). A
 * non-positive or non-integer season never becomes a link.
 */
export function playerHref(slug: string, season?: number | null, defaultSeason?: number | null): string {
  if (season == null || !Number.isInteger(season) || season <= 0 || season === defaultSeason) return `/player/${slug}`;
  return `/player/${slug}?season=${season}`;
}
