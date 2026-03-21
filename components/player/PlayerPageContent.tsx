// components/player/PlayerPageContent.tsx
"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import type { PlayerSlug } from "@/lib/types";
import PlayerHeader from "./PlayerHeader";

interface PlayerPageContentProps {
  player: PlayerSlug;
  seasonStats: unknown[];
  weeklyStats: unknown[];
  allPlayers: unknown[];
  season: number;
  seasons: number[];
  position: string;
  tab: string;
}

const TABS = [
  { key: "overview", label: "Overview" },
  { key: "game-log", label: "Game Log" },
] as const;

export default function PlayerPageContent({
  player,
  seasonStats,
  weeklyStats,
  allPlayers,
  season,
  seasons,
  position,
  tab,
}: PlayerPageContentProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const activeTab = TABS.some((t) => t.key === tab) ? tab : "overview";

  function handleTabChange(newTab: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (newTab === "overview") {
      params.delete("tab");
    } else {
      params.set("tab", newTab);
    }
    router.push(`${pathname}?${params.toString()}`, { scroll: false });
  }

  return (
    <>
      <PlayerHeader player={player} season={season} seasons={seasons} />

      {/* Tab bar */}
      <div className="flex items-center gap-0 border-b border-gray-200 mb-6">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => handleTabChange(t.key)}
            className={`px-5 py-2.5 text-sm font-medium transition-colors relative ${
              activeTab === t.key
                ? "text-navy"
                : "text-gray-400 hover:text-gray-600"
            }`}
          >
            {t.label}
            {activeTab === t.key && (
              <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-navy rounded-t" />
            )}
          </button>
        ))}
      </div>

      {/* Tab content — placeholders until sub-tasks fill them */}
      {activeTab === "overview" ? (
        <div className="rounded-lg border border-dashed border-gray-300 p-12 text-center text-gray-400">
          <p className="text-lg font-medium mb-1">Overview Tab</p>
          <p className="text-sm">
            {player.player_name} &mdash; {position} &mdash; {season} season
            <br />
            Season stats: {seasonStats.length} record(s) &middot; Weekly stats: {weeklyStats.length} game(s)
            &middot; Peer group: {allPlayers.length} player(s)
          </p>
        </div>
      ) : (
        <div className="rounded-lg border border-dashed border-gray-300 p-12 text-center text-gray-400">
          <p className="text-lg font-medium mb-1">Game Log Tab</p>
          <p className="text-sm">
            {player.player_name} &mdash; {weeklyStats.length} game(s) in {season}
          </p>
        </div>
      )}
    </>
  );
}
