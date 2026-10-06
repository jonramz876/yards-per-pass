# Read resilience: implementation spec (2026-10-06)

Repo: `yards-per-pass` (Next 14.2.35 App Router, supabase-js 2.49.1, postgrest-js 1.19.2, React 18.3.1, vitest 4.1.1).
Status: **revision 2** (2026-10-06). Spec review verdict: APPROVED WITH CHANGES (7 IMPORTANT, 10 MINOR, no CRITICAL). Every finding is applied below. Jon's decisions are recorded in section 4.

## Review changes applied (rev 2)

| Finding | Change | Where |
|---|---|---|
| I1 | A `generateMetadata` throw on a route with `loading.tsx` is **HTTP 200, skeleton, then the error card** with an empty head, not a 500. Only `/`, `/card`, `/game` return 500. Paragraph and pass criterion corrected | 1.2 "generateMetadata", 1.7 |
| I2 | Jon's choice: **accept the crawler risk**. No client-side `noindex`. Stated as a known risk with a Search Console check | 1.8 |
| I3 | "Try again" is `startTransition(() => { router.refresh(); reset(); })`, so one click is enough. Test and a one-click manual check added | 1.2, 1.6, 1.7 |
| I4 | Decision 1 redesigned: health-gated purge, mandatory warm-up, 6 h window, new gate G3, G1 waits 3 h | 2.1, 2.2(c), 2.2(e), section 4 |
| I5 | PR 2's claim reworded (four leaderboards and the homepage; team and player pages need 2b). `getPlayerBySlug` moves from 2b into PR 2 | top table, 2.2(j), 2.3, section 4 |
| I6 | Browser client limit is **15 s** (second constant); server stays 5 s | 1.3 |
| I7 | Ticket: 522 line kept (observed directly), "12 to 90 seconds", once-a-day claim starts 9/30 with 9/29 listed separately, request-volume sentence softened, "confirm before sending" list | Appendix A |
| M1 | No retry in PR 1; reason given; listed as the first follow-up after 1B | 1.3 |
| M2 | Added `order` changes row order (values identical, order not); player tables use `["player_id", "id"]` | 2.2(b), 2.3 |
| M3 | Past seasons are purged with the current one: accepted, with the reason | 2.2(e) |
| M4 | Decision 5 dropped: `/api/revalidate` does **not** purge the sitemap | 3.1, 3.4, section 4 |
| M5 | Decision 4 wording: a build is somewhat more likely to fail during a stall | 3.2, section 4 |
| M6 | Decision 6: one sentence on what is and is not worse than today | 1.8, section 4 |
| M7 | The other `fetchAllRows` callers wrap the raw rejection in an `Error` too, in 1A | 1.2 loader table |
| M8 | `hangingFetch` handles an already-aborted signal; the boundaries without a test are listed; fast-failure coverage stated; dev overlay note | 1.6, 1.7 |
| M9 | Stale-path log noise noted | 2.7 |
| M10 | `/api/stat-card`: a failed seasons read is a 503 too (no `fallbackSeason()` card) | 1.2 API table |

Also made explicit in rev 2 (gaps found while applying the review, none changes a decision): PR 1 ships as **1A then 1B** with a per-PR scope table (1.0); a 1A forced-failure run that uses a fast-failing stub, because without the timeout a silent socket just hangs (1.7); OG images mark **any** image built after a failed read `no-store`, including a card drawn for the fallback season (1.2); where S3 is placed (1.5); stale comments that 1A must correct (1.2).

Four PRs, each shippable alone, in this order (then 2b):

| PR | What | Visitor effect |
|---|---|---|
| 1A | Reads that fail stop pretending they found nothing | A read that **fails** is a clear error card, never a false 404, a false "No results", or a blank-but-normal-looking page. A read that **hangs** still hangs (1B fixes that) |
| 1B | Every Supabase read gets a time limit (5 s on the server, 15 s in the browser) | A stall is the error card in about 5 s, never a 30 s+ hang |
| 3 | Sitemap throws instead of saving a 43-URL copy | Google never sees the player and game pages vanish |
| 2 | Season-level tables are kept in Vercel's data cache | The four main leaderboards (`/teams`, `/qb-leaderboard`, `/receivers`, `/rushing`), `/card` and the homepage keep working through a stall with the last numbers they had. Team, player and game pages still show the error card until PR 2b |
| 2b | Per-team and per-game tables cached | Team and player pages survive a stall. **This is the PR that delivers the goal for about 97% of the site's URLs**; it is scheduled, not optional |

Sections: 0 evidence, 1 PR 1 (1A and 1B), 2 PR 2, 3 PR 3, 4 decisions for Jon, 5 what the audit got wrong, Appendix A Supabase ticket.

---

## 0. Evidence this spec is built on

### 0.1 Measured today (6 live requests, 14:15 to 14:17 UTC, stall still in progress)

| URL | Result |
|---|---|
| `/api/health` | no response in 25 s (curl gave up) |
| `/team/BUF` | HTTP 200, first byte 0.18 s (skeleton), then nothing more for 30 s |
| `/receivers` | HTTP 200, first byte 0.23 s, then hung past 30 s |
| `/trends` | HTTP 200, first byte 0.23 s, then hung past 30 s |
| `/run-gaps` | HTTP 200, first byte 0.79 s, then hung past 30 s |
| `/sitemap.xml` | `x-vercel-cache: HIT`, `Age: 3444`, generated 13:19:54 UTC, 43 URLs, 5,038 bytes (the degraded copy) |

So the stall the audit saw at 13:20 was still on at 14:17, and what a visitor gets today is: a 200 with a loading skeleton that never finishes.

### 0.2 Healthy speed (for choosing the limit)

- Audit, 13:55 UTC: five season pages answered first byte in under 0.25 s. That includes one `data_freshness` query in `generateMetadata`.
- Today: `/receivers` and `/trends` first byte 0.23 s (same query answered), mid-stall.
- `lib/data/box-score.ts` comment: the whole 8-request box score chain "normally settles well under a second".
- MEMORY: healthy ingest runs spend 6 to 19 s in the database for the whole season write.

A healthy single read is roughly 50 to 250 ms. 5,000 ms is 20x the slowest healthy read seen.

### 0.3 Vercel facts (docs fetched today, last updated 2026-08-21 and 2026-08-24)

- Function time limit on Hobby: **300 s default and maximum**. This is why hangs run 40 s+ instead of being cut at 10 s. The "10s (Hobby)" in the `BOX_SCORE_READ_DEADLINE_MS` comment is out of date.
- Data cache: **2 MB per item** ("items larger won't be cached"), 128 tags per item, regional, split by production/preview, **persists across deployments**, LRU eviction at a storage limit. **On Hobby all projects in the team share one cache**, and a manual purge wipes every project's entries.
- No per-plan read/write quota for the data cache is stated on that page. Not verified beyond that page.

### 0.4 Next 14.2.35 source facts (all read in `node_modules/next/dist`)

| Fact | Where |
|---|---|
| Any fetch with a `signal` skips Next's per-render request dedupe | `server/lib/dedupe-fetch.js` line 80 |
| `unstable_cache` with a **stale** entry returns the stale value at once and re-runs the callback in the background; if that throws, the error is logged and the stale entry stays | `server/web/spec-extension/unstable-cache.js` lines 129 to 147 |
| With **no** entry, the callback runs inline; a throw propagates and nothing is stored | same file, lines 152 to 162 |
| Whatever the callback **returns** is stored, including `[]` and `null` | same file, `cacheNewResult` |
| Cache key = callback source text + keyParts + `JSON.stringify(args)`. The URL and search params go only into a log label | same file, lines 50 to 72 |
| An entry over 2 MB is silently not stored in production (throws only in dev). The size checked is the entry JSON, which contains the result already stringified once, so quotes are escaped a second time (about +15 to 20%) | `server/lib/incremental-cache/index.js` lines 382 to 391 |
| A read whose tag (or path-derived "soft tag") was revalidated returns a hard miss, not a stale value | `incremental-cache/index.js` lines 313 to 319; on Vercel the tags are sent to the cache service, which answers 404 (`fetch-cache.js` lines 187 to 206) |
| Vercel can return an expired entry flagged not fresh; Next then treats it as stale (serve + background refresh) | `fetch-cache.js` lines 227 to 234 |
| The per-instance memory copy is cleared after each request | `fetch-cache.js` lines 117 to 119, 171 to 173 |
| `revalidateTag` / `revalidatePath` only record the tag; the purge is sent after the handler finishes | `spec-extension/revalidate.js`, `app-route/module.js` lines 265 to 278 |
| A page or route with `revalidate` that throws while regenerating in the background keeps the old copy and retries in 3 to 30 s. This path is skipped on Vercel (`minimalMode`), where the platform does the equivalent | `server/response-cache/index.js` lines 71, 127 to 140 |

Not in the source and **not verified**: how long Vercel keeps an expired data-cache entry. Gate G1 in PR 2 checks it.

### 0.5 supabase-js / postgrest-js facts

- `createClient(url, key, { global: { fetch } })` routes every request through the custom fetch (`supabase-js/dist/main/lib/fetch.js` line 72: `fetch(input, { ...init, headers })`).
- postgrest-js passes `signal: this.signal` (undefined unless `.abortSignal()` was called) (`PostgrestBuilder.js` line 69).
- A rejected fetch (abort, timeout, network) is turned into `{ data: null, error: { message: "<name>: <message>" } }`, not a rejection (lines 165 to 170). So a timeout arrives as `error`, and only loaders that check `error` notice it.

---

## 1. PR 1: a time limit on every read, and failed reads stop looking like empty results

### 1.0 Two PRs: what is in each

| | PR 1A "failed reads stop looking empty" | PR 1B "the time limit" |
|---|---|---|
| Sections | 1.2 (all of it) | 1.3 |
| Code | loaders throw; core / may-degrade callers; `/card` no longer 404s on a failed read; `/api/health` and `/api/stat-card` 503 `no-store`; OG fallbacks `no-store`; S1 to S4; `ErrorState` "Try again" | `lib/supabase/timeout.ts`, both clients, `getAvailableSeasons(signal)`, the `box-score.ts` "10s (Hobby)" comment |
| Not in it | no timeout, no caching, no sitemap change | no retry (M1) |
| Safe alone? | Yes. Fast failures become cards; hangs stay hangs, exactly as today | Only after 1A |

