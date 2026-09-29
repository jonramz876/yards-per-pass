"use client";
import { useEffect } from "react";
import ErrorState from "@/components/ui/ErrorState";

export default function TeamStatsError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => { console.error("Team stats error:", error); }, [error]);
  return <ErrorState title="Unable to load team stats" reset={reset} />;
}
