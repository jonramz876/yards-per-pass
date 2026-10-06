// app/card/team/[team_id]/page.tsx — /card/team/BUF names no card: a share
// card is one side of a team (/card/team/BUF/offense or /defense). A real 404,
// with no database read (team radar spec 2026-10-06 §7, decision J6).
import { notFound } from "next/navigation";

export default function TeamRadarCardWithoutSide(): never {
  notFound();
}
