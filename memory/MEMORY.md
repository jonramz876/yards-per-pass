# Yards Per Pass — Project Memory

## Season handling (as of 2026-09-05 readiness pass)

- **No hardcoded season years anywhere.** All pages resolve the season from `getAvailableSeasons()` (newest row in Supabase `data_freshness`), falling back to `fallbackSeason()` in `lib/data/queries.ts` — date-based, rolls to the new season year in September (JS `getMonth() >= 8`). The Python twin is `_detect_current_season()` in `scripts/ingest.py`.
- The site flips to a new season automatically once its first ingest lands. Nothing to edit at season rollover.

## Data pipeline

- `scripts/ingest.py` downloads nflverse parquet files (PBP, rosters, participation) and upserts into Supabase. Run: `python scripts/ingest.py --season YEAR` (or `--all`, `--dry-run`).
- `DataNotYetPublished` exception: a 404, empty file, or zero usable REG plays on the **current** season is a benign skip (exit 0, clear log). Any non-empty current-season file with real plays is ingested — even a single game (~180 rows), per Jon's "update every night after at least 1 game" requirement. Historical seasons keep the 1,000-row minimum and fail loudly.
- Truncation guard: ingest refuses to write if the new file's max week is lower than `data_freshness.through_week` (protects against nflverse re-publishing a truncated file; `cleanup_stale_rows` would otherwise delete players/teams). Accepted residual risk: a sparse republish that keeps the latest week would pass the guard.
- nflverse publishes `play_by_play_{year}.parquet` only after the first games are played; rosters appear earlier.

## GitHub Actions (jonramz876/yards-per-pass)

- `data-refresh.yml` ("Nightly Data Refresh") — daily cron 12:00 UTC (8 AM EDT / 7 AM EST); skips March–August; auto-targets current season. 2026 season opened Wednesday Sept 9 (Seahawks–Patriots), so nightly cadence matters from week 1.
- **GitHub auto-disables cron workflows after 60 days without repo activity.** This silently killed the refresh June 1–Sept 5, 2026. The workflow now has a self-keepalive step (re-enables itself via `gh api` each run, needs `actions: write` permission). If the workflow file is ever renamed, update the filename inside the keepalive step.
- `seed.yml` — manual historical backfill. `ci.yml` — tsc + build (placeholder Supabase env vars) + pytest.

## Local dev on Jon's machine

- Python is `py -3` (plain `python` is not installed). Tests: `py -3 -m pytest tests/ -q`.
- Local build needs the placeholder env vars CI uses: `NEXT_PUBLIC_SUPABASE_URL=https://placeholder.supabase.co NEXT_PUBLIC_SUPABASE_ANON_KEY=placeholder-key-for-build-only npm run build`.
- Frontend tests: `npx vitest run` (149 tests). Python: 213 tests.

## Known debt (2026-09-05)

- 8 npm vulnerabilities (6 high: `next`, `@supabase/auth-js`, `glob`, `postcss`) fixable only by the **Next.js 14 → 16 major upgrade** — deliberate deferral, needs its own session.
- `--all` ingest aborts remaining seasons if one historical season fails (design tradeoff, noted in chaos review 2026-09-05).
- A typo'd future season (`--season 2035`) exits 0 as a "not yet published" skip.
