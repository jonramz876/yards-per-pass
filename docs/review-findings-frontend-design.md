# Frontend & Design Review Findings
**Date:** 2026-03-15
**Method:** Focused-lens (A/B test vs. identical-team method used for Data & Analytics)
**Reviewers:** 15 experts across 3 specialized teams
- Team Alpha (Bugs & Correctness): 5 reviewers — "What's broken, wrong, or will break?"
- Team Bravo (Gaps & Completeness): 5 reviewers — "What's missing, incomplete, or underutilized?"
- Team Charlie (User Experience & Edge Cases): 5 reviewers — "What will confuse, frustrate, or fail for real users?"
**Status:** All 15 reviewers reached 100% consensus after cross-team debate

---

## Cross-Team Debate: Key Resolutions

### Overlap 1: Touch interaction on scatter plot
- **Team Bravo** rated HIGH ("No touch interaction for tablet users")
- **Team Charlie** rated CRITICAL ("Zero interactivity on touch devices")
- **Resolution → CRITICAL**: iPad in landscape (1024px) exceeds the `md:` breakpoint (768px), so it renders the D3 scatter plot — NOT the MobileTeamList fallback. All interaction uses `mouseenter`/`mouseleave` (lines 193/217). No `touchstart`, no `touchend`. iPad landscape users see 32 team logos they literally cannot interact with. No tooltip, no hover, no fallback.

### Overlap 2: Team metrics not displayed
- **Team Bravo** rated CRITICAL ("8 team-level DB metrics fetched but hidden")
- **Already tracked** in Data & Analytics review as M10
- **Resolution → HIGH**: The scatter plot works correctly with its 2 core metrics. Having computed but unused data is a significant product gap, not a frontend crash. Upgraded from Data & Analytics M10 to HIGH here.

### Overlap 3: rush_epa_per_play missing from leaderboard
- **Team Bravo** found this (HIGH)
- **Already tracked** in Data & Analytics review as M4
- **Resolution → HIGH**: Cross-referenced. Column exists in schema, populated by ingest, absent from COLUMNS array.

### Overlap 4: getAvailableSeasons inefficiency
- **Team Bravo** found this (MEDIUM)
- **Already tracked** in Data & Analytics review as M7
- **Resolution**: Not re-listed here (already tracked).

---

## CRITICAL (1) — Must fix before launch

### C1: Scatter plot has zero interactivity on touch devices
- **File:** `components/charts/TeamScatterPlot.tsx` lines 192-221
- **Problem:** All D3 interaction uses `mouseenter`/`mouseleave` events. No `touchstart`/`touchend` handlers exist. iPad in landscape mode (1024px) exceeds the `md:` breakpoint (768px), so it renders the D3 scatter plot instead of the MobileTeamList fallback. Users on tablets see 32 team logos with no way to interact — no tooltips, no hover effects, nothing.
- **Impact:** iPad is the #1 tablet for sports content consumption. The flagship visualization is completely non-functional on touch devices at desktop-width breakpoints. Users will think the site is broken.
- **Fix:** Add `touchstart`/`touchend` event handlers alongside mouse events. On touch, show tooltip on tap, dismiss on tap-away. Alternatively, lower the scatter plot breakpoint to `lg:` (1024px) so iPads get the MobileTeamList. Best: do both.
- **Found by:** Team Bravo + Team Charlie (severity resolved in debate)

---

## HIGH (10) — Fix before or immediately after launch

### H1: `parseInt(season)` with no NaN guard shows broken UI
- **File:** `app/teams/page.tsx` line 36
- **Problem:** `const currentSeason = season ? parseInt(season) : (seasons[0] || 2025)`. If a user visits `?season=abc`, `parseInt("abc")` returns `NaN`. This NaN is passed to `getTeamStats(NaN)` and displayed as "No data available for the NaN season yet."
- **Impact:** URL manipulation (or a broken link) produces a visibly broken page. Looks unprofessional.
- **Fix:** Validate with `Number.isNaN()` after parsing and fall back to the default season.
- **Found by:** Team Alpha

