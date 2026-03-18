"use client";

import { useEffect } from "react";
import ErrorState from "@/components/ui/ErrorState";

export default function RunGapsError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Run Gaps error:", error);
  }, [error]);

  return (
    <ErrorState
      title="Unable to load run gap data"
      reset={reset}
    />
  );
}
