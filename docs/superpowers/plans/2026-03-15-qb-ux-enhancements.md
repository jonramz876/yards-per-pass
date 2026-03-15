# QB Leaderboard UX Enhancements Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add conditional formatting (percentile heat map), league average baseline row, and clickable QB stat card modal with radar chart to the QB leaderboard.

**Architecture:** All three features are client-side only — no backend/DB changes. Percentile computation and averages derive from the filtered dataset in `QBLeaderboard.tsx`. Two new components (`RadarChart.tsx`, `QBStatCard.tsx`) handle the stat card modal. D3 is used only for math; SVG rendering is React JSX.

**Tech Stack:** React 18, TypeScript, Tailwind CSS 4.2, D3 v7.9.0 (math only), Next.js 14

**Spec:** `docs/superpowers/specs/2026-03-15-qb-ux-enhancements-design.md`

**Prerequisite:** Phase 2 Data Analytics plan (`docs/superpowers/plans/2026-03-15-phase2-data-analytics.md`) **must be completed first**. This plan assumes `getVal()`, refactored `formatVal()`, TD:INT column, and nullable types are already in place.

**Testing:** No frontend test framework exists in this project. Use `npm run build` for TypeScript/compilation checks and manual browser verification at each checkpoint.

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `components/tables/QBLeaderboard.tsx` | Modify | Add heatmap toggle, percentile computation, conditional cell styling, NFL AVG row, row click → modal state |
| `components/qb/RadarChart.tsx` | Create | D3 hexagonal radar chart (6 axes, percentile-normalized, team-colored) |
| `components/qb/QBStatCard.tsx` | Create | Modal wrapper + stat card (header, chips, bars), portal to body |

---

## Chunk 1: Conditional Formatting + NFL AVG Row

### Task 1: Add percentile helpers and heatmap column sets

**Files:**
- Modify: `components/tables/QBLeaderboard.tsx`

These helpers go **above** the `QBLeaderboard` component function (module-level).

- [ ] **Step 1: Add heatmap column sets and helper functions**

Add after the `GROUP_COLORS` constant (after line 58 in current code, but after Phase 2 lands this line number will shift — add right before the `export default function QBLeaderboard` line):

```typescript
// Columns that receive percentile-based conditional formatting
const HEATMAP_COLS_ADVANCED = new Set([
  "epa_per_play", "epa_per_db", "cpoe", "success_rate",
  "any_a", "td_int_ratio", "adot", "rush_epa_per_play",
]);
const HEATMAP_COLS_STANDARD = new Set([
  "completion_pct", "ypa", "passer_rating", "td_int_ratio",
]);

function getPercentile(sortedValues: number[], value: number): number {
  if (isNaN(value) || sortedValues.length === 0) return -1;
  const rank = sortedValues.filter((v) => v < value).length;
  return (rank / sortedValues.length) * 100;
}

function getHeatmapStyle(percentile: number): React.CSSProperties {
  if (percentile < 0) return {};
  if (percentile >= 90)
    return { background: "rgba(34,197,94,0.25)", color: "#15803d", fontWeight: 600 };
  if (percentile >= 75)
    return { background: "rgba(34,197,94,0.12)", color: "#16a34a" };
  if (percentile <= 10)
    return { background: "rgba(239,68,68,0.25)", color: "#dc2626", fontWeight: 600 };
  if (percentile <= 25)
    return { background: "rgba(239,68,68,0.12)", color: "#dc2626" };
  return {};
}

// Format a raw numeric value (used for NFL AVG row where there's no QB object)
// Note: This duplicates formatting logic from Phase 2's formatVal(). If formatVal's
// formatting rules change, update this function too. A future refactor could extract
// a shared formatNumber(key, val) helper that both functions call.
function formatAvg(key: string, val: number): string {
  if (val == null || isNaN(val)) return "\u2014";
  switch (key) {
    case "epa_per_play":
    case "epa_per_db":
    case "cpoe":
    case "adot":
    case "ypa":
    case "any_a":
    case "rush_epa_per_play":
    case "success_rate":
      return val.toFixed(2);
    case "completion_pct":
    case "passer_rating":
      return val.toFixed(1);
    case "td_int_ratio":
      return val === Infinity ? "\u221E" : val.toFixed(1) + ":1";
    case "yards_per_game":
    case "tds_per_game":
      return val.toFixed(1);
    default:
      return Number.isInteger(val) ? val.toString() : val.toFixed(1);
  }
}
```

