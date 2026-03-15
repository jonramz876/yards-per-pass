# Product & Content Review Findings
**Date:** 2026-03-15
**Method:** Focused-lens
**Reviewers:** 15 experts across 3 specialized teams
- Team Alpha (Bugs & Correctness): 5 reviewers — Product Manager, NFL Content Strategist, Analytics UX Designer, Data Journalist, Copywriter
- Team Bravo (Gaps & Completeness): 5 reviewers — Sports Media Product Lead, SEO Specialist, Social Media Strategist, Competitive Analyst, Community Builder
- Team Charlie (User Experience & Edge Cases): 5 reviewers — First-Time User Advocate, Fantasy Football Player, NFL Twitter Power User, Casual Fan Persona, Analytics Newcomer Persona
**Status:** All 15 reviewers reached 100% consensus after cross-team debate

---

## Scope
This section evaluates the site as a product: content depth, user value, shareability, messaging clarity, and competitive positioning. Technical bugs and infrastructure are covered in other sections.

---

## Cross-Team Debate: Key Resolutions

### Resolution 1: Is "only 2 pages" CRITICAL or HIGH?
- **Team Bravo**: CRITICAL ("An analytics site with 2 pages won't retain anyone")
- **Team Alpha**: HIGH ("MVP is about proving the concept, not content completeness")
- **Resolution → HIGH**: The scatter plot and leaderboard are genuinely valuable tools. Two pages can launch — but the site needs a content roadmap to retain users beyond the first visit.

### Resolution 2: Is the "More Coming" card a problem?
- **Team Alpha**: HIGH ("Promises AI-powered stat search that's nowhere on the roadmap")
- **Team Charlie**: MEDIUM ("Users will forget, and it creates anticipation")
- **Resolution → HIGH**: Promising specific features (player comparisons, game explorer, win probability, AI search) that don't exist damages credibility. Vague "more features coming" is fine; specific promises without delivery dates are not.

---

## CRITICAL (0)

No critical product issues found. The MVP delivers real value with its 2 tools.

---

## HIGH (4) — Fix before or immediately after launch

### H1: Only 2 interactive content pages — no drill-down from scatter plot or leaderboard
- **Pages:** `/teams` (scatter plot), `/qb-leaderboard` (table)
- **Problem:** The entire site's interactive content is a scatter plot and a sortable table. There are no individual team pages (`/teams/KC`), no player pages (`/players/mahomes`), no game-level data, and no comparative views. Users can see a team's dot on the chart but can't click to learn more. The scatter plot tooltip shows 3 stats but the DB has 10+.
- **Impact:** Analytics fans will visit once, see the chart, check the leaderboard, and have nothing else to explore. No depth = no return visits. Competitor sites (rbsdm.com, statmuse.com) have dozens of drill-down pages.
- **Fix (MVP):** Add team detail pages showing all computed metrics (8 are already in the DB but invisible — see Frontend & Design H3). Even a simple stats card per team adds meaningful depth. Player pages can follow.
- **Found by:** Team Bravo

### H2: No methodology or "About" page — site shows advanced metrics without explanation
- **File:** Project-wide (no `/about` or `/methodology` route exists)
- **Problem:** The site's value proposition is "NFL Analytics, Simplified" but it provides no explanation of its methodology. Where does the data come from? How are EPA values computed? What's included in "dropbacks"? What's the difference between EPA/Play and EPA/DB? The MetricTooltip provides brief definitions, but there's no comprehensive methodology page for users who want to verify the numbers.
- **Impact:** Analytics-savvy users need to trust the numbers. Without a methodology page, they'll cross-reference with PFR/ESPN and find discrepancies (ANY/A is wrong per Data & Analytics C1) with no explanation. Casual users need an entry point to understand what they're looking at.
- **Fix:** Create `/about` page with: data source (nflverse), update frequency (weekly Wednesdays), definitions of all metrics, known limitations (regular season only, no strength-of-schedule adjustment), and what makes this site different.
- **Found by:** Team Alpha + Team Charlie

