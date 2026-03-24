// app/api/stat-card/[slug]/route.ts
import { ImageResponse } from "next/og";
import { getPlayerBySlug } from "@/lib/data/players";
import { getQBStats } from "@/lib/data/queries";
import { getReceiverStats } from "@/lib/data/receivers";
import { getRBSeasonStats } from "@/lib/data/rushing";
import { getTeam } from "@/lib/data/teams";
import { computePercentile, computeRank } from "@/lib/stats/percentiles";
import type { QBSeasonStat, ReceiverSeasonStat, RBSeasonStat } from "@/lib/types";

export const runtime = "nodejs";

const interBold = fetch(
  "https://fonts.gstatic.com/s/inter/v18/UcCO3FwrK3iLTeHuS_nVMrMxCp50SjIw2boKoduKmMEVuFuYMZhrib2Bg-4.ttf"
).then((res) => res.arrayBuffer());

const W = 1200;
const H = 630; // Twitter summary_large_image spec

// --- Radar chart math (same as RadarChart.tsx) ---
const CX = 150;
const CY = 140;
const R = 110;
const R_MID = 55;

function hexPt(radius: number, i: number): [number, number] {
  const angle = -Math.PI / 2 + (i * Math.PI) / 3;
  return [CX + radius * Math.cos(angle), CY + radius * Math.sin(angle)];
}

// Satori doesn't support <polygon> — use <path d="M...Z"> instead
function hexPath(radius: number): string {
  const pts = Array.from({ length: 6 }, (_, i) => hexPt(radius, i));
  return pts.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ") + " Z";
}

function dataPath(values: number[]): string {
  const pts = values.map((pct, i) => {
    const clamped = Math.max(0, Math.min(pct, 100));
    return hexPt((clamped / 100) * R, i);
  });
  return pts.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ") + " Z";
}

// --- Position-specific configs ---
type StatDisplay = { label: string; value: string; rank: string };

function getQBRadarVal(qb: QBSeasonStat, key: string): number {
  switch (key) {
    case "epa_per_db": return qb.epa_per_db ?? NaN;
    case "cpoe": return qb.cpoe ?? NaN;
    case "dropbacks_game": return qb.games ? qb.dropbacks / qb.games : NaN;
    case "adot": return qb.adot ?? NaN;
    case "inv_int_pct": return qb.attempts > 0 ? 1 - (qb.interceptions / qb.attempts) : NaN;
    case "success_rate": return qb.success_rate ?? NaN;
    default: return NaN;
  }
}

function getWRRadarVal(rec: ReceiverSeasonStat, key: string): number {
  switch (key) {
    case "targets_game": return rec.games ? rec.targets / rec.games : NaN;
    case "epa_per_target": return rec.epa_per_target ?? NaN;
    case "croe": return rec.croe ?? NaN;
    case "air_yards_per_target": return rec.air_yards_per_target ?? NaN;
    case "yac_per_reception": return rec.yac_per_reception ?? NaN;
    case "yards_per_route_run": return rec.yards_per_route_run ?? NaN;
    default: return NaN;
  }
}

function getRBRadarVal(rb: RBSeasonStat, key: string): number {
  switch (key) {
    case "carries_game": return rb.games ? rb.carries / rb.games : NaN;
    case "epa_per_carry": return rb.epa_per_carry ?? NaN;
    case "stuff_avoid": return rb.stuff_rate != null ? 1 - rb.stuff_rate : NaN;
    case "explosive_rate": return rb.explosive_rate ?? NaN;
    case "targets_game": return rb.games ? rb.targets / rb.games : NaN;
    case "success_rate": return rb.success_rate ?? NaN;
    default: return NaN;
  }
}

