# Data & Analytics Review Findings
**Date:** 2026-03-15
**Reviewers:** 15 experts across 3 independent teams (NFL Statistician, Sports Analytics Researcher, Fantasy Football Analyst, Data Engineer, Data Quality/QA Analyst x3)
**Status:** All 15 reviewers reached 100% consensus

---

## CRITICAL (3) — Must fix before launch

### C1: ANY/A formula missing sack yards lost
- **File:** `scripts/ingest.py` line 254
- **Problem:** Code computes `(yards + 20*TD - 45*INT) / (att + sacks)` but real ANY/A is `(yards + 20*TD - 45*INT - sack_yards_lost) / (att + sacks)`. The label says ANY/A but the formula isn't ANY/A.
- **Impact:** Every QB's ANY/A is systematically inflated. ~0.5 pts for sack-heavy QBs. Anyone cross-referencing with PFR/ESPN will see discrepancies immediately.
- **Fix:** Aggregate `yards_gained` on sack plays per QB (negative on sacks in nflverse), subtract from numerator. OR rename column to "Modified AY/A" with a tooltip explaining the deviation.

### C2: Zero tests in the entire project
- **File:** Project-wide
- **Problem:** No golden-value tests, no unit tests, no integration tests. No `tests/` directory, no pytest, no jest.
- **Impact:** Any code change could silently break passer rating, EPA aggregation, or any formula. One wrong number goes viral on NFL Twitter and credibility is gone.
- **Fix:** Add pytest with golden-value tests: `passer_rating()` for 3-5 known stat lines, team EPA for 1 known season, QB EPA/DB for top-5 QBs of 1 season. At minimum 5-10 tests before launch.

### C3: EPA/DB denominator mismatch
- **File:** `scripts/ingest.py` lines 204, 251
- **Problem:** `dropback_count` uses `('game_id', 'count')` (counts ALL rows including NaN-EPA plays). `dropback_epa_sum` uses `('epa', 'sum')` (skips NaN). The resulting `epa_per_db = sum/count` has a denominator that's too large.
- **Impact:** For a QB with 600 dropbacks and 2 NaN-EPA plays, error is ~0.003 EPA/DB — exceeds the ±0.001 spec.
- **Fix:** Use `('epa', 'mean')` directly for epa_per_db, or use `('epa', 'count')` for the denominator.

---

## HIGH (7) — Fix before or immediately after launch

### H1: Scramble backfill overwrites valid passer_player_id
- **File:** `scripts/ingest.py` lines 194-200
- **Problem:** Unconditionally sets `passer_player_id = rusher_player_id` on ALL scrambles. If `rusher_player_id` is NaN on a scramble (rare — ~5-10/season), the QB's play is lost from all groupby aggregations (pandas drops NaN keys).
- **Fix:** Use `fillna()` instead of unconditional overwrite:
  ```python
  dropbacks.loc[scramble_mask, 'passer_player_id'] = (
      dropbacks.loc[scramble_mask, 'passer_player_id'].fillna(
          dropbacks.loc[scramble_mask, 'rusher_player_id']
      )
  )
  ```

### H2: Scramble yards inconsistency — rush_tds includes scrambles, rush_yards does not
- **File:** `scripts/ingest.py` lines 267-294
- **Problem:** `rush_tds` includes scramble TDs (line 294), but `rush_yards` only counts designed rushes (line 276). Josh Allen's rush yards could be off by 200-400 yards vs ESPN/NFL.com.
- **Fix:** Either add scramble yards to `rush_yards` (to match box scores) OR remove scramble TDs from `rush_tds` (for analytics purity). Recommend adding scramble yards for user trust.

### H3: CURRENT_SEASON hardcoded to 2025
- **File:** `scripts/ingest.py` line 45, `.github/workflows/data-refresh.yml` line 12
- **Problem:** Must be manually changed in BOTH files when 2026 season starts. If forgotten, site silently stops updating.
- **Fix:** Auto-detect: `datetime.now().year if datetime.now().month >= 3 else datetime.now().year - 1` in ingest.py. Use a script or dynamic variable in the workflow.

### H4: No transaction wrapping across upserts
- **File:** `scripts/ingest.py` lines 485-488
- **Problem:** Each upsert function commits independently. If `upsert_qb_stats()` fails after `upsert_team_stats()` succeeds, database has inconsistent data for that season.
- **Fix:** Remove individual `conn.commit()` calls from each function. Add a single `conn.commit()` after all upserts succeed, with rollback on failure.

### H5: No data validation before DB write
- **File:** `scripts/ingest.py` upsert functions
- **Problem:** No range checks. Corrupted nflverse data or schema changes could silently insert garbage.
- **Fix:** Add assertion checks: EPA/play between -1.0 and 1.0, comp% 0-100, passer rating 0-158.3, win+loss+tie = expected games.

### H6: No roster column validation
- **File:** `scripts/ingest.py` lines 83-88
- **Problem:** PBP download checks for required columns but roster download does not. If nflverse changes roster schema, it crashes with unhelpful KeyError.
- **Fix:** Add `REQUIRED_ROSTER_COLS = ['gsis_id', 'position']` check like the PBP validation.

### H7: Team plays count uses ('epa', 'count') — undercounts if any NaN EPA
- **File:** `scripts/ingest.py` line 109
- **Problem:** `('epa', 'count')` only counts non-NaN EPA rows. Display could show fewer plays than reality.
- **Fix:** Use `('game_id', 'count')` or `('epa', 'size')` for true row count.

---

## MEDIUM (11) — Address in next iteration

