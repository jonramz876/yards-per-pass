// app/sitemap.ts
import type { MetadataRoute } from "next";

export default function sitemap(): MetadataRoute.Sitemap {
  const base = process.env.NEXT_PUBLIC_SITE_URL || "https://yardsperpass.com";
  return [
    { url: base, lastModified: new Date(), changeFrequency: "weekly", priority: 1 },
    { url: `${base}/teams`, lastModified: new Date(), changeFrequency: "weekly", priority: 0.9 },
    { url: `${base}/qb-leaderboard`, lastModified: new Date(), changeFrequency: "weekly", priority: 0.9 },
    { url: `${base}/receivers`, lastModified: new Date(), changeFrequency: "weekly" as const, priority: 0.9 },
    { url: `${base}/run-gaps`, lastModified: new Date(), changeFrequency: "weekly" as const, priority: 0.8 },
    { url: `${base}/glossary`, lastModified: new Date(), changeFrequency: "monthly", priority: 0.7 },
    { url: `${base}/privacy`, lastModified: new Date(), changeFrequency: "yearly", priority: 0.3 },
  ];
}
