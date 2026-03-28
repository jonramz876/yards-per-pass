// components/compare/OverlayRadarChart.tsx
"use client";

interface OverlayRadarChartProps {
  values1: number[];
  values2: number[];
  color1: string;
  color2: string;
  name1: string;
  name2: string;
  axes?: { label: string }[];
}

const DEFAULT_AXES: { label: string }[] = [
  { label: "EPA/DB" }, { label: "CPOE" }, { label: "DB/Game" },
  { label: "aDOT" }, { label: "INT Rate" }, { label: "Success%" },
];

const CX = 150;
const CY = 130;
const R_OUTER = 90;
const R_MID = 45;
const R_INNER = 22.5;

function polyPoint(radius: number, index: number, count: number): [number, number] {
  const angle = -Math.PI / 2 + (index * Math.PI * 2) / count;
  return [CX + radius * Math.cos(angle), CY + radius * Math.sin(angle)];
}

function polyPoints(radius: number, count: number): string {
  return Array.from({ length: count }, (_, i) => polyPoint(radius, i, count).join(",")).join(" ");
}

function labelPos(index: number, count: number): { x: number; y: number; anchor: "start" | "middle" | "end" } {
  const angle = -Math.PI / 2 + (index * Math.PI * 2) / count;
  const labelR = R_OUTER + 22;
  const x = CX + labelR * Math.cos(angle);
  const y = CY + labelR * Math.sin(angle) + 4;
  const cos = Math.cos(angle);
  const anchor = cos > 0.3 ? "start" : cos < -0.3 ? "end" : "middle";
  return { x, y, anchor };
}

function makePolygon(values: number[], count: number): { polygon: string; points: [number, number][] } {
  const clamped = values.map((v) => (isNaN(v) || v < 0 ? 0 : Math.min(v, 100)));
  const pts = clamped.map((pct, i) => polyPoint((pct / 100) * R_OUTER, i, count));
  return { polygon: pts.map((p) => p.join(",")).join(" "), points: pts };
}

export default function OverlayRadarChart({
  values1, values2, color1, color2, name1, name2, axes: customAxes,
}: OverlayRadarChartProps) {
  const axes = customAxes || DEFAULT_AXES;
  const count = axes.length;
  const p1 = makePolygon(values1, count);
  const p2 = makePolygon(values2, count);

  return (
    <div>
      <svg viewBox="-20 -5 340 290" className="mx-auto w-full" style={{ maxWidth: 400 }}>
        {/* Outer ring */}
        <polygon points={polyPoints(R_OUTER, count)} fill="none" stroke="#e2e8f0" strokeWidth={1} />
        {/* 50th percentile ring */}
        <polygon
          points={polyPoints(R_MID, count)}
          fill="rgba(251,191,36,0.06)"
          stroke="#f59e0b"
          strokeWidth={1}
          strokeDasharray="5,3"
        />
        {/* 25th percentile ring */}
        <polygon points={polyPoints(R_INNER, count)} fill="none" stroke="#f1f5f9" strokeWidth={0.5} />

        {/* Axis lines */}
        {Array.from({ length: count }, (_, i) => {
          const [x, y] = polyPoint(R_OUTER, i, count);
          return <line key={i} x1={CX} y1={CY} x2={x} y2={y} stroke="#f1f5f9" strokeWidth={0.5} />;
        })}

        {/* Player 2 polygon (behind) */}
        <polygon points={p2.polygon} fill={`${color2}1A`} stroke={color2} strokeWidth={2} strokeDasharray="6,3" />
        {p2.points.map(([x, y], i) => (
          <circle key={`p2-${i}`} cx={x} cy={y} r={3} fill={color2} opacity={0.7} />
        ))}

        {/* Player 1 polygon (front) */}
        <polygon points={p1.polygon} fill={`${color1}1F`} stroke={color1} strokeWidth={2} />
        {p1.points.map(([x, y], i) => (
          <circle key={`p1-${i}`} cx={x} cy={y} r={3} fill={color1} />
        ))}

        {/* Axis labels */}
        {axes.map((axis, i) => {
          const pos = labelPos(i, count);
          return (
            <text
              key={axis.label}
              x={pos.x}
              y={pos.y}
              textAnchor={pos.anchor}
              fontSize={11}
              fill="#475569"
              fontWeight={600}
            >
              {axis.label}
            </text>
          );
        })}

        {/* Legend */}
        <text x={150} y={278} textAnchor="middle" fontSize={9} fill="#94a3b8">
          outer ring = league best · dashed = 50th percentile
        </text>
      </svg>

      {/* Player legend below chart */}
      <div className="flex justify-center gap-6 mt-2">
        <div className="flex items-center gap-2">
          <div className="w-4 h-0.5 rounded" style={{ backgroundColor: color1 }} />
          <span className="text-sm font-semibold" style={{ color: color1 }}>{name1}</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-4 h-0.5 rounded" style={{ backgroundColor: color2, opacity: 0.7 }}>
            <div className="w-full h-full" style={{ borderTop: `2px dashed ${color2}` }} />
          </div>
          <span className="text-sm font-semibold" style={{ color: color2 }}>{name2}</span>
        </div>
      </div>
    </div>
  );
}
