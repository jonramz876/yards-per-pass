// components/matchup/MatchupSidePanel.tsx — direction A's side panel, "SHAPE
// VS SHAPE" (team matchup spec 2026-10-10 §8, §8.1, §8.3): ONE overlay radar
// for the side that has the ball, its legend, the count line and one
// paragraph. Server component.
//
// From 1024 px up it sits in its own grid column beside the ladder and stays
// in view while the ladder scrolls; below that it drops under the ladder and
// does not stick. It is the ONLY sticky element on the matchup pages, and it
// cannot cover anything: sticky positioning never moves an element out of its
// own grid track. No ancestor up to the page may set `overflow` (that turns
// sticky off without a word).
import { getTeam } from "@/lib/data/teams";
import {
  EDGE_LEAN_MIN_GAP,
  MATCHUP_NO_OVERLAY_NOTE,
  MATCHUP_RADAR_NOTE,
  overlayCountLine,
  type OverlayModel,
} from "@/lib/stats/matchup";
import { radarStrokeColor } from "@/lib/stats/formatters";
import MatchupRadarChart from "./MatchupRadarChart";

const BARLOW = "font-[family-name:var(--font-barlow)]";

/**
 * Sticky under the navbar (64 px + 1 px border; top-20 = 80 px leaves 15 px of
 * air), only from 1024 px wide AND in a window tall enough to show the whole
 * panel: a sticky block taller than the room under the navbar would hide its
 * own count line until the ladder ends.
 *
 * ONE string literal, written out in full. Tailwind only generates CSS for
 * complete class names it finds as text in the source, so the number must
 * never be interpolated: edit it here, in BOTH classes. The rule for the
 * number is (tallest measured panel + 80 + 16), rounded up to the next 20.
 * Measured in headless Chrome on 2026-10-10 (week 5's 15 pairs, both tabs):
 * 642 px at 1280 wide, 586 px at 1024 wide → 738 → 740.
 */
export const PANEL_STICKY = "lg:[@media(min-height:740px)]:sticky lg:[@media(min-height:740px)]:top-20";

/** The chart's cap, the one the team page uses for the same `sm` radar. */
export const PANEL_CHART_MAX_WIDTH = 440;
/** Side padding in px (the class string below carries the same numbers): 10 below md, 16 from md. */
export const PANEL_PADDING = { sm: 10, md: 16 } as const;

const DEFENSE = "#334155";
/** The site accent: here only the legend's "ranks 5+ apart" swatch. */
const GAP_BAR = "#D50A0A";

export default function MatchupSidePanel({ overlay }: { overlay: OverlayModel }) {
  const team = getTeam(overlay.offId);
  const primary = team?.primaryColor ?? "#0f172a";
  const secondary = team?.secondaryColor ?? "#0f172a";
  const offStroke = radarStrokeColor(primary, secondary);

  return (
    <section
      data-matchup-panel
      className={`min-w-0 self-start border border-slate-200 bg-white px-[10px] pb-3 pt-[14px] md:px-4 md:pb-[14px] md:pt-4 lg:border-t-0 ${PANEL_STICKY}`}
    >
      <h3 className={`${BARLOW} m-0 text-[22px] font-bold leading-none tracking-[0.03em] text-navy`}>SHAPE VS SHAPE</h3>
      <p data-panel-pairing className="mt-1.5 text-[13px] font-semibold text-slate-600">
        {`${overlay.offId} offense over ${overlay.defId} defense`}
      </p>

      {overlay.drawn && overlay.tally ? (
        <>
          <div data-panel-chart className="mx-auto mt-2 w-full" style={{ maxWidth: PANEL_CHART_MAX_WIDTH }}>
            <MatchupRadarChart overlay={overlay} offColor={primary} offSecondaryColor={secondary} />
          </div>

          <ul data-panel-legend className="m-0 mt-1 flex list-none flex-wrap items-center gap-x-4 gap-y-1.5 p-0 text-[12.5px] text-slate-600">
            <li className="flex items-center gap-1.5">
              <i className="inline-block h-[10px] w-[18px] rounded-[2px] border-[2.5px] border-solid" style={{ borderColor: offStroke }} />
              {`${overlay.offId} offense`}
            </li>
            <li className="flex items-center gap-1.5">
              <i className="inline-block h-[10px] w-[18px] border-2 border-dashed" style={{ borderColor: DEFENSE, background: `${DEFENSE}14` }} />
              {`${overlay.defId} defense`}
            </li>
            <li className="flex items-center gap-1.5">
              <i data-swatch="gap" className="inline-block h-[5px] w-[18px]" style={{ background: GAP_BAR }} />
              {`ranks ${EDGE_LEAN_MIN_GAP}+ apart`}
            </li>
            <li className="flex items-center gap-1.5">
              <i className="inline-block h-0 w-[18px] border-t-2 border-dashed border-amber-500" />
              middle of the league
            </li>
          </ul>

          <p
            data-panel-count
            className={`${BARLOW} m-0 mt-2.5 border-t border-slate-200 pt-2.5 text-[18px] font-semibold leading-snug tracking-[0.02em] text-slate-900`}
          >
            {overlayCountLine(overlay.tally)}
          </p>
          <p data-panel-note className="m-0 mt-1.5 text-[12.5px] leading-normal text-slate-600">
            {MATCHUP_RADAR_NOTE}
          </p>
        </>
      ) : (
        <p data-panel-empty className="m-0 mt-3 bg-slate-50 px-3 py-2.5 text-[13px] leading-normal text-slate-600">
          {MATCHUP_NO_OVERLAY_NOTE}
        </p>
      )}
    </section>
  );
}
