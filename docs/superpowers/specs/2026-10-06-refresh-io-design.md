# Refresh IO: what the data refresh writes, and how to make it write almost nothing (spec, 2026-10-06)

**Revision 2** (2026-10-06). Spec review verdict: APPROVED WITH CHANGES; every IMPORTANT (I1 to I7) and MINOR (M1 to M11) finding is applied below. Owner decisions (section 5) are recorded as accepted.

The analysis (sections 1 to 3) was done with no database connection, no env file read and no workflow triggered. The measurement script and its raw output (`measure_writes.py`, `measure_writes.json`) were session scratch files and are not in the repo; the numbers they produced are in section 2.

## Review changes applied (revision 2)

| Finding | Change | Where |
|---|---|---|
| I1 | Schedules are fingerprinted on the rows ingest keeps (the season's rows, `GAMES_COLS` only), hashed after download. The `games.csv` asset digest is not used: it changes when betting lines change. Three API calls, not four | PR A 2, 3 |
| I2 | A wrong skip is bounded: `last_full_run_at` per season, and a full run whenever it is missing or older than 20 hours. One line per run in the Actions step summary. The "rows written on an unchanged fingerprint" warning waits for PR B's counts | PR A 6, 10; PR B |
| I3 | Revalidate bookkeeping: the workflow records a successful POST; `changed` stays true until a revalidate has succeeded after the last data change | PR A 9, 11 |
| I4 | A fingerprint is never recorded for a file that failed to load (participation listed by the API but the download fell back to none) | PR A 8 |
| I5 | PR B's saving reworded: row versions, index writes and dead rows fall; heap pages touched do not | PR B, section 4 table |
| I6 | `ensure_games_table` is gated on the schema hash like the other 17, with its own self-heal inside `ingest_schedules`. A normal run issues 0 DDL statements | PR C 2, 5 |
| I7 | Run-history pattern, the 9/28 PR #24 timing and a fifth evidence item (Vercel logs) added; the "no refresh running" sentence made precise | 3.2, 3.3, 3.4, E |
| M1 | State file keyed by season | PR A 4 |
| M2 | Cache key `ingest-state-<run_id>-<run_attempt>` with `restore-keys: ingest-state-`; the `concurrency` group is load-bearing; no restore/save on the offseason path | PR A 11 |
| M3 | Exact asset-name match; non-200, missing `assets`, missing `digest` all mean "run" | PR A 3 |
| M4 | Code hash covers `ingest.py`, `requirements.txt` and the running pandas / numpy / pyarrow versions | PR A 2 |
| M5 | Schema hash is the sha256 of `ingest.py` (whole file), not `inspect.getsource` over a hand-kept list | PR C 1 |
| M6 | Lock-timeout wording corrected (about 20 s worst case per function; the RLS block swallows the first timeout) | PR C 4 |
| M7 | Self-heal lives in `run_seasons`, once per season, independent of the transient retry counter, under the same deadline | PR C 3 |
| M8 | PR D: the amber badge will appear from mid-January; `changed` includes schedule writes | PR D |
| M9 | Dependencies stated: A and B are independent; **C needs A** (the state file); **D needs B** (the written counts) | section 4 |
| M10 | Stale text fixed: `origin/main` has `ensure_team_game_stats_columns`; `team-radar-pr1` has merged | sections 1, 4 |
| M11 | PR B verify step: the first quiet full run on a GitHub runner must log `written 0` everywhere | PR B |

One deliberate simplification against revision 1, made while applying I1: there is no separate "schedules only" run. With schedules hashed on the kept columns, the schedule fingerprint moves only when a score, date or kickoff time moves, and that is the same moment play-by-play moves. So any differing fingerprint means one ordinary full run (schedules, then the season), which keeps a single code path through `run_seasons`.

## Executive summary

1. One refresh rewrites **about 9,470 rows in 18 tables** (Week 4 data): about 1.4 MB of table data and 0.8 MB of index entries. Measured from the real 2026 files, no database.
2. Counting everything Postgres does around those rows (write-ahead log, checkpoint, later vacuum) a run costs roughly **5 to 16 MB of disk writes**, 30 to 100 MB a day. At Week 18: roughly 17 to 55 MB a run, 100 to 330 MB a day.
3. Supabase Nano's baseline is 5 MB/s and 250 IOPS (docs and the banner agree). That baseline alone allows about 432,000 MB a day. **The refresh's writes are under 0.1% of it. They cannot exhaust the Disk IO budget by themselves.** Confidence: about 90%.
4. Most likely driver (about 60%): **memory**. Nano has "Up to 0.5 GB" for Postgres plus the whole Supabase stack. When RAM runs out the machine swaps to disk, and swap is random small IO that blows through 250 IOPS at once. Supabase's own troubleshooting page lists this first. The uncached site reads (about 14 requests and 1 MB of JSON per team page) are what push memory up.
5. The refresh is still a contributor worth fixing: every run leaves 9,400 dead rows for autovacuum, runs **91 schema statements and 21 commits**, asks for an exclusive lock on 16 tables (site reads queue behind it when the database is already slow), and purges the homepage cache six times a day.
6. Proof it is wasteful: when one game is added, only **232 of 8,730 rows (3%)** really change; a whole new week changes 39%. Re-running on the same file changes 0 rows (checked: 8,730 rows identical).
7. Fix, four small PRs: (A) skip the run when the nflverse data ingest uses has not changed; (C) stop running schema statements every run; (B) write only rows that changed; (D) stamp "last updated" only when something changed. Keep six runs a day. A and C ship first (C needs A's state file); B and D later (D needs B's counts).
8. PR A needs a place to remember the last files seen. **Decided: a small file kept in the GitHub Actions cache, no database change.** A skip can never last more than 20 hours: one run a day is always a full run.
9. The read-side fixes already specced (`read-resilience`: 5 s timeout, cache season tables) cut about 90% of database reads and matter more for memory than anything here. Do those first or alongside.
10. Money: don't pay yet. Send four screenshots (section 3). If the Memory chart shows RAM full and swap in use, Supabase Pro ($25/month, includes Micro: 1 GB RAM, double the IO baseline) is the only fix that adds memory.

---

## 1. What one refresh does (from the code)

Order of work in `run_seasons` → `ingest_schedules` → `process_season` (`scripts/ingest.py` on `origin/main` @ 61c31fe, which includes `ensure_team_game_stats_columns`: 17 `ensure_*` calls in `process_season` plus `ensure_games_table` in `ingest_schedules`).

| Step | What it sends |
|---|---|
| connect | `SET statement_timeout`, commit |
| `ingest_schedules` | `ensure_games_table` (5 DDL, commit), upsert 272 `games` rows, commit |
| `get_existing_through_week` | 1 SELECT |
| 17 `ensure_*` | 86 DDL statements, 17 commits |
| 15 upserts + `upsert_teams` | 9,160 + 36 rows, every one `ON CONFLICT DO UPDATE` with no `WHERE` |
| `generate_player_slugs` | `SELECT player_id, slug FROM player_slugs` (whole table) + a UNION over four season tables, all seasons |
| `cleanup_stale_rows` | 13 `DELETE ... WHERE season = %s AND <id> != ALL(%s)`, 1 `COUNT(DISTINCT game_id)`, 1 game-keyed DELETE |
| `update_freshness` | 1 upsert stamping `now()` |
| commit | 1 |

### 1.1 Schema statements per run (counted from the code)

| Function | Statements | Of which ask for an exclusive table lock |
|---|---|---|
| `ensure_games_table` | 5 (CREATE TABLE, 2 CREATE INDEX, ENABLE RLS, CREATE POLICY) | 2 |
| `ensure_team_season_stats_columns` | 3 ADD COLUMN | 3 |
| `ensure_qb_season_stats_columns` | 5 ADD COLUMN | 5 |
| `ensure_rb_gap_tables` | 3 | 2 |
| `ensure_rb_gap_weekly_tables` | 3 | 2 |
| `ensure_def_gap_tables` | 3 | 2 |
| `ensure_receiver_stats_table` | 16 (CREATE, 3 INDEX, 10 ADD COLUMN, RLS, POLICY) | 12 |
| `ensure_rb_season_stats_table` | 12 (CREATE, 2 INDEX, 7 ADD COLUMN, RLS, POLICY) | 9 |
| `ensure_qb_weekly_stats_table` | 4 | 2 |
| `ensure_qb_weekly_stats_columns` | 2 ADD COLUMN | 2 |
| `ensure_receiver_weekly_stats_table` | 4 | 2 |
| `ensure_rb_weekly_stats_table` | 4 | 2 |
| `ensure_qb_pass_location_tables` | 5 (CREATE, 2 ADD COLUMN, RLS, POLICY) | 4 |
| `ensure_team_down_distance_table` | 4 | 2 |
| `ensure_team_situational_table` | 4 | 2 |
| `ensure_player_slugs_table` | 7 (CREATE, 2 INDEX, 2 ADD COLUMN, RLS, POLICY) | 4 |
| `ensure_team_game_stats_table` | 5 | 2 |
| `ensure_team_game_stats_columns` | 2 ADD COLUMN (+ `SET LOCAL lock_timeout`) | 2 |
| **Total** | **91 DDL statements, 18 commits** | **61 exclusive-lock requests on 16 tables** |

Plus the connect commit, the schedules commit and the season commit: **21 commits per run** (each is a WAL flush to disk).

What those statements cost when nothing needs changing:

- `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`, `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` and `CREATE POLICY` all take an ACCESS EXCLUSIVE lock on the table *before* they find out there is nothing to do. `CREATE INDEX IF NOT EXISTS` takes a lock that blocks writes. Only `ensure_team_game_stats_columns` has a `lock_timeout` (10 s). The other 59 requests wait up to the 180 s statement timeout, and **every site read of that table queues behind the waiting ALTER** (code review M1). On a healthy database this takes milliseconds. On a database that is already slow it turns "slow" into "nothing answers".
- `ENABLE ROW LEVEL SECURITY` rewrites the table's `pg_class` row even when RLS is already on (my reading of Postgres `ATExecSetRowSecurity`; not verified against the running version). That is 14 catalog writes per run, and each one makes every open connection throw away its cached plans for that table.
- The 30 `DO $$ ... EXCEPTION ...` blocks each open a subtransaction.

In IO terms the DDL is small (tens of KB). Its real cost is the lock queue and 18 extra commits.

### 1.2 `cleanup_stale_rows`

Thirteen `DELETE ... WHERE season = 2026 AND id != ALL(list)` statements. They normally delete nothing, so they write nothing. But they must *read* every 2026 row to find that out, and on seven tables no index starts with `season` (`rb_gap_stats`, `rb_gap_stats_weekly`, `def_gap_stats`, `qb_pass_location_stats`, and the three weekly tables whose indexes are `(player_id, season, week)` and `(team_id, season)`), so Postgres most likely scans the whole table, all seasons. `find_unslugged_players` scans four more season tables in full. Call it one full read of most of the database per run: cheap if the data is in memory, real disk reads if memory is tight.

## 2. Measured write load per run

### 2.1 Method

`measure_writes.py` stubs `load_dotenv` and removes `psycopg2.connect`, loads the cached real play-by-play (`team-radar/pbp_2026_real.parquet`: 11,155 rows, weeks 1 to 4, 64 games), downloads the 2026 roster and schedules the way ingest does, and calls every `aggregate_*` with the arguments `process_season` uses, plus `generate_player_slugs(conn=None)`. `download_participation(2026)` returned 404: **there is no 2026 participation file**, so route and snap columns are NULL on every run.

Bytes per row are **not** DataFrame memory (a float64 is not a NUMERIC). For each row actually sent I sized the stored tuple from the DDL types: 23-byte header plus null bitmap padded to 8; UUID `id` 16; INT 4 (aligned); TEXT 1 + length; NUMERIC 3 + 2 bytes per four digits of `repr(float)` (what psycopg2 sends, usually 16 to 17 digits, so 11 to 13 bytes); TIMESTAMPTZ 8; tuple padded to 8; plus the 4-byte line pointer. Index entry: 8-byte header + key, padded to 8, + 4. Treat every byte figure as **plus or minus 30%**. Indexes are from the DDL in `ingest.py` and `schema.sql` (primary key and each UNIQUE constraint count as an index). An index added by hand in the Supabase dashboard would not show here.

### 2.2 Per table, now (through Week 4)

| Table | Rows per run | Bytes/row | Table KB | Indexes | Index bytes/row (all) | Index KB |
|---|---|---|---|---|---|---|
| `rb_gap_stats_weekly` | 4,637 | 132 | 598 | 2 | 81 | 369 |
| `receiver_weekly_stats` | 1,028 | 154 | 155 | 3 | 84 | 84 |
| `rb_gap_stats` | 666 | 122 | 80 | 2 | 64 | 42 |
| `team_down_distance_stats` | 434 | 107 | 46 | 3 | 77 | 33 |
| `player_slugs` | 430 | 179 | 75 | 4 | 106 | 45 |
| `qb_pass_location_stats` | 372 | 183 | 67 | 2 | 75 | 27 |
| `receiver_season_stats` | 362 | 240 | 85 | 5 | 124 | 44 |
| `rb_weekly_stats` | 329 | 168 | 54 | 3 | 84 | 27 |
| `games` | 272 | 116 | 31 | 3 | 68 | 18 |
| `team_situational_stats` | 229 | 148 | 33 | 3 | 82 | 18 |
| `def_gap_stats` | 224 | 112 | 25 | 2 | 56 | 12 |
| `qb_weekly_stats` | 143 | 216 | 30 | 3 | 84 | 12 |
| `team_game_stats` | 128 | 484 | 61 | 4 | 104 | 13 |
| `rb_season_stats` | 97 | 196 | 19 | 4 | 96 | 9 |
| `qb_season_stats` | 49 | 308 | 15 | 4 | 104 | 5 |
| `team_season_stats` | 32 | 194 | 6 | 3 | 68 | 2 |
| `teams` | 36 | about 80 | 3 | 1 | 16 | 1 |
| `data_freshness` | 1 | 44 | 0 | 1 | 16 | 0 |
| **Total** | **9,469** | | **1,380 KB** | **52** | | **760 KB** |

`rb_gap_stats_weekly` alone is half the rows and 43% of the bytes.

**HOT updates.** A HOT update writes only the table, not the indexes. It needs (1) no indexed column to change *value* and (2) free space on the same 8 KB page. Condition 1 holds for every table: the `SET` lists include some indexed columns (`team_id`, `season`, `week`, `current_team_id`) but their values do not change unless a player is traded. Condition 2 is not guaranteed: tables are at the default fill, and room appears only as earlier dead rows are pruned. Expect **mostly HOT in steady state, not always**. So each run writes between 1.4 MB (all HOT) and 2.1 MB (none HOT) of new tuple and index data.

### 2.3 From row bytes to disk bytes

| Component | Per run now | Why |
|---|---|---|
| New row versions (table) | 1.4 MB | every row is rewritten, changed or not |
| Index entries | 0 to 0.8 MB | 0 if HOT |
| WAL: row records | about 2 MB | row + about 60 bytes each |
| WAL: full-page images | 1.5 to 4 MB | runs are 4 h apart, so the first touch of every page after a checkpoint logs the whole 8 KB page; roughly 200 to 500 pages |
| Checkpoint writing those pages | 1.5 to 4 MB | |
| Autovacuum later (only on runs that trigger it) | 0 to 4 MB | cleans the 9,400 dead rows; re-dirties the same pages |
| **Total** | **about 5 to 16 MB** | |

Per day (6 runs): **30 to 100 MB**, about 57,000 dead rows.

Week 18 projection: the five per-week tables scale with games (272 / 64 = 4.25x); the season tables grow about 1.5x as more players appear. That gives about **31,000 rows, 4.5 MB table, 2.5 MB index per run; 17 to 55 MB of disk writes per run; 100 to 330 MB and about 190,000 dead rows a day.**

In operations: a run is roughly 500 to 2,000 page-sized writes plus 21 commit flushes, spread over the 6 to 19 s database phase.

### 2.4 How much of it is wasted (measured)

| Scenario | Rows inserted | Rows really changed | Rows identical | Share that needed writing |
|---|---|---|---|---|
| Same file again (5 of 6 runs on a quiet day) | 0 | 0 | 8,730 | **0%** |
| One game added (`2026_04_TEN_BAL`) | 120 | 112 | 8,498 | **3%** |
| A whole week added (16 games) | 1,762 | 1,624 | 5,344 | **39%** |

(The 14 aggregate tables; `games` and `player_slugs` not included.) Per-week tables never change old rows: all their writes are inserts. The "same file again" row is also the float-noise check: aggregating twice gave bit-identical values in all 8,730 rows.

## 3. Is this what is exhausting the Disk IO budget?

### 3.1 Supabase's numbers (fetched 2026-10-06)

| Fact | Value | Source |
|---|---|---|
| Nano memory | "Up to 0.5 GB", shared CPU, $0 | https://supabase.com/docs/guides/platform/compute-and-disk |
| Nano disk baseline | 5 MB/s, 250 IOPS | same page, disk table |
| Nano disk maximum (burst) | 261 MB/s, 11,800 IOPS | same |
| Micro | 1 GB, 11 MB/s, 500 IOPS baseline, about $10 | same |
| Small | 2 GB, 22 MB/s, 1,000 IOPS, about $15 | same |
| Connections, Nano and Micro | 60 direct, 200 pooler clients | same |
| Budget rule | "Compute sizes up to 2XL can burst above their baseline for short periods of time, drawing on a disk IO budget. Once the budget is exhausted, performance returns to baseline." | same |
| Reading the gauge | "If the Disk IO % consumed stat is more than 1%, it indicates that your workload has exceeded the baseline IO throughput during the day." | same |
| When it runs out | "Response times on requests can increase noticeably", "CPU usage rises noticeably due to IO wait", "Your instance may become unresponsive" | https://supabase.com/docs/guides/troubleshooting/exhaust-disk-io |
| Causes Supabase lists | "When your memory usage is high, the operating system might frequently move parts of the memory back and forth of the swap space on the disk"; low cache hit rate; queries over 1 second | same |
| Where to look | "head over to Database Health in the Observability section" | same |

| The machine underneath (AWS t4g.nano) | baseline 43 Mbps = 5.38 MB/s and 250 IOPS; maximum 2,085 Mbps = 260.62 MB/s and 11,800 IOPS; "These instances can sustain the maximum performance for 30 minutes at least once every 24 hours, after which they revert to their baseline performance." | https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/ebs-optimized.html |

Docs versus the banner: **they agree** on the 5 MB/s baseline, and Supabase's Nano row is AWS's t4g.nano row rounded. Supabase's current pages do not state the size of the budget; AWS's does: about **30 minutes at full burst per 24 hours**. The banner's "refills whenever disk IO demand is at or below baseline" is the only refill statement I have; the exact refill rate is not published. Free-plan reports go back 24 hours only (https://supabase.com/docs/guides/monitoring-and-debugging/reports).

What that budget means in practice (my arithmetic from the AWS figures, an illustration, not a documented formula): 30 minutes at 11,800 IOPS is about 21 million operations above baseline. Something running steadily at 1,000 IOPS, 750 over the line, would drain that in roughly 8 hours: a daily pattern. The refresh spends a few seconds near the line, six times a day: about a minute a day in total.

### 3.2 The arithmetic

- Baseline alone, never touching the budget: 5 MB/s x 86,400 s = **432,000 MB a day**, and 250 IOPS = 21.6 million operations a day.
- The refresh: **30 to 100 MB a day now, 100 to 330 MB at Week 18**: under 0.1%.
- One run puts 5 to 16 MB on disk over 6 to 19 s: 0.3 to 2.7 MB/s, *under* the 5 MB/s baseline. In operations it is 500 to 2,000 over the same seconds: around the 250 IOPS line, for a few seconds, six times a day.
- The other five daily runs do the identical writes and finish in 40 to 60 s. Only the afternoon one fails.
- **Hard ceiling, needing no estimates (review).** The healthy database phase is 6 to 19 s. Even if a run sat at the burst maximum the whole time: 19 s x 11,800 IOPS x 6 runs = 1.3 million operations a day, about 6% of the 21 million burst budget. This compares against the budget itself, not the baseline, so it is the stronger argument.
- The full-page-image estimate in 2.3 may be 5 to 10 times low on runs that are not HOT (index entries for 2026 are scattered through all-season indexes): realistic worst case about 60 MB a run, 350 MB a day now. Still under 0.1% of baseline, and a checkpoint spreads it over minutes.
- A completely cold run reads at most 10,000 to 20,000 pages (the whole database is roughly 8,000 to 13,000 pages); six a day is 0.1 million of the 21.6 million baseline operations.

**Verdict: the refresh's writes are not what is exhausting the budget (about 90% sure; the reviewer puts refresh IO as primary cause at under 5%).** Being wrong would need a write amplifier I cannot see from here, for example a large hand-made index, or a table bloated far beyond its live rows.

### 3.3 What probably is

Ranked, with my honest odds:

1. **Memory pressure and swap (about 60%).** 0.5 GB holds Postgres, PostgREST, the pooler, auth, realtime, storage and monitoring agents. Swap is 4 KB random IO: 250 IOPS is 1 MB/s of swapping, so even light swapping sits above baseline all day, and the budget drains until the afternoon. What pushes memory up is concurrency on the read side: nothing is cached, a team page is about 14 requests and 1 MB of JSON, a crawl of the sitemap is about 10,000 requests (`db-load-audit.md`). The refresh adds its share: a full-database read from the cleanup scans, and autovacuum/analyze workers started by its dead rows.
2. **A daily read burst, such as a crawler (about 20%).** Same mechanism, but driven by one visitor. The sitemap's `lastmod` moving every 4 hours (because `update_freshness` stamps `now()` every run) invites recrawls. That part *is* the refresh's doing.
3. **Supabase platform trouble first, budget second (about 15%).** Their "Intermittent latency in Eastern US" incident began the same day (9/29). Slow gateway, hung requests pile up, memory rises, swap, budget. But it was marked resolved 10/6 12:15 UTC and this project stalled again at 13:19, with the budget banner showing: that moves weight to 1 and 2.
4. **Refresh writes (under 10%).**

**Two pieces of evidence added in review (I7), both pointing at a daily-clocked read load:**

- **Run history.** Zero failures 9/26 to 9/28. On 9/29 (the Supabase incident day) three runs failed across slots (06:58, 15:55, 18:38 UTC). From 9/30 to 10/5 there was exactly one failure a day, every one the run that started between 17:15 and 18:52 UTC (9/30 18:26, 10/1 18:52, 10/2 18:24, 10/3 17:15, 10/4 17:34, 10/5 18:31), and none at any other time of day. The 10/5 21:05 run succeeded but took 11 minutes, so that stall lasted about 3 hours. A fixed clock time, whatever number of refreshes ran earlier that day, means a daily-clocked load, not six evenly spaced writes.
- **What shipped the day before it started.** PR #24 merged 9/28 17:57 UTC: the sitemap went from frozen to regenerating hourly with a moving `lastmod` on about 1,400 URLs, and `/api/health` began reading the database on every call. PR #26 (Team Stats) merged 9/29 14:25 UTC. First failure: 9/29 06:58 UTC, 13 hours after #24. That fits at least as well as the Supabase incident.

The reviewer's ranking, close to the one above with more weight on a crawler: read-driven load exhausting memory on a 0.5 GB machine 65% (a clocked crawler or poller reacting to the newly live sitemap about 30%, general uncached reads 35%); Supabase platform 15%; unknown 15%; refresh IO under 5%.

One real refresh-side mechanism that is not about IO volume: once the database is slow, the afternoon run's 61 exclusive-lock requests (59 of them with no lock timeout) can hold site reads in a queue for up to 180 s per table, and `run_seasons` retries the season twice. That can stretch a slowdown into an outage. PR C removes it.

### 3.4 Evidence to ask Jon for (four screenshots and one log view)

Take the screenshots right after a stall, with the time range set to **Last 24 hours**. Items 1 to 4 are in the Supabase dashboard, left menu **Observability** (older layout: **Reports**). Item 5 is in Vercel and needs no Supabase access; it is the quickest way to confirm or kill the crawler theory.

1. **Database → "Memory usage" chart.** Is the bar nearly full all day? Is there a "swap" colour, and does it grow before the stall?
2. **Database → "Disk IOPS" chart, plus the "Disk IO budget" / "Disk IO % consumed" gauge** (Database Health). Does it sit above 250 for hours, or only show six thin spikes? Is it mostly reads or mostly writes?
3. **Database → "CPU usage" chart.** Is there a tall "iowait" band during the stall?
4. **API Gateway → "Total Requests" and "Response Errors".** Do requests jump before the stall starts, or stay flat?
5. **Vercel → project → Logs, 16:00 to 19:00 UTC, grouped by user agent and by path** (`/sitemap.xml`, `/api/health`, `/player/*`), compared with the same window on 9/27. Is one crawler or poller responsible for most requests? Is anything polling `/api/health`?

How to read them:

| What the charts show | Meaning |
|---|---|
| Memory full, swap in use, IOPS above 250 for long stretches that do not line up with the six refresh times | Memory (cause 1). Caching reads helps; more RAM (Pro) fixes it |
| Requests jump shortly before the stall, IOPS mostly reads | A read burst (cause 2). Caching reads fixes it |
| Six sharp write spikes a day and the budget steps down at each | The refresh (cause 4). This spec fixes it |
| Memory fine, IOPS low, requests flat, errors anyway | Supabase's side (cause 3). Send the support ticket in the read-resilience spec |

## 4. The fix: four small PRs, ranked by IO saved per unit of risk

All four go on top of `main` (`team-radar-pr1` has merged). **Dependencies: A and B are independent. C needs A** (it stores its schema hash in A's state file). **D needs B** (it reads B's written counts). A and C therefore ship together as one pull request with two commit series; B and D follow later. Each is safely revertable: with no state file (PR A reverted, or a local / seed run) PR C's code runs the schema statements every time, exactly as today.

Tests: `tests/test_refresh_io.py` (PR A), `tests/test_refresh_workflow.py` (PR A, the workflow checklist) and `tests/test_refresh_ddl.py` (PR C), using the `FakeConn` / `FakeCursor` / `monkeypatch` pattern of `tests/test_refresh_resilience.py`. No test touches the network: the GitHub API call and the downloads are faked.

| PR | Saves | Risk |
|---|---|---|
| A. Skip when sources unchanged | everything (writes, reads, DDL, connection, cache purge) on every run where neither the three nflverse files nor the kept schedule rows changed, except one full run a day | low: when unsure it runs, and a skip never outlives 20 hours |
| C. No DDL on normal runs | all 91 statements, 18 of 21 commits, all 61 exclusive locks on the runs that remain | low: self-heals if a table or column is missing |
| B. Write only changed rows | 60 to 97% of new row versions, index writes and dead rows on the runs that remain (heap pages are still touched: see PR B) | medium: touches 17 SQL statements |
| D. Stamp freshness only on change | sitemap and "last updated" churn; cache purges | low |

### PR A: skip the run when nflverse has not changed

**What ingest downloads** (verified): `play_by_play_{season}.parquet` (release tag `pbp`), `roster_weekly_{season}.parquet` (`weekly_rosters`), `pbp_participation_{season}.parquet` (`pbp_participation`; no 2026 file yet), and `games.csv` (`schedules`).

**How to tell a file changed.** A HEAD on the download URL is useless: it answers 302 to a signed storage URL with no ETag (checked). The GitHub release API is the right source: `GET https://api.github.com/repos/nflverse/nflverse-data/releases/tags/<tag>` lists every asset with `name`, `size`, `updated_at` and **`digest` (`sha256:<hex>` of the file)**. Each file is re-uploaded at least daily, so compare the **digest** (content), not the upload time. Whether nflverse's daily rebuild yields the same bytes when no play changed is unknown; if it does not, runs are simply not skipped (today's behaviour) and PR B is the backstop.

