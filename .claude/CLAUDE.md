# Yards Per Pass — Project Instructions

## Review Workflow

After implementing any feature, run `/review-feature "description of changes"` to dispatch the full 47-team + 3-CEO review roster.

Team roster spec: `docs/superpowers/specs/2026-03-18-review-team-roster-design.md`

## Quality Gates (MANDATORY — never skip)

### Enforced Friction
- **Every feature MUST have a spec reviewed by a spec-reviewer agent before implementation starts.** No exceptions, even for "simple" changes. The slug bug (functions defined but never called in process_season) was caused by skipping spec review.
- Spec review catches: missing integration points, functions not wired into callers, type mismatches, missing DB columns.

### Chaos Testing ("The Monkey")
- **After implementation and before dispatching the 47-reviewer panel**, dispatch a chaos testing agent that actively tries to break the new feature with:
  - Null/undefined/NaN inputs to new functions
  - Empty arrays, single items, 1000+ items
  - Players with no data for the selected season
  - Traded mid-season players (multi-team edge case)
  - Rookies with 1-2 games (small sample)
  - Special characters in names (D'Andre, O'Brien, Amon-Ra St. Brown)
  - Missing participation/weekly data (graceful fallback)
  - Supabase returning 0 rows or hitting 1000-row cap
- The chaos agent reports CRASH/ERROR/DEGRADED/PASS for each test case.
- Fix all CRASH and ERROR findings before proceeding to review.

## Project Conventions

- This is a Next.js 14 App Router project with TypeScript, Tailwind v4, and D3.js
- Data lives in Supabase (PostgreSQL with RLS)
- All stat computation happens in `scripts/ingest.py` — never compute stats client-side
- Data fetching: `lib/data/queries.ts`, `lib/data/receivers.ts`, `lib/data/rushing.ts`, `lib/data/players.ts`, `lib/data/team-hub.ts`, `lib/data/run-gaps.ts`
- Fantasy points: `lib/stats/fantasy.ts` — PPR/Half/Standard scoring, computed client-side from existing stats
- Nav labels: Team Tiers | Passing | Receiving | Rushing | Run Gaps | Glossary
- Supabase has a 1000-row server limit — use `fetchAllRows()` from `lib/data/utils.ts` for large tables
- After any DB data change, trigger ISR revalidation via the webhook at `/api/revalidate`
- `parseNumericFields` converts null → null (NOT NaN — NaN can't be serialized by Next.js server→client). UI checks `val == null || Number.isNaN(val)`.
- Always run `tsc --noEmit` and `next lint` before committing (separate commands, never chain with &&)
- Player pages use dynamic rendering (no generateStaticParams) — searchParams requires dynamic
- Team pages use generateStaticParams (32 teams pre-rendered)
- Archetype classification: `lib/stats/archetypes.ts` — classifyQB/WR/TE/RB, returns null if no match
- Slugs are immutable — once assigned, never change. Collision handling: team suffix → position suffix → player_id suffix
- TE percentiles computed against TE-only pool (not mixed with WRs)
- Qualified pools for rate stats: QB 100+ dropbacks, WR 200+ routes, TE 100+ routes, RB 30+ carries
- Elite archetypes (Complete Passer, Alpha WR1, Elite TE1, Three-Down Back) require no axis below 30th percentile
- Players below threshold see "Not enough data to qualify" — no radar, no chips, no bars
- VS League Average section shows the minimum threshold (e.g., "200+ routes · 85 WRs")
- 13 Supabase tables total (teams, team_season_stats, qb_season_stats, receiver_season_stats, rb_season_stats, rb_gap_stats, rb_gap_stats_weekly, def_gap_stats, data_freshness, player_slugs, qb_weekly_stats, receiver_weekly_stats, rb_weekly_stats)
- Automated pipeline: 4 game-day crons (Fri/Mon/Tue/Wed 7 AM ET) in `.github/workflows/data-refresh.yml`
