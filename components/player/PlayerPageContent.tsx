// components/player/PlayerPageContent.tsx
"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import type {
  PlayerSlug,
  QBSeasonStat,
  ReceiverSeasonStat,
  QBWeeklyStat,
  ReceiverWeeklyStat,
  RBWeeklyStat,
  CrossLinkReceiver,
  CrossLinkQB,
  QBPassLocationStat,
} from "@/lib/types";
import PlayerHeader from "./PlayerHeader";
import PlayerOverviewQB from "./PlayerOverviewQB";
import PlayerOverviewWR from "./PlayerOverviewWR";
import PlayerOverviewRB from "./PlayerOverviewRB";
import GameLogTab from "./GameLogTab";
import PlayerFieldHeatMap from "./PlayerFieldHeatMap";

interface PlayerPageContentProps {
  player: PlayerSlug;
  seasonStats: unknown[];
  weeklyStats: unknown[];
  allPlayers: unknown[];
  season: number;
  seasons: number[];
  position: string;
  tab: string;
  crossLinkReceivers?: CrossLinkReceiver[];
  crossLinkQB?: CrossLinkQB | null;
  passLocationStats?: QBPassLocationStat[];
}

const TABS = [
  { key: "overview", label: "Overview" },
  { key: "game-log", label: "Game Log" },
] as const;

const QB_TABS = [
  { key: "overview", label: "Overview" },
  { key: "game-log", label: "Game Log" },
  { key: "field-map", label: "Field Map" },
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
  crossLinkReceivers = [],
  crossLinkQB,
  passLocationStats = [],
}: PlayerPageContentProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const tabs = position === "QB" ? QB_TABS : TABS;
  const activeTab = tabs.some((t) => t.key === tab) ? tab : "overview";

  function handleTabChange(newTab: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (newTab === "overview") {
      params.delete("tab");
    } else {
      params.set("tab", newTab);
    }
    router.push(`${pathname}?${params.toString()}`, { scroll: false });
  }

  // ─── Render Overview tab based on position ──────────────────────────────────

  function renderOverview() {
    if (position === "QB") {
      const qbStats = seasonStats as QBSeasonStat[];
      const stat = qbStats[0];
      if (!stat) {
        return (
          <div className="rounded-lg border border-dashed border-gray-300 p-12 text-center text-gray-400">
            <p className="text-lg font-medium mb-1">No season data</p>
            <p className="text-sm">No QB stats found for {player.player_name} in {season}.</p>
          </div>
        );
      }
      return (
        <PlayerOverviewQB
          stats={stat}
          allQBs={allPlayers as QBSeasonStat[]}
          season={season}
          teamId={player.current_team_id}
          topReceivers={crossLinkReceivers}
        />
      );
    }

    if (position === "WR" || position === "TE") {
      const recStats = seasonStats as ReceiverSeasonStat[];
      const stat = recStats[0];
      if (!stat) {
        return (
          <div className="rounded-lg border border-dashed border-gray-300 p-12 text-center text-gray-400">
            <p className="text-lg font-medium mb-1">No season data</p>
            <p className="text-sm">No receiver stats found for {player.player_name} in {season}.</p>
          </div>
        );
      }
      return (
        <PlayerOverviewWR
          stats={stat}
          allReceivers={allPlayers as ReceiverSeasonStat[]}
          season={season}
          teamId={player.current_team_id}
          teamQBData={crossLinkQB ?? undefined}
        />
      );
    }

    if (position === "RB") {
      const rbWeekly = weeklyStats as RBWeeklyStat[];
      if (rbWeekly.length === 0) {
        return (
          <div className="rounded-lg border border-dashed border-gray-300 p-12 text-center text-gray-400">
            <p className="text-lg font-medium mb-1">No season data</p>
            <p className="text-sm">No RB stats found for {player.player_name} in {season}.</p>
          </div>
        );
      }
      return (
        <PlayerOverviewRB
          weeklyStats={rbWeekly}
          allRBWeekly={allPlayers as RBWeeklyStat[]}
          season={season}
          teamId={player.current_team_id}
          playerName={player.player_name}
        />
      );
    }

    // Fallback for unknown positions
    return (
      <div className="rounded-lg border border-dashed border-gray-300 p-12 text-center text-gray-400">
        <p className="text-lg font-medium mb-1">Overview</p>
        <p className="text-sm">{player.player_name} &mdash; {position} &mdash; {season}</p>
      </div>
    );
  }

  // ─── Render Field Map tab ───────────────────────────────────────────────────

  function renderFieldMap() {
    return (
      <PlayerFieldHeatMap
        stats={passLocationStats}
        playerName={player.player_name}
        season={season}
      />
    );
  }

  // ─── Render Game Log tab ────────────────────────────────────────────────────

  function renderGameLog() {
    // Cast weekly stats based on position
    let typedWeekly: QBWeeklyStat[] | ReceiverWeeklyStat[] | RBWeeklyStat[];
    if (position === "QB") {
      typedWeekly = weeklyStats as QBWeeklyStat[];
    } else if (position === "WR" || position === "TE") {
      typedWeekly = weeklyStats as ReceiverWeeklyStat[];
    } else {
      typedWeekly = weeklyStats as RBWeeklyStat[];
    }

    return (
      <GameLogTab
        weeklyStats={typedWeekly}
        position={position}
        season={season}
        teamId={player.current_team_id}
      />
    );
  }

  return (
    <>
      <PlayerHeader player={player} season={season} seasons={seasons} />

      {/* Tab bar */}
      <div className="flex items-center gap-0 border-b border-gray-200 mb-6">
        {tabs.map((t) => (
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

      {/* Tab content */}
      {activeTab === "overview" ? renderOverview() : activeTab === "field-map" ? renderFieldMap() : renderGameLog()}
    </>
  );
}
