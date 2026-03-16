// app/teams/loading.tsx
export default function TeamsLoading() {
  return (
    <div className="max-w-7xl mx-auto px-6 md:px-12 py-8">
      {/* Title + freshness badge + season selector skeleton */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
        <div className="flex items-center gap-4">
          <div className="h-8 w-48 bg-gray-200 rounded animate-pulse" />
          <div className="h-5 w-32 bg-gray-100 rounded-full animate-pulse" />
        </div>
        <div className="h-8 w-28 bg-gray-100 rounded-md animate-pulse" />
      </div>
      {/* Chart area skeleton */}
      <div className="w-full h-[560px] bg-gray-100 rounded-md border border-gray-200 flex items-center justify-center">
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-navy border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          <p className="text-sm text-gray-400">Loading chart...</p>
        </div>
      </div>
    </div>
  );
}
