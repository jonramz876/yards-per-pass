// app/game/[game_id]/error.tsx
"use client";

import { useEffect } from "react";
import { useParams } from "next/navigation";
import ErrorState from "@/components/ui/ErrorState";
import { normalizeGameId } from "@/lib/stats/box-score";
import { getTeam } from "@/lib/data/teams";

export default function GamePageError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const params = useParams<{ game_id: string }>();

  useEffect(() => {
    console.error("Box score page error:", error);
  }, [error]);

  // Every other failure state on this page hands the visitor both team pages
  // (page.tsx's teamLinks); the error card offered a GitHub issue link and
  // nothing else. The address itself carries the two codes, and it goes
  // through the same rule the page validates it with, so a junk address
  // simply produces no links rather than /team/undefined.
  const gameId = normalizeGameId(params?.game_id);
  const [, , awayId, homeId] = gameId ? gameId.split("_") : [];
  const links = gameId
    ? [
        { href: `/team/${awayId}`, label: getTeam(awayId)?.name ?? awayId },
        { href: `/team/${homeId}`, label: getTeam(homeId)?.name ?? homeId },
      ]
    : undefined;

  return (
    <ErrorState
      title="Unable to load this box score"
      // Plain reset: ErrorState's "Try again" does the router.refresh() that
      // re-runs the Server Component, for every route. A second refresh here
      // would fetch the page twice.
      reset={reset}
      links={links}
    />
  );
}
