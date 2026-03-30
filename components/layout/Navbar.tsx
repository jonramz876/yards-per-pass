// components/layout/Navbar.tsx
"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useState, useEffect, useCallback } from "react";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import SearchPalette from "@/components/search/SearchPalette";

const NAV_LINKS = [
  { href: "/teams", label: "Team Tiers" },
  { href: "/qb-leaderboard", label: "Passing" },
  { href: "/receivers", label: "Receiving" },
  { href: "/rushing", label: "Rushing" },
  { href: "/run-gaps", label: "Run Gaps" },
  { href: "/trends", label: "Trends" },
  { href: "/compare", label: "Compare", noSeason: true },
  { href: "/glossary", label: "Glossary", noSeason: true },
] as const;

export default function Navbar() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [open, setOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);

  const closeSearch = useCallback(() => setSearchOpen(false), []);

  // Global Cmd+K / Ctrl+K shortcut
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setSearchOpen(true);
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

  // Carry the current season param across page navigation
  function linkHref(base: string) {
    const season = searchParams.get("season");
    return season ? `${base}?season=${season}` : base;
  }

  return (
    <>
      <nav className="sticky top-0 z-50 bg-white border-b border-gray-200">
        <div className="max-w-6xl mx-auto px-6 md:px-12 h-16 flex items-center justify-between">
          {/* Wordmark */}
          <Link href="/" className="text-xl font-extrabold tracking-tight text-navy">
            YARDS PER <span className="text-nflred">PASS</span>
          </Link>

          {/* Desktop links + search */}
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

            {/* Search button — desktop */}
            <button
              onClick={() => setSearchOpen(true)}
              className="flex items-center gap-2 text-gray-400 hover:text-navy transition-colors"
              aria-label="Search"
            >
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
              <kbd className="hidden md:inline-flex items-center gap-0.5 px-1.5 py-0.5 bg-gray-100 rounded text-[10px] font-mono text-gray-400 border border-gray-200">
                ⌘K
              </kbd>
            </button>
          </div>

          {/* Mobile: search icon + hamburger */}
          <div className="flex md:hidden items-center gap-2">
            <button
              onClick={() => setSearchOpen(true)}
              className="p-2 text-gray-500 hover:text-navy transition-colors"
              aria-label="Search"
            >
              <svg
                width="22"
                height="22"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
            </button>

            <Sheet open={open} onOpenChange={(isOpen) => setOpen(isOpen)}>
              <SheetTrigger
                aria-label="Open menu"
                render={<button className="p-2" />}
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
        </div>
      </nav>

      <SearchPalette open={searchOpen} onClose={closeSearch} />
    </>
  );
}
