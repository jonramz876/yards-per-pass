# QB Leaderboard UX Enhancements — Design Spec

**Date:** 2026-03-15
**Status:** Draft
**Scope:** Three features that transform the QB leaderboard from a data table into a shareable analytics product

---

## Overview

Three interrelated UX enhancements for the QB Leaderboard page:

1. **Conditional Formatting** — Percentile-based cell coloring (green → white → red)
2. **League Average Baseline Row** — Pinned "NFL AVG" row computed from filtered data
3. **QB Stat Card Modal** — Click-to-open modal with radar chart, stat chips, and vs-average bars

These features work together: conditional formatting makes browsing fast, the average row gives context, and the stat card gives depth. The stat card is designed for screenshots and social sharing.

**Approved mockup:** `qb-enhancements-mockup.html` (root of yards-per-pass)

**Implementation order:** Phase 2 Data Analytics (D-M1 through D-M11) **must land first**. This spec depends on Phase 2's `getVal()` helper, `formatVal(key, qb)` refactoring, virtual columns (TD:INT, Yds/G, TD/G), and nullable type changes. Both specs heavily modify `QBLeaderboard.tsx` — implementing Phase 2 first prevents merge conflicts.

**Cross-spec dependency:** TD:INT column definition comes from Phase 2 (D-M11). This spec adds conditional formatting and radar chart usage of that column.

---

## Feature 1: Conditional Formatting

### What It Does

Every numeric efficiency cell in the leaderboard table gets a background color based on its percentile rank within the currently visible (filtered) dataset. Patterns jump out instantly — "this QB is green everywhere except aDOT."

### Percentile Tiers

| Tier | Percentile | Background | Text Color | Font Weight |
|------|-----------|------------|------------|-------------|
| Top 10% | ≥ 90th | `rgba(34,197,94,0.25)` | `#15803d` | 600 |
| Top 25% | ≥ 75th | `rgba(34,197,94,0.12)` | `#16a34a` | normal |
| Middle | 25th–75th | transparent | `#4b5563` | normal |
| Bottom 25% | ≤ 25th | `rgba(239,68,68,0.12)` | `#dc2626` | normal |
| Bottom 10% | ≤ 10th | `rgba(239,68,68,0.25)` | `#dc2626` | 600 |

### Which Columns Get Formatting

**Advanced tab:** EPA/Play, EPA/DB, CPOE, Success%, ANY/A, TD:INT, aDOT, Rush EPA
**Standard tab:** Comp%, YPA, Rating, TD:INT

Columns excluded: Games (not a performance metric), raw counting stats (Cmp, Att, Yards, TD, INT, Sk, Sk Yds, Rush Att, Rush Yds, Rush TD, FL). These are volume stats where "more" isn't inherently better/worse in a rate context.

**Conditional formatting uses inline `style` attributes** computed by a helper function (not Tailwind classes or global CSS), since the rgba background values don't map to standard Tailwind utilities.

### Directionality

All formatted columns are "higher is better" EXCEPT: none currently. All metrics in the formatted set treat higher values as greener. If a metric where lower-is-better is added later (e.g., INT%), the tier assignment would flip.

### Computation

Percentiles are computed client-side from the `filteredData` array (after search filter and dropback minimum are applied). This means:

1. Changing the dropback slider recalculates all percentiles
2. Searching for a subset recalculates percentiles within that subset
3. No backend changes needed

```typescript
function getPercentile(values: number[], value: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  const rank = sorted.filter(v => v < value).length;
  return (rank / sorted.length) * 100;
}

function getPercentileClass(percentile: number): string {
  if (percentile >= 90) return 'pct-top10';
  if (percentile >= 75) return 'pct-top25';
  if (percentile <= 10) return 'pct-bot10';
  if (percentile <= 25) return 'pct-bot25';
  return 'pct-mid';
}
```

Percentile maps are precomputed once per render via `useMemo` keyed on `filteredData`. For each formatted column, extract all non-null values → sort → store. Then for each cell, binary-search or linear-scan to find rank.

### Null/NaN Handling

Cells with null or NaN values get no formatting (transparent background, gray text, em-dash display). They are excluded from the percentile calculation.

### Toggle

A small toggle or checkbox labeled "Heat map" in the table controls area (near the search/slider). Default: **ON**. Stored in component state only (not persisted).

---

## Feature 2: League Average Baseline Row

### What It Does

A pinned amber-colored "NFL AVG" row at the top of the table body, showing the mean of each stat across all QBs in the filtered dataset.

### Visual Design

- Background: `#fef3c7` (amber-50)
- Bottom border: `2px solid #f59e0b` (amber-400)
- Text color: `#92400e` (amber-800)
- Font weight: 600 for all values, 700 for the "NFL AVG" label
- Label is italic
- Rank column: empty
- Team column: em-dash

### Computation

Averages are computed from `filteredData` (same dataset as percentiles). For each column, take the mean of all non-null values.

