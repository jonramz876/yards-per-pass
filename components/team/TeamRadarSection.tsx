// components/team/TeamRadarSection.tsx — the Team Radar section of the team
// page (team radar spec 2026-10-06 §4, §7, §8): an offense and a defense
// radar side by side, each over its stat table, or one sentence when there is
// no radar to draw, and (PR 3) a Share button under each radar that opens that
// side of the team on its own share page. Wraps itself in the section card, like every other
// team-page section. Every sentence is a constant from lib/stats/team-radar.
"use client";

import Link from "next/link";
import type { Team } from "@/lib/types";
import TecmoSectionCard from "@/components/team/TecmoSectionCard";
import TeamRadarChart from "@/components/team/TeamRadarChart";
import TeamRadarTable from "@/components/team/TeamRadarTable";
import {
  COMPARE_TEAMS_LINK_TEXT,
  RADAR_SIDES,
  RADAR_SMALL_POOL_NOTE,
  RADAR_SUBTITLE,
  RADAR_UNAVAILABLE_NOTE,
  canDrawRadar,
  radarBandAside,
  radarCardHref,
  radarLead,
  radarNoGamesNote,
  radarShareButtonText,
  radarTableOnlyNote,
  radarUncoveredNote,
  teamRadarFootnotes,
  teamStatsHref,
  type RadarSide,
  type TeamRadarSlice,
} from "@/lib/stats/team-radar";

interface TeamRadarSectionProps {
  radar: TeamRadarSlice;
  team: Team;
  /** The site's default (newest) season: the Team Stats link stays bare for it. */
  defaultSeason: number;
}

/** The sentence shown instead of the radars, per state. */
function messageFor(radar: Exclude<TeamRadarSlice, { state: "ready" }>, teamName: string): string {
  switch (radar.state) {
    case "no-games":
      return radarNoGamesNote(teamName, radar.season);
    case "small-pool":
      return RADAR_SMALL_POOL_NOTE;
    case "uncovered":
      return radarUncoveredNote(radar.season, radar.firstSeason);
    default:
      return RADAR_UNAVAILABLE_NOTE;
  }
}

export default function TeamRadarSection({ radar, team, defaultSeason }: TeamRadarSectionProps) {
  if (!radar) return null;

  const ready = radar.state === "ready";
  const aside = radarBandAside(radar.season, ready ? radar.throughWeek : null);

  return (
    <section id="team-radar" className="scroll-mt-24">
      <TecmoSectionCard
        title="Team Radar"
        aside={aside}
        primaryColor={team.primaryColor}
        secondaryColor={team.secondaryColor}
        bodyClassName="px-3.5 pt-4 pb-[18px] md:px-6 md:pt-5 md:pb-[22px]"
      >
        {radar.state !== "ready" ? (
          <p data-radar-message className="text-sm text-slate-600">
            {messageFor(radar, team.name)}
          </p>
        ) : (
          <>
            <div className="mb-1.5 flex flex-wrap items-center justify-between gap-x-4 gap-y-2.5">
              <p data-radar-lead className="text-sm text-slate-600">
                {radarLead(team.name, radar.teamsPlayed, radar.games)}
              </p>
              <Link
                data-radar-compare
                href={teamStatsHref(radar.season, defaultSeason)}
                className="inline-block rounded-md border border-slate-200 bg-white px-3.5 py-2 text-[13px] font-semibold text-slate-900 hover:bg-slate-50"
              >
                {COMPARE_TEAMS_LINK_TEXT} {"→"}
              </Link>
            </div>

            <div className="mt-2.5 grid grid-cols-1 gap-x-7 gap-y-2 md:grid-cols-2">
              {RADAR_SIDES.map(({ side: sideKey, slug, label }) => {
                const side = radar[sideKey];
                return (
                  <div key={sideKey} data-radar-side={sideKey} className="min-w-0">
                    <h4 className="mt-2.5 text-[15px] font-bold text-navy">{label}</h4>
                    <p data-radar-subtitle className="mt-0.5 text-[13px] text-slate-500">
                      {RADAR_SUBTITLE[sideKey]}
                    </p>
                    {canDrawRadar(side) ? (
                      <>
                        <TeamRadarChart side={side} sideKey={sideKey} color={team.primaryColor} secondaryColor={team.secondaryColor} label={`${team.name} ${slug} radar`} />
                        <div className="mb-3 mt-0.5 text-center">
                          <Link
                            data-radar-share={sideKey}
                            href={radarCardHref(team.id, sideKey, radar.season, defaultSeason)}
                            className="inline-block rounded-md border border-slate-900 bg-slate-900 px-3.5 py-2 text-[13px] font-semibold text-white hover:bg-slate-800"
                          >
                            {radarShareButtonText(sideKey)}
                          </Link>
                        </div>
                      </>
                    ) : (
                      <p data-radar-table-only className="my-4 rounded-md bg-slate-50 px-3 py-2 text-[13px] text-slate-600">
                        {radarTableOnlyNote(sideKey)}
                      </p>
                    )}
                    <TeamRadarTable side={side} sideKey={sideKey} teamId={team.id} teamsPlayed={radar.teamsPlayed} league={radar.league} />
                  </div>
                );
              })}
            </div>

            <div data-radar-footnotes className="mt-4 grid max-w-[100ch] gap-1.5 text-[12.5px] leading-relaxed text-slate-500">
              {teamRadarFootnotes({
                teamsPlayed: radar.teamsPlayed,
                throughWeek: radar.throughWeek,
                isLatestSeason: radar.isLatestSeason,
              }).map((note) => (
                <p key={note}>{note}</p>
              ))}
            </div>
          </>
        )}
      </TecmoSectionCard>
    </section>
  );
}
