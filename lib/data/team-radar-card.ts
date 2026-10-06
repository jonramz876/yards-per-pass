// lib/data/team-radar-card.ts — what one share card needs (team radar spec
// 2026-10-06 §7, PR 3). Server-only: never import it from a "use client" file.
// The share page, its generateMetadata and the image route all call
// loadTeamRadarCard, so the three can never disagree about a team's state.
import { getTeamRadarRows, type TeamRadarGameRow } from "@/lib/data/team-radar";
import { getBoxScoreSeasonsCached } from "@/lib/data/box-score";
import { teamRadarSlice, type TeamRadarSlice } from "@/lib/stats/team-radar";

/**
 * How long one season's rows are reused inside a server instance. One minute:
 * long enough that a share page, its metadata and its preview image (three
 * requests within a second or two of a link being pasted) cost one read, short
 * enough that a refresh shows up at once for all practical purposes.
 */
export const TEAM_RADAR_MEMO_TTL_MS = 60_000;

const rowsMemo = new Map<number, { at: number; promise: Promise<TeamRadarGameRow[]> }>();

/** Tests only: forget every memoised read. */
export function clearTeamRadarCardMemo(): void {
  rowsMemo.clear();
}

/**
 * getTeamRadarRows behind a short per-season memo (review I5). The PROMISE is
 * stored, so callers arriving while the read is in flight share it; a
 * rejection deletes the entry at once, so a failed read is never replayed and
 * the next caller reads again (the getBoxScoreSeasonsCached pattern). Module
 * scope: per server instance, empty on a cold start.
 *
 * The rows array is shared between callers: treat it as read-only
 * (buildTeamRadar does).
 */
export function getTeamRadarRowsCached(season: number): Promise<TeamRadarGameRow[]> {
  const now = Date.now();
  const hit = rowsMemo.get(season);
  if (hit && now - hit.at < TEAM_RADAR_MEMO_TTL_MS) return hit.promise;
  let promise: Promise<TeamRadarGameRow[]>;
  try {
    promise = getTeamRadarRows(season);
  } catch (err) {
    // A throw before the promise exists must not escape as a sync throw.
    return Promise.reject(err);
  }
  const entry = { at: now, promise };
  rowsMemo.set(season, entry);
  promise.catch(() => {
    // Only this entry: a retry already stored under the same season stays.
    if (rowsMemo.get(season) === entry) rowsMemo.delete(season);
  });
  return promise;
}

/**
 * One team's radar slice for a season the caller has already validated
 * (`seasons` is data_freshness's list, newest first).
 *
 * In order (spec §7): the coverage probe (memoised for an hour, may fail: it
 * is logged and read as "unknown"), then `uncovered` is decided BEFORE the
 * season-wide read, so a past season with no rows costs no row read; then the
 * rows, through the memo above. Rejects when the row read fails: a failed read
 * is never an empty card. A slice in the `unavailable` state means the read
 * succeeded with no rows for a season that has them; callers treat it as a
 * failed read too.
 */
export async function loadTeamRadarCard(
  teamId: string,
  season: number,
  seasons: readonly number[],
): Promise<TeamRadarSlice> {
  const newestSeason = seasons[0] ?? null;

  let covered: number[] = [];
  let probed = false;
  if (seasons.length > 0) {
    try {
      covered = await getBoxScoreSeasonsCached([...seasons]);
      probed = true;
    } catch (err: unknown) {
      console.error(
        `Team radar card: coverage probe failed for ${teamId} (${season}); the first covered season is unknown`,
        err,
      );
    }
  }

  // A season other than the newest that the probe says has no rows: nothing
  // to read. The newest season is always read (its rows are the evidence).
  const skipRead = probed && newestSeason !== null && season !== newestSeason && !covered.includes(season);
  const rows = skipRead ? [] : await getTeamRadarRowsCached(season);

  return teamRadarSlice({
    teamId,
    season,
    rows: rows as unknown as Record<string, unknown>[],
    newestSeason,
    covered,
    log: (message) => console.error(`Team radar card (${teamId}): ${message}`),
  });
}