### H3: No Open Graph images — social shares show no preview
- **File:** `app/layout.tsx` lines 18-21
- **Problem:** The site has `openGraph: { type: "website", siteName: "Yards Per Pass" }` but no `og:image`. When someone shares a link on Twitter/X, Discord, or Slack, the preview card shows no image — just text. For a visual analytics site, this is a massive missed opportunity.
- **Impact:** NFL Twitter is the primary target audience. A shared link with no preview image gets dramatically fewer clicks than one with a compelling chart preview. This is the #1 growth lever the site is leaving on the table.
- **Fix:** Create a static OG image (1200x630px) showing a sample scatter plot or site branding. Add to metadata: `openGraph: { images: [{ url: '/og-image.png', width: 1200, height: 630 }] }`. Stretch goal: dynamic OG images per page using `next/og` (ImageResponse).
- **Found by:** Team Bravo

### H4: "More Coming" feature card promises specific features that don't exist
- **File:** `app/page.tsx` lines 45-48
- **Problem:** The card says: "Player comparisons, game explorer, win probability charts, and AI-powered stat search. Built on trusted nflverse data." These are 4 specific, named features that don't exist and aren't on the near-term roadmap. Users who return expecting "AI-powered stat search" will feel misled.
- **Impact:** Over-promising erodes trust. Better to set low expectations and over-deliver than the reverse.
- **Fix:** Change to a vague, forward-looking statement: "More features are on the way. We're building new tools to help you explore NFL data in new ways." Or replace the card entirely with a "Newsletter" signup to be notified when new features launch.
- **Found by:** Team Alpha (cross-ref: Frontend & Design L5)

---

## MEDIUM (8) — Address in next iteration

### M1: Season selector state doesn't persist across page navigation
- **File:** `components/ui/SeasonSelect.tsx`, Navbar links
- **Problem:** If a user selects "2023" on the teams page (URL becomes `/teams?season=2023`) and then clicks "QB Rankings" in the nav, they go to `/qb-leaderboard` (no season param) — resetting to the default season. The selected season is lost on every navigation.
- **Fix:** Include `?season=X` in nav links dynamically using the current search params, or store the selection in a cookie/context.
- **Found by:** Team Charlie

### M2: No comparison features
- **File:** Project-wide
- **Problem:** Can't compare two QBs side-by-side or overlay two teams on the scatter plot. Comparison is the #1 feature analytics fans want — "Is Mahomes having a better season than Allen?" needs a side-by-side view.
- **Fix:** Add a "Compare" mode to the leaderboard (select 2-4 QBs, show bar chart or radar chart comparison). This would be a major differentiator.
- **Found by:** Team Bravo

### M3: No shareable chart images
- **File:** `components/charts/TeamScatterPlot.tsx`
- **Problem:** No "Download as PNG" or "Share" button on the scatter plot. NFL Twitter users want to screenshot charts and share them. Currently they have to use browser screenshots (which cut off edges and include browser chrome).
- **Fix:** Add a "Save as image" button using `html2canvas` or SVG-to-PNG conversion. Include the watermark and site URL in the export.
- **Found by:** Team Bravo

### M4: First-time visitors get no introduction to EPA or CPOE
- **File:** `app/page.tsx` lines 12-13
- **Problem:** The hero says "EPA, CPOE, success rate, and more" — three acronyms with no expansion or explanation. A casual NFL fan from Twitter will not know what EPA stands for, let alone why it matters.
- **Fix:** Add a brief explainer section below the hero: "EPA (Expected Points Added) measures how much each play changes a team's chances of scoring. It's the gold standard of football analytics." One sentence per metric.
- **Found by:** Team Charlie

