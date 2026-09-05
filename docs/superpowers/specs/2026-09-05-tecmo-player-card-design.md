# Tecmo Player Card — Design Spec

**Date:** 2026-09-05
**Status:** Approved direction via visual mockup rounds (see `.superpowers/brainstorm/1367-1788622017/content/`, final: `final-card.html` + avatar option A). Pending Jon's spec review.

## Overview

A retro "Tecmo Super Bowl player data screen" card for every player, used both as the shareable stat card and as the top of the player profile page. Modeled on the TSB player screen (team header, portrait, stat columns, ability bars) with modern execution: white card, pixel font for headers/labels only, real team colors, smooth radar.

## Visual design (locked in mockups)

Layout, top to bottom (component: `TecmoPlayerCard`):

1. **Team band** — team primary color, pixel font: `BUFFALO BILLS` left, position right.
2. **Identity row** — headshot (56px, team-color border, rounded) · `17-J.ALLEN` + subline `2026 · 16 GAMES · GUNSLINGER` (season, games, archetype from `lib/stats/archetypes.ts`) · **OVR badge** (team-color chip, big number + "OVR").
3. **Basic stat grid** — 12 cells (6 × 2), label over value, position-specific (below).
4. **Ability rows** (no section header; thin divider above) — each row: **tier dot** (green ≥ 75th pctl / yellow 40–74 / red < 40) · pixel label · team-color bar (width = percentile) · `raw value / 96TH` right-aligned. Percentile rendered with ordinal suffix, red accent.
5. **Radar** — existing per-position radar (7-axis QB / 6-axis WR-TE / 6-axis RB) right of the ability rows, percentile-based, team-color fill.
6. **Footer** — `YARDSPERPASS.COM · DATA: NFLVERSE` (pixel font, small, gray).

Font: Press Start 2P (self-hosted via `next/font` — no runtime Google Fonts dependency), used ONLY for headers/labels/OVR; numbers and stat values use the site's normal font for legibility. Mobile: stat grid 6 → 3 columns, radar moves below ability rows, pixel font sizes bump up one step.

### Avatar

- Primary: real headshot from nflverse roster data (`headshot_url`), rendered in a team-color frame.
- Fallback (missing/broken URL): jersey SVG in team primary color, secondary-color trim, jersey number centered. `onError` client fallback + server-side fallback when URL is null.

### Basic stat grid per position

- **QB:** COMP, ATT, PCT, YDS, TD, INT, SACK, RTG, RU YDS, RU TD, FUM, FPTS
- **WR/TE:** TGT, REC, YDS, TD, YPR, YAC, TGT %, SNAP %, ROUTES, YPRR, FUM, FPTS (PPR)
- **RB:** CAR, YDS, YPC, TD, SUCC %, EXPL %, TGT, REC, RC YDS, RC TD, FUM, FPTS (PPR)

Missing values render `—` (existing `parseNumericFields` NaN convention).

### Ability bars per position

Same metrics as the existing radars (`lib/stats/radar.ts`), shown with raw value + percentile:

- **QB (7):** EPA/DROPBACK, CPOE, DROPBACKS/GM, ADOT, BALL SECURITY, SUCCESS RATE, RUSH EPA
- **WR/TE (6):** TGT/GAME, EPA/TARGET, CROE, AIR YDS/TGT, YAC/REC, YPRR
- **RB (6):** CAR/GAME, EPA/CARRY, STUFF AVOIDANCE, EXPLOSIVE %, TGT/GAME, SUCCESS RATE

Percentile pools: existing single-season, threshold-filtered pools (QB 100+ dropbacks, WR/TE position-matched 32+ targets, RB 106+ carries).

## OVR score

`OVR = round(mean(percentiles of the position's QUALITY metrics))`, clamped to 0–99 (a perfect 100 displays as 99, Tecmo-style). Style and raw-volume metrics are shown as bars but excluded from OVR:

| Pos | OVR inputs | Excluded (still shown as bars) |
|---|---|---|
| QB | EPA/dropback, CPOE, success rate, ball security, rush EPA | aDOT (style), dropbacks/game (volume) |
| WR/TE | EPA/target, CROE, YPRR, receiving success rate | targets/game (volume), air yds/tgt (style), YAC/rec (style) |
| RB | EPA/carry, success rate, stuff avoidance, explosive rate | carries/game, targets/game (volume) |

