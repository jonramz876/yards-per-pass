# Phase 1: Data Foundation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create the data layer for player profile pages, team hub pages, and game logs — 4 new Supabase tables, pipeline updates, TypeScript types, and query functions.

**Architecture:** Extend `scripts/ingest.py` to generate player slugs and weekly stat aggregations alongside existing season-level stats. Add new query functions in `lib/data/`. No frontend changes in this phase — all backend/data only.

**Tech Stack:** Python (pandas), PostgreSQL (Supabase), TypeScript, Next.js 14

**Spec:** `docs/superpowers/specs/2026-03-21-player-team-pages-design.md`

---

## File Map

### New Files
| File | Responsibility |
|------|---------------|
| `lib/data/players.ts` | Player slug lookups, per-player stat queries, weekly game log queries |
| `lib/data/utils.ts` | Shared `fetchAllRows()` pagination utility (extracted from run-gaps.ts) |

### Modified Files
| File | Changes |
|------|---------|
| `scripts/ingest.py` | Add `REQUIRED_PBP_COLS` entries, slug generation, 4 `ensure_*` functions, 4 `upsert_*` functions, 3 weekly aggregation functions, takeaways in team stats, `cleanup_stale_rows` extension, `process_season` updates |
| `lib/types/index.ts` | Add `PlayerSlug`, `QBWeeklyStat`, `ReceiverWeeklyStat`, `RBWeeklyStat` interfaces |
| `lib/data/run-gaps.ts` | Remove `fetchAllRows()` (moved to utils.ts), import from utils |
| `app/api/revalidate/route.ts` | Add `/player` and `/team` revalidation paths |
| `tests/test_receiver_stats.py` | No changes — existing tests continue to pass |

### New Test Files
| File | Tests |
|------|-------|
| `tests/test_slugs.py` | Slug generation, collision handling, immutability |
| `tests/test_weekly_stats.py` | QB/WR/RB weekly aggregation, game context derivation |

---

### Task 1: Add PBP columns and slug generation utility

**Files:**
- Modify: `scripts/ingest.py:73-84` (REQUIRED_PBP_COLS)
- Modify: `scripts/ingest.py` (add make_slug function near top)

- [ ] **Step 1: Add new PBP columns to REQUIRED_PBP_COLS**

In `scripts/ingest.py`, add to the `REQUIRED_PBP_COLS` list (line 73-84):
```python
    'total_home_score', 'total_away_score',
    'run_location', 'run_gap',
```
(`run_location` and `run_gap` are already used by gap mapping but may not be in the required list — verify.)

- [ ] **Step 2: Add slug generation function**

Add after the `passer_rating()` function (~line 115):
```python
import re

def make_slug(name: str) -> str:
    """Convert 'Patrick Mahomes' to 'patrick-mahomes'."""
    slug = name.lower().strip()
    slug = re.sub(r"[^a-z0-9\s-]", "", slug)  # drop apostrophes, periods, Jr./Sr.
    slug = re.sub(r"\s+", "-", slug)
    slug = re.sub(r"-+", "-", slug)  # collapse multiple hyphens
    return slug.strip("-")
```

- [ ] **Step 3: Commit**

```bash
git add scripts/ingest.py
git commit -m "feat: add PBP score columns and slug generation utility"
```

---

### Task 2: Write slug tests

**Files:**
- Create: `tests/test_slugs.py`

- [ ] **Step 1: Write slug generation tests**

```python
"""Tests for player slug generation and collision handling."""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'scripts'))


class TestMakeSlug:
    def test_basic_name(self):
        from ingest import make_slug
        assert make_slug("Patrick Mahomes") == "patrick-mahomes"

    def test_apostrophe(self):
        from ingest import make_slug
        assert make_slug("Ja'Marr Chase") == "jamarr-chase"

    def test_period(self):
        from ingest import make_slug
        assert make_slug("T.J. Watt") == "tj-watt"

    def test_suffix(self):
        from ingest import make_slug
        assert make_slug("Marvin Harrison Jr.") == "marvin-harrison-jr"

    def test_hyphenated_name(self):
        from ingest import make_slug
        assert make_slug("Amon-Ra St. Brown") == "amon-ra-st-brown"

    def test_extra_spaces(self):
        from ingest import make_slug
        assert make_slug("  Josh   Allen  ") == "josh-allen"
```

- [ ] **Step 2: Run tests**

