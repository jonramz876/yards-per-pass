// app/teams/error.tsx
"use client";

import { useEffect } from "react";
import ErrorState from "@/components/ui/ErrorState";

export default function TeamsError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("Teams page error:", error);
  }, [error]);

  return <ErrorState title="Unable to load team data" reset={reset} />;
}
