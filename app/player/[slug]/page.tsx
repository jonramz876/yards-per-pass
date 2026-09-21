// app/player/[slug]/page.tsx
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import { getPlayerBySlug, getQBWeeklyStats, getReceiverWeeklyStats, getRBWeeklyStats, getTeamTopReceivers, getTeamStartingQB, getQBPassLocationStats } from "@/lib/data/players";
import type { GameResultsByTeam, QBPassLocationStat } from "@/lib/types";
import { getQBStats, getAvailableSeasons, fallbackSeason } from "@/lib/data/queries";
import { getGameResults } from "@/lib/data/games";
import { getBoxScoreSeasonsCached } from "@/lib/data/box-score";
import { getReceiverStats } from "@/lib/data/receivers";
import { getRBSeasonStats } from "@/lib/data/rushing";
import { getTeam } from "@/lib/data/teams";
import Breadcrumbs from "@/components/ui/Breadcrumbs";
import PlayerPageContent from "@/components/player/PlayerPageContent";

export const revalidate = 3600;
export const dynamicParams = true;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const player = await getPlayerBySlug(slug);
  const base = process.env.NEXT_PUBLIC_SITE_URL || "https://yardsperpass.com";
  if (!player) {
    return { title: "Player Not Found — Yards Per Pass" };
  }
  return {
    title: `${player.player_name} Stats — ${player.position} | Yards Per Pass`,
    description: `${player.player_name} advanced stats, game log, and performance metrics for the NFL ${player.position}.`,
    alternates: {
      canonical: `${base}/player/${slug}`,
    },
  };
}

function getBreadcrumbs(position: string, playerName: string) {
  switch (position) {
    case "QB":
      return [
        { label: "QB Rankings", href: "/qb-leaderboard" },
        { label: playerName },
      ];
    case "WR":
    case "TE":
      return [
        { label: "Receivers", href: "/receivers" },
        { label: playerName },
      ];
    case "RB":
    case "FB":
      return [
        { label: "Rushing", href: "/rushing" },
        { label: playerName },
      ];
    default:
      return [
        { label: "Home", href: "/" },
        { label: playerName },
      ];
  }
}

