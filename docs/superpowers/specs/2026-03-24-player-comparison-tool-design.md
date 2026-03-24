# Player Comparison Tool — Mirror Radar Overlay

**Date:** 2026-03-24
**Priority:** #2 (most-requested feature from viz ideas review)
**Route:** `/compare`

---

## 1. Overview

Side-by-side (or overlaid) radar chart comparison of two NFL players. Users select two players of the same position, and the tool shows their 6-axis radar charts overlaid on the same hexagon with both colors visible. Stat chips below show exact values and rank differences.

## 2. User Flow

1. User navigates to `/compare` (via nav link or from a player profile "Compare" button)
2. Two player search inputs at the top (same Supabase search as SearchPalette)
3. Position auto-detected from first player selected; second search filters to same position
4. Radar polygons overlaid on one chart with team colors + legend
5. Below radar: side-by-side stat comparison table with better/worse highlighting
6. URL state: `?p1=josh-allen-buf&p2=lamar-jackson-bal&season=2025` for shareability

## 3. Component Architecture

### 3.1 New Files

| File | Purpose |
|------|---------|
| `app/compare/page.tsx` | Server component — fetches all season stats, renders ComparisonTool |
| `app/compare/loading.tsx` | Loading skeleton |
| `app/compare/error.tsx` | ErrorState wrapper |
| `components/compare/ComparisonTool.tsx` | Client component — player search, radar overlay, stat table |
| `components/compare/PlayerSearchInput.tsx` | Reusable typeahead search (Supabase query) |
| `components/compare/OverlayRadarChart.tsx` | Modified RadarChart that accepts 2 value arrays + 2 colors |

### 3.2 OverlayRadarChart

Extends the existing RadarChart pattern:
- Same hexagonal grid (outer/50th/25th rings, axis lines, labels)
- Two polygons instead of one, with different colors and alpha fills
- Player name labels in matching colors below the chart
- Same `axes` prop for QB/WR/TE/RB axis labels

```tsx
interface OverlayRadarChartProps {
  values1: number[];  // Percentiles for player 1
  values2: number[];  // Percentiles for player 2
  color1: string;     // Team color for player 1
  color2: string;     // Team color for player 2
  name1: string;      // Player 1 name (for legend)
  name2: string;      // Player 2 name (for legend)
  axes?: { label: string }[];
}
```

### 3.3 PlayerSearchInput

Typeahead search with debounced Supabase query against `player_slugs` table:
- Filters by position when `positionFilter` prop is set
- Shows player name, team, position in dropdown
- Returns slug + player_id + position on selection
- Reuses the Supabase client-side query pattern from SearchPalette

### 3.4 Stat Comparison Table

Below the radar, a two-column table:

| Stat | Player 1 | Player 2 |
|------|----------|----------|
| EPA/DB | **0.25** | 0.18 |
| CPOE | +3.2% | **+4.1%** |
| ... | ... | ... |

- Bold = better value for that stat
- Green subtle background on the better cell
- Shows both raw value and percentile rank
- Stats differ by position (QB: 6 radar axes + extra stats, WR: 6 axes + extras, etc.)

## 4. Data Flow

### 4.1 Server Component (page.tsx)

```typescript
// Fetch all season stats for the selected season
const [qbs, receivers, rbs] = await Promise.all([
  getQBStats(season),
  getReceiverStats(season),
  getRBSeasonStats(season),
]);
// Pass all to client component — percentile computation happens client-side
```

### 4.2 Client Component (ComparisonTool.tsx)

1. Two PlayerSearchInput components
2. On selection, look up full stats from the pre-fetched arrays
3. Compute percentiles against position-appropriate pool
4. Render OverlayRadarChart + stat comparison table
5. Update URL params for shareability

### 4.3 URL State

- `?p1=josh-allen-buf` — player 1 slug
- `?p2=lamar-jackson-bal` — player 2 slug
- `?season=2025` — season (inherited from nav)
- On page load with URL params, auto-populate both players

## 5. Position-Specific Axes

Reuse existing radar configurations:

**QB:** EPA/DB, CPOE, DB/Game, aDOT, INT Rate, Success%
**WR/TE:** Tgt/Game, EPA/Tgt, CROE, aDOT, YAC/Rec, YPRR
**RB:** EPA/Car, Volume, Success%, Explosive%, Stuff Avoid, YPC

Plus additional comparison stats below the radar (position-specific):
- **QB extra:** Passing Yards, TDs, INTs, ANY/A, Passer Rating, TD%, INT%, Total EPA
- **WR extra:** Targets, Receptions, Yards, TDs, Catch%, Target Share, AY%, YPRR
- **RB extra:** Carries, Yards, TDs, YPC, Total Touches, Stuff%, Explosive%

## 6. Entry Points

### 6.1 Nav Link
Add "Compare" to the navigation bar (between Rushing and Glossary/footer)

### 6.2 Player Profile Button
Add a "Compare" button on player profile pages that pre-fills player 1 and navigates to `/compare?p1={slug}`

### 6.3 Direct URL
Shareable URLs: `yardsperpass.com/compare?p1=josh-allen-buf&p2=lamar-jackson-bal`

## 7. Visual Design

- Clean white card with the overlay radar centered
- Player 1 color = their team color (left legend)
- Player 2 color = their team color (right legend)
- If same team: player 2 gets secondary color or a default contrast color
- Mobile: radar chart stacks above stat table, both full-width
- Max width: same as DashboardShell (max-w-7xl)

## 8. Edge Cases

| Case | Handling |
|------|----------|
| Same player selected twice | Show message: "Select two different players" |
| Different positions | Second search filters to P1's position. If user clears P1, second search opens to all positions |
| Player with insufficient data | Show radar with available axes, gray out missing ones |
| Same team colors | Player 2 gets team's secondary color |
| No players selected | Show empty state with instructions |

## 9. Integration

- Sitemap: add `/compare`
- Revalidation: add to ISR webhook paths
- OG image: dynamic opengraph-image for share cards
- Glossary: no new terms needed (all stats already defined)

## 10. Files Modified

| File | Changes |
|------|---------|
| `app/compare/page.tsx` | NEW: server component |
| `app/compare/loading.tsx` | NEW: loading skeleton |
| `app/compare/error.tsx` | NEW: error state |
| `components/compare/ComparisonTool.tsx` | NEW: main client component |
| `components/compare/PlayerSearchInput.tsx` | NEW: typeahead search |
| `components/compare/OverlayRadarChart.tsx` | NEW: dual-polygon radar |
| `components/layout/Navbar.tsx` | Add "Compare" link |
| `app/sitemap.ts` | Add `/compare` |
| `app/api/revalidate/route.ts` | Add `/compare` path |

## 11. Implementation Order

1. OverlayRadarChart component (extend existing RadarChart)
2. PlayerSearchInput component (adapt SearchPalette pattern)
3. ComparisonTool client component (wire up search + radar + stat table)
4. Server page + loading/error states
5. Nav link + sitemap + revalidation
6. Player profile "Compare" button
7. URL state for shareability

## 12. Non-Goals

- Multi-player comparison (3+) — future feature
- Cross-season comparison — future feature
- Statistical significance testing — not applicable
- Image export / share card generation — separate feature (#2 most-requested)
