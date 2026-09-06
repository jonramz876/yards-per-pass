# Tecmo Player Card Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Tecmo Super Bowl–style player card (spec: `docs/superpowers/specs/2026-09-05-tecmo-player-card-design.md`) and use it on `/card/[slug]`, the player page Overview, the share image, and a new download route.

**Architecture:** A pure presentational `TecmoPlayerCard` component fed by unit-tested per-position builders in `lib/stats/tecmo-card.ts` (eligibility, OVR, ability rows). Headshot/jersey come from two new `player_slugs` columns filled by the ingest. The OG image and the season-aware download route share one inline-styled render function.

**Tech Stack:** Next.js 14 App Router, TypeScript, Tailwind v4, next/og ImageResponse, vitest + testing-library, Python/pandas ingest with pytest. Local Python is `py -3`; run each command separately (never chain with `&&`).

**Conventions that bind every task:**
- Read the target file section before editing; make surgical edits.
- Commit after each task with the exact message given.
- `npx tsc --noEmit` must pass before every commit that touches TS.
- Existing scales, confirmed from the codebase: `completion_pct`, `passer_rating`, `cpoe` are stored on their display scales (66.2, 104.6, +2.4); `success_rate`, `catch_rate`, `stuff_rate`, `explosive_rate` are stored 0–1 and displayed via `formatRate` from `lib/stats/formatters.ts`. If a rendered fixture string in a test disagrees with what the leaderboards show for the same stat, trust the leaderboard and fix the formatter call, not the store.

---

## File structure

| File | Responsibility |
|---|---|
| `scripts/ingest.py` (modify) | player_slugs gains headshot_url + jersey_number |
| `tests/test_slugs.py` (modify) | pytest coverage for the new fields |
| `lib/types/index.ts` (modify) | PlayerSlug type gains the two fields |
| `app/fonts/PressStart2P-Regular.ttf` (create) | bundled OFL pixel font |
| `app/fonts.ts` (create) | next/font/local export (`--font-pixel`) |
| `app/layout.tsx` (modify) | attach the font variable |
| `lib/stats/formatters.ts` (modify) | `textColorForBackground` luminance util |
| `lib/stats/tecmo-card.ts` (create) | eligibility rules, OVR, tier colors, per-position card builders |
| `components/player/JerseyAvatar.tsx` (create) | headshot with jersey-SVG fallback |
| `components/player/TecmoPlayerCard.tsx` (create) | the card (pure presentational) |
| `__tests__/lib/tecmo-card.test.ts` (create) | builder unit tests |
| `__tests__/components/TecmoPlayerCard.test.tsx` (create) | card render tests (replaces StatCardView tests) |
| `lib/og/tecmo-card-image.tsx` (create) | shared ImageResponse JSX for OG + download |
| `app/card/[slug]/page.tsx` (modify) | use builders + card; `?season=`; FB→RB |
| `app/card/[slug]/CardPageActions.tsx` (modify) | download URL carries season |
| `app/card/[slug]/opengraph-image.tsx` (rewrite) | latest-season card image |
| `app/api/stat-card/[slug]/route.tsx` (create) | season-aware download PNG |
| `components/player/PlayerOverviewQB.tsx` / `WR` / `RB` (modify) | card replaces radar+chips+bars block; banner reworded |
| `app/player/[slug]/page.tsx` (modify) | pass rb_season_stats + slugs data; FB→RB |
| `app/glossary/page.tsx` (modify) | OVR entry |
| `components/player/StatCardView.tsx` + its test (delete) | superseded |

---

### Task 1: Ingest — headshot_url and jersey_number

**Files:**
- Modify: `scripts/ingest.py` (`ensure_player_slugs_table` ~line 2757, `generate_player_slugs` ~2790–2916, `upsert_player_slugs` ~2919–2945)
- Modify: `lib/types/index.ts:198-204`
- Test: `tests/test_slugs.py`

- [ ] **Step 1: Read `tests/test_slugs.py`** to learn the existing fixture style for calling `generate_player_slugs` with `conn=None`.