Run: `cd "C:\Users\jonra\OneDrive\Desktop\claude sandbox\football website\yards-per-pass" && python -m pytest tests/test_slugs.py -v`
Expected: All 6 tests PASS

- [ ] **Step 3: Commit**

```bash
git add tests/test_slugs.py
git commit -m "test: add slug generation tests"
```

---

### Task 3: Player slugs table — ensure + upsert + generate

**Files:**
- Modify: `scripts/ingest.py` (add ensure_player_slugs_table, generate_player_slugs, upsert_player_slugs)

- [ ] **Step 1: Add ensure_player_slugs_table function**

Add after `ensure_receiver_stats_table()` (~line 1107):
```python
def ensure_player_slugs_table(conn):
    """Create player_slugs table if it doesn't exist. NOT @retry."""
    with conn.cursor() as cur:
        cur.execute("""
            CREATE TABLE IF NOT EXISTS player_slugs (
                player_id TEXT PRIMARY KEY,
                slug TEXT NOT NULL UNIQUE,
                player_name TEXT NOT NULL,
                position TEXT,
                current_team_id TEXT REFERENCES teams(id),
                created_at TIMESTAMPTZ DEFAULT NOW(),
                updated_at TIMESTAMPTZ DEFAULT NOW()
            );
            CREATE INDEX IF NOT EXISTS idx_player_slugs_slug ON player_slugs(slug);
            CREATE INDEX IF NOT EXISTS idx_player_slugs_team ON player_slugs(current_team_id);
        """)
        cur.execute("""
            DO $$ BEGIN
                ALTER TABLE player_slugs ENABLE ROW LEVEL SECURITY;
            EXCEPTION WHEN others THEN NULL;
            END $$;
        """)
        cur.execute("""
            DO $$ BEGIN
                CREATE POLICY "public_read" ON player_slugs FOR SELECT USING (true);
            EXCEPTION WHEN duplicate_object THEN NULL;
            END $$;
        """)
    conn.commit()
    log.info("Ensured player_slugs table exists")
```

- [ ] **Step 2: Add generate_player_slugs function**

```python
def generate_player_slugs(qb_stats, receiver_stats, rb_gap_stats, roster, conn):
    """Generate slugs for all players. Immutable — existing slugs never change."""
    import pandas as pd

    # Collect all unique players across tables
    players = {}
    for df, pos_default in [(qb_stats, 'QB'), (receiver_stats, None), (rb_gap_stats, 'RB')]:
        if df is None or df.empty:
            continue
        for _, row in df.iterrows():
            pid = row['player_id']
            if pid not in players:
                players[pid] = {
                    'player_id': pid,
                    'player_name': row['player_name'],
                    'team_id': row.get('team_id') or row.get('team', ''),
                    'position': row.get('position', pos_default),
                }

    # Position lookup from roster
    pos_lookup = roster.groupby('gsis_id')['position'].agg(
        lambda x: x.mode().iloc[0] if len(x.mode()) > 0 else None
    ).to_dict()
    for pid, info in players.items():
        if not info['position']:
            info['position'] = pos_lookup.get(pid, 'WR')

    # Load existing slugs (immutable — never change once assigned)
    existing = {}
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT player_id, slug FROM player_slugs")
            existing = {row[0]: row[1] for row in cur.fetchall()}
    except Exception:
        pass  # table may not exist yet on first run

    # Generate slugs for NEW players only
    slug_counts = {}  # track slug usage for collision detection
    for slug in existing.values():
        base = slug.rsplit('-', 1)[0] if slug.count('-') > 1 else slug
        slug_counts[make_slug(slug)] = slug_counts.get(make_slug(slug), 0) + 1

    results = []
    for pid, info in players.items():
        if pid in existing:
            # Keep existing slug (immutability rule)
            results.append({**info, 'slug': existing[pid]})
            continue

        base_slug = make_slug(info['player_name'])

        # Check for collision with existing or other new slugs
        collision = base_slug in [s for s in existing.values()] or base_slug in [r['slug'] for r in results]
        if collision:
            # Append team abbreviation
            team = info['team_id'].lower() if info['team_id'] else 'nfl'
            slug = f"{base_slug}-{team}"
        else:
            slug = base_slug

        results.append({**info, 'slug': slug})

    return pd.DataFrame(results)
```

- [ ] **Step 3: Add upsert_player_slugs function**