**`games.csv` is the exception (I1).** Its digest changed twice in 80 minutes on a Tuesday with no games: the file carries about 46 columns (betting lines and other pre-game fields) and ingest keeps 11. So schedules are fingerprinted on **what ingest uses**: download `games.csv` every run (2 MB from GitHub, no database), take the season's rows projected to `GAMES_COLS`, cleaned exactly as `ingest_schedules` sends them, sort by `game_id`, and sha256 a canonical JSON serialisation. The row-building code is shared with `ingest_schedules` so the hash cannot drift from what is written. The download is cached in the process, so a run that goes ahead does not fetch it twice.

**Behaviour.**

1. **Flags.** `--state-file PATH` and `--force`. Without `--state-file` (local runs, `seed.yml`) nothing changes: always a full run, call for call. `--dry-run` never reads or writes the state file.
2. **Fingerprint, per season, five parts.**
   - `code`: sha256 over the bytes of `scripts/ingest.py` and `scripts/requirements.txt` plus the running pandas, numpy and pyarrow versions (numpy is unpinned and float results can move with it). Any code or library change forces one full run with nobody having to remember a version number.
   - `pbp`, `roster`, `participation`: the asset's `digest` from the release API, or the literal `absent` when the release lists no asset with that **exact** name. Exact matters: the pbp release holds four `play_by_play_2026.*` files (`.csv.gz`, `.rds`, `.qs`, `.parquet`) and a loose match would pin the wrong one for ever.
   - `schedules`: the kept-rows hash described above.
