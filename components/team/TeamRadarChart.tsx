// components/team/TeamRadarChart.tsx — one side's seven-spoke rank radar (team
// radar spec 2026-10-06 §4). The geometry and the missing-spoke behaviour are
// components/qb/RadarChart.tsx's (which every player page uses and whose
// "50th percentile" legend would be false here), with two-line labels, a rank
// scale that keeps last place on an inner ring, and a size prop for the share
// page of PR 3.
"use client";

import {
  RADAR_AXES,
  RADAR_MID_SCORE,
  axisLabel,
  canDrawRadar,
  fmtRadarPct,
  radarRadius,
  radarStrokeColor,
  spokeRankLabel,
  type RadarSide,
  type RadarSideModel,
} from "@/lib/stats/team-radar";

interface TeamRadarChartProps {
  side: RadarSideModel;
  sideKey: RadarSide;
  /** Team primary colour (#rrggbb): the fill tint, and the outline when it shows on white. */
  color: string;
  /** Team secondary colour: the outline and dots when the primary is too light on white. */
  secondaryColor?: string;
  /** Accessible name, e.g. "Buffalo Bills offense radar". */
  label: string;
  /** "sm" on the team page (default); "lg" for a single large radar. */
  size?: "sm" | "lg";
}

interface Geometry {
  w: number; h: number; cx: number; cy: number;
  /** outer radius */ r: number;
  /** label distance past the outer ring */ gap: number;
  /** label line height */ lh: number;
  /** font size */ f: number;
  /** base stroke width */ sw: number;
  /** vertex dot radius */ dot: number;
}

const SIZES: Record<"sm" | "lg", Geometry> = {
  sm: { w: 420, h: 340, cx: 210, cy: 168, r: 104, gap: 12, lh: 13, f: 11, sw: 1, dot: 3 },
  lg: { w: 640, h: 520, cx: 320, cy: 262, r: 172, gap: 15, lh: 21, f: 17, sw: 1.5, dot: 5 },
};

const N = RADAR_AXES.length;
const n1 = (v: number) => v.toFixed(1);

function angle(i: number): number {
  return -Math.PI / 2 + (i * 2 * Math.PI) / N;
}

function point(g: Geometry, radius: number, i: number): [string, string] {
  const a = angle(i);
  return [n1(g.cx + radius * Math.cos(a)), n1(g.cy + radius * Math.sin(a))];
}

function path(points: [string, string][]): string {
  return points.map(([x, y], i) => `${i ? "L" : "M"}${x},${y}`).join(" ") + "Z";
}

/** A score the chart can plot: finite and inside 0-1; anything else is a missing spoke. */
function plottable(score: number | null, value: number | null): number | null {
  if (value === null || score === null || !Number.isFinite(score)) return null;
  return Math.min(1, Math.max(0, score));
}

export default function TeamRadarChart({ side, sideKey, color, secondaryColor = "", label, size = "sm" }: TeamRadarChartProps) {
  if (!canDrawRadar(side)) return null;

  const g = SIZES[size];
  // Outline and dots: readable on white for every team (chaos R2). The fill
  // keeps the team's primary as a 13% tint.
  const stroke = radarStrokeColor(color, secondaryColor);
  const tint = /^#[0-9a-fA-F]{6}$/.test(color) ? color : stroke;
  const at = (score: number) => g.r * radarRadius(score);
  const ring = (score: number) => path(Array.from({ length: N }, (_, i) => point(g, at(score), i)));

  const scores = side.spokes.map((s) => plottable(s.score, s.value));
  const vertices = scores
    .map((score, i) => (score === null ? null : { i, xy: point(g, at(score), i) }))
    .filter((v): v is { i: number; xy: [string, string] } => v !== null);

  return (
    <svg
      viewBox={`0 0 ${g.w} ${g.h}`}
      role="img"
      aria-label={label}
      className="mx-auto mt-0.5 block h-auto w-full"
      style={{ maxWidth: size === "sm" ? 440 : 640 }}
    >
      <path data-ring="outer" d={ring(1)} fill="none" stroke="#e2e8f0" strokeWidth={g.sw} />
      <path
        data-ring="mid"
        d={ring(RADAR_MID_SCORE)}
        fill="rgba(251,191,36,0.06)"
        stroke="#f59e0b"
        strokeWidth={g.sw}
        strokeDasharray="5,3"
      />
      <path data-ring="inner" d={ring(0)} fill="#ffffff" stroke="#e2e8f0" strokeWidth={g.sw * 0.75} />

      {RADAR_AXES.map((axis, i) => {
        const [x0, y0] = point(g, at(0), i);
        const [x1, y1] = point(g, at(1), i);
        return (
          <line key={axis.key} data-radar-axis-line x1={x0} y1={y0} x2={x1} y2={y1} stroke="#eef2f7" strokeWidth={g.sw * 0.75} />
        );
      })}

      {vertices.length >= 3 && (
        <path
          data-radar-outline
          d={path(vertices.map((v) => v.xy))}
          fill={`${tint}22`}
          stroke={stroke}
          strokeWidth={g.sw * 2}
          strokeLinejoin="round"
        />
      )}
      {vertices.map((v) => (
        <circle key={RADAR_AXES[v.i].key} data-radar-vertex cx={v.xy[0]} cy={v.xy[1]} r={g.dot} fill={stroke} />
      ))}

      {RADAR_AXES.map((axis, i) => {
        const a = angle(i);
        const cos = Math.cos(a);
        const sin = Math.sin(a);
        const x = n1(g.cx + (g.r + g.gap) * cos);
        const y = g.cy + (g.r + g.gap) * sin;
        const anchor = cos > 0.3 ? "start" : cos < -0.3 ? "end" : "middle";
        const y1 = sin < -0.5 ? y - g.lh * 1.05 : sin > 0.5 ? y + g.lh * 0.8 : y - g.lh * 0.15;
        const spoke = side.spokes[i];
        const missing = scores[i] === null;
        return (
          <g key={axis.key}>
            <text
              data-axis={axis.key}
              data-missing-axis={missing ? "true" : undefined}
              x={x}
              y={n1(y1)}
              textAnchor={anchor}
              fontSize={g.f}
              fontWeight={600}
              fill={missing ? "#cbd5e1" : "#475569"}
            >
              {axisLabel(axis, sideKey)}
            </text>
            {missing ? (
              <text data-axis-value={axis.key} x={x} y={n1(y1 + g.lh)} textAnchor={anchor} fontSize={g.f} fill="#cbd5e1">
                {"—"}
              </text>
            ) : (
              <text data-axis-value={axis.key} x={x} y={n1(y1 + g.lh)} textAnchor={anchor} fontSize={g.f} fill="#0f172a">
                <tspan fontWeight={700}>{fmtRadarPct(spoke.value)}</tspan>
                <tspan fill="#64748b">{` · ${spokeRankLabel(spoke)}`}</tspan>
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}
