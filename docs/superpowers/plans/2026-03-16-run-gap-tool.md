# Run Gap Tool Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a `/run-gaps` page showing rushing EPA broken down by 7 offensive line gaps with an interactive formation diagram, player drill-down cards, defensive matchup overlay, and advanced filters.

**Architecture:** Server component fetches gap stats from Supabase, passes to D3-powered client components. Data ingested via new functions in `scripts/ingest.py` from nflverse PBP. Desktop shows SVG formation diagram; mobile shows bar chart. v2 adds weekly granularity, defensive matchup layer, situational filters, and a league-wide heatmap.

**Tech Stack:** Next.js 14 App Router, Supabase (PostgreSQL), D3.js v7, Tailwind CSS 4.2, Python/pandas/psycopg2 for ingestion.

**Spec:** `docs/superpowers/specs/2026-03-16-run-gap-tool-design.md`

---

## File Structure

### New Files
| File | Responsibility |
|------|---------------|
| `tests/test_gap_stats.py` | pytest tests for gap mapping, aggregation, filters |
| `app/run-gaps/page.tsx` | Server component — data fetch, layout, metadata |
| `app/run-gaps/loading.tsx` | Skeleton state (pulsing OL circles) |
| `app/run-gaps/error.tsx` | Error boundary with retry |
| `components/charts/RunGapDiagram.tsx` | Client — D3 SVG formation diagram with bezier arrows |
| `components/charts/GapBarChart.tsx` | Client — mobile horizontal bar chart |
| `components/charts/PlayerGapCards.tsx` | Client — expandable player card grid |
| `components/charts/GapHeatmap.tsx` | Client — v2 league-wide 32×7 matrix |
| `lib/data/run-gaps.ts` | Supabase query functions for gap data |

### Modified Files
| File | Changes |
|------|---------|
| `scripts/ingest.py` | Add `aggregate_rb_gap_stats()`, `upsert_rb_gap_stats()`, `aggregate_rb_gap_stats_weekly()`, `upsert_rb_gap_stats_weekly()`, `aggregate_def_gap_stats()`, `upsert_def_gap_stats()`; extend `cleanup_stale_rows()`; extend `process_season()` |
| `lib/types/index.ts` | Add `RBGapStat`, `RBGapStatWeekly`, `DefGapStat` interfaces |
| `components/layout/Navbar.tsx` | Add "Run Gaps" to NAV_LINKS |
| `app/sitemap.ts` | Add `/run-gaps` entry |
| `app/glossary/page.tsx` | Add Run Gap, Stuff Rate, Explosive Run Rate terms |

---

## Chunk 1: Data Pipeline — Gap Mapping & Aggregation

### Task 1: Gap mapping function + tests

**Files:**
- Create: `tests/test_gap_stats.py`
- Modify: `scripts/ingest.py`

- [ ] **Step 1: Write failing tests for gap mapping**

```python
# tests/test_gap_stats.py
import sys
import os
import math
import pytest
import pandas as pd

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'scripts'))


class TestGapMapping:
    """Test the GAP_MAP dictionary and map_run_gap() function."""

    def test_left_end(self):
        from ingest import map_run_gap
        assert map_run_gap('left', 'end') == 'LE'

    def test_left_tackle(self):
        from ingest import map_run_gap
        assert map_run_gap('left', 'tackle') == 'LT'

    def test_left_guard(self):
        from ingest import map_run_gap
        assert map_run_gap('left', 'guard') == 'LG'

    def test_middle_none(self):
        from ingest import map_run_gap
        assert map_run_gap('middle', None) == 'M'

    def test_middle_guard(self):
        from ingest import map_run_gap
        assert map_run_gap('middle', 'guard') == 'M'

    def test_middle_tackle(self):
        from ingest import map_run_gap
        assert map_run_gap('middle', 'tackle') == 'M'

    def test_right_guard(self):
        from ingest import map_run_gap
        assert map_run_gap('right', 'guard') == 'RG'

    def test_right_tackle(self):
        from ingest import map_run_gap
        assert map_run_gap('right', 'tackle') == 'RT'

    def test_right_end(self):
        from ingest import map_run_gap
        assert map_run_gap('right', 'end') == 'RE'

    def test_unknown_returns_none(self):
        from ingest import map_run_gap
        assert map_run_gap('left', 'unknown') is None

    def test_none_none_returns_none(self):
        from ingest import map_run_gap
        assert map_run_gap(None, None) is None
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd "C:/Users/jonra/OneDrive/Desktop/claude sandbox/football website/yards-per-pass" && python -m pytest tests/test_gap_stats.py::TestGapMapping -v`
Expected: FAIL with "cannot import name 'map_run_gap'"

- [ ] **Step 3: Implement GAP_MAP and map_run_gap()**

Add after the `REQUIRED_PBP_COLS` list (around line 82) in `scripts/ingest.py`:

```python
# --- Run gap mapping ---
GAP_MAP = {
    ('left', 'end'): 'LE',
    ('left', 'tackle'): 'LT',
    ('left', 'guard'): 'LG',
    ('middle', None): 'M',
    ('middle', 'guard'): 'M',
    ('middle', 'tackle'): 'M',
    ('right', 'guard'): 'RG',
    ('right', 'tackle'): 'RT',
    ('right', 'end'): 'RE',
}


def map_run_gap(run_location, run_gap):
    """Map nflverse run_location + run_gap to one of 7 gap labels.

    Returns: 'LE','LT','LG','M','RG','RT','RE' or None if unmappable.
    """
    return GAP_MAP.get((run_location, run_gap))
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd "C:/Users/jonra/OneDrive/Desktop/claude sandbox/football website/yards-per-pass" && python -m pytest tests/test_gap_stats.py::TestGapMapping -v`
Expected: 11 PASSED

- [ ] **Step 5: Commit**

```bash
cd "C:/Users/jonra/OneDrive/Desktop/claude sandbox/football website/yards-per-pass"
git add tests/test_gap_stats.py scripts/ingest.py
git commit -m "feat: add GAP_MAP and map_run_gap() for run gap tool"
```

---

### Task 2: aggregate_rb_gap_stats() + tests

**Files:**
- Modify: `tests/test_gap_stats.py`
- Modify: `scripts/ingest.py`

- [ ] **Step 1: Write failing tests for aggregation**

Append to `tests/test_gap_stats.py`:

```python
class TestAggregateRBGapStats:
    """Test aggregate_rb_gap_stats() — groups rushing plays by player × team × gap."""

    def _make_plays(self):
        """Minimal PBP DataFrame with rush plays for gap aggregation."""
        return pd.DataFrame({
            'rush_attempt': [1, 1, 1, 1, 1, 0],
            'qb_scramble': [0, 0, 0, 0, 0, 0],
            'play_type': ['run', 'run', 'run', 'run', 'run', 'pass'],
            'run_location': ['left', 'left', 'left', 'middle', 'right', None],
            'run_gap': ['guard', 'guard', 'tackle', None, 'end', None],
            'rusher_player_id': ['RB1', 'RB1', 'RB1', 'RB2', 'RB1', 'QB1'],
            'rusher_player_name': ['J.Smith', 'J.Smith', 'J.Smith', 'K.Jones', 'J.Smith', 'L.Jackson'],
            'posteam': ['BAL', 'BAL', 'BAL', 'BAL', 'BAL', 'BAL'],
            'epa': [0.5, -0.2, 0.8, 0.1, -0.1, 1.0],
            'success': [1, 0, 1, 1, 0, 1],
            'yards_gained': [5, -1, 12, 3, 0, 15],
            'season': [2024, 2024, 2024, 2024, 2024, 2024],
        })

    def test_excludes_pass_plays(self):
        from ingest import aggregate_rb_gap_stats
        plays = self._make_plays()
        result = aggregate_rb_gap_stats(plays, 2024)
        player_ids = result['player_id'].unique()
        assert 'QB1' not in player_ids

    def test_correct_gap_assignment(self):
        from ingest import aggregate_rb_gap_stats
        plays = self._make_plays()
        result = aggregate_rb_gap_stats(plays, 2024)
        rb1_lg = result[(result['player_id'] == 'RB1') & (result['gap'] == 'LG')]
        assert len(rb1_lg) == 1
        assert rb1_lg.iloc[0]['carries'] == 2

    def test_epa_per_carry(self):
        from ingest import aggregate_rb_gap_stats
        plays = self._make_plays()
        result = aggregate_rb_gap_stats(plays, 2024)
        rb1_lg = result[(result['player_id'] == 'RB1') & (result['gap'] == 'LG')]
        assert rb1_lg.iloc[0]['epa_per_carry'] == pytest.approx(0.15, abs=0.01)

    def test_success_rate(self):
        from ingest import aggregate_rb_gap_stats
        plays = self._make_plays()
        result = aggregate_rb_gap_stats(plays, 2024)
        rb1_lg = result[(result['player_id'] == 'RB1') & (result['gap'] == 'LG')]
        assert rb1_lg.iloc[0]['success_rate'] == pytest.approx(0.5, abs=0.01)

    def test_stuff_rate(self):
        from ingest import aggregate_rb_gap_stats
        plays = self._make_plays()
        result = aggregate_rb_gap_stats(plays, 2024)
        rb1_lg = result[(result['player_id'] == 'RB1') & (result['gap'] == 'LG')]
        # 1 of 2 carries had yards_gained <= 0
        assert rb1_lg.iloc[0]['stuff_rate'] == pytest.approx(0.5, abs=0.01)

    def test_explosive_rate(self):
        from ingest import aggregate_rb_gap_stats
        plays = self._make_plays()
        result = aggregate_rb_gap_stats(plays, 2024)
        rb1_lt = result[(result['player_id'] == 'RB1') & (result['gap'] == 'LT')]
        # 1 carry of 12 yards = 100% explosive
        assert rb1_lt.iloc[0]['explosive_rate'] == pytest.approx(1.0, abs=0.01)

    def test_middle_with_none_gap(self):
        from ingest import aggregate_rb_gap_stats
        plays = self._make_plays()
        result = aggregate_rb_gap_stats(plays, 2024)
        rb2_m = result[(result['player_id'] == 'RB2') & (result['gap'] == 'M')]
        assert len(rb2_m) == 1
        assert rb2_m.iloc[0]['carries'] == 1

    def test_unmappable_gaps_excluded(self):
        from ingest import aggregate_rb_gap_stats
        plays = pd.DataFrame({
            'rush_attempt': [1],
            'qb_scramble': [0],
            'play_type': ['run'],
            'run_location': [None],
            'run_gap': [None],
            'rusher_player_id': ['RB1'],
            'rusher_player_name': ['J.Smith'],
            'posteam': ['BAL'],
            'epa': [0.5],
            'success': [1],
            'yards_gained': [5],
            'season': [2024],
        })
        result = aggregate_rb_gap_stats(plays, 2024)
        assert len(result) == 0

    def test_output_columns(self):
        from ingest import aggregate_rb_gap_stats
        plays = self._make_plays()
        result = aggregate_rb_gap_stats(plays, 2024)
        expected_cols = {'player_id', 'player_name', 'team_id', 'season', 'gap',
                         'carries', 'epa_per_carry', 'yards_per_carry',
                         'success_rate', 'stuff_rate', 'explosive_rate'}
        assert set(result.columns) == expected_cols
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd "C:/Users/jonra/OneDrive/Desktop/claude sandbox/football website/yards-per-pass" && python -m pytest tests/test_gap_stats.py::TestAggregateRBGapStats -v`
Expected: FAIL with "cannot import name 'aggregate_rb_gap_stats'"

- [ ] **Step 3: Implement aggregate_rb_gap_stats()**

Add after `aggregate_qb_stats()` (around line 425) in `scripts/ingest.py`:

```python
def aggregate_rb_gap_stats(plays: pd.DataFrame, season: int) -> pd.DataFrame:
    """Aggregate rushing stats by player × team × gap for designed runs.

    Filters: rush_attempt == 1, qb_scramble != 1, mappable gap.
    Returns DataFrame with columns: player_id, player_name, team_id, season,
    gap, carries, epa_per_carry, yards_per_carry, success_rate, stuff_rate,
    explosive_rate.
    """
    # Validate required columns exist
    for col in ('run_location', 'run_gap'):
        if col not in plays.columns:
            log.warning("Column '%s' not found in PBP data — skipping gap stats", col)
            return pd.DataFrame(columns=[
                'player_id', 'player_name', 'team_id', 'season', 'gap',
                'carries', 'epa_per_carry', 'yards_per_carry',
                'success_rate', 'stuff_rate', 'explosive_rate',
            ])

    # Filter to designed rushes only
    rushes = plays[
        (plays['rush_attempt'] == 1) &
        (plays['qb_scramble'] != 1)
    ].copy()

    # Map gaps — keep rows where mapping succeeds
    rushes['gap'] = rushes.apply(
        lambda r: map_run_gap(
            r['run_location'] if pd.notna(r['run_location']) else None,
            r['run_gap'] if pd.notna(r['run_gap']) else None,
        ),
        axis=1,
    )
    rushes = rushes[rushes['gap'].notna()]

    if rushes.empty:
        return pd.DataFrame(columns=[
            'player_id', 'player_name', 'team_id', 'season', 'gap',
            'carries', 'epa_per_carry', 'yards_per_carry',
            'success_rate', 'stuff_rate', 'explosive_rate',
        ])

    # Aggregate by player × team × gap
    grouped = rushes.groupby(
        ['rusher_player_id', 'rusher_player_name', 'posteam', 'gap']
    ).agg(
        carries=('epa', 'count'),
        epa_per_carry=('epa', 'mean'),
        yards_per_carry=('yards_gained', 'mean'),
        success_rate=('success', 'mean'),
        stuff_rate=('yards_gained', lambda x: (x <= 0).mean()),
        explosive_rate=('yards_gained', lambda x: (x >= 10).mean()),
    ).reset_index()

    grouped = grouped.rename(columns={
        'rusher_player_id': 'player_id',
        'rusher_player_name': 'player_name',
        'posteam': 'team_id',
    })
    grouped['season'] = season

    return grouped[['player_id', 'player_name', 'team_id', 'season', 'gap',
                     'carries', 'epa_per_carry', 'yards_per_carry',
                     'success_rate', 'stuff_rate', 'explosive_rate']]
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd "C:/Users/jonra/OneDrive/Desktop/claude sandbox/football website/yards-per-pass" && python -m pytest tests/test_gap_stats.py::TestAggregateRBGapStats -v`
Expected: 10 PASSED

- [ ] **Step 5: Run ALL existing tests to ensure no regressions**

Run: `cd "C:/Users/jonra/OneDrive/Desktop/claude sandbox/football website/yards-per-pass" && python -m pytest tests/ -v`
Expected: All tests PASS (existing + 11 new gap mapping tests)

- [ ] **Step 6: Commit**

```bash
cd "C:/Users/jonra/OneDrive/Desktop/claude sandbox/football website/yards-per-pass"
git add tests/test_gap_stats.py scripts/ingest.py
git commit -m "feat: add aggregate_rb_gap_stats() for run gap tool data pipeline"
```

---

### Task 3: Upsert function + table creation + cleanup

**Files:**
- Modify: `scripts/ingest.py`

- [ ] **Step 1: Add ensure_rb_gap_tables() + upsert_rb_gap_stats()**

Add after `upsert_qb_stats()` (around line 543) in `scripts/ingest.py`.

First, a table creation function called ONCE in `process_season()` (NOT inside @retry):

```python
def ensure_rb_gap_tables(conn):
    """Create rb_gap_stats table if it doesn't exist. Called once, NOT inside @retry."""
    with conn.cursor() as cur:
        cur.execute("""
            CREATE TABLE IF NOT EXISTS rb_gap_stats (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                player_id TEXT NOT NULL,
                player_name TEXT NOT NULL,
                team_id TEXT NOT NULL REFERENCES teams(id),
                season INT NOT NULL,
                gap TEXT NOT NULL,
                carries INT NOT NULL,
                epa_per_carry NUMERIC,
                yards_per_carry NUMERIC,
                success_rate NUMERIC,
                stuff_rate NUMERIC,
                explosive_rate NUMERIC,
                UNIQUE (player_id, team_id, season, gap)
            )
        """)
        cur.execute("""
            DO $$ BEGIN
                ALTER TABLE rb_gap_stats ENABLE ROW LEVEL SECURITY;
            EXCEPTION WHEN others THEN NULL;
            END $$
        """)
        cur.execute("""
            DO $$ BEGIN
                CREATE POLICY "public_read" ON rb_gap_stats FOR SELECT USING (true);
            EXCEPTION WHEN duplicate_object THEN NULL;
            END $$
        """)
    conn.commit()
    log.info("Ensured rb_gap_stats table exists with RLS")
```

