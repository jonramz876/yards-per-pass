# Retention Hooks + RB Radar Cards Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add cross-page links, homepage data freshness, and RB stat cards with radar charts to improve retention and discoverability.

**Architecture:** Cross-page links wire existing components to navigate to related views. Homepage becomes an async server component fetching freshness data. RB stat card reuses the existing RadarChart (with a new `axes` prop) and QBStatCard modal pattern. RBStatCard is hosted in RunGapDiagram, triggered by PlayerGapCards click callback, with league-wide percentiles from allGapStats.

**Tech Stack:** Next.js 14 App Router, React portals (createPortal), D3.js (tooltip link injection), existing RadarChart SVG component.

**Spec:** `docs/superpowers/specs/2026-03-19-retention-hooks-design.md`

---

## File Structure

### New Files
| File | Responsibility |
|------|---------------|
| `components/charts/RBStatCard.tsx` | RB modal — radar chart, stat chips, per-gap breakdown, portal-rendered |

### Modified Files
| File | Changes |
|------|---------|
| `components/qb/RadarChart.tsx` | Add optional `axes` prop for custom labels |
| `components/qb/QBStatCard.tsx` | Add "View Team Run Gaps →" link |
| `components/charts/TeamScatterPlot.tsx` | Add "View Run Gaps →" link inside D3 tooltip |
| `components/charts/PlayerGapCards.tsx` | Add `onPlayerClick` callback prop, make player name clickable |
| `components/charts/RunGapDiagram.tsx` | Host RB modal state, pass `onPlayerClick` to PlayerGapCards, accept `allGapStats` prop |
| `app/run-gaps/page.tsx` | Pass `allGapStats` to RunGapDiagram |
| `app/page.tsx` | Convert to async, fetch + display data freshness |

---

## Task 1: Make RadarChart accept custom axes

**Files:**
- Modify: `components/qb/RadarChart.tsx`

- [ ] **Step 1: Add `axes` prop to RadarChartProps**

Change the interface (line 4-9) from:

```typescript
interface RadarChartProps {
  /** Percentile values (0–100) for each of the 6 axes, in order */
  values: number[];
  /** Team primary color (hex) for the data polygon */
  color: string;
}
```

to:

```typescript
interface RadarChartProps {
  /** Percentile values (0–100) for each of the 6 axes, in order */
  values: number[];
  /** Team primary color (hex) for the data polygon */
  color: string;
  /** Custom axis labels (must be exactly 6). Defaults to QB axes if omitted. */
  axes?: { label: string }[];
}
```

- [ ] **Step 2: Use the `axes` prop in the component**

Change the function signature (line 44) from:

```typescript
export default function RadarChart({ values, color }: RadarChartProps) {
```

to:

```typescript
export default function RadarChart({ values, color, axes: customAxes }: RadarChartProps) {
```

Then in the axis labels JSX section (line 117), change `AXES` to `customAxes || AXES`:

```typescript
      {/* Axis labels */}
      {(customAxes || AXES).map((axis, i) => (
```

- [ ] **Step 3: Verify build**

```bash
npx tsc --noEmit
```

- [ ] **Step 4: Commit**

```bash
git add components/qb/RadarChart.tsx
git commit -m "feat: add optional axes prop to RadarChart for custom labels"
```

---

## Task 2: Add homepage data freshness

**Files:**
- Modify: `app/page.tsx`

- [ ] **Step 1: Convert to async server component and add freshness**

Add imports at the top:

```typescript
import { getAvailableSeasons, getDataFreshness } from "@/lib/data/queries";
```

Change the function signature from:

```typescript
export default function HomePage() {
```

to:

```typescript
export default async function HomePage() {
  const seasons = await getAvailableSeasons();
  const currentSeason = seasons[0] || 2025;
  const freshness = await getDataFreshness(currentSeason);
```

Add the freshness display after the hero tagline paragraph (after line 14, the `</p>` closing the tagline):

```tsx
        {freshness && (
          <p className="mt-2 text-sm text-gray-400">
            Updated {new Date(freshness.last_updated).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
            {" · "}Through Week {freshness.through_week}
            {" · "}{freshness.season} Season
          </p>
        )}
```

