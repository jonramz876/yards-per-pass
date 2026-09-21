// app/game/[game_id]/error.tsx
"use client";

import { useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
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
  const router = useRouter();
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
      // reset() re-renders the client error boundary against the RSC payload
      // it already holds; it does not re-run the Server Component. The only
      // error this boundary can ever see IS a Server Component throw (from
      // loadBoxScore), so without router.refresh() "Try again" re-shows the
      // same error for ever.
      reset={() => {
        router.refresh();
        reset();
      }}
      links={links}
    />
  );
}
