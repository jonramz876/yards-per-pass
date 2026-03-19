# QB Leaderboard URL State Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist QB Leaderboard sort/filter state in URL searchParams so users can share filtered views.

**Architecture:** Read URL params via `useSearchParams()` in the existing client component. Initialize `useState` from URL values with validation/fallback. On state changes, update the URL via `router.push()` (discrete changes) or debounced `router.replace()` (search input). Only one file is modified.

**Tech Stack:** Next.js 14 App Router (`useSearchParams`, `useRouter`, `usePathname` from `next/navigation`).

**Spec:** `docs/superpowers/specs/2026-03-18-qb-url-state-design.md`

---

## File Structure

### Modified Files
| File | Changes |
|------|---------|
| `components/tables/QBLeaderboard.tsx` | Add URL read/write: imports, param parsing with validation, URL update helper, debounced search sync, wire all state setters to update URL |

No new files. No changes to `app/qb-leaderboard/page.tsx`.

---

## Task 1: Add URL reading — initialize state from searchParams

**Files:**
- Modify: `components/tables/QBLeaderboard.tsx`

- [ ] **Step 1: Add imports**

At the top of `QBLeaderboard.tsx`, add `useSearchParams`, `useRouter`, and `usePathname` to the imports. Change line 4:

```typescript
// Before:
import React, { useState, useMemo, useEffect } from "react";
// After:
import React, { useState, useMemo, useEffect, useCallback, useRef } from "react";
```

Add after line 8 (after the QBStatCard import):

```typescript
import { useSearchParams, useRouter, usePathname } from "next/navigation";
```

- [ ] **Step 2: Add valid column key sets for validation**

Add after the `STANDARD_COLUMNS` array (after line 54), before the `type Tab` line:

```typescript
const VALID_ADVANCED_KEYS = new Set(ADVANCED_COLUMNS.map((c) => c.key));
const VALID_STANDARD_KEYS = new Set(STANDARD_COLUMNS.map((c) => c.key));
```

- [ ] **Step 3: Read searchParams and initialize state from URL**

Inside the `QBLeaderboard` function body, before the existing `useState` calls (line 138), add:

```typescript
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  // Read URL params with validation
  const urlTab = searchParams.get("tab");
  const initialTab: Tab = urlTab === "standard" ? "standard" : "advanced";

  const urlSort = searchParams.get("sort");
  const initialSortKey = (() => {
    if (!urlSort) return initialTab === "advanced" ? "epa_per_play" : "passing_yards";
    const validKeys = initialTab === "advanced" ? VALID_ADVANCED_KEYS : VALID_STANDARD_KEYS;
    return validKeys.has(urlSort) ? urlSort : (initialTab === "advanced" ? "epa_per_play" : "passing_yards");
  })();

  const urlDir = searchParams.get("dir");
  const initialSortDir: SortDir = urlDir === "asc" ? "asc" : "desc";

  const urlSearch = searchParams.get("q") || "";

  const urlMin = searchParams.get("min");
  const computedDefaultMin = Math.max(50, Math.round(200 * (throughWeek / 18)));
  const initialMin = (() => {
    if (!urlMin) return computedDefaultMin;
    const parsed = parseInt(urlMin, 10);
    return isNaN(parsed) || parsed < 0 ? computedDefaultMin : parsed;
  })();
```

Then update the existing `useState` calls to use these initial values:

```typescript
  // Before:
  const [tab, setTab] = useState<Tab>("advanced");
  const [sortKey, setSortKey] = useState<string>("epa_per_play");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [search, setSearch] = useState("");
  const [minDropbacks, setMinDropbacks] = useState(() =>
    Math.max(50, Math.round(200 * (throughWeek / 18)))
  );

  // After:
  const [tab, setTab] = useState<Tab>(initialTab);
  const [sortKey, setSortKey] = useState<string>(initialSortKey);
  const [sortDir, setSortDir] = useState<SortDir>(initialSortDir);
  const [search, setSearch] = useState(urlSearch);
  const [minDropbacks, setMinDropbacks] = useState(initialMin);
```

- [ ] **Step 4: Verify build**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add components/tables/QBLeaderboard.tsx
git commit -m "feat(qb-leaderboard): initialize state from URL searchParams"
```

---

## Task 2: Add URL writing — update URL on state changes

**Files:**
- Modify: `components/tables/QBLeaderboard.tsx`

- [ ] **Step 1: Add the URL update helper function**

Add after the `initialMin` block (after the useState calls but before the `columns` line):

```typescript
  // Build URL from current state, omitting defaults. Clones existing params to preserve unknowns.
  const buildParams = useCallback(
    (overrides: { tab?: Tab; sort?: string; dir?: SortDir; q?: string; min?: number }) => {
      const params = new URLSearchParams(searchParams.toString());
      // Remove our managed keys, then re-add non-defaults
      ["tab", "sort", "dir", "q", "min"].forEach((k) => params.delete(k));

      const newTab = overrides.tab ?? tab;
      const defaultSort = newTab === "advanced" ? "epa_per_play" : "passing_yards";
      const newSort = overrides.sort ?? sortKey;
      const newDir = overrides.dir ?? sortDir;
      const newQ = overrides.q ?? search;
      const newMin = overrides.min ?? minDropbacks;

      if (newTab !== "advanced") params.set("tab", newTab);
      if (newSort !== defaultSort) params.set("sort", newSort);
      if (newDir !== "desc") params.set("dir", newDir);
      if (newQ) params.set("q", newQ);
      if (newMin !== computedDefaultMin) params.set("min", String(newMin));

      const qs = params.toString();
      return pathname + (qs ? "?" + qs : "");
    },
    [searchParams, tab, sortKey, sortDir, search, minDropbacks, computedDefaultMin, pathname]
  );

  const pushURL = useCallback(
    (overrides: { tab?: Tab; sort?: string; dir?: SortDir; min?: number }) => {
      router.push(buildParams(overrides), { scroll: false });
    },
    [buildParams, router]
  );