- [ ] **Step 2: Verify build**

```bash
npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add app/page.tsx
git commit -m "feat: add data freshness indicator to homepage hero"
```

---

## Task 3: Add "View Run Gaps" link to QBStatCard

**Files:**
- Modify: `components/qb/QBStatCard.tsx`

- [ ] **Step 1: Add Link import and season prop**

Add at the top (after existing imports):

```typescript
import Link from "next/link";
```

Add `season` to the props interface:

```typescript
interface QBStatCardProps {
  qb: QBSeasonStat;
  allQBs: QBSeasonStat[];
  getVal: (qb: QBSeasonStat, key: string) => number;
  onClose: () => void;
  season: number;
}
```

Update the destructuring (line 91):

```typescript
export default function QBStatCard({ qb, allQBs, getVal: gv, onClose, season }: QBStatCardProps) {
```

- [ ] **Step 2: Add the link before the footer**

Find the footer div with "yardsperpass.com" text (line 278). Insert BEFORE it:

```tsx
        <Link
          href={`/run-gaps?team=${qb.team_id}&season=${season}`}
          className="block text-center text-sm font-semibold text-navy hover:text-nflred transition-colors mt-4 py-2"
          onClick={onClose}
        >
          View {team?.name ?? qb.team_id} Run Gaps →
        </Link>
```

- [ ] **Step 3: Update the QBStatCard call site to pass season**

In `components/tables/QBLeaderboard.tsx`, find where `<QBStatCard>` is rendered (search for `<QBStatCard`). Add the `season` prop:

```typescript
<QBStatCard
  qb={selectedQB}
  allQBs={filtered}
  getVal={getVal}
  onClose={() => setSelectedQB(null)}
  season={season}
/>
```

The `season` prop is already available in `QBLeaderboard` as a component prop.

- [ ] **Step 4: Verify build**

```bash
npx tsc --noEmit
```

- [ ] **Step 5: Commit**

```bash
git add components/qb/QBStatCard.tsx components/tables/QBLeaderboard.tsx
git commit -m "feat: add 'View Run Gaps' cross-link to QB stat card modal"
```

---

## Task 4: Add "View Run Gaps" link in scatter plot tooltip

**Files:**
- Modify: `components/charts/TeamScatterPlot.tsx`

- [ ] **Step 1: Add router import and hook**

Add to imports:

```typescript
import { useRouter, useSearchParams } from "next/navigation";
```

Inside the component function (after `const [dimensions, setDimensions] = ...`), add:

```typescript
  const router = useRouter();
  const searchParams = useSearchParams();
```

- [ ] **Step 2: Add "View Run Gaps" link to D3 tooltip**

The tooltip is built using imperative DOM (`document.createElement` + `appendChild`). The tooltip div has `pointer-events-none` class, which must be changed to allow clicks on the link.

**2a. Change tooltip div to allow pointer events:**

In the JSX at the bottom of the component, find the tooltip div (has `ref={tooltipRef}` and `pointer-events-none` class). Remove `pointer-events-none` from the className:

```tsx
// Before:
className="fixed z-50 bg-white px-3 py-2 rounded-md shadow-lg border border-gray-200 pointer-events-none opacity-0 transition-opacity"

// After:
className="fixed z-50 bg-white px-3 py-2 rounded-md shadow-lg border border-gray-200 pointer-events-auto opacity-0 transition-opacity"
```

**2b. Add link element to tooltip in the `showTooltip` function:**

Inside the `showTooltip` function, after the 4 existing `tooltipEl.appendChild(...)` calls (nameDiv, statsDiv, detailDiv, defDiv — around line 241-244), add:

```typescript
        const linkDiv = document.createElement("div");
        linkDiv.style.marginTop = "8px";
        linkDiv.style.paddingTop = "6px";
        linkDiv.style.borderTop = "1px solid #e2e8f0";
        linkDiv.style.textAlign = "center";
        const linkSpan = document.createElement("span");
        linkSpan.textContent = "View Run Gaps →";
        linkSpan.style.color = "#1e3a5f";
        linkSpan.style.fontSize = "12px";
        linkSpan.style.fontWeight = "600";
        linkSpan.style.cursor = "pointer";
        linkSpan.addEventListener("click", (e) => {
          e.stopPropagation();
          const season = searchParams.get("season") || "";
          const url = `/run-gaps?team=${d.team_id}${season ? `&season=${season}` : ""}`;
          router.push(url);
        });
        linkDiv.appendChild(linkSpan);
        tooltipEl.appendChild(linkDiv);
```

**2c. Add `router` and `searchParams` to the `useEffect` dependency array:**

The D3 rendering `useEffect` (line 47) currently depends on `data` and `dimensions`. Add `router` and `searchParams`:

```typescript
  }, [data, dimensions, router, searchParams]);
```

- [ ] **Step 3: Verify build**

```bash
npx tsc --noEmit
```

- [ ] **Step 4: Commit**

```bash
git add components/charts/TeamScatterPlot.tsx
git commit -m "feat: add 'View Run Gaps' link in team scatter plot tooltip"
```

---

## Task 5: Create RBStatCard component

**Files:**
- Create: `components/charts/RBStatCard.tsx`

- [ ] **Step 1: Create the RBStatCard component**

Create `components/charts/RBStatCard.tsx` following the `QBStatCard` pattern closely. The component:

```tsx
"use client";

import { useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import type { RBGapStat } from "@/lib/types";
import { getTeam, getTeamColor } from "@/lib/data/teams";
import RadarChart from "@/components/qb/RadarChart";

interface RBStatCardProps {
  /** Player's gap stats for the selected team (all 7 gaps) */
  playerGapStats: RBGapStat[];
  /** All RBs league-wide (for percentile computation) */
  allLeagueStats: RBGapStat[];
  onClose: () => void;
}

const RB_RADAR_AXES = [
  { label: "EPA/Carry" },
  { label: "Yds/Carry" },
  { label: "Success%" },
  { label: "Explosive%" },
  { label: "Elusiveness" },
  { label: "Volume" },
];

const RB_RADAR_KEYS = [
  "epa_per_carry",
  "yards_per_carry",
  "success_rate",
  "explosive_rate",
  "elusiveness", // computed: 1 - stuff_rate
  "carries",
];

const GAP_ORDER = ["LE", "LT", "LG", "M", "RG", "RT", "RE"];

/** Aggregate a player's per-gap rows into overall stats */
function aggregatePlayer(rows: RBGapStat[]): {
  player_id: string;
  player_name: string;
  team_id: string;
  carries: number;
  epa_per_carry: number;
  yards_per_carry: number;
  success_rate: number;
  stuff_rate: number;
  explosive_rate: number;
  elusiveness: number;
} {
  let totalCarries = 0;
  let epaSum = 0, ypcSum = 0, srSum = 0, stuffSum = 0, explSum = 0;

  for (const r of rows) {
    const c = r.carries || 0;
    totalCarries += c;
    if (r.epa_per_carry != null && !isNaN(r.epa_per_carry)) epaSum += r.epa_per_carry * c;
    if (r.yards_per_carry != null && !isNaN(r.yards_per_carry)) ypcSum += r.yards_per_carry * c;
    if (r.success_rate != null && !isNaN(r.success_rate)) srSum += r.success_rate * c;
    if (r.stuff_rate != null && !isNaN(r.stuff_rate)) stuffSum += r.stuff_rate * c;
    if (r.explosive_rate != null && !isNaN(r.explosive_rate)) explSum += r.explosive_rate * c;
  }

  const epa = totalCarries > 0 ? epaSum / totalCarries : NaN;
  const ypc = totalCarries > 0 ? ypcSum / totalCarries : NaN;
  const sr = totalCarries > 0 ? srSum / totalCarries : NaN;
  const stuff = totalCarries > 0 ? stuffSum / totalCarries : NaN;
  const expl = totalCarries > 0 ? explSum / totalCarries : NaN;

  return {
    player_id: rows[0]?.player_id ?? "",
    player_name: rows[0]?.player_name ?? "",
    team_id: rows[0]?.team_id ?? "",
    carries: totalCarries,
    epa_per_carry: epa,
    yards_per_carry: ypc,
    success_rate: sr,
    stuff_rate: stuff,
    explosive_rate: expl,
    elusiveness: !isNaN(stuff) ? 1 - stuff : NaN,
  };
}

/** Build league-wide per-player aggregated stats for percentile computation */
function buildLeaguePool(allStats: RBGapStat[]): Map<string, ReturnType<typeof aggregatePlayer>> {
  const byPlayer = new Map<string, RBGapStat[]>();
  for (const r of allStats) {
    const rows = byPlayer.get(r.player_id) || [];
    rows.push(r);
    byPlayer.set(r.player_id, rows);
  }
  const pool = new Map<string, ReturnType<typeof aggregatePlayer>>();
  byPlayer.forEach((rows, pid) => {
    const agg = aggregatePlayer(rows);
    if (agg.carries >= 20) pool.set(pid, agg); // min 20 carries for percentile pool
  });
  return pool;
}

function computePercentile(sortedValues: number[], value: number): number {
  if (isNaN(value) || sortedValues.length === 0) return 0;
  const rank = sortedValues.filter((v) => v < value).length;
  return (rank / sortedValues.length) * 100;
}

function getStatValue(player: ReturnType<typeof aggregatePlayer>, key: string): number {
  switch (key) {
    case "epa_per_carry": return player.epa_per_carry;
    case "yards_per_carry": return player.yards_per_carry;
    case "success_rate": return player.success_rate;
    case "explosive_rate": return player.explosive_rate;
    case "elusiveness": return player.elusiveness;
    case "carries": return player.carries;
    default: return NaN;
  }
}

function formatChipValue(key: string, val: number): string {
  if (isNaN(val)) return "\u2014";
  switch (key) {
    case "epa_per_carry": return val.toFixed(2);
    case "yards_per_carry": return val.toFixed(1);
    case "success_rate":
    case "explosive_rate":
    case "elusiveness": return (val * 100).toFixed(1) + "%";
    case "carries": return val.toString();
    default: return val.toFixed(2);
  }
}

function chipColor(rank: number, total: number): string {
  if (rank <= Math.ceil(total * 0.1)) return "#16a34a";
  if (rank > total - Math.ceil(total * 0.1)) return "#dc2626";
  return "#1e293b";
}

function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

export default function RBStatCard({ playerGapStats, allLeagueStats, onClose }: RBStatCardProps) {
  const player = aggregatePlayer(playerGapStats);
  const team = getTeam(player.team_id);
  const teamColor = getTeamColor(player.team_id);

  const leaguePool = buildLeaguePool(allLeagueStats);
  const poolArray = Array.from(leaguePool.values());
  const total = poolArray.length;

  const handleKey = useCallback(
    (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); },
    [onClose]
  );

  useEffect(() => {
    document.addEventListener("keydown", handleKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", handleKey);
      document.body.style.overflow = "";
    };
  }, [handleKey]);

  // Compute radar percentiles
  const radarValues = RB_RADAR_KEYS.map((key) => {
    const allVals = poolArray.map((p) => getStatValue(p, key)).filter((v) => !isNaN(v)).sort((a, b) => a - b);
    return computePercentile(allVals, getStatValue(player, key));
  });

  // Compute chip data (rank among league pool)
  const chipData = RB_RADAR_KEYS.map((key) => {
    const val = getStatValue(player, key);
    const allVals = poolArray.map((p) => getStatValue(p, key)).filter((v) => !isNaN(v));
    const rank = allVals.filter((v) => v > val).length + 1;
    return { key, val, rank, label: RB_RADAR_AXES[RB_RADAR_KEYS.indexOf(key)].label };
  });

  // Per-gap breakdown
  const gapBreakdown = GAP_ORDER.map((g) => {
    const row = playerGapStats.find((r) => r.gap === g);
    return {
      gap: g,
      carries: row?.carries ?? 0,
      epa: row?.epa_per_carry ?? NaN,
    };
  });

  const modal = (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: "rgba(15,23,42,0.5)", backdropFilter: "blur(4px)" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="relative bg-white rounded-2xl shadow-2xl overflow-y-auto animate-in slide-in-from-bottom-4 fade-in duration-200"
        style={{ width: 420, maxWidth: "95vw", maxHeight: "95vh", padding: 28 }}
      >
        <button
          onClick={onClose}
          className="absolute top-3 right-3 w-8 h-8 flex items-center justify-center rounded-full text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
          aria-label="Close"
        >
          &times;
        </button>

        {/* Header */}
        <div className="flex items-center gap-3.5 mb-5">
          <div
            className="w-11 h-11 rounded-full flex items-center justify-center text-white font-bold text-xs"
            style={{ backgroundColor: teamColor }}
          >
            {player.team_id}
          </div>
          <div>
            <div className="text-xl font-bold text-gray-900">{player.player_name}</div>
            <div className="text-xs text-gray-400">
              {team?.name ?? player.team_id} &middot; {player.carries} carries
            </div>
          </div>
        </div>

        {/* Radar */}
        <div className="flex justify-center mb-5">
          <RadarChart values={radarValues} color={teamColor} axes={RB_RADAR_AXES} />
        </div>

        {/* Stat chips */}
        <div className="grid grid-cols-3 gap-2 mb-5">
          {chipData.map((chip) => (
            <div key={chip.key} className="rounded-lg p-2.5 text-center" style={{ background: "#f8fafc" }}>
              <div className="text-[10px] text-gray-400 uppercase tracking-wide">{chip.label}</div>
              <div className="text-base font-bold my-0.5" style={{ color: chipColor(chip.rank, total) }}>
                {formatChipValue(chip.key, chip.val)}
              </div>
              <div className="text-[10px] text-gray-400">{ordinal(chip.rank)} of {total}</div>
            </div>
          ))}
        </div>

        {/* Gap breakdown */}
        <div className="border-t border-gray-100 pt-4">
          <div className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide mb-3">
            EPA/Carry by Gap
          </div>
          <div className="grid grid-cols-7 gap-1">
            {gapBreakdown.map((g) => (
              <div key={g.gap} className="text-center">
                <div className="text-[10px] font-semibold text-gray-500">{g.gap}</div>
                <div
                  className="text-sm font-bold"
                  style={{ color: !isNaN(g.epa) && g.epa > 0 ? "#16a34a" : !isNaN(g.epa) && g.epa < 0 ? "#dc2626" : "#94a3b8" }}
                >
                  {!isNaN(g.epa) ? (g.epa >= 0 ? "+" : "") + g.epa.toFixed(2) : "\u2014"}
                </div>
                <div className="text-[9px] text-gray-400">{g.carries} car</div>
              </div>
            ))}
          </div>
        </div>

        <div className="text-center text-[11px] text-gray-300 font-medium mt-4">
          yardsperpass.com
        </div>
      </div>
    </div>
  );

  return createPortal(modal, document.body);
}
```

