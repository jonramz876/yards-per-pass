# QB Field Heat Map — Design Spec

**Date:** 2026-03-22
**Status:** Approved
**Scope:** QB player pages only (v1). WR/TE target maps are a planned future extension.

## Overview

A 3×3 SVG field diagram on QB player pages showing where the QB throws, broken down by depth (air yards) and direction (left/middle/right). Displays as a new "Field Map" tab alongside Overview and Game Log.

Inspired by NewOrleans.Football's field heat map, but built entirely from nflverse PBP data (`air_yards` for depth, `pass_location` for direction). No route-type data is available in nflverse, so this focuses on spatial distribution only.

## Data Source

From nflverse play-by-play:
- `air_yards` — numeric yards in the air (0.6% null rate, dropped)
- `pass_location` — categorical: "left", "middle", "right" (~185 nulls per season, dropped)
- `complete_pass`, `passing_yards`, `pass_touchdown`, `interception`, `epa` — outcome data
- `passer_player_id` — QB identity
- `pass_attempt == 1`, `sack != 1`, `qb_scramble != 1` — standard pass play filters

## Grid Structure

| | ← LEFT | MIDDLE | RIGHT → |
|---|---|---|---|
| **DEEP (20+)** | zone | zone | zone |
| **INTERMEDIATE (10-19)** | zone | zone | zone |
| **SHORT (0-9)** | zone | zone | zone |
| ▲ LINE OF SCRIMMAGE | | | |

- **Depth bins** from `air_yards`: short (0-9), intermediate (10-19), deep (20+)
- **Direction bins** from `pass_location`: left, middle, right
- Negative `air_yards` (screens behind LOS) binned into "short"
- 9 zones per QB per season

## Metric Tabs

Four tabs control what the big number in each cell displays and what drives the cell color:

| Tab | Big Number | Color Encoding |
|-----|-----------|----------------|
| **Targets** | Pass attempts count | Green intensity scaled to volume (more = darker) |
| **Catch%** | Completion percentage | Green (high %) → red (low %), neutral at ~65% (league avg) |
| **Yards** | Total passing yards | Green intensity scaled to yards |
| **EPA/Att** | EPA per attempt | Divergent green (positive) → red (negative), neutral at 0 |

### Cell Content

Each cell shows:
- **Big number** — the active tab's metric value (large, white, bold)
- **Sub-line** — completions/attempts (e.g., "5/11")
- **TD/INT badges** — green "2 TD" / red "1 INT" when present
- **Empty zones** — dash with faded/transparent cell when 0 attempts

The component builds a full 3×3 grid template and fills cells from data. Zones with no rows in the query result render as empty (dash, transparent background).

### Summary Bar

Dark navy header above the field showing season totals across all zones:
- Total attempts, completions/attempts (comp%), total yards, TDs (green), INTs (red)

## Data Pipeline

### New aggregation function: `aggregate_qb_pass_location_stats(plays, roster, season)`

Location: `scripts/ingest.py`

**Column validation:** At function entry, check that `pass_location` and `air_yards` columns exist in the DataFrame. If either is missing, log a warning and return an empty DataFrame (same pattern as `aggregate_rb_gap_stats` checking for `run_location`/`run_gap`).

**Filters:**
- `pass_attempt == 1`
- `sack != 1`
- `qb_scramble != 1`
- `qb_spike != 1` (spikes have `air_yards == 0` and would pollute short-middle zone)
- `passer_player_id` is in QB roster (from `weekly_rosters`)
- `air_yards` is not null
- `pass_location` is not null

**Binning:**
- `depth_bin`: `air_yards < 10` → "short", `10 <= air_yards < 20` → "intermediate", `air_yards >= 20` → "deep"
- `direction_bin`: `pass_location` value directly ("left", "middle", "right")

**Groupby:** `passer_player_id` + `depth_bin` + `direction_bin`

**Aggregated columns:**
- `pass_attempts` — count
- `completions` — sum of `complete_pass`
- `passing_yards` — sum of `passing_yards` with `.fillna(0).sum()` (matching existing pattern for NaN yards on incompletions)
- `pass_tds` — sum of `pass_touchdown`
- `interceptions` — sum of `interception`
- `epa_sum` — sum of non-null `epa` values (`.dropna().sum()`)
- `epa_per_attempt` — computed as `epa_sum / pass_attempts` (not pandas `mean()`, to avoid count mismatch when some plays have null EPA)
- `completion_pct` — `completions / pass_attempts`
- `adot` — average depth of target per zone (`air_yards.dropna().mean()`). Stored for future tooltip use (distinguishes "barely deep" 21 yds from "bomb" 40+ yds).
- `passer_rating` — calculated from the standard 4-component formula per zone. Set to `NULL` if zone has fewer than 5 attempts (too small a sample for meaningful rating).

