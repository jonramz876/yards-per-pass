// app/compare/page.tsx
import type { Metadata } from "next";
import { Suspense } from "react";
import ComparisonTool from "@/components/compare/ComparisonTool";
import { getPlayerBySlug } from "@/lib/data/players";
import { getQBStats } from "@/lib/data/queries";
import { getReceiverStats } from "@/lib/data/receivers";
import { getRBSeasonStats } from "@/lib/data/rushing";
import type { QBSeasonStat, ReceiverSeasonStat, RBSeasonStat } from "@/lib/types";

export const metadata: Metadata = {
  title: "Player Comparison",
  description:
    "Compare NFL players head-to-head with overlaid radar charts and stat breakdowns. EPA, CPOE, CROE, and 30+ metrics side by side.",
};

export default async function ComparePage({
  searchParams,
}: {
  searchParams: { season?: string; p1?: string };
}) {
  const season = searchParams.season ? parseInt(searchParams.season, 10) : 2025;

  // Only fetch the position we need based on p1's position (if present)
  let qbs: QBSeasonStat[] = [];
  let receivers: ReceiverSeasonStat[] = [];
  let rbs: RBSeasonStat[] = [];

  if (searchParams.p1) {
    const player = await getPlayerBySlug(searchParams.p1);
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
