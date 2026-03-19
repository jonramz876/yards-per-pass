// components/layout/Navbar.tsx
"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useState } from "react";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";

const NAV_LINKS = [
  { href: "/teams", label: "Team Tiers" },
  { href: "/qb-leaderboard", label: "QB Rankings" },
  { href: "/receivers", label: "Receivers" },
  { href: "/run-gaps", label: "Run Gaps" },
  { href: "/glossary", label: "Glossary", noSeason: true },
] as const;

export default function Navbar() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [open, setOpen] = useState(false);

  // Carry the current season param across page navigation
  function linkHref(base: string) {
    const season = searchParams.get("season");
    return season ? `${base}?season=${season}` : base;
  }

  return (
    <nav className="sticky top-0 z-50 bg-white border-b border-gray-200">
      <div className="max-w-6xl mx-auto px-6 md:px-12 h-16 flex items-center justify-between">
        {/* Wordmark */}
        <Link href="/" className="text-xl font-extrabold tracking-tight text-navy">
          YARDS PER <span className="text-nflred">PASS</span>
        </Link>

        {/* Desktop links */}
        <div className="hidden md:flex items-center gap-8">
          {NAV_LINKS.map((link) => (
            <Link
              key={link.href}
              href={"noSeason" in link ? link.href : linkHref(link.href)}
              className={`text-sm font-medium transition-colors ${
                pathname === link.href
                  ? "text-navy font-semibold"
                  : "text-gray-500 hover:text-navy"
              }`}
            >
              {link.label}
            </Link>
          ))}
        </div>

        {/* Mobile hamburger */}
        <Sheet open={open} onOpenChange={(isOpen) => setOpen(isOpen)}>
          <SheetTrigger
            aria-label="Open menu"
            render={<button className="md:hidden p-2" />}
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="3" y1="6" x2="21" y2="6" />
              <line x1="3" y1="12" x2="21" y2="12" />
              <line x1="3" y1="18" x2="21" y2="18" />
            </svg>
          </SheetTrigger>
          <SheetContent side="right" className="w-64 bg-white">
            <div className="flex flex-col gap-4 mt-8">
              {NAV_LINKS.map((link) => (
                <Link
                  key={link.href}
                  href={"noSeason" in link ? link.href : linkHref(link.href)}
                  onClick={() => setOpen(false)}
                  className={`text-lg font-medium ${
                    pathname === link.href ? "text-navy" : "text-gray-500"
                  }`}
                >
                  {link.label}
                </Link>
              ))}
            </div>
          </SheetContent>
        </Sheet>
      </div>
    </nav>
  );
}
