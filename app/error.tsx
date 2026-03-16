// app/error.tsx
"use client";

import { useEffect } from "react";
import ErrorState from "@/components/ui/ErrorState";

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("Unhandled app error:", error);
  }, [error]);

  return <ErrorState title="Something went wrong" reset={reset} />;
}
