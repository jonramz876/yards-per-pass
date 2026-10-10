// components/matchup/MatchupRadarChart.tsx — the two-series overlay radar
// (team matchup spec 2026-10-10 §8.1): one team's offense (solid outline,
// round dots, its own colour) over the other team's defense (dashed slate,
// white squares), with a red bar along a spoke where the two league ranks are
// EDGE_LEAN_MIN_GAP or more places apart (the model's `gapBar`).
//
// A SERVER component on purpose (no "use client"): it imports the chart
// geometry from lib/stats/team-radar, which must stay out of the matchup
// route's browser bundle. A new component, not an extension of
// TeamRadarChart: that one draws one series and the share image is tied to
// its output. The geometry is reused, not copied (RADAR_SIZES.sm, unchanged).
//
// The encoding never rests on telling two team colours apart (BUF and LA are
// near-identical blues): solid + dots against dashed + squares.
import type { OverlayModel } from "@/lib/stats/matchup";
import {
  RADAR_AXES,
  RADAR_MID_SCORE,
  RADAR_SIZES,
  plottableScore,
  radarLabelPosition,
  radarPathD,
  radarPoint,
  radarRadius,
  radarStrokeColor,
  type RadarSideModel,
} from "@/lib/stats/team-radar";

interface MatchupRadarChartProps {
  overlay: OverlayModel;
  /** The offense's team primary (#rrggbb): the fill tint, and the outline when it shows on white. */
  offColor: string;
  /** Its secondary: the outline and dots when the primary is too light on white (PIT, NO). */
  offSecondaryColor: string;
}

const G = RADAR_SIZES.sm;
const N = RADAR_AXES.length;
const DEFENSE = "#334155";
/** The site accent. Its one job on this chart: these two ranks are 5+ apart. */
const GAP_BAR = "#D50A0A";
const n1 = (v: number) => v.toFixed(1);
const at = (score: number) => G.r * radarRadius(score);
const ring = (score: number) => radarPathD(Array.from({ length: N }, (_, i) => radarPoint(G, at(score), i)));

type Vertex = { i: number; x: number; y: number };
/** One series' plottable points; a missing spoke has no vertex (the outline bridges it). */
function vertices(side: RadarSideModel): Vertex[] {
  const out: Vertex[] = [];
  side.spokes.forEach((spoke, i) => {
    const score = plottableScore(spoke);
    if (score === null) return;
    const [x, y] = radarPoint(G, at(score), i);
    out.push({ i, x, y });
  });
  return out;
}

export default function MatchupRadarChart({ overlay, offColor, offSecondaryColor }: MatchupRadarChartProps) {
  if (!overlay.drawn || !overlay.off || !overlay.def) return null;

  const stroke = radarStrokeColor(offColor, offSecondaryColor);
  const tint = /^#[0-9a-fA-F]{6}$/.test(offColor) ? offColor : stroke;
  const off = vertices(overlay.off);
  const def = vertices(overlay.def);
  const offAt = new Map(off.map((v) => [v.i, v]));
  const defAt = new Map(def.map((v) => [v.i, v]));

  return (
    <svg
      viewBox={`0 0 ${G.w} ${G.h}`}
      role="img"
      aria-label={`${overlay.offId} offense over ${overlay.defId} defense, by league rank`}
      className="block h-auto w-full"
    >
      <path data-ring="outer" d={ring(1)} fill="none" stroke="#e2e8f0" strokeWidth={G.sw} />
      <path data-ring="mid" d={ring(RADAR_MID_SCORE)} fill="none" stroke="#f59e0b" strokeWidth={G.sw} strokeDasharray="5 3" />
      <path data-ring="inner" d={ring(0)} fill="#ffffff" stroke="#e2e8f0" strokeWidth={G.sw * 0.75} />

      {RADAR_AXES.map((axis, i) => {
        const [x0, y0] = radarPoint(G, at(0), i);
        const [x1, y1] = radarPoint(G, at(1), i);
        return <line key={axis.key} x1={n1(x0)} y1={n1(y0)} x2={n1(x1)} y2={n1(y1)} stroke="#eef2f7" strokeWidth={G.sw * 0.75} />;
      })}

      {def.length >= 3 && (
        <path
          data-series="def"
          d={radarPathD(def.map((v) => [v.x, v.y] as const))}
          fill={`${DEFENSE}17`}
          stroke={DEFENSE}
          strokeWidth={2}
          strokeDasharray="6 4"
          strokeLinejoin="round"
        />
      )}
      {off.length >= 3 && (
        <path
          data-series="off"
          d={radarPathD(off.map((v) => [v.x, v.y] as const))}
          fill={`${tint}26`}
          stroke={stroke}
          strokeWidth={2.6}
          strokeLinejoin="round"
        />
      )}

      {overlay.spokes.map((spoke, i) => {
        const a = offAt.get(i);
        const b = defAt.get(i);
        if (!spoke.gapBar || !a || !b) return null;
        return (
          <line
            key={spoke.key}
            data-gap-bar={spoke.key}
            x1={n1(a.x)}
            y1={n1(a.y)}
            x2={n1(b.x)}
            y2={n1(b.y)}
            stroke={GAP_BAR}
            strokeWidth={5}
          />
        );
      })}

      {def.map((v) => (
        <rect
          key={RADAR_AXES[v.i].key}
          data-def-marker={RADAR_AXES[v.i].key}
          x={n1(v.x - 4.5)}
          y={n1(v.y - 4.5)}
          width={9}
          height={9}
          fill="#ffffff"
          stroke={DEFENSE}
          strokeWidth={2}
        />
      ))}
      {off.map((v) => (
        <circle key={RADAR_AXES[v.i].key} data-off-dot={RADAR_AXES[v.i].key} cx={n1(v.x)} cy={n1(v.y)} r={5} fill={stroke} stroke="#ffffff" strokeWidth={1} />
      ))}

      {overlay.spokes.map((spoke, i) => {
        const p = radarLabelPosition(G, i);
        return (
          <g key={spoke.key}>
            <text data-axis={spoke.key} x={n1(p.x)} y={n1(p.y1)} textAnchor={p.anchor} fontSize={G.f} fontWeight={600} fill="#475569">
              {spoke.label}
            </text>
            <text data-axis-rank={spoke.key} x={n1(p.x)} y={n1(p.y2)} textAnchor={p.anchor} fontSize={G.f} fontWeight={700} fill="#0f172a">
              {spoke.rankLine}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