```typescript
function computeAverages(data: QBSeasonStat[], columns: string[]): Record<string, number> {
  const avgs: Record<string, number> = {};
  for (const col of columns) {
    const values = data.map(qb => getVal(qb, col)).filter(v => !isNaN(v));
    avgs[col] = values.length ? values.reduce((a, b) => a + b, 0) / values.length : NaN;
  }
  return avgs;
}
```

This uses the same `getVal()` helper from the Phase 2 data analytics spec (for virtual columns like TD:INT, Yds/G, etc.).

### Which Columns Get Averaged

**All numeric stat columns** get an average value: GP, EPA/Play, EPA/DB, CPOE, Success%, ANY/A, TD:INT, aDOT, Rush EPA (Advanced tab); GP, Cmp, Att, Comp%, Yards, TD, INT, Sk, Sk Yds, YPA, Rating, Rush Att, Rush Yds, Rush TD (Standard tab); plus any Phase 2 virtual columns (Yds/G, TD/G, FL, Tot TD).

**Left blank:** Rank column (empty), Team column (em-dash).

### Formatting

Average values use the same `formatVal()` function as regular cells, so TD:INT shows as "X.X:1", percentages show with "%", etc.

### Interaction

- The average row is **not** clickable (does not open a stat card)
- The average row is **not** sortable (always pinned at top)
- The average row does **not** get conditional formatting colors (it IS the baseline)
- When the dropback slider changes, averages recalculate

### Toggle

Controlled by the same "Heat map" toggle as conditional formatting. Both features are conceptually about "contextualized data" and should appear/disappear together. Without the average row, the heat map colors lack an anchor.

---

## Feature 3: QB Stat Card Modal

### What It Does

Clicking any QB row opens a modal overlay with a detailed stat card. The card contains:
1. **Header** — Team color dot, player name, team + season
2. **Radar chart** — 6-axis percentile-normalized spider chart
3. **Stat chips** — 6 key stats with league rank (matching radar axes)
4. **Vs-average bars** — 4 bar comparisons showing performance relative to league mean

### Modal Behavior

- **Trigger:** Click on any QB row in the table (not the NFL AVG row)
- **Backdrop:** Semi-transparent dark overlay (`rgba(15,23,42,0.5)`) with `backdrop-filter: blur(4px)`
- **Animation:** Card slides in from bottom with fade
- **Close:** Click backdrop, press Escape, or click X button
- **Width:** Fixed 420px (optimized for screenshot sharing)
- **Scrolling:** If card exceeds viewport height, the card itself scrolls (not the backdrop)
- **Filter change:** Modal closes if `filteredData` changes (dropback slider or search while modal is open)
- **No QB cycling in v1** — arrow keys do not navigate between QBs in the modal
- **Implementation:** React portal to `document.body`, focus trap for accessibility

### Component Structure

New file: `components/qb/QBStatCard.tsx` — the modal + card content
New file: `components/qb/RadarChart.tsx` — D3-based radar/spider chart (SVG)

### Radar Chart (6 Axes)

**Axes (clockwise from top):**
1. EPA/Play
2. CPOE
3. aDOT
4. TD:INT
5. Rush EPA
6. Success%

**Normalization:** Each axis maps the QB's value to a percentile (0–100) within the current filtered dataset. The radar shape shows the percentile position, NOT the raw value. This makes axes comparable despite different units.

**Visual Design:**
- Outer hexagon: `#e2e8f0` (slate-200), 1px stroke
- 50th percentile hexagon: `#f59e0b` (amber-400), 1px stroke, dashed, subtle amber fill — represents league average
- Inner hexagon (25th): `#f1f5f9` (slate-100), 0.5px stroke
- Data polygon: team color at 12% opacity fill, team color 2px stroke
- Data points: team color filled circles, 3px radius
- Axis labels: 12px, `#475569` (slate-600), font-weight 600

**D3 Implementation:**
- SVG rendered in a React component using `useRef` + `useEffect`
- Hexagonal grid (not circular) — matches mockup aesthetic
- viewBox `0 0 300 260` for consistent sizing
- Responsive: SVG scales within container

**Null handling:** If a stat is null/NaN, that axis collapses to center (0th percentile). If 3+ axes are null, show a "Not enough data" message instead of the chart.

### Stat Chips (6 Stats)

Same 6 stats as radar axes: EPA/Play, CPOE, aDOT, TD:INT, Rush EPA, Success%

Each chip shows:
- **Label:** Stat abbreviation (10px, uppercase, gray)
- **Value:** Formatted stat value (16px, bold). Green if top-10 rank, neutral otherwise, red if bottom-10
- **Rank:** "Nth of 32" (10px, gray)

Rank is computed from the filtered dataset (position when sorted descending, except none currently need ascending).

Layout: 3-column CSS grid, 8px gap.

### Vs-Average Bars (4 Stats)

