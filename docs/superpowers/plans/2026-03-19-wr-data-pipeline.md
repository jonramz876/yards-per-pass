# Receiver Data Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `receiver_season_stats` table and ingest pipeline for all receivers (WR, TE, RB, FB) from nflverse PBP data, with full test coverage.

**Architecture:** New `aggregate_receiver_stats()` function in `scripts/ingest.py` mirrors the QB pipeline pattern. Groups passing plays by `receiver_player_id`, computes receiving metrics (targets, receptions, EPA/target, YAC, air yards, target share), and upserts into a new Supabase table. Tests follow the existing `test_gap_stats.py` pattern with synthetic DataFrames.

**Tech Stack:** Python 3.14, pandas, psycopg2, pytest. Supabase PostgreSQL with RLS.

**Spec:** `docs/superpowers/specs/2026-03-19-wr-data-pipeline-design.md`

---

## File Structure

### New Files
| File | Responsibility |
|------|---------------|
| `tests/test_receiver_stats.py` | ~15 pytest tests for receiver aggregation |

### Modified Files
| File | Changes |
|------|---------|
| `scripts/ingest.py` | Add `REQUIRED_PBP_COLS` entries, `aggregate_receiver_stats()`, `ensure_receiver_stats_table()`, `upsert_receiver_stats()`, extend `cleanup_stale_rows()`, `validate_data()`, `process_season()` |

---

## Task 1: Write tests for receiver aggregation

**Files:**
- Create: `tests/test_receiver_stats.py`

- [ ] **Step 1: Create the test file with synthetic data helper and all tests**

Create `tests/test_receiver_stats.py`:

```python
"""Tests for receiver season stats aggregation in ingest.py."""
import sys
import os
import math
import pytest
import pandas as pd

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'scripts'))


def make_plays(**overrides):
    """Create a minimal plays DataFrame with receiver-relevant columns."""
    defaults = {
        'receiver_player_id': 'WR1',
        'receiver_player_name': 'Test Receiver',
        'posteam': 'KC',
        'pass_attempt': 1,
        'sack': 0,
        'complete_pass': 1,
        'receiving_yards': 10.0,
        'pass_touchdown': 0,
        'epa': 0.5,
        'yards_after_catch': 5.0,
        'air_yards': 5.0,
        'success': 1,
        'game_id': 'GAME1',
        'season': 2025,
        'week': 1,
        'fumble': 0,
        'fumble_lost': 0,
        'fumbled_1_player_id': None,
    }
    defaults.update(overrides)
    return pd.DataFrame([defaults])


def make_roster(player_id='WR1', position='WR'):
    """Create a minimal roster DataFrame."""
    return pd.DataFrame([{'gsis_id': player_id, 'position': position}])


class TestReceiverTargets:
    """Target counting: includes incompletes, excludes sacks."""

    def test_complete_pass_is_target(self):
        from ingest import aggregate_receiver_stats
        plays = make_plays(complete_pass=1)
        roster = make_roster()
        result = aggregate_receiver_stats(plays, roster, 2025)
        assert result.iloc[0]['targets'] == 1

    def test_incomplete_pass_is_target(self):
        from ingest import aggregate_receiver_stats
        plays = make_plays(complete_pass=0, receiving_yards=0)
        roster = make_roster()
        result = aggregate_receiver_stats(plays, roster, 2025)
        assert result.iloc[0]['targets'] == 1

    def test_sacks_excluded(self):
        from ingest import aggregate_receiver_stats
        plays = make_plays(sack=1, receiver_player_id=None)
        roster = make_roster()
        result = aggregate_receiver_stats(plays, roster, 2025)
        assert len(result) == 0  # No receivers on sack plays

    def test_null_receiver_excluded(self):
        from ingest import aggregate_receiver_stats
        plays = make_plays(receiver_player_id=None)
        roster = make_roster()
        result = aggregate_receiver_stats(plays, roster, 2025)
        assert len(result) == 0


class TestReceiverReceptions:
    """Receptions: only complete_pass == 1."""

    def test_receptions_count(self):
        from ingest import aggregate_receiver_stats
        plays = pd.concat([
            make_plays(complete_pass=1),
            make_plays(complete_pass=1),
            make_plays(complete_pass=0, receiving_yards=0),
        ], ignore_index=True)
        roster = make_roster()
        result = aggregate_receiver_stats(plays, roster, 2025)
        assert result.iloc[0]['receptions'] == 2
        assert result.iloc[0]['targets'] == 3


class TestReceiverYards:
    """Uses receiving_yards column, not yards_gained."""

    def test_receiving_yards_sum(self):
        from ingest import aggregate_receiver_stats
        plays = pd.concat([
            make_plays(receiving_yards=15.0),
            make_plays(receiving_yards=25.0),
        ], ignore_index=True)
        roster = make_roster()
        result = aggregate_receiver_stats(plays, roster, 2025)
        assert result.iloc[0]['receiving_yards'] == 40


class TestReceiverTDs:
    """TDs only on completed passes."""

    def test_td_on_completion(self):
        from ingest import aggregate_receiver_stats
        plays = make_plays(complete_pass=1, pass_touchdown=1)
        roster = make_roster()
        result = aggregate_receiver_stats(plays, roster, 2025)
        assert result.iloc[0]['receiving_tds'] == 1

    def test_td_not_counted_on_incomplete(self):
        from ingest import aggregate_receiver_stats
        # Edge case: pass_touchdown=1 but complete_pass=0 (shouldn't happen but guard it)
        plays = make_plays(complete_pass=0, pass_touchdown=1, receiving_yards=0)
        roster = make_roster()
        result = aggregate_receiver_stats(plays, roster, 2025)
        assert result.iloc[0]['receiving_tds'] == 0


class TestCatchRate:
    """catch_rate = receptions / targets."""

    def test_catch_rate(self):
        from ingest import aggregate_receiver_stats
        plays = pd.concat([
            make_plays(complete_pass=1),
            make_plays(complete_pass=0, receiving_yards=0),
        ], ignore_index=True)
        roster = make_roster()
        result = aggregate_receiver_stats(plays, roster, 2025)
        assert abs(result.iloc[0]['catch_rate'] - 0.5) < 0.001


class TestYardsPerReception:
    """NaN when zero receptions."""

    def test_ypr_normal(self):
        from ingest import aggregate_receiver_stats
        plays = pd.concat([
            make_plays(complete_pass=1, receiving_yards=20),
            make_plays(complete_pass=1, receiving_yards=10),
        ], ignore_index=True)
        roster = make_roster()
        result = aggregate_receiver_stats(plays, roster, 2025)
        assert abs(result.iloc[0]['yards_per_reception'] - 15.0) < 0.001

    def test_ypr_zero_receptions(self):
        from ingest import aggregate_receiver_stats
        plays = make_plays(complete_pass=0, receiving_yards=0)
        roster = make_roster()
        result = aggregate_receiver_stats(plays, roster, 2025)
        assert math.isnan(result.iloc[0]['yards_per_reception'])


class TestEPAPerTarget:
    """EPA per target handles NaN gracefully."""

    def test_epa_per_target(self):
        from ingest import aggregate_receiver_stats
        plays = pd.concat([
            make_plays(epa=0.5),
            make_plays(epa=-0.3),
        ], ignore_index=True)
        roster = make_roster()
        result = aggregate_receiver_stats(plays, roster, 2025)
        assert abs(result.iloc[0]['epa_per_target'] - 0.1) < 0.001

    def test_epa_with_nan(self):
        from ingest import aggregate_receiver_stats
        plays = pd.concat([
            make_plays(epa=0.5),
            make_plays(epa=float('nan')),
        ], ignore_index=True)
        roster = make_roster()
        result = aggregate_receiver_stats(plays, roster, 2025)
        # mean() skips NaN: 0.5 / 1 = 0.5
        assert abs(result.iloc[0]['epa_per_target'] - 0.5) < 0.001


class TestYACAndAirYards:
    """YAC and air yards aggregation."""

    def test_yac_sum(self):
        from ingest import aggregate_receiver_stats
        plays = pd.concat([
            make_plays(yards_after_catch=8.0),
            make_plays(yards_after_catch=3.0),
        ], ignore_index=True)
        roster = make_roster()
        result = aggregate_receiver_stats(plays, roster, 2025)
        assert result.iloc[0]['yac'] == 11.0

    def test_air_yards_includes_incompletes(self):
        from ingest import aggregate_receiver_stats
        plays = pd.concat([
            make_plays(complete_pass=1, air_yards=12.0),
            make_plays(complete_pass=0, air_yards=20.0, receiving_yards=0),
        ], ignore_index=True)
        roster = make_roster()
        result = aggregate_receiver_stats(plays, roster, 2025)
        assert result.iloc[0]['air_yards'] == 32.0

    def test_negative_air_yards_screens(self):
        from ingest import aggregate_receiver_stats
        plays = make_plays(air_yards=-3.0)
        roster = make_roster()
        result = aggregate_receiver_stats(plays, roster, 2025)
        assert result.iloc[0]['air_yards'] == -3.0


class TestTargetShare:
    """Target share: player targets / team total targets."""

    def test_target_share(self):
        from ingest import aggregate_receiver_stats
        plays = pd.concat([
            make_plays(receiver_player_id='WR1', receiver_player_name='WR One', posteam='KC'),
            make_plays(receiver_player_id='WR1', receiver_player_name='WR One', posteam='KC'),
            make_plays(receiver_player_id='WR2', receiver_player_name='WR Two', posteam='KC'),
        ], ignore_index=True)
        roster = pd.DataFrame([
            {'gsis_id': 'WR1', 'position': 'WR'},
            {'gsis_id': 'WR2', 'position': 'WR'},
        ])
        result = aggregate_receiver_stats(plays, roster, 2025)
        wr1 = result[result['player_id'] == 'WR1'].iloc[0]
        assert abs(wr1['target_share'] - (2/3)) < 0.001


class TestMultiTeamPlayer:
    """Player traded mid-season: picks team with most targets."""

    def test_picks_team_with_most_targets(self):
        from ingest import aggregate_receiver_stats
        plays = pd.concat([
            make_plays(receiver_player_id='WR1', posteam='KC'),
            make_plays(receiver_player_id='WR1', posteam='KC'),
            make_plays(receiver_player_id='WR1', posteam='SF'),
        ], ignore_index=True)
        roster = make_roster()
        result = aggregate_receiver_stats(plays, roster, 2025)
        assert result.iloc[0]['team_id'] == 'KC'


class TestPositionLookup:
    """Position from roster, fallback to WR."""

    def test_position_from_roster(self):
        from ingest import aggregate_receiver_stats
        plays = make_plays(receiver_player_id='TE1', receiver_player_name='Test TE')
        roster = make_roster(player_id='TE1', position='TE')
        result = aggregate_receiver_stats(plays, roster, 2025)
        assert result.iloc[0]['position'] == 'TE'

    def test_position_fallback_wr(self):
        from ingest import aggregate_receiver_stats
        plays = make_plays(receiver_player_id='UNKNOWN')
        roster = pd.DataFrame(columns=['gsis_id', 'position'])  # empty roster
        result = aggregate_receiver_stats(plays, roster, 2025)
        assert result.iloc[0]['position'] == 'WR'


class TestFumblesAttribution:
    """Fumbles searched across full plays, not just passes."""

    def test_fumble_attributed(self):
        from ingest import aggregate_receiver_stats
        plays = pd.concat([
            make_plays(receiver_player_id='WR1'),
            make_plays(receiver_player_id=None, pass_attempt=0, sack=0,
                       fumble=1, fumble_lost=1, fumbled_1_player_id='WR1'),
        ], ignore_index=True)
        roster = make_roster()
        result = aggregate_receiver_stats(plays, roster, 2025)
        assert result.iloc[0]['fumbles'] >= 1
        assert result.iloc[0]['fumbles_lost'] >= 1


class TestOutputColumns:
    """All expected columns present."""

    def test_output_has_required_columns(self):
        from ingest import aggregate_receiver_stats
        plays = make_plays()
        roster = make_roster()
        result = aggregate_receiver_stats(plays, roster, 2025)
        expected = [
            'player_id', 'player_name', 'position', 'team_id', 'season', 'games',
            'targets', 'receptions', 'receiving_yards', 'receiving_tds',
            'catch_rate', 'yards_per_target', 'yards_per_reception',
            'epa_per_target', 'yac', 'yac_per_reception',
            'air_yards', 'air_yards_per_target', 'target_share',
            'fumbles', 'fumbles_lost',
        ]
        for col in expected:
            assert col in result.columns, f"Missing column: {col}"


class TestEmptyInput:
    """Empty plays produce empty output."""

    def test_no_targets(self):
        from ingest import aggregate_receiver_stats
        plays = pd.DataFrame(columns=[
            'receiver_player_id', 'receiver_player_name', 'posteam',
            'pass_attempt', 'sack', 'complete_pass', 'receiving_yards',
            'pass_touchdown', 'epa', 'yards_after_catch', 'air_yards',
            'success', 'game_id', 'season', 'week',
            'fumble', 'fumble_lost', 'fumbled_1_player_id',
        ])
        roster = make_roster()
        result = aggregate_receiver_stats(plays, roster, 2025)
        assert len(result) == 0
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd scripts && python -m pytest ../tests/test_receiver_stats.py -v 2>&1 | head -30
```

