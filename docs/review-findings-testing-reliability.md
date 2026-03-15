# Testing & Reliability Review Findings
**Date:** 2026-03-15
**Method:** Focused-lens
**Reviewers:** 15 experts across 3 specialized teams
- Team Alpha (Bugs & Correctness): 5 reviewers — QA Lead, Test Automation Engineer, Python Test Specialist, TypeScript Test Engineer, Reliability Engineer
- Team Bravo (Gaps & Completeness): 5 reviewers — Test Architect, Coverage Analyst, CI/CD Test Specialist, Integration Test Expert, Data Quality Tester
- Team Charlie (User Experience & Edge Cases): 5 reviewers — Error Handling Specialist, Chaos Engineer, Edge Case Tester, Monitoring Specialist, Degradation Analyst
**Status:** All 15 reviewers reached 100% consensus after cross-team debate

---

## Scope
This section evaluates test coverage, error handling, monitoring, graceful degradation, and overall reliability posture. Formula correctness issues are covered in Data & Analytics; infrastructure issues in Backend & Infrastructure.

---

## Cross-Team Debate: Key Resolutions

### Resolution 1: Severity of "zero tests"
- **Team Alpha**: CRITICAL (already tracked in Data & Analytics C2)
- **Team Bravo**: CRITICAL — wants it elevated beyond C2 with specific test categories
- **Resolution**: Not re-listed as a standalone finding (already tracked as Data & Analytics C2). Instead, this section documents the **specific test suites that should exist** as HIGH-priority gaps, providing the roadmap that C2 calls for.

### Resolution 2: CI lint/type-check — is it CRITICAL or HIGH?
- **Team Alpha**: CRITICAL ("broken code could deploy")
- **Team Bravo**: HIGH ("Next.js build catches most errors anyway")
- **Resolution → HIGH**: Next.js `build` catches type errors during compilation. But there's no `build` step in CI either — both are HIGH.

---

## CRITICAL (1) — Must fix before launch

### C1: No CI pipeline for code quality (no lint, no type-check, no build, no test)
- **File:** `.github/workflows/` — no CI workflow exists for the Next.js app
- **Problem:** The project has TWO workflows (data-refresh, seed) but ZERO for the frontend application. No step runs `next lint`, `tsc --noEmit`, `next build`, or any test command. A developer could push broken TypeScript, ESLint violations, or a build-failing change to `main` and it would deploy to Vercel without any gate.
- **Impact:** This is worse than "zero tests" (Data & Analytics C2). Even if you had tests, there's no CI to run them. The entire quality gate is missing. Vercel's build step is the ONLY safety net, and by then the code is already merged.
- **Fix:** Create `.github/workflows/ci.yml`:
  ```yaml
  name: CI
  on: [push, pull_request]
  jobs:
    check:
      runs-on: ubuntu-latest
      steps:
        - uses: actions/checkout@v4
        - uses: actions/setup-node@v4
          with: { node-version: '20' }
        - run: npm ci
        - run: npm run lint
        - run: npx tsc --noEmit
        - run: npm run build
        # - run: npm test  # When tests are added
  ```
- **Found by:** All 3 teams (unanimous)

---

## HIGH (7) — Fix before or immediately after launch

### H1: No golden-value tests for core formulas (passer rating, EPA aggregation)
- **File:** `scripts/ingest.py` — `passer_rating()`, EPA/DB, ANY/A, completion%, success rate
- **Problem:** The passer rating formula has 4 components with clamping logic. A single `>` vs `>=` error changes output for every QB. EPA/DB, ANY/A, YPA, and completion% all have division-by-zero guards that could silently produce wrong values. Zero tests verify any of these.
- **Impact:** One formula regression and the entire site's credibility is gone — NFL Twitter will notice wrong numbers instantly.
- **Fix:** Add `tests/test_formulas.py` with pytest:
  ```python
  def test_passer_rating_perfect():
      assert passer_rating(10, 10, 400, 4, 0) == 158.3
  def test_passer_rating_zero_attempts():
      assert passer_rating(0, 0, 0, 0, 0) == 0.0
  def test_passer_rating_2024_mahomes():
      assert passer_rating(405, 600, 4800, 30, 10) == pytest.approx(101.3, abs=0.1)
  ```
