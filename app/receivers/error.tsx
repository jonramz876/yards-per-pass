"use client";
import { useEffect } from "react";
import ErrorState from "@/components/ui/ErrorState";

export default function ReceiversError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => { console.error("Receivers error:", error); }, [error]);
  return <ErrorState title="Unable to load receiver data" reset={reset} />;
}