Then the upsert function (with @retry, NO table creation):

```python
@retry(max_retries=2, delay=3)
def upsert_rb_gap_stats(conn, df: pd.DataFrame):
    """Upsert RB gap stats into rb_gap_stats table."""
    if df.empty:
        log.info("No RB gap stats to upsert")
        return

    cols = ['player_id', 'player_name', 'team_id', 'season', 'gap',
            'carries', 'epa_per_carry', 'yards_per_carry',
            'success_rate', 'stuff_rate', 'explosive_rate']
    clean_df = df[cols].where(df[cols].notna(), None)
    rows = [tuple(r) for _, r in clean_df.iterrows()]
    col_names = ', '.join(cols)
    update_set = ', '.join(
        f"{c} = EXCLUDED.{c}" for c in cols
        if c not in ('player_id', 'team_id', 'season', 'gap')
    )

    with conn.cursor() as cur:
        execute_values(
            cur,
            f"INSERT INTO rb_gap_stats ({col_names}) VALUES %s "
            f"ON CONFLICT (player_id, team_id, season, gap) DO UPDATE SET {update_set}",
            rows,
        )
    log.info("Upserted %d RB gap stat rows", len(rows))
```

- [ ] **Step 2: Extend cleanup_stale_rows() for rb_gap_stats**

In the existing `cleanup_stale_rows()` function, add after the QB cleanup block:

```python
        # Clean up stale RB gap stats
        cur.execute(
            "DELETE FROM rb_gap_stats WHERE season = %s AND player_id != ALL(%s)",
            (season, player_ids),
        )
        if cur.rowcount > 0:
            log.info("Cleaned up %d stale rb_gap_stats rows", cur.rowcount)
```

Note: reuse the same `player_ids` list. The `player_ids` param currently contains QB IDs only — we need to change the caller to pass RB IDs separately. Update `cleanup_stale_rows()` signature:

```python
def cleanup_stale_rows(conn, season: int, team_ids: list, player_ids: list, rb_gap_player_ids: list = None):
```

And add at the end of the function:

```python
        if rb_gap_player_ids is not None:
            cur.execute(
                "DELETE FROM rb_gap_stats WHERE season = %s AND player_id != ALL(%s)",
                (season, rb_gap_player_ids),
            )
            if cur.rowcount > 0:
                log.info("Cleaned up %d stale rb_gap_stats rows", cur.rowcount)
```

- [ ] **Step 3: Wire into process_season()**

In `process_season()`, after the existing aggregation calls (around line 622), add:

```python
    rb_gap_stats = aggregate_rb_gap_stats(plays, season)
    log.info("Aggregated %d RB gap stat rows", len(rb_gap_stats))
```

Before the try block (after aggregation, before upserts), add:

```python
    ensure_rb_gap_tables(conn)
```

In the try block after existing upserts (around line 643), add:

```python
        upsert_rb_gap_stats(conn, rb_gap_stats)
```

Update the `cleanup_stale_rows()` call to pass the new parameter:

```python
        cleanup_stale_rows(
            conn, season,
            team_ids=team_stats['team_id'].unique().tolist(),
            player_ids=qb_stats['player_id'].unique().tolist(),
            rb_gap_player_ids=rb_gap_stats['player_id'].unique().tolist() if not rb_gap_stats.empty else [],
        )
```

- [ ] **Step 4: Run all tests**

Run: `cd "C:/Users/jonra/OneDrive/Desktop/claude sandbox/football website/yards-per-pass" && python -m pytest tests/ -v`
Expected: All tests PASS (existing + gap mapping + aggregation tests)

- [ ] **Step 5: Commit**

```bash
cd "C:/Users/jonra/OneDrive/Desktop/claude sandbox/football website/yards-per-pass"
git add scripts/ingest.py
git commit -m "feat: add upsert_rb_gap_stats() with table creation and stale cleanup"
```

---

### Task 4: Run ingest dry-run to verify gap data

**Files:** None (verification only)

- [ ] **Step 1: Run dry-run for 2024 season**

Run: `cd "C:/Users/jonra/OneDrive/Desktop/claude sandbox/football website/yards-per-pass" && python scripts/ingest.py --season 2024 --dry-run`

Expected output should include:
- "Aggregated N RB gap stat rows" (expect ~2000-3500)
- No errors or warnings about missing columns

- [ ] **Step 2: Verify gap distribution looks reasonable**

Add temporary logging in `aggregate_rb_gap_stats()` to check gap distribution (or check the dry-run sample output). Expected: all 7 gaps present, middle (M) likely highest volume, ends (LE/RE) lowest.

- [ ] **Step 3: Run actual ingest against Supabase**

Run: `cd "C:/Users/jonra/OneDrive/Desktop/claude sandbox/football website/yards-per-pass" && python scripts/ingest.py --season 2024`

Expected: "Upserted N RB gap stat rows" with successful commit.

- [ ] **Step 4: Verify data in Supabase**

Check Supabase dashboard or run a query to confirm `rb_gap_stats` table exists with data.

- [ ] **Step 5: Verify RLS policy is active**

RLS is created by `ensure_rb_gap_tables()`. Verify in Supabase dashboard that `rb_gap_stats` has "public_read" policy enabled. If not, run manually in SQL editor:

```sql
ALTER TABLE rb_gap_stats ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public_read" ON rb_gap_stats FOR SELECT USING (true);
```

- [ ] **Step 6: Commit any adjustments**

```bash
cd "C:/Users/jonra/OneDrive/Desktop/claude sandbox/football website/yards-per-pass"
git add scripts/ingest.py
git commit -m "fix: adjust gap aggregation after dry-run verification"
```

---

## Chunk 2: Core Page + Formation Diagram

### Task 5: TypeScript types + Supabase queries

**Files:**
- Modify: `lib/types/index.ts`
- Create: `lib/data/run-gaps.ts`

- [ ] **Step 1: Add RBGapStat interface to types**

Append to `lib/types/index.ts` (after `DataFreshness` interface):

```typescript
// Run Gap Tool types
export interface RBGapStat {
  id: string;
  player_id: string;
  player_name: string;
  team_id: string;
  season: number;
  gap: string; // LE, LT, LG, M, RG, RT, RE
  carries: number;
  epa_per_carry: number | null;
  yards_per_carry: number | null;
  success_rate: number | null;
  stuff_rate: number | null;
  explosive_rate: number | null;
}
```

- [ ] **Step 2: Create query file**

Create `lib/data/run-gaps.ts`:

```typescript
import { createServerClient } from "@/lib/supabase/server";
import { parseNumericFields } from "@/lib/utils";
import type { RBGapStat } from "@/lib/types";

const RB_GAP_NUMERIC_FIELDS = [
  "epa_per_carry",
  "yards_per_carry",
  "success_rate",
  "stuff_rate",
  "explosive_rate",
];

export async function getRBGapStats(
  season: number,
  teamId?: string
): Promise<RBGapStat[]> {
  const supabase = createServerClient();

  let query = supabase
    .from("rb_gap_stats")
    .select("*")
    .eq("season", season);

  if (teamId) {
    query = query.eq("team_id", teamId);
  }

  const { data, error } = await query;

  if (error) throw new Error(`Failed to fetch RB gap stats: ${error.message}`);
  if (!data) return [];

  return data.map((row) =>
    parseNumericFields<RBGapStat>(row as RBGapStat, RB_GAP_NUMERIC_FIELDS)
  );
}

export async function getTeamsWithGapData(
  season: number
): Promise<string[]> {
  const supabase = createServerClient();

  const { data, error } = await supabase
    .from("rb_gap_stats")
    .select("team_id")
    .eq("season", season);

  if (error) return [];
  const unique = [...new Set((data || []).map((r: { team_id: string }) => r.team_id))];
  return unique.sort();
}
```

- [ ] **Step 3: Run TypeScript check**

Run: `cd "C:/Users/jonra/OneDrive/Desktop/claude sandbox/football website/yards-per-pass" && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
cd "C:/Users/jonra/OneDrive/Desktop/claude sandbox/football website/yards-per-pass"
git add lib/types/index.ts lib/data/run-gaps.ts
git commit -m "feat: add RBGapStat type and Supabase query functions"
```

---

### Task 6: Page server component + loading/error

**Files:**
- Create: `app/run-gaps/page.tsx`
- Create: `app/run-gaps/loading.tsx`
- Create: `app/run-gaps/error.tsx`

