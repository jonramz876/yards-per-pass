# Snap Counts Integration — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add total_snaps, snap_share, and route_participation_rate to the receiver rankings page.

**Architecture:** Extend the existing `pbp_participation` processing in `aggregate_receiver_stats()` to count ALL plays (not just pass plays). Compute snap_share using the same primary-team pattern as target_share. Add columns to DB, types, leaderboard, stat card, tooltips, and glossary.

**Tech Stack:** Python (pandas), PostgreSQL (Supabase), Next.js 14, TypeScript, Tailwind

---

### Task 1: Pipeline — Compute snap counts from participation data

**Files:**
- Modify: `scripts/ingest.py:664-723` (participation block in `aggregate_receiver_stats()`)

- [ ] **Step 1: Add total_snaps computation after exploding participation data**

In `aggregate_receiver_stats()`, after the `part_exploded` cleanup (line 682) and BEFORE the pass_plays join (line 684), add total_snaps computation. Must join to `plays` for `posteam` since participation data has no team column.

Insert after line 682 (`part_exploded = part_exploded[part_exploded['player_id'] != '']`... `drop_duplicates` line):

```python
        # --- SNAP COUNTS: count ALL plays per player (not just pass plays) ---
        # Join to plays for team context (participation data has no team column)
        snaps_with_team = part_exploded.merge(
            plays[['game_id', 'play_id', 'posteam']].drop_duplicates(),
            left_on=['nflverse_game_id', 'play_id'],
            right_on=['game_id', 'play_id'],
            how='inner'
        )
        # Total snaps per player per team
        player_snap_counts = snaps_with_team.groupby(['player_id', 'posteam'])['play_id'].nunique().reset_index(name='total_snaps')
        # Team total offensive snaps (denominator for snap_share)
        team_total_snaps = snaps_with_team.groupby('posteam')['play_id'].nunique().to_dict()
```

- [ ] **Step 2: Merge snap counts and compute snap_share/route_participation_rate**

After the existing routes_run merge (line 696) and BEFORE the derived route metrics (line 705), add:

```python
        # Merge snap counts — use primary team (same as target_share logic)
        # player's team_id was already set from target_share computation above
        rec = rec.merge(
            player_snap_counts,
            left_on=['player_id', 'team_id'],
            right_on=['player_id', 'posteam'],
            how='left'
        )
        rec.drop(columns=['posteam'], inplace=True, errors='ignore')
        rec['total_snaps'] = rec['total_snaps'].fillna(0).astype(int)
        rec['snap_share'] = rec.apply(
            lambda r: r['total_snaps'] / team_total_snaps.get(r['team_id'], 1)
            if r['total_snaps'] > 0 else float('nan'), axis=1
        )
```

Then after the existing `targets_per_route_run` computation (line 711), add:

```python
    rec['route_participation_rate'] = rec.apply(
        lambda r: r['routes_run'] / r['total_snaps'] if r['total_snaps'] > 0 else float('nan'), axis=1
    )
```

- [ ] **Step 3: Update the else branch (no participation data)**

At the existing `else: rec['routes_run'] = 0` (line 703), also add:

```python
        rec['total_snaps'] = 0
        rec['snap_share'] = float('nan')
```

And after the route_participation_rate line, it will naturally produce NaN since total_snaps=0.

- [ ] **Step 4: Add snap columns to the final column list**

Update the `cols` list at line 714 — add after `'targets_per_route_run'`:

```python
        'total_snaps', 'snap_share', 'route_participation_rate',
```

- [ ] **Step 5: Validate snap_share bounds**

After the snap_share computation, add a validation warning:

```python
        bad_snap = rec[rec['snap_share'] > 1.0]
        if not bad_snap.empty:
            log.warning("snap_share > 1.0 for %d players: %s", len(bad_snap), bad_snap['player_name'].tolist()[:5])
        bad_route = rec[rec['route_participation_rate'] > 1.0]
        if not bad_route.empty:
            log.warning("route_participation_rate > 1.0 for %d players: %s", len(bad_route), bad_route['player_name'].tolist()[:5])
```

