# Phase 2: Data & Analytics Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add fumbles, fix aDOT, add computed columns (TD:INT, per-game, total TDs), improve type safety, and enhance mobile team view — with thorough stat verification.

**Architecture:** Pipeline changes (ingest.py) compute and store fumbles + corrected aDOT. Frontend-only computed columns (TD:INT, Yds/G, TD/G, Tot TD) use a `getVal` helper for sort+display. TypeScript types made nullable-honest. All pipeline changes verified via unit tests + PFR cross-reference.

**Tech Stack:** Python/pandas (pipeline), PostgreSQL/Supabase (storage), Next.js/TypeScript/React (frontend), pytest (tests)

**Working directory:** `C:\Users\jonra\OneDrive\Desktop\claude sandbox\football website\yards-per-pass\`

**Spec:** `docs/superpowers/specs/2026-03-15-phase2-data-analytics-design.md`

---

## Chunk 1: Pipeline + Tests

### Task 1: Write aDOT unit tests (D-M3)

**Files:**
- Modify: `tests/test_formulas.py`

- [ ] **Step 1: Write 3 aDOT filter tests**

Add to `tests/test_formulas.py`:

```python
class TestADOT:
    """aDOT must only use true pass attempts: (pass_attempt==1) & (sack!=1) & (qb_scramble!=1)."""

    def _compute_adot(self, plays_data: list[dict]) -> float:
        """Helper: apply the aDOT filter and compute mean air_yards."""
        import pandas as pd
        df = pd.DataFrame(plays_data)
        adot_plays = df[
            (df['pass_attempt'] == 1) &
            (df['sack'] != 1) &
            (df['qb_scramble'] != 1)
        ]
        return adot_plays['air_yards'].dropna().mean()

    def test_adot_excludes_sacks(self):
        """Sack plays (pass_attempt=1, sack=1) must not contribute to aDOT."""
        plays = [
            {'pass_attempt': 1, 'sack': 0, 'qb_scramble': 0, 'air_yards': 10.0},
            {'pass_attempt': 1, 'sack': 1, 'qb_scramble': 0, 'air_yards': float('nan')},
            {'pass_attempt': 1, 'sack': 0, 'qb_scramble': 0, 'air_yards': 5.0},
        ]
        assert self._compute_adot(plays) == pytest.approx(7.5)

    def test_adot_excludes_scrambles(self):
        """Scramble plays must be excluded even when pass_attempt=1."""
        plays = [
            {'pass_attempt': 1, 'sack': 0, 'qb_scramble': 0, 'air_yards': 12.0},
            {'pass_attempt': 1, 'sack': 0, 'qb_scramble': 0, 'air_yards': 8.0},
            {'pass_attempt': 1, 'sack': 0, 'qb_scramble': 1, 'air_yards': 0.0},
        ]
        assert self._compute_adot(plays) == pytest.approx(10.0)

    def test_adot_all_nan_returns_nan(self):
        """QB with only sacks/scrambles should get NaN aDOT, not 0 or crash."""
        import math
        plays = [
            {'pass_attempt': 1, 'sack': 1, 'qb_scramble': 0, 'air_yards': float('nan')},
            {'pass_attempt': 1, 'sack': 0, 'qb_scramble': 1, 'air_yards': 0.0},
        ]
        result = self._compute_adot(plays)
        assert math.isnan(result)
