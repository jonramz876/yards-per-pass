# Feature Review Team Roster — Design Spec

**Date:** 2026-03-18
**Status:** Draft
**Priority:** Accuracy and ease of use

## Overview

A standardized roster of 47 specialized review teams + 3 CEO-level reviewers that are dispatched after every feature implementation on Yards Per Pass. Every team runs on every feature. If a team finds nothing relevant to the change, they report "Not relevant" and move on. The philosophy: better to overprepare than under.

**Out of scope:** Accessibility/WCAG review is intentionally excluded per project preferences.

## Dispatch Flow

```
Feature complete (code written, tsc + build pass)
    → 47 review teams dispatched in parallel
    → Summary compiler (dedup findings, filter "not relevant" teams)
    → 3 CEO reviews dispatched in parallel (each reads compiled summary + raw reports)
    → Final scorecard presented to user
```

## Rating Rubric

All teams and CEOs use the same scale:

| Score | Meaning |
|-------|---------|
| 9-10 | Excellent — no meaningful improvements needed |
| 7-8 | Good — minor improvements only |
| 5-6 | Acceptable — notable issues exist |
| 3-4 | Significant problems — should fix before shipping |
| 1-2 | Broken or fundamentally flawed |

## Severity Definitions

- **CRITICAL**: Data is wrong, feature is broken, security vulnerability, or user sees an error. Must fix before shipping.
- **IMPORTANT**: Functionality works but is misleading, confusing, incomplete, or inconsistent. Should fix before shipping.
- **MINOR**: Polish, style, optimization, or nice-to-have. Can ship without fixing.

## Team Report Format

Every team reports in this standardized format:

```
Team: [Team Name]
Perspective: [One-line description]
Relevance: Relevant | Not relevant to this change
Rating: X/10 (only if relevant)

### Findings
- **CRITICAL**: [Issue] — [file:line] — [why it matters]
- **IMPORTANT**: [Issue] — [file:line] — [why it matters]
- **MINOR**: [Issue] — [file:line] — [why it matters]

### What Would Make It a 10
- [Concrete fix 1]
- [Concrete fix 2]
```

## Summary Compiler Rules

1. Only show teams with actual findings in the main scorecard
2. Teams reporting "Not relevant" get a single aggregate line: *"N teams reported no findings relevant to this change."*
3. Deduplicate findings flagged by multiple teams — keep the highest severity level and the most specific description (preferring the version with file:line references). Note: *"(Also flagged by: Team X, Team Y)"*
4. Sort findings by severity: CRITICAL → IMPORTANT → MINOR
5. Compile a rating table with average score
6. When teams with overlapping scope disagree, flag the disagreement for CEO arbitration

---

## The 47 Review Teams

### Category 1: Data Accuracy (6 teams)

**Team 1 — Formula Verification**
Are calculations (EPA, CPOE, passer rating, success rate, ANY/A, aDOT, etc.) implemented correctly? Do they match the stated methodology? Check both the Python ingest script and any client-side computation.

**Team 2 — Cross-Source Validation**
Do displayed numbers match nflverse source data and approximate PFR/ESPN? Are known discrepancies documented? Check glossary footnotes and tooltips for methodology difference disclaimers.

**Team 3 — Edge Case / Boundary Data**
What happens with zero carries, 0 interceptions (Infinity TD:INT), null values, NaN propagation, single-game QBs, players who changed teams mid-season? Does the UI degrade gracefully or show broken data?

**Team 4 — Data Pipeline Integrity**
Does the ingest script correctly pull, transform, aggregate, and upsert data? Are there silent truncation risks (Supabase 1000-row limit), off-by-one errors, missing rows, or race conditions in the upsert logic?

**Team 5 — Database Integrity**
Are there duplicate rows, constraint violations, or missing RLS policies? Is pagination implemented where needed? Does `cleanup_stale_rows` handle edge cases safely? Are indexes appropriate?

**Team 6 — Data Freshness / Staleness**
Is the freshness indicator accurate? Does the ISR revalidation webhook cover all data pages? Could users see stale data after a pipeline run? Is the "Through Week X" label computed correctly?

### Category 2: Visual Accuracy (3 teams)

**Team 7 — Chart-to-Data Fidelity**
Does the visual actually represent the underlying numbers? Are axes scaled correctly? Is arrow thickness proportional to carry volume? Do color thresholds match the legend? Does the scatter plot position teams at the correct coordinates?

**Team 8 — Number Display Formatting**
Are percentages shown as percentages (not raw decimals)? Are decimal places consistent across similar metrics? Do ± signs appear correctly? Is "—" used for missing data? Are EPA values always signed (+/-)?

