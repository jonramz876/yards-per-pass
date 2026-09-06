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

**Desktop scale-up (amendment 2026-09-06, Jon: card too small on desktop).** At the `lg:` breakpoint the card grows: container `max-w-2xl → lg:max-w-4xl` (~896px); pixel-font sizes step up roughly +2px per element (band, name, sublines, stat-cell labels/values, ability labels and raw/percentile text, OVR number, footer); ability bars and tier dots slightly thicker; radar wrapper ~240px → ~300px; headshot/jersey avatar 56 → 64px at ALL breakpoints (the size prop is inline width/height, so it can't be breakpoint-scoped; 64px verified fine on mobile — reviewer-checked). The tiny "OVR" caption scales with the sublines. The three player-page overview wrappers (`max-w-2xl mx-auto`) gain the same `lg:max-w-4xl` so "Throws To"/"Catches From"/hub-link boxes stay width-aligned with the card. Mobile and `sm:` sizes unchanged. `/card/[slug]` inherits the wider desktop card automatically (intended). Share/OG images unaffected (separate renderer).

### Avatar

- Primary: real headshot from nflverse roster data (`headshot_url`), rendered in a team-color frame.
- Fallback (missing/broken URL): jersey SVG in team primary color, secondary-color trim, jersey number centered. `onError` client fallback + server-side fallback when URL is null.

### Basic stat grid per position

- **QB:** COMP, ATT, PCT, YDS, TD, INT, SACK, RTG, RU YDS, RU TD, FUM, FPTS
- **WR/TE:** TGT, REC, YDS, TD, YPR, YAC, TGT %, SNAP %, ROUTES, YPRR, FUM, FPTS (PPR)
- **RB:** CAR, YDS, YPC, TD, SUCC %, EXPL %, TGT, REC, RC YDS, RC TD, FUM, FPTS (PPR)

Missing values render `—` (existing `parseNumericFields` NaN convention).

FPTS uses the existing `lib/stats/fantasy.ts` helpers (QB fixed 4-pt pass TD, WR/TE/RB PPR) — same convention as the current card page and leaderboards. No ingest work needed.

### Ability bars per position

Same metrics as the existing radars (`lib/stats/radar.ts`), shown with raw value + percentile:

- **QB (7):** EPA/DROPBACK, CPOE, DROPBACKS/GM, ADOT, BALL SECURITY, SUCCESS RATE, RUSH EPA
- **WR/TE (6):** TGT/GAME, EPA/TARGET, CROE, AIR YDS/TGT, YAC/REC, YPRR
- **RB (6):** CAR/GAME, EPA/CARRY, STUFF AVOIDANCE, EXPLOSIVE %, TGT/GAME, SUCCESS RATE

### Eligibility rule (pools, OVR, and banner — unified)

Today the QB pool differs by page (238+ attempts on the player page, 100+ dropbacks on `/card`), and all season-total thresholds are unreachable in September, leaving pools empty in weeks 1–3. The card unifies on **per-game thresholds**, used consistently for (a) percentile pool membership, (b) OVR eligibility, and (c) the below-threshold banner text:

- QB: **14+ attempts per game** (PFR's rate-stat minimum — ≈238 att over 17 games)
- WR/TE: **2+ targets per game** (≈32 over 16)
- RB: **6+ carries per game** (≈106 over 17)

Pools are position-matched as today (TE vs TE). Players below the rule show OVR `—` and the warning banner; their bars still render against the qualified pool. This slightly changes the player page's current percentile basis (238-att pool → per-game pool) — intended, and it makes week-1 cards work. Early-season percentiles are volatile by nature; the banner plus OVR dash for non-qualifiers is the mitigation.

## OVR score

**Amended 2026-09-06 (v3, Jon-approved): Madden display scale (all positions) + QB "Ability" formula + ingest kneel fix.** Validated by a six-season study (2020–2025, 54-check ground-truth suite: winner 0 misses vs 9 for v2; artifacts `qb_ovr_study_*` in session scratchpad).

**1. Madden display scale — ALL positions.** The position's 50-centered blend (below) maps to display via `display = min(99, round(77 + (blend − 50) × 0.45))`. Average qualified starter ≈ 77, best ≈ 95–99 (Jon: "like Madden ratings"). Ineligible/null handling unchanged (`—`). The round happens ONLY at this final step; blends stay unrounded internally.

**2. QB blend (v3 "Ability") — replaces the v2 QB combining formula:**
- `quality` = WEIGHTED mean of percentiles: `epa_per_db` (w=1), `any_a` (w=1), `cpoe` (w=1), `success_rate` (w=1), `rush_epa_reg` (w = `min((rush_attempts/games)/3, 1)` — rushing efficiency counts in proportion to rush volume, full at 3+ att/g; raw value = the existing radar getter `getQBRadarVal(me,"rush_epa")`). ANY/A replaces `inv_int_pct` as an OVR input (it bundles INT/sack/TD); the ability BARS and radar are unchanged — this affects OVR inputs only.
- `production` = mean of PER-GAME percentiles vs the qualified pool: `epa_pg = epa_per_play × (dropbacks + rush_attempts − scrambles) / games` where `scrambles = (scramble_pct/100) × dropbacks` (verify scramble_pct's stored scale against ingest; the study confirmed /100); `yds_pg = (passing_yards + rush_yards)/games`; `tds_pg = (touchdowns + rush_tds)/games`.
- `blend = 50 + (0.5×quality + 0.5×production − 50) × min(attempts/CAP, 1)^0.5` (square-root regression — gentler than v2's linear; CAP = existing 70th-pctl pool attempts via quantileLinear). Symmetric half-degradation rules carry over from v2 verbatim.

**3. WR/TE/RB blends: unchanged v2 math**, then the Madden display map. (Their `0.5×quality_reg + 0.5×production` result IS the blend fed to the map.)

**4. Ingest kneel fix.** BOTH `aggregate_qb_stats` AND `aggregate_qb_weekly_stats` drop `play_type == 'qb_kneel'` rows (on a LOCAL filtered copy — never mutate the shared `plays` frame, which feeds RB/team aggregators that must keep kneels): victory-formation kneels (−1 EPA each, ~420/season league-wide) currently pollute QB rush EPA and epa_per_play, costing winning QBs 10–25 EPA/season (Lamar 2023 real rush EPA ≈ +37, stored +10). Extending to weekly keeps the Game Log's rush yards/FPTS summing to the season card above it. Also fix the factually wrong comment at ingest.py:424 ("filter_plays() already excludes kneeldowns" — it doesn't). Consequence, accepted by design: QB `rush_attempts`/`rush_yards` become kneel-free and diverge slightly from PFR (which counts kneels). Python tests required for both aggregators. After merge: backfill seasons 2020–2025 via the workflow so historical cards update.

**4b. Degradation clarification (v3 quality is a weighted mean):** a missing quality metric drops both its value and its WEIGHT (renormalize over the remaining weights); production and half-level degradation follow the v2 rules verbatim.

**4c. Stale v2 artifacts the implementation must update:** `lib/stats/tecmo-card.ts` header comment (REG50 formula description) + `ovrFrom` docstring (restates the old round placement) + `QB_OVR_KEYS` list/comment (v3 drops `inv_int_pct` for `any_a` — OVR-only; bars/radar unaffected); `lib/og/tecmo-card-image.tsx` `visibleRows` rationale comment (ANY/A is now an OVR input with no bar — weaken the "visible rows explain the score" claim rather than change row selection); `scripts/ingest.py:424` stale comment (covered in item 4); `app/glossary/page.tsx` (item 6); and `__tests__/stats/tecmo-card.test.ts` — near-total churn of numeric OVR expectations (Madden map shifts every position; QB cases additionally shift from new inputs + sqrt regression); invariant tests survive with recomputed values, and new v3-specific tests are required (weighted-quality renormalization, rush-weight scaling, per-game production, sqrt regression, the Madden map itself incl. blend 50 → 77 and cap at 99).

**5. Validation (implementer MUST reproduce before pushing)** — against the study's scored frames (scratchpad `qb_ovr_study_final_2025.parquet`, winner column `ovr_W_soft3` = raw blend, pre-kneel-fix data): after the Madden map, 2025 displays = Maye 97, Allen 94, Mahomes 92, Stafford 92, Purdy 91, Burrow 86, Lamar 85, McCarthy 71, Ward 67; RB Henry 91, Corum 90 (from the RB study frame under v2+map). Post-kneel-fix data may shift QBs ≤2 points — the reproduction check runs on pre-fix data.

**6. Glossary `#ovr`** — rewritten: Madden-style scale (avg starter ≈ high 70s, best ≈ 99), QB measures how well he played when he played (per-play quality incl. rushing for QBs who run + per-game production incl. rushing, short seasons pulled toward average), other positions as before, thresholds unchanged.

## OVR score (v2 — superseded by v3 above for the combining/display math; input tables below still current for WR/TE/RB and for the QB bars)

**Amended 2026-09-05 (v2, "REG50") after user feedback + empirical study on full 2025 data** (all-pro workhorses scored poorly under quality-only; pure total-EPA addition fails at RB because league rushing EPA is net-negative — study artifacts in session scratchpad):

`OVR = min(99, round(0.5 × quality_reg + 0.5 × production))`, where:

- `quality_reg = 50 + (mean(quality-metric percentiles) − 50) × min(volume / CAP, 1)` — the position's quality percentiles (input lists in the table below, unchanged from v1), regressed toward 50 at low volume. `volume` = the player's attempts (QB) / targets (WR/TE) / carries (RB). `CAP` = the 70th-percentile volume of the QUALIFIED pool, computed by **linear interpolation between closest ranks** (numpy `percentile` default: sort ascending, value at fractional index `0.7 × (n − 1)`). The existing `eligible && pool.length > 0` gate is retained, so CAP is never computed on an empty pool.
- `production = mean(available production percentiles)`, where the two production inputs are the percentile of season total EPA and the percentile of season total yards, both computed **against the same QUALIFIED pool as the quality percentiles** (strictly-less rank / n × 100, the existing `computePercentile`). QB: `total_epa` + `passing_yards`; WR/TE: `total_receiving_epa` + `receiving_yards`; RB: `total_rushing_epa` + `rushing_yards`.
- Degradation (symmetric): missing components are excluded, never counted as 0. Production entirely missing → OVR = `quality_reg` alone. Quality entirely missing but production present → OVR = `production` alone. Both entirely missing, or ineligible (per-game rule), or empty pool → OVR = null, rendered `—`.

Validated on full 2025 data (qualified pools, conventions above): Henry 68→81 (production pct 92.6), 145-carry backup Corum 93→79, 13-target small-sample WRs deflate from the 90s to ~50, medians 46–48, 85+ rare (2–8 per position).

Known DB-field limitation: QB `total_epa` excludes rushing EPA (undercounts running QBs' production slightly) — candidate ingest refinement, not in this change.

**v2 supersedes these already-shipped v1 artifacts — the implementation MUST update all of them:**
- `lib/stats/tecmo-card.ts`: `ovrFrom` and the per-builder OVR computation; the header comment (lines ~4-6 "OVR grades quality, not usage" — now false), the comments at the OVR key lists, and the `ovrFrom` docstring.
- `app/glossary/page.tsx` `#ovr` entry: the "volume metrics … do not affect OVR" sentence is replaced by: "OVR blends how good a player was per play (percentiles, regressed toward average at low volume) 50/50 with how much total value he produced (season EPA + yards)." Style metrics (aDOT, YAC/rec) remain excluded — keep that clause.
- `__tests__/stats/tecmo-card.test.ts`: the v1 "volume must not change OVR" invariant tests are superseded (volume now legitimately affects OVR via regression + production); the aDOT/style-exclusion invariants REMAIN. New tests required: regression factor at low volume, production blend, each degradation rule above, CAP interpolation.
- `__tests__/components/TecmoPlayerCard.test.tsx`: unaffected (renders precomputed data), verify only.

Original v1 formula (superseded): `OVR = round(mean(percentiles of the position's QUALITY metrics))`. The quality input lists and notes below remain CURRENT for v2 — only the combining formula changed. Note: "RB OVR is rushing-only" remains true in v2 (production uses rushing EPA/yards, no receiving). Style and raw-volume metrics are shown as bars but excluded from OVR:

| Pos | OVR inputs | Excluded (still shown as bars) |
|---|---|---|
| QB | EPA/dropback, CPOE, success rate, ball security, rush EPA | aDOT (style), dropbacks/game (volume) |
| WR/TE | EPA/target, CROE, YPRR, receiving success rate | targets/game (volume), air yds/tgt (style), YAC/rec (style) |
| RB | EPA/carry, success rate, stuff avoidance, explosive rate | carries/game, targets/game (volume) |

Notes:

- WR/TE OVR uses `receiving_success_rate` (already in `receiver_season_stats`) even though it is not a radar axis.
- TE percentiles come from the TE-only pool (existing behavior), so TE OVR is relative to TEs.
- RB OVR is rushing-quality only in v1; receiving value appears in stats/bars but not OVR (no per-target RB EPA ingested yet). Documented limitation; candidate v2 ingest addition.
- **Below-threshold players show `—` instead of an OVR** (per-game eligibility rule above). The below-threshold warning banner stays on the player page, reworded to the per-game rule so it never contradicts a shown OVR.
- Glossary gets an "OVR" entry documenting the formula and exactly which metrics feed it per position.

## Where the card appears

1. **`/card/[slug]`** — the card full-size, replacing `StatCardView`. Gains `?season=` support (defaults to latest, same resolution as other pages). Copy Link button stays; **Download Image is served by a new route handler `/api/stat-card/[slug]?season=`** that renders the card via `ImageResponse` (fixing today's 404 and honoring the season picker — the file-convention OG image cannot see `?season`, so it stays latest-season for social embeds while downloads respect the picked season). Both renders share one card-drawing function.
2. **`/player/[slug]` Overview tab** — card replaces the current radar + archetype + chips + "vs league average" section at the top. Preserved below the card: "Throws To" / "Catches From", team hub link, threshold warning banner, Game Log tab, QB Passing Map tab. (The vs-league-average bars are retired; their headline stats live in the stat grid.)
3a. **`app/player/[slug]/opengraph-image.tsx` (amendment 2026-09-06, Jon-approved "#1")** — the player page's share image becomes the Tecmo card, identical in behavior to the card page's OG: same shared renderer (`tecmoCardImage` + `getCardDataForPlayer` + `loadHeadshotDataUri` + `pixelFontOptions`), latest season (file convention gets no searchParams), never throws. Divergence from the card OG's fallback: when the player exists but has no card (kicker/punter, or no stats row that season), render a NAME PLATE — team-color background, player name, position · team, site footer — using the bundled pixel font via `pixelFontOptions` (never the old runtime gstatic fetch, which this rebuild deletes). Unknown slug → the shared `brandedFallbackImage`. A thrown query error while assembling card data for a REAL player → the name plate (the player row is already in hand; a branded fallback would waste it). Adopt the card OG's `Promise`-typed awaited params. The player page's tabs (Overview / Game Log / Passing Map) and all page content are UNTOUCHED — this changes only the OG image route.

3. **`app/card/[slug]/opengraph-image.tsx`** — rebuilt in the card design (simplified: band, name, OVR, stat grid subset, radar, footer) so social embeds match. This also removes the current 7-axes/6-labels radar bug and the hardcoded-season query (already fixed in the season-readiness pass, but the rebuild must not regress it).

## Data changes

`player_slugs` table (created/updated by `scripts/ingest.py` `generate_player_slugs`/`upsert_player_slugs`) gains two nullable columns, populated from the roster parquet each ingest:

- `headshot_url TEXT` — nflverse `headshot_url` for the player's most recent week
- `jersey_number INTEGER` — nflverse `jersey_number`, most recent week (players change numbers; latest wins)

Migration mechanics (all required — reviewer-verified traps):

- `ensure_player_slugs_table` is `CREATE TABLE IF NOT EXISTS` only; add the `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` pattern already used for other tables so existing deployments gain the columns.
- `upsert_player_slugs` must include both fields in the insert columns **and** the `ON CONFLICT ... update_set` — existing rows take the update path, so omitting update_set means no current player ever gets a headshot.
- `generate_player_slugs`: select the value from the **latest week explicitly** (sort by week, don't rely on row order), and populate the fields on both row-building paths (including the "no new players" early-return path).
- Access the new roster columns softly (`.get`/null-tolerant), NOT via `REQUIRED_ROSTER_COLS` — they're nullable by design and nflverse column drift must not fail the ingest.

Frontend: add the fields to the `PlayerSlug` type (`lib/data/players.ts` uses `select("*")`, so no query changes). No new data sources; both columns exist in the roster file the ingest already downloads.

## Component architecture

- `components/player/TecmoPlayerCard.tsx` — the card. Pure presentational; takes a `TecmoCardData` prop (identity, stat cells, ability rows with raw/pctl/tier, radar values, OVR). No data fetching.
- `lib/stats/tecmo-card.ts` — builders: `buildQBCardData`, `buildWRCardData`, `buildRBCardData` (stats + pools in, `TecmoCardData` out; OVR + tier + eligibility logic lives here, unit-testable).
- **RB source: `rb_season_stats`** for both raw values and percentile pools (server-computed, has receiving + fumbles). This replaces the current client-side weekly aggregation on the sections the card replaces; raw values and pools always come from the same source so `raw / percentile` pairs are coherent.
- `components/player/JerseyAvatar.tsx` — headshot-with-jersey-fallback (FB→RB position normalization added on card/player pages — today it exists only in compare/OG).
- Small shared luminance→text-color util (extracted; today's helpers are EPA-scale-specific or local to one component) so light team bands (e.g. CIN orange) get dark text.
- **Font:** Press Start 2P TTF bundled in the repo (SIL OFL licensed) — `next/font/local` for pages; the OG image and download route read the same bundled file (ImageResponse cannot use next/font, and bundling honors "no runtime font fetch").
- Page integration replaces sections in `app/card/[slug]/page.tsx` and the three `PlayerOverview*.tsx` components; OG image is a parallel inline-styled render (ImageResponse cannot use Tailwind).
- Old `StatCardView` is deleted once `/card` uses the new component; `__tests__/components/StatCardView.test.tsx` is replaced by equivalent `TecmoPlayerCard` tests in the same change.

## Edge cases (chaos checklist)

- Player with no headshot / broken URL → jersey fallback; no jersey number → jersey SVG with no number. Never a broken image.
- Below-threshold or zero-stat player: OVR `—`, bars render at 0 with gray dots, no NaN text anywhere.
- Week 1–3 thin pools (site now ingests single-game data): percentiles legal but volatile; thresholds mask most of it.
- Long names (`AMON-RA ST.BROWN`), long team names (`SAN FRANCISCO 49ERS`) in pixel font at mobile widths.
- Light team colors (CIN orange band): dark text on light bands via the newly extracted luminance util.
- FB position → RB variant (normalization added on card/player pages; currently only compare/OG have it).
- 2020–2025 historical seasons via `?season=` (headshot is current-day; acceptable).

## Out of scope (v1)

Hover mini-cards on leaderboards, card gallery, similar-players, RB receiving EPA ingest, card image download as client-side PNG capture, multi-season career view.

## Verification

- Unit tests for OVR builders (per-position inputs, threshold `—`, empty pools).
- Existing vitest suite + `tsc --noEmit` + `next build`; pytest for the ingest column additions.
- Chaos agent pass over the checklist above, then `/review-feature` per project convention.
- Visual check on desktop + phone before deploy.
