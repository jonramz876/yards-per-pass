// app/card/[slug]/opengraph-image.tsx — stat card: data + text, no SVG
import { ImageResponse } from "next/og";
import { getPlayerBySlug } from "@/lib/data/players";
import { getTeam } from "@/lib/data/teams";
import { createServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const alt = "Player Stat Card — Yards Per Pass";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const interBold = fetch(
  "https://fonts.gstatic.com/s/inter/v18/UcCO3FwrK3iLTeHuS_nVMrMxCp50SjIw2boKoduKmMEVuFuYMZhrib2Bg-4.ttf"
).then((res) => res.arrayBuffer());

export default async function Image({ params }: { params: { slug: string } }) {
  const fontData = await interBold;
  const player = await getPlayerBySlug(params.slug);
  const team = player ? getTeam(player.current_team_id) : null;
  const tc = team?.primaryColor || "#0f172a";
  const name = player?.player_name || "Player";
  const pos = player?.position || "";

  // Fetch stats — same Supabase client that getPlayerBySlug uses
  let line1 = "";
  let line2 = "";
  if (player) {
    try {
      const sb = createServerClient();
      const isQB = pos === "QB";
      const isRB = pos === "RB" || pos === "FB";
      const tbl = isQB ? "qb_season_stats" : isRB ? "rb_season_stats" : "receiver_season_stats";
      const { data } = await sb.from(tbl).select("*").eq("player_id", player.player_id).eq("season", 2025).single();
      if (data) {
        const s = data as Record<string, unknown>;
        const n = (k: string) => { const v = s[k]; return typeof v === "number" ? v : NaN; };
        if (isQB) {
          line1 = `EPA/DB: ${n("epa_per_db").toFixed(2)}  |  CPOE: ${(n("cpoe") >= 0 ? "+" : "")}${n("cpoe").toFixed(1)}  |  Rating: ${n("passer_rating").toFixed(1)}`;
          line2 = `Yards: ${Math.round(n("passing_yards")).toLocaleString()}  |  TD: ${Math.round(n("touchdowns"))}  |  INT: ${Math.round(n("interceptions"))}`;
        } else if (isRB) {
          line1 = `EPA/Car: ${n("epa_per_carry").toFixed(2)}  |  YPC: ${n("yards_per_carry").toFixed(1)}`;
          line2 = `Yards: ${Math.round(n("rushing_yards")).toLocaleString()}  |  TD: ${Math.round(n("rushing_tds"))}  |  Car: ${Math.round(n("carries"))}`;
        } else {
          line1 = `EPA/Tgt: ${n("epa_per_target").toFixed(2)}  |  YPRR: ${n("yards_per_route_run").toFixed(2)}`;
          line2 = `Yards: ${Math.round(n("receiving_yards")).toLocaleString()}  |  TD: ${Math.round(n("receiving_tds"))}  |  Rec: ${Math.round(n("receptions"))}`;
        }
      }
    } catch {
      line1 = "Stats unavailable";
    }
  }

  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", backgroundColor: tc, fontFamily: "Inter" }}>
        <div style={{ display: "flex", fontSize: 24, color: "rgba(255,255,255,0.7)", marginBottom: 12, letterSpacing: "0.1em", textTransform: "uppercase" }}>
          Stat Card
        </div>
        <div style={{ display: "flex", fontSize: 56, fontWeight: 800, color: "#ffffff", marginBottom: 12, textAlign: "center", paddingLeft: 40, paddingRight: 40 }}>
          {name}
        </div>
        <div style={{ display: "flex", fontSize: 24, color: "rgba(255,255,255,0.7)", marginBottom: 24 }}>
          {pos} {team ? `\u00B7 ${team.name}` : ""} {"\u00B7"} 2025
        </div>
        <div style={{ display: "flex", fontSize: 22, color: "#ffffff", marginBottom: 8 }}>
          {line1}
        </div>
        <div style={{ display: "flex", fontSize: 22, color: "rgba(255,255,255,0.8)" }}>
          {line2}
        </div>
        <div style={{ display: "flex", fontSize: 18, color: "rgba(255,255,255,0.4)", marginTop: 32 }}>
          yardsperpass.com
        </div>
      </div>
    ),
    { ...size, fonts: [{ name: "Inter", data: fontData, style: "normal", weight: 800 }] }
  );
}
