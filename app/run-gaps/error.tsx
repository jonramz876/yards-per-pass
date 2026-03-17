"use client";

import { useEffect } from "react";

export default function RunGapsError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Run Gaps error:", error);
  }, [error]);

  return (
    <div className="max-w-7xl mx-auto px-6 md:px-12 py-8">
      <div className="text-center py-16">
        <h2 className="text-xl font-bold text-navy mb-2">Unable to load run gap data</h2>
        <p className="text-sm text-gray-500 mb-4">{error.message}</p>
        <button
          onClick={reset}
          className="px-4 py-2 text-sm font-medium text-white bg-navy rounded-md hover:bg-opacity-90"
        >
          Try again
        </button>
      </div>
    </div>
  );
}
