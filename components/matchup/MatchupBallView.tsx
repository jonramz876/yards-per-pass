// components/matchup/MatchupBallView.tsx — one side of the ball (team matchup
// spec 2026-10-10 §8, §8.3): the ladder and the side panel built from the
// SAME MatchupSide, in one grid. The page renders two of these on the server
// (away ball, home ball) and hands them to the client toggle as finished
// markup, so a ladder and a radar from different sides can never be on screen
// together, and none of this reaches the browser bundle.
//
// One column up to 1023 px (the panel under the ladder). Two columns from
// 1024 px: at 768 px the side column would be 279 px wide and the radar's
// labels 6.4 px tall; 1024 px is the first width where the chart is no
// smaller than on a 375 px phone. No `overflow` here: it would switch the
// panel's sticky off.
import type { MatchupSide } from "@/lib/stats/matchup";
import MatchupLadder from "./MatchupLadder";
import MatchupSidePanel from "./MatchupSidePanel";

/** The two-column split and gap, from 1024 px. The class string below carries the same numbers. */
export const BALL_GRID_SPLIT = [1.5, 1] as const;
export const BALL_GRID_GAP = 22;

export default function MatchupBallView({ side }: { side: MatchupSide }) {
  return (
    <div data-ball-view className="grid grid-cols-1 gap-[14px] lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)] lg:items-start lg:gap-[22px]">
      <div className="min-w-0">
        <MatchupLadder ladder={side.ladder} />
      </div>
      {/* The panel is itself the grid item: sticky moves an element inside its
          containing block, so a wrapper only as tall as the panel would pin it. */}
      <MatchupSidePanel overlay={side.overlay} />
    </div>
  );
}
