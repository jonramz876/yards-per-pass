// app/player/[slug]/error.tsx
"use client";

import { useEffect } from "react";
import ErrorState from "@/components/ui/ErrorState";

export default function PlayerError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Player page error:", error);
  }, [error]);

  return <ErrorState title="Unable to load player data" reset={reset} />;
}
