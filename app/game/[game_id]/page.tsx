// app/game/[game_id]/page.tsx — one game's box score (box score spec §6).
// Address: nflverse's id, /game/2026_01_BUF_HOU (season, week, away, home).
// Generated on demand and revalidated hourly (no generateStaticParams: the id
// list would need a database read at build time, and a Supabase blip would
// then fail every build). /api/revalidate refreshes /game after each ingest.
//
// Deliberately NO loading.tsx on this route, and none may be added above
// /game either — unlike app/team/[team_id] and app/player/[slug], which both
// ship one. A loading boundary streams the shell before this page's own read
// finishes, so the addresses that must answer 404 (an id that fails
// GAME_ID_PATTERN, a game the `games` table does not have, a game with no
// final score, and a row whose home_team equals its away_team) would be
// served as streamed 200s with the not-found body swapped in underneath. The
// cost of leaving it out is a blank document until TTFB on a cold ISR miss —
// the right trade for a route whose job includes refusing addresses that have
// no page (spec §7).
import type { Metadata } from "next";
import { notFound } from "next/navigation";
// normalizeGameId comes from the pure module, not from this page's other
// data-layer import: lib/data/box-score.ts only re-exports it, and the whole
// point of defining it in lib/stats/box-score.ts is that asking "can this id
// have a page?" must never drag in the Supabase server client. Importing it
// from the data layer here is the line a future "use client" gate would copy.
import { getBoxScore, getBoxScoreMeta, type BoxScoreData, type BoxScoreMeta } from "@/lib/data/box-score";
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
  normalizeGameId,
  playCountNote,
  receivingNote,
} from "@/lib/stats/box-score";
import Scoreboard from "@/components/game/Scoreboard";
import ComparisonSection from "@/components/game/ComparisonSection";
import PlayerTable from "@/components/game/PlayerTable";
import GameMessage from "@/components/game/GameMessage";

export const revalidate = 3600;

/**
 * Load the page's data. A real database error must never become a cached empty
 * page: rethrowing fails the render instead, and a failed render is never
 * cached — the homepage's rule. What happens next was measured on the deployed
 * site (2026-09-21), and the answer is that nothing is cached at all: three
 * consecutive requests to /game/2026_01_BUF_HOU each returned
 * `x-vercel-cache: MISS` with `cache-control: private, no-cache, no-store,
 * max-age=0, must-revalidate` and `age: 0`. So `revalidate = 3600` above buys
 * nothing today, there is no stale copy to fall back on, and a failed read
 * means this visitor gets error.tsx — which is still the right trade, because
 * the alternative is showing numbers we cannot stand behind. If the page ever
 * needs to be cheap or resilient, making it genuinely cacheable is the fix,
 * and the first thing to check is what opts it out of the full route cache
 * (supabase-js sends its reads with `cache: "no-store"`, and the reads now
 * carry an AbortSignal, either of which forces dynamic rendering).
 * Only the placeholder build has no database (hasNoDatabase), and
 * then the game simply isn't there. Do not add an in-render retry: error.tsx
 * already covers the failure, so a retry would only delay it.
 *
 * What the reads cost: getBoxScore is 8 PostgREST requests in 4 serial waves
 * for a `ready` game — the games row; then both schedules and team_game_stats;
 * then the three weekly tables; then player_slugs — not "one trip".
 * generateMetadata no longer runs it: loadBoxScoreMeta below is 1–2 requests,
 * so a page view is one pass of that chain plus two, where it used to be two
 * passes of it. React's cache() would collapse repeats and is deliberately not
 * used: it ships only on the react-server build, so it makes the route
 * impossible to load under vitest. app/player/[slug]/page.tsx loads its player
 * the same way.
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

/** loadBoxScore's metadata twin: the same rethrow rule over the cheap read. */
async function loadBoxScoreMeta(rawId: string): Promise<BoxScoreMeta> {
  const gameId = normalizeGameId(rawId);
  if (!gameId) return { game: null, ready: false };
  try {
    return await getBoxScoreMeta(gameId);
  } catch (err) {
    if (!hasNoDatabase()) {
      if (err instanceof Error) throw err;
      const m = (err as { message?: unknown } | null)?.message;
      throw new Error(`Box score data unavailable: ${typeof m === "string" ? m : JSON.stringify(err)}`);
    }
    return { game: null, ready: false };
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
  // The cheap path: the `games` row and one yes/no, not the whole assembly.
  const { game: g, ready } = await loadBoxScoreMeta(game_id);
  if (!g) {
    // The root layout's template appends " — Yards Per Pass" again, so this tab
    // double-suffixes. Every other route does the same (player, team, card);
    // keep it consistent here and fix all four together or not at all.
    return { title: "Game Not Found — Yards Per Pass" };
  }
  const base = process.env.NEXT_PUBLIC_SITE_URL || "https://yardsperpass.com";
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
    // Every state that is a 200 message page rather than a box score stays out
    // of search results: a season the backfill has not reached, a playoff game,
    // AND a game whose rows are not written yet. `pending` is included
    // deliberately — it is a game that went final hours ago, both link gates
    // already point at it, so about 16 thin "stats arrive shortly" pages went
    // live to crawlers every Sunday night on the URLs that hold the real box
    // score hours later. Thin near-duplicate content on a brand-new URL is
    // exactly what gets demoted, and the demotion sticks to the URL. `follow`
    // plus a re-crawl is what "it will have content later" is for.
    ...(ready ? {} : { robots: { index: false, follow: true } }),
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
    // playCountNote is "" for a game whose counts all match (a kneel and a
    // penalty-wiped snap cancel out): the bold lead goes with it rather than
    // standing over nothing. ComparisonSection drops a falsy footnote.
    const playNote = playCountNote(data.away, data.home);
    const notes: Record<string, React.ReactNode> = {
      ...(playNote
        ? {
            "team-stats": (
              <>
                <b className="font-semibold text-slate-700">Why the play counts differ.</b> {playNote}
              </>
            ),
          }
        : {}),
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
