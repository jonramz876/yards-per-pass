// app/privacy/page.tsx
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description: "Privacy policy for Yards Per Pass, an NFL analytics website.",
};

export default function PrivacyPage() {
  return (
    <div className="max-w-3xl mx-auto px-6 md:px-12 py-16">
      <h1 className="text-2xl font-extrabold text-navy tracking-tight mb-6">
        Privacy Policy
      </h1>
      <div className="max-w-none space-y-4 text-gray-600 leading-relaxed">
        <p>
          <strong>Last updated:</strong> March 2026
        </p>

        <h2 className="text-lg font-bold text-navy mt-8 mb-2">What we collect</h2>
        <p>
          Yards Per Pass uses{" "}
          <a
            href="https://vercel.com/docs/analytics"
            target="_blank"
            rel="noopener noreferrer"
            className="underline hover:text-navy"
          >
            Vercel Analytics
          </a>{" "}
          to measure page views and performance. This collects anonymous, aggregated
          data — no cookies, no personal information, no tracking across sites.
        </p>

        <h2 className="text-lg font-bold text-navy mt-8 mb-2">What we don&apos;t collect</h2>
        <ul className="list-disc pl-5 space-y-1">
          <li>No personal information (name, email, IP address)</li>
          <li>No cookies or local storage tracking</li>
          <li>No third-party advertising or marketing trackers</li>
          <li>No account creation or login</li>
        </ul>

        <h2 className="text-lg font-bold text-navy mt-8 mb-2">Data source</h2>
        <p>
          All football statistics come from{" "}
          <a
            href="https://github.com/nflverse"
            target="_blank"
            rel="noopener noreferrer"
            className="underline hover:text-navy"
          >
            nflverse
          </a>
          , an open-source community project. We do not collect or store any user-submitted data.
        </p>

        <h2 className="text-lg font-bold text-navy mt-8 mb-2">Contact</h2>
        <p>
          Questions? Open an issue on{" "}
          <a
            href="https://github.com/jonramz876/yards-per-pass"
            target="_blank"
            rel="noopener noreferrer"
            className="underline hover:text-navy"
          >
            GitHub
          </a>
          .
        </p>
      </div>
    </div>
  );
}