- [ ] **Step 2: Run `npm run build` to verify no type errors**

Run: `cd "C:/Users/jonra/OneDrive/Desktop/claude sandbox/football website/yards-per-pass" && npm run build`
Expected: Build succeeds (helpers are defined but not yet used — tree-shaking is fine)

---

### Task 2: Add heatmap toggle and percentile/average memos

**Files:**
- Modify: `components/tables/QBLeaderboard.tsx`

- [ ] **Step 1: Add state and memos inside the component function**

Add these after the existing `const columns = ...` line (which is currently line 69, but will shift after Phase 2):

```typescript
const [showHeatmap, setShowHeatmap] = useState(true);

// Precompute sorted values per heatmap column for percentile lookups
const heatmapCols = tab === "advanced" ? HEATMAP_COLS_ADVANCED : HEATMAP_COLS_STANDARD;

const sortedByCol = useMemo(() => {
  if (!showHeatmap) return {};
  const sorted: Record<string, number[]> = {};
  for (const col of heatmapCols) {
    const values = filtered.map((qb) => getVal(qb, col)).filter((v) => !isNaN(v));
    values.sort((a, b) => a - b);
    sorted[col] = values;
  }
  return sorted;
}, [filtered, heatmapCols, showHeatmap]);

// Compute NFL average for each column
const averages = useMemo(() => {
  if (!showHeatmap) return {};
  const avgs: Record<string, number> = {};
  for (const col of columns) {
    const values = filtered.map((qb) => getVal(qb, col.key)).filter((v) => !isNaN(v));
    avgs[col.key] = values.length
      ? values.reduce((a, b) => a + b, 0) / values.length
      : NaN;
  }
  return avgs;
}, [filtered, columns, showHeatmap]);
```

Note: `getVal` is from Phase 2. It handles both real fields and virtual columns (td_int_ratio, yards_per_game, etc.).

- [ ] **Step 2: Add the heat map toggle UI**

Add this toggle **after** the dropback slider `</div>` (the one closing the `flex items-center gap-3` div), still inside the controls area:

```tsx
<label className="flex items-center gap-2 text-sm text-gray-500 whitespace-nowrap cursor-pointer select-none">
  <input
    type="checkbox"
    checked={showHeatmap}
    onChange={(e) => setShowHeatmap(e.target.checked)}
    className="rounded border-gray-300 text-navy focus:ring-navy/20"
  />
  Heat map
</label>
```

- [ ] **Step 3: Run `npm run build`**

Expected: Build succeeds

---

### Task 3: Apply conditional formatting to table cells

**Files:**
- Modify: `components/tables/QBLeaderboard.tsx`

- [ ] **Step 1: Update the cell rendering in the QB row**

Find the current cell rendering block inside `filtered.map()`. After Phase 2, it will use `getVal` and `formatVal`. Replace the `{columns.map((col) => {` block with:

```tsx
{columns.map((col) => {
  const val = getVal(qb, col.key);
  const isHeatmapCol = showHeatmap && heatmapCols.has(col.key);
  const pct = isHeatmapCol ? getPercentile(sortedByCol[col.key] || [], val) : -1;
  const heatStyle = isHeatmapCol ? getHeatmapStyle(pct) : {};

  // When heatmap is on, heatmap styling overrides EPA coloring
  const cellClass = isHeatmapCol
    ? "px-2 py-2 text-right tabular-nums"
    : `px-2 py-2 text-right tabular-nums ${
        isEpaCol(col.key) ? `font-bold ${epaColor(val)}` : "text-gray-700"
      }`;

  return (
    <td key={col.key} className={cellClass} style={heatStyle}>
      {formatVal(col.key, qb)}
    </td>
  );
})}
```