### M1: No fumble data in pipeline
- **File:** `scripts/ingest.py`
- **Problem:** Fumbles and fumbles_lost are standard QB stats on every competitor (NFL.com, ESPN, PFF, Fantasy Pros). nflverse has `fumble`, `fumble_lost` columns.
- **Fix:** Add fumble/fumble_lost columns to QB aggregation, schema, TypeScript types, and leaderboard.

### M2: Success rate inconsistency between team and QB pages
- **File:** `scripts/ingest.py` lines 108 (team) vs 217-223 (QB)
- **Problem:** Team success rate INCLUDES sacks. QB success rate EXCLUDES sacks. Same metric name, different definitions on different pages.
- **Fix:** Either align both or add clear tooltips explaining the difference on each page.

### M3: aDOT computed on all dropbacks, not just pass attempts
- **File:** `scripts/ingest.py` line 210
- **Problem:** `adot=('air_yards', lambda x: x.dropna().mean())` averages over all dropbacks. Standard aDOT uses only actual pass attempts.
- **Fix:** Filter to `pass_attempt == 1` before computing aDOT.

### M4: rush_epa_per_play computed but not displayed in QB leaderboard
- **File:** `components/tables/QBLeaderboard.tsx` COLUMNS array
- **Problem:** Column exists in schema and is populated by ingest, but not in the COLUMNS array. Free value left on the floor.
- **Fix:** Add `{ key: "rush_epa_per_play", label: "Rush EPA", tooltip: "Rush EPA", group: "rushing", hideMobile: true }` to COLUMNS.

### M5: No per-game stat columns (yards/game, TD/game)
- **Problem:** Fantasy players think in per-game terms. 250 yds/game vs 4000 total yards tells different stories for 14-game vs 17-game QBs.
- **Fix:** Add computed columns in pipeline or frontend.

### M6: No total TD column (passing + rushing combined)
- **Problem:** Leaderboard shows passing TDs and rushing TDs separately but not combined total.
- **Fix:** Add computed column to frontend or pipeline.

### M7: getAvailableSeasons() fetches full table to extract unique seasons
- **File:** `lib/data/queries.ts` lines 81-92
- **Problem:** Returns 192 rows (32 teams x 6 seasons) just to deduplicate client-side with `new Set()`.
- **Fix:** Use SQL `DISTINCT` or query `data_freshness` table instead.

### M8: 2020 CPOE data has known quality issues (COVID season)
- **Problem:** nflverse community has documented unreliable xComp model values for some 2020 games. No data quality note shown.
- **Fix:** Add a small note/badge for 2020 season data on the frontend.

### M9: TypeScript types declare number for nullable fields
- **File:** `lib/types/index.ts`
- **Problem:** `cpoe: number`, `rush_epa_per_play: number` etc. can actually be NaN. Type system doesn't protect against NaN propagation.
- **Fix:** Change nullable fields to `number | null`.

### M10: Team page only shows 2 of 10+ computed team metrics
- **Problem:** off_pass_epa, off_rush_epa, def_pass_epa, def_rush_epa, success_rate, pass_rate all computed and stored but invisible on team page.
- **Fix:** Surface additional metrics in team page hover tooltips or as a companion table.

### M11: No TD:INT ratio or TD%/INT% columns
- **Problem:** Standard analytics-community stats missing from leaderboard.
- **Fix:** Add derived columns to frontend display.

---

## LOW (10) — Nice to have

| # | Finding | File/Location |
|---|---------|--------------|
| L1 | No playoff data toggle (acceptable for MVP) | `ingest.py` filter_plays |
| L2 | Washington shows "Commanders" for 2020-2021 seasons (anachronistic) | `ingest.py` line 367, `teams.ts` |
| L3 | `two_point_attempt != 1` relies on NaN comparison behavior (works correctly but fragile) | `ingest.py` line 96 |
| L4 | No home/away stat splits | Schema design |
| L5 | No rolling averages or weekly EPA trends | Schema design |
| L6 | Min-dropback slider needs "what is a dropback?" explanation | `QBLeaderboard.tsx` |
| L7 | No database migration strategy (manual SQL for schema changes) | `schema.sql` |
| L8 | `getDataFreshness()` silently returns null on query failure | `queries.ts` line 77 |
| L9 | No alerting on workflow failures beyond GitHub email defaults | `.github/workflows/` |
| L10 | No smoke test for Supabase connection in CI | Project-wide |

---

## VERIFIED CORRECT (What all 15 reviewers confirmed is right)

- Passer rating formula: exactly matches NFL specification (0-158.3)
- Win/loss/tie logic: correctly handles nflverse `result` column (positive = home win)
- `qb_dropback == 1` for dropbacks: community standard, matches rbsdm.com
- `pass_attempt` flag for true attempts: correct (excludes sacks and scrambles)
- `passing_yards` column (not `yards_gained`): correct for passing stats
- CPOE null handling: `dropna().mean()` correctly excludes non-pass plays
- Scramble TD attribution: correctly added to rush_tds
- QB roster filtering: correctly removes WR/RB trick-play passers
- Multi-team QB assignment: most dropbacks wins (standard approach)
- NaN-to-None for PostgreSQL: prevents NaN in NUMERIC columns
- UPSERT idempotency: ON CONFLICT with full column updates
- Frontend NaN→em-dash display: correct
- D3 axis inversion (negative def EPA = top = better defense): correct
- Adaptive min-dropback threshold: scales with `throughWeek / 18` (smart UX)
- Historical team abbreviations (OAK, SD, STL): handled for FK integrity
- Retry with exponential backoff: well-implemented for network resilience
- RLS policies: public read, auth write (correct for Supabase)
- Two-point attempt filter: `!= 1` correctly includes NaN and 0
- Designed rush filter: `qb_dropback == 0 AND rusher_player_id in qb_ids` correct
