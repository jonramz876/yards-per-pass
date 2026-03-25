// components/player/StatCardView.tsx
// Self-contained stat card for sharing. ALL styles inline with hex colors.
// No Tailwind, no CSS variables, no oklch. Renders identically anywhere.

interface StatCardViewProps {
  playerName: string;
  position: string;
  teamName: string;
  teamColor: string;
  season: number;
  radarValues: number[];      // 0-100 percentiles
  radarLabels: string[];      // axis labels
  chipStats: { label: string; value: string; rank: string }[];
  barStats: { label: string; value: string; delta: number; pct: number }[];
  branding?: string;
}

// --- Radar chart geometry (matches RadarChart.tsx / stat-card route) ---
const CX = 160;
const CY = 150;
const R_OUTER = 120;
const R_MID = 60;

function hexPoint(radius: number, index: number): [number, number] {
  const angle = -Math.PI / 2 + (index * Math.PI) / 3;
  return [CX + radius * Math.cos(angle), CY + radius * Math.sin(angle)];
}

function hexPathD(radius: number): string {
  const pts = Array.from({ length: 6 }, (_, i) => hexPoint(radius, i));
  return pts.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ") + " Z";
}

function dataPathD(values: number[]): string {
  const pts = values.map((pct, i) => {
    const clamped = Math.max(0, Math.min(pct, 100));
    return hexPoint((clamped / 100) * R_OUTER, i);
  });
  return pts.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ") + " Z";
}

const LABEL_POSITIONS: Array<{ x: number; y: number; anchor: "start" | "middle" | "end" }> = [
  { x: 160, y: 10, anchor: "middle" },
  { x: 295, y: 78, anchor: "start" },
  { x: 295, y: 230, anchor: "start" },
  { x: 160, y: 296, anchor: "middle" },
  { x: 25, y: 230, anchor: "end" },
  { x: 25, y: 78, anchor: "end" },
];

