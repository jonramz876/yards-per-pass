# Phase 2: Data & Analytics — Design Spec

**Date:** 2026-03-15
**Scope:** 10 items (D-M1 through D-M11) from comprehensive review
**Project:** Yards Per Pass (yards-per-pass.vercel.app)

---

## Overview

Phase 2 Data & Analytics adds new stats (fumbles, TD:INT, per-game stats, total TDs), fixes an aDOT computation bug, improves type safety, and enhances the team mobile view. All changes maintain PFR-comparable accuracy — every pipeline change includes golden-value tests verified against Pro Football Reference.

---

## D-M1: Fumbles & Fumbles Lost

**Problem:** The QB leaderboard has no turnover stats beyond interceptions. Fumbles lost is a key box-score stat.

**Changes:**

### Pipeline (`scripts/ingest.py`)
- Add `fumble` and `fumble_lost` to `REQUIRED_PBP_COLS`
- In `aggregate_qb_stats`, aggregate fumbles across ALL plays where the QB is involved:
  - On dropback plays: sum `fumble` and `fumble_lost` grouped by `passer_player_id`
  - On designed rush plays: sum `fumble` and `fumble_lost` grouped by `rusher_player_id`
  - Merge both, summing across play types per player
- Add `fumbles` and `fumbles_lost` to the final `cols` list and `upsert_qb_stats` cols

### Schema (`scripts/schema.sql`)
```sql
-- Add to qb_season_stats table definition
fumbles INTEGER,
fumbles_lost INTEGER,
```

### Live DB Migration
```sql
ALTER TABLE qb_season_stats ADD COLUMN IF NOT EXISTS fumbles INTEGER;
ALTER TABLE qb_season_stats ADD COLUMN IF NOT EXISTS fumbles_lost INTEGER;
```

### Types (`lib/types/index.ts`)
```typescript
fumbles: number;
fumbles_lost: number;
```

### UI (`QBLeaderboard.tsx`)
- Add `FL` (fumbles lost) to STANDARD_COLUMNS after `interceptions`:
  ```typescript
  { key: "fumbles_lost", label: "FL", tooltip: "FL", group: "passing" },
  ```

### Tooltip (`MetricTooltip.tsx`)
- Add definition: `"FL": "Fumbles lost. Only counts fumbles recovered by the defense — the turnovers that actually hurt."`

### Verification
- **Golden-value test**: Josh Allen 2025 fumbles/fumbles_lost vs PFR
- **Golden-value test**: Lamar Jackson 2025 fumbles/fumbles_lost vs PFR
- nflverse `fumble` column = 1 on any play with a fumble, `fumble_lost` = 1 when the fumbling team loses possession

---

## D-M2: Success Rate Alignment (Tooltip Only)

**Problem:** Team page success rate includes sacks in the denominator; QB page excludes them. Both are valid but the difference is unexplained.

**Changes:**
- No formula changes (both definitions are analytically correct for their context)
- Add tooltip text to scatter plot tooltip's success rate display:
  - In `TeamScatterPlot.tsx` tooltip `detailDiv`, append "(incl. sacks)" after the success rate value
- The QB leaderboard already has a methodology note explaining sack exclusion

### Tooltip (`MetricTooltip.tsx`)
- Update `Success%` definition to add: "Note: Team-level success rate on the scatter plot includes sacks in the denominator."

---

## D-M3: aDOT on Pass Attempts Only

**Problem:** aDOT currently computes `air_yards.dropna().mean()` across ALL dropbacks, including scrambles and sacks which have no meaningful air yards (typically NaN or 0). This dilutes the metric.

**Changes:**

### Pipeline (`scripts/ingest.py`)
- Replace the current aDOT aggregation line:
  ```python
  # BEFORE (on all dropbacks):
  adot=('air_yards', lambda x: x.dropna().mean()),
  ```
- Compute aDOT separately on true pass attempts only:
  ```python
  # After the main qb_drop aggregation, compute aDOT on pass attempts only
  adot_plays = dropbacks[(dropbacks['pass_attempt'] == 1) & (dropbacks['sack'] != 1)]
  adot_stats = adot_plays.groupby('passer_player_id')['air_yards'].apply(
      lambda x: x.dropna().mean()
  ).reset_index().rename(columns={'passer_player_id': 'player_id', 'air_yards': 'adot'})
  ```
- Remove `adot` from the main `qb_drop` aggregation, merge `adot_stats` afterward

