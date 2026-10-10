// app/matchup/[away]/[home]/MatchupShare.tsx — "Share this matchup" on the
// matchup page (matchup card spec 2026-10-11 §8.2, PR 2): Copy Link, Download
// Image and a link to the share card. The Compare page's Share block with its
// own words (matchup-links.ts) and no red: on matchup pages red has one job.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";

vi.mock("next/link", () => ({
  default: ({ href, children, prefetch, ...rest }: { href: string; children: React.ReactNode; prefetch?: boolean }) => (
    <a href={href} data-prefetch={prefetch === undefined ? undefined : String(prefetch)} {...rest}>
      {children}
    </a>
  ),
}));

import MatchupShare from "@/app/matchup/[away]/[home]/MatchupShare";

const PROPS = {
  shareUrl: "https://yardsperpass.com/card/matchup/BUF/LA",
  cardHref: "/card/matchup/BUF/LA",
  downloadHref: "/api/matchup-card/BUF/LA?season=2026&w=5&download=1",
};
const FAILED = "Copy failed: open the share card and copy its address";
const writeText = vi.fn();
const show = (props = PROPS) => render(<MatchupShare {...props} />).container;
const classesOf = (el: Element) => (el.getAttribute("class") ?? "").split(/\s+/);

beforeEach(() => {
  writeText.mockReset();
  writeText.mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("the Share block on the matchup page", () => {
  it("the heading, Copy Link, Download Image and a link to the share card that is never prefetched", () => {
    const el = show();
    const block = el.querySelector("[data-matchup-share]")!;
    expect(block.querySelector("[data-matchup-share-heading]")?.textContent).toBe("Share this matchup");
    expect(Array.from(block.querySelectorAll("button")).map((b) => b.textContent)).toEqual(["Copy Link", "Download Image"]);
    const open = block.querySelector("a")!;
    expect([open.textContent, open.getAttribute("href"), open.getAttribute("data-prefetch")]).toEqual(["Open share card →", "/card/matchup/BUF/LA", "false"]);
    expect(block.getAttribute("data-share-url")).toBe(PROPS.shareUrl);
    expect(block.getAttribute("data-download-href")).toBe(PROPS.downloadHref);
  });

  it("Copy Link copies the share page's absolute URL it was handed, never this page's address", async () => {
    show({ ...PROPS, shareUrl: "https://preview.example/card/matchup/BUF/LA?season=2025" });
    fireEvent.click(screen.getByText("Copy Link"));
    await screen.findByText("Copied!");
    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText).toHaveBeenCalledWith("https://preview.example/card/matchup/BUF/LA?season=2025");
    expect(writeText.mock.calls[0][0]).not.toContain(window.location.host);
  });

  it("Copied! is green and only shown after the clipboard took it", async () => {
    show();
    expect(screen.queryByText("Copied!")).toBeNull();
    fireEvent.click(screen.getByText("Copy Link"));
    const button = await screen.findByText("Copied!");
    expect(classesOf(button).some((c) => /^bg-green-\d00$/.test(c))).toBe(true);
    expect(screen.queryByText("Copy Link")).toBeNull();
  });

  it("when nothing reaches the clipboard it says so, in slate and not in red, and never says Copied!", async () => {
    writeText.mockRejectedValue(new Error("NotAllowedError"));
    (document as unknown as { execCommand: () => boolean }).execCommand = () => false;
    show();
    fireEvent.click(screen.getByText("Copy Link"));
    const button = await screen.findByText(FAILED);
    expect(screen.queryByText("Copied!")).toBeNull();
    expect(classesOf(button)).toContain("bg-slate-600");
    // The long sentence takes the whole row on a phone (two lines at 320 px, measured), not a quarter of it.
    expect(classesOf(button)).toContain("basis-full");
    // Chaos F6 (PR 2): from md the sentence gets a row of its own with Download beside it, under the
    // heading and the link, so the heading never wraps and Download never drops (it did at 768 px).
    expect(classesOf(button)).toEqual(expect.arrayContaining(["md:basis-0", "flex-1"]));
    expect(classesOf(button)).not.toContain("md:flex-none");
    const block = button.closest("[data-matchup-share]")!;
    expect(classesOf(block)).toContain("md:flex-wrap");
    expect(classesOf(button.parentElement!)).toEqual(expect.arrayContaining(["md:order-last", "md:basis-full"]));
    expect(classesOf(button.parentElement!)).not.toContain("md:ml-auto");
    expect(classesOf(block.querySelector("a")!)).toContain("md:ml-auto");
    const download = screen.getByText("Download Image");
    expect(classesOf(download)).toContain("md:flex-none");
  });

  it("at rest and once copied the block is one row from md: the buttons pushed right, each its own width", async () => {
    const el = show();
    const block = el.querySelector("[data-matchup-share]")!;
    const check = () => {
      expect(classesOf(block)).not.toContain("md:flex-wrap");
      const group = block.querySelector("button")!.parentElement!;
      expect(classesOf(group)).toContain("md:ml-auto");
      expect(classesOf(group)).not.toContain("md:order-last");
      for (const b of Array.from(block.querySelectorAll("button"))) expect(classesOf(b)).toContain("md:flex-none");
      expect(classesOf(block.querySelector("a")!)).not.toContain("md:ml-auto");
    };
    check();
    fireEvent.click(screen.getByText("Copy Link"));
    await screen.findByText("Copied!");
    check();
    expect(button.getAttribute("class")).not.toMatch(/red/);
  });

  it("a browser with no clipboard API at all: the old copy command is used, and Copied! only because it said so", async () => {
    Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true });
    const exec = vi.fn(() => true);
    (document as unknown as { execCommand: unknown }).execCommand = exec;
    show();
    fireEvent.click(screen.getByText("Copy Link"));
    await screen.findByText("Copied!");
    expect(exec).toHaveBeenCalledWith("copy");
    // The helper input is gone again.
    expect(document.body.querySelector(":scope > input")).toBeNull();
  });

  it("the clipboard API refuses but the old copy command works: Copied!", async () => {
    writeText.mockRejectedValue(new Error("NotAllowedError"));
    const exec = vi.fn(() => true);
    (document as unknown as { execCommand: unknown }).execCommand = exec;
    show();
    fireEvent.click(screen.getByText("Copy Link"));
    await screen.findByText("Copied!");
    expect(writeText).toHaveBeenCalledTimes(1);
    expect(exec).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(FAILED)).toBeNull();
  });

  it("the old copy command throws (or does not exist): the failure text, no crash", async () => {
    writeText.mockRejectedValue(new Error("NotAllowedError"));
    (document as unknown as { execCommand: unknown }).execCommand = () => {
      throw new Error("not supported");
    };
    show();
    fireEvent.click(screen.getByText("Copy Link"));
    await screen.findByText(FAILED);
    expect(document.body.querySelector(":scope > input")).toBeNull();
  });

  it("the state goes back to Copy Link by itself: two seconds after a copy, four after a failure", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const click = () => act(async () => { fireEvent.click(screen.getByText("Copy Link")); });
    const pass = (ms: number) => act(async () => { vi.advanceTimersByTime(ms); });
    try {
      show();
      await click();
      expect(screen.queryByText("Copied!")).not.toBeNull();
      await pass(1999);
      expect(screen.queryByText("Copied!")).not.toBeNull();
      await pass(1);
      expect(screen.queryByText("Copy Link")).not.toBeNull();
      writeText.mockRejectedValue(new Error("no"));
      (document as unknown as { execCommand: () => boolean }).execCommand = () => false;
      await click();
      expect(screen.queryByText(FAILED)).not.toBeNull();
      await pass(3999);
      expect(screen.queryByText(FAILED)).not.toBeNull();
      await pass(1);
      expect(screen.queryByText("Copy Link")).not.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("Download Image opens the image route with download=1 in a new tab (the route answers with an attachment)", () => {
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    show();
    fireEvent.click(screen.getByText("Download Image"));
    expect(open).toHaveBeenCalledWith(PROPS.downloadHref, "_blank");
  });
});