```

- [ ] **Step 2: Run tests to verify they pass (testing the filter logic itself)**

Run: `cd scripts && python -m pytest ../tests/test_formulas.py::TestADOT -v`
Expected: 3 PASS (these test the filter logic directly, not the ingest function)

- [ ] **Step 3: Commit**

```bash
git add tests/test_formulas.py
git commit -m "test: add 3 aDOT filter unit tests (D-M3)"
```

---

### Task 2: Write fumble unit tests (D-M1)

**Files:**
- Modify: `tests/test_formulas.py`

- [ ] **Step 1: Write 4 fumble attribution tests**

Add to `tests/test_formulas.py`:

```python
class TestFumbleAttribution:
    """Fumbles must be attributed via fumbled_1_player_id, not passer/rusher grouping.
    This prevents WR/RB fumbles after a catch from being charged to the QB."""

    def _compute_qb_fumbles(self, plays_data: list[dict], qb_ids: set) -> dict:
        """Helper: apply the fumble attribution logic and return {player_id: (fumbles, fumbles_lost)}."""
        import pandas as pd
        df = pd.DataFrame(plays_data)
        qb_fumbles = df[
            df['fumbled_1_player_id'].isin(qb_ids)
        ].groupby('fumbled_1_player_id').agg(
            fumbles=('fumble', 'sum'),
            fumbles_lost=('fumble_lost', 'sum'),
        ).reset_index().rename(columns={'fumbled_1_player_id': 'player_id'})
        return {
            row['player_id']: (int(row['fumbles']), int(row['fumbles_lost']))
            for _, row in qb_fumbles.iterrows()
        }

    def test_qb_sack_fumble(self):
        """QB fumble on a sack play — fumbled_1_player_id is the QB."""
        plays = [
            {'passer_player_id': 'QB1', 'fumble': 1, 'fumble_lost': 1,
             'fumbled_1_player_id': 'QB1', 'sack': 1, 'qb_dropback': 1},
        ]
        result = self._compute_qb_fumbles(plays, {'QB1'})
        assert result['QB1'] == (1, 1)

    def test_qb_rush_fumble(self):
        """QB fumble on a designed run — fumbled_1_player_id is the QB."""
        plays = [
            {'passer_player_id': None, 'fumble': 1, 'fumble_lost': 0,
             'fumbled_1_player_id': 'QB1', 'sack': 0, 'qb_dropback': 0},
        ]
        result = self._compute_qb_fumbles(plays, {'QB1'})
        assert result['QB1'] == (1, 0)

    def test_wr_fumble_not_charged_to_qb(self):
        """WR fumble after a catch — QB must NOT be charged.
        This is the critical test. The naive approach of grouping by
        passer_player_id would wrongly charge the QB here."""
        plays = [
            {'passer_player_id': 'QB1', 'fumble': 1, 'fumble_lost': 1,
             'fumbled_1_player_id': 'WR1', 'sack': 0, 'qb_dropback': 1},
        ]
        result = self._compute_qb_fumbles(plays, {'QB1'})
        assert 'QB1' not in result  # QB should have 0 fumbles

    def test_qb_scramble_fumble(self):
        """QB fumble on a scramble — fumbled_1_player_id is the QB."""
        plays = [
            {'passer_player_id': 'QB1', 'fumble': 1, 'fumble_lost': 1,
             'fumbled_1_player_id': 'QB1', 'sack': 0, 'qb_dropback': 1,
             'qb_scramble': 1},
        ]
        result = self._compute_qb_fumbles(plays, {'QB1'})
        assert result['QB1'] == (1, 1)
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `cd scripts && python -m pytest ../tests/test_formulas.py::TestFumbleAttribution -v`
Expected: 4 PASS

- [ ] **Step 3: Commit**

```bash
git add tests/test_formulas.py
git commit -m "test: add 4 fumble attribution unit tests (D-M1)"
```

---

### Task 3: Write computed stat tests (D-M5, D-M6, D-M11)

**Files:**
- Modify: `tests/test_formulas.py`

- [ ] **Step 1: Write 3 computed stat tests**

Add to `tests/test_formulas.py`:

```python
def get_val(games: int, passing_yards: int, touchdowns: int, rush_tds: int, interceptions: int, key: str):
    """Python mirror of the frontend getVal() helper for computed stats.
    Tests this function to ensure the logic is correct before implementing in TypeScript."""
    import math
    if key == "yards_per_game":
        return passing_yards / games if games else float('nan')
    if key == "tds_per_game":
        return touchdowns / games if games else float('nan')
    if key == "total_tds":
        return touchdowns + rush_tds
    if key == "td_int_ratio":
        return touchdowns / interceptions if interceptions > 0 else float('inf')
    raise ValueError(f"Unknown key: {key}")


class TestComputedStats:
    """Frontend-computed stats via getVal helper: TD:INT ratio, per-game stats, total TDs.
    Tests a Python mirror of the TypeScript getVal() function."""

    def test_td_int_ratio_normal(self):
        """20 TD / 8 INT = 2.5."""
        assert get_val(16, 3400, 20, 5, 8, "td_int_ratio") == pytest.approx(2.5)

    def test_td_int_ratio_zero_int(self):
        """0 INTs → Infinity (displayed as 'X:0')."""
        import math
        result = get_val(16, 3400, 5, 2, 0, "td_int_ratio")
        assert math.isinf(result)

    def test_yards_per_game(self):
        """3400 yards / 16 games = 212.5."""
        assert get_val(16, 3400, 20, 5, 8, "yards_per_game") == pytest.approx(212.5)

    def test_tds_per_game(self):
        """24 TDs / 16 games = 1.5."""
        assert get_val(16, 3400, 24, 5, 8, "tds_per_game") == pytest.approx(1.5)

    def test_per_game_zero_games(self):
        """0 games → NaN (not crash or Infinity)."""
        import math
        assert math.isnan(get_val(0, 3400, 20, 5, 8, "yards_per_game"))
        assert math.isnan(get_val(0, 3400, 20, 5, 8, "tds_per_game"))

    def test_total_tds(self):
        """Total TDs = passing TDs + rushing TDs."""
        assert get_val(16, 3400, 25, 5, 8, "total_tds") == 30

    def test_total_tds_zero(self):
        """Both 0 → 0."""
        assert get_val(16, 0, 0, 0, 0, "total_tds") == 0
```

