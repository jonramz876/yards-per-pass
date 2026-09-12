# QB Field Heat Map Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a 3×3 SVG field heat map to QB player pages showing pass distribution by depth (air yards) and direction (L/M/R), with tabs for Targets, Catch%, Yards, and EPA/Att.

**Architecture:** Python pipeline aggregates nflverse PBP data into 9 zones per QB per season → Supabase table → TypeScript query → React SVG component on a new "Field Map" tab on QB player pages.

**Tech Stack:** Python/pandas (pipeline), PostgreSQL/Supabase (storage), Next.js 14/TypeScript/React SVG (frontend)

**Spec:** `docs/superpowers/specs/2026-03-22-qb-field-heat-map-design.md`

---

### Task 1: Pipeline — Tests for pass location aggregation

**Files:**
- Create: `tests/test_pass_location_stats.py`

- [ ] **Step 1: Create test file with depth binning tests**

```python
# tests/test_pass_location_stats.py
"""Tests for QB pass location (field heat map) aggregation."""
import pandas as pd
import pytest
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'scripts'))
from ingest import aggregate_qb_pass_location_stats


def _make_roster(player_ids):
    """Minimal roster DataFrame with QB positions."""
    return pd.DataFrame({
        'gsis_id': player_ids,
        'position': ['QB'] * len(player_ids),
    })


def _make_play(passer_id='QB1', air_yards=10, pass_location='middle',
               complete=1, yards=10, td=0, interception=0, epa=0.5,
               sack=0, scramble=0, spike=0, week=1, team='KC'):
    """Build a single pass play dict with all required PBP columns."""
    return {
        'pass_attempt': 1,
        'sack': sack,
        'qb_scramble': scramble,
        'qb_spike': spike,
        'passer_player_id': passer_id,
        'passer_player_name': f'Player {passer_id}',
        'air_yards': air_yards,
        'pass_location': pass_location,
        'complete_pass': complete,
        'passing_yards': yards if complete else None,
        'pass_touchdown': td,
        'interception': interception,
        'epa': epa,
        'posteam': team,
        'week': week,
        'game_id': f'2024_0{week}_{team}_OPP',
    }


class TestDepthBinning:
    def test_short_zone(self):
        plays = pd.DataFrame([_make_play(air_yards=5, pass_location='left')])
        roster = _make_roster(['QB1'])
        result = aggregate_qb_pass_location_stats(plays, roster, 2024)
        assert len(result) == 1
        assert result.iloc[0]['depth_bin'] == 'short'

    def test_intermediate_zone(self):
        plays = pd.DataFrame([_make_play(air_yards=15, pass_location='middle')])
        roster = _make_roster(['QB1'])
        result = aggregate_qb_pass_location_stats(plays, roster, 2024)
        assert result.iloc[0]['depth_bin'] == 'intermediate'

    def test_deep_zone(self):
        plays = pd.DataFrame([_make_play(air_yards=25, pass_location='right')])
        roster = _make_roster(['QB1'])
        result = aggregate_qb_pass_location_stats(plays, roster, 2024)
        assert result.iloc[0]['depth_bin'] == 'deep'

    def test_negative_air_yards_binned_short(self):
        plays = pd.DataFrame([_make_play(air_yards=-3, pass_location='left')])
        roster = _make_roster(['QB1'])
        result = aggregate_qb_pass_location_stats(plays, roster, 2024)
        assert result.iloc[0]['depth_bin'] == 'short'

    def test_boundary_values(self):
        plays = pd.DataFrame([
            _make_play(air_yards=0, pass_location='left'),
            _make_play(air_yards=9, pass_location='left'),
            _make_play(air_yards=10, pass_location='middle'),
            _make_play(air_yards=19, pass_location='middle'),
            _make_play(air_yards=20, pass_location='right'),
        ])
        roster = _make_roster(['QB1'])
        result = aggregate_qb_pass_location_stats(plays, roster, 2024)
        bins = dict(zip(
            result['depth_bin'] + '-' + result['direction_bin'],
            result['pass_attempts']
        ))
        assert bins.get('short-left', 0) == 2
        assert bins.get('intermediate-middle', 0) == 2
        assert bins.get('deep-right', 0) == 1


class TestFiltering:
    def test_null_air_yards_excluded(self):
        plays = pd.DataFrame([
            _make_play(air_yards=10),
            _make_play(air_yards=None),
        ])
        roster = _make_roster(['QB1'])
        result = aggregate_qb_pass_location_stats(plays, roster, 2024)
        total = result['pass_attempts'].sum()
        assert total == 1

    def test_null_pass_location_excluded(self):
        plays = pd.DataFrame([
            _make_play(pass_location='left'),
            _make_play(pass_location=None),
        ])
        roster = _make_roster(['QB1'])
        result = aggregate_qb_pass_location_stats(plays, roster, 2024)
        assert result['pass_attempts'].sum() == 1

    def test_sacks_excluded(self):
        plays = pd.DataFrame([
            _make_play(),
            _make_play(sack=1),
        ])
        roster = _make_roster(['QB1'])
        result = aggregate_qb_pass_location_stats(plays, roster, 2024)
        assert result['pass_attempts'].sum() == 1

    def test_scrambles_excluded(self):
        plays = pd.DataFrame([
            _make_play(),
            _make_play(scramble=1),
        ])
        roster = _make_roster(['QB1'])
        result = aggregate_qb_pass_location_stats(plays, roster, 2024)
        assert result['pass_attempts'].sum() == 1

    def test_spikes_excluded(self):
        plays = pd.DataFrame([
            _make_play(),
            _make_play(spike=1, air_yards=0),
        ])
        roster = _make_roster(['QB1'])
        result = aggregate_qb_pass_location_stats(plays, roster, 2024)
        assert result['pass_attempts'].sum() == 1

    def test_non_qb_passer_excluded(self):
        plays = pd.DataFrame([
            _make_play(passer_id='QB1'),
            _make_play(passer_id='WR1'),  # trick play
        ])
        roster = _make_roster(['QB1'])  # WR1 not in roster
        result = aggregate_qb_pass_location_stats(plays, roster, 2024)
        assert result['pass_attempts'].sum() == 1

    def test_missing_column_returns_empty(self):
        plays = pd.DataFrame([_make_play()])
        plays = plays.drop(columns=['pass_location'])
        roster = _make_roster(['QB1'])
        result = aggregate_qb_pass_location_stats(plays, roster, 2024)
        assert result.empty


class TestAggregation:
    def test_pass_attempts_count(self):
        plays = pd.DataFrame([
            _make_play(air_yards=5, pass_location='left', complete=1),
            _make_play(air_yards=7, pass_location='left', complete=0),
            _make_play(air_yards=8, pass_location='left', complete=1),
        ])
        roster = _make_roster(['QB1'])
        result = aggregate_qb_pass_location_stats(plays, roster, 2024)
        row = result[(result['depth_bin'] == 'short') & (result['direction_bin'] == 'left')]
        assert row.iloc[0]['pass_attempts'] == 3

    def test_completions_sum(self):
        plays = pd.DataFrame([
            _make_play(air_yards=5, pass_location='left', complete=1),
            _make_play(air_yards=7, pass_location='left', complete=0),
            _make_play(air_yards=8, pass_location='left', complete=1),
        ])
        roster = _make_roster(['QB1'])
        result = aggregate_qb_pass_location_stats(plays, roster, 2024)
        row = result[(result['depth_bin'] == 'short') & (result['direction_bin'] == 'left')]
        assert row.iloc[0]['completions'] == 2

    def test_completion_pct(self):
        plays = pd.DataFrame([
            _make_play(air_yards=5, pass_location='left', complete=1),
            _make_play(air_yards=7, pass_location='left', complete=0),
        ])
        roster = _make_roster(['QB1'])
        result = aggregate_qb_pass_location_stats(plays, roster, 2024)
        row = result[(result['depth_bin'] == 'short') & (result['direction_bin'] == 'left')]
        assert row.iloc[0]['completion_pct'] == pytest.approx(0.5)

    def test_epa_per_attempt(self):
        plays = pd.DataFrame([
            _make_play(air_yards=5, pass_location='left', epa=0.5),
            _make_play(air_yards=7, pass_location='left', epa=-0.3),
        ])
        roster = _make_roster(['QB1'])
        result = aggregate_qb_pass_location_stats(plays, roster, 2024)
        row = result[(result['depth_bin'] == 'short') & (result['direction_bin'] == 'left')]
        assert row.iloc[0]['epa_per_attempt'] == pytest.approx(0.1)

    def test_passing_yards_fillna(self):
        plays = pd.DataFrame([
            _make_play(air_yards=5, pass_location='left', complete=1, yards=15),
            _make_play(air_yards=7, pass_location='left', complete=0, yards=None),
        ])
        roster = _make_roster(['QB1'])
        result = aggregate_qb_pass_location_stats(plays, roster, 2024)
        row = result[(result['depth_bin'] == 'short') & (result['direction_bin'] == 'left')]
        assert row.iloc[0]['passing_yards'] == 15

    def test_passer_rating_null_under_5_attempts(self):
        plays = pd.DataFrame([
            _make_play(air_yards=25, pass_location='right', complete=1, yards=40, td=1),
        ])
        roster = _make_roster(['QB1'])
        result = aggregate_qb_pass_location_stats(plays, roster, 2024)
        row = result[(result['depth_bin'] == 'deep') & (result['direction_bin'] == 'right')]
        assert pd.isna(row.iloc[0]['passer_rating'])

    def test_passer_rating_computed_with_5_plus(self):
        plays = pd.DataFrame([
            _make_play(air_yards=5, pass_location='left', complete=1, yards=10, td=0, interception=0),
            _make_play(air_yards=6, pass_location='left', complete=1, yards=8, td=0, interception=0),
            _make_play(air_yards=7, pass_location='left', complete=1, yards=12, td=1, interception=0),
            _make_play(air_yards=8, pass_location='left', complete=0, yards=None, td=0, interception=0),
            _make_play(air_yards=9, pass_location='left', complete=0, yards=None, td=0, interception=1),
        ])
        roster = _make_roster(['QB1'])
        result = aggregate_qb_pass_location_stats(plays, roster, 2024)
        row = result[(result['depth_bin'] == 'short') & (result['direction_bin'] == 'left')]
        assert not pd.isna(row.iloc[0]['passer_rating'])
        assert row.iloc[0]['passer_rating'] > 0

    def test_multi_team_qb_primary_team(self):
        plays = pd.DataFrame([
            _make_play(air_yards=5, pass_location='left', team='KC'),
            _make_play(air_yards=6, pass_location='left', team='KC'),
            _make_play(air_yards=7, pass_location='left', team='KC'),
            _make_play(air_yards=8, pass_location='left', team='NYJ'),
        ])
        roster = _make_roster(['QB1'])
        result = aggregate_qb_pass_location_stats(plays, roster, 2024)
        assert result.iloc[0]['team_id'] == 'KC'

    def test_zero_attempt_zone_absent(self):
        """QB with no attempts to a zone should have no row for that zone."""
        plays = pd.DataFrame([_make_play(air_yards=5, pass_location='left')])
        roster = _make_roster(['QB1'])
        result = aggregate_qb_pass_location_stats(plays, roster, 2024)
        assert len(result) == 1  # only short-left, other 8 zones absent

    def test_all_nine_zones_populated(self):
        """QB throwing to all 9 zones gets 9 rows."""
        plays_list = []
        for ay, loc in [(5, 'left'), (5, 'middle'), (5, 'right'),
                        (15, 'left'), (15, 'middle'), (15, 'right'),
                        (25, 'left'), (25, 'middle'), (25, 'right')]:
            plays_list.append(_make_play(air_yards=ay, pass_location=loc))
        plays = pd.DataFrame(plays_list)
        roster = _make_roster(['QB1'])
        result = aggregate_qb_pass_location_stats(plays, roster, 2024)
        assert len(result) == 9

    def test_direction_bin_preserved(self):
        """pass_location values are preserved as direction_bin."""
        plays = pd.DataFrame([
            _make_play(air_yards=5, pass_location='left'),
            _make_play(air_yards=5, pass_location='middle'),
            _make_play(air_yards=5, pass_location='right'),
        ])
        roster = _make_roster(['QB1'])
        result = aggregate_qb_pass_location_stats(plays, roster, 2024)
        directions = set(result['direction_bin'])
        assert directions == {'left', 'middle', 'right'}

    def test_adot_stored(self):
        plays = pd.DataFrame([
            _make_play(air_yards=22, pass_location='right'),
            _make_play(air_yards=38, pass_location='right'),
        ])
        roster = _make_roster(['QB1'])
        result = aggregate_qb_pass_location_stats(plays, roster, 2024)
        row = result[(result['depth_bin'] == 'deep') & (result['direction_bin'] == 'right')]
        assert row.iloc[0]['adot'] == pytest.approx(30.0)
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python -m pytest tests/test_pass_location_stats.py -v`
Expected: FAIL — `ImportError: cannot import name 'aggregate_qb_pass_location_stats'`

