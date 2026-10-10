// app/matchup/error.tsx — the one error card for /matchup and
// /matchup/[away]/[home] (team matchup spec 2026-10-10 §10). There is no
// loading.tsx under this folder, so a failed core read is a real HTTP 500
// that is never cached, like /card and /game.
"use client";

import { useEffect } from "react";
import ErrorState from "@/components/ui/ErrorState";

const LINKS = [
  { href: "/team-stats", label: "Team Stats" },
  { href: "/matchup", label: "This week’s matchups" },
];

export default function MatchupError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Matchup page error:", error);
  }, [error]);

  // Plain reset: ErrorState's "Try again" does the router.refresh() that
  // re-runs the Server Component.
  return <ErrorState title="Unable to load matchups" reset={reset} links={LINKS} />;
}
