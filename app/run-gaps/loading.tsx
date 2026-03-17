export default function RunGapsLoading() {
  return (
    <div className="max-w-7xl mx-auto px-6 md:px-12 py-8">
      {/* Header row: title + season selector */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
        <div className="flex items-center gap-4">
          <div className="h-8 w-36 bg-gray-200 rounded-lg animate-pulse" />
          <div className="h-6 w-56 bg-gray-200 rounded-full animate-pulse" />
        </div>
        <div className="h-9 w-36 bg-gray-200 rounded-md animate-pulse" />
      </div>

      {/* Team selector row */}
      <div className="flex gap-4 mb-6">
        <div className="h-10 w-48 bg-gray-200 rounded-lg animate-pulse" />
        <div className="h-10 w-36 bg-gray-200 rounded-lg animate-pulse" />
      </div>

      {/* Header card placeholder */}
      <div className="h-20 w-full bg-gray-200 rounded-lg animate-pulse mb-6" />

      {/* Filter row */}
      <div className="flex gap-3 mb-6">
        <div className="h-8 w-24 bg-gray-200 rounded-lg animate-pulse" />
        <div className="h-8 w-28 bg-gray-200 rounded-lg animate-pulse" />
        <div className="h-8 w-24 bg-gray-200 rounded-lg animate-pulse" />
      </div>

      {/* Formation diagram skeleton */}
      <div className="bg-gray-50 border border-gray-200 rounded-lg p-8 flex flex-col items-center gap-8">
        {/* 5 OL circles */}
        <div className="flex gap-8">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="w-12 h-12 rounded-full bg-gray-200 animate-pulse" />
          ))}
        </div>
        {/* RB circle */}
        <div className="w-12 h-12 rounded-full bg-gray-200 animate-pulse" />
        {/* Loading text */}
        <p className="text-sm text-gray-400 animate-pulse">Loading gap data...</p>
      </div>
    </div>
  );
}
