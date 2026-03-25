// app/card/[slug]/opengraph-image.tsx — stat card matching player profile layout
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

type ChipStat = { label: string; value: string; rank: string };
type BarStat = { label: string; value: string; delta: number; barPct: number };

// Position configs: chip stats (radar axes) and bar stats (vs league avg)
const QB_CHIPS = ["epa_per_db", "cpoe", "adot", "success_rate", "passer_rating", "any_a"];
const QB_CHIP_LABELS = ["EPA/DB", "CPOE", "aDOT", "Success%", "Rating", "ANY/A"];
const QB_BARS = ["passing_yards", "touchdowns", "interceptions", "completion_pct", "rush_yards"];
const QB_BAR_LABELS = ["Pass Yds", "Pass TD", "INT", "Comp%", "Rush Yds"];

const WR_CHIPS = ["epa_per_target", "croe", "air_yards_per_target", "yac_per_reception", "yards_per_route_run", "target_share"];
const WR_CHIP_LABELS = ["EPA/Tgt", "CROE", "aDOT", "YAC/Rec", "YPRR", "Tgt Share"];
const WR_BARS = ["receiving_yards", "receiving_tds", "receptions", "catch_rate", "snap_share"];
const WR_BAR_LABELS = ["Yards", "TD", "Rec", "Catch%", "Snap%"];

const RB_CHIPS = ["epa_per_carry", "success_rate", "stuff_rate", "explosive_rate", "yards_per_carry"];
const RB_CHIP_LABELS = ["EPA/Car", "Success%", "Stuff%", "Explosive%", "YPC"];
const RB_BARS = ["rushing_yards", "rushing_tds", "carries", "receiving_yards", "receptions"];
const RB_BAR_LABELS = ["Rush Yds", "Rush TD", "Carries", "Rec Yds", "Rec"];

function fmtVal(key: string, v: number): string {
  if (isNaN(v)) return "\u2014";
  if (key === "success_rate" || key === "stuff_rate" || key === "explosive_rate" || key === "catch_rate" || key === "target_share" || key === "snap_share" || key === "route_participation_rate" || key === "completion_pct")
    return (v * 100).toFixed(1) + "%";
  if (key === "croe") return (v >= 0 ? "+" : "") + (v * 100).toFixed(1) + "%";
  if (key === "cpoe") return (v >= 0 ? "+" : "") + v.toFixed(1);
  if (key === "epa_per_db" || key === "epa_per_target" || key === "epa_per_carry" || key === "yards_per_route_run" || key === "any_a") return v.toFixed(2);
  if (key === "passer_rating" || key === "adot" || key === "air_yards_per_target" || key === "yac_per_reception" || key === "yards_per_carry") return v.toFixed(1);
  return Math.round(v).toLocaleString();
}

