// app/qb-leaderboard/error.tsx
"use client";

import { useEffect } from "react";
import ErrorState from "@/components/ui/ErrorState";

export default function QBError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("QB Leaderboard page error:", error);
  }, [error]);

  return <ErrorState title="Unable to load QB data" reset={reset} />;
}
