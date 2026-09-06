// components/player/PlayerFieldHeatMap.tsx — "Tecmo Field" passing map.
// HTML/CSS grid rewrite of the old SVG heat map. Cell color is keyed to the
// ACTIVE metric (the old version tinted EPA cells by attempt volume, which read
// as "this zone is good" when it only meant "he throws here a lot").
"use client";

import { useState } from "react";
import type { QBPassLocationStat } from "@/lib/types";
import { textColorForBackground, EM_DASH } from "@/lib/stats/formatters";

/* ─── Props ─── */
interface PlayerFieldHeatMapProps {
  stats: QBPassLocationStat[];
  playerName: string;
  season: number;
  teamName: string;
  primaryColor: string;
  secondaryColor: string;
  jerseyNumber?: number | null;
}

/* ─── Tabs ─── */
type TabKey = "epa" | "cpoe" | "ypa" | "yards";
type Family = "diverging" | "sequential";

const TABS: { key: TabKey; label: string; family: Family }[] = [
  { key: "epa", label: "EPA/ATT", family: "diverging" },
  { key: "cpoe", label: "CPOE", family: "diverging" },
  { key: "ypa", label: "YDS/ATT", family: "sequential" },
  { key: "yards", label: "YARDS", family: "sequential" },
];

/* ─── Zone grid (depth × direction) ─── */
const DEPTHS: { key: string; label: string; range: string }[] = [
  { key: "deep", label: "DEEP", range: "20+" },
  { key: "intermediate", label: "MID", range: "10-19" },
  { key: "short", label: "SHORT", range: "0-9" },
];
const DIRS: { key: string; label: string }[] = [
  { key: "left", label: "←LEFT" },
  { key: "middle", label: "MIDDLE" },
  { key: "right", label: "RIGHT→" },
];
/** Divider drawn UNDER each depth row (null = no divider, i.e. the last row). */
const ROW_DIVIDER: Record<string, string | null> = {
  deep: "20 YDS",
  intermediate: "10 YDS",
  short: null,
};

/* ─── Color scales (solid fills for a dark #0f172a panel) ───────────────────
 * Both families brighten as the value gets more extreme; the chunky 2px border
 * is the paired brighter step, which is what carries the retro tile look.
 *
 * DIVERGING (EPA/ATT, CPOE) — index 0 = most negative … 4 = most positive:
 *   [ #c2410c/#fb923c, #7c2d12/#ea580c, #1e293b/#334155, #1d4ed8/#60a5fa, #2563eb/#93c5fd ]
 *   (orange-700, orange-900, slate-800 neutral, blue-700, blue-600)
 *
 * SEQUENTIAL (YDS/ATT, YARDS) — index 0 = lowest … 4 = highest; reuses the
 * diverging positive ramp from neutral upward plus a lighter top step:
 *   [ #1e293b/#334155, #1e3a8a/#3b82f6, #1d4ed8/#60a5fa, #2563eb/#93c5fd, #3b82f6/#bfdbfe ]
 *
 * Text color always comes from textColorForBackground(bg) — never hardcoded.
 * ─────────────────────────────────────────────────────────────────────────── */
interface Step {
  bg: string;
  border: string;
}

const DIVERGING_STEPS: Step[] = [
  { bg: "#c2410c", border: "#fb923c" },
  { bg: "#7c2d12", border: "#ea580c" },
  { bg: "#1e293b", border: "#334155" },
  { bg: "#1d4ed8", border: "#60a5fa" },
  { bg: "#2563eb", border: "#93c5fd" },
];

const SEQUENTIAL_STEPS: Step[] = [
  { bg: "#1e293b", border: "#334155" },
  { bg: "#1e3a8a", border: "#3b82f6" },
  { bg: "#1d4ed8", border: "#60a5fa" },
  { bg: "#2563eb", border: "#93c5fd" },
  { bg: "#3b82f6", border: "#bfdbfe" },
];

/** Tile used for a zone the player never threw to. */
const EMPTY_STEP: Step = { bg: "#111c30", border: "#334155" };

/** Symmetric clamps: |value| at or beyond this saturates the outermost step. */
const EPA_CLAMP = 0.5;
const CPOE_CLAMP = 15;
/** YDS/ATT saturates at 12; YARDS is normalized to the player's own zone max. */
const YPA_CLAMP = 12;

const PANEL_BG = "#0f172a";
const SCRIMMAGE_GOLD = "#f8d800";

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/**
 * Missing numbers arrive as NaN, not null (parseNumericFields converts null →
 * NaN), so `?? 0` is not enough — every read goes through this.
 */