3. **Reading the API.** Three calls (`pbp`, `weekly_rosters`, `pbp_participation`), made before any database work, sent with the workflow's own token (`GH_TOKEN`) when present so the shared-runner anonymous limit of 60 an hour does not apply. The token is never logged. One attempt each, 20 s timeout, no retries. Any exception, any non-200 answer, a body without an `assets` list, or an asset with no `digest` makes that part **unknown**. A failed `games.csv` download makes `schedules` unknown.
4. **State file** (JSON, keyed by season so a manual `season=2025` run cannot overwrite 2026's entry):

   ```json
   {
     "version": 1,
     "schema_hash": "<sha256 of ingest.py>",
     "last_change_at": "2026-10-06T17:40:12Z",
     "seasons": {
       "2026": {
         "code": "...", "pbp": "sha256:...", "roster": "sha256:...",
         "participation": "absent", "schedules": "...",
         "last_full_run_at": "2026-10-06T17:40:12Z"
       }
     }
   }
   ```

   Beside it, in the same directory, the workflow keeps `revalidated_at` (one UTC timestamp, see point 9). The state file is written atomically (temp file, then rename). A failure to write it is logged as a warning and never fails the run: the next run is then a full run.
5. **Decision, per season, before connecting.** First match wins:

   | Condition | Result | Reason logged |
   |---|---|---|
   | `--force` | run | `forced` |
   | state file missing | run | `state file not found` |
   | state file unreadable, not JSON, wrong shape or version | run | `state file unreadable` |
   | no entry for this season | run | `no stored fingerprint` |
   | any of the five parts unknown | run | `could not read <part>` |
   | any part differs from the stored one | run | `<part> changed` (all that differ are named) |
   | `last_full_run_at` missing, unparseable, in the future, or older than 20 hours | run | `max skip age` |
   | otherwise | **skip** | `skipped: sources unchanged` |

   With `--all`, each season is decided separately and only the seasons that need it are run.
6. **The 20-hour bound (I2).** A skipped run is green in the Actions list, and the state can say "done" while the site is behind (database restored or replaced, a `seed.yml` or local run from other code, a bug in the fingerprint). Without a bound that would heal only when nflverse next changes bytes. With it, one run a day is always a full run. Twenty hours, not 24, so a late-starting slot still gives one full run every calendar day.
7. **A skipped run never opens a database connection** (`psycopg2.connect` is not called) and downloads no parquet file. It logs `skipped: sources unchanged (pbp d1689918, roster e08336ec, participation absent, schedules 1896f36a)`. If every requested season is skipped the process exits 0 without connecting.
8. **Recording (after the commit, never before; I4).** A season's fingerprint and `last_full_run_at` are written only after `process_season` returned normally (its commit succeeded), and only when all of these hold:
   - every part of the fingerprint was known;
   - the schedules ingest of that attempt did not fail (its failure is only a warning in `run_seasons`, so it must be checked explicitly);
   - **the participation file that the API listed was actually loaded.** `download_participation` returns nothing on any error, including the few-second 404 during an nflverse `--clobber` upload; the season then commits with routes and snaps as NULL. If the API showed a digest but the load fell back, the fingerprint is not recorded.

   When the season committed but any condition fails, the season's stored entry is **removed** (and the reason logged), so the next run is a full run. Removing rather than keeping matters: a forced run that wrote NULL routes must not leave an older, still-matching entry behind. `DataNotYetPublished`, `DataQualityError` (truncation guard) or any exception records nothing and leaves the stored entry alone (the season's transaction rolled back, so the database still matches it).

   The state file is saved straight after each season, so a later season failing in an `--all` run does not lose an earlier one.
