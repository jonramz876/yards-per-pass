# Spec: QB Rushing Dimension for Archetypes

## Problem
The QB radar chart has 6 passing-only axes. QBs like Hurts (105 rush att, 421 yds, 8 TD, +0.159 rush EPA) and Allen (112 att, 579 yds, 14 TD, +0.346 rush EPA) are classified purely on passing traits. Hurts gets "Sniper" (deep + safe) when he should be a dual-threat archetype.

## Solution
Add a 7th radar axis for rushing, and add rushing-aware archetypes.

### Radar Change: 6 → 7 axes

**Current 6 axes:**
EPA/DB, CPOE, DB/Game, aDOT, INT Rate, Success%

**New 7th axis: Rush EPA/Play**
- Key: `rush_epa_per_play`
- Already on QBSeasonStat (no pipeline changes)
- Percentile computed against PFR-qualified QB pool (same as other axes)

The radar becomes a heptagon (7-sided). RadarChart.tsx already supports arbitrary axis count via the `axes` prop.

### New Archetypes (2 added, 1 modified)

Insert these BEFORE existing archetypes in priority order:

1. **Dual Threat** (new) — `rush >= 80th AND eff >= 60th AND above60 >= 4`
   - Icon: ⚡ (already used by YAC Monster, use 🏃 instead)
   - "Elite rusher who also produces through the air. A true dual-threat weapon."
   - Catches: Allen, Hurts, Lamar, Jalen Dart

2. **Mobile Playmaker** (new) — `rush >= 65th AND eff >= 55th AND vol >= 55th`
   - Icon: 🌪️
   - "Extends plays and creates with his legs. Dangerous in and out of the pocket."
   - Catches: Mahomes, Herbert, Mayfield, Lawrence at their rushing peaks

3. **Scramble Artist** (new) — `rush >= 60th AND scramble_pct >= 70th`
   - Icon: 🏃
   - "Gets out of trouble consistently. Turns broken plays into gains."
   - Catches: Fields, Maye, high-scramble-rate QBs

**Modified: Sniper** — Add exclusion: `rush < 70th` (prevents dual-threat QBs from getting classified as Snipers when their passing profile happens to match).

### Files Changed

**No pipeline changes.** rush_epa_per_play already exists in qb_season_stats.

- `lib/stats/radar.ts` — Add 7th key + axis + label for QB radar
- `lib/stats/archetypes.ts` — Add 3 new archetypes + Sniper exclusion, update classifyQB to accept 7 percentiles
- `components/qb/RadarChart.tsx` — Verify it handles 7 axes (it should via dynamic `axes` prop)
- `components/player/PlayerOverviewQB.tsx` — Will inherit from radar.ts changes
- `components/compare/ComparisonTool.tsx` — Will inherit from radar.ts changes
- `app/card/[slug]/page.tsx` — Will inherit from radar.ts changes
- `app/glossary/page.tsx` — Add 3 new archetype definitions
- `tests/` — Update frontend archetype tests

### Hexagon → Heptagon Visual

RadarChart.tsx uses `Math.PI * 2 / axes.length` for angle calculation, so it auto-adapts. The visual goes from hexagon to heptagon. Labels need to be positioned for 7 points instead of 6.

### Scramble % as Radar Axis?
Considered adding scramble_pct as an 8th axis, but:
- 8 axes makes the radar too busy
- scramble_pct is partially captured by rush_epa (scramblers have positive rush EPA)
- Rush EPA/play is the cleaner single metric that captures the rushing dimension

Going with 7 axes (1 rushing) not 8.

## Scope
~100 lines changed across 3-4 files. No pipeline, no DB, no new components.