- [ ] **Step 2: Run all tests**

Run: `cd scripts && python -m pytest ../tests/test_formulas.py -v`
Expected: All tests PASS

- [ ] **Step 3: Commit**

```bash
git add tests/test_formulas.py
git commit -m "test: add 3 computed stat tests (D-M5, D-M6, D-M11)"
```

---

### Task 4: Fix aDOT pipeline computation (D-M3)

**Files:**
- Modify: `scripts/ingest.py:228-242` (qb_drop aggregation)

- [ ] **Step 1: Remove `adot` from the main aggregation**

In `scripts/ingest.py`, remove the `adot` line from the `qb_drop = dropbacks.groupby(...).agg(...)` call at line 237:

```python
# REMOVE this line from the agg() call:
        adot=('air_yards', lambda x: x.dropna().mean()),
```

- [ ] **Step 2: Add separate aDOT computation after the main aggregation**

After the `qb_drop` aggregation block (after line 242, after the `.reset_index().rename(...)`) add:

```python
    # aDOT: compute on true pass attempts only (exclude sacks and scrambles)
    # Scrambles can have pass_attempt=1 in nflverse but air_yards is meaningless
    adot_plays = dropbacks[
        (dropbacks['pass_attempt'] == 1) &
        (dropbacks['sack'] != 1) &
        (dropbacks['qb_scramble'] != 1)
    ]
    adot_stats = adot_plays.groupby('passer_player_id')['air_yards'].apply(
        lambda x: x.dropna().mean()
    ).reset_index().rename(columns={'passer_player_id': 'player_id', 'air_yards': 'adot'})
    qb_drop = qb_drop.merge(adot_stats, on='player_id', how='left')
```

- [ ] **Step 3: Run aDOT tests**

Run: `cd scripts && python -m pytest ../tests/test_formulas.py::TestADOT -v`
Expected: 3 PASS

- [ ] **Step 4: Run all existing tests to check for regression**

Run: `cd scripts && python -m pytest ../tests/test_formulas.py -v`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add scripts/ingest.py
git commit -m "fix: compute aDOT on pass attempts only, excluding sacks and scrambles (D-M3)"
```

---

### Task 5: Add fumble aggregation to pipeline (D-M1)

**Files:**
- Modify: `scripts/ingest.py:65-73` (REQUIRED_PBP_COLS)
- Modify: `scripts/ingest.py:204-383` (aggregate_qb_stats)
- Modify: `scripts/ingest.py:370-376` (final cols)
- Modify: `scripts/ingest.py:479-484` (upsert_qb_stats cols)

- [ ] **Step 1: Add fumble columns to REQUIRED_PBP_COLS**

In `scripts/ingest.py`, add to the `REQUIRED_PBP_COLS` list:

```python
    'rush_touchdown', 'rushing_yards', 'game_id', 'season', 'week',
    'home_team', 'away_team', 'result',
    'fumble', 'fumble_lost', 'fumbled_1_player_id',
]
```

- [ ] **Step 2: Add fumble aggregation logic in aggregate_qb_stats**

After the scramble merge block (after line 344, after `qb_stats['rush_yards'] = ...`) add:

```python
    # --- Fumble stats: attribute via fumbled_1_player_id (not passer/rusher grouping) ---
    # Critical: the `fumble` column marks ANY fumble on the play (including WR/RB).
    # Using passer_player_id grouping would wrongly charge receiver fumbles to the QB.
    all_qb_plays = pd.concat([dropbacks, designed_rushes])
    qb_fumble_plays = all_qb_plays[
        all_qb_plays['fumbled_1_player_id'].isin(qb_ids)
    ]
    if len(qb_fumble_plays) > 0:
        fumble_stats = qb_fumble_plays.groupby('fumbled_1_player_id').agg(
            fumbles=('fumble', 'sum'),
            fumbles_lost=('fumble_lost', 'sum'),
        ).reset_index().rename(columns={'fumbled_1_player_id': 'player_id'})
    else:
        fumble_stats = pd.DataFrame(columns=['player_id', 'fumbles', 'fumbles_lost'])
    qb_stats = qb_stats.merge(fumble_stats, on='player_id', how='left')
    qb_stats['fumbles'] = qb_stats['fumbles'].fillna(0).astype(int)
    qb_stats['fumbles_lost'] = qb_stats['fumbles_lost'].fillna(0).astype(int)
