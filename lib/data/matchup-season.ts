// lib/data/matchup-season.ts — the season a matchup 308 keeps (team matchup
// spec 2026-10-10 chaos finding 9; matchup card spec 2026-10-11 §3, §4.1 step
// 3). Shared by /matchup/[away]/[home] and /card/matchup/[away]/[home].
//
// A module of its own on purpose, importing only the memoised season list:
// the route tests replace lib/data/matchup as a whole, and a helper placed
// there would be undefined in them. Server-only.
import { getSeasonWeeksCached } from "@/lib/data/compare-card";

/**
 * The season the 308 keeps: the one asked for when the site lists it, else
 * none (chaos pass on the matchup pages, finding 9: `?season=2031` used to
 * stay in the address while the page showed the newest season; the 307 already
 * dropped it). With no season in the address nothing is read. With one, the
 * answer comes from the memoised season list every matchup page already reads
 * (one shared read, never one per pair). If that list cannot be read the
 * season is dropped: the bare address is always right, and the page it leads
 * to reports the failure itself. `what` names the caller in the log line.
 */
export async function listedMatchupSeason(requested: number | null, what: string): Promise<number | null> {
  if (requested === null) return null;
  try {
    const weeks: unknown = await getSeasonWeeksCached();
    const listed = Array.isArray(weeks) && weeks.some((w) => w !== null && typeof w === "object" && (w as { season?: unknown }).season === requested);
    return listed ? requested : null;
  } catch (err) {
    console.error(`${what}: the season list could not be read for a redirect; the season was left out of the address`, err);
    return null;
  }
}