describe("the file", () => {
  const source = readFileSync(join(process.cwd(), "app", "matchup", "[away]", "[home]", "MatchupShare.tsx"), "utf8");
  const code = source.replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, "").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

  it("is a client component that imports React, next/link and matchup-links only", () => {
    expect(source).toMatch(/^\s*["']use client["'];?\s*$/m);
    const specs = Array.from(code.matchAll(/from\s+["']([^"']+)["']/g)).map((m) => m[1]);
    expect(specs.sort()).toEqual(["@/lib/stats/matchup-links", "next/link", "react"]);
  });

  it("never reads the address bar: what is copied is the URL the server built", () => {
    expect(code).not.toMatch(/window\.location|location\.href|location\.origin/);
  });

  it("no red, nothing that floats over the page, no sideways scroller", () => {
    expect(code).not.toMatch(/red-\d00|#D50A0A|nflred/i);
    expect(code).not.toMatch(/(^|[\s"'`:])(fixed|sticky|absolute)([\s"'`]|$)/m);
    expect(code).not.toMatch(/overflow-|z-\d|z-\[/);
  });

  it("its six strings are matchup-links' (K12), printed as they are", () => {
    for (const name of ["MATCHUP_SHARE_HEADING", "MATCHUP_COPY_LINK_TEXT", "MATCHUP_COPIED_TEXT", "MATCHUP_DOWNLOAD_TEXT", "MATCHUP_OPEN_CARD_TEXT", "MATCHUP_COPY_FAILED_TEXT"]) {
      expect(code, name).toContain(name);
    }
    expect(code).not.toMatch(/["'`](Copy Link|Copied!|Download Image|Share this matchup)["'`]/);
  });
});