### H2: SVG `clip-path: circle()` on `<image>` may not render on Safari
- **File:** `components/charts/TeamScatterPlot.tsx` line 175
- **Problem:** `.attr("clip-path", "circle(16px at 16px 16px)")` applied to SVG `<image>` elements. Safari has documented issues with CSS clip-path on SVG foreign content. Logos may render as unclipped squares on Safari/WebKit.
- **Impact:** Safari is ~20% of web traffic, higher on iOS. Team logos appearing as raw squares degrades the flagship chart.
- **Fix:** Use an SVG `<clipPath>` element with `<circle>` and reference via `clip-path="url(#circle-clip)"` — the SVG-native approach works across all browsers.
- **Found by:** Team Alpha

### H3: 8 team-level metrics fetched but never displayed
- **File:** `lib/data/queries.ts` lines 6-16, `app/teams/page.tsx`
- **Problem:** `TEAM_NUMERIC_FIELDS` includes `off_pass_epa`, `off_rush_epa`, `def_pass_epa`, `def_rush_epa`, `off_success_rate`, `def_success_rate`, `pass_rate`, and `plays`. All are fetched from Supabase, parsed by `parseNumericFields`, and passed to components — but never rendered anywhere. The scatter plot only uses `off_epa_play` and `def_epa_play`.
- **Impact:** Users can't see granular team metrics they'd expect from an analytics site. The data is RIGHT THERE but invisible.
- **Fix:** Surface in MobileTeamList expanded view or scatter plot tooltip. The tooltip (lines 199-210) currently shows Off EPA, Def EPA, and Record — add pass/rush EPA split, success rate, and pass rate.
- **Found by:** Team Bravo (cross-ref: Data & Analytics M10)

### H4: `rush_epa_per_play` missing from QBLeaderboard COLUMNS array
- **File:** `components/tables/QBLeaderboard.tsx` line 14-33
- **Problem:** Column exists in `qb_season_stats` schema, populated by the ingest pipeline, included in `QB_NUMERIC_FIELDS` for parsing — but absent from the `COLUMNS` array. Free value left on the floor.
- **Fix:** Add `{ key: "rush_epa_per_play", label: "Rush EPA", tooltip: "Rush EPA", group: "rushing", hideMobile: true }` to the COLUMNS array after `rush_tds`.
- **Found by:** Team Bravo (cross-ref: Data & Analytics M4)

### H5: Full D3 import adds ~260KB when only ~15-20KB needed
- **File:** `components/charts/TeamScatterPlot.tsx` line 5
- **Problem:** `import * as d3 from "d3"` pulls in the entire D3 library (~260KB minified). The component only uses: `d3.select`, `d3.scaleLinear`, `d3.axisBottom`, `d3.axisLeft`, `d3.format`. These come from 4 sub-packages totaling ~15-20KB.
- **Impact:** 240KB of unused JavaScript on the core data visualization page. Significant impact on mobile load times and Lighthouse scores.
- **Fix:** Replace with selective imports:
  ```ts
  import { select } from "d3-selection";
  import { scaleLinear } from "d3-scale";
  import { axisBottom, axisLeft } from "d3-axis";
  import { format } from "d3-format";
  ```
- **Found by:** Team Charlie

### H6: 32 unoptimized 500px PNGs loaded simultaneously for 32px display
- **File:** `components/charts/TeamScatterPlot.tsx` lines 171-174
- **Problem:** ESPN CDN logos are full-size PNGs (~500px wide) loaded via SVG `<image>` for 32px display. All 32 load at once with no lazy loading, no srcset, no size hints. Next.js `<Image>` optimization can't be used inside SVG.
- **Impact:** Unnecessary bandwidth (~1-2MB of logo images) on every teams page load.
- **Fix:** Create a pre-processing step that downloads and resizes logos to 64px (2x for retina), host in `/public/logos/`. Or use a CDN image transform parameter if ESPN supports it. At minimum, add `width` and `height` attributes for proper resource hints.
- **Found by:** Team Charlie

