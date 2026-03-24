# Shareable Stat Card Image Generation

**Date:** 2026-03-24
**Priority:** #2 most-requested feature
**Approach:** Server-side PNG generation via Next.js `ImageResponse` API routes

---

## 1. Overview

Generate downloadable/shareable PNG stat cards for any player. Users click a "Share" button on player profiles to get a branded 1200×675px image card showing the player's key stats, radar chart visualization, archetype, and Yards Per Pass branding. Optimized for Twitter/X cards and Instagram stories.

## 2. Card Design

### 2.1 Layout (1200 × 675px)

```
┌─────────────────────────────────────────────────────┐
│ [team-color header bar]                              │
│                                                      │
│  PLAYER NAME          Position · Team Name           │
│  Archetype Icon Label  2025 Season                   │
│                                                      │
│  ┌──────────────┐  ┌──────────────────────────────┐  │
│  │              │  │  EPA/DB    0.25  (QB3)        │  │
│  │  RADAR CHART │  │  CPOE     +4.1% (QB5)        │  │
│  │  (hexagon)   │  │  ANY/A     7.2  (QB2)        │  │
│  │              │  │  Rating  105.3  (QB8)         │  │
│  │              │  │  Success%  52%  (QB4)         │  │
│  │              │  │  Pass Yds 4,200 (QB6)         │  │
│  └──────────────┘  └──────────────────────────────┘  │
│                                                      │
│  yardsperpass.com                         YPP logo   │
└─────────────────────────────────────────────────────┘
```

### 2.2 Visual Style

- Team primary color as header bar and accent
- White background, navy text
- Radar chart rendered as inline SVG paths (same hex geometry as RadarChart component)
- Stat values with position rank in parentheses
- Inter Bold font (already loaded for OG images)
- "yardsperpass.com" branding bottom-left
- Compact — optimized for readability at Twitter card size (600px wide preview)

## 3. Technical Approach

### 3.1 API Route

`/api/stat-card/[slug]/route.ts` — server-side route that:
1. Fetches player data (slug → player_id → season stats)
2. Fetches position pool for percentile computation
3. Computes radar percentiles + position ranks
4. Returns `ImageResponse` PNG (1200×675)

### 3.2 Why Server-Side (not html2canvas)

- No client-side dependency needed
- Works on any device (no canvas support issues)
- Cacheable by CDN (ISR-compatible)
- Same pattern as existing OG images
- Direct URL = instant sharing (paste URL in Twitter, image shows)

### 3.3 Radar Chart in ImageResponse

`ImageResponse` uses Satori (JSX → SVG → PNG). Satori supports basic SVG elements. The radar hexagon can be rendered using inline `<svg>` with `<polygon>` elements — same math as the React RadarChart component but expressed as static JSX.

## 4. User Flow

### 4.1 From Player Profile

1. User visits `/player/josh-allen-buf`
2. Clicks "Share Card" button (next to Compare button in PlayerHeader)
3. Opens a modal/overlay showing the card preview
4. Two buttons: "Download PNG" and "Copy Link"
5. Download triggers browser save; Copy link copies the API URL

### 4.2 Direct URL

`yardsperpass.com/api/stat-card/josh-allen-buf` returns the PNG directly.
Can be embedded in tweets, Discord, forums, etc.

### 4.3 From Comparison Tool

"Share Comparison" button on `/compare` generates a dual-player card:
`/api/stat-card/compare?p1=josh-allen-buf&p2=lamar-jackson-bal`

## 5. Position-Specific Stats

**QB Card:**
- Radar: EPA/DB, CPOE, DB/Game, aDOT, INT Rate, Success%
- Stats: EPA/DB, CPOE, ANY/A, Rating, Pass Yds, TD, INT, Success%

**WR/TE Card:**
- Radar: Tgt/Game, EPA/Tgt, CROE, aDOT, YAC/Rec, YPRR
- Stats: EPA/Tgt, CROE, YPRR, Yards, TD, Catch%, Tgt Share

**RB Card:**
- Radar: Car/Game, EPA/Car, Stuff Avoid, Explosive%, Tgt/Game, Success%
- Stats: EPA/Car, Yards, TD, YPC, Success%, Stuff%, Explosive%

## 6. Files

| File | Purpose |
|------|---------|
| `app/api/stat-card/[slug]/route.ts` | NEW: Single-player stat card PNG |
| `app/api/stat-card/compare/route.ts` | NEW: Comparison card PNG |
| `components/player/PlayerHeader.tsx` | Add "Share Card" button |
| `components/compare/ComparisonTool.tsx` | Add "Share Comparison" button |

## 7. Implementation Order

1. Single-player API route with radar SVG + stats
2. "Share Card" button + modal on player profiles
3. Comparison card API route
4. "Share Comparison" button on compare page

## 8. Non-Goals

- Custom card themes/colors (single design)
- Story-sized (9:16) variant — future
- Animated GIF cards — future
- Social media auto-posting — out of scope
