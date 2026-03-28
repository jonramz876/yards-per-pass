# Spec: Rushing EPA by Down x Distance Heatmap

## Goal
Show how a team (and individual RBs) perform on rushing plays across down and distance situations. 4x5 heatmap: rows = downs 1-4, columns = distance buckets. rbsdm-style: chart is the hero, minimal chrome, one question answered clearly.

## Data Pipeline

### New aggregation in `ingest.py`
Function: `aggregate_team_down_distance_stats(pbp, season)`

Filter: `play_type == 'run'`, exclude QB scrambles (`qb_scramble != 1`), exclude penalties, require valid `down` and `ydstogo`.

Distance bins:
- `1-2` (short yardage)
- `3-4`
- `5-7`
- `8-10`
- `11+`

Group by: `team_id`, `season`, `down` (1-4), `distance_bin`

Compute per group:
- `carries` (count)
- `epa_sum` (sum of epa)
- `epa_per_carry` (mean epa)
- `success_rate` (mean of epa > 0)
- `yards_per_carry` (mean rushing_yards)
- `stuff_rate` (yards_gained <= 0)
- `explosive_rate` (yards_gained >= 10)

### New DB table: `team_down_distance_stats`
Columns: team_id, season, down, distance_bin, carries, epa_sum, epa_per_carry, success_rate, yards_per_carry, stuff_rate, explosive_rate
Unique constraint: (team_id, season, down, distance_bin)
RLS enabled, index on (season, team_id)

### Pipeline integration
- Add `ensure_team_down_distance_table()` (NOT @retry)
- Add `upsert_team_down_distance_stats()` (WITH @retry)
- Add to `cleanup_stale_rows()` for team_ids
- Call from main pipeline after gap stats

## Frontend

### Data layer: `lib/data/team-hub.ts`
Add `getTeamDownDistanceStats(teamId, season)` query.
Add to `TeamHubData` interface and `getTeamHubData()` fetch.

### TypeScript type
```typescript
interface TeamDownDistanceStat {
  team_id: string;
  season: number;
  down: number;
  distance_bin: string;
  carries: number;
  epa_per_carry: number;
  success_rate: number;
  yards_per_carry: number;
  stuff_rate: number;
  explosive_rate: number;
}
```

### Component: `components/team/DownDistanceHeatmap.tsx`
- 4 rows (Down 1-4) x 5 columns (distance bins)
- Cell color: divergent EPA scale (red → white → green), same as existing heatmap style
- Cell content: EPA/carry value + carry count in smaller text
- Row/column headers
- Toggle: EPA/Carry (default) | Success% | YPC
- Low sample warning: cells with <5 carries shown as dashed border, muted
- League average overlay: small indicator showing league avg for that cell
- Title: "Rushing Efficiency by Down & Distance"
- Responsive: stacks or scrolls on mobile

### Integration
- Add as new section in team hub between GroundGameSection and DefenseSection
- Add to revalidation webhook paths
- Add glossary entry for "Down & Distance Heatmap"

### League averages
Compute league-wide averages per (down, distance_bin) cell for context. Either:
- Fetch all teams and compute client-side (32 rows x 20 cells = 640 rows, fine)
- OR add a league_avg row in pipeline (team_id = 'NFL')

Going with pipeline approach (team_id = 'NFL' row) for consistency with existing patterns.

## Tests
- Pipeline: 8+ pytest tests (bin mapping, aggregation, edge cases, NFL avg row)
- Frontend: verify component renders, handles empty data, metric toggle works

## Files Changed
- `scripts/ingest.py` — new aggregation + DB functions
- `scripts/schema.sql` — document new table
- `lib/types/index.ts` — TeamDownDistanceStat interface
- `lib/data/team-hub.ts` — query + integration
- `components/team/DownDistanceHeatmap.tsx` — NEW component
- `app/team/[team_id]/page.tsx` — wire in new section
- `tests/test_down_distance.py` — NEW test file
- `app/glossary/page.tsx` — new entry
- `app/api/revalidate/route.ts` — already covers /team/*
