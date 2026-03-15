# Yards Per Pass — Design Specification

**Date:** 2026-03-14
**Status:** Final (post 3-team review + PM decisions)
**Author:** Jon Ramsey + Claude
**Visual Mockup:** `design_mockup.html` (in project root)

---

## 1. Overview

Yards Per Pass is a clean, minimalist NFL analytics website that consolidates advanced metrics (EPA, CPOE, success rate) into beautiful, interactive dashboards. The site targets analytics-curious NFL fans, fantasy players, and the NFL Twitter community.

**Goal:** Portfolio/passion project with the architecture to grow into a real product.

**MVP scope:** Landing page + Team Tiers scatter plot + QB Leaderboard table, backed by automated nflverse data pipeline.

**Domain:** yardsperpass.com

---

## 2. Design Language

**Philosophy:** Clean, minimalist, data-forward. No dark mode, no glassmorphism, no gradients. Lots of white space. The data is the experience.

**Colors:**
- Primary text / headings: NFL Navy `#013369`
- Accent / CTAs: NFL Red `#D50A0A`
- Background: White `#FFFFFF`
- Section backgrounds: Light gray `#F5F5F5`
- Secondary text: `#6B7280`
- Borders: `#E5E7EB`
- Subtle hover: `#F8FAFC`

**Typography:**
- Font: Inter (Google Fonts)
- Headings: 700/800 weight, tight letter-spacing
- Body: 400/500 weight
- Data cells: tabular-nums variant

**Spacing & Radius:**
- Border radius: 6px (cards, buttons, inputs)
- Page padding: 48px horizontal
- Consistent 24px/32px vertical rhythm

**Brand mark:** "YARDS PER PASS" — wordmark only, no icon. "PASS" in NFL Red.

---

## 3. Tech Stack

| Layer | Technology | Why |
|-------|-----------|-----|
| Frontend | Next.js 14 (App Router) + TypeScript | SSR for future SEO, App Router for layouts |
| Styling | Tailwind CSS + shadcn/ui | Rapid prototyping, consistent component library |
| Charts | D3.js (scatter plot), Recharts (future charts) | D3 for full art-direction on the hero viz |
| Database | Supabase (PostgreSQL) | Free tier, auth included for future use |
| Data Source | nflverse Parquet files (GitHub releases) | Pre-computed EPA/WPA, free, peer-reviewed |
| Data Ingest | Python script + GitHub Actions cron | Weekly ETL, decoupled from frontend |
| Hosting | Vercel | Edge CDN, GitHub integration |

**Key technical constraints:**
- All interactive components must have `'use client'` directive
- Pin all dependency versions exactly (no `^` or `~`)
- Commit `package-lock.json`
- Python ingest script is fully decoupled — no shared imports with Next.js

**Config files:**
- `next.config.ts`: Add `images.remotePatterns` for `a.espncdn.com` (for team logos). Do NOT set `output: 'standalone'` — unnecessary for Vercel and adds build bloat.
- `tailwind.config.ts`: Extend theme with custom colors — `navy: '#013369'`, `nflred: '#D50A0A'`. Set dark mode to `'class'` (unused for now but prevents issues if added later).

**Supabase numeric fields:** Supabase returns `NUMERIC` columns as strings by default. The data-fetching layer must parse them to JavaScript numbers (e.g., `parseFloat()`) before passing to components. Handle this in the server-side fetch functions, not in individual components.

---

## 4. Project Structure

```
yards-per-pass/
├── app/
│   ├── layout.tsx                  # Root layout: Inter font, metadata, global styles
│   ├── page.tsx                    # Landing page
│   ├── teams/
│   │   ├── page.tsx                # Team Tiers page (renders scatter plot)
│   │   ├── loading.tsx             # Skeleton loader
│   │   └── error.tsx               # Error boundary
│   └── qb-leaderboard/
│       ├── page.tsx                # QB Leaderboard page (renders table)
│       ├── loading.tsx             # Skeleton loader
│       └── error.tsx               # Error boundary
├── components/
│   ├── layout/
│   │   ├── Navbar.tsx              # Top navigation bar
│   │   ├── Footer.tsx              # Minimal footer with nflverse attribution
│   │   └── DashboardShell.tsx      # Shared wrapper for data pages (season picker, data freshness)
│   ├── charts/
│   │   └── TeamScatterPlot.tsx     # D3 scatter plot — ALL D3 code contained here
│   ├── tables/
│   │   └── QBLeaderboard.tsx       # Sortable QB stats table
│   └── ui/
│       ├── SeasonSelect.tsx        # Reusable season dropdown
│       └── MetricTooltip.tsx       # Info icon + popover explaining a metric
├── lib/
│   ├── supabase/
│   │   ├── client.ts               # Browser Supabase client
│   │   └── server.ts               # Server Supabase client
│   ├── data/
│   │   └── teams.ts                # Comprehensive 32-team data file (colors, logos, divisions)
│   ├── types/
│   │   └── index.ts                # Shared TypeScript interfaces
│   └── utils.ts                    # Utility functions
├── scripts/
│   ├── ingest.py                   # nflverse → Supabase ETL pipeline
│   └── requirements.txt            # Python dependencies
├── .github/
│   └── workflows/
│       ├── data-refresh.yml        # Weekly Tuesday cron
│       └── seed.yml                # One-time historical data load
├── public/
│   └── og-image.png               # Static OG image for social sharing
├── .env.local.example              # Environment variable template
├── tailwind.config.ts
├── next.config.ts
└── package.json
```

