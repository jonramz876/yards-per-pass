// app/global-error.tsx
"use client";

import { useEffect } from "react";

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("Global app error:", error);
  }, [error]);

  return (
    <html>
      <body>
        <div style={{ maxWidth: 600, margin: "80px auto", padding: "0 24px", textAlign: "center", fontFamily: "system-ui, sans-serif" }}>
          <h2 style={{ fontSize: 20, fontWeight: 700, color: "#0f172a", marginBottom: 8 }}>Something went wrong</h2>
          <p style={{ color: "#6b7280", marginBottom: 24 }}>
            An unexpected error occurred. Try refreshing the page.
          </p>
          <button
            onClick={reset}
            style={{ padding: "8px 16px", background: "#0f172a", color: "white", border: "none", borderRadius: 6, cursor: "pointer", fontSize: 14 }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