### Verification
- **Golden-value test**: Compare aDOT for 3 QBs (deep thrower like Stafford, short-game QB like Garoppolo, mobile QB like Lamar) against PFR/NFL Next Gen Stats
- The fix should increase aDOT slightly for mobile QBs (scrambles with air_yards=0 were pulling the mean down)

---

## D-M5: Per-Game Stats (Yards/G, TD/G)

**Problem:** Raw volume stats (yards, TDs) penalize QBs who missed games. Per-game normalizes this.

**Changes:**
- **Frontend-computed only** — no pipeline or schema changes

### UI (`QBLeaderboard.tsx`)
- Add to STANDARD_COLUMNS after `passing_yards`:
  ```typescript
  { key: "yards_per_game", label: "Yds/G", group: "passing" },
  ```
- Add after `touchdowns`:
  ```typescript
  { key: "tds_per_game", label: "TD/G", group: "passing" },
  ```
- These are virtual keys — computed in `formatVal`:
  ```typescript
  case "yards_per_game":
    return (qb.passing_yards / qb.games).toFixed(1);
  case "tds_per_game":
    return (qb.touchdowns / qb.games).toFixed(1);
  ```
- Since these aren't real fields on `QBSeasonStat`, the sort logic needs a computed-value accessor:
  ```typescript
  function getVal(qb: QBSeasonStat, key: string): number {
    if (key === "yards_per_game") return qb.passing_yards / qb.games;
    if (key === "tds_per_game") return qb.touchdowns / qb.games;
    if (key === "total_tds") return qb.touchdowns + qb.rush_tds;
    if (key === "td_int_ratio") return qb.interceptions > 0 ? qb.touchdowns / qb.interceptions : Infinity;
    return qb[key as keyof QBSeasonStat] as number;
  }
  ```
  Use `getVal` in the sort comparator and `formatVal` for display.

---

## D-M6: Total TDs

**Problem:** No combined passing + rushing TD column. Dual-threat QBs (Lamar, Allen, Hurts) look worse without it.

**Changes:**
- **Frontend-computed only**

### UI (`QBLeaderboard.tsx`)
- Add to STANDARD_COLUMNS after `rush_tds`:
  ```typescript
  { key: "total_tds", label: "Tot TD", group: "rushing" },
  ```
- Computed via the `getVal` helper (see D-M5): `qb.touchdowns + qb.rush_tds`

---

## D-M7: getAvailableSeasons via data_freshness

**Problem:** Current implementation queries ALL rows from `team_season_stats` and deduplicates in JS with `new Set()`. Wasteful — returns ~192 rows just to extract 6 unique seasons.

**Changes:**

### Queries (`lib/data/queries.ts`)
```typescript
export async function getAvailableSeasons(): Promise<number[]> {
  const supabase = createServerClient();
  const { data, error } = await supabase
    .from("data_freshness")
    .select("season")
    .order("season", { ascending: false });

  if (error) return [];
  return (data || []).map((r: { season: number }) => r.season);
}
```
- `data_freshness` has one row per season (PRIMARY KEY on season), so no deduplication needed
- Falls back to empty array on error (same as current behavior)

---

## D-M8: 2020 CPOE Data Quality Note

**Problem:** COVID-impacted 2020 season had unusual conditions that may affect CPOE reliability. No warning for users.

**Changes:**

### UI (`QBLeaderboard.tsx`)
- Accept `season` as a new prop (already available from the page component)
- Add conditional note below the methodology section:
  ```tsx
  {season === 2020 && (
    <p className="text-amber-600">
      <span className="font-semibold">Note:</span> 2020 CPOE values may be less reliable due to COVID-impacted season conditions (no preseason, limited practice, opt-outs).
    </p>
  )}
  ```

### Page (`app/qb-leaderboard/page.tsx`)
- Pass `season` prop to `<QBLeaderboard>`

---

## D-M9: Nullable TypeScript Fields

**Problem:** Several `QBSeasonStat` fields can be `null` from the database but TypeScript declares them as `number`, hiding potential runtime issues.

**Changes:**

### Types (`lib/types/index.ts`)
Change these fields from `number` to `number | null`:
```typescript
cpoe: number | null;
adot: number | null;
epa_per_play: number | null;
epa_per_db: number | null;
rush_epa_per_play: number | null;
success_rate: number | null;
```

### Impact
- `formatVal` in QBLeaderboard already handles null/NaN → "—"
- `parseNumericFields` already converts null → NaN
- Sort comparator already handles null/NaN (pushes to bottom)
- The `getVal` helper (D-M5) should handle null: `return val ?? NaN`
- No UI breakage expected — this just makes the types honest

---

## D-M10: MobileTeamList Enhanced Metrics

