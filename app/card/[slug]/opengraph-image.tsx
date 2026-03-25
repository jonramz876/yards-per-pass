// app/card/[slug]/opengraph-image.tsx — stat card with radar + bars + stats
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

// Radar geometry
const CX = 120, CY = 110, R = 85;
function hexPt(r: number, i: number): [number, number] {
  const a = -Math.PI / 2 + (i * Math.PI) / 3;
  return [CX + r * Math.cos(a), CY + r * Math.sin(a)];
}
function pathStr(pts: [number, number][]): string {
  return pts.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ") + "Z";
}

// Build radar SVG as data URI string (Satori can render <img src="data:image/svg+xml,...">)
function buildRadarSVG(values: number[], color: string, labels: string[]): string {
  const outer = Array.from({ length: 6 }, (_, i) => hexPt(R, i));
  const mid = Array.from({ length: 6 }, (_, i) => hexPt(R * 0.5, i));
  const data = values.map((pct, i) => {
    const s = Math.max(0, Math.min(isNaN(pct) ? 0 : pct, 100));
    return hexPt((s / 100) * R, i);
  });
  const axes = Array.from({ length: 6 }, (_, i) => hexPt(R, i));

  const lp = [
    { x: 120, y: 10, a: "middle" }, { x: 218, y: 60, a: "start" }, { x: 218, y: 168, a: "start" },
    { x: 120, y: 218, a: "middle" }, { x: 22, y: 168, a: "end" }, { x: 22, y: 60, a: "end" },
  ];

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 230" width="240" height="230">
    <path d="${pathStr(outer)}" fill="none" stroke="#e2e8f0" stroke-width="1"/>
    <path d="${pathStr(mid)}" fill="rgba(251,191,36,0.06)" stroke="#f59e0b" stroke-width="0.75" opacity="0.5"/>
    ${axes.map((p, i) => `<line x1="${CX}" y1="${CY}" x2="${p[0].toFixed(1)}" y2="${p[1].toFixed(1)}" stroke="#f1f5f9" stroke-width="0.5"/>`).join("")}
    <path d="${pathStr(data)}" fill="${color}22" stroke="${color}" stroke-width="2"/>
    ${data.map(([x, y]) => `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3" fill="${color}"/>`).join("")}
    ${labels.map((l, i) => `<text x="${lp[i].x}" y="${lp[i].y}" text-anchor="${lp[i].a}" font-size="11" fill="#475569" font-weight="600" font-family="sans-serif">${l}</text>`).join("")}
  </svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

function fmtVal(key: string, v: number): string {
  if (isNaN(v)) return "\u2014";
  if (["success_rate", "stuff_rate", "explosive_rate", "catch_rate", "target_share", "snap_share", "completion_pct"].includes(key))
    return (v * 100).toFixed(1) + "%";
  if (key === "croe") return (v >= 0 ? "+" : "") + (v * 100).toFixed(1) + "%";
  if (key === "cpoe") return (v >= 0 ? "+" : "") + v.toFixed(1);
  if (["epa_per_db", "epa_per_target", "epa_per_carry", "yards_per_route_run", "any_a"].includes(key)) return v.toFixed(2);
  if (["passer_rating", "adot", "air_yards_per_target", "yac_per_reception", "yards_per_carry"].includes(key)) return v.toFixed(1);
  return Math.round(v).toLocaleString();
}

// Position configs
const QB_RADAR_KEYS = ["epa_per_db", "cpoe", "adot", "success_rate", "passer_rating", "any_a"];
const QB_RADAR_LABELS = ["EPA/DB", "CPOE", "aDOT", "Succ%", "Rating", "ANY/A"];
const QB_BAR_KEYS = ["passing_yards", "touchdowns", "interceptions", "completion_pct", "rush_yards"];
const QB_BAR_LABELS = ["Pass Yds", "Pass TD", "INT", "Comp%", "Rush Yds"];
const QB_STAT_KEYS = ["passing_yards", "touchdowns", "interceptions", "completions", "attempts", "sacks"];
const QB_STAT_LABELS = ["Pass Yds", "TD", "INT", "Cmp", "Att", "Sk"];

const WR_RADAR_KEYS = ["epa_per_target", "croe", "air_yards_per_target", "yac_per_reception", "yards_per_route_run", "target_share"];
const WR_RADAR_LABELS = ["EPA/Tgt", "CROE", "aDOT", "YAC", "YPRR", "TgtShr"];
const WR_BAR_KEYS = ["receiving_yards", "receiving_tds", "receptions", "catch_rate", "snap_share"];
const WR_BAR_LABELS = ["Yards", "TD", "Rec", "Catch%", "Snap%"];
const WR_STAT_KEYS = ["targets", "receptions", "receiving_yards", "receiving_tds", "catch_rate", "routes_run"];
const WR_STAT_LABELS = ["Tgt", "Rec", "Yds", "TD", "Catch%", "Routes"];

const RB_RADAR_KEYS = ["epa_per_carry", "success_rate", "stuff_rate", "explosive_rate", "yards_per_carry"];
const RB_RADAR_LABELS = ["EPA/Car", "Succ%", "Stuff%", "Expl%", "YPC"];
const RB_BAR_KEYS = ["rushing_yards", "rushing_tds", "carries", "receiving_yards", "receptions"];
const RB_BAR_LABELS = ["Rush Yds", "Rush TD", "Carries", "Rec Yds", "Rec"];
const RB_STAT_KEYS = ["carries", "rushing_yards", "rushing_tds", "receptions", "receiving_yards", "receiving_tds"];
const RB_STAT_LABELS = ["Car", "Rush Yds", "Rush TD", "Rec", "Rec Yds", "Rec TD"];

// Radar scaling (approximate percentiles from value ranges)
function qbRadar(n: (k: string) => number): number[] {
  return [
    (n("epa_per_db") + 0.2) / 0.5 * 100, (n("cpoe") + 5) / 12 * 100,
    (n("adot") - 5) / 8 * 100, ((n("success_rate") || 0) - 0.3) / 0.25 * 100,
    (n("passer_rating") - 60) / 60 * 100, (n("any_a") - 2) / 6 * 100,
  ];
}
function wrRadar(n: (k: string) => number): number[] {
  return [
    (n("epa_per_target") + 0.1) / 0.4 * 100, ((n("croe") || 0) + 0.1) / 0.2 * 100,
    (n("air_yards_per_target") - 5) / 10 * 100, ((n("yac_per_reception") || 0) - 2) / 8 * 100,
    ((n("yards_per_route_run") || 0) - 0.5) / 2.5 * 100, ((n("target_share") || 0)) / 0.25 * 100,
  ];
}
function rbRadar(n: (k: string) => number): number[] {
  return [
    (n("epa_per_carry") + 0.15) / 0.35 * 100, ((n("success_rate") || 0) - 0.3) / 0.25 * 100,
    (1 - (n("stuff_rate") || 0.2)) / 0.3 * 100, ((n("explosive_rate") || 0) - 0.05) / 0.15 * 100,
    (n("yards_per_carry") - 3) / 3 * 100,
  ];
}

export default async function Image({ params }: { params: { slug: string } }) {
  const fontData = await interBold;
  const player = await getPlayerBySlug(params.slug);
  const team = player ? getTeam(player.current_team_id) : null;
  const tc = team?.primaryColor || "#0f172a";
  const nm = player?.player_name || "Player";
  const pos = player?.position || "";
  const isQB = pos === "QB";
  const isRB = pos === "RB" || pos === "FB";

  const rLabels = isQB ? QB_RADAR_LABELS : isRB ? RB_RADAR_LABELS : WR_RADAR_LABELS;
  const barKeys = isQB ? QB_BAR_KEYS : isRB ? RB_BAR_KEYS : WR_BAR_KEYS;
  const barLabels = isQB ? QB_BAR_LABELS : isRB ? RB_BAR_LABELS : WR_BAR_LABELS;
  const statKeys = isQB ? QB_STAT_KEYS : isRB ? RB_STAT_KEYS : WR_STAT_KEYS;
  const statLabels = isQB ? QB_STAT_LABELS : isRB ? RB_STAT_LABELS : WR_STAT_LABELS;

  let radarSVG = "";
  let bars: { label: string; value: string; delta: number; pct: number }[] = barLabels.map((l) => ({ label: l, value: "\u2014", delta: 0, pct: 0 }));
  let stats: { l: string; v: string }[] = statLabels.map((l) => ({ l, v: "\u2014" }));

  if (player) {
    try {
      const sb = createServerClient();
      const tbl = isQB ? "qb_season_stats" : isRB ? "rb_season_stats" : "receiver_season_stats";
      const { data: allRows } = await sb.from(tbl).select("*").eq("season", 2025);
      const all = (allRows || []) as Record<string, unknown>[];
      const me = all.find((r) => r.player_id === player.player_id);

      if (me) {
        const n = (k: string) => { const v = me[k]; return typeof v === "number" ? v : NaN; };
        const gKey = isQB ? "attempts" : isRB ? "carries" : "targets";
        const minQ = isQB ? 238 : isRB ? 106 : 32;
        const pool = all.filter((r) => { const v = r[gKey]; return typeof v === "number" && v >= minQ; });

        // Radar
        const rv = isQB ? qbRadar(n) : isRB ? rbRadar(n) : wrRadar(n);
        radarSVG = buildRadarSVG(rv, tc, rLabels);

        // Bars
        bars = barKeys.map((k, i) => {
          const v = n(k);
          const poolN = (r: Record<string, unknown>) => { const x = r[k]; return typeof x === "number" ? x : NaN; };
          const poolVals = pool.map(poolN).filter((x) => !isNaN(x));
          const avg = poolVals.length ? poolVals.reduce((a, b) => a + b, 0) / poolVals.length : 0;
          const delta = v - avg;
          const pct = avg !== 0 ? Math.min(Math.abs(delta / avg) * 100, 50) : 0;
          return { label: barLabels[i], value: fmtVal(k, v), delta, pct };
        });

        // Bottom stats
        stats = statKeys.map((k, i) => ({ l: statLabels[i], v: fmtVal(k, n(k)) }));
      }
    } catch { /* defaults */ }
  }

  while (bars.length < 5) bars.push({ label: "", value: "\u2014", delta: 0, pct: 0 });
  while (stats.length < 6) stats.push({ l: "", v: "" });

  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", backgroundColor: "#ffffff", fontFamily: "Inter" }}>
        {/* Header */}
        <div style={{ width: "100%", height: 6, backgroundColor: tc, display: "flex" }} />
        <div style={{ display: "flex", padding: "14px 36px 6px" }}>
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ display: "flex", fontSize: 36, fontWeight: 800, color: "#0f172a" }}>{nm}</div>
            <div style={{ display: "flex", fontSize: 15, color: "#64748b", marginTop: 2 }}>
              {pos} {team ? `\u00B7 ${team.name}` : ""} {"\u00B7"} 2025 Season
            </div>
          </div>
        </div>

        {/* Main: Radar left, Bars right */}
        <div style={{ display: "flex", flex: 1, padding: "0 36px" }}>
          {/* Radar as embedded SVG image */}
          <div style={{ display: "flex", width: 280, alignItems: "center", justifyContent: "center" }}>
            {radarSVG ? (
              <img src={radarSVG} width={240} height={230} />
            ) : (
              <div style={{ display: "flex", color: "#94a3b8", fontSize: 14 }}>No data</div>
            )}
          </div>

          {/* Bars */}
          <div style={{ display: "flex", flexDirection: "column", flex: 1, marginLeft: 20, justifyContent: "center" }}>
            <div style={{ display: "flex", fontSize: 10, color: "#94a3b8", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 6 }}>Vs. League Average</div>
            <div style={{ display: "flex", alignItems: "center", padding: "7px 0", borderBottom: "1px solid #f1f5f9" }}>
              <div style={{ display: "flex", width: 64, fontSize: 11, color: "#64748b", fontWeight: 600 }}>{bars[0].label}</div>
              <div style={{ display: "flex", flex: 1, height: 16, backgroundColor: "#f1f5f9", borderRadius: 3 }}>
                <div style={{ display: "flex", width: `${bars[0].pct}%`, height: "100%", backgroundColor: bars[0].delta >= 0 ? "#86efac" : "#fca5a5", borderRadius: 3 }} />
              </div>
              <div style={{ display: "flex", width: 64, justifyContent: "flex-end", fontSize: 14, fontWeight: 800, color: "#0f172a" }}>{bars[0].value}</div>
            </div>
            <div style={{ display: "flex", alignItems: "center", padding: "7px 0", borderBottom: "1px solid #f1f5f9" }}>
              <div style={{ display: "flex", width: 64, fontSize: 11, color: "#64748b", fontWeight: 600 }}>{bars[1].label}</div>
              <div style={{ display: "flex", flex: 1, height: 16, backgroundColor: "#f1f5f9", borderRadius: 3 }}>
                <div style={{ display: "flex", width: `${bars[1].pct}%`, height: "100%", backgroundColor: bars[1].delta >= 0 ? "#86efac" : "#fca5a5", borderRadius: 3 }} />
              </div>
              <div style={{ display: "flex", width: 64, justifyContent: "flex-end", fontSize: 14, fontWeight: 800, color: "#0f172a" }}>{bars[1].value}</div>
            </div>
            <div style={{ display: "flex", alignItems: "center", padding: "7px 0", borderBottom: "1px solid #f1f5f9" }}>
              <div style={{ display: "flex", width: 64, fontSize: 11, color: "#64748b", fontWeight: 600 }}>{bars[2].label}</div>
              <div style={{ display: "flex", flex: 1, height: 16, backgroundColor: "#f1f5f9", borderRadius: 3 }}>
                <div style={{ display: "flex", width: `${bars[2].pct}%`, height: "100%", backgroundColor: bars[2].delta >= 0 ? "#86efac" : "#fca5a5", borderRadius: 3 }} />
              </div>
              <div style={{ display: "flex", width: 64, justifyContent: "flex-end", fontSize: 14, fontWeight: 800, color: "#0f172a" }}>{bars[2].value}</div>
            </div>
            <div style={{ display: "flex", alignItems: "center", padding: "7px 0", borderBottom: "1px solid #f1f5f9" }}>
              <div style={{ display: "flex", width: 64, fontSize: 11, color: "#64748b", fontWeight: 600 }}>{bars[3].label}</div>
              <div style={{ display: "flex", flex: 1, height: 16, backgroundColor: "#f1f5f9", borderRadius: 3 }}>
                <div style={{ display: "flex", width: `${bars[3].pct}%`, height: "100%", backgroundColor: bars[3].delta >= 0 ? "#86efac" : "#fca5a5", borderRadius: 3 }} />
              </div>
              <div style={{ display: "flex", width: 64, justifyContent: "flex-end", fontSize: 14, fontWeight: 800, color: "#0f172a" }}>{bars[3].value}</div>
            </div>
            <div style={{ display: "flex", alignItems: "center", padding: "7px 0" }}>
              <div style={{ display: "flex", width: 64, fontSize: 11, color: "#64748b", fontWeight: 600 }}>{bars[4].label}</div>
              <div style={{ display: "flex", flex: 1, height: 16, backgroundColor: "#f1f5f9", borderRadius: 3 }}>
                <div style={{ display: "flex", width: `${bars[4].pct}%`, height: "100%", backgroundColor: bars[4].delta >= 0 ? "#86efac" : "#fca5a5", borderRadius: 3 }} />
              </div>
              <div style={{ display: "flex", width: 64, justifyContent: "flex-end", fontSize: 14, fontWeight: 800, color: "#0f172a" }}>{bars[4].value}</div>
            </div>
          </div>
        </div>

        {/* Bottom stats row */}
        <div style={{ display: "flex", padding: "8px 36px 6px", borderTop: "1px solid #e2e8f0" }}>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", flex: 1, padding: "4px 0" }}>
            <div style={{ display: "flex", fontSize: 10, color: "#94a3b8", fontWeight: 600, textTransform: "uppercase" }}>{stats[0].l}</div>
            <div style={{ display: "flex", fontSize: 22, fontWeight: 800, color: "#0f172a" }}>{stats[0].v}</div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", flex: 1, padding: "4px 0" }}>
            <div style={{ display: "flex", fontSize: 10, color: "#94a3b8", fontWeight: 600, textTransform: "uppercase" }}>{stats[1].l}</div>
            <div style={{ display: "flex", fontSize: 22, fontWeight: 800, color: "#0f172a" }}>{stats[1].v}</div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", flex: 1, padding: "4px 0" }}>
            <div style={{ display: "flex", fontSize: 10, color: "#94a3b8", fontWeight: 600, textTransform: "uppercase" }}>{stats[2].l}</div>
            <div style={{ display: "flex", fontSize: 22, fontWeight: 800, color: "#0f172a" }}>{stats[2].v}</div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", flex: 1, padding: "4px 0" }}>
            <div style={{ display: "flex", fontSize: 10, color: "#94a3b8", fontWeight: 600, textTransform: "uppercase" }}>{stats[3].l}</div>
            <div style={{ display: "flex", fontSize: 22, fontWeight: 800, color: "#0f172a" }}>{stats[3].v}</div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", flex: 1, padding: "4px 0" }}>
            <div style={{ display: "flex", fontSize: 10, color: "#94a3b8", fontWeight: 600, textTransform: "uppercase" }}>{stats[4].l}</div>
            <div style={{ display: "flex", fontSize: 22, fontWeight: 800, color: "#0f172a" }}>{stats[4].v}</div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", flex: 1, padding: "4px 0" }}>
            <div style={{ display: "flex", fontSize: 10, color: "#94a3b8", fontWeight: 600, textTransform: "uppercase" }}>{stats[5].l}</div>
            <div style={{ display: "flex", fontSize: 22, fontWeight: 800, color: "#0f172a" }}>{stats[5].v}</div>
          </div>
        </div>

        {/* Footer */}
        <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 36px 10px" }}>
          <div style={{ display: "flex", fontSize: 13, color: "#94a3b8", fontWeight: 600 }}>yardsperpass.com</div>
          <div style={{ display: "flex", fontSize: 11, color: "#cbd5e1" }}>Data: nflverse play-by-play</div>
        </div>
      </div>
    ),
    { ...size, fonts: [{ name: "Inter", data: fontData, style: "normal", weight: 800 }] }
  );
}
