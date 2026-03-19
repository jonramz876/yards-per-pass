// components/qb/RadarChart.tsx
"use client";

interface RadarChartProps {
  /** Percentile values (0–100) for each of the 6 axes, in order */
  values: number[];
  /** Team primary color (hex) for the data polygon */
  color: string;
  /** Custom axis labels (must be exactly 6). Defaults to QB axes if omitted. */
  axes?: { label: string }[];
}

const AXES = [
  { label: "EPA/Play" },
  { label: "CPOE" },
  { label: "aDOT" },
  { label: "TD:INT" },
  { label: "Rush EPA" },
  { label: "Success%" },
];

const CX = 150;
const CY = 125;
const R_OUTER = 90;
const R_MID = 45; // 50% = 50th percentile ring (matches linear percentile-to-radius mapping)
const R_INNER = 22.5; // 25% = 25th percentile ring

function hexPoint(radius: number, index: number): [number, number] {
  const angle = -Math.PI / 2 + (index * Math.PI) / 3;
  return [CX + radius * Math.cos(angle), CY + radius * Math.sin(angle)];
}

function hexPoints(radius: number): string {
  return Array.from({ length: 6 }, (_, i) => hexPoint(radius, i).join(",")).join(" ");
}

const LABEL_POSITIONS: Array<{ x: number; y: number; anchor: "start" | "middle" | "end" }> = [
  { x: 150, y: 16, anchor: "middle" },
  { x: 248, y: 72, anchor: "start" },
  { x: 248, y: 182, anchor: "start" },
  { x: 150, y: 252, anchor: "middle" },
  { x: 52, y: 182, anchor: "end" },
  { x: 52, y: 72, anchor: "end" },
];

export default function RadarChart({ values, color, axes: customAxes }: RadarChartProps) {
  const nullCount = values.filter((v) => isNaN(v) || v < 0).length;
  if (nullCount >= 3) {
    return (
      <div className="text-center text-gray-400 text-sm py-8">
        Not enough data for radar chart
      </div>
    );
  }

  const clamped = values.map((v) => (isNaN(v) || v < 0 ? 0 : Math.min(v, 100)));

  const dataPoints = clamped.map((pct, i) => {
    const r = (pct / 100) * R_OUTER;
    return hexPoint(r, i);
  });
  const dataPolygon = dataPoints.map((p) => p.join(",")).join(" ");

  return (
    <svg viewBox="-20 0 340 260" className="mx-auto w-full" style={{ maxWidth: 340 }}>
      {/* Outer ring */}
      <polygon
        points={hexPoints(R_OUTER)}
        fill="none"
        stroke="#e2e8f0"
        strokeWidth={1}
      />
      {/* 50th percentile ring — amber, dashed */}
      <polygon
        points={hexPoints(R_MID)}
        fill="rgba(251,191,36,0.06)"
        stroke="#f59e0b"
        strokeWidth={1}
        strokeDasharray="5,3"
      />
      {/* 25th percentile ring */}
      <polygon
        points={hexPoints(R_INNER)}
        fill="none"
        stroke="#f1f5f9"
        strokeWidth={0.5}
      />

      {/* Axis lines */}
      {Array.from({ length: 6 }, (_, i) => {
        const [x, y] = hexPoint(R_OUTER, i);
        return (
          <line
            key={i}
            x1={CX}
            y1={CY}
            x2={x}
            y2={y}
            stroke="#f1f5f9"
            strokeWidth={0.5}
          />
        );
      })}

      {/* Data polygon */}
      <polygon
        points={dataPolygon}
        fill={`${color}1F`}
        stroke={color}
        strokeWidth={2}
      />

      {/* Data points */}
      {dataPoints.map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r={3} fill={color} />
      ))}

      {/* Axis labels */}
      {(customAxes || AXES).map((axis, i) => (
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
    </svg>
  );
}
