// app/sitemap.ts
import { getAllPlayerSlugs } from "@/lib/data/players";
import { getDataFreshness } from "@/lib/data/queries";
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

  // No /card/ URLs. /player/<slug> is the canonical page for a player, and its
  // Overview IS the same Tecmo card, so /card/ is a share view. /card/ is also
  // season-scoped: many slugs have no card (K/P/defense always; everyone whose
  // team hasn't played early each season) and render a noindex message.
  // Card pages stay reachable and indexable through the Share Card links.
  return [...staticPages, ...teamPages, ...playerPages];
}