- **Found by:** Team Alpha + Team Bravo (cross-ref: Data & Analytics C2)

### H2: No contract validation between Python schema and TypeScript types
- **File:** `scripts/ingest.py` line 317-323 (Python cols), `lib/types/index.ts` (TS interfaces)
- **Problem:** The Python `cols` list in `aggregate_qb_stats()` defines which columns are inserted into the database. The TypeScript `QBSeasonStat` interface defines which fields the frontend expects. If Python adds a column but TypeScript doesn't get updated (or vice versa), the mismatch is silent — TypeScript shows `undefined` for missing fields, or a DB column goes unused.
- **Impact:** Schema drift between ingest pipeline and frontend. No automated check catches it.
- **Fix:** Either: (a) Generate TypeScript types from the SQL schema using a tool like `supabase gen types`, or (b) Add a test that compares the Python column list with the TypeScript interface keys, or (c) Add a shared JSON schema that both Python and TypeScript validate against.
- **Found by:** Team Bravo

### H3: Error boundaries don't log errors — debugging is blind
- **File:** `app/teams/error.tsx`, `app/qb-leaderboard/error.tsx`
- **Problem:** Both error components receive `{ error, reset }` props but only use `reset`. The `error` object is completely ignored — not logged, not displayed, not sent to any monitoring service. When the chart crashes on a specific browser, there's no way to know what happened.
- **Impact:** Production errors are invisible. The user sees "Unable to load data" but the developer has no diagnostic information.
- **Fix:** At minimum, log to console: `useEffect(() => { console.error('Page error:', error) }, [error])`. Better: integrate an error reporting service (Sentry, Vercel Analytics).
- **Found by:** Team Alpha + Team Charlie

### H4: No client-side error monitoring
- **File:** Project-wide
- **Problem:** No error tracking service (Sentry, Vercel Analytics, LogRocket, etc.). Client-side JavaScript errors — D3 crash on Safari, ResizeObserver failure, Supabase timeout — happen silently in users' browsers with no visibility.
- **Impact:** You won't know your site is broken until someone tweets about it.
- **Fix:** Add Sentry Free tier or Vercel Analytics (both have generous free plans).
- **Found by:** Team Charlie

### H5: No data freshness monitoring
- **File:** Project-wide
- **Problem:** The weekly Wednesday data refresh could fail silently for weeks (especially with the silent revalidation issue from Backend & Infrastructure H1). There's no alert if `data_freshness.last_updated` is more than 10 days old. The health endpoint exists but nobody monitors it.
- **Impact:** The site could show stale Week 5 data during Week 12, and the only way to notice is manually checking.
- **Fix:** Add an uptime monitor (UptimeRobot, Better Stack free tier) that hits `/api/health` and alerts if `through_week` is more than 2 weeks behind the current NFL week. Or add a client-side banner: "Data last updated X days ago."
- **Found by:** Team Bravo + Team Charlie

### H6: No integration test for ingest pipeline end-to-end
- **File:** `scripts/ingest.py`
- **Problem:** The ingest pipeline is the most complex code in the project: download → filter → aggregate teams → aggregate QBs → scramble backfill → merge rushes → upsert. A test that runs the pipeline against a small fixture dataset and verifies output row counts and sample values would catch aggregation bugs before they reach production.
- **Fix:** Create a small fixture (~100 plays, 3 QBs, 4 teams) as a Parquet file. Run `aggregate_team_stats()` and `aggregate_qb_stats()` against it and assert specific values.
- **Found by:** Team Bravo

### H7: `parseNumericFields` uses unsafe `as unknown as` type casting
- **File:** `lib/data/queries.ts` lines 44-45, 62-63
- **Problem:** `parseNumericFields(row, TEAM_NUMERIC_FIELDS) as unknown as TeamSeasonStat` — the double cast bypasses TypeScript's type system entirely. If Supabase returns a row with a missing field, TypeScript won't catch it. The `as unknown as` pattern is a red flag for type safety.
- **Impact:** Type errors at runtime that TypeScript was supposed to prevent.
- **Fix:** Create a typed `parseTeamStats()` function that validates the shape, or use Supabase's generated types (`supabase gen types typescript`) to get type-safe query results.
- **Found by:** Team Alpha