export default async function Image({ params }: { params: { slug: string } }) {
  const fontData = await interBold;
  const player = await getPlayerBySlug(params.slug);
  const team = player ? getTeam(player.current_team_id) : null;
  const tc = team?.primaryColor || "#0f172a";
  const name = player?.player_name || "Player";
  const pos = player?.position || "";
  const isQB = pos === "QB";
  const isRB = pos === "RB" || pos === "FB";

  const chipKeys = isQB ? QB_CHIPS : isRB ? RB_CHIPS : WR_CHIPS;
  const chipLabels = isQB ? QB_CHIP_LABELS : isRB ? RB_CHIP_LABELS : WR_CHIP_LABELS;
  const barKeys = isQB ? QB_BARS : isRB ? RB_BARS : WR_BARS;
  const barLabels = isQB ? QB_BAR_LABELS : isRB ? RB_BAR_LABELS : WR_BAR_LABELS;

  let chips: ChipStat[] = chipLabels.map((l) => ({ label: l, value: "\u2014", rank: "" }));
  let bars: BarStat[] = barLabels.map((l) => ({ label: l, value: "\u2014", delta: 0, barPct: 0 }));

  if (player) {
    try {
      const sb = createServerClient();
      const tbl = isQB ? "qb_season_stats" : isRB ? "rb_season_stats" : "receiver_season_stats";

      // Fetch player + all qualified for ranks
      const { data: allRows } = await sb.from(tbl).select("*").eq("season", 2025);
      const all = (allRows || []) as Record<string, unknown>[];
      const me = all.find((r) => r.player_id === player.player_id);

      if (me) {
        const n = (r: Record<string, unknown>, k: string) => { const v = r[k]; return typeof v === "number" ? v : NaN; };
        const g = (r: Record<string, unknown>) => n(r, isQB ? "attempts" : isRB ? "carries" : "targets");
        const minQ = isQB ? 238 : isRB ? 106 : 32;
        const pool = all.filter((r) => g(r) >= minQ);
        const poolSize = pool.length;

        // Chips: value + rank among qualified
        chips = chipKeys.map((k, i) => {
          const v = n(me, k);
          const sorted = pool.map((r) => n(r, k)).filter((x) => !isNaN(x)).sort((a, b) => b - a);
          const rank = sorted.findIndex((x) => v >= x) + 1;
          return { label: chipLabels[i], value: fmtVal(k, v), rank: isNaN(v) ? "" : `${rank} of ${poolSize}` };
        });

        // Bars: value + delta from league avg
        bars = barKeys.map((k, i) => {
          const v = n(me, k);
          const poolVals = pool.map((r) => n(r, k)).filter((x) => !isNaN(x));
          const avg = poolVals.length ? poolVals.reduce((a, b) => a + b, 0) / poolVals.length : 0;
          const delta = v - avg;
          const barPct = avg !== 0 ? Math.min(Math.abs(delta / avg) * 100, 50) : 0;
          const isPct = k.includes("rate") || k.includes("pct") || k === "snap_share" || k === "target_share";
          return {
            label: barLabels[i],
            value: isPct ? (v * 100).toFixed(1) + "%" : isNaN(v) ? "\u2014" : Math.round(v).toLocaleString(),
            delta,
            barPct,
          };
        });
      }
    } catch { /* defaults */ }
  }

  // Pad chips to 6
  while (chips.length < 6) chips.push({ label: "", value: "", rank: "" });
  while (bars.length < 5) bars.push({ label: "", value: "\u2014", delta: 0, barPct: 0 });

  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", backgroundColor: "#ffffff", fontFamily: "Inter" }}>
        {/* Team color header */}
        <div style={{ width: "100%", height: 8, backgroundColor: tc, display: "flex" }} />

        {/* Name */}
        <div style={{ display: "flex", padding: "16px 40px 10px" }}>
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ display: "flex", fontSize: 38, fontWeight: 800, color: "#0f172a" }}>{name}</div>
            <div style={{ display: "flex", fontSize: 16, color: "#64748b", marginTop: 2 }}>
              {pos} {team ? `\u00B7 ${team.name}` : ""} {"\u00B7"} 2025 Season
            </div>
          </div>
        </div>

        {/* Main: 2-column */}
        <div style={{ display: "flex", flex: 1, padding: "4px 40px 0" }}>
          {/* Left: chip stats (radar axes) */}
          <div style={{ display: "flex", flexDirection: "column", width: 480 }}>
            <div style={{ display: "flex", fontSize: 11, color: "#94a3b8", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 8 }}>Performance Profile</div>
            <div style={{ display: "flex", flexWrap: "wrap" }}>
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", width: 150, padding: "10px 0", borderBottom: "1px solid #f1f5f9" }}>
                <div style={{ display: "flex", fontSize: 10, color: "#94a3b8", fontWeight: 600, textTransform: "uppercase" }}>{chips[0].label}</div>
                <div style={{ display: "flex", fontSize: 28, fontWeight: 800, color: "#0f172a" }}>{chips[0].value}</div>
                <div style={{ display: "flex", fontSize: 10, color: "#94a3b8" }}>{chips[0].rank}</div>
              </div>
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", width: 150, padding: "10px 0", borderBottom: "1px solid #f1f5f9" }}>
                <div style={{ display: "flex", fontSize: 10, color: "#94a3b8", fontWeight: 600, textTransform: "uppercase" }}>{chips[1].label}</div>
                <div style={{ display: "flex", fontSize: 28, fontWeight: 800, color: "#0f172a" }}>{chips[1].value}</div>
                <div style={{ display: "flex", fontSize: 10, color: "#94a3b8" }}>{chips[1].rank}</div>
              </div>
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", width: 150, padding: "10px 0", borderBottom: "1px solid #f1f5f9" }}>
                <div style={{ display: "flex", fontSize: 10, color: "#94a3b8", fontWeight: 600, textTransform: "uppercase" }}>{chips[2].label}</div>
                <div style={{ display: "flex", fontSize: 28, fontWeight: 800, color: "#0f172a" }}>{chips[2].value}</div>
                <div style={{ display: "flex", fontSize: 10, color: "#94a3b8" }}>{chips[2].rank}</div>
              </div>
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", width: 150, padding: "10px 0" }}>
                <div style={{ display: "flex", fontSize: 10, color: "#94a3b8", fontWeight: 600, textTransform: "uppercase" }}>{chips[3].label}</div>
                <div style={{ display: "flex", fontSize: 28, fontWeight: 800, color: "#0f172a" }}>{chips[3].value}</div>
                <div style={{ display: "flex", fontSize: 10, color: "#94a3b8" }}>{chips[3].rank}</div>
              </div>
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", width: 150, padding: "10px 0" }}>
                <div style={{ display: "flex", fontSize: 10, color: "#94a3b8", fontWeight: 600, textTransform: "uppercase" }}>{chips[4].label}</div>
                <div style={{ display: "flex", fontSize: 28, fontWeight: 800, color: "#0f172a" }}>{chips[4].value}</div>
                <div style={{ display: "flex", fontSize: 10, color: "#94a3b8" }}>{chips[4].rank}</div>
              </div>
              {chips[5].label && (
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", width: 150, padding: "10px 0" }}>
                  <div style={{ display: "flex", fontSize: 10, color: "#94a3b8", fontWeight: 600, textTransform: "uppercase" }}>{chips[5].label}</div>
                  <div style={{ display: "flex", fontSize: 28, fontWeight: 800, color: "#0f172a" }}>{chips[5].value}</div>
                  <div style={{ display: "flex", fontSize: 10, color: "#94a3b8" }}>{chips[5].rank}</div>
                </div>
              )}
            </div>
          </div>

          {/* Right: vs league avg bars */}
          <div style={{ display: "flex", flexDirection: "column", flex: 1, marginLeft: 32 }}>
            <div style={{ display: "flex", fontSize: 11, color: "#94a3b8", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 8 }}>Vs. League Average</div>
            <div style={{ display: "flex", alignItems: "center", padding: "10px 0", borderBottom: "1px solid #f1f5f9" }}>
              <div style={{ display: "flex", width: 60, fontSize: 12, color: "#64748b", fontWeight: 600 }}>{bars[0].label}</div>
              <div style={{ display: "flex", flex: 1, height: 18, backgroundColor: "#f1f5f9", borderRadius: 4, overflow: "hidden", alignItems: "center", justifyContent: "center" }}>
                <div style={{ display: "flex", width: `${bars[0].barPct}%`, height: "100%", backgroundColor: bars[0].delta >= 0 ? "#86efac" : "#fca5a5", borderRadius: 4 }} />
              </div>
              <div style={{ display: "flex", width: 70, justifyContent: "flex-end", fontSize: 16, fontWeight: 800, color: "#0f172a" }}>{bars[0].value}</div>
            </div>
            <div style={{ display: "flex", alignItems: "center", padding: "10px 0", borderBottom: "1px solid #f1f5f9" }}>
              <div style={{ display: "flex", width: 60, fontSize: 12, color: "#64748b", fontWeight: 600 }}>{bars[1].label}</div>
              <div style={{ display: "flex", flex: 1, height: 18, backgroundColor: "#f1f5f9", borderRadius: 4, overflow: "hidden" }}>
                <div style={{ display: "flex", width: `${bars[1].barPct}%`, height: "100%", backgroundColor: bars[1].delta >= 0 ? "#86efac" : "#fca5a5", borderRadius: 4 }} />
              </div>
              <div style={{ display: "flex", width: 70, justifyContent: "flex-end", fontSize: 16, fontWeight: 800, color: "#0f172a" }}>{bars[1].value}</div>
            </div>
            <div style={{ display: "flex", alignItems: "center", padding: "10px 0", borderBottom: "1px solid #f1f5f9" }}>
              <div style={{ display: "flex", width: 60, fontSize: 12, color: "#64748b", fontWeight: 600 }}>{bars[2].label}</div>
              <div style={{ display: "flex", flex: 1, height: 18, backgroundColor: "#f1f5f9", borderRadius: 4, overflow: "hidden" }}>
                <div style={{ display: "flex", width: `${bars[2].barPct}%`, height: "100%", backgroundColor: bars[2].delta >= 0 ? "#86efac" : "#fca5a5", borderRadius: 4 }} />
              </div>
              <div style={{ display: "flex", width: 70, justifyContent: "flex-end", fontSize: 16, fontWeight: 800, color: "#0f172a" }}>{bars[2].value}</div>
            </div>
            <div style={{ display: "flex", alignItems: "center", padding: "10px 0", borderBottom: "1px solid #f1f5f9" }}>
              <div style={{ display: "flex", width: 60, fontSize: 12, color: "#64748b", fontWeight: 600 }}>{bars[3].label}</div>
              <div style={{ display: "flex", flex: 1, height: 18, backgroundColor: "#f1f5f9", borderRadius: 4, overflow: "hidden" }}>
                <div style={{ display: "flex", width: `${bars[3].barPct}%`, height: "100%", backgroundColor: bars[3].delta >= 0 ? "#86efac" : "#fca5a5", borderRadius: 4 }} />
              </div>
              <div style={{ display: "flex", width: 70, justifyContent: "flex-end", fontSize: 16, fontWeight: 800, color: "#0f172a" }}>{bars[3].value}</div>
            </div>
            <div style={{ display: "flex", alignItems: "center", padding: "10px 0" }}>
              <div style={{ display: "flex", width: 60, fontSize: 12, color: "#64748b", fontWeight: 600 }}>{bars[4].label}</div>
              <div style={{ display: "flex", flex: 1, height: 18, backgroundColor: "#f1f5f9", borderRadius: 4, overflow: "hidden" }}>
                <div style={{ display: "flex", width: `${bars[4].barPct}%`, height: "100%", backgroundColor: bars[4].delta >= 0 ? "#86efac" : "#fca5a5", borderRadius: 4 }} />
              </div>
              <div style={{ display: "flex", width: 70, justifyContent: "flex-end", fontSize: 16, fontWeight: 800, color: "#0f172a" }}>{bars[4].value}</div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div style={{ display: "flex", justifyContent: "space-between", padding: "10px 40px", borderTop: "1px solid #e2e8f0" }}>
          <div style={{ display: "flex", fontSize: 14, color: "#94a3b8", fontWeight: 600 }}>yardsperpass.com</div>
          <div style={{ display: "flex", fontSize: 12, color: "#cbd5e1" }}>Data: nflverse play-by-play</div>
        </div>
      </div>
    ),
    { ...size, fonts: [{ name: "Inter", data: fontData, style: "normal", weight: 800 }] }
  );
}
