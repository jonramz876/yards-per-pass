"use client";
import { useEffect } from "react";
import ErrorState from "@/components/ui/ErrorState";

export default function RushingError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => { console.error("Rushing error:", error); }, [error]);
  return <ErrorState title="Unable to load rushing data" reset={reset} />;
}
