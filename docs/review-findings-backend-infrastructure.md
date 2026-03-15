# Backend & Infrastructure Review Findings
**Date:** 2026-03-15
**Method:** Focused-lens (same as Frontend & Design)
**Reviewers:** 15 experts across 3 specialized teams
- Team Alpha (Bugs & Correctness): 5 reviewers — DevOps Engineer, Backend Developer, Database Reliability Engineer, Security Analyst, Python Developer
- Team Bravo (Gaps & Completeness): 5 reviewers — Platform Architect, CI/CD Specialist, Data Pipeline Engineer, SRE, Infrastructure Reviewer
- Team Charlie (User Experience & Edge Cases): 5 reviewers — Developer Advocate, Ops On-Call Engineer, OSS Contributor (fork experience), Deployment Specialist, Edge Case Tester
**Status:** All 15 reviewers reached 100% consensus after cross-team debate

---

## Scope
Files reviewed: `scripts/ingest.py`, `scripts/schema.sql`, `scripts/requirements.txt`, `.github/workflows/data-refresh.yml`, `.github/workflows/seed.yml`, `lib/supabase/server.ts`, `lib/supabase/client.ts`, `lib/data/queries.ts`, `lib/types/index.ts`, `app/api/health/route.ts`, `app/api/revalidate/route.ts`, `next.config.mjs`, `package.json`, `.env.example`, `.env.local.example`

**Note:** Data correctness issues (formulas, aggregation logic) are covered in the Data & Analytics review. This section focuses on infrastructure, deployment, CI/CD, database operations, and backend reliability.

---

## Cross-Team Debate: Key Resolutions

### Overlap 1: Revalidation failure handling
- **Team Alpha** (HIGH): "Silent failure means stale website after successful data update"
- **Team Charlie** (HIGH): "Ops engineer has no way to know revalidation failed"
- **Resolution → HIGH**: Both teams agree. The `|| echo "Revalidation skipped"` swallows the failure completely. Data updates in Supabase but website serves stale ISR cache for up to 1 hour.

### Overlap 2: Hardcoded year defaults in workflows
- **Team Alpha** (MEDIUM): "2025 hardcoded in workflow_dispatch defaults"
- **Team Bravo** (HIGH): "Both workflows + ingest.py must be updated manually for new season"
- **Resolution → HIGH**: Already tracked in Data & Analytics H3 for `ingest.py`. The workflow defaults are a separate but related issue — they affect manual dispatch UX, not automated runs.

### Overlap 3: Seed workflow missing revalidation
- **Team Bravo** + **Team Charlie** both flagged this
- **Resolution → MEDIUM**: Seed is a one-time operation. The 1-hour ISR cache will catch up. Not urgent but confusing for first-time setup.

---

## CRITICAL (0)

No critical backend/infrastructure issues found. (Data formula issues are tracked in the Data & Analytics review.)

---

## HIGH (5) — Fix before or immediately after launch

### H1: Revalidation failure is completely silent
- **File:** `.github/workflows/data-refresh.yml` lines 48-51
- **Problem:** The ISR revalidation step uses `|| echo "Revalidation skipped (site may not be deployed yet)"`. If `SITE_URL` is wrong, `REVALIDATE_SECRET` doesn't match, or the endpoint returns 401/500, the error is swallowed. The ingest succeeds (data is in Supabase) but the website serves stale cached pages for up to 1 hour.
- **Impact:** Every Wednesday, data could update in the DB without the website reflecting it. No alert, no failure in the workflow run.
- **Fix:** Remove the `|| echo` fallback. Let curl fail the step if revalidation fails. Or at minimum, check the HTTP status code:
  ```yaml
  - name: Trigger ISR revalidation
    if: success()
    run: |
      STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X POST "${{ secrets.SITE_URL }}/api/revalidate" \
        -H "x-revalidate-secret: ${{ secrets.REVALIDATE_SECRET }}" \
        -H "Content-Type: application/json")
      if [ "$STATUS" != "200" ]; then
        echo "::warning::Revalidation returned HTTP $STATUS"
      fi
  ```
- **Found by:** Team Alpha + Team Charlie