Notes:

- WR/TE OVR uses `receiving_success_rate` (already in `receiver_season_stats`) even though it is not a radar axis.
- TE percentiles come from the TE-only pool (existing behavior), so TE OVR is relative to TEs.
- RB OVR is rushing-quality only in v1; receiving value appears in stats/bars but not OVR (no per-target RB EPA ingested yet). Documented limitation; candidate v2 ingest addition.
- **Below-threshold players show `—` instead of an OVR** (same thresholds as the pools). The existing below-threshold warning banner stays on the player page.
- Glossary gets an "OVR" entry documenting the formula and exactly which metrics feed it per position.

## Where the card appears

1. **`/card/[slug]`** — the card full-size, replacing `StatCardView`. Gains `?season=` support (defaults to latest, same resolution as other pages). Copy Link button stays; **Download Image now points at the card's OG image route** (fixing today's 404 — the current button targets `/api/stat-card/[slug]`, which doesn't exist).
2. **`/player/[slug]` Overview tab** — card replaces the current radar + archetype + chips + "vs league average" section at the top. Preserved below the card: "Throws To" / "Catches From", team hub link, threshold warning banner, Game Log tab, QB Passing Map tab. (The vs-league-average bars are retired; their headline stats live in the stat grid.)
3. **`app/card/[slug]/opengraph-image.tsx`** — rebuilt in the card design (simplified: band, name, OVR, stat grid subset, radar, footer) so social embeds match. This also removes the current 7-axes/6-labels radar bug and the hardcoded-season query (already fixed in the season-readiness pass, but the rebuild must not regress it).

## Data changes

`player_slugs` table (created/updated by `scripts/ingest.py` `generate_player_slugs`/`upsert_player_slugs`) gains two nullable columns, populated from the roster parquet each ingest:

- `headshot_url TEXT` — nflverse `headshot_url` for the player's most recent week
- `jersey_number INTEGER` — nflverse `jersey_number`, most recent week (players change numbers; latest wins)

Frontend `getPlayerBySlug`/`getAllPlayerSlugs` expose the new fields. No new data sources; both columns exist in the roster file the ingest already downloads.

## Component architecture

- `components/player/TecmoPlayerCard.tsx` — the card. Pure presentational; takes a `TecmoCardData` prop (identity, stat cells, ability rows with raw/pctl/tier, radar values, OVR). No data fetching.
- `lib/stats/tecmo-card.ts` — builders: `buildQBCardData`, `buildWRCardData`, `buildRBCardData` (stats + pools in, `TecmoCardData` out; OVR + tier logic lives here, unit-testable).
- `components/player/JerseyAvatar.tsx` — headshot-with-jersey-fallback.
- Page integration replaces sections in `app/card/[slug]/page.tsx` and the three `PlayerOverview*.tsx` components; OG image is a parallel inline-styled render (ImageResponse cannot use Tailwind).
- Old `StatCardView` is deleted once `/card` uses the new component (its OG twin is rebuilt in the same change).

## Edge cases (chaos checklist)

- Player with no headshot / broken URL → jersey fallback; no jersey number → jersey SVG with no number. Never a broken image.
- Below-threshold or zero-stat player: OVR `—`, bars render at 0 with gray dots, no NaN text anywhere.
- Week 1–3 thin pools (site now ingests single-game data): percentiles legal but volatile; thresholds mask most of it.
- Long names (`AMON-RA ST.BROWN`), long team names (`SAN FRANCISCO 49ERS`) in pixel font at mobile widths.
- Light team colors (CIN orange band): dark text on light bands via existing contrast helpers.
- FB position → RB variant (existing normalization).
- 2020–2025 historical seasons via `?season=` (headshot is current-day; acceptable).

## Out of scope (v1)

Hover mini-cards on leaderboards, card gallery, similar-players, RB receiving EPA ingest, card image download as client-side PNG capture, multi-season career view.

## Verification

- Unit tests for OVR builders (per-position inputs, threshold `—`, empty pools).
- Existing vitest suite + `tsc --noEmit` + `next build`; pytest for the ingest column additions.
- Chaos agent pass over the checklist above, then `/review-feature` per project convention.
- Visual check on desktop + phone before deploy.