- [ ] **Step 2: Run `npm run build`**

Expected: Build succeeds

---

### Task 4: Add NFL AVG row

**Files:**
- Modify: `components/tables/QBLeaderboard.tsx`

- [ ] **Step 1: Add the NFL AVG row as the first row in tbody**

Inside `<tbody>`, right after the empty-state check (`filtered.length === 0 ? ... :`), add the NFL AVG row BEFORE the `filtered.map()` call. The structure becomes:

```tsx
<tbody>
  {filtered.length === 0 ? (
    <tr>
      <td colSpan={columns.length + 3} className="text-center py-12 text-gray-500">
        {search ? "No players match your search." : "No data available."}
      </td>
    </tr>
  ) : (
    <>
      {showHeatmap && (
        <tr className="border-t border-amber-400">
          <td className="px-2 py-2 sticky left-0 z-10" style={{ background: "#fef3c7" }}></td>
          <td className="px-2 py-2 sticky left-8 z-10" style={{ background: "#fef3c7", color: "#92400e", fontWeight: 700, fontStyle: "italic" }}>
            NFL AVG
          </td>
          <td className="px-2 py-2" style={{ background: "#fef3c7", color: "#92400e" }}>&mdash;</td>
          {columns.map((col) => (
            <td
              key={col.key}
              className="px-2 py-2 text-right tabular-nums"
              style={{ background: "#fef3c7", color: "#92400e", fontWeight: 600, borderBottom: "2px solid #f59e0b" }}
            >
              {formatAvg(col.key, averages[col.key])}
            </td>
          ))}
        </tr>
      )}
      {filtered.map((qb, idx) => (
        // ... existing QB row rendering
      ))}
    </>
  )}
</tbody>
```

Note: The `<>...</>` fragment wrapper is needed because we now have two sibling elements (avg row + mapped rows).

- [ ] **Step 2: Run `npm run build`**

Expected: Build succeeds

- [ ] **Step 3: Commit**

```bash
cd "C:/Users/jonra/OneDrive/Desktop/claude sandbox/football website/yards-per-pass"
git add components/tables/QBLeaderboard.tsx
git commit -m "feat(qb): add conditional formatting + NFL AVG row with heat map toggle

Percentile-based cell coloring (5 tiers from green to red) and pinned
league average row. Both toggle with a 'Heat map' checkbox. Percentiles
and averages recompute when filters change.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Chunk 2: Radar Chart + QB Stat Card Modal

### Task 5: Create RadarChart component

**Files:**
- Create: `components/qb/RadarChart.tsx`

- [ ] **Step 1: Create the `components/qb/` directory**

```bash
cd "C:/Users/jonra/OneDrive/Desktop/claude sandbox/football website/yards-per-pass"
ls components/qb 2>/dev/null || mkdir -p components/qb
```

- [ ] **Step 2: Write `components/qb/RadarChart.tsx`**

```tsx
// components/qb/RadarChart.tsx
"use client";

interface RadarChartProps {
  /** Percentile values (0–100) for each of the 6 axes, in order */
  values: number[];
  /** Team primary color (hex) for the data polygon */
  color: string;
}

const AXES = [
  { label: "EPA/Play" },
  { label: "CPOE" },
  { label: "aDOT" },
  { label: "TD:INT" },
  { label: "Rush EPA" },
  { label: "Success%" },
];

const CX = 150;
const CY = 125;
const R_OUTER = 90;
const R_MID = 45; // 50% = 50th percentile ring (matches linear percentile-to-radius mapping)
const R_INNER = 22.5; // 25% = 25th percentile ring