```python
@retry(max_retries=2, delay=3)
def upsert_player_slugs(conn, df):
    """Upsert player slugs. Slug is immutable — only player_name, position, current_team_id update."""
    if df.empty:
        return
    cols = ['player_id', 'slug', 'player_name', 'position', 'current_team_id']
    # Ensure columns exist
    for c in cols:
        if c not in df.columns:
            if c == 'current_team_id':
                df[c] = df.get('team_id', None)
            else:
                df[c] = None
    clean_df = df[cols].where(df[cols].notna(), None)
    rows = [tuple(r) for _, r in clean_df.iterrows()]
    col_names = ', '.join(cols)
    # On conflict: update name/position/team but NEVER update slug
    update_set = "player_name = EXCLUDED.player_name, position = EXCLUDED.position, current_team_id = EXCLUDED.current_team_id, updated_at = NOW()"

    with conn.cursor() as cur:
        execute_values(
            cur,
            f"INSERT INTO player_slugs ({col_names}) VALUES %s ON CONFLICT (player_id) DO UPDATE SET {update_set}",
            rows,
        )
    log.info("Upserted %d player slugs", len(rows))
```

- [ ] **Step 4: Write slug collision + immutability tests**

Add to `tests/test_slugs.py`:
```python
import pandas as pd


class TestGeneratePlayerSlugs:
    def test_generates_slug_for_new_player(self):
        from ingest import generate_player_slugs
        qb = pd.DataFrame([{'player_id': 'QB1', 'player_name': 'Patrick Mahomes', 'team_id': 'KC', 'team': 'KC'}])
        roster = pd.DataFrame([{'gsis_id': 'QB1', 'position': 'QB'}])
        # Mock conn that returns empty existing slugs
        class MockConn:
            def cursor(self):
                return self
            def __enter__(self):
                return self
            def __exit__(self, *a):
                pass
            def execute(self, *a):
                pass
            def fetchall(self):
                return []
        result = generate_player_slugs(qb, pd.DataFrame(), pd.DataFrame(), roster, MockConn())
        assert result.iloc[0]['slug'] == 'patrick-mahomes'

    def test_collision_appends_team(self):
        from ingest import generate_player_slugs
        # Two Josh Allens
        qb = pd.DataFrame([
            {'player_id': 'QBA', 'player_name': 'Josh Allen', 'team_id': 'BUF', 'team': 'BUF'},
            {'player_id': 'QBB', 'player_name': 'Josh Allen', 'team_id': 'JAX', 'team': 'JAX'},
        ])
        roster = pd.DataFrame([
            {'gsis_id': 'QBA', 'position': 'QB'},
            {'gsis_id': 'QBB', 'position': 'DE'},
        ])
        class MockConn:
            def cursor(self):
                return self
            def __enter__(self):
                return self
            def __exit__(self, *a):
                pass
            def execute(self, *a):
                pass
            def fetchall(self):
                return []
        result = generate_player_slugs(qb, pd.DataFrame(), pd.DataFrame(), roster, MockConn())
        slugs = sorted(result['slug'].tolist())
        assert 'josh-allen' in slugs
        assert 'josh-allen-jax' in slugs or 'josh-allen-buf' in slugs
```

- [ ] **Step 5: Run all slug tests**

Run: `python -m pytest tests/test_slugs.py -v`
Expected: All tests PASS

- [ ] **Step 6: Commit**

```bash
git add scripts/ingest.py tests/test_slugs.py
git commit -m "feat: add player_slugs table, slug generation with collision handling"
```

---

### Task 4: QB weekly stats — table + aggregation

**Files:**
- Modify: `scripts/ingest.py` (add ensure, aggregate, upsert for qb_weekly_stats)
- Create: `tests/test_weekly_stats.py`

- [ ] **Step 1: Add ensure_qb_weekly_stats_table**

