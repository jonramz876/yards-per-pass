// components/layout/Footer.tsx
import Link from "next/link";

export default function Footer() {
  return (
    <footer className="border-t border-gray-200 bg-white py-8">
      <div className="max-w-6xl mx-auto px-6 md:px-12 text-center text-sm text-gray-500">
        Built on{" "}
        <a
          href="https://github.com/nflverse"
          target="_blank"
          rel="noopener noreferrer"
          className="underline hover:text-navy"
        >
          nflverse
        </a>{" "}
        — open-source, peer-reviewed NFL analytics data.
        <span className="block mt-1">
          &copy; {new Date().getFullYear()} Yards Per Pass
          {" "}&middot;{" "}
          <a
            href="https://github.com/jonramz876/yards-per-pass"
            target="_blank"
            rel="noopener noreferrer"
            className="underline hover:text-navy"
          >
            GitHub
          </a>
          {" "}&middot;{" "}
          <Link href="/privacy" className="underline hover:text-navy">
            Privacy
          </Link>
        </span>
      </div>
    </footer>
  );
}
