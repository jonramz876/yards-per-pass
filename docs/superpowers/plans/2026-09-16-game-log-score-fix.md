# Game Log Score Fix (Box Scores Phase 0) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The player Game Log's Result cell shows each game's official final score, read from the `games` table, instead of the stored weekly-row score that misses late points (31 wrong games in 2025, 28 of them with the wrong W/L/T).

**Architecture:** The player page (server) collects every distinct `team_id` in the player's weekly rows, reads those teams' regular-season results from `games` with a new `getGameResults(teamIds, season)`, and passes a plain nested object `{ [team_id]: { [week]: GameResult } }` through `PlayerPageContent` to `GameLogTab`. Each Game Log row looks itself up by its **own** `team_id` and `week`, trusts the entry only when the opponent matches, and otherwise falls back to the row's stored score (today's behaviour). A failed `games` read also falls back; the player page renders per request, so nothing degraded is cached.

**Tech Stack:** Next.js 14 App Router, TypeScript, Supabase (`@supabase/supabase-js` via `createServerClient`), vitest + @testing-library/react (jsdom).

**Spec:** `docs/superpowers/specs/2026-09-15-box-scores-design.md`, §9 "Phase 0: Game Log score fix". Also read §7's Game Log bullet: PR 3 will turn this Result cell into the box score link, which is why `game_id` travels with each result.

## Global Constraints

