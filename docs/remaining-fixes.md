# Remaining Fixes — Post Phase 0
**Date:** 2026-03-15
**Source:** 137-finding comprehensive review across 6 sections, 90 reviewers

Phase 0 (9 items), Phase 1 Group A (10 data pipeline), Groups B-D (14 frontend/product/launch) have been completed. **All 33 Phase 1 HIGH items are done.** This document tracks remaining MEDIUM/LOW fixes.

---

## Completed (Phase 0) — Already Fixed

| # | Fix | Files Changed |
|---|-----|---------------|
| 1 | ANY/A formula: added sack_yards_lost subtraction (was inflating every QB ~0.5 pts) | `scripts/ingest.py` |
| 2 | EPA/DB denominator: use `epa.mean()` instead of sum/count (was undercounting due to NaN skipping) | `scripts/ingest.py` |
| 3 | Added 13 golden-value pytest tests (passer rating + filter_plays) | `tests/test_formulas.py`, `scripts/requirements.txt` |
| 4 | Created CI workflow: lint + type-check + build + pytest on push/PR | `.github/workflows/ci.yml` |
| 5 | Added touch handlers to scatter plot (tap to show/dismiss tooltip on iPad) | `components/charts/TeamScatterPlot.tsx` |
| 6 | parseInt NaN guard: `?season=abc` now falls back to default season | `app/teams/page.tsx`, `app/qb-leaderboard/page.tsx` |
| 7 | SVG clip-path: replaced CSS `circle()` with SVG `<clipPath>` for Safari compatibility | `components/charts/TeamScatterPlot.tsx` |
| 8 | Pinned Tailwind CSS to exact version 4.2.1 (removed `^`) | `package.json` |
| 9 | Made revalidation failure non-silent: checks HTTP status, warns on failure | `.github/workflows/data-refresh.yml` |

## Completed (Phase 1 Group A — Data Pipeline) — Already Fixed

| # | Fix | Files Changed |
|---|-----|---------------|
| 10 | Scramble backfill: `fillna()` instead of unconditional overwrite (D-H1) | `scripts/ingest.py` |
| 11 | Scramble yards added to `rush_yards` for consistency with `rush_tds` (D-H2) | `scripts/ingest.py` |
| 12 | Transaction wrapping: single commit with rollback, removed per-upsert commits (D-H4) | `scripts/ingest.py` |
| 13 | Data validation: `validate_data()` range checks before DB write (D-H5) | `scripts/ingest.py` |
| 14 | Roster column validation: `REQUIRED_ROSTER_COLS` check (D-H6) | `scripts/ingest.py` |
| 15 | Team plays count: `('game_id', 'count')` instead of `('epa', 'count')` (D-H7) | `scripts/ingest.py` |
| 16 | Retry decorator on all 4 DB upsert functions (B-H2) | `scripts/ingest.py` |
| 17 | Connection timeout: `connect_timeout=30` on `psycopg2.connect()` (B-H3) | `scripts/ingest.py` |
| 18 | Structured logging: replaced all `print()` with Python `logging` module (B-H5) | `scripts/ingest.py` |
| 19 | Auto-detect `CURRENT_SEASON` from date + workflow default updated (D-H3, B-H4) | `scripts/ingest.py`, `data-refresh.yml` |

## Completed (Phase 1 Groups B-D — Frontend, Product, Launch) — Already Fixed

| # | Fix | Files Changed |
|---|-----|---------------|
| 20 | D3 selective imports: `d3-selection`, `d3-scale`, `d3-axis`, `d3-format` (F-H5) | `TeamScatterPlot.tsx`, `package.json` |
| 21 | MetricTooltip tap targets: 24px visible + invisible 44px touch area (F-H7) | `MetricTooltip.tsx` |
| 22 | Quadrant colors: blue for "Defense Carries", orange for "Offense First" (F-H8) | `TeamScatterPlot.tsx` |
| 23 | Y-axis annotation: 11px/#64748B (was 9px/#94A3B8) (F-H9) | `TeamScatterPlot.tsx` |
| 24 | Resize debounce: 150ms debounce on ResizeObserver (F-H10) | `TeamScatterPlot.tsx` |
| 25 | Hidden team metrics surfaced in tooltip: pass/rush EPA, pass rate, success rate (F-H10) | `TeamScatterPlot.tsx` |
| 26 | Rush EPA column added to QB leaderboard (F-H11) | `QBLeaderboard.tsx`, `MetricTooltip.tsx` |
| 27 | Error boundary logging: `useEffect` + `console.error` (T-H3) | Both `error.tsx` files |
| 28 | parseNumericFields generic type safety: removed `as unknown as` double-casts (T-H7) | `lib/utils.ts`, `queries.ts` |
| 29 | OG image metadata: OpenGraph + Twitter card tags in layout (P-H3) | `app/layout.tsx` |
| 30 | "More Coming" → "Open Source" with vague future wording (P-H4) | `app/page.tsx` |
| 31 | Vercel Analytics installed and added to layout (L-H2) | `app/layout.tsx`, `package.json` |
| 32 | Launch checklist created: 26-step pre-deploy/deploy/post-deploy (L-H3) | `docs/launch-checklist.md` |

