// app/card/[slug]/opengraph-image.tsx — minimal stat card OG image
import { ImageResponse } from "next/og";
import { getPlayerBySlug } from "@/lib/data/players";
import { getTeam } from "@/lib/data/teams";

export const runtime = "nodejs";
export const alt = "Player Stat Card — Yards Per Pass";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const interBold = fetch(
  "https://fonts.gstatic.com/s/inter/v18/UcCO3FwrK3iLTeHuS_nVMrMxCp50SjIw2boKoduKmMEVuFuYMZhrib2Bg-4.ttf"
).then((res) => res.arrayBuffer());

// Satori-safe hexagon path (no <polygon>, no .map inside SVG)
const HEX = "M150,30 L254,90 L254,210 L150,270 L46,210 L46,90 Z";

export default async function Image({ params }: { params: { slug: string } }) {
  const fontData = await interBold;
  const player = await getPlayerBySlug(params.slug);
  const team = player ? getTeam(player.current_team_id) : null;
  const teamColor = team?.primaryColor || "#0f172a";
  const playerName = player?.player_name || "Player";
  const subtitle = player
    ? `${player.position}${team ? ` · ${team.name}` : ""}`
    : "";

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: "#ffffff",
          fontFamily: "Inter",
        }}
      >
        {/* Team color bar */}
        <div style={{ width: "100%", height: 6, backgroundColor: teamColor, display: "flex" }} />

        {/* Player name */}
        <div
          style={{
            display: "flex",
            fontSize: 52,
            fontWeight: 800,
            color: "#0f172a",
            marginTop: 32,
            textAlign: "center",
            paddingLeft: 40,
            paddingRight: 40,
          }}
        >
          {playerName}
        </div>

        {/* Subtitle */}
        <div style={{ display: "flex", fontSize: 24, color: "#64748b", marginTop: 8 }}>
          {subtitle}
        </div>

        {/* Single hexagon SVG — testing Satori SVG path rendering */}
        <svg viewBox="0 0 300 300" width="200" height="200" style={{ marginTop: 24 }}>
          <path d={HEX} fill="none" stroke="#e2e8f0" strokeWidth="2" />
          <path d={HEX} fill={`${teamColor}20`} stroke={teamColor} strokeWidth="3" />
        </svg>

        {/* Footer */}
        <div style={{ display: "flex", fontSize: 18, color: "#94a3b8", marginTop: 24 }}>
          yardsperpass.com
        </div>
      </div>
    ),
    {
      ...size,
      fonts: [{ name: "Inter", data: fontData, style: "normal", weight: 800 }],
    }
  );
}