Expected: All tests FAIL with `ImportError: cannot import name 'aggregate_receiver_stats' from 'ingest'`

- [ ] **Step 3: Commit tests**

```bash
git add tests/test_receiver_stats.py
git commit -m "test: add 20 pytest tests for receiver stats aggregation (all failing)"
```

---

## Task 2: Implement aggregate_receiver_stats

**Files:**
- Modify: `scripts/ingest.py`

- [ ] **Step 1: Add required PBP columns**

In `scripts/ingest.py`, find the `REQUIRED_PBP_COLS` list (line 72). Add these columns to the list:

```python
    'receiver_player_id', 'receiver_player_name',
    'receiving_yards', 'yards_after_catch',
```

Note: `air_yards` is already in the list.

- [ ] **Step 2: Implement aggregate_receiver_stats**

Add after the `aggregate_qb_stats` function (after line ~500, before the gap stats functions). Place it logically with the other aggregation functions:

```python
def aggregate_receiver_stats(plays: pd.DataFrame, roster: pd.DataFrame, season: int) -> pd.DataFrame:
    """Aggregate receiver season stats from filtered plays."""
    # Filter to target plays: receiver exists, pass attempt, not a sack
    target_plays = plays[
        (plays['receiver_player_id'].notna()) &
        (plays['pass_attempt'] == 1) &
        (plays['sack'] != 1)
    ].copy()

    if target_plays.empty:
        return pd.DataFrame()

    # Group by receiver
    rec = target_plays.groupby('receiver_player_id').agg(
        player_name=('receiver_player_name', 'first'),
        targets=('game_id', 'count'),
        receptions=('complete_pass', 'sum'),
        receiving_yards=('receiving_yards', 'sum'),
        epa_sum=('epa', 'sum'),
        epa_per_target=('epa', 'mean'),
        yac=('yards_after_catch', lambda x: x.dropna().sum()),
        air_yards=('air_yards', lambda x: x.dropna().sum()),
        games=('game_id', 'nunique'),
    ).reset_index().rename(columns={'receiver_player_id': 'player_id'})

    # Receiving TDs: only on completed passes
    completed = target_plays[target_plays['complete_pass'] == 1]
    td_counts = completed.groupby('receiver_player_id')['pass_touchdown'].sum().reset_index()
    td_counts.columns = ['player_id', 'receiving_tds']
    rec = rec.merge(td_counts, on='player_id', how='left')
    rec['receiving_tds'] = rec['receiving_tds'].fillna(0).astype(int)

    # Derived rate stats
    rec['catch_rate'] = rec['receptions'] / rec['targets']
    rec['yards_per_target'] = rec['receiving_yards'] / rec['targets']
    rec['yards_per_reception'] = rec.apply(
        lambda r: r['receiving_yards'] / r['receptions'] if r['receptions'] > 0 else float('nan'), axis=1
    )
    rec['yac_per_reception'] = rec.apply(
        lambda r: r['yac'] / r['receptions'] if r['receptions'] > 0 else float('nan'), axis=1
    )
    rec['air_yards_per_target'] = rec['air_yards'] / rec['targets']

    # Team assignment: team with most targets
    team_counts = target_plays.groupby(['receiver_player_id', 'posteam']).size().reset_index(name='cnt')
    team_primary = team_counts.sort_values('cnt', ascending=False).drop_duplicates('receiver_player_id')
    team_primary = team_primary[['receiver_player_id', 'posteam']].rename(
        columns={'receiver_player_id': 'player_id', 'posteam': 'team_id'}
    )
    rec = rec.merge(team_primary, on='player_id', how='left')

    # Target share: player targets / team total targets
    team_total_targets = target_plays.groupby('posteam').size().to_dict()
    rec['target_share'] = rec.apply(
        lambda r: r['targets'] / team_total_targets.get(r['team_id'], 1), axis=1
    )

    # Position from roster (mode = most frequent)
    pos_lookup = roster.groupby('gsis_id')['position'].agg(
        lambda x: x.mode().iloc[0] if len(x.mode()) > 0 else 'WR'
    ).to_dict()
    rec['position'] = rec['player_id'].map(pos_lookup).fillna('WR')

    # Fumbles: search full plays DataFrame for receiver player IDs
    receiver_ids = set(rec['player_id'])
    fumble_plays = plays[plays['fumbled_1_player_id'].isin(receiver_ids)]
    fumble_counts = fumble_plays.groupby('fumbled_1_player_id').agg(
        fumbles=('fumble', 'sum'),
        fumbles_lost=('fumble_lost', 'sum'),
    ).reset_index().rename(columns={'fumbled_1_player_id': 'player_id'})
    rec = rec.merge(fumble_counts, on='player_id', how='left')
    rec['fumbles'] = rec['fumbles'].fillna(0).astype(int)
    rec['fumbles_lost'] = rec['fumbles_lost'].fillna(0).astype(int)

    # Add season, convert types
    rec['season'] = season
    rec['receptions'] = rec['receptions'].astype(int)
    rec['receiving_yards'] = rec['receiving_yards'].astype(int)

    # Drop intermediate columns
    rec.drop(columns=['epa_sum'], inplace=True, errors='ignore')

    # Select final columns
    cols = [
        'player_id', 'player_name', 'position', 'team_id', 'season', 'games',
        'targets', 'receptions', 'receiving_yards', 'receiving_tds',
        'catch_rate', 'yards_per_target', 'yards_per_reception',
        'epa_per_target', 'yac', 'yac_per_reception',
        'air_yards', 'air_yards_per_target', 'target_share',
        'fumbles', 'fumbles_lost',
    ]
    return rec[cols]
```