function hexPoint(radius: number, index: number): [number, number] {
  const angle = -Math.PI / 2 + (index * Math.PI) / 3;
  return [CX + radius * Math.cos(angle), CY + radius * Math.sin(angle)];
}

function hexPoints(radius: number): string {
  return Array.from({ length: 6 }, (_, i) => hexPoint(radius, i).join(",")).join(" ");
}

// Label positions — pushed outward from vertices for readability
const LABEL_POSITIONS: Array<{ x: number; y: number; anchor: string }> = [
  { x: 150, y: 16, anchor: "middle" },    // top: EPA/Play
  { x: 248, y: 72, anchor: "start" },     // top-right: CPOE
  { x: 248, y: 182, anchor: "start" },    // bottom-right: aDOT
  { x: 150, y: 252, anchor: "middle" },   // bottom: TD:INT
  { x: 52, y: 182, anchor: "end" },       // bottom-left: Rush EPA
  { x: 52, y: 72, anchor: "end" },        // top-left: Success%
];

export default function RadarChart({ values, color }: RadarChartProps) {
  // If 3+ axes are null/NaN, show a message instead of the chart
  const nullCount = values.filter((v) => isNaN(v) || v < 0).length;
  if (nullCount >= 3) {
    return (
      <div className="text-center text-gray-400 text-sm py-8">
        Not enough data for radar chart
      </div>
    );
  }

  // Clamp percentiles to 0–100, map NaN to 0
  const clamped = values.map((v) => (isNaN(v) || v < 0 ? 0 : Math.min(v, 100)));

  // Data polygon: each vertex at (percentile/100) * R_OUTER from center
  const dataPoints = clamped.map((pct, i) => {
    const r = (pct / 100) * R_OUTER;
    return hexPoint(r, i);
  });
  const dataPolygon = dataPoints.map((p) => p.join(",")).join(" ");

  return (
    <svg viewBox="0 0 300 260" width={300} height={260} className="mx-auto">
      {/* Grid hexagons */}
      <polygon
        points={hexPoints(R_OUTER)}
        fill="none"
        stroke="#e2e8f0"
        strokeWidth={1}
      />
      {/* 50th percentile ring — amber, dashed, subtle fill */}
      <polygon
        points={hexPoints(R_MID)}
        fill="rgba(251,191,36,0.06)"
        stroke="#f59e0b"
        strokeWidth={1}
        strokeDasharray="5,3"
      />
      {/* 25th percentile ring */}
      <polygon
        points={hexPoints(R_INNER)}
        fill="none"
        stroke="#f1f5f9"
        strokeWidth={0.5}
      />

      {/* Axis lines from center to each vertex */}
      {Array.from({ length: 6 }, (_, i) => {
        const [x, y] = hexPoint(R_OUTER, i);
        return (
          <line
            key={i}
            x1={CX}
            y1={CY}
            x2={x}
            y2={y}
            stroke="#f1f5f9"
            strokeWidth={0.5}
          />
        );
      })}

      {/* Data polygon */}
      <polygon
        points={dataPolygon}
        fill={`${color}1F`}
        stroke={color}
        strokeWidth={2}
      />

      {/* Data points */}
      {dataPoints.map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r={3} fill={color} />
      ))}

      {/* Axis labels */}
      {AXES.map((axis, i) => (
        <text
          key={axis.label}
          x={LABEL_POSITIONS[i].x}
          y={LABEL_POSITIONS[i].y}
          textAnchor={LABEL_POSITIONS[i].anchor}
          fontSize={12}
          fill="#475569"
          fontWeight={600}
        >
          {axis.label}
        </text>
      ))}
    </svg>
  );
}
```

Note on `fill={color}1F`: This appends hex alpha `1F` (~12% opacity) to the team color hex string. This works because all team colors in `teams.ts` are 6-digit hex (`#RRGGBB`), and `#RRGGBB1F` is valid CSS.