**Player identity:**
- `player_name` from mode of `passer_player_name`
- `team_id` from team with most attempts (primary team). **Intentional design choice:** multi-team QBs (trades) are merged into one row per zone under their primary team. This matches the receiver pipeline pattern and simplifies the grid display. Per-team breakdowns are out of scope for v1.

### New Supabase table: `qb_pass_location_stats`

```sql
CREATE TABLE IF NOT EXISTS qb_pass_location_stats (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    player_id TEXT NOT NULL,
    player_name TEXT NOT NULL,
    team_id TEXT NOT NULL REFERENCES teams(id),
    season INT NOT NULL,
    depth_bin TEXT NOT NULL,      -- "short", "intermediate", "deep"
    direction_bin TEXT NOT NULL,  -- "left", "middle", "right"
    pass_attempts INT NOT NULL,
    completions INT NOT NULL,
    passing_yards NUMERIC,
    pass_tds INT DEFAULT 0,
    interceptions INT DEFAULT 0,
    epa_sum NUMERIC,
    epa_per_attempt NUMERIC,
    completion_pct NUMERIC,
    adot NUMERIC,
    passer_rating NUMERIC,
    UNIQUE (player_id, season, depth_bin, direction_bin)
);
```

- RLS enabled with `public_read` policy (same as all other tables)
- `ensure_qb_pass_location_tables(conn)` — DDL, NOT `@retry`
- `upsert_qb_pass_location_stats(conn, df)` — with `@retry(max_retries=2, delay=3)`
- UNIQUE constraint intentionally omits `team_id` since multi-team QBs are merged to primary team (one row per zone per season)

### Cleanup integration

`cleanup_stale_rows()` extended with new keyword parameter `qb_pass_loc_player_ids`. In `process_season()`, extract player IDs from the aggregation result and pass to cleanup:

```python
qb_pass_loc_player_ids = list(qb_pass_loc_df['player_id'].unique()) if not qb_pass_loc_df.empty else []
# ... passed to cleanup_stale_rows(..., qb_pass_loc_player_ids=qb_pass_loc_player_ids)
```

Cleanup deletes rows from `qb_pass_location_stats` where `season = ?` AND `player_id NOT IN (?)`, same pattern as other tables.

### Pipeline integration

- Called in the main ingest flow after `aggregate_qb_stats()`
- Included in GitHub Actions workflow (already runs all ingest functions)
- ISR revalidation: `/player` paths already covered by webhook

## TypeScript Data Layer

### New type: `QBPassLocationStat`

```typescript
export interface QBPassLocationStat {
  id: string;
  player_id: string;
  player_name: string;
  team_id: string;
  season: number;
  depth_bin: string;      // "short" | "intermediate" | "deep"
  direction_bin: string;  // "left" | "middle" | "right"
  pass_attempts: number;
  completions: number;
  passing_yards: number;
  pass_tds: number;
  interceptions: number;
  epa_sum: number | null;
  epa_per_attempt: number | null;
  completion_pct: number | null;
  adot: number | null;
  passer_rating: number | null;
}
```

Note: `depth_bin` and `direction_bin` use `string` (not union literals) for consistency with existing types like `RBGapStat.gap`.

### New query: `getQBPassLocationStats(playerId, season)`

Location: `lib/data/players.ts`

- Queries `qb_pass_location_stats` filtered by `player_id` and `season`
- Returns up to 9 rows (zones with 0 attempts produce no rows)
- Uses `parseNumericFields` for rate stats (`epa_per_attempt`, `completion_pct`, `adot`, `passer_rating`)

### Data fetching

In `app/player/[slug]/page.tsx`, added to the QB parallel fetch block:
```typescript
const [allQBs, weekly, teamReceivers, passLocationStats] = await Promise.all([
  getQBStats(currentSeason),
  getQBWeeklyStats(player.player_id, currentSeason),
  getTeamTopReceivers(player.current_team_id, currentSeason, 5),
  getQBPassLocationStats(player.player_id, currentSeason).catch(() => []),
]);
```

### PlayerPageContent props update

Add `passLocationStats?: QBPassLocationStat[]` to `PlayerPageContentProps` interface. Import `QBPassLocationStat` from `@/lib/types`.

## Frontend Component

### `components/player/PlayerFieldHeatMap.tsx`

