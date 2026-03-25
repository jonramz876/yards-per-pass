// app/card/[slug]/CardPageActions.tsx
"use client";

import { useState } from "react";

interface CardPageActionsProps {
  slug: string;
}

export default function CardPageActions({ slug }: CardPageActionsProps) {
  const [copied, setCopied] = useState(false);

  async function handleCopyLink() {
    const url = `${window.location.origin}/card/${slug}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback for older browsers
      const input = document.createElement("input");
      input.value = url;
      document.body.appendChild(input);
      input.select();
      document.execCommand("copy");
      document.body.removeChild(input);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }

  function handleDownload() {
    // Open the OG image in a new tab — it's a real PNG the user can save
    window.open(`/api/stat-card/${slug}`, "_blank");
  }

  return (
    <div style={{ display: "flex", gap: 12, marginTop: 20 }}>
      <button
        onClick={handleCopyLink}
        style={{
          padding: "10px 24px",
          fontSize: 14,
          fontWeight: 600,
          backgroundColor: copied ? "#16a34a" : "#0f172a",
          color: "#ffffff",
          border: "none",
          borderRadius: 6,
          cursor: "pointer",
          transition: "background-color 0.2s",
        }}
      >
        {copied ? "Copied!" : "Copy Link"}
      </button>
      <button
        onClick={handleDownload}
        style={{
          padding: "10px 24px",
          fontSize: 14,
          fontWeight: 600,
          backgroundColor: "#ffffff",
          color: "#0f172a",
          border: "1px solid #e2e8f0",
          borderRadius: 6,
          cursor: "pointer",
        }}
      >
        Download Image
      </button>
    </div>
  );
}