```python
def ensure_qb_weekly_stats_table(conn):
    """Create qb_weekly_stats table. NOT @retry."""
    with conn.cursor() as cur:
        cur.execute("""
            CREATE TABLE IF NOT EXISTS qb_weekly_stats (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                player_id TEXT NOT NULL,
                season INT NOT NULL,
                week INT NOT NULL,
                team_id TEXT REFERENCES teams(id),
                opponent_id TEXT REFERENCES teams(id),
                home_away TEXT,
                result TEXT,
                team_score INT,
                opponent_score INT,
                completions INT,
                attempts INT,
                passing_yards INT,
                touchdowns INT,
                interceptions INT,
                sacks INT,
                epa_per_dropback NUMERIC,
                cpoe NUMERIC,
                success_rate NUMERIC,
                adot NUMERIC,
                passer_rating NUMERIC,
                ypa NUMERIC,
                rush_attempts INT,
                rush_yards INT,
                rush_tds INT,
                fumbles INT,
                fumbles_lost INT,
                UNIQUE (player_id, season, week)
            );
            CREATE INDEX IF NOT EXISTS idx_qb_weekly_team_season ON qb_weekly_stats(team_id, season);
        """)
        # RLS
        cur.execute("DO $$ BEGIN ALTER TABLE qb_weekly_stats ENABLE ROW LEVEL SECURITY; EXCEPTION WHEN others THEN NULL; END $$;")
        cur.execute("DO $$ BEGIN CREATE POLICY \"public_read\" ON qb_weekly_stats FOR SELECT USING (true); EXCEPTION WHEN duplicate_object THEN NULL; END $$;")
    conn.commit()
    log.info("Ensured qb_weekly_stats table exists")
```

- [ ] **Step 2: Add aggregate_qb_weekly_stats function**

```python
def aggregate_qb_weekly_stats(plays: pd.DataFrame, roster: pd.DataFrame, season: int) -> pd.DataFrame:
    """Aggregate QB stats per week for game logs."""
    # Identify QBs from roster
    qb_ids = set(roster[roster['position'] == 'QB']['gsis_id'])

    # Dropback plays (pass_attempt OR sack OR scramble)
    dropbacks = plays[
        (plays['qb_dropback'] == 1) &
        (plays['passer_player_id'].notna())
    ].copy()

    if dropbacks.empty:
        return pd.DataFrame()

    # Filter to actual QBs
    dropbacks = dropbacks[dropbacks['passer_player_id'].isin(qb_ids)]

    # Game context: derive score, opponent, home/away from first play per game
    game_info = plays.drop_duplicates('game_id')[['game_id', 'home_team', 'away_team', 'total_home_score', 'total_away_score']].copy()
    # Get final scores (max per game)
    final_scores = plays.groupby('game_id').agg(
        home_score=('total_home_score', 'max'),
        away_score=('total_away_score', 'max'),
        home_team=('home_team', 'first'),
        away_team=('away_team', 'first'),
    ).reset_index()

    # Group by QB + week
    grouped = dropbacks.groupby(['passer_player_id', 'week']).agg(
        player_name=('passer_player_name', 'first'),
        team_id=('posteam', 'first'),
        game_id=('game_id', 'first'),
        completions=('complete_pass', 'sum'),
        attempts=('pass_attempt', 'sum'),
        passing_yards=('passing_yards', lambda x: x.dropna().sum()),
        touchdowns=('pass_touchdown', 'sum'),
        interceptions=('interception', 'sum'),
        sacks=('sack', 'sum'),
        epa_per_dropback=('epa', 'mean'),
        cpoe=('cpoe', lambda x: x.dropna().mean()),
        success_rate=('success', 'mean'),
        adot=('air_yards', lambda x: x.dropna().mean()),
    ).reset_index().rename(columns={'passer_player_id': 'player_id'})

    # Passer rating per week
    grouped['passer_rating'] = grouped.apply(
        lambda r: passer_rating(int(r['completions']), int(r['attempts']),
                                int(r['passing_yards']), int(r['touchdowns']),
                                int(r['interceptions'])), axis=1
    )
    grouped['ypa'] = grouped.apply(
        lambda r: r['passing_yards'] / r['attempts'] if r['attempts'] > 0 else float('nan'), axis=1
    )

    # Add rushing stats
    rush_plays = plays[
        (plays['rush_attempt'] == 1) &
        (plays['rusher_player_id'].isin(qb_ids))
    ]
    rush_weekly = rush_plays.groupby(['rusher_player_id', 'week']).agg(
        rush_attempts=('rush_attempt', 'sum'),
        rush_yards=('rushing_yards', lambda x: x.dropna().sum()),
        rush_tds=('rush_touchdown', 'sum'),
    ).reset_index().rename(columns={'rusher_player_id': 'player_id'})
    grouped = grouped.merge(rush_weekly, on=['player_id', 'week'], how='left')
    grouped['rush_attempts'] = grouped['rush_attempts'].fillna(0).astype(int)
    grouped['rush_yards'] = grouped['rush_yards'].fillna(0).astype(int)
    grouped['rush_tds'] = grouped['rush_tds'].fillna(0).astype(int)

    # Fumbles
    qb_fumbles = plays[
        (plays['fumbled_1_player_id'].isin(qb_ids)) &
        (plays['fumbled_1_player_id'].notna())
    ].groupby(['fumbled_1_player_id', 'week']).agg(
        fumbles=('fumble', 'sum'),
        fumbles_lost=('fumble_lost', 'sum'),
    ).reset_index().rename(columns={'fumbled_1_player_id': 'player_id'})
    grouped = grouped.merge(qb_fumbles, on=['player_id', 'week'], how='left')
    grouped['fumbles'] = grouped['fumbles'].fillna(0).astype(int)
    grouped['fumbles_lost'] = grouped['fumbles_lost'].fillna(0).astype(int)

    # Join game context (opponent, home/away, score, result)
    grouped = grouped.merge(final_scores, on='game_id', how='left')
    grouped['opponent_id'] = grouped.apply(
        lambda r: r['away_team'] if r['team_id'] == r['home_team'] else r['home_team'], axis=1
    )
    grouped['home_away'] = grouped.apply(
        lambda r: 'home' if r['team_id'] == r['home_team'] else 'away', axis=1
    )
    grouped['team_score'] = grouped.apply(
        lambda r: int(r['home_score']) if r['home_away'] == 'home' else int(r['away_score']), axis=1
    )
    grouped['opponent_score'] = grouped.apply(
        lambda r: int(r['away_score']) if r['home_away'] == 'home' else int(r['home_score']), axis=1
    )
    grouped['result'] = grouped.apply(
        lambda r: 'W' if r['team_score'] > r['opponent_score'] else ('L' if r['team_score'] < r['opponent_score'] else 'T'), axis=1
    )

    grouped['season'] = season

    cols = [
        'player_id', 'season', 'week', 'team_id', 'opponent_id', 'home_away',
        'result', 'team_score', 'opponent_score',
        'completions', 'attempts', 'passing_yards', 'touchdowns', 'interceptions',
        'sacks', 'epa_per_dropback', 'cpoe', 'success_rate', 'adot',
        'passer_rating', 'ypa', 'rush_attempts', 'rush_yards', 'rush_tds',
        'fumbles', 'fumbles_lost',
    ]
    return grouped[cols]
```

