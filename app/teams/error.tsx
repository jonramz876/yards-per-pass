// app/teams/error.tsx
"use client";

export default function TeamsError({ reset }: { reset: () => void }) {
  return (
    <div className="max-w-6xl mx-auto px-6 md:px-12 py-16 text-center">
      <h2 className="text-xl font-bold text-navy mb-2">Unable to load data</h2>
      <p className="text-gray-500 mb-6">Please try again later.</p>
      <button
        onClick={reset}
        className="px-4 py-2 bg-navy text-white rounded-md hover:bg-navy/90 transition-colors"
      >
        Try again
      </button>
    </div>
  );
}
