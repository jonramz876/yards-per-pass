# Yards Per Pass — Project Memory

## Tecmo player card (built 2026-09-05, branch tecmo-player-card)

- The player card (Tecmo Super Bowl style, Jon's design pick from mockups) lives at `components/player/TecmoPlayerCard.tsx`, fed by pure builders in `lib/stats/tecmo-card.ts` (`buildQBCardData`/`buildWRCardData`/`buildRBCardData`). It IS the Overview on `/player/[slug]` and the whole of `/card/[slug]`.
- **OVR** = mean of quality-metric percentiles only (QB: EPA/db, CPOE, succ%, ball security, rush EPA · WR/TE: EPA/tgt, CROE, YPRR, recv succ% · RB: EPA/car, succ%, stuff avoid, expl%), 0–99, style/volume metrics excluded, missing metrics excluded (not counted as 0). Glossary `#ovr` documents it.
- **Unified eligibility** (pools + OVR + banners): QB 14+ att/g, WR/TE 2+ tgt/g, RB 6+ car/g — constants in tecmo-card.ts. Replaced the old 238-att/32-tgt/106-car season totals so week 1 works. Leaderboards/home still use their own pools (intentional, unify later if desired).
- `AbilityRow.missing` is the authority for "no data" rendering (gray dot, empty bar, em dash) — never `percentile === 0` (that's a real last-place score). OVR `0` is valid; only `null` renders "—".
- Headshots: `player_slugs.headshot_url`/`jersey_number` (from nflverse rosters, latest week wins); `JerseyAvatar` falls back to a team-color jersey SVG. Data assembly `getCardDataForPlayer` lives in `lib/data/card.ts` (server side — do NOT move into lib/stats; it would drag supabase into the client graph).
- Share image (`app/card/[slug]/opengraph-image.tsx`, latest season) and download route (`/api/stat-card/[slug]?season=`, hour-cached attachment) render via `lib/og/tecmo-card-image.tsx` — satori rules: every div display:flex, no svg <text>, bundled Press Start 2P TTF (app/fonts, OFL), headshots prefetched to data URIs.
- **@vercel/og cannot render on Windows** (yoga.wasm path bug) — OG/download images only testable on Vercel, not on Jon's machine.
- FB players normalize to RB everywhere and now have working player pages (they 404'd before).
- Pixel font: `app/fonts.ts` exports `pressStart` (`--font-pixel` var, applied at html root); Tailwind v4 scans docs/ markdown, so class strings in docs leak into the CSS (harmless, known).

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
