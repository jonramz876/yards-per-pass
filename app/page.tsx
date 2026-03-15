// app/page.tsx
import Link from "next/link";

export default function HomePage() {
  return (
    <>
      {/* Hero */}
      <section className="max-w-4xl mx-auto px-6 md:px-12 pt-24 pb-16 text-center">
        <h1 className="text-4xl md:text-6xl font-extrabold text-navy tracking-tight leading-tight">
          NFL Analytics, Simplified.
        </h1>
        <p className="mt-4 text-lg text-gray-500 max-w-xl mx-auto">
          EPA, CPOE, success rate, and more — all in one clean dashboard. No paywalls. No clutter.
        </p>
        <div className="mt-8 flex flex-col sm:flex-row gap-4 justify-center">
          <Link
            href="/teams"
            className="inline-flex items-center justify-center px-6 py-3 bg-nflred text-white font-semibold rounded-md hover:bg-red-700 transition-colors"
          >
            Explore Team Tiers
          </Link>
          <Link
            href="/qb-leaderboard"
            className="inline-flex items-center justify-center px-6 py-3 border-2 border-navy text-navy font-semibold rounded-md hover:bg-navy hover:text-white transition-colors"
          >
            QB Leaderboard
          </Link>
        </div>
      </section>

      {/* Feature cards */}
      <section className="bg-gray-50 py-16">
        <div className="max-w-6xl mx-auto px-6 md:px-12 grid grid-cols-1 md:grid-cols-3 gap-8">
          <FeatureCard
            title="Team Tiers"
            description="See where every NFL team ranks by offensive and defensive EPA — the gold standard of football analytics. One chart, total clarity."
            icon="📊"
          />
          <FeatureCard
            title="QB Rankings"
            description="Sort quarterbacks by EPA, CPOE, success rate, and 10+ other metrics. Filter by minimum dropbacks and season."
            icon="🏈"
          />
          <FeatureCard
            title="Open Source"
            description="Built on trusted nflverse data, updated weekly. More features in the works — follow along on GitHub."
            icon="🔮"
          />
        </div>
      </section>
    </>
  );
}

function FeatureCard({
  title,
  description,
  icon,
}: {
  title: string;
  description: string;
  icon: string;
}) {
  return (
    <div className="bg-white p-6 rounded-md border border-gray-200">
      <div className="text-3xl mb-4">{icon}</div>
      <h3 className="text-lg font-bold text-navy mb-2">{title}</h3>
      <p className="text-sm text-gray-500 leading-relaxed">{description}</p>
    </div>
  );
}