```

- [ ] **Step 3: Add fumbles to final columns list**

Update the `cols` list (around line 370) to include `fumbles` and `fumbles_lost`:

```python
    cols = [
        'player_id', 'player_name', 'team_id', 'season', 'games',
        'completions', 'attempts', 'dropbacks', 'epa_per_db', 'epa_per_play',
        'cpoe', 'completion_pct', 'success_rate', 'passing_yards',
        'touchdowns', 'interceptions', 'sacks', 'sack_yards_lost', 'adot', 'ypa', 'passer_rating',
        'any_a', 'rush_attempts', 'rush_yards', 'rush_tds', 'rush_epa_per_play',
        'fumbles', 'fumbles_lost',
    ]
```

- [ ] **Step 4: Add fumbles to upsert_qb_stats cols**

Update the `cols` list in `upsert_qb_stats` (around line 479) to match:

```python
    cols = [
        'player_id', 'player_name', 'team_id', 'season', 'games',
        'completions', 'attempts', 'dropbacks', 'epa_per_db', 'epa_per_play',
        'cpoe', 'completion_pct', 'success_rate', 'passing_yards',
        'touchdowns', 'interceptions', 'sacks', 'sack_yards_lost', 'adot', 'ypa', 'passer_rating',
        'any_a', 'rush_attempts', 'rush_yards', 'rush_tds', 'rush_epa_per_play',
        'fumbles', 'fumbles_lost',
    ]
```

- [ ] **Step 5: Run fumble tests**

Run: `cd scripts && python -m pytest ../tests/test_formulas.py::TestFumbleAttribution -v`
Expected: 4 PASS

- [ ] **Step 6: Run all tests**

Run: `cd scripts && python -m pytest ../tests/test_formulas.py -v`
Expected: All tests PASS

- [ ] **Step 7: Commit**

```bash
git add scripts/ingest.py
git commit -m "feat: add fumble/fumbles_lost aggregation via fumbled_1_player_id (D-M1)"
```

---

### Task 6: Update schema, types, and queries (D-M1, D-M7, D-M9)

**Files:**
- Modify: `scripts/schema.sql:39-67`
- Modify: `lib/types/index.ts:33-61`
- Modify: `lib/data/queries.ts:79-90`

- [ ] **Step 1: Add fumble columns to schema.sql**

In `scripts/schema.sql`, add before the `UNIQUE(player_id, season)` line:

```sql
  rush_epa_per_play NUMERIC,
  fumbles INTEGER,
  fumbles_lost INTEGER,
  UNIQUE(player_id, season)
```

- [ ] **Step 2: Update TypeScript types — add fumbles + make nullable fields honest**

Replace the `QBSeasonStat` interface in `lib/types/index.ts`:

```typescript
export interface QBSeasonStat {
  id: string;
  player_id: string;
  player_name: string;
  team_id: string;
  season: number;
  games: number;
  completions: number;
  attempts: number;
  dropbacks: number;
  epa_per_db: number | null;
  epa_per_play: number | null;
  cpoe: number | null;
  completion_pct: number;
  success_rate: number | null;
  passing_yards: number;
  touchdowns: number;
  interceptions: number;
  sacks: number;
  sack_yards_lost: number;
  adot: number | null;
  ypa: number;
  passer_rating: number;
  any_a: number;
  rush_attempts: number;
  rush_yards: number;
  rush_tds: number;
  rush_epa_per_play: number | null;
  fumbles: number;
  fumbles_lost: number;
}
```

- [ ] **Step 3: Update getAvailableSeasons to use data_freshness**

Replace the `getAvailableSeasons` function in `lib/data/queries.ts`:

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

- [ ] **Step 4: Commit**

```bash
git add scripts/schema.sql lib/types/index.ts lib/data/queries.ts
git commit -m "feat: add fumble columns to schema/types, nullable fields, seasons query optimization (D-M1, D-M7, D-M9)"
```

---

## Chunk 2: Frontend Changes

### Task 7: QBLeaderboard — getVal helper + sort refactor (D-M5, D-M6, D-M11)

**Files:**
- Modify: `components/tables/QBLeaderboard.tsx`

This task adds the infrastructure (getVal, sort refactor, formatVal updates) that all virtual columns depend on.

- [ ] **Step 1: Add getVal helper function**

In `QBLeaderboard.tsx`, add before the component function (after the `GROUP_COLORS` constant, around line 58):

```typescript
function getVal(qb: QBSeasonStat, key: string): number {
  switch (key) {
    case "yards_per_game": return qb.games ? qb.passing_yards / qb.games : NaN;
    case "tds_per_game": return qb.games ? qb.touchdowns / qb.games : NaN;
    case "total_tds": return qb.touchdowns + qb.rush_tds;
    case "td_int_ratio": return qb.interceptions > 0 ? qb.touchdowns / qb.interceptions : Infinity;
    default: {
      const val = qb[key as keyof QBSeasonStat] as number;
      return val ?? NaN;
    }
  }
}
```

- [ ] **Step 2: Refactor sort comparator to use getVal**

Replace the sort block inside the `useMemo` (lines 88-97):

```typescript
    result.sort((a, b) => {
      const aVal = getVal(a, sortKey);
      const bVal = getVal(b, sortKey);
      const aNull = aVal == null || Number.isNaN(aVal);
      const bNull = bVal == null || Number.isNaN(bVal);
      if (aNull && bNull) return 0;
      if (aNull) return 1;
      if (bNull) return -1;
      return sortDir === "desc" ? bVal - aVal : aVal - bVal;
    });
