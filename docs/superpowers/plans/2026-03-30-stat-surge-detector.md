# Stat Surge Detector Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a `/trends` page that identifies players whose recent performance significantly deviates from their season average, displayed as "Rising" (surges) and "Falling" (collapses) with sparklines and z-score badges.

**Architecture:** Server component fetches all weekly stats for the current season from existing Supabase tables (`qb_weekly_stats`, `receiver_weekly_stats`, `rb_weekly_stats`), joins with `player_slugs` for names/positions. Pure computation in `lib/stats/surge.ts` calculates z-scores. Client component handles position filtering, stat selection, and week window toggling.

**Tech Stack:** Next.js 14 RSC, Supabase, TypeScript, Tailwind v4, SVG sparklines

---

### Task 1: Pure Surge Detection Logic + Tests

**Files:**
- Create: `lib/stats/surge.ts`
- Create: `__tests__/stats/surge.test.ts`

- [ ] **Step 1: Write the failing tests for z-score computation**

```typescript
// __tests__/stats/surge.test.ts
import { describe, it, expect } from "vitest";
import { computeZScore, detectSurges, type WeeklyValue } from "@/lib/stats/surge";

describe("computeZScore", () => {
  it("returns 0 when recent equals season average", () => {
    expect(computeZScore([10, 10, 10, 10, 10, 10, 10, 10], 4)).toBeCloseTo(0, 1);
  });

  it("returns positive z-score for recent surge", () => {
    // Season: [5, 5, 5, 5, 5, 5, 20, 20] — last 2 weeks are way above average
    const z = computeZScore([5, 5, 5, 5, 5, 5, 20, 20], 2);
    expect(z).toBeGreaterThan(1.5);
  });

  it("returns negative z-score for recent collapse", () => {
    const z = computeZScore([20, 20, 20, 20, 20, 20, 2, 2], 2);
    expect(z).toBeLessThan(-1.5);
  });

  it("returns 0 when stdev is 0 (all values identical)", () => {
    expect(computeZScore([7, 7, 7, 7, 7, 7], 3)).toBe(0);
  });

  it("returns 0 for fewer than minGames values", () => {
    expect(computeZScore([10, 20], 2)).toBe(0);
  });
});

describe("detectSurges", () => {
  it("identifies a surging player", () => {
    const players: WeeklyValue[] = [
      { playerId: "p1", playerName: "Test QB", teamId: "KC", position: "QB", slug: "test-qb",
        weeks: [
          { week: 1, value: 0.05 }, { week: 2, value: 0.04 }, { week: 3, value: 0.06 },
          { week: 4, value: 0.03 }, { week: 5, value: 0.05 }, { week: 6, value: 0.04 },
          { week: 7, value: 0.25 }, { week: 8, value: 0.28 },
        ],
      },
    ];
    const result = detectSurges(players, { window: 2, minGames: 6, threshold: 1.5 });
    expect(result.rising.length).toBe(1);
    expect(result.rising[0].playerId).toBe("p1");
    expect(result.falling.length).toBe(0);
  });

  it("identifies a collapsing player", () => {
    const players: WeeklyValue[] = [
      { playerId: "p1", playerName: "Test WR", teamId: "BUF", position: "WR", slug: "test-wr",
        weeks: [
          { week: 1, value: 0.20 }, { week: 2, value: 0.22 }, { week: 3, value: 0.18 },
          { week: 4, value: 0.21 }, { week: 5, value: 0.19 }, { week: 6, value: 0.20 },
          { week: 7, value: 0.01 }, { week: 8, value: 0.02 },
        ],
      },
    ];
    const result = detectSurges(players, { window: 2, minGames: 6, threshold: 1.5 });
    expect(result.falling.length).toBe(1);
    expect(result.rising.length).toBe(0);
  });

  it("skips players with fewer than minGames", () => {
    const players: WeeklyValue[] = [
      { playerId: "p1", playerName: "Backup", teamId: "NE", position: "QB", slug: "backup",
        weeks: [{ week: 1, value: 0.30 }, { week: 2, value: 0.01 }],
      },
    ];
    const result = detectSurges(players, { window: 2, minGames: 6, threshold: 1.5 });
    expect(result.rising.length).toBe(0);
    expect(result.falling.length).toBe(0);
  });

  it("sorts by absolute z-score descending", () => {
    const players: WeeklyValue[] = [
      { playerId: "p1", playerName: "Small Surge", teamId: "KC", position: "QB", slug: "small",
        weeks: [
          { week: 1, value: 5 }, { week: 2, value: 5 }, { week: 3, value: 5 },
          { week: 4, value: 5 }, { week: 5, value: 5 }, { week: 6, value: 5 },
          { week: 7, value: 12 }, { week: 8, value: 12 },
        ],
      },
      { playerId: "p2", playerName: "Big Surge", teamId: "BUF", position: "QB", slug: "big",
        weeks: [
          { week: 1, value: 5 }, { week: 2, value: 5 }, { week: 3, value: 5 },
          { week: 4, value: 5 }, { week: 5, value: 5 }, { week: 6, value: 5 },
          { week: 7, value: 25 }, { week: 8, value: 25 },
        ],
      },
    ];
    const result = detectSurges(players, { window: 2, minGames: 6, threshold: 1.5 });
    expect(result.rising[0].playerId).toBe("p2");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run __tests__/stats/surge.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement surge detection logic**

```typescript
// lib/stats/surge.ts