- [ ] **Step 3: Add upsert_qb_weekly_stats**

```python
@retry(max_retries=2, delay=3)
def upsert_qb_weekly_stats(conn, df):
    """Upsert QB weekly stats."""
    if df.empty:
        return
    cols = [
        'player_id', 'season', 'week', 'team_id', 'opponent_id', 'home_away',
        'result', 'team_score', 'opponent_score',
        'completions', 'attempts', 'passing_yards', 'touchdowns', 'interceptions',
        'sacks', 'epa_per_dropback', 'cpoe', 'success_rate', 'adot',
        'passer_rating', 'ypa', 'rush_attempts', 'rush_yards', 'rush_tds',
        'fumbles', 'fumbles_lost',
    ]
    clean_df = df[cols].where(df[cols].notna(), None)
    rows = [tuple(r) for _, r in clean_df.iterrows()]
    col_names = ', '.join(cols)
    update_set = ', '.join(f"{c} = EXCLUDED.{c}" for c in cols if c not in ('player_id', 'season', 'week'))
    with conn.cursor() as cur:
        execute_values(cur, f"INSERT INTO qb_weekly_stats ({col_names}) VALUES %s ON CONFLICT (player_id, season, week) DO UPDATE SET {update_set}", rows)
    log.info("Upserted %d QB weekly rows", len(rows))
```

- [ ] **Step 4: Write QB weekly stats tests**