---

## 5. Database Schema

### Source of truth for team data

The `teams` SQL table exists for **relational integrity** (foreign keys from other tables). The `lib/data/teams.ts` file is the **runtime source of truth** for team metadata including logos, colors, and display names. Components should import from `teams.ts`, not query the `teams` table directly. The ingest script seeds the `teams` table from its own data; `teams.ts` is maintained independently for the frontend.

### `teams` — 32 rows, static reference data
```sql
CREATE TABLE teams (
  id TEXT PRIMARY KEY,              -- "BUF", "KC", etc.
  name TEXT NOT NULL,               -- "Buffalo Bills"
  division TEXT NOT NULL,           -- "AFC East"
  conference TEXT NOT NULL,         -- "AFC"
  primary_color TEXT NOT NULL,      -- "#00338D"
  secondary_color TEXT NOT NULL     -- "#C60C30"
);
```

### `team_season_stats` — ~192 rows (32 teams x 6 seasons)
```sql
CREATE TABLE team_season_stats (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id TEXT REFERENCES teams(id),
  season INTEGER NOT NULL,
  off_epa_play NUMERIC,
  def_epa_play NUMERIC,
  off_pass_epa NUMERIC,
  off_rush_epa NUMERIC,
  def_pass_epa NUMERIC,
  def_rush_epa NUMERIC,
  off_success_rate NUMERIC,
  def_success_rate NUMERIC,
  pass_rate NUMERIC,
  plays INTEGER,
  wins INTEGER DEFAULT 0,
  losses INTEGER DEFAULT 0,
  ties INTEGER DEFAULT 0,
  UNIQUE(team_id, season)
);

CREATE INDEX idx_team_season ON team_season_stats(season, team_id);
```

### `qb_season_stats` — ~200 rows per season
```sql
CREATE TABLE qb_season_stats (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id TEXT NOT NULL,
  player_name TEXT NOT NULL,
  team_id TEXT REFERENCES teams(id),  -- team with most attempts that season
  season INTEGER NOT NULL,
  games INTEGER,
  completions INTEGER,                -- needed for comp% and passer rating
  attempts INTEGER,                   -- pass attempts excluding sacks
  dropbacks INTEGER,                  -- attempts + sacks + scrambles (qb_dropback == 1)
  epa_per_db NUMERIC,                -- EPA per dropback (passing + sacks + scrambles)
  epa_per_play NUMERIC,              -- EPA per all plays (dropbacks + designed rushes)
  cpoe NUMERIC,
  completion_pct NUMERIC,             -- completions / attempts * 100
  success_rate NUMERIC,
  passing_yards INTEGER,
  touchdowns INTEGER,
  interceptions INTEGER,
  sacks INTEGER,
  adot NUMERIC,
  ypa NUMERIC,
  passer_rating NUMERIC,
  rush_attempts INTEGER,             -- designed runs only (qb_dropback == 0)
  rush_yards INTEGER,
  rush_tds INTEGER,
  rush_epa_per_play NUMERIC,         -- EPA per designed rush
  UNIQUE(player_id, season)
);

CREATE INDEX idx_qb_season ON qb_season_stats(season);
CREATE INDEX idx_qb_player ON qb_season_stats(player_id);
```

Note: For QBs who played on multiple teams in a season, `team_id` is set to the team where the QB had the most pass attempts. Stats reflect the combined season across all teams.

### `data_freshness` — single row, updated by ingest
```sql
CREATE TABLE data_freshness (
  id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  last_updated TIMESTAMPTZ DEFAULT NOW(),
  season INTEGER,
  through_week INTEGER
);

INSERT INTO data_freshness (season, through_week) VALUES (2025, 0);
```

### Row Level Security
Enable RLS on all tables with anonymous read access. Without the SELECT policy, the anon key returns zero rows silently.

```sql
-- Repeat for each table: teams, team_season_stats, qb_season_stats, data_freshness
ALTER TABLE teams ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public_read" ON teams FOR SELECT USING (true);

ALTER TABLE team_season_stats ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public_read" ON team_season_stats FOR SELECT USING (true);

ALTER TABLE qb_season_stats ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public_read" ON qb_season_stats FOR SELECT USING (true);

ALTER TABLE data_freshness ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public_read" ON data_freshness FOR SELECT USING (true);
```

Write access is restricted to the service role key (used by the ingest script only).

---

## 6. Data Pipeline

### `scripts/ingest.py`

