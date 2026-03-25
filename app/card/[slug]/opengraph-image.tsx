// app/card/[slug]/opengraph-image.tsx — shareable stat card PNG
import { ImageResponse } from "next/og";
import { getPlayerBySlug } from "@/lib/data/players";
import { getTeam } from "@/lib/data/teams";
// Use direct fetch instead of createServerClient (OG image context doesn't support it)

export const runtime = "nodejs";
export const alt = "Player Stat Card — Yards Per Pass";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const interBold = fetch(
  "https://fonts.gstatic.com/s/inter/v18/UcCO3FwrK3iLTeHuS_nVMrMxCp50SjIw2boKoduKmMEVuFuYMZhrib2Bg-4.ttf"
).then((res) => res.arrayBuffer());

// --- Radar math (Satori-safe: <path> only, no <polygon>) ---
const CX = 150;
const CY = 140;
const R = 110;

function hexPt(radius: number, i: number): [number, number] {
  const angle = -Math.PI / 2 + (i * Math.PI) / 3;
  return [CX + radius * Math.cos(angle), CY + radius * Math.sin(angle)];
}

function hexPath(radius: number): string {
  const pts = Array.from({ length: 6 }, (_, i) => hexPt(radius, i));
  return pts.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ") + " Z";
}

function dataPath(values: number[]): string {
  const pts = values.map((pct, i) => {
    const safe = isNaN(pct) ? 0 : Math.max(0, Math.min(pct, 100));
    return hexPt((safe / 100) * R, i);
  });
  return pts.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ") + " Z";
}

// Pre-computed paths (static, no .map() in JSX)
const OUTER = hexPath(R);
const MID = hexPath(55);

// Axis label positions
const LP = [
  { x: 150, y: 14 }, { x: 270, y: 78 }, { x: 270, y: 210 },
  { x: 150, y: 272 }, { x: 30, y: 210 }, { x: 30, y: 78 },
];
// Axis line endpoints
const AX = Array.from({ length: 6 }, (_, i) => hexPt(R, i));

type Fmt = { key: string; label: string; fmt: (v: number) => string };

const QB_LABELS = ["EPA/DB", "CPOE", "DB/G", "aDOT", "INT Rate", "Success%"];
const QB_STATS: Fmt[] = [
  { key: "epa_per_db", label: "EPA/DB", fmt: (v) => v.toFixed(2) },
  { key: "cpoe", label: "CPOE", fmt: (v) => (v >= 0 ? "+" : "") + v.toFixed(1) },
  { key: "any_a", label: "ANY/A", fmt: (v) => v.toFixed(1) },
  { key: "passer_rating", label: "Rating", fmt: (v) => v.toFixed(1) },
  { key: "passing_yards", label: "Pass Yds", fmt: (v) => Math.round(v).toLocaleString() },
  { key: "touchdowns", label: "Pass TD", fmt: (v) => Math.round(v).toString() },
  { key: "interceptions", label: "INT", fmt: (v) => Math.round(v).toString() },
  { key: "success_rate", label: "Success%", fmt: (v) => (v * 100).toFixed(1) + "%" },
];

const WR_LABELS = ["Tgt/G", "EPA/Tgt", "CROE", "aDOT", "YAC/Rec", "YPRR"];
const WR_STATS: Fmt[] = [
  { key: "epa_per_target", label: "EPA/Tgt", fmt: (v) => v.toFixed(2) },
  { key: "croe", label: "CROE", fmt: (v) => (v >= 0 ? "+" : "") + (v * 100).toFixed(1) + "%" },
  { key: "yards_per_route_run", label: "YPRR", fmt: (v) => v.toFixed(2) },
  { key: "receiving_yards", label: "Yards", fmt: (v) => Math.round(v).toLocaleString() },
  { key: "receiving_tds", label: "TD", fmt: (v) => Math.round(v).toString() },
  { key: "catch_rate", label: "Catch%", fmt: (v) => (v * 100).toFixed(1) + "%" },
  { key: "target_share", label: "Tgt Share", fmt: (v) => (v * 100).toFixed(1) + "%" },
];

