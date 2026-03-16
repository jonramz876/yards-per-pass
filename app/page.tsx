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

      {/* Metric explainer */}
      <section className="max-w-3xl mx-auto px-6 md:px-12 pb-12">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 text-center">
          <div>
            <p className="text-sm font-bold text-navy mb-1">EPA</p>
            <p className="text-xs text-gray-500 leading-relaxed">
              Expected Points Added — how much each play changes a team&apos;s scoring chances. Above 0 is good.
            </p>
          </div>
          <div>
            <p className="text-sm font-bold text-navy mb-1">CPOE</p>
            <p className="text-xs text-gray-500 leading-relaxed">
              Completion Percentage Over Expected — whether a QB completes more passes than difficulty suggests he should.
            </p>
          </div>
          <div>
            <p className="text-sm font-bold text-navy mb-1">Success Rate</p>
            <p className="text-xs text-gray-500 leading-relaxed">
              How often a play gains enough yards to keep the drive on schedule. The consistency metric.
            </p>
          </div>
        </div>
      </section>

      {/* Feature cards */}
      <section className="bg-gray-50 py-16">
        <div className="max-w-6xl mx-auto px-6 md:px-12 grid grid-cols-1 md:grid-cols-3 gap-8">
          <FeatureCard
            title="Team Tiers"
            description="See where every NFL team ranks by offensive and defensive EPA — the gold standard of football analytics. One chart, total clarity."
            icon="📊"
            href="/teams"
          />
          <FeatureCard
            title="QB Rankings"
            description="Sort quarterbacks by EPA, CPOE, success rate, and 10+ other metrics. Filter by minimum dropbacks and season."
            icon="🏈"
            href="/qb-leaderboard"
          />
          <FeatureCard
            title="Open Source"
            description="Built on trusted nflverse data, updated weekly. More features in the works — follow along on GitHub."
            icon="🔮"
            href="https://github.com/jonramz876/yards-per-pass"
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
  href,
}: {
  title: string;
  description: string;
  icon: string;
  href?: string;
}) {
  const content = (
    <>
      <div className="text-3xl mb-4">{icon}</div>
      <h3 className="text-lg font-bold text-navy mb-2">{title}</h3>
      <p className="text-sm text-gray-500 leading-relaxed">{description}</p>
    </>
  );

  if (href) {
    return (
      <Link
        href={href}
        className="bg-white p-6 rounded-md border border-gray-200 hover:border-navy/30 hover:shadow-md transition-all"
      >
        {content}
      </Link>
    );
  }

  return (
    <div className="bg-white p-6 rounded-md border border-gray-200">
      {content}
    </div>
  );
}