**Team 9 — Color / Legend Consistency**
Are color scales consistent across all charts and pages? Does green always mean "good"? Do legends match the actual rendering? Are the EPA color thresholds (>0.05, >0.02, etc.) applied identically in RunGapDiagram, GapHeatmap, and PlayerGapCards?

### Category 3: Usability (6 teams)

**Team 10 — First-Time User Experience**
Can someone who has never visited understand what they're looking at within 10 seconds? Is the value proposition clear on every page? Are there onboarding prompts for complex tools like Run Gaps?

**Team 11 — Metric Comprehension**
Are stat definitions plain-English enough for a fantasy player who doesn't know what EPA stands for? Do tooltips, glossary entries, and inline explanations actually help? Could a non-analyst make a decision based on what they see?

**Team 12 — Navigation / Information Architecture**
Can users find what they need? Are cross-links between pages logical (scatter plot → QB detail, QB → Run Gaps)? Does the flow make sense? Is the glossary discoverable from within data pages?

**Team 13 — Interactive Controls**
Are filters, dropdowns, toggles, sliders, and sort buttons intuitive? Do they clearly communicate what they do and what state they're in? Does changing a filter update the view predictably? Are active states visible?

**Team 14 — Loading / Error / Empty States**
What does the user see when data is loading, fails to load, or doesn't exist for their selection? Are skeleton loaders accurate to the final layout? Do error pages provide recovery paths? Are empty states helpful (not just "No data")?

**Team 15 — Visual Hierarchy / Readability**
Is the most important information the most prominent? Are font sizes, contrast ratios, whitespace, and scanning patterns appropriate? Can a user scan the page and find what matters in 3 seconds?

### Category 4: Mobile & Responsive (2 teams)

**Team 16 — Mobile Responsiveness**
Does everything work on phone and tablet? Are tables horizontally scrollable? Are charts readable at small widths? Is there any horizontal overflow or content clipping? Do layouts stack correctly?

**Team 17 — Touch Interaction**
Are touch targets at least 44x44px? Do hover-dependent features (D3 tooltips, arrow dimming) have mobile alternatives? Is the slider usable on touch? Can users tap gap labels and stat strip cells reliably?

### Category 5: NFL Domain Knowledge (14 teams)

**Team 18 — NFL Analytics Expert**
Would someone from NFL Twitter / the analytics community find issues? Are stat definitions industry-standard? Any controversial methodology choices that would invite criticism? Would Ben Baldwin or Seth Walder push back on anything?

**Team 19 — Fantasy Football (Redraft)**
Can a season-long fantasy player get actionable insights? Does the data help with lineup decisions, waiver targets, matchup analysis, start/sit context? Are the metrics presented in a fantasy-relevant way?

**Team 20 — Fantasy Football (DFS / Betting)**
Daily fantasy and sports bettors need different data cuts — player props context, correlation stacks, game environment factors. Does the data support quick prop evaluation? Can you assess over/unders from the stats shown?

**Team 21 — Dynasty / Keeper Fantasy**
Multi-year trends matter here. Can you compare a QB across seasons to see development arcs? Can you spot a young RB whose efficiency is trending up? Does the multi-season data (2020-2025) support dynasty evaluation?

**Team 22 — Casual Fan Comprehension**
Can someone who just watches games on Sunday get value from this site without a stats background? Or is everything gatekept by analytics jargon? Would they bounce immediately or stick around?

**Team 23 — NFL Media / Content Creator**
Would a beat reporter, podcaster, or Twitter/X analyst use this for content? Can they find a narrative quickly? Are charts screenshot-ready for articles and threads? Is attribution clear for crediting?

**Team 24 — Coaching / Game Planning**
Is the matchup data actionable for actual game prep? Are the situation filters (early downs, short yardage, passing downs, red zone, goal line) the right splits that coaches actually use? Does the "EXPLOIT" flag hold up under scrutiny?

**Team 25 — Quarterback Analyst**
Are the right QB metrics highlighted in the leaderboard and stat card? Is the radar chart showing the most meaningful dimensions for QB evaluation? Are the Advanced vs Standard tabs covering what a QB evaluator needs? Is excluding sacks from success rate the right call?

**Team 26 — Running Back / Run Game Analyst**
Is the run gap data complete and useful for RB evaluation? Workload splits, efficiency by gap, situational usage, stuff rate context? Are the 7 gap labels (LE through RE) the right granularity? Is the carry threshold appropriate?

**Team 27 — Defensive Analyst**
Is the defensive gap data useful for identifying tendencies and weak points? Can you spot where a defense is vulnerable? Does the matchup overlay tell an accurate story about defensive performance by gap?

**Team 28 — Play-by-Play Data Expert (nflverse)**
Someone who knows the nflverse schema intimately. Are filters correct (`qb_dropback == 1`, `pass_attempt` for true attempts, kneel exclusion)? Is scramble attribution right (backfill passer from rusher)? Are gap mappings from `run_location` + `run_gap` accurate?

