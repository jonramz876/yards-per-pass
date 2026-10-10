// app/matchup/[away]/[home]/MatchupShare.tsx — "Share this matchup" on the
// matchup page (matchup card spec 2026-10-11 §8.2, PR 2): Copy Link, Download
// Image and a link to the share card, for a pair whose share page is a card.
// The Compare page's Share block (components/compare/CompareShare.tsx) in the
// matchup page's own dress, with two differences: its words come from
// matchup-links.ts, and a failed copy is slate, never red. On matchup pages
// red has one job (a rank gap of 5 or more), and a test holds this file to it.
//
// What is copied is not this page's address but the share card's, so the
// server page hands the absolute URL over ready-made (NEXT_PUBLIC_SITE_URL,
// else https://yardsperpass.com), never the browser's own address. So a Vercel
// PREVIEW deployment copies the PRODUCTION address unless that variable is set
// for Preview.
//
// It sits in the page's normal flow, under the team header and above the two
// possession tabs: it pushes the tabs down by its own height and covers
// nothing. It does not change with the tab (one card per game).
//
// BUNDLE RULE: this file imports React, next/link and matchup-links only. It
// must never reach lib/stats/matchup-card.ts or matchup-colours.ts (they bring
// the team stat modules with them; a test walks the imports).
"use client";

import { useState } from "react";
import Link from "next/link";
import {
  MATCHUP_COPIED_TEXT,
  MATCHUP_COPY_FAILED_TEXT,
  MATCHUP_COPY_LINK_TEXT,
  MATCHUP_DOWNLOAD_TEXT,
  MATCHUP_OPEN_CARD_TEXT,
  MATCHUP_SHARE_HEADING,
} from "@/lib/stats/matchup-links";

interface MatchupShareProps {
  /** The share page's absolute URL, away first, ?season= only for a past season. */
  shareUrl: string;
  /** The same page as a site-relative link. */
  cardHref: string;
  /** The image route with this season and download=1. */
  downloadHref: string;
}

const BARLOW = "font-[family-name:var(--font-barlow)]";
const BUTTON = "min-w-0 flex-1 cursor-pointer border px-2 py-2 text-[13px] font-semibold leading-snug transition-colors md:px-4";
/** From md a button is as wide as its words (all but the failed-copy one, which fills its row). */
const OWN_WIDTH = "md:flex-none";

export default function MatchupShare({ shareUrl, cardHref, downloadHref }: MatchupShareProps) {
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

  // Navy at rest (the selected tab's colour), green once copied, slate when the copy did not happen.
  // The failure sentence is long, so for its four seconds the layout gives it room:
  // - on a phone its button takes the whole row (two lines at 320 px, measured; four when it
  //   shared the row) and Download drops under it;
  // - from md the two buttons move to a row of their own under the heading and the link, the
  //   sentence filling it and Download beside it, so the heading never wraps and Download never
  //   drops (at 768 px both happened when everything stayed on one row: PR 2 chaos F6).
  const failed = copy === "failed";
  const tone =
    copy === "copied" ? `border-green-700 bg-green-700 ${OWN_WIDTH}`
    : failed ? "basis-full border-slate-600 bg-slate-600 md:basis-0"
    : `border-navy bg-navy ${OWN_WIDTH}`;

  return (
    <div
      data-matchup-share
      data-share-url={shareUrl}
      data-download-href={downloadHref}
      className={`mt-4 flex min-w-0 flex-col gap-x-4 gap-y-2 border border-slate-200 bg-white px-3 py-[10px] md:flex-row md:items-center${failed ? " md:flex-wrap" : ""}`}
    >
      <span data-matchup-share-heading className={`${BARLOW} text-[17px] font-semibold uppercase leading-tight tracking-[0.04em] text-navy md:text-[19px]`}>
        {MATCHUP_SHARE_HEADING}
      </span>
      <div className={`flex min-w-0 flex-wrap gap-2 ${failed ? "md:order-last md:basis-full" : "md:ml-auto"}`}>
        <button type="button" onClick={handleCopyLink} className={`${BUTTON} text-white ${tone}`}>
          {copy === "copied" ? MATCHUP_COPIED_TEXT : failed ? MATCHUP_COPY_FAILED_TEXT : MATCHUP_COPY_LINK_TEXT}
        </button>
        <button type="button" onClick={handleDownload} className={`${BUTTON} ${OWN_WIDTH} border-slate-300 bg-white text-slate-900`}>
          {MATCHUP_DOWNLOAD_TEXT}
        </button>
      </div>
      {/* prefetch={false}: by default next/link asks the server for the share
          page's route tree as soon as this is on screen, one function run per
          matchup looked at. The share route has no loading file, so that
          request reads nothing today; revisit this before ever adding one. */}
      <Link
        href={cardHref}
        prefetch={false}
        className={`text-[13px] font-semibold text-slate-600 underline underline-offset-2 hover:text-slate-900${failed ? " md:ml-auto" : ""}`}
      >
        {MATCHUP_OPEN_CARD_TEXT}
      </Link>
    </div>
  );
}