Create `tests/test_weekly_stats.py`:
```python
"""Tests for weekly stat aggregation."""
import sys, os, math
import pandas as pd
import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'scripts'))


def make_qb_play(**overrides):
    """Minimal QB dropback play."""
    defaults = {
        'passer_player_id': 'QB1', 'passer_player_name': 'Test QB',
        'posteam': 'KC', 'defteam': 'BUF',
        'qb_dropback': 1, 'pass_attempt': 1, 'sack': 0, 'qb_scramble': 0,
        'complete_pass': 1, 'passing_yards': 10.0, 'pass_touchdown': 0,
        'interception': 0, 'epa': 0.5, 'cpoe': 2.0, 'success': 1,
        'air_yards': 8.0, 'yards_gained': 10, 'rush_attempt': 0,
        'rusher_player_id': None, 'rusher_player_name': None,
        'rushing_yards': 0, 'rush_touchdown': 0,
        'game_id': '2025_01_BUF_KC', 'season': 2025, 'week': 1,
        'home_team': 'KC', 'away_team': 'BUF',
        'total_home_score': 31, 'total_away_score': 17,
        'play_type': 'pass', 'season_type': 'REG', 'two_point_attempt': 0,
        'fumble': 0, 'fumble_lost': 0, 'fumbled_1_player_id': None,
        'receiver_player_id': 'WR1', 'receiver_player_name': 'Test WR',
        'receiving_yards': 10, 'yards_after_catch': 5, 'result': 14,
        'run_location': None, 'run_gap': None,
    }
    defaults.update(overrides)
    return defaults


def make_roster(player_id='QB1', position='QB'):
    return pd.DataFrame([{'gsis_id': player_id, 'position': position}])


class TestQBWeeklyStats:
    def test_basic_aggregation(self):
        from ingest import aggregate_qb_weekly_stats
        plays = pd.DataFrame([
            make_qb_play(complete_pass=1, passing_yards=15, pass_touchdown=1),
            make_qb_play(complete_pass=0, passing_yards=0, pass_touchdown=0),
        ])
        roster = make_roster()
        result = aggregate_qb_weekly_stats(plays, roster, 2025)
        assert len(result) == 1
        row = result.iloc[0]
        assert row['completions'] == 1
        assert row['attempts'] == 2
        assert row['passing_yards'] == 15
        assert row['touchdowns'] == 1
        assert row['week'] == 1

    def test_game_context(self):
        from ingest import aggregate_qb_weekly_stats
        plays = pd.DataFrame([make_qb_play()])
        roster = make_roster()
        result = aggregate_qb_weekly_stats(plays, roster, 2025)
        row = result.iloc[0]
        assert row['opponent_id'] == 'BUF'
        assert row['home_away'] == 'home'
        assert row['team_score'] == 31
        assert row['opponent_score'] == 17
        assert row['result'] == 'W'

    def test_passer_rating_computed(self):
        from ingest import aggregate_qb_weekly_stats
        plays = pd.DataFrame([make_qb_play()])
        roster = make_roster()
        result = aggregate_qb_weekly_stats(plays, roster, 2025)
        assert result.iloc[0]['passer_rating'] > 0

    def test_multiple_weeks(self):
        from ingest import aggregate_qb_weekly_stats
        plays = pd.DataFrame([
            make_qb_play(week=1, game_id='G1'),
            make_qb_play(week=2, game_id='G2'),
        ])
        roster = make_roster()
        result = aggregate_qb_weekly_stats(plays, roster, 2025)
        assert len(result) == 2
        assert set(result['week']) == {1, 2}
```

- [ ] **Step 5: Run tests**

Run: `python -m pytest tests/test_weekly_stats.py -v`
Expected: All tests PASS

- [ ] **Step 6: Commit**

```bash
git add scripts/ingest.py tests/test_weekly_stats.py
git commit -m "feat: add qb_weekly_stats table, aggregation, and tests"
```

---

### Task 5: Receiver + RB weekly stats — tables + aggregation

**Files:**
- Modify: `scripts/ingest.py` (add ensure, aggregate, upsert for receiver + RB weekly)
- Modify: `tests/test_weekly_stats.py` (add receiver + RB tests)

- [ ] **Step 1: Add ensure_receiver_weekly_stats_table and ensure_rb_weekly_stats_table**

Follow the same pattern as Task 4 but with the receiver/RB schemas from the spec. Include indexes:
```sql
CREATE INDEX IF NOT EXISTS idx_receiver_weekly_team_season ON receiver_weekly_stats(team_id, season);
CREATE INDEX IF NOT EXISTS idx_rb_weekly_team_season ON rb_weekly_stats(team_id, season);
```

- [ ] **Step 2: Add aggregate_receiver_weekly_stats function**

Group `receiver_player_id` by week. Compute: targets, receptions, receiving_yards, receiving_tds, epa_per_target, catch_rate, yac, yac_per_reception, adot, air_yards, routes_run (from participation if available), yards_per_route_run. Join game context (opponent, score, result) same pattern as QB.

- [ ] **Step 3: Add aggregate_rb_weekly_stats function**

Group `rusher_player_id` by week. Compute: carries, rushing_yards, rushing_tds, epa_per_carry, success_rate, yards_per_carry, stuff_rate (yards_gained <= 0), explosive_rate (yards_gained >= 10). Add receiving stats (targets, receptions, receiving_yards, receiving_tds from plays where player is receiver). Join game context.