export default function StatCardView({
  playerName,
  position,
  teamName,
  teamColor,
  season,
  radarValues,
  radarLabels,
  chipStats,
  barStats,
  branding = "yardsperpass.com",
}: StatCardViewProps) {
  const outerPath = hexPathD(R_OUTER);
  const midPath = hexPathD(R_MID);
  const radarPath = dataPathD(radarValues);

  // For the team color fill, append low-opacity hex
  const fillColor = teamColor + "20";

  return (
    <div
      style={{
        width: 900,
        height: 315,
        backgroundColor: "#ffffff",
        fontFamily: "'Inter', 'Segoe UI', system-ui, -apple-system, sans-serif",
        position: "relative",
        overflow: "hidden",
        borderRadius: 8,
        border: "1px solid #e2e8f0",
        boxSizing: "border-box",
      }}
    >
      {/* Team color header bar */}
      <div style={{ width: "100%", height: 5, backgroundColor: teamColor }} />

      {/* Top: Player name + info */}
      <div
        style={{
          padding: "12px 24px 6px",
          display: "flex",
          alignItems: "baseline",
          gap: 12,
        }}
      >
        <span
          style={{
            fontSize: 32,
            fontWeight: 800,
            color: "#0f172a",
            lineHeight: 1.2,
          }}
        >
          {playerName}
        </span>
        <span style={{ fontSize: 16, color: "#64748b", fontWeight: 500 }}>
          {position} &middot; {teamName} &middot; {season} Season
        </span>
      </div>

      {/* Main two-column area */}
      <div
        style={{
          display: "flex",
          padding: "0 12px",
          gap: 8,
        }}
      >
        {/* Left: Radar chart */}
        <div style={{ width: 260, flexShrink: 0 }}>
          <svg viewBox="0 0 320 310" width={320} height={280}>
            {/* Outer ring */}
            <path d={outerPath} fill="none" stroke="#e2e8f0" strokeWidth={1} />
            {/* 50th pctile ring */}
            <path d={midPath} fill="rgba(251,191,36,0.06)" stroke="#f59e0b" strokeWidth={0.75} strokeDasharray="4,3" />
            {/* Axis lines */}
            {Array.from({ length: 6 }, (_, i) => {
              const [x, y] = hexPoint(R_OUTER, i);
              return <line key={i} x1={CX} y1={CY} x2={x} y2={y} stroke="#f1f5f9" strokeWidth={0.5} />;
            })}
            {/* Data polygon */}
            <path d={radarPath} fill={fillColor} stroke={teamColor} strokeWidth={2} />
            {/* Data dots */}
            {radarValues.map((pct, i) => {
              const clamped = Math.max(0, Math.min(pct, 100));
              const [x, y] = hexPoint((clamped / 100) * R_OUTER, i);
              return <circle key={i} cx={x} cy={y} r={2.5} fill={teamColor} />;
            })}
            {/* Axis labels */}
            {radarLabels.map((label, i) => (
              <text
                key={label}
                x={LABEL_POSITIONS[i].x}
                y={LABEL_POSITIONS[i].y}
                textAnchor={LABEL_POSITIONS[i].anchor}
                fontSize={13}
                fill="#475569"
                fontWeight={600}
              >
                {label}
              </text>
            ))}
          </svg>
        </div>

        {/* Right: Vs League Average bars */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", gap: 4, paddingTop: 4 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase" as const, letterSpacing: 0.5, marginBottom: 4 }}>
            vs. League Average
          </div>
          {barStats.map((bar) => {
            const isPositive = bar.delta >= 0;
            const barColor = isPositive ? "#16a34a" : "#dc2626";
            const barBg = isPositive ? "rgba(34,197,94,0.18)" : "rgba(239,68,68,0.18)";
            const barW = Math.min(Math.abs(bar.pct), 45);
            return (
              <div key={bar.label} style={{ display: "flex", alignItems: "center", gap: 4, height: 22 }}>
                <div style={{ width: 60, fontSize: 13, color: "#64748b", fontWeight: 600, textAlign: "right" as const }}>
                  {bar.label}
                </div>
                <div
                  style={{
                    flex: 1,
                    height: 16,
                    backgroundColor: "#f1f5f9",
                    borderRadius: 3,
                    position: "relative" as const,
                    overflow: "hidden",
                  }}
                >
                  {/* Center line */}
                  <div
                    style={{
                      position: "absolute" as const,
                      top: 0,
                      bottom: 0,
                      left: "50%",
                      width: 1,
                      backgroundColor: "#94a3b8",
                    }}
                  />
                  {/* Delta bar */}
                  <div
                    style={{
                      position: "absolute" as const,
                      top: 2,
                      bottom: 2,
                      ...(isPositive
                        ? { left: "50%", width: `${barW}%`, borderRight: `2px solid ${barColor}` }
                        : { right: "50%", width: `${barW}%`, borderLeft: `2px solid ${barColor}` }),
                      backgroundColor: barBg,
                      borderRadius: 2,
                    }}
                  />
                </div>
                <div style={{ width: 68, textAlign: "right" as const }}>
                  <span style={{ fontSize: 15, fontWeight: 700, color: "#0f172a" }}>{bar.value}</span>
                  <span style={{ fontSize: 11, fontWeight: 600, color: barColor, marginLeft: 4 }}>
                    {bar.delta >= 0 ? "+" : ""}{bar.delta.toFixed(1)}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Stat chips grid */}
      <div
        style={{
          display: "flex",
          gap: 4,
          padding: "4px 12px",
          flexWrap: "wrap" as const,
        }}
      >
        {chipStats.map((chip) => (
          <div
            key={chip.label}
            style={{
              flex: "1 1 0",
              minWidth: 80,
              backgroundColor: "#f8fafc",
              borderRadius: 4,
              padding: "3px 6px",
              textAlign: "center" as const,
            }}
          >
            <div style={{ fontSize: 11, color: "#94a3b8", fontWeight: 600, textTransform: "uppercase" as const, letterSpacing: 0.3 }}>
              {chip.label}
            </div>
            <div style={{ fontSize: 20, fontWeight: 800, color: "#0f172a", lineHeight: 1.3 }}>
              {chip.value}
            </div>
            <div style={{ fontSize: 10, color: "#94a3b8", fontWeight: 500 }}>
              {chip.rank}
            </div>
          </div>
        ))}
      </div>

      {/* Footer */}
      <div
        style={{
          position: "absolute" as const,
          bottom: 0,
          left: 0,
          right: 0,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          padding: "4px 16px 6px",
          borderTop: "1px solid #f1f5f9",
        }}
      >
        <span style={{ fontSize: 14, fontWeight: 700, color: "#94a3b8" }}>
          {branding}
        </span>
        <span style={{ fontSize: 11, color: "#cbd5e1" }}>
          Data: nflverse play-by-play
        </span>
      </div>
    </div>
  );
}