export interface WeeklyValue {
  playerId: string;
  playerName: string;
  teamId: string;
  position: string;
  slug: string;
  weeks: { week: number; value: number }[];
}

export interface SurgeEntry {
  playerId: string;
  playerName: string;
  teamId: string;
  position: string;
  slug: string;
  zScore: number;
  seasonAvg: number;
  recentAvg: number;
  delta: number;
  weeks: { week: number; value: number }[];
}

export interface SurgeResult {
  rising: SurgeEntry[];
  falling: SurgeEntry[];
}

export interface SurgeOptions {
  window: number;    // number of recent weeks to average (e.g. 4)
  minGames: number;  // minimum total games to be eligible (e.g. 6)
  threshold: number; // z-score threshold (e.g. 1.5)
}

/**
 * Compute z-score of the last `window` values vs the full array.
 * Returns 0 if insufficient data or zero variance.
 */
export function computeZScore(values: number[], window: number, minGames = 6): number {
  if (values.length < minGames || values.length < window + 2) return 0;

  const n = values.length;
  const mean = values.reduce((a, b) => a + b, 0) / n;
  const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / n;
  const stdev = Math.sqrt(variance);

  if (stdev === 0) return 0;

  const recentSlice = values.slice(-window);
  const recentMean = recentSlice.reduce((a, b) => a + b, 0) / recentSlice.length;

  return (recentMean - mean) / stdev;
}

/**
 * Detect surging and collapsing players from weekly values.
 * Returns top entries sorted by absolute z-score descending.
 */
