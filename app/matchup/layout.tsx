// app/matchup/layout.tsx — sets the --font-barlow variable for /matchup,
// /matchup/[away]/[home] and their error card, and nothing else (team matchup
// spec §8.4). A plain layout adds no Suspense boundary, so a redirect is still
// a real 3xx and a 404 a real 404 (never add a loading.tsx under this folder).
// The only importer of ./fonts.
import { barlowCondensed } from "./fonts";

export default function MatchupLayout({ children }: { children: React.ReactNode }) {
  return <div className={barlowCondensed.variable}>{children}</div>;
}
