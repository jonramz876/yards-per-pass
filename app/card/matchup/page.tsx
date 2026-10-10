// app/card/matchup/page.tsx — /card/matchup names no card: a matchup needs two
// teams. A real 404 with no database read (matchup card spec 2026-10-11 §3).
// Do not delete: without this file the URL falls through to the player card
// route (app/card/[slug]) and reads the database for a player called "matchup".
import { notFound } from "next/navigation";

export default function MatchupCardNoTeam(): never {
  notFound();
}
