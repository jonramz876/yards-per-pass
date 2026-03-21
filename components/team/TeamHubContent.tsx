// components/team/TeamHubContent.tsx
"use client";

import type { Team } from "@/lib/types";
import type { TeamHubData } from "@/lib/data/team-hub";
import DashboardShell from "@/components/layout/DashboardShell";
import Breadcrumbs from "@/components/ui/Breadcrumbs";
import TeamIdentityCard from "@/components/team/TeamIdentityCard";
import PassingSection from "@/components/team/PassingSection";
import GroundGameSection from "@/components/team/GroundGameSection";
import DefenseSection from "@/components/team/DefenseSection";
import DivisionRivals from "@/components/team/DivisionRivals";

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
        <PassingSection
          teamQBs={data.teamQBs}
          teamReceivers={data.teamReceivers}
          slugMap={data.slugMap}
        />

        <GroundGameSection
          teamRBGaps={data.teamRBGaps}
          teamDefGaps={data.teamDefGaps}
          teamId={team.id}
        />

        <DefenseSection
          teamStats={data.teamStats}
          teamDefGaps={data.teamDefGaps}
        />

        <DivisionRivals
          allTeamStats={data.allTeamStats}
          division={team.division}
          currentTeamId={team.id}
        />
      </div>
    </DashboardShell>
  );
}
