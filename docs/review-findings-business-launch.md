# Business & Launch Review Findings
**Date:** 2026-03-15
**Method:** Focused-lens
**Reviewers:** 15 experts across 3 specialized teams
- Team Alpha (Bugs & Correctness): 5 reviewers — Launch Readiness Auditor, Legal/Compliance Analyst, Brand Strategist, DevOps Deploy Specialist, Risk Assessor
- Team Bravo (Gaps & Completeness): 5 reviewers — Growth Product Manager, Marketing Strategist, Analytics Lead, Community Manager, Competitive Intelligence Analyst
- Team Charlie (User Experience & Edge Cases): 5 reviewers — Launch Day Ops Engineer, Viral Traffic Specialist, Third-Party Dependency Analyst, Staging/QA Lead, Cost Analyst
**Status:** All 15 reviewers reached 100% consensus after cross-team debate

---

## Scope
This section evaluates launch readiness: legal/licensing, deployment process, growth strategy, third-party dependency risks, performance measurement, and competitive positioning.

---

## Cross-Team Debate: Key Resolutions

### Resolution 1: ESPN logo licensing
- **Team Alpha**: HIGH ("Using copyrighted ESPN assets without authorization is a legal risk")
- **Team Charlie**: HIGH ("ESPN could block hotlinking at any time, breaking all logos instantly")
- **Resolution → HIGH**: Both the legal risk AND the operational risk are real. The fallback colored circles exist but produce a significantly degraded experience.

### Resolution 2: Severity of "no analytics"
- **Team Bravo**: HIGH ("Launching without any traffic measurement is launching blind")
- **Team Alpha**: MEDIUM ("Analytics can be added post-launch without breaking anything")
- **Resolution → HIGH**: For a portfolio project trying to gain traction on NFL Twitter, you need Day 1 data on referral sources, page engagement, and feature usage to iterate.

---

## CRITICAL (0)

No critical business/launch issues found. The MVP is technically deployable.

---

## HIGH (3) — Fix before or immediately after launch

### H1: ESPN CDN team logos used without licensing — legal risk + hotlink vulnerability
- **File:** `lib/data/teams.ts` (32 team entries with ESPN CDN URLs)
- **Problem (Legal):** The site loads team logos directly from `a.espncdn.com`. These are ESPN's copyrighted assets. Using them without licensing is technically unauthorized. While ESPN hasn't historically enforced hotlink restrictions, the risk increases if the site gains visibility.
- **Problem (Operational):** ESPN could add referrer restrictions, change URL patterns, or rate-limit at any time. All 32 logos would break simultaneously with no warning.
- **Impact:** Legal cease-and-desist or sudden logo breakage on the flagship chart.
- **Fix (Short-term):** The colored-circle fallback already exists (TeamScatterPlot.tsx line 178). Ensure it works reliably and looks acceptable. (Medium-term): Download logos, host in `/public/logos/`, or use the NFL's official SVG team logos (Creative Commons). (Long-term): Contact ESPN or NFL for official licensing if the site grows.
- **Found by:** Team Alpha + Team Charlie

### H2: No analytics or performance measurement — launching blind
- **File:** Project-wide
- **Problem:** No Vercel Analytics, no Google Analytics, no Plausible, no PostHog — nothing. After launch, there's no way to know: How many visitors? Which page do they visit first? Do they use the season selector? How long do they stay? Where do they come from (Twitter, Reddit, Google)?
- **Impact:** Can't measure success, can't identify what to build next, can't optimize for the audience. Every product decision is a guess.
- **Fix:** Add Vercel Analytics (free, one line of code) or Plausible (privacy-friendly, $9/month). Alternatively, add a simple self-hosted counter. At minimum, Vercel's built-in Web Analytics gives page views and Core Web Vitals for free.
- **Found by:** Team Bravo

### H3: No launch checklist or deployment verification process
- **File:** Project-wide (deploy steps only in memory file)
- **Problem:** The deployment requires 5 manual steps (create Supabase project, set env vars, run ingest, push to GitHub, add secrets). There's no written checklist in the repository, no verification script, and no post-deploy smoke test. If any step is missed or done out of order, the site may deploy in a broken state.
- **Impact:** First deployment is high-stress with no safety net. If the site goes live with missing env vars, it shows error states to real users.
- **Fix:** Create a `docs/launch-checklist.md` with numbered steps, expected outcomes for each step, and a post-deploy verification script (hit `/api/health`, verify scatter plot loads, check leaderboard has data).
- **Found by:** Team Alpha + Team Charlie

---

## MEDIUM (7) — Address in next iteration

### M1: Tailwind CSS version not pinned (^4.2.1)
- **File:** `package.json` lines 27, 34
- **Problem:** `"tailwindcss": "^4.2.1"` and `"@tailwindcss/postcss": "^4.2.1"` use caret ranges. Tailwind v4 is still maturing. A `npm install` or Vercel build could pull in 4.3.x with breaking changes to utility classes or the CSS compiler.
- **Impact:** A deploy could silently change the site's appearance without any code changes.
- **Fix:** Pin to `"4.2.1"` (remove `^`). All other dependencies are already pinned.
- **Found by:** Team Alpha (cross-ref: Frontend & Design M11)

