// components/compare/CompareShare.tsx — "Share this comparison" on /compare
// (compare card spec 2026-10-09 §7, PR 3): Copy Link, Download Image and a
// link to the share card, for a pair that has one. The pattern of the card
// pages' own buttons (TeamRadarActions), with one difference: what is copied
// is not this page's address but the share card's, so the parent hands the
// absolute URL over ready-made (built from the site URL the server passed,
// never from window.location: a preview deployment must copy its own links).
"use client";

import { useState } from "react";
import Link from "next/link";
import {
  COMPARE_COPIED_TEXT,
  COMPARE_COPY_FAILED_TEXT,
  COMPARE_COPY_LINK_TEXT,
  COMPARE_DOWNLOAD_TEXT,
  COMPARE_OPEN_CARD_TEXT,
  COMPARE_SHARE_HEADING,
} from "@/lib/stats/compare-links";

interface CompareShareProps {
  /** The share page's absolute URL, order kept, ?season= only for a past season. */
  shareUrl: string;
  /** The same page as a site-relative link. */
  cardHref: string;
  /** The image route with this season and download=1. */
  downloadHref: string;
}

export default function CompareShare({ shareUrl, cardHref, downloadHref }: CompareShareProps) {
  const [copy, setCopy] = useState<"idle" | "copied" | "failed">("idle");

  /** The old copy command, for browsers without the clipboard API or without permission. True only when it says it copied. */
  function copyWithCommand(url: string): boolean {
    const input = document.createElement("input");
    input.value = url;
    document.body.appendChild(input);
    try {
      input.select();
      return document.execCommand("copy") === true;
    } catch {
      return false; // the command threw, or does not exist
    } finally {
      document.body.removeChild(input);
    }
  }

  async function handleCopyLink() {
    let ok: boolean;
    try {
      await navigator.clipboard.writeText(shareUrl);
      ok = true;
    } catch {
      ok = copyWithCommand(shareUrl);
    }
    // Never "Copied!" when nothing reached the clipboard.
    setCopy(ok ? "copied" : "failed");
    setTimeout(() => setCopy("idle"), ok ? 2000 : 4000);
  }

  function handleDownload() {
    // The route answers with Content-Disposition: attachment, so the browser
    // saves the PNG instead of navigating to it.
    window.open(downloadHref, "_blank");
  }

  return (
    <div
      data-compare-share
      data-share-url={shareUrl}
      data-download-href={downloadHref}
      className="flex flex-wrap items-center justify-center gap-x-4 gap-y-3 border-y border-gray-200 py-4"
    >
      <span data-compare-share-heading className="text-sm font-semibold text-navy">
        {COMPARE_SHARE_HEADING}
      </span>
      <div className="flex flex-wrap justify-center gap-3">
        <button
          type="button"
          onClick={handleCopyLink}
          className={`cursor-pointer rounded-md px-5 py-2 text-sm font-semibold text-white transition-colors ${copy === "copied" ? "bg-green-600" : copy === "failed" ? "bg-red-700" : "bg-slate-900"}`}
        >
          {copy === "copied" ? COMPARE_COPIED_TEXT : copy === "failed" ? COMPARE_COPY_FAILED_TEXT : COMPARE_COPY_LINK_TEXT}
        </button>
        <button
          type="button"
          onClick={handleDownload}
          className="cursor-pointer rounded-md border border-slate-200 bg-white px-5 py-2 text-sm font-semibold text-slate-900"
        >
          {COMPARE_DOWNLOAD_TEXT}
        </button>
      </div>
      <Link href={cardHref} className="text-sm text-slate-500 hover:text-slate-900">
        {COMPARE_OPEN_CARD_TEXT}
      </Link>
    </div>
  );
}
