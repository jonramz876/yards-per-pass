# Spec: Situational Efficiency Dashboard on Team Pages

## Goal
Show team-level offensive efficiency across game situations at a glance. rbsdm-style: one prominent card answering "where is this team good/bad situationally?" Covers both passing AND rushing (not just rushing from existing gap data).

## Data Pipeline

### New aggregation in `ingest.py`
Function: `aggregate_team_situational_stats(pbp, season)`

Filter: all offensive plays (`play_type in ('pass', 'run')`), exclude specials/penalties.

Situations (same bins as existing gap stats):
- `all` — all plays
- `early_down` — down 1-2
- `short_yardage` — down 3-4 AND ydstogo <= 2
- `passing_down` — (down 2 & ydstogo >= 7) OR (down 3 & ydstogo >= 5)
- `redzone` — yardline_100 <= 20
- `goalline` — yardline_100 <= 5

Group by: `team_id`, `season`, `situation`

Compute per group (split by play_type AND combined):
- `plays` (count)
- `epa_per_play` (mean epa)
- `success_rate` (mean of epa > 0)
- `pass_rate` (fraction of pass plays)
- `rush_epa_per_play`, `pass_epa_per_play` (split)
- `rush_success_rate`, `pass_success_rate` (split)

### New DB table: `team_situational_stats`
Columns: team_id, season, situation, plays, epa_per_play, success_rate, pass_rate, rush_epa_per_play, pass_epa_per_play, rush_success_rate, pass_success_rate
Unique constraint: (team_id, season, situation)
RLS enabled, index on (season, team_id)

### League averages
Include team_id = 'NFL' rows for league-wide averages per situation.

### Pipeline integration
- Add `ensure_team_situational_table()` (NOT @retry)
- Add `upsert_team_situational_stats()` (WITH @retry)
- Add to `cleanup_stale_rows()`
- Call from main pipeline

## Frontend

### Data layer: `lib/data/team-hub.ts`
Add `getTeamSituationalStats(teamId, season)` query.
Add league averages query. Add to `TeamHubData` and `getTeamHubData()`.

### TypeScript type
```typescript
interface TeamSituationalStat {
  team_id: string;
  season: number;
  situation: string;
  plays: number;
  epa_per_play: number;
  success_rate: number;
  pass_rate: number;
  rush_epa_per_play: number;
  pass_epa_per_play: number;
  rush_success_rate: number;
  pass_success_rate: number;
}
```

### Component: `components/team/SituationalDashboard.tsx`
Layout: 6 situation cards in a responsive grid (2x3 desktop, 1x6 mobile).

Each card shows:
- Situation label (e.g., "Early Downs", "Red Zone")
- Play count
- Overall EPA/play with color indicator (green=above avg, red=below)
- Split bars: Rush EPA vs Pass EPA (horizontal divergence bars)
- Success rate percentage
- Pass rate percentage
- Rank vs league (1-32, computed client-side from NFL avg + all teams data)
- Delta vs league average (e.g., "+0.05 vs NFL")

Color coding:
- Card border-left color: green (top 10), gray (middle), red (bottom 10) based on EPA rank
- EPA values: green positive, red negative

### Integration
- Add as new section in team hub after DefenseSection (before DivisionRivals)
- Section title: "Situational Efficiency"
- Add glossary entries for each situation definition

## Tests
- Pipeline: 6+ pytest tests (situation classification, aggregation, league avg, edge cases)
- Frontend: verify component renders, handles empty data, rank computation

## Files Changed
- `scripts/ingest.py` — new aggregation + DB functions
- `lib/types/index.ts` — TeamSituationalStat interface
- `lib/data/team-hub.ts` — query + integration
- `components/team/SituationalDashboard.tsx` — NEW component
- `app/team/[team_id]/page.tsx` — wire in new section
- `tests/test_situational.py` — NEW test file
- `app/glossary/page.tsx` — new entries