**Input:** nflverse Parquet files from GitHub releases
- Play-by-play: `https://github.com/nflverse/nflverse-data/releases/download/pbp/play_by_play_{season}.parquet`
- Rosters: `https://github.com/nflverse/nflverse-data/releases/download/rosters/roster_weekly_{season}.parquet`

**Processing:**
1. Download Parquet files for specified season(s) using `pandas` + `pyarrow`
2. **Filter plays** (critical for data accuracy):
   - Include only: `play_type IN ('pass', 'run')`
   - Include only: `season_type == 'REG'` (regular season — exclude playoffs)
   - Exclude: `two_point_attempt == 1`
   - Exclude: `play_type IN ('no_play', 'qb_kneel', 'qb_spike', 'punt', 'field_goal', 'kickoff', 'extra_point')`
   - Do NOT exclude garbage time (matches rbsdm.com default, avoidable debates)
3. **Aggregate team stats:** `team_season_stats`
   - Off EPA/play: `SUM(epa) / COUNT(*)` where `posteam == team_id`
   - Def EPA/play: `SUM(epa) / COUNT(*)` where `defteam == team_id`
   - Pass/rush splits: use `pass_attempt == 1` (includes sacks) vs `rush_attempt == 1`
   - Success rate: use nflverse's pre-computed `success` column (EPA > 0), not down-distance thresholds
   - Wins/losses: derive from game scores in play-by-play (`result` column grouped by `game_id`)
4. **Aggregate QB stats:** `qb_season_stats`
   - **Identify QBs:** Use roster data (`position == 'QB'`) to get a set of QB `player_id`s for the season
   - Group by `passer_player_id` (NOT `passer_player_name` — handles name variations)
   - **Dropbacks:** rows where `qb_dropback == 1` (NOT `passer_player_id IS NOT NULL` — `qb_dropback` is the canonical nflverse flag and avoids edge cases with scrambles classified as runs)
   - Attempts: dropbacks where `sack == 0`
   - Completions: `SUM(complete_pass)`
   - **EPA/dropback:** `SUM(epa) / COUNT(*)` on all dropbacks (includes sack EPA — analytically correct)
   - **Rushing stats:** Filter `rusher_player_id IN (qb_ids)` AND `qb_dropback == 0` (designed runs only — scrambles are already captured in dropbacks)
     - `rush_attempts`: count of designed runs
     - `rush_yards`: `SUM(rushing_yards)`
     - `rush_tds`: `SUM(rush_touchdown)`
     - `rush_epa_per_play`: `SUM(epa) / COUNT(*)` on designed runs
   - **EPA/play (total):** `(SUM(dropback_epa) + SUM(rush_epa)) / (dropbacks + rush_attempts)` — captures full QB value including designed runs
   - CPOE: `AVG(cpoe)` where `cpoe IS NOT NULL` (NULL on sacks/throwaways)
   - aDOT: `AVG(air_yards)` where `air_yards IS NOT NULL`
   - YPA: `SUM(passing_yards) / attempts` (sacks and scrambles excluded from denominator)
   - Passer rating: compute from season totals (completions, attempts, yards, TDs, INTs) — NOT from averaging per-play values
   - Multi-team QBs: assign `team_id` to the team with the most pass attempts
5. Compute `through_week` from max week in the data

**Output:** Upsert into Supabase via direct PostgreSQL connection (`psycopg2`)
- Uses `DATABASE_URL` environment variable
- Batch insert with `ON CONFLICT ... DO UPDATE` for idempotency
- Updates `data_freshness` timestamp and through_week on completion

**CLI:**
```
python scripts/ingest.py --season 2025        # Single season
python scripts/ingest.py --all                # All seasons 2020-2025
python scripts/ingest.py --season 2025 --dry-run  # Preview without writing
```

**Dependencies** (`scripts/requirements.txt`):
```
pandas==2.2.3
pyarrow==18.1.0
psycopg2-binary==2.9.10
python-dotenv==1.0.1
```

### GitHub Actions

**`data-refresh.yml`** — weekly auto-update:
- Cron: every Tuesday at 6:00 AM UTC
- Manual trigger via `workflow_dispatch` with optional season parameter
- Runs `python scripts/ingest.py --season 2025`
- Secrets: `DATABASE_URL`
- Timeout: 30 minutes

**`seed.yml`** — one-time historical load:
- Manual dispatch only
- Input: comma-separated seasons (default: "2020,2021,2022,2023,2024,2025")
- Loops through each season and runs ingest
- Secrets: `DATABASE_URL`

---

## 7. Pages & Components

### 7.1 Landing Page (`app/page.tsx`)

**Layout:** Marketing page — no DashboardShell wrapper.

**Sections:**
1. **Navbar** — "YARDS PER PASS" wordmark left, "Team Tiers" / "QB Rankings" links right
2. **Hero** — Large heading "NFL Analytics, Simplified." with one-line subtitle. Two CTA buttons: "Explore Team Tiers" (red, primary) and "QB Leaderboard" (outlined, secondary)
3. **Feature cards** — 3-column grid: Team Tiers, QB Rankings, More Coming. Each with icon, title, short description.
4. **Footer** — "Data sourced from nflverse" attribution, copyright