### H7: MetricTooltip tap targets are 16x16px (Apple HIG minimum: 44x44px)
- **File:** `components/ui/MetricTooltip.tsx` line 46
- **Problem:** `className="... w-4 h-4 ..."` makes the "i" info button 16x16 CSS pixels. Apple Human Interface Guidelines require minimum 44x44pt touch targets. These appear inside table header cells on mobile, making them nearly impossible to tap accurately.
- **Impact:** Mobile users cannot access metric definitions — a core educational feature of the site.
- **Fix:** Increase the visual button to at least 24x24px, and add invisible padding (e.g., `p-3` on the trigger) to reach 44x44px touch target.
- **Found by:** Team Charlie

### H8: "Defense Carries" and "Offense First" quadrants use identical yellow tint
- **File:** `components/charts/TeamScatterPlot.tsx` lines 16-17
- **Problem:** Both quadrants use `rgba(234,179,8,0.06)` — the exact same color. The four-quadrant visual system relies on color differentiation, but two of the four quadrants are visually indistinguishable.
- **Impact:** Users can't tell which "middle" quadrant a team is in by background color alone. The quadrant concept loses half its visual value.
- **Fix:** Use distinct colors: e.g., blue tint `rgba(59,130,246,0.06)` for "Defense Carries" and orange tint `rgba(249,115,22,0.06)` for "Offense First". Keep green for Contenders and red for Bottom Feeders.
- **Found by:** Team Charlie

### H9: Inverted Y-axis explanation is 9px in #94A3B8 — effectively invisible
- **File:** `components/charts/TeamScatterPlot.tsx` lines 135-137
- **Problem:** The note "Negative defensive EPA = better defense (axis inverted)" is rendered at `font-size: 9px` with `fill: #94A3B8` (light gray). This is the single most important explanatory element on the chart — the inverted Y-axis is counterintuitive and confuses first-time visitors.
- **Impact:** Users unfamiliar with EPA will misread the chart, thinking teams at the top have WORSE defense. The explanation exists but is invisible.
- **Fix:** Increase to at least 11px, use a darker fill like `#64748B`, and consider repositioning to be more prominent (e.g., near the Y-axis label rather than tucked in a corner).
- **Found by:** Team Charlie

### H10: D3 re-renders entire SVG on every resize event with no debounce
- **File:** `components/charts/TeamScatterPlot.tsx` lines 28-36, 39-234
- **Problem:** The `ResizeObserver` callback (line 31) calls `setDimensions()` on every resize frame. Each state update triggers the D3 effect (line 39) which does a full `svg.selectAll("*").remove()` + complete rebuild. During a window resize drag, this fires dozens of times per second.
- **Impact:** Jank, dropped frames, and unnecessary CPU/GPU work during resize. Worst on lower-powered devices.
- **Fix:** Add a debounce to the ResizeObserver callback:
  ```ts
  let timeout: NodeJS.Timeout;
  const observer = new ResizeObserver((entries) => {
    clearTimeout(timeout);
    timeout = setTimeout(() => {
      const { width } = entries[0].contentRect;
      setDimensions({ width: Math.max(400, width), height: 560 });
    }, 150);
  });
  ```
- **Found by:** Team Charlie

---

## MEDIUM (11) — Address in next iteration

### M1: MobileTeamList items overflow on narrow screens (<360px)
- **File:** `components/charts/MobileTeamList.tsx` lines 45-65
- **Problem:** Each row has 5 flex items (`gap-3` = 12px × 4 gaps = 48px, plus `px-3` = 24px padding). On a 320px screen, the Off/Def EPA values and record squeeze the team name to ~60px. Long names like "San Francisco 49ers" wrap awkwardly. No `truncate` or `overflow-hidden` class is applied.
- **Fix:** Add `truncate` to team name span, or abbreviate team names on small screens.
- **Found by:** Team Alpha

### M2: Supabase env var non-null assertions produce cryptic errors
- **File:** `lib/supabase/server.ts` lines 5-6
- **Problem:** `process.env.NEXT_PUBLIC_SUPABASE_URL!` and `...ANON_KEY!` use non-null assertions. If env vars are missing (fresh clone, Vercel misconfiguration), the error is "Invalid URL" with no indication which env var is missing.
- **Fix:** Add explicit checks: `if (!url) throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL env var")`.
- **Found by:** Team Alpha

