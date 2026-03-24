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
  { label: "EPA/DB" },
  { label: "CPOE" },
  { label: "DB/Game" },
  { label: "aDOT" },
  { label: "INT Rate" },
  { label: "Success%" },
];

const CX = 150;
const CY = 125;
const R_OUTER = 90;
const R_MID = 45;
const R_INNER = 22.5;

function hexPoint(radius: number, index: number): [number, number] {
  const angle = -Math.PI / 2 + (index * Math.PI) / 3;
  return [CX + radius * Math.cos(angle), CY + radius * Math.sin(angle)];
}

function hexPoints(radius: number): string {
  return Array.from({ length: 6 }, (_, i) => hexPoint(radius, i).join(",")).join(" ");
}

const LABEL_POSITIONS: Array<{ x: number; y: number; anchor: "start" | "middle" | "end" }> = [
  { x: 150, y: 16, anchor: "middle" },
  { x: 252, y: 72, anchor: "start" },
  { x: 252, y: 186, anchor: "start" },
  { x: 150, y: 240, anchor: "middle" },
  { x: 48, y: 186, anchor: "end" },
  { x: 48, y: 72, anchor: "end" },
];

function makePolygon(values: number[]): { polygon: string; points: [number, number][] } {
  const clamped = values.map((v) => (isNaN(v) || v < 0 ? 0 : Math.min(v, 100)));
  const pts = clamped.map((pct, i) => hexPoint((pct / 100) * R_OUTER, i));
  return { polygon: pts.map((p) => p.join(",")).join(" "), points: pts };
}

export default function OverlayRadarChart({
  values1,
  values2,
  color1,
  color2,
  name1,
  name2,
  axes: customAxes,
}: OverlayRadarChartProps) {
  const axes = customAxes || DEFAULT_AXES;
  const p1 = makePolygon(values1);
  const p2 = makePolygon(values2);

  return (
    <div>
      <svg viewBox="-20 -5 340 280" className="mx-auto w-full" style={{ maxWidth: 400 }}>
        {/* Outer ring */}
        <polygon points={hexPoints(R_OUTER)} fill="none" stroke="#e2e8f0" strokeWidth={1} />
        {/* 50th percentile ring */}
        <polygon
          points={hexPoints(R_MID)}
          fill="rgba(251,191,36,0.06)"
          stroke="#f59e0b"
          strokeWidth={1}
          strokeDasharray="5,3"
        />
        {/* 25th percentile ring */}
        <polygon points={hexPoints(R_INNER)} fill="none" stroke="#f1f5f9" strokeWidth={0.5} />

        {/* Axis lines */}
        {Array.from({ length: 6 }, (_, i) => {
          const [x, y] = hexPoint(R_OUTER, i);
          return <line key={i} x1={CX} y1={CY} x2={x} y2={y} stroke="#f1f5f9" strokeWidth={0.5} />;
        })}

        {/* Player 2 polygon (rendered first = behind) */}
        <polygon points={p2.polygon} fill={`${color2}1A`} stroke={color2} strokeWidth={2} strokeDasharray="6,3" />
        {p2.points.map(([x, y], i) => (
          <circle key={`p2-${i}`} cx={x} cy={y} r={3} fill={color2} opacity={0.7} />
        ))}

        {/* Player 1 polygon (rendered second = in front) */}
        <polygon points={p1.polygon} fill={`${color1}1F`} stroke={color1} strokeWidth={2} />
        {p1.points.map(([x, y], i) => (
          <circle key={`p1-${i}`} cx={x} cy={y} r={3} fill={color1} />
        ))}

        {/* Axis labels */}
        {axes.map((axis, i) => (
          <text
            key={axis.label}
            x={LABEL_POSITIONS[i].x}
            y={LABEL_POSITIONS[i].y}
            textAnchor={LABEL_POSITIONS[i].anchor}
            fontSize={12}
            fill="#475569"
            fontWeight={600}
          >
            {axis.label}
          </text>
        ))}

        {/* Legend */}
        <text x={150} y={265} textAnchor="middle" fontSize={9} fill="#94a3b8">
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
