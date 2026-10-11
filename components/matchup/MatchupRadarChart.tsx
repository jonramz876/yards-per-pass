// components/matchup/MatchupRadarChart.tsx — the two-series overlay radar
// (team matchup spec 2026-10-10 §8.1, as amended by the page colours
// amendment of 2026-10-10): one team's offense (solid outline, round dots)
// over the other team's defense (dashed outline, white squares), each in its
// own team's colour for this pair.
//
// The chart holds no team colour, no ring colour and no colour rule: the three
// colours are the share card's (lib/stats/matchup-colours.ts), worked out once
// by the server page and passed down as plain strings. That rule only returns
// #RRGGBB colours that show on white, so the chart draws what it is given. It
// draws no rank-gap bar: the model's `gapBar` is still there, undrawn (the
// ladder is where a gap of 5 or more is marked).
//
// A SERVER component on purpose (no "use client"): it imports the chart
// geometry from lib/stats/team-radar, which must stay out of the matchup
// route's browser bundle. A new component, not an extension of
// TeamRadarChart: that one draws one series and the share image is tied to
// its output. The geometry is reused, not copied (RADAR_SIZES.sm, unchanged).
//
// The two shapes are told apart by form first (solid + dots against dashed +
// squares), then by colour. Line weights and fill alphas are the card's,
// scaled from its r 116 radar to this one's r 104.
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
  type RadarSideModel,
} from "@/lib/stats/team-radar";

interface MatchupRadarChartProps {
  overlay: OverlayModel;
  /** The colour of the team with the ball (#RRGGBB): its outline, fill tint and dots. */
  offColor: string;
  /** The OTHER team's colour: the defense's dashed outline, fill tint and square outlines. */
  defColor: string;
  /** The middle-of-the-league ring: amber, or grey beside a team colour close to amber. */
  ringColor: string;
}

const G = RADAR_SIZES.sm;
const N = RADAR_AXES.length;
const n1 = (v: number) => v.toFixed(1);
const at = (score: number) => G.r * radarRadius(score);
const ring = (score: number) => radarPathD(Array.from({ length: N }, (_, i) => radarPoint(G, at(score), i)));
/**
 * Widths in viewBox units, chosen for a phone (the chart is 329 px wide in a
 * 375 px window, 274 px in a 320 px one; the viewBox is 420). The middle ring
 * at the base width was 0.78 px there and the grey one could not be found
 * (its grey cannot be darker: #94A3B8 already sits on the rule's floor of 30
 * from a team colour), so it is 1.7: 1.33 px at 375. The squares' outline is
 * 2.4: 1.57 px at 320 (2 was 1.3 px).
 */
const MID_RING_WIDTH = 1.7;
const SQUARE_OUTLINE = 2.4;

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

export default function MatchupRadarChart({ overlay, offColor, defColor, ringColor }: MatchupRadarChartProps) {
  if (!overlay.drawn || !overlay.off || !overlay.def) return null;

  const off = vertices(overlay.off);
  const def = vertices(overlay.def);

  return (
    <svg
      viewBox={`0 0 ${G.w} ${G.h}`}
      role="img"
      aria-label={`${overlay.offId} offense over ${overlay.defId} defense, by league rank`}
      className="block h-auto w-full"
    >
      <path data-ring="outer" d={ring(1)} fill="none" stroke="#e2e8f0" strokeWidth={G.sw} />
      <path data-ring="mid" d={ring(RADAR_MID_SCORE)} fill="none" stroke={ringColor} strokeWidth={MID_RING_WIDTH} strokeDasharray="5 3" />
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
          fill={`${defColor}14`}
          stroke={defColor}
          strokeWidth={2.6}
          strokeDasharray="6 4"
          strokeLinejoin="round"
        />
      )}
      {off.length >= 3 && (
        <path
          data-series="off"
          d={radarPathD(off.map((v) => [v.x, v.y] as const))}
          fill={`${offColor}22`}
          stroke={offColor}
          strokeWidth={3}
          strokeLinejoin="round"
        />
      )}

      {def.map((v) => (
        <rect
          key={RADAR_AXES[v.i].key}
          data-def-marker={RADAR_AXES[v.i].key}
          x={n1(v.x - 4.5)}
          y={n1(v.y - 4.5)}
          width={9}
          height={9}
          fill="#ffffff"
          stroke={defColor}
          strokeWidth={SQUARE_OUTLINE}
        />
      ))}
      {off.map((v) => (
        <circle key={RADAR_AXES[v.i].key} data-off-dot={RADAR_AXES[v.i].key} cx={n1(v.x)} cy={n1(v.y)} r={5} fill={offColor} stroke="#ffffff" strokeWidth={1} />
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