- [ ] **Step 1: Create loading skeleton**

Create `app/run-gaps/loading.tsx`:

```typescript
export default function RunGapsLoading() {
  return (
    <div className="max-w-7xl mx-auto px-6 md:px-12 py-8">
      {/* Title skeleton */}
      <div className="h-8 w-56 bg-gray-200 rounded animate-pulse mb-6" />

      {/* Dropdowns skeleton */}
      <div className="flex gap-4 mb-6">
        <div className="h-10 w-48 bg-gray-200 rounded animate-pulse" />
        <div className="h-10 w-32 bg-gray-200 rounded animate-pulse" />
      </div>

      {/* Diagram skeleton: 5 circles in a row */}
      <div className="bg-gray-50 border border-gray-200 rounded-lg p-8 flex flex-col items-center gap-8">
        <div className="flex gap-8">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="w-12 h-12 rounded-full bg-gray-200 animate-pulse" />
          ))}
        </div>
        <div className="w-12 h-12 rounded-full bg-gray-200 animate-pulse" />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Create error boundary**

Create `app/run-gaps/error.tsx`:

```typescript
"use client";

import { useEffect } from "react";

export default function RunGapsError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Run Gaps error:", error);
  }, [error]);

  return (
    <div className="max-w-7xl mx-auto px-6 md:px-12 py-8">
      <div className="text-center py-16">
        <h2 className="text-xl font-bold text-navy mb-2">Unable to load run gap data</h2>
        <p className="text-sm text-gray-500 mb-4">{error.message}</p>
        <button
          onClick={reset}
          className="px-4 py-2 text-sm font-medium text-white bg-navy rounded-md hover:bg-opacity-90"
        >
          Try again
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Create page server component**

Create `app/run-gaps/page.tsx`:

```typescript
import type { Metadata } from "next";
import dynamic from "next/dynamic";
import { Suspense } from "react";
import { getRBGapStats, getTeamsWithGapData } from "@/lib/data/run-gaps";
import { getAvailableSeasons, getDataFreshness } from "@/lib/data/queries";
import { getTeam } from "@/lib/data/teams";
import DashboardShell from "@/components/layout/DashboardShell";

export const revalidate = 3600;

const RunGapDiagram = dynamic(
  () => import("@/components/charts/RunGapDiagram"),
  {
    ssr: false,
    loading: () => (
      <div className="flex items-center justify-center" style={{ height: 400 }}>
        <div className="w-8 h-8 border-2 border-navy border-t-transparent rounded-full animate-spin" />
      </div>
    ),
  }
);

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<{ season?: string; team?: string }>;
}): Promise<Metadata> {
  const { season, team } = await searchParams;
  const s = season || "2025";
  const teamName = team ? getTeam(team)?.name || team : "NFL";
  return {
    title: `${teamName} Run Gap Analysis ${s} | Yards Per Pass`,
    description: `Rushing EPA broken down by offensive line gap for ${teamName}. See which gaps produce the most efficient runs.`,
  };
}

export default async function RunGapsPage({
  searchParams,
}: {
  searchParams: Promise<{ season?: string; team?: string; gap?: string }>;
}) {
  const { season, team, gap } = await searchParams;
  const seasons = await getAvailableSeasons();
  const parsed = season ? parseInt(season) : NaN;
  const currentSeason = Number.isNaN(parsed) ? (seasons[0] || 2025) : parsed;

  const [gapStats, teams, freshness] = await Promise.all([
    team ? getRBGapStats(currentSeason, team) : Promise.resolve([]),
    getTeamsWithGapData(currentSeason),
    getDataFreshness(currentSeason),
  ]);

  return (
    <DashboardShell
      title="Run Gaps"
      seasons={seasons}
      currentSeason={currentSeason}
      freshness={freshness}
    >
      <RunGapDiagram
        data={gapStats}
        teams={teams}
        selectedTeam={team || null}
        selectedGap={gap || null}
        season={currentSeason}
      />
    </DashboardShell>
  );
}
```

- [ ] **Step 4: Create a minimal RunGapDiagram placeholder**

Create `components/charts/RunGapDiagram.tsx`:

```typescript
"use client";

import type { RBGapStat } from "@/lib/types";

interface RunGapDiagramProps {
  data: RBGapStat[];
  teams: string[];
  selectedTeam: string | null;
  selectedGap: string | null;
  season: number;
}

export default function RunGapDiagram({
  data,
  teams,
  selectedTeam,
  selectedGap,
  season,
}: RunGapDiagramProps) {
  return (
    <div className="text-center py-16 text-gray-400">
      Run Gap Diagram — {data.length} rows loaded for {selectedTeam || "no team"} ({season})
    </div>
  );
}
```

- [ ] **Step 5: Run TypeScript check + dev server**

Run: `cd "C:/Users/jonra/OneDrive/Desktop/claude sandbox/football website/yards-per-pass" && npx tsc --noEmit`
Expected: No errors

Run: `cd "C:/Users/jonra/OneDrive/Desktop/claude sandbox/football website/yards-per-pass" && npx next build`
Expected: Build succeeds

- [ ] **Step 6: Commit**

```bash
cd "C:/Users/jonra/OneDrive/Desktop/claude sandbox/football website/yards-per-pass"
git add app/run-gaps/ components/charts/RunGapDiagram.tsx
git commit -m "feat: add /run-gaps page with server component, loading, and error states"
```

---

### Task 7: Navbar + sitemap + glossary updates

**Files:**
- Modify: `components/layout/Navbar.tsx`
- Modify: `app/sitemap.ts`
- Modify: `app/glossary/page.tsx`

- [ ] **Step 1: Add Run Gaps to Navbar**

In `components/layout/Navbar.tsx`, update `NAV_LINKS`:

```typescript
const NAV_LINKS = [
  { href: "/teams", label: "Team Tiers" },
  { href: "/qb-leaderboard", label: "QB Rankings" },
  { href: "/run-gaps", label: "Run Gaps" },
  { href: "/glossary", label: "Glossary", noSeason: true },
] as const;
```

- [ ] **Step 2: Add /run-gaps to sitemap**

In `app/sitemap.ts`, add entry:

```typescript
{ url: `${base}/run-gaps`, lastModified: new Date(), changeFrequency: "weekly", priority: 0.8 },
```

- [ ] **Step 3: Add glossary terms**

In `app/glossary/page.tsx`, add to the `TERMS` array:

```typescript
  {
    term: "Run Gap",
    definition:
      "The space between offensive linemen where a running back aims to carry the ball. Seven gaps: Left End (LE), Left Tackle (LT), Left Guard (LG), Middle (M), Right Guard (RG), Right Tackle (RT), Right End (RE).",
  },
  {
    term: "Stuff Rate",
    definition:
      "Percentage of rushing attempts stopped at or behind the line of scrimmage (0 or fewer yards gained). Lower is better for the offense.",
  },
  {
    term: "Explosive Run Rate",
    definition:
      "Percentage of rushing attempts that gain 10 or more yards. Higher means more big plays through that gap.",
  },
```

- [ ] **Step 4: Run TypeScript check**

Run: `cd "C:/Users/jonra/OneDrive/Desktop/claude sandbox/football website/yards-per-pass" && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
cd "C:/Users/jonra/OneDrive/Desktop/claude sandbox/football website/yards-per-pass"
git add components/layout/Navbar.tsx app/sitemap.ts app/glossary/page.tsx
git commit -m "feat: add Run Gaps to navbar, sitemap, and glossary"
```

---

### Task 8: Full RunGapDiagram with D3 SVG

**Files:**
- Modify: `components/charts/RunGapDiagram.tsx`

- [ ] **Step 1: Implement the full RunGapDiagram component**

Replace the placeholder `components/charts/RunGapDiagram.tsx` with the full implementation. This is a large component — key sections:

1. **Team selector dropdown** — uses `useRouter`/`usePathname`/`useSearchParams` to update `?team=` URL param
2. **Season passthrough** — reads from props (server already fetched correct season)
3. **Team-level gap aggregation** — computed from player-level data: sum carries, weighted-average stats per gap
4. **League-average computation** — when all teams' data is fetched (for rank display)
5. **Split header** — team logo + name (left), rushing stats + L/R tendency (right)
6. **SVG formation** — 5 OL circles + RB circle + bezier arrows + gap labels + EPA numbers
7. **Hover/focus** — dims non-hovered arrows to 15% opacity
8. **Click handler** — updates `?gap=` URL param, scrolls to PlayerGapCards
9. **Disclaimer footnote**

The component is ~300-400 lines. Key D3 patterns to follow from `TeamScatterPlot.tsx`:
- `useRef<SVGSVGElement>` for SVG element
- `useEffect` with `svg.selectAll("*").remove()` cleanup
- `ResizeObserver` for responsive width (debounced 150ms)
- Return cleanup function for React Strict Mode
- Dynamic import with `ssr: false` (already done in page.tsx)

**SVG structure:**
```
<svg viewBox="0 0 600 400">
  <!-- 5 OL circles at y=100 -->
  <circle cx="100" cy="100" r="24" /> <!-- LT -->
  <circle cx="200" cy="100" r="24" /> <!-- LG -->
  <circle cx="300" cy="100" r="24" /> <!-- C  -->
  <circle cx="400" cy="100" r="24" /> <!-- RG -->
  <circle cx="500" cy="100" r="24" /> <!-- RT -->

  <!-- RB circle at y=280 -->
  <circle cx="300" cy="280" r="22" />

  <!-- Gap labels above OL (clickable) -->
  <text x="40"  y="50">LE</text>  <!-- outside LT -->
  <text x="150" y="50">LT</text>  <!-- between LT-LG -->
  <text x="250" y="50">LG</text>  <!-- between LG-C -->
  <text x="300" y="50">M</text>   <!-- at C -->
  <text x="350" y="50">RG</text>  <!-- between C-RG -->
  <text x="450" y="50">RT</text>  <!-- between RG-RT -->
  <text x="560" y="50">RE</text>  <!-- outside RT -->

  <!-- Bezier arrows from RB(300,280) to each gap target -->
  <path d="M300,258 Q40,180 40,75" />   <!-- LE -->
  <path d="M300,258 Q150,180 150,75" /> <!-- LT -->
  <!-- ... etc -->
</svg>
```

**Arrow styling:**
- Thickness: `strokeWidth = 2 + (carries / maxCarries) * 10` (range 2-12px)
- Color: `epa > 0.02 ? '#16a34a' : epa < -0.02 ? '#dc2626' : '#f59e0b'`
- Fixed opacity: 0.75 (all arrows), dims to 0.15 on non-hovered
- EPA label: `<text>` near arrow endpoint, font-size 11, fill matches arrow color
- **Low-sample treatment (<5 carries):** Thin gray dashed arrow (`strokeWidth: 2`, `stroke: '#9ca3af'`, `strokeDasharray: '4 3'`) with a `<title>` tooltip "Low sample (N carries)". No EPA label shown for low-sample gaps.

**Important:** This task produces the visual centerpiece. The implementer should reference `TeamScatterPlot.tsx` extensively for D3 patterns (ResizeObserver, cleanup, tooltip positioning).

- [ ] **Step 2: Run TypeScript check + build**

Run: `cd "C:/Users/jonra/OneDrive/Desktop/claude sandbox/football website/yards-per-pass" && npx tsc --noEmit && npx next build`
Expected: No errors, build succeeds

- [ ] **Step 3: Manual test in browser**

Run dev server, navigate to `/run-gaps?team=BAL&season=2024`. Verify:
- Team dropdown shows all teams with gap data
- Header shows team name in team colors + rushing stats
- Formation diagram renders with arrows to all 7 gaps
- Arrows have varying thickness and color
- Hover dims other arrows
- EPA labels visible near arrow endpoints
- Gap labels are clickable

- [ ] **Step 4: Commit**

```bash
cd "C:/Users/jonra/OneDrive/Desktop/claude sandbox/football website/yards-per-pass"
git add components/charts/RunGapDiagram.tsx
git commit -m "feat: implement RunGapDiagram with D3 SVG formation and bezier arrows"
```

---

## Chunk 3: Player Drill-Down + Polish

### Task 9: PlayerGapCards component

**Files:**
- Create: `components/charts/PlayerGapCards.tsx`
- Modify: `components/charts/RunGapDiagram.tsx` (integrate cards)

- [ ] **Step 1: Create PlayerGapCards component**

Create `components/charts/PlayerGapCards.tsx`:

Key sections:
1. **Props:** `gap: string`, `stats: RBGapStat[]`, `teamAvgEpa: number`, `leagueRank: number`
2. **Min carry threshold dropdown** (5/10/15/20, default 10) — client-side `useState`
3. **Header bar:** gap name, total carries, aggregate EPA, league rank
4. **Card grid:** 3-col desktop, 1-col mobile
5. **Each card:** player name, carries, EPA divergence bar, 2×2 stat grid
6. **EPA divergence bar:** centered at 0, green extends right for positive, red extends left for negative
7. **Empty state:** "No players meet the minimum carry threshold"
8. **CSV export button:** client-side Blob download

```typescript
"use client";

import { useState } from "react";
import type { RBGapStat } from "@/lib/types";

const GAP_NAMES: Record<string, string> = {
  LE: "Left End",
  LT: "Left Tackle",
  LG: "Left Guard",
  M: "Middle",
  RG: "Right Guard",
  RT: "Right Tackle",
  RE: "Right End",
};

const THRESHOLDS = [5, 10, 15, 20];

interface PlayerGapCardsProps {
  gap: string;
  stats: RBGapStat[];
  teamAvgEpa: number;
  leagueRank: number | null;
}

export default function PlayerGapCards({
  gap,
  stats,
  teamAvgEpa,
  leagueRank,
}: PlayerGapCardsProps) {
  const [minCarries, setMinCarries] = useState(10);

  const filtered = stats
    .filter((s) => s.gap === gap && s.carries >= minCarries)
    .sort((a, b) => b.carries - a.carries);

  const totalCarries = stats
    .filter((s) => s.gap === gap)
    .reduce((sum, s) => sum + s.carries, 0);

  // NaN-safe CSV formatter (parseNumericFields converts null → NaN, not null)
  function csvVal(val: number | null, decimals: number): string {
    return val != null && !isNaN(val) ? val.toFixed(decimals) : "";
  }
  function csvPct(val: number | null): string {
    return val != null && !isNaN(val) ? (val * 100).toFixed(1) : "";
  }

  function exportCSV() {
    const header = "Player,Carries,EPA/Carry,Yds/Carry,Success%,Stuff%,Explosive%\n";
    const rows = filtered
      .map((s) =>
        [
          s.player_name,
          s.carries,
          csvVal(s.epa_per_carry, 3),
          csvVal(s.yards_per_carry, 1),
          csvPct(s.success_rate),
          csvPct(s.stuff_rate),
          csvPct(s.explosive_rate),
        ].join(",")
      )
      .join("\n");
    const blob = new Blob([header + rows], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${gap}_gap_stats.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // Helper for NaN-safe formatting (parseNumericFields converts null → NaN)
  function fmt(val: number | null, decimals: number): string {
    return val != null && !isNaN(val) ? val.toFixed(decimals) : "—";
  }
  function fmtPct(val: number | null): string {
    return val != null && !isNaN(val) ? `${(val * 100).toFixed(1)}%` : "—";
  }

  // ... render header bar, threshold dropdown, card grid, empty state, export button
  // Use fmt() and fmtPct() for all stat display (handles NaN from parseNumericFields)
  // EPA divergence bar: width% = Math.min(Math.abs(epa - teamAvgEpa) / 0.3 * 50, 50)
  // Direction: epa > teamAvgEpa → extends right (green), else left (red)
}
```

- [ ] **Step 2: Integrate into RunGapDiagram**

In `RunGapDiagram.tsx`, import `PlayerGapCards` and render below the SVG when a gap is selected:

```typescript
import PlayerGapCards from "./PlayerGapCards";

// In the return JSX, after the SVG:
{selectedGap && (
  <div id="player-drilldown" className="mt-6">
    <PlayerGapCards
      gap={selectedGap}
      stats={data}
      teamAvgEpa={gapAggregates[selectedGap]?.epa_per_carry ?? 0}
      leagueRank={null} // Added in next task
    />
  </div>
)}
```

- [ ] **Step 3: Run TypeScript check + build**

Run: `cd "C:/Users/jonra/OneDrive/Desktop/claude sandbox/football website/yards-per-pass" && npx tsc --noEmit && npx next build`
Expected: No errors

- [ ] **Step 4: Manual test**

Navigate to `/run-gaps?team=BAL&season=2024&gap=LG`. Verify:
- Player cards appear below diagram
- Cards show name, carries, EPA divergence bar, stat grid
- Min carry threshold dropdown filters cards
- CSV export downloads file
- Empty state shows when threshold is too high

- [ ] **Step 5: Commit**

```bash
cd "C:/Users/jonra/OneDrive/Desktop/claude sandbox/football website/yards-per-pass"
git add components/charts/PlayerGapCards.tsx components/charts/RunGapDiagram.tsx
git commit -m "feat: add PlayerGapCards drill-down with EPA divergence bars and CSV export"
```

---

### Task 10: League-average baselines + rank

**Files:**
- Modify: `lib/data/run-gaps.ts`
- Modify: `app/run-gaps/page.tsx`
- Modify: `components/charts/RunGapDiagram.tsx`

- [ ] **Step 1: Add league-wide query function**

Add to `lib/data/run-gaps.ts`:

```typescript
export interface GapLeagueAvg {
  gap: string;
  avg_epa: number;
  avg_yards: number;
  avg_success: number;
  avg_stuff: number;
  avg_explosive: number;
}

export async function getLeagueGapAverages(
  season: number
): Promise<GapLeagueAvg[]> {
  const supabase = createServerClient();

  // Get all teams' gap stats, then compute league averages per gap
  const { data, error } = await supabase
    .from("rb_gap_stats")
    .select("team_id, gap, carries, epa_per_carry, yards_per_carry, success_rate, stuff_rate, explosive_rate")
    .eq("season", season);

  if (error || !data) return [];

  // Aggregate by gap across all teams (carry-weighted averages)
  const gapMap = new Map<string, { totalCarries: number; weightedEpa: number; weightedYards: number; weightedSuccess: number; weightedStuff: number; weightedExplosive: number }>();

  for (const row of data) {
    const carries = row.carries as number;
    const g = row.gap as string;
    const prev = gapMap.get(g) || { totalCarries: 0, weightedEpa: 0, weightedYards: 0, weightedSuccess: 0, weightedStuff: 0, weightedExplosive: 0 };
    prev.totalCarries += carries;
    prev.weightedEpa += carries * (parseFloat(row.epa_per_carry as string) || 0);
    prev.weightedYards += carries * (parseFloat(row.yards_per_carry as string) || 0);
    prev.weightedSuccess += carries * (parseFloat(row.success_rate as string) || 0);
    prev.weightedStuff += carries * (parseFloat(row.stuff_rate as string) || 0);
    prev.weightedExplosive += carries * (parseFloat(row.explosive_rate as string) || 0);
    gapMap.set(g, prev);
  }

  return Array.from(gapMap.entries()).map(([gap, v]) => ({
    gap,
    avg_epa: v.totalCarries > 0 ? v.weightedEpa / v.totalCarries : 0,
    avg_yards: v.totalCarries > 0 ? v.weightedYards / v.totalCarries : 0,
    avg_success: v.totalCarries > 0 ? v.weightedSuccess / v.totalCarries : 0,
    avg_stuff: v.totalCarries > 0 ? v.weightedStuff / v.totalCarries : 0,
    avg_explosive: v.totalCarries > 0 ? v.weightedExplosive / v.totalCarries : 0,
  }));
}
```

- [ ] **Step 2: Pass league averages to diagram**

In `app/run-gaps/page.tsx`, add to `Promise.all`:

```typescript
const [gapStats, teams, freshness, leagueAvgs] = await Promise.all([
  team ? getRBGapStats(currentSeason, team) : Promise.resolve([]),
  getTeamsWithGapData(currentSeason),
  getDataFreshness(currentSeason),
  getLeagueGapAverages(currentSeason),
]);
```

Pass `leagueAvgs` as prop to `RunGapDiagram`.

- [ ] **Step 3: Display league avg + rank in diagram and cards**

In `RunGapDiagram.tsx`, compute per-gap rank by comparing team EPA to all teams. Display "Rank Nth" next to gap labels and pass `leagueRank` to `PlayerGapCards`.

- [ ] **Step 4: Run TypeScript check + build**

Run: `cd "C:/Users/jonra/OneDrive/Desktop/claude sandbox/football website/yards-per-pass" && npx tsc --noEmit && npx next build`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
cd "C:/Users/jonra/OneDrive/Desktop/claude sandbox/football website/yards-per-pass"
git add lib/data/run-gaps.ts app/run-gaps/page.tsx components/charts/RunGapDiagram.tsx components/charts/PlayerGapCards.tsx
git commit -m "feat: add league-average baselines and per-gap rank indicators"
```

---

### Task 11: Data disclaimer + left/right tendency

**Files:**
- Modify: `components/charts/RunGapDiagram.tsx`

- [ ] **Step 1: Add L/R tendency to header**

In the split header area, compute from gap data:

```typescript
const leftCarries = ['LE', 'LT', 'LG'].reduce((sum, g) => sum + (gapAggregates[g]?.carries ?? 0), 0);
const rightCarries = ['RG', 'RT', 'RE'].reduce((sum, g) => sum + (gapAggregates[g]?.carries ?? 0), 0);
const middleCarries = gapAggregates['M']?.carries ?? 0;
const total = leftCarries + rightCarries + middleCarries;
const leftPct = total > 0 ? Math.round((leftCarries / total) * 100) : 0;
const rightPct = total > 0 ? Math.round((rightCarries / total) * 100) : 0;
```

Display: `Left ${leftPct}% | Middle ${100 - leftPct - rightPct}% | Right ${rightPct}%`

- [ ] **Step 2: Add disclaimer footnote**

At the bottom of the component return JSX:

```typescript
<p className="mt-8 text-xs text-gray-400 border-t border-gray-100 pt-4">
  Gap data reflects ball carrier destination, not designed play direction.
  Source:{" "}
  <a href="https://github.com/nflverse" target="_blank" rel="noopener noreferrer" className="underline hover:text-navy">
    nflverse
  </a>{" "}
  play-by-play (~85-90% of rush plays have gap data). Stats may differ from
  PFF/TruMedia due to methodology differences.
</p>
```

- [ ] **Step 3: Run TypeScript check**

Run: `cd "C:/Users/jonra/OneDrive/Desktop/claude sandbox/football website/yards-per-pass" && npx tsc --noEmit`

- [ ] **Step 4: Commit**

```bash
cd "C:/Users/jonra/OneDrive/Desktop/claude sandbox/football website/yards-per-pass"
git add components/charts/RunGapDiagram.tsx
git commit -m "feat: add L/R tendency split and data disclaimer to run gaps page"
```

---

## Chunk 4: Mobile Responsive

### Task 12: GapBarChart mobile component

**Files:**
- Create: `components/charts/GapBarChart.tsx`
- Modify: `components/charts/RunGapDiagram.tsx`

- [ ] **Step 1: Create GapBarChart**

Create `components/charts/GapBarChart.tsx` — a simple horizontal bar chart (no D3 needed, pure Tailwind divs):

```typescript
"use client";

interface GapData {
  gap: string;
  carries: number;
  epa_per_carry: number;
}

interface GapBarChartProps {
  gaps: GapData[];
  maxCarries: number;
  onGapClick: (gap: string) => void;
  selectedGap: string | null;
}

const GAP_ORDER = ['LE', 'LT', 'LG', 'M', 'RG', 'RT', 'RE'];

export default function GapBarChart({ gaps, maxCarries, onGapClick, selectedGap }: GapBarChartProps) {
  const sorted = GAP_ORDER.map((g) => gaps.find((d) => d.gap === g)).filter(Boolean) as GapData[];

  return (
    <div className="space-y-2">
      {sorted.map((g) => {
        const widthPct = maxCarries > 0 ? (g.carries / maxCarries) * 100 : 0;
        const color = isNaN(g.epa_per_carry) ? '#9ca3af' : g.epa_per_carry > 0.02 ? '#16a34a' : g.epa_per_carry < -0.02 ? '#dc2626' : '#f59e0b';
        const isSelected = selectedGap === g.gap;

        return (
          <button
            key={g.gap}
            onClick={() => onGapClick(g.gap)}
            className={`w-full flex items-center gap-3 p-2 rounded-md text-left transition-colors ${
              isSelected ? 'bg-blue-50 ring-1 ring-navy' : 'hover:bg-gray-50'
            }`}
          >
            <span className="w-8 text-xs font-bold text-navy">{g.gap}</span>
            <div className="flex-1 h-6 bg-gray-100 rounded overflow-hidden">
              <div
                className="h-full rounded"
                style={{ width: `${widthPct}%`, backgroundColor: color }}
              />
            </div>
            <span className="w-16 text-right text-xs text-gray-500">{g.carries} car</span>
            <span
              className="w-14 text-right text-xs font-semibold"
              style={{ color }}
            >
              {isNaN(g.epa_per_carry) ? '—' : `${g.epa_per_carry > 0 ? '+' : ''}${g.epa_per_carry.toFixed(2)}`}
            </span>
          </button>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 2: Add mobile toggle to RunGapDiagram**

In `RunGapDiagram.tsx`, import `GapBarChart` and add the desktop/mobile toggle:

```typescript
{/* Desktop: SVG formation */}
<div className="hidden md:block">
  <svg ref={svgRef} ... />
</div>

{/* Mobile: bar chart */}
<div className="md:hidden">
  <GapBarChart
    gaps={gapAggregatesList}
    maxCarries={maxGapCarries}
    onGapClick={handleGapClick}
    selectedGap={selectedGap}
  />
</div>
```

- [ ] **Step 3: Run TypeScript check + build**

Run: `cd "C:/Users/jonra/OneDrive/Desktop/claude sandbox/football website/yards-per-pass" && npx tsc --noEmit && npx next build`

- [ ] **Step 4: Test at 375px viewport width**

Open browser DevTools, set viewport to 375px. Verify:
- Bar chart shows instead of formation diagram
- Bars are tappable, drill-down cards appear
- Cards stack to 1 column
- Dropdowns stack vertically

- [ ] **Step 5: Commit**

```bash
cd "C:/Users/jonra/OneDrive/Desktop/claude sandbox/football website/yards-per-pass"
git add components/charts/GapBarChart.tsx components/charts/RunGapDiagram.tsx
git commit -m "feat: add GapBarChart mobile alternative for run gaps page"
```

---

## Chunk 5: v2 Weekly Data Pipeline

### Task 13: aggregate_rb_gap_stats_weekly() + tests

**Files:**
- Modify: `tests/test_gap_stats.py`
- Modify: `scripts/ingest.py`

- [ ] **Step 1: Write failing tests**

Append to `tests/test_gap_stats.py`:

```python
class TestAggregateRBGapStatsWeekly:
    """Test weekly gap stats aggregation with situation/field_zone splits."""

    def _make_plays(self):
        return pd.DataFrame({
            'rush_attempt': [1, 1, 1, 1],
            'qb_scramble': [0, 0, 0, 0],
            'play_type': ['run', 'run', 'run', 'run'],
            'run_location': ['left', 'left', 'left', 'right'],
            'run_gap': ['guard', 'guard', 'guard', 'end'],
            'rusher_player_id': ['RB1', 'RB1', 'RB1', 'RB1'],
            'rusher_player_name': ['J.Smith', 'J.Smith', 'J.Smith', 'J.Smith'],
            'posteam': ['BAL', 'BAL', 'BAL', 'BAL'],
            'epa': [0.5, -0.2, 0.3, 0.1],
            'success': [1, 0, 1, 1],
            'yards_gained': [5, -1, 8, 3],
            'season': [2024, 2024, 2024, 2024],
            'week': [1, 1, 2, 2],
            'down': [1, 2, 1, 3],
            'ydstogo': [10, 7, 10, 1],
            'yardline_100': [45, 38, 15, 3],
        })

    def test_weekly_rows(self):
        from ingest import aggregate_rb_gap_stats_weekly
        plays = self._make_plays()
        result = aggregate_rb_gap_stats_weekly(plays, 2024)
        # RB1 has LG in week 1 (2 carries) and week 2 (1 carry), RE in week 2 (1 carry)
        # With situation='all' and field_zone='all': 3 rows
        all_rows = result[(result['situation'] == 'all') & (result['field_zone'] == 'all')]
        assert len(all_rows) == 3

    def test_situation_early_downs(self):
        from ingest import aggregate_rb_gap_stats_weekly
        plays = self._make_plays()
        result = aggregate_rb_gap_stats_weekly(plays, 2024)
        early = result[result['situation'] == 'early']
        # Plays with down in [1, 2]: all 4 plays except the down=3 one
        assert len(early) > 0

    def test_field_zone_redzone(self):
        from ingest import aggregate_rb_gap_stats_weekly
        plays = self._make_plays()
        result = aggregate_rb_gap_stats_weekly(plays, 2024)
        rz = result[result['field_zone'] == 'redzone']
        # yardline_100 <= 20: rows with yardline 15 and 3
        assert len(rz) > 0

    def test_output_has_week_column(self):
        from ingest import aggregate_rb_gap_stats_weekly
        plays = self._make_plays()
        result = aggregate_rb_gap_stats_weekly(plays, 2024)
        assert 'week' in result.columns
        assert 'situation' in result.columns
        assert 'field_zone' in result.columns
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd "C:/Users/jonra/OneDrive/Desktop/claude sandbox/football website/yards-per-pass" && python -m pytest tests/test_gap_stats.py::TestAggregateRBGapStatsWeekly -v`
Expected: FAIL

- [ ] **Step 3: Implement aggregate_rb_gap_stats_weekly()**

Add to `scripts/ingest.py`:

```python
SITUATIONS = {
    'all': lambda df: df,
    'early': lambda df: df[df['down'].isin([1, 2])],
    'short_yardage': lambda df: df[(df['down'].isin([3, 4])) & (df['ydstogo'] <= 2)],
    'passing': lambda df: df[
        ((df['down'] == 2) & (df['ydstogo'] >= 7)) |
        ((df['down'] == 3) & (df['ydstogo'] >= 5))
    ],
}

FIELD_ZONES = {
    'all': lambda df: df,
    'redzone': lambda df: df[df['yardline_100'] <= 20],
    'goalline': lambda df: df[df['yardline_100'] <= 5],
}


def aggregate_rb_gap_stats_weekly(plays: pd.DataFrame, season: int) -> pd.DataFrame:
    """Aggregate rushing stats by player × team × gap × week × situation × field_zone."""
    # Same gap mapping and filtering as aggregate_rb_gap_stats
    for col in ('run_location', 'run_gap', 'week', 'down', 'ydstogo', 'yardline_100'):
        if col not in plays.columns:
            log.warning("Column '%s' not found — skipping weekly gap stats", col)
            return pd.DataFrame()

    rushes = plays[
        (plays['rush_attempt'] == 1) &
        (plays['qb_scramble'] != 1)
    ].copy()

    rushes['gap'] = rushes.apply(
        lambda r: map_run_gap(
            r['run_location'] if pd.notna(r['run_location']) else None,
            r['run_gap'] if pd.notna(r['run_gap']) else None,
        ),
        axis=1,
    )
    rushes = rushes[rushes['gap'].notna()]

    if rushes.empty:
        return pd.DataFrame()

    all_results = []
    for sit_name, sit_filter in SITUATIONS.items():
        for fz_name, fz_filter in FIELD_ZONES.items():
            subset = fz_filter(sit_filter(rushes))
            if subset.empty:
                continue

            grouped = subset.groupby(
                ['rusher_player_id', 'rusher_player_name', 'posteam', 'week', 'gap']
            ).agg(
                carries=('epa', 'count'),
                epa_per_carry=('epa', 'mean'),
                yards_per_carry=('yards_gained', 'mean'),
                success_rate=('success', 'mean'),
                stuff_rate=('yards_gained', lambda x: (x <= 0).mean()),
                explosive_rate=('yards_gained', lambda x: (x >= 10).mean()),
            ).reset_index()

            grouped['situation'] = sit_name
            grouped['field_zone'] = fz_name
            grouped['season'] = season
            grouped = grouped.rename(columns={
                'rusher_player_id': 'player_id',
                'rusher_player_name': 'player_name',
                'posteam': 'team_id',
            })
            all_results.append(grouped)

    if not all_results:
        return pd.DataFrame()

    return pd.concat(all_results, ignore_index=True)
```

- [ ] **Step 4: Run tests**

Run: `cd "C:/Users/jonra/OneDrive/Desktop/claude sandbox/football website/yards-per-pass" && python -m pytest tests/test_gap_stats.py -v`
Expected: All tests PASS

- [ ] **Step 5: Add upsert + table creation for weekly stats**

Follow the same `upsert_rb_gap_stats()` pattern. Table: `rb_gap_stats_weekly` with UUID PK, UNIQUE constraint on `(player_id, team_id, season, week, gap, situation, field_zone)`.

- [ ] **Step 6: Wire into process_season() and cleanup_stale_rows()**

- [ ] **Step 7: Run ingest dry-run, then real ingest**

- [ ] **Step 8: Commit**

```bash
cd "C:/Users/jonra/OneDrive/Desktop/claude sandbox/football website/yards-per-pass"
git add scripts/ingest.py tests/test_gap_stats.py
git commit -m "feat: add weekly gap stats pipeline with situation and field zone splits"
```

---

## Chunk 6: Recent Form + Filters

### Task 14: Recent form toggle UI

**Files:**
- Modify: `lib/data/run-gaps.ts`
- Modify: `lib/types/index.ts`
- Modify: `app/run-gaps/page.tsx`
- Modify: `components/charts/RunGapDiagram.tsx`

- [ ] **Step 1: Add RBGapStatWeekly type**

Add to `lib/types/index.ts`:

```typescript
export interface RBGapStatWeekly extends RBGapStat {
  week: number;
  situation: string;
  field_zone: string;
}
```

- [ ] **Step 2: Add weekly query function**

Add to `lib/data/run-gaps.ts`:

```typescript
export async function getRBGapStatsWeekly(
  season: number,
  teamId: string,
  situation: string = "all",
  fieldZone: string = "all"
): Promise<RBGapStatWeekly[]> {
  const supabase = createServerClient();
  const { data, error } = await supabase
    .from("rb_gap_stats_weekly")
    .select("*")
    .eq("season", season)
    .eq("team_id", teamId)
    .eq("situation", situation)
    .eq("field_zone", fieldZone);

  if (error) throw new Error(`Failed to fetch weekly gap stats: ${error.message}`);
  if (!data) return [];

  return data.map((row) =>
    parseNumericFields<RBGapStatWeekly>(row as RBGapStatWeekly, RB_GAP_NUMERIC_FIELDS)
  );
}
```

- [ ] **Step 3: Add form/filter controls to RunGapDiagram**

Add toggles above the diagram:
- "Full Season" / "Last 4 Weeks" toggle
- "All Downs" / "Early Downs" / "Short Yardage" / "Passing Downs" dropdown
- "All Field" / "Red Zone" / "Goal Line" dropdown

These update URL params: `?form=recent&situation=early&zone=redzone`

When "Last 4 Weeks" is selected, fetch weekly data, filter to latest 4 weeks, and re-aggregate client-side.

- [ ] **Step 4: Add sample size warnings**

When a gap × situation combination has <5 carries, show an amber warning icon next to the gap label.

- [ ] **Step 5: Run TypeScript check + build + manual test**

- [ ] **Step 6: Commit**

```bash
cd "C:/Users/jonra/OneDrive/Desktop/claude sandbox/football website/yards-per-pass"
git add lib/types/index.ts lib/data/run-gaps.ts app/run-gaps/page.tsx components/charts/RunGapDiagram.tsx
git commit -m "feat: add recent form toggle, down/distance filter, and red zone filter"
```

---

## Chunk 7: Defensive Matchup Layer

### Task 15: Defensive gap stats pipeline

**Files:**
- Modify: `tests/test_gap_stats.py`
- Modify: `scripts/ingest.py`

- [ ] **Step 1: Write failing tests for aggregate_def_gap_stats()**

```python
class TestAggregateDefGapStats:
    def _make_plays(self):
        return pd.DataFrame({
            'rush_attempt': [1, 1, 1],
            'qb_scramble': [0, 0, 0],
            'play_type': ['run', 'run', 'run'],
            'run_location': ['left', 'left', 'right'],
            'run_gap': ['guard', 'guard', 'end'],
            'defteam': ['KC', 'KC', 'KC'],
            'epa': [0.5, -0.2, 0.3],
            'success': [1, 0, 1],
            'yards_gained': [5, -1, 8],
            'season': [2024, 2024, 2024],
        })

    def test_groups_by_defteam(self):
        from ingest import aggregate_def_gap_stats
        plays = self._make_plays()
        result = aggregate_def_gap_stats(plays, 2024)
        assert all(result['team_id'] == 'KC')

    def test_correct_gap_assignment(self):
        from ingest import aggregate_def_gap_stats
        plays = self._make_plays()
        result = aggregate_def_gap_stats(plays, 2024)
        lg = result[result['gap'] == 'LG']
        assert lg.iloc[0]['carries_faced'] == 2
```

- [ ] **Step 2: Implement aggregate_def_gap_stats()**

Same pattern as `aggregate_rb_gap_stats()` but groupby `defteam` instead of `rusher_player_id`. Output columns: `team_id, season, gap, carries_faced, def_epa_per_carry, def_yards_per_carry, def_success_rate, def_stuff_rate, def_explosive_rate`.

- [ ] **Step 3: Add upsert + table creation + cleanup**

- [ ] **Step 4: Wire into process_season()**

- [ ] **Step 5: Run all tests + ingest**

- [ ] **Step 6: Commit**

```bash
git commit -m "feat: add defensive gap stats pipeline"
```

---

### Task 16: Defensive matchup UI

**Files:**
- Modify: `lib/types/index.ts`
- Modify: `lib/data/run-gaps.ts`
- Modify: `app/run-gaps/page.tsx`
- Modify: `components/charts/RunGapDiagram.tsx`

- [ ] **Step 1: Add DefGapStat type + query**

- [ ] **Step 2: Add opponent dropdown to RunGapDiagram**

When an opponent is selected, fetch their `def_gap_stats` and display alongside the offensive data:
- Split arrows or dual indicators per gap
- Green highlight on gaps where offense EPA > 0 AND defense allows EPA > 0 (mismatch)
- Header summary: "Offense runs +0.08 EPA at LG, opponent allows +0.05 EPA there"

- [ ] **Step 3: Run TypeScript check + build + manual test**

- [ ] **Step 4: Commit**

```bash
git commit -m "feat: add defensive matchup overlay with opponent dropdown"
```

---

## Chunk 8: League Heatmap

### Task 17: GapHeatmap component

**Files:**
- Create: `components/charts/GapHeatmap.tsx`
- Modify: `components/charts/RunGapDiagram.tsx`

- [ ] **Step 1: Create GapHeatmap**

32-team × 7-gap matrix. Each cell colored by EPA (green/red diverging scale). Columns are sortable. Click a team row to set `?team=` and navigate to the formation diagram.

Shows when no team is selected (`/run-gaps` with no `?team=` param).

```typescript
"use client";

// Pure Tailwind grid — no D3 needed for the matrix
// Use existing team colors from lib/data/teams.ts
// Color scale: diverging green-white-red centered at 0
```

- [ ] **Step 2: Integrate into RunGapDiagram (or page.tsx)**

When `selectedTeam` is null, show the heatmap as the landing view instead of the formation diagram.

- [ ] **Step 3: Run TypeScript check + build**

- [ ] **Step 4: Manual test**

Navigate to `/run-gaps` (no team param). Verify:
- 32-team heatmap renders
- Cells colored by EPA
- Columns sortable
- Click team row navigates to formation view

- [ ] **Step 5: Commit**

```bash
git commit -m "feat: add league-wide gap heatmap as run gaps landing page"
```

---

## Final Steps

### Task 18: End-to-end verification

- [ ] **Step 1: Run all Python tests**

Run: `cd "C:/Users/jonra/OneDrive/Desktop/claude sandbox/football website/yards-per-pass" && python -m pytest tests/ -v`
Expected: All tests PASS

- [ ] **Step 2: Run TypeScript check**

Run: `cd "C:/Users/jonra/OneDrive/Desktop/claude sandbox/football website/yards-per-pass" && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Run production build**

Run: `cd "C:/Users/jonra/OneDrive/Desktop/claude sandbox/football website/yards-per-pass" && npx next build`
Expected: Build succeeds

- [ ] **Step 4: Full manual test flow**

1. Navigate to `/run-gaps` — heatmap shows
2. Click a team → formation diagram with arrows
3. Hover gaps → arrow isolation
4. Click a gap → player cards expand
5. Change min carry threshold → cards filter
6. Export CSV → file downloads
7. Toggle "Last 4 Weeks" → data updates
8. Select opponent → matchup overlay shows
9. Change situation/field zone filters → data updates with sample size warnings
10. Test on mobile viewport → bar chart shows
11. Navigate via navbar → season param carries over

- [ ] **Step 5: Push to remote**

```bash
cd "C:/Users/jonra/OneDrive/Desktop/claude sandbox/football website/yards-per-pass"
git push origin master
```
