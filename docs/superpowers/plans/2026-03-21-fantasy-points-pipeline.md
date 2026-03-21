# Fantasy Points + Automated Pipeline — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add PPR/Half/Standard fantasy points to leaderboards, player pages, and game logs. Automate the data pipeline to run after every game day.

**Architecture:** Fantasy points computed client-side from existing stat fields (no pipeline changes). Scoring toggle persists in URL. Automated pipeline adds 4 cron schedules to existing GitHub Actions workflow.

**Tech Stack:** TypeScript, Next.js 14, GitHub Actions

**Spec:** `docs/superpowers/specs/2026-03-21-fantasy-points-pipeline-design.md`

---

## File Map

### New Files
| File | Responsibility |
|------|---------------|
| `lib/stats/fantasy.ts` | Fantasy point scoring functions (qbFantasyPoints, wrFantasyPoints, rbFantasyPoints) |

### Modified Files
| File | Changes |
|------|---------|
| `components/tables/QBLeaderboard.tsx` | Add FPts column + scoring toggle |
| `components/tables/ReceiverLeaderboard.tsx` | Add FPts column + scoring toggle |
| `components/player/PlayerOverviewQB.tsx` | Add fantasy pts bar stat |
| `components/player/PlayerOverviewWR.tsx` | Add fantasy pts bar stat |
| `components/player/PlayerOverviewRB.tsx` | Add fantasy pts bar stat + fumbles_lost to aggregation |
| `components/player/GameLogTab.tsx` | Add FPts column per weekly row |
| `.github/workflows/data-refresh.yml` | Replace single cron with 4 game-day crons |

---

### Task 1: Fantasy scoring utility + tests

**Files:**
- Create: `lib/stats/fantasy.ts`

- [ ] **Step 1: Create the fantasy scoring utility**

Create `lib/stats/fantasy.ts`:
```typescript
export type ScoringFormat = "ppr" | "half" | "std";

const PPR_BONUS: Record<ScoringFormat, number> = { ppr: 1.0, half: 0.5, std: 0 };

export function qbFantasyPoints(stats: {
  passing_yards: number; touchdowns: number; interceptions: number;
  rush_yards?: number; rush_tds?: number; fumbles_lost?: number;
}): number {
  return (
    (stats.passing_yards || 0) / 25 +
    (stats.touchdowns || 0) * 4 +
    (stats.interceptions || 0) * -2 +
    (stats.rush_yards || 0) / 10 +
    (stats.rush_tds || 0) * 6 +
    (stats.fumbles_lost || 0) * -1
  );
}

export function wrFantasyPoints(
  stats: { receiving_yards: number; receiving_tds: number; receptions: number; fumbles_lost?: number },
  format: ScoringFormat = "ppr"
): number {
  return (
    (stats.receiving_yards || 0) / 10 +
    (stats.receiving_tds || 0) * 6 +
    (stats.receptions || 0) * PPR_BONUS[format] +
    (stats.fumbles_lost || 0) * -1
  );
}

export function rbFantasyPoints(
  stats: {
    rushing_yards: number; rushing_tds: number;
    receiving_yards?: number; receiving_tds?: number;
    receptions?: number; fumbles_lost?: number;
  },
  format: ScoringFormat = "ppr"
): number {
  return (
    (stats.rushing_yards || 0) / 10 +
    (stats.rushing_tds || 0) * 6 +
    (stats.receiving_yards || 0) / 10 +
    (stats.receiving_tds || 0) * 6 +
    (stats.receptions || 0) * PPR_BONUS[format] +
    (stats.fumbles_lost || 0) * -1
  );
}
```

- [ ] **Step 2: Verify TypeScript**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```
git add lib/stats/fantasy.ts
git commit -m "feat: add fantasy points scoring utility (PPR/Half/Standard)"
```

---

### Task 2: QB Leaderboard — FPts column + scoring toggle

**Files:**
- Modify: `components/tables/QBLeaderboard.tsx`

- [ ] **Step 1: Add scoring format state and toggle**

Read the file. Add state near the other filter states:
```typescript
import { qbFantasyPoints, type ScoringFormat } from "@/lib/stats/fantasy";

const [scoringFormat, setScoringFormat] = useState<ScoringFormat>("ppr");
```