---

## MEDIUM (8) — Address in next iteration

### M1: Error messages give users no actionable information
- **File:** `app/teams/error.tsx`, `app/qb-leaderboard/error.tsx`
- **Problem:** Both say "Unable to load data. Please try again later." with a "Try again" button. No suggestion to check internet connection, no indication whether the issue is temporary or permanent, no way to report the problem.
- **Fix:** Add context: "This might be temporary — try refreshing. If the problem persists, the data source may be updating." Include a link to report issues.
- **Found by:** Team Charlie

### M2: Loading skeletons don't match actual component layout
- **File:** `app/teams/loading.tsx`, `app/qb-leaderboard/loading.tsx`
- **Problem:** Teams loading shows a single 560px gray box (roughly matches chart). QB loading shows 10 shimmer rows (actual table could be 25-40 rows). The skeleton doesn't include the search bar, slider, or header row that the real component has, causing layout shift.
- **Fix:** Match skeleton structure to actual component: search bar placeholder + header row + 15 shimmer rows.
- **Found by:** Team Charlie

### M3: TypeScript interfaces declare `number` for nullable database fields
- **File:** `lib/types/index.ts`
- **Problem:** Fields like `cpoe`, `rush_epa_per_play`, `adot` can be NaN (from `parseNumericFields` null→NaN conversion). TypeScript declares them as `number`, which is technically correct (NaN is a number), but loses the semantic information that these fields need null-checking.
- **Fix:** Declare nullable fields as `number | null` and handle null explicitly in components. Or add JSDoc annotations marking which fields can be NaN.
- **Found by:** Team Alpha (cross-ref: Data & Analytics M9)

### M4: No E2E test verifying pages render
- **File:** Project-wide
- **Problem:** No Playwright or Cypress tests verifying that `/teams` and `/qb-leaderboard` render without JavaScript errors. A broken import, missing env var, or Supabase schema change could make pages fail silently in production.
- **Fix:** Add minimal Playwright test: navigate to each page, assert no console errors, assert key elements exist.
- **Found by:** Team Bravo

### M5: No visual regression testing for chart output
- **File:** `components/charts/TeamScatterPlot.tsx`
- **Problem:** D3 chart rendering is complex (scales, positioning, labels, colors). A code change could subtly shift logo positions, break quadrant colors, or misalign axes without any test catching it.
- **Fix:** Add Playwright screenshot comparison tests for the scatter plot page with fixture data.
- **Found by:** Team Bravo

### M6: No type-safe Supabase client (no generated types)
- **File:** `lib/supabase/server.ts`
- **Problem:** `createClient()` is called without generic type parameters. All queries return `any` from Supabase's perspective. The TypeScript types in `lib/types/index.ts` are manually maintained copies of the schema — not generated from the database.
- **Fix:** Run `supabase gen types typescript --project-id <id>` to generate `database.types.ts`, then pass it as a generic: `createClient<Database>(url, key)`. This makes query results type-safe and catches schema mismatches at compile time.
- **Found by:** Team Alpha

### M7: `getDataFreshness()` silently returns null on any error
- **File:** `lib/data/queries.ts` line 77
- **Problem:** `if (error) return null` — no logging, no error classification. A permissions error, a schema change, and a network timeout all produce the same result: null. The calling component just shows no freshness badge.
- **Fix:** Log the error: `if (error) { console.error('Freshness query failed:', error.message); return null; }`.
- **Found by:** Team Charlie (cross-ref: Data & Analytics L8)

### M8: Duplicated error boundary components
- **File:** `app/teams/error.tsx`, `app/qb-leaderboard/error.tsx`
- **Problem:** Both files are identical — same markup, same styling, same "Unable to load data" message. If you update one, you have to remember to update the other.
- **Fix:** Extract a shared `ErrorState` component that both routes use.
- **Found by:** Team Alpha