---

### Task 2: Pipeline — Implement aggregation function

**Files:**
- Modify: `scripts/ingest.py` (add function after `aggregate_rb_season_stats`, around line 680)

- [ ] **Step 3: Add `aggregate_qb_pass_location_stats()` to ingest.py**

Add after `aggregate_rb_season_stats()` (around line 680). Follow the `aggregate_rb_gap_stats` pattern:

```python
def aggregate_qb_pass_location_stats(plays: pd.DataFrame, roster: pd.DataFrame, season: int) -> pd.DataFrame:
    """Aggregate QB pass attempts by field zone (depth x direction) for heat map."""
    for col in ('pass_location', 'air_yards', 'qb_spike'):
        if col not in plays.columns:
            log.warning("Column '%s' not found in PBP data — skipping pass location stats", col)
            return pd.DataFrame(columns=[
                'player_id', 'player_name', 'team_id', 'season',
                'depth_bin', 'direction_bin', 'pass_attempts', 'completions',
                'passing_yards', 'pass_tds', 'interceptions',
                'epa_sum', 'epa_per_attempt', 'completion_pct', 'adot', 'passer_rating',
            ])

    qb_ids = set(roster[roster['position'] == 'QB']['gsis_id'].dropna().unique())

    passes = plays[
        (plays['pass_attempt'] == 1) &
        (plays['sack'] != 1) &
        (plays['qb_scramble'] != 1) &
        (plays['qb_spike'] != 1) &
        (plays['passer_player_id'].isin(qb_ids)) &
        (plays['air_yards'].notna()) &
        (plays['pass_location'].notna())
    ].copy()

    if passes.empty:
        return pd.DataFrame(columns=[
            'player_id', 'player_name', 'team_id', 'season',
            'depth_bin', 'direction_bin', 'pass_attempts', 'completions',
            'passing_yards', 'pass_tds', 'interceptions',
            'epa_sum', 'epa_per_attempt', 'completion_pct', 'adot', 'passer_rating',
        ])

    # Bin depth
    passes['depth_bin'] = pd.cut(
        passes['air_yards'],
        bins=[-999, 10, 20, 999],
        labels=['short', 'intermediate', 'deep'],
        right=False,
    )
    passes['direction_bin'] = passes['pass_location']

    # Name map
    name_map = passes.groupby('passer_player_id')['passer_player_name'].agg(
        lambda x: x.mode().iloc[0] if len(x.mode()) > 0 else x.iloc[0]
    ).to_dict()

    # Team assignment: most attempts
    team_counts = passes.groupby(['passer_player_id', 'posteam']).size().reset_index(name='cnt')
    team_primary = team_counts.sort_values('cnt', ascending=False).drop_duplicates('passer_player_id')
    team_map = dict(zip(team_primary['passer_player_id'], team_primary['posteam']))

    # Aggregate
    grouped = passes.groupby(['passer_player_id', 'depth_bin', 'direction_bin'], observed=True).agg(
        pass_attempts=('epa', 'count'),
        completions=('complete_pass', 'sum'),
        passing_yards=('passing_yards', lambda s: s.fillna(0).sum()),
        pass_tds=('pass_touchdown', 'sum'),
        interceptions=('interception', 'sum'),
        epa_sum=('epa', lambda s: s.dropna().sum()),
        adot=('air_yards', lambda s: s.dropna().mean()),
    ).reset_index()

    grouped = grouped.rename(columns={'passer_player_id': 'player_id'})
    grouped['player_name'] = grouped['player_id'].map(name_map)
    grouped['team_id'] = grouped['player_id'].map(team_map)
    grouped['season'] = season
    grouped['epa_per_attempt'] = grouped['epa_sum'] / grouped['pass_attempts']
    grouped['completion_pct'] = grouped['completions'] / grouped['pass_attempts']

    # Passer rating — only for zones with 5+ attempts
    def calc_passer_rating(row):
        if row['pass_attempts'] < 5:
            return None
        return passer_rating(
            int(row['completions']), int(row['pass_attempts']),
            int(row['passing_yards']), int(row['pass_tds']), int(row['interceptions'])
        )
    grouped['passer_rating'] = grouped.apply(calc_passer_rating, axis=1)

    # Convert categorical to string for DB
    grouped['depth_bin'] = grouped['depth_bin'].astype(str)
    grouped['direction_bin'] = grouped['direction_bin'].astype(str)

    log.info("Aggregated %d QB pass location zones for %d QBs",
             len(grouped), grouped['player_id'].nunique())

    return grouped
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `python -m pytest tests/test_pass_location_stats.py -v`
Expected: All tests PASS

- [ ] **Step 5: Run full test suite to check for regressions**

Run: `python -m pytest tests/ -v`
Expected: All 124+ tests PASS

- [ ] **Step 6: Commit**

```
git add tests/test_pass_location_stats.py scripts/ingest.py
git commit -m "feat: add QB pass location aggregation with tests"
```

---

### Task 3: Pipeline — Table DDL, upsert, and cleanup integration

**Files:**
- Modify: `scripts/ingest.py` (add ensure/upsert functions, update process_season and cleanup)

- [ ] **Step 7: Add `ensure_qb_pass_location_tables()` function**

Add after the last `ensure_*` function (around line 1470). Follow the `ensure_rb_gap_tables` pattern at line 1148:

```python
def ensure_qb_pass_location_tables(conn):
    """Create qb_pass_location_stats table if it doesn't exist."""
    with conn.cursor() as cur:
        cur.execute("""
            CREATE TABLE IF NOT EXISTS qb_pass_location_stats (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                player_id TEXT NOT NULL,
                player_name TEXT NOT NULL,
                team_id TEXT NOT NULL REFERENCES teams(id),
                season INT NOT NULL,
                depth_bin TEXT NOT NULL,
                direction_bin TEXT NOT NULL,
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
            )
        """)
        cur.execute("""
            DO $$ BEGIN
                ALTER TABLE qb_pass_location_stats ENABLE ROW LEVEL SECURITY;
            EXCEPTION WHEN others THEN NULL;
            END $$
        """)
        cur.execute("""
            DO $$ BEGIN
                CREATE POLICY "public_read" ON qb_pass_location_stats FOR SELECT USING (true);
            EXCEPTION WHEN duplicate_object THEN NULL;
            END $$
        """)
    conn.commit()
    log.info("Ensured qb_pass_location_stats table exists with RLS")