- [ ] **Step 2: Write the failing tests** (append to `tests/test_slugs.py`, adapting fixture construction to the file's existing helpers — the roster frame must include the new columns):

```python
def _roster_with_headshots():
    import pandas as pd
    return pd.DataFrame([
        # week 1 row has OLD number/headshot; week 2 must win
        {"gsis_id": "00-001", "position": "QB", "full_name": "Josh Allen",
         "week": 1, "jersey_number": 10, "headshot_url": "https://img/old.png"},
        {"gsis_id": "00-001", "position": "QB", "full_name": "Josh Allen",
         "week": 2, "jersey_number": 17, "headshot_url": "https://img/new.png"},
        {"gsis_id": "00-002", "position": "WR", "full_name": "No Photo Guy",
         "week": 2, "jersey_number": None, "headshot_url": None},
    ])

def test_slugs_carry_headshot_and_jersey(qb_stats_fixture, empty_receiver_stats, empty_rb_gap_stats):
    df = generate_player_slugs(qb_stats_fixture, empty_receiver_stats, empty_rb_gap_stats,
                               _roster_with_headshots(), conn=None)
    row = df[df["player_id"] == "00-001"].iloc[0]
    assert row["headshot_url"] == "https://img/new.png"   # latest week wins
    assert row["jersey_number"] == 17

def test_slugs_tolerate_missing_headshot_columns(qb_stats_fixture, empty_receiver_stats, empty_rb_gap_stats):
    roster = _roster_with_headshots().drop(columns=["headshot_url", "jersey_number"])
    df = generate_player_slugs(qb_stats_fixture, empty_receiver_stats, empty_rb_gap_stats,
                               roster, conn=None)
    assert "headshot_url" in df.columns          # column present, values None
    assert df["headshot_url"].isna().all() or (df["headshot_url"] == None).all()
```

(If the file has no reusable qb_stats/empty fixtures, build minimal DataFrames inline the same way its existing tests do.)

- [ ] **Step 3: Run to verify failure.** Run: `py -3 -m pytest tests/test_slugs.py -q` — Expected: FAIL (KeyError `headshot_url`).

- [ ] **Step 4: Implement in `scripts/ingest.py`** — four edits:

(a) In `ensure_player_slugs_table`, after the `CREATE INDEX` statements inside the same `cur.execute` block or as a following execute:

```python
        cur.execute("ALTER TABLE player_slugs ADD COLUMN IF NOT EXISTS headshot_url TEXT;")
        cur.execute("ALTER TABLE player_slugs ADD COLUMN IF NOT EXISTS jersey_number INTEGER;")
```

(b) In `generate_player_slugs`, where `pos_map`/`full_name_map` are built from the roster (~line 2816): sort so the latest week wins, and build two new maps with soft access:

```python
    pos_map = {}
    full_name_map = {}
    headshot_map = {}
    jersey_map = {}
    if roster is not None and not roster.empty:
        roster_iter = roster.sort_values("week") if "week" in roster.columns else roster
        for _, row in roster_iter.iterrows():
            gsis_id = row.get("gsis_id")
            ...existing pos/full_name logic unchanged...
            headshot = row.get("headshot_url")
            if gsis_id and headshot is not None and pd.notna(headshot):
                headshot_map[gsis_id] = headshot
            jersey = row.get("jersey_number")
            if gsis_id and jersey is not None and pd.notna(jersey):
                jersey_map[gsis_id] = int(jersey)
```

(c) BOTH row-building paths (the "no new players" early-return ~line 2862 AND the final loop ~line 2903) gain the two fields:

```python
                'headshot_url': headshot_map.get(pid),
                'jersey_number': jersey_map.get(pid),
```

Also add the two columns to the empty-DataFrame return at ~line 2814.

(d) In `upsert_player_slugs`:

```python
    cols = ['player_id', 'slug', 'player_name', 'position', 'current_team_id',
            'headshot_url', 'jersey_number']
    ...
    update_set = ', '.join(
        f"{c} = EXCLUDED.{c}"
        for c in ['player_name', 'position', 'current_team_id', 'headshot_url', 'jersey_number']
    )
```

(update_set MUST include the new fields — existing rows only ever take the update path.)

- [ ] **Step 5: Run tests.** Run: `py -3 -m pytest tests/ -q` — Expected: all pass (whole suite, not just slugs).

- [ ] **Step 6: Update the frontend type** in `lib/types/index.ts`:

```ts
export interface PlayerSlug {
  player_id: string;
  slug: string;
  player_name: string;
  position: string;
  current_team_id: string;
  headshot_url: string | null;
  jersey_number: number | null;
}
```

Run: `npx tsc --noEmit` — Expected: clean (fields are additive; `select("*")` callers unaffected).

- [ ] **Step 7: Commit.** `git add scripts/ingest.py tests/test_slugs.py lib/types/index.ts` then commit: `feat: ingest headshot_url and jersey_number into player_slugs`

---

### Task 2: Bundle the pixel font

**Files:**
- Create: `app/fonts/PressStart2P-Regular.ttf`
- Create: `app/fonts.ts`
- Modify: `app/layout.tsx:11,37`

- [ ] **Step 1: Download the font** (SIL OFL 1.1 licensed):

Run: `curl -L -o app/fonts/PressStart2P-Regular.ttf https://github.com/google/fonts/raw/main/ofl/pressstart2p/PressStart2P-Regular.ttf`
Then verify it's a real font, not an HTML error page: `file app/fonts/PressStart2P-Regular.ttf` — Expected: `TrueType Font data`. (Also confirm size is ~80–120 KB via `ls -l`.)

- [ ] **Step 2: Create `app/fonts.ts`:**

```ts
// app/fonts.ts — Press Start 2P (SIL OFL 1.1), bundled so no runtime font fetch
import localFont from "next/font/local";

export const pressStart = localFont({
  src: "./fonts/PressStart2P-Regular.ttf",
  variable: "--font-pixel",
  display: "swap",
});
```

- [ ] **Step 3: Attach in `app/layout.tsx`** — import `{ pressStart }` from `"./fonts"` and change line 37:

```tsx
    <html lang="en" className={`${inter.variable} ${pressStart.variable}`}>
```

- [ ] **Step 4: Verify.** Run `npx tsc --noEmit` then `NEXT_PUBLIC_SUPABASE_URL=https://placeholder.supabase.co NEXT_PUBLIC_SUPABASE_ANON_KEY=placeholder-key-for-build-only npm run build` — Expected: build succeeds.

- [ ] **Step 5: Commit.** `git add app/fonts app/fonts.ts app/layout.tsx` → `feat: bundle Press Start 2P pixel font`

---

### Task 3: Luminance text-color util

**Files:**
- Modify: `lib/stats/formatters.ts` (append)
- Test: `__tests__/lib/formatters.test.ts` (create or append if it exists)

- [ ] **Step 1: Write failing test:**

```ts
import { describe, it, expect } from "vitest";
import { textColorForBackground } from "@/lib/stats/formatters";

describe("textColorForBackground", () => {
  it("returns white on dark team colors", () => {
    expect(textColorForBackground("#00338D")).toBe("#ffffff"); // BUF navy
  });
  it("returns near-black on light team colors", () => {
    expect(textColorForBackground("#FB4F14")).toBe("#0f172a"); // CIN orange
  });
  it("tolerates malformed input", () => {
    expect(textColorForBackground("")).toBe("#ffffff");
  });
});
```

- [ ] **Step 2: Run to verify failure.** `npx vitest run __tests__/lib/formatters.test.ts` — Expected: FAIL (not exported).

- [ ] **Step 3: Implement** (append to `lib/stats/formatters.ts`):

```ts
/** WCAG-ish relative luminance → readable text color for a solid background. */
export function textColorForBackground(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || "");
  if (!m) return "#ffffff";
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b; // 0–255 scale
  return lum > 145 ? "#0f172a" : "#ffffff";
}
```

- [ ] **Step 4: Run tests.** `npx vitest run __tests__/lib/formatters.test.ts` — Expected: PASS.

- [ ] **Step 5: Commit.** → `feat: add textColorForBackground luminance util`

---

### Task 4: Card data builders (`lib/stats/tecmo-card.ts`)

**Files:**
- Create: `lib/stats/tecmo-card.ts`
- Test: `__tests__/lib/tecmo-card.test.ts`

- [ ] **Step 1: Read** `lib/stats/formatters.ts` (top of file) to confirm the exact names/behavior of `formatRate`, `formatPerPlay`, `formatOneDecimal`, `EM_DASH` — the code below assumes `formatRate(0.498) === "49.8%"`-style output and `formatPerPlay(0.21) === "+0.21"`-style signed output; adapt call sites if the real semantics differ (leaderboards are ground truth).

- [ ] **Step 2: Write failing tests** (`__tests__/lib/tecmo-card.test.ts`) — build small fixture pools:

```ts
import { describe, it, expect } from "vitest";
import {
  buildQBCardData, buildWRCardData, buildRBCardData,
  qbEligible, tierColor,
} from "@/lib/stats/tecmo-card";
import type { QBSeasonStat, ReceiverSeasonStat, RBSeasonStat } from "@/lib/types";

// minimal QB factory — only fields the builders touch
function qb(over: Partial<QBSeasonStat>): QBSeasonStat {
  return {
    player_id: "x", player_name: "X", team_id: "BUF", season: 2026, games: 16,
    completions: 359, attempts: 542, dropbacks: 580, epa_per_db: 0.21,
    epa_per_play: 0.2, cpoe: 2.4, completion_pct: 66.2, success_rate: 0.498,
    passing_yards: 4306, touchdowns: 29, interceptions: 12, sacks: 28,
    sack_yards_lost: 180, adot: 8.9, ypa: 7.9, passer_rating: 104.6, any_a: 7.4,
    rush_attempts: 102, rush_yards: 523, rush_tds: 15, rush_epa_per_play: 0.18,
    fumbles: 6, fumbles_lost: 3, td_pct: 5.4, int_pct: 2.2, sack_pct: 4.8,
    scramble_pct: 8, total_epa: 120,
    ...over,
  } as QBSeasonStat;
}

describe("eligibility", () => {
  it("QB with 14+ att/game is eligible", () => {
    expect(qbEligible(qb({ attempts: 224, games: 16 }))).toBe(true);
  });
  it("QB below 14 att/game is not", () => {
    expect(qbEligible(qb({ attempts: 100, games: 16 }))).toBe(false);
  });
  it("zero games is not eligible (no NaN)", () => {
    expect(qbEligible(qb({ games: 0 }))).toBe(false);
  });
});

describe("buildQBCardData", () => {
  const pool = [qb({ player_id: "a", epa_per_db: 0.05 }), qb({ player_id: "b", epa_per_db: 0.1 }),
                qb({ player_id: "c", epa_per_db: 0.15 }), qb({ player_id: "me", epa_per_db: 0.21 })];
  it("produces 12 stat cells and 7 ability rows", () => {
    const d = buildQBCardData(pool[3], pool, 2026);
    expect(d.statCells).toHaveLength(12);
    expect(d.abilityRows).toHaveLength(7);
  });
  it("OVR is 0-99 integer for an eligible QB", () => {
    const d = buildQBCardData(pool[3], pool, 2026);
    expect(d.ovr).not.toBeNull();
    expect(Number.isInteger(d.ovr)).toBe(true);
    expect(d.ovr!).toBeLessThanOrEqual(99);
  });
  it("OVR is null below threshold", () => {
    const scrub = qb({ player_id: "scrub", attempts: 40 });
    const d = buildQBCardData(scrub, pool, 2026);
    expect(d.ovr).toBeNull();
    expect(d.eligible).toBe(false);
  });
  it("aDOT and volume are NOT in the OVR inputs (style/volume excluded)", () => {
    // two QBs identical except aDOT — OVR must match
    const lowAdot = qb({ player_id: "l", adot: 6 });
    const highAdot = qb({ player_id: "h", adot: 12 });
    const p = [...pool, lowAdot, highAdot];
    expect(buildQBCardData(lowAdot, p, 2026).ovr).toBe(buildQBCardData(highAdot, p, 2026).ovr);
  });
  it("empty pool yields null OVR, no NaN in rows", () => {
    const d = buildQBCardData(qb({}), [], 2026);
    expect(d.ovr).toBeNull();
    d.abilityRows.forEach(r => expect(Number.isNaN(r.percentile)).toBe(false));
  });
});

describe("tierColor", () => {
  it("75+ green, 40-74 yellow, <40 red", () => {
    expect(tierColor(80)).toBe("#16a34a");
    expect(tierColor(50)).toBe("#ca8a04");
    expect(tierColor(10)).toBe("#dc2626");
  });
});
// Analogous minimal suites for buildWRCardData (TE pool separation: a TE's pool
// must contain only TEs) and buildRBCardData (rushing-only OVR: changing
// targets/receptions must not change OVR).
```

Write the WR/TE and RB suites out in full in the test file, following the QB pattern (factories with every field the builder touches; the two named invariants asserted).

- [ ] **Step 3: Run to verify failure.** `npx vitest run __tests__/lib/tecmo-card.test.ts` — Expected: FAIL (module not found).

- [ ] **Step 4: Implement `lib/stats/tecmo-card.ts`:**

```ts
// lib/stats/tecmo-card.ts — data builders for the Tecmo player card.
// Eligibility (per-game, unified), OVR (quality metrics only), ability rows.
import type { QBSeasonStat, ReceiverSeasonStat, RBSeasonStat } from "@/lib/types";
import { computePercentile } from "./percentiles";
import {
  QB_RADAR_KEYS, QB_RADAR_AXES, getQBRadarVal,
  WR_RADAR_KEYS, WR_RADAR_AXES, getWRRadarVal,
  RB_RADAR_KEYS, RB_RADAR_AXES, getRBRadarVal,
  computeRadarValues,
} from "./radar";
import { classifyQB, classifyWR, classifyTE, classifyRB } from "./archetypes";
import { qbFantasyPoints, wrFantasyPoints, rbFantasyPoints } from "./fantasy";
import { formatRate, EM_DASH } from "./formatters";

export interface StatCell { label: string; value: string; }
export interface AbilityRow { label: string; raw: string; percentile: number; }
export interface TecmoCardData {
  playerName: string;
  position: string;
  season: number;
  games: number;
  archetypeLabel: string | null;
  eligible: boolean;
  ovr: number | null; // null renders as "—"
  statCells: StatCell[];
  abilityRows: AbilityRow[];
  radarValues: number[];
  radarLabels: string[];
}

// ---- Unified per-game eligibility (pools + OVR + banner) ----
export const QB_MIN_ATT_PER_GAME = 14;
export const WR_MIN_TGT_PER_GAME = 2;
export const RB_MIN_CAR_PER_GAME = 6;

export function qbEligible(q: QBSeasonStat): boolean {
  return q.games > 0 && q.attempts / q.games >= QB_MIN_ATT_PER_GAME;
}
export function wrEligible(r: ReceiverSeasonStat): boolean {
  return r.games > 0 && r.targets / r.games >= WR_MIN_TGT_PER_GAME;
}
export function rbEligible(r: RBSeasonStat): boolean {
  return r.games > 0 && r.carries / r.games >= RB_MIN_CAR_PER_GAME;
}

export function tierColor(percentile: number): string {
  if (percentile >= 75) return "#16a34a";
  if (percentile >= 40) return "#ca8a04";
  return "#dc2626";
}

// ---- shared formatting ----
const num = (v: number, d = 0) => (v == null || Number.isNaN(v) ? EM_DASH : v.toFixed(d));
const signed = (v: number, d = 2) =>
  v == null || Number.isNaN(v) ? EM_DASH : `${v >= 0 ? "+" : ""}${v.toFixed(d)}`;

function ovrFrom(pcts: number[], eligible: boolean): number | null {
  if (!eligible) return null;
  const valid = pcts.filter((p) => !Number.isNaN(p));
  if (valid.length === 0) return null;
  return Math.min(99, Math.round(valid.reduce((a, b) => a + b, 0) / valid.length));
}

function pctOf<T>(pool: T[], get: (t: T) => number, me: T): number {
  const vals = pool.map(get).filter((v) => !Number.isNaN(v)).sort((a, b) => a - b);
  return computePercentile(vals, get(me)); // computePercentile returns 0 on NaN/empty
}

// ---- QB ----
const QB_OVR_KEYS = ["epa_per_db", "cpoe", "success_rate", "inv_int_pct", "rush_epa"];

export function buildQBCardData(me: QBSeasonStat, all: QBSeasonStat[], season: number): TecmoCardData {
  const pool = all.filter(qbEligible);
  const keys = QB_RADAR_KEYS as readonly string[];
  const radarValues = computeRadarValues(keys, getQBRadarVal, me, pool);
  const pct = (k: string) => radarValues[keys.indexOf(k)];
  const eligible = qbEligible(me);
  const ovr = ovrFrom(QB_OVR_KEYS.map(pct), eligible);
  const intPct = me.attempts > 0 ? (me.interceptions / me.attempts) * 100 : NaN;
  return {
    playerName: me.player_name, position: "QB", season, games: me.games,
    archetypeLabel: classifyQB(radarValues)?.label ?? null,
    eligible, ovr,
    statCells: [
      { label: "COMP", value: num(me.completions) },
      { label: "ATT", value: num(me.attempts) },
      { label: "PCT", value: num(me.completion_pct, 1) },
      { label: "YDS", value: num(me.passing_yards) },
      { label: "TD", value: num(me.touchdowns) },
      { label: "INT", value: num(me.interceptions) },
      { label: "SACK", value: num(me.sacks) },
      { label: "RTG", value: num(me.passer_rating, 1) },
      { label: "RU YDS", value: num(me.rush_yards) },
      { label: "RU TD", value: num(me.rush_tds) },
      { label: "FUM", value: num(me.fumbles) },
      { label: "FPTS", value: num(qbFantasyPoints(me)) },
    ],
    abilityRows: [
      { label: "EPA/DROPBACK", raw: signed(me.epa_per_db), percentile: pct("epa_per_db") },
      { label: "CPOE", raw: signed(me.cpoe, 1), percentile: pct("cpoe") },
      { label: "DROPBACKS/GM", raw: num(me.games ? me.dropbacks / me.games : NaN, 1), percentile: pct("dropbacks_game") },
      { label: "ADOT", raw: num(me.adot, 1), percentile: pct("adot") },
      { label: "BALL SECURITY", raw: `${num(intPct, 1)}% INT`, percentile: pct("inv_int_pct") },
      { label: "SUCCESS RATE", raw: formatRate(me.success_rate), percentile: pct("success_rate") },
      { label: "RUSH EPA", raw: signed(getQBRadarVal(me, "rush_epa")), percentile: pct("rush_epa") },
    ],
    radarValues,
    radarLabels: QB_RADAR_AXES.map((a) => a.label),
  };
}

// ---- WR / TE ----
// OVR = quality only: EPA/target, CROE, YPRR, receiving success rate (extra, non-radar).
export function buildWRCardData(me: ReceiverSeasonStat, all: ReceiverSeasonStat[], season: number): TecmoCardData {
  const pool = all.filter((r) => r.position === me.position).filter(wrEligible); // TE vs TE
  const keys = WR_RADAR_KEYS as readonly string[];
  const radarValues = computeRadarValues(keys, getWRRadarVal, me, pool);
  const pct = (k: string) => radarValues[keys.indexOf(k)];
  const succPct = pctOf(pool, (r) => r.receiving_success_rate ?? NaN, me);
  const eligible = wrEligible(me);
  const ovr = ovrFrom([pct("epa_per_target"), pct("croe"), pct("yards_per_route_run"), succPct], eligible);
  const classify = me.position === "TE" ? classifyTE : classifyWR;
  return {
    playerName: me.player_name, position: me.position, season, games: me.games,
    archetypeLabel: classify(radarValues)?.label ?? null,
    eligible, ovr,
    statCells: [
      { label: "TGT", value: num(me.targets) },
      { label: "REC", value: num(me.receptions) },
      { label: "YDS", value: num(me.receiving_yards) },
      { label: "TD", value: num(me.receiving_tds) },
      { label: "YPR", value: num(me.yards_per_reception, 1) },
      { label: "YAC", value: num(me.yac) },
      { label: "TGT %", value: formatRate(me.target_share) },
      { label: "SNAP %", value: formatRate(me.snap_share) },
      { label: "ROUTES", value: num(me.routes_run) },
      { label: "YPRR", value: num(me.yards_per_route_run, 2) },
      { label: "FUM", value: num(me.fumbles) },
      { label: "FPTS", value: num(wrFantasyPoints(me)) },
    ],
    abilityRows: [
      { label: "TGT/GAME", raw: num(me.games ? me.targets / me.games : NaN, 1), percentile: pct("targets_game") },
      { label: "EPA/TARGET", raw: signed(me.epa_per_target), percentile: pct("epa_per_target") },
      { label: "CROE", raw: signed(me.croe, 1), percentile: pct("croe") },
      { label: "AIR YDS/TGT", raw: num(me.air_yards_per_target, 1), percentile: pct("air_yards_per_target") },
      { label: "YAC/REC", raw: num(me.yac_per_reception, 1), percentile: pct("yac_per_reception") },
      { label: "YPRR", raw: num(me.yards_per_route_run, 2), percentile: pct("yards_per_route_run") },
    ],
    radarValues,
    radarLabels: WR_RADAR_AXES.map((a) => a.label),
  };
}

// ---- RB ----
// Source is rb_season_stats (server-computed). OVR = rushing quality only (v1).
const RB_OVR_KEYS = ["epa_per_carry", "success_rate", "stuff_avoidance", "explosive_rate"];

export function buildRBCardData(me: RBSeasonStat, all: RBSeasonStat[], season: number): TecmoCardData {
  const pool = all.filter(rbEligible);
  const keys = RB_RADAR_KEYS as readonly string[];
  const radarValues = computeRadarValues(keys, getRBRadarVal, me, pool);
  const pct = (k: string) => radarValues[keys.indexOf(k)];
  const eligible = rbEligible(me);
  const ovr = ovrFrom(RB_OVR_KEYS.map(pct), eligible);
  return {
    playerName: me.player_name, position: "RB", season, games: me.games,
    archetypeLabel: classifyRB(radarValues)?.label ?? null,
    eligible, ovr,
    statCells: [
      { label: "CAR", value: num(me.carries) },
      { label: "YDS", value: num(me.rushing_yards) },
      { label: "YPC", value: num(me.yards_per_carry, 1) },
      { label: "TD", value: num(me.rushing_tds) },
      { label: "SUCC %", value: formatRate(me.success_rate) },
      { label: "EXPL %", value: formatRate(me.explosive_rate) },
      { label: "TGT", value: num(me.targets) },
      { label: "REC", value: num(me.receptions) },
      { label: "RC YDS", value: num(me.receiving_yards) },
      { label: "RC TD", value: num(me.receiving_tds) },
      { label: "FUM", value: num(me.fumbles) },
      { label: "FPTS", value: num(rbFantasyPoints(me)) },
    ],
    abilityRows: [
      { label: "CAR/GAME", raw: num(me.games ? me.carries / me.games : NaN, 1), percentile: pct("carries_game") },
      { label: "EPA/CARRY", raw: signed(me.epa_per_carry), percentile: pct("epa_per_carry") },
      { label: "STUFF AVOID", raw: formatRate(1 - me.stuff_rate), percentile: pct("stuff_avoidance") },
      { label: "EXPLOSIVE %", raw: formatRate(me.explosive_rate), percentile: pct("explosive_rate") },
      { label: "TGT/GAME", raw: num(me.games ? me.targets / me.games : NaN, 1), percentile: pct("targets_game") },
      { label: "SUCCESS RATE", raw: formatRate(me.success_rate), percentile: pct("success_rate") },
    ],
    radarValues,
    radarLabels: RB_RADAR_AXES.map((a) => a.label),
  };
}
```

(If `formatRate`'s real signature differs from `formatRate(0.498) → "49.8%"`, adapt these call sites per Step 1's reading — never re-scale stored values by hand.)

- [ ] **Step 5: Run tests.** `npx vitest run __tests__/lib/tecmo-card.test.ts` — Expected: PASS. Then `npx tsc --noEmit` — Expected: clean.

- [ ] **Step 6: Commit.** → `feat: Tecmo card data builders with unified eligibility and quality-only OVR`

---

### Task 5: JerseyAvatar component

**Files:**
- Create: `components/player/JerseyAvatar.tsx`
- Test: `__tests__/components/JerseyAvatar.test.tsx`

- [ ] **Step 1: Write failing tests:**

```tsx
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import JerseyAvatar from "@/components/player/JerseyAvatar";

describe("JerseyAvatar", () => {
  it("renders an img when headshotUrl is set", () => {
    const { container } = render(
      <JerseyAvatar headshotUrl="https://img/x.png" jerseyNumber={17}
        primaryColor="#00338D" secondaryColor="#C60C30" playerName="Josh Allen" />
    );
    expect(container.querySelector("img")).not.toBeNull();
  });
  it("renders the jersey SVG with number when headshotUrl is null", () => {
    const { container, getByText } = render(
      <JerseyAvatar headshotUrl={null} jerseyNumber={17}
        primaryColor="#00338D" secondaryColor="#C60C30" playerName="Josh Allen" />
    );
    expect(container.querySelector("svg")).not.toBeNull();
    expect(getByText("17")).toBeTruthy();
  });
  it("renders jersey with no number when jerseyNumber is null", () => {
    const { container } = render(
      <JerseyAvatar headshotUrl={null} jerseyNumber={null}
        primaryColor="#00338D" secondaryColor="#C60C30" playerName="X" />
    );
    expect(container.querySelector("svg")).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify failure**, then **Step 3: implement:**

```tsx
"use client";
// components/player/JerseyAvatar.tsx — headshot with team-jersey fallback.
import { useState } from "react";

interface Props {
  headshotUrl: string | null;
  jerseyNumber: number | null;
  primaryColor: string;
  secondaryColor: string;
  playerName: string;
  size?: number; // px, default 56
}

export default function JerseyAvatar({
  headshotUrl, jerseyNumber, primaryColor, secondaryColor, playerName, size = 56,
}: Props) {
  const [broken, setBroken] = useState(false);
  if (headshotUrl && !broken) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- external host, unoptimized by design
      <img
        src={headshotUrl}
        alt={playerName}
        width={size}
        height={size}
        onError={() => setBroken(true)}
        className="rounded-md object-cover bg-slate-100 border-2"
        style={{ borderColor: primaryColor, width: size, height: size }}
      />
    );
  }
  return (
    <svg width={size} height={size} viewBox="0 0 60 60" role="img" aria-label={playerName}>
      <path
        d="M14 8 L24 4 Q30 8 36 4 L46 8 L56 20 L46 27 L46 54 Q30 58 14 54 L14 27 L4 20 Z"
        fill={primaryColor} stroke={secondaryColor} strokeWidth="2.5"
      />
      {jerseyNumber != null && (
        <text x="30" y="40" textAnchor="middle" fill="#ffffff"
          fontSize="20" fontWeight="bold" fontFamily="var(--font-pixel), monospace">
          {jerseyNumber}
        </text>
      )}
    </svg>
  );
}
```

- [ ] **Step 4: Run tests + tsc.** Expected: PASS/clean. **Step 5: Commit.** → `feat: JerseyAvatar with headshot and jersey fallback`

---

### Task 6: TecmoPlayerCard component

**Files:**
- Create: `components/player/TecmoPlayerCard.tsx`
- Test: `__tests__/components/TecmoPlayerCard.test.tsx`

- [ ] **Step 1: Read** `components/qb/RadarChart.tsx` to get its exact props (it draws the percentile radar on the three overview pages) — reuse it rather than drawing a new radar.

- [ ] **Step 2: Write failing tests** (model fixtures on the mockup data):

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import TecmoPlayerCard from "@/components/player/TecmoPlayerCard";
import type { TecmoCardData } from "@/lib/stats/tecmo-card";

const data: TecmoCardData = {
  playerName: "Josh Allen", position: "QB", season: 2026, games: 16,
  archetypeLabel: "Gunslinger", eligible: true, ovr: 91,
  statCells: Array.from({ length: 12 }, (_, i) => ({ label: `S${i}`, value: `${i}` })),
  abilityRows: [
    { label: "EPA/DROPBACK", raw: "+0.21", percentile: 96 },
    { label: "BALL SECURITY", raw: "3.1% INT", percentile: 38 },
  ],
  radarValues: [96, 84, 90, 62, 78, 71, 91],
  radarLabels: ["EPA/DB", "CPOE", "DB/Game", "aDOT", "Ball Security", "Success%", "Rush EPA"],
};
const team = { teamName: "Buffalo Bills", teamId: "BUF", primaryColor: "#00338D", secondaryColor: "#C60C30" };

describe("TecmoPlayerCard", () => {
  it("renders name, team band, and OVR", () => {
    render(<TecmoPlayerCard data={data} {...team} headshotUrl={null} jerseyNumber={17} />);
    expect(screen.getByText(/JOSH ALLEN|Josh Allen/)).toBeTruthy();
    expect(screen.getByText("BUFFALO BILLS")).toBeTruthy();
    expect(screen.getByText("91")).toBeTruthy();
  });
  it("renders raw / ordinal percentile per ability row", () => {
    render(<TecmoPlayerCard data={data} {...team} headshotUrl={null} jerseyNumber={17} />);
    expect(screen.getByText(/\+0\.21/)).toBeTruthy();
    expect(screen.getByText(/96TH/i)).toBeTruthy();
  });
  it("shows em dash for null OVR", () => {
    render(<TecmoPlayerCard data={{ ...data, ovr: null, eligible: false }} {...team} headshotUrl={null} jerseyNumber={null} />);
    expect(screen.getByText("—")).toBeTruthy();
  });
});
```