### M2: No privacy policy or terms of service
- **File:** Project-wide (no `/privacy` or `/terms` route)
- **Problem:** The site is publicly accessible and may be indexed by search engines. While it collects no user data directly, Vercel may set analytics cookies, and Supabase client-side queries involve network requests. A privacy policy is expected by users and potentially required depending on jurisdiction.
- **Fix:** Add a minimal privacy policy page: "We don't collect personal data. Data is sourced from nflverse (open-source). Hosted on Vercel and Supabase." This covers the basics.
- **Found by:** Team Alpha

### M3: No social media presence or community channels
- **File:** N/A (external)
- **Problem:** No @yardsperpass on Twitter/X, no subreddit, no Discord. The target audience (NFL Twitter, analytics community) is highly social. Without a presence, there's no way to announce launches, share insights, or build a following.
- **Fix:** Register @yardsperpass on Twitter/X before launch. Post the scatter plot image weekly with commentary. Engage with NFL analytics accounts (rbsdm, PFF, Next Gen Stats).
- **Found by:** Team Bravo

### M4: No staging or preview environment
- **File:** Project-wide
- **Problem:** There's no way to test changes before they go live to production. Vercel provides deploy previews for PRs, but the project is on `main` branch with no PR workflow established. A push to main deploys directly to production.
- **Fix:** Use Vercel's preview deployments on PRs. Create a simple branch protection rule: require PR for main. This gives a preview URL to verify before merge.
- **Found by:** Team Charlie

### M5: No performance baseline
- **File:** Project-wide
- **Problem:** No Lighthouse audit has been run, no Core Web Vitals baseline established. The site loads ~260KB of D3 (Frontend & Design H5) and 32 unoptimized PNGs (H6) — there's likely a performance issue that hasn't been measured.
- **Fix:** Run Lighthouse on the deployed site. Establish baselines for LCP, CLS, INP, FCP. Add Lighthouse CI to the GitHub Actions workflow (optional but recommended).
- **Found by:** Team Bravo + Team Charlie

### M6: nflverse data dependency has no fallback or monitoring
- **File:** `scripts/ingest.py` lines 46-47
- **Problem:** The pipeline depends on nflverse's GitHub releases (`github.com/nflverse/nflverse-data/releases/`). If nflverse restructures their releases, changes file names, or goes offline, the pipeline breaks. The `@retry` decorator handles transient failures but not permanent URL changes.
- **Fix:** Monitor the nflverse-data releases page. Add a validation step: if download returns <1MB (too small for PBP data), abort with a clear error rather than processing corrupted data.
- **Found by:** Team Charlie

### M7: No competitive positioning documented
- **File:** Project-wide
- **Problem:** The site competes with rbsdm.com, statmuse.com, PFF, Pro Football Reference, and Football Outsiders. There's no documented analysis of: What do they offer that we don't? What do we offer that they don't? What's our unique angle?
- **Fix:** Document the positioning: "Free, clean, no paywall — the minimalist alternative to PFF/Statmuse. EPA-first approach. Weekly automated updates." This guides future feature decisions.
- **Found by:** Team Bravo

---

## LOW (5) — Nice to have

| # | Finding | Found by |
|---|---------|----------|
| L1 | Vercel free tier has 100GB bandwidth/month — a viral NFL Twitter moment could exceed this | Charlie |
| L2 | No content calendar or published feature roadmap | Bravo |
| L3 | Watermark says "yardsperpass.com" but domain purchase status is unconfirmed | Alpha |
| L4 | No contributor guide, no open-source license, no CODE_OF_CONDUCT | Bravo |
| L5 | Dark mode CSS variables defined in `globals.css` but unused — creates false expectation for contributors | Alpha |

---

## VERIFIED CORRECT (Launch-readiness items all 15 reviewers confirmed)

### Deployment Architecture
- Vercel + Supabase + GitHub Actions is a solid, well-documented stack for this project size
- ISR with webhook revalidation is the correct pattern for weekly-updating data
- Decoupled Python ingest (no shared code with Next.js) is architecturally clean
- `.env.example` provides clear guidance for required environment variables
- `DATABASE_URL` and `REVALIDATE_SECRET` stored as GitHub secrets (not in code)

### Legal & Compliance
- nflverse data is open-source (MIT-licensed) — no licensing issue with the data itself
- nflverse attribution in footer meets their community norms
- No user authentication, no personal data collection, no cookies (from the app itself)
- Copyright notice is present in footer

### MVP Scope
- Two-page MVP (scatter plot + leaderboard) is appropriate for initial launch
- The spec explicitly scopes this as "portfolio/passion project with architecture to grow"
- Automated data pipeline means the site stays fresh without manual intervention
- ISR caching means near-zero database cost even under moderate traffic

### Technical Foundation
- All dependencies pinned to exact versions (except Tailwind — see M1)
- Python dependencies also pinned in `requirements.txt`
- GitHub Actions cron + manual dispatch covers both automated and manual refresh
- Schema supports multi-season data from day one