**No:** auth buttons, newsletter signup, pricing, social proof.

### 7.2 Team Tiers (`app/teams/page.tsx`)

**Layout:** Wrapped in DashboardShell.

**Data flow:**
1. Server component accepts `searchParams` prop: `{ searchParams: { season?: string } }`
2. Fetches `team_season_stats` + `data_freshness` from Supabase for selected season (apply `parseFloat` to NUMERIC fields)
3. Passes data as props to `TeamScatterPlot` client component
4. Page-level caching: `export const revalidate = 3600` (data changes weekly, hourly revalidation is generous)

**Above chart:**
- Page title: "Team Tiers"
- Season dropdown (from DashboardShell)
- **Data freshness badge:** Prominent pill-shaped badge (light blue background, navy text) reading "Through Week 12 · Updated Dec 3, 2025". Must be immediately visible — not buried in a footer or small text. Users need to know what they're looking at at a glance, especially mid-season. Displayed in DashboardShell so it appears on both Team Tiers and QB Leaderboard pages.

**TeamScatterPlot.tsx** (D3, `'use client'`):

**Must use `dynamic` import with `ssr: false`** in the parent page — D3 accesses `window`/`document` and will crash during server-side rendering:
```typescript
const TeamScatterPlot = dynamic(() => import('@/components/charts/TeamScatterPlot'), { ssr: false });
```

**Desktop view** (viewport >= 768px):
- SVG canvas, full width of content area, ~560px height
- **X-axis:** Offensive EPA/play (left = bad offense, right = good offense)
- **Y-axis:** Defensive EPA/play, inverted (top = good defense, bottom = bad defense)
- **Quadrants:** Four zones with subtle background tints:
  - Top-right (green tint): **"Contenders"** — "Elite on both sides of the ball"
  - Top-left (yellow tint): **"Defense Carries"** — "Strong defense, offense needs work"
  - Bottom-right (yellow tint): **"Offense First"** — "High-powered offense, defense needs work"
  - Bottom-left (red tint): **"Bottom Feeders"** — "Struggling on both sides"
- **Dashed crosshair** lines at x=0, y=0 creating the quadrant split
- **Team dots:** Team logos rendered as SVG `<image>` elements (not `<foreignObject>`), 32x32px, positioned at data coordinates. Logo source: nflverse team logos (`https://a.espncdn.com/i/teamlogos/nfl/500/{abbr}.png`) — the same CDN the nflverse ecosystem uses, stable for 15+ years. **Fallback:** If an image fails to load, render a colored circle (team primary color) with the team abbreviation in white text.
- **Hover:** Logo scales up 1.4x, tooltip appears showing team name, Off EPA, Def EPA, record
- **Watermark:** "yardsperpass.com" in light gray text in the bottom-right corner of the chart — visible in screenshots
- **Container styling:** White background, light gray `#FAFAFA` chart area, `1px solid #E5E7EB` border, 6px radius

**Mobile view** (viewport < 768px):
- Do NOT show the scatter plot. Instead show a sorted list of teams by composite EPA score (off_epa_play - def_epa_play), grouped by quadrant. Same data, mobile-native UX.

**D3 containment rule:** All D3 code (scales, axes, rendering, event handlers) lives inside this one component. Uses `useRef` for the SVG container and `useEffect` for D3 rendering. **The `useEffect` must return a cleanup function** that calls `d3.select(svgRef.current).selectAll('*').remove()` — without this, React strict mode in development creates duplicate chart elements. Clean props interface:
```typescript
interface TeamScatterPlotProps {
  data: TeamSeasonStat[];
  teams: Team[];
}
```

### 7.3 QB Leaderboard (`app/qb-leaderboard/page.tsx`)

**Layout:** Wrapped in DashboardShell.

**Data flow:**
1. Server component accepts `searchParams` prop: `{ searchParams: { season?: string } }`
2. Fetches `qb_season_stats` from Supabase for selected season (apply `parseFloat` to NUMERIC fields)
3. Passes to `QBLeaderboard` client component
4. Page-level caching: `export const revalidate = 3600`

**QBLeaderboard.tsx** (`'use client'`):

**Controls bar:**
- Search input: "Search players..." — filters by player_name
- Min dropbacks slider: range 50-500. Default is adaptive: `Math.round(200 * (through_week / 18))`, minimum 50. (18 weeks in NFL regular season.) This prevents filtering out all QBs during early-season weeks.
- (Season selector is in DashboardShell)

**Table** (built with shadcn Table):
- **Headers** (all clickable to sort asc/desc):
  - `#` (rank), Player, Team, GP, EPA/Play, EPA/DB, Comp%, CPOE, Success%, Yards, TD, INT, Sk, Rush Att, Rush Yds, Rush TD, aDOT, YPA, Rating
