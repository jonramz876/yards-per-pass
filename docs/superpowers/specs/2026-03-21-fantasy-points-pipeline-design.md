# Fantasy Points Integration + Automated Pipeline — Design Spec

**Date:** 2026-03-21
**Status:** Approved
**Scope:** Fantasy points on leaderboards/player pages/game logs + automated weekly data refresh

---

## 1. Fantasy Points

### Scoring Formulas (computed client-side)

**Passing:**
- 1 point per 25 passing yards
- 4 points per passing TD
- -2 points per interception
- -1 point per fumble lost

**Rushing:**
- 1 point per 10 rushing yards
- 6 points per rushing TD
- -1 point per fumble lost

**Receiving:**
- 1 point per 10 receiving yards
- 6 points per receiving TD
- -1 point per fumble lost
- PPR bonus: 1.0 (PPR), 0.5 (Half-PPR), 0.0 (Standard) per reception

**No pipeline changes needed.** All source stats already exist in the database. Fantasy points are derived client-side from existing fields.

### Where It Appears

**QB Leaderboard (`QBLeaderboard.tsx`):**
- New "FPts" column in both Advanced and Standard tabs (sortable)
- Computed from: passing_yards, touchdowns, interceptions, rush_yards, rush_tds, fumbles_lost
- Scoring toggle in controls bar

**Receiver Leaderboard (`ReceiverLeaderboard.tsx`):**
- New "FPts" column (sortable)
- Computed from: receiving_yards, receiving_tds, receptions (PPR bonus), fumbles_lost

**Player Page Overview Tab (`PlayerOverviewQB/WR/RB.tsx`):**
- Fantasy points total as a bar stat in the vs-league bars section
- Label: "Fantasy Pts (PPR)" / "(Half)" / "(Std)"

**Game Log Tab (`GameLogTab.tsx`):**
- New "FPts" column at the end of each weekly row
- QB: passing + rushing fantasy points combined per week
- WR/TE: receiving fantasy points per week
- RB: rushing + receiving fantasy points per week

**Scoring Toggle:**
- 3-button pill group: `PPR | Half | Standard`
- Default: PPR
- Persists via URL param `?scoring=ppr` (or `half` or `std`)
- On leaderboards: appears in controls bar next to archetype filter
- On player pages: appears above the game log tab
- Leaderboard and player page share the same URL param

### Implementation

**New utility: `lib/stats/fantasy.ts`**
```typescript
export type ScoringFormat = "ppr" | "half" | "std";

export function qbFantasyPoints(stats: {
  passing_yards: number; touchdowns: number; interceptions: number;
  rush_yards: number; rush_tds: number; fumbles_lost: number;
}): number

export function wrFantasyPoints(stats: {
  receiving_yards: number; receiving_tds: number;
  receptions: number; fumbles_lost: number;
}, format: ScoringFormat): number

export function rbFantasyPoints(stats: {
  rushing_yards: number; rushing_tds: number;
  receiving_yards: number; receiving_tds: number;
  receptions: number; fumbles_lost: number;
}, format: ScoringFormat): number
```

QB fantasy points don't vary by format (no receptions). WR/TE/RB points depend on the PPR multiplier.

All functions should use `(stats.field || 0)` defensive patterns for null safety.

**Note:** QB types use `rush_yards`/`rush_tds`, RB types use `rushing_yards`/`rushing_tds`. The function signatures must match the correct type field names.

**Note:** `ReceiverWeeklyStat` is missing `fumbles`/`fumbles_lost` fields. For weekly WR/TE game log rows, treat fumbles as 0 (known limitation — season totals will be accurate). If the columns are added to the weekly table later, the game log will automatically pick them up.

**Note:** `PlayerOverviewRB.tsx` aggregates weekly stats into `AggregatedRB` which currently skips `fumbles_lost`. Implementation must add `fumbles_lost` to the aggregation loop.

### Files Changed

| File | Change |
|------|--------|
| `lib/stats/fantasy.ts` | New — scoring functions |
| `components/tables/QBLeaderboard.tsx` | Add FPts column, scoring toggle |
| `components/tables/ReceiverLeaderboard.tsx` | Add FPts column, scoring toggle |
| `components/player/PlayerOverviewQB.tsx` | Add fantasy pts bar stat |
| `components/player/PlayerOverviewWR.tsx` | Add fantasy pts bar stat |
| `components/player/PlayerOverviewRB.tsx` | Add fantasy pts bar stat |
| `components/player/GameLogTab.tsx` | Add FPts column per week |

---

## 2. Automated Pipeline

### Schedule

Replace the existing single cron in `.github/workflows/data-refresh.yml` with 4 cron entries:

```yaml
on:
  schedule:
    - cron: '0 12 * * 5'  # Friday 7 AM ET (12:00 UTC) — after Thursday Night Football
    - cron: '0 12 * * 1'  # Monday 7 AM ET — after Sunday games
    - cron: '0 12 * * 2'  # Tuesday 7 AM ET — after Monday Night Football
    - cron: '0 12 * * 3'  # Wednesday 7 AM ET — late stat corrections
  workflow_dispatch:       # keep manual trigger (with optional season input)
```

**Note:** This replaces the existing `cron: '0 11 * * 3'` (Wednesday only). The Wednesday entry moves from 11 UTC to 12 UTC for consistency.

### Existing Safeguards (no changes needed)
- "Check for offseason" step skips if no new data available
- ISR revalidation webhook called at the end (busts all page caches including homepage)
- Pipeline is idempotent (upserts, not inserts)
- Retry decorator on all Supabase writes

### Files Changed

| File | Change |
|------|--------|
| `.github/workflows/data-refresh.yml` | Replace single Wednesday cron with 4 game-day crons |

---

## What This Does NOT Include

- Custom scoring (user-defined point values)
- Fantasy projections or start/sit recommendations
- Weekly rankings by fantasy points (the leaderboard sort handles this)
- Roster management or league integration
- Pipeline monitoring/alerting (backlog item)