- [ ] **Step 3: Run to verify failure**, then **Step 4: implement** `components/player/TecmoPlayerCard.tsx` (server-safe; only JerseyAvatar is a client component):

```tsx
// components/player/TecmoPlayerCard.tsx — the Tecmo Super Bowl-style player card.
// Pure presentational; all data precomputed by lib/stats/tecmo-card.ts builders.
import RadarChart from "@/components/qb/RadarChart";
import JerseyAvatar from "@/components/player/JerseyAvatar";
import { tierColor } from "@/lib/stats/tecmo-card";
import type { TecmoCardData } from "@/lib/stats/tecmo-card";
import { ordinal } from "@/lib/stats/percentiles";
import { textColorForBackground } from "@/lib/stats/formatters";

interface Props {
  data: TecmoCardData;
  teamName: string;
  teamId: string;
  primaryColor: string;
  secondaryColor: string;
  headshotUrl: string | null;
  jerseyNumber: number | null;
}

export default function TecmoPlayerCard({
  data, teamName, primaryColor, secondaryColor, headshotUrl, jerseyNumber,
}: Props) {
  const bandText = textColorForBackground(primaryColor);
  return (
    <div className="bg-white rounded-lg shadow overflow-hidden max-w-2xl mx-auto">
      {/* Team band */}
      <div
        className="flex justify-between px-4 py-2.5 text-[9px] sm:text-[10px] font-[family-name:var(--font-pixel)] uppercase tracking-wide"
        style={{ background: primaryColor, color: bandText }}
      >
        <span>{teamName}</span>
        <span>{data.position}</span>
      </div>

      <div className="p-4">
        {/* Identity row */}
        <div className="flex items-center gap-3">
          <JerseyAvatar
            headshotUrl={headshotUrl} jerseyNumber={jerseyNumber}
            primaryColor={primaryColor} secondaryColor={secondaryColor}
            playerName={data.playerName}
          />
          <div className="min-w-0">
            <div className="font-[family-name:var(--font-pixel)] text-[11px] sm:text-xs text-navy uppercase truncate">
              {jerseyNumber != null ? `${jerseyNumber}-` : ""}{data.playerName}
            </div>
            <div className="font-[family-name:var(--font-pixel)] text-[7px] sm:text-[8px] text-gray-500 uppercase mt-1.5">
              {data.season} · {data.games} GAMES{data.archetypeLabel ? ` · ${data.archetypeLabel}` : ""}
            </div>
          </div>
          <div
            className="ml-auto text-center rounded-md px-2.5 py-1.5 font-[family-name:var(--font-pixel)]"
            style={{ background: primaryColor, color: bandText }}
          >
            <div className="text-sm">{data.ovr ?? "—"}</div>
            <div className="text-[6px]">OVR</div>
          </div>
        </div>

        {/* Basic stat grid */}
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-1.5 mt-3">
          {data.statCells.map((c) => (
            <div key={c.label} className="bg-slate-50 border border-slate-200 rounded px-1 py-1.5 text-center">
              <div className="font-[family-name:var(--font-pixel)] text-[6px] text-gray-500 uppercase">{c.label}</div>
              <div className="text-sm font-bold text-navy mt-0.5">{c.value}</div>
            </div>
          ))}
        </div>

        {/* Ability rows + radar */}
        <div className="flex flex-col sm:flex-row gap-4 items-center mt-4 border-t border-slate-200 pt-2">
          <div className="flex-1 w-full">
            {data.abilityRows.map((r) => (
              <div key={r.label} className="flex items-center gap-2 mt-2">
                <span className="w-2 h-2 rounded-full shrink-0" style={{ background: tierColor(r.percentile) }} />
                <span className="font-[family-name:var(--font-pixel)] text-[7px] text-slate-700 uppercase basis-1/3 shrink-0">
                  {r.label}
                </span>
                <span className="flex-1 h-2 bg-slate-200 rounded-full overflow-hidden">
                  <span
                    className="block h-2 rounded-full"
                    style={{ width: `${Math.max(0, Math.min(r.percentile, 100))}%`, background: primaryColor }}
                  />
                </span>
                <span className="font-[family-name:var(--font-pixel)] text-[7px] text-navy basis-[27%] shrink-0 text-right uppercase">
                  {r.raw} / <b style={{ color: secondaryColor }}>{ordinal(Math.round(r.percentile)).toUpperCase()}</b>
                </span>
              </div>
            ))}
          </div>
          <div className="shrink-0">
            <RadarChart values={data.radarValues} labels={data.radarLabels} color={primaryColor} size={150} />
          </div>
        </div>

        <div className="font-[family-name:var(--font-pixel)] text-[6px] text-slate-400 text-center mt-3 uppercase">
          yardsperpass.com · Data: nflverse
        </div>
      </div>
    </div>
  );
}
```