- **Player column:** Team primary color dot (8px circle) + bold player name
- **EPA/Play column:** Green if positive, red if negative, bold font. This is the total EPA (passing + rushing) per all plays — captures full QB value.
- **EPA/DB column:** Green if positive, red if negative. Dropback-only EPA (passing + sacks + scrambles) — isolates passing efficiency.
- **Sk column:** Sack count — context for EPA/DB. If a QB's dropback EPA seems low relative to their comp%/CPOE, sacks explain why.
- **Rush columns:** Rush Att, Rush Yds, Rush TD — makes mobile QBs (Lamar, Allen, Hurts) visible. Without this, the leaderboard is a 2015 view of QB play.
- **Rank column:** Gray, bold, tabular-nums
- **Numeric columns:** Right-aligned, tabular-nums
- **Styling:** NFL navy header row, white body, subtle row borders, hover highlight `#F8FAFC`
- **Default sort:** EPA/Play descending (total EPA, the most complete measure of QB value)
- **Column groups:** On desktop, subtle visual separation between passing stats (Comp% through Sk), rushing stats (Rush Att through Rush TD), and efficiency stats (aDOT through Rating) using slightly different header background tints or thin vertical dividers. Helps the eye navigate a wide table.

### 7.4 Shared Components

**Navbar.tsx:**
- Sticky top, white background, bottom border
- Left: "YARDS PER PASS" wordmark (navy, "PASS" in red)
- Right: page links (Team Tiers, QB Rankings)
- Mobile: hamburger menu (shadcn Sheet)
- Active page link: navy + semibold; inactive: gray

**Footer.tsx:**
- Minimal single line
- "Built on nflverse — open-source, peer-reviewed NFL analytics data." + copyright (trust signal, not just attribution)
- White background, top border

**DashboardShell.tsx:**
- Wraps Teams and QB Leaderboard pages
- Provides consistent padding, page title area
- **Data freshness badge:** Prominent pill (light blue bg, navy text) showing "Through Week X · Updated [date]" — immediately visible next to the page title, not buried
- Season selector slot (SeasonSelect component)

**SeasonSelect.tsx:**
- Dropdown populated from `SELECT DISTINCT season FROM team_season_stats ORDER BY season DESC`
- Defaults to the most recent season
- **Data flow pattern:** Season is stored as a URL search param (`?season=2024`). Changing the season calls `router.push` with the new search param, which triggers a server-side re-fetch via Next.js navigation. This keeps data fetching on the server and makes season-specific pages linkable/shareable.

### 7.5 Loading, Error, and Empty States

- **Loading:** While Supabase data is fetching, show a centered spinner (simple CSS spinner, not a library). For the scatter plot, show the empty chart container with quadrant labels but no dots. For the leaderboard, show a skeleton table with 10 gray shimmer rows.
- **Error:** If Supabase is unreachable, show a centered message: "Unable to load data. Please try again later." with a retry button. No stack traces or technical details.
- **Empty season:** If a selected season has no data (e.g., future season), show: "No data available for the [year] season yet."
- **Empty search:** If QB search returns zero results, show: "No players match your search." in the table body area.

### 7.6 `lib/data/teams.ts`

Comprehensive, typed, verified data file for all 32 NFL teams.

```typescript
export interface Team {
  id: string;            // "BUF"
  name: string;          // "Buffalo Bills"
  abbreviation: string;  // "BUF"
  division: string;      // "AFC East"
  conference: string;    // "AFC"
  primaryColor: string;  // "#00338D"
  secondaryColor: string; // "#C60C30"
  logo: string;          // ESPN CDN URL
}
```

- Exports `NFL_TEAMS: Team[]` — all 32 teams with verified hex colors and ESPN CDN logo URLs
- Exports helper functions: `getTeam(id)`, `getTeamColor(id)`, `getTeamLogo(id)`
- Exports groupings: `DIVISIONS`, `CONFERENCES`
- Logo URL pattern: `https://a.espncdn.com/i/teamlogos/nfl/500/{abbr}.png` — stable ESPN CDN URLs used across the nflverse analytics ecosystem
- Header comment with last-verified date and source reference

---

## 8. Content & Copy

### 8.1 Tone of Voice

Clean, confident, analytical — like FiveThirtyEight, not like NFL meme culture. No exclamation points, no hype language, no "BREAKING" energy. Let the data speak. The name "Yards Per Pass" sets the tone: precise, specific, no-nonsense.

### 8.2 Landing Page Copy

**Hero heading:** "NFL Analytics, Simplified."
**Hero subtitle:** "EPA, CPOE, success rate, and more — all in one clean dashboard. No paywalls. No clutter."

**Feature cards:**
- **Team Tiers** — "See where every NFL team ranks by offensive and defensive EPA — the gold standard of football analytics. One chart, total clarity."
- **QB Rankings** — "Sort quarterbacks by EPA, CPOE, success rate, and 10+ other metrics. Filter by minimum dropbacks and season."
- **More Coming** — "Player comparisons, game explorer, win probability charts, and AI-powered stat search. Built on trusted nflverse data."

