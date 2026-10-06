// app/card/team/[team_id]/[side]/TeamRadarActions.tsx — Copy Link and
// Download Image under a team radar share card (the player card's
// CardPageActions pattern). The server page hands over both URLs ready-made.
"use client";

import { useState } from "react";
import { RADAR_COPIED_TEXT, RADAR_COPY_LINK_TEXT, RADAR_DOWNLOAD_TEXT } from "@/lib/stats/team-radar";

interface TeamRadarActionsProps {
  /** This page's path: bare for the default season, ?season= for a past one, so a link copied today keeps meaning "the newest season". */
  pagePath: string;
  /** The image route with this page's season and download=1. */
  downloadHref: string;
}

export default function TeamRadarActions({ pagePath, downloadHref }: TeamRadarActionsProps) {
  const [copied, setCopied] = useState(false);

  async function handleCopyLink() {
    const url = `${window.location.origin}${pagePath}`;
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      // Older browsers, or a page without clipboard permission.
      const input = document.createElement("input");
      input.value = url;
      document.body.appendChild(input);
      input.select();
      document.execCommand("copy");
      document.body.removeChild(input);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function handleDownload() {
    // The route answers with Content-Disposition: attachment, so the browser
    // saves the PNG instead of navigating to it.
    window.open(downloadHref, "_blank");
  }

  return (
    <div
      data-radar-actions
      data-page-path={pagePath}
      data-download-href={downloadHref}
      className="mt-5 flex flex-wrap justify-center gap-3"
    >
      <button
        type="button"
        onClick={handleCopyLink}
        className={`cursor-pointer rounded-md px-6 py-2.5 text-sm font-semibold text-white transition-colors ${copied ? "bg-green-600" : "bg-slate-900"}`}
      >
        {copied ? RADAR_COPIED_TEXT : RADAR_COPY_LINK_TEXT}
      </button>
      <button
        type="button"
        onClick={handleDownload}
        className="cursor-pointer rounded-md border border-slate-200 bg-white px-6 py-2.5 text-sm font-semibold text-slate-900"
      >
        {RADAR_DOWNLOAD_TEXT}
      </button>
    </div>
  );
}
