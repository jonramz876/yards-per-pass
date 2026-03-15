// app/qb-leaderboard/loading.tsx
export default function QBLoading() {
  return (
    <div className="max-w-7xl mx-auto px-6 md:px-12 py-8">
      <div className="h-8 w-48 bg-gray-200 rounded animate-pulse mb-6" />
      <div className="space-y-2">
        {Array.from({ length: 10 }).map((_, i) => (
          <div key={i} className="h-10 bg-gray-100 rounded animate-pulse" />
        ))}
      </div>
    </div>
  );
}