### M3: Homepage feature cards are not clickable
- **File:** `app/page.tsx` lines 34-48
- **Problem:** The "Team Tiers" and "QB Rankings" feature cards are plain `<div>` elements. Users expect to click them to navigate to the corresponding pages. The CTA buttons above work, but the cards feel broken.
- **Fix:** Wrap each FeatureCard in a `<Link>` to its respective page (except "More Coming" which has no destination).
- **Found by:** Team Bravo

### M4: No custom 404 page
- **File:** Project-wide (no `app/not-found.tsx` exists)
- **Problem:** Visitors hitting invalid URLs get the default Next.js 404. No branding, no navigation back to the site.
- **Fix:** Create `app/not-found.tsx` with site branding and links to /teams and /qb-leaderboard.
- **Found by:** Team Bravo

### M5: No robots.txt or sitemap.xml for SEO
- **File:** Project-wide (neither file exists)
- **Problem:** Search engines have no sitemap to discover pages and no robots.txt for crawl directives. For a public-facing analytics site targeting NFL Twitter, SEO is important.
- **Fix:** Add `app/robots.ts` and `app/sitemap.ts` using Next.js metadata API.
- **Found by:** Team Bravo

### M6: No global error boundary
- **File:** `app/` directory (no `app/error.tsx`)
- **Problem:** Error boundaries exist for `/teams` and `/qb-leaderboard` but not at the root level. An error in the homepage or layout crashes to the Next.js default error page.
- **Fix:** Add `app/error.tsx` with site-branded error state.
- **Found by:** Team Bravo

### M7: No rank numbers in mobile team list
- **File:** `components/charts/MobileTeamList.tsx`
- **Problem:** Teams are sorted by composite EPA but no rank number is shown. Users can't quickly answer "where does my team rank?" without counting rows manually.
- **Fix:** Add a rank counter that resets per quadrant or runs globally.
- **Found by:** Team Bravo

### M8: No color legend for scatter plot quadrants
- **File:** `components/charts/TeamScatterPlot.tsx`
- **Problem:** Quadrant labels are rendered directly on the chart in 11px gray text, but there's no separate legend. Users who zoom or screenshot may lose the context of what each colored region means.
- **Fix:** Add a small 4-item color legend below or beside the chart.
- **Found by:** Team Bravo

### M9: No client-side D3 loading state
- **File:** `app/teams/page.tsx` lines 9-12
- **Problem:** The `dynamic()` import with `ssr: false` shows nothing while D3 loads. The page renders an empty `<div>` where the chart should be, then it pops in. No skeleton, no spinner.
- **Fix:** Add a `loading` component to the `dynamic()` call: `{ ssr: false, loading: () => <ChartSkeleton /> }`.
- **Found by:** Team Charlie

### M10: Tooltip clips at viewport edges
- **File:** `components/charts/TeamScatterPlot.tsx` lines 213-215
- **Problem:** Tooltip is positioned at `clientX + 12, clientY - 28` with no boundary checking. For teams in the top-right quadrant (e.g., Contenders near the edge), the tooltip extends beyond the viewport.
- **Fix:** Check tooltip dimensions against `window.innerWidth`/`innerHeight` and flip position when near edges.
- **Found by:** Team Charlie

### M11: Tailwind CSS uses caret range dependency (^4.2.1) — not pinned
- **File:** `package.json` lines 27, 34
- **Problem:** `"@tailwindcss/postcss": "^4.2.1"` and `"tailwindcss": "^4.2.1"` use caret ranges. Tailwind v4 is still early and breaking changes between minor versions could change styling without warning. All other dependencies are pinned to exact versions.
- **Fix:** Pin to exact versions: `"4.2.1"` (remove `^`).
- **Found by:** Team Alpha + Team Charlie

---

## LOW (10) — Nice to have