- [ ] **Step 3: Run tests**

```bash
cd scripts && python -m pytest ../tests/test_receiver_stats.py -v
```

Expected: All ~20 tests PASS.

- [ ] **Step 4: Run existing tests to check for regressions**

```bash
python -m pytest tests/ -v
```

Expected: All 55 existing + ~20 new tests pass (~75 total).

- [ ] **Step 5: Commit**

```bash
git add scripts/ingest.py tests/test_receiver_stats.py
git commit -m "feat: implement aggregate_receiver_stats with 20 passing tests"
```

---

## Task 3: Add DDL, upsert, and pipeline integration

**Files:**
- Modify: `scripts/ingest.py`

- [ ] **Step 1: Add ensure_receiver_stats_table**

Add after the existing `ensure_def_gap_tables` function:

```python
def ensure_receiver_stats_table(conn):
    """Create receiver_season_stats table if it doesn't exist. NOT @retry."""
    with conn.cursor() as cur:
        cur.execute("""
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
        """)
        # RLS
        cur.execute("ALTER TABLE receiver_season_stats ENABLE ROW LEVEL SECURITY;")
        cur.execute("""
            DO $$ BEGIN
                CREATE POLICY "public_read" ON receiver_season_stats FOR SELECT USING (true);
            EXCEPTION WHEN duplicate_object THEN NULL;
            END $$;
        """)
    conn.commit()
    log.info("Ensured receiver_season_stats table exists")
```