### H2: No retry on database upsert operations
- **File:** `scripts/ingest.py` lines 396-461
- **Problem:** The `@retry` decorator is applied to `download_pbp()` and `download_roster()` (network calls), but NOT to any of the upsert functions. A transient PostgreSQL connection drop during `upsert_qb_stats()` loses all computed data for that season — the expensive pandas computation (seconds to minutes) is thrown away.
- **Impact:** A transient DB error during the weekly refresh means the entire season's data fails silently. The script prints the exception and moves on (or crashes).
- **Fix:** Apply `@retry(max_retries=2, delay=3)` to `upsert_team_stats`, `upsert_qb_stats`, and `update_freshness`. Or wrap the upsert block in a try/retry loop in `process_season()`.
- **Found by:** Team Bravo

### H3: `psycopg2.connect()` with no connection timeout
- **File:** `scripts/ingest.py` line 511
- **Problem:** `conn = psycopg2.connect(db_url)` uses no `connect_timeout` parameter. If the Supabase database is unreachable (wrong URL, firewall, maintenance), the connection attempt hangs indefinitely. The workflow has a 30-minute global timeout, but that's a long wait before failure.
- **Impact:** A misconfigured `DATABASE_URL` or Supabase outage causes the GitHub Actions job to hang for 30 minutes before being killed, consuming CI minutes.
- **Fix:** Add timeout: `conn = psycopg2.connect(db_url, connect_timeout=30)`. Also consider adding `options='-c statement_timeout=300000'` (5 min per statement).
- **Found by:** Team Alpha

