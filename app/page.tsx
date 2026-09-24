// app/page.tsx
import Link from "next/link";
import { getAvailableSeasons, getDataFreshness, getTeamStats, getQBStats, fallbackSeason } from "@/lib/data/queries";
import { getReceiverStats } from "@/lib/data/receivers";
import { getRBSeasonStats } from "@/lib/data/rushing";
import { getPlayerSlugsByIds } from "@/lib/data/players";
import { hasScheduleForSeason } from "@/lib/data/games";
import { hasNoDatabase } from "@/lib/supabase/server";
import { getTeam } from "@/lib/data/teams";
import TecmoStandings from "@/components/team/TecmoStandings";
import type { TeamSeasonStat, PlayerSlug, ReceiverSeasonStat } from "@/lib/types";

export const revalidate = 3600;

/* ------------------------------------------------------------------ */
/*  Leader qualifiers — PFR's per-team-game minimums                   */
/* ------------------------------------------------------------------ */
// The rates the leaderboard pages use (components/tables/QBLeaderboard.tsx
// PFR_ATT_PER_GAME, RBLeaderboard.tsx PFR_CAR_PER_GAME, ReceiverLeaderboard.tsx
// PFR_TGT_PER_GAME) and the glossary's "pfr-qualified" entry
// (app/glossary/page.tsx): per team game, times min(through_week, 17).
// Copied, not imported: the leaderboards are "use client" modules, so a value
// imported here would be a client-reference proxy and every minimum NaN in
// production (vitest skips that transform, so tests would still pass). Not
// lib/stats/tecmo-card.ts's *_MIN_*_PER_GAME either: that is a per-player-game
// OVR rule. __tests__/app/home-page.test.tsx fails if the leaderboards' rates
// change. Module-private on purpose: Next 14 rejects extra page exports.
const PFR_ATT_PER_GAME = 14;
const PFR_CAR_PER_GAME = 6.25;
const PFR_TGT_PER_GAME = 1.875;

/* ------------------------------------------------------------------ */
/*  Slug helper — maps player_id → slug for linking                   */
/* ------------------------------------------------------------------ */
function buildSlugMap(slugs: PlayerSlug[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const s of slugs) m.set(s.player_id, s.slug);
  return m;
}