const RB_LABELS = ["Car/G", "EPA/Car", "Stuff Av", "Expl%", "Tgt/G", "Success%"];
const RB_STATS: Fmt[] = [
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
  if (!player) {
    return new ImageResponse(
      (<div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", backgroundColor: "#0f172a", color: "#fff", fontSize: 32, fontFamily: "Inter" }}>Player not found</div>),
      { ...size, fonts: [{ name: "Inter", data: fontData, style: "normal" as const, weight: 800 }] }
    );
  }

  const team = getTeam(player.current_team_id);
  const teamColor = team?.primaryColor || "#0f172a";
  const isQB = player.position === "QB";
  const isRB = player.position === "RB" || player.position === "FB";

  // Direct REST fetch (createServerClient doesn't work in OG image context)
  const table = isQB ? "qb_season_stats" : isRB ? "rb_season_stats" : "receiver_season_stats";
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  const res = await fetch(
    `${supabaseUrl}/rest/v1/${table}?player_id=eq.${player.player_id}&season=eq.2025&select=*&limit=1`,
    { headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` } }
  );
  const rows = await res.json();
  const row = rows?.[0] ?? null;
  const s = (row || {}) as Record<string, unknown>;
  const n = (k: string): number => { const v = s[k]; return typeof v === "number" ? v : NaN; };

  // Position-specific radar + stats
  let radarLabels: string[];
  let radarValues: number[];
  let stats: { label: string; value: string }[];

  if (isQB) {
    radarLabels = QB_LABELS;
    radarValues = [
      (n("epa_per_db") + 0.2) / 0.5 * 100,
      (n("cpoe") + 5) / 12 * 100,
      (n("dropbacks") / Math.max(n("games"), 1) - 20) / 20 * 100,
      (n("adot") - 5) / 8 * 100,
      (1 - (n("int_pct") || 3) / 100 * 4) * 100,
      ((n("success_rate") || 0) - 0.3) / 0.25 * 100,
    ];
    stats = QB_STATS.map((d) => ({ label: d.label, value: isNaN(n(d.key)) ? "\u2014" : d.fmt(n(d.key)) }));
  } else if (isRB) {
    radarLabels = RB_LABELS;
    radarValues = [
      (n("carries") / Math.max(n("games"), 1) - 5) / 15 * 100,
      (n("epa_per_carry") + 0.15) / 0.35 * 100,
      (1 - (n("stuff_rate") || 0.2)) / 0.3 * 100,
      ((n("explosive_rate") || 0) - 0.05) / 0.15 * 100,
      ((n("targets") || 0) / Math.max(n("games"), 1)) / 5 * 100,
      ((n("success_rate") || 0) - 0.3) / 0.25 * 100,
    ];
    stats = RB_STATS.map((d) => ({ label: d.label, value: isNaN(n(d.key)) ? "\u2014" : d.fmt(n(d.key)) }));
  } else {
    radarLabels = WR_LABELS;
    radarValues = [
      (n("targets") / Math.max(n("games"), 1) - 2) / 8 * 100,
      (n("epa_per_target") + 0.1) / 0.4 * 100,
      ((n("croe") || 0) + 0.1) / 0.2 * 100,
      (n("air_yards_per_target") - 5) / 10 * 100,
      ((n("yac_per_reception") || 0) - 2) / 8 * 100,
      ((n("yards_per_route_run") || 0) - 0.5) / 2.5 * 100,
    ];
    stats = WR_STATS.map((d) => ({ label: d.label, value: isNaN(n(d.key)) ? "\u2014" : d.fmt(n(d.key)) }));
  }

  const radar = dataPath(radarValues);

  // Pre-compute radar dot positions (no .map() in JSX)
  const dots = radarValues.map((pct, i) => {
    const safe = isNaN(pct) ? 0 : Math.max(0, Math.min(pct, 100));
    return hexPt((safe / 100) * R, i);
  });

  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", backgroundColor: "#ffffff", fontFamily: "Inter" }}>
        {/* Team color header */}
        <div style={{ width: "100%", height: 6, backgroundColor: teamColor, display: "flex" }} />

        {/* Name + info */}
        <div style={{ display: "flex", padding: "20px 40px 12px", alignItems: "center" }}>
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ display: "flex", fontSize: 42, fontWeight: 800, color: "#0f172a" }}>{player.player_name}</div>
            <div style={{ display: "flex", fontSize: 18, color: "#64748b", marginTop: 4 }}>
              {player.position} {team ? `\u00B7 ${team.name}` : ""} {"\u00B7"} 2025 Season
            </div>
          </div>
        </div>

        {/* Radar + Stats row */}
        <div style={{ display: "flex", flex: 1, padding: "0 40px" }}>
          {/* Radar chart */}
          <div style={{ display: "flex", width: 300, height: 300, alignItems: "center", justifyContent: "center" }}>
            <svg viewBox="0 0 300 290" width="300" height="290">
              <path d={OUTER} fill="none" stroke="#e2e8f0" strokeWidth="1" />
              <path d={MID} fill="rgba(251,191,36,0.08)" stroke="rgba(245,158,11,0.6)" strokeWidth="0.75" />
              <line x1={CX} y1={CY} x2={AX[0][0]} y2={AX[0][1]} stroke="#f1f5f9" strokeWidth="0.5" />
              <line x1={CX} y1={CY} x2={AX[1][0]} y2={AX[1][1]} stroke="#f1f5f9" strokeWidth="0.5" />
              <line x1={CX} y1={CY} x2={AX[2][0]} y2={AX[2][1]} stroke="#f1f5f9" strokeWidth="0.5" />
              <line x1={CX} y1={CY} x2={AX[3][0]} y2={AX[3][1]} stroke="#f1f5f9" strokeWidth="0.5" />
              <line x1={CX} y1={CY} x2={AX[4][0]} y2={AX[4][1]} stroke="#f1f5f9" strokeWidth="0.5" />
              <line x1={CX} y1={CY} x2={AX[5][0]} y2={AX[5][1]} stroke="#f1f5f9" strokeWidth="0.5" />
              <path d={radar} fill={`${teamColor}25`} stroke={teamColor} strokeWidth="2.5" />
              <circle cx={dots[0][0]} cy={dots[0][1]} r="4" fill={teamColor} />
              <circle cx={dots[1][0]} cy={dots[1][1]} r="4" fill={teamColor} />
              <circle cx={dots[2][0]} cy={dots[2][1]} r="4" fill={teamColor} />
              <circle cx={dots[3][0]} cy={dots[3][1]} r="4" fill={teamColor} />
              <circle cx={dots[4][0]} cy={dots[4][1]} r="4" fill={teamColor} />
              <circle cx={dots[5][0]} cy={dots[5][1]} r="4" fill={teamColor} />
              <text x={LP[0].x} y={LP[0].y} textAnchor="middle" fontSize="14" fill="#475569" fontWeight="600" fontFamily="Inter">{radarLabels[0]}</text>
              <text x={LP[1].x} y={LP[1].y} textAnchor="start" fontSize="14" fill="#475569" fontWeight="600" fontFamily="Inter">{radarLabels[1]}</text>
              <text x={LP[2].x} y={LP[2].y} textAnchor="start" fontSize="14" fill="#475569" fontWeight="600" fontFamily="Inter">{radarLabels[2]}</text>
              <text x={LP[3].x} y={LP[3].y} textAnchor="middle" fontSize="14" fill="#475569" fontWeight="600" fontFamily="Inter">{radarLabels[3]}</text>
              <text x={LP[4].x} y={LP[4].y} textAnchor="end" fontSize="14" fill="#475569" fontWeight="600" fontFamily="Inter">{radarLabels[4]}</text>
              <text x={LP[5].x} y={LP[5].y} textAnchor="end" fontSize="14" fill="#475569" fontWeight="600" fontFamily="Inter">{radarLabels[5]}</text>
            </svg>
          </div>

          {/* Stats column */}
          <div style={{ display: "flex", flexDirection: "column", flex: 1, justifyContent: "center", marginLeft: 40 }}>
            <div style={{ display: "flex", alignItems: "center", padding: "7px 0", borderBottom: "1px solid #f1f5f9" }}>
              <div style={{ display: "flex", width: 100, fontSize: 14, color: "#64748b", fontWeight: 600 }}>{stats[0]?.label || ""}</div>
              <div style={{ display: "flex", flex: 1, fontSize: 24, fontWeight: 800, color: "#0f172a" }}>{stats[0]?.value || ""}</div>
            </div>
            <div style={{ display: "flex", alignItems: "center", padding: "7px 0", borderBottom: "1px solid #f1f5f9" }}>
              <div style={{ display: "flex", width: 100, fontSize: 14, color: "#64748b", fontWeight: 600 }}>{stats[1]?.label || ""}</div>
              <div style={{ display: "flex", flex: 1, fontSize: 24, fontWeight: 800, color: "#0f172a" }}>{stats[1]?.value || ""}</div>
            </div>
            <div style={{ display: "flex", alignItems: "center", padding: "7px 0", borderBottom: "1px solid #f1f5f9" }}>
              <div style={{ display: "flex", width: 100, fontSize: 14, color: "#64748b", fontWeight: 600 }}>{stats[2]?.label || ""}</div>
              <div style={{ display: "flex", flex: 1, fontSize: 24, fontWeight: 800, color: "#0f172a" }}>{stats[2]?.value || ""}</div>
            </div>
            <div style={{ display: "flex", alignItems: "center", padding: "7px 0", borderBottom: "1px solid #f1f5f9" }}>
              <div style={{ display: "flex", width: 100, fontSize: 14, color: "#64748b", fontWeight: 600 }}>{stats[3]?.label || ""}</div>
              <div style={{ display: "flex", flex: 1, fontSize: 24, fontWeight: 800, color: "#0f172a" }}>{stats[3]?.value || ""}</div>
            </div>
            <div style={{ display: "flex", alignItems: "center", padding: "7px 0", borderBottom: "1px solid #f1f5f9" }}>
              <div style={{ display: "flex", width: 100, fontSize: 14, color: "#64748b", fontWeight: 600 }}>{stats[4]?.label || ""}</div>
              <div style={{ display: "flex", flex: 1, fontSize: 24, fontWeight: 800, color: "#0f172a" }}>{stats[4]?.value || ""}</div>
            </div>
            <div style={{ display: "flex", alignItems: "center", padding: "7px 0", borderBottom: "1px solid #f1f5f9" }}>
              <div style={{ display: "flex", width: 100, fontSize: 14, color: "#64748b", fontWeight: 600 }}>{stats[5]?.label || ""}</div>
              <div style={{ display: "flex", flex: 1, fontSize: 24, fontWeight: 800, color: "#0f172a" }}>{stats[5]?.value || ""}</div>
            </div>
            <div style={{ display: "flex", alignItems: "center", padding: "7px 0", borderBottom: "1px solid #f1f5f9" }}>
              <div style={{ display: "flex", width: 100, fontSize: 14, color: "#64748b", fontWeight: 600 }}>{stats[6]?.label || ""}</div>
              <div style={{ display: "flex", flex: 1, fontSize: 24, fontWeight: 800, color: "#0f172a" }}>{stats[6]?.value || ""}</div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 40px", borderTop: "1px solid #e2e8f0" }}>
          <div style={{ display: "flex", fontSize: 14, color: "#94a3b8", fontWeight: 600 }}>yardsperpass.com</div>
          <div style={{ display: "flex", fontSize: 12, color: "#cbd5e1" }}>Data: nflverse play-by-play</div>
        </div>
      </div>
    ),
    {
      ...size,
      fonts: [{ name: "Inter", data: fontData, style: "normal", weight: 800 }],
    }
  );
}
