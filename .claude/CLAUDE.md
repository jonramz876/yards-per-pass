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
- All stat computation happens in `scripts/ingest.py` — never compute stats client-side — exception: `/team-stats` sums `team_game_stats` rows in `lib/stats/team-stats.ts` on the server (play-weighted, spec 2026-09-28), and the team radar on `/team/[team_id]`, its share pages `/card/team/[team_id]/[side]` and its image route `/api/team-radar/[team_id]/[side]` do the same in `lib/stats/team-radar.ts` (spec 2026-10-06)
- Data fetching: `lib/data/queries.ts`, `lib/data/receivers.ts`, `lib/data/rushing.ts`, `lib/data/players.ts`, `lib/data/team-hub.ts`, `lib/data/run-gaps.ts`, `lib/data/games.ts` (schedule + official final scores — server-only, never import it from a `"use client"` file), `lib/data/box-score.ts` (the `/game/[game_id]` page and the box score link gate — server-only; its pure builders are in `lib/stats/box-score.ts`), `lib/data/team-stats.ts` (the `/team-stats` season read — server-only; pure builders in `lib/stats/team-stats.ts`), `lib/data/team-radar.ts` (the team radar's season read, its own column list — server-only; the pure module `lib/stats/team-radar.ts` must import nothing from `lib/data`, it is in the client hub's graph), `lib/data/team-radar-card.ts` (`loadTeamRadarCard`: the one loader behind a team radar share page, its metadata and its image — server-only)
- Images drawn with `next/og`. All of them: response header keys must be lowercase (`"cache-control"`), or next/og's one-year default is sent as well. Image **route handlers** (`/api/stat-card/[slug]`, `/api/team-radar/[team_id]/[side]`): a failed read answers 503 `no-store`. File-convention `opengraph-image.tsx` files (player, card) do the opposite on purpose: they draw a plate with `no-store`, because a link preview must never be an error. The team radar image (`lib/og/team-radar-image.tsx`) is plain flex `div`s plus svg `<path>`/`<line>`/`<circle>` (no svg `<text>`, no `<polygon>`, no components), with fonts read from files in the deployment, never fetched; the Tecmo card image is its own design (it uses `<img>` for the headshot). next/og's own loader fails on Windows: the three module-load file reads in the bundled `@vercel/og` `index.node.js` (`fs.readFileSync(fileURLToPath(join(import.meta.url, "../<file>")))`) resolve wrongly there. A scratch copy with those three paths made absolute renders locally (never edit `node_modules`); a Vercel preview is still the final check for any image change
- Fantasy points: `lib/stats/fantasy.ts` — PPR/Half/Standard scoring, computed client-side from existing stats
- Player comparison maths: `lib/stats/compare.ts` (`buildComparison`: radar percentiles + missing mask, colours, stat table). Pure: imports nothing from `lib/data` except `teams`, no React/Next/Supabase (a test checks); the Compare page calls it today, the comparison share card's server routes will. Its pin: `__tests__/components/ComparisonTool.pin.test.tsx` — never edit or re-capture the expected file.
- Nav labels: Team Tiers | Team Stats | Passing | Receiving | Rushing | Run Gaps | Glossary
- Supabase has a 1000-row server limit — use `fetchAllRows()` from `lib/data/utils.ts` for large tables
- After any DB data change, trigger ISR revalidation via the webhook at `/api/revalidate`
- A failed read must never look like an empty one (read resilience spec 2026-10-06). Loaders in `lib/data` throw an `Error` on a query error and return `[]` / `null` only when the read succeeded with no rows; wrap `fetchAllRows`' raw rejection with `queryError` (`lib/data/utils.ts`). Pages let a core read's throw reach the route's `error.tsx` (never `notFound()`, never an empty render); a read may degrade only if the page is honest without it, and then it logs with `console.error`. Client-side Supabase reads must read `error` and tell the visitor.
- Every Supabase read has a time limit from `lib/supabase/timeout.ts` (5 s server, 15 s browser); a timeout is an ordinary failed read. Create clients only through `createServerClient` / `getSupabaseClient` so the limit applies. A read that passes its own signal keeps only that deadline, so an assembly with one budget must pass its signal to every read. A signal disables Next's per-render fetch dedupe: do not rely on dedupe for Supabase reads.
- Static/ISR pages must not swallow data errors into a rendered page. Rethrow unless there is no database (`hasNoDatabase` in `lib/supabase/server.ts`; the homepage's `rethrowUnlessNoDatabase`); known exception pending follow-up: `app/sitemap.ts`. No in-render retries (none exist; adding one is a spec decision). Consequence: a persistent Supabase problem fails every Vercel build (production and previews) until the database recovers; the live site keeps its last good copy.
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
- 18 Supabase tables total (teams, team_season_stats, qb_season_stats, receiver_season_stats, rb_season_stats, rb_gap_stats, rb_gap_stats_weekly, def_gap_stats, data_freshness, player_slugs, qb_weekly_stats, receiver_weekly_stats, rb_weekly_stats, games, qb_pass_location_stats, team_down_distance_stats, team_situational_stats, team_game_stats)
- Automated pipeline: `.github/workflows/data-refresh.yml` runs every 4 hours at :17 UTC September–February (6/day) and once daily at 13:17 UTC March–August (offseason skip + keepalive); concurrency group `data-refresh` means refreshes queue and never overlap