- [ ] **Step 2: Add upsert_receiver_stats**

Add after the new ensure function:

```python
@retry(max_retries=3, delay=5)
def upsert_receiver_stats(conn, df: pd.DataFrame):
    """Upsert receiver season stats."""
    cols = [
        'player_id', 'player_name', 'position', 'team_id', 'season', 'games',
        'targets', 'receptions', 'receiving_yards', 'receiving_tds',
        'catch_rate', 'yards_per_target', 'yards_per_reception',
        'epa_per_target', 'yac', 'yac_per_reception',
        'air_yards', 'air_yards_per_target', 'target_share',
        'fumbles', 'fumbles_lost',
    ]
    clean_df = df[cols].where(df[cols].notna(), None)
    rows = [tuple(r) for _, r in clean_df.iterrows()]
    col_names = ', '.join(cols)
    update_set = ', '.join(f"{c} = EXCLUDED.{c}" for c in cols if c not in ('player_id', 'season'))

    with conn.cursor() as cur:
        execute_values(
            cur,
            f"""INSERT INTO receiver_season_stats ({col_names})
                VALUES %s
                ON CONFLICT (player_id, season) DO UPDATE SET {update_set}""",
            rows,
        )
    log.info("Upserted %d receiver season rows", len(rows))
```

- [ ] **Step 3: Extend cleanup_stale_rows**