```

- [ ] **Step 8: Add `upsert_qb_pass_location_stats()` function**

Add right after the ensure function. Follow the `upsert_rb_gap_stats` pattern at line 1185:

```python
@retry(max_retries=2, delay=3)
def upsert_qb_pass_location_stats(conn, df: pd.DataFrame):
    """Upsert QB pass location stats."""
    if df.empty:
        log.info("No QB pass location stats to upsert")
        return

    cols = ['player_id', 'player_name', 'team_id', 'season',
            'depth_bin', 'direction_bin', 'pass_attempts', 'completions',
            'passing_yards', 'pass_tds', 'interceptions',
            'epa_sum', 'epa_per_attempt', 'completion_pct', 'adot', 'passer_rating']
    clean_df = df[cols].where(df[cols].notna(), None)
    rows = [tuple(r) for _, r in clean_df.iterrows()]
    col_names = ', '.join(cols)
    update_set = ', '.join(
        f"{c} = EXCLUDED.{c}" for c in cols
        if c not in ('player_id', 'season', 'depth_bin', 'direction_bin')
    )

    with conn.cursor() as cur:
        execute_values(
            cur,
            f"INSERT INTO qb_pass_location_stats ({col_names}) VALUES %s "
            f"ON CONFLICT (player_id, season, depth_bin, direction_bin) DO UPDATE SET {update_set}",
            rows,
        )
    log.info("Upserted %d QB pass location stat rows", len(rows))