**Team 29 — Statistical Methodology**
Are weighted vs unweighted averages used correctly? Are sample size thresholds appropriate and documented? Is the carry-weighted league average the right approach vs team-weighted? Is the math defensible if challenged publicly?

**Team 30 — Historical / Cross-Season Context**
Does multi-season data (2020-2025) tell accurate stories? Is the COVID 2020 season flagged appropriately? Are rule changes between seasons accounted for? Do mid-season QB changes or player trades skew team-level metrics?

**Team 31 — Threshold & Filter Analyst**
Are minimum dropback/carry thresholds appropriate? Do they filter out noise without hiding meaningful data? Is "< 5 carries = low sample" the right cutoff? Should the min dropback slider range (50-500) change? Do filter combinations produce empty results too easily?

### Category 6: Code Quality (4 teams)

**Team 32 — TypeScript / Type Safety**
Are types correct and complete? Any `any` escape hatches or unsafe casts? Potential runtime type mismatches between server data and client expectations? Are `parseNumericFields` conversions comprehensive?

**Team 33 — Security**
XSS risk via D3 `.html()` or string interpolation? Exposed secrets in client bundles? Error message leakage to users? Input sanitization on URL params? CORS configuration appropriate? Server token handling correct?

**Team 34 — Error Handling / Resilience**
What happens when Supabase is down, API returns unexpected shapes, or data is malformed? Does the app crash or degrade gracefully? Are try/catch blocks in the right places? Do error boundaries catch component failures?

**Team 35 — Performance**
Bundle size impact of new code. Unnecessary re-renders in React components. Query efficiency (N+1 patterns, redundant fetches, missing pagination). Image optimization. Font loading strategy. D3 rendering on mobile.

### Category 7: Content & Copy (3 teams)

**Team 36 — Terminology Consistency**
Is naming consistent across the entire site? "EPA/carry" vs "EPA per carry", "Heatmap" vs "Heat map", gap label formatting, stat abbreviations. Does every instance of a term match every other instance?

**Team 37 — Glossary Completeness**
Are all metrics used on the site defined in the glossary? Are any definitions wrong, misleading, or out of date? Are new features adding metrics that need glossary entries? Do MetricTooltip definitions match glossary definitions?

**Team 38 — Data Source Attribution**
Is nflverse credited everywhere it should be? Are methodology differences from PFR/ESPN documented in footnotes? Is the data freshness source clear? Are disclaimers present where needed (gap data coverage, sack handling, etc.)?

### Category 8: Infrastructure (3 teams)

**Team 39 — Build Verification**
Does `tsc --noEmit` pass with zero errors? Does `next build` succeed with no errors? Any new warnings introduced? Are ESLint rules satisfied? Does the build output look reasonable (bundle sizes, page count)?

**Team 40 — Caching / ISR Strategy**
Is revalidation configured for all data pages? Does the webhook trigger cover new routes? Could users see stale data after a pipeline run? Are `revalidate` values appropriate (3600s)? Is on-demand revalidation working?

**Team 41 — URL State / Deep Linking**
Are filter states preserved in the URL via searchParams? Does the back button work correctly after navigation? Can a user share their current view as a link? Do URL params survive page refreshes? Does season selection persist across pages?

### Category 9: External Perception (3 teams)

**Team 42 — SEO / Metadata**
Dynamic page titles for all routes? OG tags with images? Sitemap entries for new pages? Canonical URLs? Meta descriptions? Does `generateMetadata` cover all server components? Is the robots.txt correct?

**Team 43 — Screenshot / Share Readiness**
Do charts look good when screenshotted for Twitter/X? Are watermarks ("yardsperpass.com") present on all visual elements? Is the SVG title bar providing context for out-of-context screenshots? Do OG images render correctly?

**Team 44 — Competitive Positioning**
How does this feature compare to what rbsdm.com, PFR, PFF, ESPN, or Next Gen Stats offer? Is it differentiated? Does it offer something users can't get for free elsewhere? Would it hold up in a comparison thread?

### Category 10: Regression & Testing (3 teams)

**Team 45 — Regression Check**
Does this change break any existing feature? Do all pages still render correctly? Do existing interactions (sort, filter, click, hover) still work? Are there any TypeScript errors or runtime console errors introduced?

**Team 46 — Cross-Page Consistency**
Are design patterns consistent across all pages? Do similar components behave the same way? Is the visual language (colors, spacing, typography, card styles) uniform? Does a new feature look like it belongs on the same site?

**Team 47 — Test Coverage**
Does this feature have unit or integration tests? Are the tests adequate for the complexity of the change? Do existing tests (pytest for data pipeline, any frontend tests) still pass? Is test coverage adequate for data transformations, aggregation functions, and edge cases?

