// app/qb-leaderboard/loading.tsx
export default function QBLoading() {
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
      {/* Tab bar + controls skeleton */}
      <div className="flex items-center gap-6 mb-4">
        <div className="h-10 w-36 bg-gray-200 rounded-lg animate-pulse" />
        <div className="h-9 w-56 bg-gray-100 rounded-md animate-pulse" />
        <div className="h-9 w-32 bg-gray-100 rounded animate-pulse" />
      </div>
      {/* Table skeleton */}
      <div className="border border-gray-200 rounded-md overflow-hidden">
        {/* Header row */}
        <div className="h-10 bg-navy animate-pulse" />
        {/* Data rows */}
        {Array.from({ length: 12 }).map((_, i) => (
          <div key={i} className={`h-10 ${i % 2 === 0 ? "bg-gray-50" : "bg-white"} border-t border-gray-100 animate-pulse`} />
        ))}
      </div>
    </div>
  );
}