These show volume/traditional stats (complementing the radar's efficiency focus):
1. **Yds/G** — Passing yards per game
2. **TD/G** — Passing TDs per game
3. **Comp%** — Completion percentage
4. **YPA** — Yards per attempt

For dual-threat QBs (rush EPA/play > 0.00, i.e., above replacement-level rushing value), replace YPA with **Rush Y/G**.

Each bar shows:
- **Label:** 50px right-aligned (11px, gray)
- **Track:** Full-width bar with center line representing league average
- **Center line:** 2px gray vertical line at 50% with "avg: X" label above
- **Fill:** Green extends right from center if above average, red extends left if below
- **Values:** Absolute value (bold) + delta from average (green "+X" or red "-X")

Fill width is proportional: `width = min(abs(delta / avg) * 100, 45)%` — capped at 45% to prevent overflow.

### Data Flow

The stat card receives:
- `qb: QBSeasonStat` — the selected QB
- `allQBs: QBSeasonStat[]` — the filtered dataset (for percentile/rank/average calculations)
- `onClose: () => void`

Team colors use the existing `getTeamColor(id)` from `lib/data/teams.ts` (already has `primaryColor` for all 32 teams). No duplicate color map needed.

Team name for the card header uses `getTeam(qb.team_id)?.name` from `lib/data/teams.ts`.

### Screenshot Optimization

- Fixed 420px width ensures consistent card dimensions
- White background (no transparency effects on the card itself)
- "yardsperpass.com" watermark at bottom (11px, `#cbd5e1`)
- Clean borders, no complex shadows that break in screenshots

---

## Files to Create

| File | Purpose |
|------|---------|
| `components/qb/QBStatCard.tsx` | Modal wrapper + stat card content (header, chips, bars) |
| `components/qb/RadarChart.tsx` | D3-based 6-axis radar chart component |

## Files to Modify

| File | Changes |
|------|---------|
| `components/tables/QBLeaderboard.tsx` | Add percentile computation, conditional formatting classes, NFL AVG row, heat map toggle, row click → open stat card modal, pass data to QBStatCard |
| `app/qb-leaderboard/page.tsx` | No changes needed (data already flows through) |

## Dependencies

- **D3** (already installed) — for radar chart SVG generation
- **No new packages needed**

---

## Design Decisions

### Why client-side percentiles (not precomputed in DB)?

Percentiles must react to the dropback slider and search filter. Precomputing would require storing percentiles for every possible filter combination. Client-side computation on 32-40 QBs is trivial (~1ms).

### Why a fixed-width modal (not responsive)?

The stat card is designed for screenshots and sharing. A fixed 420px width ensures every screenshot looks identical regardless of screen size. On mobile viewports (<480px), the card scales down via `max-width: 95vw` with the same aspect ratio.

### Why hexagonal radar grid (not circular)?

Hexagonal grids have straight edges between vertices, making it easier to read where the data polygon falls relative to the grid. Circular grids create ambiguity at the midpoints between axes. The hexagonal shape also matches the established aesthetic in football analytics (Next Gen Stats, PFF).

### Why combine heat map + average row toggle?

They're conceptually linked — both provide "context relative to peers." The average row without heat map colors is useful but incomplete; heat map colors without the average row lack an anchor. A single toggle keeps the UI simple.

### Why 6 radar axes (not 4 or 8)?

Six axes capture the key QB dimensions without clutter:
- Passing efficiency (EPA/Play)
- Accuracy over expectation (CPOE)
- Arm talent / depth (aDOT)
- Ball security (TD:INT)
- Rushing value (Rush EPA)
- Down-to-down consistency (Success%)

Four axes would miss rushing or depth. Eight would add visual noise for marginal insight.

---

## Edge Cases

1. **QB with all null advanced stats** (e.g., very few dropbacks): Radar chart shows "Not enough data" message. Stat chips show "—". Bars still render for volume stats.

2. **Only 1 QB in filtered dataset**: Percentiles become meaningless (everyone is 100th). Heat map shows all green. Average row equals that QB's stats. This is acceptable — user filtered aggressively.

3. **TD:INT when INT = 0**: Display as "∞:1" or "X:0" format. Percentile rank: place at 100th (best possible).

4. **Negative Rush EPA for average row**: Display the negative value normally. Bar comparison handles negatives (both QB and average can be negative).

5. **Mobile viewport**: Modal uses `max-width: 95vw` and vertical scrolling. Radar chart scales proportionally within the narrower card.

---

## Verification Plan

1. **Visual regression:** Compare rendered table against mockup for 5 representative QBs (elite, average, poor, dual-threat, rookie)
2. **Percentile accuracy:** For Mahomes EPA/Play, manually compute percentile from dataset and verify heat map tier matches
3. **Average accuracy:** Sum and divide a column manually, compare to NFL AVG row value
4. **Radar shape:** Verify Mahomes shape (big, passing-heavy) vs Lamar shape (left-leaning, rush-heavy) matches mockup
5. **Responsiveness:** Test modal on 375px, 768px, and 1440px viewports
6. **Filter reactivity:** Change dropback slider, verify all three features (colors, averages, percentiles in stat card) update
