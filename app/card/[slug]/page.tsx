// app/card/[slug]/page.tsx — Shareable stat card page
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getPlayerBySlug } from "@/lib/data/players";
import { getAvailableSeasons, fallbackSeason } from "@/lib/data/queries";
import { getTeam } from "@/lib/data/teams";
import { getCardDataForPlayer, getLatestCardSeason } from "@/lib/data/card";
import { isCardPosition, resolveCardSeason } from "@/lib/stats/tecmo-card";
import type { TecmoCardData } from "@/lib/stats/tecmo-card";
import TecmoPlayerCard from "@/components/player/TecmoPlayerCard";
import CardPageActions from "./CardPageActions";

export const revalidate = 3600;

// -------------------------------------------------------------------
// Metadata
// -------------------------------------------------------------------
export async function generateMetadata({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ season?: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const { season: seasonParam } = await searchParams;
  const player = await getPlayerBySlug(slug);
  const base = process.env.NEXT_PUBLIC_SITE_URL || "https://yardsperpass.com";
  if (!player) {
    return { title: "Player Not Found — Yards Per Pass" };
  }

  const { season, requested } = resolveCardSeason(
    seasonParam,
    await getAvailableSeasons(),
    fallbackSeason(),
  );
  // Keep ?season= so a shared 2025 card canonicalizes to the 2025 card — the
  // bare URL shows whatever the newest season is (and may have no card yet).
  const url = requested != null ? `${base}/card/${slug}?season=${requested}` : `${base}/card/${slug}`;

  // No card for this season (K/P, or no stat row yet): the page renders a
  // "no card" message — keep that out of search results.
  let hasCard = isCardPosition(player.position);
  if (hasCard) {
    try {
      hasCard = (await getCardDataForPlayer(player, season)) != null;
    } catch {
      // Lookup failed — the page itself 404s on this path; leave robots alone.
    }
  }

  return {
    title: `${player.player_name} Stat Card — Yards Per Pass`,
    description: `${player.player_name} advanced performance card with radar chart, percentiles, and league comparisons.`,
    alternates: { canonical: url },
    ...(hasCard ? {} : { robots: { index: false, follow: true } }),
    openGraph: {
      title: `${player.player_name} Stat Card — Yards Per Pass`,
      description: `${player.player_name} advanced stat card with radar chart and league comparisons.`,
      url,
      type: "website",
    },
    twitter: {
      card: "summary_large_image",
      title: `${player.player_name} Stat Card — Yards Per Pass`,
      description: `${player.player_name} advanced stat card with radar chart and league comparisons.`,
    },
  };
}

// -------------------------------------------------------------------
// "No card" message — a real player with nothing to show for this season.
// HTTP 200 + noindex (see generateMetadata) instead of a 404.
// -------------------------------------------------------------------
function NoCardMessage({
  playerName,
  slug,
  position,
  season,
  isCurrentSeason,
  latestSeason,
}: {
  playerName: string;
  slug: string;
  position: string;
  season: number;
  isCurrentSeason: boolean;
  latestSeason: number | null;
}) {
  const cardPosition = isCardPosition(position);
  const heading = !cardPosition
    ? `No stat card for ${playerName}`
    : `No ${season} card${isCurrentSeason ? " yet" : ""} for ${playerName}`;
  const body = !cardPosition
    ? "Stat cards cover quarterbacks, receivers and running backs."
    : isCurrentSeason
      ? `${playerName} has no ${season} stats yet — his team may not have played yet this season, or he hasn't recorded a stat. Cards update the day after each game.`
      : `${playerName} has no stats for the ${season} season.`;

  return (
    <div
      style={{
        minHeight: "100vh",
        backgroundColor: "#f8fafc",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
        fontFamily: "'Inter', system-ui, sans-serif",
      }}
    >
      <div
        data-card-message
        style={{
          maxWidth: 480,
          width: "100%",
          backgroundColor: "#ffffff",
          border: "1px solid #e2e8f0",
          borderRadius: 12,
          padding: "32px 28px",
          textAlign: "center",
        }}
      >
        <h1 style={{ fontSize: 22, fontWeight: 800, color: "#0f172a", margin: 0 }}>{heading}</h1>
        <p style={{ fontSize: 15, color: "#475569", marginTop: 12, lineHeight: 1.5 }}>{body}</p>
        {latestSeason != null && latestSeason !== season && (
          <a
            href={`/card/${slug}?season=${latestSeason}`}
            style={{
              display: "inline-block",
              marginTop: 20,
              padding: "10px 24px",
              fontSize: 14,
              fontWeight: 600,
              backgroundColor: "#0f172a",
              color: "#ffffff",
              borderRadius: 6,
              textDecoration: "none",
            }}
          >
            See his {latestSeason} card &rarr;
          </a>
        )}
        <div style={{ marginTop: 16 }}>
          <a href={`/player/${slug}`} style={{ fontSize: 14, color: "#64748b", textDecoration: "none" }}>
            View full player profile &rarr;
          </a>
        </div>
      </div>
    </div>
  );
}

// -------------------------------------------------------------------
// Page
// -------------------------------------------------------------------
export default async function CardPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ season?: string }>;
}) {
  const { slug } = await params;
  const { season: seasonParam } = await searchParams;
  const player = await getPlayerBySlug(slug);
  if (!player) notFound(); // unknown slug stays a 404

  const seasons = await getAvailableSeasons();
  const { season, invalid } = resolveCardSeason(seasonParam, seasons, fallbackSeason());
  // A season the site has no data for at all (?season=2099, typos) stays a 404.
  if (invalid) notFound();

  const team = getTeam(player.current_team_id);
  const teamName = team?.name || player.current_team_id;

  // Assembly (position branching, stat lookup) is shared with the OG image and
  // the download route — see lib/data/card.ts.
  let card: TecmoCardData | null = null;
  try {
    card = await getCardDataForPlayer(player, season);
  } catch {
    notFound();
  }

  if (!card) {
    // Real player, no card for this season: K/P (never have one), or no stat
    // row yet — e.g. week 1 before his team has played. Explain and link to
    // his newest real card instead of 404ing. The season shown is NOT changed.
    const newest = await getLatestCardSeason(player);
    // Link only to a season the site serves; resolveCardSeason 404s the rest.
    const latestSeason =
      newest != null && (seasons.length === 0 || seasons.includes(newest)) ? newest : null;
    return (
      <NoCardMessage
        playerName={player.player_name}
        slug={slug}
        position={player.position}
        season={season}
        isCurrentSeason={season === (seasons[0] ?? fallbackSeason())}
        latestSeason={latestSeason}
      />
    );
  }

  return (
    <div
      style={{
        minHeight: "100vh",
        backgroundColor: "#f8fafc",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
        fontFamily: "'Inter', system-ui, sans-serif",
      }}
    >
      {/* The card — scrollable wrapper for mobile */}
      <div style={{ maxWidth: "100%", overflowX: "auto", WebkitOverflowScrolling: "touch" }}>
        <TecmoPlayerCard
          data={card}
          teamName={teamName}
          teamId={player.current_team_id}
          primaryColor={team?.primaryColor || "#0f172a"}
          secondaryColor={team?.secondaryColor || "#334155"}
          headshotUrl={player.headshot_url ?? null}
          jerseyNumber={player.jersey_number ?? null}
        />
      </div>

      {/* Actions below the card */}
      <CardPageActions slug={slug} season={season} />

      {/* Link back to player profile */}
      <a
        href={`/player/${slug}`}
        style={{
          marginTop: 12,
          fontSize: 14,
          color: "#64748b",
          textDecoration: "none",
        }}
      >
        View full player profile &rarr;
      </a>
    </div>
  );
}