**Footer attribution:** "Built on nflverse — open-source, peer-reviewed NFL analytics data." (Not just "Data sourced from nflverse" — this version is a trust signal.)

### 8.3 Metric Tooltips

**MetricTooltip.tsx** — a small info icon (circle-i) next to metric names. On hover/click, shows a popover with a plain-English definition. Used on QB Leaderboard column headers and scatter plot axis labels.

Definitions to include:

| Metric | Tooltip text |
|--------|-------------|
| EPA/Play | Expected Points Added per play across ALL plays (passing + rushing). The most complete measure of a QB's total value. Above 0 is good. |
| EPA/DB | EPA per dropback — passing plays only (attempts + sacks + scrambles). Isolates passing efficiency without rushing. Useful for comparing pure passers. |
| CPOE | Completion Percentage Over Expected. How often a QB completes passes compared to what's expected given the difficulty. Higher is better. |
| Comp% | Completion percentage — completions divided by pass attempts. The baseline that makes CPOE meaningful. |
| Success Rate | Percentage of plays that generate positive EPA (Expected Points Added). A "successful" play is one that improves the team's expected scoring position. |
| Sk | Sacks taken. Included in EPA/DB denominator — a QB who takes many sacks will have lower dropback EPA even if their completions are efficient. |
| Rush Att | Designed rush attempts (not scrambles — those are counted in dropbacks). Shows how often a QB runs by design. |
| aDOT | Average Depth of Target. How far downfield a QB throws on average. Higher = more aggressive. |
| YPA | Yards Per Attempt. Total passing yards divided by pass attempts (sacks excluded from denominator). |
| Passer Rating | Traditional NFL passer rating (scale 0-158.3). Combines completion %, yards, TDs, and INTs. The most familiar QB stat for casual fans, though EPA-based metrics are more predictive. |
| Off EPA/Play | Offensive EPA per play — how efficiently a team's offense generates expected points. |
| Def EPA/Play | Defensive EPA per play — how well a defense limits the opponent's expected points. Lower (more negative) is better. |

### 8.4 Scatter Plot Quadrant Descriptions

Each quadrant label includes a one-line description below it:

| Quadrant | Label | Description |
|----------|-------|-------------|
| Top-right | **Contenders** | "Elite on both sides of the ball" |
| Top-left | **Defense Carries** | "Strong defense, offense needs work" |
| Bottom-right | **Offense First** | "High-powered offense, defense needs work" |
| Bottom-left | **Bottom Feeders** | "Struggling on both sides" |

### 8.5 Per-Page SEO & Open Graph Tags

Each page exports Next.js `metadata` with unique title, description, and OG tags:

| Page | Title | Description |
|------|-------|-------------|
| Landing | "Yards Per Pass — NFL Analytics, Simplified" | "Free NFL analytics dashboard with EPA, CPOE, success rate, and more. Clean, fast, no paywall." |
| Team Tiers | "NFL Team Tiers {season} — Yards Per Pass" | "See where all 32 NFL teams rank by offensive and defensive EPA through Week {week}." |
| QB Leaderboard | "QB Rankings {season} — Yards Per Pass" | "NFL quarterback rankings by EPA, CPOE, success rate, and 10+ advanced metrics." |
OG images: For MVP, use a static branded image (Yards Per Pass wordmark on NFL navy background). Dynamic per-page OG images are a future enhancement.

---

## 9. Prerequisites & Blockers

These must be resolved before implementation begins:

### 9.1 Python 3.14 Compatibility

Jon is running Python 3.14.3, which is bleeding edge. `psycopg2-binary` and `pandas` may not have pre-built wheels for 3.14. **Action:** Test `pip install pandas pyarrow psycopg2-binary` on Python 3.14 as the very first step. If it fails, options are:
- (a) Install Python 3.12 alongside 3.14 and use it for the ingest script only
- (b) Use `psycopg` (pure Python, no binary dependency) instead of `psycopg2-binary`
- (c) Use `sqlalchemy` with a compatible driver

This is the highest-risk blocker. Test it before writing any other code.

### 9.2 GitHub Repository

Jon does not have `gh` CLI installed. Need to:
- Create a new GitHub repo (`yards-per-pass`) — can be done via github.com UI
- Clone it locally to the football website directory
- GitHub Actions (data-refresh, seed) require the repo to exist with secrets configured

### 9.3 Supabase Project

Jon has a Supabase account but needs a project created for this site. Steps:
- Create new Supabase project (name: `yards-per-pass`)
- Note the project URL, anon key, and database connection string
- These go into `.env.local` and GitHub Actions secrets

### 9.4 Domain & Hosting

- **Domain:** Confirm yardsperpass.com is available and purchase it (Namecheap, Google Domains, etc.)
- **Vercel:** Jon needs a Vercel account connected to his GitHub. Vercel's free tier is sufficient for MVP.
- **DNS:** Point yardsperpass.com to Vercel via their domain configuration

