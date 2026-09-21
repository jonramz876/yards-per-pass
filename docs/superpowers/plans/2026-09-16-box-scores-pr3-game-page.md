# Box Scores PR 3 — `/game/[game_id]` + schedule-tile and Game Log links Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every played 2026 regular-season game gets a page at `/game/<game_id>` — a Tecmo scoreboard, the four `AWAY | stat | HOME` comparison sections with the better side shaded, and the passing / rushing / receiving player lines — and the team page's schedule tiles and the player page's Game Log link to it.

**Architecture:** One server-only data module, `lib/data/box-score.ts`, assembles a page from PR 2's `team_game_stats` table plus the existing `games`, weekly player tables and `player_slugs`, and returns one of five explicit states (not-found, unplayed, uncovered, pending, ready). One pure module, `lib/stats/box-score.ts`, turns those rows into display models — number formatting, records counted from the schedule, the scoreboard, the comparison rows with their "better side", the three player tables and the on-page notes — so every number on the page is unit-tested against the BUF–HOU golden values without a database. Four small server-rendered components (`Scoreboard`, `ComparisonSection`, `PlayerTable`, `GameMessage`) render the models; `app/game/[game_id]/page.tsx` is generated on demand with hourly revalidation and rethrows on any failed read. The link gate is a per-season `limit(1)` probe of `team_game_stats` (`getBoxScoreSeasons`), fetched in the team and player page server components and threaded to the client components as a plain `number[]`.

**Tech Stack:** Next.js 14.2 App Router, React 18, TypeScript 5.9, Tailwind v4 (arbitrary values), `next/image` + `next/link`, Supabase (`@supabase/supabase-js` via `createServerClient`), base-ui tooltips through `components/ui/MetricTooltip.tsx`, vitest 4 + @testing-library/react (jsdom), `gh` CLI, Vercel.

**Spec:** `docs/superpowers/specs/2026-09-15-box-scores-design.md`. PR 3 = §3 "Phase 1 … PR 3: `/game/[game_id]` + schedule-tile and Game Log links". Binding: §6 (page order, records, player tables, the EPA null guard, states, rendering, mobile), §7 (links, the season gate and threading to client components), §11 "Frontend (vitest…)", §12 (the on-page notes), §4 for what every number means. §11's frontend list includes two PR 4 items — the hook rule for every branch and the strip advancing a week — which are out of scope here. §8 is PR 4 — not built here, but the scoreboard, the record helper and the team colours are reusable pieces it will take. The column names come from PR 2's plan, `docs/superpowers/plans/2026-09-16-box-scores-pr2-team-game-stats.md` (`TEAM_GAME_STATS_COLS` and its NULL policy in the Global Constraints; the two `qb_weekly_stats` columns from its Task 5).

## Global Constraints

- **Windows + Git Bash.** One command per Bash call. Never chain with `&&` or `||`. Agent shells reset the working directory, so every command uses an absolute, quoted path. The repo is `C:/Users/jonra/OneDrive/Desktop/claude sandbox/football website/yards-per-pass` (the path has spaces).
- **Before every commit:** `tsc --noEmit` passes and `next lint` adds no new warning to a changed file — `main` already carries four warnings (`components/compare/ComparisonTool.tsx`, `QBLeaderboard.tsx`, `RBLeaderboard.tsx`, `ReceiverLeaderboard.tsx`); those stay, nothing new joins them. Vitest runs locally (CI does not run it). `next build` with the placeholder env (`NEXT_PUBLIC_SUPABASE_URL=https://placeholder.supabase.co NEXT_PUBLIC_SUPABASE_ANON_KEY=placeholder-key-for-build-only`) passes before the branch is pushed. If the build fails with `EINVAL: invalid argument, readlink` under `.next`, OneDrive has locked the folder: move `.next/server` aside to `.next/cache/onedrive-locked-<new suffix>` and build again — never delete it.
- **Server-only modules stay server-only.** Anything that imports `lib/supabase/server.ts` — `lib/data/box-score.ts`, `lib/data/games.ts`, `lib/data/queries.ts`, `lib/data/players.ts` — is never imported from a `"use client"` file (`components/team/ScheduleSection.tsx`, `TeamHubContent.tsx`, `components/player/GameLogTab.tsx`, `PlayerPageContent.tsx`). Client files import only *types* from `@/lib/types` and pure code from `@/lib/stats/*` and `@/lib/data/teams.ts`. Props crossing server → client are JSON-serializable: plain arrays and objects, no `Map`, no `NaN` (spec §7).
- **Numeric guards are `val == null || Number.isNaN(val)`.** `parseNumericFields` turns a stored `"NaN"` into `null` and leaves NULL as `null`; an `isNaN`-only guard lets `null` through (`epaTextColor` has exactly that footgun — wrap it, never call it with a possibly-null value; spec §6, the 2026-09-11 F1 crash). `lib/stats/box-score.ts`'s `isNum` is the one guard every render goes through.
- **PR 2's table is the contract.** `team_game_stats` columns, verbatim from `TEAM_GAME_STATS_COLS`: `game_id, team_id, season, week, opponent_id, home_away, plays, epa_per_play, success_rate, first_down_rate, pass_plays, pass_epa_per_play, pass_success_rate, pass_first_down_rate, rush_plays, rush_epa_per_play, rush_success_rate, rush_first_down_rate, early_plays, early_epa_per_play, early_success_rate, late_plays, late_epa_per_play, late_success_rate, explosive_plays, explosive_rate, explosive_pass, explosive_rush, epa_lost_turnovers, epa_lost_sacks, epa_lost_penalties, first_downs, first_downs_pass, first_downs_rush, first_downs_penalty, third_down_att, third_down_conv, fourth_down_att, fourth_down_conv, total_plays, total_yards, total_drives, yards_per_play, net_passing_yards, completions, attempts, yards_per_pass, interceptions, sacks, sack_yards, rushing_yards, rushing_attempts, yards_per_rush, red_zone_trips, red_zone_tds, penalties, penalty_yards, turnovers, fumbles_lost, def_st_tds, time_of_possession_seconds, team_targets`. NULL policy: the 17 rate columns (`epa_per_play`, `success_rate`, `first_down_rate`, their `pass_`/`rush_` variants, `early_epa_per_play`, `early_success_rate`, `late_epa_per_play`, `late_success_rate`, `explosive_rate`, `yards_per_play`, `yards_per_pass`, `yards_per_rush`) are NULL when the denominator is 0; `time_of_possession_seconds` is NULL only for a team with drives but no clock; every count and yard total is 0 when a team had none; `epa_lost_*` are 0.0; `sack_yards` is stored **positive**. `qb_weekly_stats` gains `rush_epa_per_carry` and `rush_success_rate` (NUMERIC; NULL for a game with no carries and on every 2020–2025 row until the backfill). If PR 2's review renames a column, find-and-replace it in Tasks 1–3 before executing them.
- **Supabase's 1000-row cap:** any read not scoped to one game or one season goes through `fetchAllRows()` (`lib/data/utils.ts`). The link gate never reads the whole table: `getBoxScoreSeasons` probes each candidate season with `limit(1)` (spec §7's verified trap — a bare `select season` over `team_game_stats` returns only the first 1000 rows once the backfill lands).
- **Protected reads throw.** On the box score page every read (`games`, both schedules, `team_game_stats`, the three weekly tables, `player_slugs`, `data_freshness`) throws on a query error, and the page rethrows unless `hasNoDatabase()` (the placeholder build), so a Supabase blip can never cache an empty page — ISR keeps the last good copy (spec §6, the homepage rule). The documented exception stays documented: `app/sitemap.ts` swallows read errors, so a failed read drops every game URL until the next rebuild (note it, do not fix it here). The team and player pages catch the seasons probe and render no links (logged).
- **Never compute a stat that ingest stores.** The only arithmetic in the page is presentation the spec defines from stored columns: toxic differential (§4), the pass/rush explosive rates (`explosive_pass ÷ pass_plays`, `explosive_rush ÷ rush_plays`), target share (`targets ÷ team_targets`, §5 — never a sum of rows), Y/TGT, a QB's yards per carry (`rush_yards ÷ rush_attempts`), and the records counted from `games` (§6).
- **Copy is the approved mockup's, verbatim** (section titles, row labels, tooltip texts, message headings, notes) as transcribed in Tasks 2, 5 and 7. Numbers never use the pixel font (site convention). Negative numbers print a typographic minus (U+2212, "−0.26"), the way the mockup and the golden values in this plan read; a value that rounds to zero prints unsigned ("0.0", never "-0.0").
- **Quality gates as tasks:** chaos test (Task 11) before the final code review (Task 12); a "rate it + 3 domain experts" pass after it (Task 13); docs/memory (Task 14) before shipping (Task 15). Fix every CRASH/ERROR before moving on.
- **Ship gate:** this PR does not merge until PR 2 is merged **and** production `team_game_stats` has 2026 rows (Task 15 checks with a read-only REST GET using the anon key from `.env.local`, printing only counts — never the key, never `DATABASE_URL`). Branch `box-scores-pr3` from the then-current `main`; one PR; CI polled with a background until-loop over `gh pr checks <n> --json bucket` (never `--watch`); `gh pr merge <n> --merge` once green; wait for the Vercel production deploy (commit status context `Vercel`); verify on yardsperpass.com.
- **Commits:** stage files by name. End every commit message in this plan with `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>` — that line, not the generic one the commit commands below still carry.
- **`first_down_rate`, `pass_first_down_rate` and `rush_first_down_rate` are stored but not shown.** rbsdm publishes 1st% as the third of its four numbers and PR 2 stores all three variants, but the approved mockup's Efficiency section does not have a 1st%-rate row, so the page does not render one. They stay typed, fixtured and parsed so adding three rows later is a display-only change. Do not add the rows in this PR.
- **Line numbers** in this plan are as of `main` @ a1f4cfe (Phase 0 and PR 2 merged; PR 2 changed only scripts/ingest.py, tests/, docs and memory, so no frontend line moved) and are orientation only; anchor every edit on the quoted text. `scripts/ingest.py` and `tests/` are PR 2's — do not touch them.

## File Structure

| File | Change | Responsibility |
|---|---|---|
| `lib/types/index.ts` | Modify (Task 1) | `TeamGameStat` (the 62 columns, nullable NUMERICs), `PlayerIdentity`, `GamePlayerLines`; `QBWeeklyStat` gains `rush_epa_per_carry` / `rush_success_rate` |
| `lib/supabase/server.ts` | Modify (Task 1) | `hasNoDatabase()` moves here from `app/page.tsx` (spec §6: both pages import it) |
| `app/page.tsx` | Modify (Task 1) | Imports `hasNoDatabase` instead of defining it |
| `lib/data/players.ts` | Modify (Task 1) | Exports `QB_WEEKLY_NUMERIC` / `RECEIVER_WEEKLY_NUMERIC` / `RB_WEEKLY_NUMERIC`; QB list gains the two PR 2 columns |
| `__tests__/data/supabase-server.test.ts` | Create (Task 1) | `hasNoDatabase` cases |
| `__tests__/fixtures/box-score-buf-hou.ts` | Create (Task 2) | 2026_01_BUF_HOU golden fixture: `games` row, both `team_game_stats` rows, schedules, weekly rows, identities |
| `lib/stats/box-score.ts` | Create (Task 2) | Pure builders: formatting, records, scoreboard, comparison sections, notes, player tables |
| `__tests__/stats/box-score.test.ts` | Create (Task 2) | Every builder against the golden values + edge cases |
| `lib/data/games.ts` | Modify (Task 3) | `GameRecord`, `getGame(gameId)`, `getPlayedRegularSeasonGameIds(season)` |
| `lib/data/box-score.ts` | Create (Task 3) | `getBoxScoreSeasons`, `getTeamGameStats`, `getGamePlayerLines`, `getBoxScore`, `normalizeGameId`, `TEAM_GAME_NUMERIC` |
| `__tests__/data/games.test.ts`, `__tests__/data/box-score.test.ts` | Modify / Create (Task 3) | Fake-client tests for every read and every state |
| `components/game/Scoreboard.tsx`, `components/game/GameMessage.tsx` | Create (Task 4) | Tecmo scoreboard header; the message card for uncovered / pending games |
| `__tests__/components/game/Scoreboard.test.tsx` | Create (Task 4) | Scoreboard render |
| `components/ui/MetricTooltip.tsx` | Modify (Task 5) | Four box score definitions |
| `components/game/ComparisonSection.tsx` | Create (Task 5) | The `AWAY \| stat \| HOME` stat sheet with the dark 28/1fr/28 band |
| `__tests__/components/game/ComparisonSection.test.tsx`, `__tests__/components/MetricTooltip.test.tsx` | Create (Task 5) | Section render; the definitions exist |
| `components/game/PlayerTable.tsx` | Create (Task 6) | Passing / Rushing / Receiving tables |
| `__tests__/components/game/PlayerTable.test.tsx` | Create (Task 6) | Table + GameMessage render |
| `app/game/[game_id]/page.tsx`, `app/game/[game_id]/error.tsx` | Create (Task 7) | The page (states, metadata, layout) and its error boundary |
| `app/api/revalidate/route.ts` | Modify (Task 7) | `revalidatePath("/game", "layout")` |
| `__tests__/app/game-route.test.tsx` | Create (Task 7) | Every state, the golden render, metadata |
| `components/team/ScheduleSection.tsx`, `components/team/TeamHubContent.tsx`, `app/team/[team_id]/page.tsx` | Modify (Task 8) | Score line → box score link, gated by `boxScoreSeasons` |
| `__tests__/components/ScheduleSection.test.tsx`, `__tests__/app/team-route.test.tsx` | Modify / Create (Task 8) | Tile links; the page passes the gate down |
| `components/player/GameLogTab.tsx`, `components/player/PlayerPageContent.tsx`, `app/player/[slug]/page.tsx` | Modify (Task 9) | Result cell → box score link, gated by `boxScoreSeasons` |
| `__tests__/components/GameLogTab.test.tsx`, `__tests__/components/PlayerHeader.test.tsx`, `__tests__/app/player-route.test.ts` | Modify (Task 9) | Result links; existing renders pass the new prop |
| `app/sitemap.ts`, `__tests__/app/sitemap.test.ts` | Modify (Task 10) | Box score URLs for covered seasons |
| `memory/MEMORY.md`, `.claude/CLAUDE.md` | Modify (Task 14) | New memory section; data-fetching list gains `lib/data/box-score.ts` |

Out of scope: `/scores` and the homepage strip (PR 4, spec §8); percentile colouring; the 2020–2025 backfill; making `epaTextColor` null-safe (spec §13 follow-up — this plan wraps it); the Game Log's own columns; an OG image for game pages (`@vercel/og` cannot render on this machine).

---
### Task 1: Branch, plan commit, shared types, `hasNoDatabase` move

**Files:**
- Create: `docs/superpowers/plans/2026-09-16-box-scores-pr3-game-page.md` (this plan — already committed at `30557ed`; Step 1 only confirms it)
- Modify: `lib/types/index.ts` (`QBWeeklyStat` ends at line 241; `GameResultsByTeam` is line 367)
- Modify: `lib/supabase/server.ts` (17 lines; append)
- Modify: `app/page.tsx` (import block lines 2–10; `hasNoDatabase` block lines 23–37)
- Modify: `lib/data/players.ts` (the three numeric lists, lines 15–38)
- Test: `__tests__/data/supabase-server.test.ts` (create)

**Interfaces:**
- Consumes: nothing new — `parseNumericFields` (`lib/utils.ts`) is what the numeric lists feed.
- Produces:
  - `interface TeamGameStat` in `@/lib/types` — the 62 `team_game_stats` columns; NUMERIC columns typed `number | null`, counts `number`, `home_away: "home" | "away"`.
  - `interface PlayerIdentity { player_id: string; player_name: string; position: string; slug: string | null }` and `interface GamePlayerLines { qbs: QBWeeklyStat[]; receivers: ReceiverWeeklyStat[]; rbs: RBWeeklyStat[]; players: Record<string, PlayerIdentity> }` in `@/lib/types`.
  - `QBWeeklyStat.rush_epa_per_carry: number | null` and `QBWeeklyStat.rush_success_rate: number | null`.
  - `export function hasNoDatabase(): boolean` from `@/lib/supabase/server` (same body as before; `app/page.tsx` now imports it).
  - `export const QB_WEEKLY_NUMERIC`, `RECEIVER_WEEKLY_NUMERIC`, `RB_WEEKLY_NUMERIC` from `@/lib/data/players` (Task 3 reads the weekly tables with them).

- [ ] **Step 1: Confirm the branch and the already-committed plan**

```bash
git -C "C:/Users/jonra/OneDrive/Desktop/claude sandbox/football website/yards-per-pass" status --short --branch
```

Expected: `## box-scores-pr3` and no `M`/`??` lines. The branch already exists off `main` and the plan is already committed at `30557ed` — do **not** re-create the branch and do **not** re-commit the plan. If `git status` shows a different branch, run `git switch box-scores-pr3` first. Skip straight to Step 2.

- [ ] **Step 2: Write the failing test for `hasNoDatabase`**

Create `__tests__/data/supabase-server.test.ts`:

```ts
import { describe, it, expect, afterEach, vi } from "vitest";
import { hasNoDatabase } from "@/lib/supabase/server";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("hasNoDatabase", () => {
  it("is true for the CI placeholder URL (any case, trailing slash) and for no URL", () => {
    for (const url of ["https://placeholder.supabase.co", "HTTPS://PLACEHOLDER.SUPABASE.CO/", " https://placeholder.supabase.co ", ""]) {
      vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", url);
      expect(hasNoDatabase(), url).toBe(true);
    }
  });

  it("is false for a real project URL and for look-alikes", () => {
    for (const url of ["https://abcdefghijklmnop.supabase.co", "https://notplaceholder.supabase.co", "https://placeholder.supabase.co.example.com", "https://abc.supabase.co/?placeholder"]) {
      vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", url);
      expect(hasNoDatabase(), url).toBe(false);
    }
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

```bash
node "C:/Users/jonra/OneDrive/Desktop/claude sandbox/football website/yards-per-pass/node_modules/vitest/vitest.mjs" run --root "C:/Users/jonra/OneDrive/Desktop/claude sandbox/football website/yards-per-pass" __tests__/data/supabase-server.test.ts
```

Expected: FAIL — both tests throw `TypeError: hasNoDatabase is not a function` (the module does not export it yet).

- [ ] **Step 4: Move `hasNoDatabase` into `lib/supabase/server.ts`**

Append to the end of `lib/supabase/server.ts` (after `createServerClient`'s closing `}`):

```ts

/**
 * True when there is no real database behind the Supabase env vars: the fake
 * URL that .github/workflows/ci.yml (and the local build command in
 * memory/MEMORY.md) passes to `next build`, or no URL at all. Only then is an
 * empty page the right render (the homepage and the box score page both
 * check it before swallowing a data error). Next inlines NEXT_PUBLIC_* vars
 * when it compiles, so in a real build this is effectively fixed at build
 * time; only under vitest is the variable read again on each call.
 */
export function hasNoDatabase(): boolean {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  return !url || /^https?:\/\/placeholder\.supabase\.co(\/|$)/i.test(url.trim());
}
```

In `app/page.tsx`, change the import line

```ts
import { hasScheduleForSeason } from "@/lib/data/games";
```

to

```ts
import { hasScheduleForSeason } from "@/lib/data/games";
import { hasNoDatabase } from "@/lib/supabase/server";
```

and delete this whole block (lines 23–37, from the `No-database check` banner comment through the function's closing brace and the blank line after it):

```ts
/* ------------------------------------------------------------------ */
/*  No-database check — CI and local builds                            */
/* ------------------------------------------------------------------ */
/**
 * True when there is no real database behind the Supabase env vars: the fake
 * URL that .github/workflows/ci.yml (and the local build command in
 * memory/MEMORY.md) passes to `next build`, or no URL at all. Only then is an
 * empty homepage the right render. Next inlines NEXT_PUBLIC_* vars when it
 * compiles, so in a real build this is effectively fixed at build time; only
 * under vitest is the variable read again on each call.
 */
function hasNoDatabase(): boolean {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  return !url || /^https?:\/\/placeholder\.supabase\.co(\/|$)/i.test(url.trim());
}

```

Nothing else in `app/page.tsx` changes; the `catch` block still calls `hasNoDatabase()`.

- [ ] **Step 5: Add the types**

In `lib/types/index.ts`, inside `export interface QBWeeklyStat`, change

```ts
  rush_tds: number;
  fumbles: number;
  fumbles_lost: number;
}

export interface ReceiverWeeklyStat {
```

to

```ts
  rush_tds: number;
  /**
   * EPA per carry and success rate over exactly the carries `rush_attempts`
   * counts (designed runs + scrambles, kneels excluded) — box score spec
   * §10.1, added by PR 2. Null for a game with no carries, and on every row
   * ingested before PR 2 (2020–2025 until the backfill).
   */
  rush_epa_per_carry: number | null;
  rush_success_rate: number | null;
  fumbles: number;
  fumbles_lost: number;
}

