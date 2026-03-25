// app/card/[slug]/opengraph-image.tsx — stat card: chips + bars + counting stats
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

// Position configs
const QB_CHIP = { keys: ["epa_per_db","cpoe","adot","success_rate","passer_rating","any_a"], labels: ["EPA/DB","CPOE","aDOT","Success%","Rating","ANY/A"] };
const QB_BAR = { keys: ["passing_yards","touchdowns","interceptions","completion_pct","rush_yards"], labels: ["Pass Yds","Pass TD","INT","Comp%","Rush Yds"] };
const QB_BOT = { keys: ["passing_yards","touchdowns","interceptions","completions","attempts","sacks"], labels: ["Pass Yds","TD","INT","Cmp","Att","Sk"] };

const WR_CHIP = { keys: ["epa_per_target","croe","air_yards_per_target","yac_per_reception","yards_per_route_run","target_share"], labels: ["EPA/Tgt","CROE","aDOT","YAC/Rec","YPRR","Tgt Share"] };
const WR_BAR = { keys: ["receiving_yards","receiving_tds","receptions","catch_rate","snap_share"], labels: ["Yards","TD","Rec","Catch%","Snap%"] };
const WR_BOT = { keys: ["targets","receptions","receiving_yards","receiving_tds","catch_rate","routes_run"], labels: ["Tgt","Rec","Yds","TD","Catch%","Routes"] };

const RB_CHIP = { keys: ["epa_per_carry","success_rate","stuff_rate","explosive_rate","yards_per_carry"], labels: ["EPA/Car","Success%","Stuff%","Explosive%","YPC"] };
const RB_BAR = { keys: ["rushing_yards","rushing_tds","carries","receiving_yards","receptions"], labels: ["Rush Yds","Rush TD","Carries","Rec Yds","Rec"] };
const RB_BOT = { keys: ["carries","rushing_yards","rushing_tds","receptions","receiving_yards","receiving_tds"], labels: ["Car","Rush Yds","Rush TD","Rec","Rec Yds","Rec TD"] };