None of these block local development — they only block public deployment. Implementation can start without them.

---

## 10. Known Risks & Mitigations

### 10.1 Mobile Scatter Plot

32 team logos on a 375px phone screen will be unreadable. The D3 component must handle this:
- **Breakpoint:** Below 768px viewport width, switch to a simplified mobile view
- **Mobile approach:** Horizontal scrollable container with the chart rendered at desktop width (user can pan/pinch-zoom), OR a simplified sorted bar chart showing the same data in a linear format
- **Decision:** Implement horizontal scroll with pinch-to-zoom first (simpler, preserves the signature chart feel). If it's too clunky on real devices, swap to bar chart in a future pass.
- **Implementation note:** The D3 component should accept a `width` prop and re-render on resize via `ResizeObserver`.

### 10.2 NFL Intellectual Property

Using NFL team names, logos, and colors is standard for fan/analytics sites and is not a concern for the portfolio phase (B). However, if the site grows to a paid product (A), selling access to content built on NFL IP without a license is legally risky. **Mitigation:** If monetization is pursued, consult a sports IP attorney. Free-tier analytics sites (rbsdm.com, nfelo, etc.) operate without issue because they don't charge.

### 10.3 Data Accuracy Validation

Before launch, validate your numbers against rbsdm.com for at least one complete season (e.g., 2024). Compare team-level Off EPA/play and Def EPA/play for all 32 teams, and QB EPA/dropback for the top 10 QBs. **If your numbers don't match within ±0.001, investigate.** Someone on NFL Twitter WILL post a side-by-side comparison. The most likely sources of discrepancy:
- Using `passer_player_id IS NOT NULL` instead of `qb_dropback == 1` for dropbacks
- Including/excluding penalty plays differently
- Different handling of `no_play` rows where the result stood

**Mitigation:** Build a validation script that pulls the same season from your pipeline and compares key aggregates against known rbsdm.com values. Run it as part of the data pipeline CI.

### 10.4 Data Pipeline Reliability

The ingest script depends on nflverse publishing Parquet files to GitHub. If nflverse changes their release structure or file format, the pipeline breaks silently. **Mitigation:**
- The ingest script should validate that downloaded Parquet files contain expected columns before processing
- Log clear error messages if columns are missing
- GitHub Actions sends failure notifications via GitHub's built-in email alerts

---

## 11. Post-MVP Considerations

Not in scope for MVP, but should be added early in the product's life:

| Item | Why it matters | When to add |
|------|---------------|-------------|
| **Plausible Analytics** | Without analytics, you can't tell if anyone uses the site or which features matter | First week after launch ($9/mo) |
| **Testing: data pipeline** | Wrong EPA aggregation = wrong charts = damaged credibility. Unit tests on the ingest script's aggregation logic are high-value. | Before relying on automated weekly refreshes |
| **Testing: frontend** | Not critical for portfolio. If growing to A, add component tests for the scatter plot and leaderboard. | When adding Phase 2 features |
| **Dynamic OG images** | Static OG image is fine for launch. Dynamic per-page images (showing the actual chart) dramatically improve Twitter sharing. Use `@vercel/og`. | When social sharing becomes a priority |
| **Changelog page** | `/changelog` — shows what's new. Builds trust and shows momentum. | After 2-3 feature updates |

---

## 12. TypeScript Interfaces

```typescript
// lib/types/index.ts

export interface Team {
  id: string;
  name: string;
  abbreviation: string;
  division: string;
  conference: string;
  primaryColor: string;
  secondaryColor: string;
  logo: string;
}

export interface TeamSeasonStat {
  id: string;
  team_id: string;
  season: number;
  off_epa_play: number;
  def_epa_play: number;
  off_pass_epa: number;
  off_rush_epa: number;
  def_pass_epa: number;
  def_rush_epa: number;
  off_success_rate: number;
  def_success_rate: number;
  pass_rate: number;
  plays: number;
  wins: number;
  losses: number;
  ties: number;
}

export interface QBSeasonStat {
  id: string;
  player_id: string;
  player_name: string;
  team_id: string;
  season: number;
  games: number;
  completions: number;
  attempts: number;
  dropbacks: number;
  epa_per_db: number;        // EPA per dropback (passing only)
  epa_per_play: number;      // EPA per all plays (passing + rushing)
  cpoe: number;
  completion_pct: number;
  success_rate: number;
  passing_yards: number;
  touchdowns: number;
  interceptions: number;
  sacks: number;
  adot: number;
  ypa: number;
  passer_rating: number;
  rush_attempts: number;
  rush_yards: number;
  rush_tds: number;
  rush_epa_per_play: number; // EPA per designed rush
}

export interface DataFreshness {
  last_updated: string;
  season: number;
  through_week: number;
}
```

---

## 13. Environment Variables