- [ ] **Step 6: Run existing tests to confirm no regressions**

Run: `cd "C:\Users\jonra\OneDrive\Desktop\claude sandbox\football website\yards-per-pass" && python -m pytest tests/test_receiver_stats.py -v`
Expected: All 28 existing tests PASS (new columns present but tests don't assert them yet)

- [ ] **Step 7: Commit**

```bash
git add scripts/ingest.py
git commit -m "feat: compute snap counts from participation data in receiver pipeline"
```

---

### Task 2: Schema migration — Add snap columns to DB

**Files:**
- Modify: `scripts/ingest.py:1046-1048` (`ensure_receiver_stats_table()`)
- Modify: `scripts/ingest.py:1072-1080` (`upsert_receiver_stats()`)

- [ ] **Step 1: Add ALTER TABLE for snap columns**

At line 1048, after the existing route column migrations, add:

```python
        for col, typ in [('total_snaps', 'INTEGER'), ('snap_share', 'NUMERIC'), ('route_participation_rate', 'NUMERIC')]:
            cur.execute(f"ALTER TABLE receiver_season_stats ADD COLUMN IF NOT EXISTS {col} {typ};")
```

- [ ] **Step 2: Add snap columns to upsert column list**

At the `cols` list in `upsert_receiver_stats()` (line 1072-1080), add after `'targets_per_route_run'`:

```python
        'total_snaps', 'snap_share', 'route_participation_rate',
```

- [ ] **Step 3: Commit**

```bash
git add scripts/ingest.py
git commit -m "feat: add snap count columns to receiver DB schema and upsert"
```

---

### Task 3: Tests — Snap count pipeline tests

**Files:**
- Modify: `tests/test_receiver_stats.py` (add new test class at end)

- [ ] **Step 1: Write all 6 new tests**

Add at the end of `tests/test_receiver_stats.py`:

```python
class TestSnapCounts:
    """Snap count, snap share, and route participation rate from participation data."""

    def test_total_snaps_counts_all_plays(self):
        """total_snaps counts ALL plays (pass + run), not just pass plays."""
        from ingest import aggregate_receiver_stats
        # 1 pass play targeting WR1
        pass_play = make_plays(game_id='GAME1', complete_pass=1)
        pass_play['play_id'] = [0]
        # 1 run play (no receiver, not a pass attempt) — WR1 still on field
        run_play = make_plays(game_id='GAME1', receiver_player_id=None, pass_attempt=0,
                              complete_pass=0, receiving_yards=0, air_yards=0,
                              yards_after_catch=0, epa=0.1, pass_touchdown=0)
        run_play['play_id'] = [1]
        plays = pd.concat([pass_play, run_play], ignore_index=True)
        roster = make_roster()
        # WR1 on field for BOTH plays
        participation = pd.concat([
            make_participation(player_ids='WR1', play_id=0),
            make_participation(player_ids='WR1', play_id=1),
        ], ignore_index=True)
        result = aggregate_receiver_stats(plays, roster, 2025, participation)
        assert result.iloc[0]['total_snaps'] == 2  # both plays
        assert result.iloc[0]['routes_run'] == 1   # only pass play

    def test_snap_share_computation(self):
        """snap_share = player_snaps / team_total_snaps."""
        from ingest import aggregate_receiver_stats
        # 2 plays, WR1 on field for 1, WR2 also on field for both
        play1 = make_plays(game_id='GAME1', complete_pass=1)
        play1['play_id'] = [0]
        play2 = make_plays(game_id='GAME1', receiver_player_id='WR2',
                           receiver_player_name='Other WR', complete_pass=1)
        play2['play_id'] = [1]
        plays = pd.concat([play1, play2], ignore_index=True)
        roster = pd.concat([make_roster('WR1', 'WR'), make_roster('WR2', 'WR')], ignore_index=True)
        participation = pd.concat([
            make_participation(player_ids=['WR1', 'WR2'], play_id=0),
            make_participation(player_ids=['WR2'], play_id=1),
        ], ignore_index=True)
        result = aggregate_receiver_stats(plays, roster, 2025, participation)
        wr1 = result[result['player_id'] == 'WR1'].iloc[0]
        assert wr1['total_snaps'] == 1
        assert abs(wr1['snap_share'] - 0.5) < 0.01  # 1 snap / 2 team snaps

    def test_route_participation_rate(self):
        """route_participation_rate = routes_run / total_snaps."""
        from ingest import aggregate_receiver_stats
        # 3 plays: 2 pass + 1 run. WR1 on field for all 3.
        pass1 = make_plays(game_id='GAME1', complete_pass=1)
        pass1['play_id'] = [0]
        pass2 = make_plays(game_id='GAME1', complete_pass=0, receiving_yards=0)
        pass2['play_id'] = [1]
        run = make_plays(game_id='GAME1', receiver_player_id=None, pass_attempt=0,
                         complete_pass=0, receiving_yards=0, air_yards=0,
                         yards_after_catch=0, epa=0.1, pass_touchdown=0)
        run['play_id'] = [2]
        plays = pd.concat([pass1, pass2, run], ignore_index=True)
        roster = make_roster()
        participation = pd.concat([
            make_participation(player_ids='WR1', play_id=0),
            make_participation(player_ids='WR1', play_id=1),
            make_participation(player_ids='WR1', play_id=2),
        ], ignore_index=True)
        result = aggregate_receiver_stats(plays, roster, 2025, participation)
        row = result.iloc[0]
        assert row['total_snaps'] == 3
        assert row['routes_run'] == 2  # only pass plays
        assert abs(row['route_participation_rate'] - 2/3) < 0.01

    def test_snap_zero_division(self):
        """Player with 0 total_snaps gets NaN for snap_share and route_participation_rate."""
        from ingest import aggregate_receiver_stats
        plays = make_plays()
        plays['play_id'] = [0]
        roster = make_roster()
        # No participation data — fallback
        result = aggregate_receiver_stats(plays, roster, 2025, None)
        assert result.iloc[0]['total_snaps'] == 0
        assert math.isnan(result.iloc[0]['snap_share'])
        assert math.isnan(result.iloc[0]['route_participation_rate'])

    def test_snap_share_bounds(self):
        """No player should have snap_share > 1.0 or route_participation_rate > 1.0."""
        from ingest import aggregate_receiver_stats
        plays = make_plays()
        plays['play_id'] = [0]
        roster = make_roster()
        participation = make_participation(player_ids='WR1', play_id=0)
        result = aggregate_receiver_stats(plays, roster, 2025, participation)
        row = result.iloc[0]
        if not math.isnan(row['snap_share']):
            assert row['snap_share'] <= 1.0
        if not math.isnan(row['route_participation_rate']):
            assert row['route_participation_rate'] <= 1.0

    def test_traded_player_snap_share(self):
        """Traded player's snap_share uses primary team's total snaps."""
        from ingest import aggregate_receiver_stats
        # WR1 has 2 targets on KC, 1 target on SF → primary team = KC
        kc1 = make_plays(game_id='GAME1', posteam='KC')
        kc1['play_id'] = [0]
        kc2 = make_plays(game_id='GAME2', posteam='KC')
        kc2['play_id'] = [1]
        sf1 = make_plays(game_id='GAME3', posteam='SF')
        sf1['play_id'] = [2]
        plays = pd.concat([kc1, kc2, sf1], ignore_index=True)
        roster = make_roster()
        # On field for all 3 plays
        participation = pd.concat([
            make_participation(play_id=0, game_id='GAME1'),
            make_participation(play_id=1, game_id='GAME2'),
            make_participation(play_id=2, game_id='GAME3'),
        ], ignore_index=True)
        result = aggregate_receiver_stats(plays, roster, 2025, participation)
        row = result.iloc[0]
        assert row['team_id'] == 'KC'  # primary team
        # snap_share should be KC snaps / KC team total (2/2 = 1.0)
        # The player had 2 snaps on KC out of 2 KC team snaps
        assert abs(row['snap_share'] - 1.0) < 0.01

    def test_output_has_snap_columns(self):
        """Output DataFrame includes all snap count columns."""
        from ingest import aggregate_receiver_stats
        plays = make_plays()
        plays['play_id'] = [0]
        roster = make_roster()
        result = aggregate_receiver_stats(plays, roster, 2025)
        for col in ['total_snaps', 'snap_share', 'route_participation_rate']:
            assert col in result.columns, f"Missing column: {col}"
```

- [ ] **Step 2: Run all tests**

Run: `cd "C:\Users\jonra\OneDrive\Desktop\claude sandbox\football website\yards-per-pass" && python -m pytest tests/test_receiver_stats.py -v`
Expected: All 35 tests PASS (28 existing + 7 new)

- [ ] **Step 3: Run full test suite**

Run: `cd "C:\Users\jonra\OneDrive\Desktop\claude sandbox\football website\yards-per-pass" && python -m pytest tests/ -v`
Expected: All 89+ tests PASS

- [ ] **Step 4: Commit**

```bash
git add tests/test_receiver_stats.py
git commit -m "test: add 7 snap count tests (total_snaps, snap_share, route_rate, bounds, traded)"
```

---

### Task 4: Frontend types and data layer

**Files:**
- Modify: `lib/types/index.ts:129-132` (add fields before closing brace)
- Modify: `lib/data/receivers.ts:5-17` (add to RECEIVER_NUMERIC_FIELDS)

- [ ] **Step 1: Add fields to ReceiverSeasonStat**

In `lib/types/index.ts`, after line 131 (`targets_per_route_run: number;`) and before the closing `}`:

```typescript
  total_snaps: number;
  snap_share: number;
  route_participation_rate: number;
```

- [ ] **Step 2: Add numeric fields to RECEIVER_NUMERIC_FIELDS**

In `lib/data/receivers.ts`, after `"targets_per_route_run"` (line 16), add:

```typescript
  "snap_share",
  "route_participation_rate",
```

(Note: `total_snaps` is INTEGER so it parses automatically — only NUMERIC columns need this.)

- [ ] **Step 3: Commit**

```bash
git add lib/types/index.ts lib/data/receivers.ts
git commit -m "feat: add snap count fields to ReceiverSeasonStat type and numeric parser"
```

---

### Task 5: ReceiverLeaderboard — Add columns and formatting

**Files:**
- Modify: `components/tables/ReceiverLeaderboard.tsx:24-47` (column defs)
- Modify: `components/tables/ReceiverLeaderboard.tsx:74-81` (heatmap sets)
- Modify: `components/tables/ReceiverLeaderboard.tsx:102-143` (formatVal/formatAvg)

- [ ] **Step 1: Add Snaps to STANDARD_COLUMNS**

In `STANDARD_COLUMNS` array, after the `routes_run` entry (line 44), add:

```typescript
  { key: "total_snaps", label: "Snaps", group: "receiving" },
```

- [ ] **Step 2: Add Snap% and Route% to ADVANCED_COLUMNS**

In `ADVANCED_COLUMNS` array, after the `targets_per_route_run` entry (line 33), add:

```typescript
  { key: "snap_share", label: "Snap%", tooltip: "Snap%", group: "efficiency" },
  { key: "route_participation_rate", label: "Route%", tooltip: "Route%", group: "efficiency" },
```

- [ ] **Step 3: Add heatmap coloring for snap_share and route_participation_rate**

In `HEATMAP_COLS_ADVANCED` (line 74), add to the Set:

```typescript
  "snap_share", "route_participation_rate",
```

- [ ] **Step 4: Add percentage formatting to formatVal()**

In `formatVal()` (line 102), add `snap_share` and `route_participation_rate` to the percentage case at line 113-115:

```typescript
    case "catch_rate":
    case "target_share":
    case "snap_share":
    case "route_participation_rate":
      return (val * 100).toFixed(1) + "%";
```

- [ ] **Step 5: Add percentage formatting to formatAvg()**

Same change in `formatAvg()` (line 125), add to the percentage case at line 135-137:

```typescript
    case "catch_rate":
    case "target_share":
    case "snap_share":
    case "route_participation_rate":
      return (val * 100).toFixed(1) + "%";
```

- [ ] **Step 6: Add footnote text for Snap% and Route%**

In the footnotes section (line 551-555), add after the Tgt Share line:

```tsx
        <p><span className="font-semibold text-gray-500">Snap%</span> = player snaps / team offensive snaps. <span className="font-semibold text-gray-500">Route%</span> = routes run / total snaps (pass catchers &gt; blockers).</p>
```

- [ ] **Step 7: Commit**

```bash
git add components/tables/ReceiverLeaderboard.tsx
git commit -m "feat: add Snaps, Snap%, Route% columns to ReceiverLeaderboard"
```

---

### Task 6: ReceiverStatCard — Add bar stats

**Files:**
- Modify: `components/receivers/ReceiverStatCard.tsx:44-49` (BAR_STATS)
- Modify: `components/receivers/ReceiverStatCard.tsx:76-83` (getBarVal)
- Modify: `components/receivers/ReceiverStatCard.tsx:290-292` (bar value display)

- [ ] **Step 1: Add snap stats to BAR_STATS array**

At line 44, add two entries to `BAR_STATS`:

```typescript
const BAR_STATS = [
  { key: "yards_per_game", label: "Yds/G" },
  { key: "tds_per_game", label: "TD/G" },
  { key: "receptions_per_game", label: "Rec/G" },
  { key: "yards_per_reception", label: "YPR" },
  { key: "snap_share", label: "Snap%", pct: true },
  { key: "route_participation_rate", label: "Route%", pct: true },
];
```

Update the type to include `pct`:
```typescript
// Update BAR_STATS type by changing the existing array items inline - add pct: false to existing items
```

Actually, simpler approach: add a `pct` flag and update formatting.

- [ ] **Step 2: Update bar value display for percentage stats**

At line 290-292, the bar value display is:
```tsx
{isNaN(bar.val) ? "\u2014" : bar.val.toFixed(1)}
```

Change to:
```tsx
{isNaN(bar.val) ? "\u2014" : bar.pct ? (bar.val * 100).toFixed(1) + "%" : bar.val.toFixed(1)}
```

Also update the avg display (line 266) similarly:
```tsx
avg: {isNaN(bar.avg) ? "\u2014" : bar.pct ? (bar.avg * 100).toFixed(1) + "%" : bar.avg < 10 ? bar.avg.toFixed(1) : bar.avg.toFixed(0)}
```

And the delta display (line 298-300):
```tsx
{isNaN(bar.delta)
  ? ""
  : (bar.delta >= 0 ? "+" : "") + (bar.pct ? (bar.delta * 100).toFixed(1) + "%" : bar.delta.toFixed(1))}
```

- [ ] **Step 3: Commit**

```bash
git add components/receivers/ReceiverStatCard.tsx
git commit -m "feat: add Snap% and Route% bar stats to ReceiverStatCard modal"
```

---

### Task 7: Tooltips and Glossary

**Files:**
- Modify: `components/ui/MetricTooltip.tsx:10-52` (METRIC_DEFINITIONS)
- Modify: `app/glossary/page.tsx:139` (TERMS array, before closing bracket)

- [ ] **Step 1: Add tooltip definitions**

In `METRIC_DEFINITIONS` in MetricTooltip.tsx, after the TPRR entry (line 51), add:

```typescript
  "Snaps": "Total offensive plays the player was on the field. Derived from play-by-play participation data.",
  "Snap%": "Percentage of team\u2019s offensive plays the player was on the field. 100% means every snap.",
  "Route%": "How often the player runs a route when on the field. High = pure pass catcher, low = run blocker. WRs are typically 80\u201395%, blocking TEs can be 40\u201360%.",
```

- [ ] **Step 2: Add glossary entries**

In the TERMS array in `app/glossary/page.tsx`, after the TPRR entry (before line 140's `];`), add:

```typescript
  {
    term: "Snap Count",
    definition: "Total offensive plays a player was on the field for. Derived from play-by-play participation data \u2014 counts all play types (passes, runs, penalties). Does not include special teams snaps.",
  },
  {
    term: "Snap Share (Snap%)",
    definition: "Player\u2019s offensive snap count divided by their team\u2019s total offensive snaps. A snap share of 85% means the player was on the field for 85% of the team\u2019s offensive plays. The primary measure of a receiver\u2019s playing time.",
  },
  {
    term: "Route Participation Rate (Route%)",
    definition: "Routes run divided by total offensive snaps. Measures how often a player runs a route when on the field. A WR with 90% route participation is almost always running routes. A TE with 50% is blocking half the time. Separates pass catchers from blockers.",
  },
```

- [ ] **Step 3: Commit**

```bash
git add components/ui/MetricTooltip.tsx app/glossary/page.tsx
git commit -m "feat: add snap count tooltip definitions and glossary entries"
```

---

### Task 8: Build verification and data ingest

- [ ] **Step 1: TypeScript check**

Run: `cd "C:\Users\jonra\OneDrive\Desktop\claude sandbox\football website\yards-per-pass" && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 2: Next.js build**

Run: `cd "C:\Users\jonra\OneDrive\Desktop\claude sandbox\football website\yards-per-pass" && npx next build`
Expected: Build succeeds with 17 pages

- [ ] **Step 3: Run full test suite**

Run: `cd "C:\Users\jonra\OneDrive\Desktop\claude sandbox\football website\yards-per-pass" && python -m pytest tests/ -v`
Expected: All tests pass (83 original + 7 new = 90)

- [ ] **Step 4: Fix any build/test failures**

If tsc or build fails, fix TypeScript errors. If tests fail, fix test or implementation issues.

- [ ] **Step 5: Ingest data for one season to verify pipeline**

Run: `cd "C:\Users\jonra\OneDrive\Desktop\claude sandbox\football website\yards-per-pass" && python scripts/ingest.py --seasons 2025`
Expected: Ingest completes. Log shows snap count stats being computed. No warnings about snap_share > 1.0.

- [ ] **Step 6: Verify data in Supabase**

Run: `cd "C:\Users\jonra\OneDrive\Desktop\claude sandbox\football website\yards-per-pass" && python -c "
import psycopg2, os
conn = psycopg2.connect(os.environ['DATABASE_URL'])
cur = conn.cursor()
cur.execute('SELECT player_name, total_snaps, snap_share, route_participation_rate FROM receiver_season_stats WHERE season=2025 AND total_snaps > 0 ORDER BY total_snaps DESC LIMIT 10')
for row in cur.fetchall():
    print(f'{row[0]:25s} snaps={row[1]:4d}  snap%={row[2]:.3f}  route%={row[3]:.3f}')
conn.close()
"`
Expected: Top receivers show ~800-1100 snaps, snap_share 0.7-1.0, route_rate 0.7-0.95.

- [ ] **Step 7: Commit any fixes**

```bash
git add -A
git commit -m "fix: address build/test/ingest issues from snap counts integration"
```

(Only if fixes were needed. Skip if Steps 1-6 all passed cleanly.)
