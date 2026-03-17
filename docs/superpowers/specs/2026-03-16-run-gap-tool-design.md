# Run Gap Tool — Design Specification

## Overview

A new `/run-gaps` page showing rushing EPA broken down by 7 offensive line gaps (LE, LT, LG, M, RG, RT, RE) with an interactive formation diagram, player drill-down cards, and team color theming. Built in two phases: v1 (core tool) and v2 (matchup layer + advanced filters).

**Target audience:** Fantasy football players and sports bettors who want gap-level rushing analytics.

**Data source:** nflverse play-by-play `run_location` + `run_gap` columns. Filter: `rush_attempt == 1 & qb_scramble != 1` (designed runs only, no scrambles). ~85-90% of rush plays have gap data; 10-15% null excluded from gap view but included in header totals.

---

## v1 Features (Core Tool)

### Page Structure

**Route:** `/run-gaps` — standalone page with its own nav link ("Run Gaps" in Navbar).

**Header area (split layout):**
- Top bar: team dropdown (left), season dropdown (right)
- Below: left = team logo + team name in team primary color; right = high-level rushing stats (total rush EPA, EPA rank among 32 teams, yards/carry, total carries, left/right tendency split e.g. "Left 54% | Right 46%")

**URL state:** `?team=BUF&season=2025&gap=LG` — team, season, and selected gap all persisted in URL via `useSearchParams()`. Shareable links. Default: no team selected (show prompt to pick one), current season, no gap expanded.

### Formation Diagram