### H4: Workflow `workflow_dispatch` defaults hardcoded to '2025'
- **File:** `.github/workflows/data-refresh.yml` line 12, `.github/workflows/seed.yml` line 10
- **Problem:** Manual dispatch defaults show '2025' in the GitHub Actions UI. When the 2026 season starts, a developer manually triggering the workflow might not notice the default is wrong and accidentally refresh the wrong season.
- **Impact:** Manual refreshes during 2026+ season would process 2025 data unless the operator remembers to change the input field.
- **Fix:** Use a dynamic default in the workflow (GitHub Actions doesn't support computed defaults natively, but the `Resolve season` step can detect current season):
  ```yaml
  - name: Resolve season
    id: vars
    run: |
      if [ -n "${{ github.event.inputs.season }}" ]; then
        echo "season=${{ github.event.inputs.season }}" >> $GITHUB_OUTPUT
      else
        MONTH=$(date +%m)
        YEAR=$(date +%Y)
        if [ "$MONTH" -lt 3 ]; then
          YEAR=$((YEAR - 1))
        fi
        echo "season=$YEAR" >> $GITHUB_OUTPUT
      fi
  ```
- **Found by:** Team Alpha + Team Bravo (cross-ref: Data & Analytics H3)

### H5: No structured logging in ingest pipeline
- **File:** `scripts/ingest.py` (all `print()` statements)
- **Problem:** All output is via `print()`. No log levels (INFO, WARNING, ERROR), no timestamps, no structured format. When debugging a failed GitHub Actions run, you have to scan raw stdout for clues. Errors from pandas or psycopg2 aren't wrapped with context.
- **Impact:** Debugging production failures requires reading unstructured text output. Can't filter by severity. Can't tell timing of each phase.
- **Fix:** Replace `print()` with Python `logging` module. Add timestamps and levels:
  ```python
  import logging
  logging.basicConfig(level=logging.INFO, format='%(asctime)s %(levelname)s %(message)s')
  logger = logging.getLogger(__name__)
  ```
- **Found by:** Team Bravo

---

## MEDIUM (9) — Address in next iteration

### M1: Duplicate and conflicting env example files
- **Files:** `.env.example` vs `.env.local.example`
- **Problem:** Two env example files with overlapping but different content. `.env.example` has `REVALIDATE_SECRET` and `SITE_URL`; `.env.local.example` has `NEXT_PUBLIC_SITE_URL` instead. A developer setting up the project doesn't know which to follow.
- **Fix:** Consolidate into a single `.env.example` with all variables and clear comments indicating which are needed for local dev vs. CI.
- **Found by:** Team Charlie

### M2: `NEXT_PUBLIC_SITE_URL` in .env.local.example but never used in codebase
- **File:** `.env.local.example` line 11
- **Problem:** `NEXT_PUBLIC_SITE_URL=https://yardsperpass.com` is listed but never referenced in any TypeScript or Python file. It pollutes the env example with a dead variable.
- **Fix:** Remove from the example file, or use it for OG metadata/canonical URLs if needed.
- **Found by:** Team Bravo

### M3: Seed workflow missing ISR revalidation after bulk data load
- **File:** `.github/workflows/seed.yml`
- **Problem:** After seeding 6 seasons of historical data, the website won't reflect the new data until the ISR cache (1 hour) expires naturally. The data-refresh workflow has a revalidation step, but the seed workflow doesn't.
- **Fix:** Add the same revalidation curl step from data-refresh.yml at the end of the seed job.
- **Found by:** Team Bravo + Team Charlie

### M4: No cleanup mechanism for orphaned/stale data rows
- **File:** `scripts/ingest.py` upsert functions
- **Problem:** Upserts handle inserts and updates but never delete. If a QB is removed from the roster filter (e.g., reclassified to non-QB), or if nflverse corrects data by removing a player entirely, the old row persists in `qb_season_stats` forever.
- **Fix:** Add a `DELETE FROM qb_season_stats WHERE season = %s AND player_id NOT IN (...)` step after upserting, passing the current set of valid player_ids. Or use a "last_seen" timestamp.
- **Found by:** Team Bravo

### M5: `createServerClient()` creates a new Supabase client on every call
- **File:** `lib/supabase/server.ts`
- **Problem:** Every data fetch (`getTeamStats`, `getQBStats`, `getDataFreshness`, `getAvailableSeasons`) creates a brand-new Supabase client. On the teams page, 3 clients are created in a single render.
- **Impact:** Minor — Supabase JS client is lightweight. But it's wasteful and could become an issue at scale.
- **Fix:** Module-level singleton:
  ```ts
  let _client: ReturnType<typeof createClient>;
  export function createServerClient() {
    if (!_client) {
      _client = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
      );
    }
    return _client;
  }
  ```
- **Found by:** Team Alpha

### M6: Weekly cron runs during NFL offseason (Feb-Sep)
- **File:** `.github/workflows/data-refresh.yml` line 6
- **Problem:** `cron: '0 11 * * 3'` runs every Wednesday year-round. During the offseason, it downloads the same PBP data, computes identical stats, and upserts unchanged rows. ~30 weeks of wasted CI time per year.
- **Fix:** Add a conditional check: only run if the current month is September through February (NFL regular season + playoffs). Or accept the waste since it's idempotent and costs nothing on GitHub's free tier.
- **Found by:** Team Charlie

### M7: No `--dry-run` sample value output
- **File:** `scripts/ingest.py` lines 478-482
- **Problem:** `--dry-run` mode only shows row counts ("Would upsert: 32 team rows, 45 QB rows"). It doesn't show any sample data values, making it impossible to verify computation correctness without actually writing to the database.
- **Fix:** Add a `--verbose` flag that prints 3-5 sample rows (top QBs by EPA) during dry-run.
- **Found by:** Team Charlie

### M8: Python dependency `psycopg2-binary` is not production-recommended
- **File:** `scripts/requirements.txt` line 3
- **Problem:** `psycopg2-binary` bundles its own libpq. The psycopg2 docs recommend using `psycopg2` (not `-binary`) in production. In a CI context (GitHub Actions), binary is actually fine and avoids compilation. But if someone runs the ingest locally on a different platform, they could hit binary compatibility issues.
- **Impact:** Low — binary works fine in CI and most dev environments.
- **Fix:** Acceptable as-is for this use case. Note in a comment if desired.
- **Found by:** Team Alpha

### M9: No deployment documentation in the repository
- **File:** Project-wide
- **Problem:** Deployment steps (Supabase setup, Vercel connection, GitHub secrets) are documented only in the external memory file, not in the repository itself. A collaborator or future-you has no in-repo guide.
- **Fix:** Add a brief "Deployment" section to the project README or a `docs/deploy.md` with the 5-step process.
- **Found by:** Team Bravo

---

## LOW (7) — Nice to have

| # | Finding | File/Location | Found by |
|---|---------|---------------|----------|
| L1 | Health endpoint has no rate limiting — could be hammered | `app/api/health/route.ts` | Alpha |
| L2 | Seed workflow processes seasons sequentially — no parallelization for 6 seasons | `.github/workflows/seed.yml` | Charlie |
| L3 | `.env.example` has `REVALIDATE_SECRET` but `.env.local.example` doesn't | Both env files | Charlie |
| L4 | No success notification after weekly refresh — only GitHub's default failure emails | `.github/workflows/data-refresh.yml` | Charlie |
| L5 | `lib/supabase/client.ts` exists but is never imported (dead code) | `lib/supabase/client.ts` | Bravo |
| L6 | `next.config.mjs` configures ESPN image remote patterns but `<Image>` is never used (only raw SVG `<image>`) | `next.config.mjs` | Alpha |
| L7 | No database backup strategy documented (Supabase has automatic backups on paid plans) | Project-wide | Bravo |

---

## Already Tracked in Previous Reviews

These findings were identified but are already captured in the Data & Analytics review:

| Data & Analytics # | Finding | Relevant here? |
|---|---------|---|
| H3 | CURRENT_SEASON hardcoded to 2025 in ingest.py | Yes — also affects workflow defaults (H4 above) |
| H4 | No transaction wrapping across upserts | Yes — infrastructure concern |
| H5 | No data validation before DB write | Yes |
| H6 | No roster column validation | Yes |
| M9 | TypeScript types declare `number` for nullable fields | Yes |
| L7 | No database migration strategy | Yes |
| L8 | `getDataFreshness()` silently returns null on error | Yes |
| L9 | No alerting on workflow failures | Yes — related to H1 above |
| L10 | No Supabase connection smoke test in CI | Yes |

---

## VERIFIED CORRECT (What all 15 reviewers confirmed is right)

### Database & Schema
- RLS policies: public SELECT only, no public write — correct separation
- Upsert idempotency: `ON CONFLICT (composite_key) DO UPDATE SET` — safe for repeated runs
- NaN-to-None conversion (`where(df.notna(), None)`) prevents PostgreSQL NaN in NUMERIC columns
- `data_freshness` uses per-season rows with `ON CONFLICT (season)` — correct for multi-season support
- UUID primary keys with gen_random_uuid() — no collision risk
- Proper foreign key: `team_id TEXT REFERENCES teams(id)` with historical abbreviation handling
- Index strategy: composite indexes on (season, team_id) and separate indexes on season and player_id

### CI/CD Pipeline
- Retry with exponential backoff on network downloads — well-implemented
- Pip dependency caching with `hashFiles('scripts/requirements.txt')` — cache busts on dependency changes
- All Python dependencies pinned to exact versions in requirements.txt
- Workflow timeout limits (30 min refresh, 180 min seed) — prevent runaway jobs
- Seed workflow error handling: tracks failed seasons, reports with `::error::`, non-zero exit
- `actions/checkout@v4`, `actions/setup-python@v5`, `actions/cache@v4` — current versions

### Security
- `DATABASE_URL` stored as GitHub Actions secret (not in code)
- `REVALIDATE_SECRET` validated on POST endpoint before triggering revalidation
- Revalidation endpoint fails closed (returns 401 if secret is missing or wrong)
- `.env.local` gitignored by Next.js default — no credential leak risk
- No raw SQL injection — uses `execute_values` with parameterized queries and `%s` placeholders
- Non-null assertions on env vars (`!`) are server-side only — never exposed to client

### Ingest Pipeline
- `load_dotenv()` for local development, env vars for CI — correct dual-mode
- `--dry-run` flag prevents accidental writes during development
- Win/loss/tie computed from unfiltered PBP (ensures all games counted even if some plays filtered)
- Historical team abbreviations (OAK, SD, STL) seeded for foreign key integrity
- `execute_values` for batch inserts — efficient for ~32 team rows and ~200 QB rows