### M5: MetricTooltip definitions are expert-level only
- **File:** `components/ui/MetricTooltip.tsx` lines 10-33
- **Problem:** EPA/Play tooltip says "Expected Points Added per play across ALL plays (passing + rushing). The most complete measure of a QB's total value. Above 0 is good." This is accurate but assumes the reader understands expected points. No progressive disclosure (simple → detailed).
- **Fix:** Lead with a simple comparison: "EPA/Play measures overall QB impact. Think of it as 'points added per play.' Above 0 = above average." Then optionally expand to the technical definition.
- **Found by:** Team Charlie

### M6: Freshness badge is small and easy to miss
- **File:** `components/layout/DashboardShell.tsx` lines 36-39
- **Problem:** The "Through Week X" badge is a small blue pill on the right side of the header. On mobile it wraps below the title. A user during Week 12 might not realize they're looking at Week 5 data.
- **Fix:** Make the freshness badge more prominent if data is more than 1 week old. Add a yellow/orange warning state: "Data is from Week 5 — newer data may be available."
- **Found by:** Team Charlie

### M7: Footer only links to nflverse — no GitHub, contact, or social links
- **File:** `components/layout/Footer.tsx`
- **Problem:** The footer has a nflverse attribution link and copyright. No link to the project's GitHub repo (for credibility/transparency), no contact email, no Twitter handle, no feedback mechanism.
- **Fix:** Add GitHub link, Twitter/X handle, and a "Feedback" link (can be a GitHub Issues link).
- **Found by:** Team Bravo

### M8: No explainer or glossary content for SEO
- **File:** Project-wide
- **Problem:** "What is EPA in football" and "NFL CPOE explained" are high-volume search queries. The site has no content targeting these keywords. A glossary page or blog post explaining each metric would drive organic traffic from the exact audience this site targets.
- **Fix:** Create a `/glossary` page with definitions of all 13 metrics used on the site, cross-linked to the leaderboard and scatter plot.
- **Found by:** Team Bravo

---

## LOW (5) — Nice to have

| # | Finding | File/Location | Found by |
|---|---------|---------------|----------|
| L1 | No RSS feed or data update notification mechanism | Project-wide | Bravo |
| L2 | No breadcrumbs or navigation hierarchy on interior pages | `DashboardShell.tsx` | Charlie |
| L3 | Landing page hero mentions "success rate" which isn't prominently featured on either main page | `app/page.tsx` | Alpha |
| L4 | No guided onboarding or first-visit walkthrough for the scatter plot | `TeamScatterPlot.tsx` | Charlie |
| L5 | Site name "Yards Per Pass" emphasizes a single metric while the site is EPA-centric | Brand-level | Alpha |

---

## VERIFIED CORRECT (Product decisions all 15 reviewers endorsed)

### Value Proposition
- EPA scatter plot is genuinely differentiated — most competitors show raw stats, not EPA-based quadrant analysis
- "No paywalls. No clutter." positioning is accurate and compelling
- nflverse attribution in footer is appropriate and builds credibility with the analytics community
- Two-page MVP scope is appropriate for initial launch — depth can be added iteratively

### Content & Messaging
- Feature card descriptions (Team Tiers, QB Rankings) accurately describe what the pages offer
- MetricTooltip definitions are factually accurate for all 13 metrics
- Axis labels on scatter plot ("Offensive EPA/Play →" and "← Better Defense (Def EPA/Play)") are clear
- EPA color coding (green = positive, red = negative) matches universal conventions
- "Showing X of Y quarterbacks with ≥Z dropbacks" footer text is informative

### User Interface
- Season selector with freshness badge provides temporal context
- Adaptive min-dropback threshold is smart UX (scales with weeks played)
- Mobile-first approach (MobileTeamList fallback for chart) is correct
- Search filter on QB leaderboard enables quick lookup
- Watermark on chart establishes brand attribution

### Data Attribution
- nflverse is properly credited
- "open-source, peer-reviewed" accurately describes nflverse
- Copyright notice is present
