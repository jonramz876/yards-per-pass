// app/game/[game_id]/page.tsx — one game's box score (box score spec §6).
// Address: nflverse's id, /game/2026_01_BUF_HOU (season, week, away, home).
// Generated on demand and revalidated hourly (no generateStaticParams: the id
// list would need a database read at build time, and a Supabase blip would
// then fail every build). /api/revalidate refreshes /game after each ingest.
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getBoxScore, normalizeGameId, type BoxScoreData } from "@/lib/data/box-score";
import { hasNoDatabase } from "@/lib/supabase/server";
import { getTeam } from "@/lib/data/teams";
import {
  LEGEND_TEXT,
  STRIP_SACK_NOTE,
  buildComparison,
  buildPassingTable,
  buildReceivingTable,
  buildRushingTable,
  buildScoreboard,
  playCountNote,
  receivingNote,
} from "@/lib/stats/box-score";
import Scoreboard from "@/components/game/Scoreboard";
import ComparisonSection from "@/components/game/ComparisonSection";
import PlayerTable from "@/components/game/PlayerTable";
import GameMessage from "@/components/game/GameMessage";

export const revalidate = 3600;

/**
 * Load the page's data. A real database error must never become a cached
 * empty page: rethrowing keeps ISR serving the last good copy (a cold miss
 * gets error.tsx) — the homepage's rule. Only the placeholder build has no
 * database (hasNoDatabase), and then the game simply isn't there. Do not add
 * an in-render retry: ISR already keeps the last good copy and error.tsx
 * covers a cold miss, so a retry would only delay both.
 *
 * What is known about the cost: generateMetadata and the page component each
 * call this, so the read runs twice per render. Whether Next 14's per-render
 * fetch memo collapses the Supabase GETs underneath has not been measured —
 * assume two trips per render until someone counts the PostgREST requests for
 * one page. React's cache() would collapse the two and is deliberately not
 * used: it ships only on the react-server build, so it makes the route
 * impossible to load under vitest. app/player/[slug]/page.tsx loads its
 * player the same way.
 */
async function loadBoxScore(rawId: string): Promise<BoxScoreData> {
  const gameId = normalizeGameId(rawId);
  if (!gameId) return { state: "not-found" };
  try {
    return await getBoxScore(gameId);
  } catch (err) {
    if (!hasNoDatabase()) {
      if (err instanceof Error) throw err;
      const m = (err as { message?: unknown } | null)?.message;
      throw new Error(`Box score data unavailable: ${typeof m === "string" ? m : JSON.stringify(err)}`);
    }
    return { state: "not-found" };
  }
}

function teamName(id: string): string {
  return getTeam(id)?.name ?? id;
}

function nickname(id: string): string {
  return teamName(id).split(" ").pop() ?? id;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ game_id: string }>;
}): Promise<Metadata> {
  const { game_id } = await params;
  const data = await loadBoxScore(game_id);
  if (data.state === "not-found" || data.state === "unplayed") {
    // The root layout's template appends " — Yards Per Pass" again, so this tab
    // double-suffixes. Every other route does the same (player, team, card);
    // keep it consistent here and fix all four together or not at all.
    return { title: "Game Not Found — Yards Per Pass" };
  }
  const base = process.env.NEXT_PUBLIC_SITE_URL || "https://yardsperpass.com";
  const g = data.game;
  // Winner first, as a headline reads; the away team first in a tie.
  const homeFirst = g.home_score > g.away_score;
  const first = homeFirst ? `${nickname(g.home_team)} ${g.home_score}` : `${nickname(g.away_team)} ${g.away_score}`;
  const second = homeFirst ? `${nickname(g.away_team)} ${g.away_score}` : `${nickname(g.home_team)} ${g.home_score}`;
  // getGame runs the column through normalizeGameType (lib/stats/box-score.ts),
  // so game_type is already trimmed, upper case, and "REG" when it was blank —
  // the same one rule getBoxScore, gameLabel and both link gates read it by.
  // The `||` stays as a belt for a hand-built GameRecord: a blank here would
  // otherwise double-space the title.
  const when = (g.game_type === "REG" ? "" : g.game_type) || `Week ${g.week}`;
  return {
    // The root layout's title template appends " — Yards Per Pass".
    title: `${first}, ${second} — ${g.season} ${when} box score`,
    description: `${teamName(g.away_team)} at ${teamName(g.home_team)}, ${g.season} ${when}: EPA per play, success rate, explosive plays and the official box score, with every passer, rusher and receiver.`,
    alternates: { canonical: `${base}/game/${g.game_id}` },
    // A game that will never get a box score here (2020–2025 until the
    // backfill, playoffs) is a 200 message page: keep it out of search results.
    ...(data.state === "uncovered" ? { robots: { index: false, follow: true } } : {}),
  };
}