/* ------------------------------------------------------------------ */
/*  Page component                                                     */
/* ------------------------------------------------------------------ */
export default async function HomePage() {
  let currentSeason = fallbackSeason();
  let freshness = null;
  let teamStats: TeamSeasonStat[] = [];
  let qbStats: import("@/lib/types").QBSeasonStat[] = [];
  let receiverStats: import("@/lib/types").ReceiverSeasonStat[] = [];
  let rbStats: import("@/lib/types").RBSeasonStat[] = [];
  let playerSlugs: PlayerSlug[] = [];

  try {
    const seasons = await getAvailableSeasons();
    // getAvailableSeasons and getDataFreshness return []/null on a query error
    // instead of throwing. A real database always has data_freshness rows (one
    // per season, upserted, never deleted), so empty here means the read failed.
    if (seasons.length === 0) {
      throw new Error("Homepage: no seasons from data_freshness (query failed or table empty)");
    }
    currentSeason = seasons[0] || fallbackSeason();

    [freshness, teamStats, qbStats, receiverStats, rbStats] = await Promise.all([
      getDataFreshness(currentSeason),
      getTeamStats(currentSeason),
      getQBStats(currentSeason),
      getReceiverStats(currentSeason),
      getRBSeasonStats(currentSeason),
    ]);
    if (!freshness) {
      throw new Error(`Homepage: no data_freshness row for ${currentSeason} (query failed)`);
    }
  } catch (err) {
    if (!hasNoDatabase()) {
      // Real database error: never render (and cache) an empty homepage.
      // Throwing keeps ISR serving the last good copy and retrying in ~30s;
      // during `next build` it fails the deploy, so the previous one stays live.
      // Do not add an in-render retry: Next 14 replays identical fetches from a
      // per-render memo, failures included (next/dist/server/lib/dedupe-fetch.js).
      if (err instanceof Error) throw err;
      // fetchAllRows throws the raw PostgREST error object — wrap it for the logs.
      const m = (err as { message?: unknown } | null)?.message;
      throw new Error(`Homepage data unavailable: ${typeof m === "string" ? m : JSON.stringify(err)}`);
    }
    // No database (CI / local placeholder build) — render with empty data
  }

  // Standings season: once the league publishes next season's schedule, the
  // board flips to it (every team 0-0 until week 1 lands, which is the correct
  // pre-season answer). Otherwise it stays on the latest stats season, which
  // through the offseason means the completed season's final standings.
  // `teamStats` is reused unless the seasons differ — it feeds the strips below
  // and must keep pointing at `currentSeason`.
  let standingsSeason = currentSeason;
  let standingsStats: TeamSeasonStat[] = teamStats;
  try {
    if (await hasScheduleForSeason(currentSeason + 1)) {
      standingsSeason = currentSeason + 1;
      standingsStats = await getTeamStats(standingsSeason).catch(() => []);
    }
  } catch {
    // Probe failed (placeholder credentials, table missing) — the latest stats
    // season stands in.
  }

  // Player strips qualify like the leaderboard pages: round(rate × team games),
  // team games = min(through_week, 17). A missing, 0 or non-numeric
  // through_week counts as one game, so a minimum is never 0.
  const tw = freshness?.through_week;
  const teamGames = typeof tw === "number" && Number.isFinite(tw) ? Math.min(Math.max(tw, 1), 17) : 1;
  const minAttempts = Math.round(PFR_ATT_PER_GAME * teamGames);
  const minCarries = Math.round(PFR_CAR_PER_GAME * teamGames);
  const minTargets = Math.round(PFR_TGT_PER_GAME * teamGames);
  // Every numeric filter uses Number.isFinite: a rate can arrive as null
  // (stored NaN) or Infinity, and Number.isFinite rejects those and strings.

  // Strip 1: QB Efficiency — top 5 by EPA/play among QBs with >= minAttempts attempts
  const epaLeaders = [...qbStats]
    .filter((q) => Number.isFinite(q.attempts) && q.attempts >= minAttempts && Number.isFinite(q.epa_per_play))
    .sort((a, b) => (b.epa_per_play ?? 0) - (a.epa_per_play ?? 0))
    .slice(0, 5);

  // Strip 2: QB Accuracy — top 5 by CPOE, same attempts qualifier
  const cpoeLeaders = [...qbStats]
    .filter((q) => Number.isFinite(q.attempts) && q.attempts >= minAttempts && Number.isFinite(q.cpoe))
    .sort((a, b) => (b.cpoe ?? 0) - (a.cpoe ?? 0))
    .slice(0, 5);

  // Strip 3: Receiving Efficiency — top 5 among receivers with >= minTargets
  // targets, by Yards Per Route Run when the season has route data, otherwise by
  // EPA per Target (the Receiver page's default ranking). Decided once for the
  // season, never per player, so the strip never mixes two metrics. Route data
  // counts only when >= 90% of the target-qualified pool has routes_run > 0, so
  // a partial participation file does not rank just the teams it covers.
  // (nflverse publishes no participation feed for 2026: routes_run is null.)
  const targetQualified = receiverStats.filter((r) => Number.isFinite(r.targets) && r.targets >= minTargets);
  const withRoutes = targetQualified.filter((r) => Number.isFinite(r.routes_run) && r.routes_run > 0).length;
  const hasRouteData = targetQualified.length > 0 && withRoutes * 10 >= targetQualified.length * 9;
  const recValue = (r: ReceiverSeasonStat) => (hasRouteData ? r.yards_per_route_run : r.epa_per_target);
  const recLeaders = targetQualified
    .filter((r) => Number.isFinite(recValue(r)) && (!hasRouteData || recValue(r) > 0))
    .sort((a, b) => recValue(b) - recValue(a))
    .slice(0, 5);

  // Strip 4: Rushing Efficiency — top 5 by EPA/carry among backs with >= minCarries carries
  const rushEpaLeaders = [...rbStats]
    .filter((rb) => Number.isFinite(rb.carries) && rb.carries >= minCarries && Number.isFinite(rb.epa_per_carry))
    .sort((a, b) => (b.epa_per_carry ?? 0) - (a.epa_per_carry ?? 0))
    .slice(0, 5);

  // Strip 5: Team Defense — top 5 by defensive EPA (lower = better, so sort ascending)
  const defLeaders = [...teamStats]
    .filter((t) => t.def_epa_play != null)
    .sort((a, b) => (a.def_epa_play ?? 0) - (b.def_epa_play ?? 0))
    .slice(0, 5);

  // Fetch only the slugs needed for player leaderboard entries
  const leaderPlayerIds = Array.from(new Set([
    ...epaLeaders.map((q) => q.player_id),
    ...cpoeLeaders.map((q) => q.player_id),
    ...recLeaders.map((r) => r.player_id),
    ...rushEpaLeaders.map((rb) => rb.player_id),
  ]));

  try {
    playerSlugs = await getPlayerSlugsByIds(leaderPlayerIds);
  } catch {
    // slug fetch failed — links will fall back to player_id
  }

  const slugMap = buildSlugMap(playerSlugs);

  return (
    <div className="max-w-7xl mx-auto px-6 md:px-12 py-8 space-y-10">
      {/* ---- 1. Compact Hero ---- */}
      <section className="text-center space-y-2">
        <h1 className="text-3xl md:text-5xl font-extrabold text-navy tracking-tight">
          Yards Per Pass
        </h1>
        <p className="text-base text-gray-500">
          NFL analytics powered by nflverse play-by-play data
        </p>
        {freshness && (
          <p className="text-xs text-gray-400">
            Updated{" "}
            {new Date(freshness.last_updated).toLocaleDateString("en-US", {
              month: "short",
              day: "numeric",
            })}
            {" \u00b7 "}Through Week {freshness.through_week}
            {" \u00b7 "}{freshness.season} Season
          </p>
        )}
      </section>

      {/* ---- 2. Standings Board (Tecmo) ---- */}
      <TecmoStandings season={standingsSeason} teamStats={standingsStats} />

      {/* ---- 3. Stat Leaderboard Strips ---- */}
      <section className="space-y-6">
        <LeaderStrip
          title="QB Efficiency"
          subtitle="EPA per Play"
          items={epaLeaders.map((q, i) => ({
            rank: i + 1,
            name: q.player_name,
            slug: slugMap.get(q.player_id),
            teamId: q.team_id,
            value: (q.epa_per_play ?? 0).toFixed(3),
          }))}
        />
        <LeaderStrip
          title="QB Accuracy"
          subtitle="Completion % Over Expected"
          items={cpoeLeaders.map((q, i) => ({
            rank: i + 1,
            name: q.player_name,
            slug: slugMap.get(q.player_id),
            teamId: q.team_id,
            value: (q.cpoe ?? 0) >= 0 ? `+${(q.cpoe ?? 0).toFixed(1)}` : (q.cpoe ?? 0).toFixed(1),
          }))}
        />
        <LeaderStrip
          title="Receiving Efficiency"
          subtitle={hasRouteData ? "Yards Per Route Run" : "EPA per Target"}
          items={recLeaders.map((r, i) => ({
            rank: i + 1,
            name: r.player_name,
            slug: slugMap.get(r.player_id),
            teamId: r.team_id,
            value: recValue(r).toFixed(2),
          }))}
        />
        <LeaderStrip
          title="Rushing Efficiency"
          subtitle="EPA per Carry"
          items={rushEpaLeaders.map((rb, i) => ({
            rank: i + 1,
            name: rb.player_name,
            slug: slugMap.get(rb.player_id),
            teamId: rb.team_id,
            value: (rb.epa_per_carry ?? 0).toFixed(3),
          }))}
        />
        <LeaderStrip
          title="Team Defense"
          subtitle="Defensive EPA/Play (lower = better)"
          items={defLeaders.map((t, i) => {
            const team = getTeam(t.team_id);
            return {
              rank: i + 1,
              name: team?.name ?? t.team_id,
              href: `/team/${t.team_id}`,
              teamId: t.team_id,
              value: (t.def_epa_play ?? 0).toFixed(3),
            };
          })}
        />
      </section>

      {/* ---- 4. Feature Cards Row ---- */}
      <section className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <FeatureCard
          title="Team Tiers"
          description="Offensive & defensive EPA for all 32 teams."
          href="/teams"
        />
        <FeatureCard
          title="QB Rankings"
          description="EPA, CPOE, success rate, and 10+ metrics."
          href="/qb-leaderboard"
        />
        <FeatureCard
          title="Receiver Rankings"
          description="YPRR, target share, YAC, and more."
          href="/receivers"
        />
        <FeatureCard
          title="Run Gap Analysis"
          description="Rushing EPA by offensive line gap."
          href="/run-gaps"
        />
      </section>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  LeaderStrip component                                              */
/* ------------------------------------------------------------------ */
interface LeaderItem {
  rank: number;
  name: string;
  slug?: string;
  href?: string; // override link (for team entries that go to /team/[id] instead of /player/[slug])
  teamId: string;
  value: string;
}

function LeaderStrip({
  title,
  subtitle,
  items,
}: {
  title: string;
  subtitle: string;
  items: LeaderItem[];
}) {
  return (
    <div>
      <div className="flex items-baseline gap-2 mb-3">
        <h2 className="text-sm font-bold text-navy uppercase tracking-wide">{title}</h2>
        <span className="text-xs text-gray-400">{subtitle}</span>
      </div>
      <div className="flex gap-3 overflow-x-auto pb-1">
        {items.map((item) => {
          const team = getTeam(item.teamId);
          const card = (
            <div className="flex items-center gap-3 bg-white rounded-xl border border-gray-100 px-4 py-3 min-w-[200px] flex-shrink-0 hover:shadow-md transition-shadow">
              <span className="text-lg font-extrabold text-gray-300 w-6 text-right">
                {item.rank}
              </span>
              {team && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={team.logo}
                  alt={team.abbreviation}
                  width={28}
                  height={28}
                  className="w-7 h-7 object-contain"
                />
              )}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-navy truncate">{item.name}</p>
                <p className="text-[11px] text-gray-400">{item.teamId}</p>
              </div>
              <span className="text-sm font-bold text-navy tabular-nums">{item.value}</span>
            </div>
          );

          const linkHref = item.href || (item.slug ? `/player/${item.slug}` : null);
          return linkHref ? (
            <Link key={item.rank} href={linkHref}>
              {card}
            </Link>
          ) : (
            <div key={item.rank}>{card}</div>
          );
        })}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  FeatureCard component                                              */
/* ------------------------------------------------------------------ */
function FeatureCard({
  title,
  description,
  href,
}: {
  title: string;
  description: string;
  href: string;
}) {
  return (
    <Link
      href={href}
      className="bg-white p-5 rounded-xl border border-gray-100 hover:border-navy/30 hover:shadow-md transition-all"
    >
      <h3 className="text-sm font-bold text-navy mb-1">{title}</h3>
      <p className="text-xs text-gray-500 leading-relaxed">{description}</p>
    </Link>
  );
}
