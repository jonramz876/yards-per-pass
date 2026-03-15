// app/teams/loading.tsx
export default function TeamsLoading() {
  return (
    <div className="max-w-6xl mx-auto px-6 md:px-12 py-8">
      <div className="h-8 w-48 bg-gray-200 rounded animate-pulse mb-6" />
      <div className="w-full h-[560px] bg-gray-100 rounded-md border border-gray-200 flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-navy border-t-transparent rounded-full animate-spin" />
      </div>
    </div>
  );
}
