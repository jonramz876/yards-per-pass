// components/game/GameMessage.tsx — the message card under the scoreboard when
// a played game has no box score (box score spec §6 states): a heading, one
// line of explanation and, when useful, links to both team pages. Never a
// blank page (MEMORY.md rule).
import Link from "next/link";

export interface GameMessageLink {
  href: string;
  label: string;
}

interface GameMessageProps {
  /** "uncovered" | "pending" — for tests and styling hooks. */
  kind: string;
  heading: string;
  body: string;
  links?: GameMessageLink[];
}

export default function GameMessage({ kind, heading, body, links = [] }: GameMessageProps) {
  return (
    <section
      data-game-message={kind}
      className="rounded-xl border border-gray-200 bg-white px-5 py-6 text-center"
    >
      <h2 className="text-lg font-bold text-navy">{heading}</h2>
      <p className="mx-auto mt-1.5 max-w-[48ch] text-sm leading-relaxed text-gray-500">{body}</p>
      {links.length > 0 && (
        <div className="mt-3.5 flex flex-wrap justify-center gap-x-5 gap-y-2">
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="text-sm font-semibold text-navy transition-colors hover:text-nflred"
            >
              {link.label} ›
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}