```

- [ ] **Step 3: Refactor formatVal to accept qb object and handle virtual keys**

Replace the `formatVal` function (lines 110-131):

```typescript
  function formatVal(key: string, qb: QBSeasonStat): string {
    const val = getVal(qb, key);
    if (val == null || (typeof val === "number" && Number.isNaN(val))) return "\u2014";
    const n = val;
    switch (key) {
      case "epa_per_play":
      case "epa_per_db":
      case "cpoe":
      case "adot":
      case "ypa":
      case "any_a":
      case "rush_epa_per_play":
        return n.toFixed(2);
      case "completion_pct":
        return n.toFixed(1);
      case "success_rate":
        return n.toFixed(2);
      case "passer_rating":
        return n.toFixed(1);
      case "yards_per_game":
      case "tds_per_game":
        return n.toFixed(1);
      case "total_tds":
        return n.toString();
      case "td_int_ratio":
        if (!Number.isFinite(n)) return `${qb.touchdowns}:0`;
        return n.toFixed(1) + ":1";
      default:
        return Number.isInteger(n) ? n.toString() : n.toFixed(1);
    }
  }
```

- [ ] **Step 4: Update the cell rendering in the table body**

Replace the entire `{columns.map((col) => { ... })}` block inside `<tbody>` (lines 239-251). Remove the old `const val = qb[col.key as keyof typeof qb]` line — it's replaced by `getVal`:

```typescript
                  {columns.map((col) => (
                    <td
                      key={col.key}
                      className={`px-2 py-2 text-right tabular-nums ${
                        isEpaCol(col.key) ? `font-bold ${epaColor(getVal(qb, col.key))}` : "text-gray-700"
                      }`}
                    >
                      {formatVal(col.key, qb)}
                    </td>
                  ))}
