# Yards Per Pass — Project Memory

## Tecmo player card (built 2026-09-05, branch tecmo-player-card)

- The player card (Tecmo Super Bowl style, Jon's design pick from mockups) lives at `components/player/TecmoPlayerCard.tsx`, fed by pure builders in `lib/stats/tecmo-card.ts` (`buildQBCardData`/`buildWRCardData`/`buildRBCardData`). It IS the Overview on `/player/[slug]` and the whole of `/card/[slug]`.
- **OVR v3** (2026-09-06, Jon-approved): ALL positions display via the **Madden map** `min(99, round(77 + (blend−50)×0.45))` — avg starter ≈77, best 95-99; the round happens ONLY here (blends unrounded internally — a second round anywhere shifts scores, see the frozen anchor test). **QB blend = v3 "Ability"** (six-season study, 54 ground-truth checks, 0 misses): weighted quality pctls (EPA/db, ANY/A, CPOE, succ% at w=1; rush EPA at w=min(rushAtt/g/3,1); missing → drop value AND weight) 50/50 with per-game production (EPA/g incl. rushing via `epa_per_play×(dropbacks+rush_att−scrambles)/g`, yds/g, TDs/g), regressed by `sqrt(min(att/CAP,1))`. WR/TE/RB keep the v2 REG50 blend (season-total production, linear regression) → Madden map. 2025 anchors frozen in `__tests__/stats/tecmo-card-2025-anchors.test.ts` (Maye 97, Burrow 86 pre-kneel-fix / 85 live, Lamar 84, Henry 91). **Kneel fix**: ingest drops qb_kneel from BOTH QB season + weekly aggregation (QB rush stats intentionally diverge from PFR; Lamar 2025 rush EPA went +0.04→+0.37); backfilled 2020-2025. Glossary `#ovr` documents everything. Study artifacts were session-scratchpad only (gone); the spec's v3 section is the durable record.
- **Unified eligibility** (pools + OVR + banners): QB 14+ att/g, WR/TE 2+ tgt/g, RB 6+ car/g — constants in tecmo-card.ts. Replaced the old 238-att/32-tgt/106-car season totals so week 1 works. Leaderboards/home still use their own pools (intentional, unify later if desired).
- `AbilityRow.missing` is the authority for "no data" rendering (gray dot, empty bar, em dash) — never `percentile === 0` (that's a real last-place score). OVR `0` is valid; only `null` renders "—".
- Headshots: `player_slugs.headshot_url`/`jersey_number` (from nflverse rosters, latest week wins); `JerseyAvatar` falls back to a team-color jersey SVG. Data assembly `getCardDataForPlayer` lives in `lib/data/card.ts` (server side — do NOT move into lib/stats; it would drag supabase into the client graph).
- Share images: BOTH `/card/[slug]` and `/player/[slug]` OG routes render the Tecmo card (latest season; player OG falls back to a pixel-font name plate for cardless players like K/P, branded plate for unknown slugs). Download route (`/api/stat-card/[slug]?season=`, hour-cached attachment) render via `lib/og/tecmo-card-image.tsx` — satori rules: every div display:flex, no svg <text>, bundled Press Start 2P TTF (app/fonts, OFL), headshots prefetched to data URIs.
- **@vercel/og cannot render on Windows** (yoga.wasm path bug) — OG/download images only testable on Vercel, not on Jon's machine.
- FB players normalize to RB everywhere and now have working player pages (they 404'd before).
- **Passing Map** (2026-09-06, Jon's mockup pick "Tecmo Field"): `PlayerFieldHeatMap.tsx` is an HTML/CSS grid (no more SVG) — team band, dark navy field, pixel labels only, solid tiles colored by the SELECTED metric (diverging blue/orange for EPA ±0.5 & CPOE ±15; sequential blues for YPA 0-12 & yards), textColorForBackground on every tile, always-on legend, title tooltips. FOOTGUN: zone-level `completion_pct` is 0-1 but season-level is 0-100 (same name, opposite scales). parseNumericFields null→NaN means every numeric read needs Number.isFinite guards (a null CPOE once painted a tile bright-positive with "NaN" text). Card ability rows have a VALUE / PCTL header — the red ordinals are PERCENTILES, not ranks.
- Pixel font: `app/fonts.ts` exports `pressStart` (`--font-pixel` var, applied at html root); Tailwind v4 scans docs/ markdown, so class strings in docs leak into the CSS (harmless, known).

## Team pages (2026-09-06, Jon's mockup pick "full Tecmo")

- `games` table (nflverse schedules file) feeds Schedule & Results season grids on team pages — ingested in main()'s loop BEFORE the DataNotYetPublished skip (schedules land pre-season; scores fill nightly). Tiles: W green / L red / T slate / upcoming navy w/ kickoff, next-game #60a5fa border, REG-scoped byes (no phantom playoff byes), playoff tiles appended by round.
- **Upcoming-season rule**: viewing the latest stats season also fetches season+1's schedule; if present it shows instead, band `SCHEDULE · {year}`, record omitted (page passes isLatestSeason; don't derive in team-hub). Self-retires when the season flips.
- Whole team page wears TecmoSectionCard band headers (each section wraps ITSELF — parent-wrapping breaks empty-state nulls); identity header shows record · division rank (competition ranking from allTeamStats) · EPA ranks · TO diff (fields added to TeamSeasonStat; turnover_diff is NOT numeric-parsed — typeof check, not isFinite). NO team OVR (deliberate — needs its own study if ever).
- games.csv footguns: playoff game_type is WC/DIV/CON/SB (never "POST") at weeks 19-22; a cross-week reschedule gets a NEW game_id (stale row remains, no cleanup exists).

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
