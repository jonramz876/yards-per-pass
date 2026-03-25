// components/player/StatCardView.tsx
// Self-contained stat card for sharing. ALL styles inline with hex colors.
// No Tailwind, no CSS variables, no oklch. Renders identically anywhere.

interface StatCardViewProps {
  playerName: string;
  position: string;
  teamName: string;
  teamColor: string;
  season: number;
  radarValues: number[];
  radarLabels: string[];
  chipStats: { label: string; value: string; rank: string }[];
  barStats: { label: string; value: string; delta: number; pct: number }[];
  branding?: string;
}

// --- Radar geometry ---
const CX = 150, CY = 135, R = 100, R_MID = 50;

function hp(r: number, i: number): [number, number] {
  const a = -Math.PI / 2 + (i * Math.PI) / 3;
  return [CX + r * Math.cos(a), CY + r * Math.sin(a)];
}
function mkPath(r: number): string {
  return Array.from({ length: 6 }, (_, i) => hp(r, i))
    .map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`)
    .join(" ") + " Z";
}
function dataPath(vals: number[]): string {
  return vals.map((p, i) => {
    const s = Math.max(0, Math.min(p, 100));
    const [x, y] = hp((s / 100) * R, i);
    return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ") + " Z";
}

const OUTER = mkPath(R);
const MID = mkPath(R_MID);
const AX = Array.from({ length: 6 }, (_, i) => hp(R, i));
const LP = [
  { x: 150, y: 14, a: "middle" as const }, { x: 264, y: 72, a: "start" as const },
  { x: 264, y: 206, a: "start" as const }, { x: 150, y: 262, a: "middle" as const },
  { x: 36, y: 206, a: "end" as const }, { x: 36, y: 72, a: "end" as const },
];

export default function StatCardView({
  playerName, position, teamName, teamColor, season,
  radarValues, radarLabels, chipStats, barStats,
  branding = "yardsperpass.com",
}: StatCardViewProps) {
  const rp = dataPath(radarValues);
  const dots = radarValues.map((p, i) => {
    const s = Math.max(0, Math.min(p, 100));
    return hp((s / 100) * R, i);
  });

  return (
    <div style={{
      width: 960, backgroundColor: "#ffffff",
      fontFamily: "'Inter', system-ui, sans-serif",
      borderRadius: 10, border: "1px solid #e2e8f0",
      overflow: "hidden",
    }}>
      {/* Team color bar */}
      <div style={{ width: "100%", height: 6, backgroundColor: teamColor }} />

      {/* Header */}
      <div style={{ padding: "16px 28px 8px", display: "flex", alignItems: "baseline", gap: 14 }}>
        <span style={{ fontSize: 36, fontWeight: 800, color: "#0f172a" }}>{playerName}</span>
        <span style={{ fontSize: 18, color: "#64748b", fontWeight: 500 }}>
          {position} &middot; {teamName} &middot; {season} Season
        </span>
      </div>

      {/* Main: Radar + Bars */}
      <div style={{ display: "flex", padding: "0 20px", gap: 16 }}>
        {/* Radar */}
        <div style={{ width: 340, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <svg viewBox="0 0 300 275" width={300} height={275}>
            <path d={OUTER} fill="none" stroke="#e2e8f0" strokeWidth={1} />
            <path d={MID} fill="rgba(251,191,36,0.06)" stroke="#f59e0b" strokeWidth={0.75} strokeDasharray="4,3" />
            {AX.map(([x, y], i) => (
              <line key={i} x1={CX} y1={CY} x2={x} y2={y} stroke="#f1f5f9" strokeWidth={0.5} />
            ))}
            <path d={rp} fill={`${teamColor}20`} stroke={teamColor} strokeWidth={2} />
            {dots.map(([x, y], i) => (
              <circle key={i} cx={x} cy={y} r={3} fill={teamColor} />
            ))}
            {radarLabels.map((label, i) => (
              <text key={label} x={LP[i].x} y={LP[i].y} textAnchor={LP[i].a}
                fontSize={12} fill="#475569" fontWeight={600}>{label}</text>
            ))}
          </svg>
        </div>

        {/* Bars */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", gap: 6, paddingTop: 8 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase" as const, letterSpacing: 1, marginBottom: 4 }}>
            vs. League Average
          </div>
          {barStats.map((bar) => {
            const pos = bar.delta >= 0;
            const col = pos ? "#16a34a" : "#dc2626";
            const bg = pos ? "rgba(34,197,94,0.18)" : "rgba(239,68,68,0.18)";
            const w = Math.min(Math.abs(bar.pct), 45);
            return (
              <div key={bar.label} style={{ display: "flex", alignItems: "center", gap: 6, height: 28 }}>
                <div style={{ width: 56, fontSize: 13, color: "#64748b", fontWeight: 600, textAlign: "right" as const }}>{bar.label}</div>
                <div style={{ flex: 1, height: 20, backgroundColor: "#f1f5f9", borderRadius: 4, position: "relative" as const, overflow: "hidden" }}>
                  <div style={{ position: "absolute" as const, top: 0, bottom: 0, left: "50%", width: 1, backgroundColor: "#94a3b8" }} />
                  <div style={{
                    position: "absolute" as const, top: 2, bottom: 2,
                    ...(pos ? { left: "50%", width: `${w}%` } : { right: "50%", width: `${w}%` }),
                    backgroundColor: bg, borderRadius: 2,
                    ...(pos ? { borderRight: `2px solid ${col}` } : { borderLeft: `2px solid ${col}` }),
                  }} />
                </div>
                <div style={{ width: 90, textAlign: "right" as const }}>
                  <span style={{ fontSize: 17, fontWeight: 700, color: "#0f172a" }}>{bar.value}</span>
                  <span style={{ fontSize: 12, fontWeight: 600, color: col, marginLeft: 4 }}>
                    {bar.delta >= 0 ? "+" : ""}{bar.delta.toFixed(1)}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Stat chips */}
      <div style={{ display: "flex", gap: 6, padding: "10px 20px 8px", flexWrap: "wrap" as const }}>
        {chipStats.map((chip) => (
          <div key={chip.label} style={{
            flex: "1 1 0", minWidth: 100, backgroundColor: "#f8fafc",
            borderRadius: 6, padding: "6px 8px", textAlign: "center" as const,
            border: "1px solid #f1f5f9",
          }}>
            <div style={{ fontSize: 11, color: "#94a3b8", fontWeight: 600, textTransform: "uppercase" as const, letterSpacing: 0.5 }}>
              {chip.label}
            </div>
            <div style={{ fontSize: 24, fontWeight: 800, color: "#0f172a", lineHeight: "1.3" }}>
              {chip.value}
            </div>
            <div style={{ fontSize: 11, color: "#94a3b8", fontWeight: 500 }}>
              {chip.rank}
            </div>
          </div>
        ))}
      </div>

      {/* Footer */}
      <div style={{
        display: "flex", justifyContent: "space-between", alignItems: "center",
        padding: "6px 20px 10px", borderTop: "1px solid #f1f5f9",
      }}>
        <span style={{ fontSize: 14, fontWeight: 700, color: "#94a3b8" }}>{branding}</span>
        <span style={{ fontSize: 11, color: "#cbd5e1" }}>Data: nflverse play-by-play</span>
      </div>
    </div>
  );
}
