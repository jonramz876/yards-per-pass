// app/card/[slug]/page.tsx — Shareable stat card page
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getPlayerBySlug } from "@/lib/data/players";
import { getAvailableSeasons, fallbackSeason } from "@/lib/data/queries";
import { getTeam } from "@/lib/data/teams";
import { getCardDataForPlayer } from "@/lib/data/card";
import type { TecmoCardData } from "@/lib/stats/tecmo-card";
import TecmoPlayerCard from "@/components/player/TecmoPlayerCard";
import CardPageActions from "./CardPageActions";

export const revalidate = 3600;

// -------------------------------------------------------------------
// Metadata
// -------------------------------------------------------------------
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
    title: `${player.player_name} Stat Card — Yards Per Pass`,
    description: `${player.player_name} advanced performance card with radar chart, percentiles, and league comparisons.`,
    alternates: { canonical: `${base}/card/${slug}` },
    openGraph: {
      title: `${player.player_name} Stat Card — Yards Per Pass`,
      description: `${player.player_name} advanced stat card with radar chart and league comparisons.`,
      url: `${base}/card/${slug}`,
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
  if (!player) notFound();

  const seasons = await getAvailableSeasons();
  const parsed = seasonParam ? parseInt(seasonParam, 10) : NaN;
  const season = Number.isNaN(parsed) ? (seasons[0] ?? fallbackSeason()) : parsed;

  const team = getTeam(player.current_team_id);
  const teamName = team?.name || player.current_team_id;

  // Assembly (position branching, stat lookup) is shared with the OG image and
  // the download route — see lib/stats/tecmo-card.ts.
  let card: TecmoCardData | null = null;
  try {
    card = await getCardDataForPlayer(player, season);
  } catch {
    notFound();
  }

  if (!card) notFound();

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