const QB_RADAR_KEYS = ["epa_per_db", "cpoe", "dropbacks_game", "adot", "inv_int_pct", "success_rate"];
const QB_RADAR_LABELS = ["EPA/DB", "CPOE", "DB/G", "aDOT", "INT Rate", "Success%"];
const QB_DISPLAY_STATS = [
  { key: "epa_per_db", label: "EPA/DB", fmt: (v: number) => v.toFixed(2) },
  { key: "cpoe", label: "CPOE", fmt: (v: number) => (v >= 0 ? "+" : "") + v.toFixed(1) },
  { key: "any_a", label: "ANY/A", fmt: (v: number) => v.toFixed(1) },
  { key: "passer_rating", label: "Rating", fmt: (v: number) => v.toFixed(1) },
  { key: "passing_yards", label: "Pass Yds", fmt: (v: number) => v.toLocaleString() },
  { key: "touchdowns", label: "Pass TD", fmt: (v: number) => v.toString() },
  { key: "interceptions", label: "INT", fmt: (v: number) => v.toString() },
  { key: "success_rate", label: "Success%", fmt: (v: number) => (v * 100).toFixed(1) + "%" },
];

const WR_RADAR_KEYS = ["targets_game", "epa_per_target", "croe", "air_yards_per_target", "yac_per_reception", "yards_per_route_run"];
const WR_RADAR_LABELS = ["Tgt/G", "EPA/Tgt", "CROE", "aDOT", "YAC/Rec", "YPRR"];
const WR_DISPLAY_STATS = [
  { key: "epa_per_target", label: "EPA/Tgt", fmt: (v: number) => v.toFixed(2) },
  { key: "croe", label: "CROE", fmt: (v: number) => (v >= 0 ? "+" : "") + (v * 100).toFixed(1) + "%" },
  { key: "yards_per_route_run", label: "YPRR", fmt: (v: number) => v.toFixed(2) },
  { key: "receiving_yards", label: "Yards", fmt: (v: number) => v.toLocaleString() },
  { key: "receiving_tds", label: "TD", fmt: (v: number) => v.toString() },
  { key: "catch_rate", label: "Catch%", fmt: (v: number) => (v * 100).toFixed(1) + "%" },
  { key: "target_share", label: "Tgt Share", fmt: (v: number) => (v * 100).toFixed(1) + "%" },
];

const RB_RADAR_KEYS = ["carries_game", "epa_per_carry", "stuff_avoid", "explosive_rate", "targets_game", "success_rate"];
const RB_RADAR_LABELS = ["Car/G", "EPA/Car", "Stuff Av", "Expl%", "Tgt/G", "Success%"];
const RB_DISPLAY_STATS = [
  { key: "epa_per_carry", label: "EPA/Car", fmt: (v: number) => v.toFixed(2) },
  { key: "rushing_yards", label: "Rush Yds", fmt: (v: number) => v.toLocaleString() },
  { key: "rushing_tds", label: "Rush TD", fmt: (v: number) => v.toString() },
  { key: "yards_per_carry", label: "YPC", fmt: (v: number) => v.toFixed(1) },
  { key: "success_rate", label: "Success%", fmt: (v: number) => (v * 100).toFixed(1) + "%" },
  { key: "stuff_rate", label: "Stuff%", fmt: (v: number) => (v * 100).toFixed(1) + "%" },
  { key: "explosive_rate", label: "Explosive%", fmt: (v: number) => (v * 100).toFixed(1) + "%" },
];

// Label positions around the radar (adjusted for card layout)
const LABEL_POS: { x: number; y: number; anchor: string }[] = [
  { x: 150, y: 14, anchor: "middle" },
  { x: 270, y: 78, anchor: "start" },
  { x: 270, y: 210, anchor: "start" },
  { x: 150, y: 272, anchor: "middle" },
  { x: 30, y: 210, anchor: "end" },
  { x: 30, y: 78, anchor: "end" },
];

