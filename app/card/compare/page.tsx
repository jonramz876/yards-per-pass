// app/card/compare/page.tsx — /card/compare names no card. A real 404 with no
// database read: without this file the URL fell through to the player card
// route (/card/[slug], slug "compare"), which looked a player up first
// (compare card spec 2026-10-09 section 4).
import { notFound } from "next/navigation";

export default function CompareCardIndex(): never {
  notFound();
}