```
# Supabase
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key

# Database (for Python ingest script)
DATABASE_URL=postgresql://postgres:password@db.your-project.supabase.co:5432/postgres

# Site
NEXT_PUBLIC_SITE_URL=https://yardsperpass.com
```

---

## 14. Future Expansion Path

These are explicitly **not in MVP scope** but the architecture supports them:

| Feature | What changes |
|---------|-------------|
| Player Comparison | New page + `players/page.tsx`, Recharts RadarChart, same Supabase data |
| Game Explorer | New page, add `plays` table (partitioned), WP line chart |
| Smart Search | API route + Anthropic API call, query builder against existing schema |
| Auth + Payments | Supabase Auth (already in stack), Stripe webhook routes |
| Social Export | `html2canvas` wrapper component, watermark overlay |
| Week-range filter | Add `week_start`/`week_end` to `team_season_stats`, update ingest |

No MVP code needs to be rewritten for any of these. They add pages and components; they don't change existing ones.

---

## 15. Decisions Log

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Sidebar vs Navbar | Top navbar only | 3 pages don't justify a sidebar; maximizes chart width; unanimous across all 3 review agents |
| Route groups vs flat | Flat + DashboardShell | Route groups add cognitive overhead for 3 pages; DashboardShell gives shared UI without framework complexity |
| D3 vs Recharts for scatter | D3.js (contained) | Scatter plot is the hero viz — needs full art direction for team logos, quadrants, social sharing; all D3 code stays in one component |
| teams.ts scope | Comprehensive | Every component depends on team data; wrong colors/logos kill credibility; one-time investment |
| `plays` table | Deferred | Millions of rows not needed for MVP; add when Game Explorer is built |
| Dark mode | Not included | Minimalist = one mode done well; NFL colors work best on white |
| Auth/payments | Deferred | No users to gate; add when product grows to "A" |
| Design direction | NFL colors, minimalist | Clean white/navy/red palette; diverges from original plan's dark/teal aesthetic |
| Content: metric tooltips | Included in MVP | Analytics jargon without explanation limits audience to NFL Twitter insiders only |
| Content: glossary page | **Cut** (PM decision) | New domain won't rank for glossary terms; MetricTooltip solves in-context education better |
| Content: quadrant descriptions | Included in MVP | One-line descriptions turn data into story |
| Content: per-page SEO/OG | Included in MVP | Dynamic titles/descriptions make shared links compelling |
| Content: tone | Clean/analytical (FiveThirtyEight style) | Matches the "Yards Per Pass" brand — precise, no hype |
| Logos | ESPN CDN (not self-hosted) | ESPN CDN has served logos reliably for 15+ years; fallback to colored circles if needed |
| `seasons` table | **Cut** (PM decision) | 6 integers derived from `SELECT DISTINCT season` — no table needed |
| `games` table | **Cut** (PM decision) | Zero consumers in MVP; add when Game Explorer is built |
| Success Rate definition | EPA-based (`epa > 0`) | Matches nflverse's `success` column; avoids nonstandard threshold debates |
| Scatter plot quadrant labels | "Defense Carries" replaces "Rebuilding" | Describes performance, not team intent — more analytically neutral |
| Mobile scatter plot | Sorted list on < 768px | 32 logos unreadable on phone; list view gives same insight natively |
| D3 SSR | `ssr: false` dynamic import | D3 accesses window/document; SSR will crash without this |
| Caching | `revalidate = 3600` on data pages | Data changes weekly; hourly revalidation prevents hammering Supabase |
| Chart watermark | "yardsperpass.com" on scatter plot | URL travels with screenshots — free marketing |
| QB multi-team seasons | Team with most attempts | Simplest approach; documented limitation |
| Completion % | Added to schema + leaderboard | Most basic QB stat; CPOE meaningless without comp% context |
| EPA/Play vs EPA/DB | Both columns in leaderboard | EPA/Play = total value (passing + rushing); EPA/DB = passing efficiency only. Users get the complete picture — mobile QBs like Lamar shine in EPA/Play while pocket passers may lead EPA/DB |
| QB rushing stats | Included in schema + leaderboard | In 2026, a QB leaderboard without rushing data is incomplete. Designed runs (not scrambles) tracked separately. Scrambles are already in dropbacks |
| Sacks column | Added to QB leaderboard | Sack EPA is in the denominator — users need to see sack counts to understand why a QB's dropback EPA is lower than their comp%/CPOE suggests |
| Dropback definition | `qb_dropback == 1` (not `passer_player_id IS NOT NULL`) | `qb_dropback` is the canonical nflverse flag. `passer_player_id` has edge cases (scrambles coded as runs) that cause numbers to drift ±0.002 from rbsdm.com |
| Data freshness display | Prominent pill badge on every data page | Mid-season, users must immediately see what week the data covers. Buried freshness info makes data useless |
| rbsdm.com validation | Required before launch | Someone WILL compare numbers. Pipeline must match rbsdm.com within ±0.001 for team EPA and top-10 QB EPA/dropback |
