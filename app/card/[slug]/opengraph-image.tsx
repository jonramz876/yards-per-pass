// app/card/[slug]/opengraph-image.tsx — stat card with inline radar SVG
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

// Radar math
const CX = 130, CY = 120, RAD = 95;
function hp(r: number, i: number): [number, number] {
  const a = -Math.PI / 2 + (i * Math.PI) / 3;
  return [CX + r * Math.cos(a), CY + r * Math.sin(a)];
}
function mp(pts: [number, number][]): string {
  return pts.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ") + "Z";
}
// Pre-compute static paths
const OP = mp(Array.from({ length: 6 }, (_, i) => hp(RAD, i)));
const MP = mp(Array.from({ length: 6 }, (_, i) => hp(RAD * 0.5, i)));
const AX = Array.from({ length: 6 }, (_, i) => hp(RAD, i));

function fmtVal(key: string, v: number): string {
  if (isNaN(v)) return "\u2014";
  if (["success_rate","stuff_rate","explosive_rate","catch_rate","target_share","snap_share","completion_pct"].includes(key))
    return (v * 100).toFixed(1) + "%";
  if (key === "croe") return (v >= 0 ? "+" : "") + (v * 100).toFixed(1) + "%";
  if (key === "cpoe") return (v >= 0 ? "+" : "") + v.toFixed(1);
  if (["epa_per_db","epa_per_target","epa_per_carry","yards_per_route_run","any_a"].includes(key)) return v.toFixed(2);
  if (["passer_rating","adot","air_yards_per_target","yac_per_reception","yards_per_carry"].includes(key)) return v.toFixed(1);
  return Math.round(v).toLocaleString();
}

// Configs
const QB = {
  bar: { k: ["passing_yards","touchdowns","interceptions","completion_pct","rush_yards"], l: ["Pass Yds","Pass TD","INT","Comp%","Rush Yds"] },
  bot: { k: ["passing_yards","touchdowns","interceptions","completions","attempts","sacks"], l: ["Pass Yds","TD","INT","Cmp","Att","Sk"] },
  rk: ["epa_per_db","cpoe","adot","success_rate","passer_rating","any_a"],
  rl: ["EPA/DB","CPOE","aDOT","Succ%","Rating","ANY/A"],
  rv: (n: (k: string) => number) => [(n("epa_per_db")+0.2)/0.5*100,(n("cpoe")+5)/12*100,(n("adot")-5)/8*100,((n("success_rate")||0)-0.3)/0.25*100,(n("passer_rating")-60)/60*100,(n("any_a")-2)/6*100],
};
const WR = {
  bar: { k: ["receiving_yards","receiving_tds","receptions","catch_rate","snap_share"], l: ["Yards","TD","Rec","Catch%","Snap%"] },
  bot: { k: ["targets","receptions","receiving_yards","receiving_tds","catch_rate","routes_run"], l: ["Tgt","Rec","Yds","TD","Catch%","Routes"] },
  rk: ["epa_per_target","croe","air_yards_per_target","yac_per_reception","yards_per_route_run","target_share"],
  rl: ["EPA/Tgt","CROE","aDOT","YAC","YPRR","TgtShr"],
  rv: (n: (k: string) => number) => [(n("epa_per_target")+0.1)/0.4*100,((n("croe")||0)+0.1)/0.2*100,(n("air_yards_per_target")-5)/10*100,((n("yac_per_reception")||0)-2)/8*100,((n("yards_per_route_run")||0)-0.5)/2.5*100,((n("target_share")||0))/0.25*100],
};
const RB = {
  bar: { k: ["rushing_yards","rushing_tds","carries","receiving_yards","receptions"], l: ["Rush Yds","Rush TD","Car","Rec Yds","Rec"] },
  bot: { k: ["carries","rushing_yards","rushing_tds","receptions","receiving_yards","receiving_tds"], l: ["Car","Rush Yds","Rush TD","Rec","Rec Yds","Rec TD"] },
  rk: ["epa_per_carry","success_rate","stuff_rate","explosive_rate","yards_per_carry"],
  rl: ["EPA/Car","Succ%","Stuff%","Expl%","YPC"],
  rv: (n: (k: string) => number) => [(n("epa_per_carry")+0.15)/0.35*100,((n("success_rate")||0)-0.3)/0.25*100,(1-(n("stuff_rate")||0.2))/0.3*100,((n("explosive_rate")||0)-0.05)/0.15*100,(n("yards_per_carry")-3)/3*100,50],
};