**Note:** F-H6 (logo optimization — pre-process 500px PNGs to 64px) requires an asset pipeline step outside of code changes. Logos still load from ESPN CDN with colored-circle fallback. This will be addressed when local hosting is set up.

---

## Phase 2 — Next Iteration (MEDIUM Priority)

### Data & Analytics (10 items)
| # | Fix | File |
|---|-----|------|
| D-M1 | Add fumble/fumble_lost columns to QB aggregation, schema, types, and leaderboard | `ingest.py`, `schema.sql`, `types/index.ts`, `QBLeaderboard.tsx` |
| D-M2 | Align success rate definition between team and QB pages (or add tooltips explaining difference) | `ingest.py:108,217-223` |
| D-M3 | Compute aDOT on pass_attempt==1 only (not all dropbacks) | `ingest.py:210` |
| D-M5 | Add per-game stat columns (yards/game, TD/game) | Pipeline or frontend computed |
| D-M6 | Add total TD column (passing + rushing combined) | Frontend computed column |
| D-M7 | Use SQL DISTINCT or data_freshness table for getAvailableSeasons | `queries.ts:81-92` |
| D-M8 | Add data quality note for 2020 CPOE (COVID season) | Frontend badge/note |
| D-M9 | Change nullable TS fields from `number` to `number \| null` | `lib/types/index.ts` |
| D-M10 | Surface additional team metrics on team page | `TeamScatterPlot.tsx` tooltip, `MobileTeamList.tsx` |
| D-M11 | Add TD:INT ratio or TD%/INT% columns | `QBLeaderboard.tsx` |

### Frontend & Design (11 items)
| # | Fix | File |
|---|-----|------|
| F-M1 | Add `truncate` to MobileTeamList team name for narrow screens | `MobileTeamList.tsx:50-51` |
| F-M2 | Add explicit env var checks in Supabase client (replace `!` assertions) | `lib/supabase/server.ts:5-6` |
| F-M3 | Make feature cards clickable (wrap in Link) | `app/page.tsx:34-48` |
| F-M4 | Create custom 404 page | `app/not-found.tsx` (new) |
| F-M5 | Add robots.txt and sitemap.xml | `app/robots.ts`, `app/sitemap.ts` (new) |
| F-M6 | Add global error boundary | `app/error.tsx` (new) |
| F-M7 | Add rank numbers to mobile team list | `MobileTeamList.tsx` |
| F-M8 | Add color legend below scatter plot | `TeamScatterPlot.tsx` or parent |
| F-M9 | Add loading component to D3 dynamic import | `app/teams/page.tsx:9-12` |
| F-M10 | Add viewport boundary checking for tooltip position | `TeamScatterPlot.tsx:213-215` |
| F-M11 | Tailwind already pinned (Phase 0) | `package.json` ✅ |

### Backend & Infrastructure (9 items)
| # | Fix | File |
|---|-----|------|
| B-M1 | Consolidate duplicate env example files | `.env.example`, `.env.local.example` |
| B-M2 | Remove unused NEXT_PUBLIC_SITE_URL from env example | `.env.local.example:11` |
| B-M3 | Add ISR revalidation to seed workflow | `.github/workflows/seed.yml` |
| B-M4 | Add cleanup mechanism for orphaned/stale data rows | `ingest.py` upserts |
| B-M5 | Add server-side Supabase client singleton | `lib/supabase/server.ts` |
| B-M6 | Add offseason skip or conditional in weekly cron | `data-refresh.yml:6` |
| B-M7 | Add --dry-run sample value output | `ingest.py:478-482` |
| B-M8 | Document psycopg2-binary usage decision | `requirements.txt` comment |
| B-M9 | Add deployment documentation to repo | `docs/deploy.md` (new) |