```

Note: `buildParams` clones existing `searchParams` (preserving `season` and any future params) rather than building from scratch. This matches the pattern used by `SeasonSelect` and `GapHeatmap`.

- [ ] **Step 2: Add debounced URL update for search and slider**

Add after the `pushURL` function:

```typescript
  // Debounced URL update for continuous inputs (search, slider) — uses replace to avoid flooding history
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const replaceURLDebounced = useCallback(
    (overrides: { q?: string; min?: number }) => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        router.replace(buildParams(overrides), { scroll: false });
      }, 300);
    },
    [buildParams, router]
  );
```

This single debounced function handles both search and slider — both are continuous inputs that shouldn't flood browser history.

- [ ] **Step 3: Wire up state setters to update URL**

**3a. Update `handleSort` function (line 209-216):**

```typescript
  // Before (line 209-216):
  function handleSort(key: string) {
    if (sortKey === key) {
      setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  }

  // After:
  function handleSort(key: string) {
    if (sortKey === key) {
      const newDir = sortDir === "desc" ? "asc" : "desc";
      setSortDir(newDir);
      pushURL({ dir: newDir });
    } else {
      setSortKey(key);
      setSortDir("desc");
      pushURL({ sort: key, dir: "desc" });
    }
  }
```

Note: We replace the functional updater `setSortDir((d) => ...)` with a direct value so we can pass the same value to `pushURL` (avoids stale closure).

**3b. Update `switchTab` function (line 153-161):**

```typescript
  // Before:
  function switchTab(newTab: Tab) {
    setTab(newTab);
    if (newTab === "advanced") {
      setSortKey("epa_per_play");
    } else {
      setSortKey("passing_yards");
    }
    setSortDir("desc");
  }

  // After:
  function switchTab(newTab: Tab) {
    setTab(newTab);
    const newSort = newTab === "advanced" ? "epa_per_play" : "passing_yards";
    setSortKey(newSort);
    setSortDir("desc");
    pushURL({ tab: newTab, sort: newSort, dir: "desc" });
  }
```

**3c. Update search input onChange (find the `<input>` with `setSearch`):**

```typescript
  // Before:
  onChange={(e) => setSearch(e.target.value)}

  // After:
  onChange={(e) => {
    setSearch(e.target.value);
    replaceURLDebounced({ q: e.target.value });
  }}
```

**3d. Update min dropbacks slider onChange (line 305):**

```typescript
  // Before:
  onChange={(e) => setMinDropbacks(parseInt(e.target.value))}

  // After:
  onChange={(e) => {
    const val = parseInt(e.target.value);
    setMinDropbacks(val);
    replaceURLDebounced({ min: val });
  }}
```

- [ ] **Step 4: Verify build**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add components/tables/QBLeaderboard.tsx
git commit -m "feat(qb-leaderboard): sync state changes to URL searchParams"
```

---

## Task 3: Final verification

- [ ] **Step 1: TypeScript check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 2: Full build**

```bash
npx next build
```

Expected: Build succeeds, all pages generated.

- [ ] **Step 3: Manual testing checklist**

Run `npx next dev` and test:

1. **Sort column click**: Click "EPA/Play" header → URL should update to `?sort=epa_per_play` (or omit if default) with `&dir=desc`
2. **Sort direction toggle**: Click same column again → `&dir=asc` appears in URL
3. **Tab switch**: Click "Standard" tab → `?tab=standard&sort=passing_yards` in URL
4. **Search**: Type "mahomes" → after 300ms, `?q=mahomes` appears in URL
5. **Min dropbacks slider**: Slide to 100 → `?min=100` appears in URL (if different from default)
6. **Season change**: Change season via dropdown → all filter params should persist
7. **Share URL**: Copy the URL, open in new tab → same filters/sort should be applied
8. **Invalid params**: Navigate to `?sort=nonexistent&tab=foo` → should fall back to defaults silently
9. **Back button**: After several filter changes, browser back button should undo them one at a time (except search changes which use replace)
10. **Default omission**: When all filters are at default, URL should be clean: `/qb-leaderboard?season=2025` (no extra params)
