# Weekly EPA Sparkline in RBStatCard — Design Spec

**Date:** 2026-03-19
**Status:** Draft
**Context:** 10-team review flagged lack of weekly trends. Weekly data already exists in `rb_gap_stats_weekly` and is fetched by RunGapDiagram.

## Overview

Add a compact SVG line chart to the RBStatCard modal showing the selected player's EPA/carry trend across weeks. Answers "is this RB getting better or worse?"

## Chart Design

- **Position:** Between the radar chart and stat chips sections in RBStatCard
- **Dimensions:** Full modal width (~360px usable), ~80px tall
- **Line:** Team color, 2px stroke, with dots on each data point
- **Most recent week:** Larger dot (r=5 vs r=3) to draw the eye
- **Zero line:** Dashed gray horizontal line at Y=0 (above = positive EPA, below = negative)
- **Gaps:** Weeks with zero carries for this player show no dot and a broken line
- **X-axis:** Week numbers (small text below each dot)
- **Y-axis:** No labels — the zero line provides context. EPA values shown on hover/title attribute
- **Title:** "EPA/Carry by Week" in `text-[11px] font-semibold text-gray-400 uppercase tracking-wide` (matches "EPA/Carry by Gap" header style)
- **Pure SVG:** No D3 dependency — simple path + circles, computed from data

## Data Flow

1. `weeklyData` is already fetched server-side in `run-gaps/page.tsx` and passed to `RunGapDiagram` as a prop
2. `RunGapDiagram` passes `weeklyData` to `RBStatCard` as a new prop
3. `RBStatCard` filters `weeklyData` by `player_id` and `situation="all"` and `field_zone="all"`
4. Aggregates across all 7 gaps per week: sum carries, carry-weighted EPA/carry
5. Produces an array of `{ week: number, epa: number, carries: number }` sorted by week
6. Renders as a simple SVG line chart

## Aggregation Logic

For each week, combine all gap rows for the player:
```
totalCarries = sum(carries across all gaps)
weightedEpa = sum(epa_per_carry * carries across all gaps)
epa = totalCarries > 0 ? weightedEpa / totalCarries : NaN
```

Weeks where `totalCarries === 0` are excluded from the chart (no dot, line skips).

## Files Changed

| File | Change |
|------|--------|
| `components/charts/RBStatCard.tsx` | Add `weeklyData: RBGapStatWeekly[]` prop; filter/aggregate per-week; render SVG sparkline between radar and chips |
| `components/charts/RunGapDiagram.tsx` | Pass `weeklyData` prop to `<RBStatCard>` |

No new files. No new data fetches. No DB changes.

## Out of Scope

- Interactive tooltip on hover (just use SVG `<title>` for native browser tooltip)
- Team-level trend chart (only player-level in the modal)
- Multiple metrics on the same chart (just EPA/carry)
- Trend lines on the main run-gaps page (Option B from brainstorming)