export default async function PlayerPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ season?: string; tab?: string }>;
}) {
  const { slug } = await params;
  const { season, tab } = await searchParams;

  // Redirect uppercase slugs to lowercase
  if (slug !== slug.toLowerCase()) {
    const sp = new URLSearchParams();
    if (season) sp.set("season", season);
    if (tab) sp.set("tab", tab);
    const qs = sp.toString();
    redirect(`/player/${slug.toLowerCase()}${qs ? `?${qs}` : ""}`);
  }

  const player = await getPlayerBySlug(slug);
  if (!player) notFound();

  const seasons = await getAvailableSeasons();
  const parsed = season ? parseInt(season) : NaN;
  const currentSeason = Number.isNaN(parsed) ? (seasons[0] || fallbackSeason()) : parsed;

  if (seasons.length === 0) {
    // getAvailableSeasons swallows its own query error and returns [], and the
    // probe below then short-circuits without querying, throwing, or reaching
    // its catch — so the links would vanish with nothing logged at all.
    console.error("Player page: no seasons from data_freshness; Game Log results will not link");
  }

  // Box score links (spec §7) render only for seasons with team_game_stats
  // rows. Started here so the probe overlaps the stat reads below; the handler
  // is attached at once so a rejection is never unhandled. On failure the
  // Game Log simply shows unlinked results (logged), and nothing degraded is
  // cached. This route reads searchParams, so it renders on every request:
  // the probe goes through the hourly memo instead of costing one limit(1)
  // query per covered season per view. A rejection is never memoised.
  //
  // try/catch inside, not .catch() outside: a .catch() hangs off the call's
  // RETURN value, so a throw that happens BEFORE the promise exists escapes it
  // and 500s the whole player hub with nothing logged — safe only by the
  // probe's `async` keyword. The Game Log hit this exact bug in an earlier PR.
  const boxScoreSeasonsPromise = (async (): Promise<number[]> => {
    try {
      return await getBoxScoreSeasonsCached(seasons);
    } catch (err: unknown) {
      console.error(`Player page: box score seasons unavailable for ${slug}; Game Log results will not link`, err);
      return [];
    }
  })();

  // Fetch position-specific data in parallel — catch errors so page doesn't 500
  let seasonStats: unknown[] = [];
  let weeklyStats: unknown[] = [];
  let allPlayers: unknown[] = [];
  let crossLinkReceivers: Awaited<ReturnType<typeof getTeamTopReceivers>> = [];
  let crossLinkQB: Awaited<ReturnType<typeof getTeamStartingQB>> = null;
  let passLocationStats: QBPassLocationStat[] = [];

  try {
    if (player.position === "QB") {
      const [allQBs, weekly, teamReceivers, passLocStats] = await Promise.all([
        getQBStats(currentSeason).catch(() => []),
        getQBWeeklyStats(player.player_id, currentSeason),
        getTeamTopReceivers(player.current_team_id, currentSeason, 5).catch(() => []),
        getQBPassLocationStats(player.player_id, currentSeason).catch(() => []),
      ]);
      const playerSeason = allQBs.filter((qb) => qb.player_id === player.player_id);
      seasonStats = playerSeason;
      weeklyStats = weekly;
      // Full, unfiltered pool — buildQBCardData applies the per-game
      // eligibility rule (QB_MIN_ATT_PER_GAME) internally.
      allPlayers = allQBs;
      crossLinkReceivers = teamReceivers;
      passLocationStats = passLocStats;
    } else if (player.position === "WR" || player.position === "TE") {
      const [allReceivers, weekly, teamQB] = await Promise.all([
        getReceiverStats(currentSeason).catch(() => []),
        getReceiverWeeklyStats(player.player_id, currentSeason),
        getTeamStartingQB(player.current_team_id, currentSeason).catch(() => null),
      ]);
      const playerSeason = allReceivers.filter((r) => r.player_id === player.player_id);
      seasonStats = playerSeason;
      weeklyStats = weekly;
      // Full, unfiltered pool — buildWRCardData applies the per-game
      // eligibility rule (WR_MIN_TGT_PER_GAME) and position matching internally.
      allPlayers = allReceivers;
      crossLinkQB = teamQB;
    } else if (player.position === "RB" || player.position === "FB") {
      // FBs are carried in the RB stat tables.
      const [allRBs, weekly] = await Promise.all([
        getRBSeasonStats(currentSeason).catch(() => []),
        // Weekly rows still power the Game Log tab.
        getRBWeeklyStats(player.player_id, currentSeason),
      ]);
      const playerSeason = allRBs.filter((r) => r.player_id === player.player_id);
      seasonStats = playerSeason;
      weeklyStats = weekly;
      // Full, unfiltered pool — buildRBCardData applies the per-game
      // eligibility rule (RB_MIN_CAR_PER_GAME) internally.
      allPlayers = allRBs;
    }
  } catch {
    // Data fetch failed — page will render with empty data
  }

  // Game Log scores come from `games` (box score spec §9). Look up every team
  // the weekly rows name: a traded player's rows span teams, and
  // player.current_team_id is not the team he played for in past seasons.
  // If this read fails the Game Log falls back to each row's stored score, as
  // before. Awaiting searchParams makes Next render this page per request, so
  // a fallback render is never cached; moving the season into the URL path
  // would change that.
  let gameResults: GameResultsByTeam = {};
  const weeklyTeamIds = Array.from(
    new Set(
      (weeklyStats as { team_id?: unknown }[])
        .map((row) => row?.team_id)
        .filter((id): id is string => typeof id === "string" && id.length > 0)
    )
  );
  if (weeklyTeamIds.length > 0) {
    try {
      gameResults = await getGameResults(weeklyTeamIds, currentSeason);
    } catch (err) {
      // Read failed (rejected or thrown): gameResults stays {} and the Game Log
      // shows each row's stored score. Log it — the fallback is otherwise
      // invisible, and the stored scores are wrong for some games.
      console.error(
        `Game Log: official scores unavailable for ${slug} (${currentSeason}); showing stored scores`,
        err
      );
    }
  }

  const boxScoreSeasons = await boxScoreSeasonsPromise;

  const breadcrumbs = getBreadcrumbs(player.position, player.player_name);

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Person",
    "name": player.player_name,
    "url": `${process.env.NEXT_PUBLIC_SITE_URL || "https://yardsperpass.com"}/player/${player.slug}`,
    "affiliation": {
      "@type": "SportsTeam",
      "name": getTeam(player.current_team_id)?.name || player.current_team_id,
    },
  };

  return (
    <div className="max-w-7xl mx-auto px-6 md:px-12 py-8">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <Breadcrumbs items={breadcrumbs} />
      <Suspense fallback={null}>
        <PlayerPageContent
          player={player}
          seasonStats={seasonStats}
          weeklyStats={weeklyStats}
          allPlayers={allPlayers}
          season={currentSeason}
          seasons={seasons}
          position={player.position}
          tab={tab || "overview"}
          crossLinkReceivers={crossLinkReceivers}
          crossLinkQB={crossLinkQB}
          passLocationStats={passLocationStats}
          gameResults={gameResults}
          boxScoreSeasons={boxScoreSeasons}
        />
      </Suspense>
    </div>
  );
}
