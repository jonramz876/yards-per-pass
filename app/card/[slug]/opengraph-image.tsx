// app/card/[slug]/opengraph-image.tsx — shareable stat card
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

type Fmt = { key: string; label: string; fmt: (v: number) => string };
const QB_S: Fmt[] = [
  { key: "epa_per_db", label: "EPA/DB", fmt: (v) => v.toFixed(2) },
  { key: "cpoe", label: "CPOE", fmt: (v) => (v >= 0 ? "+" : "") + v.toFixed(1) },
  { key: "any_a", label: "ANY/A", fmt: (v) => v.toFixed(1) },
  { key: "passer_rating", label: "Rating", fmt: (v) => v.toFixed(1) },
  { key: "passing_yards", label: "Pass Yds", fmt: (v) => Math.round(v).toLocaleString() },
  { key: "touchdowns", label: "Pass TD", fmt: (v) => Math.round(v).toString() },
  { key: "interceptions", label: "INT", fmt: (v) => Math.round(v).toString() },
  { key: "success_rate", label: "Success%", fmt: (v) => (v * 100).toFixed(1) + "%" },
];
const WR_S: Fmt[] = [
  { key: "epa_per_target", label: "EPA/Tgt", fmt: (v) => v.toFixed(2) },
  { key: "yards_per_route_run", label: "YPRR", fmt: (v) => v.toFixed(2) },
  { key: "receiving_yards", label: "Yards", fmt: (v) => Math.round(v).toLocaleString() },
  { key: "receiving_tds", label: "TD", fmt: (v) => Math.round(v).toString() },
  { key: "catch_rate", label: "Catch%", fmt: (v) => (v * 100).toFixed(1) + "%" },
  { key: "target_share", label: "Tgt Share", fmt: (v) => (v * 100).toFixed(1) + "%" },
  { key: "croe", label: "CROE", fmt: (v) => (v >= 0 ? "+" : "") + (v * 100).toFixed(1) + "%" },
];
const RB_S: Fmt[] = [
  { key: "epa_per_carry", label: "EPA/Car", fmt: (v) => v.toFixed(2) },
  { key: "rushing_yards", label: "Rush Yds", fmt: (v) => Math.round(v).toLocaleString() },
  { key: "rushing_tds", label: "Rush TD", fmt: (v) => Math.round(v).toString() },
  { key: "yards_per_carry", label: "YPC", fmt: (v) => v.toFixed(1) },
  { key: "success_rate", label: "Success%", fmt: (v) => (v * 100).toFixed(1) + "%" },
  { key: "stuff_rate", label: "Stuff%", fmt: (v) => (v * 100).toFixed(1) + "%" },
  { key: "explosive_rate", label: "Explosive%", fmt: (v) => (v * 100).toFixed(1) + "%" },
];

