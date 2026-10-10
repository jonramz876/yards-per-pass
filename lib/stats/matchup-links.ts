// lib/stats/matchup-links.ts — the links and URL words of /matchup (team
// matchup spec 2026-10-10 §4.1 step 3, §4.3, §7.1).
//
// This module imports NOTHING, and must stay that way (a test checks): browser
// code (the team page's schedule tiles, the ladder toggle, the team picker)
// takes its links from here so that none of it pulls lib/stats/matchup.ts,
// team-radar.ts or team-stats.ts into a client bundle. That is also why two
// rules that live elsewhere are written again here, each held to its original
// by a test: the season range (lib/stats/team-stats.ts SEASON_PARAM_MIN/MAX)
// and the team-id rule (lib/stats/team-radar.ts parseRadarTeamId).

/** Which team has the ball in the ladder a link opens on. The away team is the default. */
export type Ball = "away" | "home";

/** Plausible seasons: the same range as the rest of the site (SEASON_PARAM_MIN / MAX). */
export const MATCHUP_SEASON_MIN = 1999;
export const MATCHUP_SEASON_MAX = 2100;

/** `?ball=`: "home" exactly, else away. A repeated key (an array) is absent. */
export function parseBall(raw: string | string[] | null | undefined): Ball {
  return raw === "home" ? "home" : "away";
}

export function flipBall(ball: Ball): Ball {
  return ball === "home" ? "away" : "home";
}

/**
 * `?season=` for the matchup routes: a single string of exactly four ASCII
 * digits, 1999-2100. Stricter than the season pages' bare parseInt on purpose:
 * "2025abc", "2025.9", " 2025", "", and a repeated key are all absent (the
 * default season), so the page never shows one season under a URL that a
 * canonical helper would read as another.
 */
export function parseMatchupSeason(raw: string | string[] | null | undefined): number | null {
  if (typeof raw !== "string" || !/^[0-9]{4}$/.test(raw)) return null;
  const season = Number(raw);
  return season >= MATCHUP_SEASON_MIN && season <= MATCHUP_SEASON_MAX ? season : null;
}

/**
 * "/matchup/BUF/LA", away first. `?season=` only when the season is one
 * parseMatchupSeason accepts (a whole number, 1999-2100) other than
 * `defaultSeason` (the playerHref rule: the default season stays the bare URL;
 * an unknown default still carries the season); `ball=home` only for home;
 * season before ball. The ids should be the caller's canonical ones
 * (parseMatchupTeamId + a team look-up); each is percent-encoded anyway.
 */
export function matchupHref(
  awayId: string,
  homeId: string,
  opts: { season?: number | null; defaultSeason?: number | null; ball?: Ball } = {},
): string {
  const query: string[] = [];
  const season = opts.season;
  // Only a season the route's own rule reads back (chaos F8): any other number
  // would be a URL the page treats as "no season asked for".
  if (
    typeof season === "number" && Number.isSafeInteger(season) && season !== opts.defaultSeason &&
    parseMatchupSeason(String(season)) === season
  ) {
    query.push(`season=${season}`);
  }
  if (opts.ball === "home") query.push("ball=home");
  return `/matchup/${pathSegment(awayId)}/${pathSegment(homeId)}${query.length > 0 ? `?${query.join("&")}` : ""}`;
}

/* ─── The matchup share card (matchup card spec 2026-10-11 §4.3, §9 K12) ─── */

/** The share page's path, away first: "/card/matchup/BUF/LA". Each id is percent-encoded, as in matchupHref. */
export function matchupCardPath(awayId: string, homeId: string): string {
  return `/card/matchup/${pathSegment(awayId)}/${pathSegment(homeId)}`;
}

/**
 * The share page for a season: matchupHref's season rule, and no `ball` (one
 * card per game). Bare for the default season; `?season=` for another season
 * the route's own rule reads back; an unknown default still carries the season.
 */
export function matchupCardHref(
  awayId: string,
  homeId: string,
  opts: { season?: number | null; defaultSeason?: number | null } = {},
): string {
  const season = opts.season;
  const named =
    typeof season === "number" && Number.isSafeInteger(season) && season !== opts.defaultSeason &&
    parseMatchupSeason(String(season)) === season;
  return `${matchupCardPath(awayId, homeId)}${named ? `?season=${season}` : ""}`;
}

/** K12: the Share block on the matchup page (its client component imports them from here, never from matchup-card.ts). */
export const MATCHUP_SHARE_HEADING = "Share this matchup";
export const MATCHUP_COPY_LINK_TEXT = "Copy Link";
export const MATCHUP_COPIED_TEXT = "Copied!";
export const MATCHUP_DOWNLOAD_TEXT = "Download Image";
export const MATCHUP_OPEN_CARD_TEXT = "Open share card →";
/** On the matchup page the address bar holds the matchup, not the card, so the advice is the Compare page's. */
export const MATCHUP_COPY_FAILED_TEXT = "Copy failed: open the share card and copy its address";

/**
 * One path segment, percent-encoded, so an id can never add a "/", a "?" or a
 * "#" of its own (chaos F8). A real team id is letters only and comes out
 * unchanged. A value that cannot be encoded (a lone surrogate) is an empty
 * segment, never a throw. Dots are not encoded by encodeURIComponent, so ".."
 * is still the caller's to keep out: every caller passes parseMatchupTeamId's
 * answer.
 */
function pathSegment(id: string): string {
  try {
    return encodeURIComponent(String(id));
  } catch {
    return "";
  }
}

/**
 * A team segment, upper-cased: two or three ASCII letters, tested BEFORE
 * upper-casing, else null. "ſf" (long s) and "pıt" (dotless i) upper-case to
 * SF and PIT, so an upper-case-then-look-up would let them through as aliases.
 * Whether the id is a real team is the caller's getTeam look-up.
 */
export function parseMatchupTeamId(raw: string | null | undefined): string | null {
  return typeof raw === "string" && /^[A-Za-z]{2,3}$/.test(raw) ? raw.toUpperCase() : null;
}