Add a 3-button pill group in the controls section (after the archetype dropdown):
```tsx
<div className="flex items-center gap-1 border border-gray-200 rounded-md overflow-hidden">
  {(["ppr", "half", "std"] as ScoringFormat[]).map((fmt) => (
    <button
      key={fmt}
      onClick={() => setScoringFormat(fmt)}
      className={`px-2 py-1 text-xs font-medium transition-colors ${
        scoringFormat === fmt ? "bg-navy text-white" : "bg-white text-gray-600 hover:bg-gray-50"
      }`}
    >
      {fmt === "ppr" ? "PPR" : fmt === "half" ? "Half" : "Std"}
    </button>
  ))}
</div>
```

- [ ] **Step 2: Add FPts column to both ADVANCED_COLUMNS and STANDARD_COLUMNS**

Add to both arrays:
```typescript
{ key: "fantasy_pts", label: "FPts", group: "efficiency" },
```

- [ ] **Step 3: Update getVal to compute fantasy points**

In the `getVal` function's switch statement, add:
```typescript
case "fantasy_pts":
  return qbFantasyPoints({
    passing_yards: qb.passing_yards,
    touchdowns: qb.touchdowns,
    interceptions: qb.interceptions,
    rush_yards: qb.rush_yards,
    rush_tds: qb.rush_tds,
    fumbles_lost: qb.fumbles_lost,
  });
```

Note: QB fantasy points don't vary by format (no receptions), so `scoringFormat` is not needed here. But the toggle should still appear for consistency with the receiver leaderboard.

- [ ] **Step 4: Update formatVal and formatAvg for fantasy_pts**

Add case in both functions:
```typescript
case "fantasy_pts":
  return val.toFixed(1);
```

- [ ] **Step 5: Verify and commit**

Run: `npx tsc --noEmit`
Run: `npx next lint`

```
git add components/tables/QBLeaderboard.tsx
git commit -m "feat: add fantasy points column + scoring toggle to QB leaderboard"
```

---

### Task 3: Receiver Leaderboard — FPts column + scoring toggle

**Files:**
- Modify: `components/tables/ReceiverLeaderboard.tsx`

- [ ] **Step 1: Same pattern as QB leaderboard**

Import `wrFantasyPoints` and `ScoringFormat`. Add `scoringFormat` state. Add pill toggle. Add "FPts" to both column arrays.

Key difference: WR fantasy points VARY by format, so `getVal` needs access to `scoringFormat`:

```typescript
case "fantasy_pts":
  return wrFantasyPoints({
    receiving_yards: rec.receiving_yards,
    receiving_tds: rec.receiving_tds,
    receptions: rec.receptions,
    fumbles_lost: rec.fumbles_lost,
  }, scoringFormat);
```

Add `scoringFormat` to the `filtered` useMemo dependency array since sort order changes when format changes.

- [ ] **Step 2: Verify and commit**

Run: `npx tsc --noEmit`
Run: `npx next lint`

```
git add components/tables/ReceiverLeaderboard.tsx
git commit -m "feat: add fantasy points column + scoring toggle to receiver leaderboard"
```

---

### Task 4: Player page overview tabs — fantasy pts bar stat

**Files:**
- Modify: `components/player/PlayerOverviewQB.tsx`
- Modify: `components/player/PlayerOverviewWR.tsx`
- Modify: `components/player/PlayerOverviewRB.tsx`

- [ ] **Step 1: QB overview — add fantasy pts bar**

Read `PlayerOverviewQB.tsx`. Find the `BAR_STATS` array. Add:
```typescript
{ key: "fantasy_pts", label: "FPts", pct: false },
```

Update `getBarValue` to compute:
```typescript
case "fantasy_pts":
  return qbFantasyPoints({
    passing_yards: qb.passing_yards, touchdowns: qb.touchdowns,
    interceptions: qb.interceptions, rush_yards: qb.rush_yards,
    rush_tds: qb.rush_tds, fumbles_lost: qb.fumbles_lost,
  });
```

Import `qbFantasyPoints` from `@/lib/stats/fantasy`.

- [ ] **Step 2: WR overview — add fantasy pts bar**

Same pattern with `wrFantasyPoints`. Default to PPR format on the player page (no toggle needed here — the bar shows PPR as the standard).

- [ ] **Step 3: RB overview — add fantasy pts bar + fix fumbles_lost aggregation**

Read `PlayerOverviewRB.tsx`. Find the `AggregatedRB` interface and the aggregation loop. Add `fumbles_lost` to both:

