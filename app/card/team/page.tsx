// app/card/team/page.tsx — /card/team names no card. A real 404 with no
// database read: without this file the URL fell through to the player card
// route (/card/[slug], slug "team"), which looked a player up first (team
// radar spec 2026-10-06 §7, review M11).
import { notFound } from "next/navigation";

export default function TeamRadarCardIndex(): never {
  notFound();
}