export async function GET(
  _req: Request,
  { params }: { params: { slug: string } }
) {
  try {
  const fontData = await interBold;
  const season = 2025;

  // Look up player
  const player = await getPlayerBySlug(params.slug);
  if (!player) {
    return new Response("Player not found", { status: 404 });
  }

  const team = getTeam(player.current_team_id);
  const teamColor = team?.primaryColor || "#0f172a";
  const isQB = player.position === "QB";
  const isRB = player.position === "RB" || player.position === "FB";

  // Fetch position pool + find player's stats
  let radarValues: number[] = [];
  let displayStats: StatDisplay[] = [];
  let radarLabels: string[] = [];

  if (isQB) {
    const pool = await getQBStats(season);
    const me = pool.find((q) => q.player_id === player.player_id);
    if (!me) return new Response("No stats for this player", { status: 404 });

    radarLabels = QB_RADAR_LABELS;
    const qualPool = pool.filter((q) => q.dropbacks >= 100);
    radarValues = QB_RADAR_KEYS.map((k) => {
      const sorted = qualPool.map((q) => getQBRadarVal(q, k)).filter((v) => !isNaN(v)).sort((a, b) => a - b);
      return computePercentile(sorted, getQBRadarVal(me, k));
    });

    displayStats = QB_DISPLAY_STATS.map((s) => {
      const val = (me as unknown as Record<string, unknown>)[s.key];
      const v = typeof val === "number" ? val : NaN;
      const poolVals = qualPool.map((q) => {
        const pv = (q as unknown as Record<string, unknown>)[s.key];
        return typeof pv === "number" ? pv : NaN;
      }).filter((x) => !isNaN(x));
      const rank = computeRank(poolVals, v);
      return { label: s.label, value: isNaN(v) ? "—" : s.fmt(v), rank: isNaN(v) ? "" : `QB${rank}` };
    });
  } else if (isRB) {
    const pool = await getRBSeasonStats(season);
    const me = pool.find((r) => r.player_id === player.player_id);
    if (!me) return new Response("No stats for this player", { status: 404 });

    radarLabels = RB_RADAR_LABELS;
    const qualPool = pool.filter((r) => r.carries >= 50);
    radarValues = RB_RADAR_KEYS.map((k) => {
      const sorted = qualPool.map((r) => getRBRadarVal(r, k)).filter((v) => !isNaN(v)).sort((a, b) => a - b);
      return computePercentile(sorted, getRBRadarVal(me, k));
    });

    displayStats = RB_DISPLAY_STATS.map((s) => {
      const val = (me as unknown as Record<string, unknown>)[s.key];
      const v = typeof val === "number" ? val : NaN;
      const poolVals = qualPool.map((r) => {
        const pv = (r as unknown as Record<string, unknown>)[s.key];
        return typeof pv === "number" ? pv : NaN;
      }).filter((x) => !isNaN(x));
      const rank = computeRank(poolVals, v);
      return { label: s.label, value: isNaN(v) ? "—" : s.fmt(v), rank: isNaN(v) ? "" : `RB${rank}` };
    });
  } else {
    // WR/TE
    const pool = await getReceiverStats(season);
    const me = pool.find((r) => r.player_id === player.player_id);
    if (!me) return new Response("No stats for this player", { status: 404 });

    const pos = me.position;
    radarLabels = WR_RADAR_LABELS;
    const minRoutes = pos === "TE" ? 100 : 200;
    const qualPool = pool.filter((r) => r.position === pos && r.routes_run >= minRoutes);
    radarValues = WR_RADAR_KEYS.map((k) => {
      const sorted = qualPool.map((r) => getWRRadarVal(r, k)).filter((v) => !isNaN(v)).sort((a, b) => a - b);
      return computePercentile(sorted, getWRRadarVal(me, k));
    });

    displayStats = WR_DISPLAY_STATS.map((s) => {
      const val = (me as unknown as Record<string, unknown>)[s.key];
      const v = typeof val === "number" ? val : NaN;
      const poolVals = qualPool.map((r) => {
        const pv = (r as unknown as Record<string, unknown>)[s.key];
        return typeof pv === "number" ? pv : NaN;
      }).filter((x) => !isNaN(x));
      const rank = computeRank(poolVals, v);
      return { label: s.label, value: isNaN(v) ? "—" : s.fmt(v), rank: isNaN(v) ? "" : `${pos}${rank}` };
    });
  }

  // Build radar path strings (Satori requires <path>, not <polygon>)
  const radarPath = dataPath(radarValues);
  const outerPath = hexPath(R);
  const midPath = hexPath(R_MID);

  return new ImageResponse(
    (
      <div
        style={{
          width: W,
          height: H,
          display: "flex",
          flexDirection: "column",
          backgroundColor: "#ffffff",
          fontFamily: "Inter",
          position: "relative",
        }}
      >
        {/* Team color header bar */}
        <div style={{ width: "100%", height: 6, backgroundColor: teamColor, display: "flex" }} />

        {/* Top section: name + info */}
        <div style={{ display: "flex", padding: "24px 40px 16px", alignItems: "center", gap: 16 }}>
          <div style={{ display: "flex", flexDirection: "column", flex: 1 }}>
            <div style={{ display: "flex", fontSize: 42, fontWeight: 800, color: "#0f172a", lineHeight: 1.1 }}>
              {player.player_name}
            </div>
            <div style={{ display: "flex", fontSize: 18, color: "#64748b", marginTop: 6, gap: 12 }}>
              <span>{player.position}</span>
              <span style={{ color: "#cbd5e1" }}>·</span>
              <span>{team?.name || player.current_team_id}</span>
              <span style={{ color: "#cbd5e1" }}>·</span>
              <span>{season} Season</span>
            </div>
          </div>
        </div>

        {/* Main content: radar + stats */}
        <div style={{ display: "flex", flex: 1, padding: "0 40px", gap: 40 }}>
          {/* Radar chart */}
          <div style={{ display: "flex", width: 300, height: 300, flexShrink: 0, alignItems: "center", justifyContent: "center" }}>
            <svg viewBox="0 0 300 290" width="300" height="290">
              {/* Outer ring — Satori: <path> not <polygon> */}
              <path d={outerPath} fill="none" stroke="#e2e8f0" strokeWidth="1" />
              {/* 50th percentile ring — solid (Satori doesn't support strokeDasharray) */}
              <path d={midPath} fill="rgba(251,191,36,0.08)" stroke="#f59e0b" strokeWidth="0.75" opacity="0.6" />
              {/* Axis lines */}
              {Array.from({ length: 6 }).map((_, i) => {
                const [x, y] = hexPt(R, i);
                return <line key={i} x1={CX} y1={CY} x2={x} y2={y} stroke="#f1f5f9" strokeWidth="0.5" />;
              })}
              {/* Data shape */}
              <path d={radarPath} fill={`${teamColor}25`} stroke={teamColor} strokeWidth="2.5" />
              {/* Data dots */}
              {radarValues.map((pct, i) => {
                const [x, y] = hexPt((Math.min(Math.max(pct, 0), 100) / 100) * R, i);
                return <circle key={i} cx={x} cy={y} r="4" fill={teamColor} />;
              })}
              {/* Labels — bumped to 18px for readability at Twitter preview size */}
              {radarLabels.map((label, i) => (
                <text
                  key={label}
                  x={LABEL_POS[i].x}
                  y={LABEL_POS[i].y}
                  textAnchor={LABEL_POS[i].anchor as "start" | "middle" | "end"}
                  fontSize="16"
                  fill="#475569"
                  fontWeight="600"
                  fontFamily="Inter"
                >
                  {label}
                </text>
              ))}
            </svg>
          </div>

          {/* Stats column */}
          <div style={{ display: "flex", flexDirection: "column", flex: 1, justifyContent: "center", gap: 2 }}>
            {displayStats.map((stat) => (
              <div
                key={stat.label}
                style={{
                  display: "flex",
                  alignItems: "center",
                  padding: "8px 0",
                  borderBottom: "1px solid #f1f5f9",
                }}
              >
                <div style={{ display: "flex", width: 100, fontSize: 14, color: "#64748b", fontWeight: 600 }}>
                  {stat.label}
                </div>
                <div style={{ display: "flex", flex: 1, fontSize: 24, fontWeight: 800, color: "#0f172a" }}>
                  {stat.value}
                </div>
                <div style={{ display: "flex", fontSize: 14, color: teamColor, fontWeight: 700 }}>
                  {stat.rank}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Footer */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            padding: "12px 40px",
            borderTop: "1px solid #e2e8f0",
          }}
        >
          <div style={{ display: "flex", fontSize: 14, color: "#94a3b8", fontWeight: 600 }}>
            yardsperpass.com
          </div>
          <div style={{ display: "flex", fontSize: 12, color: "#cbd5e1" }}>
            Data: nflverse play-by-play
          </div>
        </div>
      </div>
    ),
    {
      width: W,
      height: H,
      fonts: [{ name: "Inter", data: fontData, style: "normal", weight: 800 }],
      headers: {
        "Cache-Control": "public, max-age=3600, s-maxage=86400, stale-while-revalidate=43200",
      },
    }
  );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return new Response(`Error generating stat card: ${message}`, { status: 500 });
  }
}
