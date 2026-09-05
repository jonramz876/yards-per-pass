// components/player/TecmoPlayerCard.tsx — the Tecmo Super Bowl-style player card.
// Pure presentational; all data precomputed by lib/stats/tecmo-card.ts builders.
import RadarChart from "@/components/qb/RadarChart";
import JerseyAvatar from "@/components/player/JerseyAvatar";
import { tierColor } from "@/lib/stats/tecmo-card";
import type { TecmoCardData } from "@/lib/stats/tecmo-card";
import { ordinal } from "@/lib/stats/percentiles";
import { textColorForBackground, EM_DASH } from "@/lib/stats/formatters";

/** Dot color for a metric the player has no value for (slate-400). */
const MISSING_GRAY = "#94a3b8";
/** Accent used when a team's secondary is too light to read on the white card. */
const ACCENT_FALLBACK = "#0f172a"; // slate-900, matches text-navy

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
  // Percentile accent sits on the white card, so it has to be dark itself.
  // If white text is what's readable ON the secondary, the secondary is dark
  // and safe here; otherwise it's a light silver (DAL, LV) or the "#ffffff"
  // fallback, which would be invisible — use navy instead.
  const accent =
    textColorForBackground(secondaryColor) === "#ffffff" ? secondaryColor : ACCENT_FALLBACK;
  // RadarChart takes `axes: { label: string }[]`, not a flat string array.
  const radarAxes = data.radarLabels.map((label) => ({ label }));

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
              {data.season} &middot; {data.games} GAMES{data.archetypeLabel ? ` · ${data.archetypeLabel}` : ""}
            </div>
          </div>
          <div
            className="ml-auto shrink-0 text-center rounded-md px-2.5 py-1.5 font-[family-name:var(--font-pixel)]"
            style={{ background: primaryColor, color: bandText }}
          >
            {/* Nullish coalescing, never a truthiness check: an OVR of 0 is a real score. */}
            <div data-ovr className="text-sm">{data.ovr ?? EM_DASH}</div>
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
          <div className="flex-1 w-full min-w-0">
            {data.abilityRows.map((r) => (
              <div key={r.label} className="flex items-center gap-2 mt-2">
                {/* r.missing — not percentile === 0 — decides the gray treatment:
                    a genuine last-place player also scores 0 and gets a red dot. */}
                <span
                  data-tier-dot
                  aria-hidden="true"
                  className="w-2 h-2 rounded-full shrink-0"
                  style={{ background: r.missing ? MISSING_GRAY : tierColor(r.percentile) }}
                />
                <span className="font-[family-name:var(--font-pixel)] text-[7px] text-slate-700 uppercase basis-1/3 shrink-0">
                  {r.label}
                </span>
                <span aria-hidden="true" className="flex-1 h-2 bg-slate-200 rounded-full overflow-hidden min-w-0">
                  <span
                    data-bar-fill
                    className="block h-2 rounded-full"
                    style={{
                      width: r.missing ? "0%" : `${Math.max(0, Math.min(r.percentile, 100))}%`,
                      background: primaryColor,
                    }}
                  />
                </span>
                <span className="font-[family-name:var(--font-pixel)] text-[7px] text-navy basis-[27%] shrink-0 text-right uppercase">
                  {r.missing ? EM_DASH : (
                    <>{r.raw} / <b data-pct-accent style={{ color: accent }}>{ordinal(Math.round(r.percentile)).toUpperCase()}</b></>
                  )}
                </span>
              </div>
            ))}
          </div>
          <div className="shrink-0 w-full sm:w-[240px]">
            <RadarChart values={data.radarValues} color={primaryColor} axes={radarAxes} />
          </div>
        </div>

        <div className="font-[family-name:var(--font-pixel)] text-[6px] text-slate-400 text-center mt-3 uppercase">
          yardsperpass.com &middot; Data: nflverse
        </div>
      </div>
    </div>
  );
}