- **Read side only.** No writes to Supabase, no changes to `scripts/ingest.py`, no re-ingest. The stored `team_score`/`opponent_score` columns in `qb_weekly_stats`, `receiver_weekly_stats` and `rb_weekly_stats` stay wrong for those 31 games; only the Game Log display changes (spec §9, "Recommended fix").
- **Lookup key is the weekly row's own `(team_id, week)`.** Never `player.current_team_id` and never GameLogTab's `teamId` prop: `components/player/PlayerPageContent.tsx:203` passes the player's *current* team, so keying off it would give A.J. Brown's 2025 Game Log (PHI) New England's games (spec §9).
- **The server read covers every distinct `team_id` present in the weekly rows** (spec §9).
- **Result values are exactly** `{ game_id, team_score, opponent_score, result, opponent_id }` (spec §9).
- **Props crossing server → client must be JSON-serializable:** plain objects only — no `Map`, no `NaN` (`.claude/CLAUDE.md`). Week keys become strings in transit; `obj[5]` and `obj["5"]` are the same lookup in JS.
- **`lib/data/games.ts` imports the server Supabase client.** Never import it from a `"use client"` file (`GameLogTab.tsx`, `PlayerPageContent.tsx`). Client files import only *types* from `@/lib/types`.
- **Numeric guards use `val == null || Number.isNaN(val)`** — an `isNaN`-only guard lets `null` through (`.claude/CLAUDE.md`, the 2026-09-11 F1 crash).
- **Commands:** one per Bash call. Never chain with `&&` or `||`. Agent shells reset the working directory, so every command uses absolute paths. The repo is `C:/Users/jonra/OneDrive/Desktop/claude sandbox/football website/yards-per-pass` (quote it: the path has spaces).
- **Before every commit:** `tsc --noEmit` and `next lint` pass (`.claude/CLAUDE.md`). Every task below ends green.
- **CI does not run vitest.** Run it locally before merging (`memory/MEMORY.md`).
- **Quality gates:** chaos test (Task 4) before code review (Task 5); fix every CRASH/ERROR first (Jon's global CLAUDE.md and `.claude/CLAUDE.md`).
- **Branch** `game-log-score-fix`, one PR to `main`, merged once CI passes (Jon's standing decision: staged PRs).

## File Structure

| File | Change | Responsibility |
|---|---|---|
| `lib/types/index.ts` | Modify (after `TeamGame`, line 346) | `GameResult` and `GameResultsByTeam` types, shared by server and client |
| `lib/data/games.ts` | Modify (add after `getTeamSchedule`, line 92) | `getGameResults()` — the `games` read, reusing the file's `toTeamGame` derivation |
| `__tests__/data/games.test.ts` | Create | Unit tests for `getGameResults` against a fake Supabase client |
| `app/player/[slug]/page.tsx` | Modify (imports; after the try/catch ending line 143; props at 166-178) | Collect team ids, call `getGameResults`, pass results down |
| `components/player/PlayerPageContent.tsx` | Modify (lines 5-16, 26-38, 51-63, 199-204) | Accept `gameResults` and hand it to `GameLogTab` |
| `components/player/GameLogTab.tsx` | Modify (line 6; props 12-17; `resultStr` 36-42; `COMMON_COLS` 48-53; component 223-232) | Result cell reads the schedule result; fallback to stored score |
| `__tests__/app/player-route.test.ts` | Modify | Page passes results for every weekly team; empty and failure paths |
| `__tests__/components/GameLogTab.test.tsx` | Modify | Result-column tests; existing renders pass the new required prop |
| `memory/MEMORY.md`, `.claude/CLAUDE.md` | Modify (Task 6) | Record the new data flow and the still-wrong stored columns |

Out of scope (known follow-ups in `memory/MEMORY.md`, do not fix here): the guessed BYE/DNP rows, and past seasons wearing the player's current team colours.

---

### Task 1: `getGameResults` — read final scores from `games`

**Files:**
- Modify: `lib/types/index.ts` (insert after the `TeamGame` interface, which ends at line 346)
- Modify: `lib/data/games.ts` (type import on line 5; new function after `getTeamSchedule`, which ends at line 92)
- Test: `__tests__/data/games.test.ts` (create)

**Interfaces:**
- Consumes: `toTeamGame(row: GameRow, teamId: string): TeamGame` and `interface GameRow` (both module-private, already in `lib/data/games.ts`); `createServerClient()` from `@/lib/supabase/server`.
- Produces:
  - `interface GameResult { game_id: string; team_score: number; opponent_score: number; result: "W" | "L" | "T"; opponent_id: string }` in `@/lib/types`
  - `type GameResultsByTeam = Record<string, Record<number, GameResult>>` in `@/lib/types`
  - `getGameResults(teamIds: string[], season: number): Promise<GameResultsByTeam>` exported from `@/lib/data/games` — throws `Error("Failed to fetch game results: <message>")` on a query error

- [ ] **Step 1: Create the branch**

Check the spec branch is still based on the latest `main`:

```bash
git -C "C:/Users/jonra/OneDrive/Desktop/claude sandbox/football website/yards-per-pass" fetch origin
```

```bash
git -C "C:/Users/jonra/OneDrive/Desktop/claude sandbox/football website/yards-per-pass" merge-base --is-ancestor origin/main box-scores-spec
```

Expected: exit code 0, no output. If it exits 1, `main` has moved: stop and rebase `box-scores-spec` onto `origin/main` first (it holds only docs commits, so conflicts are unlikely).

```bash
git -C "C:/Users/jonra/OneDrive/Desktop/claude sandbox/football website/yards-per-pass" switch -c game-log-score-fix box-scores-spec
```

The PR will carry the box score spec and this plan along with the fix.

- [ ] **Step 2: Add the types**

In `lib/types/index.ts`, directly after the closing `}` of `export interface TeamGame` (line 346), insert:

```ts

/**
 * One played regular-season game from one team's side, read from the `games`
 * table (box score spec §9). The player Game Log shows these instead of a
 * weekly stat row's stored team_score/opponent_score, which miss any points
 * scored after the game's last run or pass.
 */
export interface GameResult {
  game_id: string;
  team_score: number;
  opponent_score: number;
  result: "W" | "L" | "T";
  opponent_id: string;
}

/**
 * Game results keyed by team, then week: `results["TEN"][5]`. Plain objects
 * (never a Map) so it can cross the server → client boundary; the week keys
 * arrive as strings, which JS object lookup treats the same as numbers.
 */
export type GameResultsByTeam = Record<string, Record<number, GameResult>>;
```

- [ ] **Step 3: Write the failing tests**

Create `__tests__/data/games.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from "vitest";

// Chainable fake Supabase client (same pattern as __tests__/data/card.test.ts):
// records the query chain and resolves a settable result.
const calls: unknown[][] = [];
let result: { data: unknown; error: unknown } = { data: [], error: null };

vi.mock("@/lib/supabase/server", () => {
  const builder: Record<string, unknown> = {};
  for (const m of ["select", "eq", "or", "order"]) {
    builder[m] = (...a: unknown[]) => {
      calls.push([m, ...a]);
      return builder;
    };
  }
  builder.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
    Promise.resolve(result).then(res, rej);
  return {
    createServerClient: () => ({
      from: (t: string) => {
        calls.push(["from", t]);
        return builder;
      },
    }),
  };
});

import { getGameResults } from "@/lib/data/games";

/** A `games` row as PostgREST returns it (defaults: 2025 week 1, BAL 40 @ BUF 41). */
function game(over: Record<string, unknown>) {
  return {
    game_id: "2025_01_BAL_BUF",
    season: 2025,
    game_type: "REG",
    week: 1,
    gameday: "2025-09-07",
    weekday: "Sunday",
    gametime: "20:20",
    home_team: "BUF",
    away_team: "BAL",
    home_score: 41,
    away_score: 40,
    ...over,
  };
}

beforeEach(() => {
  calls.length = 0;
  result = { data: [], error: null };
});

describe("getGameResults", () => {
  it("keys each requested team's result by team, then week, from that team's side", async () => {
    result = { data: [game({})], error: null };
    const out = await getGameResults(["BUF", "BAL"], 2025);
    expect(out.BUF[1]).toEqual({
      game_id: "2025_01_BAL_BUF",
      team_score: 41,
      opponent_score: 40,
      result: "W",
      opponent_id: "BAL",
    });
    expect(out.BAL[1]).toEqual({
      game_id: "2025_01_BAL_BUF",
      team_score: 40,
      opponent_score: 41,
      result: "L",
      opponent_id: "BUF",
    });
  });

  it("leaves out an opponent that wasn't requested", async () => {
    result = { data: [game({})], error: null };
    const out = await getGameResults(["BUF"], 2025);
    expect(Object.keys(out)).toEqual(["BUF"]);
  });

  it("covers every team a traded player played for", async () => {
    // Tyler Lockett, 2025: TEN through week 7, LV from week 9. Both teams played week 5.
    result = {
      data: [
        game({ game_id: "2025_05_TEN_ARI", week: 5, home_team: "ARI", away_team: "TEN", home_score: 21, away_score: 22 }),
        game({ game_id: "2025_05_LV_IND", week: 5, home_team: "IND", away_team: "LV", home_score: 40, away_score: 6 }),
        game({ game_id: "2025_14_DEN_LV", week: 14, home_team: "LV", away_team: "DEN", home_score: 17, away_score: 24 }),
      ],
      error: null,
    };
    const out = await getGameResults(["TEN", "LV"], 2025);
    expect(out.TEN[5]).toMatchObject({ game_id: "2025_05_TEN_ARI", result: "W", team_score: 22, opponent_score: 21 });
    expect(out.LV[5]).toMatchObject({ game_id: "2025_05_LV_IND", result: "L", team_score: 6, opponent_score: 40 });
    expect(out.LV[14]).toMatchObject({ game_id: "2025_14_DEN_LV", result: "L", team_score: 17, opponent_score: 24 });
  });

  it("reads a tie as T", async () => {
    result = {
      data: [game({ game_id: "2025_04_GB_DAL", week: 4, home_team: "DAL", away_team: "GB", home_score: 40, away_score: 40 })],
      error: null,
    };
    const out = await getGameResults(["DAL"], 2025);
    expect(out.DAL[4]).toMatchObject({ result: "T", team_score: 40, opponent_score: 40, opponent_id: "GB" });
  });

  it("skips games without both scores", async () => {
    result = {
      data: [
        game({ home_score: null, away_score: null }),
        game({ game_id: "2025_02_BUF_NYJ", week: 2, home_score: 30, away_score: null }),
      ],
      error: null,
    };
    expect(await getGameResults(["BUF"], 2025)).toEqual({});
  });

  it("skips playoff games (weekly stat rows are regular season only)", async () => {
    result = { data: [game({ game_id: "2025_19_BUF_JAX", game_type: "WC", week: 19 })], error: null };
    expect(await getGameResults(["BUF"], 2025)).toEqual({});
  });

  it("treats a missing game_type as regular season, like getTeamSchedule", async () => {
    result = { data: [game({ game_type: null })], error: null };
    const out = await getGameResults(["BUF"], 2025);
    expect(out.BUF[1]).toMatchObject({ result: "W" });
  });

  it("filters by season and both sides, with ids deduped and reduced to letters and digits", async () => {
    await getGameResults(["BUF", "KC", "BUF", "N.E)"], 2025);
    expect(calls).toContainEqual(["from", "games"]);
    expect(calls).toContainEqual(["eq", "season", 2025]);
    expect(calls).toContainEqual(["or", "home_team.in.(BUF,KC,NE),away_team.in.(BUF,KC,NE)"]);
  });

  it("returns {} without querying when no usable team id is given", async () => {
    expect(await getGameResults([], 2025)).toEqual({});
    expect(await getGameResults(["", "()"], 2025)).toEqual({});
    expect(calls).toHaveLength(0);
  });

  it("throws on a query error so the caller chooses the fallback", async () => {
    result = { data: null, error: { message: "fetch failed" } };
    await expect(getGameResults(["BUF"], 2025)).rejects.toThrow("Failed to fetch game results: fetch failed");
  });
});
```

- [ ] **Step 4: Run the tests to verify they fail**

```bash
node "C:/Users/jonra/OneDrive/Desktop/claude sandbox/football website/yards-per-pass/node_modules/vitest/vitest.mjs" run --root "C:/Users/jonra/OneDrive/Desktop/claude sandbox/football website/yards-per-pass" __tests__/data/games.test.ts
```

Expected: FAIL — `getGameResults` is not exported, so every test fails with a "not a function" TypeError.

- [ ] **Step 5: Implement `getGameResults`**

In `lib/data/games.ts`, change the type import on line 5 from:

```ts
import type { TeamGame } from "@/lib/types";
```

to:

```ts
import type { TeamGame, GameResultsByTeam } from "@/lib/types";
```

Then insert after `getTeamSchedule`'s closing `}` (line 92):

```ts

/**
 * Final scores of the regular-season games a set of teams played in one
 * season, keyed by team then week: `results["TEN"][5]`. Feeds the player Game
 * Log (box score spec §9). `games` holds the official final score; a weekly
 * stat row's own team_score/opponent_score miss any points scored after the
 * game's last run or pass (31 of 2025's 272 games).
 *
 * Pass every team the player's weekly rows name: a traded player's rows span
 * teams, and his current team is not the one he played for. A team plays at
 * most 17 regular-season games, so even a three-team player stays far under
 * Supabase's 1000-row cap — no pagination. Games without both scores are left
 * out. Throws on a query error; the caller picks the fallback.
 */
export async function getGameResults(
  teamIds: string[],
  season: number
): Promise<GameResultsByTeam> {
  // Same sanitising as getTeamSchedule: the ids go into a raw .or() filter.
  const ids = Array.from(
    new Set(
      teamIds
        .map((id) => String(id ?? "").replace(/[^A-Za-z0-9]/g, ""))
        .filter((id) => id.length > 0)
    )
  );
  if (ids.length === 0) return {};

  const supabase = createServerClient();
  const list = ids.join(",");
  const { data, error } = await supabase
    .from("games")
    .select("*")
    .eq("season", season)
    .or(`home_team.in.(${list}),away_team.in.(${list})`);

  if (error) throw new Error(`Failed to fetch game results: ${error.message}`);

  const results: GameResultsByTeam = {};
  for (const row of (data ?? []) as unknown as GameRow[]) {
    for (const teamId of [row.home_team, row.away_team]) {
      if (!ids.includes(teamId)) continue;
      const game = toTeamGame(row, teamId);
      // Weekly stat rows are regular season only; an unscored game has no result.
      if (game.game_type !== "REG" || game.result === null) continue;
      if (!results[teamId]) results[teamId] = {};
      results[teamId][game.week] = {
        game_id: game.game_id,
        team_score: game.team_score as number,
        opponent_score: game.opponent_score as number,
        result: game.result,
        opponent_id: game.opponent_id,
      };
    }
  }
  return results;
}
```

- [ ] **Step 6: Run the tests to verify they pass**

```bash
node "C:/Users/jonra/OneDrive/Desktop/claude sandbox/football website/yards-per-pass/node_modules/vitest/vitest.mjs" run --root "C:/Users/jonra/OneDrive/Desktop/claude sandbox/football website/yards-per-pass" __tests__/data/games.test.ts
```

Expected: PASS, 10 tests.

- [ ] **Step 7: Type check and lint**

```bash
node "C:/Users/jonra/OneDrive/Desktop/claude sandbox/football website/yards-per-pass/node_modules/typescript/bin/tsc" --noEmit -p "C:/Users/jonra/OneDrive/Desktop/claude sandbox/football website/yards-per-pass/tsconfig.json"
```

Expected: no output, exit 0.

```bash
npm --prefix "C:/Users/jonra/OneDrive/Desktop/claude sandbox/football website/yards-per-pass" run lint
```

Expected: `✔ No ESLint warnings or errors`.

- [ ] **Step 8: Commit**

```bash
git -C "C:/Users/jonra/OneDrive/Desktop/claude sandbox/football website/yards-per-pass" add lib/types/index.ts lib/data/games.ts __tests__/data/games.test.ts
```

```bash
git -C "C:/Users/jonra/OneDrive/Desktop/claude sandbox/football website/yards-per-pass" commit -m "feat: read regular-season final scores from games by team and week" -m "getGameResults(teamIds, season) returns { [team_id]: { [week]: GameResult } } for the player Game Log (box score spec section 9). Reuses toTeamGame, skips playoff and unscored games, throws on a query error." -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: Player page fetches results for every weekly team and hands them to the Game Log

**Files:**
- Modify: `app/player/[slug]/page.tsx` (imports lines 6-7; new block after the try/catch that ends at line 143; `PlayerPageContent` props at lines 166-178)
- Modify: `components/player/PlayerPageContent.tsx` (type import lines 5-16; props lines 26-38; destructuring lines 51-63; `GameLogTab` at lines 199-204)
- Modify: `components/player/GameLogTab.tsx` (type import line 6; props interface lines 12-17 only — the component starts *using* the prop in Task 3)
- Test: `__tests__/app/player-route.test.ts`; `__tests__/components/GameLogTab.test.tsx` (existing renders pass the new prop)

**Interfaces:**
- Consumes: `getGameResults(teamIds: string[], season: number): Promise<GameResultsByTeam>` and the `GameResultsByTeam` type (Task 1).
- Produces: `PlayerPageContent` and `GameLogTab` each gain a **required** prop `gameResults: GameResultsByTeam`. Required on purpose: `tsc` then refuses any render that forgets to pass it (the repo's slug bug was a function never wired into its caller). Task 3 consumes it inside `GameLogTab`.

- [ ] **Step 1: Write the failing page tests**

In `__tests__/app/player-route.test.ts`:

(a) Replace the `PlayerPageContent` mock (lines 38-40):

```ts
vi.mock("@/components/player/PlayerPageContent", () => ({
  default: () => null,
}));
```

with:

```ts
vi.mock("@/components/player/PlayerPageContent", () => ({
  default: vi.fn(() => null),
}));

vi.mock("@/lib/data/games", () => ({
  getGameResults: vi.fn(async () => ({})),
}));
```

(b) Replace the imports at lines 46-47:

```ts
import PlayerPage, { generateMetadata } from "@/app/player/[slug]/page";
import { getPlayerBySlug } from "@/lib/data/players";
```

with:

```ts
import { render } from "@testing-library/react";
import PlayerPage, { generateMetadata } from "@/app/player/[slug]/page";
import PlayerPageContent from "@/components/player/PlayerPageContent";
import { getPlayerBySlug, getReceiverWeeklyStats } from "@/lib/data/players";
import { getGameResults } from "@/lib/data/games";
import type { ReceiverWeeklyStat } from "@/lib/types";
```

(c) Append at the end of the file:

```ts

describe("PlayerPage — Game Log results (box score spec §9)", () => {
  // Tyler Lockett: current team LV, but his 2025 rows are TEN then LV.
  const lockett = {
    player_id: "00-0032211",
    slug: "tyler-lockett",
    player_name: "Tyler Lockett",
    position: "WR",
    current_team_id: "LV",
    headshot_url: null,
    jersey_number: null,
  };
  const row = (week: number, team_id: string) =>
    ({ player_id: "00-0032211", season: 2025, week, team_id }) as unknown as ReceiverWeeklyStat;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getPlayerBySlug).mockResolvedValue(lockett);
    vi.mocked(getReceiverWeeklyStats).mockResolvedValue([]);
    vi.mocked(getGameResults).mockReset();
    vi.mocked(getGameResults).mockResolvedValue({});
  });

  /** Render the page and return the props PlayerPageContent received. */
  async function contentProps() {
    render(
      await PlayerPage({
        params: Promise.resolve({ slug: "tyler-lockett" }),
        searchParams: Promise.resolve({ season: "2025", tab: "game-log" }),
      }),
    );
    const calls = vi.mocked(PlayerPageContent).mock.calls;
    return calls[calls.length - 1][0];
  }

  it("fetches results for every team in the weekly rows, not the current team", async () => {
    vi.mocked(getReceiverWeeklyStats).mockResolvedValue([row(5, "TEN"), row(7, "TEN"), row(14, "LV")]);
    const results = {
      TEN: { 5: { game_id: "2025_05_TEN_ARI", team_score: 22, opponent_score: 21, result: "W" as const, opponent_id: "ARI" } },
    };
    vi.mocked(getGameResults).mockResolvedValue(results);

    const props = await contentProps();

    expect(getGameResults).toHaveBeenCalledTimes(1);
    const [ids, season] = vi.mocked(getGameResults).mock.calls[0];
    expect([...ids].sort()).toEqual(["LV", "TEN"]);
    expect(season).toBe(2025);
    expect(props.gameResults).toEqual(results);
  });

  it("skips the read when the player has no weekly rows", async () => {
    const props = await contentProps();
    expect(getGameResults).not.toHaveBeenCalled();
    expect(props.gameResults).toEqual({});
  });

  it("still renders when the games read fails; the Game Log keeps stored scores", async () => {
    vi.mocked(getReceiverWeeklyStats).mockResolvedValue([row(5, "TEN")]);
    vi.mocked(getGameResults).mockRejectedValue(new Error("Failed to fetch game results: fetch failed"));
    const props = await contentProps();
    expect(props.gameResults).toEqual({});
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
node "C:/Users/jonra/OneDrive/Desktop/claude sandbox/football website/yards-per-pass/node_modules/vitest/vitest.mjs" run --root "C:/Users/jonra/OneDrive/Desktop/claude sandbox/football website/yards-per-pass" __tests__/app/player-route.test.ts
```

Expected: FAIL — "fetches results for every team" (`getGameResults` called 0 times) and the other two new tests (`props.gameResults` is `undefined`). The 6 existing tests pass.

- [ ] **Step 3: Implement the page**

In `app/player/[slug]/page.tsx`:

(a) Replace lines 6-7:

```ts
import type { QBPassLocationStat } from "@/lib/types";
import { getQBStats, getAvailableSeasons, fallbackSeason } from "@/lib/data/queries";
```

with:

```ts
import type { GameResultsByTeam, QBPassLocationStat } from "@/lib/types";
import { getQBStats, getAvailableSeasons, fallbackSeason } from "@/lib/data/queries";
import { getGameResults } from "@/lib/data/games";
```

(b) Directly after the try/catch that ends with:

```ts
  } catch {
    // Data fetch failed — page will render with empty data
  }
```

insert:

```ts

  // Game Log scores come from `games` (box score spec §9). Look up every team
  // the weekly rows name: a traded player's rows span teams, and
  // player.current_team_id is not the team he played for in past seasons.
  // If this read fails the Game Log falls back to each row's stored score, as
  // before; player pages render per request, so nothing degraded is cached.
  let gameResults: GameResultsByTeam = {};
  const weeklyTeamIds = Array.from(
    new Set(
      (weeklyStats as { team_id?: unknown }[])
        .map((row) => row?.team_id)
        .filter((id): id is string => typeof id === "string" && id.length > 0)
    )
  );
  if (weeklyTeamIds.length > 0) {
    gameResults = await getGameResults(weeklyTeamIds, currentSeason).catch(
      (): GameResultsByTeam => ({})
    );
  }
```

(c) In the `<PlayerPageContent ... />` props, after `passLocationStats={passLocationStats}` add:

```tsx
          gameResults={gameResults}
```

- [ ] **Step 4: Pass it through `PlayerPageContent`**

In `components/player/PlayerPageContent.tsx`:

(a) Replace the type import block (lines 5-16) with:

```ts
import type {
  PlayerSlug,
  QBSeasonStat,
  ReceiverSeasonStat,
  RBSeasonStat,
  QBWeeklyStat,
  ReceiverWeeklyStat,
  RBWeeklyStat,
  CrossLinkReceiver,
  CrossLinkQB,
  QBPassLocationStat,
  GameResultsByTeam,
} from "@/lib/types";
```

(b) In `interface PlayerPageContentProps`, after `passLocationStats?: QBPassLocationStat[];` add:

```ts
  /** Official final scores for the Game Log, keyed by team then week. */
  gameResults: GameResultsByTeam;
```

(c) In the function's destructuring, after `passLocationStats = [],` add:

```ts
  gameResults,
```

(d) In `renderGameLog()`, change:

```tsx
      <GameLogTab
        weeklyStats={typedWeekly}
        position={position}
        season={season}
        teamId={player.current_team_id}
      />
```

to:

```tsx
      <GameLogTab
        weeklyStats={typedWeekly}
        position={position}
        season={season}
        teamId={player.current_team_id}
        gameResults={gameResults}
      />
```

- [ ] **Step 5: Declare the prop on `GameLogTab`**

In `components/player/GameLogTab.tsx`:

(a) Line 6, change:

```ts
import type { QBWeeklyStat, ReceiverWeeklyStat, RBWeeklyStat } from "@/lib/types";
```

to:

```ts
import type { GameResultsByTeam, QBWeeklyStat, ReceiverWeeklyStat, RBWeeklyStat } from "@/lib/types";
```

(b) Replace the props interface (lines 12-17):

```ts
interface GameLogTabProps {
  weeklyStats: WeeklyRow[];
  position: string;
  season: number;
  teamId: string;
}
```

with:

```ts
interface GameLogTabProps {
  weeklyStats: WeeklyRow[];
  position: string;
  season: number;
  /**
   * The player's CURRENT team — only the sparkline colour. Never use it to
   * look up games: a traded player's rows belong to other teams.
   */
  teamId: string;
  /** Official final scores from `games`, keyed by team then week (getGameResults). */
  gameResults: GameResultsByTeam;
}
```

Do not destructure `gameResults` in the component yet; Task 3 does that together with the code that uses it.

- [ ] **Step 6: Pass the prop in the existing GameLogTab tests**

In `__tests__/components/GameLogTab.test.tsx`, add `gameResults={{}}` to the three renders. Line 33 becomes:

```tsx
      <GameLogTab weeklyStats={[{ ...base, ...noRoutes }]} position="WR" season={2026} teamId="SEA" gameResults={{}} />
```

Line 42 becomes:

```tsx
      <GameLogTab weeklyStats={[base]} position="WR" season={2026} teamId="SEA" gameResults={{}} />
```

Line 53 becomes:

```tsx
      <GameLogTab weeklyStats={rows} position="WR" season={2026} teamId="SEA" gameResults={{}} />
```

- [ ] **Step 7: Run the tests to verify they pass**

```bash
node "C:/Users/jonra/OneDrive/Desktop/claude sandbox/football website/yards-per-pass/node_modules/vitest/vitest.mjs" run --root "C:/Users/jonra/OneDrive/Desktop/claude sandbox/football website/yards-per-pass" __tests__/app/player-route.test.ts
```

Expected: PASS, 9 tests.

```bash
node "C:/Users/jonra/OneDrive/Desktop/claude sandbox/football website/yards-per-pass/node_modules/vitest/vitest.mjs" run --root "C:/Users/jonra/OneDrive/Desktop/claude sandbox/football website/yards-per-pass" __tests__/components/GameLogTab.test.tsx
```

Expected: PASS, 3 tests (behaviour unchanged so far).

- [ ] **Step 8: Type check and lint**

```bash
node "C:/Users/jonra/OneDrive/Desktop/claude sandbox/football website/yards-per-pass/node_modules/typescript/bin/tsc" --noEmit -p "C:/Users/jonra/OneDrive/Desktop/claude sandbox/football website/yards-per-pass/tsconfig.json"
```

Expected: no output, exit 0.

```bash
npm --prefix "C:/Users/jonra/OneDrive/Desktop/claude sandbox/football website/yards-per-pass" run lint
```

Expected: `✔ No ESLint warnings or errors`.

- [ ] **Step 9: Commit**

```bash
git -C "C:/Users/jonra/OneDrive/Desktop/claude sandbox/football website/yards-per-pass" add "app/player/[slug]/page.tsx" components/player/PlayerPageContent.tsx components/player/GameLogTab.tsx __tests__/app/player-route.test.ts __tests__/components/GameLogTab.test.tsx
```

```bash
git -C "C:/Users/jonra/OneDrive/Desktop/claude sandbox/football website/yards-per-pass" commit -m "feat: player page passes official game results down to the Game Log" -m "Reads games for every distinct team_id in the weekly rows (never current_team_id) and hands the results through PlayerPageContent to GameLogTab as a required prop. A failed read yields {} so the Game Log keeps its stored scores; the page renders per request, so nothing degraded is cached." -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: Game Log Result cell uses the schedule's final score

**Files:**
- Modify: `components/player/GameLogTab.tsx` (type import line 6; `resultStr` lines 36-42; `COMMON_COLS` lines 48-53; component signature and `allCols`, lines 223-232)
- Test: `__tests__/components/GameLogTab.test.tsx`

**Interfaces:**
- Consumes: `GameResult`, `GameResultsByTeam` types (Task 1); the `gameResults` prop declared in Task 2. Type-only imports — never import `@/lib/data/games` in this client file.
- Produces: module-private `scheduleResult(row, gameResults): GameResult | undefined`, `resultStr(row, gameResults): string`, `commonCols(gameResults): ColDef[]`. Box scores PR 3 reuses `scheduleResult` to link the cell to `/game/{game_id}`.

- [ ] **Step 1: Write the failing tests**

In `__tests__/components/GameLogTab.test.tsx`:

(a) Change the type import on line 4 from:

```ts
import type { ReceiverWeeklyStat } from "@/lib/types";
```

to:

```ts
import type { GameResultsByTeam, ReceiverWeeklyStat } from "@/lib/types";
```

(b) Append at the end of the file:

```tsx

/** Text of the Result cell in the row for `week` (BYE/DNP rows have only 2 cells). */
function resultFor(container: HTMLElement, week: number): string | null {
  const headers = Array.from(container.querySelectorAll("thead th"));
  const col = headers.findIndex((th) => (th.textContent ?? "").startsWith("Result"));
  const row = Array.from(container.querySelectorAll("tbody tr")).find(
    (tr) => tr.querySelectorAll("td").length > 2 && tr.querySelector("td")?.textContent === String(week)
  );
  return row ? row.querySelectorAll("td")[col].textContent : null;
}

describe("GameLogTab — Result comes from the schedule (box score spec §9)", () => {
  // Tyler Lockett, 2025: TEN through week 7, LV from week 9. His player page's
  // teamId prop is LV, his current team. Stored scores are the live DB values.
  const lockettWk5: ReceiverWeeklyStat = {
    ...base, player_id: "00-0032211", season: 2025, week: 5, team_id: "TEN", opponent_id: "ARI",
    home_away: "away", result: "L", team_score: 19, opponent_score: 21,
  };
  const lockettWk14: ReceiverWeeklyStat = {
    ...lockettWk5, week: 14, team_id: "LV", opponent_id: "DEN", home_away: "home", team_score: 14, opponent_score: 24,
  };
  const schedule: GameResultsByTeam = {
    TEN: { 5: { game_id: "2025_05_TEN_ARI", team_score: 22, opponent_score: 21, result: "W", opponent_id: "ARI" } },
    LV: {
      5: { game_id: "2025_05_LV_IND", team_score: 6, opponent_score: 40, result: "L", opponent_id: "IND" },
      14: { game_id: "2025_14_DEN_LV", team_score: 17, opponent_score: 24, result: "L", opponent_id: "DEN" },
    },
  };

  it("shows the schedule's final score, not the stored one", () => {
    const { container } = render(
      <GameLogTab weeklyStats={[lockettWk5]} position="WR" season={2025} teamId="TEN" gameResults={schedule} />
    );
    expect(resultFor(container, 5)).toBe("W 22-21");
  });

  it("looks each row up by its own team, never the player's current team", () => {
    const { container } = render(
      <GameLogTab weeklyStats={[lockettWk5, lockettWk14]} position="WR" season={2025} teamId="LV" gameResults={schedule} />
    );
    expect(resultFor(container, 5)).toBe("W 22-21"); // TEN's week 5 — not LV's "L 6-40"
    expect(resultFor(container, 14)).toBe("L 17-24");
  });

  it("works after the results cross the server → client boundary (week keys become strings)", () => {
    const serialized = JSON.parse(JSON.stringify(schedule)) as GameResultsByTeam;
    const { container } = render(
      <GameLogTab weeklyStats={[lockettWk5]} position="WR" season={2025} teamId="LV" gameResults={serialized} />
    );
    expect(resultFor(container, 5)).toBe("W 22-21");
  });

  it("shows a tie from the schedule as T", () => {
    // Values from Dak Prescott's 2025 week 4 row: stored 40-37, final 40-40.
    const dal: ReceiverWeeklyStat = { ...base, season: 2025, week: 4, team_id: "DAL", opponent_id: "GB", team_score: 40, opponent_score: 37 };
    const tie: GameResultsByTeam = {
      DAL: { 4: { game_id: "2025_04_GB_DAL", team_score: 40, opponent_score: 40, result: "T", opponent_id: "GB" } },
    };
    const { container } = render(
      <GameLogTab weeklyStats={[dal]} position="WR" season={2025} teamId="DAL" gameResults={tie} />
    );
    expect(resultFor(container, 4)).toBe("T 40-40");
  });

  it("falls back to the stored score when the schedule has no game for the row", () => {
    const { container } = render(
      <GameLogTab weeklyStats={[base]} position="WR" season={2026} teamId="SEA" gameResults={{}} />
    );
    expect(resultFor(container, 1)).toBe("W 27-20");
  });

  it("ignores a schedule entry whose opponent doesn't match the row", () => {
    const otherGame: GameResultsByTeam = {
      SEA: { 1: { game_id: "2025_01_SF_SEA", team_score: 13, opponent_score: 17, result: "L", opponent_id: "SF" } },
    };
    const { container } = render(
      <GameLogTab weeklyStats={[base]} position="WR" season={2026} teamId="SEA" gameResults={otherGame} />
    );
    expect(resultFor(container, 1)).toBe("W 27-20");
  });

  it("shows a dash when there is no schedule game and the stored score isn't a number", () => {
    const blank: ReceiverWeeklyStat = { ...base, team_score: NaN, opponent_score: NaN };
    const { container } = render(
      <GameLogTab weeklyStats={[blank]} position="WR" season={2026} teamId="SEA" gameResults={{}} />
    );
    expect(resultFor(container, 1)).toBe("—");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
node "C:/Users/jonra/OneDrive/Desktop/claude sandbox/football website/yards-per-pass/node_modules/vitest/vitest.mjs" run --root "C:/Users/jonra/OneDrive/Desktop/claude sandbox/football website/yards-per-pass" __tests__/components/GameLogTab.test.tsx
```

Expected: 5 FAIL — "shows the schedule's final score", "looks each row up by its own team" and "works after the results cross" each get `L 19-21`; "shows a tie" gets `W 40-37`; "shows a dash" gets `T NaN-NaN`. 5 PASS — the 3 Routes tests and the two fallback tests, which already show stored scores.

- [ ] **Step 3: Implement**

In `components/player/GameLogTab.tsx`:

(a) Line 6, change:

```ts
import type { GameResultsByTeam, QBWeeklyStat, ReceiverWeeklyStat, RBWeeklyStat } from "@/lib/types";
```

to:

```ts
import type { GameResult, GameResultsByTeam, QBWeeklyStat, ReceiverWeeklyStat, RBWeeklyStat } from "@/lib/types";
```

(b) Replace `resultStr`:

```ts
function resultStr(row: WeeklyRow): string {
  const ts = row.team_score;
  const os = row.opponent_score;
  if (ts == null || os == null) return "\u2014";
  const w = ts > os ? "W" : ts < os ? "L" : "T";
  return `${w} ${ts}-${os}`;
}
```

with:

```ts
/**
 * The schedule's result for this row's game. Looked up by the row's OWN team
 * and week (box score spec §9) and trusted only when the opponent matches, so
 * a row can never borrow another game's score.
 */
function scheduleResult(row: WeeklyRow, gameResults: GameResultsByTeam): GameResult | undefined {
  const game = gameResults?.[row.team_id]?.[row.week];
  return game && game.opponent_id === row.opponent_id ? game : undefined;
}

/**
 * "W 41-40" from the `games` table's final score. Falls back to the weekly
 * row's stored score — which can miss points scored after the last run or
 * pass — only when the schedule has no matching game (e.g. its read failed).
 */
function resultStr(row: WeeklyRow, gameResults: GameResultsByTeam): string {
  const game = scheduleResult(row, gameResults);
  if (game) return `${game.result} ${game.team_score}-${game.opponent_score}`;
  const ts = row.team_score;
  const os = row.opponent_score;
  if (ts == null || os == null || Number.isNaN(ts) || Number.isNaN(os)) return "\u2014";
  const w = ts > os ? "W" : ts < os ? "L" : "T";
  return `${w} ${ts}-${os}`;
}
```

(c) Replace `COMMON_COLS`:

```ts
const COMMON_COLS: ColDef[] = [
  { key: "week", label: "Wk", numeric: true, sortable: true, getValue: (r) => r.week },
  { key: "opponent", label: "Opp", getValue: (r) => r.opponent_id, sortable: true },
  { key: "home_away", label: "H/A", getValue: (r) => homeAway(r) },
  { key: "result", label: "Result", getValue: (r) => resultStr(r) },
];
```

with:

```ts
function commonCols(gameResults: GameResultsByTeam): ColDef[] {
  return [
    { key: "week", label: "Wk", numeric: true, sortable: true, getValue: (r) => r.week },
    { key: "opponent", label: "Opp", getValue: (r) => r.opponent_id, sortable: true },
    { key: "home_away", label: "H/A", getValue: (r) => homeAway(r) },
    { key: "result", label: "Result", getValue: (r) => resultStr(r, gameResults) },
  ];
}
```

(d) In the component, change the signature:

```ts
export default function GameLogTab({ weeklyStats, position, season, teamId }: GameLogTabProps) {
```

to:

```ts
export default function GameLogTab({ weeklyStats, position, season, teamId, gameResults }: GameLogTabProps) {
```

and `allCols`:

```ts
  const allCols = useMemo(() => [...COMMON_COLS, ...posCols], [posCols]);
```

to:

```ts
  const allCols = useMemo(() => [...commonCols(gameResults), ...posCols], [gameResults, posCols]);
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
node "C:/Users/jonra/OneDrive/Desktop/claude sandbox/football website/yards-per-pass/node_modules/vitest/vitest.mjs" run --root "C:/Users/jonra/OneDrive/Desktop/claude sandbox/football website/yards-per-pass" __tests__/components/GameLogTab.test.tsx
```

Expected: PASS, 10 tests.

- [ ] **Step 5: Full local verification**

These four commands are the release check; Tasks 4 and 5 re-run them after any fix.

```bash
node "C:/Users/jonra/OneDrive/Desktop/claude sandbox/football website/yards-per-pass/node_modules/typescript/bin/tsc" --noEmit -p "C:/Users/jonra/OneDrive/Desktop/claude sandbox/football website/yards-per-pass/tsconfig.json"
```

Expected: no output, exit 0.

```bash
npm --prefix "C:/Users/jonra/OneDrive/Desktop/claude sandbox/football website/yards-per-pass" run lint
```

Expected: `✔ No ESLint warnings or errors`.

```bash
node "C:/Users/jonra/OneDrive/Desktop/claude sandbox/football website/yards-per-pass/node_modules/vitest/vitest.mjs" run --root "C:/Users/jonra/OneDrive/Desktop/claude sandbox/football website/yards-per-pass"
```

Expected: 0 failures; one more test file than on `main` (`__tests__/data/games.test.ts`) and 20 more tests (10 + 3 + 7).

```bash
NEXT_PUBLIC_SUPABASE_URL=https://placeholder.supabase.co NEXT_PUBLIC_SUPABASE_ANON_KEY=placeholder-key-for-build-only npm --prefix "C:/Users/jonra/OneDrive/Desktop/claude sandbox/football website/yards-per-pass" run build
```

Expected: `✓ Compiled successfully`, with `/player/[slug]` listed as `ƒ` (dynamic). If it fails with `EINVAL: invalid argument, readlink` under `.next`, OneDrive has locked the build folder. Deleting it is blocked, so move it aside and build again:

```bash
mv "C:/Users/jonra/OneDrive/Desktop/claude sandbox/football website/yards-per-pass/.next/server" "C:/Users/jonra/OneDrive/Desktop/claude sandbox/football website/yards-per-pass/.next/cache/onedrive-locked-2"
```

(Use a suffix that doesn't exist yet: `onedrive-locked-*` folders from earlier sessions are already there.)

- [ ] **Step 6: Commit**

```bash
git -C "C:/Users/jonra/OneDrive/Desktop/claude sandbox/football website/yards-per-pass" add components/player/GameLogTab.tsx __tests__/components/GameLogTab.test.tsx
```

```bash
git -C "C:/Users/jonra/OneDrive/Desktop/claude sandbox/football website/yards-per-pass" commit -m "fix: Game Log result shows the schedule's final score" -m "Each row looks up its own team and week, trusts the entry only when the opponent matches, and otherwise falls back to the stored score. A non-numeric stored score now shows a dash instead of T NaN-NaN." -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: Chaos test

**Files:** none committed by the chaos agent (it works in throwaway test files it deletes). Fixes land in the files from Tasks 1-3, each with a regression test in the matching test file.

**Interfaces:** Consumes the finished Tasks 1-3.

- [ ] **Step 1: Dispatch the chaos agent**

Use the Agent tool (`general-purpose`) with this prompt:

```text
You are a chaos tester for the Yards Per Pass repo at
C:/Users/jonra/OneDrive/Desktop/claude sandbox/football website/yards-per-pass
(branch game-log-score-fix). Try to BREAK the Game Log score fix. Do not modify
source files. Write throwaway vitest files under __tests__/chaos/ (delete them when
done) and run them with:
node "C:/Users/jonra/OneDrive/Desktop/claude sandbox/football website/yards-per-pass/node_modules/vitest/vitest.mjs" run --root "C:/Users/jonra/OneDrive/Desktop/claude sandbox/football website/yards-per-pass" __tests__/chaos
Run every command separately (never chain with && or ||). Never write to Supabase.

What changed (read these first):
- lib/data/games.ts: getGameResults(teamIds, season) -> { [team_id]: { [week]: GameResult } }
- components/player/GameLogTab.tsx: scheduleResult / resultStr / commonCols; new required prop gameResults
- app/player/[slug]/page.tsx: collects distinct weekly team_ids, calls getGameResults, catches failures into {}
- components/player/PlayerPageContent.tsx: passes gameResults to GameLogTab
Mock Supabase the way __tests__/data/games.test.ts does; render components the way
__tests__/components/GameLogTab.test.tsx does; call the page the way
__tests__/app/player-route.test.ts does.

Cases (add any others you think of):
1. getGameResults: teamIds containing null, undefined, "", "()", lowercase "buf", 40 ids,
   duplicates; rows with null week, null game_type, string scores ("41"), NaN scores,
   negative scores, home_team === away_team, data: null with no error, 1500 rows.
2. GameLogTab: gameResults undefined/null at runtime; results after
   JSON.parse(JSON.stringify(...)); an entry with null/NaN scores or result "X";
   row.team_id null/""; row.week NaN or 0; two rows with the same week (different teams);
   1000+ weekly rows (check render time); scores 0-0; opponent mismatch; special
   characters in ids ("D'A", "St. Brown").
3. Traded players: rows from 3 teams where every team played the same week number;
   teamId prop set to a 4th team; confirm each row shows its own team's game.
4. Page: weekly rows missing team_id; getGameResults rejecting with a non-Error object
   ({ message, details, hint, code }); getGameResults throwing synchronously; position
   "K" (no weekly fetch); weekly fetch rejecting; season param "abc".
5. A player with no rows for the selected season, and a rookie with 1 game.

For each case report exactly one of CRASH (throws / page fails to render), ERROR (wrong
output a visitor would see), DEGRADED (acceptable fallback, e.g. stored score shown),
PASS — with the input, what happened, and file:line of the cause. End with the list of
CRASH and ERROR findings only. Delete __tests__/chaos/ before finishing and confirm
`git status` shows no untracked chaos files.
```

- [ ] **Step 2: Fix every CRASH and ERROR**

For each CRASH/ERROR finding: add a failing regression test to the matching file (`__tests__/data/games.test.ts`, `__tests__/components/GameLogTab.test.tsx` or `__tests__/app/player-route.test.ts`), run that file to see it fail, make the smallest fix, run it again to see it pass. DEGRADED findings that match the plan's fallback (stored score shown when the schedule has no matching game) need no change.

- [ ] **Step 3: Re-verify and commit the fixes (skip if there were none)**

Run the four Task 3 Step 5 commands again (tsc, lint, vitest, build); all must pass. Stage only the files you changed, by name, for example:

```bash
git -C "C:/Users/jonra/OneDrive/Desktop/claude sandbox/football website/yards-per-pass" add lib/data/games.ts __tests__/data/games.test.ts
```

```bash
git -C "C:/Users/jonra/OneDrive/Desktop/claude sandbox/football website/yards-per-pass" commit -m "fix: harden Game Log results against chaos-test findings" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: Code review

**Files:** whatever the accepted findings touch, with tests.

**Interfaces:** Consumes the branch after Task 4.

This is a bug fix, so it follows the week-1 audit process in `memory/MEMORY.md` (code review), not the 47-team `/review-feature` roster.

- [ ] **Step 1: Request the review**

Use the superpowers:requesting-code-review skill with base `origin/main` and head `game-log-score-fix`. Give the reviewer spec §9 and this plan's Global Constraints as the requirements, and ask it to check specifically: no client file imports `lib/data/games.ts`; no lookup uses `current_team_id` or the `teamId` prop; props stay serializable; the fallback can never show another game's score.

- [ ] **Step 2: Address the findings**

Use superpowers:receiving-code-review. Fix Critical and Important findings with a failing test first; for anything you decline, record why in the PR description.

- [ ] **Step 3: Re-verify and commit (skip if nothing changed)**

Run the four Task 3 Step 5 commands again; all must pass. Stage only the files you changed, by name, then:

```bash
git -C "C:/Users/jonra/OneDrive/Desktop/claude sandbox/football website/yards-per-pass" commit -m "fix: address code review on the Game Log score fix" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: Record it in memory and project docs

**Files:**
- Modify: `memory/MEMORY.md` (new section after "Homepage resilience (2026-09-14)", which ends at line 61)
- Modify: `.claude/CLAUDE.md` (line 33, the "Data fetching" list)

- [ ] **Step 1: Update `memory/MEMORY.md`**

Insert after line 61 (the `- Tests: __tests__/app/home-page.test.tsx ...` bullet):

```markdown

## Game Log scores (box scores Phase 0)

- **The Game Log's Result cell reads the official final score from `games`**, not the weekly rows' stored `team_score`/`opponent_score`. Those stored columns come from `_derive_game_context` over *filtered* plays, which misses points scored after the last run or pass: **31 of 2025's 272 games are stored with the wrong score (28 with the wrong W/L/T)** — e.g. Josh Allen's 2025 week 1 is stored L 38-40, really W 41-40. The columns were NOT rewritten (no production write); anything else that reads them gets the wrong score. The backfill is the natural time to fix the stored values.
- Flow: `app/player/[slug]/page.tsx` collects every distinct `team_id` in the weekly rows → `getGameResults(teamIds, season)` (`lib/data/games.ts`) → `{ [team_id]: { [week]: GameResult } }` → `PlayerPageContent` → `GameLogTab`. **Rows look themselves up by their own `team_id` + `week`, never `player.current_team_id`** (a traded player's rows span teams), and trust the entry only when the opponent matches.
- Fallback: no matching schedule game, or the `games` read failed → the row's stored score, exactly as before. Player pages render per request, so nothing degraded is cached.
- `GameResult.game_id` is there for box scores PR 3, which turns this Result cell into the box score link.
- Tests: `__tests__/data/games.test.ts`, `__tests__/components/GameLogTab.test.tsx`, `__tests__/app/player-route.test.ts`.
```

- [ ] **Step 2: Update `.claude/CLAUDE.md`**

Change line 33 from:

```markdown
- Data fetching: `lib/data/queries.ts`, `lib/data/receivers.ts`, `lib/data/rushing.ts`, `lib/data/players.ts`, `lib/data/team-hub.ts`, `lib/data/run-gaps.ts`
```

to:

```markdown
- Data fetching: `lib/data/queries.ts`, `lib/data/receivers.ts`, `lib/data/rushing.ts`, `lib/data/players.ts`, `lib/data/team-hub.ts`, `lib/data/run-gaps.ts`, `lib/data/games.ts` (schedule + official final scores — server-only, never import it from a `"use client"` file)
```

- [ ] **Step 3: Commit**

```bash
git -C "C:/Users/jonra/OneDrive/Desktop/claude sandbox/football website/yards-per-pass" add memory/MEMORY.md .claude/CLAUDE.md
```

```bash
git -C "C:/Users/jonra/OneDrive/Desktop/claude sandbox/football website/yards-per-pass" commit -m "docs: record the Game Log score source and the still-wrong stored columns" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 7: Ship and verify live

**Files:** none.

- [ ] **Step 1: Confirm the "before" values on the live site**

Open each URL on https://yardsperpass.com and confirm the Before column. These are the live database values on 2026-09-16; if any differs, stop and find out why before merging.

| Page | Row | Before | After (must match) |
|---|---|---|---|
| `/player/josh-allen?season=2025&tab=game-log` | Wk 1, vs BAL | L 38-40 | **W 41-40** |
| `/player/dak-prescott?season=2025&tab=game-log` | Wk 4, vs GB | W 40-37 | **T 40-40** |
| `/player/tyler-lockett?season=2025&tab=game-log` | Wk 5, @ ARI (TEN) | L 19-21 | **W 22-21** |
| `/player/tyler-lockett?season=2025&tab=game-log` | Wk 14, vs DEN (LV) | L 14-24 | **L 17-24** |
| `/player/aj-brown?season=2025&tab=game-log` | Wk 12, @ DAL | T 21-21 | **L 21-24** (not NE's W 26-20) |
| `/player/josh-allen?tab=game-log` | Wk 1, @ HOU (2026) | W 36-31 | **W 36-31** (unchanged) |

- [ ] **Step 2: Push and open the PR**

```bash
git -C "C:/Users/jonra/OneDrive/Desktop/claude sandbox/football website/yards-per-pass" push -u origin game-log-score-fix
```

Write the PR description to a file named `pr-body.md` in the session scratchpad directory. It must contain: the problem (31 wrong 2025 games, 28 wrong W/L/T, stored columns untouched), the approach (read `games` by each row's own team and week), the Step 1 table, the local results (tsc, lint, vitest counts, build), the chaos and review outcomes with anything declined, a note that the box score spec and this plan ride along, and it must end with:

```text
🤖 Generated with [Claude Code](https://claude.com/claude-code)
```

Then, with that file's absolute path:

```bash
gh pr create --repo jonramz876/yards-per-pass --base main --head game-log-score-fix --title "fix: Game Log shows the official final score (box scores phase 0)" --body-file "<absolute path to pr-body.md>"
```

- [ ] **Step 3: Wait for CI**

`gh pr checks --watch` has exited early on this repo while jobs were still pending, so poll instead. Use the Monitor tool with an until-loop over:

```bash
gh pr checks game-log-score-fix --repo jonramz876/yards-per-pass --json name,bucket
```

Done when no check has `"bucket":"pending"`. Expected: `lint-and-build` and `test-python` both `pass`. On a failure, read the log with `gh run view <run id from the checks output> --repo jonramz876/yards-per-pass --log-failed`, fix it with a test, re-run the Task 3 Step 5 commands, push, and poll again.

- [ ] **Step 4: Merge**

```bash
gh pr merge game-log-score-fix --repo jonramz876/yards-per-pass --merge
```

- [ ] **Step 5: Verify live**

Wait for the Vercel production deploy of the merge commit to finish (the commit's status check on GitHub turns green). Player pages render per request, so no `/api/revalidate` call is needed. Re-open every URL in the Step 1 table and confirm each row matches **After**. Any mismatch blocks box scores PR 2 until it's explained.
