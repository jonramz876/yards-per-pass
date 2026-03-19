# QB Leaderboard URL State — Design Spec

**Date:** 2026-03-18
**Status:** Draft
**Context:** 10-team review flagged no URL state sharing for QB leaderboard (UX 6.5/10, Competitive 5/10). Run-gaps page already does this well.

## Overview

Persist QB Leaderboard filter/sort state in URL searchParams so users can share filtered views. Example: `/qb-leaderboard?season=2025&tab=standard&sort=passing_yards&dir=desc&q=mahomes&min=100`.

## URL Parameters

| Param | Maps to useState | Type | Default (omitted from URL when at default) |
|-------|-----------------|------|---------------------------------------------|
| `season` | season (existing, server-side) | string | `"2025"` |
| `tab` | tab | `"advanced"` \| `"standard"` | `"advanced"` |
| `sort` | sortKey | string (column key) | `"epa_per_play"` |
| `dir` | sortDir | `"asc"` \| `"desc"` | `"desc"` |
| `q` | search | string | `""` (empty) |
| `min` | minDropbacks | number | dynamic: `Math.max(50, Math.round(200 * (throughWeek / 18)))` |

### Excluded from URL

- `showHeatmap` — visual preference, not a data filter. Not useful for sharing.
- `selectedQB` — modal state. Opening a modal from a URL would require loading the full data first, and the modal is for quick inspection not a destination.

## How It Works

### Reading (initialization)

`QBLeaderboard` is a client component (`"use client"`). It reads URL params directly via `useSearchParams()` — matching the pattern used by `RunGapDiagram.tsx` and `GapHeatmap.tsx`. No new props needed on the page component.

1. `QBLeaderboard` calls `useSearchParams()` to read `tab`, `sort`, `dir`, `q`, `min`
2. Initializes each `useState` from the URL value (if present and valid) or its default
3. `page.tsx` continues to read only `season` (needed for server-side data fetching)

### Writing (URL updates)

1. When any filter/sort state changes, update the URL using `router.push()` — matching the existing pattern used by `SeasonSelect`, `RunGapDiagram`, and `GapHeatmap`
2. **Exception:** The `q` (search) param uses `router.replace()` instead, since search input changes on every keystroke and `push` would flood the browser history stack
3. **Debounce:** The `q` param URL update is debounced by 300ms to avoid excessive URL updates during typing. The local `search` state updates immediately (for responsive UI), but the URL update is delayed
4. Build a `URLSearchParams` from current state, omitting any param that equals its default value
5. Always preserve `season` if it's in the current URL
6. Use `{ scroll: false }` to avoid scroll jumps

### Tab change behavior

When tab changes (advanced ↔ standard), the sort key resets to the tab's default (`epa_per_play` for advanced, `passing_yards` for standard). This existing behavior is preserved — the URL updates to reflect the new sort key.

## Files Changed

| File | Changes |
|------|---------|
| `components/tables/QBLeaderboard.tsx` | Add `useSearchParams()` + `useRouter()` reads; initialize useState from URL; add URL update helper; call it on state changes; debounce search URL update |

`app/qb-leaderboard/page.tsx` is NOT modified — it already reads `season` for server-side data fetching, and the new params are purely client-side presentation state.

## Edge Cases

- **Invalid sort key in URL** (e.g., `?sort=nonexistent`): Fall back to tab default (`epa_per_play` or `passing_yards`). Validate against the actual column keys.
- **Invalid tab in URL** (e.g., `?tab=foo`): Fall back to `"advanced"`
- **Invalid dir in URL**: Fall back to `"desc"`
- **Invalid min in URL** (e.g., `?min=abc`): Fall back to computed default
- **Season change via SeasonSelect**: Triggers a full page navigation (`router.push`), so `QBLeaderboard` remounts and `useState` initializers run fresh. If `min` is in the URL from the previous season, it will be used as-is — this is acceptable since the user explicitly set it. If `min` is NOT in the URL (was at default), the new season's default is computed.

## Out of Scope

- Heatmap toggle in URL
- Selected QB modal state in URL
- Browser back/forward beyond standard Next.js router behavior
