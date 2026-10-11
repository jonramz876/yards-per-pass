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
//
// Colour (page colours amendment 2026-10-12): the panel looks no team up and
// holds no colour. Its `paint` is the share card's colours for this pair and
// this side of the ball, built once by the server page: the offense's colour,
// the OTHER team's colour for the defense, and the middle ring's colour with
// its word for the paragraph. The legend has three entries; the radar has no
// rank-gap bars, so there is no entry for one and no red here.
import {
  MATCHUP_NO_OVERLAY_NOTE,
  matchupRadarNote,
  overlayCountLine,
  type OverlayModel,
} from "@/lib/stats/matchup";
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

/**
 * One side of the ball's colours, as plain strings from the server page (the
 * share card's rule, lib/stats/matchup-colours.ts; never worked out here).
 */
export interface MatchupSidePaint {
  /** the team with the ball */
  offColor: string;
  /** the other team: its defense is drawn in ITS colour */
  defColor: string;
  /** the middle-of-the-league ring */
  ringColor: string;
  /** that ring's colour as the paragraph's word */
  ringWord: "amber" | "grey";
}

export default function MatchupSidePanel({ overlay, paint }: { overlay: OverlayModel; paint: MatchupSidePaint }) {
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
            <MatchupRadarChart overlay={overlay} offColor={paint.offColor} defColor={paint.defColor} ringColor={paint.ringColor} />
          </div>

          <ul data-panel-legend className="m-0 mt-1 flex list-none flex-wrap items-center gap-x-4 gap-y-1.5 p-0 text-[12.5px] text-slate-600">
            <li className="flex items-center gap-1.5">
              <i data-legend="off" className="inline-block h-[10px] w-[18px] rounded-[2px] border-[2.5px] border-solid" style={{ borderColor: paint.offColor }} />
              {`${overlay.offId} offense`}
            </li>
            <li className="flex items-center gap-1.5">
              <i data-legend="def" className="inline-block h-[10px] w-[18px] border-2 border-dashed" style={{ borderColor: paint.defColor, background: `${paint.defColor}14` }} />
              {`${overlay.defId} defense`}
            </li>
            <li className="flex items-center gap-1.5">
              <i data-legend="ring" className="inline-block h-0 w-[18px] border-t-2 border-dashed" style={{ borderColor: paint.ringColor }} />
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
            {matchupRadarNote(paint.ringWord)}
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
