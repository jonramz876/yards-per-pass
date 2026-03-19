# Receiver Data Pipeline + DB Schema — Design Spec

**Date:** 2026-03-19
**Status:** Draft
**Context:** Last remaining item from 10-team review. Sub-project 1 of 3 for WR data feature (pipeline → page → integration).

## Overview

Add a `receiver_season_stats` table and ingest pipeline for all receivers (WR, TE, RB, FB) from nflverse PBP data. Mirrors the existing QB pipeline pattern. Stores per-season aggregated receiving stats with a `position` column for frontend filtering.

## Table Schema

```sql
CREATE TABLE IF NOT EXISTS receiver_season_stats (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id TEXT NOT NULL,
  player_name TEXT NOT NULL,
  position TEXT NOT NULL,
  team_id TEXT REFERENCES teams(id),
  season INTEGER NOT NULL,
  games INTEGER,
  targets INTEGER,
  receptions INTEGER,
  receiving_yards INTEGER,
  receiving_tds INTEGER,
  catch_rate NUMERIC,
  yards_per_target NUMERIC,
  yards_per_reception NUMERIC,
  epa_per_target NUMERIC,
  yac NUMERIC,
  yac_per_reception NUMERIC,
  air_yards NUMERIC,
  air_yards_per_target NUMERIC,
  target_share NUMERIC,
  fumbles INTEGER,
  fumbles_lost INTEGER,
  UNIQUE(player_id, season)
);

CREATE INDEX IF NOT EXISTS idx_receiver_season ON receiver_season_stats(season);
CREATE INDEX IF NOT EXISTS idx_receiver_player ON receiver_season_stats(player_id);
CREATE INDEX IF NOT EXISTS idx_receiver_team ON receiver_season_stats(team_id, season);

ALTER TABLE receiver_season_stats ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public_read" ON receiver_season_stats FOR SELECT USING (true);
```

**Notes:**
- `air_yards` is NUMERIC (not INTEGER) because screen passes have negative air yards
- RLS + public_read policy required for Supabase anon key access
- Indexes on season, player_id, and (team_id, season) for query patterns

## Aggregation: `aggregate_receiver_stats(plays, roster, season)`

### Play Filter

```python
targets = plays[
    (plays['receiver_player_id'].notna()) &
    (plays['pass_attempt'] == 1) &
    (plays['sack'] != 1)
].copy()
```

**Why `sack != 1`:** nflverse sets `pass_attempt=1` on sacks. Sacks typically have null `receiver_player_id`, but excluding them explicitly prevents edge-case noise (same pattern as QB `true_passes` filter).

### Required PBP Columns

Add to `REQUIRED_PBP_COLS` in ingest.py:
- `receiver_player_id`
- `receiver_player_name`
- `receiving_yards`
- `yards_after_catch`
- `air_yards`

### Grouping and Metrics

Group by `receiver_player_id`. Compute:

| Metric | Computation |
|--------|-------------|
| `targets` | count of plays |
| `receptions` | sum(`complete_pass`) |
| `receiving_yards` | sum(`receiving_yards`) — the nflverse column, NOT `yards_gained` |
| `receiving_tds` | sum(`pass_touchdown`) where `complete_pass == 1` |
| `catch_rate` | receptions / targets |
| `yards_per_target` | receiving_yards / targets |
| `yards_per_reception` | receiving_yards / receptions (NaN if 0 receptions) |
| `epa_per_target` | sum(`epa`) / targets |
| `yac` | sum(`yards_after_catch`) — nflverse column name, not "yac" |
| `yac_per_reception` | yac / receptions |
| `air_yards` | sum(`air_yards`) — includes incomplete passes (intended target depth) |
| `air_yards_per_target` | air_yards / targets |
| `target_share` | player targets / team total targets (computed after grouping) |
| `games` | nunique(`game_id`) |

### Team Assignment

Use `posteam` from the plays DataFrame. For players on multiple teams (mid-season trade), pick the team with the most targets (same pattern as QB pipeline).

### Position Lookup

Join `receiver_player_id` against roster `gsis_id`. Use the **mode** (most frequent position) from the weekly roster, not just the first occurrence. This handles edge cases like a player listed as FB some weeks and RB others. Fallback to "WR" if not found in roster.

### Fumbles Attribution

Search `fumbled_1_player_id` across the **full `plays` DataFrame** (not just the pass-play subset) for receiver player IDs. This captures end-around fumbles and other non-pass situations where a receiver touches the ball. Same attribution pattern as QB fumbles.

### Target Share Computation

After grouping by receiver, compute team total targets:
```python
team_targets = targets_df.groupby('posteam')['game_id'].count()  # total targets per team
```
Then for each receiver: `target_share = player_targets / team_targets[player_team]`

### Zero-Target Exclusion

Players with zero targets are implicitly excluded by the `receiver_player_id.notna()` filter. Only players who were actually targeted appear in the output.

## Pipeline Integration

### `ensure_receiver_stats_table(conn)`
- DDL function (NOT decorated with `@retry`) — follows `ensure_rb_gap_tables` pattern
- Creates table, indexes, RLS policy

### `upsert_receiver_stats(conn, df)`
- Decorated with `@retry` (follows QB/RB upsert pattern)
- `ON CONFLICT (player_id, season) DO UPDATE SET` all non-key columns
- NaN → None conversion for SQL NULL

### `cleanup_stale_rows()` Extension
- Add `receiver_player_ids: list` parameter
- Delete receiver rows where `season = X AND player_id NOT IN (list)`

### `validate_data()` Extension
- `catch_rate` between 0 and 1
- `yards_per_reception` between 0 and 50
- `epa_per_target` between -3 and 3
- `target_share` between 0 and 1

### `process_season()` Changes
- Add: `receiver_stats = aggregate_receiver_stats(plays, roster, season)`
- Add: `ensure_receiver_stats_table(conn)` before upserts
- Add: `upsert_receiver_stats(conn, receiver_stats)` in the try block
- Add: `receiver_player_ids=receiver_stats['player_id'].unique().tolist()` to cleanup call

### ISR Revalidation
- Future: add `/receivers` or `/wr-leaderboard` to webhook when the page exists
- For now, no webhook change needed (pipeline-only, no frontend route yet)

## Tests (~15 pytest tests)

| Test | What it verifies |
|------|-----------------|
| Target counting | Includes incomplete passes, excludes sacks |
| Receptions | Only `complete_pass == 1` |
| Receiving yards | Uses `receiving_yards` column, not `yards_gained` |
| Receiving TDs | Only on completed passes |
| Catch rate | receptions / targets, handles zero targets |
| Yards per reception | NaN when zero receptions |
| EPA per target | Handles NaN EPA gracefully |
| YAC aggregation | Uses `yards_after_catch` column |
| Air yards | Includes incompletes, handles negative (screens) |
| Target share | Correct team-level denominator |
| Multi-team player | Picks team with most targets |
| Position lookup | Gets mode from roster, falls back to "WR" |
| Fumbles attribution | Searches full play universe, not just passes |
| Output columns | All expected columns present |
| Zero-carry edge | Empty targets produce empty output |

## Out of Scope

- Frontend page/components (sub-project 2)
- Weekly receiver stats table (future, mirrors `rb_gap_stats_weekly`)
- Route-running metrics (not available in nflverse PBP)
