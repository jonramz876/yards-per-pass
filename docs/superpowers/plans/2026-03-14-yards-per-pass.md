# Yards Per Pass Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build Yards Per Pass MVP — landing page, team tiers EPA scatter plot, QB leaderboard table, and automated nflverse data pipeline.

**Architecture:** Next.js 14 App Router with TypeScript for the frontend, Supabase PostgreSQL for data storage, D3.js for the hero scatter plot visualization, and a decoupled Python ETL pipeline consuming nflverse Parquet files via GitHub Actions cron.

**Tech Stack:** Next.js 14, TypeScript, Tailwind CSS, shadcn/ui, D3.js, Supabase (PostgreSQL), Python 3.x (pandas, pyarrow, psycopg2), GitHub Actions, Vercel

**Spec:** `docs/superpowers/specs/2026-03-14-yards-per-pass-design.md`

---

## Prerequisites (Manual — Jon must complete before implementation)

These are blocking prerequisites that require manual action:

1. **Test Python 3.14 compatibility** — Run `pip install pandas pyarrow psycopg2-binary` on Python 3.14. If `psycopg2-binary` fails, install Python 3.12 alongside and use it for the ingest script.
2. **Create Supabase project** — Go to supabase.com, create project named `yards-per-pass`. Note: project URL, anon key, and database connection string (DATABASE_URL).
3. **Create GitHub repo** — Create `yards-per-pass` repo on github.com (can use web UI since `gh` CLI isn't installed). Clone locally.
4. **Node.js** — Verify Node.js 18+ is installed: `node --version`

Domain purchase and Vercel setup do NOT block local development — handle those before deployment.

---

## Chunk 1: Project Foundation

### Task 1: Create Next.js Project

**Files:** New project directory with all scaffolding

- [ ] **Step 1: Scaffold the project**

```bash
cd "C:\Users\jonra\OneDrive\Desktop\claude sandbox\football website"
npx create-next-app@14 yards-per-pass --typescript --tailwind --eslint --app --no-src-dir --import-alias "@/*"
```

Answer the prompts: Yes to TypeScript, Yes to ESLint, Yes to Tailwind CSS, No to `src/` directory, Yes to App Router, Yes to default import alias.

- [ ] **Step 2: Install additional dependencies**

```bash
cd yards-per-pass
npm install @supabase/supabase-js@2.49.1 d3@7.9.0
npm install -D @types/d3@7.4.3
```

- [ ] **Step 3: Pin all dependency versions**

Open `package.json` and remove all `^` and `~` prefixes from every dependency version. For example, change `"next": "^14.2.20"` to `"next": "14.2.20"`. Do this for EVERY dependency in both `dependencies` and `devDependencies`.

- [ ] **Step 4: Verify the dev server starts**

```bash
npm run dev
```

Expected: Server running on `http://localhost:3000`. Visit in browser, see default Next.js page.

- [ ] **Step 5: Stop dev server (Ctrl+C)**

### Task 2: Configure Tailwind and Next.js

**Files:**
- Modify: `tailwind.config.ts`
- Modify: `next.config.ts` (or `next.config.mjs` — use whichever was created)

- [ ] **Step 1: Update tailwind.config.ts with NFL colors and Inter font**

```typescript
import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "class",
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        navy: "#013369",
        nflred: "#D50A0A",
      },
      fontFamily: {
        sans: ["var(--font-inter)", "sans-serif"],
      },
    },
  },
  plugins: [],
};

export default config;
```

- [ ] **Step 2: Update next.config with ESPN image domain**

```typescript
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "a.espncdn.com",
        pathname: "/i/teamlogos/**",
      },
    ],
  },
};

export default nextConfig;
```

- [ ] **Step 3: Update `app/globals.css` with base styles (NO Google Fonts import — using next/font instead)**

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

@layer base {
  body {
    @apply font-sans text-navy antialiased;
    font-feature-settings: "cv02", "cv03", "cv04", "cv11";
  }
}

@layer utilities {
  .tabular-nums {
    font-variant-numeric: tabular-nums;
  }
}
```

### Task 3: Initialize shadcn/ui

**Files:** Various files created by shadcn init

- [ ] **Step 1: Initialize shadcn**

```bash
npx shadcn@latest init
```

When prompted: choose "Default" style, "Slate" base color, CSS variables yes. If it asks about tailwind.config.ts, let it update.

- [ ] **Step 2: Add required components**

```bash
npx shadcn@latest add table select popover sheet
```

This creates component files in `components/ui/`. These are source files you own (not node_modules).

- [ ] **Step 3: Verify shadcn added `lib/utils.ts` with the `cn()` helper**

If not, create it:

```typescript
// lib/utils.ts
import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
```

### Task 4: TypeScript Type Definitions

**Files:**
- Create: `lib/types/index.ts`

- [ ] **Step 1: Create the types directory and file**

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
  epa_per_db: number;
  epa_per_play: number;
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
  rush_epa_per_play: number;
}

export interface DataFreshness {
  last_updated: string;
  season: number;
  through_week: number;
}
```

### Task 5: Teams Data File

**Files:**
- Create: `lib/data/teams.ts`

This is the runtime source of truth for all team metadata. The SQL `teams` table exists only for foreign keys. Components import from this file.

- [ ] **Step 1: Create the teams data file with all 32 NFL teams**

```typescript
// lib/data/teams.ts
// Last verified: 2026-03-14
// Source: Official NFL team colors + ESPN CDN logos

import type { Team } from "@/lib/types";

const espnLogo = (abbr: string) =>
  `https://a.espncdn.com/i/teamlogos/nfl/500/${abbr.toLowerCase()}.png`;

export const NFL_TEAMS: Team[] = [
  { id: 'ARI', name: 'Arizona Cardinals', abbreviation: 'ARI', division: 'NFC West', conference: 'NFC', primaryColor: '#97233F', secondaryColor: '#000000', logo: espnLogo('ari') },
  { id: 'ATL', name: 'Atlanta Falcons', abbreviation: 'ATL', division: 'NFC South', conference: 'NFC', primaryColor: '#A71930', secondaryColor: '#000000', logo: espnLogo('atl') },
  { id: 'BAL', name: 'Baltimore Ravens', abbreviation: 'BAL', division: 'AFC North', conference: 'AFC', primaryColor: '#241773', secondaryColor: '#000000', logo: espnLogo('bal') },
  { id: 'BUF', name: 'Buffalo Bills', abbreviation: 'BUF', division: 'AFC East', conference: 'AFC', primaryColor: '#00338D', secondaryColor: '#C60C30', logo: espnLogo('buf') },
  { id: 'CAR', name: 'Carolina Panthers', abbreviation: 'CAR', division: 'NFC South', conference: 'NFC', primaryColor: '#0085CA', secondaryColor: '#101820', logo: espnLogo('car') },
  { id: 'CHI', name: 'Chicago Bears', abbreviation: 'CHI', division: 'NFC North', conference: 'NFC', primaryColor: '#0B162A', secondaryColor: '#C83803', logo: espnLogo('chi') },
  { id: 'CIN', name: 'Cincinnati Bengals', abbreviation: 'CIN', division: 'AFC North', conference: 'AFC', primaryColor: '#FB4F14', secondaryColor: '#000000', logo: espnLogo('cin') },
  { id: 'CLE', name: 'Cleveland Browns', abbreviation: 'CLE', division: 'AFC North', conference: 'AFC', primaryColor: '#311D00', secondaryColor: '#FF3C00', logo: espnLogo('cle') },
  { id: 'DAL', name: 'Dallas Cowboys', abbreviation: 'DAL', division: 'NFC East', conference: 'NFC', primaryColor: '#041E42', secondaryColor: '#869397', logo: espnLogo('dal') },
  { id: 'DEN', name: 'Denver Broncos', abbreviation: 'DEN', division: 'AFC West', conference: 'AFC', primaryColor: '#FB4F14', secondaryColor: '#002244', logo: espnLogo('den') },
  { id: 'DET', name: 'Detroit Lions', abbreviation: 'DET', division: 'NFC North', conference: 'NFC', primaryColor: '#0076B6', secondaryColor: '#B0B7BC', logo: espnLogo('det') },
  { id: 'GB', name: 'Green Bay Packers', abbreviation: 'GB', division: 'NFC North', conference: 'NFC', primaryColor: '#203731', secondaryColor: '#FFB612', logo: espnLogo('gb') },
  { id: 'HOU', name: 'Houston Texans', abbreviation: 'HOU', division: 'AFC South', conference: 'AFC', primaryColor: '#03202F', secondaryColor: '#A71930', logo: espnLogo('hou') },
  { id: 'IND', name: 'Indianapolis Colts', abbreviation: 'IND', division: 'AFC South', conference: 'AFC', primaryColor: '#002C5F', secondaryColor: '#A2AAAD', logo: espnLogo('ind') },
  { id: 'JAX', name: 'Jacksonville Jaguars', abbreviation: 'JAX', division: 'AFC South', conference: 'AFC', primaryColor: '#006778', secondaryColor: '#9F792C', logo: espnLogo('jax') },
  { id: 'KC', name: 'Kansas City Chiefs', abbreviation: 'KC', division: 'AFC West', conference: 'AFC', primaryColor: '#E31837', secondaryColor: '#FFB81C', logo: espnLogo('kc') },
  { id: 'LAC', name: 'Los Angeles Chargers', abbreviation: 'LAC', division: 'AFC West', conference: 'AFC', primaryColor: '#0080C6', secondaryColor: '#FFC20E', logo: espnLogo('lac') },
  { id: 'LAR', name: 'Los Angeles Rams', abbreviation: 'LAR', division: 'NFC West', conference: 'NFC', primaryColor: '#003594', secondaryColor: '#FFA300', logo: espnLogo('lar') },
  { id: 'LV', name: 'Las Vegas Raiders', abbreviation: 'LV', division: 'AFC West', conference: 'AFC', primaryColor: '#000000', secondaryColor: '#A5ACAF', logo: espnLogo('lv') },
  { id: 'MIA', name: 'Miami Dolphins', abbreviation: 'MIA', division: 'AFC East', conference: 'AFC', primaryColor: '#008E97', secondaryColor: '#FC4C02', logo: espnLogo('mia') },
  { id: 'MIN', name: 'Minnesota Vikings', abbreviation: 'MIN', division: 'NFC North', conference: 'NFC', primaryColor: '#4F2683', secondaryColor: '#FFC62F', logo: espnLogo('min') },
  { id: 'NE', name: 'New England Patriots', abbreviation: 'NE', division: 'AFC East', conference: 'AFC', primaryColor: '#002244', secondaryColor: '#C60C30', logo: espnLogo('ne') },
  { id: 'NO', name: 'New Orleans Saints', abbreviation: 'NO', division: 'NFC South', conference: 'NFC', primaryColor: '#D3BC8D', secondaryColor: '#101820', logo: espnLogo('no') },
  { id: 'NYG', name: 'New York Giants', abbreviation: 'NYG', division: 'NFC East', conference: 'NFC', primaryColor: '#0B2265', secondaryColor: '#A71930', logo: espnLogo('nyg') },
  { id: 'NYJ', name: 'New York Jets', abbreviation: 'NYJ', division: 'AFC East', conference: 'AFC', primaryColor: '#125740', secondaryColor: '#000000', logo: espnLogo('nyj') },
  { id: 'PHI', name: 'Philadelphia Eagles', abbreviation: 'PHI', division: 'NFC East', conference: 'NFC', primaryColor: '#004C54', secondaryColor: '#A5ACAF', logo: espnLogo('phi') },
  { id: 'PIT', name: 'Pittsburgh Steelers', abbreviation: 'PIT', division: 'AFC North', conference: 'AFC', primaryColor: '#FFB612', secondaryColor: '#101820', logo: espnLogo('pit') },
  { id: 'SEA', name: 'Seattle Seahawks', abbreviation: 'SEA', division: 'NFC West', conference: 'NFC', primaryColor: '#002244', secondaryColor: '#69BE28', logo: espnLogo('sea') },
  { id: 'SF', name: 'San Francisco 49ers', abbreviation: 'SF', division: 'NFC West', conference: 'NFC', primaryColor: '#AA0000', secondaryColor: '#B3995D', logo: espnLogo('sf') },
  { id: 'TB', name: 'Tampa Bay Buccaneers', abbreviation: 'TB', division: 'NFC South', conference: 'NFC', primaryColor: '#D50A0A', secondaryColor: '#FF7900', logo: espnLogo('tb') },
  { id: 'TEN', name: 'Tennessee Titans', abbreviation: 'TEN', division: 'AFC South', conference: 'AFC', primaryColor: '#0C2340', secondaryColor: '#4B92DB', logo: espnLogo('ten') },
  { id: 'WAS', name: 'Washington Commanders', abbreviation: 'WAS', division: 'NFC East', conference: 'NFC', primaryColor: '#5A1414', secondaryColor: '#FFB612', logo: espnLogo('wsh') },
];

// Helper functions
export function getTeam(id: string): Team | undefined {
  return NFL_TEAMS.find((t) => t.id === id);
}

export function getTeamColor(id: string): string {
  return getTeam(id)?.primaryColor ?? "#6B7280";
}

export function getTeamLogo(id: string): string {
  return getTeam(id)?.logo ?? "";
}

// Groupings
export const DIVISIONS = [...new Set(NFL_TEAMS.map((t) => t.division))].sort();
export const CONFERENCES = ["AFC", "NFC"] as const;
```

- [ ] **Step 2: Verify all 32 teams are present and logos load**

Open a browser tab and test a few logo URLs manually:
- `https://a.espncdn.com/i/teamlogos/nfl/500/buf.png` — should show Bills logo
- `https://a.espncdn.com/i/teamlogos/nfl/500/kc.png` — should show Chiefs logo
- `https://a.espncdn.com/i/teamlogos/nfl/500/was.png` — should show Commanders logo

If any URL 404s, check the correct ESPN abbreviation and update the `espnLogo()` call for that team (some teams use different ESPN abbreviations — e.g., `wsh` instead of `was`).

### Task 6: Supabase Clients and Utilities

**Files:**
- Create: `lib/supabase/server.ts`
- Create: `lib/supabase/client.ts`
- Modify: `lib/utils.ts` (add `parseNumericFields`)

- [ ] **Step 1: Create server-side Supabase client**

```typescript
// lib/supabase/server.ts
import { createClient } from "@supabase/supabase-js";

export function createServerClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  return createClient(url, key);
}
```

- [ ] **Step 2: Create browser-side Supabase client**

```typescript
// lib/supabase/client.ts
// Browser-only singleton. Do NOT import this in server components — use lib/supabase/server.ts instead.

import { createClient } from "@supabase/supabase-js";

let client: ReturnType<typeof createClient> | null = null;

export function getSupabaseClient() {
  if (!client) {
    client = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );
  }
  return client;
}
```

- [ ] **Step 3: Add `parseNumericFields` to `lib/utils.ts`**

Supabase returns NUMERIC columns as strings. This utility parses them to numbers at the data-fetching layer so components never deal with strings.

```typescript
/** Parse Supabase NUMERIC fields (returned as strings) to JavaScript numbers */
export function parseNumericFields(
  row: Record<string, unknown>,
  fields: string[]
): Record<string, unknown> {
  const parsed = { ...row };
  for (const field of fields) {
    if (typeof parsed[field] === "string") {
      parsed[field] = parseFloat(parsed[field] as string);
    }
  }
  return parsed;
}
```

Add this function to the existing `lib/utils.ts` file (below the `cn()` function that shadcn created).

### Task 7: Environment Template and First Commit

**Files:**
- Create: `.env.local.example`
- Create: `.env.local` (from template, with real values)

- [ ] **Step 1: Create environment template**

```bash
# .env.local.example

# Supabase
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key

# Database (for Python ingest script only)
DATABASE_URL=postgresql://postgres:password@db.your-project.supabase.co:5432/postgres

# Site
NEXT_PUBLIC_SITE_URL=https://yardsperpass.com
```

- [ ] **Step 2: Create `.env.local` with real Supabase credentials**

Copy `.env.local.example` to `.env.local` and fill in the real values from the Supabase project dashboard.

- [ ] **Step 3: Verify `.gitignore` includes `.env.local`**

The `create-next-app` scaffolding should already have this. Verify:

```bash
grep ".env.local" .gitignore
```

Expected: `.env*.local` or `.env.local` in the output.

- [ ] **Step 4: Copy design docs into the project**

```bash
cp -r "../docs" ./docs
```

- [ ] **Step 5: Commit the foundation**

```bash
git add -A
git commit -m "feat: scaffold Next.js project with Tailwind, shadcn, Supabase, types, and teams data"
```

---

## Chunk 2: Database Schema and Data Pipeline

### Task 8: Database Schema SQL

**Files:**
- Create: `scripts/schema.sql`

This file is run manually in Supabase SQL Editor. It creates all tables, indexes, RLS policies.

- [ ] **Step 1: Create the schema SQL file**

```sql
-- scripts/schema.sql
-- Yards Per Pass — Database Schema
-- Run this in the Supabase SQL Editor (supabase.com → project → SQL Editor)

-- 1. Teams (32 rows, static reference data)
CREATE TABLE IF NOT EXISTS teams (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  division TEXT NOT NULL,
  conference TEXT NOT NULL,
  primary_color TEXT NOT NULL,
  secondary_color TEXT NOT NULL
);

-- 2. Team season stats (~192 rows: 32 teams × 6 seasons)
CREATE TABLE IF NOT EXISTS team_season_stats (
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

CREATE INDEX IF NOT EXISTS idx_team_season ON team_season_stats(season, team_id);

-- 3. QB season stats (~200 rows per season)
CREATE TABLE IF NOT EXISTS qb_season_stats (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id TEXT NOT NULL,
  player_name TEXT NOT NULL,
  team_id TEXT REFERENCES teams(id),
  season INTEGER NOT NULL,
  games INTEGER,
  completions INTEGER,
  attempts INTEGER,
  dropbacks INTEGER,
  epa_per_db NUMERIC,
  epa_per_play NUMERIC,
  cpoe NUMERIC,
  completion_pct NUMERIC,
  success_rate NUMERIC,
  passing_yards INTEGER,
  touchdowns INTEGER,
  interceptions INTEGER,
  sacks INTEGER,
  adot NUMERIC,
  ypa NUMERIC,
  passer_rating NUMERIC,
  rush_attempts INTEGER,
  rush_yards INTEGER,
  rush_tds INTEGER,
  rush_epa_per_play NUMERIC,
  UNIQUE(player_id, season)
);

CREATE INDEX IF NOT EXISTS idx_qb_season ON qb_season_stats(season);
CREATE INDEX IF NOT EXISTS idx_qb_player ON qb_season_stats(player_id);

-- 4. Data freshness (single row)
CREATE TABLE IF NOT EXISTS data_freshness (
  id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  last_updated TIMESTAMPTZ DEFAULT NOW(),
  season INTEGER,
  through_week INTEGER
);

INSERT INTO data_freshness (season, through_week)
VALUES (2025, 0)
ON CONFLICT (id) DO NOTHING;

-- 5. Row Level Security — anonymous read access
ALTER TABLE teams ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public_read" ON teams FOR SELECT USING (true);

ALTER TABLE team_season_stats ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public_read" ON team_season_stats FOR SELECT USING (true);

ALTER TABLE qb_season_stats ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public_read" ON qb_season_stats FOR SELECT USING (true);

ALTER TABLE data_freshness ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public_read" ON data_freshness FOR SELECT USING (true);
```

- [ ] **Step 2: Run the schema in Supabase**

Go to Supabase dashboard → SQL Editor → paste the entire file → Run. All tables should be created with zero errors.

- [ ] **Step 3: Verify tables exist**

In Supabase Table Editor, confirm: `teams`, `team_season_stats`, `qb_season_stats`, `data_freshness` all appear.

### Task 9: Python Ingest Script

**Files:**
- Create: `scripts/ingest.py`
- Create: `scripts/requirements.txt`

This is the most critical code for data accuracy. Every number on the site comes from this script.

- [ ] **Step 1: Create requirements.txt**

```
pandas==2.2.3
pyarrow==18.1.0
psycopg2-binary==2.9.10
python-dotenv==1.0.1
```

- [ ] **Step 2: Install Python dependencies**

```bash
pip install -r scripts/requirements.txt
```

If `psycopg2-binary` fails on Python 3.14, use `psycopg[binary]` instead (pure Python driver).

- [ ] **Step 3: Create the full ingest script**

```python
#!/usr/bin/env python3
"""nflverse → Supabase ETL pipeline for Yards Per Pass.

Downloads play-by-play and roster data from nflverse GitHub releases,
aggregates team and QB season stats, and upserts into Supabase PostgreSQL.
"""

import argparse
import os
import sys
from datetime import datetime, timezone

import pandas as pd
import psycopg2
from psycopg2.extras import execute_values
from dotenv import load_dotenv

load_dotenv()

# --- Constants ---
FIRST_SEASON = 2020
CURRENT_SEASON = 2025
PBP_URL = "https://github.com/nflverse/nflverse-data/releases/download/pbp/play_by_play_{season}.parquet"
ROSTER_URL = "https://github.com/nflverse/nflverse-data/releases/download/rosters/roster_weekly_{season}.parquet"

REQUIRED_PBP_COLS = [
    'play_type', 'season_type', 'two_point_attempt', 'epa', 'success',
    'posteam', 'defteam', 'pass_attempt', 'rush_attempt', 'qb_dropback',
    'passer_player_id', 'passer_player_name', 'rusher_player_id',
    'complete_pass', 'sack', 'qb_scramble', 'air_yards', 'yards_gained',
    'cpoe', 'passing_yards', 'pass_touchdown', 'interception',
    'rush_touchdown', 'rushing_yards', 'game_id', 'season', 'week',
    'home_team', 'away_team', 'result',
]


def passer_rating(comp: int, att: int, yds: int, td: int, ints: int) -> float:
    """NFL passer rating formula. Returns 0-158.3 scale."""
    if att == 0:
        return 0.0
    a = max(0.0, min(((comp / att) - 0.3) * 5, 2.375))
    b = max(0.0, min(((yds / att) - 3) * 0.25, 2.375))
    c = max(0.0, min((td / att) * 20, 2.375))
    d = max(0.0, min(2.375 - ((ints / att) * 25), 2.375))
    return round(((a + b + c + d) / 6) * 100, 1)


def download_pbp(season: int) -> pd.DataFrame:
    """Download play-by-play Parquet from nflverse."""
    url = PBP_URL.format(season=season)
    print(f"  Downloading PBP for {season}...")
    df = pd.read_parquet(url)
    missing = [c for c in REQUIRED_PBP_COLS if c not in df.columns]
    if missing:
        raise ValueError(f"Missing columns in PBP data: {missing}")
    return df


def download_roster(season: int) -> pd.DataFrame:
    """Download roster Parquet from nflverse."""
    url = ROSTER_URL.format(season=season)
    print(f"  Downloading roster for {season}...")
    return pd.read_parquet(url)


def filter_plays(pbp: pd.DataFrame) -> pd.DataFrame:
    """Filter to relevant plays: pass/run, regular season, no two-point attempts."""
    mask = (
        pbp['play_type'].isin(['pass', 'run']) &
        (pbp['season_type'] == 'REG') &
        (pbp['two_point_attempt'] != 1)
    )
    filtered = pbp[mask].copy()
    print(f"  Filtered to {len(filtered):,} plays (from {len(pbp):,} raw)")
    return filtered


def aggregate_team_stats(plays: pd.DataFrame, pbp: pd.DataFrame, season: int) -> pd.DataFrame:
    """Aggregate team-level season stats from filtered plays."""
    # Offensive stats
    off = plays.groupby('posteam').agg(
        off_epa_play=('epa', 'mean'),
        off_success_rate=('success', 'mean'),
        plays=('epa', 'count'),
    ).reset_index().rename(columns={'posteam': 'team_id'})

    # Pass/rush splits
    pass_plays = plays[plays['pass_attempt'] == 1]
    rush_plays = plays[plays['rush_attempt'] == 1]

    off_pass = pass_plays.groupby('posteam').agg(
        off_pass_epa=('epa', 'mean'),
    ).reset_index().rename(columns={'posteam': 'team_id'})

    off_rush = rush_plays.groupby('posteam').agg(
        off_rush_epa=('epa', 'mean'),
    ).reset_index().rename(columns={'posteam': 'team_id'})

    # Pass rate
    pass_rate = plays.groupby('posteam').apply(
        lambda x: x['pass_attempt'].sum() / len(x), include_groups=False
    ).reset_index().rename(columns={'posteam': 'team_id', 0: 'pass_rate'})

    # Defensive stats
    def_ = plays.groupby('defteam').agg(
        def_epa_play=('epa', 'mean'),
        def_success_rate=('success', 'mean'),
    ).reset_index().rename(columns={'defteam': 'team_id'})

    def_pass = pass_plays.groupby('defteam').agg(
        def_pass_epa=('epa', 'mean'),
    ).reset_index().rename(columns={'defteam': 'team_id'})

    def_rush = rush_plays.groupby('defteam').agg(
        def_rush_epa=('epa', 'mean'),
    ).reset_index().rename(columns={'defteam': 'team_id'})

    # Win/loss records from game results (use unfiltered pbp to ensure all games counted)
    game_results = (
        pbp[pbp['season_type'] == 'REG']
        .groupby('game_id')
        .first()[['home_team', 'away_team', 'result']]
        .dropna(subset=['result'])
        .reset_index()
    )

    home = game_results[['home_team', 'result']].rename(columns={'home_team': 'team_id'})
    home['wins'] = (home['result'] > 0).astype(int)
    home['losses'] = (home['result'] < 0).astype(int)
    home['ties'] = (home['result'] == 0).astype(int)

    away = game_results[['away_team', 'result']].rename(columns={'away_team': 'team_id'})
    away['wins'] = (away['result'] < 0).astype(int)
    away['losses'] = (away['result'] > 0).astype(int)
    away['ties'] = (away['result'] == 0).astype(int)

    records = pd.concat([
        home[['team_id', 'wins', 'losses', 'ties']],
        away[['team_id', 'wins', 'losses', 'ties']],
    ]).groupby('team_id').sum().reset_index()

    # Merge all
    team_stats = (
        off.merge(off_pass, on='team_id', how='left')
        .merge(off_rush, on='team_id', how='left')
        .merge(pass_rate, on='team_id', how='left')
        .merge(def_, on='team_id', how='left')
        .merge(def_pass, on='team_id', how='left')
        .merge(def_rush, on='team_id', how='left')
        .merge(records, on='team_id', how='left')
    )
    team_stats['season'] = season

    print(f"  Aggregated stats for {len(team_stats)} teams")
    return team_stats


def aggregate_qb_stats(plays: pd.DataFrame, roster: pd.DataFrame, season: int) -> pd.DataFrame:
    """Aggregate QB season stats from filtered plays."""
    # Identify QB player IDs from roster
    qb_ids = set(roster[roster['position'] == 'QB']['gsis_id'].dropna().unique())

    # --- Dropback stats (qb_dropback == 1) ---
    dropbacks = plays[plays['qb_dropback'] == 1].copy()

    # Fix scramble attribution: on scrambles, passer_player_id is often NULL
    # but rusher_player_id has the QB. Fill it in before the groupby.
    scramble_mask = dropbacks['qb_scramble'] == 1
    dropbacks.loc[scramble_mask, 'passer_player_id'] = (
        dropbacks.loc[scramble_mask, 'rusher_player_id']
    )

    qb_drop = dropbacks.groupby('passer_player_id').agg(
        player_name=('passer_player_name', 'first'),
        dropback_count=('game_id', 'count'),  # Use game_id (never NaN) not epa (can be NaN)
        dropback_epa_sum=('epa', 'sum'),
        completions=('complete_pass', 'sum'),
        sacks=('sack', 'sum'),
        scrambles=('qb_scramble', 'sum'),
        cpoe=('cpoe', lambda x: x.dropna().mean()),
        adot=('air_yards', lambda x: x.dropna().mean()),
        touchdowns=('pass_touchdown', 'sum'),
        interceptions=('interception', 'sum'),
        games=('game_id', 'nunique'),
        success_rate=('success', lambda x: x.dropna().mean()),
    ).reset_index().rename(columns={'passer_player_id': 'player_id'})

    # Pass attempts: use nflverse pass_attempt flag directly (excludes sacks AND scrambles)
    # pass_attempt == 1 only on true pass attempts (completions + incompletions + INTs)
    pass_attempts = dropbacks.groupby('passer_player_id')['pass_attempt'].sum().reset_index()
    pass_attempts.rename(columns={'passer_player_id': 'player_id', 'pass_attempt': 'attempts'}, inplace=True)
    qb_drop = qb_drop.merge(pass_attempts, on='player_id', how='left')
    qb_drop['attempts'] = qb_drop['attempts'].fillna(0).astype(int)

    # Passing yards: use nflverse passing_yards column on actual pass attempts only
    # pass_attempt == 1 excludes both sacks and scrambles
    actual_passes = dropbacks[dropbacks['pass_attempt'] == 1]
    pass_yards = actual_passes.groupby('passer_player_id')['passing_yards'].apply(
        lambda s: s.fillna(0).sum()
    )
    pass_yards = pass_yards.reset_index().rename(
        columns={'passer_player_id': 'player_id', 'passing_yards': 'passing_yards'}
    )
    qb_drop = qb_drop.merge(pass_yards, on='player_id', how='left')
    qb_drop['passing_yards'] = qb_drop['passing_yards'].fillna(0).astype(int)

    # Derived passing stats
    qb_drop['completion_pct'] = qb_drop.apply(
        lambda r: (r['completions'] / r['attempts'] * 100) if r['attempts'] > 0 else 0.0, axis=1
    )
    qb_drop['ypa'] = qb_drop.apply(
        lambda r: r['passing_yards'] / r['attempts'] if r['attempts'] > 0 else 0.0, axis=1
    )
    qb_drop['epa_per_db'] = qb_drop['dropback_epa_sum'] / qb_drop['dropback_count']

    # Passer rating from season totals
    qb_drop['passer_rating'] = qb_drop.apply(
        lambda r: passer_rating(
            int(r['completions']), int(r['attempts']),
            int(r['passing_yards']), int(r['touchdowns']), int(r['interceptions'])
        ), axis=1
    )

    # --- Designed rush stats (QB runs where qb_dropback == 0) ---
    designed_rushes = plays[
        (plays['rusher_player_id'].isin(qb_ids)) &
        (plays['qb_dropback'] == 0)
    ].copy()

    rush_stats = designed_rushes.groupby('rusher_player_id').agg(
        rush_attempts=('epa', 'count'),
        rush_epa_sum=('epa', 'sum'),
        rush_yards=('rushing_yards', 'sum'),
        rush_tds=('rush_touchdown', 'sum'),
    ).reset_index().rename(columns={'rusher_player_id': 'player_id'})

    # Scramble TDs: these have qb_dropback==1, qb_scramble==1, rush_touchdown==1
    # They are NOT counted in pass_touchdown or designed rush_tds, so we must add them
    scramble_tds = dropbacks[dropbacks['qb_scramble'] == 1].groupby('passer_player_id').agg(
        scramble_td_count=('rush_touchdown', 'sum'),
    ).reset_index().rename(columns={'passer_player_id': 'player_id'})

    # Merge dropback + rush + scramble TDs
    qb_stats = qb_drop.merge(rush_stats, on='player_id', how='left')
    qb_stats = qb_stats.merge(scramble_tds, on='player_id', how='left')
    qb_stats['rush_attempts'] = qb_stats['rush_attempts'].fillna(0).astype(int)
    qb_stats['rush_yards'] = qb_stats['rush_yards'].fillna(0).astype(int)
    qb_stats['rush_tds'] = qb_stats['rush_tds'].fillna(0).astype(int)
    qb_stats['rush_epa_sum'] = qb_stats['rush_epa_sum'].fillna(0)
    # Add scramble TDs into rush_tds (they are rushing TDs, just from dropback scrambles)
    qb_stats['rush_tds'] = qb_stats['rush_tds'] + qb_stats['scramble_td_count'].fillna(0).astype(int)

    # EPA per play (total: passing + rushing)
    total_plays = qb_stats['dropback_count'] + qb_stats['rush_attempts']
    total_epa = qb_stats['dropback_epa_sum'] + qb_stats['rush_epa_sum']
    qb_stats['epa_per_play'] = total_epa / total_plays.replace(0, float('nan'))

    # Rush EPA per play
    qb_stats['rush_epa_per_play'] = qb_stats.apply(
        lambda r: r['rush_epa_sum'] / r['rush_attempts'] if r['rush_attempts'] > 0 else None,
        axis=1
    )

    # Multi-team QBs: team with most pass attempts
    team_att = dropbacks.groupby(['passer_player_id', 'posteam']).size().reset_index(name='n')
    team_att = team_att.sort_values('n', ascending=False).drop_duplicates('passer_player_id')
    team_map = dict(zip(team_att['passer_player_id'], team_att['posteam']))
    qb_stats['team_id'] = qb_stats['player_id'].map(team_map)

    qb_stats['season'] = season
    qb_stats = qb_stats.rename(columns={'dropback_count': 'dropbacks'})

    # Select final columns
    cols = [
        'player_id', 'player_name', 'team_id', 'season', 'games',
        'completions', 'attempts', 'dropbacks', 'epa_per_db', 'epa_per_play',
        'cpoe', 'completion_pct', 'success_rate', 'passing_yards',
        'touchdowns', 'interceptions', 'sacks', 'adot', 'ypa', 'passer_rating',
        'rush_attempts', 'rush_yards', 'rush_tds', 'rush_epa_per_play',
    ]
    result = qb_stats[cols].copy()

    print(f"  Aggregated stats for {len(result)} QBs")
    return result


def upsert_teams(conn, teams_df: pd.DataFrame):
    """Seed ALL known teams for FK integrity — includes historical abbreviations."""
    TEAM_NAMES = {
        'ARI': ('Arizona Cardinals', 'NFC West', 'NFC', '#97233F', '#000000'),
        'ATL': ('Atlanta Falcons', 'NFC South', 'NFC', '#A71930', '#000000'),
        'BAL': ('Baltimore Ravens', 'AFC North', 'AFC', '#241773', '#000000'),
        'BUF': ('Buffalo Bills', 'AFC East', 'AFC', '#00338D', '#C60C30'),
        'CAR': ('Carolina Panthers', 'NFC South', 'NFC', '#0085CA', '#101820'),
        'CHI': ('Chicago Bears', 'NFC North', 'NFC', '#0B162A', '#C83803'),
        'CIN': ('Cincinnati Bengals', 'AFC North', 'AFC', '#FB4F14', '#000000'),
        'CLE': ('Cleveland Browns', 'AFC North', 'AFC', '#311D00', '#FF3C00'),
        'DAL': ('Dallas Cowboys', 'NFC East', 'NFC', '#041E42', '#869397'),
        'DEN': ('Denver Broncos', 'AFC West', 'AFC', '#FB4F14', '#002244'),
        'DET': ('Detroit Lions', 'NFC North', 'NFC', '#0076B6', '#B0B7BC'),
        'GB': ('Green Bay Packers', 'NFC North', 'NFC', '#203731', '#FFB612'),
        'HOU': ('Houston Texans', 'AFC South', 'AFC', '#03202F', '#A71930'),
        'IND': ('Indianapolis Colts', 'AFC South', 'AFC', '#002C5F', '#A2AAAD'),
        'JAX': ('Jacksonville Jaguars', 'AFC South', 'AFC', '#006778', '#9F792C'),
        'KC': ('Kansas City Chiefs', 'AFC West', 'AFC', '#E31837', '#FFB81C'),
        'LAC': ('Los Angeles Chargers', 'AFC West', 'AFC', '#0080C6', '#FFC20E'),
        'LAR': ('Los Angeles Rams', 'NFC West', 'NFC', '#003594', '#FFA300'),
        'LV': ('Las Vegas Raiders', 'AFC West', 'AFC', '#000000', '#A5ACAF'),
        'MIA': ('Miami Dolphins', 'AFC East', 'AFC', '#008E97', '#FC4C02'),
        'MIN': ('Minnesota Vikings', 'NFC North', 'NFC', '#4F2683', '#FFC62F'),
        'NE': ('New England Patriots', 'AFC East', 'AFC', '#002244', '#C60C30'),
        'NO': ('New Orleans Saints', 'NFC South', 'NFC', '#D3BC8D', '#101820'),
        'NYG': ('New York Giants', 'NFC East', 'NFC', '#0B2265', '#A71930'),
        'NYJ': ('New York Jets', 'AFC East', 'AFC', '#125740', '#000000'),
        'PHI': ('Philadelphia Eagles', 'NFC East', 'NFC', '#004C54', '#A5ACAF'),
        'PIT': ('Pittsburgh Steelers', 'AFC North', 'AFC', '#FFB612', '#101820'),
        'SEA': ('Seattle Seahawks', 'NFC West', 'NFC', '#002244', '#69BE28'),
        'SF': ('San Francisco 49ers', 'NFC West', 'NFC', '#AA0000', '#B3995D'),
        'TB': ('Tampa Bay Buccaneers', 'NFC South', 'NFC', '#D50A0A', '#FF7900'),
        'TEN': ('Tennessee Titans', 'AFC South', 'AFC', '#0C2340', '#4B92DB'),
        'WAS': ('Washington Commanders', 'NFC East', 'NFC', '#5A1414', '#FFB612'),
        # Historical abbreviations (nflverse uses these for pre-relocation seasons)
        'OAK': ('Oakland Raiders', 'AFC West', 'AFC', '#000000', '#A5ACAF'),
        'SD': ('San Diego Chargers', 'AFC West', 'AFC', '#002A5E', '#FFC20E'),
        'STL': ('St. Louis Rams', 'NFC West', 'NFC', '#002244', '#B3995D'),
    }
    # Seed all known teams unconditionally (not just current season's teams)
    rows = [
        (tid, name, div, conf, pc, sc)
        for tid, (name, div, conf, pc, sc) in TEAM_NAMES.items()
    ]
    if rows:
        with conn.cursor() as cur:
            execute_values(
                cur,
                """INSERT INTO teams (id, name, division, conference, primary_color, secondary_color)
                   VALUES %s
                   ON CONFLICT (id) DO UPDATE SET
                     name = EXCLUDED.name,
                     division = EXCLUDED.division,
                     conference = EXCLUDED.conference,
                     primary_color = EXCLUDED.primary_color,
                     secondary_color = EXCLUDED.secondary_color""",
                rows,
            )
        conn.commit()
        print(f"  Upserted {len(rows)} teams")


def upsert_team_stats(conn, df: pd.DataFrame):
    """Upsert team season stats."""
    cols = [
        'team_id', 'season', 'off_epa_play', 'def_epa_play',
        'off_pass_epa', 'off_rush_epa', 'def_pass_epa', 'def_rush_epa',
        'off_success_rate', 'def_success_rate', 'pass_rate', 'plays',
        'wins', 'losses', 'ties',
    ]
    rows = [tuple(r[c] for c in cols) for _, r in df.iterrows()]
    placeholders = ', '.join(['%s'] * len(cols))
    col_names = ', '.join(cols)
    update_set = ', '.join(f"{c} = EXCLUDED.{c}" for c in cols if c not in ('team_id', 'season'))

    with conn.cursor() as cur:
        execute_values(
            cur,
            f"""INSERT INTO team_season_stats ({col_names})
                VALUES %s
                ON CONFLICT (team_id, season) DO UPDATE SET {update_set}""",
            rows,
        )
    conn.commit()
    print(f"  Upserted {len(rows)} team season rows")


def upsert_qb_stats(conn, df: pd.DataFrame):
    """Upsert QB season stats."""
    cols = [
        'player_id', 'player_name', 'team_id', 'season', 'games',
        'completions', 'attempts', 'dropbacks', 'epa_per_db', 'epa_per_play',
        'cpoe', 'completion_pct', 'success_rate', 'passing_yards',
        'touchdowns', 'interceptions', 'sacks', 'adot', 'ypa', 'passer_rating',
        'rush_attempts', 'rush_yards', 'rush_tds', 'rush_epa_per_play',
    ]
    # Replace NaN with None for SQL NULL
    clean_df = df[cols].where(df[cols].notna(), None)
    rows = [tuple(r) for _, r in clean_df.iterrows()]
    col_names = ', '.join(cols)
    update_set = ', '.join(f"{c} = EXCLUDED.{c}" for c in cols if c not in ('player_id', 'season'))

    with conn.cursor() as cur:
        execute_values(
            cur,
            f"""INSERT INTO qb_season_stats ({col_names})
                VALUES %s
                ON CONFLICT (player_id, season) DO UPDATE SET {update_set}""",
            rows,
        )
    conn.commit()
    print(f"  Upserted {len(rows)} QB season rows")


def update_freshness(conn, season: int, through_week: int):
    """Update the data_freshness single-row table."""
    with conn.cursor() as cur:
        cur.execute(
            """INSERT INTO data_freshness (id, last_updated, season, through_week)
               VALUES (1, %s, %s, %s)
               ON CONFLICT (id) DO UPDATE SET
                 last_updated = EXCLUDED.last_updated,
                 season = EXCLUDED.season,
                 through_week = EXCLUDED.through_week""",
            (datetime.now(timezone.utc), season, through_week),
        )
    conn.commit()
    print(f"  Updated freshness: season={season}, through_week={through_week}")


def process_season(season: int, conn, dry_run: bool = False):
    """Full pipeline for one season."""
    print(f"\n{'='*50}")
    print(f"Processing season {season}")
    print(f"{'='*50}")

    pbp = download_pbp(season)
    roster = download_roster(season)
    plays = filter_plays(pbp)

    team_stats = aggregate_team_stats(plays, pbp, season)
    qb_stats = aggregate_qb_stats(plays, roster, season)
    through_week = int(plays['week'].max())

    if dry_run:
        print(f"\n  [DRY RUN] Would upsert:")
        print(f"    {len(team_stats)} team rows")
        print(f"    {len(qb_stats)} QB rows")
        print(f"    through_week={through_week}")
        return

    upsert_teams(conn, team_stats)
    upsert_team_stats(conn, team_stats)
    upsert_qb_stats(conn, qb_stats)
    update_freshness(conn, season, through_week)

    print(f"\n  ✓ Season {season} complete (through week {through_week})")


def main():
    parser = argparse.ArgumentParser(description="nflverse → Supabase ETL for Yards Per Pass")
    parser.add_argument('--season', type=int, help='Process a single season')
    parser.add_argument('--all', action='store_true', help=f'Process all seasons ({FIRST_SEASON}-{CURRENT_SEASON})')
    parser.add_argument('--dry-run', action='store_true', help='Preview without writing to database')
    args = parser.parse_args()

    if not args.season and not args.all:
        parser.error("Specify --season YEAR or --all")

    seasons = list(range(FIRST_SEASON, CURRENT_SEASON + 1)) if args.all else [args.season]

    conn = None
    if not args.dry_run:
        db_url = os.environ.get('DATABASE_URL')
        if not db_url:
            print("ERROR: DATABASE_URL not set. Add it to .env or environment.", file=sys.stderr)
            sys.exit(1)
        conn = psycopg2.connect(db_url)

    try:
        for season in seasons:
            process_season(season, conn, dry_run=args.dry_run)
    finally:
        if conn:
            conn.close()

    print("\nDone!")


if __name__ == '__main__':
    main()
```

- [ ] **Step 4: Test the dry-run mode**

```bash
python scripts/ingest.py --season 2024 --dry-run
```

Expected: Downloads PBP and roster Parquets, prints filtering stats, aggregation counts, and "Would upsert: N team rows, M QB rows" without touching the database.

- [ ] **Step 5: Run a real ingest for one season**

```bash
python scripts/ingest.py --season 2024
```

Expected: Downloads data, aggregates, upserts into Supabase. Check the Supabase Table Editor to confirm `team_season_stats` has 32 rows for 2024 and `qb_season_stats` has ~150-200 rows.

- [ ] **Step 6: Spot-check accuracy against rbsdm.com**

Go to [rbsdm.com](https://rbsdm.com) and compare a few values for the 2024 season:
- KC offensive EPA/play — should match within ±0.001
- BUF defensive EPA/play — should match within ±0.001
- Top QB EPA/dropback — should match within ±0.002

If numbers don't match, the most likely causes are:
1. Play filtering differences (check `no_play` handling)
2. Penalty play inclusion/exclusion
3. `qb_dropback` vs `passer_player_id` discrepancy

### Task 10: GitHub Actions Workflows

**Files:**
- Create: `.github/workflows/data-refresh.yml`
- Create: `.github/workflows/seed.yml`

- [ ] **Step 1: Create the weekly data refresh workflow**

```yaml
# .github/workflows/data-refresh.yml
name: Weekly Data Refresh

on:
  schedule:
    - cron: '0 11 * * 3'  # Every Wednesday at 11:00 AM UTC (after MNF data is published)
  workflow_dispatch:
    inputs:
      season:
        description: 'Season to refresh (default: current)'
        required: false
        default: '2025'

jobs:
  refresh:
    runs-on: ubuntu-latest
    timeout-minutes: 30
    steps:
      - uses: actions/checkout@v4

      - name: Set up Python
        uses: actions/setup-python@v5
        with:
          python-version: '3.12'

      - name: Cache pip dependencies
        uses: actions/cache@v4
        with:
          path: ~/.cache/pip
          key: ${{ runner.os }}-pip-${{ hashFiles('scripts/requirements.txt') }}
          restore-keys: |
            ${{ runner.os }}-pip-

      - name: Install dependencies
        run: pip install -r scripts/requirements.txt

      - name: Resolve season
        id: vars
        run: echo "season=${{ github.event.inputs.season || '2025' }}" >> $GITHUB_OUTPUT

      - name: Run ingest
        env:
          DATABASE_URL: ${{ secrets.DATABASE_URL }}
        run: python scripts/ingest.py --season "${{ steps.vars.outputs.season }}"
```

- [ ] **Step 2: Create the one-time seed workflow**

```yaml
# .github/workflows/seed.yml
name: Seed Historical Data

on:
  workflow_dispatch:
    inputs:
      seasons:
        description: 'Comma-separated seasons to load'
        required: false
        default: '2020,2021,2022,2023,2024,2025'

jobs:
  seed:
    runs-on: ubuntu-latest
    timeout-minutes: 180
    steps:
      - uses: actions/checkout@v4

      - name: Set up Python
        uses: actions/setup-python@v5
        with:
          python-version: '3.12'

      - name: Cache pip dependencies
        uses: actions/cache@v4
        with:
          path: ~/.cache/pip
          key: ${{ runner.os }}-pip-${{ hashFiles('scripts/requirements.txt') }}
          restore-keys: |
            ${{ runner.os }}-pip-

      - name: Install dependencies
        run: pip install -r scripts/requirements.txt

      - name: Seed each season
        env:
          DATABASE_URL: ${{ secrets.DATABASE_URL }}
        run: |
          IFS=',' read -ra SEASONS <<< "${{ github.event.inputs.seasons }}"
          FAILED=()
          for season in "${SEASONS[@]}"; do
            echo "Processing season $season..."
            if ! python scripts/ingest.py --season "$season"; then
              echo "::warning::Season $season failed"
              FAILED+=("$season")
            fi
          done
          if [ ${#FAILED[@]} -gt 0 ]; then
            echo "::error::Failed seasons: ${FAILED[*]}"
            exit 1
          fi
```

- [ ] **Step 3: Commit the pipeline**

```bash
git add scripts/ .github/
git commit -m "feat: add nflverse data pipeline with GitHub Actions automation"
```

---

## Chunk 3: Layout and Landing Page

### Task 11: Root Layout

**Files:**
- Modify: `app/layout.tsx`

- [ ] **Step 1: Update the root layout with Inter font, metadata, and global structure**

```typescript
// app/layout.tsx
import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });

export const metadata: Metadata = {
  title: {
    default: "Yards Per Pass — NFL Analytics, Simplified",
    template: "%s — Yards Per Pass",
  },
  description:
    "Free NFL analytics dashboard with EPA, CPOE, success rate, and more. Clean, fast, no paywall.",
  openGraph: {
    type: "website",
    siteName: "Yards Per Pass",
    locale: "en_US",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={inter.variable}>
      <body className="min-h-screen bg-white">
        {children}
      </body>
    </html>
  );
}
```

Note: Inter font is loaded via `next/font/google` for zero layout shift and optimal Core Web Vitals. The `--font-inter` CSS variable is referenced in `tailwind.config.ts`.

### Task 12: Navbar Component

**Files:**
- Create: `components/layout/Navbar.tsx`

- [ ] **Step 1: Create the navbar with wordmark and page links**

```typescript
// components/layout/Navbar.tsx
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";

const NAV_LINKS = [
  { href: "/teams", label: "Team Tiers" },
  { href: "/qb-leaderboard", label: "QB Rankings" },
];

export default function Navbar() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  return (
    <nav className="sticky top-0 z-50 bg-white border-b border-gray-200">
      <div className="max-w-6xl mx-auto px-6 md:px-12 h-16 flex items-center justify-between">
        {/* Wordmark */}
        <Link href="/" className="text-xl font-extrabold tracking-tight text-navy">
          YARDS PER <span className="text-nflred">PASS</span>
        </Link>

        {/* Desktop links */}
        <div className="hidden md:flex items-center gap-8">
          {NAV_LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={`text-sm font-medium transition-colors ${
                pathname === link.href
                  ? "text-navy font-semibold"
                  : "text-gray-500 hover:text-navy"
              }`}
            >
              {link.label}
            </Link>
          ))}
        </div>

        {/* Mobile hamburger */}
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetTrigger asChild className="md:hidden">
            <button className="p-2" aria-label="Open menu">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="3" y1="6" x2="21" y2="6" />
                <line x1="3" y1="12" x2="21" y2="12" />
                <line x1="3" y1="18" x2="21" y2="18" />
              </svg>
            </button>
          </SheetTrigger>
          <SheetContent side="right" className="w-64">
            <div className="flex flex-col gap-4 mt-8">
              {NAV_LINKS.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  onClick={() => setOpen(false)}
                  className={`text-lg font-medium ${
                    pathname === link.href ? "text-navy" : "text-gray-500"
                  }`}
                >
                  {link.label}
                </Link>
              ))}
            </div>
          </SheetContent>
        </Sheet>
      </div>
    </nav>
  );
}
```

### Task 13: Footer Component

**Files:**
- Create: `components/layout/Footer.tsx`

- [ ] **Step 1: Create the minimal footer**

```typescript
// components/layout/Footer.tsx
export default function Footer() {
  return (
    <footer className="border-t border-gray-200 bg-white py-8">
      <div className="max-w-6xl mx-auto px-6 md:px-12 text-center text-sm text-gray-500">
        Built on{" "}
        <a
          href="https://github.com/nflverse"
          target="_blank"
          rel="noopener noreferrer"
          className="underline hover:text-navy"
        >
          nflverse
        </a>{" "}
        — open-source, peer-reviewed NFL analytics data.
        <span className="block mt-1">
          &copy; 2026 Yards Per Pass
        </span>
      </div>
    </footer>
  );
}
```

### Task 14: Landing Page

**Files:**
- Modify: `app/page.tsx`

- [ ] **Step 1: Replace the default page with the landing page**

```typescript
// app/page.tsx
import Link from "next/link";
import Navbar from "@/components/layout/Navbar";
import Footer from "@/components/layout/Footer";

export default function HomePage() {
  return (
    <>
      <Navbar />
      <main>
        {/* Hero */}
        <section className="max-w-4xl mx-auto px-6 md:px-12 pt-24 pb-16 text-center">
          <h1 className="text-4xl md:text-6xl font-extrabold text-navy tracking-tight leading-tight">
            NFL Analytics, Simplified.
          </h1>
          <p className="mt-4 text-lg text-gray-500 max-w-xl mx-auto">
            EPA, CPOE, success rate, and more — all in one clean dashboard. No paywalls. No clutter.
          </p>
          <div className="mt-8 flex flex-col sm:flex-row gap-4 justify-center">
            <Link
              href="/teams"
              className="inline-flex items-center justify-center px-6 py-3 bg-nflred text-white font-semibold rounded-md hover:bg-red-700 transition-colors"
            >
              Explore Team Tiers
            </Link>
            <Link
              href="/qb-leaderboard"
              className="inline-flex items-center justify-center px-6 py-3 border-2 border-navy text-navy font-semibold rounded-md hover:bg-navy hover:text-white transition-colors"
            >
              QB Leaderboard
            </Link>
          </div>
        </section>

        {/* Feature cards */}
        <section className="bg-gray-50 py-16">
          <div className="max-w-6xl mx-auto px-6 md:px-12 grid grid-cols-1 md:grid-cols-3 gap-8">
            <FeatureCard
              title="Team Tiers"
              description="See where every NFL team ranks by offensive and defensive EPA — the gold standard of football analytics. One chart, total clarity."
              icon="📊"
            />
            <FeatureCard
              title="QB Rankings"
              description="Sort quarterbacks by EPA, CPOE, success rate, and 10+ other metrics. Filter by minimum dropbacks and season."
              icon="🏈"
            />
            <FeatureCard
              title="More Coming"
              description="Player comparisons, game explorer, win probability charts, and AI-powered stat search. Built on trusted nflverse data."
              icon="🔮"
            />
          </div>
        </section>
      </main>
      <Footer />
    </>
  );
}

function FeatureCard({
  title,
  description,
  icon,
}: {
  title: string;
  description: string;
  icon: string;
}) {
  return (
    <div className="bg-white p-6 rounded-md border border-gray-200">
      <div className="text-3xl mb-4">{icon}</div>
      <h3 className="text-lg font-bold text-navy mb-2">{title}</h3>
      <p className="text-sm text-gray-500 leading-relaxed">{description}</p>
    </div>
  );
}
```

- [ ] **Step 2: Verify in browser**

```bash
npm run dev
```

Visit `http://localhost:3000`. You should see:
- Sticky navbar with "YARDS PER PASS" wordmark (PASS in red)
- Hero section with heading, subtitle, two CTA buttons
- Three feature cards on gray background
- Footer with nflverse attribution

- [ ] **Step 3: Commit**

```bash
git add app/ components/layout/
git commit -m "feat: add navbar, footer, and landing page"
```

---

## Chunk 4: Dashboard Infrastructure

### Task 15: Data-Fetching Functions

**Files:**
- Create: `lib/data/queries.ts`

Server-side functions that fetch from Supabase and parse NUMERIC strings to numbers. These are called by page server components.

- [ ] **Step 1: Create the data-fetching module**

```typescript
// lib/data/queries.ts
import { createServerClient } from "@/lib/supabase/server";
import { parseNumericFields } from "@/lib/utils";
import type { TeamSeasonStat, QBSeasonStat, DataFreshness } from "@/lib/types";

const TEAM_NUMERIC_FIELDS = [
  'off_epa_play', 'def_epa_play', 'off_pass_epa', 'off_rush_epa',
  'def_pass_epa', 'def_rush_epa', 'off_success_rate', 'def_success_rate',
  'pass_rate',
];

const QB_NUMERIC_FIELDS = [
  'epa_per_db', 'epa_per_play', 'cpoe', 'completion_pct', 'success_rate',
  'adot', 'ypa', 'passer_rating', 'rush_epa_per_play',
];

export async function getTeamStats(season: number): Promise<TeamSeasonStat[]> {
  const supabase = createServerClient();
  const { data, error } = await supabase
    .from('team_season_stats')
    .select('*')
    .eq('season', season);

  if (error) throw new Error(`Failed to fetch team stats: ${error.message}`);
  if (!data) return [];

  return data.map((row) =>
    parseNumericFields(row, TEAM_NUMERIC_FIELDS) as unknown as TeamSeasonStat
  );
}

export async function getQBStats(season: number): Promise<QBSeasonStat[]> {
  const supabase = createServerClient();
  const { data, error } = await supabase
    .from('qb_season_stats')
    .select('*')
    .eq('season', season);

  if (error) throw new Error(`Failed to fetch QB stats: ${error.message}`);
  if (!data) return [];

  return data.map((row) =>
    parseNumericFields(row, QB_NUMERIC_FIELDS) as unknown as QBSeasonStat
  );
}

export async function getDataFreshness(): Promise<DataFreshness | null> {
  const supabase = createServerClient();
  const { data, error } = await supabase
    .from('data_freshness')
    .select('*')
    .single();

  if (error) return null;
  return data as DataFreshness;
}

export async function getAvailableSeasons(): Promise<number[]> {
  const supabase = createServerClient();
  const { data, error } = await supabase
    .from('team_season_stats')
    .select('season')
    .order('season', { ascending: false });

  if (error) return [];
  return [...new Set((data || []).map((r: { season: number }) => r.season))];
}
```

### Task 16: DashboardShell and SeasonSelect

**Files:**
- Create: `components/layout/DashboardShell.tsx`
- Create: `components/ui/SeasonSelect.tsx`

- [ ] **Step 1: Create the SeasonSelect dropdown**

```typescript
// components/ui/SeasonSelect.tsx
"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";

interface SeasonSelectProps {
  seasons: number[];
  currentSeason: number;
}

export default function SeasonSelect({ seasons, currentSeason }: SeasonSelectProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function handleChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("season", e.target.value);
    router.push(`${pathname}?${params.toString()}`);
  }

  return (
    <select
      value={currentSeason}
      onChange={handleChange}
      className="px-3 py-1.5 text-sm border border-gray-200 rounded-md bg-white text-navy font-medium focus:outline-none focus:ring-2 focus:ring-navy/20"
    >
      {seasons.map((s) => (
        <option key={s} value={s}>
          {s} Season
        </option>
      ))}
    </select>
  );
}
```

- [ ] **Step 2: Create the DashboardShell wrapper**

```typescript
// components/layout/DashboardShell.tsx
// SERVER COMPONENT — do NOT add 'use client'. SeasonSelect (client) is
// wrapped in Suspense to handle useSearchParams() static rendering requirements.
import { Suspense } from "react";
import type { DataFreshness } from "@/lib/types";
import SeasonSelect from "@/components/ui/SeasonSelect";

interface DashboardShellProps {
  title: string;
  seasons: number[];
  currentSeason: number;
  freshness: DataFreshness | null;
  children: React.ReactNode;
}

export default function DashboardShell({
  title,
  seasons,
  currentSeason,
  freshness,
  children,
}: DashboardShellProps) {
  const freshnessText = freshness
    ? `${freshness.season} Season · Through Week ${freshness.through_week} · Updated ${new Date(freshness.last_updated).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`
    : null;

  return (
    <div className="max-w-6xl mx-auto px-6 md:px-12 py-8">
      {/* Header row: title + controls */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
        <div className="flex items-center gap-4">
          <h1 className="text-2xl font-extrabold text-navy tracking-tight">{title}</h1>
          {freshnessText && (
            <span className="inline-flex items-center px-3 py-1 text-xs font-medium text-navy bg-blue-50 rounded-full">
              {freshnessText}
            </span>
          )}
        </div>
        {/* CRITICAL: useSearchParams() in SeasonSelect requires Suspense boundary */}
        <Suspense fallback={
          <select className="px-3 py-1.5 text-sm border border-gray-200 rounded-md bg-white text-navy font-medium" disabled>
            <option>{currentSeason} Season</option>
          </select>
        }>
          <SeasonSelect seasons={seasons} currentSeason={currentSeason} />
        </Suspense>
      </div>

      {/* Page content */}
      {children}
    </div>
  );
}
```

### Task 17: MetricTooltip Component

**Files:**
- Create: `components/ui/MetricTooltip.tsx`

- [ ] **Step 1: Create the tooltip with all metric definitions**

```typescript
// components/ui/MetricTooltip.tsx
"use client";

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

const METRIC_DEFINITIONS: Record<string, string> = {
  "EPA/Play":
    "Expected Points Added per play across ALL plays (passing + rushing). The most complete measure of a QB's total value. Above 0 is good.",
  "EPA/DB":
    "EPA per dropback — passing plays only (attempts + sacks + scrambles). Isolates passing efficiency without rushing. Useful for comparing pure passers.",
  "CPOE":
    "Completion Percentage Over Expected. How often a QB completes passes compared to what's expected given the difficulty. Higher is better.",
  "Comp%":
    "Completion percentage — completions divided by pass attempts. The baseline that makes CPOE meaningful.",
  "Success%":
    "Percentage of dropbacks that generate positive EPA. A 'successful' play is one that improves the team's expected scoring position.",
  "Sk":
    "Sacks taken. Included in EPA/DB denominator — a QB who takes many sacks will have lower dropback EPA even if their completions are efficient.",
  "Rush Att":
    "Designed rush attempts (not scrambles — those are counted in dropbacks). Shows how often a QB runs by design.",
  "aDOT":
    "Average Depth of Target. How far downfield a QB throws on average. Higher = more aggressive.",
  "YPA":
    "Yards Per Attempt. Total passing yards divided by pass attempts (sacks excluded from denominator).",
  "Rating":
    "Traditional NFL passer rating (scale 0-158.3). Combines completion %, yards, TDs, and INTs. The most familiar QB stat for casual fans, though EPA-based metrics are more predictive.",
  "Off EPA/Play":
    "Offensive EPA per play — how efficiently a team's offense generates expected points.",
  "Def EPA/Play":
    "Defensive EPA per play — how well a defense limits the opponent's expected points. Lower (more negative) is better.",
};

interface MetricTooltipProps {
  metric: string;
}

export default function MetricTooltip({ metric }: MetricTooltipProps) {
  const definition = METRIC_DEFINITIONS[metric];
  if (!definition) return null;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          className="inline-flex items-center justify-center w-4 h-4 ml-1 text-gray-400 hover:text-navy rounded-full border border-gray-300 text-[10px] font-bold leading-none align-middle"
          aria-label={`What is ${metric}?`}
        >
          i
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-72 text-sm text-gray-600 leading-relaxed" side="top">
        <p className="font-semibold text-navy mb-1">{metric}</p>
        <p>{definition}</p>
      </PopoverContent>
    </Popover>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add lib/data/queries.ts components/layout/DashboardShell.tsx components/ui/SeasonSelect.tsx components/ui/MetricTooltip.tsx
git commit -m "feat: add data-fetching layer, DashboardShell, SeasonSelect, and MetricTooltip"
```

---

## Chunk 5: Team Tiers Page

### Task 18: TeamScatterPlot D3 Component

**Files:**
- Create: `components/charts/TeamScatterPlot.tsx`

This is the hero visualization. ALL D3 code is contained in this one file. The `useEffect` MUST return a cleanup function to prevent React strict mode from creating duplicate chart elements.

- [ ] **Step 1: Create the D3 scatter plot component**

```typescript
// components/charts/TeamScatterPlot.tsx
"use client";

import { useRef, useEffect, useState } from "react";
import * as d3 from "d3";
import type { TeamSeasonStat, Team } from "@/lib/types";
import { getTeam, getTeamColor } from "@/lib/data/teams";

interface TeamScatterPlotProps {
  data: TeamSeasonStat[];
  teams: Team[];
}

// Quadrant config
const QUADRANTS = [
  { key: "contenders", label: "Contenders", desc: "Elite on both sides of the ball", color: "rgba(34,197,94,0.06)" },
  { key: "defense", label: "Defense Carries", desc: "Strong defense, offense needs work", color: "rgba(234,179,8,0.06)" },
  { key: "offense_first", label: "Offense First", desc: "High-powered offense, defense needs work", color: "rgba(234,179,8,0.06)" },
  { key: "bottom", label: "Bottom Feeders", desc: "Struggling on both sides", color: "rgba(239,68,68,0.06)" },
];

export default function TeamScatterPlot({ data, teams }: TeamScatterPlotProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ width: 800, height: 560 });

  // ResizeObserver for responsive width
  useEffect(() => {
    if (!containerRef.current) return;
    const observer = new ResizeObserver((entries) => {
      const { width } = entries[0].contentRect;
      setDimensions({ width: Math.max(400, width), height: 560 });
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  // D3 rendering
  useEffect(() => {
    if (!svgRef.current || !data.length) return;

    const svg = d3.select(svgRef.current);
    // CRITICAL: cleanup for React strict mode
    svg.selectAll("*").remove();

    const margin = { top: 50, right: 50, bottom: 60, left: 65 };
    const width = dimensions.width - margin.left - margin.right;
    const height = dimensions.height - margin.top - margin.bottom;

    const g = svg
      .attr("width", dimensions.width)
      .attr("height", dimensions.height)
      .append("g")
      .attr("transform", `translate(${margin.left},${margin.top})`);

    // Symmetric scale around 0
    const xVals = data.map((d) => d.off_epa_play);
    const yVals = data.map((d) => d.def_epa_play);
    const maxAbsX = Math.max(...xVals.map(Math.abs)) * 1.2;
    const maxAbsY = Math.max(...yVals.map(Math.abs)) * 1.2;

    const x = d3.scaleLinear().domain([-maxAbsX, maxAbsX]).range([0, width]);
    // Defense: more negative EPA = better defense = TOP of chart
    // CRITICAL: domain is [positive, negative] so negative values map to y=0 (top)
    const y = d3.scaleLinear().domain([maxAbsY, -maxAbsY]).range([height, 0]);

    // Quadrant backgrounds
    // Top-right: good offense (x>0) + good defense (def_epa<0, mapped to top)
    g.append("rect").attr("x", x(0)).attr("y", 0).attr("width", width - x(0)).attr("height", y(0))
      .attr("fill", QUADRANTS[0].color); // Contenders
    g.append("rect").attr("x", 0).attr("y", 0).attr("width", x(0)).attr("height", y(0))
      .attr("fill", QUADRANTS[1].color); // Defense Carries
    g.append("rect").attr("x", x(0)).attr("y", y(0)).attr("width", width - x(0)).attr("height", height - y(0))
      .attr("fill", QUADRANTS[2].color); // Offense First
    g.append("rect").attr("x", 0).attr("y", y(0)).attr("width", x(0)).attr("height", height - y(0))
      .attr("fill", QUADRANTS[3].color); // Bottom Feeders

    // Crosshair lines at 0,0
    g.append("line").attr("x1", 0).attr("x2", width).attr("y1", y(0)).attr("y2", y(0))
      .attr("stroke", "#CBD5E1").attr("stroke-width", 1).attr("stroke-dasharray", "6,4");
    g.append("line").attr("x1", x(0)).attr("x2", x(0)).attr("y1", 0).attr("y2", height)
      .attr("stroke", "#CBD5E1").attr("stroke-width", 1).attr("stroke-dasharray", "6,4");

    // Quadrant labels
    const labelStyle = { fontSize: "11px", fontWeight: "700", fill: "#94A3B8" };
    const descStyle = { fontSize: "9px", fontWeight: "400", fill: "#94A3B8" };

    g.append("text").attr("x", x(maxAbsX * 0.55)).attr("y", 20).attr("text-anchor", "middle")
      .style("font-size", labelStyle.fontSize).style("font-weight", labelStyle.fontWeight).style("fill", labelStyle.fill)
      .text("Contenders");
    g.append("text").attr("x", x(maxAbsX * 0.55)).attr("y", 33).attr("text-anchor", "middle")
      .style("font-size", descStyle.fontSize).style("fill", descStyle.fill)
      .text("Elite on both sides of the ball");

    g.append("text").attr("x", x(-maxAbsX * 0.55)).attr("y", 20).attr("text-anchor", "middle")
      .style("font-size", labelStyle.fontSize).style("font-weight", labelStyle.fontWeight).style("fill", labelStyle.fill)
      .text("Defense Carries");
    g.append("text").attr("x", x(-maxAbsX * 0.55)).attr("y", 33).attr("text-anchor", "middle")
      .style("font-size", descStyle.fontSize).style("fill", descStyle.fill)
      .text("Strong defense, offense needs work");

    g.append("text").attr("x", x(maxAbsX * 0.55)).attr("y", height - 15).attr("text-anchor", "middle")
      .style("font-size", labelStyle.fontSize).style("font-weight", labelStyle.fontWeight).style("fill", labelStyle.fill)
      .text("Offense First");
    g.append("text").attr("x", x(maxAbsX * 0.55)).attr("y", height - 3).attr("text-anchor", "middle")
      .style("font-size", descStyle.fontSize).style("fill", descStyle.fill)
      .text("High-powered offense, defense needs work");

    g.append("text").attr("x", x(-maxAbsX * 0.55)).attr("y", height - 15).attr("text-anchor", "middle")
      .style("font-size", labelStyle.fontSize).style("font-weight", labelStyle.fontWeight).style("fill", labelStyle.fill)
      .text("Bottom Feeders");
    g.append("text").attr("x", x(-maxAbsX * 0.55)).attr("y", height - 3).attr("text-anchor", "middle")
      .style("font-size", descStyle.fontSize).style("fill", descStyle.fill)
      .text("Struggling on both sides");

    // Axes
    const xAxis = d3.axisBottom(x).ticks(8).tickFormat((d) => d3.format("+.2f")(d as number));
    const yAxis = d3.axisLeft(y).ticks(8).tickFormat((d) => d3.format("+.2f")(d as number));

    g.append("g").attr("transform", `translate(0,${height})`).call(xAxis)
      .selectAll("text").style("font-size", "10px").style("fill", "#6B7280");
    g.append("g").call(yAxis)
      .selectAll("text").style("font-size", "10px").style("fill", "#6B7280");

    // Axis labels
    g.append("text").attr("x", width / 2).attr("y", height + 45).attr("text-anchor", "middle")
      .style("font-size", "12px").style("font-weight", "600").style("fill", "#374151")
      .text("Offensive EPA/Play →");
    g.append("text").attr("transform", "rotate(-90)").attr("x", -height / 2).attr("y", -50)
      .attr("text-anchor", "middle")
      .style("font-size", "12px").style("font-weight", "600").style("fill", "#374151")
      .text("← Better Defense (Def EPA/Play)");

    // Y-axis annotation explaining inverted defense axis
    g.append("text").attr("x", 5).attr("y", -8)
      .style("font-size", "9px").style("fill", "#94A3B8").style("font-style", "italic")
      .text("Note: Negative defensive EPA = better defense (axis inverted)");

    // Pre-compute ranks for hover tooltip
    const ordinal = (n: number) => n + (["th","st","nd","rd"][(n%100-20)%10] || ["th","st","nd","rd"][n%100] || "th");
    const offRanks = new Map(
      [...data].sort((a, b) => b.off_epa_play - a.off_epa_play).map((d, i) => [d.team_id, i + 1])
    );
    const defRanks = new Map(
      [...data].sort((a, b) => a.def_epa_play - b.def_epa_play).map((d, i) => [d.team_id, i + 1])
    );

    // Tooltip div
    const tooltip = d3.select(tooltipRef.current);

    // Team logos
    const logoSize = 32;
    const logoGroup = g.selectAll(".team-logo")
      .data(data)
      .enter()
      .append("g")
      .attr("class", "team-logo")
      .attr("transform", (d) => `translate(${x(d.off_epa_play) - logoSize / 2},${y(d.def_epa_play) - logoSize / 2})`)
      .style("cursor", "pointer");

    // Add logo images with fallback
    logoGroup.each(function (d) {
      const group = d3.select(this);
      const team = getTeam(d.team_id);
      if (!team) return;

      const img = group.append("image")
        .attr("width", logoSize)
        .attr("height", logoSize)
        .attr("href", team.logo)
        .attr("clip-path", "circle(16px at 16px 16px)");

      // Fallback: colored circle with abbreviation
      img.on("error", function () {
        d3.select(this).remove();
        group.append("circle")
          .attr("cx", logoSize / 2).attr("cy", logoSize / 2).attr("r", 14)
          .attr("fill", getTeamColor(d.team_id));
        group.append("text")
          .attr("x", logoSize / 2).attr("y", logoSize / 2 + 4)
          .attr("text-anchor", "middle").attr("fill", "white")
          .style("font-size", "9px").style("font-weight", "700")
          .text(d.team_id);
      });
    });

    // Hover behavior
    logoGroup
      .on("mouseenter", function (event, d) {
        d3.select(this).raise().transition().duration(150)
          .attr("transform", `translate(${x(d.off_epa_play) - logoSize * 0.7},${y(d.def_epa_play) - logoSize * 0.7}) scale(1.4)`);
        const team = getTeam(d.team_id);
        tooltip
          .style("opacity", "1")
          .style("left", `${event.clientX + 12}px`)
          .style("top", `${event.clientY - 28}px`)
          .html(`
            <div class="font-semibold text-navy">${team?.name ?? d.team_id}</div>
            <div class="text-xs text-gray-500 mt-1">
              Off EPA: ${d.off_epa_play.toFixed(3)} (${ordinal(offRanks.get(d.team_id) ?? 0)})<br/>
              Def EPA: ${d.def_epa_play.toFixed(3)} (${ordinal(defRanks.get(d.team_id) ?? 0)})<br/>
              Record: ${d.wins}-${d.losses}${d.ties > 0 ? `-${d.ties}` : ""}
            </div>
          `);
      })
      .on("mouseleave", function (_, d) {
        d3.select(this).transition().duration(150)
          .attr("transform", `translate(${x(d.off_epa_play) - logoSize / 2},${y(d.def_epa_play) - logoSize / 2}) scale(1)`);
        tooltip.style("opacity", "0");
      });

    // Watermark
    g.append("text")
      .attr("x", width - 5).attr("y", height - 5)
      .attr("text-anchor", "end")
      .style("font-size", "11px").style("fill", "#D1D5DB").style("font-weight", "500")
      .text("yardsperpass.com");

    // Cleanup function — CRITICAL for React strict mode
    return () => {
      svg.selectAll("*").remove();
    };
  }, [data, teams, dimensions]);

  return (
    <div ref={containerRef} className="relative w-full bg-white border border-gray-200 rounded-md">
      <svg ref={svgRef} className="w-full" />
      <div
        ref={tooltipRef}
        className="fixed z-50 bg-white px-3 py-2 rounded-md shadow-lg border border-gray-200 pointer-events-none opacity-0 transition-opacity"
        style={{ maxWidth: 220 }}
      />
    </div>
  );
}
```

### Task 19: Mobile Team List Fallback

**Files:**
- Create: `components/charts/MobileTeamList.tsx`

- [ ] **Step 1: Create the mobile fallback list view**

```typescript
// components/charts/MobileTeamList.tsx
"use client";

import type { TeamSeasonStat } from "@/lib/types";
import { getTeam, getTeamColor } from "@/lib/data/teams";

interface MobileTeamListProps {
  data: TeamSeasonStat[];
}

function getQuadrant(d: TeamSeasonStat): { label: string; order: number } {
  const goodOff = d.off_epa_play > 0;
  const goodDef = d.def_epa_play < 0;
  if (goodOff && goodDef) return { label: "Contenders", order: 0 };
  if (!goodOff && goodDef) return { label: "Defense Carries", order: 1 };
  if (goodOff && !goodDef) return { label: "Offense First", order: 2 };
  return { label: "Bottom Feeders", order: 3 };
}

export default function MobileTeamList({ data }: MobileTeamListProps) {
  // Sort by composite EPA (off - def, since lower def is better)
  const sorted = [...data].sort(
    (a, b) => (b.off_epa_play - b.def_epa_play) - (a.off_epa_play - a.def_epa_play)
  );

  // Group by quadrant
  const grouped = sorted.reduce((acc, team) => {
    const q = getQuadrant(team);
    if (!acc[q.label]) acc[q.label] = { order: q.order, teams: [] };
    acc[q.label].teams.push(team);
    return acc;
  }, {} as Record<string, { order: number; teams: TeamSeasonStat[] }>);

  const sections = Object.entries(grouped).sort(([, a], [, b]) => a.order - b.order);

  return (
    <div className="space-y-6">
      {sections.map(([label, { teams }]) => (
        <div key={label}>
          <h3 className="text-sm font-bold text-navy uppercase tracking-wide mb-2">{label}</h3>
          <div className="space-y-1">
            {teams.map((t) => {
              const team = getTeam(t.team_id);
              return (
                <div key={t.team_id} className="flex items-center gap-3 py-2 px-3 bg-gray-50 rounded-md">
                  <div
                    className="w-3 h-3 rounded-full flex-shrink-0"
                    style={{ backgroundColor: getTeamColor(t.team_id) }}
                  />
                  <span className="text-sm font-medium text-navy flex-1">
                    {team?.name ?? t.team_id}
                  </span>
                  <span className="text-xs text-gray-500 tabular-nums">
                    {t.wins}-{t.losses}{t.ties > 0 ? `-${t.ties}` : ""}
                  </span>
                  <span className="text-xs tabular-nums font-medium" style={{
                    color: t.off_epa_play > 0 ? "#16A34A" : "#DC2626"
                  }}>
                    Off: {t.off_epa_play > 0 ? "+" : ""}{t.off_epa_play.toFixed(3)}
                  </span>
                  <span className="text-xs tabular-nums font-medium" style={{
                    color: t.def_epa_play < 0 ? "#16A34A" : "#DC2626"
                  }}>
                    Def: {t.def_epa_play > 0 ? "+" : ""}{t.def_epa_play.toFixed(3)}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
```

### Task 20: Teams Page with Loading and Error States

**Files:**
- Create: `app/teams/page.tsx`
- Create: `app/teams/loading.tsx`
- Create: `app/teams/error.tsx`

- [ ] **Step 1: Create the teams page (server component)**

```typescript
// app/teams/page.tsx
import dynamic from "next/dynamic";
import type { Metadata } from "next";
import Navbar from "@/components/layout/Navbar";
import Footer from "@/components/layout/Footer";
import DashboardShell from "@/components/layout/DashboardShell";
import MobileTeamList from "@/components/charts/MobileTeamList";
import { getTeamStats, getDataFreshness, getAvailableSeasons } from "@/lib/data/queries";
import { NFL_TEAMS } from "@/lib/data/teams";

// CRITICAL: D3 accesses window/document — must disable SSR
const TeamScatterPlot = dynamic(
  () => import("@/components/charts/TeamScatterPlot"),
  { ssr: false }
);

export const revalidate = 3600; // Revalidate hourly

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<{ season?: string }>;
}): Promise<Metadata> {
  const { season } = await searchParams;
  const s = season || "2025";
  return {
    title: `NFL Team Tiers ${s}`,
    description: `See where all 32 NFL teams rank by offensive and defensive EPA for the ${s} season.`,
  };
}

export default async function TeamsPage({
  searchParams,
}: {
  searchParams: Promise<{ season?: string }>;
}) {
  const { season } = await searchParams;
  const seasons = await getAvailableSeasons();
  const currentSeason = season ? parseInt(season) : (seasons[0] || 2025);
  const [teamStats, freshness] = await Promise.all([
    getTeamStats(currentSeason),
    getDataFreshness(),
  ]);

  return (
    <>
      <Navbar />
      <DashboardShell
        title="Team Tiers"
        seasons={seasons}
        currentSeason={currentSeason}
        freshness={freshness}
      >
        {teamStats.length === 0 ? (
          <div className="text-center py-16 text-gray-500">
            No data available for the {currentSeason} season yet.
          </div>
        ) : (
          <>
            {/* Desktop: D3 scatter plot */}
            <div className="hidden md:block">
              <TeamScatterPlot data={teamStats} teams={NFL_TEAMS} />
            </div>
            {/* Mobile: sorted list */}
            <div className="md:hidden">
              <MobileTeamList data={teamStats} />
            </div>
          </>
        )}
      </DashboardShell>
      <Footer />
    </>
  );
}
```

- [ ] **Step 2: Create loading state**

```typescript
// app/teams/loading.tsx
export default function TeamsLoading() {
  return (
    <div className="max-w-6xl mx-auto px-6 md:px-12 py-8">
      <div className="h-8 w-48 bg-gray-200 rounded animate-pulse mb-6" />
      <div className="w-full h-[560px] bg-gray-100 rounded-md border border-gray-200 flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-navy border-t-transparent rounded-full animate-spin" />
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Create error boundary**

```typescript
// app/teams/error.tsx
"use client";

export default function TeamsError({ reset }: { reset: () => void }) {
  return (
    <div className="max-w-6xl mx-auto px-6 md:px-12 py-16 text-center">
      <h2 className="text-xl font-bold text-navy mb-2">Unable to load data</h2>
      <p className="text-gray-500 mb-6">Please try again later.</p>
      <button
        onClick={reset}
        className="px-4 py-2 bg-navy text-white rounded-md hover:bg-navy/90 transition-colors"
      >
        Try again
      </button>
    </div>
  );
}
```

- [ ] **Step 4: Verify in browser**

```bash
npm run dev
```

Visit `http://localhost:3000/teams`. You should see:
- DashboardShell with "Team Tiers" title, freshness badge, season dropdown
- D3 scatter plot with team logos positioned by Off/Def EPA
- Four colored quadrants with labels and descriptions
- Hover a team logo: scales up 1.4x, tooltip shows team name + EPA + record
- "yardsperpass.com" watermark in bottom-right
- Resize browser to < 768px: scatter plot replaced with sorted team list

If no data appears, verify Supabase credentials in `.env.local` and that the ingest script was run for the selected season.

- [ ] **Step 5: Commit**

```bash
git add components/charts/ app/teams/
git commit -m "feat: add Team Tiers page with D3 scatter plot and mobile fallback"
```

---

## Chunk 6: QB Leaderboard, SEO, and Final Polish

### Task 21: QBLeaderboard Component

**Files:**
- Create: `components/tables/QBLeaderboard.tsx`

- [ ] **Step 1: Create the sortable QB leaderboard table**

```typescript
// components/tables/QBLeaderboard.tsx
"use client";

import { useState, useMemo } from "react";
import type { QBSeasonStat } from "@/lib/types";
import { getTeamColor } from "@/lib/data/teams";
import MetricTooltip from "@/components/ui/MetricTooltip";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";

interface QBLeaderboardProps {
  data: QBSeasonStat[];
  throughWeek: number;
}

const COLUMNS = [
  { key: "games", label: "GP", group: "core" },
  { key: "epa_per_play", label: "EPA/Play", tooltip: "EPA/Play", group: "core" },
  { key: "epa_per_db", label: "EPA/DB", tooltip: "EPA/DB", group: "core" },
  { key: "completion_pct", label: "Comp%", tooltip: "Comp%", group: "passing" },
  { key: "attempts", label: "Att", group: "passing" },
  { key: "cpoe", label: "CPOE", tooltip: "CPOE", group: "passing" },
  { key: "success_rate", label: "Success%", tooltip: "Success%", group: "passing" },
  { key: "passing_yards", label: "Yards", group: "passing" },
  { key: "touchdowns", label: "TD", group: "passing" },
  { key: "interceptions", label: "INT", group: "passing" },
  { key: "sacks", label: "Sk", tooltip: "Sk", group: "passing", hideMobile: true },
  { key: "rush_attempts", label: "Rush Att", tooltip: "Rush Att", group: "rushing", hideMobile: true },
  { key: "rush_yards", label: "Rush Yds", group: "rushing", hideMobile: true },
  { key: "rush_tds", label: "Rush TD", group: "rushing", hideMobile: true },
  { key: "adot", label: "aDOT", tooltip: "aDOT", group: "efficiency", hideMobile: true },
  { key: "ypa", label: "YPA", tooltip: "YPA", group: "efficiency" },
  { key: "passer_rating", label: "Rating", tooltip: "Rating", group: "efficiency" },
] as const;

type SortKey = typeof COLUMNS[number]['key'];
type SortDir = "asc" | "desc";

// Header background tints for column groups (spec: passing | rushing | efficiency)
// "core" columns (GP, EPA/Play, EPA/DB) use same bg-navy as #/Player/Team
const GROUP_COLORS: Record<string, string> = {
  core: "bg-navy",
  passing: "bg-navy/[0.92]",
  rushing: "bg-navy/[0.85]",
  efficiency: "bg-navy/[0.78]",
};

export default function QBLeaderboard({ data, throughWeek }: QBLeaderboardProps) {
  const [sortKey, setSortKey] = useState<SortKey>("epa_per_play");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [search, setSearch] = useState("");
  const [minDropbacks, setMinDropbacks] = useState(() =>
    Math.max(50, Math.round(200 * (throughWeek / 18)))
  );

  const filtered = useMemo(() => {
    let result = data.filter((qb) => qb.dropbacks >= minDropbacks);
    if (search) {
      const term = search.toLowerCase();
      result = result.filter((qb) => qb.player_name.toLowerCase().includes(term));
    }
    result.sort((a, b) => {
      const aVal = a[sortKey] as number;
      const bVal = b[sortKey] as number;
      return sortDir === "desc" ? bVal - aVal : aVal - bVal;
    });
    return result;
  }, [data, sortKey, sortDir, search, minDropbacks]);

  function handleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  }

  function formatVal(key: string, val: unknown): string {
    if (val == null) return "—";
    const n = val as number;
    switch (key) {
      case "epa_per_play":
      case "epa_per_db":
      case "cpoe":
      case "adot":
      case "ypa":
        return n.toFixed(2);
      case "completion_pct":
      case "success_rate":
        return n.toFixed(1);
      case "passer_rating":
        return n.toFixed(1);
      default:
        return Number.isInteger(n) ? n.toString() : n.toFixed(1);
    }
  }

  function epaColor(val: number): string {
    return val > 0 ? "text-green-600" : val < 0 ? "text-red-600" : "text-gray-700";
  }

  return (
    <div>
      {/* Controls bar */}
      <div className="flex flex-col sm:flex-row gap-4 mb-4">
        <input
          type="text"
          placeholder="Search players..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="px-3 py-2 text-sm border border-gray-200 rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-navy/20 w-full sm:w-64"
        />
        <div className="flex items-center gap-3">
          <label className="text-sm text-gray-500 whitespace-nowrap">
            Min dropbacks: <span className="font-semibold text-navy">{minDropbacks}</span>
          </label>
          <input
            type="range"
            min={50}
            max={500}
            step={10}
            value={minDropbacks}
            onChange={(e) => setMinDropbacks(parseInt(e.target.value))}
            className="w-32"
          />
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto border border-gray-200 rounded-md">
        <table className="w-full text-sm">
          <thead>
            <tr>
              <th className="bg-navy text-white px-3 py-2.5 text-left text-xs font-semibold sticky left-0 z-20">#</th>
              <th className="bg-navy text-white px-3 py-2.5 text-left text-xs font-semibold min-w-[160px] sticky left-[40px] z-20">Player</th>
              <th className="bg-navy text-white px-3 py-2.5 text-left text-xs font-semibold">Team</th>
              {COLUMNS.map((col) => (
                <th
                  key={col.key}
                  onClick={() => handleSort(col.key)}
                  className={`${sortKey === col.key ? "bg-navy/60" : GROUP_COLORS[col.group]} text-white px-3 py-2.5 text-right text-xs font-semibold cursor-pointer hover:bg-navy/70 transition-colors whitespace-nowrap ${col.hideMobile ? "hidden sm:table-cell" : ""}`}
                >
                  <span className="inline-flex items-center gap-0.5">
                    {col.label}
                    {col.tooltip && <MetricTooltip metric={col.tooltip} />}
                    {sortKey === col.key && (
                      <span className="ml-1">{sortDir === "desc" ? "▼" : "▲"}</span>
                    )}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={COLUMNS.length + 3} className="text-center py-12 text-gray-500">
                  {search ? "No players match your search." : "No data available."}
                </td>
              </tr>
            ) : (
              filtered.map((qb, idx) => (
                <tr key={qb.player_id} className="group border-t border-gray-100 hover:bg-gray-50/50 transition-colors">
                  <td className="px-3 py-2 text-gray-400 font-bold tabular-nums sticky left-0 z-10 bg-white group-hover:bg-gray-50/50">{idx + 1}</td>
                  <td className="px-3 py-2 sticky left-[40px] z-10 bg-white group-hover:bg-gray-50/50">
                    <div className="flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: getTeamColor(qb.team_id) }} />
                      <span className="font-semibold text-navy">{qb.player_name}</span>
                    </div>
                  </td>
                  <td className="px-3 py-2 text-gray-500 text-xs">{qb.team_id}</td>
                  {COLUMNS.map((col) => {
                    const val = qb[col.key as keyof typeof qb];
                    const isEpa = col.key === "epa_per_play" || col.key === "epa_per_db";
                    return (
                      <td
                        key={col.key}
                        className={`px-3 py-2 text-right tabular-nums ${
                          isEpa ? `font-bold ${epaColor(val as number)}` : "text-gray-700"
                        } ${col.hideMobile ? "hidden sm:table-cell" : ""}`}
                      >
                        {formatVal(col.key, val)}
                      </td>
                    );
                  })}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <p className="mt-2 text-xs text-gray-400">
        Showing {filtered.length} of {data.length} quarterbacks with ≥{minDropbacks} dropbacks
      </p>
    </div>
  );
}
```

### Task 22: QB Leaderboard Page

**Files:**
- Create: `app/qb-leaderboard/page.tsx`
- Create: `app/qb-leaderboard/loading.tsx`
- Create: `app/qb-leaderboard/error.tsx`

- [ ] **Step 1: Create the QB Leaderboard page (server component)**

```typescript
// app/qb-leaderboard/page.tsx
import type { Metadata } from "next";
import Navbar from "@/components/layout/Navbar";
import Footer from "@/components/layout/Footer";
import DashboardShell from "@/components/layout/DashboardShell";
import QBLeaderboard from "@/components/tables/QBLeaderboard";
import { getQBStats, getDataFreshness, getAvailableSeasons } from "@/lib/data/queries";

export const revalidate = 3600;

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<{ season?: string }>;
}): Promise<Metadata> {
  const { season } = await searchParams;
  const s = season || "2025";
  return {
    title: `QB Rankings ${s}`,
    description: `NFL quarterback rankings by EPA, CPOE, success rate, and 10+ advanced metrics for the ${s} season.`,
  };
}

export default async function QBLeaderboardPage({
  searchParams,
}: {
  searchParams: Promise<{ season?: string }>;
}) {
  const { season } = await searchParams;
  const seasons = await getAvailableSeasons();
  const currentSeason = season ? parseInt(season) : (seasons[0] || 2025);
  const [qbStats, freshness] = await Promise.all([
    getQBStats(currentSeason),
    getDataFreshness(),
  ]);

  return (
    <>
      <Navbar />
      <DashboardShell
        title="QB Rankings"
        seasons={seasons}
        currentSeason={currentSeason}
        freshness={freshness}
      >
        {qbStats.length === 0 ? (
          <div className="text-center py-16 text-gray-500">
            No data available for the {currentSeason} season yet.
          </div>
        ) : (
          <QBLeaderboard
            data={qbStats}
            throughWeek={freshness?.through_week ?? 18}
          />
        )}
      </DashboardShell>
      <Footer />
    </>
  );
}
```

- [ ] **Step 2: Create loading state**

```typescript
// app/qb-leaderboard/loading.tsx
export default function QBLoading() {
  return (
    <div className="max-w-6xl mx-auto px-6 md:px-12 py-8">
      <div className="h-8 w-48 bg-gray-200 rounded animate-pulse mb-6" />
      <div className="space-y-2">
        {Array.from({ length: 10 }).map((_, i) => (
          <div key={i} className="h-10 bg-gray-100 rounded animate-pulse" />
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Create error boundary**

```typescript
// app/qb-leaderboard/error.tsx
"use client";

export default function QBError({ reset }: { reset: () => void }) {
  return (
    <div className="max-w-6xl mx-auto px-6 md:px-12 py-16 text-center">
      <h2 className="text-xl font-bold text-navy mb-2">Unable to load data</h2>
      <p className="text-gray-500 mb-6">Please try again later.</p>
      <button
        onClick={reset}
        className="px-4 py-2 bg-navy text-white rounded-md hover:bg-navy/90 transition-colors"
      >
        Try again
      </button>
    </div>
  );
}
```

- [ ] **Step 4: Verify in browser**

Visit `http://localhost:3000/qb-leaderboard`. You should see:
- DashboardShell with "QB Rankings" title, freshness badge, season dropdown
- Controls bar with search input and dropbacks slider
- Sortable table with all columns: EPA/Play, EPA/DB, GP, Comp%, CPOE, Success%, Yards, TD, INT, Sk, Rush Att, Rush Yds, Rush TD, aDOT, YPA, Rating
- EPA columns are green (positive) or red (negative) and bold
- Click any column header to sort (toggle asc/desc)
- Type in search to filter by name
- Adjust dropbacks slider to change minimum threshold
- Column group headers have slightly different navy tints
- Metric tooltips appear on hover over the (i) icons

- [ ] **Step 5: Commit**

```bash
git add components/tables/ app/qb-leaderboard/
git commit -m "feat: add QB Leaderboard page with sortable table, search, and dropbacks filter"
```

### Task 23: Final Verification and Polish

- [ ] **Step 1: Run the build to verify no TypeScript or build errors**

```bash
npm run build
```

Expected: Build completes successfully with zero errors. Warnings are OK.

- [ ] **Step 2: Full browser walkthrough**

Start `npm run dev` and verify each page:

1. **Landing page** (`/`):
   - Navbar: "YARDS PER PASS" wordmark, links to Team Tiers and QB Rankings
   - Hero: heading, subtitle, two CTA buttons
   - Feature cards: three cards on gray background
   - Footer: nflverse attribution
   - Mobile: hamburger menu works

2. **Team Tiers** (`/teams`):
   - DashboardShell: title, freshness badge ("Through Week X"), season dropdown
   - Scatter plot: team logos at correct positions, four quadrant tints + labels
   - Hover: logo scales up, tooltip shows team name + EPA + record
   - Watermark: "yardsperpass.com" in bottom-right
   - Season dropdown: changes URL param, triggers data reload
   - Mobile (< 768px): scatter plot hidden, sorted list shown

3. **QB Leaderboard** (`/qb-leaderboard`):
   - DashboardShell: title, freshness badge, season dropdown
   - Search: filters by player name
   - Dropbacks slider: filters QBs by minimum dropbacks
   - Table: all 18 columns visible, sortable, EPA columns color-coded
   - Column groups: subtle visual separation
   - Metric tooltips: info icons show popover definitions

4. **Navigation**: all links work, active page is highlighted, back button works with season params

- [ ] **Step 3: Final commit**

```bash
git add -A
git commit -m "feat: complete Yards Per Pass MVP — landing page, team tiers, QB leaderboard"
```