In the interface:
```typescript
fumbles_lost: number;
```

In the aggregation loop, add:
```typescript
agg.fumbles_lost = (agg.fumbles_lost || 0) + (r.fumbles_lost || 0);
```

Then add the fantasy pts bar using `rbFantasyPoints`.

- [ ] **Step 4: Verify and commit**

Run: `npx tsc --noEmit`
Run: `npx next lint`

```
git add components/player/PlayerOverviewQB.tsx components/player/PlayerOverviewWR.tsx components/player/PlayerOverviewRB.tsx
git commit -m "feat: add fantasy points bar stat to all player overview tabs"
```

---

### Task 5: Game Log — fantasy pts column per week

**Files:**
- Modify: `components/player/GameLogTab.tsx`

- [ ] **Step 1: Add FPts column to each position's column definitions**

Read `GameLogTab.tsx`. Find where QB/WR/RB columns are defined (likely separate arrays or switch cases).

For QB columns, add at the end:
```typescript
{
  key: "fpts", label: "FPts", numeric: true, sortable: true,
  getValue: (row) => {
    const qb = row as QBWeeklyStat;
    return qbFantasyPoints({
      passing_yards: qb.passing_yards, touchdowns: qb.touchdowns,
      interceptions: qb.interceptions, rush_yards: qb.rush_yards,
      rush_tds: qb.rush_tds, fumbles_lost: qb.fumbles_lost,
    });
  },
  format: fmtDec1,
}
```

For WR columns (default PPR):
```typescript
{
  key: "fpts", label: "FPts", numeric: true, sortable: true,
  getValue: (row) => {
    const wr = row as ReceiverWeeklyStat;
    return wrFantasyPoints({
      receiving_yards: wr.receiving_yards, receiving_tds: wr.receiving_tds,
      receptions: wr.receptions, fumbles_lost: 0, // weekly type lacks fumbles_lost
    }, "ppr");
  },
  format: fmtDec1,
}
```

For RB columns:
```typescript
{
  key: "fpts", label: "FPts", numeric: true, sortable: true,
  getValue: (row) => {
    const rb = row as RBWeeklyStat;
    return rbFantasyPoints({
      rushing_yards: rb.rushing_yards, rushing_tds: rb.rushing_tds,
      receiving_yards: rb.receiving_yards || 0, receiving_tds: rb.receiving_tds || 0,
      receptions: rb.receptions || 0, fumbles_lost: rb.fumbles_lost || 0,
    }, "ppr");
  },
  format: fmtDec1,
}
```

Import the scoring functions from `@/lib/stats/fantasy`.

- [ ] **Step 2: Verify and commit**

Run: `npx tsc --noEmit`
Run: `npx next lint`

```
git add components/player/GameLogTab.tsx
git commit -m "feat: add fantasy points column to game log tab (all positions)"
```

---

### Task 6: Automated pipeline — 4 game-day crons

**Files:**
- Modify: `.github/workflows/data-refresh.yml`

- [ ] **Step 1: Replace the single cron with 4 entries**

Change lines 4-7 from:
```yaml
on:
  schedule:
    - cron: '0 11 * * 3'  # Every Wednesday at 11:00 AM UTC
  workflow_dispatch:
```

To:
```yaml
on:
  schedule:
    - cron: '0 12 * * 5'  # Friday 7 AM ET (12:00 UTC) — after Thursday Night Football
    - cron: '0 12 * * 1'  # Monday 7 AM ET — after Sunday games
    - cron: '0 12 * * 2'  # Tuesday 7 AM ET — after Monday Night Football
    - cron: '0 12 * * 3'  # Wednesday 7 AM ET — late stat corrections
  workflow_dispatch:
```

Keep the rest of the file unchanged — the `workflow_dispatch` inputs, offseason check, and revalidation all work as-is.

- [ ] **Step 2: Commit**

```
git add .github/workflows/data-refresh.yml
git commit -m "feat: automate data pipeline — 4 game-day cron schedules (Fri/Mon/Tue/Wed)"
```

---

### Task 7: Build verification + chaos test

- [ ] **Step 1: TypeScript check**

Run: `npx tsc --noEmit`

- [ ] **Step 2: Lint check**

Run: `npx next lint`

- [ ] **Step 3: Run Python tests (no regressions)**

Run: `python -m pytest tests/ -v`
Expected: All 124 tests pass

- [ ] **Step 4: Push**

```
git push
```
