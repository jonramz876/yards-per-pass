// app/card/compare/[a]/page.tsx — /card/compare/<one player> names no card: a
// comparison needs two. A real 404 with no database read (compare card spec
// 2026-10-09 section 4).
import { notFound } from "next/navigation";

export default function CompareCardOnePlayer(): never {
  notFound();
}