---

## CEO Review Layer (3 reviewers)

The three CEO reviewers receive the compiled summary AND all 47 raw team reports. They provide an executive-level synthesis. They run in parallel after the team reports are compiled.

### CEO 1 — Product / Consumer CEO
**Persona:** Head of a consumer sports media company (like The Athletic or ESPN Digital).
**Lens:** "Would users come back? Is this easy to understand? Does this grow the audience?"
**Evaluates:** User experience, feature discoverability, engagement potential, casual fan accessibility, content shareability.
**Output:** Top 5 priorities from a product perspective, overall go/no-go recommendation, suggested user-facing improvements.

### CEO 2 — Analytics / Data CEO
**Persona:** Head of an analytics company (like PFF or TruMedia).
**Lens:** "Is the data bulletproof? Would an analyst trust this? Could this embarrass us if someone fact-checks it on Twitter?"
**Evaluates:** Data accuracy, statistical methodology, industry-standard definitions, cross-source validation, credibility signals.
**Output:** Top 5 priorities from an accuracy perspective, overall trust rating, any findings that would damage credibility if shipped.

### CEO 3 — Technical / Web CEO
**Persona:** Head of a web technology company (CTO-level technical depth).
**Lens:** "Is this production-ready? Is it fast, secure, and maintainable? Would I be comfortable with this in a production environment?"
**Evaluates:** Performance, security, error handling, build health, caching strategy, code quality, infrastructure reliability, scalability.
**Output:** Top 5 technical priorities, overall production-readiness rating, any showstoppers that need fixing before deploy.

### CEO Report Format

```
CEO: [Name / Persona]
Perspective: [One-line lens]
Overall Assessment: [1-2 sentence summary]
Go / No-Go: [Ship it | Ship with fixes | Do not ship]

### Top 5 Priorities
1. [Priority] — [Why it matters from this CEO's perspective]
2. ...

### Overrides / Escalations
- [Any findings the teams missed or under-weighted]

### Final Score: X/10
```

### Go / No-Go Aggregation

The user makes the final call after reading all three CEO assessments. However, the following guidelines apply:
- If **any CEO** says "Do not ship" → the default recommendation is **Do not ship** (user can override)
- If **two or more CEOs** say "Ship with fixes" → default is **Ship with fixes**
- Otherwise → **Ship it**

---

## Dispatch Context

Each team receives this context when dispatched:

```
You are reviewing a feature on the Yards Per Pass NFL analytics website.

**What changed:** [Summary of the feature / files modified]
**Files modified:** [List of changed files]
**Codebase location:** C:\Users\jonra\OneDrive\Desktop\claude sandbox\football website\yards-per-pass\

Your review perspective: [Team-specific prompt from above]

Focus your review on the changed files and any code/pages they interact with.
Do NOT audit the entire codebase unless the change has site-wide implications
(e.g., shared component changes, design system updates, data pipeline changes).

Consider a change relevant to your perspective if it directly modifies, or could
indirectly affect, functionality within your review scope. When in doubt, report
as relevant with a brief note on why.

If this change is not relevant to your perspective, report "Not relevant to this
change" and stop.

If relevant, provide:
- Rating: X/10 (see rubric: 9-10 excellent, 7-8 good, 5-6 acceptable, 3-4 significant problems, 1-2 broken)
- Findings categorized as:
  - CRITICAL: Data wrong, feature broken, security issue, user sees error. Must fix.
  - IMPORTANT: Works but misleading, confusing, incomplete. Should fix.
  - MINOR: Polish, style, optimization. Can ship without fixing.
- What specific changes would bring your rating to 10/10

Be specific. Cite files and line numbers. Do not make assumptions — read the code.
```

CEO reviewers receive:

```
You are a CEO-level reviewer for the Yards Per Pass NFL analytics website.

**Your persona:** [CEO-specific persona]
**Your lens:** [CEO-specific evaluation criteria]

Below is the compiled summary from 47 specialized review teams, followed by the
full individual team reports for reference.

[Compiled summary]

[All 47 raw team reports]

Provide: overall assessment, go/no-go recommendation (Ship it | Ship with fixes |
Do not ship), top 5 priorities, any overrides or findings the teams missed, and a
final score out of 10.
```

---

## Implementation Notes

- All 47 teams are dispatched as parallel agents (Agent tool with `run_in_background: true`)
- CEO reviewers are dispatched after all 47 teams complete and summary is compiled
- The summary compiler runs between team completion and CEO dispatch
- Total review takes ~3-5 minutes wall-clock time depending on feature size
- Token cost scales with feature complexity (more files = more reading per team)
- Teams that self-filter as "not relevant" consume minimal tokens