- Pure React SVG (like RadarChart — no D3 dependency)
- Scales naturally via `viewBox` — no special mobile breakpoints needed

**Props:**
```typescript
interface PlayerFieldHeatMapProps {
  stats: QBPassLocationStat[];
  playerName: string;
  season: number;
}
```

**State:**
- `activeTab`: "targets" | "catch_pct" | "yards" | "epa" (default: "targets")

**Grid construction:** Component defines a `ZONES` constant with all 9 depth×direction combinations. On render, maps query results into a `Record<string, QBPassLocationStat>` keyed by `${depth_bin}-${direction_bin}`. Iterates over `ZONES` to render the grid, using the lookup to fill cells or rendering an empty dash.

**SVG structure:**
- Green turf background (`#2d5a27`)
- 3×3 grid of rounded-rect cells with 8px gap
- Yard line markers at 10 and 20 yard boundaries (white lines with labeled pills)
- Line of scrimmage at bottom (amber)
- Depth labels on left gutter: "DEEP (20+)", "INTERMEDIATE", "SHORT (0-9)" — 13px bold, rotated
- Direction labels at top: "← LEFT", "MIDDLE", "RIGHT →"

**Color scales:**
- Volume (Targets/Yards): `rgba(16, 185, 129, intensity)` where intensity = value / max_value across 9 zones, clamped to [0.05, 0.6] to avoid invisible or fully opaque cells
- Performance (Catch%): interpolate green → neutral → red based on percentage, with ~65% as neutral (league-average completion rate)
- EPA: divergent scale — `rgba(34, 197, 94, |epa| * scale)` for positive, `rgba(239, 68, 68, |epa| * scale)` for negative

### Tab wiring in `PlayerPageContent.tsx`

- Define `QB_TABS` as a separate array that includes `{ key: "field-map", label: "Field Map" }` in addition to the base Overview and Game Log tabs
- Use `QB_TABS` when `position === "QB"`, base `TABS` for all other positions
- `activeTab` validation uses the position-appropriate tabs array
- New `renderFieldMap()` function renders `PlayerFieldHeatMap` with `passLocationStats` prop

## Integration

- **Glossary:** Add "Field Heat Map" entry explaining depth buckets, air yards, and the 3×3 grid. Include note that direction (L/M/R) is derived from nflverse charting data which categorizes passes into three zones — users familiar with Next Gen Stats passing charts (x,y coordinates) should understand this is a coarser but publicly available alternative.
- **Sitemap:** No changes (player pages already dynamic)
- **Nav:** No changes (lives on player pages, not standalone)
- **Revalidation:** `/player` paths already in webhook

## Tests

New file: `tests/test_pass_location_stats.py` (~15-20 tests)

**Binning tests:**
- `air_yards` 5 → "short", 15 → "intermediate", 25 → "deep"
- `air_yards` -3 (screen behind LOS) → "short"
- `air_yards` 0 → "short", 9 → "short", 10 → "intermediate", 19 → "intermediate", 20 → "deep"
- `pass_location` "left"/"middle"/"right" → preserved as-is

**Filtering tests:**
- Null `air_yards` rows excluded
- Null `pass_location` rows excluded
- Sacks excluded (`sack == 1`)
- QB scrambles excluded (`qb_scramble == 1`)
- QB spikes excluded (`qb_spike == 1`)
- Non-QB passers filtered out (trick plays)

**Aggregation tests:**
- Correct `pass_attempts` count per zone
- Correct `completions` sum per zone
- `completion_pct` = completions / attempts
- `epa_per_attempt` = epa_sum / pass_attempts (not pandas mean)
- `passing_yards` uses `.fillna(0).sum()` (nulls on incompletions)
- Passer rating formula spot-check against known values
- Passer rating is NULL when zone has < 5 attempts
- Multi-team QB: assigned to primary team (most attempts)

**Edge cases:**
- QB with 0 attempts in a zone → zone not in results
- Single attempt in a zone → valid row, passer_rating is NULL (< 5 threshold)
- All 9 zones populated → 9 rows returned
- Missing `pass_location` column → empty DataFrame returned with warning

## Future Extensions (not in this spec)

- **WR/TE target maps** — same table schema, filter by `receiver_player_id` instead of `passer_player_id`. Same 3×3 grid shows "where do I get targeted?"
- **Team-level passing chart** — aggregate all QBs on a team, show on team hub
- **Season-over-season comparison** — overlay two seasons' heat maps
- **Down/distance filters** — filter zones by early downs, passing downs, red zone (like run gap tool)
- **Hover detail** — tooltip with full stat breakdown on cell hover
