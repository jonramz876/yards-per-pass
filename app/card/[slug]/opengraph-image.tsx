// app/card/[slug]/opengraph-image.tsx — stat card as OG image
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

// Radar keys removed — using approximate ranges instead of percentile pools for speed
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

export default async function Image({ params }: { params: { slug: string } }) {
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

  // Fetch just this player's stats (single row, fast query)
  const supabase = createServerClient();
  const table = isQB ? "qb_season_stats" : isRB ? "rb_season_stats" : "receiver_season_stats";
  const { data: statsRow } = await supabase
    .from(table)
    .select("*")
    .eq("player_id", player.player_id)
    .eq("season", season)
    .single();

  if (!statsRow) {
    return new ImageResponse(
      (<div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", backgroundColor: "#0f172a", color: "#fff", fontSize: 32, fontFamily: "Inter" }}>No stats found for {player.player_name}</div>),
      { ...size, fonts: [{ name: "Inter", data: fontData, style: "normal" as const, weight: 800 }] }
    );
  }

  const s = statsRow as Record<string, unknown>;
  const num = (key: string): number => { const v = s[key]; return typeof v === "number" ? v : NaN; };

  let radarLabels: string[];
  let radarValues: number[]; // Use raw 0-100 scale approximations instead of percentiles
  let displayStats: StatDisplay[];

  if (isQB) {
    radarLabels = QB_RADAR_LABELS;
    // Approximate percentiles using reasonable league ranges
    radarValues = [
      Math.min(100, Math.max(0, (num("epa_per_db") + 0.2) / 0.5 * 100)),  // EPA/DB: -0.2 to 0.3
      Math.min(100, Math.max(0, (num("cpoe") + 5) / 12 * 100)),            // CPOE: -5 to 7
      Math.min(100, Math.max(0, (num("dropbacks") / Math.max(num("games"), 1) - 20) / 20 * 100)), // DB/G: 20-40
      Math.min(100, Math.max(0, (num("adot") - 5) / 8 * 100)),             // aDOT: 5-13
      Math.min(100, Math.max(0, (1 - num("int_pct") / 100 * 4) * 100)),    // INT Rate (inverted)
      Math.min(100, Math.max(0, ((num("success_rate") || 0) - 0.3) / 0.25 * 100)), // Success: 30-55%
    ];
    displayStats = QB_DISPLAY_STATS.map((ds) => ({
      label: ds.label, value: isNaN(num(ds.key)) ? "—" : ds.fmt(num(ds.key)), rank: "",
    }));
  } else if (isRB) {
    radarLabels = RB_RADAR_LABELS;
    radarValues = [
      Math.min(100, Math.max(0, (num("carries") / Math.max(num("games"), 1) - 5) / 15 * 100)),
      Math.min(100, Math.max(0, (num("epa_per_carry") + 0.15) / 0.35 * 100)),
      Math.min(100, Math.max(0, (1 - (num("stuff_rate") || 0.2)) / 0.3 * 100)),
      Math.min(100, Math.max(0, ((num("explosive_rate") || 0) - 0.05) / 0.15 * 100)),
      Math.min(100, Math.max(0, ((num("targets") || 0) / Math.max(num("games"), 1)) / 5 * 100)),
      Math.min(100, Math.max(0, ((num("success_rate") || 0) - 0.3) / 0.25 * 100)),
    ];
    displayStats = RB_DISPLAY_STATS.map((ds) => ({
      label: ds.label, value: isNaN(num(ds.key)) ? "—" : ds.fmt(num(ds.key)), rank: "",
    }));
  } else {
    radarLabels = WR_RADAR_LABELS;
    radarValues = [
      Math.min(100, Math.max(0, (num("targets") / Math.max(num("games"), 1) - 2) / 8 * 100)),
      Math.min(100, Math.max(0, (num("epa_per_target") + 0.1) / 0.4 * 100)),
      Math.min(100, Math.max(0, ((num("croe") || 0) + 0.1) / 0.2 * 100)),
      Math.min(100, Math.max(0, (num("air_yards_per_target") - 5) / 10 * 100)),
      Math.min(100, Math.max(0, ((num("yac_per_reception") || 0) - 2) / 8 * 100)),
      Math.min(100, Math.max(0, ((num("yards_per_route_run") || 0) - 0.5) / 2.5 * 100)),
    ];
    displayStats = WR_DISPLAY_STATS.map((ds) => ({
      label: ds.label, value: isNaN(num(ds.key)) ? "—" : ds.fmt(num(ds.key)), rank: "",
    }));
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
}
