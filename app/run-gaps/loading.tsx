export default function RunGapsLoading() {
  return (
    <div className="max-w-7xl mx-auto px-6 md:px-12 py-8">
      <div className="h-8 w-56 bg-gray-200 rounded animate-pulse mb-6" />
      <div className="flex gap-4 mb-6">
        <div className="h-10 w-48 bg-gray-200 rounded animate-pulse" />
        <div className="h-10 w-32 bg-gray-200 rounded animate-pulse" />
      </div>
      <div className="bg-gray-50 border border-gray-200 rounded-lg p-8 flex flex-col items-center gap-8">
        <div className="flex gap-8">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="w-12 h-12 rounded-full bg-gray-200 animate-pulse" />
          ))}
        </div>
        <div className="w-12 h-12 rounded-full bg-gray-200 animate-pulse" />
      </div>
    </div>
  );
}