---

## LOW (5) — Nice to have

| # | Finding | File/Location | Found by |
|---|---------|---------------|----------|
| L1 | No offline/service worker fallback — Supabase downtime = broken pages | Project-wide | Charlie |
| L2 | No graceful message for empty-but-valid seasons (e.g., "2026 season hasn't started yet") | `app/teams/page.tsx` line 51 | Charlie |
| L3 | `next lint` script exists in package.json but ESLint config may need rule customization for project patterns | `package.json`, `.eslintrc` | Bravo |
| L4 | No smoke test script for local development (verify Supabase connection before starting dev server) | Project-wide | Bravo |
| L5 | No performance budget or Lighthouse CI check | Project-wide | Charlie |

---

## Already Tracked in Previous Reviews

| Previous Review # | Finding | Section |
|---|---------|---|
| Data & Analytics C2 | Zero tests in the entire project | This section provides the roadmap |
| Data & Analytics M9 | TypeScript types declare `number` for nullable fields | M3 above |
| Data & Analytics L8 | `getDataFreshness()` silently returns null | M7 above |
| Backend & Infra H1 | Silent revalidation failure | Related to H5 above (monitoring) |
| Backend & Infra H5 | No structured logging | Related to H3/H4 above |

---

## VERIFIED CORRECT (What all 15 reviewers confirmed is right)

### TypeScript Configuration
- `strict: true` enabled in tsconfig.json — catches many type errors at compile time
- `noEmit: true` — correct for Next.js (it handles compilation)
- `isolatedModules: true` — correct for bundler-mode compilation
- `incremental: true` — faster rebuilds during development

### Error Handling Patterns
- Error boundaries exist for both data routes (/teams, /qb-leaderboard)
- Loading states (Suspense boundaries) exist for both data routes
- NaN/null handling in `formatVal()` — em-dash display is correct
- Sort function handles NaN safely (pushes to bottom)
- `getTeamStats`/`getQBStats` throw on error (caught by error boundary) — correct pattern
- `getDataFreshness` returns null on error (non-critical data, shouldn't crash the page) — acceptable

### Data Pipeline Resilience
- `@retry` decorator with exponential backoff on network calls
- `filter_plays()` validates play type, season type, and two-point attempts
- `REQUIRED_PBP_COLS` validation on download — catches nflverse schema changes early
- NaN→None conversion before database writes
- UPSERT idempotency — repeated runs produce same result

### Framework-Level Safety
- Next.js ISR with `revalidate = 3600` — stale data served during revalidation (not broken page)
- React error boundaries catch client-side rendering errors
- Supabase RLS prevents unauthorized writes
- `ssr: false` on D3 component prevents server-side window/document errors

---

## Recommended Test Plan (Priority Order)

Based on all 15 reviewers' consensus, the minimum viable test suite for launch should include:

### Phase 1: Formula Correctness (pytest, ~10 tests)
1. `passer_rating()` — perfect game (158.3), zero attempts (0.0), 3 known NFL stat lines
2. EPA/DB — verify sum/count matches expected for 5-play fixture
3. ANY/A — verify formula with known inputs (once sack_yards fix from Data & Analytics C1 is implemented)
4. `filter_plays()` — verify correct row counts for fixture data
5. `aggregate_qb_stats()` — verify output columns match expected set

### Phase 2: CI Pipeline (GitHub Actions, 1 workflow)
1. `next lint` — catches ESLint violations
2. `tsc --noEmit` — catches TypeScript errors
3. `next build` — catches build failures
4. `pytest tests/` — runs formula tests

### Phase 3: Integration (pytest, ~5 tests)
1. Full pipeline with 100-play fixture → verify QB count, team count, column names
2. Scramble backfill → verify passer_player_id populated
3. Multi-team QB → verify assigned to team with most dropbacks
4. NaN-to-None conversion → verify no NaN values in output

### Phase 4: E2E & Monitoring (Playwright + Sentry)
1. Smoke test: each page loads without console errors
2. Sentry integration for client-side error tracking
3. Uptime monitor on `/api/health`
