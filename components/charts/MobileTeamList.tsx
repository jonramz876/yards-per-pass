// components/charts/MobileTeamList.tsx
"use client";

import type { TeamSeasonStat } from "@/lib/types";
import { getTeam, getTeamColor } from "@/lib/data/teams";

interface MobileTeamListProps {
  data: TeamSeasonStat[];
}

function getQuadrant(d: TeamSeasonStat): { label: string; order: number } {
  const goodOff = d.off_epa_play > 0;
  const goodDef = d.def_epa_play < 0;
  if (goodOff && goodDef) return { label: "Contenders", order: 0 };
  if (!goodOff && goodDef) return { label: "Defense Carries", order: 1 };
  if (goodOff && !goodDef) return { label: "Offense First", order: 2 };
  return { label: "Bottom Feeders", order: 3 };
}

const fmtEpa = (v: number) => isNaN(v) ? "\u2014" : v.toFixed(3);
const fmtPct = (v: number) => isNaN(v) ? "\u2014" : (v * 100).toFixed(1) + "%";

export default function MobileTeamList({ data }: MobileTeamListProps) {
  // Sort by composite EPA (off - def, since lower def is better)
  const sorted = [...data].sort(
    (a, b) => (b.off_epa_play - b.def_epa_play) - (a.off_epa_play - a.def_epa_play)
  );

  // Group by quadrant
  const grouped = sorted.reduce((acc, team) => {
    const q = getQuadrant(team);
    if (!acc[q.label]) acc[q.label] = { order: q.order, teams: [] };
    acc[q.label].teams.push(team);
    return acc;
  }, {} as Record<string, { order: number; teams: TeamSeasonStat[] }>);

  const sections = Object.entries(grouped).sort(([, a], [, b]) => a.order - b.order);

  return (
    <div className="space-y-6">
      {sections.map(([label, { teams }]) => (
        <div key={label}>
          <h3 className="text-sm font-bold text-navy uppercase tracking-wide mb-2">{label}</h3>
          <div className="space-y-1">
            {teams.map((t) => {
              const team = getTeam(t.team_id);
              const rank = sorted.indexOf(t) + 1;
              return (
                <div key={t.team_id} className="py-2 px-3 bg-gray-50 rounded-md">
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-gray-400 font-bold tabular-nums w-5 text-right flex-shrink-0">{rank}</span>
                    <div
                      className="w-3 h-3 rounded-full flex-shrink-0"
                      style={{ backgroundColor: getTeamColor(t.team_id) }}
                    />
                    <span className="text-sm font-medium text-navy flex-1 truncate">
                      {team?.name ?? t.team_id}
                    </span>
                    <span className="text-xs text-gray-500 tabular-nums">
                      {t.wins}-{t.losses}{t.ties > 0 ? `-${t.ties}` : ""}
                    </span>
                    <span className="text-xs tabular-nums font-medium" style={{
                      color: t.off_epa_play > 0 ? "#16A34A" : "#DC2626"
                    }}>
                      Off: {t.off_epa_play > 0 ? "+" : ""}{t.off_epa_play.toFixed(3)}
                    </span>
                    <span className="text-xs tabular-nums font-medium" style={{
                      color: t.def_epa_play < 0 ? "#16A34A" : "#DC2626"
                    }}>
                      Def: {t.def_epa_play > 0 ? "+" : ""}{t.def_epa_play.toFixed(3)}
                    </span>
                  </div>
                  <div className="text-[11px] text-gray-400 tabular-nums pl-[44px] mt-0.5">
                    Pass EPA: {fmtEpa(t.off_pass_epa)} | Rush EPA: {fmtEpa(t.off_rush_epa)} | Pass Rate: {fmtPct(t.pass_rate)} | Success: {fmtPct(t.off_success_rate)}
                  </div>
                  <div className="text-[11px] text-gray-400 tabular-nums pl-[44px] mt-0.5">
                    Def Pass: {fmtEpa(t.def_pass_epa)} | Def Rush: {fmtEpa(t.def_rush_epa)} | Def Success: {fmtPct(t.def_success_rate)}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