- [ ] **Step 2: Verify build**

```bash
npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add components/charts/RBStatCard.tsx
git commit -m "feat: add RBStatCard component with radar chart and gap breakdown"
```

---

## Task 6: Wire up RBStatCard in RunGapDiagram

**Files:**
- Modify: `components/charts/PlayerGapCards.tsx`
- Modify: `components/charts/RunGapDiagram.tsx`
- Modify: `app/run-gaps/page.tsx`

- [ ] **Step 1: Add onPlayerClick prop to PlayerGapCards**

In `components/charts/PlayerGapCards.tsx`, add to the props interface:

```typescript
interface PlayerGapCardsProps {
  gap: string;
  stats: RBGapStat[];
  teamAvgEpa: number;
  leagueRank: number | null;
  leagueAvg: LeagueAvgStats;
  onPlayerClick?: (playerId: string) => void;  // NEW
}
```

Update the destructuring:

```typescript
export default function PlayerGapCards({
  gap,
  stats,
  teamAvgEpa,
  leagueRank,
  leagueAvg,
  onPlayerClick,
}: PlayerGapCardsProps) {
```

Find where the player name is rendered in the card JSX (look for `player_name`). Wrap it in a clickable element:

Find the player name render — it will be something like:

```tsx
<span className="font-bold text-navy text-sm">{p.player_name}</span>
```

