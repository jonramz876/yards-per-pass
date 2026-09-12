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
- **Passing Map** (2026-09-06, Jon's mockup pick "Tecmo Field"): `PlayerFieldHeatMap.tsx` is an HTML/CSS grid (no more SVG) — team band, dark navy field, pixel labels only, solid tiles colored by the SELECTED metric (diverging blue/orange for EPA ±0.5 & CPOE ±15; sequential blues for YPA 0-12 & yards), textColorForBackground on every tile, always-on legend, title tooltips. FOOTGUN: zone-level `completion_pct` is 0-1 but season-level is 0-100 (same name, opposite scales). `parseNumericFields` (lib/utils.ts) turns the DB string `"NaN"` into **null** (NOT NaN — NaN can't be serialized server→client), so every numeric read needs `val == null || Number.isNaN(val)`; an `isNaN`-only guard passes null straight through to `.toFixed()` (see the 2026-09-11 F1 crash). Card ability rows have a VALUE / PCTL header — the red ordinals are PERCENTILES, not ranks.
- Pixel font: `app/fonts.ts` exports `pressStart` (`--font-pixel` var, applied at html root); Tailwind v4 scans docs/ markdown, so class strings in docs leak into the CSS (harmless, known).

## Team pages (2026-09-06, Jon's mockup pick "full Tecmo")

- `games` table (nflverse schedules file) feeds Schedule & Results season grids on team pages — ingested in main()'s loop BEFORE the DataNotYetPublished skip (schedules land pre-season; scores fill nightly). Tiles: W green / L red / T slate / upcoming navy w/ kickoff, next-game #60a5fa border, REG-scoped byes (no phantom playoff byes), playoff tiles appended by round.
- **Upcoming-season rule (v2)**: viewing the latest stats season also fetches season+1's schedule; if present it renders as an ADDITIONAL section ABOVE the viewed season's (band `SCHEDULE · {year}`, record omitted; the viewed season keeps its `SCHEDULE & RESULTS` grid below — v1 replaced it, which masked the latest season's results pre-flip). Page passes isLatestSeason (don't derive in team-hub); each section self-omits when empty, so post-flip only one renders.
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
- `seed.yml` — manual historical backfill. `ci.yml` — lint + tsc + build (placeholder Supabase env vars) + pytest. **CI does NOT run vitest** — run it locally before merging.

## Local dev on Jon's machine

- Python is `py -3` (plain `python` is not installed). Tests: `py -3 -m pytest tests/ -q`.
- Local build needs the placeholder env vars CI uses: `NEXT_PUBLIC_SUPABASE_URL=https://placeholder.supabase.co NEXT_PUBLIC_SUPABASE_ANON_KEY=placeholder-key-for-build-only npm run build`.
- Frontend tests: `npx vitest run` (399 tests / 23 files after the 2026-09-11 week-1 fixes). Python: `py -3 -m pytest tests/ -q` (262 tests).
- Agent/tool shells reset the working directory between calls, so `cd` does not carry over: use absolute paths — `node <repo>/node_modules/vitest/vitest.mjs run --root <repo>`, `node <repo>/node_modules/typescript/bin/tsc --noEmit -p <repo>/tsconfig.json`, `npm --prefix <repo> run lint`, `py -3 -m pytest <repo>/tests -q`.
- Running pytest dirties the tracked `tests/__pycache__/*.pyc` files; use `PYTHONDONTWRITEBYTECODE=1 … -p no:cacheprovider`, and never stage `__pycache__`.

## Known debt (2026-09-05)

- 8 npm vulnerabilities (6 high: `next`, `@supabase/auth-js`, `glob`, `postcss`) fixable only by the **Next.js 14 → 16 major upgrade** — deliberate deferral, needs its own session.
- `--all` ingest aborts remaining seasons if one historical season fails (design tradeoff, noted in chaos review 2026-09-05).
- A typo'd future season (`--season 2035`) exits 0 as a "not yet published" skip.

## Week 1 2026 audit + fixes (2026-09-11)

