// components/team/TeamHubContent.tsx
"use client";

import type { Team } from "@/lib/types";
import type { TeamHubData } from "@/lib/data/team-hub";
import DashboardShell from "@/components/layout/DashboardShell";
import Breadcrumbs from "@/components/ui/Breadcrumbs";
import TeamIdentityCard from "@/components/team/TeamIdentityCard";
import ScheduleSection from "@/components/team/ScheduleSection";
import PassingSection from "@/components/team/PassingSection";
import GroundGameSection from "@/components/team/GroundGameSection";
import DefenseSection from "@/components/team/DefenseSection";
import DivisionRivals from "@/components/team/DivisionRivals";
import DownDistanceHeatmap from "@/components/team/DownDistanceHeatmap";
import SituationalDashboard from "@/components/team/SituationalDashboard";

interface TeamHubContentProps {
  team: Team;
  data: TeamHubData;
}

export default function TeamHubContent({ team, data }: TeamHubContentProps) {
  const breadcrumbs = [
    { label: "Team Tiers", href: "/teams" },
    { label: team.name },
  ];

  return (
    <DashboardShell
      title={team.name}
      seasons={data.seasons}
      currentSeason={data.currentSeason}
      freshness={data.freshness}
    >
      <Breadcrumbs items={breadcrumbs} />

      <TeamIdentityCard
        team={team}
        teamStats={data.teamStats}
        allTeamStats={data.allTeamStats}
      />

      <div className="space-y-8 mt-8">
        {/* Next season's slate, pre-surfaced before its stats exist. Empty on
            historical views and once the season flips, and the section omits
            itself then — leaving just the viewed season's schedule below. */}
        <ScheduleSection
          schedule={data.upcomingSchedule}
          teamName={team.name}
          primaryColor={team.primaryColor}
          secondaryColor={team.secondaryColor}
          teamStats={data.teamStats}
          upcomingSeason={data.upcomingSeason}
        />

        {/* The viewed season's schedule & results, with its record. */}
        <ScheduleSection
          schedule={data.schedule}
          teamName={team.name}
          primaryColor={team.primaryColor}
          secondaryColor={team.secondaryColor}
          teamStats={data.teamStats}
        />

        <PassingSection
          teamQBs={data.teamQBs}
          teamReceivers={data.teamReceivers}
          slugMap={data.slugMap}
          allTeamStats={data.allTeamStats}
          teamId={team.id}
          freshness={data.freshness}
          primaryColor={team.primaryColor}
          secondaryColor={team.secondaryColor}
        />

        <GroundGameSection
          teamRBGaps={data.teamRBGaps}
          teamId={team.id}
          slugMap={data.slugMap}
          allTeamStats={data.allTeamStats}
          season={data.currentSeason}
          freshness={data.freshness}
          primaryColor={team.primaryColor}
          secondaryColor={team.secondaryColor}
        />

        <DownDistanceHeatmap
          stats={data.downDistanceStats}
          nflAvg={data.downDistanceNFL}
          teamName={team.name}
          primaryColor={team.primaryColor}
          secondaryColor={team.secondaryColor}
        />

        <SituationalDashboard
          teamStats={data.situationalStats}
          allTeamStats={data.allSituationalStats}
          teamName={team.name}
          primaryColor={team.primaryColor}
          secondaryColor={team.secondaryColor}
        />

        <DefenseSection
          teamStats={data.teamStats}
          allTeamStats={data.allTeamStats}
          teamDefGaps={data.teamDefGaps}
          primaryColor={team.primaryColor}
          secondaryColor={team.secondaryColor}
        />

        <DivisionRivals
          allTeamStats={data.allTeamStats}
          division={team.division}
          currentTeamId={team.id}
          primaryColor={team.primaryColor}
          secondaryColor={team.secondaryColor}
        />
      </div>
    </DashboardShell>
  );
}
