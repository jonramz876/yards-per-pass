// components/search/SearchPalette.tsx
"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { getSupabaseClient } from "@/lib/supabase/client";
import { NFL_TEAMS } from "@/lib/data/teams";
import type { PlayerSlug } from "@/lib/types";

interface SearchResult {
  type: "team" | "player";
  label: string;
  sublabel: string;
  href: string;
  color: string;
}

interface SearchPaletteProps {
  open: boolean;
  onClose: () => void;
}

// Shown when the player query failed or timed out, in place of "No results",
// which would be false (read resilience spec §1.5, S1). A string constant, not
// JSX text: lint rejects a bare apostrophe in JSX, and JSX text does not
// decode escape sequences.
const PLAYER_SEARCH_UNAVAILABLE = "Player search isn't responding right now. Try again in a moment.";

export default function SearchPalette({ open, onClose }: SearchPaletteProps) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [loading, setLoading] = useState(false);
  // True when the last player query failed (an error from Supabase, a timeout,
  // or a client that could not be created). Team matches are unaffected.
  const [playerSearchFailed, setPlayerSearchFailed] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Focus input when palette opens
  useEffect(() => {
    if (open) {
      setQuery("");
      setResults([]);
      setSelectedIndex(0);
      setPlayerSearchFailed(false);
      // Small delay to ensure modal is rendered before focusing
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  // Global keyboard shortcut: Cmd+K / Ctrl+K handled in parent (Navbar)
  // Escape to close is handled here
  useEffect(() => {
    if (!open) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  // Search logic with debounce
  const doSearch = useCallback(async (term: string) => {
    const trimmed = term.trim().toLowerCase();
    if (!trimmed) {
      setResults([]);
      setSelectedIndex(0);
      setPlayerSearchFailed(false);
      return;
    }

    // Search teams (client-side, instant)
    const teamResults: SearchResult[] = NFL_TEAMS
      .filter(
        (t) =>
          t.name.toLowerCase().includes(trimmed) ||
          t.abbreviation.toLowerCase().includes(trimmed)
      )
      .slice(0, 5)
      .map((t) => ({
        type: "team" as const,
        label: t.name,
        sublabel: t.division,
        href: `/team/${t.id}`,
        color: t.primaryColor,
      }));

    // Search players (Supabase ilike)
    let playerResults: SearchResult[] = [];
    let playersFailed = false;
    if (trimmed.length >= 2) {
      setLoading(true);
      try {
        const supabase = getSupabaseClient();
        // supabase-js reports a failed or timed-out request as `error`, not as
        // a rejection, so it has to be read: `data` is null either way.
        const { data, error } = await supabase
          .from("player_slugs")
          .select("player_id, slug, player_name, position, current_team_id")
          .ilike("player_name", `%${trimmed}%`)
          .order("player_name")
          .limit(10);

        if (error) {
          playersFailed = true;
        } else if (data) {
          playerResults = (data as PlayerSlug[]).map((p) => {
            const team = NFL_TEAMS.find((t) => t.id === p.current_team_id);
            return {
              type: "player" as const,
              label: p.player_name,
              sublabel: `${p.position} · ${p.current_team_id}`,
              href: `/player/${p.slug}`,
              color: team?.primaryColor ?? "#6B7280",
            };
          });
        }
      } catch {
        // The client could not be created, or the request threw. Team results
        // still show; the visitor is told player search is down.
        playersFailed = true;
      } finally {
        setLoading(false);
      }
    }

    // Teams first, then players, max 10 total
    const combined = [...teamResults, ...playerResults].slice(0, 10);
    setResults(combined);
    setSelectedIndex(0);
    setPlayerSearchFailed(playersFailed);
  }, []);

  // Debounced input handler
  function handleInputChange(value: string) {
    setQuery(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => doSearch(value), 200);
  }

  // Keyboard navigation inside palette
  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((prev) => Math.min(prev + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((prev) => Math.max(prev - 1, 0));
    } else if (e.key === "Enter" && results.length > 0) {
      e.preventDefault();
      navigateTo(results[selectedIndex].href);
    }
  }

  function navigateTo(href: string) {
    onClose();
    router.push(href);
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-start justify-center pt-[15vh]"
      style={{ background: "rgba(15,23,42,0.5)", backdropFilter: "blur(4px)" }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl overflow-hidden animate-in slide-in-from-top-4 fade-in duration-200"
        style={{ width: 500, maxWidth: "95vw" }}
      >
        {/* Search input */}
        <div className="flex items-center gap-3 px-4 border-b border-gray-200">
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="#9CA3AF"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="shrink-0"
          >
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => handleInputChange(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search players and teams..."
            className="py-3 text-lg w-full outline-none bg-transparent"
          />
          {loading && (
            <div className="w-4 h-4 border-2 border-gray-300 border-t-navy rounded-full animate-spin shrink-0" />
          )}
        </div>

        {/* Results list */}
        {results.length > 0 && (
          <ul className="max-h-[360px] overflow-y-auto py-1">
            {results.map((result, i) => (
              <li
                key={`${result.type}-${result.href}`}
                className={`flex items-center gap-3 py-2.5 px-4 cursor-pointer transition-colors ${
                  i === selectedIndex ? "bg-navy/5" : "hover:bg-gray-50"
                }`}
                onClick={() => navigateTo(result.href)}
                onMouseEnter={() => setSelectedIndex(i)}
              >
                {/* Team color dot */}
                <span
                  className="w-2.5 h-2.5 rounded-full shrink-0"
                  style={{ backgroundColor: result.color }}
                />
                <div className="min-w-0 flex-1">
                  <span className="text-sm font-medium text-gray-900">
                    {result.label}
                  </span>
                  <span className="text-sm text-gray-400 ml-2">
                    {result.sublabel}
                  </span>
                </div>
                <span className="text-xs text-gray-300 uppercase shrink-0">
                  {result.type === "team" ? "Team" : "Player"}
                </span>
              </li>
            ))}
          </ul>
        )}

        {/* Player search failed: said under any team matches, never "No results" */}
        {query.trim().length > 0 && playerSearchFailed && !loading && (
          <div className="py-4 px-4 text-center text-sm text-gray-500" role="status">
            {PLAYER_SEARCH_UNAVAILABLE}
          </div>
        )}

        {/* Empty state */}
        {query.trim().length > 0 && results.length === 0 && !loading && !playerSearchFailed && (
          <div className="py-8 text-center text-sm text-gray-400">
            No results for &ldquo;{query.trim()}&rdquo;
          </div>
        )}

        {/* Hint bar */}
        <div className="flex items-center gap-4 px-4 py-2 border-t border-gray-100 text-xs text-gray-400">
          <span>
            <kbd className="px-1.5 py-0.5 bg-gray-100 rounded text-[10px] font-mono">↑↓</kbd> navigate
          </span>
          <span>
            <kbd className="px-1.5 py-0.5 bg-gray-100 rounded text-[10px] font-mono">↵</kbd> open
          </span>
          <span>
            <kbd className="px-1.5 py-0.5 bg-gray-100 rounded text-[10px] font-mono">esc</kbd> close
          </span>
        </div>
      </div>
    </div>
  );
}
