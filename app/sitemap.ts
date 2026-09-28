// app/sitemap.ts
import { getAllPlayerSlugs } from "@/lib/data/players";
import { getAvailableSeasons, getDataFreshness } from "@/lib/data/queries";
import { getBoxScoreSeasons } from "@/lib/data/box-score";
import { getPlayedRegularSeasonGameIds } from "@/lib/data/games";
import { normalizeGameId } from "@/lib/stats/box-score";
import { NFL_TEAMS } from "@/lib/data/teams";
import type { MetadataRoute } from "next";

export const revalidate = 3600;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = process.env.NEXT_PUBLIC_SITE_URL || "https://yardsperpass.com";
  let players: { slug: string }[] = [];
  try {
    players = await getAllPlayerSlugs();
  } catch {
    // Supabase unavailable (e.g., CI build) — sitemap will have static + team pages only
  }

  // lastmod = when the stats last changed (newest data_freshness row), not the
  // time of the request. Left off when unknown — a missing lastmod is valid, a
  // made-up one teaches crawlers to ignore it. Invalid dates are dropped: Next
  // calls toISOString() on a Date, which throws and would 500 the sitemap.
  let dataUpdated: Date | undefined;
  try {
    const fresh = await getDataFreshness();
    const d = fresh?.last_updated ? new Date(fresh.last_updated) : null;
    if (d && !Number.isNaN(d.getTime())) dataUpdated = d;
  } catch {
    // Supabase unavailable — no lastmod
  }

  const staticPages: MetadataRoute.Sitemap = [
    { url: base, lastModified: dataUpdated, changeFrequency: "weekly", priority: 1 },
    { url: `${base}/teams`, lastModified: dataUpdated, changeFrequency: "weekly", priority: 0.9 },
    { url: `${base}/qb-leaderboard`, lastModified: dataUpdated, changeFrequency: "weekly", priority: 0.9 },
    { url: `${base}/receivers`, lastModified: dataUpdated, changeFrequency: "weekly", priority: 0.9 },
    { url: `${base}/rushing`, lastModified: dataUpdated, changeFrequency: "weekly", priority: 0.9 },
    { url: `${base}/run-gaps`, lastModified: dataUpdated, changeFrequency: "weekly", priority: 0.8 },
    { url: `${base}/compare`, lastModified: dataUpdated, changeFrequency: "weekly", priority: 0.8 },
    { url: `${base}/trends`, lastModified: dataUpdated, changeFrequency: "weekly", priority: 0.8 },
    // Hand-written pages: no data timestamp applies.
    { url: `${base}/glossary`, changeFrequency: "monthly", priority: 0.7 },
    { url: `${base}/privacy`, changeFrequency: "yearly", priority: 0.3 },
  ];

  const teamPages: MetadataRoute.Sitemap = NFL_TEAMS.map((t) => ({
    url: `${base}/team/${t.id}`,
    lastModified: dataUpdated,
    changeFrequency: "weekly" as const,
    priority: 0.8,
  }));

  const playerPages: MetadataRoute.Sitemap = players.map((p) => ({
    url: `${base}/player/${p.slug}`,
    lastModified: dataUpdated,
    changeFrequency: "weekly" as const,
    priority: 0.7,
  }));

  // Box scores: every played regular-season game of a season that has
  // team_game_stats rows (box score spec §6). Same documented exception as the
  // slugs above (memory/MEMORY.md, "Homepage resilience" follow-ups): a failed
  // read drops every game URL until the next hourly regeneration — logged,
  // below.
  //
  // `revalidate = 3600` is what keeps this file current: without it Next
  // treats the route as static and its Supabase reads as cache-forever
  // (one-year fetch-cache entries keyed without a build id), so even a deploy
  // re-served the old lastmod and game list (frozen at Sep 12 / Sep 21 until
  // this fix). ISR serves the previous copy to the first request after the
  // hour and rebuilds in the background, so a new box score appears one crawl
  // later. Do not switch to `dynamic = "force-dynamic"`: in a Next 14 route
  // handler that does not bypass the fetch cache.
  //
  // This is a serial chain: getAvailableSeasons, then one limit(1) probe per
  // candidate season, then one game-id read per covered season (1 + N + M
  // round trips, N = 7 and M = 1 today). Do not stack more reads on it in PR 4
  // without parallelising it first.
  let gameIds: string[] = [];
  try {
    const seasons = await getAvailableSeasons();
    if (seasons.length === 0) {
      // getAvailableSeasons swallows its own query error and returns [], and
      // getBoxScoreSeasons([]) short-circuits before any query — so without
      // this the sitemap drops every game URL with nothing logged anywhere
      // (observed in a no-database build).
      console.error("Sitemap: no seasons from data_freshness; no box score URLs");
    }
    const covered = await getBoxScoreSeasons(seasons);
    const perSeason = await Promise.all(covered.map((season) => getPlayedRegularSeasonGameIds(season)));
    // The same address rule both link gates apply (ScheduleSection.tsx,
    // GameLogTab.tsx). The sitemap is a link surface too, and the page 404s
    // for an id that fails GAME_ID_PATTERN, so an unvalidated id out of a
    // corrupt `games` row would submit a dead URL to Google. Not reachable
    // from well-formed nflverse data — hygiene, and the one surface on the
    // branch that was skipping it.
    gameIds = perSeason
      .flat()
      .map((id) => normalizeGameId(id))
      .filter((id): id is string => id !== null);
  } catch (err) {
    // Supabase unavailable — no game pages this time. Logged because the team
    // and player pages log this very failure, and because dropping every box
    // score URL with no signal anywhere is how the seasons.length === 0 case
    // above went unnoticed. `err` is logged and never branched on: this must
    // stay a bare-shape catch, since getPlayedRegularSeasonGameIds rejects
    // with fetchAllRows' raw PostgREST object rather than an Error, so an
    // `instanceof Error` test here would take the wrong branch.
    console.error("Sitemap: box score game ids unavailable; no box score URLs", err);
  }
  const gamePages: MetadataRoute.Sitemap = gameIds.map((id) => ({
    url: `${base}/game/${id}`,
    lastModified: dataUpdated,
    changeFrequency: "weekly" as const,
    priority: 0.6,
  }));

  // No /card/ URLs. /player/<slug> is the canonical page for a player, and its
  // Overview IS the same Tecmo card, so /card/ is a share view. /card/ is also
  // season-scoped: many slugs have no card (K/P/defense always; everyone whose
  // team hasn't played early each season) and render a noindex message.
  // Card pages stay reachable and indexable through the Share Card links.
  return [...staticPages, ...teamPages, ...playerPages, ...gamePages];
}
