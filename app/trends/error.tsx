"use client";
import { useEffect } from "react";
import ErrorState from "@/components/ui/ErrorState";

export default function TrendsError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => { console.error("Trends error:", error); }, [error]);
  return <ErrorState title="Unable to load trend data" reset={reset} />;
}