export default async function Image({ params }: { params: { slug: string } }) {
  const fontData = await interBold;
  const player = await getPlayerBySlug(params.slug);
  const team = player ? getTeam(player.current_team_id) : null;
  const tc = team?.primaryColor || "#0f172a";
  const name = player?.player_name || "Player";
  const pos = player?.position || "";
  const isQB = pos === "QB";
  const isRB = pos === "RB" || pos === "FB";

  // Fetch stats
  const statFmts = isQB ? QB_S : isRB ? RB_S : WR_S;
  let sr: { l: string; v: string }[] = statFmts.map((d) => ({ l: d.label, v: "\u2014" }));

  if (player) {
    try {
      const sb = createServerClient();
      const tbl = isQB ? "qb_season_stats" : isRB ? "rb_season_stats" : "receiver_season_stats";
      const { data } = await sb.from(tbl).select("*").eq("player_id", player.player_id).eq("season", 2025).single();
      if (data) {
        const s = data as Record<string, unknown>;
        const n = (k: string) => { const v = s[k]; return typeof v === "number" ? v : NaN; };
        sr = statFmts.map((d) => ({ l: d.label, v: isNaN(n(d.key)) ? "\u2014" : d.fmt(n(d.key)) }));
      }
    } catch { /* show defaults */ }
  }
  while (sr.length < 8) sr.push({ l: "", v: "" });

  // Two-column stat layout
  const left = sr.slice(0, 4);
  const right = sr.slice(4, 8);

  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", backgroundColor: "#ffffff", fontFamily: "Inter" }}>
        {/* Team color header */}
        <div style={{ width: "100%", height: 8, backgroundColor: tc, display: "flex" }} />

        {/* Name block */}
        <div style={{ display: "flex", flexDirection: "column", padding: "32px 56px 24px" }}>
          <div style={{ display: "flex", fontSize: 52, fontWeight: 800, color: "#0f172a" }}>{name}</div>
          <div style={{ display: "flex", fontSize: 22, color: "#64748b", marginTop: 6 }}>
            {pos} {team ? `\u00B7 ${team.name}` : ""} {"\u00B7"} 2025 Season
          </div>
        </div>

        {/* Stats grid: 2 columns x 4 rows */}
        <div style={{ display: "flex", flex: 1, padding: "0 56px" }}>
          {/* Left column */}
          <div style={{ display: "flex", flexDirection: "column", flex: 1 }}>
            <div style={{ display: "flex", padding: "14px 0", borderBottom: "1px solid #e2e8f0" }}>
              <div style={{ display: "flex", width: 130, fontSize: 17, color: "#64748b", fontWeight: 600 }}>{left[0].l}</div>
              <div style={{ display: "flex", fontSize: 32, fontWeight: 800, color: "#0f172a" }}>{left[0].v}</div>
            </div>
            <div style={{ display: "flex", padding: "14px 0", borderBottom: "1px solid #e2e8f0" }}>
              <div style={{ display: "flex", width: 130, fontSize: 17, color: "#64748b", fontWeight: 600 }}>{left[1].l}</div>
              <div style={{ display: "flex", fontSize: 32, fontWeight: 800, color: "#0f172a" }}>{left[1].v}</div>
            </div>
            <div style={{ display: "flex", padding: "14px 0", borderBottom: "1px solid #e2e8f0" }}>
              <div style={{ display: "flex", width: 130, fontSize: 17, color: "#64748b", fontWeight: 600 }}>{left[2].l}</div>
              <div style={{ display: "flex", fontSize: 32, fontWeight: 800, color: "#0f172a" }}>{left[2].v}</div>
            </div>
            <div style={{ display: "flex", padding: "14px 0" }}>
              <div style={{ display: "flex", width: 130, fontSize: 17, color: "#64748b", fontWeight: 600 }}>{left[3].l}</div>
              <div style={{ display: "flex", fontSize: 32, fontWeight: 800, color: "#0f172a" }}>{left[3].v}</div>
            </div>
          </div>
          {/* Right column */}
          <div style={{ display: "flex", flexDirection: "column", flex: 1, marginLeft: 40 }}>
            <div style={{ display: "flex", padding: "14px 0", borderBottom: "1px solid #e2e8f0" }}>
              <div style={{ display: "flex", width: 130, fontSize: 17, color: "#64748b", fontWeight: 600 }}>{right[0].l}</div>
              <div style={{ display: "flex", fontSize: 32, fontWeight: 800, color: "#0f172a" }}>{right[0].v}</div>
            </div>
            <div style={{ display: "flex", padding: "14px 0", borderBottom: "1px solid #e2e8f0" }}>
              <div style={{ display: "flex", width: 130, fontSize: 17, color: "#64748b", fontWeight: 600 }}>{right[1].l}</div>
              <div style={{ display: "flex", fontSize: 32, fontWeight: 800, color: "#0f172a" }}>{right[1].v}</div>
            </div>
            <div style={{ display: "flex", padding: "14px 0", borderBottom: "1px solid #e2e8f0" }}>
              <div style={{ display: "flex", width: 130, fontSize: 17, color: "#64748b", fontWeight: 600 }}>{right[2].l}</div>
              <div style={{ display: "flex", fontSize: 32, fontWeight: 800, color: "#0f172a" }}>{right[2].v}</div>
            </div>
            <div style={{ display: "flex", padding: "14px 0" }}>
              <div style={{ display: "flex", width: 130, fontSize: 17, color: "#64748b", fontWeight: 600 }}>{right[3].l}</div>
              <div style={{ display: "flex", fontSize: 32, fontWeight: 800, color: "#0f172a" }}>{right[3].v}</div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div style={{ display: "flex", justifyContent: "space-between", padding: "14px 56px", borderTop: "1px solid #e2e8f0" }}>
          <div style={{ display: "flex", fontSize: 16, color: "#94a3b8", fontWeight: 600 }}>yardsperpass.com</div>
          <div style={{ display: "flex", fontSize: 13, color: "#cbd5e1" }}>Data: nflverse play-by-play</div>
        </div>
      </div>
    ),
    { ...size, fonts: [{ name: "Inter", data: fontData, style: "normal", weight: 800 }] }
  );
}