- [ ] **Step 4: Add upsert functions for both**

Same pattern as `upsert_qb_weekly_stats`.

- [ ] **Step 5: Add receiver + RB weekly tests to test_weekly_stats.py**

Test basic aggregation, game context, and column presence for both positions.

- [ ] **Step 6: Run all weekly tests**

Run: `python -m pytest tests/test_weekly_stats.py -v`
Expected: All tests PASS

- [ ] **Step 7: Commit**

```bash
git add scripts/ingest.py tests/test_weekly_stats.py
git commit -m "feat: add receiver_weekly_stats and rb_weekly_stats tables + aggregation"
```

---

### Task 6: Takeaways in team_season_stats + process_season integration

**Files:**
- Modify: `scripts/ingest.py` (team aggregation + process_season)

- [ ] **Step 1: Add takeaways/giveaways to team aggregation**

In `aggregate_team_stats()`, add columns for:
- `takeaways` = count of `interception == 1` by defteam + `fumble_lost == 1` by defteam (where defteam recovered)
- `giveaways` = count of `interception == 1` by posteam + `fumble_lost == 1` by posteam
- `turnover_diff` = takeaways - giveaways

Add ALTER TABLE in the existing `ensure_*` or add new:
```sql
ALTER TABLE team_season_stats ADD COLUMN IF NOT EXISTS takeaways INT;
ALTER TABLE team_season_stats ADD COLUMN IF NOT EXISTS giveaways INT;
ALTER TABLE team_season_stats ADD COLUMN IF NOT EXISTS turnover_diff INT;
```

- [ ] **Step 2: Wire all new functions into process_season**

In `process_season()` (~line 1356), add:
```python
    # After existing aggregations
    qb_weekly = aggregate_qb_weekly_stats(plays, roster, season)
    receiver_weekly = aggregate_receiver_weekly_stats(plays, roster, season, participation)
    rb_weekly = aggregate_rb_weekly_stats(plays, roster, season)
    player_slugs_df = generate_player_slugs(qb_stats, receiver_stats, rb_gap_stats, roster, conn)
```

In the ensure block (~line 1393):
```python
    ensure_player_slugs_table(conn)
    ensure_qb_weekly_stats_table(conn)
    ensure_receiver_weekly_stats_table(conn)
    ensure_rb_weekly_stats_table(conn)
```

In the upsert block (~line 1398):
```python
    upsert_player_slugs(conn, player_slugs_df)
    upsert_qb_weekly_stats(conn, qb_weekly)
    upsert_receiver_weekly_stats(conn, receiver_weekly)
    upsert_rb_weekly_stats(conn, rb_weekly)
```

Update `cleanup_stale_rows()` to handle the new weekly tables.

Update dry-run logging to include new table row counts.

- [ ] **Step 3: Run full test suite**

Run: `python -m pytest tests/ -v`
Expected: All tests PASS (90 existing + new slug + weekly tests)

- [ ] **Step 4: Commit**

```bash
git add scripts/ingest.py
git commit -m "feat: integrate weekly stats + slugs + takeaways into process_season pipeline"
```

---

### Task 7: TypeScript types and data layer

**Files:**
- Modify: `lib/types/index.ts`
- Create: `lib/data/players.ts`
- Create: `lib/data/utils.ts`
- Modify: `lib/data/run-gaps.ts` (extract fetchAllRows)

- [ ] **Step 1: Add TypeScript interfaces to lib/types/index.ts**

```typescript
export interface PlayerSlug {
  player_id: string;
  slug: string;
  player_name: string;
  position: string;
  current_team_id: string;
}

export interface QBWeeklyStat {
  player_id: string;
  season: number;
  week: number;
  team_id: string;
  opponent_id: string;
  home_away: string;
  result: string;
  team_score: number;
  opponent_score: number;
  completions: number;
  attempts: number;
  passing_yards: number;
  touchdowns: number;
  interceptions: number;
  sacks: number;
  epa_per_dropback: number;
  cpoe: number;
  success_rate: number;
  adot: number;
  passer_rating: number;
  ypa: number;
  rush_attempts: number;
  rush_yards: number;
  rush_tds: number;
  fumbles: number;
  fumbles_lost: number;
}

export interface ReceiverWeeklyStat {
  player_id: string;
  season: number;
  week: number;
  team_id: string;
  opponent_id: string;
  home_away: string;
  result: string;
  team_score: number;
  opponent_score: number;
  targets: number;
  receptions: number;
  receiving_yards: number;
  receiving_tds: number;
  epa_per_target: number;
  catch_rate: number;
  yac: number;
  yac_per_reception: number;
  adot: number;
  air_yards: number;
  routes_run: number;
  yards_per_route_run: number;
}

export interface RBWeeklyStat {
  player_id: string;
  season: number;
  week: number;
  team_id: string;
  opponent_id: string;
  home_away: string;
  result: string;
  team_score: number;
  opponent_score: number;
  carries: number;
  rushing_yards: number;
  rushing_tds: number;
  epa_per_carry: number;
  success_rate: number;
  yards_per_carry: number;
  stuff_rate: number;
  explosive_rate: number;
  targets: number;
  receptions: number;
  receiving_yards: number;
  receiving_tds: number;
  fumbles: number;
  fumbles_lost: number;
}
```

