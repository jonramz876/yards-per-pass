// app/compare/page.tsx
import type { Metadata } from "next";
import { Suspense } from "react";
import ComparisonTool from "@/components/compare/ComparisonTool";
import { getPlayerBySlug } from "@/lib/data/players";
import { getQBStats, getAvailableSeasons, fallbackSeason } from "@/lib/data/queries";
import { getReceiverStats } from "@/lib/data/receivers";
import { getRBSeasonStats } from "@/lib/data/rushing";
import type { QBSeasonStat, ReceiverSeasonStat, RBSeasonStat, PlayerSlug } from "@/lib/types";

export const metadata: Metadata = {
  title: "Player Comparison",
  description:
    "Compare NFL players head-to-head with overlaid radar charts and stat breakdowns. EPA, CPOE, CROE, and 30+ metrics side by side.",
  alternates: { canonical: `${process.env.NEXT_PUBLIC_SITE_URL || "https://yardsperpass.com"}/compare` },
};

export default async function ComparePage({
  searchParams,
}: {
  searchParams: Promise<{ season?: string; p1?: string }>;
}) {
  const { season: seasonParam, p1 } = await searchParams;
  const parsed = seasonParam ? parseInt(seasonParam, 10) : NaN;
  const season = Number.isNaN(parsed) ? ((await getAvailableSeasons())[0] ?? fallbackSeason()) : parsed;

  // Only fetch the position we need based on p1's position (if present)
  let qbs: QBSeasonStat[] = [];
  let receivers: ReceiverSeasonStat[] = [];
  let rbs: RBSeasonStat[] = [];

  if (p1) {
    // The one read here that may degrade (read resilience spec §1.2): if the
    // p1 lookup fails, render the tool with nothing preloaded. The browser
    // restores both players from the URL itself and says so if it cannot.
    // The seasons read above and the position table below are core: a failure
    // throws to app/compare/error.tsx.
    let player: PlayerSlug | null = null;
    try {
      player = await getPlayerBySlug(p1);
    } catch (err: unknown) {
      console.error(`Compare page: player lookup failed for ${p1}; rendering with nothing preloaded`, err);
    }
    if (player) {
      const pos = player.position;
      if (pos === "QB") {
        qbs = await getQBStats(season);
      } else if (pos === "WR" || pos === "TE") {
        receivers = await getReceiverStats(season);
      } else if (pos === "RB" || pos === "FB") {
        rbs = await getRBSeasonStats(season);
      }
    }
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="space-y-2 mb-6">
        <h1 className="text-2xl font-extrabold text-navy tracking-tight">
          Player Comparison
        </h1>
        <p className="text-sm text-gray-500">
          Compare two same-position players with overlaid radar charts and detailed stat breakdowns.
        </p>
      </div>
      <Suspense fallback={<div className="text-center py-12 text-gray-400">Loading comparison tool...</div>}>
        <ComparisonTool qbs={qbs} receivers={receivers} rbs={rbs} season={season} />
      </Suspense>
    </div>
  );
}
