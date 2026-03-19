# Retention Hooks (Option A) + RB Radar Cards — Design Spec

**Date:** 2026-03-19
**Status:** Draft
**Context:** 10-team review scored Product at 6.5/10, partly due to dead-end pages with no cross-linking and no reason to return. Also adding RB radar charts to match existing QB radar feature.

## Overview

Three improvements to give users reasons to explore and return:
1. **Cross-page links** — connect existing pages so users can drill deeper
2. **Homepage data freshness** — dynamic indicator showing when data was last updated
3. **RB stat card with radar chart** — click an RB in PlayerGapCards to see a radar profile

## 1. Cross-Page Links

| From | Action | Destination |
|------|--------|-------------|
| Team scatter plot tooltip | "View Run Gaps →" link inside tooltip | `/run-gaps?team=KC&season=2025` |
| QB stat card modal | "View Team Run Gaps →" button | `/run-gaps?team=KC&season=2025` |
| Gap heatmap team row | Click team name | Already works (existing `router.push`) — no change needed |

**Team ID format:** All components use the same 3-letter abbreviations (verified). Cross-linking is safe.

**Implementation notes:**
- `TeamScatterPlot` is a D3 imperative component — team dots are rendered via `selection.append()` inside a `useEffect`. Adding click-to-navigate on the dot itself creates a UX conflict with the existing tooltip on tap/hover. **Solution:** Add a "View Run Gaps →" link inside the existing tooltip popup rather than on the dot itself. This requires importing `useRouter` and wiring `router.push()` into the tooltip's DOM creation.
- `QBStatCard` gets a small link/button at the bottom of the modal: "View [Team] Run Gaps →". The `qb.team_id` and season (from component props or `QBSeasonStat.season`) provide the URL params.
- `GapHeatmap` already navigates on team click — no change needed.

## 2. Homepage Data Freshness

Convert the homepage to an async server component that shows data freshness.

**Display:** Below the hero tagline, add a subtle line:
> "Updated Mar 19 · Through Week 11 · 2025 Season"

**Implementation:**
- `app/page.tsx` becomes an `async` server component
- Fetch `getDataFreshness(currentSeason)` and `getAvailableSeasons()`
- Render the freshness line in the hero section
- Style: small text, gray, non-intrusive
- **Null handling:** If `getDataFreshness` returns null (DB down, no row), simply don't render the freshness line. No error state needed — the rest of the homepage is static and unaffected.

## 3. RB Stat Card with Radar Chart

### RadarChart Changes

Make `RadarChart.tsx` accept custom axis labels:

```typescript
interface RadarChartProps {
  values: number[];
  color: string;
  axes?: { label: string }[]; // optional, defaults to existing QB axes
}
```

If `axes` is provided, use it instead of the hardcoded `AXES` array. This keeps QB radar unchanged while enabling RB radar. **Note:** The `LABEL_POSITIONS` array (6 hand-tuned x/y positions) is reused as-is since RB radar also has exactly 6 axes. Both QB and RB radars are locked to 6 axes.

### RB Radar Axes (6)

| Axis | Metric | Direction |
|------|--------|-----------|
| EPA/Carry | `epa_per_carry` | Higher = better |
| Yds/Carry | `yards_per_carry` | Higher = better |
| Success% | `success_rate` | Higher = better |
| Explosive% | `explosive_rate` | Higher = better |
| Elusiveness | `1 - stuff_rate` | Inverted: lower stuff rate = better |
| Volume | `carries` | Higher = more usage |

### Percentile Pool

Percentiles are computed against **all RBs league-wide** for the season, not just the current team. This provides meaningful comparisons (a team typically has only 3-5 RBs — too small for percentiles).

**Data source:** `allGapStats` from `getAllGapData()` is already fetched on every `/run-gaps` page load (league-wide `RBGapStat[]`). Pass this to `RunGapDiagram` as a new prop. At modal open time, aggregate each player's per-gap rows into overall stats (sum carries, compute carry-weighted averages for rate stats), then compute percentiles across all league RBs.

### RBStatCard Component

New file: `components/charts/RBStatCard.tsx`

Similar to `QBStatCard`:
- `"use client"` component
- Portal-rendered modal via `createPortal` (same pattern as QBStatCard)
- Header: player name, team logo, team color accent
- Radar chart (6 axes above)
- Stat chips showing raw values for each metric
- Gap breakdown section showing EPA/carry by gap (LE through RE)
- Close on backdrop click or Escape key

### Data Flow and Modal Hosting

The modal is hosted in `RunGapDiagram` (not `PlayerGapCards`) because:
1. `RunGapDiagram` has access to the full `gapStats` array (all players × all gaps for the team)
2. `RunGapDiagram` will receive `allGapStats` (league-wide) for percentile computation
3. `PlayerGapCards` only has stats for the currently selected gap view

**Flow:**
1. `PlayerGapCards` receives an `onPlayerClick: (playerId: string) => void` callback prop
2. User clicks RB name in `PlayerGapCards`
3. `PlayerGapCards` calls `onPlayerClick(playerId)`
4. `RunGapDiagram` sets `selectedRB` state, filters `gapStats` for that player's per-gap data
5. `RunGapDiagram` renders `<RBStatCard>` with player data, team color, and league-wide stats for percentiles

## Files Changed

| File | Change |
|------|--------|
| `components/qb/RadarChart.tsx` | Add optional `axes` prop (must be exactly 6 items) |
| `components/charts/RBStatCard.tsx` | **NEW** — RB modal with radar chart and gap breakdown |
| `components/charts/PlayerGapCards.tsx` | Add `onPlayerClick` prop, make player name clickable |
| `components/charts/RunGapDiagram.tsx` | Host RB modal state, pass `onPlayerClick` to PlayerGapCards, receive + pass `allGapStats` |
| `components/charts/TeamScatterPlot.tsx` | Add "View Run Gaps →" link in D3 tooltip |
| `components/qb/QBStatCard.tsx` | Add "View Run Gaps" link button |
| `app/page.tsx` | Convert to async, fetch + display data freshness |
| `app/run-gaps/page.tsx` | Pass `allGapStats` to `RunGapDiagram` |

## Out of Scope

- Favorite teams / localStorage personalization
- Weekly movers / historical snapshots
- Notification system
- Changelog page
