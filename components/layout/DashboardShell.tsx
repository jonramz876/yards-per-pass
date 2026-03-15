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
  const freshnessText = freshness
    ? `${freshness.season} Season \u00b7 Through Week ${freshness.through_week} \u00b7 Updated ${new Date(freshness.last_updated).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`
    : null;

  return (
    <div className="max-w-6xl mx-auto px-6 md:px-12 py-8">
      {/* Header row: title + controls */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
        <div className="flex items-center gap-4">
          <h1 className="text-2xl font-extrabold text-navy tracking-tight">
            {title}
          </h1>
          {freshnessText && (
            <span className="inline-flex items-center px-3 py-1 text-xs font-medium text-navy bg-blue-50 rounded-full">
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
