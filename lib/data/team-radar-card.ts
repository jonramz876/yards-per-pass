// lib/data/team-radar-card.ts — what one share card needs (team radar spec
// 2026-10-06 §7, PR 3). Server-only: never import it from a "use client" file.
// The share page, its generateMetadata and the image route all call
// loadTeamRadarCard, so the three can never disagree about a team's state.
import { getTeamRadarRows, type TeamRadarGameRow } from "@/lib/data/team-radar";
import { getBoxScoreSeasonsCached } from "@/lib/data/box-score";
import { getAvailableSeasons } from "@/lib/data/queries";
import { teamRadarSlice, type TeamRadarSlice } from "@/lib/stats/team-radar";

/**
 * How long a read is reused inside one server instance: one minute.
 *
 * This memo is what bounds the IMAGE ROUTE's reads. That route exports
 * `revalidate = 0`, so none of its Supabase reads are in Next's data cache;
 * without the memo every image request (64 cards, each also fetched once more
 * by the Download button and by every link-preview crawler) would read the
 * seasons list and the season's rows again. With it: one of each a minute per
 * instance, and a refresh reaches new images within a minute, unless a
 * share-page view in the same instance filled the rows memo from the page's
 * hour-long data cache first (the image is then as old as the page, never
 * older). A read that RESOLVES empty is kept for the minute like any other
 * answer; only a rejection is dropped at once.
 *
 * It is NOT what bounds the share PAGE. The page exports `revalidate = 3600`,
 * so its reads are already in Next's data cache for up to an hour (cleared by
 * /api/revalidate through `revalidatePath("/card", "layout")`). After a
 * refresh the image can therefore be ahead of the page that links it until
 * that revalidate call lands or the hour turns over.
 */
export const TEAM_RADAR_MEMO_TTL_MS = 60_000;

type Entry<T> = { at: number; promise: Promise<T> };

/**
 * A promise memo: callers arriving while the read is in flight share it (the
 * PROMISE is stored), and a rejection deletes the entry at once, so a failed
 * read is never replayed and the next caller reads again (the
 * getBoxScoreSeasonsCached pattern). Module scope: per server instance, empty
 * on a cold start.
 */
export function memoised<K, T>(store: Map<K, Entry<T>>, key: K, read: () => Promise<T>): Promise<T> {
  const now = Date.now();
  const hit = store.get(key);
  if (hit && now - hit.at < TEAM_RADAR_MEMO_TTL_MS) return hit.promise;
  let promise: Promise<T>;
  try {
    promise = read();
  } catch (err) {
    // A throw before the promise exists must not escape as a sync throw.
    return Promise.reject(err);
  }
  const entry = { at: now, promise };
  store.set(key, entry);
  promise.catch(() => {
    // Only this entry: a retry already stored under the same key stays.
    if (store.get(key) === entry) store.delete(key);
  });
  return promise;
}

const rowsMemo = new Map<number, Entry<TeamRadarGameRow[]>>();
const seasonsMemo = new Map<"seasons", Entry<number[]>>();

/** Tests only: forget every memoised read. */
export function clearTeamRadarCardMemo(): void {
  rowsMemo.clear();
  seasonsMemo.clear();
}

/**
 * getTeamRadarRows behind the memo, per season (review I5). The rows array is
 * shared between callers: treat it as read-only (buildTeamRadar does).
 */
export function getTeamRadarRowsCached(season: number): Promise<TeamRadarGameRow[]> {
  return memoised(rowsMemo, season, () => getTeamRadarRows(season));
}

/**
 * getAvailableSeasons behind the same memo, for the image route (chaos R1: it
 * read data_freshness on every request). Each caller gets its own copy of the
 * list, so nothing a caller does to it reaches the next one.
 */
export async function getAvailableSeasonsCached(): Promise<number[]> {
  return [...(await memoised(seasonsMemo, "seasons", () => getAvailableSeasons()))];
}

/**
 * One team's radar slice for a season the caller has already validated
 * (`seasons` is data_freshness's list, newest first).
 *
 * In order (spec §7): the coverage probe (memoised for an hour), then
 * `uncovered` is decided BEFORE the season-wide read, so a past season with no
 * rows costs no row read; then the rows, through the memo above.
 *
 * Rejects when the row read fails: a failed read is never an empty card. It
 * also rejects when the probe failed AND the answer would have depended on it
 * (chaos R3): a past season whose rows came back empty is "not covered", but
 * with the probe down nothing says which season is the first covered one, and
 * the vaguer sentence must not go out as a success. A probe failure is
 * harmless when the season's rows are there (they are the proof).
 *
 * A slice in the `unavailable` state means the read succeeded with no rows
 * for a season that has them; callers treat it as a failed read too.
 */
export async function loadTeamRadarCard(
  teamId: string,
  season: number,
  seasons: readonly number[],
): Promise<TeamRadarSlice> {
  const newestSeason = seasons[0] ?? null;

  let covered: number[] = [];
  let probed = false;
  let probeError: unknown = null;
  if (seasons.length > 0) {
    try {
      covered = await getBoxScoreSeasonsCached([...seasons]);
      probed = true;
    } catch (err: unknown) {
      probeError = err;
      console.error(`Team radar card: coverage probe failed for ${teamId} (${season})`, err);
    }
  }

  // A season other than the newest that the probe says has no rows: nothing
  // to read. The newest season is always read (its rows are the evidence).
  const skipRead = probed && newestSeason !== null && season !== newestSeason && !covered.includes(season);
  const rows = skipRead ? [] : await getTeamRadarRowsCached(season);

  const slice = teamRadarSlice({
    teamId,
    season,
    rows: rows as unknown as Record<string, unknown>[],
    newestSeason,
    covered,
    log: (message) => console.error(`Team radar card (${teamId}): ${message}`),
  });

  if (slice.state === "uncovered" && seasons.length > 0 && !probed) {
    const why = probeError instanceof Error ? probeError.message : String(probeError);
    throw new Error(`Team radar card: coverage probe failed, so ${season} cannot be called uncovered (${why})`);
  }
  return slice;
}