export default async function Image({ params }: { params: { slug: string } }) {
  const fontData = await interBold;
  const player = await getPlayerBySlug(params.slug);
  const team = player ? getTeam(player.current_team_id) : null;
  const tc = team?.primaryColor || "#0f172a";
  const nm = player?.player_name || "Player";
  const pos = player?.position || "";
  const isQB = pos === "QB";
  const isRB = pos === "RB" || pos === "FB";

  const chipCfg = isQB ? QB_CHIP : isRB ? RB_CHIP : WR_CHIP;
  const barCfg = isQB ? QB_BAR : isRB ? RB_BAR : WR_BAR;
  const botCfg = isQB ? QB_BOT : isRB ? RB_BOT : WR_BOT;

  let chips: { l: string; v: string; r: string }[] = chipCfg.labels.map(l => ({ l, v: "\u2014", r: "" }));
  let bars: { l: string; v: string; d: number; p: number }[] = barCfg.labels.map(l => ({ l, v: "\u2014", d: 0, p: 0 }));
  let bot: { l: string; v: string }[] = botCfg.labels.map(l => ({ l, v: "\u2014" }));

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
        const ps = pool.length;

        chips = chipCfg.keys.map((k, i) => {
          const v = n(k);
          const sorted = pool.map(r => { const x = r[k]; return typeof x === "number" ? x : NaN; }).filter(x => !isNaN(x)).sort((a, b) => b - a);
          const rank = sorted.findIndex(x => v >= x) + 1;
          return { l: chipCfg.labels[i], v: fmtVal(k, v), r: isNaN(v) ? "" : `${rank} of ${ps}` };
        });

        bars = barCfg.keys.map((k, i) => {
          const v = n(k);
          const pv = pool.map(r => { const x = r[k]; return typeof x === "number" ? x : NaN; }).filter(x => !isNaN(x));
          const avg = pv.length ? pv.reduce((a, b) => a + b, 0) / pv.length : 0;
          const d = v - avg;
          const p = avg !== 0 ? Math.min(Math.abs(d / avg) * 100, 50) : 0;
          return { l: barCfg.labels[i], v: fmtVal(k, v), d, p };
        });

        bot = botCfg.keys.map((k, i) => ({ l: botCfg.labels[i], v: fmtVal(k, n(k)) }));
      }
    } catch { /* defaults */ }
  }

  while (chips.length < 6) chips.push({ l: "", v: "", r: "" });
  while (bars.length < 5) bars.push({ l: "", v: "\u2014", d: 0, p: 0 });
  while (bot.length < 6) bot.push({ l: "", v: "" });

  // Helper for chip box
  const chip = (c: { l: string; v: string; r: string }) => (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", width: 150, padding: "8px 0" }}>
      <div style={{ display: "flex", fontSize: 10, color: "#94a3b8", fontWeight: 600, textTransform: "uppercase" }}>{c.l}</div>
      <div style={{ display: "flex", fontSize: 26, fontWeight: 800, color: "#0f172a", marginTop: 2 }}>{c.v}</div>
      <div style={{ display: "flex", fontSize: 9, color: "#94a3b8" }}>{c.r}</div>
    </div>
  );

  const bar = (b: { l: string; v: string; d: number; p: number }) => (
    <div style={{ display: "flex", alignItems: "center", padding: "6px 0", borderBottom: "1px solid #f1f5f9" }}>
      <div style={{ display: "flex", width: 60, fontSize: 11, color: "#64748b", fontWeight: 600 }}>{b.l}</div>
      <div style={{ display: "flex", flex: 1, height: 14, backgroundColor: "#f1f5f9", borderRadius: 3 }}>
        <div style={{ display: "flex", width: `${b.p}%`, height: "100%", backgroundColor: b.d >= 0 ? "#86efac" : "#fca5a5", borderRadius: 3 }} />
      </div>
      <div style={{ display: "flex", width: 64, justifyContent: "flex-end", fontSize: 14, fontWeight: 800, color: "#0f172a" }}>{b.v}</div>
    </div>
  );

  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", backgroundColor: "#ffffff", fontFamily: "Inter" }}>
        <div style={{ width: "100%", height: 6, backgroundColor: tc, display: "flex" }} />
        <div style={{ display: "flex", padding: "14px 36px 4px" }}>
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ display: "flex", fontSize: 34, fontWeight: 800, color: "#0f172a" }}>{nm}</div>
            <div style={{ display: "flex", fontSize: 14, color: "#64748b", marginTop: 2 }}>
              {pos} {team ? `\u00B7 ${team.name}` : ""} {"\u00B7"} 2025 Season
            </div>
          </div>
        </div>

        {/* Main: Chips left, Bars right */}
        <div style={{ display: "flex", flex: 1, padding: "4px 36px 0" }}>
          <div style={{ display: "flex", flexDirection: "column", width: 470 }}>
            <div style={{ display: "flex", fontSize: 10, color: "#94a3b8", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 4 }}>Performance Profile</div>
            <div style={{ display: "flex", flexWrap: "wrap" }}>
              {chip(chips[0])}{chip(chips[1])}{chip(chips[2])}
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", borderTop: "1px solid #f1f5f9" }}>
              {chip(chips[3])}{chip(chips[4])}{chips[5].l ? chip(chips[5]) : null}
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", flex: 1, marginLeft: 24, justifyContent: "center" }}>
            <div style={{ display: "flex", fontSize: 10, color: "#94a3b8", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 4 }}>Vs. League Average</div>
            {bar(bars[0])}{bar(bars[1])}{bar(bars[2])}{bar(bars[3])}{bar(bars[4])}
          </div>
        </div>

        {/* Bottom stats */}
        <div style={{ display: "flex", padding: "8px 36px 4px", borderTop: "1px solid #e2e8f0" }}>
          {bot.map((s, i) => (
            <div key={i} style={{ display: "flex", flexDirection: "column", alignItems: "center", flex: 1, padding: "4px 0" }}>
              <div style={{ display: "flex", fontSize: 10, color: "#94a3b8", fontWeight: 600, textTransform: "uppercase" }}>{s.l}</div>
              <div style={{ display: "flex", fontSize: 20, fontWeight: 800, color: "#0f172a" }}>{s.v}</div>
            </div>
          ))}
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 36px 8px" }}>
          <div style={{ display: "flex", fontSize: 12, color: "#94a3b8", fontWeight: 600 }}>yardsperpass.com</div>
          <div style={{ display: "flex", fontSize: 10, color: "#cbd5e1" }}>Data: nflverse play-by-play</div>
        </div>
      </div>
    ),
    { ...size, fonts: [{ name: "Inter", data: fontData, style: "normal", weight: 800 }] }
  );
}