(Adapt the `RadarChart` props line to its real signature from Step 1 — if it doesn't accept `color`/`size`, use whatever props it exposes; the radar's exact styling is not a spec requirement.)

- [ ] **Step 5: Run tests + tsc.** Expected: PASS/clean. **Step 6: Commit.** → `feat: TecmoPlayerCard component`

---

### Task 7: /card page uses the new card (+ season support)

**Files:**
- Modify: `app/card/[slug]/page.tsx`
- Modify: `app/card/[slug]/CardPageActions.tsx:34`

- [ ] **Step 1: Read `app/card/[slug]/page.tsx` in full.** Note: `const seasons = await getAvailableSeasons(); const season = seasons[0] ?? fallbackSeason();` (added in the 2026-readiness pass), QB/WR/RB branches that build `radarValues/chipStats/barStats`, and the `StatCardView` render at the bottom.

- [ ] **Step 2: Rework the page:**
  - Accept `searchParams: Promise<{ season?: string }>`; resolve `const parsed = ...; const season = Number.isNaN(parsed) ? (seasons[0] ?? fallbackSeason()) : parsed;` (same guard as `app/compare/page.tsx`).
  - Normalize FB: `const pos = player.position === "FB" ? "RB" : player.position;`
  - Replace the three per-position radar/chip/bar blocks with builder calls:

```tsx
  let card: TecmoCardData;
  if (pos === "QB") {
    const all = await getQBStats(season);
    const me = all.find((q) => q.player_id === player.player_id);
    if (!me) notFound();
    card = buildQBCardData(me, all, season);
  } else if (pos === "WR" || pos === "TE") {
    const all = await getReceiverStats(season);
    const me = all.find((r) => r.player_id === player.player_id);
    if (!me) notFound();
    card = buildWRCardData(me, all, season);
  } else if (pos === "RB") {
    const all = await getRBSeasonStats(season); // rb_season_stats — NOT weekly aggregation
    const me = all.find((r) => r.player_id === player.player_id);
    if (!me) notFound();
    card = buildRBCardData(me, all, season);
  } else {
    notFound();
  }
```

  - Render `<TecmoPlayerCard data={card} teamName={teamName} teamId={player.current_team_id} primaryColor={team?.primaryColor || "#0f172a"} secondaryColor={team?.secondaryColor || "#ffffff"} headshotUrl={player.headshot_url ?? null} jerseyNumber={player.jersey_number ?? null} />` in place of `StatCardView`, keeping the surrounding page chrome and `CardPageActions`.
  - Pass `season` to `CardPageActions`.

- [ ] **Step 3: `CardPageActions.tsx`** — add a `season: number` prop and change the download target (line ~34) to:

```tsx
    window.open(`/api/stat-card/${slug}?season=${season}`, "_blank");
```

- [ ] **Step 4: Verify.** `npx tsc --noEmit` (clean), then the placeholder-env `npm run build` (succeeds — the route 404s at runtime until Task 8, which is fine for the build).

- [ ] **Step 5: Commit.** → `feat: /card renders TecmoPlayerCard with season support`

---

### Task 8: Share image + download route

**Files:**
- Create: `lib/og/tecmo-card-image.tsx`
- Rewrite: `app/card/[slug]/opengraph-image.tsx`
- Create: `app/api/stat-card/[slug]/route.tsx`

- [ ] **Step 1: Create the shared render** — `lib/og/tecmo-card-image.tsx` exports (a) `loadPixelFont(): Promise<ArrayBuffer>` reading the bundled TTF, and (b) `tecmoCardImage(cardData, teamInfo, headshotUrl): JSX` — a simplified 1200×630 inline-styled card per spec (band, name+OVR, 6-cell stat subset, ability rows, radar polygon, footer). All styles inline (`display:flex` on every div — ImageResponse requirement). Font loading:

```tsx
import { readFile } from "node:fs/promises";
import { join } from "node:path";

export async function loadPixelFont(): Promise<ArrayBuffer> {
  const buf = await readFile(join(process.cwd(), "app", "fonts", "PressStart2P-Regular.ttf"));
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}
```