**SVG top-down view, ~600×400 viewBox:**
- 5 O-line circles (LT, LG, C, RG, RT) in navy with white position labels — NO tight ends (football-inaccurate as a static default)
- RB circle below center in team primary color
- 7 gap labels above the formation line (LE, LT, LG, M, RG, RT, RE) in team primary color, clickable
- Bezier curve arrows from RB to each gap:
  - Thickness = carry volume (scaled relative to team's max gap)
  - Color = EPA (green = positive, red = negative, amber = neutral)
  - No opacity variable — fixed opacity for all arrows
  - Numeric EPA label near each arrow endpoint (small, muted text)
- Hover/focus state: hovering a gap dims all other arrows to 15% opacity, isolating the selected gap
- Click a gap label → scrolls to and expands the player drill-down below, updates `?gap=` URL param
- Low sample treatment: <5 carries in a gap = thin gray dashed arrow + "Low sample" tooltip

**Mobile (<640px):** Replace formation diagram with horizontal bar chart. Each row = one gap, bar length = carry share, bar color = EPA. Tap a bar to drill down. Same pattern as existing `TeamScatterPlot` (desktop) / `MobileTeamList` (mobile) toggle using `hidden md:block` / `md:hidden`.

### Player Drill-Down (Cards)

Expands below the diagram when a gap is clicked.

**Header bar:** Gap name + total carries + aggregate EPA/carry + league rank for that gap.

**Card grid:** 3 across on desktop, 1-column stack on mobile. Each card contains:
- Player name
- Carry count
- EPA-vs-team-average divergence bar (centered at 0, green right / red left)
- 2×2 stat grid: yards/carry, success rate, stuff rate, explosive run rate (10+ yards)

**Sorting:** By carries descending.

**Min carry threshold:** Dropdown (5/10/15/20), default 10. Filters client-side.

**Empty state:** "No players meet the minimum carry threshold" with prompt to lower it.

### League-Average Baselines

Every EPA metric shows league average as reference + rank indicator:
- Gap-level: each arrow/label shows "Rank Nth of 32" on hover or inline
- Header rushing stats: show league rank next to each number
- Player cards: EPA divergence bar is relative to team average for that gap
- Computed at query time via SQL window functions (no extra table needed)

### Additional v1 Features

**Explosive run rate:** New column in `rb_gap_stats` — proportion of carries gaining 10+ yards. Shown in player cards.

**Data disclaimer footnote:** Bottom of page — "Gap data reflects ball carrier destination, not designed play direction. Source: nflverse play-by-play (~85-90% of rush plays have gap data). Stats may differ from PFF/TruMedia due to methodology differences."

**Loading/skeleton states:** `app/run-gaps/loading.tsx` with pulsing gray O-line circles and placeholder cards. `app/run-gaps/error.tsx` with retry prompt. Follow existing `qb-leaderboard/loading.tsx` pattern.

**CSV export:** Small download button on the player drill-down section. Client-side Blob URL creation from already-fetched data.

**Hover/focus interaction:** D3 `mouseenter`/`mouseleave` on arrows — dims non-hovered arrows to 15% opacity.

**Sitemap:** Add `/run-gaps` entry (weekly, priority 0.8).

**Glossary:** Add "Run Gap", "Stuff Rate", "Explosive Run Rate" definitions.

---

## v2 Features (Matchup Layer + Advanced Filters)

### Recent Form Toggle

**Toggle:** "Last 4 weeks" vs "Full season" switch above the diagram.

**DB requirement:** New `rb_gap_stats_weekly` table — one row per player × team × gap × week × season. ~61,000 rows per season (3,600 × 17 weeks). "Last 4 weeks" computed at query time by filtering to max 4 weeks and aggregating.

**Ingest:** New function in `ingest.py` that aggregates per-week instead of per-season.

### Defensive Matchup Layer

**The killer feature.** When activated, shows the opposing defense's gap-level EPA alongside the offense.

**New DB table:** `def_gap_stats` — one row per team × gap × season. Columns: `team_id`, `season`, `gap`, `carries_faced`, `def_epa_per_carry`, `def_yards_per_carry`, `def_success_rate`, `def_stuff_rate`, `def_explosive_rate`. ~224 rows per season (32 teams × 7 gaps).

**UI:** "Matchup mode" toggle or opponent dropdown. When active:
- Formation diagram shows split arrows or side-by-side indicators per gap: offense EPA (top) vs defense EPA allowed (bottom)
- Color coding highlights exploitable mismatches (offense positive + defense also positive = green highlight)
- Header shows matchup summary: "Offense runs +0.08 EPA at LG, opponent allows +0.05 EPA there"

**Ingest:** New `process_def_gap_stats()` function grouping by `defteam` + `run_gap` + `run_location`.

### League-Wide Heatmap

**Entry point page** or section at `/run-gaps` when no team is selected.

**32-team × 7-gap matrix:** Each cell colored by EPA (green/red gradient). Sortable by any gap column. Click a team row to jump to their formation diagram view.

**Data:** Aggregated from `rb_gap_stats` grouped by team + gap. No new table needed.

### Down/Distance Filter

**Dropdown:** "All downs" / "Early downs (1st-2nd)" / "Short yardage (3rd/4th, ≤2 yds)" / "Passing downs (2nd/3rd long)"

**DB requirement:** Add `situation` column to `rb_gap_stats_weekly` table (or create separate `rb_gap_stats_situational`). Triples row count per situation bucket.

**Ingest:** Define situation buckets from `down` + `ydstogo` columns in nflverse PBP. Aggregate separately per situation.

**Sample size warning:** When a gap × situation × player combination has <5 carries, show warning indicator.

### Red Zone / Goal-Line Filter

**Toggle:** "All field" / "Red zone (inside 20)" / "Goal line (inside 5)"

**DB requirement:** Same situational split approach as down/distance. Uses `yardline_100` column from nflverse.

**Sample size:** Red zone + specific gap + specific player will often be single digits. Prominent sample size warnings.

---

## Technical Architecture

### New Files
- `app/run-gaps/page.tsx` — server component, data fetching, renders layout
- `app/run-gaps/loading.tsx` — skeleton state
- `app/run-gaps/error.tsx` — error boundary
- `components/charts/RunGapDiagram.tsx` — client component, D3 SVG formation + arrows
- `components/charts/GapBarChart.tsx` — client component, mobile bar chart alternative
- `components/charts/PlayerGapCards.tsx` — client component, expandable card grid
- `components/charts/GapHeatmap.tsx` — client component, v2 league-wide matrix
- `lib/data/run-gaps.ts` — Supabase query functions for gap data (follows `lib/data/queries.ts` convention)

### Modified Files
- `scripts/ingest.py` — new `process_rb_gap_stats()`, `process_rb_gap_stats_weekly()`, `process_def_gap_stats()` functions + table creation
- `components/layout/Navbar.tsx` — add "Run Gaps" to NAV_LINKS
- `app/sitemap.ts` — add `/run-gaps` entry
- `app/glossary/page.tsx` — add Run Gap, Stuff Rate, Explosive Run Rate terms
- `lib/types/index.ts` — add `RBGapStat`, `RBGapStatWeekly`, `DefGapStat` interfaces

### Database Tables

**`rb_gap_stats`** (v1):
```sql
CREATE TABLE rb_gap_stats (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id TEXT NOT NULL,
  player_name TEXT NOT NULL,
  team_id TEXT NOT NULL REFERENCES teams(id),
  season INT NOT NULL,
  gap TEXT NOT NULL,  -- LE/LT/LG/M/RG/RT/RE
  carries INT NOT NULL,
  epa_per_carry NUMERIC,
  yards_per_carry NUMERIC,
  success_rate NUMERIC,
  stuff_rate NUMERIC,
  explosive_rate NUMERIC,
  UNIQUE (player_id, team_id, season, gap)
);
ALTER TABLE rb_gap_stats ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public_read" ON rb_gap_stats FOR SELECT USING (true);
```

**`rb_gap_stats_weekly`** (v2):
```sql
CREATE TABLE rb_gap_stats_weekly (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id TEXT NOT NULL,
  player_name TEXT NOT NULL,
  team_id TEXT NOT NULL REFERENCES teams(id),
  season INT NOT NULL,
  week INT NOT NULL,
  gap TEXT NOT NULL,
  situation TEXT NOT NULL DEFAULT 'all',  -- all/early/short_yardage/passing
  field_zone TEXT NOT NULL DEFAULT 'all', -- all/redzone/goalline
  carries INT NOT NULL,
  epa_per_carry NUMERIC,
  yards_per_carry NUMERIC,
  success_rate NUMERIC,
  stuff_rate NUMERIC,
  explosive_rate NUMERIC,
  UNIQUE (player_id, team_id, season, week, gap, situation, field_zone)
);
ALTER TABLE rb_gap_stats_weekly ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public_read" ON rb_gap_stats_weekly FOR SELECT USING (true);
```

Row count estimate: ~61,000 rows/season at v2 launch (situation='all', field_zone='all' only). When down/distance and red zone filters ship, expands to ~734,000 rows/season (4 situations × 3 field zones × 17 weeks × ~150 player-team-gap combos).

**`def_gap_stats`** (v2):
```sql
CREATE TABLE def_gap_stats (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id TEXT NOT NULL REFERENCES teams(id),
  season INT NOT NULL,
  gap TEXT NOT NULL,
  carries_faced INT NOT NULL,
  def_epa_per_carry NUMERIC,
  def_yards_per_carry NUMERIC,
  def_success_rate NUMERIC,
  def_stuff_rate NUMERIC,
  def_explosive_rate NUMERIC,
  UNIQUE (team_id, season, gap)
);
ALTER TABLE def_gap_stats ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public_read" ON def_gap_stats FOR SELECT USING (true);
```

**TypeScript interfaces** (add to `lib/types/index.ts`):
```typescript
export interface RBGapStat {
  id: string;
  player_id: string;
  player_name: string;
  team_id: string;
  season: number;
  gap: string;
  carries: number;
  epa_per_carry: number | null;
  yards_per_carry: number | null;
  success_rate: number | null;
  stuff_rate: number | null;
  explosive_rate: number | null;
}

export interface RBGapStatWeekly extends RBGapStat {
  week: number;
  situation: string;
  field_zone: string;
}

export interface DefGapStat {
  id: string;
  team_id: string;
  season: number;
  gap: string;
  carries_faced: number;
  def_epa_per_carry: number | null;
  def_yards_per_carry: number | null;
  def_success_rate: number | null;
  def_stuff_rate: number | null;
  def_explosive_rate: number | null;
}
```

### Patterns Followed
- Server component fetches → passes props to client components (same as teams/QB pages)
- D3.js for SVG rendering (same as TeamScatterPlot)
- `page.tsx` is a server component that reads `searchParams` from page props (same as `app/teams/page.tsx`). Client components like `RunGapDiagram.tsx` use `useSearchParams()` for interactive URL updates.
- Module-level Supabase singleton (same as server.ts)
- Team colors from existing `teams` table
- Desktop/mobile component toggle via Tailwind breakpoint classes
- `ingest.py` patterns: psycopg2, upsert with ON CONFLICT, @retry decorator, stale row cleanup outside retry
- Each new `process_*` function must have a corresponding `cleanup_stale_rows` call (outside @retry) to remove rows for traded/released players, matching the existing pattern
- Multi-team RBs: schema stores separate rows per team via `(player_id, team_id)` — a player traded mid-season appears under both teams with their respective stats
- League rank for header rushing stats: use `team_season_stats.off_rush_epa` (already exists) with SQL `RANK() OVER(ORDER BY off_rush_epa DESC)`; gap-level ranks use `rb_gap_stats` aggregated by team+gap with `RANK()` window function

### Gap Mapping Logic (ingest.py)
```python
# nflverse columns: run_location (left/middle/right), run_gap (end/tackle/guard)
GAP_MAP = {
    ('left', 'end'): 'LE',
    ('left', 'tackle'): 'LT',
    ('left', 'guard'): 'LG',
    ('middle', None): 'M',      # middle runs often have no gap
    ('middle', 'guard'): 'M',   # middle/guard = center gap
    ('middle', 'tackle'): 'M',  # rare, treat as middle
    ('right', 'guard'): 'RG',
    ('right', 'tackle'): 'RT',
    ('right', 'end'): 'RE',
}
# Filter: rush_attempt == 1 & qb_scramble != 1 & (run_gap.notna() | run_location == 'middle')
# Kneels already excluded by existing filter_plays() which keeps only play_type in ['pass', 'run']
# Note: run_location/run_gap columns validated at top of process_rb_gap_stats() only,
# NOT added to global REQUIRED_PBP_COLS (they're nullable and may not exist in old seasons)
```

### No New Dependencies
D3.js already installed. All existing patterns reused.

---

## Chunked Implementation Order

### Chunk 1: Data Pipeline (testable independently)
- `rb_gap_stats` table creation + `process_rb_gap_stats()` in ingest.py
- Gap mapping logic + filters
- Verify with pytest: correct row counts, gap distribution, null handling
- Run ingest for 2024 season, verify data in Supabase

### Chunk 2: Core Page + Diagram (testable with real data)
- `app/run-gaps/page.tsx` server component + data fetching
- `lib/data/run-gaps.ts` queries
- `lib/types/index.ts` — add `RBGapStat` interface
- `RunGapDiagram.tsx` — SVG formation with arrows
- `loading.tsx` / `error.tsx`
- Navbar + sitemap updates
- Test: page loads, diagram renders, arrows reflect data

### Chunk 3: Player Drill-Down + Polish (testable end-to-end)
- `PlayerGapCards.tsx` — card grid with drill-down
- URL state (`?team=&season=&gap=`)
- League-average baselines + rank
- Left/right tendency header
- Hover/focus arrow dimming
- CSV export
- Data disclaimer + glossary terms
- Test: full user flow — pick team, see diagram, click gap, see players

### Chunk 4: Mobile + Responsive (testable on device)
- `GapBarChart.tsx` — mobile bar chart alternative
- Responsive breakpoint toggle
- Card stacking, dropdown stacking
- Test: full flow on 375px viewport

### Chunk 5: Weekly Data Pipeline (v2 foundation)
- `rb_gap_stats_weekly` table + `process_rb_gap_stats_weekly()` in ingest.py
- Situational splits (down/distance + field zone)
- Verify with pytest
- Run ingest, verify weekly data in Supabase

### Chunk 6: Recent Form + Filters (testable with weekly data)
- Recent form toggle (4wk vs full season)
- Down/distance filter dropdown
- Red zone / goal-line filter
- Sample size warnings
- Test: toggle filters, verify data updates, check thin sample handling

### Chunk 7: Defensive Data + Matchup (testable independently)
- `def_gap_stats` table + `process_def_gap_stats()` in ingest.py
- Verify with pytest
- Defensive matchup UI — opponent dropdown, split arrows, mismatch highlighting
- Test: pick offense + defense, verify matchup overlay

### Chunk 8: League Heatmap (testable independently)
- `GapHeatmap.tsx` — 32×7 matrix
- Sorting by gap column
- Click-to-navigate to team view
- Test: heatmap renders, sorting works, navigation works

---

## Killed Features
- **Yards before contact:** nflverse doesn't have this data (NFL Next Gen Stats only)
- **Auto-generated insights:** All football reviewers said skip or "be very careful" — cut
- **Personnel grouping filter:** Deferred to v3 (string parsing + thin sample sizes)
- **Week-range selector + sparklines:** Deferred to v3 (incremental on weekly data)
- **Opponent schedule lookahead:** Deferred to v3 (depends on defensive matchup + schedule table)