**Problem:** MobileTeamList only shows Off/Def EPA and record. The scatter plot tooltip (desktop) shows pass rate, success rate, pass/rush EPA — mobile users miss this.

**Changes:**

### UI (`MobileTeamList.tsx`)
- Add a second row of detail stats below each team:
  ```tsx
  <div className="text-[11px] text-gray-400 tabular-nums">
    Pass EPA: {fmtEpa(t.off_pass_epa)} | Rush EPA: {fmtEpa(t.off_rush_epa)} |
    Pass Rate: {fmtPct(t.pass_rate)} | Success: {fmtPct(t.off_success_rate)}
  </div>
  ```
- Helper functions `fmtEpa` and `fmtPct` defined at module level (same format as scatter tooltip)

---

## D-M11: TD:INT Ratio

**Problem:** TD:INT ratio is a quick-read efficiency stat that's missing from the leaderboard. Every QB comparison article uses it.

**Changes:**
- **Frontend-computed only**

### UI (`QBLeaderboard.tsx`)
- Add to ADVANCED_COLUMNS after `any_a`:
  ```typescript
  { key: "td_int_ratio", label: "TD:INT", tooltip: "TD:INT", group: "efficiency" },
  ```
- Computed via `getVal`: `qb.interceptions > 0 ? qb.touchdowns / qb.interceptions : Infinity`
- Display format in `formatVal`:
  - If Infinity → show TD count (e.g., "5:0")
  - Otherwise → show ratio to 1 decimal + ":1" suffix (e.g., "2.5:1")

### Tooltip (`MetricTooltip.tsx`)
- Add: `"TD:INT": "Touchdown to interception ratio. Higher is better. Shows passing TDs only (rushing TDs not included)."`

---

## Stat Verification Plan

Given prior accuracy issues, every pipeline change gets verified:

### Golden-Value Tests (`tests/test_formulas.py`)

**New tests to add:**

1. **aDOT filter test**: Create a minimal DataFrame with a mix of pass attempts, sacks, and scrambles with known air_yards. Verify aDOT only uses `(pass_attempt==1) & (sack!=1)` plays.

2. **Fumble aggregation test**: Create a minimal DataFrame with fumbles on pass plays and rush plays. Verify both are counted for the correct QB.

3. **Total fumble count test**: Verify fumbles from dropback + designed rush + scramble plays are all attributed correctly.

### PFR Cross-Reference (Manual, Post-Ingest)

After re-running `ingest.py --all`, spot-check these QBs against PFR for 2025:

| QB | Stats to verify |
|----|----------------|
| Josh Allen | Fumbles, fumbles lost, aDOT |
| Lamar Jackson | Fumbles (rushing fumbles important), total TDs |
| Patrick Mahomes | aDOT, TD:INT ratio |

### Dry-Run Validation

Before writing to DB, run `python scripts/ingest.py --season 2025 --dry-run` and manually inspect the log output for the new columns.

---

## Implementation Order

1. **Pipeline first** (D-M1 fumbles, D-M3 aDOT) — these change stored data
2. **Tests** — golden-value tests for new aggregations
3. **Schema + types** (D-M1 new columns, D-M9 nullable fields)
4. **Queries** (D-M7 getAvailableSeasons)
5. **UI** (D-M1, D-M2, D-M5, D-M6, D-M8, D-M10, D-M11 — all frontend changes)
6. **Verify** — dry-run, re-ingest, PFR cross-reference

---

## Files Changed

| File | Items |
|------|-------|
| `scripts/ingest.py` | D-M1, D-M3 |
| `scripts/schema.sql` | D-M1 |
| `lib/types/index.ts` | D-M1, D-M9 |
| `lib/data/queries.ts` | D-M7 |
| `components/tables/QBLeaderboard.tsx` | D-M1, D-M5, D-M6, D-M8, D-M11 |
| `components/ui/MetricTooltip.tsx` | D-M1, D-M2, D-M11 |
| `components/charts/MobileTeamList.tsx` | D-M10 |
| `components/charts/TeamScatterPlot.tsx` | D-M2 |
| `app/qb-leaderboard/page.tsx` | D-M8 |
| `tests/test_formulas.py` | D-M1, D-M3 |

## Post-Implementation Steps

1. Run `ALTER TABLE` on Supabase for new columns
2. Run `python scripts/ingest.py --all` to repopulate with corrected aDOT and new fumble columns
3. Trigger ISR revalidation: `curl -X POST "https://yards-per-pass.vercel.app/api/revalidate" -H "x-revalidate-secret: <secret>"`
4. Spot-check live site stats against PFR