```

The old code had `const val = qb[col.key as keyof typeof qb]` which breaks for virtual keys like `yards_per_game`. Now `getVal` and `formatVal` handle everything.

- [ ] **Step 5: Commit**

```bash
git add components/tables/QBLeaderboard.tsx
git commit -m "refactor: add getVal helper and refactor sort/formatVal for virtual columns"
```

---

### Task 8: QBLeaderboard — add all new columns (D-M1, D-M5, D-M6, D-M8, D-M11)

**Files:**
- Modify: `components/tables/QBLeaderboard.tsx`
- Modify: `app/qb-leaderboard/page.tsx`

- [ ] **Step 1: Add TD:INT to ADVANCED_COLUMNS**

Insert after the `any_a` entry:

```typescript
const ADVANCED_COLUMNS: ColumnDef[] = [
  { key: "games", label: "GP", group: "core" },
  { key: "epa_per_play", label: "EPA/Play", tooltip: "EPA/Play", group: "core" },
  { key: "epa_per_db", label: "EPA/DB", tooltip: "EPA/DB", group: "core" },
  { key: "cpoe", label: "CPOE", tooltip: "CPOE", group: "passing" },
  { key: "success_rate", label: "Success%", tooltip: "Success%", group: "passing" },
  { key: "any_a", label: "ANY/A", tooltip: "ANY/A", group: "efficiency" },
  { key: "td_int_ratio", label: "TD:INT", tooltip: "TD:INT", group: "efficiency" },
  { key: "adot", label: "aDOT", tooltip: "aDOT", group: "efficiency" },
  { key: "rush_epa_per_play", label: "Rush EPA", tooltip: "Rush EPA", group: "rushing" },
];
```

- [ ] **Step 2: Add FL, Yds/G, TD/G, Tot TD to STANDARD_COLUMNS**

```typescript
const STANDARD_COLUMNS: ColumnDef[] = [
  { key: "games", label: "GP", group: "core" },
  { key: "completions", label: "Cmp", group: "passing" },
  { key: "attempts", label: "Att", group: "passing" },
  { key: "completion_pct", label: "Comp%", tooltip: "Comp%", group: "passing" },
  { key: "passing_yards", label: "Yards", group: "passing" },
  { key: "yards_per_game", label: "Yds/G", group: "passing" },
  { key: "touchdowns", label: "TD", group: "passing" },
  { key: "tds_per_game", label: "TD/G", group: "passing" },
  { key: "interceptions", label: "INT", group: "passing" },
  { key: "fumbles_lost", label: "FL", tooltip: "FL", group: "passing" },
  { key: "sacks", label: "Sk", tooltip: "Sk", group: "passing" },
  { key: "sack_yards_lost", label: "Sk Yds", tooltip: "Sk Yds", group: "passing" },
  { key: "ypa", label: "YPA", tooltip: "YPA", group: "efficiency" },
  { key: "passer_rating", label: "Rating", tooltip: "Rating", group: "efficiency" },
  { key: "rush_attempts", label: "Rush Att", tooltip: "Rush Att", group: "rushing" },
  { key: "rush_yards", label: "Rush Yds", group: "rushing" },
  { key: "rush_tds", label: "Rush TD", group: "rushing" },
  { key: "total_tds", label: "Tot TD", group: "rushing" },
];
```

- [ ] **Step 3: Add `season` prop to QBLeaderboard**

Update the interface and component signature:

```typescript
interface QBLeaderboardProps {
  data: QBSeasonStat[];
  throughWeek: number;
  season: number;
}