| # | Finding | File/Location | Found by |
|---|---------|---------------|----------|
| L1 | Sticky column visual seam — `bg-white` vs `group-hover:bg-gray-50/50` creates transparency gap on horizontal scroll | `QBLeaderboard.tsx` lines 179-180 | Alpha |
| L2 | WAS team_id maps to `espnLogo('wsh')` — works but inconsistent with other teams where ID = ESPN slug | `lib/data/teams.ts` | Alpha |
| L3 | Next 14 `searchParams` typing will need `Promise<>` unwrap for Next 15 migration | `app/teams/page.tsx` line 19 | Alpha |
| L4 | Range input slider has no custom track styling — looks different across browsers (Chrome vs Firefox vs Safari) | `QBLeaderboard.tsx` line 132-139 | Charlie |
| L5 | "More Coming" feature card promises unreleased features ("AI-powered stat search") — sets unmet expectations | `app/page.tsx` lines 45-48 | Charlie |
| L6 | EPA disclaimer text too subtle (small gray, easily missed by users unfamiliar with EPA caveats) | `app/teams/page.tsx` lines 63-65 | Charlie |
| L7 | `lib/supabase/client.ts` is dead code — browser singleton never imported by any file | `lib/supabase/client.ts` | Alpha |
| L8 | No analytics integration — no way to measure traffic, feature usage, or user behavior | Project-wide | Bravo |
| L9 | No export/share functionality for chart screenshots or table data (CSV, PNG) | Project-wide | Bravo |
| L10 | No season comparison view (e.g., compare 2024 vs 2023 side-by-side) | Project-wide | Bravo |

---

## VERIFIED CORRECT (What all 15 reviewers confirmed is right)

### D3 Integration
- D3 fully contained in single component (`TeamScatterPlot.tsx`) — no D3 leaking into other components
- `ssr: false` dynamic import correctly prevents server-side D3 execution
- React strict mode cleanup: `svg.selectAll("*").remove()` in both effect body and cleanup return
- ResizeObserver properly disconnected in useEffect cleanup

### Chart Design
- Y-axis inversion: `domain([positive, negative])` correctly maps negative def EPA to top (better defense = higher)
- Symmetric scales with 1.2x padding prevent data points from touching edges
- Quadrant assignment logic in MobileTeamList matches D3 chart axes exactly
- Color coding: green for positive EPA (good offense), red for negative; inverted for defense
- Safe DOM construction in tooltip — uses `createElement`/`textContent`, not `.html()` (no XSS)
- Watermark "yardsperpass.com" positioned correctly
- Pre-computed ordinal ranks for tooltip display

### Leaderboard
- NaN handling: em-dash `\u2014` display for null/NaN values
- Adaptive min-dropback threshold: `Math.max(50, Math.round(200 * (throughWeek / 18)))` — smart UX
- Sort with NaN safety: null/NaN values pushed to bottom regardless of sort direction
- Group-colored header backgrounds distinguish passing/rushing/efficiency columns
- `tabular-nums` class for proper numeric alignment

### Data Flow
- `parseNumericFields` correctly converts Supabase NUMERIC strings to JavaScript numbers
- ISR `revalidate = 3600` on data pages with manual revalidation via webhook
- Revalidation endpoint validates secret before triggering

### Mobile
- MobileTeamList composite EPA sort: `(off - def)` correctly ranks teams (accounts for inverted def EPA)
- Responsive breakpoint: `md:` hides/shows chart vs list appropriately for phones

---

## Method Comparison Note

This section used the **focused-lens method** (3 teams with distinct perspectives: Bugs, Gaps, UX) vs. the **identical-team method** used for Data & Analytics (3 teams all reviewing everything).

**Results:** 32 unique findings (1 CRITICAL, 10 HIGH, 11 MEDIUM, 10 LOW) with only 4 overlaps requiring cross-team debate. The focused lenses produced minimal redundancy while catching issues the other teams missed:
- Team Alpha (Bugs) uniquely found: Safari clip-path, parseInt NaN, env var assertions
- Team Bravo (Gaps) uniquely found: hidden team metrics, missing 404/robots/sitemap/error boundary
- Team Charlie (UX) uniquely found: D3 bundle size, image optimization, tap targets, invisible axis note, quadrant colors, resize debounce

The focused-lens method found **more unique issues with less overlap** than the identical-team method.
