# Player Pages, Team Hubs & Site Navigation — Design Spec

**Date:** 2026-03-21
**Status:** Approved (unified from 3 PM teams + CPO mediation)
**Scope:** Player profile pages, team hub pages, game logs, navigation redesign, linking strategy

---

## Problem

Yards Per Pass has 5 disconnected tools with no connective tissue. Users hit dead ends everywhere — the QB leaderboard opens a modal with no escape route, the team tiers scatter plot has nowhere to drill down, and there's no way to navigate from a player to their team to their teammates. Adding player profile pages and team hub pages transforms the site from a collection of tools into a connected NFL analytics platform.

## Core Principle

**Every noun on the site should be clickable and lead somewhere useful.** Every team name links to a team hub. Every player name links to a player profile. Every stat label links to the glossary. No dead ends.

---

## 1. Site Hierarchy

```
yardsperpass.com
├── / (Homepage — league dashboard)
│
├── PRIMARY PAGES (navbar links)
│   ├── /teams              Team Tiers scatter plot (existing)
│   ├── /qb-leaderboard     QB rankings (existing)
│   ├── /receivers           Receiver rankings (existing)
│   └── /run-gaps            Run gap analysis (existing)
│
├── SECONDARY PAGES (linked from primary)
│   ├── /team/[team_id]     Team hub (32 pages) — e.g., /team/KC
│   └── /player/[slug]      Player profile (~500+ pages) — e.g., /player/patrick-mahomes
│
└── TERTIARY PAGES (footer)
    ├── /glossary
    └── /privacy
```

---

## 2. URL Structure

### Player Pages: `/player/[slug]`
- Slugs generated from player_name: "Patrick Mahomes" → `patrick-mahomes`
- Collision handling: append team abbreviation only when needed (`josh-allen-buf` vs `josh-allen-jax`)
- Season as query param: `/player/patrick-mahomes?season=2025`
- Tab as query param: `/player/patrick-mahomes?tab=game-log`
- 301 redirect from gsis_id: `/player/00-0039732` → `/player/patrick-mahomes` (handled in page component via `redirect()` from `next/navigation`)
- Case-insensitive: `/player/Patrick-Mahomes` → redirect to `/player/patrick-mahomes` (check `slug !== slug.toLowerCase()` in page component)
- `not-found.tsx`: Shows "Player not found" with navbar, search bar, and links to QB/Receiver leaderboards
- Canonical URL omits default season param
- ISR: On-demand rendering (empty `generateStaticParams`), `revalidate = 3600`

