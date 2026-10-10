// app/matchup/[away]/page.tsx — /matchup/BUF names no matchup: a matchup is
// two teams (/matchup/BUF/LA). A real 404, with no database read (team
// matchup spec 2026-10-10 §4.1; the /card/team/[team_id] pattern). Do not
// delete this file: route precedence is not something to reason about.
import { notFound } from "next/navigation";

export default function MatchupWithoutHomeTeam(): never {
  notFound();
}
