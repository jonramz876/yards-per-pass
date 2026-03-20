# Snap Counts Integration — Design Spec

**Date:** 2026-03-20
**Status:** Approved
**Scope:** Receiver page only (no RB/QB changes)

## Problem

The receiver page has routes run, YPRR, and TPRR but lacks snap-level context. Fantasy analysts and NFL fans want to know: How much does this player play? When he's on the field, is he running routes or blocking? Snap share and route participation rate are standard metrics that answer these questions.

## Approach: Derive from Participation Data

Compute snap counts from the existing `pbp_participation` download (already used for routes_run). No new data download required.

**Why not official PFR snap_counts parquet?** The PFR dataset uses `pfr_player_id` which only maps to our `gsis_id` for 69.5% of skill players via rosters. Participation-derived counts correlate at 0.983 with official numbers, give 100% coverage, and stay internally consistent with routes_run (route_participation_rate can never exceed 1.0).

**What's different from routes_run?** Routes = pass plays where player is on field. Total snaps = ALL plays (run, pass, penalties, etc.) where player is on field. The ratio (route participation rate) separates pass-catchers from blockers.

## Data Pipeline Changes (scripts/ingest.py)

### In `aggregate_receiver_stats()`

The function already:
1. Downloads `pbp_participation`
2. Explodes `offense_players` semicolon field into one row per player per play
3. Joins to pass plays to count routes_run

**Add after step 2 (before the pass-play join):**

```python
# Count ALL plays per player = total_snaps
total_snaps = exploded.groupby('player_id')['play_id'].nunique()

# Count ALL plays per team = team_total_snaps (for snap_share denominator)
team_snaps = exploded.groupby('possession_team')['play_id'].nunique()
```

**Compute new columns per player:**
```python
total_snaps = <from groupby above>
snap_share = total_snaps / team_total_snaps  # 0.0–1.0
route_participation_rate = routes_run / total_snaps  # 0.0–1.0
```

**Graceful fallback:** If participation data is None for a season, all three columns get None (same as existing routes_run fallback).

**Validation:** Warn if snap_share > 1.0 or route_participation_rate > 1.0 (should never happen with this approach).

### In `ensure_receiver_stats_table()`

Add three ALTER TABLE migrations (same pattern as YPRR/TPRR):
```sql
ALTER TABLE receiver_season_stats ADD COLUMN IF NOT EXISTS total_snaps INTEGER;
ALTER TABLE receiver_season_stats ADD COLUMN IF NOT EXISTS snap_share NUMERIC;
ALTER TABLE receiver_season_stats ADD COLUMN IF NOT EXISTS route_participation_rate NUMERIC;
```

### In `upsert_receiver_stats()`

Add the three new columns to the upsert column list.

## Database Schema Changes

**Table:** `receiver_season_stats`
**New columns:**

| Column | Type | Description |
|--------|------|-------------|
| `total_snaps` | INTEGER | Offensive plays player was on field (from participation data) |
| `snap_share` | NUMERIC | player total_snaps / team total offensive snaps (0.0–1.0) |
| `route_participation_rate` | NUMERIC | routes_run / total_snaps (0.0–1.0) |

## Frontend Changes

### Types (lib/types/index.ts)

Add to `ReceiverSeasonStat`:
```typescript
total_snaps: number;
snap_share: number;
route_participation_rate: number;
```

### ReceiverLeaderboard.tsx

**Standard tab** — add `Snaps` column:
- Key: `total_snaps`
- Display: integer (no decimal)
- Heatmap: none (raw count, like GP/Tgt/Rec)
- Position: next to existing `Routes` column

**Advanced tab** — add `Snap%` and `Route%` columns:
- `Snap%`: key `snap_share`, display as percentage (e.g., "82.3%"), green-scale heatmap
- `Route%`: key `route_participation_rate`, display as percentage, green-scale heatmap
- Position: after TPRR (end of advanced metrics)

### ReceiverStatCard.tsx

Add two new **bar stats** (alongside existing Yds/G, TD/G, Rec/G, YPR):
- `Snap%` — snap_share as percentage, percentile coloring against filtered pool
- `Route%` — route_participation_rate as percentage, percentile coloring against filtered pool

Radar chart: **No changes** — keep current 6 axes (EPA/Tgt, Catch%, ADOT, YAC/Rec, Tgt Share, YPRR).

### MetricTooltip.tsx

Add plain-English definitions:
- **Snaps:** "Total offensive plays the player was on the field"
- **Snap%:** "Percentage of team's offensive plays the player was on the field"
- **Route%:** "How often the player runs a route when on the field — separates pass catchers from blockers"

### Glossary page (app/glossary/page.tsx)

Add entries:
- **Snap Count** — total offensive plays on field
- **Snap Share (Snap%)** — player snaps / team offensive snaps
- **Route Participation Rate (Route%)** — routes run / total snaps; high = pure pass catcher, low = blocker

## Tests (tests/test_receiver_stats.py)

5 new pytest tests:

1. **test_total_snaps_count** — verify total_snaps counts all plays (pass + run + other), not just pass plays. Use mock participation data with known play types.

2. **test_snap_share_computation** — verify snap_share = player_snaps / team_snaps. Player with 50 snaps on team with 100 total → 0.50.

3. **test_route_participation_rate** — verify rate = routes_run / total_snaps. Player with 40 routes and 60 total snaps → 0.667.

4. **test_snap_zero_division** — verify player with 0 total_snaps gets None/NaN for snap_share and route_participation_rate (no ZeroDivisionError).

5. **test_snap_share_bounds** — verify no player has snap_share > 1.0 or route_participation_rate > 1.0.

**Estimated total:** 83 existing + 5 new = 88 tests.

## Files Changed

| File | Change |
|------|--------|
| `scripts/ingest.py` | Extend participation processing, add 3 columns, schema migration |
| `lib/types/index.ts` | Add 3 fields to ReceiverSeasonStat |
| `lib/data/receivers.ts` | No change needed (SELECT * already returns new columns) |
| `components/tables/ReceiverLeaderboard.tsx` | Add Snaps, Snap%, Route% columns |
| `components/receivers/ReceiverStatCard.tsx` | Add 2 bar stats |
| `components/ui/MetricTooltip.tsx` | Add 3 tooltip definitions |
| `app/glossary/page.tsx` | Add 3 glossary entries |
| `tests/test_receiver_stats.py` | Add 5 new tests |

## What This Does NOT Include

- RB snap share (separate pipeline, future work)
- QB snap share (not useful — starters are ~100%)
- Official PFR snap counts download (rejected due to 69.5% ID mapping coverage)
- Radar chart changes (current 6 axes are well-chosen)
- Any new database tables (columns added to existing receiver_season_stats)