9. **`changed` and the revalidate POST (I3).** `last_change_at` is stamped whenever a run commits anything (schedule rows or a season). The workflow's revalidate step writes `revalidated_at` only on HTTP 200. Ingest writes `changed=true|false` to `$GITHUB_OUTPUT`:
   - `true` when this run committed data;
   - `true` when `last_change_at` has no `revalidated_at` at or after it (the last POST failed, or never ran), **even on a skipped run**;
   - `true` on any doubt (no state file in use, unparseable timestamps);
   - `false` only on a skip whose last data change is covered by a successful revalidate.

   Until PR B there are no written counts, so every run that is not skipped counts as a data change.
10. **One line per run in `$GITHUB_STEP_SUMMARY`** so the Actions list tells runs apart without opening logs: `2026: skipped: sources unchanged`, `2026: full run (pbp changed): 9,469 rows sent`, `2026: full run (forced): ...`, `2026: full run (max skip age): ...`, or `2026: FAILED (...)`.
11. **Workflow (`data-refresh.yml`).** No change to the cron lines or the `concurrency` group.
    - `actions/cache/restore@v4`, path `.ingest-state`, `key: ingest-state-${{ github.run_id }}-${{ github.run_attempt }}`, `restore-keys: ingest-state-`. The key never matches (it is new every run); the restore-key prefix picks the newest saved state. A bare prefix as `key` would never match.
    - Ingest runs with `--state-file .ingest-state/state.json`, `GH_TOKEN: ${{ github.token }}`, and `--force` when the new `workflow_dispatch` checkbox **`force`** is ticked.
    - The revalidate step runs when `changed` is not `false`, and on HTTP 200 writes `.ingest-state/revalidated_at`.
    - `actions/cache/save@v4` under the same run_id + run_attempt key, `if: always()` when the state file exists, **after** the revalidate step so the marker is saved with it. The attempt number matters: a re-run of a failed job reuses `run_id`, cache keys are immutable, and without it the save would be silently refused.
    - Restore and save are skipped on the offseason path. The keepalive step still runs every time.
    - **The `concurrency: data-refresh` group is load-bearing for this design**: it serialises restore, ingest, save, so a queued run restores what the previous one saved. Do not remove it.
    - Scheduled runs use the default branch's cache. A manual run from another branch can read main's cache but saves into its own scope, which is the right behaviour. Eviction (GitHub drops entries unused for 7 days) or a miss means a full run. No extra permission is needed.
    - `seed.yml` is not changed and passes no state file: always a full run with DDL, as today.