1A merges first; 1B a day later (Decision 7).

### 1.1 Why the timeout alone is not safe

Many loaders turn a failed read into "no rows". With a 5 s limit, a stall would become one of these, quickly and often:

| Loader / call site | On a failed read today | What the visitor would see |
|---|---|---|
| `getPlayerBySlug` (`lib/data/players.ts`) | returns `null` | `/player/x` and `/card/x`: the Not Found page. `/api/stat-card/x`: 404. Title "Player Not Found" |
| `app/card/[slug]/page.tsx` `catch { notFound() }` around `getCardDataForPlayer` | 404 | a real player's card 404s |
| `getAvailableSeasons` | returns `[]` | season picker empty, page silently uses the calendar-year fallback |
| `getDataFreshness` | returns `null` | leaderboards use `throughWeek ?? 18`, so the qualifier minimums are 18 weeks' worth and almost every player is filtered out: a near-empty board that looks normal |
| `getTeamHubData` (12 reads, each `.catch(() => [])`; `getDownDistanceStats` and `getSituationalStats` ignore `error` entirely) | all empty | a team page with the name and nothing else |
| `app/player/[slug]/page.tsx` outer `catch {}` plus the three weekly loaders returning `[]` | empty | "No QB stats found for X in 2026" for a player who has stats |
| `getAllGapData`, `getLeagueGapAverages`, `getTeamsWithGapData` | empty | `/run-gaps` empty heatmap |
| `getPlayerSlugsByIds`, `hasScheduleForSeason` (homepage) | `[]` / `false` | homepage leaders unlinked, or the wrong standings season, **cached for an hour** by ISR (MEMORY follow-up) |
| Search palette and Compare search (`const { data } = await ...`, error ignored) | no results | "No results for 'allen'", which is false |
| Both `opengraph-image.tsx` routes | brand plate / name plate | a fallback image that may then be cached long-term (MEMORY "OG freeze") |

So PR 1 has two parts, shipped as PR 1A then PR 1B (1.0). Part A must merge before Part B.

### 1.2 Part A (PR 1A): tell a failed read from an empty one

Rule: **a loader throws an `Error` on a query error and returns empty only when the query succeeded with no rows.** Callers decide what a throw means.

#### Loader changes

| File | Function | Change |
|---|---|---|
| `lib/data/queries.ts` | `getAvailableSeasons` | `if (error) throw new Error("Failed to fetch seasons: " + error.message)`. A successful empty read still returns `[]` |
| | `getDataFreshness` | use `.maybeSingle()` (0 rows gives `data: null, error: null`); `if (error) throw`. A season with no row still returns `null` |
| `lib/data/players.ts` | `getPlayerBySlug` | `.maybeSingle()`; throw on `error`; `null` only for no row |
| | `getPlayerSlugsByIds`, `getQBWeeklyStats`, `getReceiverWeeklyStats`, `getRBWeeklyStats`, `getQBPassLocationStats`, `getTeamTopReceivers`, `getTeamStartingQB` | throw on `error` |
| | `getAllPlayerSlugs` | wrap `fetchAllRows`' raw rejection in an `Error` (M7) |
| `lib/data/team-hub.ts` | `getDownDistanceStats`, `getSituationalStats` | read `error`, throw on it |
| `lib/data/run-gaps.ts` | `getAllGapData`, `getLeagueGapAverages`, `getTeamsWithGapData` | remove the `try/catch` that returns empty; wrap `fetchAllRows`' raw rejection in an `Error` |
| | `getRBGapStats` (all-teams path), `getDefGapStats` | wrap the raw rejection (M7) |
| `lib/data/rushing.ts` | `getRBSeasonStats` | wrap the raw rejection (M7) |
| `lib/data/trends.ts` | `getWeeklyForStat`, `getAllSurgeData` | wrap the raw rejection (M7) |
| `lib/data/games.ts` | `hasScheduleForSeason` | throw on `error` (false only for a successful empty read); correct its doc comment |
| `lib/data/utils.ts` | new `queryError(what, err)` | the one wrapping helper: returns `new Error("Failed to fetch <what>: <message>", { cause })`. The message comes from `err.message` when that is a string, else `JSON.stringify(err)` |
| `lib/data/card.ts` | `getLatestCardSeason` | unchanged (a missing "see his 2025 card" link is an honest degrade) |
| `lib/data/box-score.ts` | `getBoxScore` | comment only: "getAvailableSeasons returns [] on a query error" is no longer true. The `seasons.length === 0` throw stays for a truly empty table |

`fetchAllRows` is unchanged (its call-for-call behaviour is pinned by `__tests__/data/utils.test.ts`). M7: every loader that calls it now rethrows through `queryError`, so the error boundaries and logs get an `Error` with a message, not a bare object. The one caller left raw is `getPlayedRegularSeasonGameIds` (`lib/data/games.ts`): its only caller is `app/sitemap.ts`, which PR 3 rewrites; PR 3 wraps it. `app/page.tsx`'s own wrapping idiom stays (it still guards any non-Error).

`app/sitemap.ts` is untouched in 1A: its reads already sit inside `try/catch`, so a loader that now throws lands where a `[]` / `null` used to and the output is the same. Its comments that say "getAvailableSeasons swallows its own query error" go stale and are corrected in PR 3 with the rest of the file.

#### Caller changes: what is "core" (throws to the error card) and what may degrade

| Route | Core reads (failure = error card) | May degrade (logged with `console.error`, page still renders) |
|---|---|---|
| `/` | already: seasons, freshness, 4 stat tables. **Add:** `getPlayerSlugsByIds`, `hasScheduleForSeason`, next-season `getTeamStats`. Each rethrows unless `hasNoDatabase()` | none |
| `/team/[team_id]` | seasons, team stats, QBs, receivers, RB gaps, def gaps, down-distance, situational, schedule, freshness | player slug map (names render unlinked), next season's schedule, box score seasons probe (existing) |
| `/player/[slug]` | player row, seasons, the position's season table, the weekly rows | cross-link boxes, pass-location map, official game results (existing), box score probe (existing) |
| `/card/[slug]` | player row, seasons, `getCardDataForPlayer` (rethrow instead of `notFound()`) | `getLatestCardSeason` |
| `/qb-leaderboard`, `/receivers`, `/rushing`, `/teams`, `/trends`, `/run-gaps`, `/team-stats` | every read (they already `await` without catching; Part A makes seasons/freshness/gap data throw) | none |
| `/compare` | seasons, the position table when `p1` is given | the `p1` player lookup: on failure render the tool with nothing preloaded (the browser restores the players itself) |
| `/game/[game_id]` | unchanged (already throws on every read) | unchanged |

