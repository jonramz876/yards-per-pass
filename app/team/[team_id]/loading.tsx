// app/team/[team_id]/loading.tsx
export default function TeamHubLoading() {
  return (
    <div className="max-w-7xl mx-auto px-6 md:px-12 py-8">
      {/* Breadcrumb skeleton */}
      <div className="h-4 w-56 bg-gray-100 rounded animate-pulse mb-3" />

      {/* DashboardShell header skeleton */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
        <div className="flex items-center gap-4">
          <div className="h-8 w-48 bg-gray-200 rounded animate-pulse" />
          <div className="h-5 w-32 bg-gray-100 rounded-full animate-pulse" />
        </div>
        <div className="h-8 w-28 bg-gray-100 rounded-md animate-pulse" />
      </div>

      {/* Identity card skeleton */}
      <div className="rounded-lg border border-gray-200 overflow-hidden mb-8">
        <div className="h-1.5 bg-gray-200 animate-pulse" />
        <div className="p-6 flex flex-col sm:flex-row sm:items-center gap-6">
          <div className="w-20 h-20 bg-gray-100 rounded animate-pulse" />
          <div className="flex-1 space-y-3">
            <div className="h-7 w-56 bg-gray-200 rounded animate-pulse" />
            <div className="flex gap-3">
              <div className="h-5 w-24 bg-gray-100 rounded-full animate-pulse" />
              <div className="h-5 w-28 bg-gray-100 rounded-full animate-pulse" />
            </div>
            <div className="flex gap-3">
              <div className="h-6 w-32 bg-gray-100 rounded animate-pulse" />
              <div className="h-6 w-32 bg-gray-100 rounded animate-pulse" />
            </div>
          </div>
        </div>
      </div>

      {/* Section skeletons */}
      <div className="space-y-8">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="rounded-lg border border-gray-200 p-6">
            <div className="h-6 w-40 bg-gray-200 rounded animate-pulse mb-4" />
            <div className="h-48 bg-gray-50 rounded animate-pulse" />
          </div>
        ))}
      </div>
    </div>
  );
}