12. If nflverse re-uploads between the digest read and the download, the stored digest is the older one and the next run runs again: an extra run, never a missed one.
13. Before the season's first play-by-play file exists, every run is `DataNotYetPublished`, nothing is recorded, and every run does what it does today (schedules upsert, then the skip message). Nothing is saved there and nothing is lost.

**Where the state lives (decided: Actions cache file).**

| | Actions cache file (chosen) | New private table `ingest_state` (rejected) |
|---|---|---|
| Database change | none | one small table. Needs a schema change |
| Skipped run touches the database | no | yes: one connect and one SELECT |
| Can it wrongly skip? | only if the database loses data some other way (project recreated, tables emptied by hand). Bounded at 20 hours by point 6; immediate fix: run with `force` ticked | no: state and data commit together |
| Cache lost (GitHub evicts after 7 days unused) | next run is a full run: safe | n/a |

A column on `data_freshness` was considered and rejected: every page reads that table with `select *`, so a new column changes what the site receives.

**Tests.** State file missing → full run. State unreadable → full run. Same fingerprint and fresh `last_full_run_at` → `psycopg2.connect` never called, log line present, `changed=false`. Each one of the five parts differing, alone → full run. Participation goes from `absent` to present → run. A betting-line-only change in `games.csv` → same schedules hash, no connect. A score change → different hash. `--force` → run. API raises / returns 403 / body has no `assets` / asset lacks `digest` → run. Exact asset name: `play_by_play_2026.csv.gz`, `.rds`, `.qs` and `games.qs` are never matched. `last_full_run_at` 21 hours old with an identical fingerprint → run; 19 hours → skip. State saved only after the commit (`process_season` raises → nothing recorded; `DataNotYetPublished` → nothing recorded). Participation listed but load failed → entry removed, next run is full. Schedules ingest failed → not recorded. Season-keyed: a 2025 run leaves 2026's entry intact. Revalidate bookkeeping across three runs: full run with a failed POST → the next (skipped) run says `changed=true` → marker written → the next skip says `changed=false`. Step summary line for skipped, full and forced runs. Token never appears in `caplog`. No `--state-file` → today's behaviour, call for call (the existing `tests/test_refresh_resilience.py` passes unmodified). `--dry-run` writes no state. A workflow check (YAML parsed in a test when PyYAML is installed): revalidate gated on `changed`, keepalive `if: always()`, cron lines and concurrency group unchanged.