```

- [ ] **Step 9: Add `qb_pass_loc_player_ids` to `cleanup_stale_rows()`**

At line 2382, add `qb_pass_loc_player_ids: list = None` to the function signature. Then add the cleanup block inside the function body (after the last existing `if X_player_ids is not None:` block):

```python
        if qb_pass_loc_player_ids is not None:
            cur.execute(
                "DELETE FROM qb_pass_location_stats WHERE season = %s AND player_id != ALL(%s)",
                (season, qb_pass_loc_player_ids),
            )
            if cur.rowcount > 0:
                log.info("Cleaned up %d stale qb_pass_location_stats rows", cur.rowcount)
```

- [ ] **Step 10: Wire into `process_season()`**

Three changes in `process_season()`:

1. Add aggregation call after `qb_stats` (around line 2535):
```python
    qb_pass_loc = aggregate_qb_pass_location_stats(plays, roster, season)
```

2. Add ensure call (around line 2574):
```python
    ensure_qb_pass_location_tables(conn)
```

3. Add upsert call (after `upsert_qb_stats`, around line 2580):
```python
        upsert_qb_pass_location_stats(conn, qb_pass_loc)
```

4. Add to cleanup call (around line 2590):
```python
            qb_pass_loc_player_ids=qb_pass_loc['player_id'].unique().tolist() if not qb_pass_loc.empty else [],
