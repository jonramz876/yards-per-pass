// app/game/[game_id]/error.tsx
"use client";

import { useEffect } from "react";
import ErrorState from "@/components/ui/ErrorState";

export default function GamePageError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Box score page error:", error);
  }, [error]);

  return <ErrorState title="Unable to load this box score" reset={reset} />;
}