- [ ] **Step 2: Extract fetchAllRows to lib/data/utils.ts**

Create `lib/data/utils.ts` with the `fetchAllRows()` function from `lib/data/run-gaps.ts`. Update `run-gaps.ts` to import from `utils.ts`.

- [ ] **Step 3: Create lib/data/players.ts**

```typescript
import { createServerClient } from "@/lib/supabase/server";
import { parseNumericFields } from "@/lib/utils";
import type { PlayerSlug, QBSeasonStat, ReceiverSeasonStat, QBWeeklyStat, ReceiverWeeklyStat, RBWeeklyStat } from "@/lib/types";

const QB_WEEKLY_NUMERIC = ["epa_per_dropback", "cpoe", "success_rate", "adot", "passer_rating", "ypa"];
const RECEIVER_WEEKLY_NUMERIC = ["epa_per_target", "catch_rate", "yac", "yac_per_reception", "adot", "air_yards", "yards_per_route_run"];
const RB_WEEKLY_NUMERIC = ["epa_per_carry", "success_rate", "yards_per_carry", "stuff_rate", "explosive_rate"];

export async function getPlayerBySlug(slug: string): Promise<PlayerSlug | null> { ... }
export async function getAllPlayerSlugs(): Promise<PlayerSlug[]> { ... }
export async function getQBSeasonStatsByPlayer(playerId: string, season: number): Promise<QBSeasonStat | null> { ... }
export async function getReceiverSeasonStatsByPlayer(playerId: string, season: number): Promise<ReceiverSeasonStat | null> { ... }
export async function getQBWeeklyStats(playerId: string, season: number): Promise<QBWeeklyStat[]> { ... }
export async function getReceiverWeeklyStats(playerId: string, season: number): Promise<ReceiverWeeklyStat[]> { ... }
export async function getRBWeeklyStats(playerId: string, season: number): Promise<RBWeeklyStat[]> { ... }
```

Each function follows the existing pattern: createServerClient → query → parseNumericFields → return.

- [ ] **Step 4: Update revalidation API**

In `app/api/revalidate/route.ts`, add:
```typescript
  revalidatePath("/player", "layout");
  revalidatePath("/team", "layout");
```

- [ ] **Step 5: TypeScript check**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 6: Commit**

```bash
git add lib/types/index.ts lib/data/players.ts lib/data/utils.ts lib/data/run-gaps.ts app/api/revalidate/route.ts
git commit -m "feat: add player data layer — types, queries, pagination util, revalidation"
```

---

### Task 8: Build verification + data ingest

- [ ] **Step 1: Run full Python test suite**

Run: `python -m pytest tests/ -v`
Expected: All tests pass

- [ ] **Step 2: TypeScript check + build**

Run: `npx tsc --noEmit && npx next build`
Expected: Both pass

- [ ] **Step 3: Push and trigger pipeline**

```bash
git push
gh workflow run "Seed Historical Data"  # or "Weekly Data Refresh" — whichever ingests all seasons
```

Wait for pipeline to complete. Verify with:
```bash
gh run watch <run_id> --exit-status
```

- [ ] **Step 4: Verify data in Supabase**

Spot-check:
- `player_slugs`: ~500+ rows, slugs look correct
- `qb_weekly_stats`: ~5000+ rows (17 weeks × ~60 QBs × 6 seasons)
- `receiver_weekly_stats`: ~8000+ rows
- `rb_weekly_stats`: ~6000+ rows
- `team_season_stats`: takeaways/giveaways/turnover_diff populated

- [ ] **Step 5: Commit any fixes**

If pipeline issues found, fix and re-run. Otherwise, Phase 1 is complete.

```bash
git push
```
