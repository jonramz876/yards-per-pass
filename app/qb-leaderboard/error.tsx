// app/qb-leaderboard/error.tsx
"use client";

import { useEffect } from "react";

export default function QBError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("QB Leaderboard page error:", error);
  }, [error]);
  return (
    <div className="max-w-7xl mx-auto px-6 md:px-12 py-16 text-center">
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
