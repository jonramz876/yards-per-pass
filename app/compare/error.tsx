"use client";

import ErrorState from "@/components/ui/ErrorState";

export default function Error({ reset }: { error: Error; reset: () => void }) {
  return <ErrorState title="Something went wrong" reset={reset} />;
}