function num(v: number | null | undefined): number {
  return v != null && Number.isFinite(v) ? v : 0;
}

/** −1…+1 → one of the 5 diverging steps. */
function divergingStep(t: number): Step {
  if (!Number.isFinite(t)) return DIVERGING_STEPS[2];
  if (t <= -0.5) return DIVERGING_STEPS[0];
  if (t <= -0.15) return DIVERGING_STEPS[1];
  if (t < 0.15) return DIVERGING_STEPS[2];
  if (t < 0.5) return DIVERGING_STEPS[3];
  return DIVERGING_STEPS[4];
}

/** 0…1 → one of the 5 sequential steps. */
function sequentialStep(t: number): Step {
  if (!Number.isFinite(t)) return SEQUENTIAL_STEPS[0];
  if (t < 0.2) return SEQUENTIAL_STEPS[0];
  if (t < 0.4) return SEQUENTIAL_STEPS[1];
  if (t < 0.6) return SEQUENTIAL_STEPS[2];
  if (t < 0.8) return SEQUENTIAL_STEPS[3];
  return SEQUENTIAL_STEPS[4];
}

function stepFor(tab: TabKey, zone: QBPassLocationStat, maxYards: number): Step {
  switch (tab) {
    case "epa":
      return divergingStep(clamp(num(zone.epa_per_attempt) / EPA_CLAMP, -1, 1));
    case "cpoe":
      return divergingStep(clamp(num(zone.cpoe) / CPOE_CLAMP, -1, 1));
    case "ypa":
      return sequentialStep(clamp(num(zone.yards_per_attempt) / YPA_CLAMP, 0, 1));
    case "yards":
      return sequentialStep(clamp(maxYards > 0 ? num(zone.passing_yards) / maxYards : 0, 0, 1));
    default:
      return SEQUENTIAL_STEPS[0];
  }
}

/* ─── Value formatting (ported verbatim from the SVG version) ─── */
function getBigNumber(tab: TabKey, zone: QBPassLocationStat | undefined): string {
  if (!zone || zone.pass_attempts === 0) return EM_DASH;

  switch (tab) {
    case "epa": {
      const v = zone.epa_per_attempt;
      if (v == null || !Number.isFinite(v)) return EM_DASH;
      return v >= 0 ? `+${v.toFixed(2)}` : v.toFixed(2);
    }
    case "cpoe": {
      const v = zone.cpoe;
      if (v == null || !Number.isFinite(v)) return EM_DASH;
      return v >= 0 ? `+${v.toFixed(1)}%` : `${v.toFixed(1)}%`;
    }
    case "ypa": {
      const v = zone.yards_per_attempt;
      return v != null && Number.isFinite(v) ? v.toFixed(1) : EM_DASH;
    }
    case "yards":
      return Number.isFinite(zone.passing_yards)
        ? String(Math.round(zone.passing_yards))
        : EM_DASH;
    default:
      return EM_DASH;
  }
}

/**
 * Completion percentage for a zone.
 * SCALE FOOTGUN: zone-level `completion_pct` is stored 0–1, the OPPOSITE of
 * season-level QBSeasonStat.completion_pct (0–100). Multiply by 100 here.
 */
function zoneCompPct(zone: QBPassLocationStat): number {
  const pct = zone.completion_pct;
  if (pct != null && Number.isFinite(pct)) return pct * 100;
  return zone.pass_attempts > 0 ? (zone.completions / zone.pass_attempts) * 100 : 0;
}

/** "DEEP LEFT: EPA/ATT +0.61 · 8/19 (42.1%) · 245 yds · 2 TD · 1 INT" */
function detailTitle(
  tab: { key: TabKey; label: string },
  depthLabel: string,
  dirKey: string,
  zone: QBPassLocationStat,
): string {
  const where = `${depthLabel} ${dirKey.toUpperCase()}`;
  return (
    `${where}: ${tab.label} ${getBigNumber(tab.key, zone)}` +
    ` · ${zone.completions}/${zone.pass_attempts} (${zoneCompPct(zone).toFixed(1)}%)` +
    ` · ${Math.round(num(zone.passing_yards))} yds` +
    ` · ${zone.pass_tds} TD · ${zone.interceptions} INT`
  );
}

/** "2TD 1INT" — omitted entirely when both are zero. */
function scoreSegment(zone: QBPassLocationStat): string {
  const parts: string[] = [];
  if (zone.pass_tds > 0) parts.push(`${zone.pass_tds}TD`);
  if (zone.interceptions > 0) parts.push(`${zone.interceptions}INT`);
  return parts.join(" ");
}

