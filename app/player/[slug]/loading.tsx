// app/player/[slug]/loading.tsx
export default function PlayerLoading() {
  return (
    <div className="max-w-7xl mx-auto px-6 md:px-12 py-8">
      {/* Breadcrumb skeleton */}
      <div className="h-4 w-48 bg-gray-100 rounded animate-pulse mb-3" />

      {/* Header skeleton: accent bar + player info */}
      <div className="rounded-lg border border-gray-200 overflow-hidden mb-6">
        <div className="h-1.5 bg-gray-200 animate-pulse" />
        <div className="p-6 flex flex-col sm:flex-row sm:items-center gap-4">
          <div className="flex-1 space-y-3">
            <div className="flex items-center gap-3">
              <div className="h-8 w-56 bg-gray-200 rounded animate-pulse" />
              <div className="h-6 w-10 bg-gray-100 rounded-full animate-pulse" />
            </div>
            <div className="flex items-center gap-2">
              <div className="h-6 w-6 bg-gray-100 rounded animate-pulse" />
              <div className="h-5 w-36 bg-gray-100 rounded animate-pulse" />
            </div>
          </div>
          <div className="h-8 w-28 bg-gray-100 rounded-md animate-pulse" />
        </div>
      </div>

      {/* Tab bar skeleton */}
      <div className="flex items-center gap-6 border-b border-gray-200 mb-6">
        <div className="h-10 w-24 bg-gray-200 rounded-t animate-pulse" />
        <div className="h-10 w-24 bg-gray-100 rounded-t animate-pulse" />
      </div>

      {/* Content area skeleton */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="h-64 bg-gray-50 rounded-lg border border-gray-100 animate-pulse" />
        <div className="h-64 bg-gray-50 rounded-lg border border-gray-100 animate-pulse" />
      </div>
    </div>
  );
}