Radar polygon math: copy the existing point-generation helpers (`hp`, `mp`, RAD constants) from the current `opengraph-image.tsx` before rewriting it — they are the only part worth keeping.

- [ ] **Step 2: Rewrite `app/card/[slug]/opengraph-image.tsx`:** keep `export const runtime = "nodejs"`, `size`, `contentType`, `alt`. Body: resolve latest season (existing `getAvailableSeasons()[0] ?? fallbackSeason()` inside try/catch — preserve that hardening), build card data with the Task 4 builders (FB→RB normalized), and return `new ImageResponse(tecmoCardImage(...), { ...size, fonts: [{ name: "PressStart", data: await loadPixelFont(), style: "normal" }] })`. Delete the old drawing code and the gstatic Inter fetch.

- [ ] **Step 3: Create `app/api/stat-card/[slug]/route.tsx`:**

```tsx
// GET /api/stat-card/[slug]?season=2026 — downloadable PNG of the card.
import { ImageResponse } from "next/og";
import { getPlayerBySlug } from "@/lib/data/players";
import { getAvailableSeasons, fallbackSeason } from "@/lib/data/queries";
import { tecmoCardImage, loadPixelFont } from "@/lib/og/tecmo-card-image";
// ...same data assembly as opengraph-image, but season comes from the query string:
export const runtime = "nodejs";

export async function GET(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const url = new URL(req.url);
  const parsed = parseInt(url.searchParams.get("season") ?? "", 10);
  let season: number;
  if (Number.isNaN(parsed)) {
    try { season = (await getAvailableSeasons())[0] ?? fallbackSeason(); }
    catch { season = fallbackSeason(); }
  } else { season = parsed; }
  const player = await getPlayerBySlug(slug);
  if (!player) return new Response("Not found", { status: 404 });
  // build card data (shared helper extracted in Step 2 so this stays ~20 lines)
  // return new ImageResponse(tecmoCardImage(...), {...})
}
```

Extract the "player + season → card data" assembly into a shared server helper (e.g. `getCardDataForPlayer(player, season)` in `lib/og/tecmo-card-image.tsx` or a sibling) so the OG file, this route, and Task 7's page don't triplicate the position branching. Return 404 for positions with no card and for players with no stats that season.

- [ ] **Step 4: Verify.** `npx tsc --noEmit`; placeholder-env `npm run build` — Expected: both clean, `/api/stat-card/[slug]` appears in the route list.

- [ ] **Step 5: Commit.** → `feat: Tecmo card share image and season-aware download route`

---

### Task 9: Player page — QB overview

**Files:**
- Modify: `components/player/PlayerOverviewQB.tsx`
- Modify: `app/player/[slug]/page.tsx` (prop plumbing only)

- [ ] **Step 1: Read `PlayerOverviewQB.tsx` in full.** Identify: the 238-attempt pool (~line 104), the below-threshold banner (~line 111), the radar/archetype/chips/"vs league average" JSX blocks, and the "Throws To" section (KEEP).

