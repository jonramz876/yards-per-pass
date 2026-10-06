// components/compare/PlayerSearchInput.tsx
"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { getSupabaseClient } from "@/lib/supabase/client";
import { getTeamColor } from "@/lib/data/teams";

export interface SelectedPlayer {
  player_id: string;
  slug: string;
  player_name: string;
  position: string;
  current_team_id: string;
}

// Shown when the search failed or timed out. Without it a failed search shows
// nothing, exactly like a name nobody has (read resilience spec §1.5, S2; the
// same sentence as the site search). A string constant, not JSX text: lint
// rejects a bare apostrophe in JSX, and JSX text does not decode escapes.
const PLAYER_SEARCH_UNAVAILABLE = "Player search isn't responding right now. Try again in a moment.";

interface PlayerSearchInputProps {
  label: string;
  selected: SelectedPlayer | null;
  onSelect: (player: SelectedPlayer | null) => void;
  positionFilter?: string;
  excludePlayerId?: string;
}

export default function PlayerSearchInput({
  label,
  selected,
  onSelect,
  positionFilter,
  excludePlayerId,
}: PlayerSearchInputProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SelectedPlayer[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  // True when the last search failed (an error from Supabase, a timeout, or a
  // client that could not be created), as opposed to finding nobody.
  const [searchFailed, setSearchFailed] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const search = useCallback(
    async (q: string) => {
      if (q.length < 2) {
        setResults([]);
        setSearchFailed(false);
        return;
      }
      setLoading(true);
      try {
        const supabase = getSupabaseClient();
        let qb = supabase
          .from("player_slugs")
          .select("player_id, slug, player_name, position, current_team_id")
          .ilike("player_name", `%${q}%`)
          .limit(10);

        if (positionFilter) {
          // RB pool includes FBs
          if (positionFilter === "RB") {
            qb = qb.in("position", ["RB", "FB"]);
          } else {
            qb = qb.eq("position", positionFilter);
          }
        }
        // supabase-js reports a failed or timed-out request as `error`, not as
        // a rejection. Unread, it looked exactly like a name nobody has.
        const { data, error } = await qb;
        if (error) {
          setResults([]);
          setSearchFailed(true);
          return;
        }
        let filtered = (data as SelectedPlayer[]) || [];
        if (excludePlayerId) {
          filtered = filtered.filter((p) => p.player_id !== excludePlayerId);
        }
        setResults(filtered);
        setSelectedIndex(0);
        setSearchFailed(false);
      } catch {
        // The client could not be created, or the request threw.
        setResults([]);
        setSearchFailed(true);
      } finally {
        setLoading(false);
      }
    },
    [positionFilter, excludePlayerId]
  );

  const handleInput = (val: string) => {
    setQuery(val);
    setOpen(true);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => search(val), 200);
  };

  const handleSelect = (player: SelectedPlayer) => {
    onSelect(player);
    setQuery("");
    setResults([]);
    setSearchFailed(false);
    setOpen(false);
  };

  const handleClear = () => {
    onSelect(null);
    setQuery("");
    setResults([]);
    setSearchFailed(false);
  };

  // Close dropdown on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  // Keyboard navigation
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!open || results.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      handleSelect(results[selectedIndex]);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  };

  if (selected) {
    return (
      <div className="flex items-center gap-2 px-3 py-2 border border-gray-200 rounded-lg bg-white">
        <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: getTeamColor(selected.current_team_id) }} />
        <span className="font-semibold text-navy text-sm">{selected.player_name}</span>
        <span className="text-xs text-gray-400">{selected.position} · {selected.current_team_id}</span>
        <button
          onClick={handleClear}
          className="ml-auto text-gray-400 hover:text-red-500 transition-colors text-lg leading-none"
          aria-label="Clear selection"
        >
          &times;
        </button>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="relative">
      <label className="block text-xs font-semibold text-gray-500 mb-1">{label}</label>
      <input
        type="text"
        value={query}
        onChange={(e) => handleInput(e.target.value)}
        onFocus={() => query.length >= 2 && setOpen(true)}
        onKeyDown={handleKeyDown}
        placeholder="Search players..."
        className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-navy/20"
      />
      {open && results.length > 0 && (
        <div className="absolute z-50 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-60 overflow-y-auto">
          {results.map((p, i) => (
            <button
              key={p.player_id}
              onClick={() => handleSelect(p)}
              className={`w-full text-left px-3 py-2 text-sm flex items-center gap-2 transition-colors ${
                i === selectedIndex ? "bg-navy/5" : "hover:bg-gray-50"
              }`}
            >
              <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: getTeamColor(p.current_team_id) }} />
              <span className="font-medium text-gray-800">{p.player_name}</span>
              <span className="text-xs text-gray-400 ml-auto">{p.position} · {p.current_team_id}</span>
            </button>
          ))}
        </div>
      )}
      {open && loading && (
        <div className="absolute z-50 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg px-3 py-2 text-sm text-gray-400">
          Searching...
        </div>
      )}
      {open && !loading && searchFailed && (
        <div
          role="status"
          className="absolute z-50 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg px-3 py-2 text-sm text-gray-500"
        >
          {PLAYER_SEARCH_UNAVAILABLE}
        </div>
      )}
    </div>
  );
}