### Team Hubs: `/team/[team_id]`
- Uses existing 3-letter abbreviations: `/team/KC`, `/team/BUF`
- Case-insensitive: `/team/kc` → served as `/team/KC` (uppercase in page component's params handler before `getTeam()` lookup)
- All 32 pre-rendered via `generateStaticParams` at build time
- Season as query param: `/team/KC?season=2025`
- `revalidate = 3600`

### Game Logs
- NOT a separate route — tab within player page
- URL: `/player/patrick-mahomes?tab=game-log`
- Default tab is "overview" (omitted from URL)

---

## 3. New Database Tables

### `player_slugs` (lookup table)
```sql
CREATE TABLE player_slugs (
    player_id TEXT PRIMARY KEY,           -- nflverse gsis_id
    slug TEXT NOT NULL UNIQUE,            -- URL slug
    player_name TEXT NOT NULL,
    position TEXT,                        -- QB, WR, TE, RB
    current_team_id TEXT REFERENCES teams(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_player_slugs_slug ON player_slugs(slug);
CREATE INDEX idx_player_slugs_team ON player_slugs(current_team_id);
```

Generated in `ingest.py` from all unique (player_id, player_name) pairs across qb_season_stats, receiver_season_stats, and rb_gap_stats. Position from roster lookup. Collision detection appends team abbreviation.

**Pipeline integration:** Follows existing pattern — `ensure_player_slugs_table()` (NOT @retry), `upsert_player_slugs()` (@retry), added to `process_season()`, and `cleanup_stale_rows()` extended with player_slug_ids. RLS with public_read policy.

### `qb_weekly_stats`
```sql
CREATE TABLE qb_weekly_stats (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    player_id TEXT NOT NULL,
    season INT NOT NULL,
    week INT NOT NULL,
    team_id TEXT REFERENCES teams(id),
    opponent_id TEXT,
    home_away TEXT,                       -- 'home' or 'away'
    result TEXT,                          -- 'W' or 'L'
    team_score INT,
    opponent_score INT,
    completions INT,
    attempts INT,
    passing_yards INT,
    touchdowns INT,
    interceptions INT,
    sacks INT,
    epa_per_dropback NUMERIC,            -- EPA per dropback (not per play — matches radar axis)
    cpoe NUMERIC,
    success_rate NUMERIC,
    adot NUMERIC,
    passer_rating NUMERIC,
    ypa NUMERIC,                          -- yards per attempt
    rush_attempts INT,
    rush_yards INT,
    rush_tds INT,
    fumbles INT,
    fumbles_lost INT,
    UNIQUE (player_id, season, week)
);
```

**Note:** `passing_yards` excludes sack yardage (same rule as season-level stats). `epa_per_dropback` uses dropback-only plays (pass_attempt + sack + scramble), matching the radar chart axis.

### `receiver_weekly_stats`
```sql
CREATE TABLE receiver_weekly_stats (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    player_id TEXT NOT NULL,
    season INT NOT NULL,
    week INT NOT NULL,
    team_id TEXT REFERENCES teams(id),
    opponent_id TEXT,
    home_away TEXT,
    result TEXT,
    team_score INT,
    opponent_score INT,
    targets INT,
    receptions INT,
    receiving_yards INT,
    receiving_tds INT,
    epa_per_target NUMERIC,
    catch_rate NUMERIC,
    yac NUMERIC,
    yac_per_reception NUMERIC,
    adot NUMERIC,
    air_yards NUMERIC,
    routes_run INT,
    UNIQUE (player_id, season, week)
);
```

### `rb_weekly_stats`
```sql
CREATE TABLE rb_weekly_stats (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    player_id TEXT NOT NULL,
    season INT NOT NULL,
    week INT NOT NULL,
    team_id TEXT REFERENCES teams(id),
    opponent_id TEXT,
    home_away TEXT,
    result TEXT,
    team_score INT,
    opponent_score INT,
    carries INT,
    rushing_yards INT,
    rushing_tds INT,
    epa_per_carry NUMERIC,
    success_rate NUMERIC,
    yards_per_carry NUMERIC,
    stuff_rate NUMERIC,
    explosive_rate NUMERIC,
    targets INT,
    receptions INT,
    receiving_yards INT,
    receiving_tds INT,
    fumbles INT,
    fumbles_lost INT,
    UNIQUE (player_id, season, week)
);
```

All weekly tables populated in `ingest.py` via groupby on `(player_id, season, week)` from PBP data.

**Game context derivation:** `team_score`/`opponent_score` derived from nflverse `total_home_score`/`total_away_score` columns (take `max()` per game_id to get final score). `home_away` derived from `posteam` vs `home_team`. `result` (W/L) derived from score comparison. These PBP columns must be added to `REQUIRED_PBP_COLS`.

**Bye week handling:** Detect gaps in the week sequence per player — if a player has data for weeks 1-6 and 8-17, week 7 is inferred as a bye. No external schedule dataset needed.

**TypeScript interfaces:** Add `PlayerSlug`, `QBWeeklyStat`, `ReceiverWeeklyStat`, `RBWeeklyStat` to `lib/types/index.ts` mirroring the SQL schemas. All NUMERIC columns need entries in `parseNumericFields` arrays in the query functions.

**Pagination:** Weekly stat queries may exceed Supabase 1000-row cap for multi-season queries. Extract `fetchAllRows()` from `lib/data/run-gaps.ts` into a shared `lib/data/utils.ts` utility (Phase 2).

---

## 4. Player Page Design

### Header (all positions)
- Player name (large), position badge, team logo + team name (linked to `/team/[team_id]`)
- Team-colored accent bar at top
- Season selector (same pattern as existing pages)
- Breadcrumb: `QB Rankings > Patrick Mahomes` (position-aware link back to relevant leaderboard)

### Tab Bar
- **Overview** (default) — radar + stats + cross-links
- **Game Log** — weekly table + sparklines

### Overview Tab — QB
**Radar chart axes (6):** *(NOTE: intentionally differs from current modal radar — drops Rush EPA, adds Volume)*
1. Efficiency (EPA/Dropback)
2. Accuracy (CPOE)
3. Volume (Yards/Game)
4. Big Plays (aDOT)
5. Ball Security (TD:INT ratio)
6. Consistency (Success Rate)

**Stat chips:** 3×2 grid with ranked values (same format as current modal)

**Vs-league bars:** Full-width divergence bars showing player vs league avg

**Rushing section:** Rush attempts, yards, TDs, rush EPA (if dual-threat QB)

**Team context:** "Throws to:" — top 3 receivers with key stat, each linked to `/player/[slug]`

**Cross-link:** "View [Team] Hub →" → `/team/[team_id]`

### Overview Tab — WR/TE
**Radar chart axes (6):**
1. Volume (Targets/Game)
2. Efficiency (EPA/Target)
3. Separation/Catch (Catch Rate)
4. Downfield (ADOT)
5. After Catch (YAC/Rec)
6. Consistency (YPRR)

**Stat chips + bars:** Same pattern as QB

**Team context:** "Catches from:" — their QB with key stats, linked to `/player/[slug]`

**Cross-link:** "View [Team] Receivers →" → `/receivers?team=[team_id]`

### Overview Tab — RB
**Radar chart axes (6):**
1. Volume (Carries/Game)
2. Efficiency (EPA/Carry)
3. Power (Stuff Avoidance — inverse stuff rate)
4. Explosiveness (Explosive Run Rate)
5. Receiving (EPA/Target as receiver)
6. Consistency (Success Rate)

**Gap breakdown:** Personal 7-gap bar chart

**Cross-link:** "View [Team] Run Gaps →" → `/run-gaps?team=[team_id]`

---

## 5. Game Log Tab Design

### Sparklines (top of tab)
Two SVG sparklines at top:
1. **EPA trend** — line chart showing EPA/play per week (green above avg, red below)
2. **Volume trend** — bar chart showing attempts/targets/carries per week

### Common columns (all positions)
| Week | Opp | H/A | Result |

- Opponent: team logo + abbreviation, linked to `/team/[opp_id]`
- H/A: "@" for away, "vs" for home
- Result: "W 31-24" or "L 17-28"
- Bye weeks: grayed-out row with "BYE" label

### QB columns
| Comp/Att | Yards | TD | INT | EPA/Play | CPOE | Sck | Rush Yds | Rush TD |

### WR/TE columns
| Tgt | Rec | Yards | TD | EPA/Tgt | Catch% | ADOT | YAC | Routes |

### RB columns
| Car | Yards | TD | EPA/Car | Succ% | Tgt | Rec | Rec Yds | Rec TD |

---

## 6. Team Hub Design

Route: `/team/[team_id]` (e.g., `/team/PHI`)

Organized by **football concepts**, not database tables.

### A. Team Identity Card (top)
- Team logo (large), full name, record (W-L), division, conference
- EPA rank badges: "5th in Off EPA" / "12th in Def EPA"
- Season selector
- Breadcrumb: `Team Tiers > Kansas City Chiefs`

### B. Passing Attack Section
- **Programmatic summary:** "The {team} passing offense ranks {rank}th in EPA/play ({value}) through Week {week}."
- **QB card:** Starting QB radar chart (compact) + key stats (EPA/DB, CPOE, success rate). Name links to `/player/[slug]`.
- **Receivers table:** Team receivers sorted by targets — Target Share, EPA/Tgt, Catch%, YPRR. Each name links to `/player/[slug]`.
- **Cross-link:** "See full QB Rankings →" → `/qb-leaderboard`

### C. Ground Game Section
- **Programmatic summary:** "The {team} rush offense ranks {rank}th in EPA ({value}), running through the {best_gap} gap most effectively."
- **Gap mini-heatmap:** 7-gap bar showing EPA per gap (reuse `GapBarChart` component)
- **RBs table:** Carries, EPA/carry, yards/carry, success rate. Names link to `/player/[slug]`.
- **Cross-link:** "Full Run Gap Breakdown →" → `/run-gaps?team=[team_id]`

### D. Defense Section
- Team defensive EPA/play (pass and rush splits)
- Defensive gap heatmap (from `def_gap_stats`)
- Opponent success rate
- Takeaways (interceptions + opponent fumbles lost — derive from PBP and add to `team_season_stats` pipeline)

### E. Division Rivals Strip
- Horizontal row of 3 cards showing other division teams
- Each: logo, record, off/def EPA rank
- Each links to `/team/[rival_id]`

### Programmatic Summaries
These are template strings, NOT AI-generated. Pattern:
```
`The ${teamName} ${concept} ranks ${ordinal(rank)} in ${metricLabel} (${value.toFixed(2)}) through Week ${week}.`
```
Built from data already queried for the page. Zero additional API calls.

---

## 7. Navigation Changes

### Navbar
**Keep current 5 links. Add search icon.**
```
[YPP Logo]  Team Tiers  QBs  Receivers  Run Gaps  [🔍]
```
- Logo → homepage
- Search icon → Cmd+K / Ctrl+K command palette overlay
- Search indexes all player names + team names from `player_slugs` + `NFL_TEAMS`
- Glossary moves to footer only

### Breadcrumbs
On all secondary/tertiary pages. Logical hierarchy (not click path):
- Player page: `QB Rankings > Patrick Mahomes`
- Team hub: `Team Tiers > Kansas City Chiefs`
- Run Gaps (team-scoped): `Team Hub: KC > Run Gap Analysis`

### Linking Changes to Existing Pages
- **QBLeaderboard:** Player name → `<Link>` to `/player/[slug]`. Team abbreviation → `<Link>` to `/team/[team_id]`.
- **ReceiverLeaderboard:** Same pattern.
- **RunGapDiagram:** Player name in PlayerGapCards → `<Link>` to `/player/[slug]`.
- **TeamScatterPlot:** Team dot click → `/team/[team_id]`. Tooltip adds "View Team Hub →" hint.
- **MobileTeamList:** Team name → `/team/[team_id]`.

### Modal Transition Strategy
1. Build player pages first (Phase 3)
2. Make player NAMES links on leaderboards (Phase 4) — row click still opens modal
3. Both coexist during transition
4. Remove modals entirely in Phase 7 — row click navigates to player page

---

## 8. Homepage Redesign (Phase 7)

Current homepage (feature cards) → League dashboard:

1. **Compact hero:** Title + subtitle + freshness badge (shrunk, not full-viewport)
2. **32-team logo grid:** 8×4 organized by division. Each logo → `/team/[team_id]`. Shows record on hover.
3. **Stat leaderboard strips:** 3 horizontal scrollable strips (top 5 QBs by EPA, top 5 receivers by yards, biggest movers). Player names → `/player/[slug]`.
4. **Feature cards:** Keep 4 cards pointing to primary pages (shrunk to a footer-like row).

---

## 9. Component Architecture

### Shared Utility Extraction
Extract duplicated logic from `QBStatCard.tsx` and `ReceiverStatCard.tsx` into:
- `lib/stats/percentiles.ts` — `computePercentile()`, `computeRank()`, `ordinal()`, `chipColor()`
- `lib/stats/formatters.ts` — stat formatting functions

### New Components (~15)
**Player page:**
- `components/player/PlayerHeader.tsx` — name, team, position, season selector
- `components/player/PlayerOverviewQB.tsx` — QB overview layout
- `components/player/PlayerOverviewWR.tsx` — WR/TE overview layout
- `components/player/PlayerOverviewRB.tsx` — RB overview layout
- `components/player/GameLogTable.tsx` — position-aware game log
- `components/player/Sparkline.tsx` — SVG sparkline (reusable)

**Team hub:**
- `components/team/TeamIdentityCard.tsx` — logo, name, record, EPA badges
- `components/team/PassingSection.tsx` — QB + receivers
- `components/team/GroundGameSection.tsx` — run game + gap heatmap
- `components/team/DefenseSection.tsx` — defensive stats
- `components/team/DivisionRivals.tsx` — 3-card rival strip

**Navigation:**
- `components/search/SearchPalette.tsx` — Cmd+K overlay
- `components/ui/Breadcrumbs.tsx` — breadcrumb nav

### New Data Layer Files
- `lib/data/players.ts` — `getPlayerBySlug()`, `getPlayerSeasonStats()`, `getPlayerWeeklyStats()`, `getAllPlayerSlugs()`
- `lib/data/team-hub.ts` — `getTeamHubData()`, `getTeamRoster()`, `getTeamQBs()`, `getTeamReceivers()`

### New Page Files
- `app/player/[slug]/page.tsx`, `loading.tsx`, `error.tsx`, `not-found.tsx`, `opengraph-image.tsx`
- `app/team/[team_id]/page.tsx`, `loading.tsx`, `error.tsx`, `opengraph-image.tsx`

---

## 10. SEO Infrastructure

### Dynamic Metadata
Player pages: `"Patrick Mahomes Stats — QB | Yards Per Pass"`
Team pages: `"Kansas City Chiefs Stats | Yards Per Pass"`

### JSON-LD Structured Data
```json
// Player
{ "@type": "Person", "name": "Patrick Mahomes",
  "affiliation": { "@type": "SportsTeam", "name": "Kansas City Chiefs" } }

// Team
{ "@type": "SportsTeam", "name": "Kansas City Chiefs",
  "sport": "American Football",
  "memberOf": { "@type": "SportsOrganization", "name": "National Football League" } }
```

### Sitemap
Dynamic sitemap fetching all player slugs + 32 teams at build time. Player pages priority 0.7, team pages 0.8.

### OG Images
Dynamic `opengraph-image.tsx` for both player and team pages — player name/team name on team-colored background.

### Canonical URLs
`<link rel="canonical">` on every page. Omit default season param from canonical.

---

## 11. Build Phases

| Phase | What | Sessions | Dependencies |
|-------|------|----------|-------------|
| 1 | **Data Foundation** — player_slugs table, 3 weekly tables, pipeline updates, ingest all seasons | 1 | None |
| 2 | **Shared Utilities** — extract percentile/formatter code, extract `fetchAllRows` to shared util, build Breadcrumbs component | 1 | Phase 1 |
| 3 | **Player Pages** — /player/[slug] with Overview + Game Log tabs, all 3 positions | 2-3 | Phases 1-2 |
| 4 | **Link Leaderboards** — player names become Links, team abbreviations become Links | 1 | Phase 3 |
| 5 | **Team Hubs** — /team/[team_id] with all sections, division rivals, programmatic summaries | 2 | Phases 1, 3 |
| 6 | **Search + Nav** — SearchPalette (Cmd+K), breadcrumbs on all secondary pages | 1 | Phases 3-5 |
| 7a | **Modal Removal** — kill modals, row click navigates to player page | 1 | Phase 6 |
| 7b | **Homepage Redesign** — league dashboard with team grid + leaderboard strips | 1 | Phase 7a |
| 8 | **SEO Polish** — metadata, JSON-LD, OG images, sitemap, canonical URLs | 1 | Phase 7b |

**Total: ~10-12 sessions**

---

## 12. What This Does NOT Include

1. Defensive player pages (no clean per-player defensive data in nflverse PBP)
2. Matchup/game preview tool (separate future project)
3. Situational splits on player pages (down/distance, red zone, game script)
4. Player headshot photos (team-color circle with initials, same as current)
5. Multi-season comparison view (single season via selector is sufficient for v1)
6. User accounts, favorites, or saved views
7. AI-generated narratives (programmatic summaries are template strings only)
8. Dark mode
9. Fourth down calculator, PROE, or other competitor features
10. Frontend tests (deferred — 90 backend tests cover the data layer)