- [ ] **Step 3: Run `npm run build`**

Expected: Build succeeds (component is defined but not yet imported anywhere)

- [ ] **Step 4: Commit**

```bash
git add components/qb/RadarChart.tsx
git commit -m "feat(qb): add hexagonal radar chart component

6-axis percentile-normalized radar with team-colored data polygon.
Amber dashed ring marks league average (50th percentile). Pure React
SVG rendering — no D3 DOM manipulation.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 6: Create QBStatCard modal component

**Files:**
- Create: `components/qb/QBStatCard.tsx`

- [ ] **Step 1: Write `components/qb/QBStatCard.tsx`**

```tsx
// components/qb/QBStatCard.tsx
"use client";

import { useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import type { QBSeasonStat } from "@/lib/types";
import { getTeam, getTeamColor } from "@/lib/data/teams";
import RadarChart from "./RadarChart";

interface QBStatCardProps {
  qb: QBSeasonStat;
  allQBs: QBSeasonStat[];
  /** Function to get a value (real or virtual) from a QB */
  getVal: (qb: QBSeasonStat, key: string) => number;
  onClose: () => void;
}

// The 6 radar axes (must match RadarChart.tsx order)
const RADAR_KEYS = [
  "epa_per_play",
  "cpoe",
  "adot",
  "td_int_ratio",
  "rush_epa_per_play",
  "success_rate",
];

const RADAR_LABELS: Record<string, string> = {
  epa_per_play: "EPA/Play",
  cpoe: "CPOE",
  adot: "aDOT",
  td_int_ratio: "TD:INT",
  rush_epa_per_play: "Rush EPA",
  success_rate: "Success%",
};

// Bar comparison stats
const BAR_STATS = [
  { key: "yards_per_game", label: "Yds/G" },
  { key: "tds_per_game", label: "TD/G" },
  { key: "completion_pct", label: "Comp%" },
  { key: "ypa", label: "YPA" },
];

const BAR_STATS_RUSHER = [
  { key: "yards_per_game", label: "Yds/G" },
  { key: "tds_per_game", label: "TD/G" },
  { key: "completion_pct", label: "Comp%" },
  { key: "rush_yards_per_game", label: "Rush Y/G" },
];

function computePercentile(allValues: number[], value: number): number {
  if (isNaN(value) || allValues.length === 0) return 0;
  const rank = allValues.filter((v) => v < value).length;
  return (rank / allValues.length) * 100;
}

function computeRank(allValues: number[], value: number): number {
  if (isNaN(value)) return allValues.length;
  // Rank 1 = highest value (descending)
  return allValues.filter((v) => v > value).length + 1;
}

function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

function formatChipValue(key: string, val: number): string {
  if (isNaN(val)) return "\u2014";
  switch (key) {
    case "epa_per_play":
    case "rush_epa_per_play":
    case "success_rate":
      return val.toFixed(2);
    case "cpoe":
      return (val >= 0 ? "+" : "") + val.toFixed(1);
    case "adot":
      return val.toFixed(1);
    case "td_int_ratio":
      return val === Infinity ? "\u221E" : val.toFixed(1) + ":1";
    default:
      return val.toFixed(2);
  }
}

function chipColor(rank: number, total: number): string {
  if (rank <= Math.ceil(total * 0.1)) return "#16a34a"; // top 10% green
  if (rank > total - Math.ceil(total * 0.1)) return "#dc2626"; // bottom 10% red
  return "#1e293b"; // neutral
}

export default function QBStatCard({ qb, allQBs, getVal: gv, onClose }: QBStatCardProps) {
  const team = getTeam(qb.team_id);
  const teamColor = getTeamColor(qb.team_id);
  const total = allQBs.length;

  // Close on Escape
  const handleKey = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    },
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

  // Compute percentiles for radar
  const radarValues = RADAR_KEYS.map((key) => {
    const allVals = allQBs
      .map((q) => gv(q, key))
      .filter((v) => !isNaN(v))
      .sort((a, b) => a - b);
    return computePercentile(allVals, gv(qb, key));
  });

  // Compute ranks for chips
  const chipData = RADAR_KEYS.map((key) => {
    const val = gv(qb, key);
    const allVals = allQBs.map((q) => gv(q, key)).filter((v) => !isNaN(v));
    const rank = computeRank(allVals, val);
    return { key, val, rank };
  });

  // Determine bar stats: use rusher variant if rush EPA > 0
  const isDualThreat = gv(qb, "rush_epa_per_play") > 0;
  const barStats = isDualThreat ? BAR_STATS_RUSHER : BAR_STATS;

  // Helper for virtual rush_yards_per_game
  const getBarVal = (q: QBSeasonStat, key: string): number => {
    if (key === "rush_yards_per_game") {
      return q.games ? q.rush_yards / q.games : NaN;
    }
    return gv(q, key);
  };

  // Compute bar data
  const barData = barStats.map((stat) => {
    const val = getBarVal(qb, stat.key);
    const allVals = allQBs.map((q) => getBarVal(q, stat.key)).filter((v) => !isNaN(v));
    const avg = allVals.length
      ? allVals.reduce((a, b) => a + b, 0) / allVals.length
      : 0;
    const delta = val - avg;
    const barWidth = avg !== 0 ? Math.min(Math.abs(delta / avg) * 100, 45) : 0;
    return { ...stat, val, avg, delta, barWidth };
  });

  const modal = (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: "rgba(15,23,42,0.5)", backdropFilter: "blur(4px)" }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="relative bg-white rounded-2xl shadow-2xl overflow-y-auto animate-in slide-in-from-bottom-4 fade-in duration-200"
        style={{ width: 420, maxWidth: "95vw", maxHeight: "95vh", padding: 28 }}
      >
        {/* Close button */}
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
            {qb.team_id}
          </div>
          <div>
            <div className="text-xl font-bold text-gray-900">{qb.player_name}</div>
            <div className="text-xs text-gray-400">
              {team?.name ?? qb.team_id} &middot; {qb.season}
            </div>
          </div>
        </div>

        {/* Radar Chart */}
        <div className="flex justify-center mb-5">
          <RadarChart values={radarValues} color={teamColor} />
        </div>

        {/* Stat Chips */}
        <div className="grid grid-cols-3 gap-2 mb-5">
          {chipData.map((chip) => (
            <div
              key={chip.key}
              className="rounded-lg p-2.5 text-center"
              style={{ background: "#f8fafc" }}
            >
              <div className="text-[10px] text-gray-400 uppercase tracking-wide">
                {RADAR_LABELS[chip.key]}
              </div>
              <div
                className="text-base font-bold my-0.5"
                style={{ color: chipColor(chip.rank, total) }}
              >
                {formatChipValue(chip.key, chip.val)}
              </div>
              <div className="text-[10px] text-gray-400">
                {ordinal(chip.rank)} of {total}
              </div>
            </div>
          ))}
        </div>

        {/* Vs-Average Bars */}
        <div className="border-t border-gray-100 pt-4">
          <div className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide mb-3">
            vs. League Average
          </div>
          {barData.map((bar) => (
            <div key={bar.key} className="flex items-center gap-2 mb-2.5">
              <div className="text-[11px] text-gray-500 w-[50px] text-right">
                {bar.label}
              </div>
              <div
                className="flex-1 h-6 rounded relative overflow-hidden"
                style={{ background: "#f1f5f9" }}
              >
                {/* Center line (average) */}
                <div
                  className="absolute top-0 bottom-0 w-0.5 z-[2]"
                  style={{ left: "50%", background: "#94a3b8" }}
                />
                <div
                  className="absolute whitespace-nowrap z-[3]"
                  style={{
                    top: -14,
                    left: "50%",
                    transform: "translateX(-50%)",
                    fontSize: 9,
                    color: "#94a3b8",
                  }}
                >
                  avg: {isNaN(bar.avg) ? "\u2014" : bar.avg < 10 ? bar.avg.toFixed(1) : bar.avg.toFixed(0)}
                </div>
                {/* Fill bar */}
                {bar.delta >= 0 ? (
                  <div
                    className="absolute top-0.5 bottom-0.5 rounded-sm"
                    style={{
                      left: "50%",
                      width: `${bar.barWidth}%`,
                      background: "rgba(34,197,94,0.3)",
                      borderRight: "2px solid #16a34a",
                    }}
                  />
                ) : (
                  <div
                    className="absolute top-0.5 bottom-0.5 rounded-sm"
                    style={{
                      right: "50%",
                      width: `${bar.barWidth}%`,
                      background: "rgba(239,68,68,0.3)",
                      borderLeft: "2px solid #dc2626",
                    }}
                  />
                )}
              </div>
              <div className="w-[90px] text-right leading-tight">
                <div className="text-[11px] font-bold text-gray-900">
                  {isNaN(bar.val) ? "\u2014" : bar.val < 10 ? bar.val.toFixed(1) : bar.val.toFixed(1)}
                </div>
                <div
                  className="text-[10px]"
                  style={{ color: bar.delta >= 0 ? "#16a34a" : "#dc2626" }}
                >
                  {isNaN(bar.delta)
                    ? ""
                    : (bar.delta >= 0 ? "+" : "") + bar.delta.toFixed(1)}
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Watermark */}
        <div className="text-center text-[11px] text-gray-300 font-medium mt-4">
          yardsperpass.com
        </div>
      </div>
    </div>
  );

  return createPortal(modal, document.body);
}
```

- [ ] **Step 2: Run `npm run build`**

Expected: Build succeeds

- [ ] **Step 3: Commit**

```bash
git add components/qb/QBStatCard.tsx
git commit -m "feat(qb): add stat card modal with radar chart, chips, and vs-avg bars

420px fixed-width card designed for screenshots. Radar chart shows
percentile profile across 6 axes. Stat chips show value + league rank.
Bar comparisons show delta from filtered-dataset average. Dual-threat
QBs get Rush Y/G instead of YPA.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 7: Wire up the modal in QBLeaderboard

**Files:**
- Modify: `components/tables/QBLeaderboard.tsx`

- [ ] **Step 1: Add imports, state, and useEffect**

Update the React import at the top of the file to include `useEffect`:

```typescript
import { useState, useMemo, useEffect } from "react";
```

Add the QBStatCard import:

```typescript
import QBStatCard from "@/components/qb/QBStatCard";
```

Add state inside the component function, after the existing state declarations:

```typescript
const [selectedQB, setSelectedQB] = useState<QBSeasonStat | null>(null);
```

Add a `useEffect` to close the modal when filters change:

```typescript
// Close stat card modal when filters change (slider/search adjustment)
useEffect(() => {
  setSelectedQB(null);
}, [filtered]);
```

- [ ] **Step 2: Add click handler to QB rows**

On the `<tr>` element inside `filtered.map()`, add an `onClick` and cursor style:

```tsx
<tr
  key={qb.player_id}
  className="group border-t border-gray-100 hover:bg-gray-50/50 transition-colors cursor-pointer"
  onClick={() => setSelectedQB(qb)}
>
```

- [ ] **Step 3: Render the modal**

Add the modal rendering at the very end of the component's return, right before the closing `</div>`:

```tsx
{selectedQB && (
  <QBStatCard
    qb={selectedQB}
    allQBs={filtered}
    getVal={getVal}
    onClose={() => setSelectedQB(null)}
  />
)}
```

Note: `getVal` is the function from Phase 2 that already exists in this file.

- [ ] **Step 4: Run `npm run build`**

Expected: Build succeeds

- [ ] **Step 5: Commit**

```bash
git add components/tables/QBLeaderboard.tsx
git commit -m "feat(qb): wire up stat card modal on row click

Click any QB row to open the stat card modal. Modal closes on backdrop
click, Escape key, or when filters change. NFL AVG row is not clickable.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Chunk 3: Build Verification + Visual QA

### Task 8: Full build verification

**Files:**
- All modified/created files

- [ ] **Step 1: Run full build**

```bash
cd "C:/Users/jonra/OneDrive/Desktop/claude sandbox/football website/yards-per-pass"
npm run build
```

Expected: Build succeeds with no TypeScript errors.

If there are type errors, fix them. Common issues:
- `useEffect` not imported (ensure import includes it)
- `getVal` not in scope (it comes from Phase 2 — verify it exists)
- `createPortal` import path (should be `react-dom`)

- [ ] **Step 2: Start dev server for visual verification**

```bash
npm run dev
```

Open `http://localhost:3000/qb-leaderboard` in browser.

- [ ] **Step 3: Visual verification checklist**

Verify each item manually:

1. **Heat map toggle** — checkbox visible in controls area, default ON
2. **Conditional formatting** — cells show green/red/neutral backgrounds based on percentile
3. **NFL AVG row** — amber row pinned at top of table, values look reasonable
4. **Toggle OFF** — unchecking "Heat map" removes both cell colors AND the NFL AVG row
5. **Advanced tab** — EPA/Play, EPA/DB, CPOE, Success%, ANY/A, aDOT, Rush EPA all formatted
6. **Standard tab** — Comp%, YPA, Rating formatted; raw counts (Cmp, Att, Yards) NOT formatted
7. **Click Mahomes** — stat card opens with radar chart skewed right (passing elite)
8. **Click Lamar** — radar shape skewed left (Rush EPA dominant), Rush Y/G bar replaces YPA
9. **Radar avg ring** — amber dashed hexagon visible at 50th percentile
10. **Stat chips** — 6 stats matching radar axes, ranks shown (e.g., "1st of 32")
11. **Vs-avg bars** — center line with "avg: X" label, green/red fill, absolute + delta values
12. **Close modal** — click backdrop, press Escape, or click X — all work
13. **Dropback slider** — change slider, verify colors and averages update
14. **Dropback slider with modal open** — modal should close
15. **Watermark** — "yardsperpass.com" at bottom of stat card
16. **Screenshot test** — right-click stat card → "Save image" or screenshot tool, verify 420px width looks clean

- [ ] **Step 4: Fix any visual issues found**

Common fixes:
- Sticky column background not matching heatmap: ensure sticky cells have explicit `bg-white` that doesn't conflict with inline heatmap styles
- NFL AVG row sticky columns need matching amber background (already handled via inline style)
- Modal z-index conflicts: ensure `z-50` is high enough

- [ ] **Step 5: Final commit (if fixes were needed)**

```bash
git add -A
git commit -m "fix(qb): visual polish for UX enhancements

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 9: Verify with Phase 2 columns

This task applies only if Phase 2 has added the TD:INT, Yds/G, FL columns.

- [ ] **Step 1: Verify virtual columns in heat map**

1. TD:INT column on Advanced tab should have green/red heat map coloring
2. TD:INT column on Standard tab should also be formatted
3. Yds/G, TD/G columns on Standard tab should NOT be formatted (they're counting/volume stats)
4. FL (fumbles lost) should NOT be formatted

- [ ] **Step 2: Verify stat card uses virtual columns**

1. Click a QB — radar chart TD:INT axis should reflect the QB's ratio
2. Stat chip for TD:INT should show "X.X:1" format with correct rank
3. Vs-avg bar for Yds/G should use `getVal` (passing_yards / games), not raw `passing_yards`

- [ ] **Step 3: Commit if fixes needed**

```bash
git add -A
git commit -m "fix(qb): ensure UX enhancements work with Phase 2 virtual columns

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```