export interface ReceiverWeeklyStat {
```

Then, directly after the line

```ts
export type GameResultsByTeam = Record<string, Record<number, GameResult>>;
```

insert:

```ts

/**
 * One team's row of `team_game_stats` for one game (box score spec §5), as
 * scripts/ingest.py's aggregate_team_game_stats writes it. Counts and yard
 * totals are 0 when the team had none, never null. The NUMERIC columns arrive
 * from PostgREST as strings and go through parseNumericFields, so they are
 * numbers or null: the rate columns are null when their denominator was 0,
 * the three epa_lost_* sums are 0 when there was nothing to lose, and
 * time_of_possession_seconds is null only when nflverse gave none of the
 * team's drives a clock. Every render of a nullable column guards
 * `val == null || Number.isNaN(val)`.
 */
export interface TeamGameStat {
  game_id: string;
  team_id: string;
  season: number;
  week: number;
  opponent_id: string;
  home_away: "home" | "away";
  // efficiency (nflfastR / rbsdm play set)
  plays: number;
  epa_per_play: number | null;
  success_rate: number | null;
  first_down_rate: number | null;
  pass_plays: number;
  pass_epa_per_play: number | null;
  pass_success_rate: number | null;
  pass_first_down_rate: number | null;
  rush_plays: number;
  rush_epa_per_play: number | null;
  rush_success_rate: number | null;
  rush_first_down_rate: number | null;
  early_plays: number;
  early_epa_per_play: number | null;
  early_success_rate: number | null;
  late_plays: number;
  late_epa_per_play: number | null;
  late_success_rate: number | null;
  explosive_plays: number;
  explosive_rate: number | null;
  explosive_pass: number;
  explosive_rush: number;
  // what it cost them (EPA sums)
  epa_lost_turnovers: number | null;
  epa_lost_sacks: number | null;
  epa_lost_penalties: number | null;
  // traditional (official box-score conventions)
  first_downs: number;
  first_downs_pass: number;
  first_downs_rush: number;
  first_downs_penalty: number;
  third_down_att: number;
  third_down_conv: number;
  fourth_down_att: number;
  fourth_down_conv: number;
  total_plays: number;
  total_yards: number;
  total_drives: number;
  yards_per_play: number | null;
  net_passing_yards: number;
  completions: number;
  attempts: number;
  yards_per_pass: number | null;
  interceptions: number;
  sacks: number;
  /** Stored positive (11 = eleven yards lost). */
  sack_yards: number;
  rushing_yards: number;
  rushing_attempts: number;
  yards_per_rush: number | null;
  red_zone_trips: number;
  red_zone_tds: number;
  penalties: number;
  penalty_yards: number;
  turnovers: number;
  fumbles_lost: number;
  def_st_tds: number;
  time_of_possession_seconds: number | null;
  /** Denominator for TGT% in the receiving table (spec §5). */
  team_targets: number;
}

/** What a player line needs from `player_slugs`: name, position tag and page link. */
export interface PlayerIdentity {
  player_id: string;
  player_name: string;
  position: string;
  slug: string | null;
}

/**
 * The weekly rows behind a box score's player tables (spec §6): both teams'
 * QB, receiver and RB rows for that season + week, plus the identity of every
 * player_id they name — the weekly tables store no name or position.
 */
export interface GamePlayerLines {
  qbs: QBWeeklyStat[];
  receivers: ReceiverWeeklyStat[];
  rbs: RBWeeklyStat[];
  players: Record<string, PlayerIdentity>;
}
```

- [ ] **Step 6: Export the weekly numeric lists and add the two QB columns**

In `lib/data/players.ts`, change

```ts
const QB_WEEKLY_NUMERIC = [
  "epa_per_dropback",
  "cpoe",
  "success_rate",
  "adot",
  "passer_rating",
  "ypa",
];
const RECEIVER_WEEKLY_NUMERIC = [
```

to

```ts
// Exported for lib/data/box-score.ts, which reads the same three tables by game.
export const QB_WEEKLY_NUMERIC = [
  "epa_per_dropback",
  "cpoe",
  "success_rate",
  "adot",
  "passer_rating",
  "ypa",
  "rush_epa_per_carry",
  "rush_success_rate",
];
export const RECEIVER_WEEKLY_NUMERIC = [
```

and change `const RB_WEEKLY_NUMERIC = [` to `export const RB_WEEKLY_NUMERIC = [`.

- [ ] **Step 7: Run the tests to verify they pass**

```bash
node "C:/Users/jonra/OneDrive/Desktop/claude sandbox/football website/yards-per-pass/node_modules/vitest/vitest.mjs" run --root "C:/Users/jonra/OneDrive/Desktop/claude sandbox/football website/yards-per-pass" __tests__/data/supabase-server.test.ts __tests__/app/home-page.test.tsx
```

Expected: PASS — 2 tests in `supabase-server.test.ts` and the 14 existing homepage tests (the placeholder-build cases still render the empty shell through the moved function).

- [ ] **Step 8: Type check and lint**

```bash
node "C:/Users/jonra/OneDrive/Desktop/claude sandbox/football website/yards-per-pass/node_modules/typescript/bin/tsc" --noEmit -p "C:/Users/jonra/OneDrive/Desktop/claude sandbox/football website/yards-per-pass/tsconfig.json"
```

Expected: no output, exit 0 (no test builds a full `QBWeeklyStat` literal, so the two new required fields break nothing).

```bash
npm --prefix "C:/Users/jonra/OneDrive/Desktop/claude sandbox/football website/yards-per-pass" run lint
```

Expected: only the four pre-existing warnings (`ComparisonTool.tsx`, `QBLeaderboard.tsx`, `RBLeaderboard.tsx`, `ReceiverLeaderboard.tsx`).

- [ ] **Step 9: Commit**

```bash
git -C "C:/Users/jonra/OneDrive/Desktop/claude sandbox/football website/yards-per-pass" add lib/types/index.ts lib/supabase/server.ts app/page.tsx lib/data/players.ts __tests__/data/supabase-server.test.ts
```

```bash
git -C "C:/Users/jonra/OneDrive/Desktop/claude sandbox/football website/yards-per-pass" commit -m "feat: box score types and a shared hasNoDatabase" -m "TeamGameStat (PR 2's 62 team_game_stats columns, NUMERICs nullable), PlayerIdentity and GamePlayerLines; QBWeeklyStat gains rush_epa_per_carry / rush_success_rate. hasNoDatabase moves from app/page.tsx to lib/supabase/server.ts so the box score page can share it (spec section 6). The weekly numeric-field lists are exported for the game reads." -m "Co-Authored-By: Claude <noreply@anthropic.com>"
```

---
### Task 2: Pure box score builders — formatting, records, scoreboard, comparison rows, notes, player tables

**Files:**
- Create: `__tests__/fixtures/box-score-buf-hou.ts` (the golden fixture, shared by Tasks 2–7)
- Create: `lib/stats/box-score.ts`
- Test: `__tests__/stats/box-score.test.ts` (create)

**Interfaces:**
- Consumes: `TeamGameStat`, `GamePlayerLines`, `PlayerIdentity`, `QBWeeklyStat`, `ReceiverWeeklyStat`, `RBWeeklyStat`, `TeamGame` from `@/lib/types` (Task 1); `EM_DASH`, `epaTextColor` from `@/lib/stats/formatters`; `getTeam`, `getTeamColor` from `@/lib/data/teams` (pure constants — safe in client code too).
- Produces (all exported from `@/lib/stats/box-score`, no Supabase import, importable from client and server alike):
  - `isNum(v: unknown): v is number`; `fmtFixed(v, decimals, signed?)`, `fmtSigned2`, `fmtSigned1`, `fmtDec1`, `fmtDec2`, `fmtInt`, `fmtSignedInt`, `fmtPct(v, decimals = 0)`, `fmtPair(a, b, sep = "-")`, `fmtClock(seconds)` — every one returns the em dash for null / undefined / NaN / Infinity; `MINUS` (U+2212); `epaCellClass(v): string` (grey for null/NaN, else `epaTextColor`).
  - `interface WinLossTie { wins; losses; ties }`, `recordThroughWeek(schedule: TeamGame[], week: number): WinLossTie`, `formatRecord(rec): string`.
  - `interface ScoreboardGame`, `interface ScoreboardTeam`, `interface ScoreboardModel`, `formatGameDate(gameday, weekday, today?)`, `gameLabel(game)`, `buildScoreboard(game, awayRecord, homeRecord, today?)`.
  - `type Side = "away" | "home"`, `interface StatCell { main; detail? }`, `interface ComparisonRow { key; label; labelDetail?; labelSuffix?; sub?; tooltip?; away; home; better: Side | null }`, `interface ComparisonSectionModel { key: "efficiency" | "team-stats" | "cost" | "downs"; title; rows }`, `betterSide(away, home, higherIsBetter, quantize?)`, `rate(num, den)`, `buildComparison(away: TeamGameStat, home: TeamGameStat): ComparisonSectionModel[]`.
  - `LEGEND_TEXT`, `STRIP_SACK_NOTE`, `playCountNote(away, home): string`, `receivingNote(lines, awayId, homeId): string`.
  - `interface PlayerCell { text; epa? }`, `interface PlayerTableRow { player_id; name; slug; position; cells }`, `interface PlayerTableTeam { team_id; color; note?; rows }`, `interface PlayerTableModel { key: "passing" | "rushing" | "receiving"; title; columns; teams }`, `buildPassingTable(lines, awayId, homeId)`, `buildRushingTable(lines, awayId, homeId)`, `buildReceivingTable(lines, awayId, homeId, teamTargets: Record<string, number | null | undefined>)`.
- The fixture (`__tests__/fixtures/box-score-buf-hou.ts`) exports `BUF_HOU_GAME` (typed with its own `PlayedGameFixture`, structurally identical to Task 3's `PlayedGame`, so this task type-checks on its own), `BUF_STATS`, `HOU_STATS`, `teamRow(over)`, `scheduleFor("BUF" | "HOU")`, `qb(...)`, `rec(...)`, `rb(...)`, `ALLEN`, `STROUD`, `BUF_HOU_LINES`. Tasks 3–7 import it.

- [ ] **Step 1: Create the golden fixture**

Create `__tests__/fixtures/box-score-buf-hou.ts`. The team rows carry the exact values PR 2's golden pytest pins (`GOLD` in `tests/test_team_game_stats.py`); the player rows are the weekly rows as the approved mockup shows them. Never edit a value here to make a test pass.

```ts
// __tests__/fixtures/box-score-buf-hou.ts — 2026_01_BUF_HOU, the golden game
// (box score spec §4, verified against rbsdm.com and ESPN). The team rows carry
// the exact values PR 2's golden pytest pins; the player rows are the weekly
// rows as the mockup shows them. Never edit a value here to make a test pass.
import type {
  GamePlayerLines,
  PlayerIdentity,
  QBWeeklyStat,
  RBWeeklyStat,
  ReceiverWeeklyStat,
  TeamGame,
  TeamGameStat,
} from "@/lib/types";

/** A `games` row with both scores present — the same shape as lib/data/box-score.ts's PlayedGame. */
export interface PlayedGameFixture {
  game_id: string;
  season: number;
  game_type: string;
  week: number;
  gameday: string | null;
  weekday: string | null;
  gametime: string | null;
  home_team: string;
  away_team: string;
  home_score: number;
  away_score: number;
}

export const BUF_HOU_GAME: PlayedGameFixture = {
  game_id: "2026_01_BUF_HOU",
  season: 2026,
  game_type: "REG",
  week: 1,
  gameday: "2026-09-13",
  weekday: "Sunday",
  gametime: "13:00",
  home_team: "HOU",
  away_team: "BUF",
  home_score: 31,
  away_score: 36,
};

/** A team_game_stats row with every column; overrides on top of BUF's. */
export function teamRow(over: Partial<TeamGameStat>): TeamGameStat {
  return { ...BUF_STATS, ...over };
}

export const BUF_STATS: TeamGameStat = {
  game_id: "2026_01_BUF_HOU",
  team_id: "BUF",
  season: 2026,
  week: 1,
  opponent_id: "HOU",
  home_away: "away",
  plays: 56,
  epa_per_play: 0.278,
  success_rate: 0.4107,
  first_down_rate: 0.3571,
  pass_plays: 37,
  pass_epa_per_play: 0.5557,
  pass_success_rate: 0.4595,
  pass_first_down_rate: 0.4324,
  rush_plays: 19,
  rush_epa_per_play: -0.2628,
  rush_success_rate: 0.3158,
  rush_first_down_rate: 0.2105,
  early_plays: 45,
  early_epa_per_play: 0.3013,
  early_success_rate: 0.4222,
  late_plays: 10,
  late_epa_per_play: 0.2955,
  late_success_rate: 0.4,
  explosive_plays: 8,
  explosive_rate: 8 / 56,
  explosive_pass: 5,
  explosive_rush: 3,
  epa_lost_turnovers: 0,
  epa_lost_sacks: -3.27,
  epa_lost_penalties: -8.52,
  first_downs: 20,
  first_downs_pass: 13,
  first_downs_rush: 5,
  first_downs_penalty: 2,
  third_down_att: 9,
  third_down_conv: 3,
  fourth_down_att: 1,
  fourth_down_conv: 0,
  total_plays: 52,
  total_yards: 409,
  total_drives: 12,
  yards_per_play: 409 / 52,
  net_passing_yards: 323,
  completions: 20,
  attempts: 29,
  yards_per_pass: 323 / 31,
  interceptions: 0,
  sacks: 2,
  sack_yards: 11,
  rushing_yards: 86,
  rushing_attempts: 21,
  yards_per_rush: 86 / 21,
  red_zone_trips: 3,
  red_zone_tds: 1,
  penalties: 10,
  penalty_yards: 85,
  turnovers: 0,
  fumbles_lost: 0,
  def_st_tds: 0,
  time_of_possession_seconds: 23 * 60 + 43,
  team_targets: 28,
};

export const HOU_STATS: TeamGameStat = {
  game_id: "2026_01_BUF_HOU",
  team_id: "HOU",
  season: 2026,
  week: 1,
  opponent_id: "BUF",
  home_away: "home",
  plays: 79,
  epa_per_play: 0.0713,
  success_rate: 0.481,
  first_down_rate: 0.3165,
  pass_plays: 48,
  pass_epa_per_play: 0.0977,
  pass_success_rate: 0.5208,
  pass_first_down_rate: 0.3333,
  rush_plays: 31,
  rush_epa_per_play: 0.0303,
  rush_success_rate: 0.4194,
  rush_first_down_rate: 0.2903,
  early_plays: 59,
  early_epa_per_play: 0.1003,
  early_success_rate: 0.4746,
  late_plays: 20,
  late_epa_per_play: -0.0144,
  late_success_rate: 0.5,
  explosive_plays: 8,
  explosive_rate: 8 / 79,
  explosive_pass: 4,
  explosive_rush: 4,
  epa_lost_turnovers: -7.0,
  epa_lost_sacks: -8.66,
  epa_lost_penalties: -9.69,
  first_downs: 26,
  first_downs_pass: 11,
  first_downs_rush: 10,
  first_downs_penalty: 5,
  third_down_att: 16,
  third_down_conv: 7,
  fourth_down_att: 2,
  fourth_down_conv: 2,
  total_plays: 73,
  total_yards: 381,
  total_drives: 11,
  yards_per_play: 381 / 73,
  net_passing_yards: 257,
  completions: 26,
  attempts: 38,
  yards_per_pass: 257 / 41,
  interceptions: 0,
  sacks: 3,
  sack_yards: 17,
  rushing_yards: 124,
  rushing_attempts: 32,
  yards_per_rush: 124 / 32,
  red_zone_trips: 5,
  red_zone_tds: 4,
  penalties: 7,
  penalty_yards: 106,
  turnovers: 2,
  fumbles_lost: 2,
  def_st_tds: 0,
  time_of_possession_seconds: 36 * 60 + 17,
  team_targets: 37,
};

/** The teams' `games` rows from each side, as getTeamSchedule returns them (week 1 only, plus an unplayed week 2). */
export function scheduleFor(team: "BUF" | "HOU"): TeamGame[] {
  const isBuf = team === "BUF";
  return [
    {
      game_id: "2026_01_BUF_HOU",
      season: 2026,
      game_type: "REG",
      week: 1,
      gameday: "2026-09-13",
      weekday: "Sunday",
      gametime: "13:00",
      home_team: "HOU",
      away_team: "BUF",
      home_score: 31,
      away_score: 36,
      opponent_id: isBuf ? "HOU" : "BUF",
      home_away: isBuf ? "away" : "home",
      played: true,
      result: isBuf ? "W" : "L",
      team_score: isBuf ? 36 : 31,
      opponent_score: isBuf ? 31 : 36,
    },
    {
      game_id: isBuf ? "2026_02_DET_BUF" : "2026_02_CIN_HOU",
      season: 2026,
      game_type: "REG",
      week: 2,
      gameday: isBuf ? "2026-09-17" : "2026-09-20",
      weekday: isBuf ? "Thursday" : "Sunday",
      gametime: isBuf ? "20:15" : "13:00",
      home_team: team,
      away_team: isBuf ? "DET" : "CIN",
      home_score: null,
      away_score: null,
      opponent_id: isBuf ? "DET" : "CIN",
      home_away: "home",
      played: false,
      result: null,
      team_score: null,
      opponent_score: null,
    },
  ];
}

const gameSide = (team: string) =>
  team === "BUF"
    ? { team_id: "BUF", opponent_id: "HOU", home_away: "away", result: "W", team_score: 36, opponent_score: 31 }
    : { team_id: "HOU", opponent_id: "BUF", home_away: "home", result: "L", team_score: 31, opponent_score: 36 };

export function qb(
  player_id: string,
  team: string,
  over: Partial<QBWeeklyStat>
): QBWeeklyStat {
  return {
    player_id,
    season: 2026,
    week: 1,
    ...gameSide(team),
    completions: 0,
    attempts: 0,
    passing_yards: 0,
    touchdowns: 0,
    interceptions: 0,
    sacks: 0,
    epa_per_dropback: 0,
    cpoe: 0,
    success_rate: 0,
    adot: 0,
    passer_rating: 0,
    ypa: 0,
    rush_attempts: 0,
    rush_yards: 0,
    rush_tds: 0,
    rush_epa_per_carry: null,
    rush_success_rate: null,
    fumbles: 0,
    fumbles_lost: 0,
    ...over,
  };
}

export function rec(
  player_id: string,
  team: string,
  targets: number,
  receptions: number,
  receiving_yards: number,
  receiving_tds: number,
  yac: number,
  epa_per_target: number,
  adot: number,
  over: Partial<ReceiverWeeklyStat> = {}
): ReceiverWeeklyStat {
  return {
    player_id,
    season: 2026,
    week: 1,
    ...gameSide(team),
    targets,
    receptions,
    receiving_yards,
    receiving_tds,
    epa_per_target,
    catch_rate: targets > 0 ? receptions / targets : 0,
    yac,
    yac_per_reception: receptions > 0 ? yac / receptions : 0,
    adot,
    air_yards: adot * targets,
    // No participation file for 2026: routes are NULL in the database.
    routes_run: null as unknown as number,
    yards_per_route_run: null as unknown as number,
    ...over,
  };
}

export function rb(
  player_id: string,
  team: string,
  carries: number,
  rushing_yards: number,
  rushing_tds: number,
  epa_per_carry: number,
  success_rate: number,
  over: Partial<RBWeeklyStat> = {}
): RBWeeklyStat {
  return {
    player_id,
    season: 2026,
    week: 1,
    ...gameSide(team),
    carries,
    rushing_yards,
    rushing_tds,
    epa_per_carry,
    success_rate,
    yards_per_carry: carries > 0 ? rushing_yards / carries : 0,
    stuff_rate: 0,
    explosive_rate: 0,
    targets: 0,
    receptions: 0,
    receiving_yards: 0,
    receiving_tds: 0,
    fumbles: 0,
    fumbles_lost: 0,
    ...over,
  };
}

function identity(player_id: string, player_name: string, position: string, slug: string): PlayerIdentity {
  return { player_id, player_name, position, slug };
}

export const ALLEN = "00-0034857";
export const STROUD = "00-0039163";

export const BUF_HOU_LINES: GamePlayerLines = {
  qbs: [
    qb(ALLEN, "BUF", {
      completions: 20, attempts: 29, passing_yards: 334, touchdowns: 2, interceptions: 0, sacks: 2,
      passer_rating: 130.5, epa_per_dropback: 0.5557, cpoe: 8.1, success_rate: 0.47, adot: 13.2, ypa: 11.5,
      rush_attempts: 5, rush_yards: 24, rush_tds: 2, rush_epa_per_carry: -0.4626, rush_success_rate: 0.4,
    }),
    qb(STROUD, "HOU", {
      completions: 26, attempts: 38, passing_yards: 274, touchdowns: 2, interceptions: 0, sacks: 3,
      passer_rating: 106.7, epa_per_dropback: 0.0977, cpoe: 3.2, success_rate: 0.5, adot: 8.5, ypa: 7.2,
      rush_attempts: 2, rush_yards: 15, rush_tds: 0, rush_epa_per_carry: 0.73, rush_success_rate: 0.5,
    }),
  ],
  receivers: [
    rec("00-0038557", "BUF", 6, 5, 130, 0, 38, 1.27, 16.3),
    rec("00-0033557", "BUF", 8, 5, 100, 1, 24, 0.8, 19.8),
    rec("00-0037248", "BUF", 6, 4, 40, 0, 15, 0.09, 6.5),
    rec("00-0036926", "BUF", 2, 1, 34, 1, 6, 2.06, 31.0),
    rec("00-0038545", "BUF", 4, 3, 12, 0, 14, -0.09, -1.0),
    rec("00-0035285", "BUF", 1, 1, 7, 0, 5, 0.29, 2.0),
    rec("00-0039062", "BUF", 1, 1, 1, 0, -3, 1.0, 4.0),
    rec("00-0036908", "HOU", 10, 7, 75, 1, 8, 0.49, 12.0),
    rec("00-0039911", "HOU", 2, 2, 53, 0, 27, 1.99, 13.0),
    rec("00-0034351", "HOU", 8, 4, 35, 0, 27, -0.32, 3.3),
    rec("00-0038995", "HOU", 6, 3, 32, 0, 21, 0.15, 9.5),
    rec("00-0038537", "HOU", 2, 1, 21, 0, 7, 0.21, 16.0),
    rec("00-0036212", "HOU", 3, 3, 19, 1, 14, 0.88, 1.7),
    rec("00-0040155", "HOU", 1, 1, 16, 0, 2, 1.05, 14.0),
    rec("00-0034426", "HOU", 2, 2, 15, 0, 8, 0.47, 3.5),
    rec("00-0039339", "HOU", 1, 1, 12, 0, 0, 0.73, 12.0),
    rec("00-0039864", "HOU", 1, 1, -2, 0, 0, -0.94, -2.0),
    rec("00-0039916", "HOU", 1, 1, -2, 0, 0, -1.37, -2.0),
  ],
  rbs: [
    rb("00-0038545", "BUF", 13, 57, 0, -0.01, 0.3846, { targets: 4, receptions: 3, receiving_yards: 12 }),
    rb("00-0039354", "BUF", 1, 3, 0, -0.15, 0),
    rb("00-0039352", "BUF", 1, 3, 0, -0.06, 0),
    rb("00-0036212", "HOU", 20, 60, 2, -0.02, 0.4, { targets: 3, receptions: 3, receiving_yards: 19, receiving_tds: 1 }),
    rb("00-0039916", "HOU", 9, 42, 0, 0.16, 0.4444, { targets: 1, receptions: 1, receiving_yards: -2 }),
  ],
  players: Object.fromEntries(
    [
      identity(ALLEN, "Josh Allen", "QB", "josh-allen"),
      identity(STROUD, "C.J. Stroud", "QB", "cj-stroud"),
      identity("00-0038557", "Dalton Kincaid", "TE", "dalton-kincaid"),
      identity("00-0033557", "DJ Moore", "WR", "dj-moore"),
      identity("00-0037248", "Khalil Shakir", "WR", "khalil-shakir"),
      identity("00-0036926", "Josh Palmer", "WR", "josh-palmer"),
      identity("00-0038545", "James Cook", "RB", "james-cook"),
      identity("00-0035285", "Dawson Knox", "TE", "dawson-knox"),
      identity("00-0039062", "Keon Coleman", "WR", "keon-coleman"),
      identity("00-0039354", "Ray Davis", "RB", "ray-davis"),
      identity("00-0039352", "Frank Gore Jr.", "RB", "frank-gore-jr"),
      identity("00-0036908", "Nico Collins", "WR", "nico-collins"),
      identity("00-0039911", "Jaylin Noel", "WR", "jaylin-noel"),
      identity("00-0034351", "Dalton Schultz", "TE", "dalton-schultz"),
      identity("00-0038995", "Xavier Hutchinson", "WR", "xavier-hutchinson"),
      identity("00-0038537", "Kayshon Boutte", "WR", "kayshon-boutte"),
      identity("00-0036212", "David Montgomery", "RB", "david-montgomery"),
      identity("00-0040155", "Marlin Klein", "TE", "marlin-klein"),
      identity("00-0034426", "Foster Moreau", "TE", "foster-moreau"),
      identity("00-0039339", "Jared Wayne", "WR", "jared-wayne"),
      identity("00-0039864", "Cade Stover", "TE", "cade-stover"),
      identity("00-0039916", "Woody Marks", "RB", "woody-marks"),
    ].map((p) => [p.player_id, p])
  ),
};
```

- [ ] **Step 2: Write the failing tests**

Create `__tests__/stats/box-score.test.ts`. The golden expectations are the brief's rendering values for 2026_01_BUF_HOU (spec §4 numbers as the mockup shows them); `[…, shaded side]` is the "better side" per row.

```ts
import { describe, it, expect } from "vitest";
import {
  fmtFixed,
  fmtSigned2,
  fmtSigned1,
  fmtDec1,
  fmtInt,
  fmtSignedInt,
  fmtPct,
  fmtPair,
  fmtClock,
  epaCellClass,
  recordThroughWeek,
  formatRecord,
  formatGameDate,
  gameLabel,
  buildScoreboard,
  betterSide,
  buildComparison,
  LEGEND_TEXT,
  playCountNote,
  receivingNote,
  buildPassingTable,
  buildRushingTable,
  buildReceivingTable,
  type ComparisonRow,
} from "@/lib/stats/box-score";
import type { GamePlayerLines, TeamGame } from "@/lib/types";
import {
  BUF_HOU_GAME,
  BUF_STATS,
  HOU_STATS,
  BUF_HOU_LINES,
  ALLEN,
  scheduleFor,
  teamRow,
  rec,
  qb,
} from "../fixtures/box-score-buf-hou";

const M = "\u2212"; // typographic minus
const DASH = "\u2014";

describe("number formatting", () => {
  it("prints a typographic minus and never a signed zero", () => {
    expect(fmtSigned2(0.278)).toBe("+0.28");
    expect(fmtSigned2(-0.2628)).toBe(`${M}0.26`);
    expect(fmtSigned2(0)).toBe("0.00");
    expect(fmtSigned2(-0.001)).toBe("0.00");
    expect(fmtDec1(-0.04)).toBe("0.0");
    expect(fmtDec1(-7)).toBe(`${M}7.0`);
    expect(fmtSigned1(8.1)).toBe("+8.1");
    expect(fmtInt(-3)).toBe(`${M}3`);
    expect(fmtInt(409)).toBe("409");
    expect(fmtSignedInt(2)).toBe("+2");
    expect(fmtSignedInt(0)).toBe("0");
    expect(fmtSignedInt(-2)).toBe(`${M}2`);
  });

  it("renders rates, pairs and clocks", () => {
    expect(fmtPct(0.4107)).toBe("41%");
    expect(fmtPct(6 / 28, 1)).toBe("21.4%");
    expect(fmtPct(0)).toBe("0%");
    expect(fmtPair(3, 9)).toBe("3-9");
    expect(fmtPair(20, 29, "/")).toBe("20/29");
    expect(fmtClock(23 * 60 + 43)).toBe("23:43");
    expect(fmtClock(68 * 60 + 26)).toBe("68:26");
    expect(fmtClock(5)).toBe("0:05");
    expect(fmtClock(-1)).toBe(DASH);
  });

  it("shows an em dash for null, undefined, NaN, Infinity and non-numbers", () => {
    for (const v of [null, undefined, NaN, Infinity, -Infinity]) {
      expect(fmtSigned2(v)).toBe(DASH);
      expect(fmtPct(v)).toBe(DASH);
      expect(fmtInt(v)).toBe(DASH);
      expect(fmtClock(v)).toBe(DASH);
    }
    expect(fmtPair(3, null)).toBe(DASH);
    expect(fmtFixed("12" as unknown as number, 1)).toBe(DASH);
  });

  it("colours EPA at the site's thresholds and greys out null/NaN (never amber)", () => {
    expect(epaCellClass(0.56)).toBe("text-green-700");
    expect(epaCellClass(0.02)).toBe("text-green-700");
    expect(epaCellClass(-0.01)).toBe("text-amber-600");
    expect(epaCellClass(-0.02)).toBe("text-amber-600");
    expect(epaCellClass(-0.46)).toBe("text-red-600");
    expect(epaCellClass(null)).toBe("text-gray-400");
    expect(epaCellClass(NaN)).toBe("text-gray-400");
    expect(epaCellClass(undefined)).toBe("text-gray-400");
  });
});

describe("records from the schedule (spec §6)", () => {
  it("counts played regular-season games through the week", () => {
    expect(recordThroughWeek(scheduleFor("BUF"), 1)).toEqual({ wins: 1, losses: 0, ties: 0 });
    expect(recordThroughWeek(scheduleFor("HOU"), 1)).toEqual({ wins: 0, losses: 1, ties: 0 });
  });

  it("ignores later weeks, playoff rows and unplayed games; ties count", () => {
    const [wk1, wk2] = scheduleFor("BUF");
    const played2: TeamGame = { ...wk2, played: true, result: "L", team_score: 20, opponent_score: 24, home_score: 20, away_score: 24 };
    const tie3: TeamGame = { ...played2, game_id: "2026_03_BUF_LAC", week: 3, opponent_id: "LAC", result: "T", team_score: 20, opponent_score: 20 };
    const playoff: TeamGame = { ...played2, game_id: "2026_19_BUF_MIA", week: 19, game_type: "WC", result: "W" };
    const all = [wk1, played2, tie3, playoff];
    expect(recordThroughWeek(all, 3)).toEqual({ wins: 1, losses: 1, ties: 1 });
    expect(recordThroughWeek(all, 2)).toEqual({ wins: 1, losses: 1, ties: 0 });
    expect(recordThroughWeek(all, 19)).toEqual({ wins: 1, losses: 1, ties: 1 });
    expect(recordThroughWeek([], 5)).toEqual({ wins: 0, losses: 0, ties: 0 });
  });

  it("formats the ties leg only when there is one", () => {
    expect(formatRecord({ wins: 1, losses: 0, ties: 0 })).toBe("1-0");
    expect(formatRecord({ wins: 9, losses: 7, ties: 1 })).toBe("9-7-1");
  });
});

describe("scoreboard model", () => {
  const today = new Date(2026, 8, 21);

  it("labels the week and date, and marks the winner", () => {
    const sb = buildScoreboard(BUF_HOU_GAME, { wins: 1, losses: 0, ties: 0 }, { wins: 0, losses: 1, ties: 0 }, today);
    expect(sb.label).toBe("WEEK 1");
    expect(sb.dateLabel).toBe("SUN SEP 13");
    expect(sb.away).toMatchObject({
      id: "BUF", abbreviation: "BUF", name: "Buffalo Bills", nickname: "Bills",
      record: "1-0", score: 36, winner: true, logo: "/logos/buf.png", primaryColor: "#00338D",
    });
    expect(sb.home).toMatchObject({ id: "HOU", nickname: "Texans", record: "0-1", score: 31, winner: false });
  });

  it("adds the year for another calendar year, tolerates bad dates and names playoff rounds", () => {
    expect(formatGameDate("2025-12-08", "Monday", today)).toBe("MON DEC 8, 2025");
    expect(formatGameDate(null, "Sunday", today)).toBe("SUN");
    expect(formatGameDate("garbage", null, today)).toBe("");
    expect(formatGameDate("2026-13-40", "Sun", today)).toBe("SUN");
    expect(gameLabel({ game_type: "WC", week: 19 })).toBe("WILD CARD");
    expect(gameLabel({ game_type: "SB", week: 22 })).toBe("SUPER BOWL");
    expect(gameLabel({ game_type: "REG", week: 7 })).toBe("WEEK 7");
  });

  it("marks neither score in a tie and copes with an unknown team id", () => {
    const sb = buildScoreboard(
      { ...BUF_HOU_GAME, home_score: 20, away_score: 20, away_team: "XYZ" },
      { wins: 0, losses: 0, ties: 1 },
      { wins: 0, losses: 0, ties: 1 },
      today
    );
    expect(sb.away.winner).toBe(false);
    expect(sb.home.winner).toBe(false);
    expect(sb.away).toMatchObject({ abbreviation: "XYZ", name: "XYZ", nickname: "XYZ", logo: "", record: "0-0-1" });
  });
});

/** "+0.28 (56)" — main value plus detail, the way a visitor reads the cell. */
function cell(c: { main: string; detail?: string }): string {
  return c.detail ? `${c.main} ${c.detail}` : c.main;
}

function rowsOf(sectionKey: string): ComparisonRow[] {
  const section = buildComparison(BUF_STATS, HOU_STATS).find((s) => s.key === sectionKey);
  if (!section) throw new Error(`no section ${sectionKey}`);
  return section.rows;
}

/** [key, BUF cell, HOU cell, shaded side] for one section. */
function flat(sectionKey: string): [string, string, string, string | null][] {
  return rowsOf(sectionKey).map((r) => [r.key, cell(r.away), cell(r.home), r.better]);
}

describe("comparison sections — 2026_01_BUF_HOU golden (spec §4 / mockup)", () => {
  it("lists the four sections in page order with their titles", () => {
    expect(buildComparison(BUF_STATS, HOU_STATS).map((s) => [s.key, s.title])).toEqual([
      ["efficiency", "Efficiency"],
      ["team-stats", "Team stats"],
      ["cost", "What it cost them"],
      ["downs", "Early vs late downs"],
    ]);
  });

  it("Efficiency", () => {
    expect(flat("efficiency")).toEqual([
      ["epa", "+0.28 (56)", "+0.07 (79)", "away"],
      ["epa-pass", "+0.56 (37)", "+0.10 (48)", "away"],
      ["epa-rush", `${M}0.26 (19)`, "+0.03 (31)", "home"],
      ["success", "41%", "48%", "home"],
      ["success-pass", "46%", "52%", "home"],
      ["success-rush", "32%", "42%", "home"],
      ["explosive", "8 (14%)", "8 (10%)", null],
      ["explosive-pass", "5 (14%)", "4 (8%)", "away"],
      ["explosive-rush", "3 (16%)", "4 (13%)", "home"],
      ["toxic", "+2 (TO +2, expl 0)", `${M}2 (TO ${M}2, expl 0)`, "away"],
    ]);
    // Spec §2's "8 (15%)" illustration is 8/52 (traditional plays); the stored
    // explosive_rate is 8/56 = 14%, per PR 2's GOLD. 14% is correct.
  });

  it("Efficiency labels, details, sub-rows and tooltips read as the mockup", () => {
    const rows = rowsOf("efficiency");
    const byKey = Object.fromEntries(rows.map((r) => [r.key, r]));
    expect(byKey.epa).toMatchObject({ label: "EPA / play", labelDetail: "(plays)", tooltip: "EPA / play" });
    expect(byKey["epa-pass"]).toMatchObject({ label: "Passing", sub: true });
    expect(byKey.success).toMatchObject({ label: "Success rate", tooltip: "Success rate" });
    expect(byKey.explosive).toMatchObject({ label: "Explosive plays", labelDetail: "(rate)", tooltip: "Explosive plays" });
    expect(byKey["explosive-pass"]).toMatchObject({ label: "Passing", labelDetail: "(20+ yd completion)", sub: true });
    expect(byKey["explosive-rush"]).toMatchObject({ label: "Rushing", labelDetail: "(10+ yd run)", sub: true });
    expect(byKey.toxic).toMatchObject({ label: "Toxic differential", labelDetail: "(turnovers + explosives)", tooltip: "Toxic differential" });
    expect(rows.filter((r) => r.tooltip).map((r) => r.tooltip)).toEqual(["EPA / play", "Success rate", "Explosive plays", "Toxic differential"]);
  });

  it("Team stats", () => {
    expect(flat("team-stats")).toEqual([
      ["first-downs", "20", "26", "home"],
      ["first-downs-pass", "13", "11", "away"],
      ["first-downs-rush", "5", "10", "home"],
      ["first-downs-penalty", "2", "5", "home"],
      ["third-down", "3-9", "7-16", "home"],
      ["fourth-down", "0-1", "2-2", "home"],
      ["total-plays", "52", "73", null],
      ["total-yards", "409", "381", "away"],
      ["total-drives", "12", "11", null],
      ["yards-per-play", "7.9", "5.2", "away"],
      ["passing", "323", "257", "away"],
      ["comp-att", "20/29", "26/38", null],
      ["yards-per-pass", "10.4", "6.3", "away"],
      ["interceptions", "0", "0", null],
      ["sacks", "2-11", "3-17", "away"],
      ["rushing", "86", "124", "home"],
      ["rushing-attempts", "21", "32", null],
      ["yards-per-rush", "4.1", "3.9", "away"],
      ["red-zone", "1-3", "4-5", "home"],
      ["penalties", "10-85", "7-106", null],
      ["turnovers", "0", "2", "away"],
      ["fumbles-lost", "0", "2", "away"],
      ["turnovers-int", "0", "0", null],
      ["def-st-tds", "0", "0", null],
      ["possession", "23:43", "36:17", null],
    ]);
    const labels = rowsOf("team-stats").map((r) => (r.sub ? "↳ " : "") + r.label + (r.labelDetail ? ` ${r.labelDetail}` : ""));
    expect(labels).toEqual([
      "1st downs", "↳ Passing 1st downs", "↳ Rushing 1st downs", "↳ 1st downs from penalties",
      "↳ 3rd down efficiency", "↳ 4th down efficiency", "Total plays", "Total yards", "Total drives",
      "Yards per play", "Passing", "↳ Comp/Att", "↳ Yards per pass", "↳ Interceptions thrown",
      "↳ Sacks-yards lost", "Rushing", "↳ Rushing attempts", "↳ Yards per rush", "Red zone (made-att)",
      "Penalties", "Turnovers", "↳ Fumbles lost", "↳ Interceptions thrown", "Defensive / special teams TDs", "Possession",
    ]);
  });

  it("What it cost them — less bad is better, one decimal", () => {
    expect(flat("cost")).toEqual([
      ["cost-turnovers", "0.0", `${M}7.0`, "away"],
      ["cost-sacks", `${M}3.3`, `${M}8.7`, "away"],
      ["cost-penalties", `${M}8.5`, `${M}9.7`, "away"],
    ]);
  });

  it("Early vs late downs", () => {
    expect(flat("downs")).toEqual([
      ["early-epa", "+0.30 (45)", "+0.10 (59)", "away"],
      ["early-success", "42%", "47%", "home"],
      ["late-epa", "+0.30 (10)", `${M}0.01 (20)`, "away"],
      ["late-success", "40%", "50%", "home"],
    ]);
    const early = rowsOf("downs")[0];
    expect(early).toMatchObject({ label: "Early downs", labelDetail: "(1st–2nd)", labelSuffix: "EPA / play" });
    expect(rowsOf("downs")[2]).toMatchObject({ label: "Late downs", labelDetail: "(3rd–4th)", labelSuffix: "EPA / play" });
  });
});

describe("comparison sections — edge cases", () => {
  it("never shades a row whose values read the same, or where a value is missing", () => {
    expect(betterSide(0.281, 0.279, true, (v) => Math.round(v * 100))).toBeNull();
    expect(betterSide(0.28, 0.07, true, (v) => Math.round(v * 100))).toBe("away");
    expect(betterSide(2, 0, false)).toBe("home");
    expect(betterSide(null, 3, true)).toBeNull();
    expect(betterSide(3, NaN, true)).toBeNull();
  });

  it("shows dashes and no shading when a rate column is null (a team with no rush plays)", () => {
    const home = teamRow({ team_id: "HOU", rush_plays: 0, rush_epa_per_play: null, rush_success_rate: null, yards_per_rush: null, explosive_rush: 0, rushing_attempts: 0, rushing_yards: 0 });
    const rows = buildComparison(BUF_STATS, home);
    const eff = Object.fromEntries(rows[0].rows.map((r) => [r.key, r]));
    expect(cell(eff["epa-rush"].home)).toBe(`${DASH} (0)`);
    expect(eff["epa-rush"].better).toBeNull();
    expect(cell(eff["success-rush"].home)).toBe(DASH);
    expect(cell(eff["explosive-rush"].home)).toBe(`0 (${DASH})`);
    const team = Object.fromEntries(rows[1].rows.map((r) => [r.key, r]));
    expect(cell(team["yards-per-rush"].home)).toBe(DASH);
    expect(team["yards-per-rush"].better).toBeNull();
  });

  it("breaks a sacks tie on yards lost, and leaves 0-attempt made-att rows unshaded", () => {
    const home = teamRow({ team_id: "HOU", sacks: 2, sack_yards: 17, fourth_down_att: 0, fourth_down_conv: 0, red_zone_trips: 0, red_zone_tds: 0 });
    const team = Object.fromEntries(buildComparison(BUF_STATS, home)[1].rows.map((r) => [r.key, r]));
    expect(team.sacks.better).toBe("away");
    expect(cell(team["fourth-down"].home)).toBe("0-0");
    expect(team["fourth-down"].better).toBeNull();
    expect(team["red-zone"].better).toBeNull();
    const same = Object.fromEntries(buildComparison(BUF_STATS, teamRow({ team_id: "HOU" }))[1].rows.map((r) => [r.key, r]));
    expect(same.sacks.better).toBeNull();
  });

  it("toxic differential shows a dash when a turnover count is missing", () => {
    const home = teamRow({ team_id: "HOU", turnovers: null as unknown as number });
    const eff = Object.fromEntries(buildComparison(BUF_STATS, home)[0].rows.map((r) => [r.key, r]));
    expect(eff.toxic.away.main).toBe(DASH);
    expect(eff.toxic.away.detail).toBeUndefined();
    expect(eff.toxic.better).toBeNull();
  });

  it("possession clocks a null as a dash and never shades", () => {
    const home = teamRow({ team_id: "HOU", time_of_possession_seconds: null });
    const team = Object.fromEntries(buildComparison(BUF_STATS, home)[1].rows.map((r) => [r.key, r]));
    expect(cell(team.possession.home)).toBe(DASH);
    expect(team.possession.better).toBeNull();
  });
});

describe("on-page notes (spec §12) come from the game's own numbers", () => {
  it("explains the three play counts with the away team's figures", () => {
    const note = playCountNote(BUF_STATS, HOU_STATS);
    expect(note).toContain("so BUF has 56 plays there and 52 in the official total above");
    expect(note).toContain("which is why BUF shows 21 attempts and 19 rush plays");
  });

  it("picks the team whose counts differ when the away team's match", () => {
    const away = teamRow({ plays: 52, rush_plays: 21 });
    expect(playCountNote(away, HOU_STATS)).toContain("HOU has 79 plays there and 73");
  });

  it("names the uncredited passing yards (Allen's lateral) and the rushing-table gap", () => {
    const note = receivingNote(BUF_HOU_LINES, "BUF", "HOU");
    expect(note).toContain("10 of Josh Allen\u2019s 334 passing yards aren\u2019t credited to a receiver above");
    expect(note).not.toContain("Stroud");
    expect(note.endsWith("runs by receivers and kneel-downs don\u2019t appear in the rushing table.")).toBe(true);
  });

  it("falls back to a generic sentence when every yard is credited", () => {
    const lines: GamePlayerLines = { ...BUF_HOU_LINES, qbs: [qb(ALLEN, "BUF", { passing_yards: 324 })] };
    expect(receivingNote(lines, "BUF", "HOU")).toBe(
      "Yards gained after a lateral belong to no receiver, and runs by receivers and kneel-downs don\u2019t appear in the rushing table."
    );
  });
});

const texts = (table: ReturnType<typeof buildPassingTable>, team: string) =>
  table.teams.find((t) => t.team_id === team)!.rows.map((r) => [r.name, r.position, ...r.cells.map((c) => c.text)]);

describe("player tables — 2026_01_BUF_HOU golden (mockup)", () => {
  it("Passing: both QBs, away team first, no position tag", () => {
    const table = buildPassingTable(BUF_HOU_LINES, "BUF", "HOU");
    expect(table.columns).toEqual(["Player", "C/ATT", "YDS", "TD", "INT", "SCK", "RTG", "EPA/DB", "CPOE", "SUCC%", "aDOT"]);
    expect(table.teams.map((t) => t.team_id)).toEqual(["BUF", "HOU"]);
    expect(table.teams[0].color).toBe("#00338D");
    expect(texts(table, "BUF")).toEqual([["Josh Allen", null, "20/29", "334", "2", "0", "2", "130.5", "+0.56", "+8.1", "47%", "13.2"]]);
    expect(texts(table, "HOU")).toEqual([["C.J. Stroud", null, "26/38", "274", "2", "0", "3", "106.7", "+0.10", "+3.2", "50%", "8.5"]]);
    expect(table.teams[0].rows[0].slug).toBe("josh-allen");
    expect(table.teams[0].rows[0].cells[6]).toEqual({ text: "+0.56", epa: 0.5557 });
  });

  it("Rushing: RBs plus QB carries, sorted by yards with a stable tiebreak", () => {
    const table = buildRushingTable(BUF_HOU_LINES, "BUF", "HOU");
    expect(table.columns).toEqual(["Player", "CAR", "YDS", "TD", "YPC", "EPA/CAR", "SUCC%"]);
    expect(texts(table, "BUF")).toEqual([
      ["James Cook", "RB", "13", "57", "0", "4.4", `${M}0.01`, "38%"],
      ["Josh Allen", "QB", "5", "24", "2", "4.8", `${M}0.46`, "40%"],
      // 3 yards on 1 carry each: name A→Z decides.
      ["Frank Gore Jr.", "RB", "1", "3", "0", "3.0", `${M}0.06`, "0%"],
      ["Ray Davis", "RB", "1", "3", "0", "3.0", `${M}0.15`, "0%"],
    ]);
    expect(texts(table, "HOU")).toEqual([
      ["David Montgomery", "RB", "20", "60", "2", "3.0", `${M}0.02`, "40%"],
      ["Woody Marks", "RB", "9", "42", "0", "4.7", "+0.16", "44%"],
      ["C.J. Stroud", "QB", "2", "15", "0", "7.5", "+0.73", "50%"],
    ]);
  });

  it("Receiving: team targets in the sub-header, TGT% by team targets, Y/TGT, no YPRR without routes", () => {
    const table = buildReceivingTable(BUF_HOU_LINES, "BUF", "HOU", { BUF: 28, HOU: 37 });
    expect(table.columns).toEqual(["Player", "TGT", "REC", "YDS", "TD", "TGT%", "YAC", "EPA/TGT", "CATCH%", "aDOT", "Y/TGT"]);
    expect(table.teams.map((t) => t.note)).toEqual(["28 team targets", "37 team targets"]);
    expect(texts(table, "BUF")).toEqual([
      ["Dalton Kincaid", "TE", "6", "5", "130", "0", "21.4%", "38", "+1.27", "83%", "16.3", "21.7"],
      ["DJ Moore", "WR", "8", "5", "100", "1", "28.6%", "24", "+0.80", "63%", "19.8", "12.5"],
      ["Khalil Shakir", "WR", "6", "4", "40", "0", "21.4%", "15", "+0.09", "67%", "6.5", "6.7"],
      ["Josh Palmer", "WR", "2", "1", "34", "1", "7.1%", "6", "+2.06", "50%", "31.0", "17.0"],
      ["James Cook", "RB", "4", "3", "12", "0", "14.3%", "14", `${M}0.09`, "75%", `${M}1.0`, "3.0"],
      ["Dawson Knox", "TE", "1", "1", "7", "0", "3.6%", "5", "+0.29", "100%", "2.0", "7.0"],
      ["Keon Coleman", "WR", "1", "1", "1", "0", "3.6%", `${M}3`, "+1.00", "100%", "4.0", "1.0"],
    ]);
    expect(texts(table, "HOU")).toEqual([
      ["Nico Collins", "WR", "10", "7", "75", "1", "27.0%", "8", "+0.49", "70%", "12.0", "7.5"],
      ["Jaylin Noel", "WR", "2", "2", "53", "0", "5.4%", "27", "+1.99", "100%", "13.0", "26.5"],
      ["Dalton Schultz", "TE", "8", "4", "35", "0", "21.6%", "27", `${M}0.32`, "50%", "3.3", "4.4"],
      ["Xavier Hutchinson", "WR", "6", "3", "32", "0", "16.2%", "21", "+0.15", "50%", "9.5", "5.3"],
      ["Kayshon Boutte", "WR", "2", "1", "21", "0", "5.4%", "7", "+0.21", "50%", "16.0", "10.5"],
      ["David Montgomery", "RB", "3", "3", "19", "1", "8.1%", "14", "+0.88", "100%", "1.7", "6.3"],
      ["Marlin Klein", "TE", "1", "1", "16", "0", "2.7%", "2", "+1.05", "100%", "14.0", "16.0"],
      ["Foster Moreau", "TE", "2", "2", "15", "0", "5.4%", "8", "+0.47", "100%", "3.5", "7.5"],
      ["Jared Wayne", "WR", "1", "1", "12", "0", "2.7%", "0", "+0.73", "100%", "12.0", "12.0"],
      ["Cade Stover", "TE", "1", "1", `${M}2`, "0", "2.7%", "0", `${M}0.94`, "100%", `${M}2.0`, `${M}2.0`],
      ["Woody Marks", "RB", "1", "1", `${M}2`, "0", "2.7%", "0", `${M}1.37`, "100%", `${M}2.0`, `${M}2.0`],
    ]);
  });
});

describe("player tables — edge cases", () => {
  it("shows YPRR only when any row in the game has route data", () => {
    const withRoutes: GamePlayerLines = {
      ...BUF_HOU_LINES,
      receivers: [
        rec("00-0038557", "BUF", 6, 5, 130, 0, 38, 1.27, 16.3, { routes_run: 30, yards_per_route_run: 130 / 30 }),
        rec("00-0036908", "HOU", 10, 7, 75, 1, 8, 0.49, 12.0),
      ],
    };
    const table = buildReceivingTable(withRoutes, "BUF", "HOU", { BUF: 28, HOU: 37 });
    expect(table.columns[table.columns.length - 1]).toBe("YPRR");
    expect(texts(table, "BUF")[0].slice(-1)).toEqual(["4.33"]);
    expect(texts(table, "HOU")[0].slice(-1)).toEqual([DASH]);
  });

  it("null EPA (a 2025 QB row before the backfill) renders a dash with a null epa, and a missing team target count blanks TGT%", () => {
    const lines: GamePlayerLines = {
      ...BUF_HOU_LINES,
      qbs: [qb(ALLEN, "BUF", { rush_attempts: 5, rush_yards: 24, rush_epa_per_carry: null, rush_success_rate: null })],
    };
    const rushing = buildRushingTable(lines, "BUF", "HOU");
    const allen = rushing.teams[0].rows.find((r) => r.player_id === ALLEN)!;
    expect(allen.cells[4]).toEqual({ text: DASH, epa: null });
    expect(allen.cells[5].text).toBe(DASH);
    const receiving = buildReceivingTable(BUF_HOU_LINES, "BUF", "HOU", { BUF: null, HOU: 0 });
    expect(receiving.teams.map((t) => t.note)).toEqual([undefined, undefined]);
    expect(receiving.teams[0].rows[0].cells[4].text).toBe(DASH);
  });

  it("leaves out QBs and RBs without a carry, and falls back to the id for an unknown player", () => {
    const lines: GamePlayerLines = {
      qbs: [qb(ALLEN, "BUF", { rush_attempts: 0 })],
      receivers: [],
      rbs: [
        { ...BUF_HOU_LINES.rbs[0], player_id: "00-0099999", carries: 0 },
        { ...BUF_HOU_LINES.rbs[1], player_id: "00-0088888" },
      ],
      players: {},
    };
    const table = buildRushingTable(lines, "BUF", "HOU");
    expect(table.teams[0].rows.map((r) => [r.name, r.slug, r.position])).toEqual([["00-0088888", null, "RB"]]);
    expect(table.teams[1].rows).toEqual([]);
    expect(buildPassingTable(lines, "BUF", "HOU").teams[0].rows[0]).toMatchObject({ name: "00-0034857", slug: null });
  });

  it("copes with empty lines", () => {
    const empty: GamePlayerLines = { qbs: [], receivers: [], rbs: [], players: {} };
    expect(buildPassingTable(empty, "BUF", "HOU").teams.map((t) => t.rows.length)).toEqual([0, 0]);
    expect(buildRushingTable(empty, "BUF", "HOU").teams.map((t) => t.rows.length)).toEqual([0, 0]);
    expect(buildReceivingTable(empty, "BUF", "HOU", {}).columns).toHaveLength(11);
    expect(receivingNote(empty, "BUF", "HOU")).toContain("Yards gained after a lateral");
    expect(LEGEND_TEXT).toContain("team pages");
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

```bash
node "C:/Users/jonra/OneDrive/Desktop/claude sandbox/football website/yards-per-pass/node_modules/vitest/vitest.mjs" run --root "C:/Users/jonra/OneDrive/Desktop/claude sandbox/football website/yards-per-pass" __tests__/stats/box-score.test.ts
```

Expected: FAIL — the file cannot load: `Error: Failed to resolve import "@/lib/stats/box-score" from "__tests__/stats/box-score.test.ts". Does the file exist?` (0 tests run).

- [ ] **Step 4: Implement the builders**

Create `lib/stats/box-score.ts`:

```ts
// lib/stats/box-score.ts — pure builders for the box score page (spec §6).
//
// No Supabase here: the page's server component, its components and the tests
// all import this module. Every number comes from team_game_stats and the
// weekly player tables exactly as scripts/ingest.py wrote them; the only
// arithmetic is presentation the spec defines from stored columns (toxic
// differential, the pass/rush explosive rates, target share, Y/TGT, a QB's
// yards per carry) and the records counted from the schedule.
import type {
  GamePlayerLines,
  QBWeeklyStat,
  RBWeeklyStat,
  ReceiverWeeklyStat,
  TeamGame,
  TeamGameStat,
} from "@/lib/types";
import { EM_DASH, epaTextColor } from "@/lib/stats/formatters";
import { getTeam, getTeamColor } from "@/lib/data/teams";

/* ─── Numbers ─── */

/** Typographic minus for negatives — the approved mockup's "−0.26". */
export const MINUS = "\u2212";

/**
 * A number a visitor can read. parseNumericFields turns a stored "NaN" into
 * null and leaves NULL as null, so every guard is `val == null ||
 * Number.isNaN(val)` — an isNaN-only check lets null through to .toFixed()
 * (the 2026-09-11 F1 crash). Infinity is excluded too.
 */
export function isNum(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

/**
 * Fixed decimals with a real minus sign. A value that rounds to zero prints
 * unsigned ("0.0", never "-0.0" or "+0.00"); `signed` adds "+" to positives.
 */
export function fmtFixed(v: number | null | undefined, decimals: number, signed = false): string {
  if (!isNum(v)) return EM_DASH;
  const abs = Math.abs(v).toFixed(decimals);
  if (Number(abs) === 0) return abs;
  if (v < 0) return `${MINUS}${abs}`;
  return signed ? `+${abs}` : abs;
}

export const fmtSigned2 = (v: number | null | undefined): string => fmtFixed(v, 2, true);
export const fmtSigned1 = (v: number | null | undefined): string => fmtFixed(v, 1, true);
export const fmtDec1 = (v: number | null | undefined): string => fmtFixed(v, 1);
export const fmtDec2 = (v: number | null | undefined): string => fmtFixed(v, 2);
export const fmtInt = (v: number | null | undefined): string =>
  isNum(v) ? fmtFixed(Math.round(v), 0) : EM_DASH;
export const fmtSignedInt = (v: number | null | undefined): string =>
  isNum(v) ? fmtFixed(Math.round(v), 0, true) : EM_DASH;

/** A 0–1 rate as a percentage: 0.4107 → "41%"; 0.2142 → "21.4%" with one decimal. */
export const fmtPct = (v: number | null | undefined, decimals = 0): string =>
  isNum(v) ? `${fmtFixed(v * 100, decimals)}%` : EM_DASH;

/** "3-9", "2-11", "20/29" — two whole numbers joined. */
export const fmtPair = (
  a: number | null | undefined,
  b: number | null | undefined,
  sep = "-"
): string => (isNum(a) && isNum(b) ? `${fmtInt(a)}${sep}${fmtInt(b)}` : EM_DASH);

/** Seconds → "23:43"; the minutes run past 59 in overtime ("68:26"). */
export function fmtClock(seconds: number | null | undefined): string {
  if (!isNum(seconds) || seconds < 0) return EM_DASH;
  const s = Math.round(seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/**
 * Tailwind text colour for an EPA cell at the site's thresholds (≥ +0.02
 * green, ≥ −0.02 amber, else red). null / NaN → grey, never amber:
 * epaTextColor guards isNaN only, and isNaN(null) is false (spec §6).
 */
export function epaCellClass(v: number | null | undefined): string {
  return isNum(v) ? epaTextColor(v) : "text-gray-400";
}

/* ─── Records (spec §6: `games` stores no record column) ─── */

export interface WinLossTie {
  wins: number;
  losses: number;
  ties: number;
}

/**
 * A team's record through `week` of one regular season, counted from its
 * `games` rows: played REG games with a week at or before `week`. Playoff
 * rows and later weeks are ignored, so a playoff game shows the full
 * regular-season record.
 */
export function recordThroughWeek(schedule: TeamGame[], week: number): WinLossTie {
  const rec: WinLossTie = { wins: 0, losses: 0, ties: 0 };
  for (const g of schedule ?? []) {
    if (!g || g.game_type !== "REG" || !g.played || !isNum(g.week) || g.week > week) continue;
    if (g.result === "W") rec.wins += 1;
    else if (g.result === "L") rec.losses += 1;
    else if (g.result === "T") rec.ties += 1;
  }
  return rec;
}

/** "1-0", "9-7-1" — the ties leg only once there is one (site convention). */
export function formatRecord(rec: WinLossTie): string {
  return rec.ties > 0 ? `${rec.wins}-${rec.losses}-${rec.ties}` : `${rec.wins}-${rec.losses}`;
}

/* ─── Scoreboard ─── */

/** The `games` row fields the scoreboard reads (lib/data/games.ts's GameRecord, once played). */
export interface ScoreboardGame {
  game_id: string;
  season: number;
  game_type: string;
  week: number;
  gameday: string | null;
  weekday: string | null;
  home_team: string;
  away_team: string;
  home_score: number;
  away_score: number;
}

export interface ScoreboardTeam {
  id: string;
  abbreviation: string;
  name: string;
  /** "Bills" — the last word of the team name. */
  nickname: string;
  logo: string;
  primaryColor: string;
  secondaryColor: string;
  score: number;
  /** Record after this game, e.g. "1-0". */
  record: string;
  winner: boolean;
}

export interface ScoreboardModel {
  /** "WEEK 1", or the playoff round. */
  label: string;
  /** "SUN SEP 13" ("MON DEC 8, 2025" for another calendar year); "" when unknown. */
  dateLabel: string;
  away: ScoreboardTeam;
  home: ScoreboardTeam;
}

const ROUND_LABELS: Record<string, string> = {
  WC: "WILD CARD",
  DIV: "DIVISIONAL",
  CON: "CONFERENCE CHAMPIONSHIP",
  SB: "SUPER BOWL",
};

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

/**
 * "SUN SEP 13" from the schedule's weekday and ISO gameday. The date is parsed
 * by hand: `new Date("2026-09-13")` is UTC midnight and reads as the previous
 * day west of London (ScheduleSection carries the same guard). The year is
 * appended when the game was played in another calendar year than `today`.
 */
export function formatGameDate(gameday: string | null, weekday: string | null, today: Date = new Date()): string {
  const parts: string[] = [];
  const day = String(weekday ?? "").trim().slice(0, 3).toUpperCase();
  if (day) parts.push(day);
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(gameday ?? "").trim());
  if (m) {
    const year = Number(m[1]);
    const month = Number(m[2]);
    const d = Number(m[3]);
    if (month >= 1 && month <= 12 && d >= 1 && d <= 31) {
      parts.push(`${MONTHS[month - 1]} ${d}${year !== today.getFullYear() ? `, ${year}` : ""}`);
    }
  }
  return parts.join(" ");
}

/** "WEEK 1" for the regular season; the round name ("WILD CARD") for playoffs. */
export function gameLabel(game: Pick<ScoreboardGame, "game_type" | "week">): string {
  const type = String(game.game_type ?? "REG").toUpperCase();
  return type === "REG" ? `WEEK ${fmtInt(game.week)}` : (ROUND_LABELS[type] ?? type);
}

function scoreboardTeam(id: string, score: number, record: WinLossTie, winner: boolean): ScoreboardTeam {
  const team = getTeam(id);
  const name = team?.name ?? id;
  return {
    id,
    abbreviation: team?.abbreviation ?? id,
    name,
    nickname: name.split(" ").pop() ?? name,
    logo: team?.logo ?? "",
    primaryColor: team?.primaryColor ?? "#0f172a",
    secondaryColor: team?.secondaryColor ?? "#334155",
    score,
    record: formatRecord(record),
    winner,
  };
}

/** Scoreboard model for a played game; a tie leaves neither score in gold. */
export function buildScoreboard(
  game: ScoreboardGame,
  awayRecord: WinLossTie,
  homeRecord: WinLossTie,
  today: Date = new Date()
): ScoreboardModel {
  return {
    label: gameLabel(game),
    dateLabel: formatGameDate(game.gameday, game.weekday, today),
    away: scoreboardTeam(game.away_team, game.away_score, awayRecord, game.away_score > game.home_score),
    home: scoreboardTeam(game.home_team, game.home_score, homeRecord, game.home_score > game.away_score),
  };
}

/* ─── Team comparison sections ─── */

export type Side = "away" | "home";

export interface StatCell {
  /** "+0.28", "41%", "3-9", "23:43" */
  main: string;
  /** Muted detail after the value: "(56)", "(TO +2, expl 0)". */
  detail?: string;
}

export interface ComparisonRow {
  key: string;
  label: string;
  /** Muted text after the label: "(plays)", "(1st–2nd)". */
  labelDetail?: string;
  /** Plain text after the detail: the "EPA / play" of "Early downs (1st–2nd) EPA / play". */
  labelSuffix?: string;
  /** Sub-row: "↳ " prefix and lighter type. */
  sub?: boolean;
  /** MetricTooltip key when the row has an info tooltip. */
  tooltip?: string;
  away: StatCell;
  home: StatCell;
  /** The shaded side; null when equal, missing, or the row has no better side. */
  better: Side | null;
}

export interface ComparisonSectionModel {
  key: "efficiency" | "team-stats" | "cost" | "downs";
  title: string;
  rows: ComparisonRow[];
}

type Quantize = (v: number) => number;
const Q_INT: Quantize = (v) => Math.round(v);
const Q_DEC1: Quantize = (v) => Math.round(v * 10);
const Q_DEC2: Quantize = (v) => Math.round(v * 100);
const Q_PCT0: Quantize = (v) => Math.round(v * 100);

/**
 * Which side is better, compared at the precision the cell shows (`q`), so two
 * cells that read the same are never shaded apart. null when either value is
 * missing or they are equal.
 */
export function betterSide(
  away: number | null | undefined,
  home: number | null | undefined,
  higherIsBetter: boolean,
  q: Quantize = Q_INT
): Side | null {
  if (!isNum(away) || !isNum(home)) return null;
  const a = q(away);
  const h = q(home);
  if (a === h) return null;
  return a > h === higherIsBetter ? "away" : "home";
}

/** numerator ÷ denominator, or null when the denominator is missing or 0. */
export function rate(
  numerator: number | null | undefined,
  denominator: number | null | undefined
): number | null {
  return isNum(numerator) && isNum(denominator) && denominator > 0 ? numerator / denominator : null;
}

type Get = (t: TeamGameStat) => number | null | undefined;
type RowOpts = Partial<Pick<ComparisonRow, "labelDetail" | "labelSuffix" | "sub" | "tooltip">>;

/**
 * The four comparison sections in page order (spec §6), every row labelled
 * as the approved mockup has it. Higher is better for EPA, rates, yards and
 * first downs; lower for turnovers, interceptions, sacks and the "EPA lost
 * to" rows (less bad is better); plays, drives, attempts, penalties and
 * possession have no better side.
 */
export function buildComparison(away: TeamGameStat, home: TeamGameStat): ComparisonSectionModel[] {
  const a = away;
  const h = home;

  const epa = (key: string, label: string, value: Get, plays: Get, opts: RowOpts = {}): ComparisonRow => ({
    key,
    label,
    ...opts,
    away: { main: fmtSigned2(value(a)), detail: `(${fmtInt(plays(a))})` },
    home: { main: fmtSigned2(value(h)), detail: `(${fmtInt(plays(h))})` },
    better: betterSide(value(a), value(h), true, Q_DEC2),
  });
  const pct = (key: string, label: string, value: Get, opts: RowOpts = {}): ComparisonRow => ({
    key,
    label,
    ...opts,
    away: { main: fmtPct(value(a)) },
    home: { main: fmtPct(value(h)) },
    better: betterSide(value(a), value(h), true, Q_PCT0),
  });
  const count = (
    key: string,
    label: string,
    value: Get,
    higherIsBetter: boolean | null,
    opts: RowOpts = {}
  ): ComparisonRow => ({
    key,
    label,
    ...opts,
    away: { main: fmtInt(value(a)) },
    home: { main: fmtInt(value(h)) },
    better: higherIsBetter === null ? null : betterSide(value(a), value(h), higherIsBetter),
  });
  const dec1 = (key: string, label: string, value: Get, opts: RowOpts = {}): ComparisonRow => ({
    key,
    label,
    ...opts,
    away: { main: fmtDec1(value(a)) },
    home: { main: fmtDec1(value(h)) },
    better: betterSide(value(a), value(h), true, Q_DEC1),
  });
  const madeAtt = (key: string, label: string, made: Get, att: Get, opts: RowOpts = {}): ComparisonRow => ({
    key,
    label,
    ...opts,
    away: { main: fmtPair(made(a), att(a)) },
    home: { main: fmtPair(made(h), att(h)) },
    better: betterSide(rate(made(a), att(a)), rate(made(h), att(h)), true, Q_PCT0),
  });
  const text = (
    key: string,
    label: string,
    value: (t: TeamGameStat) => string,
    better: Side | null,
    opts: RowOpts = {}
  ): ComparisonRow => ({
    key,
    label,
    ...opts,
    away: { main: value(a) },
    home: { main: value(h) },
    better,
  });
  // Explosive rows compare the count; the split rates divide by that split's plays.
  const explosive = (
    key: string,
    label: string,
    n: Get,
    explosiveRate: (t: TeamGameStat) => number | null,
    opts: RowOpts = {}
  ): ComparisonRow => ({
    key,
    label,
    ...opts,
    away: { main: fmtInt(n(a)), detail: `(${fmtPct(explosiveRate(a))})` },
    home: { main: fmtInt(n(h)), detail: `(${fmtPct(explosiveRate(h))})` },
    better: betterSide(n(a), n(h), true),
  });
  // Toxic differential (spec §4): (opponent turnovers − own) + (own explosives − opponent's).
  const toxic = (own: TeamGameStat, opp: TeamGameStat): { total: number | null; cell: StatCell } => {
    const to = isNum(own.turnovers) && isNum(opp.turnovers) ? opp.turnovers - own.turnovers : null;
    const ex =
      isNum(own.explosive_plays) && isNum(opp.explosive_plays)
        ? own.explosive_plays - opp.explosive_plays
        : null;
    const total = to !== null && ex !== null ? to + ex : null;
    return {
      total,
      cell: {
        main: fmtSignedInt(total),
        detail: total === null ? undefined : `(TO ${fmtSignedInt(to)}, expl ${fmtSignedInt(ex)})`,
      },
    };
  };
  const toxicAway = toxic(a, h);
  const toxicHome = toxic(h, a);
  // Fewer sacks is better; the same number of sacks, then fewer yards lost.
  const sacksBetter = betterSide(a.sacks, h.sacks, false) ?? betterSide(a.sack_yards, h.sack_yards, false);

  return [
    {
      key: "efficiency",
      title: "Efficiency",
      rows: [
        epa("epa", "EPA / play", (t) => t.epa_per_play, (t) => t.plays, {
          labelDetail: "(plays)",
          tooltip: "EPA / play",
        }),
        epa("epa-pass", "Passing", (t) => t.pass_epa_per_play, (t) => t.pass_plays, { sub: true }),
        epa("epa-rush", "Rushing", (t) => t.rush_epa_per_play, (t) => t.rush_plays, { sub: true }),
        pct("success", "Success rate", (t) => t.success_rate, { tooltip: "Success rate" }),
        pct("success-pass", "Passing", (t) => t.pass_success_rate, { sub: true }),
        pct("success-rush", "Rushing", (t) => t.rush_success_rate, { sub: true }),
        explosive("explosive", "Explosive plays", (t) => t.explosive_plays, (t) => (isNum(t.explosive_rate) ? t.explosive_rate : null), {
          labelDetail: "(rate)",
          tooltip: "Explosive plays",
        }),
        explosive("explosive-pass", "Passing", (t) => t.explosive_pass, (t) => rate(t.explosive_pass, t.pass_plays), {
          sub: true,
          labelDetail: "(20+ yd completion)",
        }),
        explosive("explosive-rush", "Rushing", (t) => t.explosive_rush, (t) => rate(t.explosive_rush, t.rush_plays), {
          sub: true,
          labelDetail: "(10+ yd run)",
        }),
        {
          key: "toxic",
          label: "Toxic differential",
          labelDetail: "(turnovers + explosives)",
          tooltip: "Toxic differential",
          away: toxicAway.cell,
          home: toxicHome.cell,
          better: betterSide(toxicAway.total, toxicHome.total, true),
        },
      ],
    },
    {
      key: "team-stats",
      title: "Team stats",
      rows: [
        count("first-downs", "1st downs", (t) => t.first_downs, true),
        count("first-downs-pass", "Passing 1st downs", (t) => t.first_downs_pass, true, { sub: true }),
        count("first-downs-rush", "Rushing 1st downs", (t) => t.first_downs_rush, true, { sub: true }),
        count("first-downs-penalty", "1st downs from penalties", (t) => t.first_downs_penalty, true, { sub: true }),
        madeAtt("third-down", "3rd down efficiency", (t) => t.third_down_conv, (t) => t.third_down_att, { sub: true }),
        madeAtt("fourth-down", "4th down efficiency", (t) => t.fourth_down_conv, (t) => t.fourth_down_att, { sub: true }),
        count("total-plays", "Total plays", (t) => t.total_plays, null),
        count("total-yards", "Total yards", (t) => t.total_yards, true),
        count("total-drives", "Total drives", (t) => t.total_drives, null),
        dec1("yards-per-play", "Yards per play", (t) => t.yards_per_play),
        count("passing", "Passing", (t) => t.net_passing_yards, true),
        text("comp-att", "Comp/Att", (t) => fmtPair(t.completions, t.attempts, "/"), null, { sub: true }),
        dec1("yards-per-pass", "Yards per pass", (t) => t.yards_per_pass, { sub: true }),
        count("interceptions", "Interceptions thrown", (t) => t.interceptions, false, { sub: true }),
        text("sacks", "Sacks-yards lost", (t) => fmtPair(t.sacks, t.sack_yards), sacksBetter, { sub: true }),
        count("rushing", "Rushing", (t) => t.rushing_yards, true),
        count("rushing-attempts", "Rushing attempts", (t) => t.rushing_attempts, null, { sub: true }),
        dec1("yards-per-rush", "Yards per rush", (t) => t.yards_per_rush, { sub: true }),
        madeAtt("red-zone", "Red zone", (t) => t.red_zone_tds, (t) => t.red_zone_trips, { labelDetail: "(made-att)" }),
        text("penalties", "Penalties", (t) => fmtPair(t.penalties, t.penalty_yards), null),
        count("turnovers", "Turnovers", (t) => t.turnovers, false),
        count("fumbles-lost", "Fumbles lost", (t) => t.fumbles_lost, false, { sub: true }),
        count("turnovers-int", "Interceptions thrown", (t) => t.interceptions, false, { sub: true }),
        count("def-st-tds", "Defensive / special teams TDs", (t) => t.def_st_tds, true),
        text("possession", "Possession", (t) => fmtClock(t.time_of_possession_seconds), null),
      ],
    },
    {
      key: "cost",
      title: "What it cost them",
      rows: [
        dec1("cost-turnovers", "EPA lost to turnovers", (t) => t.epa_lost_turnovers),
        dec1("cost-sacks", "EPA lost to sacks", (t) => t.epa_lost_sacks),
        dec1("cost-penalties", "EPA lost to penalties", (t) => t.epa_lost_penalties),
      ],
    },
    {
      key: "downs",
      title: "Early vs late downs",
      rows: [
        epa("early-epa", "Early downs", (t) => t.early_epa_per_play, (t) => t.early_plays, {
          labelDetail: "(1st–2nd)",
          labelSuffix: "EPA / play",
        }),
        pct("early-success", "Success rate", (t) => t.early_success_rate, { sub: true }),
        epa("late-epa", "Late downs", (t) => t.late_epa_per_play, (t) => t.late_plays, {
          labelDetail: "(3rd–4th)",
          labelSuffix: "EPA / play",
        }),
        pct("late-success", "Success rate", (t) => t.late_success_rate, { sub: true }),
      ],
    },
  ];
}

/* ─── On-page notes (spec §12: things that look odd on purpose) ─── */

/** Legend above the first section; the page renders the "Shaded" chip before it. */
export const LEGEND_TEXT =
  "= the better side of each row. Rows with no clear \u201cbetter\u201d (plays, drives, attempts, penalties, possession) aren\u2019t shaded. These numbers use the nflfastR/rbsdm play filter, so a team\u2019s EPA/play here can differ from its season figure on the team pages.";

export const STRIP_SACK_NOTE = "A strip-sack counts in both the sack row and the turnover row.";

/**
 * "Why the play counts differ", worded from this game's own numbers: the
 * efficiency plays, the official total plays, and rush plays beside rushing
 * attempts. Illustrated with the team whose counts differ (away first).
 */
export function playCountNote(away: TeamGameStat, home: TeamGameStat): string {
  const pick =
    [away, home].find((t) => t.plays !== t.total_plays || t.rushing_attempts !== t.rush_plays) ?? away;
  const id = pick.team_id;
  return (
    `Efficiency counts every run and dropback the way nflfastR and rbsdm.com do, including sacks, scrambles, ` +
    `plays wiped out by penalties and 2-point tries, so ${id} has ${fmtInt(pick.plays)} plays there and ` +
    `${fmtInt(pick.total_plays)} in the official total above. Rushing attempts count kneel-downs and QB scrambles, ` +
    `while rush plays are the designed runs in that efficiency set, which is why ${id} shows ` +
    `${fmtInt(pick.rushing_attempts)} attempts and ${fmtInt(pick.rush_plays)} rush plays.`
  );
}

/**
 * Why the receiving lines need not add up to team totals (spec §10.3): a
 * team's QB passing yards minus its receivers' yards, when positive, is the
 * yardage no receiver was credited with (a lateral, or a catch by a player
 * outside the receiving positions). Always ends with the rushing-table half.
 */
export function receivingNote(lines: GamePlayerLines, awayId: string, homeId: string): string {
  const gaps: string[] = [];
  for (const team of [awayId, homeId]) {
    const qbs = lines.qbs.filter((q) => q.team_id === team);
    if (qbs.length === 0) continue;
    const passing = qbs.reduce((sum, q) => sum + (isNum(q.passing_yards) ? q.passing_yards : 0), 0);
    const receiving = lines.receivers
      .filter((r) => r.team_id === team)
      .reduce((sum, r) => sum + (isNum(r.receiving_yards) ? r.receiving_yards : 0), 0);
    const diff = passing - receiving;
    if (diff <= 0) continue;
    const who = qbs.length === 1 ? (lines.players[qbs[0].player_id]?.player_name || team) : team;
    gaps.push(
      `${fmtInt(diff)} of ${who}\u2019s ${fmtInt(passing)} passing yards aren\u2019t credited to a receiver above ` +
        `(yards after a lateral, or a catch by a lineman or quarterback)`
    );
  }
  const lead =
    gaps.length > 0 ? `${gaps.join("; ")}, and runs` : "Yards gained after a lateral belong to no receiver, and runs";
  return `${lead} by receivers and kneel-downs don\u2019t appear in the rushing table.`;
}

/* ─── Player tables (type A: one table per stat type, both teams inside) ─── */

export interface PlayerCell {
  text: string;
  /** Present on EPA cells: the raw value, for the colour thresholds (null → grey). */
  epa?: number | null;
}

export interface PlayerTableRow {
  player_id: string;
  name: string;
  slug: string | null;
  /** Small grey tag after the name; null on the passing table (all QBs). */
  position: string | null;
  cells: PlayerCell[];
}

export interface PlayerTableTeam {
  team_id: string;
  color: string;
  /** "28 team targets" on the receiving table. */
  note?: string;
  rows: PlayerTableRow[];
}

export interface PlayerTableModel {
  key: "passing" | "rushing" | "receiving";
  title: string;
  /** Header labels; the first is the player column. */
  columns: string[];
  /** Away team first, then home. */
  teams: PlayerTableTeam[];
}

function who(lines: GamePlayerLines, playerId: string, fallbackPosition: string | null) {
  const p = lines.players?.[playerId];
  return {
    name: p?.player_name || playerId,
    slug: p?.slug ?? null,
    position: p?.position || fallbackPosition,
  };
}

/** Yards descending, then volume descending, then name A→Z — one stable order for ties. */
function orderRows<T>(
  rows: T[],
  yards: (r: T) => number | null | undefined,
  volume: (r: T) => number | null | undefined,
  name: (r: T) => string
): T[] {
  const n = (v: number | null | undefined) => (isNum(v) ? v : Number.NEGATIVE_INFINITY);
  return [...rows].sort(
    (x, y) => n(yards(y)) - n(yards(x)) || n(volume(y)) - n(volume(x)) || name(x).localeCompare(name(y))
  );
}

const PASSING_COLUMNS = ["Player", "C/ATT", "YDS", "TD", "INT", "SCK", "RTG", "EPA/DB", "CPOE", "SUCC%", "aDOT"];
const RUSHING_COLUMNS = ["Player", "CAR", "YDS", "TD", "YPC", "EPA/CAR", "SUCC%"];
const RECEIVING_COLUMNS = ["Player", "TGT", "REC", "YDS", "TD", "TGT%", "YAC", "EPA/TGT", "CATCH%", "aDOT", "Y/TGT"];

/** Passing: every qb_weekly_stats row of each team, most passing yards first. */
export function buildPassingTable(lines: GamePlayerLines, awayId: string, homeId: string): PlayerTableModel {
  const teams = [awayId, homeId].map((team): PlayerTableTeam => {
    const rows = orderRows(
      lines.qbs.filter((q) => q.team_id === team),
      (q) => q.passing_yards,
      (q) => q.attempts,
      (q) => who(lines, q.player_id, "QB").name
    );
    return {
      team_id: team,
      color: getTeamColor(team),
      rows: rows.map((q): PlayerTableRow => {
        const id = who(lines, q.player_id, "QB");
        return {
          player_id: q.player_id,
          name: id.name,
          slug: id.slug,
          position: null,
          cells: [
            { text: fmtPair(q.completions, q.attempts, "/") },
            { text: fmtInt(q.passing_yards) },
            { text: fmtInt(q.touchdowns) },
            { text: fmtInt(q.interceptions) },
            { text: fmtInt(q.sacks) },
            { text: fmtDec1(q.passer_rating) },
            { text: fmtSigned2(q.epa_per_dropback), epa: isNum(q.epa_per_dropback) ? q.epa_per_dropback : null },
            { text: fmtSigned1(q.cpoe) },
            { text: fmtPct(q.success_rate) },
            { text: fmtDec1(q.adot) },
          ],
        };
      }),
    };
  });
  return { key: "passing", title: "Passing", columns: PASSING_COLUMNS, teams };
}

interface RushLine {
  player_id: string;
  yards: number | null;
  carries: number | null;
  row: PlayerTableRow;
}

/**
 * Rushing: rb_weekly_stats rows plus QB rushing from qb_weekly_stats (spec
 * §6, §10.1), only players with a carry, most rushing yards first. QB rows use
 * the PR 2 columns rush_epa_per_carry / rush_success_rate; yards per carry for
 * a QB is rush_yards ÷ rush_attempts (the QB table stores no YPC).
 */
export function buildRushingTable(lines: GamePlayerLines, awayId: string, homeId: string): PlayerTableModel {
  const teams = [awayId, homeId].map((team): PlayerTableTeam => {
    const rbLines: RushLine[] = lines.rbs
      .filter((r) => r.team_id === team && isNum(r.carries) && r.carries > 0)
      .map((r) => {
        const id = who(lines, r.player_id, "RB");
        return {
          player_id: r.player_id,
          yards: isNum(r.rushing_yards) ? r.rushing_yards : null,
          carries: r.carries,
          row: {
            player_id: r.player_id,
            name: id.name,
            slug: id.slug,
            position: id.position,
            cells: [
              { text: fmtInt(r.carries) },
              { text: fmtInt(r.rushing_yards) },
              { text: fmtInt(r.rushing_tds) },
              { text: fmtDec1(r.yards_per_carry) },
              { text: fmtSigned2(r.epa_per_carry), epa: isNum(r.epa_per_carry) ? r.epa_per_carry : null },
              { text: fmtPct(r.success_rate) },
            ],
          },
        };
      });
    const qbLines: RushLine[] = lines.qbs
      .filter((q) => q.team_id === team && isNum(q.rush_attempts) && q.rush_attempts > 0)
      .map((q) => {
        const id = who(lines, q.player_id, "QB");
        return {
          player_id: q.player_id,
          yards: isNum(q.rush_yards) ? q.rush_yards : null,
          carries: q.rush_attempts,
          row: {
            player_id: q.player_id,
            name: id.name,
            slug: id.slug,
            position: id.position,
            cells: [
              { text: fmtInt(q.rush_attempts) },
              { text: fmtInt(q.rush_yards) },
              { text: fmtInt(q.rush_tds) },
              { text: fmtDec1(rate(q.rush_yards, q.rush_attempts)) },
              { text: fmtSigned2(q.rush_epa_per_carry), epa: isNum(q.rush_epa_per_carry) ? q.rush_epa_per_carry : null },
              { text: fmtPct(q.rush_success_rate) },
            ],
          },
        };
      });
    const ordered = orderRows(
      [...rbLines, ...qbLines],
      (l) => l.yards,
      (l) => l.carries,
      (l) => l.row.name
    );
    return { team_id: team, color: getTeamColor(team), rows: ordered.map((l) => l.row) };
  });
  return { key: "rushing", title: "Rushing", columns: RUSHING_COLUMNS, teams };
}

/**
 * Receiving: receiver_weekly_stats only (its position filter already includes
 * RB/FB), most receiving yards first. TGT% divides by the team's team_targets
 * from team_game_stats (spec §5), never by a sum of rows; Y/TGT is yards ÷
 * targets. YPRR is appended only when any row in the game has route data
 * (nflverse publishes participation after the season, so 2026 has none).
 */
export function buildReceivingTable(
  lines: GamePlayerLines,
  awayId: string,
  homeId: string,
  teamTargets: Record<string, number | null | undefined>
): PlayerTableModel {
  const hasRoutes = lines.receivers.some((r) => isNum(r.routes_run));
  const columns = hasRoutes ? [...RECEIVING_COLUMNS, "YPRR"] : RECEIVING_COLUMNS;
  const teams = [awayId, homeId].map((team): PlayerTableTeam => {
    const targets = teamTargets[team];
    const rows = orderRows(
      lines.receivers.filter((r) => r.team_id === team),
      (r) => r.receiving_yards,
      (r) => r.targets,
      (r) => who(lines, r.player_id, null).name
    );
    return {
      team_id: team,
      color: getTeamColor(team),
      note: isNum(targets) && targets > 0 ? `${fmtInt(targets)} team targets` : undefined,
      rows: rows.map((r): PlayerTableRow => {
        const id = who(lines, r.player_id, null);
        const cells: PlayerCell[] = [
          { text: fmtInt(r.targets) },
          { text: fmtInt(r.receptions) },
          { text: fmtInt(r.receiving_yards) },
          { text: fmtInt(r.receiving_tds) },
          { text: fmtPct(rate(r.targets, targets), 1) },
          { text: fmtInt(r.yac) },
          { text: fmtSigned2(r.epa_per_target), epa: isNum(r.epa_per_target) ? r.epa_per_target : null },
          { text: fmtPct(r.catch_rate) },
          { text: fmtDec1(r.adot) },
          { text: fmtDec1(rate(r.receiving_yards, r.targets)) },
        ];
        if (hasRoutes) cells.push({ text: fmtDec2(r.yards_per_route_run) });
        return { player_id: r.player_id, name: id.name, slug: id.slug, position: id.position, cells };
      }),
    };
  });
  return { key: "receiving", title: "Receiving", columns, teams };
}

// Re-exported so callers can type their inputs without importing lib/types twice.
export type { QBWeeklyStat, RBWeeklyStat, ReceiverWeeklyStat, TeamGameStat, GamePlayerLines };
```

- [ ] **Step 5: Run the tests to verify they pass**

```bash
node "C:/Users/jonra/OneDrive/Desktop/claude sandbox/football website/yards-per-pass/node_modules/vitest/vitest.mjs" run --root "C:/Users/jonra/OneDrive/Desktop/claude sandbox/football website/yards-per-pass" __tests__/stats/box-score.test.ts
```

Expected: PASS, 32 tests. If a golden value fails, the builder deviates from the mockup / spec §4 — fix the builder; never change a value in the fixture or the expected arrays.

- [ ] **Step 6: Type check and lint**

```bash
node "C:/Users/jonra/OneDrive/Desktop/claude sandbox/football website/yards-per-pass/node_modules/typescript/bin/tsc" --noEmit -p "C:/Users/jonra/OneDrive/Desktop/claude sandbox/football website/yards-per-pass/tsconfig.json"
```

Expected: no output, exit 0.

```bash
npm --prefix "C:/Users/jonra/OneDrive/Desktop/claude sandbox/football website/yards-per-pass" run lint
```

Expected: only the four pre-existing warnings.

- [ ] **Step 7: Commit**

```bash
git -C "C:/Users/jonra/OneDrive/Desktop/claude sandbox/football website/yards-per-pass" add lib/stats/box-score.ts __tests__/stats/box-score.test.ts __tests__/fixtures/box-score-buf-hou.ts
```

```bash
git -C "C:/Users/jonra/OneDrive/Desktop/claude sandbox/football website/yards-per-pass" commit -m "feat: pure box score builders pinned to the BUF-HOU golden game" -m "lib/stats/box-score.ts turns team_game_stats and weekly rows into the scoreboard, the four AWAY | stat | HOME sections with their better side, the on-page notes and the three player tables (box score spec sections 4, 6, 12). Every number is formatted through one null/NaN guard; the 2026_01_BUF_HOU fixture pins the values verified against rbsdm and ESPN." -m "Co-Authored-By: Claude <noreply@anthropic.com>"
```

---
### Task 3: Server reads — `getGame`, `getBoxScoreSeasons`, the player lines and `getBoxScore`

**Files:**
- Modify: `lib/data/games.ts` (imports at lines 4–5; insert before the `hasScheduleForSeason` doc comment, which starts at line 151)
- Create: `lib/data/box-score.ts`
- Test: `__tests__/data/games.test.ts` (fake-client method list at line 12; append tests), `__tests__/data/box-score.test.ts` (create)

**Interfaces:**
- Consumes: `createServerClient` (`@/lib/supabase/server`); `fetchAllRows` (`@/lib/data/utils`); `parseNumericFields` (`@/lib/utils`); `getTeamSchedule` and the module-private `GameRow` / `score` / `toTeamGame` already in `lib/data/games.ts`; `getAvailableSeasons` (`@/lib/data/queries`); `QB_WEEKLY_NUMERIC` / `RECEIVER_WEEKLY_NUMERIC` / `RB_WEEKLY_NUMERIC` (Task 1); `recordThroughWeek`, `WinLossTie` (Task 2); the types from Task 1.
- Produces:
  - In `@/lib/data/games`: `interface GameRecord` (a `games` row with numeric-or-null scores), `getGame(gameId: string): Promise<GameRecord | null>` (throws `Failed to fetch game <id>: <message>` on a query error), `getPlayedRegularSeasonGameIds(season: number): Promise<string[]>` (via `fetchAllRows`, which throws the raw PostgREST error object).
  - In `@/lib/data/box-score` (server-only): `TEAM_GAME_NUMERIC: string[]`, `GAME_ID_PATTERN`, `normalizeGameId(raw): string | null`, `type PlayedGame = GameRecord & { home_score: number; away_score: number }`, `interface GameRecords { away: WinLossTie; home: WinLossTie }`, `type BoxScoreData` (the five states — see the file), `getBoxScoreSeasons(candidates: number[]): Promise<number[]>` (newest first; throws `Failed to fetch box score seasons: …`), `getTeamGameStats(gameId): Promise<TeamGameStat[]>`, `getGamePlayerLines(season, week, teamIds): Promise<GamePlayerLines>`, `getBoxScore(gameId): Promise<BoxScoreData>`. Tasks 7–10 consume these.

- [ ] **Step 1: Extend the games fake client and write the failing games tests**

In `__tests__/data/games.test.ts`, change line 12

```ts
  for (const m of ["select", "eq", "or", "order"]) {
```

to

```ts
  for (const m of ["select", "eq", "or", "order", "limit", "range"]) {
```

change the import

```ts
import { getGameResults } from "@/lib/data/games";
```

to

```ts
import { getGameResults, getGame, getPlayedRegularSeasonGameIds } from "@/lib/data/games";
```

and append at the end of the file:

```ts

describe("getGame (box score spec §6)", () => {
  it("returns the row for one game id with parsed scores, filtering by game_id with limit 1", async () => {
    result = { data: [game({ home_score: "31", away_score: 36 })], error: null };
    const out = await getGame("2025_01_BAL_BUF");
    expect(out).toEqual({
      game_id: "2025_01_BAL_BUF", season: 2025, game_type: "REG", week: 1, gameday: "2025-09-07",
      weekday: "Sunday", gametime: "20:20", home_team: "BUF", away_team: "BAL", home_score: 31, away_score: 36,
    });
    expect(calls).toContainEqual(["from", "games"]);
    expect(calls).toContainEqual(["eq", "game_id", "2025_01_BAL_BUF"]);
    expect(calls).toContainEqual(["limit", 1]);
  });

  it("keeps null scores for an unplayed game and reads a missing game_type as REG", async () => {
    result = { data: [game({ home_score: null, away_score: null, game_type: null, gametime: null })], error: null };
    const out = await getGame("2025_01_BAL_BUF");
    expect(out).toMatchObject({ home_score: null, away_score: null, game_type: "REG", gametime: null });
  });

  it("returns null when there is no such row, and throws on a query error", async () => {
    expect(await getGame("2025_01_XXX_YYY")).toBeNull();
    result = { data: null, error: { message: "fetch failed" } };
    await expect(getGame("2025_01_BAL_BUF")).rejects.toThrow("Failed to fetch game 2025_01_BAL_BUF: fetch failed");
  });
});

describe("getPlayedRegularSeasonGameIds (sitemap)", () => {
  it("returns the ids of played REG games only, reading through fetchAllRows", async () => {
    result = {
      data: [
        { game_id: "2026_01_BUF_HOU", game_type: "REG", home_score: 31, away_score: 36 },
        { game_id: "2026_02_DET_BUF", game_type: "REG", home_score: null, away_score: null },
        { game_id: "2026_19_BUF_MIA", game_type: "WC", home_score: 20, away_score: 17 },
        { game_id: "2026_01_NE_SEA", game_type: null, home_score: "13", away_score: "10" },
      ],
      error: null,
    };
    expect(await getPlayedRegularSeasonGameIds(2026)).toEqual(["2026_01_BUF_HOU", "2026_01_NE_SEA"]);
    expect(calls).toContainEqual(["from", "games"]);
    expect(calls).toContainEqual(["eq", "season", 2026]);
    expect(calls).toContainEqual(["range", 0, 999]);
  });

  it("propagates a query error (the sitemap catches it)", async () => {
    result = { data: null, error: { message: "fetch failed" } };
    await expect(getPlayedRegularSeasonGameIds(2026)).rejects.toMatchObject({ message: "fetch failed" });
  });
});
```

- [ ] **Step 2: Write the failing box-score data tests**

Create `__tests__/data/box-score.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import type { TeamGame } from "@/lib/types";

// Fake Supabase client: every from(table) starts its own chain, so the parallel
// reads in getBoxScore can't interleave. `results[table]` is a response or a
// function of the chain's recorded calls (one table can answer two queries).
type Res = { data: unknown; error: unknown };
const results: Record<string, Res | ((calls: unknown[][]) => Res)> = {};
const chains: { table: string; calls: unknown[][] }[] = [];

vi.mock("@/lib/supabase/server", () => ({
  createServerClient: () => ({
    from: (table: string) => {
      const calls: unknown[][] = [];
      chains.push({ table, calls });
      const builder: Record<string, unknown> = {};
      for (const m of ["select", "eq", "in", "limit", "order", "or", "range"]) {
        builder[m] = (...a: unknown[]) => {
          calls.push([m, ...a]);
          return builder;
        };
      }
      builder.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => {
        const r = results[table];
        const value = typeof r === "function" ? r(calls) : (r ?? { data: [], error: null });
        return Promise.resolve(value).then(res, rej);
      };
      return builder;
    },
  }),
}));

vi.mock("@/lib/data/games", () => ({
  getGame: vi.fn(),
  getTeamSchedule: vi.fn(async () => []),
}));

vi.mock("@/lib/data/queries", () => ({
  getAvailableSeasons: vi.fn(async () => [2026, 2025]),
}));

import {
  getBoxScore,
  getBoxScoreSeasons,
  getGamePlayerLines,
  getTeamGameStats,
  normalizeGameId,
  TEAM_GAME_NUMERIC,
} from "@/lib/data/box-score";
import { getGame, getTeamSchedule } from "@/lib/data/games";
import { getAvailableSeasons } from "@/lib/data/queries";
import { BUF_HOU_GAME, BUF_STATS, HOU_STATS, scheduleFor } from "../fixtures/box-score-buf-hou";

/** A team_game_stats row as PostgREST sends it: NUMERIC columns are strings. */
function wireRow(team: "BUF" | "HOU"): Record<string, unknown> {
  const src = team === "BUF" ? BUF_STATS : HOU_STATS;
  const row: Record<string, unknown> = { ...src };
  for (const col of TEAM_GAME_NUMERIC) {
    const v = row[col];
    row[col] = v === null ? null : String(v);
  }
  return row;
}

const chainsFor = (table: string) => chains.filter((c) => c.table === table);

beforeEach(() => {
  for (const k of Object.keys(results)) delete results[k];
  chains.length = 0;
  vi.mocked(getGame).mockReset();
  vi.mocked(getTeamSchedule).mockReset();
  vi.mocked(getTeamSchedule).mockImplementation(async (team: string) => scheduleFor(team as "BUF" | "HOU"));
  vi.mocked(getAvailableSeasons).mockReset();
  vi.mocked(getAvailableSeasons).mockResolvedValue([2026, 2025]);
});

describe("normalizeGameId", () => {
  it("accepts nflverse ids, upper-cases them, and rejects everything else", () => {
    expect(normalizeGameId("2026_01_BUF_HOU")).toBe("2026_01_BUF_HOU");
    expect(normalizeGameId("2026_01_buf_hou")).toBe("2026_01_BUF_HOU");
    expect(normalizeGameId(" 2025_14_PHI_LAC ")).toBe("2025_14_PHI_LAC");
    expect(normalizeGameId("2026_01_LA_SF")).toBe("2026_01_LA_SF");
    for (const bad of ["", "BUF", "2026-01-BUF-HOU", "2026_1_BUF_HOU", "2026_01_BUF_HOU; drop", "2026_01_BUF", null, undefined, "../etc"]) {
      expect(normalizeGameId(bad)).toBeNull();
    }
  });
});

describe("getBoxScoreSeasons", () => {
  it("probes each candidate with limit 1 and keeps the seasons that have rows, newest first", async () => {
    results.team_game_stats = (calls) =>
      calls.some((c) => c[0] === "eq" && c[1] === "season" && c[2] === 2026)
        ? { data: [{ game_id: "2026_01_BUF_HOU" }], error: null }
        : { data: [], error: null };
    expect(await getBoxScoreSeasons([2025, 2026, 2024])).toEqual([2026]);
    const probes = chainsFor("team_game_stats");
    expect(probes).toHaveLength(3);
    for (const p of probes) {
      expect(p.calls).toContainEqual(["select", "game_id"]);
      expect(p.calls).toContainEqual(["limit", 1]);
    }
  });

  it("dedupes and drops junk candidates; returns [] without a query for none", async () => {
    results.team_game_stats = { data: [{ game_id: "x" }], error: null };
    expect(await getBoxScoreSeasons([2026, 2026, NaN, 0, -1, 2025.5, "2024" as unknown as number])).toEqual([2026]);
    expect(chainsFor("team_game_stats")).toHaveLength(1);
    chains.length = 0;
    expect(await getBoxScoreSeasons([])).toEqual([]);
    expect(await getBoxScoreSeasons(undefined as unknown as number[])).toEqual([]);
    expect(chains).toHaveLength(0);
  });

  it("throws on a query error", async () => {
    results.team_game_stats = { data: null, error: { message: "fetch failed" } };
    await expect(getBoxScoreSeasons([2026])).rejects.toThrow("Failed to fetch box score seasons: fetch failed");
  });
});

describe("getTeamGameStats", () => {
  it("parses NUMERIC strings to numbers and NULL / 'NaN' to null", async () => {
    const hou = wireRow("HOU");
    hou.rush_epa_per_play = "NaN";
    hou.time_of_possession_seconds = null;
    results.team_game_stats = { data: [wireRow("BUF"), hou], error: null };
    const rows = await getTeamGameStats("2026_01_BUF_HOU");
    expect(rows).toHaveLength(2);
    expect(rows[0].epa_per_play).toBeCloseTo(0.278, 6);
    expect(rows[0].epa_lost_penalties).toBeCloseTo(-8.52, 6);
    expect(rows[0].plays).toBe(56);
    expect(rows[1].rush_epa_per_play).toBeNull();
    expect(rows[1].time_of_possession_seconds).toBeNull();
    expect(chainsFor("team_game_stats")[0].calls).toContainEqual(["eq", "game_id", "2026_01_BUF_HOU"]);
  });

  it("throws on a query error", async () => {
    results.team_game_stats = { data: null, error: { message: "boom" } };
    await expect(getTeamGameStats("2026_01_BUF_HOU")).rejects.toThrow("Failed to fetch team game stats for 2026_01_BUF_HOU: boom");
  });
});

describe("getGamePlayerLines", () => {
  it("reads the three weekly tables by season, week and both teams, then the players they name", async () => {
    results.qb_weekly_stats = { data: [{ player_id: "q1", team_id: "BUF", epa_per_dropback: "0.5557", rush_epa_per_carry: "-0.4626" }], error: null };
    results.receiver_weekly_stats = { data: [{ player_id: "r1", team_id: "HOU", epa_per_target: "NaN" }, { player_id: "q1", team_id: "BUF" }], error: null };
    results.rb_weekly_stats = { data: [{ player_id: "b1", team_id: "HOU", epa_per_carry: "0.16" }], error: null };
    results.player_slugs = {
      data: [
        { player_id: "q1", player_name: "Josh Allen", position: "QB", slug: "josh-allen" },
        { player_id: "b1", player_name: "Woody Marks", position: "RB", slug: null },
      ],
      error: null,
    };
    const lines = await getGamePlayerLines(2026, 1, ["BUF", "HOU"]);
    expect(lines.qbs[0].epa_per_dropback).toBeCloseTo(0.5557, 6);
    expect(lines.qbs[0].rush_epa_per_carry).toBeCloseTo(-0.4626, 6);
    expect(lines.receivers[0].epa_per_target).toBeNull();
    expect(lines.rbs[0].epa_per_carry).toBeCloseTo(0.16, 6);
    expect(lines.players).toEqual({
      q1: { player_id: "q1", player_name: "Josh Allen", position: "QB", slug: "josh-allen" },
      b1: { player_id: "b1", player_name: "Woody Marks", position: "RB", slug: null },
    });
    for (const table of ["qb_weekly_stats", "receiver_weekly_stats", "rb_weekly_stats"]) {
      const calls = chainsFor(table)[0].calls;
      expect(calls).toContainEqual(["eq", "season", 2026]);
      expect(calls).toContainEqual(["eq", "week", 1]);
      expect(calls).toContainEqual(["in", "team_id", ["BUF", "HOU"]]);
    }
    const slugCalls = chainsFor("player_slugs")[0].calls;
    expect(slugCalls).toContainEqual(["select", "player_id, player_name, position, slug"]);
    expect(slugCalls.find((c) => c[0] === "in")?.[2]).toEqual(["q1", "r1", "b1"]);
  });

  it("skips the player_slugs read when no row names a player", async () => {
    const lines = await getGamePlayerLines(2026, 1, ["BUF", "HOU"]);
    expect(lines).toEqual({ qbs: [], receivers: [], rbs: [], players: {} });
    expect(chainsFor("player_slugs")).toHaveLength(0);
  });

  it("throws when a weekly read or the slug read fails", async () => {
    results.rb_weekly_stats = { data: null, error: { message: "rb down" } };
    await expect(getGamePlayerLines(2026, 1, ["BUF", "HOU"])).rejects.toThrow("Failed to fetch rb_weekly_stats for 2026 week 1: rb down");
    delete results.rb_weekly_stats;
    results.qb_weekly_stats = { data: [{ player_id: "q1", team_id: "BUF" }], error: null };
    results.player_slugs = { data: null, error: { message: "slugs down" } };
    await expect(getGamePlayerLines(2026, 1, ["BUF", "HOU"])).rejects.toThrow("Failed to fetch player identities: slugs down");
  });
});

describe("getBoxScore", () => {
  const ready = () => {
    vi.mocked(getGame).mockResolvedValue(BUF_HOU_GAME);
    results.team_game_stats = (calls) =>
      calls.some((c) => c[0] === "limit")
        ? { data: [{ game_id: "2026_01_BUF_HOU" }], error: null }
        : { data: [wireRow("BUF"), wireRow("HOU")], error: null };
    results.qb_weekly_stats = { data: [{ player_id: "q1", team_id: "BUF" }], error: null };
    results.player_slugs = { data: [{ player_id: "q1", player_name: "Josh Allen", position: "QB", slug: "josh-allen" }], error: null };
  };

  it("unknown id → not-found; no schedule or stats reads", async () => {
    vi.mocked(getGame).mockResolvedValue(null);
    expect(await getBoxScore("2026_01_XXX_YYY")).toEqual({ state: "not-found" });
    expect(getTeamSchedule).not.toHaveBeenCalled();
    expect(chains).toHaveLength(0);
  });

  it("no final score → unplayed", async () => {
    vi.mocked(getGame).mockResolvedValue({ ...BUF_HOU_GAME, home_score: null, away_score: null });
    const out = await getBoxScore("2026_01_BUF_HOU");
    expect(out.state).toBe("unplayed");
    expect(chains).toHaveLength(0);
  });

  it("ready: both rows, records through the week, player lines", async () => {
    ready();
    const out = await getBoxScore("2026_01_BUF_HOU");
    expect(out.state).toBe("ready");
    if (out.state !== "ready") return;
    expect(out.game).toEqual(BUF_HOU_GAME);
    expect(out.records).toEqual({ away: { wins: 1, losses: 0, ties: 0 }, home: { wins: 0, losses: 1, ties: 0 } });
    expect(out.away.team_id).toBe("BUF");
    expect(out.home.team_id).toBe("HOU");
    expect(out.away.epa_per_play).toBeCloseTo(0.278, 6);
    expect(out.lines.qbs).toHaveLength(1);
    expect(out.lines.players.q1.slug).toBe("josh-allen");
    expect(getTeamSchedule).toHaveBeenCalledWith("BUF", 2026);
    expect(getTeamSchedule).toHaveBeenCalledWith("HOU", 2026);
    // No coverage probe was needed.
    expect(chainsFor("team_game_stats")).toHaveLength(1);
    expect(getAvailableSeasons).not.toHaveBeenCalled();
  });

  it("played 2025 game before the backfill → uncovered, naming the first covered season", async () => {
    vi.mocked(getGame).mockResolvedValue({ ...BUF_HOU_GAME, game_id: "2025_14_PHI_LAC", season: 2025, week: 14, away_team: "PHI", home_team: "LAC", away_score: 19, home_score: 22 });
    results.team_game_stats = (calls) =>
      calls.some((c) => c[0] === "eq" && c[1] === "season" && c[2] === 2026)
        ? { data: [{ game_id: "2026_01_BUF_HOU" }], error: null }
        : { data: [], error: null };
    const out = await getBoxScore("2025_14_PHI_LAC");
    expect(out).toMatchObject({ state: "uncovered", reason: "season", firstSeason: 2026 });
    expect(getAvailableSeasons).toHaveBeenCalledTimes(1);
  });

  it("played, covered season, rows not written yet → pending (also when only one team's row exists)", async () => {
    vi.mocked(getGame).mockResolvedValue(BUF_HOU_GAME);
    results.team_game_stats = (calls) =>
      calls.some((c) => c[0] === "limit") ? { data: [{ game_id: "2026_01_NE_SEA" }], error: null } : { data: [], error: null };
    expect((await getBoxScore("2026_01_BUF_HOU")).state).toBe("pending");
    results.team_game_stats = (calls) =>
      calls.some((c) => c[0] === "limit") ? { data: [{ game_id: "2026_01_NE_SEA" }], error: null } : { data: [wireRow("BUF")], error: null };
    expect((await getBoxScore("2026_01_BUF_HOU")).state).toBe("pending");
  });

  it("played game with no covered season at all (before PR 2's first refresh) → pending", async () => {
    vi.mocked(getGame).mockResolvedValue(BUF_HOU_GAME);
    results.team_game_stats = { data: [], error: null };
    expect((await getBoxScore("2026_01_BUF_HOU")).state).toBe("pending");
  });

  it("playoff game → uncovered / playoffs with the regular-season records", async () => {
    vi.mocked(getGame).mockResolvedValue({ ...BUF_HOU_GAME, game_id: "2026_19_BUF_HOU", game_type: "WC", week: 19 });
    const out = await getBoxScore("2026_19_BUF_HOU");
    expect(out).toMatchObject({ state: "uncovered", reason: "playoffs", firstSeason: null, records: { away: { wins: 1 } } });
  });

  it("throws when a protected read fails: schedule, stats rows, seasons list", async () => {
    vi.mocked(getGame).mockResolvedValue(BUF_HOU_GAME);
    vi.mocked(getTeamSchedule).mockRejectedValue(new Error("Failed to fetch schedule: fetch failed"));
    await expect(getBoxScore("2026_01_BUF_HOU")).rejects.toThrow("Failed to fetch schedule");

    vi.mocked(getTeamSchedule).mockImplementation(async (team: string) => scheduleFor(team as "BUF" | "HOU"));
    results.team_game_stats = { data: null, error: { message: "tgs down" } };
    await expect(getBoxScore("2026_01_BUF_HOU")).rejects.toThrow("tgs down");

    results.team_game_stats = { data: [], error: null };
    vi.mocked(getAvailableSeasons).mockResolvedValue([]);
    await expect(getBoxScore("2026_01_BUF_HOU")).rejects.toThrow("no seasons from data_freshness");

    vi.mocked(getGame).mockRejectedValue(new Error("Failed to fetch game 2026_01_BUF_HOU: down"));
    await expect(getBoxScore("2026_01_BUF_HOU")).rejects.toThrow("Failed to fetch game");
  });

  it("records ignore the schedule's unplayed and later games", async () => {
    ready();
    const later: TeamGame[] = [...scheduleFor("BUF"), { ...scheduleFor("BUF")[0], game_id: "2026_03_BUF_LAC", week: 3, result: "L", team_score: 10, opponent_score: 20 }];
    vi.mocked(getTeamSchedule).mockImplementation(async (team: string) => (team === "BUF" ? later : scheduleFor("HOU")));
    const out = await getBoxScore("2026_01_BUF_HOU");
    expect(out.state === "ready" && out.records.away).toEqual({ wins: 1, losses: 0, ties: 0 });
  });
});
```

- [ ] **Step 3: Run both files to verify they fail**

```bash
node "C:/Users/jonra/OneDrive/Desktop/claude sandbox/football website/yards-per-pass/node_modules/vitest/vitest.mjs" run --root "C:/Users/jonra/OneDrive/Desktop/claude sandbox/football website/yards-per-pass" __tests__/data/games.test.ts __tests__/data/box-score.test.ts
```

Expected: `games.test.ts` — 5 FAIL (`getGame is not a function`, `getPlayedRegularSeasonGameIds is not a function`), 10 PASS; `box-score.test.ts` fails to load (`Failed to resolve import "@/lib/data/box-score"`).

- [ ] **Step 4: Add `GameRecord`, `getGame` and `getPlayedRegularSeasonGameIds` to `lib/data/games.ts`**

Change the imports (lines 4–5)

```ts
import { createServerClient } from "@/lib/supabase/server";
import type { TeamGame, GameResultsByTeam } from "@/lib/types";
```

to

```ts
import { createServerClient } from "@/lib/supabase/server";
import { fetchAllRows } from "@/lib/data/utils";
import type { TeamGame, GameResultsByTeam } from "@/lib/types";
```

Then insert the following directly before the doc comment that begins `/**\n * Has the league published this season's schedule yet?` (the `hasScheduleForSeason` block):

```ts
/**
 * One `games` row as the box score page reads it — both teams, scores parsed
 * to numbers, null until the game is played (never NaN: see `score`).
 */
export interface GameRecord {
  game_id: string;
  season: number;
  /** REG, or WC / DIV / CON / SB. A missing value reads REG, like getTeamSchedule. */
  game_type: string;
  week: number;
  gameday: string | null;
  weekday: string | null;
  gametime: string | null;
  home_team: string;
  away_team: string;
  home_score: number | null;
  away_score: number | null;
}

/**
 * The `games` row for one nflverse game id, or null when there is none.
 * Throws on a query error (box score spec §6: a failed read must not render
 * as "not found").
 */
export async function getGame(gameId: string): Promise<GameRecord | null> {
  const supabase = createServerClient();
  const { data, error } = await supabase.from("games").select("*").eq("game_id", gameId).limit(1);
  if (error) throw new Error(`Failed to fetch game ${gameId}: ${error.message}`);
  const row = ((data ?? []) as unknown as GameRow[])[0];
  if (!row) return null;
  return {
    game_id: row.game_id,
    season: Number(row.season),
    game_type: row.game_type ?? "REG",
    week: row.week ?? 0,
    gameday: row.gameday ?? null,
    weekday: row.weekday ?? null,
    gametime: row.gametime ?? null,
    home_team: row.home_team,
    away_team: row.away_team,
    home_score: score(row.home_score),
    away_score: score(row.away_score),
  };
}

/**
 * Ids of every played regular-season game of one season (both scores
 * present), for the sitemap's box score URLs. Paginated with fetchAllRows:
 * one season is 272 rows, under the 1000-row cap, but the helper costs
 * nothing and keeps this safe if it is ever called across seasons.
 */
export async function getPlayedRegularSeasonGameIds(season: number): Promise<string[]> {
  const rows = await fetchAllRows("games", "game_id,game_type,home_score,away_score", { season });
  return rows
    .filter(
      (r) =>
        ((r.game_type as string | null) ?? "REG") === "REG" &&
        score(r.home_score) !== null &&
        score(r.away_score) !== null
    )
    .map((r) => String(r.game_id));
}

```

- [ ] **Step 5: Create `lib/data/box-score.ts`**

```ts
// lib/data/box-score.ts — server-side reads for /game/[game_id] and the box
// score links (box score spec §6, §7). Imports the Supabase server client:
// never import this module from a "use client" file.
//
// Every read here throws on a query error. The page turns that into a thrown
// render (ISR keeps the last good copy) instead of a cached empty shell; the
// team and player pages catch the seasons probe and simply render no links.
import { createServerClient } from "@/lib/supabase/server";
import { parseNumericFields } from "@/lib/utils";
import { getGame, getTeamSchedule, type GameRecord } from "@/lib/data/games";
import { getAvailableSeasons } from "@/lib/data/queries";
import { QB_WEEKLY_NUMERIC, RECEIVER_WEEKLY_NUMERIC, RB_WEEKLY_NUMERIC } from "@/lib/data/players";
import { recordThroughWeek, type WinLossTie } from "@/lib/stats/box-score";
import type {
  GamePlayerLines,
  PlayerIdentity,
  QBWeeklyStat,
  RBWeeklyStat,
  ReceiverWeeklyStat,
  TeamGameStat,
} from "@/lib/types";

/**
 * The NUMERIC columns of team_game_stats (PR 2's TEAM_GAME_STATS_RATE_COLS
 * and TEAM_GAME_STATS_SUM_COLS). PostgREST sends NUMERIC as strings;
 * parseNumericFields makes them numbers, or null for NULL and "NaN".
 */
export const TEAM_GAME_NUMERIC = [
  "epa_per_play",
  "success_rate",
  "first_down_rate",
  "pass_epa_per_play",
  "pass_success_rate",
  "pass_first_down_rate",
  "rush_epa_per_play",
  "rush_success_rate",
  "rush_first_down_rate",
  "early_epa_per_play",
  "early_success_rate",
  "late_epa_per_play",
  "late_success_rate",
  "explosive_rate",
  "yards_per_play",
  "yards_per_pass",
  "yards_per_rush",
  "epa_lost_turnovers",
  "epa_lost_sacks",
  "epa_lost_penalties",
];

/** nflverse game id: season_week_AWAY_HOME, e.g. 2026_01_BUF_HOU. */
export const GAME_ID_PATTERN = /^\d{4}_\d{2}_[A-Z]{2,3}_[A-Z]{2,3}$/;

/**
 * The id as the database stores it (upper case), or null when the address
 * cannot be a game id — so junk never reaches a query and gets notFound().
 */
export function normalizeGameId(raw: string | null | undefined): string | null {
  const id = String(raw ?? "").trim().toUpperCase();
  return GAME_ID_PATTERN.test(id) ? id : null;
}

/** A `games` row with both scores present. */
export type PlayedGame = GameRecord & { home_score: number; away_score: number };

export interface GameRecords {
  away: WinLossTie;
  home: WinLossTie;
}

/**
 * Everything the page needs, in one of five states (spec §6):
 * - not-found: no such game id
 * - unplayed: scheduled, no final score yet (the page 404s; nothing links to it)
 * - uncovered: played, but no box score will come — a season before the
 *   first covered one (2020–2025 until the backfill) or a playoff game
 * - pending: played in a covered season, team_game_stats rows not written yet
 * - ready: both teams' rows and the player lines
 */
export type BoxScoreData =
  | { state: "not-found" }
  | { state: "unplayed"; game: GameRecord }
  | {
      state: "uncovered";
      game: PlayedGame;
      records: GameRecords;
      reason: "season" | "playoffs";
      /** The earliest season with box scores ("Box scores start with the 2026 season"). */
      firstSeason: number | null;
    }
  | { state: "pending"; game: PlayedGame; records: GameRecords }
  | {
      state: "ready";
      game: PlayedGame;
      records: GameRecords;
      away: TeamGameStat;
      home: TeamGameStat;
      lines: GamePlayerLines;
    };

/**
 * Which of `candidates` have team_game_stats rows — the box score link gate
 * (spec §7). One `limit(1)` probe per season, in parallel, so the answer can
 * never be cut off by PostgREST's 1000-row cap (a bare `select season` over
 * the table would be, once the backfill lands). Newest first. Throws on a
 * query error.
 */
export async function getBoxScoreSeasons(candidates: number[]): Promise<number[]> {
  const seasons = Array.from(
    new Set((candidates ?? []).filter((s) => Number.isInteger(s) && s > 0))
  );
  if (seasons.length === 0) return [];
  const supabase = createServerClient();
  const found = await Promise.all(
    seasons.map(async (season) => {
      const { data, error } = await supabase
        .from("team_game_stats")
        .select("game_id")
        .eq("season", season)
        .limit(1);
      if (error) throw new Error(`Failed to fetch box score seasons: ${error.message}`);
      return (data?.length ?? 0) > 0 ? season : null;
    })
  );
  return found.filter((s): s is number => s !== null).sort((a, b) => b - a);
}

/** Both teams' team_game_stats rows for one game (0, 1 or 2 rows). */
export async function getTeamGameStats(gameId: string): Promise<TeamGameStat[]> {
  const supabase = createServerClient();
  const { data, error } = await supabase.from("team_game_stats").select("*").eq("game_id", gameId);
  if (error) throw new Error(`Failed to fetch team game stats for ${gameId}: ${error.message}`);
  return (data ?? []).map((row) =>
    parseNumericFields<TeamGameStat>(row as unknown as TeamGameStat, TEAM_GAME_NUMERIC)
  );
}

/**
 * The weekly rows behind the player tables: both teams' QB, receiver and RB
 * rows for `season` + `week` (spec §6: taken from the `games` row, never the
 * URL), plus name / position / slug for every player_id they name — the
 * weekly tables store none of those. A player with no player_slugs row is
 * left out of `players`; the table then shows his id, unlinked.
 */
export async function getGamePlayerLines(
  season: number,
  week: number,
  teamIds: string[]
): Promise<GamePlayerLines> {
  const supabase = createServerClient();
  const weekly = async <T,>(table: string, numeric: string[]): Promise<T[]> => {
    const { data, error } = await supabase
      .from(table)
      .select("*")
      .eq("season", season)
      .eq("week", week)
      .in("team_id", teamIds);
    if (error) throw new Error(`Failed to fetch ${table} for ${season} week ${week}: ${error.message}`);
    return (data ?? []).map((row) => parseNumericFields<T>(row as unknown as T, numeric));
  };
  const [qbs, receivers, rbs] = await Promise.all([
    weekly<QBWeeklyStat>("qb_weekly_stats", QB_WEEKLY_NUMERIC),
    weekly<ReceiverWeeklyStat>("receiver_weekly_stats", RECEIVER_WEEKLY_NUMERIC),
    weekly<RBWeeklyStat>("rb_weekly_stats", RB_WEEKLY_NUMERIC),
  ]);

  const ids = Array.from(
    new Set(
      [...qbs, ...receivers, ...rbs]
        .map((r) => r.player_id)
        .filter((id): id is string => typeof id === "string" && id.length > 0)
    )
  );
  const players: Record<string, PlayerIdentity> = {};
  if (ids.length > 0) {
    const { data, error } = await supabase
      .from("player_slugs")
      .select("player_id, player_name, position, slug")
      .in("player_id", ids);
    if (error) throw new Error(`Failed to fetch player identities: ${error.message}`);
    for (const row of (data ?? []) as PlayerIdentity[]) {
      if (typeof row?.player_id !== "string") continue;
      players[row.player_id] = {
        player_id: row.player_id,
        player_name: row.player_name,
        position: row.position,
        slug: row.slug ?? null,
      };
    }
  }
  return { qbs, receivers, rbs, players };
}

/**
 * Assemble one game's box score. Reads: the `games` row; then both teams'
 * schedules (records) and the team_game_stats rows in parallel; then, when the
 * rows exist, the player lines. When they don't, the covered-seasons probe
 * decides between "uncovered" and "pending". Every read throws on failure.
 */
export async function getBoxScore(gameId: string): Promise<BoxScoreData> {
  const game = await getGame(gameId);
  if (!game) return { state: "not-found" };
  if (game.home_score === null || game.away_score === null) return { state: "unplayed", game };
  const played = game as PlayedGame;

  // A playoff game pays for a getTeamGameStats read the check below discards.
  // Deliberate: moving the game_type check above this Promise.all would cost
  // the common (regular-season) case a serial round trip. Leave it.
  const [awaySchedule, homeSchedule, statRows] = await Promise.all([
    getTeamSchedule(game.away_team, game.season),
    getTeamSchedule(game.home_team, game.season),
    getTeamGameStats(gameId),
  ]);
  const records: GameRecords = {
    away: recordThroughWeek(awaySchedule, game.week),
    home: recordThroughWeek(homeSchedule, game.week),
  };

  // Playoffs are out of scope (spec §2): the ingest skips them, so no rows ever come.
  if (game.game_type !== "REG") {
    return { state: "uncovered", game: played, records, reason: "playoffs", firstSeason: null };
  }

  const away = statRows.find((r) => r.team_id === game.away_team);
  const home = statRows.find((r) => r.team_id === game.home_team);
  if (!away || !home) {
    const seasons = await getAvailableSeasons();
    // getAvailableSeasons returns [] on a query error; a real database always
    // has data_freshness rows, so empty means the read failed (homepage rule).
    if (seasons.length === 0) {
      throw new Error("Box score: no seasons from data_freshness (query failed or table empty)");
    }
    const covered = await getBoxScoreSeasons(seasons);
    const firstSeason = covered.length > 0 ? Math.min(...covered) : null;
    if (firstSeason !== null && game.season < firstSeason) {
      return { state: "uncovered", game: played, records, reason: "season", firstSeason };
    }
    return { state: "pending", game: played, records };
  }

  const lines = await getGamePlayerLines(game.season, game.week, [game.away_team, game.home_team]);
  return { state: "ready", game: played, records, away, home, lines };
}
```

- [ ] **Step 6: Run the tests to verify they pass**

```bash
node "C:/Users/jonra/OneDrive/Desktop/claude sandbox/football website/yards-per-pass/node_modules/vitest/vitest.mjs" run --root "C:/Users/jonra/OneDrive/Desktop/claude sandbox/football website/yards-per-pass" __tests__/data/games.test.ts __tests__/data/box-score.test.ts
```

Expected: PASS — 15 tests in `games.test.ts`, 18 in `box-score.test.ts`.

- [ ] **Step 7: Type check and lint**

```bash
node "C:/Users/jonra/OneDrive/Desktop/claude sandbox/football website/yards-per-pass/node_modules/typescript/bin/tsc" --noEmit -p "C:/Users/jonra/OneDrive/Desktop/claude sandbox/football website/yards-per-pass/tsconfig.json"
```

Expected: no output, exit 0.

```bash
npm --prefix "C:/Users/jonra/OneDrive/Desktop/claude sandbox/football website/yards-per-pass" run lint
```

Expected: only the four pre-existing warnings.

- [ ] **Step 8: Commit**

```bash
git -C "C:/Users/jonra/OneDrive/Desktop/claude sandbox/football website/yards-per-pass" add lib/data/games.ts lib/data/box-score.ts __tests__/data/games.test.ts __tests__/data/box-score.test.ts
```

```bash
git -C "C:/Users/jonra/OneDrive/Desktop/claude sandbox/football website/yards-per-pass" commit -m "feat: box score reads with explicit page states" -m "getBoxScore(gameId) returns not-found / unplayed / uncovered / pending / ready from games, both schedules, team_game_stats, the three weekly tables and player_slugs; every read throws on a query error (box score spec section 6). getBoxScoreSeasons probes each season with limit 1 so the link gate never hits the 1000-row cap (section 7). getGame and getPlayedRegularSeasonGameIds join lib/data/games.ts." -m "Co-Authored-By: Claude <noreply@anthropic.com>"
```

---
### Task 4: `Scoreboard` and `GameMessage` components

**Files:**
- Create: `components/game/Scoreboard.tsx`
- Create: `components/game/GameMessage.tsx`
- Test: `__tests__/components/game/Scoreboard.test.tsx` (create; `GameMessage` is covered in Task 6's test file together with `PlayerTable`)

**Interfaces:**
- Consumes: `ScoreboardModel`, `ScoreboardTeam`, `buildScoreboard` (Task 2); `next/image`, `next/link`.
- Produces: `default export Scoreboard({ model }: { model: ScoreboardModel })` and `default export GameMessage({ kind, heading, body, links? }: { kind: string; heading: string; body: string; links?: { href: string; label: string }[] })`, both server-renderable (no `"use client"`). Data hooks for tests: `[data-scoreboard]`, `[data-scoreboard-label]`, `[data-scoreboard-team="away"|"home"]`, `[data-scoreboard-score]`, `[data-score="away"|"home"]`, `[data-game-message="<kind>"]`. PR 4 reuses `Scoreboard`'s model for its cards.

- [ ] **Step 1: Write the failing Scoreboard test**

Create `__tests__/components/game/Scoreboard.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import Scoreboard from "@/components/game/Scoreboard";
import { buildScoreboard } from "@/lib/stats/box-score";
import { BUF_HOU_GAME } from "../../fixtures/box-score-buf-hou";

const today = new Date(2026, 8, 21);
const model = buildScoreboard(BUF_HOU_GAME, { wins: 1, losses: 0, ties: 0 }, { wins: 0, losses: 1, ties: 0 }, today);

describe("Scoreboard", () => {
  it("renders the band, both teams with records, and the winner's score in gold", () => {
    const { container } = render(<Scoreboard model={model} />);
    expect(container.querySelector("[data-scoreboard-label]")?.textContent).toBe("WEEK 1 · SUN SEP 13");
    expect(container.textContent).toContain("FINAL");
    const away = container.querySelector('[data-scoreboard-team="away"]')!;
    expect(away.getAttribute("href")).toBe("/team/BUF");
    expect(away.getAttribute("title")).toBe("Buffalo Bills team page");
    expect(away.textContent).toBe("BUFBills · 1-0");
    expect(away.querySelector("img")?.getAttribute("alt")).toBe("Buffalo Bills");
    const home = container.querySelector('[data-scoreboard-team="home"]')!;
    expect(home.getAttribute("href")).toBe("/team/HOU");
    expect(home.textContent).toBe("HOUTexans · 0-1");
    expect((container.querySelector('[data-score="away"]') as HTMLElement).style.color).toBe("rgb(251, 191, 36)");
    expect((container.querySelector('[data-score="home"]') as HTMLElement).style.color).toBe("");
    expect(container.querySelector("[data-scoreboard-score]")?.textContent).toBe("36–31");
  });

  it("omits the date when unknown and the logo when the team is unknown", () => {
    const { container } = render(
      <Scoreboard model={{ ...model, dateLabel: "", away: { ...model.away, logo: "", winner: false }, home: { ...model.home, winner: false } }} />
    );
    expect(container.querySelector("[data-scoreboard-label]")?.textContent).toBe("WEEK 1");
    expect(container.querySelectorAll("img")).toHaveLength(1);
    expect((container.querySelector('[data-score="away"]') as HTMLElement).style.color).toBe("");
    expect(container.textContent).not.toMatch(/undefined|NaN|null/);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
node "C:/Users/jonra/OneDrive/Desktop/claude sandbox/football website/yards-per-pass/node_modules/vitest/vitest.mjs" run --root "C:/Users/jonra/OneDrive/Desktop/claude sandbox/football website/yards-per-pass" __tests__/components/game/Scoreboard.test.tsx
```

Expected: FAIL — `Failed to resolve import "@/components/game/Scoreboard"`.

- [ ] **Step 3: Create `components/game/Scoreboard.tsx`**

The approved look: dark panel `#0f172a`, slate band `#1e3a5f` reading `WEEK 1 · SUN SEP 13` left and `FINAL` right in the pixel font; away team left / home team right (logo, abbreviation in the pixel font, nickname + record in Inter); the score in Inter extrabold with the winner's number in gold `#fbbf24`; team names link to the team pages. On phones the logos shrink, the nickname hides and the score drops to 28px.

```tsx
// components/game/Scoreboard.tsx — Tecmo scoreboard header for one game.
// Dark panel, a slate band ("WEEK 1 · SUN SEP 13" left, "FINAL" right) in the
// pixel font, away team left / home team right — logo, abbreviation in the
// pixel font, nickname + record after this game in the regular font — and the
// big score with the winner's number in gold. Numbers never use the pixel
// font (site convention). No "use client": the game page renders it on the
// server, and PR 4's /scores cards and homepage strip reuse the same
// buildScoreboard model from lib/stats/box-score.ts.
import Image from "next/image";
import Link from "next/link";
import type { ScoreboardModel, ScoreboardTeam } from "@/lib/stats/box-score";

const PIXEL = "font-[family-name:var(--font-pixel)]";
const PANEL_BG = "#0f172a";
const BAND_BG = "#1e3a5f";
const GOLD = "#fbbf24";

function TeamSide({ team, side }: { team: ScoreboardTeam; side: "away" | "home" }) {
  const home = side === "home";
  return (
    <Link
      href={`/team/${team.id}`}
      title={`${team.name} team page`}
      data-scoreboard-team={side}
      className={`group flex min-w-0 items-center gap-2 md:gap-3.5 ${home ? "flex-row-reverse text-right" : ""}`}
    >
      {team.logo && (
        <Image
          src={team.logo}
          alt={team.name}
          width={46}
          height={46}
          className="h-[30px] w-[30px] shrink-0 object-contain md:h-[46px] md:w-[46px]"
        />
      )}
      <span className="flex min-w-0 flex-col gap-1.5">
        <span
          className={`${PIXEL} text-[12px] leading-none text-white group-hover:underline group-hover:underline-offset-4 md:text-[17px]`}
        >
          {team.abbreviation}
        </span>
        <span className="whitespace-nowrap text-[12px] text-slate-400 md:text-[12.5px]">
          <span className="hidden md:inline">{team.nickname} · </span>
          <b className="font-bold tabular-nums text-slate-200">{team.record}</b>
        </span>
      </span>
    </Link>
  );
}

export default function Scoreboard({ model }: { model: ScoreboardModel }) {
  const { away, home } = model;
  return (
    <section
      data-scoreboard
      className="overflow-hidden rounded-xl text-slate-200 shadow"
      style={{ background: PANEL_BG }}
    >
      <div
        className={`${PIXEL} flex justify-between gap-3 px-3.5 py-2.5 text-[8px] tracking-wider text-slate-300 md:px-5 md:text-[10px]`}
        style={{ background: BAND_BG }}
      >
        <span data-scoreboard-label>
          {model.label}
          {model.dateLabel ? ` · ${model.dateLabel}` : ""}
        </span>
        <span className="text-white">FINAL</span>
      </div>
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 px-3.5 py-4 md:gap-3 md:px-6 md:py-5">
        <TeamSide team={away} side="away" />
        <div
          data-scoreboard-score
          className="whitespace-nowrap text-[28px] font-extrabold leading-none tracking-tight tabular-nums md:text-[42px]"
        >
          <span data-score="away" style={away.winner ? { color: GOLD } : undefined}>
            {away.score}
          </span>
          <span className="mx-1.5 font-semibold text-slate-600 md:mx-3">–</span>
          <span data-score="home" style={home.winner ? { color: GOLD } : undefined}>
            {home.score}
          </span>
        </div>
        <TeamSide team={home} side="home" />
      </div>
    </section>
  );
}
```

- [ ] **Step 4: Create `components/game/GameMessage.tsx`**

```tsx
// components/game/GameMessage.tsx — the message card under the scoreboard when
// a played game has no box score (box score spec §6 states): a heading, one
// line of explanation and, when useful, links to both team pages. Never a
// blank page (MEMORY.md rule).
import Link from "next/link";

export interface GameMessageLink {
  href: string;
  label: string;
}

interface GameMessageProps {
  /** "uncovered" | "pending" — for tests and styling hooks. */
  kind: string;
  heading: string;
  body: string;
  links?: GameMessageLink[];
}

export default function GameMessage({ kind, heading, body, links = [] }: GameMessageProps) {
  return (
    <section
      data-game-message={kind}
      className="rounded-xl border border-gray-200 bg-white px-5 py-6 text-center"
    >
      <h2 className="text-lg font-bold text-navy">{heading}</h2>
      <p className="mx-auto mt-1.5 max-w-[48ch] text-sm leading-relaxed text-gray-500">{body}</p>
      {links.length > 0 && (
        <div className="mt-3.5 flex flex-wrap justify-center gap-x-5 gap-y-2">
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="text-sm font-semibold text-navy transition-colors hover:text-nflred"
            >
              {link.label} ›
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}
```

- [ ] **Step 5: Run the test to verify it passes**

```bash
node "C:/Users/jonra/OneDrive/Desktop/claude sandbox/football website/yards-per-pass/node_modules/vitest/vitest.mjs" run --root "C:/Users/jonra/OneDrive/Desktop/claude sandbox/football website/yards-per-pass" __tests__/components/game/Scoreboard.test.tsx
```

Expected: PASS, 2 tests.

- [ ] **Step 6: Type check, lint, commit**

```bash
node "C:/Users/jonra/OneDrive/Desktop/claude sandbox/football website/yards-per-pass/node_modules/typescript/bin/tsc" --noEmit -p "C:/Users/jonra/OneDrive/Desktop/claude sandbox/football website/yards-per-pass/tsconfig.json"
```

Expected: no output, exit 0.

```bash
npm --prefix "C:/Users/jonra/OneDrive/Desktop/claude sandbox/football website/yards-per-pass" run lint
```

Expected: only the four pre-existing warnings.

```bash
git -C "C:/Users/jonra/OneDrive/Desktop/claude sandbox/football website/yards-per-pass" add components/game/Scoreboard.tsx components/game/GameMessage.tsx __tests__/components/game/Scoreboard.test.tsx
```

```bash
git -C "C:/Users/jonra/OneDrive/Desktop/claude sandbox/football website/yards-per-pass" commit -m "feat: Tecmo scoreboard header and game message card" -m "Scoreboard renders buildScoreboard's model (week and date band, logos, records after the game, winner in gold, team links). GameMessage is the card under it for games without a box score (box score spec section 6)." -m "Co-Authored-By: Claude <noreply@anthropic.com>"
```

---
### Task 5: `ComparisonSection` and the four tooltip definitions

**Files:**
- Modify: `components/ui/MetricTooltip.tsx` (the `METRIC_DEFINITIONS` map ends at line 79 with the `"TCH/G"` entry)
- Create: `components/game/ComparisonSection.tsx`
- Test: `__tests__/components/game/ComparisonSection.test.tsx` (create), `__tests__/components/MetricTooltip.test.tsx` (create)

**Interfaces:**
- Consumes: `ComparisonRow`, `ComparisonSectionModel`, `Side`, `StatCell`, `buildComparison` (Task 2); `MetricTooltip` (`@/components/ui/MetricTooltip`, a client component the server section may render).
- Produces: `default export ComparisonSection({ section, awayId, homeId, footnote? }: { section: ComparisonSectionModel; awayId: string; homeId: string; footnote?: ReactNode })`, server-renderable. Data hooks: `[data-section="<key>"]`, `[data-row="<row key>"]`, `data-better="away"|"home"` on a shaded row. `METRIC_DEFINITIONS` gains the keys `"EPA / play"`, `"Success rate"`, `"Explosive plays"`, `"Toxic differential"` (Task 2's rows name exactly these).

- [ ] **Step 1: Write the failing tests**

Create `__tests__/components/game/ComparisonSection.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";

vi.mock("@/components/ui/MetricTooltip", () => ({
  default: ({ metric }: { metric: string }) => <span data-tooltip={metric} />,
}));

import ComparisonSection from "@/components/game/ComparisonSection";
import { buildComparison, type ComparisonSectionModel } from "@/lib/stats/box-score";
import { BUF_STATS, HOU_STATS } from "../../fixtures/box-score-buf-hou";

const [efficiency, teamStats] = buildComparison(BUF_STATS, HOU_STATS);

function renderSection(section: ComparisonSectionModel, footnote?: string) {
  return render(<ComparisonSection section={section} awayId="BUF" homeId="HOU" footnote={footnote} />);
}

describe("ComparisonSection", () => {
  it("bands the away abbreviation, title and home abbreviation on the 28/1fr/28 grid", () => {
    const { container } = renderSection(efficiency);
    const band = container.querySelector("h2")!;
    expect(band.className).toContain("grid-cols-[28%_1fr_28%]");
    const spans = Array.from(band.querySelectorAll("span")).map((s) => [s.textContent, s.className.includes("text-right"), s.className.includes("text-left")]);
    expect(spans).toEqual([["BUF", true, false], ["Efficiency", false, false], ["HOU", false, true]]);
    const cols = container.querySelectorAll("colgroup col");
    expect(cols[0].className).toContain("w-[28%]");
    expect(cols[2].className).toContain("w-[28%]");
  });

  it("aligns away values right and home values left, shades the better side, mutes details", () => {
    const { container } = renderSection(efficiency);
    const row = container.querySelector('[data-row="epa"]')!;
    const [away, label, home] = Array.from(row.querySelectorAll("td"));
    expect(away.className).toContain("text-right");
    expect(home.className).toContain("text-left");
    expect(label.className).toContain("text-center");
    expect(row.getAttribute("data-better")).toBe("away");
    expect((away as HTMLElement).style.backgroundColor).toBe("rgb(236, 253, 245)");
    expect((away as HTMLElement).style.color).toBe("rgb(6, 95, 70)");
    expect(away.className).toContain("font-bold");
    expect((home as HTMLElement).style.backgroundColor).toBe("");
    expect(away.textContent).toBe("+0.28(56)");
    expect(away.querySelector("span")?.textContent).toBe("(56)");
    expect(away.querySelector("span")?.className).toContain("text-[#3f8f72]");
    expect(home.querySelector("span")?.className).toContain("text-slate-400");
  });

  it("prefixes sub-rows with the arrow in lighter type and leaves equal rows unshaded", () => {
    const { container } = renderSection(efficiency);
    const sub = container.querySelector('[data-row="epa-pass"]')!;
    expect(sub.querySelectorAll("td")[1].textContent).toBe("↳ Passing");
    // BUF is the better side of this sub-row (bold); HOU's cell shows the lighter sub-row type.
    expect(sub.querySelectorAll("td")[0].className).toContain("font-bold");
    expect(sub.querySelectorAll("td")[2].className).toContain("font-medium");
    const equal = container.querySelector('[data-row="explosive"]')!;
    expect(equal.getAttribute("data-better")).toBeNull();
    for (const td of Array.from(equal.querySelectorAll("td"))) expect((td as HTMLElement).style.backgroundColor).toBe("");
  });

  it("renders a tooltip on the rows that carry one, label details and suffixes", () => {
    const { container } = renderSection(efficiency);
    expect(Array.from(container.querySelectorAll("[data-tooltip]")).map((e) => e.getAttribute("data-tooltip"))).toEqual([
      "EPA / play", "Success rate", "Explosive plays", "Toxic differential",
    ]);
    expect(container.querySelector('[data-row="epa"] td:nth-child(2)')?.textContent).toBe("EPA / play(plays)");
    const downs = buildComparison(BUF_STATS, HOU_STATS)[3];
    const { container: c2 } = renderSection(downs);
    expect(c2.querySelector('[data-row="early-epa"] td:nth-child(2)')?.textContent).toBe("Early downs(1st–2nd) EPA / play");
    expect(c2.querySelectorAll("[data-tooltip]")).toHaveLength(0);
  });

  it("shows the footnote only when given", () => {
    const { container } = renderSection(teamStats, "Why the play counts differ.");
    expect(container.querySelector("p")?.textContent).toBe("Why the play counts differ.");
    const { container: bare } = renderSection(teamStats);
    expect(bare.querySelector("p")).toBeNull();
    expect(bare.querySelectorAll("[data-row]")).toHaveLength(25);
  });
});
```

Create `__tests__/components/MetricTooltip.test.tsx` (the real base-ui tooltip renders in jsdom under its provider):

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import MetricTooltip, { METRIC_DEFINITIONS as DEFINITION_TEXT } from "@/components/ui/MetricTooltip";
import { TooltipProvider } from "@/components/ui/tooltip";

describe("MetricTooltip — box score definitions (spec §4)", () => {
  it.each([
    ["EPA / play", "the way nflfastR and rbsdm.com do"],
    ["Success rate", "EPA above zero"],
    ["Explosive plays", "QB scrambles of 10+ yards count as explosive runs"],
    ["Toxic differential", "Turnover margin plus explosive-play margin"],
  ])("defines %s", (metric, fragment) => {
    render(
      <TooltipProvider>
        <MetricTooltip metric={metric} />
      </TooltipProvider>
    );
    expect(screen.getByLabelText(`What is ${metric}?`)).toBeTruthy();
    expect(DEFINITION_TEXT[metric]).toContain(fragment);
  });

  it("renders nothing for an unknown metric", () => {
    const { container } = render(
      <TooltipProvider>
        <MetricTooltip metric="No such stat" />
      </TooltipProvider>
    );
    expect(container.innerHTML).toBe("");
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

```bash
node "C:/Users/jonra/OneDrive/Desktop/claude sandbox/football website/yards-per-pass/node_modules/vitest/vitest.mjs" run --root "C:/Users/jonra/OneDrive/Desktop/claude sandbox/football website/yards-per-pass" __tests__/components/game/ComparisonSection.test.tsx __tests__/components/MetricTooltip.test.tsx
```

Expected: `ComparisonSection.test.tsx` fails to load (`Failed to resolve import "@/components/game/ComparisonSection"`); `MetricTooltip.test.tsx` also fails to load, because `METRIC_DEFINITIONS` is still module-private (`does not provide an export named 'METRIC_DEFINITIONS'`) — Step 3 adds the `export`. With only that export added and the definitions still missing, the four `defines …` tests FAIL (`Unable to find a label with the text of: What is EPA / play?` — `MetricTooltip` returns null for an unknown key) and `renders nothing for an unknown metric` passes.

- [ ] **Step 3: Add the definitions**

In `components/ui/MetricTooltip.tsx`, change `const METRIC_DEFINITIONS: Record<string, string> = {` to `export const METRIC_DEFINITIONS: Record<string, string> = {` (the test imports it to pin the definition text), then change the end of the map

```ts
  "TCH/G":
    "Touches per game \u2014 (carries + receptions) \u00f7 games played. Measures per-game workload.",
};
```

to

```ts
  "TCH/G":
    "Touches per game \u2014 (carries + receptions) \u00f7 games played. Measures per-game workload.",
  // Box score page (spec §4 definitions). "EPA / play" and "Success rate" are
  // the team-level, nflfastR-style versions — the QB entries above exclude sacks.
  "EPA / play":
    "Expected points added per play: how much each snap moved the offense\u2019s expected points. Counts every run and dropback, the way nflfastR and rbsdm.com do.",
  "Success rate": "Share of plays that gained expected points (EPA above zero).",
  "Explosive plays":
    "Runs of 10+ yards and completions of 20+ yards. QB scrambles of 10+ yards count as explosive runs.",
  "Toxic differential":
    "Turnover margin plus explosive-play margin, using the explosive plays counted above.",
};
```

- [ ] **Step 4: Create `components/game/ComparisonSection.tsx`**

The approved look: a white `rounded-xl shadow` card; a dark band (`#0f172a`) laid out as a 28% / 1fr / 28% grid — away abbreviation right-aligned over the away column, section title centred, home abbreviation left-aligned — and the table below on the same widths: away values right-aligned, label centred, home values left-aligned; sub-rows start with "↳ " in lighter type; detail values in muted grey after the main value (they wrap under it on phones); the better side's cell shaded `#ecfdf5` with bold `#065f46` text.

```tsx
// components/game/ComparisonSection.tsx — one AWAY | stat | HOME stat sheet
// (box score spec §6). The dark band and the table share a 28% / 1fr / 28%
// grid: away abbreviation and values right-aligned, the title and labels
// centred, home abbreviation and values left-aligned. Sub-rows start with
// "↳ " in lighter type, detail values sit in muted grey after the main value,
// and the better side's cell is shaded. Pure presentation of a
// ComparisonSectionModel from lib/stats/box-score.ts.
import type { ReactNode } from "react";
import MetricTooltip from "@/components/ui/MetricTooltip";
import type { ComparisonRow, ComparisonSectionModel, Side, StatCell } from "@/lib/stats/box-score";

const PIXEL = "font-[family-name:var(--font-pixel)]";
const PANEL_BG = "#0f172a";
/** The shaded better-side cell: emerald-50 background, emerald-800 bold text. */
const EDGE = { background: "#ecfdf5", color: "#065f46" } as const;

function valueClass(row: ComparisonRow, side: Side): string {
  const align = side === "away" ? "text-right" : "text-left";
  const tone =
    row.better === side
      ? "font-bold"
      : row.sub
        ? "font-medium text-slate-600"
        : "font-semibold text-[#0f172a]";
  const size = row.sub ? "text-[13px] md:text-[14px]" : "text-[14px] md:text-[15px]";
  return `px-2 py-1.5 md:px-4 ${align} ${tone} ${size}`;
}

function Value({ cell, edge }: { cell: StatCell; edge: boolean }) {
  return (
    <>
      {cell.main}
      {cell.detail && (
        <span
          className={`ml-1 text-[12.5px] font-normal max-md:ml-0 max-md:block max-md:text-[11.5px] ${
            edge ? "text-[#3f8f72]" : "text-slate-400"
          }`}
        >
          {cell.detail}
        </span>
      )}
    </>
  );
}

interface ComparisonSectionProps {
  section: ComparisonSectionModel;
  awayId: string;
  homeId: string;
  /** Note under the table (spec §12); omitted when absent. */
  footnote?: ReactNode;
}

export default function ComparisonSection({ section, awayId, homeId, footnote }: ComparisonSectionProps) {
  return (
    <section data-section={section.key} className="overflow-hidden rounded-xl bg-white shadow">
      <h2
        className={`${PIXEL} grid grid-cols-[28%_1fr_28%] items-center py-3 text-[9px] uppercase tracking-wide text-white md:text-[11px]`}
        style={{ background: PANEL_BG }}
      >
        <span className="px-2 text-right md:px-4">{awayId}</span>
        <span className="px-2 text-center md:px-4">{section.title}</span>
        <span className="px-2 text-left md:px-4">{homeId}</span>
      </h2>
      <table className="w-full border-collapse tabular-nums">
        <colgroup>
          <col className="w-[28%]" />
          <col />
          <col className="w-[28%]" />
        </colgroup>
        <tbody>
          {section.rows.map((row) => (
            <tr
              key={row.key}
              data-row={row.key}
              data-better={row.better ?? undefined}
              className="border-b border-slate-100 last:border-b-0"
            >
              <td className={valueClass(row, "away")} style={row.better === "away" ? EDGE : undefined}>
                <Value cell={row.away} edge={row.better === "away"} />
              </td>
              <td
                className={`px-2 py-1.5 text-center md:px-4 ${
                  row.sub
                    ? "text-[11.5px] font-normal text-slate-500 md:text-[13px]"
                    : "text-[12px] font-semibold text-[#0f172a] md:text-[13.5px]"
                }`}
              >
                {row.sub && <span className="text-slate-300">↳ </span>}
                {row.label}
                {row.labelDetail && <span className="ml-1 font-normal text-slate-400">{row.labelDetail}</span>}
                {row.labelSuffix && <span> {row.labelSuffix}</span>}
                {row.tooltip && <MetricTooltip metric={row.tooltip} />}
              </td>
              <td className={valueClass(row, "home")} style={row.better === "home" ? EDGE : undefined}>
                <Value cell={row.home} edge={row.better === "home"} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {footnote && (
        <p className="border-t border-slate-100 px-4 py-2.5 text-xs leading-relaxed text-slate-500">{footnote}</p>
      )}
    </section>
  );
}
```

- [ ] **Step 5: Run the tests to verify they pass**

```bash
node "C:/Users/jonra/OneDrive/Desktop/claude sandbox/football website/yards-per-pass/node_modules/vitest/vitest.mjs" run --root "C:/Users/jonra/OneDrive/Desktop/claude sandbox/football website/yards-per-pass" __tests__/components/game/ComparisonSection.test.tsx __tests__/components/MetricTooltip.test.tsx
```

Expected: PASS — 5 tests in each file.

- [ ] **Step 6: Type check, lint, commit**

```bash
node "C:/Users/jonra/OneDrive/Desktop/claude sandbox/football website/yards-per-pass/node_modules/typescript/bin/tsc" --noEmit -p "C:/Users/jonra/OneDrive/Desktop/claude sandbox/football website/yards-per-pass/tsconfig.json"
```

Expected: no output, exit 0.

```bash
npm --prefix "C:/Users/jonra/OneDrive/Desktop/claude sandbox/football website/yards-per-pass" run lint
```

Expected: only the four pre-existing warnings.

```bash
git -C "C:/Users/jonra/OneDrive/Desktop/claude sandbox/football website/yards-per-pass" add components/game/ComparisonSection.tsx components/ui/MetricTooltip.tsx __tests__/components/game/ComparisonSection.test.tsx __tests__/components/MetricTooltip.test.tsx
```

```bash
git -C "C:/Users/jonra/OneDrive/Desktop/claude sandbox/football website/yards-per-pass" commit -m "feat: AWAY | stat | HOME comparison section with box score tooltips" -m "ComparisonSection renders a buildComparison section on the mockup's 28/1fr/28 band and table, shading the better side. MetricTooltip gains the team-level EPA / play, Success rate, Explosive plays (scrambles count) and Toxic differential definitions (box score spec section 4)." -m "Co-Authored-By: Claude <noreply@anthropic.com>"
```

---
### Task 6: `PlayerTable` component

**Files:**
- Create: `components/game/PlayerTable.tsx`
- Test: `__tests__/components/game/PlayerTable.test.tsx` (create; also covers Task 4's `GameMessage`)

**Interfaces:**
- Consumes: `PlayerTableModel`, `epaCellClass`, `buildRushingTable`, `buildReceivingTable` (Task 2); `GameMessage` (Task 4).
- Produces: `default export PlayerTable({ model, footnote? }: { model: PlayerTableModel; footnote?: ReactNode })`, server-renderable. Data hooks: `[data-player-table="passing"|"rushing"|"receiving"]`, `[data-team-row="<team>"]`, `[data-player-id="<id>"]`, `[data-empty-team="<team>"]`.

- [ ] **Step 1: Write the failing tests**

Create `__tests__/components/game/PlayerTable.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import PlayerTable from "@/components/game/PlayerTable";
import GameMessage from "@/components/game/GameMessage";
import { buildReceivingTable, buildRushingTable, type PlayerTableModel } from "@/lib/stats/box-score";
import { BUF_HOU_LINES } from "../../fixtures/box-score-buf-hou";

const M = "\u2212";

describe("PlayerTable", () => {
  const rushing = buildRushingTable(BUF_HOU_LINES, "BUF", "HOU");
  const receiving = buildReceivingTable(BUF_HOU_LINES, "BUF", "HOU", { BUF: 28, HOU: 37 });

  it("bands the title, heads the columns, and groups rows under team sub-headers, away first", () => {
    const { container } = render(<PlayerTable model={rushing} />);
    expect(container.querySelector("h2")?.textContent).toBe("Rushing");
    expect(Array.from(container.querySelectorAll("th")).map((th) => th.textContent)).toEqual(["Player", "CAR", "YDS", "TD", "YPC", "EPA/CAR", "SUCC%"]);
    expect(container.querySelectorAll("th")[0].className).toContain("text-left");
    expect(container.querySelectorAll("th")[1].className).toContain("text-right");
    const teamRows = Array.from(container.querySelectorAll("[data-team-row]"));
    expect(teamRows.map((r) => r.getAttribute("data-team-row"))).toEqual(["BUF", "HOU"]);
    expect((teamRows[0].querySelector("span") as HTMLElement).style.backgroundColor).toBe("rgb(0, 51, 141)");
    expect(teamRows[0].querySelector("td")?.getAttribute("colspan")).toBe("7");
    const order = Array.from(container.querySelectorAll("tbody tr")).map((r) => r.getAttribute("data-team-row") ?? r.getAttribute("data-player-id"));
    expect(order).toEqual(["BUF", "00-0038545", "00-0034857", "00-0039352", "00-0039354", "HOU", "00-0036212", "00-0039916", "00-0039163"]);
  });

  it("links names to player pages with a position tag, colours EPA cells, scrolls sideways", () => {
    const { container } = render(<PlayerTable model={rushing} />);
    const cook = container.querySelector('[data-player-id="00-0038545"]')!;
    expect(cook.querySelector("a")?.getAttribute("href")).toBe("/player/james-cook");
    expect(cook.querySelector("a")?.textContent).toBe("James Cook");
    expect(cook.querySelector("td")?.textContent).toBe("James CookRB");
    expect(Array.from(cook.querySelectorAll("td")).slice(1).map((td) => td.textContent)).toEqual(["13", "57", "0", "4.4", `${M}0.01`, "38%"]);
    expect(cook.querySelectorAll("td")[5].className).toContain("text-amber-600");
    expect(cook.querySelectorAll("td")[1].className).toContain("text-gray-900");
    const allen = container.querySelector('[data-player-id="00-0034857"]')!;
    expect(allen.querySelectorAll("td")[5].className).toContain("text-red-600");
    expect(container.querySelector("table")?.parentElement?.className).toContain("overflow-x-auto");
  });

  it("shows the team-targets note on Receiving and an unlinked name for a player without a slug", () => {
    const model: PlayerTableModel = {
      ...receiving,
      teams: receiving.teams.map((t, i) => (i === 0 ? { ...t, rows: t.rows.map((r) => (r.player_id === "00-0038557" ? { ...r, slug: null } : r)) } : t)),
    };
    const { container } = render(<PlayerTable model={model} footnote="Footnote text." />);
    expect(container.querySelector('[data-team-row="BUF"]')?.textContent).toBe("BUF · 28 team targets");
    const kincaid = container.querySelector('[data-player-id="00-0038557"]')!;
    expect(kincaid.querySelector("a")).toBeNull();
    expect(kincaid.querySelector("td")?.textContent).toBe("Dalton KincaidTE");
    expect(container.querySelector("p")?.textContent).toBe("Footnote text.");
  });

  it("says so when a team has no line, and never prints undefined or NaN", () => {
    const empty: PlayerTableModel = { key: "passing", title: "Passing", columns: ["Player", "C/ATT"], teams: [{ team_id: "BUF", color: "#00338D", rows: [] }, { team_id: "HOU", color: "#03202F", rows: [] }] };
    const { container } = render(<PlayerTable model={empty} />);
    expect(container.querySelectorAll("[data-empty-team]")).toHaveLength(2);
    expect(container.querySelector("[data-empty-team]")?.textContent).toBe("No passing line for BUF");
    expect(container.textContent).not.toMatch(/undefined|NaN|null/);
  });
});

describe("GameMessage", () => {
  it("renders the heading, body and team links", () => {
    const { container } = render(
      <GameMessage kind="uncovered" heading="Box scores start with the 2026 season" body="Not yet." links={[{ href: "/team/PHI", label: "Philadelphia Eagles" }, { href: "/team/LAC", label: "Los Angeles Chargers" }]} />
    );
    expect(container.querySelector('[data-game-message="uncovered"] h2')?.textContent).toBe("Box scores start with the 2026 season");
    expect(container.querySelector("p")?.textContent).toBe("Not yet.");
    expect(Array.from(container.querySelectorAll("a")).map((a) => [a.getAttribute("href"), a.textContent])).toEqual([
      ["/team/PHI", "Philadelphia Eagles ›"], ["/team/LAC", "Los Angeles Chargers ›"],
    ]);
  });

  it("renders no link row without links", () => {
    const { container } = render(<GameMessage kind="pending" heading="Stats arrive once play-by-play is published" body="Soon." />);
    expect(container.querySelectorAll("a")).toHaveLength(0);
    expect(container.querySelector('[data-game-message="pending"]')).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
node "C:/Users/jonra/OneDrive/Desktop/claude sandbox/football website/yards-per-pass/node_modules/vitest/vitest.mjs" run --root "C:/Users/jonra/OneDrive/Desktop/claude sandbox/football website/yards-per-pass" __tests__/components/game/PlayerTable.test.tsx
```

Expected: FAIL — `Failed to resolve import "@/components/game/PlayerTable"`.

- [ ] **Step 3: Create `components/game/PlayerTable.tsx`**

The approved look: band title PASSING / RUSHING / RECEIVING; a team sub-header row (team-colour square + abbreviation, `· 28 team targets` on Receiving); the away team's rows first; names link to player pages with a small grey position tag; EPA cells coloured with the site's thresholds, null/NaN grey; the table scrolls sideways in its own container on phones.

```tsx
// components/game/PlayerTable.tsx — one player-lines table (type A, box score
// spec §6): a PASSING / RUSHING / RECEIVING band, a sub-header row per team
// (team-colour square + abbreviation, "· 28 team targets" on Receiving), the
// away team's rows first. Names link to player pages with a small grey
// position tag; EPA cells take the site's colour thresholds with null / NaN
// in grey. The table scrolls sideways in its own container on phones.
import { Fragment, type ReactNode } from "react";
import Link from "next/link";
import { epaCellClass, type PlayerTableModel } from "@/lib/stats/box-score";

const PIXEL = "font-[family-name:var(--font-pixel)]";
const PANEL_BG = "#0f172a";

interface PlayerTableProps {
  model: PlayerTableModel;
  /** Note under the table (spec §12); omitted when absent. */
  footnote?: ReactNode;
}

export default function PlayerTable({ model, footnote }: PlayerTableProps) {
  const span = model.columns.length;
  return (
    <section data-player-table={model.key} className="overflow-hidden rounded-xl bg-white shadow">
      <h2
        className={`${PIXEL} px-4 py-3 text-[9px] uppercase tracking-wide text-white md:px-5 md:text-[11px]`}
        style={{ background: PANEL_BG }}
      >
        {model.title}
      </h2>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-[13px] tabular-nums">
          <thead>
            <tr>
              {model.columns.map((col, i) => (
                <th
                  key={col}
                  className={`whitespace-nowrap border-b border-gray-200 bg-gray-50 px-2.5 py-2 text-[11px] font-semibold uppercase tracking-wider text-gray-400 ${
                    i === 0 ? "text-left" : "text-right"
                  }`}
                >
                  {col}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {model.teams.map((team) => (
              <Fragment key={team.team_id}>
                <tr data-team-row={team.team_id}>
                  <td colSpan={span} className="bg-slate-50 px-2.5 py-1.5 text-left text-xs font-bold text-slate-700">
                    <span
                      aria-hidden="true"
                      className="mr-1.5 inline-block h-[11px] w-[11px] rounded-[3px] align-[-1px]"
                      style={{ background: team.color }}
                    />
                    {team.team_id}
                    {team.note && <span className="font-normal text-slate-500"> · {team.note}</span>}
                  </td>
                </tr>
                {team.rows.length === 0 && (
                  <tr data-empty-team={team.team_id}>
                    <td colSpan={span} className="px-2.5 py-2 text-left text-xs text-gray-400">
                      No {model.title.toLowerCase()} line for {team.team_id}
                    </td>
                  </tr>
                )}
                {team.rows.map((row) => (
                  <tr key={row.player_id} data-player-id={row.player_id} className="border-b border-gray-100 last:border-b-0">
                    <td className="whitespace-nowrap px-2.5 py-1.5 text-left text-gray-900">
                      {row.slug ? (
                        <Link
                          href={`/player/${row.slug}`}
                          className="font-medium text-navy transition-colors hover:text-nflred"
                        >
                          {row.name}
                        </Link>
                      ) : (
                        <span className="font-medium">{row.name}</span>
                      )}
                      {row.position && (
                        <span className="ml-1.5 text-[11px] font-medium text-gray-400">{row.position}</span>
                      )}
                    </td>
                    {row.cells.map((cell, i) => (
                      <td
                        key={model.columns[i + 1] ?? i}
                        className={`whitespace-nowrap px-2.5 py-1.5 text-right ${
                          "epa" in cell ? epaCellClass(cell.epa) : "text-gray-900"
                        }`}
                      >
                        {cell.text}
                      </td>
                    ))}
                  </tr>
                ))}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
      {footnote && (
        <p className="border-t border-gray-100 px-4 py-2.5 text-xs leading-relaxed text-slate-500">{footnote}</p>
      )}
    </section>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
node "C:/Users/jonra/OneDrive/Desktop/claude sandbox/football website/yards-per-pass/node_modules/vitest/vitest.mjs" run --root "C:/Users/jonra/OneDrive/Desktop/claude sandbox/football website/yards-per-pass" __tests__/components/game/PlayerTable.test.tsx
```

Expected: PASS, 6 tests.

- [ ] **Step 5: Type check, lint, commit**

```bash
node "C:/Users/jonra/OneDrive/Desktop/claude sandbox/football website/yards-per-pass/node_modules/typescript/bin/tsc" --noEmit -p "C:/Users/jonra/OneDrive/Desktop/claude sandbox/football website/yards-per-pass/tsconfig.json"
```

Expected: no output, exit 0.

```bash
npm --prefix "C:/Users/jonra/OneDrive/Desktop/claude sandbox/football website/yards-per-pass" run lint
```

Expected: only the four pre-existing warnings.

```bash
git -C "C:/Users/jonra/OneDrive/Desktop/claude sandbox/football website/yards-per-pass" add components/game/PlayerTable.tsx __tests__/components/game/PlayerTable.test.tsx
```

```bash
git -C "C:/Users/jonra/OneDrive/Desktop/claude sandbox/football website/yards-per-pass" commit -m "feat: box score player tables" -m "PlayerTable renders a buildPassingTable / buildRushingTable / buildReceivingTable model: team sub-headers with the away team first, player links with position tags, EPA colours with null in grey, sideways scroll on phones (box score spec section 6)." -m "Co-Authored-By: Claude <noreply@anthropic.com>"
```

---
### Task 7: The page — `/game/[game_id]`, its error boundary, metadata, and `/api/revalidate`

**Files:**
- Create: `app/game/[game_id]/page.tsx`
- Create: `app/game/[game_id]/error.tsx`
- Modify: `app/api/revalidate/route.ts` (line 21, `revalidatePath("/card", "layout");`)
- Test: `__tests__/app/game-route.test.tsx` (create)

**Interfaces:**
- Consumes: `getBoxScore`, `normalizeGameId`, `BoxScoreData` (Task 3); `hasNoDatabase` (Task 1); `buildScoreboard`, `buildComparison`, `buildPassingTable`, `buildRushingTable`, `buildReceivingTable`, `playCountNote`, `receivingNote`, `LEGEND_TEXT`, `STRIP_SACK_NOTE` (Task 2); `Scoreboard`, `GameMessage` (Task 4); `ComparisonSection` (Task 5); `PlayerTable` (Task 6); `getTeam` (`@/lib/data/teams`); `ErrorState` (`@/components/ui/ErrorState`).
- Produces: the route `/game/[game_id]` — `export const revalidate = 3600`, no `generateStaticParams` (spec §6), `generateMetadata` and the default page. `/api/revalidate` also revalidates `/game` (layout), which the data-refresh workflow already calls after every ingest, so "stats arrive" pages refresh within one refresh cycle.

- [ ] **Step 1: Write the failing page tests**

Create `__tests__/app/game-route.test.tsx`:

```tsx
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
}));

vi.mock("@/lib/data/box-score", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/data/box-score")>()),
  getBoxScore: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createServerClient: vi.fn(),
  hasNoDatabase: vi.fn(() => false),
}));

// base-ui tooltips need a provider; the page test only cares which metrics get one.
vi.mock("@/components/ui/MetricTooltip", () => ({
  default: ({ metric }: { metric: string }) => <span data-tooltip={metric} />,
}));

import GamePage, { generateMetadata } from "@/app/game/[game_id]/page";
import { getBoxScore, type BoxScoreData } from "@/lib/data/box-score";
import { hasNoDatabase } from "@/lib/supabase/server";
import { BUF_HOU_GAME, BUF_STATS, HOU_STATS, BUF_HOU_LINES } from "../fixtures/box-score-buf-hou";

const RECORDS = { away: { wins: 1, losses: 0, ties: 0 }, home: { wins: 0, losses: 1, ties: 0 } };
const READY: BoxScoreData = { state: "ready", game: BUF_HOU_GAME, records: RECORDS, away: BUF_STATS, home: HOU_STATS, lines: BUF_HOU_LINES };
const M = "\u2212";

const page = (game_id: string) => GamePage({ params: Promise.resolve({ game_id }) });
const meta = (game_id: string) => generateMetadata({ params: Promise.resolve({ game_id }) });

beforeEach(() => {
  vi.mocked(getBoxScore).mockReset();
  vi.mocked(hasNoDatabase).mockReset();
  vi.mocked(hasNoDatabase).mockReturnValue(false);
});

describe("GamePage — states (spec §6)", () => {
  it("junk address → notFound without a query", async () => {
    await expect(page("not-a-game")).rejects.toThrow("NEXT_NOT_FOUND");
    expect(getBoxScore).not.toHaveBeenCalled();
  });

  it("lower-case address is looked up upper-cased", async () => {
    vi.mocked(getBoxScore).mockResolvedValue({ state: "not-found" });
    await expect(page("2026_01_buf_hou")).rejects.toThrow("NEXT_NOT_FOUND");
    expect(getBoxScore).toHaveBeenCalledWith("2026_01_BUF_HOU");
  });

  it("unknown game and unplayed game → notFound", async () => {
    vi.mocked(getBoxScore).mockResolvedValue({ state: "not-found" });
    await expect(page("2026_01_BUF_HOU")).rejects.toThrow("NEXT_NOT_FOUND");
    vi.mocked(getBoxScore).mockResolvedValue({ state: "unplayed", game: { ...BUF_HOU_GAME, home_score: null, away_score: null } });
    await expect(page("2026_09_BUF_HOU")).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("2020–2025 game → scoreboard + 'Box scores start with the 2026 season' + both team links", async () => {
    vi.mocked(getBoxScore).mockResolvedValue({
      state: "uncovered", reason: "season", firstSeason: 2026, records: { away: { wins: 8, losses: 5, ties: 0 }, home: { wins: 9, losses: 4, ties: 0 } },
      game: { ...BUF_HOU_GAME, game_id: "2025_14_PHI_LAC", season: 2025, week: 14, gameday: "2025-12-08", weekday: "Monday", away_team: "PHI", home_team: "LAC", away_score: 19, home_score: 22 },
    });
    const { container } = render(await page("2025_14_PHI_LAC"));
    expect(container.querySelector("[data-scoreboard]")).not.toBeNull();
    expect(container.querySelector("[data-scoreboard-label]")?.textContent).toMatch(/^WEEK 14 · MON DEC 8/);
    expect(screen.getByText("Box scores start with the 2026 season")).toBeTruthy();
    expect(container.textContent).toContain("Team stats and player lines for earlier games aren\u2019t available yet.");
    expect(container.querySelector('[data-game-message="uncovered"]')).not.toBeNull();
    expect(container.querySelector('[data-game-message] a[href="/team/PHI"]')?.textContent).toContain("Philadelphia Eagles");
    expect(container.querySelector('[data-game-message] a[href="/team/LAC"]')?.textContent).toContain("Los Angeles Chargers");
    expect(container.querySelector("[data-section]")).toBeNull();
    expect(container.querySelector("[data-player-table]")).toBeNull();
  });

  it("playoff game → scoreboard + regular-season-only message", async () => {
    vi.mocked(getBoxScore).mockResolvedValue({
      state: "uncovered", reason: "playoffs", firstSeason: null, records: RECORDS,
      game: { ...BUF_HOU_GAME, game_id: "2026_19_BUF_HOU", game_type: "WC", week: 19 },
    });
    const { container } = render(await page("2026_19_BUF_HOU"));
    expect(container.querySelector("[data-scoreboard-label]")?.textContent).toMatch(/^WILD CARD/);
    expect(screen.getByText("Box scores cover regular-season games for now")).toBeTruthy();
    expect(container.textContent).toContain("Playoff games don\u2019t have team stats or player lines here yet.");
  });

  it("played 2026 game without stats yet → 'Stats arrive once play-by-play is published'", async () => {
    vi.mocked(getBoxScore).mockResolvedValue({ state: "pending", game: BUF_HOU_GAME, records: RECORDS });
    const { container } = render(await page("2026_01_BUF_HOU"));
    expect(screen.getByText("Stats arrive once play-by-play is published")).toBeTruthy();
    expect(container.textContent).toContain("That\u2019s usually within a few hours of the final whistle.");
    expect(container.querySelector('[data-game-message="pending"]')).not.toBeNull();
  });

  it("a failed protected read throws (never a blank page) unless there is no database", async () => {
    vi.mocked(getBoxScore).mockRejectedValue(new Error("Failed to fetch team game stats for 2026_01_BUF_HOU: fetch failed"));
    await expect(page("2026_01_BUF_HOU")).rejects.toThrow("Failed to fetch team game stats");
    vi.mocked(getBoxScore).mockRejectedValue({ message: "TypeError: fetch failed", details: "", hint: "", code: "" });
    await expect(page("2026_01_BUF_HOU")).rejects.toThrow("Box score data unavailable: TypeError: fetch failed");
    vi.mocked(hasNoDatabase).mockReturnValue(true);
    await expect(page("2026_01_BUF_HOU")).rejects.toThrow("NEXT_NOT_FOUND");
  });
});

describe("GamePage — 2026_01_BUF_HOU renders the golden values", () => {
  beforeEach(() => {
    vi.mocked(getBoxScore).mockResolvedValue(READY);
  });

  it("scoreboard: band, teams, records, score with the winner in gold, team links", async () => {
    const { container } = render(await page("2026_01_BUF_HOU"));
    const sb = container.querySelector("[data-scoreboard]")!;
    expect(sb.querySelector("[data-scoreboard-label]")?.textContent).toMatch(/^WEEK 1 · SUN SEP 13/);
    expect(sb.textContent).toContain("FINAL");
    const away = sb.querySelector('[data-scoreboard-team="away"]')!;
    const home = sb.querySelector('[data-scoreboard-team="home"]')!;
    expect(away.getAttribute("href")).toBe("/team/BUF");
    expect(away.textContent).toContain("BUF");
    expect(away.textContent).toContain("Bills");
    expect(away.textContent).toContain("1-0");
    expect(home.getAttribute("href")).toBe("/team/HOU");
    expect(home.textContent).toContain("HOU");
    expect(home.textContent).toContain("Texans");
    expect(home.textContent).toContain("0-1");
    expect(sb.querySelector('[data-score="away"]')?.textContent).toBe("36");
    expect(sb.querySelector('[data-score="home"]')?.textContent).toBe("31");
    expect((sb.querySelector('[data-score="away"]') as HTMLElement).style.color).toBe("rgb(251, 191, 36)");
    expect((sb.querySelector('[data-score="home"]') as HTMLElement).style.color).toBe("");
    expect(sb.querySelectorAll("img")).toHaveLength(2);
  });

  it("legend, four sections in order, shaded better sides, tooltips and notes", async () => {
    const { container } = render(await page("2026_01_BUF_HOU"));
    expect(container.textContent).toContain("Shaded = the better side of each row.");
    expect(Array.from(container.querySelectorAll("[data-section]")).map((s) => s.getAttribute("data-section"))).toEqual([
      "efficiency", "team-stats", "cost", "downs",
    ]);
    const row = (key: string) => container.querySelector(`[data-row="${key}"]`)!;
    const cells = (key: string) => Array.from(row(key).querySelectorAll("td")).map((td) => td.textContent);
    expect(cells("epa")).toEqual(["+0.28(56)", "EPA / play(plays)", "+0.07(79)"]);
    expect(row("epa").getAttribute("data-better")).toBe("away");
    expect((row("epa").querySelectorAll("td")[0] as HTMLElement).style.backgroundColor).toBe("rgb(236, 253, 245)");
    expect((row("epa").querySelectorAll("td")[2] as HTMLElement).style.backgroundColor).toBe("");
    expect(cells("epa-rush")).toEqual([`${M}0.26(19)`, "↳ Rushing", "+0.03(31)"]);
    expect(row("epa-rush").getAttribute("data-better")).toBe("home");
    expect(cells("explosive")).toEqual(["8(14%)", "Explosive plays(rate)", "8(10%)"]);
    expect(row("explosive").getAttribute("data-better")).toBeNull();
    expect(cells("toxic")).toEqual(["+2(TO +2, expl 0)", "Toxic differential(turnovers + explosives)", `${M}2(TO ${M}2, expl 0)`]);
    expect(cells("sacks")).toEqual(["2-11", "↳ Sacks-yards lost", "3-17"]);
    expect(cells("possession")).toEqual(["23:43", "Possession", "36:17"]);
    expect(cells("cost-turnovers")).toEqual(["0.0", "EPA lost to turnovers", `${M}7.0`]);
    expect(cells("early-epa")).toEqual(["+0.30(45)", "Early downs(1st–2nd) EPA / play", "+0.10(59)"]);
    expect(Array.from(container.querySelectorAll("[data-tooltip]")).map((e) => e.getAttribute("data-tooltip"))).toEqual([
      "EPA / play", "Success rate", "Explosive plays", "Toxic differential",
    ]);
    const teamStats = container.querySelector('[data-section="team-stats"]')!;
    expect(teamStats.textContent).toContain("Why the play counts differ.");
    expect(teamStats.textContent).toContain("BUF has 56 plays there and 52 in the official total above");
    expect(container.querySelector('[data-section="cost"]')?.textContent).toContain("A strip-sack counts in both the sack row and the turnover row.");
  });

  it("player tables: order, team sub-headers, links, position tags, EPA colours, notes, no YPRR", async () => {
    const { container } = render(await page("2026_01_BUF_HOU"));
    expect(Array.from(container.querySelectorAll("[data-player-table]")).map((t) => t.getAttribute("data-player-table"))).toEqual([
      "passing", "rushing", "receiving",
    ]);
    const passing = container.querySelector('[data-player-table="passing"]')!;
    expect(Array.from(passing.querySelectorAll("th")).map((th) => th.textContent)).toEqual([
      "Player", "C/ATT", "YDS", "TD", "INT", "SCK", "RTG", "EPA/DB", "CPOE", "SUCC%", "aDOT",
    ]);
    expect(Array.from(passing.querySelectorAll("[data-team-row]")).map((r) => r.getAttribute("data-team-row"))).toEqual(["BUF", "HOU"]);
    const allen = passing.querySelector('[data-player-id="00-0034857"]')!;
    expect(allen.querySelector("a")?.getAttribute("href")).toBe("/player/josh-allen");
    expect(Array.from(allen.querySelectorAll("td")).map((td) => td.textContent)).toEqual([
      "Josh Allen", "20/29", "334", "2", "0", "2", "130.5", "+0.56", "+8.1", "47%", "13.2",
    ]);
    expect(allen.querySelectorAll("td")[7].className).toContain("text-green-700");

    const rushing = container.querySelector('[data-player-table="rushing"]')!;
    const cook = rushing.querySelector('[data-player-id="00-0038545"]')!;
    expect(cook.querySelectorAll("td")[0].textContent).toBe("James CookRB");
    expect(cook.querySelectorAll("td")[5].className).toContain("text-amber-600");
    const allenRush = rushing.querySelector('[data-player-id="00-0034857"]')!;
    expect(Array.from(allenRush.querySelectorAll("td")).map((td) => td.textContent)).toEqual([
      "Josh AllenQB", "5", "24", "2", "4.8", `${M}0.46`, "40%",
    ]);
    expect(allenRush.querySelectorAll("td")[5].className).toContain("text-red-600");

    const receiving = container.querySelector('[data-player-table="receiving"]')!;
    expect(receiving.textContent).toContain("28 team targets");
    expect(receiving.textContent).toContain("37 team targets");
    expect(receiving.textContent).not.toContain("YPRR");
    expect(receiving.querySelector('[data-player-id="00-0038557"] a')?.textContent).toBe("Dalton Kincaid");
    expect(receiving.textContent).toContain("Player lines won\u2019t always add up to team totals.");
    expect(receiving.textContent).toContain("10 of Josh Allen\u2019s 334 passing yards");
    expect(receiving.querySelector(".overflow-x-auto")).not.toBeNull();
  });

  it("null EPA renders a grey dash, never amber", async () => {
    vi.mocked(getBoxScore).mockResolvedValue({
      ...READY,
      lines: { ...BUF_HOU_LINES, qbs: [{ ...BUF_HOU_LINES.qbs[0], epa_per_dropback: null as unknown as number, rush_epa_per_carry: null }, BUF_HOU_LINES.qbs[1]] },
    });
    const { container } = render(await page("2026_01_BUF_HOU"));
    const cell = container.querySelector('[data-player-table="passing"] [data-player-id="00-0034857"]')!.querySelectorAll("td")[7];
    expect(cell.textContent).toBe("\u2014");
    expect(cell.className).toContain("text-gray-400");
    expect(cell.className).not.toContain("amber");
  });
});

describe("GamePage generateMetadata", () => {
  it("ready → winner-first title, canonical, indexable", async () => {
    vi.mocked(getBoxScore).mockResolvedValue(READY);
    const m = await meta("2026_01_BUF_HOU");
    expect(m.title).toBe("Bills 36, Texans 31 — 2026 Week 1 box score");
    expect(m.alternates?.canonical).toBe("https://yardsperpass.com/game/2026_01_BUF_HOU");
    expect("robots" in m).toBe(false);
    expect(String(m.description)).toContain("Buffalo Bills at Houston Texans");
  });

  it("uncovered → noindex; pending → indexable; unknown → not-found title", async () => {
    vi.mocked(getBoxScore).mockResolvedValue({ state: "uncovered", reason: "season", firstSeason: 2026, game: { ...BUF_HOU_GAME, season: 2025 }, records: RECORDS });
    expect((await meta("2025_01_BUF_HOU")).robots).toEqual({ index: false, follow: true });
    vi.mocked(getBoxScore).mockResolvedValue({ state: "pending", game: BUF_HOU_GAME, records: RECORDS });
    expect("robots" in (await meta("2026_01_BUF_HOU"))).toBe(false);
    vi.mocked(getBoxScore).mockResolvedValue({ state: "not-found" });
    expect(String((await meta("2026_01_BUF_HOU")).title)).toContain("Game Not Found");
    expect(String((await meta("junk")).title)).toContain("Game Not Found");
  });

  it("home winner is named first", async () => {
    vi.mocked(getBoxScore).mockResolvedValue({ ...READY, game: { ...BUF_HOU_GAME, away_score: 20, home_score: 27 } });
    expect((await meta("2026_01_BUF_HOU")).title).toBe("Texans 27, Bills 20 — 2026 Week 1 box score");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
node "C:/Users/jonra/OneDrive/Desktop/claude sandbox/football website/yards-per-pass/node_modules/vitest/vitest.mjs" run --root "C:/Users/jonra/OneDrive/Desktop/claude sandbox/football website/yards-per-pass" __tests__/app/game-route.test.tsx
```

Expected: FAIL — `Failed to resolve import "@/app/game/[game_id]/page"`.

- [ ] **Step 3: Create `app/game/[game_id]/page.tsx`**

Page order (spec §6): scoreboard → legend → Efficiency → Team stats (with the "Why the play counts differ" note) → What it cost them (with the strip-sack note) → Early vs late downs → Passing → Rushing → Receiving (with the "Player lines won't always add up" note). Width and spacing follow the mockup (`max-width 860px`, 20px gaps; 16px side padding on phones). Message copy is the mockup's; the 2020–2025 heading names the first covered season from data, never a hardcoded 2026.

```tsx
// app/game/[game_id]/page.tsx — one game's box score (box score spec §6).
// Address: nflverse's id, /game/2026_01_BUF_HOU (season, week, away, home).
// Generated on demand and revalidated hourly (no generateStaticParams: the id
// list would need a database read at build time, and a Supabase blip would
// then fail every build). /api/revalidate refreshes /game after each ingest.
import { cache } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getBoxScore, normalizeGameId, type BoxScoreData } from "@/lib/data/box-score";
import { hasNoDatabase } from "@/lib/supabase/server";
import { getTeam } from "@/lib/data/teams";
import {
  LEGEND_TEXT,
  STRIP_SACK_NOTE,
  buildComparison,
  buildPassingTable,
  buildReceivingTable,
  buildRushingTable,
  buildScoreboard,
  playCountNote,
  receivingNote,
} from "@/lib/stats/box-score";
import Scoreboard from "@/components/game/Scoreboard";
import ComparisonSection from "@/components/game/ComparisonSection";
import PlayerTable from "@/components/game/PlayerTable";
import GameMessage from "@/components/game/GameMessage";

export const revalidate = 3600;

/**
 * Load the page's data. A real database error must never become a cached
 * empty page: rethrowing keeps ISR serving the last good copy (a cold miss
 * gets error.tsx) — the homepage's rule. Only the placeholder build has no
 * database (hasNoDatabase), and then the game simply isn't there. Do not add
 * an in-render retry: Next 14 replays identical fetches from a per-render
 * memo, failures included. React's cache() is what makes generateMetadata and
 * the page share one read instead of relying on that memo.
 */
const loadBoxScore = cache(async (rawId: string): Promise<BoxScoreData> => {
  const gameId = normalizeGameId(rawId);
  if (!gameId) return { state: "not-found" };
  try {
    return await getBoxScore(gameId);
  } catch (err) {
    if (!hasNoDatabase()) {
      if (err instanceof Error) throw err;
      const m = (err as { message?: unknown } | null)?.message;
      throw new Error(`Box score data unavailable: ${typeof m === "string" ? m : JSON.stringify(err)}`);
    }
    return { state: "not-found" };
  }
});

function teamName(id: string): string {
  return getTeam(id)?.name ?? id;
}

function nickname(id: string): string {
  return teamName(id).split(" ").pop() ?? id;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ game_id: string }>;
}): Promise<Metadata> {
  const { game_id } = await params;
  const data = await loadBoxScore(game_id);
  if (data.state === "not-found" || data.state === "unplayed") {
    // The root layout's template appends " — Yards Per Pass" again, so this tab
    // double-suffixes. Every other route does the same (player, team, card);
    // keep it consistent here and fix all four together or not at all.
    return { title: "Game Not Found — Yards Per Pass" };
  }
  const base = process.env.NEXT_PUBLIC_SITE_URL || "https://yardsperpass.com";
  const g = data.game;
  // Winner first, as a headline reads; the away team first in a tie.
  const homeFirst = g.home_score > g.away_score;
  const first = homeFirst ? `${nickname(g.home_team)} ${g.home_score}` : `${nickname(g.away_team)} ${g.away_score}`;
  const second = homeFirst ? `${nickname(g.away_team)} ${g.away_score}` : `${nickname(g.home_team)} ${g.home_score}`;
  const when = g.game_type === "REG" ? `Week ${g.week}` : g.game_type.toUpperCase();
  return {
    // The root layout's title template appends " — Yards Per Pass".
    title: `${first}, ${second} — ${g.season} ${when} box score`,
    description: `${teamName(g.away_team)} at ${teamName(g.home_team)}, ${g.season} ${when}: EPA per play, success rate, explosive plays and the official box score, with every passer, rusher and receiver.`,
    alternates: { canonical: `${base}/game/${g.game_id}` },
    // A game that will never get a box score here (2020–2025 until the
    // backfill, playoffs) is a 200 message page: keep it out of search results.
    ...(data.state === "uncovered" ? { robots: { index: false, follow: true } } : {}),
  };
}

export default async function GamePage({ params }: { params: Promise<{ game_id: string }> }) {
  const { game_id } = await params;
  const data = await loadBoxScore(game_id);
  // Unknown ids and games without a final score have no page (spec §6).
  if (data.state === "not-found" || data.state === "unplayed") notFound();

  // No `today` argument: the date label's year suffix is decided against
  // render-time "now", so a page cached across New Year can omit the year for
  // an hour. Harmless at revalidate = 3600 — deliberate, do not "fix" it.
  const scoreboard = buildScoreboard(data.game, data.records.away, data.records.home);
  const awayId = data.game.away_team;
  const homeId = data.game.home_team;
  const teamLinks = [
    { href: `/team/${awayId}`, label: teamName(awayId) },
    { href: `/team/${homeId}`, label: teamName(homeId) },
  ];

  let body: React.ReactNode;
  if (data.state === "uncovered" && data.reason === "season") {
    body = (
      <GameMessage
        kind="uncovered"
        heading={`Box scores start with the ${data.firstSeason} season`}
        body={"Team stats and player lines for earlier games aren’t available yet."}
        links={teamLinks}
      />
    );
  } else if (data.state === "uncovered") {
    body = (
      <GameMessage
        kind="uncovered"
        heading="Box scores cover regular-season games for now"
        body={"Playoff games don’t have team stats or player lines here yet."}
        links={teamLinks}
      />
    );
  } else if (data.state === "pending") {
    body = (
      <GameMessage
        kind="pending"
        heading="Stats arrive once play-by-play is published"
        body={"That’s usually within a few hours of the final whistle."}
      />
    );
  } else {
    const sections = buildComparison(data.away, data.home);
    const notes: Record<string, React.ReactNode> = {
      "team-stats": (
        <>
          <b className="font-semibold text-slate-700">Why the play counts differ.</b> {playCountNote(data.away, data.home)}
        </>
      ),
      cost: STRIP_SACK_NOTE,
    };
    const teamTargets = { [awayId]: data.away.team_targets, [homeId]: data.home.team_targets };
    body = (
      <>
        <p className="-mt-1 px-0.5 text-xs text-gray-500">
          <span className="rounded-sm px-1.5 py-px font-bold" style={{ background: "#ecfdf5", color: "#065f46" }}>
            Shaded
          </span>{" "}
          {LEGEND_TEXT}
        </p>
        {sections.map((section) => (
          <ComparisonSection
            key={section.key}
            section={section}
            awayId={awayId}
            homeId={homeId}
            footnote={notes[section.key]}
          />
        ))}
        <PlayerTable model={buildPassingTable(data.lines, awayId, homeId)} />
        <PlayerTable model={buildRushingTable(data.lines, awayId, homeId)} />
        <PlayerTable
          model={buildReceivingTable(data.lines, awayId, homeId, teamTargets)}
          footnote={
            <>
              <b className="font-semibold text-slate-700">{"Player lines won’t always add up to team totals."}</b>{" "}
              {receivingNote(data.lines, awayId, homeId)}
            </>
          }
        />
      </>
    );
  }

  return (
    <div className="mx-auto max-w-[860px] space-y-5 px-4 py-6 md:px-12 md:py-8">
      <Scoreboard model={scoreboard} />
      {body}
    </div>
  );
}
```

- [ ] **Step 4: Create `app/game/[game_id]/error.tsx`**

```tsx
// app/game/[game_id]/error.tsx
"use client";

import { useEffect } from "react";
import ErrorState from "@/components/ui/ErrorState";

export default function GamePageError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Box score page error:", error);
  }, [error]);

  return <ErrorState title="Unable to load this box score" reset={reset} />;
}
```

- [ ] **Step 5: Revalidate `/game` with the rest**

In `app/api/revalidate/route.ts`, after the line

```ts
  revalidatePath("/card", "layout");
```

add

```ts
  revalidatePath("/game", "layout");
```

- [ ] **Step 6: Run the page tests to verify they pass**

```bash
node "C:/Users/jonra/OneDrive/Desktop/claude sandbox/football website/yards-per-pass/node_modules/vitest/vitest.mjs" run --root "C:/Users/jonra/OneDrive/Desktop/claude sandbox/football website/yards-per-pass" __tests__/app/game-route.test.tsx
```

Expected: PASS, 14 tests.

- [ ] **Step 7: Type check, lint, commit**

```bash
node "C:/Users/jonra/OneDrive/Desktop/claude sandbox/football website/yards-per-pass/node_modules/typescript/bin/tsc" --noEmit -p "C:/Users/jonra/OneDrive/Desktop/claude sandbox/football website/yards-per-pass/tsconfig.json"
```

Expected: no output, exit 0.

```bash
npm --prefix "C:/Users/jonra/OneDrive/Desktop/claude sandbox/football website/yards-per-pass" run lint
```

Expected: only the four pre-existing warnings.

```bash
git -C "C:/Users/jonra/OneDrive/Desktop/claude sandbox/football website/yards-per-pass" add "app/game/[game_id]/page.tsx" "app/game/[game_id]/error.tsx" app/api/revalidate/route.ts __tests__/app/game-route.test.tsx
```

```bash
git -C "C:/Users/jonra/OneDrive/Desktop/claude sandbox/football website/yards-per-pass" commit -m "feat: /game/[game_id] box score page" -m "Scoreboard, legend, the four comparison sections with their notes, and the passing / rushing / receiving tables (box score spec section 6). Unknown and unplayed games 404; a 2020-2025 or playoff game shows the scoreboard and a noindex message; a played game whose stats have not landed shows the scoreboard and 'Stats arrive once play-by-play is published'. A failed read throws instead of caching an empty page. /api/revalidate now covers /game." -m "Co-Authored-By: Claude <noreply@anthropic.com>"
```

---
### Task 8: Schedule tiles link to the box score

**Files:**
- Modify: `components/team/ScheduleSection.tsx` (props interface lines 13–26; `skinFor` at line 161; `GameTile` signature line 177 and its played branch lines 208–217; the component signature lines 247–254; the two `<GameTile …/>` call sites at lines 278–280 and 318–320)
- Modify: `components/team/TeamHubContent.tsx` (props lines 17–22; the two `<ScheduleSection …/>` blocks at lines 47–54 and 57–63)
- Modify: `app/team/[team_id]/page.tsx` (imports lines 6–7; the `getTeamHubData` call at lines 54–55; the `<TeamHubContent …/>` at lines 75–78)
- Test: `__tests__/components/ScheduleSection.test.tsx` (the `renderSchedule` helper at lines 64–75 and the `rerender` at lines 235–243; append tests), `__tests__/app/team-route.test.tsx` (create)

**Interfaces:**
- Consumes: `getBoxScoreSeasons` (Task 3) in the server page only. `ScheduleSection` and `TeamHubContent` are `"use client"` — they receive a plain `number[]` and import nothing from `lib/data/box-score.ts`.
- Produces: `ScheduleSection` and `TeamHubContent` each gain a **required** prop `boxScoreSeasons: number[]` (required on purpose: `tsc` then refuses any render that forgets it — the repo's slug bug was a function never wired into its caller). A played regular-season tile whose `game.season` is in the list renders its score line as `<Link href="/game/<game_id>" data-box-score-link title="Box score: BUF 36, HOU 31">`; every other tile is unchanged.

- [ ] **Step 1: Write the failing tests**

In `__tests__/components/ScheduleSection.test.tsx`, add the new required prop to both existing renders. The `renderSchedule` helper becomes:

```tsx
function renderSchedule(over: Partial<React.ComponentProps<typeof ScheduleSection>> = {}) {
  return render(
    <ScheduleSection
      schedule={schedule}
      teamName="Buffalo Bills"
      primaryColor="#00338D"
      secondaryColor="#C60C30"
      teamStats={teamStats}
      boxScoreSeasons={[]}
      {...over}
    />,
  );
}
```

and the `rerender(...)` inside "shows the record in the band, and omits it when teamStats is null" becomes:

```tsx
    rerender(
      <ScheduleSection
        schedule={schedule}
        teamName="Buffalo Bills"
        primaryColor="#00338D"
        secondaryColor="#C60C30"
        teamStats={null}
        boxScoreSeasons={[]}
      />,
    );
```

Then append at the end of the file:

```tsx

describe("ScheduleSection — box score links (box score spec §7)", () => {
  it("links the score line of a played regular-season tile when its season has box scores", () => {
    const { container } = renderSchedule({ boxScoreSeasons: [2026] });
    const links = Array.from(container.querySelectorAll("a[data-box-score-link]"));
    expect(links.map((a) => a.getAttribute("href"))).toEqual(["/game/2026_01_BUF_HOU", "/game/2026_02_BUF_DET"]);
    expect(links[0].textContent).toBe("W27-20");
    expect(links[0].getAttribute("title")).toBe("Box score: BUF 27, HOU 20");
    // The opponent link is untouched and sits beside, never inside, the score link.
    expect(container.querySelector('a[href="/team/HOU"]')!.textContent).toBe("@HOU");
    expect(container.querySelectorAll("a")).toHaveLength(8);
    expect(container.querySelector("[data-game-id]")!.querySelector("a a")).toBeNull();
  });

  it("links nothing when the season has no box scores, or the list is empty", () => {
    for (const seasons of [[], [2025]]) {
      const { container } = renderSchedule({ boxScoreSeasons: seasons });
      expect(container.querySelectorAll("a[data-box-score-link]")).toHaveLength(0);
      expect(container.querySelectorAll("a")).toHaveLength(6);
      expect(container.textContent).toContain("27-20");
    }
  });

  it("never links unplayed, bye or playoff tiles", () => {
    const { container } = renderSchedule({
      boxScoreSeasons: [2026],
      schedule: [...schedule, final(20, 21, 17, { game_type: "DIV", opponent_id: "KC", gameday: "2027-01-17" })],
    });
    const hrefs = Array.from(container.querySelectorAll("a[data-box-score-link]")).map((a) => a.getAttribute("href"));
    expect(hrefs).toEqual(["/game/2026_01_BUF_HOU", "/game/2026_02_BUF_DET"]);
    expect(container.textContent).toContain("21-17");
  });

  it("survives a season list that arrives as strings or is missing at runtime", () => {
    const { container } = renderSchedule({ boxScoreSeasons: ["2026"] as unknown as number[] });
    expect(container.querySelectorAll("a[data-box-score-link]")).toHaveLength(0);
    const { container: none } = renderSchedule({ boxScoreSeasons: undefined as unknown as number[] });
    expect(none.querySelectorAll("[data-game-id]")).toHaveLength(6);
  });
});
```

Create `__tests__/app/team-route.test.tsx`:

```tsx
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
}));

vi.mock("@/lib/data/queries", () => ({
  getAvailableSeasons: vi.fn(async () => [2026, 2025]),
  fallbackSeason: () => 2026,
}));

vi.mock("@/lib/data/team-hub", () => ({
  getTeamHubData: vi.fn(async () => ({ currentSeason: 2026, seasons: [2026, 2025] })),
}));

vi.mock("@/lib/data/box-score", () => ({
  getBoxScoreSeasons: vi.fn(async () => []),
}));

vi.mock("@/components/team/TeamHubContent", () => ({
  default: vi.fn(() => null),
}));

import TeamPage from "@/app/team/[team_id]/page";
import TeamHubContent from "@/components/team/TeamHubContent";
import { getBoxScoreSeasons } from "@/lib/data/box-score";

async function contentProps(teamId = "buf") {
  render(
    await TeamPage({
      params: Promise.resolve({ team_id: teamId }),
      searchParams: Promise.resolve({}),
    })
  );
  const calls = vi.mocked(TeamHubContent).mock.calls;
  return calls[calls.length - 1][0];
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getBoxScoreSeasons).mockReset();
  vi.mocked(getBoxScoreSeasons).mockResolvedValue([2026]);
});

describe("TeamPage — box score link gate (spec §7)", () => {
  it("probes the available seasons and passes the covered ones down", async () => {
    const props = await contentProps();
    expect(getBoxScoreSeasons).toHaveBeenCalledWith([2026, 2025]);
    expect(props.boxScoreSeasons).toEqual([2026]);
    expect(props.team.id).toBe("BUF");
  });

  it("renders unlinked (and logs) when the probe fails", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(getBoxScoreSeasons).mockRejectedValue(new Error("Failed to fetch box score seasons: fetch failed"));
    const props = await contentProps();
    expect(props.boxScoreSeasons).toEqual([]);
    expect(logged).toHaveBeenCalledTimes(1);
    expect(String(logged.mock.calls[0][0])).toContain("BUF");
    logged.mockRestore();
  });

  it("unknown team still 404s", async () => {
    await expect(contentProps("xyz")).rejects.toThrow("NEXT_NOT_FOUND");
    expect(getBoxScoreSeasons).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

```bash
node "C:/Users/jonra/OneDrive/Desktop/claude sandbox/football website/yards-per-pass/node_modules/vitest/vitest.mjs" run --root "C:/Users/jonra/OneDrive/Desktop/claude sandbox/football website/yards-per-pass" __tests__/components/ScheduleSection.test.tsx __tests__/app/team-route.test.tsx
```

Expected: in `ScheduleSection.test.tsx` the 17 existing tests pass and 2 of the 4 new ones FAIL — "links the score line…" and "never links unplayed…" (`expected [] to deeply equal [ '/game/2026_01_BUF_HOU', … ]`); the other two pass by accident, because no links render yet. In `team-route.test.tsx` the first two FAIL (`props.boxScoreSeasons` is `undefined`; `getBoxScoreSeasons` not called), the 404 test passes.

- [ ] **Step 3: `ScheduleSection` — the prop, the gate and the link**

(a) In `interface ScheduleSectionProps`, after `upcomingSeason?: number;` add:

```ts
  /**
   * Seasons that have box scores (team_game_stats rows), from
   * getBoxScoreSeasons. A played regular-season tile in one of them links its
   * score line to /game/<game_id>; everything else stays unlinked (spec §7).
   */
  boxScoreSeasons: number[];
```

(b) Directly before `function skinFor(game: TeamGame): TileSkin {` insert:

```ts
/**
 * Box score link for a tile (spec §7): only a played regular-season game in a
 * season that has box scores. Unplayed and playoff tiles never link.
 */
function boxScoreHref(game: TeamGame, boxScoreSeasons: number[]): string | null {
  if (!game.played || game.game_type !== "REG") return null;
  if (!game.game_id || !game.game_id.trim()) return null;
  if (!Array.isArray(boxScoreSeasons) || !boxScoreSeasons.includes(Number(game.season))) return null;
  return `/game/${game.game_id}`;
}

/** "Box score: BUF 36, HOU 31" — away team first, as the scoreboard reads. */
function boxScoreTitle(game: TeamGame): string {
  if (game.away_score == null || game.home_score == null) return "Box score";
  return `Box score: ${game.away_team} ${game.away_score}, ${game.home_team} ${game.home_score}`;
}

```

(c) Change the `GameTile` signature

```tsx
function GameTile({ game, isNext }: { game: TeamGame; isNext: boolean }) {
```

to

```tsx
function GameTile({ game, isNext, href }: { game: TeamGame; isNext: boolean; href: string | null }) {
```

and replace its played branch

```tsx
      {game.played ? (
        <div
          className="mt-1.5 flex items-baseline justify-center gap-1 leading-none"
          style={{ color: skin.accent }}
        >
          <span className={`${PIXEL} text-[7px] lg:text-[9px]`}>{game.result}</span>
          <span className="text-[10px] lg:text-xs font-bold">
            {game.team_score}-{game.opponent_score}
          </span>
        </div>
      ) : (
```

with

```tsx
      {game.played ? (
        href ? (
          // The opponent above already links to their team page and links can't
          // nest, so the score line is the box score link (spec §7).
          <Link
            href={href}
            data-box-score-link
            title={boxScoreTitle(game)}
            className="mt-1.5 flex items-baseline justify-center gap-1 leading-none underline decoration-dotted decoration-[1.5px] underline-offset-[3px] hover:decoration-solid"
            style={{ color: skin.accent }}
          >
            <span className={`${PIXEL} text-[7px] lg:text-[9px]`}>{game.result}</span>
            <span className="text-[10px] lg:text-xs font-bold">
              {game.team_score}-{game.opponent_score}
            </span>
          </Link>
        ) : (
          <div
            className="mt-1.5 flex items-baseline justify-center gap-1 leading-none"
            style={{ color: skin.accent }}
          >
            <span className={`${PIXEL} text-[7px] lg:text-[9px]`}>{game.result}</span>
            <span className="text-[10px] lg:text-xs font-bold">
              {game.team_score}-{game.opponent_score}
            </span>
          </div>
        )
      ) : (
```

The tile wrapper already carries `title={gameTitle(game)}`, so the score line ends up with a `title` nested inside another one — deliberate: hovering the score says what the link does, hovering the tile says what the game was. Leave both.

(d) In the component's destructuring change

```tsx
  teamStats,
  upcomingSeason,
}: ScheduleSectionProps) {
```

to

```tsx
  teamStats,
  upcomingSeason,
  boxScoreSeasons,
}: ScheduleSectionProps) {
```

(e) Replace the regular-season call site

```tsx
        regTiles.push(
          <GameTile key={game.game_id} game={game} isNext={game.game_id === nextGameId} />
        );
```

with

```tsx
        regTiles.push(
          <GameTile
            key={game.game_id}
            game={game}
            isNext={game.game_id === nextGameId}
            href={boxScoreHref(game, boxScoreSeasons)}
          />
        );
```

and the playoff call site

```tsx
        {postGames.map((game) => (
          <GameTile key={game.game_id} game={game} isNext={game.game_id === nextGameId} />
        ))}
```

with

```tsx
        {postGames.map((game) => (
          <GameTile
            key={game.game_id}
            game={game}
            isNext={game.game_id === nextGameId}
            href={boxScoreHref(game, boxScoreSeasons)}
          />
        ))}
```

(`boxScoreHref` returns null for playoff rows, so those tiles keep their plain score line.)

- [ ] **Step 4: `TeamHubContent` passes the list to both schedules**

Change

```tsx
interface TeamHubContentProps {
  team: Team;
  data: TeamHubData;
}

export default function TeamHubContent({ team, data }: TeamHubContentProps) {
```

to

```tsx
interface TeamHubContentProps {
  team: Team;
  data: TeamHubData;
  /** Seasons with box scores — played tiles in them link to /game/<id> (spec §7). */
  boxScoreSeasons: number[];
}

export default function TeamHubContent({ team, data, boxScoreSeasons }: TeamHubContentProps) {
```

In the first `<ScheduleSection …/>` (the upcoming season), change

```tsx
          teamStats={data.teamStats}
          upcomingSeason={data.upcomingSeason}
        />
```

to

```tsx
          teamStats={data.teamStats}
          upcomingSeason={data.upcomingSeason}
          boxScoreSeasons={boxScoreSeasons}
        />
```

and in the second (the viewed season), change

```tsx
          secondaryColor={team.secondaryColor}
          teamStats={data.teamStats}
        />

        <PassingSection
```

to

```tsx
          secondaryColor={team.secondaryColor}
          teamStats={data.teamStats}
          boxScoreSeasons={boxScoreSeasons}
        />

        <PassingSection
```

- [ ] **Step 5: The team page fetches the gate**

In `app/team/[team_id]/page.tsx`, change the imports

```ts
import { getAvailableSeasons, fallbackSeason } from "@/lib/data/queries";
import TeamHubContent
```

to

```ts
import { getAvailableSeasons, fallbackSeason } from "@/lib/data/queries";
import { getBoxScoreSeasons } from "@/lib/data/box-score";
import TeamHubContent
```

replace

```ts
  // Only the latest season pre-surfaces next season's schedule.
  const data = await getTeamHubData(teamId, currentSeason, currentSeason === seasons[0]);
```

with

```ts
  // Only the latest season pre-surfaces next season's schedule. The box score
  // link gate (spec §7) is fetched here — TeamHubContent is a client
  // component — and passed down as a plain array. A failed probe logs and
  // renders no links this render (ISR: up to an hour), never a crash.
  const [data, boxScoreSeasons] = await Promise.all([
    getTeamHubData(teamId, currentSeason, currentSeason === seasons[0]),
    getBoxScoreSeasons(seasons).catch((err: unknown): number[] => {
      console.error(`Team page: box score seasons unavailable for ${teamId}; schedule tiles will not link`, err);
      return [];
    }),
  ]);
```

and

```tsx
      <TeamHubContent
        team={team}
        data={data}
      />
```

with

```tsx
      <TeamHubContent
        team={team}
        data={data}
        boxScoreSeasons={boxScoreSeasons}
      />
```

- [ ] **Step 6: Run the tests to verify they pass**

```bash
node "C:/Users/jonra/OneDrive/Desktop/claude sandbox/football website/yards-per-pass/node_modules/vitest/vitest.mjs" run --root "C:/Users/jonra/OneDrive/Desktop/claude sandbox/football website/yards-per-pass" __tests__/components/ScheduleSection.test.tsx __tests__/app/team-route.test.tsx
```

Expected: PASS — 21 tests in `ScheduleSection.test.tsx`, 3 in `team-route.test.tsx`.

- [ ] **Step 7: Type check, lint, commit**

```bash
node "C:/Users/jonra/OneDrive/Desktop/claude sandbox/football website/yards-per-pass/node_modules/typescript/bin/tsc" --noEmit -p "C:/Users/jonra/OneDrive/Desktop/claude sandbox/football website/yards-per-pass/tsconfig.json"
```

Expected: no output, exit 0 (both `ScheduleSection` call sites and the `TeamHubContent` call site now pass the prop).

```bash
npm --prefix "C:/Users/jonra/OneDrive/Desktop/claude sandbox/football website/yards-per-pass" run lint
```

Expected: only the four pre-existing warnings.

```bash
git -C "C:/Users/jonra/OneDrive/Desktop/claude sandbox/football website/yards-per-pass" add components/team/ScheduleSection.tsx components/team/TeamHubContent.tsx "app/team/[team_id]/page.tsx" __tests__/components/ScheduleSection.test.tsx __tests__/app/team-route.test.tsx
```

```bash
git -C "C:/Users/jonra/OneDrive/Desktop/claude sandbox/football website/yards-per-pass" commit -m "feat: schedule tiles link played games to their box score" -m "The score line of a played regular-season tile links to /game/<game_id> when the season has team_game_stats rows (box score spec section 7); the team page probes the seasons with getBoxScoreSeasons and threads the list to the client components as a plain array. Unplayed, playoff and uncovered-season tiles are unchanged." -m "Co-Authored-By: Claude <noreply@anthropic.com>"
```

---
### Task 9: Game Log results link to the box score

**Files:**
- Modify: `components/player/GameLogTab.tsx` (props interface lines 12–23; component signature line 258; the cell render inside `allCols.map` — the `if (col.key === "opponent")` branch ends at line 442, the `if (typeof raw === "number" && col.format)` branch starts at line 443)
- Modify: `components/player/PlayerPageContent.tsx` (props lines 27–41; destructuring lines 54–67; `<GameLogTab …/>` at lines 203–209)
- Modify: `app/player/[slug]/page.tsx` (import line 8; after `currentSeason` at line 89; before `getBreadcrumbs` at line 175; `<PlayerPageContent …/>` props at lines 196–209)
- Test: `__tests__/components/GameLogTab.test.tsx` (every `<GameLogTab … />` render; append tests), `__tests__/components/PlayerHeader.test.tsx` (the `PlayerPageContent` render at line 84), `__tests__/app/player-route.test.ts` (mocks at lines 42–44; imports at lines 50–55; append tests)

**Interfaces:**
- Consumes: `getBoxScoreSeasons` (Task 3) in the server page only; `scheduleResult(row, gameResults)` already in `GameLogTab.tsx` (Phase 0 — it returns the schedule's `GameResult`, with `game_id`, only for a played regular-season game whose opponent matches the row).
- Produces: `GameLogTab` and `PlayerPageContent` each gain a **required** prop `boxScoreSeasons: number[]`. A Result cell whose schedule result exists and whose row `season` is in the list renders `<Link href="/game/<game_id>" data-box-score-link>W 36-31</Link>`; a stored-score fallback never links.

- [ ] **Step 1: Write the failing tests**

(a) In `__tests__/components/GameLogTab.test.tsx`, add ` boxScoreSeasons={[]}` before the closing ` />` of **every** existing `<GameLogTab …/>` render (twelve of them: the three Routes tests and the nine Result tests). For example line 33 becomes:

```tsx
      <GameLogTab weeklyStats={[{ ...base, ...noRoutes }]} position="WR" season={2026} teamId="SEA" gameResults={{}} boxScoreSeasons={[]} />
```

Then append at the end of the file:

```tsx

describe("GameLogTab — Result links to the box score (box score spec §7)", () => {
  const schedule: GameResultsByTeam = {
    TEN: { 5: { game_id: "2025_05_TEN_ARI", team_score: 22, opponent_score: 21, result: "W", opponent_id: "ARI" } },
  };
  const wk5: ReceiverWeeklyStat = {
    ...base, player_id: "00-0032211", season: 2025, week: 5, team_id: "TEN", opponent_id: "ARI",
    home_away: "away", result: "L", team_score: 19, opponent_score: 21,
  };

  function resultCell(container: HTMLElement, week: number): HTMLTableCellElement {
    const headers = Array.from(container.querySelectorAll("thead th"));
    const col = headers.findIndex((th) => (th.textContent ?? "").startsWith("Result"));
    const row = Array.from(container.querySelectorAll("tbody tr")).find(
      (tr) => tr.querySelectorAll("td").length > 2 && tr.querySelector("td")?.textContent === String(week)
    )!;
    return row.querySelectorAll("td")[col];
  }

  it("links the schedule result when the row's season has box scores", () => {
    const { container } = render(
      <GameLogTab weeklyStats={[wk5]} position="WR" season={2025} teamId="TEN" gameResults={schedule} boxScoreSeasons={[2026, 2025]} />
    );
    const link = resultCell(container, 5).querySelector("a[data-box-score-link]")!;
    expect(link.getAttribute("href")).toBe("/game/2025_05_TEN_ARI");
    expect(link.textContent).toBe("W 22-21");
  });

  it("links nothing for a season without box scores (2025 until the backfill) or an empty list", () => {
    for (const seasons of [[2026], []]) {
      const { container } = render(
        <GameLogTab weeklyStats={[wk5]} position="WR" season={2025} teamId="TEN" gameResults={schedule} boxScoreSeasons={seasons} />
      );
      const cell = resultCell(container, 5);
      expect(cell.querySelector("a")).toBeNull();
      expect(cell.textContent).toBe("W 22-21");
    }
  });

  it("never links a stored-score fallback, even in a covered season", () => {
    const { container } = render(
      <GameLogTab weeklyStats={[base]} position="WR" season={2026} teamId="SEA" gameResults={{}} boxScoreSeasons={[2026]} />
    );
    const cell = resultCell(container, 1);
    expect(cell.querySelector("a")).toBeNull();
    expect(cell.textContent).toBe("W 27-20");
  });

  it("works after the props cross the server → client boundary, and with no list at runtime", () => {
    const serialized = JSON.parse(JSON.stringify({ schedule, seasons: [2025] }));
    const { container } = render(
      <GameLogTab weeklyStats={[wk5]} position="WR" season={2025} teamId="TEN" gameResults={serialized.schedule} boxScoreSeasons={serialized.seasons} />
    );
    expect(resultCell(container, 5).querySelector("a")?.getAttribute("href")).toBe("/game/2025_05_TEN_ARI");
    const { container: none } = render(
      <GameLogTab weeklyStats={[wk5]} position="WR" season={2025} teamId="TEN" gameResults={schedule} boxScoreSeasons={undefined as unknown as number[]} />
    );
    expect(resultCell(none, 5).textContent).toBe("W 22-21");
  });
});
```

(b) In `__tests__/components/PlayerHeader.test.tsx`, the `renderContent` helper's `<PlayerPageContent …>` render gains the prop — change

```tsx
        tab="game-log"
        gameResults={{}}
      />,
```

to

```tsx
        tab="game-log"
        gameResults={{}}
        boxScoreSeasons={[]}
      />,
```

(c) In `__tests__/app/player-route.test.ts`, after the `@/lib/data/games` mock

```ts
vi.mock("@/lib/data/games", () => ({
  getGameResults: vi.fn(async () => ({})),
}));
```

add

```ts

vi.mock("@/lib/data/box-score", () => ({
  getBoxScoreSeasons: vi.fn(async () => []),
}));
```

change the imports

```ts
import { getGameResults } from "@/lib/data/games";
import type { ReceiverWeeklyStat } from "@/lib/types";
```

to

```ts
import { getGameResults } from "@/lib/data/games";
import { getBoxScoreSeasons } from "@/lib/data/box-score";
import type { ReceiverWeeklyStat } from "@/lib/types";
```

and append at the end of the file:

```ts

describe("PlayerPage — box score link gate (box score spec §7)", () => {
  const allen = {
    player_id: "00-0034857",
    slug: "josh-allen",
    player_name: "Josh Allen",
    position: "QB",
    current_team_id: "BUF",
    headshot_url: null,
    jersey_number: 17,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getPlayerBySlug).mockResolvedValue(allen);
    vi.mocked(getBoxScoreSeasons).mockReset();
    vi.mocked(getBoxScoreSeasons).mockResolvedValue([2026]);
  });

  async function contentProps() {
    render(
      await PlayerPage({
        params: Promise.resolve({ slug: "josh-allen" }),
        searchParams: Promise.resolve({ tab: "game-log" }),
      }),
    );
    const calls = vi.mocked(PlayerPageContent).mock.calls;
    return calls[calls.length - 1][0];
  }

  it("probes the available seasons and passes the covered ones down", async () => {
    const props = await contentProps();
    expect(getBoxScoreSeasons).toHaveBeenCalledWith([2026, 2025]);
    expect(props.boxScoreSeasons).toEqual([2026]);
  });

  it("renders unlinked (and logs) when the probe fails", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(getBoxScoreSeasons).mockRejectedValue(new Error("Failed to fetch box score seasons: fetch failed"));
    const props = await contentProps();
    expect(props.boxScoreSeasons).toEqual([]);
    expect(logged).toHaveBeenCalledTimes(1);
    expect(String(logged.mock.calls[0][0])).toContain("josh-allen");
    logged.mockRestore();
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

```bash
node "C:/Users/jonra/OneDrive/Desktop/claude sandbox/football website/yards-per-pass/node_modules/vitest/vitest.mjs" run --root "C:/Users/jonra/OneDrive/Desktop/claude sandbox/football website/yards-per-pass" __tests__/components/GameLogTab.test.tsx __tests__/app/player-route.test.ts
```

Expected: `GameLogTab.test.tsx` — the 12 existing tests pass; "links the schedule result…" FAILS with `Cannot read properties of null (reading 'getAttribute')` and "works after the props cross…" FAILS with `expected undefined to be '/game/2025_05_TEN_ARI'`; the other two new tests pass by accident. `player-route.test.ts` — the 11 existing tests pass; both new tests FAIL (`props.boxScoreSeasons` is `undefined`; `getBoxScoreSeasons` not called).

- [ ] **Step 3: `GameLogTab` — the prop and the link**

(a) In `interface GameLogTabProps`, after the `gameResults` line add:

```ts
  /**
   * Seasons that have box scores (getBoxScoreSeasons). A Result cell links to
   * /game/<game_id> only when its schedule result exists (a played,
   * regular-season game) and the row's season is in this list (spec §7).
   */
  boxScoreSeasons: number[];
```

(b) Change the component signature

```tsx
export default function GameLogTab({ weeklyStats, position, season, teamId, gameResults }: GameLogTabProps) {
```

to

```tsx
export default function GameLogTab({ weeklyStats, position, season, teamId, gameResults, boxScoreSeasons }: GameLogTabProps) {
```

(c) Inside the row render, directly before

```tsx
                      if (typeof raw === "number" && col.format) {
                        display = col.format(raw);
                      } else {
                        display = String(raw ?? "\u2014");
                      }
```

insert:

```tsx
                      if (col.key === "result") {
                        // Box score link (spec §7). scheduleResult is only set for a
                        // played regular-season game; the season gate is the list prop.
                        const game = scheduleResult(r, gameResults);
                        const linked =
                          game !== undefined &&
                          Array.isArray(boxScoreSeasons) &&
                          boxScoreSeasons.includes(Number(r.season));
                        return (
                          <td key={col.key} className="px-2.5 py-1.5 text-left whitespace-nowrap text-gray-900">
                            {linked ? (
                              <Link
                                href={`/game/${game.game_id}`}
                                data-box-score-link
                                title={`Box score: ${game.team_score}-${game.opponent_score}`}
                                className="text-navy hover:text-nflred font-medium underline decoration-dotted underline-offset-[3px] transition-colors"
                              >
                                {String(raw)}
                              </Link>
                            ) : (
                              String(raw ?? "\u2014")
                            )}
                          </td>
                        );
                      }
```

(`Link` is already imported at the top of the file; `scheduleResult` is the Phase 0 helper in the same file.)

- [ ] **Step 4: `PlayerPageContent` passes it through**

In `interface PlayerPageContentProps`, after `gameResults: GameResultsByTeam;` add:

```ts
  /** Seasons with box scores — Game Log results in them link to /game/<id> (spec §7). */
  boxScoreSeasons: number[];
```

In the destructuring, change

```ts
  passLocationStats = [],
  gameResults,
}: PlayerPageContentProps) {
```

to

```ts
  passLocationStats = [],
  gameResults,
  boxScoreSeasons,
}: PlayerPageContentProps) {
```

and in `renderGameLog()` change

```tsx
        teamId={player.current_team_id}
        gameResults={gameResults}
      />
```

to

```tsx
        teamId={player.current_team_id}
        gameResults={gameResults}
        boxScoreSeasons={boxScoreSeasons}
      />
```

- [ ] **Step 5: The player page fetches the gate**

In `app/player/[slug]/page.tsx`, change

```ts
import { getGameResults } from "@/lib/data/games";
```

to

```ts
import { getGameResults } from "@/lib/data/games";
import { getBoxScoreSeasons } from "@/lib/data/box-score";
```

Directly after

```ts
  const currentSeason = Number.isNaN(parsed) ? (seasons[0] || fallbackSeason()) : parsed;
```

insert (the probe starts here so it overlaps the position reads; the `.catch` is attached at once so a rejection is never unhandled):

```ts

  // Box score links (spec §7) render only for seasons with team_game_stats
  // rows. Started here so the probe overlaps the stat reads below; the catch
  // is attached at once so a rejection is never unhandled. On failure the
  // Game Log simply shows unlinked results (logged), and this page renders per
  // request, so nothing degraded is cached.
  const boxScoreSeasonsPromise = getBoxScoreSeasons(seasons).catch((err: unknown): number[] => {
    console.error(`Player page: box score seasons unavailable for ${slug}; Game Log results will not link`, err);
    return [];
  });
```

Directly before

```ts
  const breadcrumbs = getBreadcrumbs(player.position, player.player_name);
```

insert:

```ts
  const boxScoreSeasons = await boxScoreSeasonsPromise;

```

and in the `<PlayerPageContent …/>` props, after `gameResults={gameResults}` add:

```tsx
          boxScoreSeasons={boxScoreSeasons}
```

- [ ] **Step 6: Run the tests to verify they pass**

```bash
node "C:/Users/jonra/OneDrive/Desktop/claude sandbox/football website/yards-per-pass/node_modules/vitest/vitest.mjs" run --root "C:/Users/jonra/OneDrive/Desktop/claude sandbox/football website/yards-per-pass" __tests__/components/GameLogTab.test.tsx __tests__/app/player-route.test.ts __tests__/components/PlayerHeader.test.tsx
```

Expected: PASS — 16 tests in `GameLogTab.test.tsx`, 13 in `player-route.test.ts`, 8 in `PlayerHeader.test.tsx`.

- [ ] **Step 7: Type check, lint, commit**

```bash
node "C:/Users/jonra/OneDrive/Desktop/claude sandbox/football website/yards-per-pass/node_modules/typescript/bin/tsc" --noEmit -p "C:/Users/jonra/OneDrive/Desktop/claude sandbox/football website/yards-per-pass/tsconfig.json"
```

Expected: no output, exit 0 (if it reports a missing `boxScoreSeasons`, a `<GameLogTab>` or `<PlayerPageContent>` render was missed — add the prop there).

```bash
npm --prefix "C:/Users/jonra/OneDrive/Desktop/claude sandbox/football website/yards-per-pass" run lint
```

Expected: only the four pre-existing warnings.

```bash
git -C "C:/Users/jonra/OneDrive/Desktop/claude sandbox/football website/yards-per-pass" add components/player/GameLogTab.tsx components/player/PlayerPageContent.tsx "app/player/[slug]/page.tsx" __tests__/components/GameLogTab.test.tsx __tests__/components/PlayerHeader.test.tsx __tests__/app/player-route.test.ts
```

```bash
git -C "C:/Users/jonra/OneDrive/Desktop/claude sandbox/football website/yards-per-pass" commit -m "feat: Game Log results link to the box score" -m "The Result cell links to /game/<game_id> when the schedule result exists (Phase 0's scheduleResult: a played regular-season game) and the row's season has team_game_stats rows (box score spec section 7). The player page probes the seasons with getBoxScoreSeasons alongside its other reads and passes the list down; a failed probe logs and leaves the cells unlinked." -m "Co-Authored-By: Claude <noreply@anthropic.com>"
```

---
### Task 10: Sitemap entries for box scores, then the full local verification

**Files:**
- Modify: `app/sitemap.ts` (imports lines 2–3; after `playerPages` at lines 50–55; the `return` at line 62)
- Test: `__tests__/app/sitemap.test.ts` (mocks at lines 3–4; imports at lines 6–8; `beforeEach` at lines 18–24; append tests)

**Interfaces:**
- Consumes: `getBoxScoreSeasons` (Task 3), `getPlayedRegularSeasonGameIds` (Task 3), `getAvailableSeasons` (`@/lib/data/queries`).
- Produces: `/sitemap.xml` lists `/game/<id>` for every played regular-season game of every covered season, after the player pages. A failed read drops the game URLs silently — the documented sitemap exception (`app/sitemap.ts` swallows errors; noted as a follow-up in `memory/MEMORY.md`), not fixed here.

- [ ] **Step 1: Write the failing sitemap tests**

In `__tests__/app/sitemap.test.ts`, replace the queries mock

```ts
vi.mock("@/lib/data/queries", () => ({ getDataFreshness: vi.fn() }));
```

with

```ts
vi.mock("@/lib/data/queries", () => ({
  getDataFreshness: vi.fn(),
  getAvailableSeasons: vi.fn(async () => [2026, 2025]),
}));
vi.mock("@/lib/data/box-score", () => ({ getBoxScoreSeasons: vi.fn(async () => []) }));
vi.mock("@/lib/data/games", () => ({ getPlayedRegularSeasonGameIds: vi.fn(async () => []) }));
```

replace the imports

```ts
import sitemap from "@/app/sitemap";
import { getAllPlayerSlugs } from "@/lib/data/players";
import { getDataFreshness } from "@/lib/data/queries";
```

with

```ts
import sitemap from "@/app/sitemap";
import { getAllPlayerSlugs } from "@/lib/data/players";
import { getAvailableSeasons, getDataFreshness } from "@/lib/data/queries";
import { getBoxScoreSeasons } from "@/lib/data/box-score";
import { getPlayedRegularSeasonGameIds } from "@/lib/data/games";
```

change the start of `beforeEach`

```ts
beforeEach(() => {
  vi.mocked(getAllPlayerSlugs).mockReset();
  vi.mocked(getDataFreshness).mockReset();
```

to

```ts
beforeEach(() => {
  vi.mocked(getAllPlayerSlugs).mockReset();
  vi.mocked(getDataFreshness).mockReset();
  vi.mocked(getAvailableSeasons).mockReset();
  vi.mocked(getAvailableSeasons).mockResolvedValue([2026, 2025]);
  vi.mocked(getBoxScoreSeasons).mockReset();
  vi.mocked(getBoxScoreSeasons).mockResolvedValue([]);
  vi.mocked(getPlayedRegularSeasonGameIds).mockReset();
  vi.mocked(getPlayedRegularSeasonGameIds).mockResolvedValue([]);
```

and append at the end of the file:

```ts

describe("sitemap — box score pages (box score spec §6)", () => {
  it("lists every played regular-season game of each covered season", async () => {
    vi.mocked(getBoxScoreSeasons).mockResolvedValue([2026]);
    vi.mocked(getPlayedRegularSeasonGameIds).mockResolvedValue(["2026_01_BUF_HOU", "2026_01_NE_SEA"]);
    const entries = await sitemap();
    const games = entries.filter((e) => e.url.includes("/game/"));
    expect(games.map((e) => e.url)).toEqual([
      "https://yardsperpass.com/game/2026_01_BUF_HOU",
      "https://yardsperpass.com/game/2026_01_NE_SEA",
    ]);
    expect((games[0].lastModified as Date).toISOString()).toBe("2026-09-10T16:42:00.000Z");
    expect(games[0].priority).toBe(0.6);
    expect(getBoxScoreSeasons).toHaveBeenCalledWith([2026, 2025]);
    expect(getPlayedRegularSeasonGameIds).toHaveBeenCalledTimes(1);
    expect(getPlayedRegularSeasonGameIds).toHaveBeenCalledWith(2026);
    expect(entries).toHaveLength(10 + 32 + 3 + 2);
  });

  it("lists none when no season is covered, and none (no throw) when the reads fail", async () => {
    expect((await sitemap()).filter((e) => e.url.includes("/game/"))).toHaveLength(0);
    vi.mocked(getBoxScoreSeasons).mockRejectedValue(new Error("boom"));
    const entries = await sitemap();
    expect(entries.filter((e) => e.url.includes("/game/"))).toHaveLength(0);
    expect(entries).toHaveLength(10 + 32 + 3);
    vi.mocked(getBoxScoreSeasons).mockResolvedValue([2026]);
    vi.mocked(getPlayedRegularSeasonGameIds).mockRejectedValue(new Error("boom"));
    expect((await sitemap()).filter((e) => e.url.includes("/game/"))).toHaveLength(0);
    vi.mocked(getPlayedRegularSeasonGameIds).mockResolvedValue(["2026_01_BUF_HOU"]);
    vi.mocked(getAvailableSeasons).mockRejectedValueOnce(new Error("boom"));
    expect((await sitemap()).filter((e) => e.url.includes("/game/"))).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
node "C:/Users/jonra/OneDrive/Desktop/claude sandbox/football website/yards-per-pass/node_modules/vitest/vitest.mjs" run --root "C:/Users/jonra/OneDrive/Desktop/claude sandbox/football website/yards-per-pass" __tests__/app/sitemap.test.ts
```

Expected: the 5 existing tests pass; "lists every played regular-season game…" FAILS (`expected [] to deeply equal [ 'https://yardsperpass.com/game/2026_01_BUF_HOU', … ]`); "lists none…" passes by accident.

- [ ] **Step 3: Add the game URLs**

In `app/sitemap.ts`, change the imports

```ts
import { getAllPlayerSlugs } from "@/lib/data/players";
import { getDataFreshness } from "@/lib/data/queries";
```

to

```ts
import { getAllPlayerSlugs } from "@/lib/data/players";
import { getAvailableSeasons, getDataFreshness } from "@/lib/data/queries";
import { getBoxScoreSeasons } from "@/lib/data/box-score";
import { getPlayedRegularSeasonGameIds } from "@/lib/data/games";
```

after the `playerPages` block

```ts
  const playerPages: MetadataRoute.Sitemap = players.map((p) => ({
    url: `${base}/player/${p.slug}`,
    lastModified: dataUpdated,
    changeFrequency: "weekly" as const,
    priority: 0.7,
  }));
```

insert

```ts

  // Box scores: every played regular-season game of a season that has
  // team_game_stats rows (box score spec §6). Same documented exception as the
  // slugs above: a failed read silently drops every game URL until the next
  // rebuild (memory/MEMORY.md, "Homepage resilience" follow-ups).
  // This is a serial chain: getAvailableSeasons, then one limit(1) probe per
  // candidate season, then one game-id read per covered season (1 + N + M
  // round trips, N = 7 and M = 1 today). Do not stack more reads on it in PR 4
  // without parallelising it first.
  let gameIds: string[] = [];
  try {
    const covered = await getBoxScoreSeasons(await getAvailableSeasons());
    const perSeason = await Promise.all(covered.map((season) => getPlayedRegularSeasonGameIds(season)));
    gameIds = perSeason.flat();
  } catch {
    // Supabase unavailable — no game pages this time
  }
  const gamePages: MetadataRoute.Sitemap = gameIds.map((id) => ({
    url: `${base}/game/${id}`,
    lastModified: dataUpdated,
    changeFrequency: "weekly" as const,
    priority: 0.6,
  }));
```

and change the return

```ts
  return [...staticPages, ...teamPages, ...playerPages];
```

to

```ts
  return [...staticPages, ...teamPages, ...playerPages, ...gamePages];
```

- [ ] **Step 4: Run it to verify it passes**

```bash
node "C:/Users/jonra/OneDrive/Desktop/claude sandbox/football website/yards-per-pass/node_modules/vitest/vitest.mjs" run --root "C:/Users/jonra/OneDrive/Desktop/claude sandbox/football website/yards-per-pass" __tests__/app/sitemap.test.ts
```

Expected: PASS, 7 tests.

- [ ] **Step 5: Full local verification (the release check; Tasks 11–13 re-run it after any fix)**

```bash
node "C:/Users/jonra/OneDrive/Desktop/claude sandbox/football website/yards-per-pass/node_modules/typescript/bin/tsc" --noEmit -p "C:/Users/jonra/OneDrive/Desktop/claude sandbox/football website/yards-per-pass/tsconfig.json"
```

Expected: no output, exit 0.

```bash
npm --prefix "C:/Users/jonra/OneDrive/Desktop/claude sandbox/football website/yards-per-pass" run lint
```

Expected: only the four pre-existing warnings (`ComparisonTool.tsx` 179:6, `QBLeaderboard.tsx` 634:29, `RBLeaderboard.tsx` 708:29, `ReceiverLeaderboard.tsx` 722:29) — nothing in a file this PR touched.

```bash
node "C:/Users/jonra/OneDrive/Desktop/claude sandbox/football website/yards-per-pass/node_modules/vitest/vitest.mjs" run --root "C:/Users/jonra/OneDrive/Desktop/claude sandbox/football website/yards-per-pass"
```

Expected: `Test Files 34 passed`, `Tests 541 passed` — `main` has 25 files / 437 tests; this PR adds 9 files (`data/supabase-server`, `stats/box-score`, `data/box-score`, `components/game/Scoreboard`, `components/game/ComparisonSection`, `components/MetricTooltip`, `components/game/PlayerTable`, `app/game-route`, `app/team-route`) and 104 tests. If PR 2 has merged first and `main` moved, the baseline is whatever `main` reports plus these.

```bash
NEXT_PUBLIC_SUPABASE_URL=https://placeholder.supabase.co NEXT_PUBLIC_SUPABASE_ANON_KEY=placeholder-key-for-build-only npm --prefix "C:/Users/jonra/OneDrive/Desktop/claude sandbox/football website/yards-per-pass" run build
```

Expected: `✓ Generating static pages (50/50)` and a route table with `ƒ /game/[game_id]` (Dynamic, ~3.5 kB, ~149 kB first load) and `● /team/[team_id]` still SSG with its 32 paths; the placeholder build prints `getDataFreshness failed (season=undefined): TypeError: fetch failed` once from the sitemap — that is the existing behaviour. If it fails with `EINVAL: invalid argument, readlink` under `.next`, OneDrive has locked the build folder; move it aside (use a suffix that doesn't exist yet) and build again:

```bash
mv "C:/Users/jonra/OneDrive/Desktop/claude sandbox/football website/yards-per-pass/.next/server" "C:/Users/jonra/OneDrive/Desktop/claude sandbox/football website/yards-per-pass/.next/cache/onedrive-locked-3"
```

- [ ] **Step 6: Commit**

```bash
git -C "C:/Users/jonra/OneDrive/Desktop/claude sandbox/football website/yards-per-pass" add app/sitemap.ts __tests__/app/sitemap.test.ts
```

```bash
git -C "C:/Users/jonra/OneDrive/Desktop/claude sandbox/football website/yards-per-pass" commit -m "feat: sitemap lists box scores for covered seasons" -m "Every played regular-season game of a season with team_game_stats rows gets a /game/<id> entry. A failed read drops them silently, the sitemap's documented exception." -m "Co-Authored-By: Claude <noreply@anthropic.com>"
```

---
### Task 11: Chaos test

**Files:** none committed by the chaos agent (it works in throwaway test files under `__tests__/chaos/` and deletes them). Fixes land in the files from Tasks 1–10, each with a regression test in the matching test file.

**Interfaces:** Consumes the finished Tasks 1–10.

- [ ] **Step 1: Dispatch the chaos agent**

Use the Agent tool (`general-purpose`) with this prompt:

```text
You are a chaos tester for the Yards Per Pass repo at
C:/Users/jonra/OneDrive/Desktop/claude sandbox/football website/yards-per-pass
(branch box-scores-pr3). Try to BREAK the new box score page and its links. Do
not modify source files. Write throwaway vitest files under __tests__/chaos/
(delete them when done) and run them with:
node "C:/Users/jonra/OneDrive/Desktop/claude sandbox/football website/yards-per-pass/node_modules/vitest/vitest.mjs" run --root "C:/Users/jonra/OneDrive/Desktop/claude sandbox/football website/yards-per-pass" __tests__/chaos
Run every command separately (never chain with && or ||). Never write to
Supabase, never set DATABASE_URL, never print the contents of .env.local.

What changed (read these first):
- lib/stats/box-score.ts: formatting (fmt*), recordThroughWeek, buildScoreboard,
  buildComparison, playCountNote, receivingNote, buildPassingTable /
  buildRushingTable / buildReceivingTable — pure, no Supabase.
- lib/data/box-score.ts: getBoxScoreSeasons, getTeamGameStats, getGamePlayerLines,
  getBoxScore (five states), normalizeGameId. lib/data/games.ts: getGame,
  getPlayedRegularSeasonGameIds.
- components/game/{Scoreboard,ComparisonSection,PlayerTable,GameMessage}.tsx;
  app/game/[game_id]/page.tsx (+ generateMetadata); app/sitemap.ts.
- components/team/ScheduleSection.tsx + app/team/[team_id]/page.tsx and
  components/player/GameLogTab.tsx + app/player/[slug]/page.tsx: new required
  prop boxScoreSeasons: number[] and the /game links.
Mock Supabase the way __tests__/data/box-score.test.ts does (one chain per
from()), render components the way __tests__/components/game/*.test.tsx do,
call the page the way __tests__/app/game-route.test.tsx does, and use the
fixture __tests__/fixtures/box-score-buf-hou.ts.

Rules the code must keep: every numeric render survives null, undefined, NaN
and Infinity (an em dash, grey for EPA, never "NaN", "undefined", "null" or
"-0.0" in the DOM); a failed protected read on the game page throws (never a
rendered empty shell) unless hasNoDatabase(); the team and player pages never
crash on a failed seasons probe; nothing links to an unplayed, playoff or
uncovered game; props crossing to client components are plain JSON.

Cases (add any others you think of):
1. normalizeGameId / the page: "", "   ", "2026_01_buf_hou", "2026_01_BUF_HOU/",
   "2026_01_BUF_HOU%20", a 500-char id, "2026_01_BU_HOU", "2026_01_BUF_HOUX",
   "2026_01_LA_SF", "0000_00_AAA_AAA", "../../etc/passwd", "<script>", unicode
   digits, null / undefined params, and real historical ids that must render
   the uncovered message page, not 404 and not a blank shell:
   "2025_14_PHI_LAC", "2020_01_HOU_KC", plus a real playoff id "2025_19_..."
   from the games table (the playoff branch of "uncovered").
2. getBoxScore: games row with home_team === away_team; season as a string
   ("2026"); week null / 0 / 99; game_type null / "" / "post" (lower case);
   scores "36"/"31" strings, negative, 0-0; team_game_stats returning 3 rows,
   rows for the wrong teams, rows whose team_id is lower case; a row with every
   NUMERIC as "NaN" and every count null;
   time_of_possession_seconds 0 / 5000 / negative; team_targets 0 / null;
   getAvailableSeasons returning [2026] but no probe hits; getTeamSchedule
   returning rows from another season; a real unplayed game ("2026_02_NYG_LA",
   both scores null — must notFound(), never render); team_game_stats returning
   ZERO rows for a played covered game (the "pending" state) and ONE row
   (only the away team present).
3. buildComparison / notes with both rows identical, both rows all-null,
   plays 0, total_plays 0, explosive counts larger than plays, turnovers
   negative, first downs that don't sum, 1000-play teams.
4. Player lines: 0 rows; 150 receiver rows on one team; duplicate player_ids
   across tables (a QB who also has an rb row); a player_id with no slug row;
   names with apostrophes and dots (D'Andre, Amon-Ra St. Brown, "C.J."); a
   60-character player_name and a single-character one; player_name null / "";
   slug null / ""; position null / "FB" / lower case; targets 0 with receptions > 0;
   catch_rate > 1; carries 0 with yards; rush_attempts null on a QB;
   routes_run 0 (not null) on one row; yards_per_route_run null with routes;
   every EPA column null / NaN / Infinity / "0.5" (a string that escaped
   parsing).
5. Scoreboard: unknown team ids ("XYZ"), records with NaN wins, a tie game,
   gameday "2026-9-3", weekday "" / null, a January game (year suffix logic),
   scores of 0-0, 99-98.
6. Links: ScheduleSection with boxScoreSeasons undefined / null / ["2026"] /
   [NaN] / a 40-season list; a TeamGame with season as a string; game_id with
   spaces; GameLogTab rows whose season is a string or NaN; gameResults entry
   present but boxScoreSeasons empty; 1000 rows (time the render).
7. Pages: team page with getBoxScoreSeasons rejecting with a non-Error object;
   player page with getBoxScoreSeasons throwing synchronously (not rejecting);
   the game page with getBoxScore resolving to a state object missing fields,
   or an unknown state string; generateMetadata for every state and for a
   junk id.
8. Sitemap: 5,000 game ids across 7 seasons (assert no duplicates and no
   throw); getAvailableSeasons resolving [] (no game URLs, no throw).

For each case report exactly one of CRASH (throws / page fails to render),
ERROR (wrong output a visitor would see), DEGRADED (acceptable fallback, e.g.
a dash or an unlinked cell), PASS — with the input, what happened, and
file:line of the cause. End with the list of CRASH and ERROR findings only.
Delete __tests__/chaos/ before finishing and confirm `git status` shows no
untracked chaos files.
```

- [ ] **Step 2: Fix every CRASH and ERROR**

For each finding: add a failing regression test to the matching file (`__tests__/stats/box-score.test.ts`, `__tests__/data/box-score.test.ts`, `__tests__/data/games.test.ts`, `__tests__/components/game/*.test.tsx`, `__tests__/app/game-route.test.tsx`, `__tests__/components/ScheduleSection.test.tsx`, `__tests__/components/GameLogTab.test.tsx`, `__tests__/app/sitemap.test.ts`), run that file to see it fail, make the smallest fix, run it again to see it pass. DEGRADED findings that match this plan's documented behaviour (dashes, grey EPA, unlinked cells, the sitemap's silent drop, a 404 for junk ids) need no change; note the rest in the PR description.

- [ ] **Step 3: Re-verify and commit the fixes (skip if there were none)**

Run the four Task 10 Step 5 commands again (tsc, lint, vitest, build); all must pass. Stage only the files you changed, by name, for example:

```bash
git -C "C:/Users/jonra/OneDrive/Desktop/claude sandbox/football website/yards-per-pass" add lib/stats/box-score.ts __tests__/stats/box-score.test.ts
```

```bash
git -C "C:/Users/jonra/OneDrive/Desktop/claude sandbox/football website/yards-per-pass" commit -m "fix: harden the box score page against chaos-test findings" -m "Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 12: Code review (SDD's final whole-branch review)

**Files:** whatever the accepted findings touch, with tests.

**Interfaces:** Consumes the branch after Task 11.

- [ ] **Step 1: Request the review**

First write the review package to the scratchpad as **per-file diffs**, never one whole-branch blob (PR 2's whole-branch package was ~317 KB and stalled a reviewer — its ledger's ruling was "switch the final review to opus and slice the diff by file"):

```bash
git -C "C:/Users/jonra/OneDrive/Desktop/claude sandbox/football website/yards-per-pass" fetch origin
```

```bash
git -C "C:/Users/jonra/OneDrive/Desktop/claude sandbox/football website/yards-per-pass" diff --stat origin/main...box-scores-pr3
```

Then one file per slice, e.g.:

```bash
git -C "C:/Users/jonra/OneDrive/Desktop/claude sandbox/football website/yards-per-pass" diff origin/main...box-scores-pr3 -- lib/stats/box-score.ts > "<your scratchpad>/review-lib-stats.diff"
```

Group the slices into four packages — (a) `lib/stats/box-score.ts` + its test, (b) `lib/data/box-score.ts` + `lib/data/games.ts` + their tests, (c) `components/game/*` + `MetricTooltip` + their tests, (d) the page, `sitemap.ts`, `revalidate`, and the Tasks 8–9 link edits + their tests — and use the superpowers:requesting-code-review skill **with model `opus`**, one dispatch per package, each told to write findings incrementally to its own scratchpad file so a stall loses nothing. Give every reviewer spec §6, §7, §11 (frontend), §12 and this plan's Global Constraints as the requirements, and ask it to check specifically:

- No `"use client"` file imports `lib/data/box-score.ts`, `lib/data/games.ts`, `lib/data/queries.ts` or `lib/data/players.ts`; `ScheduleSection`, `TeamHubContent`, `GameLogTab` and `PlayerPageContent` receive `boxScoreSeasons` as a plain array; nothing non-serializable crosses server → client.
- Every numeric render goes through `isNum` / the `fmt*` helpers; `epaTextColor` is only reached through `epaCellClass`; no `.toFixed` on a possibly-null value anywhere in the new code.
- The game page rethrows on a failed read unless `hasNoDatabase()`; nothing in `lib/data/box-score.ts` swallows an error; `getAvailableSeasons() === []` is treated as a failure; the link gate is a per-season `limit(1)` probe and no new read over `team_game_stats` or `games` can hit the 1000-row cap.
- Every row label, section title, tooltip text, message heading and note matches the approved mockup as transcribed in Tasks 2, 5 and 7; the better-side direction per row matches Task 2's comment (higher / lower / none) and the golden test; only presentation arithmetic appears (toxic differential, split explosive rates, TGT% by `team_targets`, Y/TGT, QB YPC, records).
- Links render only for played, REG, covered-season games (schedule tiles and Game Log) and never nest inside another link.
- `revalidatePath("/game", "layout")` is in `/api/revalidate`; `revalidate = 3600` and no `generateStaticParams` on the page; the sitemap change is inside its documented try/catch.
- No committed file references a scratchpad path; nothing outside the listed files was refactored; the four pre-existing lint warnings are the only ones.

- [ ] **Step 2: Address the findings**

Use superpowers:receiving-code-review. Fix Critical and Important findings with a failing test first; for anything you decline, record why in the PR description.

- [ ] **Step 3: Re-verify and commit (skip if nothing changed)**

Run the four Task 10 Step 5 commands again; all must pass. Stage only the files you changed, by name, then:

```bash
git -C "C:/Users/jonra/OneDrive/Desktop/claude sandbox/football website/yards-per-pass" commit -m "fix: address code review on the box score page" -m "Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 13: Rate it + 3 domain experts

**Files:** whatever the accepted findings touch, with tests.

**Interfaces:** Consumes the branch after Task 12. This is the first user-visible box score work, so it gets the "rate it + 3 domain experts" pass (`memory/feedback_3expert_review.md`: run it after the final code review, on working code; implement the findings in one batch).

- [ ] **Step 1: Self-rate against the mockup and the spec**

Render the page locally against the BUF–HOU fixture the way `__tests__/app/game-route.test.tsx` does, and against the live database if PR 2's rows exist (start the dev server with Bash and `run_in_background: true` — `npm --prefix "C:/Users/jonra/OneDrive/Desktop/claude sandbox/football website/yards-per-pass" run dev` — wait for "Ready" in its output, then drive `http://localhost:3000/game/2026_01_BUF_HOU`, `/game/2025_14_PHI_LAC`, `/team/BUF` and `/player/josh-allen?tab=game-log` in the Browser pane via `navigate`, at desktop width and then `resize_window` preset `mobile`; stop the background server when done — the comparison sections must fit 390px with no sideways scroll, the player tables must scroll inside their own container). Write down: a rating 1–10 against the approved mockup and spec §6/§7/§12, what would make it a 10, and why it isn't already.

- [ ] **Step 2: Dispatch the three experts**

Use the Agent tool (`general-purpose`) three times in one message, all `run_in_background: true`, model `opus` (PR 2's ledger: sonnet's whole-branch review stalled and opus caught what it missed), with this prompt — one dispatch per role, substituting that role's text for `[ROLE]`:

```text
You are reviewing box scores PR 3 on the Yards Per Pass NFL analytics site
(repo C:/Users/jonra/OneDrive/Desktop/claude sandbox/football website/yards-per-pass,
branch box-scores-pr3). The change is already written out for you as per-file
diffs in <your scratchpad>/review-*.diff — read those, not one whole-branch
diff, and read the source files directly when you need more context. Read
spec docs/superpowers/specs/2026-09-15-box-scores-design.md sections 4, 6, 7,
11 and 12 in full; from the plan
docs/superpowers/plans/2026-09-16-box-scores-pr3-game-page.md read only its
Global Constraints (lines 13-28) and the task whose area you are reviewing.
Do not modify files; read-only. Write your findings to
<your scratchpad>/expert-<role>.md as you go, so a stall loses nothing.

Your role: [ROLE]

Push back on 3–5 specific, concrete issues with file:line references — things
that are wrong, misleading, fragile or missing for someone in your role — and
say what you would add. For each: severity CRITICAL (wrong data or a visitor
sees an error), IMPORTANT (misleading, confusing, incomplete), MINOR (polish).
Then rate the work 1–10 for your role and say what would make it a 10. Cite
code you actually read; never assume.
```

Roles:
1. `An NFL analytics editor who lives in rbsdm.com and ESPN box scores: are the definitions, labels, rounding, "better side" shading, notes and tooltips exactly what an analyst expects, and would any number embarrass the site if fact-checked?`
2. `A Next.js 14 / Vercel engineer: rendering mode, ISR and revalidation, the server/client boundary, serialization, request fan-out and latency on the game, team and player pages, build safety with the placeholder database, error boundaries and metadata.`
3. `A data-integrity / QA engineer: null and NaN paths from PostgREST through parseNumericFields to the DOM, the five page states and their tests, the link gate, the 1000-row cap, the fixture's fidelity to PR 2's golden values, and anything the vitest suite does not cover.`

- [ ] **Step 3: Implement the findings in one batch**

Collect the three reports. Fix every CRITICAL and IMPORTANT finding with a failing test first (same files as Task 11 Step 2); list declined items with the reason. Re-run the four Task 10 Step 5 commands; all must pass. Stage the changed files by name and commit:

```bash
git -C "C:/Users/jonra/OneDrive/Desktop/claude sandbox/football website/yards-per-pass" commit -m "fix: box score page after the three-expert review" -m "Co-Authored-By: Claude <noreply@anthropic.com>"
```

- [ ] **Step 4: The `/review-feature` roster — controller's call**

`.claude/CLAUDE.md` asks for `/review-feature "<description>"` (the 47-team + 3-CEO roster) after any feature, and PR 2's plan deferred that roster to "when PR 3 puts the numbers on a page". Run it here unless the controller rules the single review + three experts sufficient for this PR; if it runs, treat its CRITICAL/IMPORTANT findings exactly as Step 3 and commit as `fix: box score page after the review roster`.

---

### Task 14: Record it in memory and project docs

**Files:**
- Modify: `memory/MEMORY.md` (the "Frontend tests:" line under "Local dev on Jon's machine"; a new section after PR 2's `## team_game_stats + QB rushing EPA (box scores PR 2)` section if it exists, otherwise after `## Game Log scores (box scores Phase 0)`)
- Modify: `.claude/CLAUDE.md` (the "Data fetching:" line)
- Modify: `app/glossary/page.tsx` (one new `TERMS` entry; the file has no test)

- [ ] **Step 1: Update the test counts in `memory/MEMORY.md`**

`memory/MEMORY.md` line 49 currently reads (its Python half is PR 2's — leave it exactly as you find it):

```markdown
- Frontend tests: `npx vitest run` (413 tests / 24 files after the 2026-09-14 homepage-resilience change). Python: `py -3 -m pytest tests/ -q` (459 tests: 453 pass, 5 skip without `YPP_PBP_PARQUET`, 1 strict xfail).
```

Its frontend figure is already stale — the branch before this PR measures 437 tests / 25 files, because Phase 0's `games.test.ts` was never written back. Replace only the frontend parenthetical with the real numbers Task 10 Step 5 printed, i.e. `(541 tests / 34 files after box scores PR 3)`, or whatever chaos and review fixes made it.

- [ ] **Step 2: Add the new section**

Insert, after the PR 2 memory section (or after the "Game Log scores (box scores Phase 0)" section's `- Tests:` bullet if PR 2 has not merged yet) and before `## Known debt (2026-09-05)`:

```markdown

## Box score page + links (box scores PR 3)

- **`/game/<game_id>`** (`app/game/[game_id]/page.tsx`, on demand + `revalidate = 3600`, no `generateStaticParams`): Tecmo scoreboard → legend → Efficiency / Team stats / What it cost them / Early vs late downs (`AWAY | stat | HOME`, better side shaded) → Passing / Rushing / Receiving. Data: `lib/data/box-score.ts` `getBoxScore(id)` → one of five states — `not-found` / `unplayed` (both `notFound()`), `uncovered` (a season before the first with `team_game_stats`, or a playoff game: scoreboard + noindex message + team links), `pending` (played, covered season, rows not written yet: "Stats arrive once play-by-play is published"), `ready`. **Every read throws on failure and the page rethrows unless `hasNoDatabase()`** (moved to `lib/supabase/server.ts`) — never a cached empty page. Records come from `getTeamSchedule` (`recordThroughWeek`), never a stored column.
- **Pure builders live in `lib/stats/box-score.ts`** (no Supabase; safe in client code): `fmt*` (typographic minus U+2212, no signed zero, em dash for null/NaN/Infinity), `epaCellClass` (the null-safe wrapper around `epaTextColor` — never call `epaTextColor` with a possibly-null value), `buildScoreboard`, `buildComparison` (rows + `better` side, compared at display precision), `playCountNote` / `receivingNote` (worded from the game's own numbers), `buildPassingTable` / `buildRushingTable` / `buildReceivingTable` (yards desc → volume desc → name; QB rushing rows use PR 2's `rush_epa_per_carry` / `rush_success_rate`; TGT% = targets ÷ `team_targets`; YPRR only when any row has `routes_run`). The only arithmetic on the page is presentation the spec defines from stored columns. Golden fixture `__tests__/fixtures/box-score-buf-hou.ts` pins 2026_01_BUF_HOU (rbsdm/ESPN values) — never edit it to make a test pass.
- **Links (spec §7):** `getBoxScoreSeasons(candidates)` probes each season with `limit(1)` (never a bare `select season` — the 1000-row cap would drop seasons after the backfill). The team and player pages fetch it server-side and pass `boxScoreSeasons: number[]` (a required prop) to `ScheduleSection` / `GameLogTab`; a played REG game in a covered season links its score line / Result cell to `/game/<id>`; playoff, unplayed and uncovered games never link. A failed probe logs and renders no links (the team page is ISR, so that lasts up to an hour).
- `/api/revalidate` also revalidates `/game` (layout) — the data-refresh workflow calls it after every ingest, so "pending" pages refresh within a refresh cycle. The sitemap lists `/game/<id>` for played REG games of covered seasons inside its documented error-swallowing try/catch.
- Tooltips: `MetricTooltip` keys `EPA / play`, `Success rate`, `Explosive plays` (scrambles count), `Toxic differential`. Copy, labels and section order are the approved mockup's (2026-09-16); the mockup itself was session scratch and is gone — the plan is the durable transcription.
- Tests: `__tests__/stats/box-score.test.ts`, `__tests__/data/box-score.test.ts`, `__tests__/data/games.test.ts`, `__tests__/components/game/*.test.tsx`, `__tests__/components/MetricTooltip.test.tsx`, `__tests__/app/game-route.test.tsx`, `__tests__/app/team-route.test.tsx`, plus the link tests in `ScheduleSection.test.tsx`, `GameLogTab.test.tsx`, `player-route.test.ts`, `sitemap.test.ts`.
- Follow-ups (spec §13): `/scores` + homepage strip (PR 4 reuses `Scoreboard` / `buildScoreboard`), percentile colouring, the 2020–2025 backfill (the message page names the first covered season from data), an OG image for game pages, making `epaTextColor` itself null-safe, and the remaining glossary entries for the box score definitions (`/glossary` gains only the first-down double-count entry spec §4 explicitly asks for; EPA / play, success rate, explosive plays and toxic differential stay on the page's own tooltips and notes for now).
```

- [ ] **Step 3: Update `.claude/CLAUDE.md`**

The "Data fetching" line reads (after Phase 0):

```markdown
- Data fetching: `lib/data/queries.ts`, `lib/data/receivers.ts`, `lib/data/rushing.ts`, `lib/data/players.ts`, `lib/data/team-hub.ts`, `lib/data/run-gaps.ts`, `lib/data/games.ts` (schedule + official final scores — server-only, never import it from a `"use client"` file)
```

Change it to:

```markdown
- Data fetching: `lib/data/queries.ts`, `lib/data/receivers.ts`, `lib/data/rushing.ts`, `lib/data/players.ts`, `lib/data/team-hub.ts`, `lib/data/run-gaps.ts`, `lib/data/games.ts` (schedule + official final scores — server-only, never import it from a `"use client"` file), `lib/data/box-score.ts` (the `/game/[game_id]` page and the box score link gate — server-only; its pure builders are in `lib/stats/box-score.ts`)
```

Leave the rest of `.claude/CLAUDE.md` alone: line 50 already reads "18 Supabase tables total (… team_game_stats)" (PR 2 did it; the spec §13 note about "13 → 14" is stale), and the "Nav labels" line gains **Scores** only in PR 4.

- [ ] **Step 4: Add the one glossary entry spec §4 asks for**

Spec §4 says the glossary notes the first-down double count ("We store the sum of parts so the total always equals its own sub-rows and matches ESPN, and the glossary notes it"). `app/glossary/page.tsx` has no test file, so this is a copy-only change with no test. In its `TERMS` array, directly after the `"Success Rate"` entry in the `Core Stats` section

```ts
  {
    term: "Success Rate",
    definition:
      "How often a play generates positive EPA (Expected Points Added > 0). This is the nflverse EPA-based definition, which may differ slightly from PFR\u2019s yardage-based formula (40%/50%/100% of needed yards). QB success rate on this site excludes sacks from the denominator.",
  },
```

insert:

```ts
  {
    term: "First Downs (Box Score)",
    id: "first-downs",
    definition:
      "A team\u2019s total first downs on a game\u2019s box score, counted as passing + rushing + penalty first downs. One play can set two of those at once \u2014 a run that reaches the line to gain and also draws a defensive penalty \u2014 so the total deliberately double-counts that rare case. It is what ESPN shows, and it keeps the total equal to the sum of its own sub-rows; summing the raw first-down flag instead comes up 1\u20133 short in about one game in six.",
  },
```

Only this one entry: the other box score glossary entries stay on the follow-up list.

- [ ] **Step 5: Check MEMORY.md is still under 200 lines**

```bash
wc -l "C:/Users/jonra/OneDrive/Desktop/claude sandbox/football website/yards-per-pass/memory/MEMORY.md"
```

Expected: under 200 (about 130 with PR 2's section in place). If it is over, trim the oldest "Week 1 2026 audit" follow-up bullets that are already marked resolved, never this section.

- [ ] **Step 6: Commit**

```bash
git -C "C:/Users/jonra/OneDrive/Desktop/claude sandbox/football website/yards-per-pass" add memory/MEMORY.md .claude/CLAUDE.md app/glossary/page.tsx
```

```bash
git -C "C:/Users/jonra/OneDrive/Desktop/claude sandbox/football website/yards-per-pass" commit -m "docs: record the box score page, its states and the link gate" -m "Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 15: Ship and verify live

**Files:** none in the repo. Scratch (not committed): `<your scratchpad>/pr-body.md`, `<your scratchpad>/check_production.py`.

**Interfaces:** Consumes the merged branch; the site's public REST API with the anon key from `.env.local` (read-only GETs; the script prints counts and ids, never the key); the Vercel GitHub integration's commit status (context `Vercel`).

- [ ] **Step 1: The gate — PR 2 merged and production has 2026 rows**

```bash
gh pr list --repo jonramz876/yards-per-pass --state merged --head box-scores-pr2 --json number,title,mergedAt
```

Expected: exactly one row — PR **#18**, `feat: team_game_stats — per-game team box score data (box scores PR 2)`, merged 2026-09-21. If the list is empty, stop: this PR waits for PR 2.

Save this as `<your scratchpad>/check_production.py`:

```python
"""Read-only production check for box scores PR 3. Reads the site's anon key
from .env.local for the public REST API and NEVER prints it.

Usage:  py -3 check_production.py "<repo path>"
"""
import json
import os
import sys
import urllib.parse
import urllib.request

repo = sys.argv[1]
env = {}
with open(os.path.join(repo, '.env.local'), encoding='utf-8') as fh:
    for line in fh:
        line = line.strip()
        if '=' in line and not line.startswith('#'):
            key, _, value = line.partition('=')
            env[key.strip()] = value.strip().strip('"').strip("'")
URL = env['NEXT_PUBLIC_SUPABASE_URL'].rstrip('/')
KEY = env['NEXT_PUBLIC_SUPABASE_ANON_KEY']


def get(table, **params):
    query = urllib.parse.urlencode(params)
    req = urllib.request.Request(f'{URL}/rest/v1/{table}?{query}',
                                 headers={'apikey': KEY, 'Authorization': f'Bearer {KEY}'})
    with urllib.request.urlopen(req, timeout=60) as resp:
        return json.loads(resp.read().decode('utf-8'))


rows = get('team_game_stats', season='eq.2026', select='game_id,team_id,week', limit=1000)
played = get('games', season='eq.2026', game_type='eq.REG', home_score='not.is.null',
             select='game_id,week', order='week.desc,game_id.asc', limit=1000)
unplayed = get('games', season='eq.2026', game_type='eq.REG', home_score='is.null',
               select='game_id,week', order='week.asc,game_id.asc', limit=1)
weeks = sorted({r['week'] for r in rows})
print(f'team_game_stats 2026 rows: {len(rows)} covering weeks {weeks}')
print(f'played 2026 REG games in `games`: {len(played)}; latest week {played[0]["week"] if played else None}')
missing = sorted({g['game_id'] for g in played} - {r['game_id'] for r in rows})
print(f'played games without team_game_stats rows yet: {len(missing)} {missing[:5]}')
print(f'an unplayed 2026 game id for the 404 check: {unplayed[0]["game_id"] if unplayed else None}')
buf = [r for r in rows if r['game_id'] == '2026_01_BUF_HOU']
print(f'2026_01_BUF_HOU rows: {len(buf)}')
if len(rows) < 32 or len(buf) != 2:
    print('GATE NOT MET: production lacks the week-1 rows this PR is verified against')
    sys.exit(1)
print('OK: gate met')
```

```bash
py -3 "<your scratchpad>/check_production.py" "C:/Users/jonra/OneDrive/Desktop/claude sandbox/football website/yards-per-pass"
```

Expected (as of 2026-09-21, weeks 1–2 played): `team_game_stats 2026 rows: 62 covering weeks [1, 2]` or more — 2 rows per played REG game — `played 2026 REG games in games: 31`, `2026_01_BUF_HOU rows: 2`, `OK: gate met`. The "played games without rows yet" line lists games whose play-by-play the refresh has not caught up with (the last game of the newest week for a few hours) — fine, those pages show the "Stats arrive" message. `GATE NOT MET` means **stop and report to Jon**. Do not dispatch `data-refresh.yml` — it is a production write and needs his go-ahead. Paste the script's output and wait. Keep the unplayed game id it prints for Step 6.

- [ ] **Step 2: Pre-flight**

```bash
git -C "C:/Users/jonra/OneDrive/Desktop/claude sandbox/football website/yards-per-pass" status --short --branch
```

Expected: `## box-scores-pr3` with no modified or untracked files (a leftover `__tests__/chaos/` means Task 11 was not cleaned up).

```bash
git -C "C:/Users/jonra/OneDrive/Desktop/claude sandbox/football website/yards-per-pass" fetch origin
```

```bash
git -C "C:/Users/jonra/OneDrive/Desktop/claude sandbox/football website/yards-per-pass" merge-base --is-ancestor origin/main box-scores-pr3
```

Expected: exit 0. If it exits 1, `main` moved (PR 2 merged after Task 1): rebase with `git -C "<repo>" rebase origin/main` — PR 2 touches only `scripts/`, `tests/`, `memory/MEMORY.md` and `.claude/CLAUDE.md`, so at most Task 14's two doc files conflict; resolve by keeping both sections and the true table count — then re-run the four Task 10 Step 5 commands.

- [ ] **Step 3: Push and open the PR**

```bash
git -C "C:/Users/jonra/OneDrive/Desktop/claude sandbox/football website/yards-per-pass" push -u origin box-scores-pr3
```

Write the PR description to `<your scratchpad>/pr-body.md`. It must contain: what the PR adds (`/game/<game_id>` with the scoreboard, four comparison sections and three player tables; schedule-tile and Game Log links gated per season; sitemap and revalidate entries); the five page states and which are noindex; how the numbers are verified (the BUF–HOU golden fixture pinned to rbsdm/ESPN values, the golden render test, the pure-builder tests); the local results (tsc, lint, vitest file/test counts, build); the chaos, code-review and three-expert outcomes with anything declined; the deploy note (needs PR 2's `team_game_stats` in production — Step 1's output pasted in; team pages rebuild at deploy so links appear at once; "Stats arrive" pages refresh with each data refresh through `/api/revalidate`); and it must end with:

```text
🤖 Generated with [Claude Code](https://claude.com/claude-code)
```

Then, with that file's absolute path:

```bash
gh pr create --repo jonramz876/yards-per-pass --base main --head box-scores-pr3 --title "feat: /game box score page + schedule and Game Log links (box scores PR 3)" --body-file "<absolute path to pr-body.md>"
```

Note the PR number `<n>` it prints.

- [ ] **Step 4: Wait for CI**

Never use `gh pr checks --watch` (it has exited early on this repo). Poll in the background — Bash with `run_in_background: true`, or the Monitor tool with the same until-loop:

```bash
until [ "$(gh pr checks <n> --repo jonramz876/yards-per-pass --json bucket --jq 'map(select(.bucket == "pending")) | length')" = "0" ]; do sleep 60; done; gh pr checks <n> --repo jonramz876/yards-per-pass --json name,bucket
```

Expected when it finishes: four checks, all `"bucket":"pass"` — `Vercel`, `Vercel Preview Comments`, `lint-and-build` and `test-python` (PR 2 got exactly these four). CI does not run vitest — Task 10 Step 5 was the vitest gate. On a failure: `gh run view <run id from the checks output> --repo jonramz876/yards-per-pass --log-failed`, fix it with a test, re-run the four local commands, push, poll again.

- [ ] **Step 5: Merge and wait for the production deploy**

```bash
gh pr merge <n> --repo jonramz876/yards-per-pass --merge
```

```bash
gh pr view <n> --repo jonramz876/yards-per-pass --json mergeCommit --jq '.mergeCommit.oid'
```

Poll the merge commit's Vercel status in the background until it is `success`:

```bash
until [ -n "$(gh api repos/jonramz876/yards-per-pass/commits/<merge sha>/status --jq '[.statuses[] | select(.context == "Vercel") | .state] | map(select(. == "success" or . == "failure" or . == "error")) | last')" ]; do sleep 60; done; gh api repos/jonramz876/yards-per-pass/commits/<merge sha>/status --jq '.statuses[] | select(.context == "Vercel") | {state, target_url}'
```

If the printed `state` is not `success`, do NOT proceed to Step 6 — follow the failure note below.

A `failure` state means the production build failed (a transient Supabase error during prerender fails the deploy — the previous deployment stays live): open the `target_url`, and if the log shows `Error occurred prerendering page`, click **Redeploy** in Vercel and poll again. No `/api/revalidate` call is needed: the new deployment's build prerenders all 32 team pages with the new code (their tiles link at once), player and game pages render on demand, and the data-refresh workflow already calls `/api/revalidate` (now including `/game`) after every ingest.

- [ ] **Step 6: Verify on yardsperpass.com**

Each check is one `curl` (or the Browser pane); grep the HTML — the page is server-rendered, so every value is in the response.

The golden game:

```bash
curl -s "https://yardsperpass.com/game/2026_01_BUF_HOU" -o "<your scratchpad>/buf-hou.html" -w "%{http_code}\n"
```

Expected: `200`. Then check the golden values are in the file (each `grep -c` must print at least 1):

```bash
grep -c "WEEK 1<!-- --> · SUN SEP 13" "<your scratchpad>/buf-hou.html"
```

and likewise for: `>36<` and `>31<` inside the scoreboard, `1-0`, `0-1`, `+0.28`, `(56)`, `+0.07`, `(79)`, `−0.26` (U+2212), `41%`, `48%`, `(TO +2, expl 0)`, `3-9`, `7-16`, `409`, `381`, `7.9`, `5.2`, `323`, `257`, `20/29`, `26/38`, `10.4`, `6.3`, `2-11`, `3-17`, `10-85`, `7-106`, `23:43`, `36:17`, `−7.0`, `−3.3`, `−8.7`, `−8.5`, `−9.7`, `(45)`, `(59)`, `(10)`, `(20)`, `Josh Allen`, `130.5`, `+8.1`, `13.2`, `C.J. Stroud`, `106.7`, `James Cook`, `−0.46`, `David Montgomery`, `Woody Marks`, `+0.73`, `Dalton Kincaid`, `21.4%`, `21.7`, `28 team targets`, `37 team targets`, `Nico Collins`, `27.0%`, `Why the play counts differ`, `A strip-sack counts in both`, `won’t always add up`, `differ from its season figure`, `data-better="away"`, and that `YPRR` does **not** appear (`grep -c YPRR` prints 0). The scoreboard's records read `1-0` / `0-1` even though week 2 has been played: records are counted through the game's week.

The message states and the 404:

```bash
curl -s "https://yardsperpass.com/game/2025_14_PHI_LAC" -o "<your scratchpad>/phi-lac.html" -w "%{http_code}\n"
```

Expected: `200`; the file contains `Box scores start with the 2026 season`, `aren’t available yet`, `WEEK 14<!-- --> · MON DEC 8, 2025`, `PHI`, `LAC`, `href="/team/PHI"`, `href="/team/LAC"`, and `<meta name="robots" content="noindex, follow"`.

```bash
curl -s -o /dev/null -w "%{http_code}\n" "https://yardsperpass.com/game/<the unplayed 2026 game id from Step 1>"
```

Expected: `404`. Also `https://yardsperpass.com/game/not-a-game` → `404`.

The links (the team page is prerendered by the deploy; the player page renders per request):

```bash
curl -s "https://yardsperpass.com/team/BUF" | grep -c 'href="/game/2026_01_BUF_HOU"'
```

Expected: `1` (and `curl -s "https://yardsperpass.com/team/BUF" | grep -o 'data-box-score-link' | wc -l` prints one per played BUF game — the page is a single line of HTML, so `grep -c` would always print 1; it is **2** as of week 2, and grows each week. A BUF game whose stats are pending still links, and its page shows the "Stats arrive" message.)

```bash
curl -s "https://yardsperpass.com/player/josh-allen?tab=game-log" | grep -c 'href="/game/2026_01_BUF_HOU"'
```

Expected: `1`.

```bash
curl -s "https://yardsperpass.com/player/josh-allen?season=2025&tab=game-log" | grep -c 'data-box-score-link'
```

Expected: `0` — nothing links for 2025 until a backfill.

```bash
curl -s "https://yardsperpass.com/sitemap.xml" | grep -c "/game/2026_"
```

Expected: Step 1's `played` count minus its `missing` count — **31** as of week 2, rising by ~16 a week.

The newest week: open the box score of the most recent final on the team page of a team that played last (the highest-week `data-box-score-link` on `/team/<id>`). It must be either a full page or the "Stats arrive once play-by-play is published" message — never an error page or a blank one. If it shows the message for more than ~6 hours after the game, check `gh run list --workflow data-refresh.yml --limit 3` for a failed refresh.

- [ ] **Step 7: Three live box scores against the references (spec §11)**

Compare three pages, reading each value off the live page:

1. `/game/2026_01_BUF_HOU` — the golden values above (rbsdm efficiency rows; ESPN box score rows).
2. `/game/2026_01_NO_DET` — the overtime game: the two Possession values must sum to `68:26`; the scoreboard must show the final (`NO 30, DET 31`) with `WEEK 1`.
3. `/game/2026_01_TB_CIN` — Defensive / special teams TDs must read `1 | 1` (unshaded, equal); Turnovers `4 | 1` with CIN shaded (fewer is better); Toxic differential must reconcile with those turnovers (TB's detail reads `TO −3`, CIN's `TO +3`).

Any mismatch is a bug in this PR or in PR 2's numbers — record it in the program ledger and fix before PR 4 starts.

- [ ] **Step 7b: The revert trigger**

Revert this PR (`gh pr revert` is not a thing — open a revert PR from the merge commit with `git revert -m 1 <merge sha>`, then ship it the same way) if any of these is true after the deploy:

- `/team/<any id>` or `/player/<any slug>` returns a non-200, or renders with its schedule or Game Log missing — the link gate is in the render path of two pages that worked before this PR, and that is the only regression risk this change carries.
- `/game/2026_01_BUF_HOU` returns 500, or renders the scoreboard with an empty body (an empty shell is the one thing spec §6 forbids; a *message* body is fine).
- Step 6's `/game/<unplayed id>` returns 200 instead of 404 — a page for a game that has not happened.
- A number on `/game/2026_01_BUF_HOU` disagrees with rbsdm or ESPN by more than rounding, and the cause is in this PR's display code rather than PR 2's stored values.

Everything else — a pending page that should be ready, a missing sitemap entry, a link that did not appear — waits for the next data refresh or a follow-up commit. Do not revert for those.

- [ ] **Step 8: Hand off**

Report the PR number, the merge commit, the Vercel deployment URL, Step 1's counts, the Step 6 check results (each expected value, found or not) and the Step 7 comparison. PR 4 (`/scores` + the homepage strip) may start once every check passes; it reuses `Scoreboard` / `buildScoreboard`, `recordThroughWeek` and `getBoxScoreSeasons` from this PR.

- [ ] **Step 9: Append PR 3 to the program ledger**

Add one line to `.superpowers/sdd/box-scores-program.md` in the same shape as PR 2's last entry: the date, "PR 3 SHIPPED", the PR number and merge commit, what the live verification found, and "Next: PR 4". `.superpowers/` is git-ignored, so this file is never staged and never committed — just write it.
