// components/player/PlayerHeader.tsx
"use client";

import { Suspense } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import type { PlayerSlug } from "@/lib/types";
import { getTeam, getTeamColor } from "@/lib/data/teams";

interface PlayerHeaderProps {
  player: PlayerSlug;
  season: number;
  seasons: number[];
}

const POSITION_COLORS: Record<string, string> = {
  QB: "bg-blue-100 text-blue-800",
  WR: "bg-emerald-100 text-emerald-800",
  TE: "bg-purple-100 text-purple-800",
  RB: "bg-amber-100 text-amber-800",
};

function SeasonSelector({ seasons, season }: { seasons: number[]; season: number }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function handleChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("season", e.target.value);
    router.push(`${pathname}?${params.toString()}`);
  }

  return (
    <select
      value={season}
      onChange={handleChange}
      className="px-3 py-1.5 text-sm border border-gray-200 rounded-md bg-white text-navy font-medium focus:outline-none focus:ring-2 focus:ring-navy/20"
    >
      {seasons.map((s) => (
        <option key={s} value={s}>
          {s} Season
        </option>
      ))}
    </select>
  );
}

export default function PlayerHeader({ player, season, seasons }: PlayerHeaderProps) {
  const team = getTeam(player.current_team_id);
  const teamColor = getTeamColor(player.current_team_id);
  const posClass = POSITION_COLORS[player.position] || "bg-gray-100 text-gray-800";

  return (
    <div className="rounded-lg border border-gray-200 overflow-hidden mb-6">
      {/* Team-colored accent bar */}
      <div className="h-1.5" style={{ backgroundColor: teamColor }} />

      <div className="p-6 flex flex-col sm:flex-row sm:items-center gap-4">
        {/* Player info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-2xl font-extrabold text-navy tracking-tight">
              {player.player_name}
            </h1>
            <span className={`inline-flex items-center px-2.5 py-0.5 text-xs font-semibold rounded-full ${posClass}`}>
              {player.position}
            </span>
          </div>
          {team && (
            <Link
              href={`/team/${player.current_team_id}`}
              className="inline-flex items-center gap-2 mt-2 text-sm text-gray-500 hover:text-navy transition-colors group"
            >
              <Image
                src={team.logo}
                alt={team.name}
                width={20}
                height={20}
                className="object-contain"
              />
              <span className="group-hover:underline">{team.name}</span>
            </Link>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-3">
          <Link
            href={`/compare?p1=${player.slug}`}
            className="px-3 py-1.5 text-sm font-medium border border-gray-200 rounded-md bg-white text-navy hover:bg-navy hover:text-white transition-colors"
          >
            Compare
          </Link>
          <a
            href={`/api/stat-card/${player.slug}`}
            target="_blank"
            rel="noopener noreferrer"
            className="px-3 py-1.5 text-sm font-medium border border-gray-200 rounded-md bg-white text-navy hover:bg-navy hover:text-white transition-colors"
          >
            Share Card
          </a>
          <Suspense
            fallback={
              <select
                className="px-3 py-1.5 text-sm border border-gray-200 rounded-md bg-white text-navy font-medium"
                disabled
              >
                <option>{season} Season</option>
              </select>
            }
          >
            <SeasonSelector seasons={seasons} season={season} />
          </Suspense>
        </div>
      </div>
    </div>
  );
}