A 16-agent read-only audit of the live site in the week-1 state (1-2 games played, 2026 the default season everywhere) produced **115 verified findings**. Five were fixed in three PRs; the rest are the follow-up list below.

**Jon's standing decisions from this session:**
- **Keep 2026 as the default season and ADD MESSAGES.** Never silently fall back to an older season for a default view; where a page would be empty or 404 because a player/team has no current-season row, say so and link to the season that does have data.
- Keep `app/player/[slug]/loading.tsx` (the instant skeleton) even though it makes unknown slugs a soft 200.
- Staged PRs, merged once CI passes, rather than one big PR.

**Shipped (PR #11 → main, PR #12, PR #13):**
- **F1 team-page crash** (`components/team/SituationalDashboard.tsx`): a situation with 0 rushes or 0 passes stores `NaN` → parses to `null`; `isNaN(null)` is false, so `formatEpa` called `null.toFixed()` and the error boundary ate the whole page. `/team/NE` and `/team/SF` were down live. Guards now use `val == null || Number.isNaN(val)`; a missing side shows a gray dash. ANY new numeric render on team data needs this guard — the `number` prop types lie (widening them is a follow-up).
- **F5 standings order** (`lib/data/teams.ts` → `winPct`/`compareRecords`, used by `TecmoStandings`, `TeamIdentityCard`, `DivisionRivals`): was wins-only, so 0-1 NE sat above 0-0 NYJ and bye weeks misordered teams. Now win % (tie = half a win, 0-0 = .500), then wins−losses. Division rank counts all 4 teams from `NFL_TEAMS` with shared places; DivisionRivals lists rivals who haven't played (0-0, dashes). Intentional history change: 2025 NFC North now GB (9-7-1) above DET (9-8).
- **F2 slug deletion** (`scripts/ingest.py` `generate_player_slugs`): it DELETEd a stored slug whenever the current roster's name produced a different slug, committed mid-run, and only recreated slugs for players with stats *this* season — so Kenneth/Kenny Gainwell (2021-2025 stats) lost his page and 11 renamed players got new URLs (old ones dead). **Slugs are now never deleted**, there is no mid-function commit (one transaction per night), and any player with stats in any season but no slug is backfilled using the roster of his newest stats season. Also guards a NaN roster position in the collision-suffix path (chaos find).
- **F4 missing participation** (`scripts/ingest.py` receiver aggregators + `lib/stats/percentiles.ts` `percentileOrMissing`): with no 2026 participation file, routes/snaps were stored as **0** and rates as NaN, and the frontend scored missing YPRR as the **0th percentile** — every 2026 TE became "Blocking TE" and YPRR plotted at the radar center. Now NULL in the DB, `percentileOrMissing` returns NaN so archetype rules ignore that axis, radars/share images/compare leave a gap, Game Log Routes shows a dash, and `ReceiverLeaderboard` skips archetypes until `MIN_ARCHETYPE_POOL` (10) WRs/TEs qualify (~week 5-6). Golden fixture `__tests__/stats/fixtures/wr-te-2025-pool.json` pins all 347 2025 WR/TE labels + OVRs — never re-capture it to make a test pass.
- **F3 card 404s** (`app/card/[slug]/page.tsx`, `PlayerHeader`/`PlayerPageContent`, `app/sitemap.ts`, `lib/og/tecmo-card-image.tsx`): Share Card linked to `?season=2026` for players with no 2026 row and the card page called `notFound()` — a 404 for every player on a team that hadn't played, plus K/P and 0-carry RBs; the sitemap listed ~1,225 card URLs that 404'd. Now a 200 **noindex message page** ("No 2026 card yet for X") linking to the newest season with a card; unknown slug/season still 404; Share Card only renders when the viewed season has a card (`hasCard`); card OG falls back to the player name plate (moved into `lib/og/tecmo-card-image.tsx`); canonical/og:url carry `?season=`; **all `/card/` URLs dropped from the sitemap** (`/player/` is canonical) and lastmod comes from `data_freshness.last_updated`.

**Process that worked (repeat it):** audit → every finding re-verified by an independent skeptic (1 of 116 refuted) → one spec per fix, each approved by a spec reviewer before any code → implement → chaos test (56+67+42 cases; 2 real crashes found) → code review → local tsc/lint/vitest/pytest/build → PR → CI → merge → verify on the live site against pre-merge snapshots.

### Follow-ups from the audit (not yet done, roughly by value)

- **Stat Surge Detector can never fire.** `lib/stats/surge.ts` compares a w-week mean against a single-game stdev with the recent weeks inside the baseline, so crossing 1.5 needs ≥11 games at w=3 (the UI offers 3/4/5). Replaying all of 2025: 0 hits in 30 stat×window combos. Fix: compare the recent window against the PRIOR weeks (`sd*sqrt(1/w + 1/(n-w))`) and re-tune the threshold. Its tests only assert threshold crossings at window=2, which the UI never offers.
- **PFR qualifier pro-rating uses one global `throughWeek`** for every team (`min(throughWeek,17)` in all 3 leaderboards), so after each Thursday game starters on teams that haven't played drop off the default board until they catch up, and bye teams are penalized all season. Fix: per-team games played.
- **Past seasons show the player's CURRENT team** (colors, band, hub link, "Catches From"): `app/player/[slug]/page.tsx` and the card/stat-card routes pass `player.current_team_id` instead of `seasonStats[0].team_id`. A.J. Brown's 2025 page wears Patriots colors.
- **Game Log BYE/DNP is guessed**, labeling the first missing week "BYE" (Lamar 2025 shows week 5; the real bye was week 7). The `games` table now exists — use the team's REG schedule and the weekly row's `team_id` for traded players.
- **Fantasy tab's "PPR" column shows the selected format** (`fantasy_pts` does double duty); the receivers heatmap for FPts is computed from PPR while cells show Half/Std; the QB scoring toggle is a no-op.
- **Receive-only RBs have no `rb_season_stats` row** (aggregated from rushing plays only), so their pages say "No RB stats found" while receiving + game-log rows exist. Outer-merge receiving, or fall back to `receiver_season_stats`.
- **Silent pipeline failures.** A mid-season 404 or empty file still exits 0 as "not yet published" even when `data_freshness` already has that season; a failed schedules ingest is a warning; `/api/health` returns ok regardless of staleness; `update_freshness` bumps `last_updated` even when nothing changed, so the 10-day stale badge can never fire. Fix: hard-fail when `get_existing_through_week` is not None, and return 503 from `/api/health` past ~36h in season.
- **The "8 AM ET" cron actually starts 3-5.5h late** (GitHub queueing), so Sunday's games land ~noon-1:40 PM ET Monday.
- **Early-season messaging (the rest of Jon's "add messages" decision):** player pages with no current-season row show "No QB stats found for X in 2026" with no link to his latest season; team headers for teams that haven't played show no record/rank line; the 4 empty homepage leader strips (season-total thresholds: 100 dropbacks / 50 routes / 50 carries) have no explanation and the YPRR strip can't fill while participation is missing; ranks/percentiles computed from pools of 2-4 (run-gaps says "#1 of 32" with 2 teams; Team Tiers labels 2 teams "Contenders"/"Bottom Feeders"); `MIN_ARCHETYPE_POOL` hides the archetype dropdown with no note.
- **Slug aliases** for the 11 renamed players whose old URLs died pre-2026-09-07 (values were never recorded; would need rebuilding from old rosters + a redirect).
- **Soft 404s**: unknown player slugs return 200 (kept deliberately for the loading skeleton) and mixed-case URLs use a meta refresh rather than a 307.
- **Stored `NaN` instead of NULL** in other float columns (RB weekly rates, zone passer rating): the real fix belongs in the upsert layer, not the aggregators.
- **CI does not run vitest** (only lint + tsc + build + pytest) — add it.
- Smaller: negative zero rendered as "-0.00"; "1 GAMES" on cards; duplicated page-title suffix; `/trends` ships every weekly row (~870KB by season end); stale/rescheduled `games` rows are never deleted; download route sends both `immutable, max-age=31536000` and `max-age=0`.
