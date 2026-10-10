// app/matchup/fonts.ts — Barlow Condensed, the matchup pages' display face
// (team matchup spec 2026-10-10 §8.4). Loaded the way the site loads Inter
// (next/font/google: downloaded at build time, served from the site), but
// declared HERE and imported only by app/matchup/layout.tsx, so only matchup
// routes get its @font-face rules and preload links. Never move it to
// app/fonts.ts or the root layout: every page of the site would then load it.
// Weights 600 and 700 are the only two any matchup rule uses.
import { Barlow_Condensed } from "next/font/google";

export const barlowCondensed = Barlow_Condensed({
  subsets: ["latin"],
  weight: ["600", "700"],
  variable: "--font-barlow",
  display: "swap",
});