### Testing & Reliability (8 items)
| # | Fix | File |
|---|-----|------|
| T-M1 | Make error messages actionable (suggest refresh, report link) | Both `error.tsx` files |
| T-M2 | Match loading skeletons to actual component layout | Both `loading.tsx` files |
| T-M3 | Declare nullable fields as `number \| null` in types | `lib/types/index.ts` |
| T-M4 | Add minimal Playwright E2E tests | `tests/e2e/` (new) |
| T-M5 | Add Playwright screenshot comparison for chart | `tests/e2e/` (new) |
| T-M6 | Generate type-safe Supabase client types | `supabase gen types` → `database.types.ts` |
| T-M7 | Add error logging to getDataFreshness | `queries.ts:77` |
| T-M8 | Extract shared ErrorState component from duplicated error boundaries | `components/ui/ErrorState.tsx` (new) |

### Product & Content (8 items)
| # | Fix | File |
|---|-----|------|
| P-M1 | Persist season selector across page navigation | `SeasonSelect.tsx`, `Navbar.tsx` |
| P-M2 | Add comparison features (QB side-by-side) | New component/page |
| P-M3 | Add shareable chart images (SVG-to-PNG download button) | `TeamScatterPlot.tsx` |
| P-M4 | Add EPA/CPOE intro section on landing page | `app/page.tsx` |
| P-M5 | Simplify MetricTooltip definitions for casual fans | `MetricTooltip.tsx:10-33` |
| P-M6 | Make freshness badge more prominent when data is stale | `DashboardShell.tsx:36-39` |
| P-M7 | Add GitHub, contact, and social links to footer | `Footer.tsx` |
| P-M8 | Create glossary page for SEO | `app/glossary/page.tsx` (new) |

### Business & Launch (7 items)
| # | Fix | File |
|---|-----|------|
| L-M1 | Tailwind already pinned (Phase 0) | ✅ |
| L-M2 | Add minimal privacy policy page | `app/privacy/page.tsx` (new) |
| L-M3 | Register @yardsperpass social media accounts | External |
| L-M4 | Set up Vercel preview deployments + branch protection | GitHub settings |
| L-M5 | Run Lighthouse audit, establish performance baselines | Post-deploy |
| L-M6 | Add nflverse data size validation (abort if download <1MB) | `ingest.py` downloads |
| L-M7 | Document competitive positioning | `docs/positioning.md` (new) |

---

## Phase 3 — Nice to Have (LOW Priority, 42 items)

### Data & Analytics (10)
No playoff toggle | WAS anachronistic team name for 2020-2021 | NaN comparison fragility in two_point filter | No home/away splits | No rolling averages or trends | No "what is a dropback?" explanation on slider | No database migration strategy | getDataFreshness silently returns null | No alerting on workflow failures | No Supabase connection smoke test in CI

### Frontend & Design (10)
Sticky column visual seam on hover | WAS→wsh ESPN slug inconsistency | Next 14→15 searchParams typing | Range slider no custom track styling | EPA disclaimer too subtle | Dead code in lib/supabase/client.ts | No export/share functionality | No season comparison view

### Backend & Infrastructure (7)
Health endpoint no rate limiting | Seed workflow sequential processing | .env file REVALIDATE_SECRET inconsistency | No success notification after refresh | Dead lib/supabase/client.ts | next.config ESPN patterns unused (no `<Image>` used) | No backup strategy documented

### Testing & Reliability (5)
No offline/service worker fallback | No empty-season graceful message | ESLint config may need customization | No local dev smoke test script | No Lighthouse CI performance budget

### Product & Content (5)
No RSS feed or update notifications | No breadcrumbs | Landing page mentions "success rate" not prominently shown | No scatter plot onboarding/walkthrough | Site name "Yards Per Pass" vs EPA focus

### Business & Launch (5)
Vercel free tier bandwidth limits | No content calendar | Domain purchase unconfirmed | No contributor guide or license | Dark mode CSS vars defined but unused

---

## Quick Reference: File Change Counts

| File | Phase 1 Changes | Phase 2 Changes |
|------|----------------|----------------|
| `scripts/ingest.py` | 8 | 4 |
| `components/charts/TeamScatterPlot.tsx` | 6 | 2 |
| `components/tables/QBLeaderboard.tsx` | 1 | 1 |
| `components/ui/MetricTooltip.tsx` | 1 | 1 |
| `lib/data/queries.ts` | 0 | 2 |
| `lib/types/index.ts` | 0 | 2 |
| `app/page.tsx` | 1 | 1 |
| `app/layout.tsx` | 1 | 0 |
| Error/loading files | 2 | 4 |
| New files needed | 0 | 8+ |