export default async function GamePage({ params }: { params: Promise<{ game_id: string }> }) {
  const { game_id } = await params;
  const data = await loadBoxScore(game_id);
  // Unknown ids and games without a final score have no page (spec §6).
  if (data.state === "not-found" || data.state === "unplayed") notFound();

  // No `today` argument: the date label's year suffix is decided against
  // render-time "now", so a page cached across New Year can omit the year for
  // an hour. Harmless at revalidate = 3600 — deliberate, do not "fix" it.
  const scoreboard = buildScoreboard(data.game, data.records.away, data.records.home);
  const awayId = data.game.away_team;
  const homeId = data.game.home_team;
  const teamLinks = [
    { href: `/team/${awayId}`, label: teamName(awayId) },
    { href: `/team/${homeId}`, label: teamName(homeId) },
  ];

  let body: React.ReactNode;
  if (data.state === "uncovered" && data.reason === "season") {
    body = (
      <GameMessage
        kind="uncovered"
        heading={
          data.firstSeason === null
            ? "Box scores aren’t available for this season"
            : `Box scores start with the ${data.firstSeason} season`
        }
        body={"Team stats and player lines for earlier games aren’t available yet."}
        links={teamLinks}
      />
    );
  } else if (data.state === "uncovered") {
    body = (
      <GameMessage
        kind="uncovered"
        heading="Box scores cover regular-season games for now"
        body={"Playoff games don’t have team stats or player lines here yet."}
        links={teamLinks}
      />
    );
  } else if (data.state === "pending") {
    body = (
      <GameMessage
        kind="pending"
        heading="Stats arrive once play-by-play is published"
        body={"That’s usually within a few hours of the final whistle."}
      />
    );
  } else {
    const sections = buildComparison(data.away, data.home);
    const notes: Record<string, React.ReactNode> = {
      "team-stats": (
        <>
          <b className="font-semibold text-slate-700">Why the play counts differ.</b> {playCountNote(data.away, data.home)}
        </>
      ),
      cost: STRIP_SACK_NOTE,
    };
    const teamTargets = { [awayId]: data.away.team_targets, [homeId]: data.home.team_targets };
    body = (
      <>
        <p className="-mt-1 px-0.5 text-xs text-gray-500">
          <span className="rounded-sm px-1.5 py-px font-bold" style={{ background: "#ecfdf5", color: "#065f46" }}>
            Shaded
          </span>{" "}
          {LEGEND_TEXT}
        </p>
        {sections.map((section) => (
          <ComparisonSection
            key={section.key}
            section={section}
            awayId={awayId}
            homeId={homeId}
            footnote={notes[section.key]}
          />
        ))}
        <PlayerTable model={buildPassingTable(data.lines, awayId, homeId)} />
        <PlayerTable model={buildRushingTable(data.lines, awayId, homeId)} />
        <PlayerTable
          model={buildReceivingTable(data.lines, awayId, homeId, teamTargets)}
          footnote={
            <>
              <b className="font-semibold text-slate-700">{"Player lines won’t always add up to team totals."}</b>{" "}
              {receivingNote(data.lines, awayId, homeId)}
            </>
          }
        />
      </>
    );
  }

  return (
    <div className="mx-auto max-w-[860px] space-y-5 px-4 py-6 md:px-12 md:py-8">
      <Scoreboard model={scoreboard} />
      {body}
    </div>
  );
}