- [ ] **Step 2: Replace** the radar + archetype + chips + vs-league-average blocks with the card. The component computes `const card = buildQBCardData(me, allQBs, season)` (it already receives the full QB list and season — verify prop names while reading) and renders `<TecmoPlayerCard ... />` with team info from `getTeam(...)` and `headshotUrl`/`jerseyNumber` passed down from the page's `PlayerSlug` (add the two props; page already fetched the slug row).

- [ ] **Step 3: Banner rewording** — replace the 238-attempt condition and text with the unified rule:

```tsx
{!qbEligible(me) && (
  <div className="...existing banner classes...">
    Small sample: below {QB_MIN_ATT_PER_GAME} attempts per game. Percentiles and OVR are hidden or noisy.
  </div>
)}
```

- [ ] **Step 4: Verify.** `npx tsc --noEmit`; `npx vitest run` (full suite — StatCardView tests still pass, nothing imported it here); placeholder-env build.

- [ ] **Step 5: Commit.** → `feat: QB player page uses TecmoPlayerCard`

---

### Task 10: Player page — WR/TE overview

**Files:**
- Modify: `components/player/PlayerOverviewWR.tsx`, `app/player/[slug]/page.tsx`

- [ ] **Step 1: Read `PlayerOverviewWR.tsx` in full** (pool ~line 79/134, banner, kept sections: "Catches From", team link).

- [ ] **Step 2: Same surgery as Task 9** with `buildWRCardData` + `wrEligible`/`WR_MIN_TGT_PER_GAME` banner text ("below 2 targets per game"). Keep "Catches From".

- [ ] **Step 3: Verify** (tsc, vitest, build). **Step 4: Commit.** → `feat: WR/TE player page uses TecmoPlayerCard`

---

### Task 11: Player page — RB overview (source switch)

**Files:**
- Modify: `components/player/PlayerOverviewRB.tsx`, `app/player/[slug]/page.tsx`

- [ ] **Step 1: Read `PlayerOverviewRB.tsx` in full.** It currently aggregates `rb_weekly_stats` client-side (~line 148–198).

- [ ] **Step 2:** In `app/player/[slug]/page.tsx`, for RB/FB players fetch `getRBSeasonStats(currentSeason)` (from `lib/data/rushing.ts` — already used by `/rushing`) and pass the array down. In `PlayerOverviewRB`, replace the weekly aggregation + radar/chips/bars blocks with `buildRBCardData(me, allRBs, season)` + `<TecmoPlayerCard ... />`; me = find by player_id, render the existing "no stats" empty state if absent. Banner: `rbEligible` / "below 6 carries per game". Keep the `/rushing?team=` cross-link. FB normalization: treat position FB as RB when choosing the overview component (check how `app/player/[slug]/page.tsx:124` branches and add `|| position === "FB"`).

- [ ] **Step 3: Verify** (tsc, vitest, build). **Step 4: Commit.** → `feat: RB player page uses TecmoPlayerCard from rb_season_stats`

---

### Task 12: Delete StatCardView; replace its tests

**Files:**
- Delete: `components/player/StatCardView.tsx`, `__tests__/components/StatCardView.test.tsx`

- [ ] **Step 1:** `npx grep` check nothing imports it anymore: search `StatCardView` across `app/ components/ lib/ __tests__/` — Expected: only the two files being deleted.
- [ ] **Step 2:** Delete both files. Run `npx vitest run` (full) + `npx tsc --noEmit` — Expected: green (TecmoPlayerCard tests from Task 6 are the replacement coverage).
- [ ] **Step 3: Commit.** → `chore: remove StatCardView (superseded by TecmoPlayerCard)`

---

### Task 13: Glossary OVR entry

**Files:**
- Modify: `app/glossary/page.tsx`

- [ ] **Step 1: Read the glossary entry pattern** (each entry has an anchor id — the archetype badges deep-link to `#anchors`).
- [ ] **Step 2: Add an entry** with `id="ovr"`, following the file's existing structure, with this content:

> **OVR (Overall)** — A 0–99 score: the average of a player's percentile ranks in his position's *quality* metrics (QB: EPA/dropback, CPOE, success rate, ball security, rush EPA · WR/TE: EPA/target, CROE, yards per route run, receiving success rate · RB: EPA/carry, success rate, stuff avoidance, explosive rate). Style metrics (like aDOT) and volume metrics (like targets per game) appear on the card but do not affect OVR. Players below the per-game qualifying threshold (QB 14 att/g, WR/TE 2 tgt/g, RB 6 car/g) show "—". RB OVR currently measures rushing only.

- [ ] **Step 3: Verify + commit.** → `docs: glossary entry for OVR`

---

### Task 14: Full verification, chaos pass, review

- [ ] **Step 1:** Run all four checks (separately): `npx tsc --noEmit` · placeholder-env `npm run build` · `npx vitest run` · `py -3 -m pytest tests/ -q` — Expected: all green.
- [ ] **Step 2: Chaos agent** (per `.claude/CLAUDE.md`): attack with the spec's checklist — no-headshot/broken-URL/no-jersey players, ineligible + zero-stat players (no NaN text anywhere), empty pools, `?season=abc`/`?season=1999` on /card and the download route, long names ("Amon-Ra St. Brown") and long team names at mobile widths, CIN/light team bands (text contrast), FB players, historical seasons. Fix all crashes before proceeding.
- [ ] **Step 3:** Visual pass — run the dev server, check `/card/josh-allen` and a WR/TE/RB page on desktop and phone-width; confirm the pixel font renders and bars/dots/radar match the approved mockup (`.superpowers/brainstorm/1367-1788622017/content/final-card.html`).
- [ ] **Step 4:** Per project convention, run `/review-feature "Tecmo player card"` (Jon triggers this — remind him).
- [ ] **Step 5:** Update `memory/MEMORY.md` (card architecture, OVR formula location, eligibility constants) per the end-of-session rule. Commit.

---

## Self-review notes (already applied)

- Spec coverage: every spec section maps to a task (eligibility → T4; migration traps → T1; font/OG → T2/T8; download+season → T7/T8; banner rewording → T9–11; StatCardView tests → T12; FB → T7/T11; luminance → T3; glossary → T13).
- Deliberate deviations from pure TDD: page-integration tasks (7, 9–11) are verified by tsc/build/existing suite + Task 14's chaos pass rather than new per-page tests — the pages are thin assemblies of unit-tested builders.
- Types used consistently: `TecmoCardData`/`AbilityRow`/`StatCell` defined once in T4 and imported everywhere; `tierColor` lives in T4 (not the component) so tests in T4 cover it.