**Verify after merge (no database access).** `gh run view <id> --log`: the first run after merge says `full run (state file not found)`; later quiet runs say `skipped: sources unchanged` and finish in under a minute with the revalidate step skipped; at least one run a day says `max skip age` or names a changed part. If nearly every run is full because `pbp changed`, nflverse's rebuilds are not byte-stable and PR B carries the load.

**Rollback.** Revert the PR; or, without a deploy, tick `force` (manual run) or delete the cache entries. Leftover cache entries are harmless.

### PR C: stop running schema statements on every run

**Behaviour.**

1. **Schema hash (M5)** = sha256 of `scripts/ingest.py`, the whole file, computed at start-up. It is simpler than hashing a hand-kept list of functions, cannot miss DDL built from a module constant or a 19th `ensure_*` function, and costs one DDL pass per `ingest.py` change, which is exactly when one is wanted: the first run after a column-adding change does the DDL pass before the upsert that needs the columns, with no self-heal round trip.
2. **Gate.** The state file holds `schema_hash` (top level: the schema is database-wide, not per season). When it matches and `--force` is not set, `process_season` skips its 17 `ensure_*` calls and logs `schema unchanged: skipped 17 ensure steps`, and `ingest_schedules` skips `ensure_games_table` (I6). When it differs, or there is no state file (local runs, seed, first run, cache lost, PR A reverted), they run exactly as today, in the same order. The hash is stored after a season commits in a run where the ensure steps ran and the schedules ingest did not fail.
3. **Self-heal, season (M7).** In `run_seasons`, a separate `except (UndefinedTable, UndefinedColumn)`, placed before the transient-error handler (the two classes do not overlap). If the ensure steps were skipped for that attempt and the season has not healed already: roll back, log a warning, and retry the season once with the ensure steps switched on. It has its own once-per-season flag, independent of the transient retry counter, and obeys the same run deadline (no retry unless a full attempt still fits). Because each `ensure_*` commits by itself, the repair survives a later transient retry. A second `UndefinedTable` / `UndefinedColumn`, or one raised while the ensure steps were on, is raised as today. `get_existing_through_week` reads `data_freshness`, which no `ensure_*` creates: a missing `data_freshness` therefore fails once more after the heal and is raised, never looped.
4. **Lock timeout (M6).** Every `ensure_*` function, all 18, issues `SET LOCAL lock_timeout = '10s'` as its first statement, inside its own transaction (each commits by itself, so each must set it), as `ensure_team_game_stats_columns` already does. For a bare `ALTER` or `CREATE INDEX` a timeout raises `LockNotAvailable`, which `run_seasons` already retries. In the 14 functions with an `ENABLE ROW LEVEL SECURITY` block, that block's `EXCEPTION WHEN others THEN NULL` swallows the first timeout; the `CREATE POLICY` that follows waits again and raises. So the worst case is about 20 s per function, not 10. Harmless (RLS is already on); the handlers are not changed in this PR.
5. **Self-heal, schedules (I6).** `run_seasons` turns any schedules failure into a warning, so a missing `games` table would never reach point 3. The fix is local to `ingest_schedules`: when `ensure_games_table` was skipped and the upsert raises `UndefinedTable` / `UndefinedColumn`, roll back, run `ensure_games_table`, retry the upsert once. A second failure goes to the existing rollback-and-warning path.
6. **Result.** A normal full run issues **0 DDL statements** and 3 commits (connect, schedules, season) instead of 91 and 21.
7. Accepted loss: today a policy or index dropped by hand in the dashboard is recreated by the next run. After this PR it comes back only when `ingest.py` changes, the cache is lost, or someone ticks `force`. A dropped table or column still self-heals.

