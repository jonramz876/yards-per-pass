// components/ui/ErrorState.tsx
"use client";

interface ErrorStateProps {
  title?: string;
  message?: string;
  reset: () => void;
}

export default function ErrorState({
  title = "Unable to load data",
  message = "Something went wrong loading this page. Try refreshing, or come back in a few minutes.",
  reset,
}: ErrorStateProps) {
  return (
    <div className="max-w-4xl mx-auto px-6 md:px-12 py-16 text-center">
      <h2 className="text-xl font-bold text-navy mb-2">{title}</h2>
      <p className="text-gray-500 mb-6 max-w-md mx-auto">{message}</p>
      <div className="flex gap-4 justify-center">
        <button
          onClick={reset}
          className="px-4 py-2 bg-navy text-white rounded-md hover:bg-navy/90 transition-colors"
        >
          Try again
        </button>
        <a
          href="https://github.com/jonramz876/yards-per-pass/issues"
          target="_blank"
          rel="noopener noreferrer"
          className="px-4 py-2 border border-gray-300 text-gray-600 rounded-md hover:bg-gray-50 transition-colors"
        >
          Report issue
        </a>
      </div>
    </div>
  );
}