`getTeamHubData` keeps `.catch()` only on the two "may degrade" reads it owns (the slug map and next season's schedule), and each now logs with `console.error`; the box score probe is caught in the page, as today. `freshness` may still be `null` there (a `?season=` with no `data_freshness` row is a real state); only a query **error** throws. `app/team/[team_id]/page.tsx` and `app/player/[slug]/page.tsx` drop their `seasons.length === 0` log-and-continue: a failed seasons read now throws; a truly empty `data_freshness` table (no error, no rows) throws too unless `hasNoDatabase()`, the homepage's rule. That empty-table rule applies to `/`, `/team` and `/player` only: `/card`, `/compare` and the season pages keep their `fallbackSeason()` path for a truly empty list (existing tests pin it).

On `/player`, the page's outer `try { ... } catch {}` around the position reads is removed. The season table and the weekly rows are awaited bare; the cross-link and pass-location reads keep a `.catch` that logs (`console.error`, naming the slug and season) and returns the empty value.

On `/`, the three added reads share the existing rule through one module-private helper (rethrow as an `Error` unless `hasNoDatabase()`), so the placeholder build still renders the empty shell: with 1A `hasScheduleForSeason` **throws** against `placeholder.supabase.co`, where it used to answer `false`.

#### generateMetadata: a failed read throws, same as the body

In `generateMetadata` of the season pages, `/player`, `/card` and `/team-stats`, a failed read is **not caught**: it throws, exactly as `/game` already does (with tests). No fallback title, no fallback canonical, no noindex.

Why not a fallback: the stalls are intermittent, and with the timeout the metadata read and the body read are separate attempts (1.3, dedupe). A caught metadata failure followed by a successful body would serve a healthy 200 page with a wrong canonical, or, if marked noindex to hide that, would tell a crawler to drop a real page. A throw is honest.

What a metadata throw looks like (review I1, settled from source, replacing rev 1's "expected a real 500"): Next 14.2 does not let it propagate out of the head. `resolveMetadata` catches it (`lib/metadata/resolve-metadata.js` 259 to 268 and 616 to 620), the `<head>` gets **default metadata** (no title, no description, no canonical, no robots; `lib/metadata/metadata.js` 51 to 100), and `MetadataOutlet` rethrows the error beside the page component, inside that segment's loading and error boundaries (`metadata.js` 150 to 156, `create-component-tree.js` 421 to 429). So:

| Route | A failed metadata read gives |
|---|---|
| has `loading.tsx`: `/player`, `/team`, the seven season pages, `/compare` | **HTTP 200**, skeleton, then the error card, with an empty head. The same as a failed body read |
| no `loading.tsx`: `/`, `/card`, `/game` | a real **500** with the error card |

The one existing catch that stays: `/card` metadata's `try` around `getCardDataForPlayer` (it only decides noindex for a no-card page and already leaves robots alone on failure; its comment "the page itself 404s on this path" is corrected, since the page now throws). `/team-stats` metadata's probe catch also stays (existing, documented fail-open).

#### API routes and images

| Route | Change |
|---|---|
| `/api/health` | on error (a query `error`, or a thrown client): **503**, `{ status: "error", message }`, `Cache-Control: no-store`. Was 500 with no cache header. After 1B a timeout message begins `TimeoutError:` (postgrest-js prefixes the error name); in 1A alone a hung read still hangs |
| `/api/revalidate` | no database read. No change in PR 1 |
| `/api/stat-card/[slug]` | wrap the three reads (seasons, player row, card data): on a thrown read return **503**, body `Stat card temporarily unavailable. Try again in a few minutes.`, headers `Cache-Control: no-store`, `Retry-After: 60`. That includes the seasons read (M10): today a failed seasons read is caught and the card is drawn for `fallbackSeason()`, which can be the wrong season; that inner `try/catch` is removed. A `?season=` in range still skips the seasons read. 404 stays for an unknown slug or no card |
| `app/player/[slug]/opengraph-image.tsx`, `app/card/[slug]/opengraph-image.tsx` | when **any** read in the route threw (seasons, player row or card data), whatever image is returned carries `headers: { "Cache-Control": "no-store" }`: the brand plate, the name plate, and also a card drawn for `fallbackSeason()` after a failed seasons read (it may be the wrong season). An image built with no failed read (unknown slug, no card, or the real card) is returned exactly as today, with no header. The review traced the header through `base-server.js:1396` (non-SSG path, the handler's own response is sent) and expects it to survive; it cannot be checked on Windows (1.7). If the preview shows it does not survive, the fallback is to throw from the image route instead |

#### Client-side reads

`components/search/SearchPalette.tsx`, `components/compare/PlayerSearchInput.tsx`, `components/compare/ComparisonTool.tsx` read `error` and show a message instead of a false empty state (sentences in 1.5). A thrown client (missing env) counts as an error too. Team results in the palette still show.

#### "Try again" must actually retry

`reset()` re-renders the boundary against the server payload it already holds; it does not re-run the server component (documented in `app/game/[game_id]/error.tsx`). So on every route except `/game`, "Try again" re-shows the same error even after the database is back.

Fix once, in `components/ui/ErrorState.tsx` (review I3): the button runs

```ts
startTransition(() => {
  router.refresh();
  reset();
});
```

with React's `startTransition` and `useRouter` from `next/navigation`. Why the transition: `reset` is a plain urgent `setState` (`error-boundary.js` 120 to 124) and `router.refresh()` is a transition that lands later. Called bare, one after the other, the boundary re-renders at once against the old payload, throws the same error again, and nothing clears it when the fresh payload arrives (the boundary resets only on a pathname change), so the first click does nothing visible and the second works. Inside one transition both commit together when the refresh lands. `app/game/[game_id]/error.tsx` has the bare two-call form today; it now passes plain `reset` and its own `router.refresh()` is removed (it would refresh twice).

### 1.3 Part B (PR 1B): the time limit

#### Files

| File | Change |
|---|---|
| `lib/supabase/timeout.ts` (new, pure, no Supabase import, safe for the browser bundle) | `SUPABASE_READ_TIMEOUT_MS = 5000`, `SUPABASE_BROWSER_READ_TIMEOUT_MS = 15000`, and `withReadTimeout(fetchImpl, ms = SUPABASE_READ_TIMEOUT_MS)` |
| `lib/supabase/server.ts` | `createClient(url, key, { global: { fetch: withReadTimeout(fetch) } })` (5 s) |
| `lib/supabase/client.ts` | `withReadTimeout(fetch, SUPABASE_BROWSER_READ_TIMEOUT_MS)` for the browser singleton (15 s, review I6). The signal covers the whole request including the body, and `ComparisonTool` downloads a whole season table (`select *`, up to about 470 KB) to the browser: on a slow phone connection that can pass 5 s with nothing wrong, and S3 would then be false. The 20x margin in 0.2 was measured server to server. Search stays quick because its payload is tiny |
| `lib/data/box-score.ts` | comment only: correct "10s (Hobby)" to the 300 s limit; the 5 s assembly deadline is unchanged |

#### Behaviour of `withReadTimeout`

| Caller passed | What the wrapper does |
|---|---|
| no `init.signal` | adds `signal: AbortSignal.timeout(ms)` |
| an `init.signal` (box score assembly, `/team-stats`, `getBoxScoreSeasons`) | passes the call through **unchanged**. The explicit deadline is the only deadline. Never shortened, never combined |
| a `Request` object as `input` with no `init` | adds the signal through `init` (postgrest-js never does this; covered for completeness) |

The signal covers the whole request including reading the body. A timeout rejects with a `TimeoutError`; postgrest-js returns it as `error.message = "TimeoutError: ..."`.

If `AbortSignal.timeout` is missing (very old browser), use `AbortController` + `setTimeout`.

One read escapes the box score's single 5 s budget: `getBoxScore` calls `getAvailableSeasons()` with no signal on its no-rows path (`lib/data/box-score.ts` line 385). After Part B that read gets its own 5 s, so a `pending` / `uncovered` game can take up to 10 s to fail. Fix in this PR: give `getAvailableSeasons` an optional `signal` argument and pass the assembly's signal there.

#### Why a real signal, and what it costs

Two ways to time out were considered:

| Option | Pro | Con |
|---|---|---|
| **(a) pass an AbortSignal (chosen)** | really cancels the socket; covers a body that stalls mid-download; three lines | Next stops deduping identical reads within one render (0.4). Cost below |
| (b) race the fetch against a timer, no signal | keeps Next's dedupe | the hung request stays open (undici's own limit is 300 s); a stalled body is not covered unless the wrapper also buffers the body |

Cost of (a), per page view, until PR 2 lands (PR 2 removes all of it for the reads it caches):

| Route | Extra requests | Which |
|---|---|---|
| season pages (`/teams`, 3 leaderboards, `/trends`, `/run-gaps`, `/team-stats`) | +1 | `data_freshness` seasons list, read in metadata and again in the page |
| `/team/[team_id]` | +1 | seasons list, read by the page and by `getTeamHubData` |
| `/player/[slug]` | +1 | player row, read in metadata and in the page |
| `/card/[slug]` | +3 | player row, seasons list, the position's season table |
| `/game/[game_id]`, `/` | 0 | already on explicit signals / no duplicates |

That is roughly +15% requests in normal operation, all small indexed reads. The audit found the database is not load-bound, so this is acceptable for the gap between PR 1 and PR 2. If PR 2 is delayed more than a week, add the per-request memo from 2.6 to these three loaders as a small follow-up.

Side effect worth knowing: MEMORY says an in-render retry of the same query is a no-op because Next replays the memoised failure. With a signal on every read that is no longer true.

**No retry in PR 1 (review M1, decided: not now).** The review points out that one retry inside `withReadTimeout` (GET/HEAD, no caller signal, 3 s per attempt) would do more for "visitors stop noticing" than anything else here, because identical requests succeed in the same minute: a 12-read page at a 20% per-read failure rate goes from about 7% success to about 61%. It is left out of 1A and 1B on purpose: Jon chose two small PRs a day apart so any surprise is easy to place, and a retry changes request counts and worst-case timing (two attempts per read) at the same moment the limit first ships. It is the first follow-up once 1B has run through one stall window, with its own short spec review.

#### Why 5,000 ms

- 20x the slowest healthy read (0.2).
- Same number as the existing box score deadline, so one number to remember.
- Longest serial chain, worst case where every read is slow but just under the limit: `/player` has 6 waves (metadata player row; player row; seasons; position reads; game results; probe) = 30 s. `/trends` by December: seasons, then slugs (2 pages), then up to 9 weekly pages = about 60 s. Both far under Vercel's 300 s. In a real stall the first hung read throws at 5 s and ends the chain, so the typical failure is 5 to 6 s.
- A page of `fetchAllRows` gets its own 5 s (one signal per request), so a healthy multi-page read is never cut off for being long.

### 1.4 What a visitor sees when a read times out

This table describes 1A and 1B together. With **1A alone** every "card in about 5 s" row reads "card as soon as the read fails; a read that never answers still hangs, as today", and the 503s likewise arrive only when the read fails.

HTTP status note: routes with a `loading.tsx` send `200` and the skeleton first (measured today: first byte about 0.2 s), so the error card arrives inside a 200 response, whether the failed read was in `generateMetadata` or in the page (1.2, I1). Routes without one (`/`, `/card`, `/game`) return a real 500. Confirm both in 1.7.

Shared card (`components/ui/ErrorState.tsx`): the title below, then **"Something went wrong loading this page. Try refreshing, or come back in a few minutes."**, then buttons **"Try again"** and **"Report issue"**.

| Route | `loading.tsx` | Error boundary | Title on the card | After |
|---|---|---|---|---|
| `/` (cached copy exists) | no | n/a | none: Vercel keeps serving the last good homepage | unchanged |
| `/` (first request after `/api/revalidate` purged it, or brand-new deployment) | no | `app/error.tsx` | "Something went wrong" | 500 in about 5 s (today: hang) |
| `/teams` | yes | `app/teams/error.tsx` | "Unable to load team data" | card in about 5 s |
| `/team-stats` | yes | `app/team-stats/error.tsx` | "Unable to load team stats" | unchanged (already 5 s) |
| `/qb-leaderboard` | yes | own | "Unable to load QB data" | card in about 5 s |
| `/receivers` | yes | own | "Unable to load receiver data" | card in about 5 s |
| `/rushing` | yes | own | "Unable to load rushing data" | card in about 5 s |
| `/trends` | yes | own | "Unable to load trend data" | card in about 5 s |
| `/run-gaps` | yes | own | "Unable to load run gap data" | card (today: empty heatmap) |
| `/compare` | yes | own | "Something went wrong" | card; or the empty tool if only the `p1` lookup failed |
| `/team/[team_id]` | yes | own | "Unable to load team data" | card (today: blank team page) |
| `/player/[slug]` | yes | own | "Unable to load player data" | card (today: Not Found, or "No stats found") |
| `/card/[slug]` | no | `app/error.tsx` | "Something went wrong" | 500 (today: 404) |
| `/game/[game_id]` | no (deliberate) | own | "Unable to load this box score" + both team links | unchanged |
| `/glossary`, `/privacy`, `/robots.txt` | n/a | n/a | no database | unchanged |
| `/sitemap.xml` | n/a | n/a | see PR 3 | see PR 3 |
| `/api/health` | n/a | n/a | 503 JSON | 5 s (today: hang) |
| `/api/stat-card/[slug]` | n/a | n/a | 503 text (1.5) | 5 s |
| OG images | n/a | n/a | fallback image, `no-store` | not kept by caches |
| Search palette | n/a | n/a | sentence S1 under the team results | 5 s (today: spinner, then false "No results") |

Never, on a failed or timed-out read: a 404, a page with empty tables and normal chrome, or a cached response. (A failed render is not cached anywhere: dynamic routes send `no-store`; ISR keeps the old copy.)

### 1.5 Visitor-facing sentences in PR 1 (each needs a test)

| Id | Where | Text | Shown when |
|---|---|---|---|
| S1 | `SearchPalette` | `Player search isn't responding right now. Try again in a moment.` | the player query returned an error or timed out. Replaces "No results for ..." in that case only; team matches still list above it |
| S2 | `PlayerSearchInput` (Compare) | same text as S1 | same condition |
| S2 detail | | | `PlayerSearchInput` has no "No results" text today (an empty search shows nothing), so S2 is new copy in the dropdown position; a healthy empty search still shows nothing |
| S3 | `ComparisonTool` | `Couldn't load stats for this comparison. Try again in a moment.` | a lazy season-table read or the URL-restore read returned an error. One line directly under the two player pickers, above the empty state / comparison area. That position covers both cases: after a failed URL restore no player is selected and the "Select two players to compare" empty state still shows below it (the visitor can pick by hand); after a failed season-table read both players are selected and the area below is blank. It clears when Player 1 changes |
| S4 | `/api/stat-card` 503 body | `Stat card temporarily unavailable. Try again in a few minutes.` | a read threw |
| existing | `ErrorState` | the titles in 1.4 (12 boundary files, 9 distinct titles) and the shared message and buttons | already rendered; tests as listed in 1.6 |

Each sentence lives in a module-level string constant and is rendered as `{CONSTANT}`, with a straight apostrophe. Two reasons: `next lint`'s `react/no-unescaped-entities` rejects a bare apostrophe in JSX text, and a string literal is immune to the MEMORY trap (the Edit tool can turn a typed apostrophe into a literal escape sequence, which JSX text does not decode). The tests assert the literal sentence, never the imported constant.

### 1.6 Tests

Simulating a stalled database in vitest (no real timers longer than a few ms, no fake timers: `AbortSignal.timeout` does not reliably follow `vi.useFakeTimers`):

```ts
// a fetch that never answers, and rejects the way undici does when aborted
const hangingFetch = (_input: unknown, init?: { signal?: AbortSignal }) => {
  // M8: a signal that is already aborted never fires "abort" again
  if (init?.signal?.aborted) return Promise.reject(init.signal.reason);
  return new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () => reject(init.signal!.reason), { once: true });
  });
};
```

Real 20 ms timers with no fake timers are deterministic enough here (review M8). This mock and the 1.7 silent socket cover **hangs** only, so they belong to 1B. The **fast-failure** shape (a rejected fetch, or a non-2xx answer whose body becomes `error.message`) is what 1A changes, and the loader unit tests below cover it by handing the loader `{ data: null, error: { message } }`.

`__tests__/data/supabase-timeout.test.ts` (new, **PR 1B**):

1. `withReadTimeout(hangingFetch, 20)` rejects with `name === "TimeoutError"` in under 500 ms.
2. Caller signal wins: pass a controller's signal and `ms = 20`; after 100 ms the promise is still pending; abort the controller; it rejects with the controller's reason. Assert the inner fetch received the caller's exact signal object.
3. No signal: the inner fetch receives a signal; other `init` fields (`method`, `headers`) arrive unchanged.
4. A fast fetch resolves with the same `Response` object.
5. Default `ms` is `SUPABASE_READ_TIMEOUT_MS` and that constant is 5000.
6. Through the real client: `createClient("https://x.supabase.co", "k", { global: { fetch: withReadTimeout(hangingFetch, 20) } }).from("t").select("*")` resolves to `{ data: null, error }` with `error.message` starting `TimeoutError`.
7. `createServerClient` and `getSupabaseClient` pass a `global.fetch` (mock `@supabase/supabase-js` `createClient`, assert the options). Both clients are module-level singletons: call `vi.resetModules()` and re-import in each case.

Everything from here to the end of 1.6 is **PR 1A**.

Loader tests (extend `__tests__/data/queries.test.ts` and `games.test.ts`; add `players.test.ts`, `run-gaps.test.ts`, `team-hub.test.ts`, `fetch-all-wrap.test.ts`), each loader in the 1.2 table, three cases: query error throws an `Error`; success with rows returns them; success with no rows returns `[]` / `null`. For the `.maybeSingle()` loaders, assert no row is `null`, not a throw. For the `fetchAllRows` callers, reject with a **plain object** and assert an `Error` whose message carries the object's message.

Route tests (mock the loaders; a failed read is `mockRejectedValue(new Error("Failed to fetch ...: TypeError: fetch failed"))`):

| Test file | Assert |
|---|---|
| `player-route.test.ts` | player row rejects: the page throws and `notFound` was **not** called. Seasons reject: throws. Season table rejects: throws. Weekly rows reject: throws. Cross-link / pass-location reject: renders, logs. Empty seasons: throws with a real URL, renders with the placeholder. `generateMetadata` on a rejected player read: rejects (no "Player Not Found" title) |
| `card-page.test.tsx` | `getCardDataForPlayer` rejects: throws that error, `notFound` not called. Player row rejects: throws, `notFound` not called. The metadata catch around `getCardDataForPlayer` stays (existing test) |
| `team-route.test.tsx` + new `team-hub.test.ts` | each of the ten core reads rejects: `getTeamHubData` rejects. Slug read or next-season schedule rejects: resolves, logs. Page: seasons reject: throws; empty seasons: throws with a real URL, renders with the placeholder |
| `home-page.test.tsx` | `getPlayerSlugsByIds` rejects: throws (real URL) / renders (placeholder URL). Same for the schedule probe and for next season's `getTeamStats` |
| `canonical.test.ts` | for each of the seven season pages: seasons read rejects, `generateMetadata` rejects. The existing "bare when the season list is empty" cases stay (empty is not an error) |
| new `season-pages-failed-read.test.tsx` | for each of the seven season pages: seasons read rejects, the page function rejects; freshness read rejects, the page function rejects. `/run-gaps`: `getAllGapData` rejects, rejects. `/compare`: seasons or the position table reject, rejects; the `p1` lookup rejects, renders and logs |
| `health-route.test.ts` | error gives 503 and `no-store`; a thrown client gives 503 |
| new `stat-card-route.test.ts` | each of the three reads rejecting gives 503, S4, `no-store`, `Retry-After: 60`; unknown slug and no card still 404; healthy path keeps its headers. (`@vercel/og` cannot render on Windows: mock `next/og`) |
| new `og-image-routes.test.ts` (mock `next/og`) | both routes: player read throws: brand plate with `Cache-Control: no-store`; card read throws: name plate with it; seasons read throws then a card: card with it; unknown slug / no card / healthy card: no `headers` at all |
| new `SearchPalette.test.tsx`, `PlayerSearchInput.test.tsx`, `ComparisonTool.test.tsx` | error from the client: S1/S2/S3 shown, "No results" not shown; teams still listed above S1; a healthy empty result still shows "No results" (palette) or nothing (Compare picker); a healthy result shows no sentence |
| new `ErrorState.test.tsx` | one click on "Try again" calls `router.refresh()` once and `reset()` once, **both inside one `startTransition` callback** (mock `react`'s `startTransition` to record that the two calls happened while its callback was running), and neither before the click. Also the shared message and both buttons. The `/game` wrapper's own refresh is removed in this PR and `game-error.test.tsx`'s assertion becomes "passes the retry through `ErrorState`" |
| new `error-boundaries.test.tsx` | each of the 12 `error.tsx` files renders `ErrorState` with its 1.4 title and the shared message |

Boundaries (review M8: "list which are missing"). Before this PR only `app/game/[game_id]/error.tsx` had a test. Missing, and covered by `error-boundaries.test.tsx`: `app/error.tsx`, `compare`, `player/[slug]`, `team/[team_id]`, `teams`, `team-stats`, `qb-leaderboard`, `receivers`, `rushing`, `trends`, `run-gaps` (11 files). What vitest can and cannot show: "a thrown loader reaches the boundary" needs Next's runtime, so it is split in two. (a) The route tests above show each page function **rejects** when a core loader rejects. (b) `error-boundaries.test.tsx` shows each boundary file renders the right card. The join between them (Next handing the rejection to the nearest `error.tsx`) is checked by the forced-failure run in 1.7.

Chaos pass (project gate) should include: read that errors after partial pages in `fetchAllRows`; `error` objects with no `message`; (1B) a signal already aborted before the call; (1B) `ms = 0`.

### 1.7 Verifying PR 1

Forced failure, no real outage needed, on Jon's machine. Never the real database and never `.env.local`: the Supabase URL is set for that one process and points at a local port. The host must not be `placeholder.supabase.co` (that flips `hasNoDatabase()` and the homepage renders its empty shell on purpose).

**1A run: a stub that fails fast.** Without the timeout a silent socket just hangs, which is today's behaviour and proves nothing about 1A. So the stand-in answers every request at once with an error:

1. Start it: `node -e "require('http').createServer((q,s)=>{s.writeHead(503,{'content-type':'text/plain'});s.end('stub: database unavailable')}).listen(54399)"`
2. In a second terminal, from the repo folder: `NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54399 NEXT_PUBLIC_SUPABASE_ANON_KEY=x npx --no-install next dev -p 3100` (Git Bash syntax. In PowerShell set `$env:NEXT_PUBLIC_SUPABASE_URL` and `$env:NEXT_PUBLIC_SUPABASE_ANON_KEY` on their own lines first, then run the `npx` command.)
3. For each row of the 1.4 table: `curl -s -o NUL -w "%{http_code} %{time_total}\n" http://localhost:3100/<path>` (repeat once; the first hit compiles the route). Pass criteria:
   - routes with `loading.tsx` (`/teams`, `/team-stats`, the three leaderboards, `/trends`, `/run-gaps`, `/team/BUF`, `/player/josh-allen`): **status 200**, and in a browser the page shows that route's 1.4 title. The card is drawn by the error boundary in the browser, so `curl` shows the status but not the card's text: read the card in a browser. On `/player/josh-allen` and `/qb-leaderboard` the first read to fail is the one in `generateMetadata`: the result must still be the error card with status 200 and no `<title>` of its own (I1). A blank page means stop and return to spec review.
   - `/`, `/card/josh-allen`: **500** with "Something went wrong". `/card` must not be the Not Found page.
   - `/compare`: 200 and the error card (the seasons read fails). `/compare?season=2026`: 200 and the tool renders (no read is needed).
   - `/api/health`: 503, `Cache-Control: no-store`, JSON `status: "error"`. `/api/stat-card/josh-allen`: 503, `no-store`, `Retry-After: 60`, body S4.
   - `/glossary`, `/privacy`: 200, unchanged. `/sitemap.xml`: 200 with the 43 static + team URLs (unchanged until PR 3).
4. In a browser, on any page: open search and type a name: team matches (if any) and S1, not "No results". On `/compare?season=2026` type in Player 1: S2. `/compare?season=2026&p1=josh-allen`: S3 above the empty state. Under `next dev` a red error overlay sits on top of the error card: close it (Esc) to see the card (M8).
5. One-click "Try again" (review I3). Use a stub that fails only while a flag file exists and otherwise answers an empty list: `node -e "const fs=require('fs');require('http').createServer((q,s)=>{if(fs.existsSync('fail.flag')){s.writeHead(503);s.end('stub down')}else{s.writeHead(200,{'content-type':'application/json'});s.end('[]')}}).listen(54399)"`. Create `fail.flag`, load `/game/2026_01_BUF_HOU` (error card), delete `fail.flag`, click "Try again" **once**. Expect the Not Found page: proof that the server render re-ran and the boundary cleared on one click.
6. OG images: `@vercel/og` does not render on Windows, so the `no-store` header on a failed-read image cannot be checked locally. Check it on the Vercel preview: `curl -sI <preview>/player/josh-allen/opengraph-image` during a stall, or leave it to the unit test until the next stall.

Result of the 1A run on 2026-10-06 (branch `read-resilience-1a`, `next dev`, stub on 127.0.0.1:54399): every row passed. The seven season pages, `/team/BUF` and `/player/josh-allen` returned 200 and showed their own card; `/player`, `/qb-leaderboard` and the other season pages had no `<title>` (metadata read failed first), `/team/BUF` kept its title (its metadata reads nothing). `/`, `/card/josh-allen` and `/game/2026_01_BUF_HOU` returned 500 with the card; `/card` was not Not Found. `/compare` 200 with the card, `/compare?season=2026` 200 with the tool. `/api/health` 503 `no-store`; `/api/stat-card/josh-allen` 503 `no-store`, `Retry-After: 60`, S4. `/sitemap.xml` 200 with 43 URLs. S1 (under "Buffalo Bills"), S2 and S3 all appeared. One click on "Try again" after the stub recovered turned the `/game` card into the Not Found page. In the browser the stub is another origin with no CORS headers, so the browser-side reads failed as blocked requests rather than as 503s: the same code path (`error` set). The OG image route returned 500 locally (the font path and `@vercel/og` do not work on this machine), so step 6 is still open.

**1B run: a socket that never answers.** Same steps with `node -e "require('net').createServer(()=>{}).listen(54399)"` as the stand-in. Now every row must finish in 5 to 7 s with the same statuses as the 1A run, and S1 appears after about 15 s (browser limit).

Why not a Vercel preview pointed at a dead host: `next build` prerenders `/`, which throws when the database is unreachable, so that deployment never finishes building.

Live, after deploy (6 requests): `/api/health`, `/teams`, `/team/BUF`, `/player/josh-allen`, `/qb-leaderboard`, `/game/2026_01_BUF_HOU` with `-w "%{http_code} %{time_starttransfer} %{time_total}"`. Healthy: all 200, totals under about 2 s, same as before the deploy (take the same six before merging for comparison). During the next stall window (daily 17:15 to 19:30 UTC so far): the same six; nothing should run past about 7 s.

### 1.8 Rollback and risks

Rollback: Vercel Instant Rollback to the previous deployment, or revert the PR. No data or cache state is involved.

| Risk | Handling |
|---|---|
| A slow-but-working database (reads of 5 s+) now shows error cards where the page used to load slowly | intended trade; the constant is one line. Decision 2 |
| Pages that used to render partly empty now show an error card | intended (project rule, Decision 6). The "may degrade" lists keep the harmless cases. What is and is not worse than today (review M6): a read that **hangs** already hangs the whole page (`.catch` only handles rejections), so the card is no worse there. It is worse only for reads that fail **fast** today and leave a half page. After PR 2, one failed live read on `/team` hides content that is sitting in the cache; if 2b slips, a per-section "Couldn't load this section" message on the team page is the alternative. Not built now |
| **What a crawler sees during a stall changes (review I2). Jon's decision: accept it.** Today a crawl during a stall gets a 200 that never finishes, which Google treats as a temporary fetch failure and retries. After PR 1 the same crawl gets a **completed 200 whose content is the error card**: either with an empty head (the metadata read failed) or with the right title and canonical above "Unable to load player data" (the body read failed). Both are soft-404 material. At 1 to 2 hours a day that is roughly 4 to 8% of crawls, and `/player` is about 1,300 of the 1,400 sitemap URLs. It cannot be fixed with a status code: the 200 goes out with the skeleton and Jon keeps `loading.tsx` | No client-side `noindex` on the error card (considered, declined: a page crawled mid-stall would drop out of the index until its next crawl). Shorten the exposure instead: ship PR 2 soon after PR 1, with `getPlayerBySlug` answered from the cached slugs (I5), then 2b. **Jon checks Search Console's "Soft 404" list two weeks after 1B ships** |
| A persistent database problem fails the build on two more homepage reads | same class of failure as today's six; previous deployment stays live |
| +15% requests until PR 2 | quantified in 1.3 |
| Existing tests that assert the old swallow behaviour (for example sitemap and player-route fallbacks) | update them in the same PR; each change is listed in 1.6 |
| Throw inside a component wrapped in `Suspense` on `/player` | the read happens in the page function above the `Suspense`, so the route's `error.tsx` catches it; covered by the route test |

---

## 2. PR 2: cache the season-level reads

Depends on PR 1 (both parts). Without Part A, a swallowed error would be stored as an empty table. Without Part B, a background refresh during a stall would hold the function open for up to 300 s.

### 2.1 Design

One small server-only module, `lib/data/cache.ts`, wrapping Next's `unstable_cache`:

- `DATA_TAG = "ypp-data"`, `DATA_REVALIDATE_SECONDS = 21600` (6 h, review I4), `CACHE_VERSION = "v1"`. Why 6 h and not 1 h: the purge after each refresh is what delivers new numbers, so the window is only a backstop. 6 h matches the refresh cadence and is well past the longest stall seen (2 h 15 min), so an entry almost never expires between two purges, and the design leans far less on the stale path and on gate G1. Jon's range was 3 to 6 h; 6 is chosen because nothing is gained by expiring sooner than the next refresh.
- `readRowsCached(table, select, filters, order)` returns the **raw rows exactly as PostgREST sent them**. Internally one `unstable_cache(fetcher, ["ypp-rows", CACHE_VERSION], { revalidate: DATA_REVALIDATE_SECONDS, tags: [DATA_TAG] })`, called with `(table, select, JSON.stringify(sortedFilters), JSON.stringify(order))`, so the key is fixed text + those four strings.
- The fetcher calls `fetchAllRows` (always with an `order`, see 2.3) and:
  - throws an `Error` on any query error (wrapping `fetchAllRows`' raw rejection);
  - throws a private `EmptyResult` when the read succeeded with **zero rows**. `readRowsCached` catches that one error type and returns `[]`. Effect: an empty answer is never stored, and an empty background refresh never replaces good rows;
  - logs `console.warn` with the table and byte count when `JSON.stringify(rows).length > 1_500_000` (Next is silent when it declines to store an entry).
- Seasons outside 1999 to (current year + 1) skip the cache and read live.
- Per-request memo (2.6) around `readRowsCached`.

Each existing loader keeps its name, signature and return value. Its body becomes: get raw rows from `readRowsCached`, then run the **same** parsing it runs today.

### 2.2 The ten points

**(a) 2 MB per entry.** The check is on the entry JSON, where the rows are stringified twice, so plan for rows JSON under about 1.6 MB. Estimates (row counts from MEMORY and code comments, bytes from the field lists in `lib/types/index.ts`; none measured, the site was stalled):

| Read | Rows | Est. rows JSON | Est. entry | Verdict |
|---|---|---|---|---|
| `data_freshness` (all rows) | 7 | under 1 KB | under 1 KB | fine |
| `team_season_stats` per season | 32 | 15 KB | 18 KB | fine |
| `qb_season_stats` per season | 80 to 110, 36 fields | 100 KB | 120 KB | fine |
| `rb_season_stats` per season | 150 to 250, 26 fields | 150 KB | 180 KB | fine |
| `receiver_season_stats` per season | 450 to 550, 34 fields | 470 KB | 560 KB | fine |
| `player_slugs` (all, `*`) | about 1,300, growing about 300 a year | 300 KB | 360 KB | fine for years |
| `team_situational_stats` per season | 33 teams x situations, 11 fields | under 150 KB | under 180 KB | fine |
| later: `games` per season | 285 | 70 KB | 85 KB | fine |
| later: `team_game_stats`, 30 columns, per season | 544 at season end | 380 KB | 460 KB | fine |
| later: `rb_gap_stats` per season | unknown (paginates, so over 1,000) | 0.5 to 1.5 MB | up to 1.8 MB | **measure first** |
| later: weekly tables for `/trends`, `select *` | receivers about 7,600 by week 18 | about 3.7 MB | over the limit | **must trim** to `player_id, week` + the `SURGE_STATS` columns (about 0.85 MB), one entry per table |

Gate **G2**: on the preview, read the logged byte counts for every cached key before merging.

**(b) Values that do not survive JSON.** The brief says `parseNumericFields` turns null into NaN. It does not: `lib/utils.ts` turns the string `"NaN"` and unparseable strings into **null**, and null stays null. Even so, parsed values can hold `Infinity` or `-0`, which JSON changes. So the cache stores the rows **before** parsing. PostgREST's rows came out of `JSON.parse`, so they contain only strings, finite numbers, booleans, null, arrays and objects, and `JSON.parse(JSON.stringify(rows))` is the same value. Parsing then runs on every request exactly as today. The **values** are identical by construction; the test in 2.5 pins it. The **row order** is not (review M2): three of the seven loaders are single unordered `select`s today, and 2.3 adds an `order` to each. `app/page.tsx` breaks ties explicitly and the boards sort in the browser, so this is expected to be harmless, but the mocked tests in 2.5 cannot see it: check the homepage strips and one leaderboard by eye on the preview.

**(c) Errors and stale entries.** From 0.4:

| Situation | Result |
|---|---|
| fresh entry | cached rows, no database read. With the 6 h window and a purge after each refresh, **this is the normal state during a stall**, and the main stall survival |
| stale entry, database healthy | stale rows now; background refresh; next request gets new rows |
| stale entry, database stalled | stale rows now; background refresh fails after 5 s, is logged, entry stays. Repeats on each request. **This is the stall survival.** |
| no entry, database healthy | reads the database, stores, returns |
| no entry, database stalled | throws after 5 s; nothing stored; error card (PR 1) |
| over 2 MB | never stored; every request reads the database; warning logged by our wrapper |

Honest limits: (1) survival needs an entry to exist; (2) the first read after a purge has no entry (see e); (3) Next will serve a stale entry indefinitely, but whether Vercel still **has** it hours after it expired is not in the source; (4) on a `loading.tsx` route the page's reads run after the shell, and `app-render.js` 938 to 960 collects `pendingRevalidates` once, when the shell is ready, so a background refresh started later is never handed to `waitUntil`, and the miss path's cache write (`unstable-cache.js:160`) is not awaited at all. On Vercel, work left after the response ends is not guaranteed to finish. So neither the stale path's refresh nor a miss's write can be assumed on streamed routes. This is why the design is purge + warm-up + a 6 h window (e), not "let entries go stale and refresh themselves".

Gate **G1** (retention): on the preview, set the window to 60 s temporarily, load a page, wait **3 hours** (the question is whether an entry outlives a 2 h 15 min stall), load again with `NEXT_PRIVATE_DEBUG_CACHE=1` set on the preview and look for `cache-state: stale` (not "no fetch cache entry") in the function log. If G1 fails, pages survive only while an entry is younger than the window, which the 6 h window plus the purge already covers.

Gate **G3** (background refresh on a streamed route): on the preview with a 60 s window, load `/qb-leaderboard`, wait 2 minutes, load it again, then a third time. The log must show `set cache` after the second load and `cache-state: fresh` on the third. If it does not, background refresh is unreliable on streamed routes and the long window plus purge is the only freshness path, which this design already assumes; record the result in MEMORY either way.

G1 and G3 need only a throwaway preview branch with one cached loader. Run them while PR 1 is in review; their results shape PR 2. A custom last-known-good layer is not specified here; it would be a separate spec.

No cap on staleness is added: every page prints "Through Week N · Updated <date>" from the same cache, so old numbers are labelled as old. Decision 3.

**(d) Keys cannot explode.** The key holds table, select, filters, order. No search params (0.4). The only variable is `season`, limited to a plausible range, and an out-of-data season returns zero rows, which is never stored. Upper bound: 8 tables x about 8 seasons + 2 global reads, about 70 entries, about 10 MB.

**(e) Clearing after a refresh: purge only when the site can reach the database, then warm (review I4, replaces rev 1's "the gap is seconds").** `/api/revalidate` adds one line: `revalidateTag("ypp-data")`. The existing `revalidatePath` calls stay.

Why rev 1's "the gap is seconds" did not hold: (1) an entry refills only when someone requests a page that reads it, and on a low-traffic site that can be many minutes, longer for past seasons; (2) the purge wipes every season though only the current one changed; (3) the refresh's success proves the **pooler** path from GitHub, while Vercel uses the **REST gateway**, which is the path that stalls, and refreshes start 2 to 6 hours late, so a successful run plus purge can land just before or inside a stall. After that every miss throws, nothing is stored, and those pages show the error card for the rest of the stall: today's outcome, on exactly the days the cache was meant to help.

So the refresh workflow's revalidate step (`.github/workflows/data-refresh.yml`, and `seed.yml`'s) becomes three steps, **all mandatory**:

1. **Health gate.** `curl -s -o /dev/null -w "%{http_code}" --max-time 8 "$SITE_URL/api/health"`. `/api/health` is a live read through the same REST path the pages use (and after PR 1 answers 503 within 5 s when it cannot read). If the answer is not `200`: **skip the purge this run**, log `::notice::` saying so, and exit 0. The site keeps the previous numbers; the next refresh (about 4 h) or the 6 h window picks the new ones up.
2. **Purge.** The existing POST to `/api/revalidate`, unchanged.
3. **Warm-up**, only after a successful POST, non-fatal (`|| true`, 20 s limit each): GET `/teams`, `/qb-leaderboard`, `/receivers`, `/rushing`, `/team/BUF`. These read every current-season entry PR 2 caches, so the refill happens seconds after the purge, while the gate has just shown the path healthy.

- Past seasons are purged along with the current one and refill on their first visit (review M3: **accepted**). Tagging per season and trimming the `revalidatePath` list would avoid it, at the cost of a second tag scheme and a purge list that must track the season rollover; past-season pages are a small share of traffic and a miss there costs one normal read. Revisit only if past-season error cards show up after a purge.
- The purge is sent after the handler returns and reaches all regions within about 300 ms (Vercel docs).
- Note the existing `revalidatePath("/team", "layout")` style calls are no longer inert: cached reads made while rendering those paths carry the path's soft tag, so those calls also clear them. Harmless, same effect as the tag.
- A render already in flight keeps the rows it has read and may read new rows for the rest. For one response it can show, for example, the old "Through Week" beside new stats. Dynamic pages are not cached, so the next view is consistent. The homepage is the one place this could be stored (for up to an hour): the window is the half second of one render landing on the purge, six times a day. Accepted.
- After the purge every entry is a miss until first read. The warm-up (step 3) is what closes that gap for the current season. If the database stalls between the gate and the warm-up, those pages show the error card until one read succeeds; that window is a few seconds wide.
- The alternative (never purge, short window) was considered and rejected: it leans on the stale path for both freshness and survival, and limits (3) and (4) in (c) are exactly the two unverified behaviours that path needs.

**(f) Homepage.** No change in PR 2: it keeps its own hourly ISR, its direct reads through the same loaders, and the throw rule. Because the loaders are now cached, a background regeneration during a stall gets stale rows instead of throwing and re-saves a good page. A regeneration right after a purge with the database down throws, and Vercel keeps the last good page, as today. The rule "never render an empty homepage" still holds: a cached loader returns real rows or throws. `home-page.test.tsx` is unchanged and must stay green.

**(g) Per-request memo vs data cache.** The data cache is shared across requests and survives deploys. It costs one cache-service round trip per call. A per-request memo removes repeats inside one render (seasons list in metadata + page + hub). Use React's `cache` only through a guard, because the plain `react` build that vitest loads has no `cache` export (MEMORY: importing it makes a route fail under vitest): `const memo = typeof React.cache === "function" ? React.cache : (f) => f`. The memo wraps `readRowsCached` (string arguments). Loaders parse after it, so each caller gets fresh objects and cannot corrupt another's.

**(h) Freshness.** New numbers appear right after `/api/revalidate` runs (the warm-up reloads them). If the health gate skipped the purge, or the POST failed, the site keeps the previous numbers until the next refresh's purge (about 4 h later), or at worst the 6 h window plus one view. The homepage keeps its own hourly ISR and its `revalidatePath("/")`, but it reads through the same cached loaders, so it follows the same rule. Verify after the first refresh following the deploy: `gh run list --workflow data-refresh.yml --limit 1` shows success; then `/api/health` (live read) `last_updated` equals the "Updated" date and "Through Week" on `/teams` and `/qb-leaderboard` within 2 minutes (3 requests). One-time check that the purge works at all: note `/teams`' "Updated" text, wait for a refresh, compare.

**(i) Vercel Hobby.** 2 MB per item; one cache shared by every project in the team, with LRU eviction, so another project writing heavily could evict these entries (they refill on next read); a manual purge in the dashboard clears all projects. No read/write quota is listed on the Data Cache page. Entries persist across deployments, so `CACHE_VERSION` must be bumped whenever a cached read's meaning changes without its table/select/filters changing.

**(j) Not cached, and why.**

| Read | Why not |
|---|---|
| search (`ilike`), Compare client reads | browser-side, free-text, unbounded keys |
| weekly rows per player, pass-location per player | about 1,300 players x seasons; each key is read rarely |
| `getRBGapStatsWeekly(team, situation, zone)` | user-chosen filters, hundreds of combinations |
| everything under `getBoxScore` / `getBoxScoreMeta` | decides pending vs ready for one game; must be live |
| `/api/health` | its job is to read the database |
| `getPlayerBySlug` | **Now in PR 2** (review I5), not as its own entry: it is answered from the cached `player_slugs` rows that loader #1 already stores (find by `slug` in memory). Takes `/card` to zero live reads and removes the first read, and the metadata read, from all 1,300 player pages |
| per-team reads (`getRBGapStats(team)`, `getDefGapStats(team)`, down-distance, schedules, game results) | PR 2b: cache the season-level table once and filter in memory, after measuring sizes |

### 2.3 Which loaders ship when

PR 2 (ranked by requests saved):

| # | Loader | Cached read | Used by |
|---|---|---|---|
| 1 | `getAllPlayerSlugs`, and `getPlayerBySlug` derived from the same rows (I5) | `player_slugs`, `*`, no filter, order `player_id` (2 pages today) | team hub, 3 leaderboards, run-gaps, trends, sitemap; player, card, compare, stat-card, OG images |
| 2 | `getAvailableSeasons` + `getDataFreshness` | one read: `data_freshness`, `*`, order `season` desc; both loaders derive from it | every page |
| 3 | `getQBStats(season)` | `qb_season_stats`, `*`, order `player_id, id` | team hub, QB board, player, card, compare, home |
| 4 | `getReceiverStats(season)` | `receiver_season_stats`, `*`, order `player_id, id`; the optional `position` argument filters in memory | same set |
| 5 | `getRBSeasonStats(season)` | `rb_season_stats`, `*`, order `player_id, id` | same set |
| 6 | `getTeamStats(season)` | `team_season_stats`, `*`, order `team_id` | team hub, teams, home |
| 7 | `getSituationalStats(season)` | `team_situational_stats`, `*`, order `team_id, id` | team hub |

Every cached read passes an `order`: `fetchAllRows` pages without one today, and a skipped or repeated row would be frozen for hours instead of one request. The player tables order by `player_id` then `id` (review M2), so the order means something and is stable, where a random UUID `id` alone would give an arbitrary one. Confirm each table has the ordering columns before coding (`scripts/schema.sql` / `ingest.py`: `id UUID PRIMARY KEY` on the five stat tables, `player_id` PK on `player_slugs`, `season` PK on `data_freshness`; from DDL only, production not checked).

`getPlayerBySlug` from the cached rows keeps 1A's contract: `null` only when the cached list really has no such slug; a failed read with no entry throws.

Requests per view, warm cache:

| Route | Now | After PR 2 |
|---|---|---|
| `/team/[id]` | 14 | 5 (RB gaps, def gaps, down-distance, 2 schedules) |
| `/qb-leaderboard`, `/receivers`, `/rushing` | 5 | 0 |
| `/teams` | 3 | 0 |
| `/player/[slug]` | 5 to 8 | 2 to 4 (weekly rows, cross-link, pass map, game results) |
| `/card/[slug]` | 3 to 4 | 0 |
| `/trends` | 8 | 3 now, more by December (weekly tables) |
| `/run-gaps` | 6 to 8 | 3 to 5 |
| `/team-stats` | 3 | 1 |

What survives a stall after PR 2 (review I5, stated plainly): the routes with **zero** live reads, which are `/teams`, `/qb-leaderboard`, `/receivers`, `/rushing`, `/card/[slug]`, plus the homepage's stored copy. Every other row above still has at least one core live read, and by 1A's rule one failed core read is the error card. That is about 97% of the site's URLs (players, teams, games).

PR 2b (scheduled, own spec review; it is what delivers Jon's goal): `games` per season, gap tables, `team_game_stats`, trimmed weekly tables. After 2b the team hub and player page are 0 to 1 live reads and survive a stall completely.

### 2.4 Files

| File | Change |
|---|---|
| `lib/data/cache.ts` (new) | as 2.1 |
| `lib/data/queries.ts`, `players.ts`, `receivers.ts`, `rushing.ts`, `team-hub.ts` | the 7 loaders read through `readRowsCached`; parsing unchanged |
| `app/api/revalidate/route.ts` | add `revalidateTag("ypp-data")` |
| `.github/workflows/data-refresh.yml`, `seed.yml` | the revalidate step becomes health gate, purge, warm-up (2.2(e)). `SITE_URL` must stay the apex (MEMORY) or the gate sees a 308 and skips every purge |
| `vitest.setup.ts` | `vi.mock("next/cache", ...)` with pass-through `unstable_cache` and `vi.fn()` for `revalidateTag` / `revalidatePath` (real `unstable_cache` throws outside Next) |
| `__tests__/app/revalidate-route.test.ts` | its own mock gains `revalidateTag`; assert it is called with `"ypp-data"` and not called on a bad secret |
| `.claude/CLAUDE.md`, `memory/MEMORY.md` | the rule: season-level reads go through `readRowsCached`; cache raw rows; bump `CACHE_VERSION` |

### 2.5 Tests

`__tests__/data/cache.test.ts` with a small fake `unstable_cache` (a `Map` plus a per-entry "stale" flag) injected through the `next/cache` mock:

1. Miss: fetcher called once, rows returned; second call: fetcher not called.
2. Stale + fetcher resolves: old rows returned; after the background promise, new rows are stored.
3. Stale + fetcher rejects: old rows returned; entry unchanged; nothing thrown.
4. Miss + fetcher rejects: rejects with an `Error` (also when `fetchAllRows` rejected with a plain object); nothing stored.
5. Zero rows: returns `[]`; nothing stored; fetcher runs again next call.
6. Stale + zero rows on refresh: old rows kept.
7. Key: different season, table or select gives different entries; filter key order does not matter.
8. Season 12345 or 1850: `unstable_cache` not called, live read used.
9. Over 1.5 MB: one `console.warn` naming the table.
10. Round trip: for a fixture of raw rows containing `"NaN"`, `"-0.004"`, `null`, a missing field and a long decimal string, `parse(JSON.parse(JSON.stringify(rows)))` deep-equals `parse(rows)` for each of the 7 loaders' field lists.

Loader tests: each of the 7 returns the same value as before for the same mocked rows (existing tests, run under the pass-through mock, are this check). Add: `getAvailableSeasons` and `getDataFreshness(2026)` in one render make one read. `getReceiverStats(2026, "TE")` equals the filtered full list.

Not unit-testable: real `unstable_cache` on Vercel. Covered by G1, G2 and 2.6.

### 2.6 Verifying PR 2

`x-vercel-cache` says nothing here: these pages stay dynamic (`MISS`, `no-store`) by design. Preview URLs need a Vercel login (MEMORY), so preview checks are done in a signed-in browser, with the function logs read in the Vercel dashboard, not with curl. Use:

1. Preview, with `NEXT_PRIVATE_DEBUG_CACHE=1`: load `/qb-leaderboard` twice; the function log shows `set cache` then `got fetch cache entry ... cache-state: fresh`. G1 and G2 as above.
2. Production, 4 requests: `/qb-leaderboard` and `/team/BUF`, each twice, `-w "%{time_starttransfer} %{time_total}"`. Second totals should be clearly lower than the pre-deploy numbers from 1.7.
3. Vercel dashboard, Observability, Runtime Cache: hit rate and writes for the project.
4. Supabase dashboard, Reports, API: requests per hour before and after.
5. Stall survival. There is no way to fake this end to end without a real stall: the cache must first be filled from the real database, and a build pointed at a dead host does not complete (1.7). The unit tests (2.5, cases 2, 3, 6) cover the logic; the live proof is the next real stall window: `/qb-leaderboard`, `/teams`, `/team/BUF` render with data while `/api/health` returns 503. That contrast (health down, pages up) is the proof. 4 requests.
6. Freshness: (h).

### 2.7 Rollback and risks

Rollback: revert the PR or Instant Rollback. Old entries are simply never read again. If wrong data is ever stored: bump `CACHE_VERSION` and deploy, or POST `/api/revalidate`.

| Risk | Handling |
|---|---|
| Vercel does not keep expired entries (G1 fails), or background refresh does not complete on streamed routes (G3 fails) | already assumed: 6 h window, purge and warm-up, as (c) and (e) |
| The health gate skips a purge and the site shows the previous numbers for up to about 4 h more | intended trade (Decision 1): old numbers, labelled with their date, beat error cards |
| Log noise on the stale path (review M9): every failed or empty background refresh logs `revalidating cache with key: <the whole callback source>` at error level (`unstable-cache.js:144`), once per key per view during a stall, and for every table that is legitimately empty | expected; not an incident. Read the function log for our own `console.error` lines, not these |
| A deploy changes the callback's compiled text, so all keys change and the cache starts cold | acceptable: refills on first views; a deploy cannot complete during a stall anyway (homepage prerender throws) |
| Stale shape after a deploy | rows are `select *` straight from the database, so shape follows the database; select lists are part of the key; `CACHE_VERSION` for anything else |
| Shared team cache on Hobby | another project could evict or purge entries; they refill |
| Every view during a stall still fires background refreshes (5 s each, after the response) | bounded by PR 1; same count as today's blocking reads |
| Purge then stall before refill | (e) |
| A table that is legitimately empty (preseason, before week 1) is never stored, so those reads hit the database on every view | same as today, by design: do not "fix" by caching empties |
| An ingest that deletes all rows of a table would not be reflected (empty never replaces rows) | seasons are never emptied by the pipeline; `CACHE_VERSION` bump if it ever happens |

---

## 3. PR 3: sitemap keeps its last good copy

Independent of PR 2; needs PR 1 Part A (so `getDataFreshness` / `getAvailableSeasons` throw).

### 3.1 Behaviour (`app/sitemap.ts`)

| Condition | Now | After |
|---|---|---|
| all reads succeed | full list (about 1,400 URLs) | same |
| player slugs read fails, or returns 0 rows | 43 URLs saved for an hour | **throw** |
| seasons read fails or returns none | no game URLs | **throw** |
| box score seasons probe or game-id read fails | no game URLs | **throw** |
| freshness read fails | no `lastmod` anywhere | **throw** |
| freshness row present but date invalid | no `lastmod` | same (data problem, not a read failure) |
| `hasNoDatabase()` (CI, local placeholder build) | static + team pages | same, no throw |

Every throw is an `Error` (`getPlayedRegularSeasonGameIds` wraps `fetchAllRows`' raw rejection with 1A's `queryError`; the file's comments about loaders that "swallow" errors are corrected). `revalidate = 3600` stays.

`app/api/revalidate/route.ts` is **not** changed (review M4, Decision 5 dropped): no `revalidatePath("/sitemap.xml")`. The hourly regeneration already picks up a new box score within an hour or two, and that path keeps the old copy when a regeneration fails. A purge would add the only way the sitemap can have **no** copy during a stall, and whether `revalidatePath` reaches a metadata route on Vercel is unverified.

### 3.2 What happens when it throws

- Background regeneration (hourly): outside Vercel, Next keeps the old entry and retries in 3 to 30 s (0.4). On Vercel that code path is skipped and the platform does it; the authority is the homepage's observed behaviour recorded in MEMORY ("Vercel keeps the last good copy and retries ~30s later"). **Verify for this route** (3.4).
- First request on a deployment with no copy: 500, not cached. (Nothing purges the sitemap, so "right after a purge" no longer exists.)
- During `next build`: the build fails (`Error occurred prerendering page "/sitemap.xml"`), as the homepage already does when the database is down. Review M5: this is **somewhat more likely to fail a build during a stall** than today, not "no new exposure": the sitemap is about 12 reads in a serial chain and the homepage 8, and under an intermittent stall more reads that must all succeed means more failed builds. Same outcome and same fix: the previous deployment stays live; click Redeploy afterwards. Decision 4.

### 3.3 `lastmod`

Root cause is in the pipeline: `update_freshness` stamps `now()` on every run (MEMORY R7), so `lastmod` moves six times a day. The real fix (stamp only when rows changed) is an ingest change tied to the "silent pipeline failures" follow-up: **not cheap, deferred**.

Cheap site-side step, included: emit `lastmod` as the UTC **date** only (`YYYY-MM-DD` string; Next writes a string as given). It then changes at most once a day. Three lines and one test.

### 3.4 Tests and verification

`__tests__/app/sitemap.test.ts`:

- Each failure row of 3.1 with a real URL stubbed (`vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://abc.supabase.co")`): `sitemap()` rejects with an `Error`, including when the mock rejects with a plain object.
- Same failures with the placeholder URL: resolves with 11 + 32 entries.
- Zero slugs with a real URL: rejects.
- The existing tests "failed freshness gives no lastModified" and "Supabase down gives static + team pages only" are rewritten to the two cases above.
- `lastModified` is the string `2026-09-10` for the fixture; `/glossary` and `/privacy` still have none.
- `revalidate-route.test.ts`: `"/sitemap.xml"` is **not** among the `revalidatePath` calls (M4; guards against it being added back).

Live (3 requests): `curl -sI /sitemap.xml` and count `<loc>`: about 1,400, `lastmod` date-only. Within about two hours of the next refresh: any new box score URL is present. During the next stall: `Age` above 3600 and still about 1,400 URLs (old copy kept). If instead it returns 500 for the whole stall, Vercel is not keeping the copy for this route: return to spec review (the fallback would be a module-level last-good copy).

Right now the live sitemap is the 43-URL copy. It heals itself at the first hourly regeneration after the stall ends; nothing to do.

Rollback: revert. Risk: none beyond 3.2.

---

## 4. Decisions for Jon (all decided, 2026-10-06)

| # | Question | Decided |
|---|---|---|
| 1 | How new numbers reach the site after a refresh | **Changed by the review (I4), accepted.** New numbers show right after each refresh. If the database is unreachable from the site at that moment, the refresh skips the cache clear and the site keeps the previous numbers until the next refresh (about 4 hours). After a clear, the workflow reloads the five main pages at once so their data is back in the cache. Numbers are kept for up to 6 hours as a backstop |
| 2 | How long to wait before showing the error card | **5 seconds** on the server (same as box scores today). **15 seconds** for reads made from the visitor's browser (search, Compare), so a slow phone connection is not reported as an outage (I6) |
| 3 | How old may numbers be during a long outage? | **No limit.** Pages keep the last numbers they had and already print "Through Week N · Updated <date>" |
| 4 | Should a deploy fail when the database is down? | **Yes, as today.** The old version stays live and you click Redeploy later. The sitemap joins the homepage in this, so a deploy tried during a stall is somewhat more likely to fail than today (M5) |
| 5 | Refresh the sitemap right after each data refresh? | **Dropped (M4).** The sitemap already refreshes itself every hour, and that path keeps the old copy if the database is down |
| 6 | Pages that used to load half-empty during a blip now show the error card instead (team page, player page, run gaps) | **Yes.** A page that looks fine with missing numbers is worse. Not worse than today for reads that hang (those already hang the whole page); only for reads that fail fast (M6) |
| 7 | Ship PR 1 as one PR or two | **Two**, a day apart: 1A "failed reads stop looking empty", then 1B "the time limit" |
| I2 | Should the error card tell search engines not to index it? | **No.** Accept the risk that a page crawled mid-stall is read as an error page; check Search Console's "Soft 404" list two weeks after 1B |

Order: 1A, 1B, PR 3, PR 2, then PR 2b. **2b is what delivers the goal** (team and player pages surviving a stall), so it is scheduled work, not an optional extra. Gates G1 and G3 run on a throwaway preview while PR 1 is in review.

---

## 5. What the audit got wrong or left out

1. **"Stalls become fast error pages" (fix 1) is only true where loaders throw.** In about a dozen places a timed-out read becomes a 404 (`/player`, `/card`, stat card), an empty-looking page (team hub, player page, run gaps, leaderboards via `throughWeek ?? 18`), or a false "No results". Hence PR 1 Part A.
2. **The timeout changes the request counts.** A signal on a fetch turns off Next's per-render dedupe, so the audit's per-page counts go up by 1 to 3 until PR 2.
3. **"Until Vercel kills it (40 s+)":** the limit on Hobby is 300 s, so a hang can last five minutes. The repo's own "10s (Hobby)" comment is out of date.
4. **"Pages keep rendering through a stall from cached data" (fix 2)** holds only while an entry exists; the first read after a purge has no fallback; and whether Vercel retains expired entries is unverified (G1).
5. **"`revalidatePath` does nothing useful for per-request routes" (section 6)** is true today but stops being true once `unstable_cache` is in: those calls then clear cached reads made under those paths.
6. **Team hub "14 down to 2 to 4":** with the loaders the audit lists it is 5; 0 to 1 needs PR 2b.
7. **The cache is not per project on Hobby:** all the team's projects share it.
8. **Not the audit, the brief:** `parseNumericFields` does not produce NaN. It maps `"NaN"` to null and keeps null.
9. **Confirmed, not wrong:** the 43-URL sitemap generated at 13:19:54 UTC was still being served at 14:17 UTC, and the stall was still on then (health endpoint no answer in 25 s; four pages sent a skeleton and then nothing for 30 s).

---

## Appendix A: Supabase support ticket (plain text)

Before sending, Jon confirms three things in the Supabase dashboard (review I7). They are not part of the ticket text:

1. **Project ref and region.** Settings, General: the ref is `ljgipucfwuvndoysjjlw` and the region is `us-east-2`. Neither has a recorded source in this spec.
2. **Request volume.** Reports, API: requests per hour for 17:00 to 19:30 UTC on two or three of the stall days. It has not been measured, and the audit could not rule out a daily crawler. If the count is flat, replace the request-volume sentence below with the number ("our request count was flat at about N per hour during the stall"), which is much stronger. If it spikes, that is a finding of its own: do not send the "not our load" section as written.
3. Nothing in the ticket is a secret: the project ref is public (it is in the site's client bundle); there are no keys and no connection string.

Evidence behind each claim: the 522 was observed directly by the controller on 2026-10-02 at about 19:22 UTC, from Vercel iad1, through the site's `/api/health`. The hang figures are no response within 12, 15, 25, 30 and 40+ seconds, plus job-side waits up to about 90 seconds. The once-a-day pattern is 9/30 through 10/5; 9/29 had three failed runs (06:58 UTC, which was the site's own validation bug, fixed in PR #27, and is left out of the ticket; 15:55; 18:38).

Subject: Project ljgipucfwuvndoysjjlw (us-east-2): recurring ~1-2 hour API/pooler stalls continuing after "Intermittent latency in Eastern US" was resolved

Hello,

Project ref: ljgipucfwuvndoysjjlw
Region: us-east-2
Clients affected: Vercel functions in iad1 (REST / PostgREST through the API gateway) and GitHub Actions runners (Postgres through the session pooler, port 5432).

What we see

Since 2026-09-29 the project stalls for roughly one to two hours at a time. During a stall, small indexed REST reads (single-row lookups, a 7-row table) either hang for 12 to 90 seconds or fail, while identical requests in the same minute sometimes succeed in under 250 ms. Outside these windows everything is fast.

This started the same day as your status incident "Intermittent latency in Eastern US" (opened 2026-09-29 16:26 UTC, marked resolved 2026-10-06 12:15 UTC). It is still happening after the incident was marked resolved.

When

- Every day from 2026-09-30 through 2026-10-05, including the weekend, between about 17:15 and 19:30 UTC. Our scheduled job failed exactly once per day in that window (starts between 17:15 and 18:52 UTC); the other five identical runs each day finished normally in 40 to 60 seconds.
- 2026-09-29, the first day: two failed runs, starting 15:55 UTC and 18:38 UTC. The 15:55 run is outside the later daily window.
- 2026-10-06 from about 13:20 UTC until at least 14:17 UTC, which is after the incident was marked resolved. At 14:15 to 14:17 UTC a one-query health check got no response in 25 seconds and four page renders were still waiting on their reads after 30 seconds.

Errors

From GitHub Actions through the session pooler:
- EAUTHQUERY ... connection to database not available
- ECHECKOUTTIMEOUT ... (Session mode)
- statement timeouts on very small upserts that normally take milliseconds (the whole write phase normally takes 6 to 19 seconds and has been flat since mid-September)

From Vercel (iad1) to the project's REST endpoint:
- a Cloudflare 522 response (seen 2026-10-02 at about 19:22 UTC)
- requests that hang with no response

Why we think this is not our load

- The failing job does the same work at the same size as the five daily runs that succeed.
- We are not aware of any change in the site's traffic, and the stalls do not line up with our deploys or data refreshes; the 2026-10-06 stall began about 25 minutes before any deploy and with no refresh running. We have not yet compared this with the project's API request counts and would welcome your view of them (question 1).
- Trivial queries hang next to identical ones that succeed in the same minute.

What we would like to know

1. What do this project's own metrics show in those windows (17:15 to 19:30 UTC daily from 2026-09-30, 15:55 and 18:38 UTC on 2026-09-29, and 13:20 to 14:20 UTC on 2026-10-06): CPU, memory, disk IO budget/burst balance, active and pooled connections, and API gateway request and error counts?
2. Is the project still affected by the Eastern US incident, or by anything on its host, pooler, or gateway path?
3. Is there anything on our side you recommend changing (pooler mode, compute size, region) that would avoid these windows?
4. Is the daily 17:15 to 19:30 UTC pattern known to you?

We can provide exact timestamps of failed requests and GitHub Actions run logs on request.

Thank you.