export default function QBLeaderboard({ data, throughWeek, season }: QBLeaderboardProps) {
```

- [ ] **Step 4: Add 2020 CPOE note**

Inside the methodology `<div>` at the bottom (around line 263), add before the closing `</div>`:

```tsx
        {season === 2020 && (
          <p className="text-amber-600"><span className="font-semibold text-amber-700">Note:</span> 2020 CPOE values may be less reliable due to COVID-impacted season conditions (no preseason, limited practice, opt-outs).</p>
        )}
```

- [ ] **Step 5: Pass season prop from page component**

In `app/qb-leaderboard/page.tsx`, update the QBLeaderboard usage:

```tsx
        <QBLeaderboard
          data={qbStats}
          throughWeek={freshness?.through_week ?? 18}
          season={currentSeason}
        />
```

- [ ] **Step 6: Commit**

```bash
git add components/tables/QBLeaderboard.tsx app/qb-leaderboard/page.tsx
git commit -m "feat: add FL, Yds/G, TD/G, Tot TD, TD:INT columns + 2020 CPOE note (D-M1, D-M5, D-M6, D-M8, D-M11)"
```

---

### Task 9: Tooltip definitions + success rate alignment (D-M1, D-M2, D-M11)

**Files:**
- Modify: `components/ui/MetricTooltip.tsx`
- Modify: `components/charts/TeamScatterPlot.tsx:225-235`

- [ ] **Step 1: Add new tooltip definitions**

In `MetricTooltip.tsx`, add to `METRIC_DEFINITIONS`:

```typescript
  FL: "Fumbles lost. Only counts fumbles recovered by the defense \u2014 the turnovers that actually hurt.",
  "TD:INT":
    "Touchdown to interception ratio. Higher is better. Shows passing TDs only (rushing TDs not included).",
```

- [ ] **Step 2: Update Success% tooltip with team-page note**

Update the `Success%` entry:

```typescript
  "Success%":
    "Percentage of non-sack dropbacks that are successful (gained enough yards for the situation). Sacks excluded because they reflect OL failure, not QB decision-making. Note: Team-level success rate on the scatter plot includes sacks in the denominator.",
```

- [ ] **Step 3: Add "(incl. sacks)" to scatter plot tooltip**

In `TeamScatterPlot.tsx`, in the `showTooltip` function, update the `detailDiv.textContent` line (around line 233-235):

```typescript
        detailDiv.textContent =
          `Pass EPA: ${fmtEpa(d.off_pass_epa)} | Rush EPA: ${fmtEpa(d.off_rush_epa)} | ` +
          `Pass Rate: ${fmtPct(d.pass_rate)} | Success: ${fmtPct(d.off_success_rate)} (incl. sacks)`;
```

- [ ] **Step 4: Commit**

```bash
git add components/ui/MetricTooltip.tsx components/charts/TeamScatterPlot.tsx
git commit -m "feat: add FL/TD:INT tooltips, clarify success rate methodology (D-M1, D-M2, D-M11)"
```

---

### Task 10: MobileTeamList enhanced metrics (D-M10)

**Files:**
- Modify: `components/charts/MobileTeamList.tsx`

- [ ] **Step 1: Add helper functions and detail row**

Add helper functions before the component (after the `getQuadrant` function):

```typescript
const fmtEpa = (v: number) => isNaN(v) ? "\u2014" : v.toFixed(3);
const fmtPct = (v: number) => isNaN(v) ? "\u2014" : (v * 100).toFixed(1) + "%";
```

Then add a detail row inside each team card, after the Def EPA `<span>`:

```tsx
                  <span className="text-xs tabular-nums font-medium" style={{
                    color: t.def_epa_play < 0 ? "#16A34A" : "#DC2626"
                  }}>
                    Def: {t.def_epa_play > 0 ? "+" : ""}{t.def_epa_play.toFixed(3)}
                  </span>
                </div>
                <div className="text-[11px] text-gray-400 tabular-nums pl-6">
                  Pass EPA: {fmtEpa(t.off_pass_epa)} | Rush EPA: {fmtEpa(t.off_rush_epa)} | Pass Rate: {fmtPct(t.pass_rate)} | Success: {fmtPct(t.off_success_rate)}
                </div>
```

Note: The detail row goes inside the `<div key={t.team_id}>` but after the closing `</div>` of the flex row. The parent container for each team needs to change from a single flex row to a wrapper div.

Full replacement for the team card rendering:

```tsx
              {teams.map((t) => {
                const team = getTeam(t.team_id);
                return (
                  <div key={t.team_id} className="py-2 px-3 bg-gray-50 rounded-md">
                    <div className="flex items-center gap-3">
                      <div
                        className="w-3 h-3 rounded-full flex-shrink-0"
                        style={{ backgroundColor: getTeamColor(t.team_id) }}
                      />
                      <span className="text-sm font-medium text-navy flex-1">
                        {team?.name ?? t.team_id}
                      </span>
                      <span className="text-xs text-gray-500 tabular-nums">
                        {t.wins}-{t.losses}{t.ties > 0 ? `-${t.ties}` : ""}
                      </span>
                      <span className="text-xs tabular-nums font-medium" style={{
                        color: t.off_epa_play > 0 ? "#16A34A" : "#DC2626"
                      }}>
                        Off: {t.off_epa_play > 0 ? "+" : ""}{t.off_epa_play.toFixed(3)}
                      </span>
                      <span className="text-xs tabular-nums font-medium" style={{
                        color: t.def_epa_play < 0 ? "#16A34A" : "#DC2626"
                      }}>
                        Def: {t.def_epa_play > 0 ? "+" : ""}{t.def_epa_play.toFixed(3)}
                      </span>
                    </div>
                    <div className="text-[11px] text-gray-400 tabular-nums pl-6 mt-0.5">
                      Pass EPA: {fmtEpa(t.off_pass_epa)} | Rush EPA: {fmtEpa(t.off_rush_epa)} | Pass Rate: {fmtPct(t.pass_rate)} | Success: {fmtPct(t.off_success_rate)}
                    </div>
                  </div>
                );
              })}
```

- [ ] **Step 2: Commit**

```bash
git add components/charts/MobileTeamList.tsx
git commit -m "feat: add pass/rush EPA, pass rate, success rate to MobileTeamList (D-M10)"
```

---

## Chunk 3: Build, Verify, Deploy

### Task 11: Build + type-check

**Files:** None (verification only)

- [ ] **Step 1: Run TypeScript compiler**

Run: `cd "C:/Users/jonra/OneDrive/Desktop/claude sandbox/football website/yards-per-pass" && npx tsc --noEmit`
Expected: No errors. If there are type errors from the nullable changes (D-M9), fix them.

- [ ] **Step 2: Run Next.js build**

Run: `cd "C:/Users/jonra/OneDrive/Desktop/claude sandbox/football website/yards-per-pass" && npx next build`
Expected: Build succeeds with no errors.

- [ ] **Step 3: Run all Python tests**

Run: `cd "C:/Users/jonra/OneDrive/Desktop/claude sandbox/football website/yards-per-pass/scripts" && python -m pytest ../tests/test_formulas.py -v`
Expected: All 20 tests PASS.

- [ ] **Step 4: Fix any issues and commit**

```bash
git add -A
git commit -m "fix: resolve build/type errors from Phase 2 changes"
```

---

### Task 12: Dry-run verification + sample logging

**Files:**
- Modify: `scripts/ingest.py` (temporary logging, remove after verification)

- [ ] **Step 1: Add sample QB logging to process_season**

In `scripts/ingest.py`, in `process_season` after `validate_data(team_stats, qb_stats)` (line 560), add:

```python
    # Temporary: log sample QBs for verification
    sample = qb_stats.nlargest(5, 'attempts')[
        ['player_name', 'team_id', 'fumbles', 'fumbles_lost', 'adot', 'attempts',
         'touchdowns', 'interceptions', 'passing_yards']
    ]
    for _, row in sample.iterrows():
        td_int = f"{row['touchdowns']/row['interceptions']:.1f}:1" if row['interceptions'] > 0 else f"{row['touchdowns']}:0"
        log.info(
            "QB Sample: %s (%s) — fum=%d, fum_lost=%d, aDOT=%.2f, att=%d, TD:INT=%s",
            row['player_name'], row['team_id'],
            row['fumbles'], row['fumbles_lost'],
            row['adot'] if pd.notna(row['adot']) else 0,
            row['attempts'], td_int
        )
```

- [ ] **Step 2: Run dry-run for 2025**

Run: `cd "C:/Users/jonra/OneDrive/Desktop/claude sandbox/football website/yards-per-pass/scripts" && python ingest.py --season 2025 --dry-run`

Expected output: 5 QB samples with reasonable values:
- Fumbles: 0-15 range
- aDOT: 5.0-12.0 range
- TD:INT: 1.0:1 to 5.0:1 range (or X:0)

- [ ] **Step 3: Inspect output for outliers**

Check: No fumbles > 20, no aDOT < 3 or > 15, no negative values where positive expected.

- [ ] **Step 4: Remove temporary logging and commit**

Remove the sample logging block added in Step 1, then:

```bash
git add scripts/ingest.py
git commit -m "chore: verify dry-run output for Phase 2 pipeline changes"
```

---

### Task 13: Post-implementation — DB migration + re-ingest + PFR verification

This task requires manual steps that the implementer performs interactively.

- [ ] **Step 1: Record pre-ingest baseline**

Run this SQL in Supabase SQL Editor:
```sql
SELECT player_name, attempts, passing_yards, touchdowns, interceptions, sacks, passer_rating, epa_per_db, adot
FROM qb_season_stats
WHERE player_name IN ('J.Allen', 'L.Jackson', 'P.Mahomes', 'J.Goff', 'C.Stroud')
AND season = 2025
ORDER BY player_name;
```
Save the results.

- [ ] **Step 2: Run ALTER TABLE for new columns**

Run in Supabase SQL Editor:
```sql
ALTER TABLE qb_season_stats ADD COLUMN IF NOT EXISTS fumbles INTEGER;
ALTER TABLE qb_season_stats ADD COLUMN IF NOT EXISTS fumbles_lost INTEGER;
```

- [ ] **Step 3: Re-ingest all seasons**

Run: `cd "C:/Users/jonra/OneDrive/Desktop/claude sandbox/football website/yards-per-pass/scripts" && python ingest.py --all`

- [ ] **Step 4: Regression check — compare pre/post values**

Run the same SQL from Step 1. Compare:
- `attempts`, `passing_yards`, `touchdowns`, `interceptions`, `sacks`, `passer_rating`, `epa_per_db` should be IDENTICAL
- `adot` will change (D-M3 fix) — this is expected
- `fumbles` and `fumbles_lost` should now have values

- [ ] **Step 5: PFR cross-reference for fumbles + aDOT**

For each of the 6 QBs in the verification plan, look up their 2025 stats on Pro Football Reference and compare:
- Fumbles: within ±1 of PFR
- Fumbles lost: within ±1 of PFR
- aDOT: within ±0.3 of PFR/Next Gen Stats

If any stat is outside tolerance, investigate the discrepancy before proceeding.

- [ ] **Step 6: Trigger ISR revalidation**

Run: `curl -X POST "https://yards-per-pass.vercel.app/api/revalidate" -H "x-revalidate-secret: <secret>"`

- [ ] **Step 7: Frontend spot-check on live site**

Open https://yards-per-pass.vercel.app/qb-leaderboard and verify:
- FL column shows values
- Yds/G = Yards / GP (calculator check for any QB)
- TD/G = TD / GP
- Total TD = Pass TD + Rush TD
- TD:INT = TD / INT (or "X:0" for 0 INT)
- aDOT values look reasonable (5-12 range)
- Switch to 2020: CPOE note appears
- Mobile: team list shows expanded metrics

- [ ] **Step 8: Push and commit verification notes**

```bash
git push origin main
```
