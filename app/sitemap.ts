// app/sitemap.ts
import { getAllPlayerSlugs } from "@/lib/data/players";
import { getAvailableSeasons, getDataFreshness } from "@/lib/data/queries";
import { getBoxScoreSeasons } from "@/lib/data/box-score";
import { getPlayedRegularSeasonGameIds } from "@/lib/data/games";
import { NFL_TEAMS } from "@/lib/data/teams";
import type { MetadataRoute } from "next";

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
  // slugs above: a failed read silently drops every game URL until the next
  // rebuild (memory/MEMORY.md, "Homepage resilience" follow-ups).
  // This is a serial chain: getAvailableSeasons, then one limit(1) probe per
  // candidate season, then one game-id read per covered season (1 + N + M
  // round trips, N = 7 and M = 1 today). Do not stack more reads on it in PR 4
  // without parallelising it first.
  let gameIds: string[] = [];
  try {
    const covered = await getBoxScoreSeasons(await getAvailableSeasons());
    const perSeason = await Promise.all(covered.map((season) => getPlayedRegularSeasonGameIds(season)));
    gameIds = perSeason.flat();
  } catch {
    // Supabase unavailable — no game pages this time
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