Update the `cleanup_stale_rows` function signature to add `receiver_player_ids`:

```python
def cleanup_stale_rows(conn, season: int, team_ids: list, player_ids: list,
                       rb_gap_player_ids: list = None, rb_gap_weekly_player_ids: list = None,
                       def_gap_team_ids: list = None, receiver_player_ids: list = None):
```

Add at the end of the function body (before the closing of the `with` block):

```python
        if receiver_player_ids is not None:
            cur.execute(
                "DELETE FROM receiver_season_stats WHERE season = %s AND player_id != ALL(%s)",
                (season, receiver_player_ids),
            )
            if cur.rowcount > 0:
                log.info("Cleaned up %d stale receiver_season_stats rows", cur.rowcount)
```

- [ ] **Step 4: Extend validate_data**

Update `validate_data` to accept and check receiver stats:

```python
def validate_data(team_stats: pd.DataFrame, qb_stats: pd.DataFrame, receiver_stats: pd.DataFrame = None):
```

Add at the end of the function:

```python
    if receiver_stats is not None and not receiver_stats.empty:
        bad_catch = receiver_stats[(receiver_stats['catch_rate'] < 0) | (receiver_stats['catch_rate'] > 1)]
        if len(bad_catch) > 0:
            log.warning("Found %d receivers with catch_rate outside [0,1]", len(bad_catch))
        bad_ypr = receiver_stats[receiver_stats['yards_per_reception'].notna() & (receiver_stats['yards_per_reception'] > 50)]
        if len(bad_ypr) > 0:
            log.warning("Found %d receivers with yards_per_reception > 50", len(bad_ypr))
        bad_ts = receiver_stats[(receiver_stats['target_share'] < 0) | (receiver_stats['target_share'] > 1)]
        if len(bad_ts) > 0:
            log.warning("Found %d receivers with target_share outside [0,1]", len(bad_ts))
```

- [ ] **Step 5: Integrate into process_season**

In `process_season()`:

After the line `def_gap_stats = aggregate_def_gap_stats(plays, season)` (~line 1043), add:

```python
    receiver_stats = aggregate_receiver_stats(plays, roster, season)
```

Update the `validate_data` call:

```python
    validate_data(team_stats, qb_stats, receiver_stats)
```

Update the dry_run log:

```python
    if dry_run:
        log.info("[DRY RUN] Would upsert: %d team rows, %d QB rows, %d RB gap rows, %d RB gap weekly rows, %d def gap rows, %d receiver rows, through_week=%d",
                 len(team_stats), len(qb_stats), len(rb_gap_stats), len(rb_gap_stats_weekly), len(def_gap_stats), len(receiver_stats), through_week)
```

Add `ensure_receiver_stats_table(conn)` after the other ensure calls (~line 1066):

```python
    ensure_receiver_stats_table(conn)
```

Add `upsert_receiver_stats(conn, receiver_stats)` in the try block, after `upsert_def_gap_stats`:

```python
        upsert_receiver_stats(conn, receiver_stats)
```

Add `receiver_player_ids` to the `cleanup_stale_rows` call:

```python
            receiver_player_ids=receiver_stats['player_id'].unique().tolist() if not receiver_stats.empty else [],
```

- [ ] **Step 6: Run all tests**

```bash
python -m pytest tests/ -v
```

Expected: All ~75 tests pass.

- [ ] **Step 7: Commit**

```bash
git add scripts/ingest.py
git commit -m "feat: add receiver pipeline integration (DDL, upsert, cleanup, validate)"
```

---

## Task 4: Dry-run verification

- [ ] **Step 1: Run a dry-run for a single season**

```bash
cd scripts && python ingest.py --season 2025 --dry-run
```

Expected: Logs should show receiver stats aggregation alongside QB and RB stats. Look for:
- `[DRY RUN] Would upsert: ... X receiver rows`
- No errors or warnings about missing columns

- [ ] **Step 2: Verify receiver row counts are reasonable**

For 2025, expect ~150-250 receiver rows (all positions with at least 1 target across 32 teams).

- [ ] **Step 3: Commit the spec**

```bash
git add docs/superpowers/specs/2026-03-19-wr-data-pipeline-design.md
git commit -m "docs: add receiver data pipeline design spec"
```