Not chosen: a `--migrate` flag someone must remember to pass (fragile for a one-person project); a catalog check against a hand-kept list of expected columns (the list drifts from the DDL).

**Tests.** Matching hash → no cursor executes text containing `ALTER`, `CREATE` or `DO $$` anywhere in the run (schedules included): DDL count 0, commits 3. Different hash, no state file, or `--force` → the same statement list as today, in the same order (the existing order test in `tests/test_team_game_stats_pipeline.py` passes unmodified). Hash stored only after the season commit. `UndefinedColumn` with ensure skipped and the transaction aborted → rollback first, then the ensure steps, season retried once, success. Second `UndefinedColumn` → raised. `UndefinedTable` on `data_freshness` → one heal, then raised (no loop). `UndefinedTable` with ensure on → raised at once. Heal refused when the deadline leaves no room. Heal composes with a transient retry in the same season. `ingest_schedules`: matching hash → no DDL; `UndefinedTable` → `ensure_games_table` then one retry; second failure raises. Each of the 18 `ensure_*` issues `SET LOCAL lock_timeout = '10s'` as its first statement. No state file → ensure steps run (revert safety, M9).

**Verify.** Log shows `schema unchanged: skipped 17 ensure steps` and none of the 18 "Ensured ..." lines. The run after any `ingest.py` change shows them once.

**Rollback.** Revert. The DDL is idempotent, so going back to "every run" is safe.

### PR B: write only the rows that changed

**Behaviour.** Every `ON CONFLICT (...) DO UPDATE SET ...` gains

`WHERE (t.c1, t.c2, ...) IS DISTINCT FROM (EXCLUDED.c1, EXCLUDED.c2, ...)`

over exactly the columns in its `SET` list (`IS DISTINCT FROM` treats two NULLs as equal). `t` is an alias the statement must declare: `INSERT INTO <table> AS t (...)`. Use the alias in all 17 so the tests can check one pattern. Seventeen statements: the 15 `upsert_*`, `upsert_teams`, `ingest_schedules`. `update_freshness` is PR D.

Checked for each trap:

- **`updated_at`.** Two statements set `updated_at = now()`: `upsert_player_slugs` and `ingest_schedules`. Keep it in `SET`, leave it **out** of the `WHERE` comparison. The timestamp then moves only when a real column changed.
- **Float noise.** Not a problem on the same machine: two aggregations of one file gave identical values in all 8,730 rows, and `EXCLUDED` is already cast to the column's type, so NUMERIC is compared with NUMERIC. Not proven across machines (a different CPU or numpy build on the GitHub runner could flip a last digit). The failure is harmless, one extra row write, and visible in the new counts. No rounding now; if quiet runs report rows written, round rates at the source as a follow-up.
- **NaN.** Five upserts still clean with `df.where(notna, None)`, which MEMORY records as leaving real NaN in place. Postgres treats NaN = NaN for NUMERIC, so those rows still compare equal. No change needed for this PR.
- **Truthful logging.** `execute_values` sends pages of 100 rows and `cur.rowcount` reports only the last page; today's "Upserted N rows" is just `len(rows)`. New: add `RETURNING 1`, call `execute_values(..., fetch=True)`, count the returned rows. Log `qb_weekly_stats: sent 143, written 3, unchanged 140`. Each upsert returns its written count.
- **Slugs.** `upsert_player_slugs` never updates `slug`; unchanged.
- **Key columns.** The comparison never includes conflict-key columns.

**Saving (from 2.4), stated precisely (I5).** One game added: 232 new row versions instead of 8,730. A new week: 3,386 instead of 8,730. New row versions, all index writes, dead rows, bloat and the autovacuum work fall by that share (60 to 97%). **Heap pages touched do not fall**: `ON CONFLICT DO UPDATE ... WHERE <false>` still locks the conflicting row (Postgres INSERT docs: only rows where the condition is true are updated, "although all rows will be locked"), and a row lock writes the tuple header, dirties the page and emits a WAL record, with a full-page image on first touch after a checkpoint. So on a run where 3% of rows changed, every heap page holding a 2026 row is still dirtied. That is acceptable: PR A is what removes page writes on unchanged runs. PR B is not complicated to fix it; if zero page writes on partial runs is ever wanted, the route is a client-side diff or `INSERT ... SELECT` from `VALUES` anti-joined to the table.

