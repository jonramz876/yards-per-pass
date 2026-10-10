// app/card/matchup/[away]/page.tsx — /card/matchup/<one team> names no card: a
// matchup needs two. A real 404 with no database read (matchup card spec
// 2026-10-11 §3). Do not delete.
import { notFound } from "next/navigation";

export default function MatchupCardOneTeam(): never {
  notFound();
}