/* ─── Small presentational helpers ─── */
const PIXEL = "font-[family-name:var(--font-pixel)]";

function TotalStat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <span className="flex items-baseline gap-1">
      <span className={`${PIXEL} text-[6px] lg:text-[8px] text-slate-400 uppercase`}>{label}</span>
      <span className="text-[11px] lg:text-sm font-bold" style={color ? { color } : undefined}>
        {value}
      </span>
    </span>
  );
}

/* ─── Component ─── */
export default function PlayerFieldHeatMap({
  stats,
  playerName,
  season,
  teamName,
  primaryColor,
  secondaryColor,
  jerseyNumber = null,
}: PlayerFieldHeatMapProps) {
  const [activeTab, setActiveTab] = useState<TabKey>("epa");

  if (stats.length === 0) {
    return (
      <div className="text-gray-400 text-center py-12">
        No pass location data available for {playerName} ({season}).
      </div>
    );
  }

  const tab = TABS.find((t) => t.key === activeTab) ?? TABS[0];
  const bandText = textColorForBackground(primaryColor);

  /* Zone lookup */
  const lookup: Record<string, QBPassLocationStat> = {};
  for (const s of stats) {
    lookup[`${s.depth_bin}-${s.direction_bin}`] = s;
  }

  /* Season totals (ported from the SVG version) */
  const totalAttempts = stats.reduce((a, s) => a + s.pass_attempts, 0);
  const totalCompletions = stats.reduce((a, s) => a + s.completions, 0);
  const totalYards = stats.reduce((a, s) => a + num(s.passing_yards), 0);
  const totalTds = stats.reduce((a, s) => a + s.pass_tds, 0);
  const totalInts = stats.reduce((a, s) => a + s.interceptions, 0);
  const totalCompPct = totalAttempts > 0 ? (totalCompletions / totalAttempts) * 100 : 0;
  const totalEpa = stats.reduce((a, s) => a + num(s.epa_sum), 0);

  /* YARDS is normalized against the player's own busiest zone. */
  const maxYards = Math.max(...stats.map((s) => num(s.passing_yards)), 1);

  const legendSteps = tab.family === "diverging" ? DIVERGING_STEPS : SEQUENTIAL_STEPS;
  const legendLow = tab.family === "diverging" ? "TOUGH" : "LOW";
  const legendHigh = tab.family === "diverging" ? "ELITE" : "HIGH";

  return (
    <div className="bg-white rounded-lg shadow overflow-hidden max-w-2xl lg:max-w-3xl mx-auto">
      {/* Team band */}
      <div
        className={`${PIXEL} flex items-center justify-between gap-2 px-3 py-2.5 lg:px-5 lg:py-3 text-[7px] sm:text-[9px] lg:text-[11px] uppercase tracking-wide`}
        style={{ background: primaryColor, color: bandText, borderBottom: `2px solid ${secondaryColor}` }}
      >
        <span className="shrink-0">Passing Map</span>
        <span className="truncate text-right">
          {jerseyNumber != null ? `${jerseyNumber}-` : ""}{playerName} &middot; {season}
        </span>
      </div>

      {/* Dark field panel */}
      <div
        className="p-3 lg:p-4"
        style={{ background: PANEL_BG }}
        aria-label={`${playerName} ${season} passing map`}
      >
        {/* Season totals strip */}
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-md border border-white/10 bg-white/5 px-2.5 py-2 mb-3">
          <span className={`${PIXEL} text-[6px] lg:text-[8px] text-slate-400 uppercase`}>{teamName}</span>
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-slate-100">
            <TotalStat label="EPA" value={`${totalEpa >= 0 ? "+" : ""}${totalEpa.toFixed(1)}`} />
            <TotalStat label="C/ATT" value={`${totalCompletions}/${totalAttempts}`} />
            <TotalStat label="PCT" value={`${totalCompPct.toFixed(1)}%`} />
            <TotalStat label="YDS" value={String(Math.round(totalYards))} />
            <TotalStat label="TD" value={String(totalTds)} color="#4ade80" />
            <TotalStat label="INT" value={String(totalInts)} color="#f87171" />
          </div>
        </div>

        {/* Tab bar */}
        <div className="flex flex-wrap gap-1.5 mb-3">
          {TABS.map((t) => {
            const active = t.key === activeTab;
            return (
              <button
                key={t.key}
                onClick={() => setActiveTab(t.key)}
                aria-pressed={active}
                className={`${PIXEL} rounded px-2 py-1.5 lg:px-2.5 lg:py-2 text-[7px] lg:text-[9px] uppercase transition-colors ${
                  active
                    ? "bg-white text-slate-900"
                    : "bg-white/10 text-slate-400 hover:bg-white/20 hover:text-slate-200"
                }`}
              >
                {t.label}
              </button>
            );
          })}
        </div>

        {/* Field grid: depth-label gutter + 3 direction columns */}
        <div className="grid grid-cols-[42px_repeat(3,minmax(0,1fr))] lg:grid-cols-[64px_repeat(3,minmax(0,1fr))] gap-1.5 lg:gap-2">
          {/* Direction headers */}
          <div />
          {DIRS.map((d) => (
            <div
              key={d.key}
              className={`${PIXEL} text-center text-[6px] lg:text-[8px] text-slate-400 pb-0.5`}
            >
              {d.label}
            </div>
          ))}

          {DEPTHS.map((depth) => (
            <div key={depth.key} className="contents">
              <div
                className={`${PIXEL} flex flex-col items-end justify-center pr-1 text-[6px] lg:text-[8px] leading-relaxed text-slate-400 text-right`}
              >
                <span>{depth.label}</span>
                <span className="text-slate-500">{depth.range}</span>
              </div>

              {DIRS.map((dir) => {
                const zone = lookup[`${depth.key}-${dir.key}`];
                const isEmpty = !zone || zone.pass_attempts === 0;
                const step = isEmpty ? EMPTY_STEP : stepFor(activeTab, zone!, maxYards);
                const fg = textColorForBackground(step.bg);
                const score = isEmpty ? "" : scoreSegment(zone!);

                return (
                  <div
                    key={dir.key}
                    data-zone={`${depth.key}-${dir.key}`}
                    title={isEmpty ? undefined : detailTitle(tab, depth.label, dir.key, zone!)}
                    className={`rounded-md px-1 py-2 lg:py-2.5 text-center overflow-hidden ${
                      isEmpty ? "border-2 border-dashed" : "border-2"
                    }`}
                    style={{ background: step.bg, borderColor: step.border, color: fg }}
                  >
                    {isEmpty ? (
                      <div className="text-lg lg:text-xl font-bold text-slate-500">{EM_DASH}</div>
                    ) : (
                      <>
                        <div className="text-base sm:text-lg lg:text-2xl font-extrabold leading-none tracking-tight">
                          {getBigNumber(activeTab, zone)}
                        </div>
                        <div className="mt-1 text-[9px] sm:text-[10px] lg:text-xs opacity-80 leading-tight">
                          {zone!.completions}/{zone!.pass_attempts}
                          {/* TD/INT drops below sm so narrow phones keep one clean line. */}
                          {score && <span className="hidden sm:inline"> &middot; {score}</span>}
                        </div>
                      </>
                    )}
                  </div>
                );
              })}

              {ROW_DIVIDER[depth.key] && (
                <div className="col-span-4 flex items-center gap-2">
                  <span className="flex-1 border-t-2 border-dashed border-white/20" />
                  <span className={`${PIXEL} text-[6px] lg:text-[8px] text-slate-500`}>
                    {ROW_DIVIDER[depth.key]}
                  </span>
                  <span className="flex-1 border-t-2 border-dashed border-white/20" />
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Line of scrimmage */}
        <div
          className="mt-3 pt-1.5 flex items-center justify-between"
          style={{ borderTop: `3px solid ${SCRIMMAGE_GOLD}` }}
        >
          <span className={`${PIXEL} text-[6px] lg:text-[8px]`} style={{ color: SCRIMMAGE_GOLD }}>
            Scrimmage
          </span>
          <span className={`${PIXEL} text-[6px] lg:text-[8px] text-slate-600`}>yardsperpass.com</span>
        </div>

        {/* Legend — always visible, gradient matches the active family */}
        <div className="mt-3 flex items-center justify-center gap-2">
          <span className={`${PIXEL} text-[6px] lg:text-[8px] text-slate-400 uppercase`}>{legendLow}</span>
          <span
            aria-hidden="true"
            className="h-2.5 lg:h-3 w-32 sm:w-44 lg:w-56 rounded-sm"
            style={{ background: `linear-gradient(90deg, ${legendSteps.map((s) => s.bg).join(", ")})` }}
          />
          <span className={`${PIXEL} text-[6px] lg:text-[8px] text-slate-400 uppercase`}>{legendHigh}</span>
        </div>
      </div>
    </div>
  );
}
