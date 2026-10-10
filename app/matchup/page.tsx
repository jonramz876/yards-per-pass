// app/matchup/page.tsx — the matchup index (team matchup spec 2026-10-10
// §4.2): this week's games as one-tap rows, then two team pickers for any
// other pair. Always the newest stats season. No loading.tsx (see the pair
// page).
import type { Metadata } from "next";
import { NFL_TEAMS } from "@/lib/data/teams";
import { loadMatchupIndex } from "@/lib/data/matchup";
import { MATCHUP_GAMES_UNAVAILABLE, matchupNoUpcomingNote } from "@/lib/stats/matchup";
import MatchupPicker from "@/components/matchup/MatchupPicker";
import MatchupSlate from "@/components/matchup/MatchupSlate";

// BOTH exports stay. They look contradictory; neither may be tidied away (a
// test holds each).
//  - `dynamic = "force-dynamic"`: this page reads no searchParams, so without
//    it it would be a true ISR page, and a render made while the games read
//    was failing ("This week's games are unavailable right now.") would be
//    stored and served for an hour. Rendered per request, it may degrade that
//    one read honestly, as /team does for next season's schedule.
//  - `revalidate = 3600`: the safety net for its Supabase reads. A page with
//    no `revalidate` had its reads kept in Next's data cache for a YEAR
//    (/compare); if force-dynamic does not opt the reads out, the hour bounds
//    them. The loader's one-minute memo bounds them either way.
// Whether Vercel really renders this per request is checked on a preview
// before it is trusted (three requests, x-vercel-cache: MISS each time); if it
// is cached there, the games read becomes a core read that throws.
export const dynamic = "force-dynamic";
export const revalidate = 3600;

const BASE = process.env.NEXT_PUBLIC_SITE_URL || "https://yardsperpass.com";
const DESCRIPTION =
  "This week’s NFL games as team matchups: each offense against the other team’s defense by league rank, with EPA per play, success rate, explosive plays, sacks, stuffs and turnovers. Or pick any two teams.";

export const metadata: Metadata = {
  title: "Team Matchups",
  description: DESCRIPTION,
  alternates: { canonical: `${BASE}/matchup` },
  openGraph: { title: "Team Matchups", description: DESCRIPTION, url: `${BASE}/matchup`, type: "website" },
};

const BARLOW = "font-[family-name:var(--font-barlow)]";
const SECTION = `${BARLOW} m-0 border-b-2 border-navy pb-2 text-[28px] font-bold uppercase leading-none tracking-[0.03em] text-navy`;
const INTRO = "Each offense against the other team’s defense, stat by stat, by league rank.";

export default async function MatchupIndexPage() {
  // The seasons read is core (it rejects: app/matchup/error.tsx). The games
  // read may degrade: slate null with gamesAvailable false.
  const { season, slate, gamesAvailable } = await loadMatchupIndex();
  const teams = NFL_TEAMS.map((t) => ({ id: t.id, name: t.name })).sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div className="mx-auto w-full max-w-7xl min-w-0 px-3 py-6 md:px-6">
      <h1 className={`${BARLOW} m-0 text-[40px] font-bold leading-none tracking-[0.02em] text-navy md:text-[52px]`}>TEAM MATCHUPS</h1>
      <p className="m-0 mt-2 text-[14px] text-slate-600">{INTRO}</p>

      <div className="mt-7">
        {slate ? (
          <MatchupSlate label={slate.label} games={slate.games} />
        ) : (
          <p data-slate-note className="m-0 border border-slate-200 bg-white px-4 py-3 text-[14px] text-slate-700">
            {gamesAvailable ? matchupNoUpcomingNote(season) : MATCHUP_GAMES_UNAVAILABLE}
          </p>
        )}
      </div>

      <section className="mt-9">
        <h2 className={SECTION}>Any two teams</h2>
        <div className="mt-4 max-w-3xl">
          <MatchupPicker teams={teams} />
        </div>
      </section>
    </div>
  );
}