**Wrong-skip alarm (I2, needs this PR's counts).** A `max skip age` full run whose fingerprint matched the stored one but which writes more than 0 rows logs `::warning::skip state was wrong: N rows written on an unchanged fingerprint`.

**Tests.** For each of the 17 statements: the SQL contains `IS DISTINCT FROM`, the compared column list equals the `SET` list minus `updated_at`, no key column is compared. `updated_at = now()` still in the two `SET` lists. Written count equals the fetched row count, not `len(rows)` (fake cursor returns 3 rows for 143 sent). Empty DataFrame paths unchanged. One no-database consistency test: aggregate the week-1 fixture twice, assert equal rows (pins determinism).

**Verify.** Logs on a quiet full run: every table `written 0`. **The first quiet full run on a GitHub runner must log `written 0` everywhere (M11)**; if it does not, float results differ across machines and rates must be rounded at the source before PR D is built on these counts. After a game: small numbers in per-week tables, `unchanged` large. Sum the `written` figures across a week and compare with section 2.4.

**Rollback.** Revert; the old statements are a superset (they write everything).

### PR D: stamp freshness only when something changed

**Behaviour.** `process_season` sums the written counts from PR B plus the rows deleted by `cleanup_stale_rows` (it now returns its total). If the sum is 0 and `through_week` equals the stored value: skip `update_freshness` and log `no rows changed: freshness not stamped`. Otherwise stamp as today.

**`changed` after PR D (M8)** = season rows written or deleted **or** schedule rows written, so a score-only update still revalidates; and, as in PR A point 9, it stays true until a revalidate has succeeded after the last change. A run that changed nothing reports `changed=false` and the workflow skips the revalidate POST.

`cleanup_stale_rows` itself is left alone: a DELETE that matches nothing writes nothing, PR A already removes its scans on unchanged runs, and making it conditional would risk leaving a stale row when the only change in a file is a row disappearing.

Effects: `data_freshness.last_updated` now means "data last changed". The homepage "Updated" line and the 10-day stale badge become truthful, and sitemap `lastmod` stops moving every 4 hours (MEMORY R7). It no longer says "the pipeline last ran". If the "silent pipeline failures" follow-up wants a heartbeat, the Actions run history already is one; a `last_checked` column would need Jon's approval and is not proposed.

Two consequences to expect (M8). **The amber "stale" badge will show from roughly mid-January** (10 days after the last regular-season write) instead of mid-March as today, so an amber pill during the playoffs is correct, not a fault. And the health follow-up in MEMORY ("503 past about 36 h in season") can no longer be built on `last_updated`; it would need the Actions run history or its own heartbeat.

**Tests.** All upserts return 0 and cleanup deletes 0 → `update_freshness` not called, commit still called, `changed=false`. One row written → called. Only a cleanup delete → called. `through_week` moves with 0 writes (cannot really happen, but pinned) → called.

**Verify.** `curl -s https://yardsperpass.com/sitemap.xml` twice, several hours apart on a day with no games: same `lastmod`.

**Rollback.** Revert.

### E. Schedule

Keep all six slots. After PR A an unchanged slot costs three GitHub API calls, one 2 MB download and no database work, so there is nothing left to save by dropping one, and MEMORY records why the gap between runs matters (GitHub starts them 2 to 6 hours late). Dropping the 17:17 UTC slot would only hide the daily failure; the stall happens whether or not that run exists (on 10/6 two refreshes ran at 12:03 and 12:48 UTC, both green and under a minute, and the stall began at 13:19 with none running).

### F. Read side: already covered elsewhere

The read-resilience spec (a session document, not in this repo at the time of writing): PR 1 (5 s limit on every read), PR 2 (cache the season tables: about 90% fewer database reads; this is the change that lowers memory pressure), PR 3 (sitemap keeps its last good copy; date-only `lastmod`). Nothing here repeats it. Two links: that spec's `/api/revalidate` will clear the whole data cache, so this spec's "revalidate only when changed" (PR A, PR D) keeps the cache warm on quiet runs; and PR D fixes the `lastmod` root cause that spec deferred.

Order across the two specs (review): read-resilience PR 1A then 1B; refresh PR A + C; read-resilience PR 2 (A must already be in, or the whole data cache is purged six times a day); refresh PR B, then PR D.

### G. Without code

| Option | Cost | What you get | Honest view |
|---|---|---|---|
| Stay on Free | $0 | 0.5 GB, 5 MB/s / 250 IOPS baseline, no backups, pauses after a week idle, 24-hour charts | Workable if caching brings memory down. Unknown until the charts are seen |
| Supabase Pro | "from $25/month", includes "$10/month in compute credits that cover one project on Micro compute" (https://supabase.com/pricing) | Micro: 1 GB RAM, 11 MB/s / 500 IOPS baseline; daily backups kept 7 days; never pauses; 7-day charts; support tickets get answered | The only way to add memory. Does not fix uncached reads, just gives them room |
| Pro + Small | about $30/month ($25 + $15 compute − $10 credit) | 2 GB RAM, 22 MB/s / 1,000 IOPS | Not needed for a database this size |

On backups: every stats table can be rebuilt from nflverse with `--all`. The one thing that cannot is `player_slugs` (the URLs are permanent, and MEMORY records that lost slug values could not be recovered once already). That is a small, real reason to want backups.

**Recommendation for a hobby site:** do not pay yet. Send the four screenshots, ship read-resilience PR 1 and PR 2 and this spec's PR A and PR C, then look at the Memory chart again. If RAM is still near full with swap in use on a quiet day, 0.5 GB is simply too small for Supabase's own services and $25 a month is the fix; cancel it if it changes nothing.

## 5. Decisions for Jon

**Jon accepted every recommended option (2026-10-06).** Recorded here as decided.

1. **Where the refresh remembers which files it last saw.** *Decided: option 1*, a small file in GitHub's cache. No database change. If the database were ever wiped by hand, tick "force" once (and even untouched, the next day's full run repairs it). Option 2 (a new one-row-per-season table) is not built.
2. **Skip runs when nflverse has nothing new?** *Decided: yes.* Runs where nothing ingest uses has changed do not touch the database at all, except one full run a day. Scores are covered: the schedule rows are part of the fingerprint.
3. **"Last updated" on the site means "data last changed", not "last checked"?** *Decided: yes (PR D).* It stops Google being told every page changed six times a day. Expect an amber "stale" pill from mid-January, ten days after the last regular-season game.
4. **Keep six refreshes a day?** *Decided: yes.* After the change the idle ones cost nothing.
5. **Order of work.** *Decided:* PR A and PR C first (one pull request: C needs A), alongside the read fixes already written up (timeout, caching); PR B and PR D later (D needs B).
6. **Pay for Supabase Pro ($25/month)?** *Decided: not yet.* Decide after the Memory chart. If memory is full with swap in use, yes.
7. **Send the four screenshots and the Vercel log view** (section 3.4), the screenshots taken just after a stall with the range set to "Last 24 hours": Memory usage; Disk IOPS with the Disk IO budget gauge; CPU usage; API Gateway total requests and errors; Vercel logs 16:00 to 19:00 UTC by user agent and path.
8. **Ask Supabase support** (ticket text is in the read-resilience spec) what their charts show for the 17:15 to 19:30 UTC windows. Free-plan charts only go back a day, so they can see what you cannot.

## 6. Limits of this analysis

- No database was read. Table sizes, bloat, hand-made indexes, autovacuum settings, `shared_buffers` and swap use are unknown; byte figures are computed from the rows, plus or minus 30%.
- The budget's size comes from AWS's t4g.nano page, not Supabase's; the refill rate is not published by either.
- "Mostly HOT" and the full-page-image count are estimates from how Postgres works, not measurements; the range in 2.3 covers both ends.
- Stall start times (17:15, 13:19) come from the first failed run or a cached page's timestamp, so they are "no later than", not the true onset.
- The cause ranking in 3.3 is judgement. The four charts and the Vercel logs settle it.
- Whether nflverse's rebuilds are byte-stable is unknown, so the share of runs PR A skips is unknown until a week of run history exists. The earlier "four of six runs" figure was written before I1 and is withdrawn; nothing in the design depends on it.
