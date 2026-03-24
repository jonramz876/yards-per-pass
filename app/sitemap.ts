// app/sitemap.ts
import { getAllPlayerSlugs } from "@/lib/data/players";
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

  const staticPages: MetadataRoute.Sitemap = [
    { url: base, lastModified: new Date(), changeFrequency: "weekly", priority: 1 },
    { url: `${base}/teams`, lastModified: new Date(), changeFrequency: "weekly", priority: 0.9 },
    { url: `${base}/qb-leaderboard`, lastModified: new Date(), changeFrequency: "weekly", priority: 0.9 },
    { url: `${base}/receivers`, lastModified: new Date(), changeFrequency: "weekly", priority: 0.9 },
    { url: `${base}/rushing`, lastModified: new Date(), changeFrequency: "weekly", priority: 0.9 },
    { url: `${base}/run-gaps`, lastModified: new Date(), changeFrequency: "weekly", priority: 0.8 },
    { url: `${base}/compare`, lastModified: new Date(), changeFrequency: "weekly", priority: 0.8 },
    { url: `${base}/glossary`, lastModified: new Date(), changeFrequency: "monthly", priority: 0.7 },
    { url: `${base}/privacy`, lastModified: new Date(), changeFrequency: "yearly", priority: 0.3 },
  ];

  const teamPages: MetadataRoute.Sitemap = NFL_TEAMS.map((t) => ({
    url: `${base}/team/${t.id}`,
    lastModified: new Date(),
    changeFrequency: "weekly" as const,
    priority: 0.8,
  }));

  const playerPages: MetadataRoute.Sitemap = players.map((p) => ({
    url: `${base}/player/${p.slug}`,
    lastModified: new Date(),
    changeFrequency: "weekly" as const,
    priority: 0.7,
  }));

  return [...staticPages, ...teamPages, ...playerPages];
}
