# YPRR + TPRR via Participation Data — Design Spec

**Date:** 2026-03-19
**Status:** Approved
**Context:** YPRR and TPRR are premium receiver metrics that require route participation data. nflverse publishes pbp_participation parquet with per-play per-player on-field data.

## Overview

Add yards per route run (YPRR) and targets per route run (TPRR) to the receiver pipeline and leaderboard. Download nflverse participation data, join to pass plays to count routes run per receiver, compute YPRR and TPRR, store in existing `receiver_season_stats` table.

## Data Source

```
https://github.com/nflverse/nflverse-data/releases/download/pbp_participation/pbp_participation_{season}.parquet
```

Columns: `nflverse_game_id`, `play_id`, `gsis_id` (player ID), plus other fields. One row per player per play.

## Pipeline Changes (ingest.py)

### New Function: `download_participation(season)`

```python
PARTICIPATION_URL = "https://github.com/nflverse/nflverse-data/releases/download/pbp_participation/pbp_participation_{season}.parquet"

@retry(max_retries=3, delay=5)
def download_participation(season: int) -> pd.DataFrame:
    url = PARTICIPATION_URL.format(season=season)
    log.info("Downloading participation data for %d...", season)
    df = pd.read_parquet(url)
    if len(df) < 1000:
        raise DataQualityError(f"Participation data for {season} suspiciously small")
    return df
```

### Route Counting Logic

Inside `aggregate_receiver_stats`, after computing all existing stats, join participation data to count routes run:

```python
# Filter PBP to pass plays (same filter as targets but without receiver check)
pass_plays = plays[
    (plays['pass_attempt'] == 1) &
    (plays['sack'] != 1) &
    (plays['qb_scramble'] != 1)
][['game_id', 'play_id']].drop_duplicates()

# Join participation to pass plays
routes = participation.merge(
    pass_plays,
    left_on=['nflverse_game_id', 'play_id'],
    right_on=['game_id', 'play_id']
)

# Count routes per player
routes_per_player = routes.groupby('gsis_id').size().reset_index(name='routes_run')
routes_per_player.columns = ['player_id', 'routes_run']

# Merge into receiver stats
rec = rec.merge(routes_per_player, on='player_id', how='left')
rec['routes_run'] = rec['routes_run'].fillna(0).astype(int)
rec['yards_per_route_run'] = rec.apply(
    lambda r: r['receiving_yards'] / r['routes_run'] if r['routes_run'] > 0 else float('nan'), axis=1
)
rec['targets_per_route_run'] = rec.apply(
    lambda r: r['targets'] / r['routes_run'] if r['routes_run'] > 0 else float('nan'), axis=1
)
```

### Function Signature Change

`aggregate_receiver_stats` gains a `participation` parameter:

```python
def aggregate_receiver_stats(plays, roster, season, participation=None):
```

If `participation` is None, `routes_run`/YPRR/TPRR are set to 0/NaN (graceful degradation for seasons without participation data).

### process_season Changes

```python
participation = download_participation(season)
receiver_stats = aggregate_receiver_stats(plays, roster, season, participation)
```

Wrap `download_participation` in a try/except — if participation data isn't available for a season, fall back to `None` and receiver stats still work without YPRR/TPRR.

## DB Schema Change

Add 3 columns via ALTER TABLE in `ensure_receiver_stats_table()`:

```sql
ALTER TABLE receiver_season_stats ADD COLUMN IF NOT EXISTS routes_run INTEGER;
ALTER TABLE receiver_season_stats ADD COLUMN IF NOT EXISTS yards_per_route_run NUMERIC;
ALTER TABLE receiver_season_stats ADD COLUMN IF NOT EXISTS targets_per_route_run NUMERIC;
```

Update upsert column list to include the 3 new columns.

## TypeScript Changes

Add to `ReceiverSeasonStat` in `lib/types/index.ts`:
```typescript
routes_run: number;
yards_per_route_run: number;
targets_per_route_run: number;
```

Add `"yards_per_route_run"` and `"targets_per_route_run"` to `RECEIVER_NUMERIC_FIELDS` in `lib/data/receivers.ts`.

## Frontend Changes

### ReceiverLeaderboard — Advanced Tab

Add 2 new columns:
```typescript
{ key: "yards_per_route_run", label: "YPRR", tooltip: "YPRR", group: "efficiency" },
{ key: "targets_per_route_run", label: "TPRR", tooltip: "TPRR", group: "efficiency" },
```

Add to `HEATMAP_COLS_ADVANCED`:
```typescript
"yards_per_route_run", "targets_per_route_run"
```

Format: `.toFixed(2)` (e.g., "1.85")

### ReceiverStatCard — Radar Chart

Replace "Volume" (raw targets) with "YPRR" on the radar:
```typescript
const RADAR_AXES = [
  { label: "EPA/Tgt" },
  { label: "Catch%" },
  { label: "ADOT" },
  { label: "YAC/Rec" },
  { label: "Tgt Share" },
  { label: "YPRR" },      // was "Volume"
];

const RADAR_KEYS = [
  "epa_per_target",
  "catch_rate",
  "air_yards_per_target",
  "yac_per_reception",
  "target_share",
  "yards_per_route_run",   // was "targets"
];
```

### Glossary + MetricTooltip

Add:
- **YPRR (Yards Per Route Run):** "Receiving yards divided by routes run. The gold standard for receiver efficiency — measures production relative to opportunity. Higher = more productive per snap in a route."
- **TPRR (Targets Per Route Run):** "Targets divided by routes run. Measures how often a receiver is thrown to relative to how often they run routes. Higher = more frequently targeted."

## Tests

Add to `tests/test_receiver_stats.py`:
- `test_routes_run_counted` — participation join produces correct count
- `test_yprr_calculation` — yards / routes
- `test_tprr_calculation` — targets / routes
- `test_no_participation_data` — graceful fallback (routes=0, YPRR/TPRR=NaN)
- `test_routes_exclude_sacks_scrambles` — only true pass plays counted

## Out of Scope

- Weekly YPRR/TPRR (would need weekly participation join — future)
- Snap counts (separate dataset, separate feature)
- NGS metrics (separate dataset, separate feature)
