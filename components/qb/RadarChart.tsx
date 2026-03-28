// components/qb/RadarChart.tsx
"use client";

interface RadarChartProps {
  /** Percentile values (0–100) for each axis, in order */
  values: number[];
  /** Team primary color (hex) for the data polygon */
  color: string;
  /** Custom axis labels. Defaults to QB 6-axis if omitted. */
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

export default function RadarChart({ values, color, axes: customAxes }: RadarChartProps) {
  const axes = customAxes || DEFAULT_AXES;
  const count = axes.length;

  const nullCount = values.filter((v) => isNaN(v) || v < 0).length;
  if (nullCount >= Math.ceil(count / 2)) {
    return (
      <div className="text-center text-gray-400 text-sm py-8">
        Not enough data for radar chart
      </div>
    );
  }

  const clamped = values.map((v) => (isNaN(v) || v < 0 ? 0 : Math.min(v, 100)));
  const dataPoints = clamped.map((pct, i) => polyPoint((pct / 100) * R_OUTER, i, count));
  const dataPolygon = dataPoints.map((p) => p.join(",")).join(" ");

  return (
    <svg viewBox="-20 -5 340 290" className="mx-auto w-full" style={{ maxWidth: 340 }}>
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

      {/* Data polygon */}
      <polygon points={dataPolygon} fill={`${color}1F`} stroke={color} strokeWidth={2} />

      {/* Data points */}
      {dataPoints.map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r={3} fill={color} />
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
  );
}