export function detectSurges(
  players: WeeklyValue[],
  options: SurgeOptions,
): SurgeResult {
  const { window, minGames, threshold } = options;
  const rising: SurgeEntry[] = [];
  const falling: SurgeEntry[] = [];

  for (const player of players) {
    const sorted = [...player.weeks].sort((a, b) => a.week - b.week);
    const values = sorted.map((w) => w.value);

    const z = computeZScore(values, window, minGames);
    if (Math.abs(z) < threshold) continue;

    const seasonAvg = values.reduce((a, b) => a + b, 0) / values.length;
    const recentSlice = values.slice(-window);
    const recentAvg = recentSlice.reduce((a, b) => a + b, 0) / recentSlice.length;

    const entry: SurgeEntry = {
      playerId: player.playerId,
      playerName: player.playerName,
      teamId: player.teamId,
      position: player.position,
      slug: player.slug,
      zScore: z,
      seasonAvg,
      recentAvg,
      delta: recentAvg - seasonAvg,
      weeks: sorted,
    };

    if (z >= threshold) rising.push(entry);
    else falling.push(entry);
  }

  rising.sort((a, b) => b.zScore - a.zScore);
  falling.sort((a, b) => a.zScore - b.zScore);

  return { rising, falling };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run __tests__/stats/surge.test.ts`
Expected: All 8 tests PASS

- [ ] **Step 5: Commit**

```bash
git add lib/stats/surge.ts __tests__/stats/surge.test.ts
git commit -m "feat(trends): add surge detection logic with z-score computation"
```

---

### Task 2: Data Layer — Fetch All Weekly Stats

**Files:**
- Create: `lib/data/trends.ts`
- Modify: `lib/types/index.ts` (add SurgeStat type)

- [ ] **Step 1: Add SurgeStat type**

Add to `lib/types/index.ts`:
```typescript
export interface SurgeStat {
  position: "QB" | "WR" | "RB";
  statKey: string;
  statLabel: string;
}
```

- [ ] **Step 2: Create trends data layer**

```typescript
// lib/data/trends.ts
import { createServerClient } from "@/lib/supabase/server";
import { fetchAllRows } from "./utils";
import type { PlayerSlug, QBWeeklyStat, ReceiverWeeklyStat, RBWeeklyStat } from "@/lib/types";
import type { WeeklyValue } from "@/lib/stats/surge";

const QB_WEEKLY_NUMERIC = ["epa_per_dropback", "cpoe", "success_rate", "adot", "passer_rating", "ypa"];
const RCV_WEEKLY_NUMERIC = ["epa_per_target", "catch_rate", "yac_per_reception", "adot", "yards_per_route_run"];
const RB_WEEKLY_NUMERIC = ["epa_per_carry", "success_rate", "yards_per_carry", "stuff_rate", "explosive_rate"];

function parseNum(v: unknown): number {
  if (v === null || v === undefined) return NaN;
  const n = typeof v === "string" ? parseFloat(v) : Number(v);
  return isNaN(n) ? NaN : n;
}

/** Fetch all QB weekly stats for a season, enriched with player name/slug */
export async function getAllQBWeekly(season: number, slugMap: Map<string, PlayerSlug>): Promise<WeeklyValue[]> {
  const rows = await fetchAllRows("qb_weekly_stats", "*", { season });
  const byPlayer = new Map<string, { week: number; value: number }[]>();

  for (const row of rows) {
    const pid = row.player_id as string;
    const week = row.week as number;
    const val = parseNum(row.epa_per_dropback);
    if (isNaN(val)) continue;
    if (!byPlayer.has(pid)) byPlayer.set(pid, []);
    byPlayer.get(pid)!.push({ week, value: val });
  }

  const result: WeeklyValue[] = [];
  for (const [pid, weeks] of byPlayer) {
    const info = slugMap.get(pid);
    if (!info || info.position !== "QB") continue;
    result.push({
      playerId: pid,
      playerName: info.player_name,
      teamId: info.current_team_id,
      position: "QB",
      slug: info.slug,
      weeks,
    });
  }
  return result;
}

/** Fetch all WR weekly stats for a season */
export async function getAllReceiverWeekly(season: number, slugMap: Map<string, PlayerSlug>): Promise<WeeklyValue[]> {
  const rows = await fetchAllRows("receiver_weekly_stats", "*", { season });
  const byPlayer = new Map<string, { week: number; value: number }[]>();

  for (const row of rows) {
    const pid = row.player_id as string;
    const week = row.week as number;
    const val = parseNum(row.epa_per_target);
    if (isNaN(val)) continue;
    if (!byPlayer.has(pid)) byPlayer.set(pid, []);
    byPlayer.get(pid)!.push({ week, value: val });
  }

  const result: WeeklyValue[] = [];
  for (const [pid, weeks] of byPlayer) {
    const info = slugMap.get(pid);
    if (!info) continue;
    if (info.position !== "WR" && info.position !== "TE") continue;
    result.push({
      playerId: pid,
      playerName: info.player_name,
      teamId: info.current_team_id,
      position: info.position as string,
      slug: info.slug,
      weeks,
    });
  }
  return result;
}

/** Fetch all RB weekly stats for a season */
export async function getAllRBWeekly(season: number, slugMap: Map<string, PlayerSlug>): Promise<WeeklyValue[]> {
  const rows = await fetchAllRows("rb_weekly_stats", "*", { season });
  const byPlayer = new Map<string, { week: number; value: number }[]>();

  for (const row of rows) {
    const pid = row.player_id as string;
    const week = row.week as number;
    const val = parseNum(row.epa_per_carry);
    if (isNaN(val)) continue;
    if (!byPlayer.has(pid)) byPlayer.set(pid, []);
    byPlayer.get(pid)!.push({ week, value: val });
  }

  const result: WeeklyValue[] = [];
  for (const [pid, weeks] of byPlayer) {
    const info = slugMap.get(pid);
    if (!info || info.position !== "RB") continue;
    result.push({
      playerId: pid,
      playerName: info.player_name,
      teamId: info.current_team_id,
      position: "RB",
      slug: info.slug,
      weeks,
    });
  }
  return result;
}

/** Multi-stat variant: return WeeklyValue[] for a specific stat key */
export async function getWeeklyByStat(
  table: string,
  statColumn: string,
  season: number,
  slugMap: Map<string, PlayerSlug>,
  positionFilter: string[],
): Promise<WeeklyValue[]> {
  const rows = await fetchAllRows(table, `player_id,week,${statColumn}`, { season });
  const byPlayer = new Map<string, { week: number; value: number }[]>();

  for (const row of rows) {
    const pid = row.player_id as string;
    const week = row.week as number;
    const val = parseNum(row[statColumn]);
    if (isNaN(val)) continue;
    if (!byPlayer.has(pid)) byPlayer.set(pid, []);
    byPlayer.get(pid)!.push({ week, value: val });
  }

  const result: WeeklyValue[] = [];
  for (const [pid, weeks] of byPlayer) {
    const info = slugMap.get(pid);
    if (!info || !positionFilter.includes(info.position)) continue;
    result.push({
      playerId: pid,
      playerName: info.player_name,
      teamId: info.current_team_id,
      position: info.position,
      slug: info.slug,
      weeks,
    });
  }
  return result;
}
```

- [ ] **Step 3: Commit**

```bash
git add lib/data/trends.ts lib/types/index.ts
git commit -m "feat(trends): add data layer for fetching all weekly stats"
```

---

### Task 3: SurgeDetector Client Component

**Files:**
- Create: `components/trends/SurgeDetector.tsx`

- [ ] **Step 1: Create the SurgeDetector component**

Client component with:
- Position filter tabs (All / QB / WR / RB)
- Stat selector dropdown (EPA default, plus completion%, yards/game, etc.)
- Week window slider (3/4/5 weeks, default 4)
- Two-column layout: Rising (green) | Falling (red)
- Each entry: player name (link to /player/slug), team logo, position badge, sparkline SVG, z-score badge, season avg → recent avg delta
- Max 10 entries per column

Key details:
- Sparkline: tiny SVG (120×32) with polyline, last N weeks highlighted
- z-score badge: green for rising (z >= 1.5), red for falling (z <= -1.5), intensity scales with magnitude
- Delta chip: "+0.12 EPA/DB" or "-3.2 YPG" format
- Team logo: 16×16 img from `/logos/{team_id}.svg`
- Player name links to `/player/{slug}`

- [ ] **Step 2: Commit**

```bash
git add components/trends/SurgeDetector.tsx
git commit -m "feat(trends): add SurgeDetector client component with sparklines and z-score badges"
```

---

### Task 4: Trends Page + Route Files

**Files:**
- Create: `app/trends/page.tsx`
- Create: `app/trends/loading.tsx`
- Create: `app/trends/error.tsx`

- [ ] **Step 1: Create page server component**

Server component that:
- Fetches current season from `getAvailableSeasons()`
- Fetches all player slugs, builds slugMap
- Fetches QB/WR/RB weekly stats in parallel with `Promise.all()`
- Runs `detectSurges()` for each position group
- Passes pre-computed surge results to SurgeDetector client component
- Uses DashboardShell wrapper
- `generateMetadata()` with season in title
- `export const revalidate = 3600`

- [ ] **Step 2: Create loading skeleton**

Simple spinner matching the existing pattern (spinning border with navy color).

- [ ] **Step 3: Create error handler**

Standard "use client" error boundary using ErrorState component.

- [ ] **Step 4: Commit**

```bash
git add app/trends/page.tsx app/trends/loading.tsx app/trends/error.tsx
git commit -m "feat(trends): add /trends page with server-side surge detection"
```

---

### Task 5: Integration — Nav, Sitemap, Revalidation, Glossary

**Files:**
- Modify: `components/layout/Navbar.tsx` — add "Trends" nav link
- Modify: `app/sitemap.ts` — add /trends entry
- Modify: `app/api/revalidate/route.ts` — add revalidatePath("/trends")
- Modify: `app/glossary/page.tsx` — add glossary entries

- [ ] **Step 1: Add nav link**

Add `{ href: "/trends", label: "Trends" }` to NAV_LINKS array in Navbar.tsx, between "Run Gaps" and "Compare".

- [ ] **Step 2: Add sitemap entry**

Add `{ url: \`\${base}/trends\`, lastModified: new Date(), changeFrequency: "weekly" as const, priority: 0.8 }` to staticPages array.

- [ ] **Step 3: Add revalidation path**

Add `revalidatePath("/trends")` to the POST handler.

- [ ] **Step 4: Add glossary entries**

Add entries for:
- "Stat Surge Detector" — definition of the feature
- "Z-Score" — statistical measure of deviation from the mean

- [ ] **Step 5: Commit**

```bash
git add components/layout/Navbar.tsx app/sitemap.ts app/api/revalidate/route.ts app/glossary/page.tsx
git commit -m "feat(trends): integrate nav, sitemap, revalidation, glossary"
```

---

### Task 6: TypeScript + Full Test Suite Verification

- [ ] **Step 1: Run tsc**

Run: `npx tsc --noEmit`
Expected: Clean (no errors)

- [ ] **Step 2: Run all frontend tests**

Run: `npx vitest run`
Expected: All tests pass (135+ frontend)

- [ ] **Step 3: Run all backend tests**

Run: `python -m pytest tests/ -q`
Expected: 213 passed

- [ ] **Step 4: Run ESLint**

Run: `npx next lint`
Expected: Clean

- [ ] **Step 5: Final commit if any lint fixes needed**
