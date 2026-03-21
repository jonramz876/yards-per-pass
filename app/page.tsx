// app/page.tsx
import Link from "next/link";
import { getAvailableSeasons, getDataFreshness, getTeamStats, getQBStats } from "@/lib/data/queries";
import { getReceiverStats } from "@/lib/data/receivers";
import { getPlayerSlugsByIds } from "@/lib/data/players";
import { NFL_TEAMS, DIVISIONS, getTeam } from "@/lib/data/teams";
import type { TeamSeasonStat, PlayerSlug } from "@/lib/types";

export const revalidate = 3600;

/* ------------------------------------------------------------------ */
/*  Slug helper — maps player_id → slug for linking                   */
/* ------------------------------------------------------------------ */
function buildSlugMap(slugs: PlayerSlug[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const s of slugs) m.set(s.player_id, s.slug);
  return m;
}

/* ------------------------------------------------------------------ */
/*  Record helper — maps team_id → "W-L" from team stats              */
/* ------------------------------------------------------------------ */
function buildRecordMap(teams: TeamSeasonStat[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const t of teams) {
    const rec = t.ties > 0 ? `${t.wins}-${t.losses}-${t.ties}` : `${t.wins}-${t.losses}`;
    m.set(t.team_id, rec);
  }
  return m;
}

/* ------------------------------------------------------------------ */
/*  Page component                                                     */
/* ------------------------------------------------------------------ */
export default async function HomePage() {
  let currentSeason = 2025;
  let freshness = null;
  let teamStats: TeamSeasonStat[] = [];
  let qbStats: import("@/lib/types").QBSeasonStat[] = [];
  let receiverStats: import("@/lib/types").ReceiverSeasonStat[] = [];
  let playerSlugs: PlayerSlug[] = [];

  try {
    const seasons = await getAvailableSeasons();
    currentSeason = seasons[0] || 2025;

    [freshness, teamStats, qbStats, receiverStats] = await Promise.all([
      getDataFreshness(currentSeason),
      getTeamStats(currentSeason),
      getQBStats(currentSeason),
      getReceiverStats(currentSeason),
    ]);
  } catch {
    // Data unavailable (e.g., CI build with placeholder credentials) — render with empty data
  }

  const recordMap = buildRecordMap(teamStats);

  // Top 5 QBs by EPA/play (min 100 dropbacks)
  const epaLeaders = [...qbStats]
    .filter((q) => q.dropbacks >= 100 && q.epa_per_play != null)
    .sort((a, b) => (b.epa_per_play ?? 0) - (a.epa_per_play ?? 0))
    .slice(0, 5);

  // Top 5 receivers by receiving yards (min 30 targets)
  const yardLeaders = [...receiverStats]
    .filter((r) => r.targets >= 30)
    .sort((a, b) => b.receiving_yards - a.receiving_yards)
    .slice(0, 5);

  // Top 5 receivers by YPRR (min 50 routes run)
  const yprrLeaders = [...receiverStats]
    .filter((r) => r.routes_run >= 50 && r.yards_per_route_run > 0)
    .sort((a, b) => b.yards_per_route_run - a.yards_per_route_run)
    .slice(0, 5);

  // Fetch only the slugs needed for leaderboard entries (~15 IDs instead of 1200+)
  const leaderPlayerIds = Array.from(new Set([
    ...epaLeaders.map((q) => q.player_id),
    ...yardLeaders.map((r) => r.player_id),
    ...yprrLeaders.map((r) => r.player_id),
  ]));

  try {
    playerSlugs = await getPlayerSlugsByIds(leaderPlayerIds);
  } catch {
    // slug fetch failed — links will fall back to player_id
  }

  const slugMap = buildSlugMap(playerSlugs);

  // Division order: AFC East through NFC West
  const divisionOrder = DIVISIONS;

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

      {/* ---- 2. 32-Team Logo Grid ---- */}
      <section>
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-x-4 gap-y-6">
          {divisionOrder.map((div) => {
            const divTeams = NFL_TEAMS.filter((t) => t.division === div);
            return (
              <div key={div}>
                <h3 className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2 text-center">
                  {div}
                </h3>
                <div className="space-y-2">
                  {divTeams.map((team) => {
                    const record = recordMap.get(team.id);
                    return (
                      <Link
                        key={team.id}
                        href={`/team/${team.id.toLowerCase()}`}
                        title={`${team.name}${record ? ` (${record})` : ""}`}
                        className="flex flex-col items-center gap-1 py-1.5 rounded-lg hover:bg-gray-50 transition-colors"
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={team.logo}
                          alt={team.name}
                          width={40}
                          height={40}
                          className="w-10 h-10 object-contain"
                        />
                        <span className="text-[11px] font-semibold text-navy">
                          {team.abbreviation}
                        </span>
                      </Link>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* ---- 3. Stat Leaderboard Strips ---- */}
      <section className="space-y-6">
        <LeaderStrip
          title="EPA Leaders"
          subtitle="QBs by EPA/Play"
          items={epaLeaders.map((q, i) => ({
            rank: i + 1,
            name: q.player_name,
            slug: slugMap.get(q.player_id),
            teamId: q.team_id,
            value: (q.epa_per_play ?? 0).toFixed(3),
          }))}
        />
        <LeaderStrip
          title="Receiving Leaders"
          subtitle="By Receiving Yards"
          items={yardLeaders.map((r, i) => ({
            rank: i + 1,
            name: r.player_name,
            slug: slugMap.get(r.player_id),
            teamId: r.team_id,
            value: r.receiving_yards.toLocaleString(),
          }))}
        />
        <LeaderStrip
          title="YPRR Leaders"
          subtitle="Yards Per Route Run"
          items={yprrLeaders.map((r, i) => ({
            rank: i + 1,
            name: r.player_name,
            slug: slugMap.get(r.player_id),
            teamId: r.team_id,
            value: r.yards_per_route_run.toFixed(2),
          }))}
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

          return item.slug ? (
            <Link key={item.rank} href={`/player/${item.slug}`}>
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
