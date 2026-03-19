// components/layout/DashboardShell.tsx
// SERVER COMPONENT — do NOT add "use client". SeasonSelect (client) is
// wrapped in Suspense to handle useSearchParams() static rendering requirements.
import { Suspense } from "react";
import type { DataFreshness } from "@/lib/types";
import SeasonSelect from "@/components/ui/SeasonSelect";

interface DashboardShellProps {
  title: string;
  seasons: number[];
  currentSeason: number;
  freshness: DataFreshness | null;
  children: React.ReactNode;
}

export default function DashboardShell({
  title,
  seasons,
  currentSeason,
  freshness,
  children,
}: DashboardShellProps) {
  const freshnessDate = freshness ? new Date(freshness.last_updated) : null;
  const daysSinceUpdate = freshnessDate
    ? Math.floor((Date.now() - freshnessDate.getTime()) / (1000 * 60 * 60 * 24))
    : 0;
  const isStale = daysSinceUpdate > 10;
  const freshnessText = freshness
    ? `${freshness.season} Season \u00b7 Through Week ${freshness.through_week} \u00b7 Updated ${freshnessDate!.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`
    : null;

  return (
    <div className="max-w-7xl mx-auto px-6 md:px-12 py-8">
      {/* Header row: title + controls */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
        <div className="flex items-center gap-4 flex-wrap">
          <h1 className="text-2xl font-extrabold text-navy tracking-tight">
            {title}
          </h1>
          {freshnessText && (
            <span className={`inline-flex items-center px-3 py-1 text-xs font-medium rounded-full ${
              isStale
                ? "text-amber-800 bg-amber-50 border border-amber-200"
                : "text-navy bg-blue-50"
            }`}>
              {isStale && <span className="mr-1">&#9888;</span>}
              {freshnessText}
            </span>
          )}
        </div>
        {/* CRITICAL: useSearchParams() in SeasonSelect requires Suspense boundary */}
        <Suspense
          fallback={
            <select
              className="px-3 py-1.5 text-sm border border-gray-200 rounded-md bg-white text-navy font-medium"
              disabled
            >
              <option>{currentSeason} Season</option>
            </select>
          }
        >
          <SeasonSelect seasons={seasons} currentSeason={currentSeason} />
        </Suspense>
      </div>

      {/* Page content */}
      {children}
    </div>
  );
}