export default async function Image({ params }: { params: { slug: string } }) {
  const fontData = await interBold;
  const player = await getPlayerBySlug(params.slug);
  const team = player ? getTeam(player.current_team_id) : null;
  const tc = team?.primaryColor || "#0f172a";
  const nm = player?.player_name || "Player";
  const pos = player?.position || "";
  const isQB = pos === "QB";
  const isRB = pos === "RB" || pos === "FB";
  const cfg = isQB ? QB : isRB ? RB : WR;

  let rv = [50,50,50,50,50,50];
  let bars: { l: string; v: string; d: number; p: number }[] = cfg.bar.l.map(l => ({ l, v: "\u2014", d: 0, p: 0 }));
  let bot: { l: string; v: string }[] = cfg.bot.l.map(l => ({ l, v: "\u2014" }));

  if (player) {
    try {
      const sb = createServerClient();
      const tbl = isQB ? "qb_season_stats" : isRB ? "rb_season_stats" : "receiver_season_stats";
      const { data: allRows } = await sb.from(tbl).select("*").eq("season", 2025);
      const all = (allRows || []) as Record<string, unknown>[];
      const me = all.find(r => r.player_id === player.player_id);
      if (me) {
        const n = (k: string) => { const v = me[k]; return typeof v === "number" ? v : NaN; };
        const gk = isQB ? "attempts" : isRB ? "carries" : "targets";
        const mq = isQB ? 238 : isRB ? 106 : 32;
        const pool = all.filter(r => { const v = r[gk]; return typeof v === "number" && v >= mq; });

        rv = cfg.rv(n);
        bars = cfg.bar.k.map((k, i) => {
          const v = n(k);
          const pv = pool.map(r => { const x = r[k]; return typeof x === "number" ? x : NaN; }).filter(x => !isNaN(x));
          const avg = pv.length ? pv.reduce((a, b) => a + b, 0) / pv.length : 0;
          const d = v - avg;
          return { l: cfg.bar.l[i], v: fmtVal(k, v), d, p: avg !== 0 ? Math.min(Math.abs(d / avg) * 100, 50) : 0 };
        });
        bot = cfg.bot.k.map((k, i) => ({ l: cfg.bot.l[i], v: fmtVal(k, n(k)) }));
      }
    } catch { /* defaults */ }
  }

  // Radar polygon + dots
  const dp = rv.map((p, i) => { const s = Math.max(0, Math.min(isNaN(p) ? 0 : p, 100)); return hp((s / 100) * RAD, i); });
  const rPath = mp(dp);
  while (bars.length < 5) bars.push({ l: "", v: "\u2014", d: 0, p: 0 });
  while (bot.length < 6) bot.push({ l: "", v: "" });

  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", backgroundColor: "#ffffff", fontFamily: "Inter" }}>
        <div style={{ width: "100%", height: 6, backgroundColor: tc, display: "flex" }} />
        <div style={{ display: "flex", padding: "12px 36px 4px" }}>
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ display: "flex", fontSize: 34, fontWeight: 800, color: "#0f172a" }}>{nm}</div>
            <div style={{ display: "flex", fontSize: 14, color: "#64748b", marginTop: 2 }}>{pos} {team ? `\u00B7 ${team.name}` : ""} {"\u00B7"} 2025 Season</div>
          </div>
        </div>

        {/* Radar + Bars */}
        <div style={{ display: "flex", flex: 1, padding: "0 36px" }}>
          {/* Radar */}
          <div style={{ display: "flex", width: 300, alignItems: "center", justifyContent: "center" }}>
            <svg viewBox="0 0 260 250" width="280" height="260">
              <path d={OP} fill="none" stroke="#e2e8f0" strokeWidth="1" />
              <path d={MP} fill="rgba(251,191,36,0.06)" stroke="rgba(245,158,11,0.5)" strokeWidth="0.75" />
              <line x1={CX} y1={CY} x2={AX[0][0]} y2={AX[0][1]} stroke="#f1f5f9" strokeWidth="0.5" />
              <line x1={CX} y1={CY} x2={AX[1][0]} y2={AX[1][1]} stroke="#f1f5f9" strokeWidth="0.5" />
              <line x1={CX} y1={CY} x2={AX[2][0]} y2={AX[2][1]} stroke="#f1f5f9" strokeWidth="0.5" />
              <line x1={CX} y1={CY} x2={AX[3][0]} y2={AX[3][1]} stroke="#f1f5f9" strokeWidth="0.5" />
              <line x1={CX} y1={CY} x2={AX[4][0]} y2={AX[4][1]} stroke="#f1f5f9" strokeWidth="0.5" />
              <line x1={CX} y1={CY} x2={AX[5][0]} y2={AX[5][1]} stroke="#f1f5f9" strokeWidth="0.5" />
              <path d={rPath} fill={`${tc}22`} stroke={tc} strokeWidth="2" />
              <circle cx={dp[0][0]} cy={dp[0][1]} r="3.5" fill={tc} />
              <circle cx={dp[1][0]} cy={dp[1][1]} r="3.5" fill={tc} />
              <circle cx={dp[2][0]} cy={dp[2][1]} r="3.5" fill={tc} />
              <circle cx={dp[3][0]} cy={dp[3][1]} r="3.5" fill={tc} />
              <circle cx={dp[4][0]} cy={dp[4][1]} r="3.5" fill={tc} />
              <circle cx={dp[5][0]} cy={dp[5][1]} r="3.5" fill={tc} />
            </svg>
          </div>

          {/* Bars */}
          <div style={{ display: "flex", flexDirection: "column", flex: 1, marginLeft: 16, justifyContent: "center" }}>
            <div style={{ display: "flex", fontSize: 10, color: "#94a3b8", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 4 }}>Vs. League Average</div>
            <div style={{ display: "flex", alignItems: "center", padding: "7px 0", borderBottom: "1px solid #f1f5f9" }}>
              <div style={{ display: "flex", width: 60, fontSize: 11, color: "#64748b", fontWeight: 600 }}>{bars[0].l}</div>
              <div style={{ display: "flex", flex: 1, height: 14, backgroundColor: "#f1f5f9", borderRadius: 3 }}><div style={{ display: "flex", width: `${bars[0].p}%`, height: "100%", backgroundColor: bars[0].d >= 0 ? "#86efac" : "#fca5a5", borderRadius: 3 }} /></div>
              <div style={{ display: "flex", width: 64, justifyContent: "flex-end", fontSize: 14, fontWeight: 800, color: "#0f172a" }}>{bars[0].v}</div>
            </div>
            <div style={{ display: "flex", alignItems: "center", padding: "7px 0", borderBottom: "1px solid #f1f5f9" }}>
              <div style={{ display: "flex", width: 60, fontSize: 11, color: "#64748b", fontWeight: 600 }}>{bars[1].l}</div>
              <div style={{ display: "flex", flex: 1, height: 14, backgroundColor: "#f1f5f9", borderRadius: 3 }}><div style={{ display: "flex", width: `${bars[1].p}%`, height: "100%", backgroundColor: bars[1].d >= 0 ? "#86efac" : "#fca5a5", borderRadius: 3 }} /></div>
              <div style={{ display: "flex", width: 64, justifyContent: "flex-end", fontSize: 14, fontWeight: 800, color: "#0f172a" }}>{bars[1].v}</div>
            </div>
            <div style={{ display: "flex", alignItems: "center", padding: "7px 0", borderBottom: "1px solid #f1f5f9" }}>
              <div style={{ display: "flex", width: 60, fontSize: 11, color: "#64748b", fontWeight: 600 }}>{bars[2].l}</div>
              <div style={{ display: "flex", flex: 1, height: 14, backgroundColor: "#f1f5f9", borderRadius: 3 }}><div style={{ display: "flex", width: `${bars[2].p}%`, height: "100%", backgroundColor: bars[2].d >= 0 ? "#86efac" : "#fca5a5", borderRadius: 3 }} /></div>
              <div style={{ display: "flex", width: 64, justifyContent: "flex-end", fontSize: 14, fontWeight: 800, color: "#0f172a" }}>{bars[2].v}</div>
            </div>
            <div style={{ display: "flex", alignItems: "center", padding: "7px 0", borderBottom: "1px solid #f1f5f9" }}>
              <div style={{ display: "flex", width: 60, fontSize: 11, color: "#64748b", fontWeight: 600 }}>{bars[3].l}</div>
              <div style={{ display: "flex", flex: 1, height: 14, backgroundColor: "#f1f5f9", borderRadius: 3 }}><div style={{ display: "flex", width: `${bars[3].p}%`, height: "100%", backgroundColor: bars[3].d >= 0 ? "#86efac" : "#fca5a5", borderRadius: 3 }} /></div>
              <div style={{ display: "flex", width: 64, justifyContent: "flex-end", fontSize: 14, fontWeight: 800, color: "#0f172a" }}>{bars[3].v}</div>
            </div>
            <div style={{ display: "flex", alignItems: "center", padding: "7px 0" }}>
              <div style={{ display: "flex", width: 60, fontSize: 11, color: "#64748b", fontWeight: 600 }}>{bars[4].l}</div>
              <div style={{ display: "flex", flex: 1, height: 14, backgroundColor: "#f1f5f9", borderRadius: 3 }}><div style={{ display: "flex", width: `${bars[4].p}%`, height: "100%", backgroundColor: bars[4].d >= 0 ? "#86efac" : "#fca5a5", borderRadius: 3 }} /></div>
              <div style={{ display: "flex", width: 64, justifyContent: "flex-end", fontSize: 14, fontWeight: 800, color: "#0f172a" }}>{bars[4].v}</div>
            </div>
          </div>
        </div>

        {/* Bottom stats */}
        <div style={{ display: "flex", padding: "6px 36px 4px", borderTop: "1px solid #e2e8f0" }}>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", flex: 1 }}><div style={{ display: "flex", fontSize: 10, color: "#94a3b8", fontWeight: 600, textTransform: "uppercase" }}>{bot[0].l}</div><div style={{ display: "flex", fontSize: 20, fontWeight: 800, color: "#0f172a" }}>{bot[0].v}</div></div>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", flex: 1 }}><div style={{ display: "flex", fontSize: 10, color: "#94a3b8", fontWeight: 600, textTransform: "uppercase" }}>{bot[1].l}</div><div style={{ display: "flex", fontSize: 20, fontWeight: 800, color: "#0f172a" }}>{bot[1].v}</div></div>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", flex: 1 }}><div style={{ display: "flex", fontSize: 10, color: "#94a3b8", fontWeight: 600, textTransform: "uppercase" }}>{bot[2].l}</div><div style={{ display: "flex", fontSize: 20, fontWeight: 800, color: "#0f172a" }}>{bot[2].v}</div></div>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", flex: 1 }}><div style={{ display: "flex", fontSize: 10, color: "#94a3b8", fontWeight: 600, textTransform: "uppercase" }}>{bot[3].l}</div><div style={{ display: "flex", fontSize: 20, fontWeight: 800, color: "#0f172a" }}>{bot[3].v}</div></div>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", flex: 1 }}><div style={{ display: "flex", fontSize: 10, color: "#94a3b8", fontWeight: 600, textTransform: "uppercase" }}>{bot[4].l}</div><div style={{ display: "flex", fontSize: 20, fontWeight: 800, color: "#0f172a" }}>{bot[4].v}</div></div>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", flex: 1 }}><div style={{ display: "flex", fontSize: 10, color: "#94a3b8", fontWeight: 600, textTransform: "uppercase" }}>{bot[5].l}</div><div style={{ display: "flex", fontSize: 20, fontWeight: 800, color: "#0f172a" }}>{bot[5].v}</div></div>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", padding: "2px 36px 8px" }}>
          <div style={{ display: "flex", fontSize: 12, color: "#94a3b8", fontWeight: 600 }}>yardsperpass.com</div>
          <div style={{ display: "flex", fontSize: 10, color: "#cbd5e1" }}>Data: nflverse play-by-play</div>
        </div>
      </div>
    ),
    { ...size, fonts: [{ name: "Inter", data: fontData, style: "normal", weight: 800 }] }
  );
}
