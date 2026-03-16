// app/not-found.tsx
import Link from "next/link";

export default function NotFound() {
  return (
    <div className="max-w-4xl mx-auto px-6 md:px-12 py-24 text-center">
      <h1 className="text-6xl font-extrabold text-navy mb-4">404</h1>
      <p className="text-lg text-gray-500 mb-8">
        This page doesn&apos;t exist. Maybe it got sacked.
      </p>
      <div className="flex flex-col sm:flex-row gap-4 justify-center">
        <Link
          href="/"
          className="inline-flex items-center justify-center px-6 py-3 bg-navy text-white font-semibold rounded-md hover:bg-navy/90 transition-colors"
        >
          Go Home
        </Link>
        <Link
          href="/teams"
          className="inline-flex items-center justify-center px-6 py-3 border-2 border-navy text-navy font-semibold rounded-md hover:bg-navy hover:text-white transition-colors"
        >
          Team Tiers
        </Link>
        <Link
          href="/qb-leaderboard"
          className="inline-flex items-center justify-center px-6 py-3 border-2 border-navy text-navy font-semibold rounded-md hover:bg-navy hover:text-white transition-colors"
        >
          QB Leaderboard
        </Link>
      </div>
    </div>
  );
}
