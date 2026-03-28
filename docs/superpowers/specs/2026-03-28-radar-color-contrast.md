# Spec: Radar Overlay Color Contrast Fix

## Problem
When comparing players from teams with similar primary colors (e.g. DAL #041E42 vs NE #002244, or CIN #FB4F14 vs DEN #FB4F14), the overlay radar chart polygons are nearly indistinguishable. Current fix only handles exact same-team matches.

## Solution
Add perceptual color distance check. When colors are too similar, substitute player 2's color with a guaranteed-contrasting alternative.

### Algorithm
1. Parse both hex colors to RGB
2. Compute perceptual distance using weighted Euclidean: `sqrt(2*dR^2 + 4*dG^2 + 3*dB^2)` (human eye is most sensitive to green)
3. If distance < threshold (150), replace color2 with a contrasting fallback

### Fallback Color Selection
Ordered palette of 6 high-contrast colors, pick the first one that has sufficient distance from color1:
- `#dc2626` (red)
- `#2563eb` (blue)
- `#16a34a` (green)
- `#d97706` (amber)
- `#9333ea` (purple)
- `#0891b2` (cyan)

### Files Changed
- `components/compare/ComparisonTool.tsx` — replace simple same-team check with `ensureContrast(color1, color2)` utility
- Could extract to `lib/utils/colors.ts` if needed elsewhere

### Edge Cases
- Both players null → no chart rendered (existing behavior)
- Same player selected for both slots → already blocked by UI
- Color1 happens to match a fallback → palette iteration handles this

## Scope
~30 lines of code. No pipeline, no DB, no new components.