```

- [ ] **Step 11: Run full test suite**

Run: `python -m pytest tests/ -v`
Expected: All tests PASS

- [ ] **Step 12: Commit**

```
git add scripts/ingest.py
git commit -m "feat: add pipeline DDL, upsert, and cleanup for QB pass location stats"
```

---

### Task 4: TypeScript — Type definition and data query

**Files:**
- Modify: `lib/types/index.ts` (append new type after line 269)
- Modify: `lib/data/players.ts` (append new query after line 227)

- [ ] **Step 13: Add `QBPassLocationStat` type**

Append to `lib/types/index.ts` after the last interface:

```typescript
// QB Field Heat Map types
export interface QBPassLocationStat {
  id: string;
  player_id: string;
  player_name: string;
  team_id: string;
  season: number;
  depth_bin: string;
  direction_bin: string;
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

- [ ] **Step 14: Add `getQBPassLocationStats()` query**

Append to `lib/data/players.ts`. Add `QBPassLocationStat` to the import from `@/lib/types`. Then add:

```typescript
const QB_PASS_LOC_NUMERIC = [
  "epa_per_attempt",
  "completion_pct",
  "adot",
  "passer_rating",
];

export async function getQBPassLocationStats(
  playerId: string,
  season: number
): Promise<QBPassLocationStat[]> {
  const supabase = createServerClient();
  const { data, error } = await supabase
    .from("qb_pass_location_stats")
    .select("*")
    .eq("player_id", playerId)
    .eq("season", season);
  if (error || !data) return [];
  return data.map((row) =>
    parseNumericFields<QBPassLocationStat>(
      row as unknown as QBPassLocationStat,
      QB_PASS_LOC_NUMERIC
    )
  );
}
```

- [ ] **Step 15: Run TypeScript check**

Run: `npx tsc --noEmit`
Expected: Clean (no errors)

- [ ] **Step 16: Commit**

```
git add lib/types/index.ts lib/data/players.ts
git commit -m "feat: add QBPassLocationStat type and query"
```

---

### Task 5: Page data wiring — Fetch and pass through to component

**Files:**
- Modify: `app/player/[slug]/page.tsx` (lines 5, 97-103)
- Modify: `components/player/PlayerPageContent.tsx` (lines 6-10, 21-32, 34-37, 63-83, 167-195)

- [ ] **Step 17: Fetch pass location stats in page.tsx**

In `app/player/[slug]/page.tsx`:

1. Add `getQBPassLocationStats` to the import from `@/lib/data/players` (line 5)
2. Add `import type { QBPassLocationStat } from "@/lib/types";`
3. Add variable declaration (around line 92): `let passLocationStats: QBPassLocationStat[] = [];`
4. In the QB block (around line 97), add `getQBPassLocationStats` to the Promise.all:

```typescript
      const [allQBs, weekly, teamReceivers, passLocStats] = await Promise.all([
        getQBStats(currentSeason).catch(() => []),
        getQBWeeklyStats(player.player_id, currentSeason),
        getTeamTopReceivers(player.current_team_id, currentSeason, 5).catch(() => []),
        getQBPassLocationStats(player.player_id, currentSeason).catch(() => []),
      ]);
```

5. After the parallel fetch: `passLocationStats = passLocStats;`
6. Pass to PlayerPageContent: `passLocationStats={passLocationStats}`

- [ ] **Step 18: Update PlayerPageContent to accept and route the data**

In `components/player/PlayerPageContent.tsx`:

1. Add `QBPassLocationStat` to the import from `@/lib/types`
2. Add `passLocationStats?: QBPassLocationStat[]` to `PlayerPageContentProps`
3. Add `passLocationStats = []` to destructured props
4. Define `QB_TABS` alongside existing `TABS`:

```typescript
const TABS = [
  { key: "overview", label: "Overview" },
  { key: "game-log", label: "Game Log" },
] as const;

const QB_TABS = [
  { key: "overview", label: "Overview" },
  { key: "game-log", label: "Game Log" },
  { key: "field-map", label: "Field Map" },
] as const;
```

5. Use position-appropriate tabs: `const tabs = position === "QB" ? QB_TABS : TABS;`
6. Update `activeTab` validation to use `tabs` instead of `TABS`
7. Add `renderFieldMap()` function:

```typescript
  function renderFieldMap() {
    return (
      <PlayerFieldHeatMap
        stats={passLocationStats}
        playerName={player.player_name}
        season={season}
      />
    );
  }
```

8. Update the JSX tab bar to iterate over `tabs` instead of `TABS`: change `{TABS.map((t) => (` to `{tabs.map((t) => (`
9. Update tab content rendering to handle the new tab:
```typescript
{activeTab === "overview" ? renderOverview() : activeTab === "field-map" ? renderFieldMap() : renderGameLog()}
```

10. Import `PlayerFieldHeatMap` — create a minimal stub file first to avoid tsc failures:
```typescript
// components/player/PlayerFieldHeatMap.tsx (stub — replaced in Task 6)
"use client";
import type { QBPassLocationStat } from "@/lib/types";
export default function PlayerFieldHeatMap({ stats, playerName, season }: { stats: QBPassLocationStat[]; playerName: string; season: number }) {
  return <div className="text-gray-400 text-center py-12">Field Heat Map — coming soon ({stats.length} zones, {playerName}, {season})</div>;
}
```

- [ ] **Step 19: Run TypeScript check**

Run: `npx tsc --noEmit`
Expected: May fail if `PlayerFieldHeatMap` doesn't exist yet — that's OK, we'll create it next.

- [ ] **Step 20: Commit**

```
git add app/player/[slug]/page.tsx components/player/PlayerPageContent.tsx
git commit -m "feat: wire QB pass location data through to player page"
```

---

### Task 6: Frontend — PlayerFieldHeatMap component

**Files:**
- Create: `components/player/PlayerFieldHeatMap.tsx`

- [ ] **Step 21: Replace the PlayerFieldHeatMap stub with the full component**

Replace the stub at `components/player/PlayerFieldHeatMap.tsx` with the full SVG implementation. This is a pure React SVG component (no D3), following the RadarChart pattern at `components/qb/RadarChart.tsx`.

Key implementation details:
- `ZONES` constant: `[["deep","left"], ["deep","middle"], ["deep","right"], ["intermediate","left"], ...]`
- Build a lookup `Record<string, QBPassLocationStat>` from stats array, keyed by `${depth_bin}-${direction_bin}`
- Summary bar: sum all stats across zones for the header totals
- Tab state: `activeTab` controls which metric is the big number and which color scale is used
- SVG viewBox `"0 0 360 440"` with green turf background
- 3×3 grid of `<rect>` cells at computed positions with `rx="6"` corners
- Yard line markers at depth boundaries with labeled pills
- LOS at bottom in amber
- Depth labels in left gutter, rotated 90°
- Direction labels at top
- Color functions:
  - `volumeColor(value, max)`: green opacity scaled to proportion of max
  - `catchPctColor(pct)`: green→red interpolation, neutral at 0.65
  - `epaColor(epa)`: green for positive, red for negative

The component should be `"use client"` since it has `useState` for the active tab.

Full component is ~250 lines. Build the SVG structure matching the approved mockup in `.superpowers/brainstorm/3072-1774197656/grid-layout-v3.html`.

- [ ] **Step 22: Run TypeScript check**

Run: `npx tsc --noEmit`
Expected: Clean

- [ ] **Step 23: Run ESLint**

Run: `npx next lint`
Expected: No errors

- [ ] **Step 24: Commit**

```
git add components/player/PlayerFieldHeatMap.tsx
git commit -m "feat: add PlayerFieldHeatMap SVG component with 4 metric tabs"
```

---

### Task 7: Glossary entry

**Files:**
- Modify: `app/glossary/page.tsx` (insert in TERMS array)

- [ ] **Step 25: Add Field Heat Map glossary entry**

Add a new entry to the `TERMS` array in `app/glossary/page.tsx` (around line 100, near other passing terms):

```typescript
{
  term: "Field Heat Map",
  id: "field-heat-map",
  definition:
    "A 3×3 grid showing where a QB throws on the field, broken down by depth (short 0-9 yards, intermediate 10-19, deep 20+) and direction (left, middle, right). Air yards measures the distance the ball travels in the air from the line of scrimmage. Direction (L/M/R) is derived from nflverse charting data, which categorizes passes into three zones.",
},
```

- [ ] **Step 26: Run TypeScript check and lint**

Run: `npx tsc --noEmit`
Run: `npx next lint`
Expected: Clean

- [ ] **Step 27: Commit**

```
git add app/glossary/page.tsx
git commit -m "feat: add Field Heat Map glossary entry"
```

---

### Task 8: Pipeline seed run and verification

**Files:** None (operational verification)

- [ ] **Step 28: Run pipeline for one season to populate data**

Run: `python scripts/ingest.py --season 2025`

Expected: Log output includes:
- `"Ensured qb_pass_location_stats table exists with RLS"`
- `"Aggregated N QB pass location zones for M QBs"`
- `"Upserted N QB pass location stat rows"`
- No errors

- [ ] **Step 29: Verify data in Supabase**

Check the table has data. Expected: ~30-35 QBs × up to 9 zones = ~200-300 rows for 2025.

- [ ] **Step 30: Run all tests one final time**

Run: `python -m pytest tests/ -v`
Run: `npx tsc --noEmit`
Run: `npx next lint`
Expected: All pass, all clean

- [ ] **Step 31: Commit any remaining changes**

```
git add -A
git commit -m "feat: QB Field Heat Map — pipeline verified, data seeded"
```

---

### Task Summary

| Task | Description | Files | Steps |
|------|-------------|-------|-------|
| 1 | Pipeline tests | tests/test_pass_location_stats.py | 1-2 |
| 2 | Pipeline aggregation function | scripts/ingest.py | 3-6 |
| 3 | DDL, upsert, cleanup, process_season wiring | scripts/ingest.py | 7-12 |
| 4 | TypeScript type + query | lib/types, lib/data/players | 13-16 |
| 5 | Page data wiring | page.tsx, PlayerPageContent | 17-20 |
| 6 | SVG component | PlayerFieldHeatMap.tsx | 21-24 |
| 7 | Glossary entry | glossary/page.tsx | 25-27 |
| 8 | Pipeline seed + verification | (operational) | 28-31 |