Add the click handler and hover styles:

```tsx
<span
  className={`font-bold text-sm ${onPlayerClick ? "text-navy hover:text-nflred cursor-pointer transition-colors" : "text-navy"}`}
  onClick={() => onPlayerClick?.(p.player_id)}
>
  {p.player_name}
</span>
```

Note: Read the actual JSX to match the exact class string. The key change is adding `onClick`, `cursor-pointer`, and `hover:text-nflred`.

- [ ] **Step 2: Add allGapStats prop and RB modal to RunGapDiagram**

In `components/charts/RunGapDiagram.tsx`:

Add import at top:

```typescript
import RBStatCard from "./RBStatCard";
```

Find the props interface and add `allGapStats`:

```typescript
// Add to existing props:
allGapStats: RBGapStat[];
```

Add `allGapStats` to the destructured props.

Inside the component, add state for the selected RB:

```typescript
const [selectedRBId, setSelectedRBId] = useState<string | null>(null);
```

Add the modal render (just before the component's return statement's closing fragment/div):

```tsx
{selectedRBId && (
  <RBStatCard
    playerGapStats={data.filter((r) => r.player_id === selectedRBId)}
    allLeagueStats={allGapStats}
    onClose={() => setSelectedRBId(null)}
  />
)}
```

Find where `<PlayerGapCards>` is rendered and add the callback:

```tsx
<PlayerGapCards
  // ... existing props
  onPlayerClick={(playerId) => setSelectedRBId(playerId)}
/>
```

- [ ] **Step 3: Pass allGapStats from page.tsx to RunGapDiagram**

In `app/run-gaps/page.tsx`, add `allGapStats` to the RunGapDiagram props:

```tsx
<RunGapDiagram
  data={gapStats}
  weeklyData={weeklyStats}
  teams={teams}
  selectedTeam={team}
  selectedGap={gap || null}
  selectedOpp={opp || null}
  season={currentSeason}
  leagueAvgs={leagueGapData.averages}
  teamGapEpas={leagueGapData.teamGapEpas}
  defStats={defStats}
  allGapStats={allGapStats}
/>
```

- [ ] **Step 4: Verify build**

```bash
npx tsc --noEmit
```

- [ ] **Step 5: Commit**

```bash
git add components/charts/PlayerGapCards.tsx components/charts/RunGapDiagram.tsx app/run-gaps/page.tsx
git commit -m "feat: wire up RBStatCard modal triggered by player name click"
```

---

## Task 7: Final verification

- [ ] **Step 1: TypeScript check**

```bash
npx tsc --noEmit
```

- [ ] **Step 2: Full build**

```bash
npx next build
```

Expected: Build succeeds, all pages generated.

- [ ] **Step 3: Run tests**

```bash
python -m pytest tests/ -v
```

Expected: All 55 tests pass.

- [ ] **Step 4: Manual testing checklist**

Run `npx next dev` and verify:

1. **Homepage** shows "Updated [date] · Through Week [X] · [Year] Season" below tagline
2. **QB Leaderboard** → click a QB → modal shows "View [Team] Run Gaps →" link → clicking it navigates to `/run-gaps?team=XX&season=YYYY`
3. **Team Tiers** → hover a team dot → tooltip shows "View Run Gaps →" link → clicking it navigates to `/run-gaps?team=XX`
4. **Run Gaps** → select a team → click an RB name in PlayerGapCards → RB stat card modal opens with:
   - Player name and team badge
   - 6-axis radar chart (EPA/Carry, Yds/Carry, Success%, Explosive%, Elusiveness, Volume)
   - Stat chips with percentile ranks (against league-wide RBs)
   - Per-gap EPA breakdown (LE through RE)
   - Close on backdrop click or Escape
5. **Run Gaps heatmap** (no team selected) → click team → navigates to team drill-down (existing behavior, verify not broken)
