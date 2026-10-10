// The nav (team stats spec §7): Team Stats sits right after Team Tiers,
// carries ?season= like the other data pages, and is styled active on its page.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";

const nav = vi.hoisted(() => ({ params: new URLSearchParams(), pathname: "/" }));

vi.mock("next/navigation", () => ({
  useSearchParams: () => nav.params,
  usePathname: () => nav.pathname,
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));
vi.mock("@/components/search/SearchPalette", () => ({ default: () => null }));
// The sheet is a portal that renders nothing while closed; stand in for it so
// the mobile list can be read.
vi.mock("@/components/ui/sheet", () => ({
  Sheet: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SheetTrigger: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
  SheetContent: ({ children }: { children: React.ReactNode }) => <div data-sheet-content>{children}</div>,
}));

import Navbar from "@/components/layout/Navbar";

function desktopLinks(pathname = "/", query = "") {
  nav.pathname = pathname;
  nav.params = new URLSearchParams(query);
  const { container } = render(<Navbar />);
  const row = container.querySelector("nav div.hidden.md\\:flex");
  if (!row) throw new Error("no desktop link row");
  return { row, links: Array.from(row.querySelectorAll("a")) };
}

/** The mobile sheet's links (the sheet is mocked open: its content renders inline). */
function mobileLinks(pathname = "/", query = "") {
  nav.pathname = pathname;
  nav.params = new URLSearchParams(query);
  const { container } = render(<Navbar />);
  const sheet = container.querySelector("[data-sheet-content]");
  if (!sheet) throw new Error("no mobile sheet");
  return Array.from(sheet.querySelectorAll("a"));
}

beforeEach(() => {
  nav.pathname = "/";
  nav.params = new URLSearchParams();
});

describe("Navbar", () => {
  it("lists Team Tiers, Team Stats, Matchups, Passing, … in that order (ten labels)", () => {
    const { links } = desktopLinks();
    expect(links.map((a) => a.textContent)).toEqual([
      "Team Tiers", "Team Stats", "Matchups", "Passing", "Receiving", "Rushing", "Run Gaps", "Trends", "Compare", "Glossary",
    ]);
  });

  it("Matchups → /matchup, right after Team Stats, and never carries ?season= (the index is always the newest season)", () => {
    expect(desktopLinks().links[2].getAttribute("href")).toBe("/matchup");
    expect(desktopLinks("/rushing", "season=2025").links[2].getAttribute("href")).toBe("/matchup");
    expect(mobileLinks("/rushing", "season=2025").find((a) => a.textContent === "Matchups")?.getAttribute("href")).toBe("/matchup");
  });

  it.each(["/matchup", "/matchup/BUF/LA"])("Matchups is active on %s in BOTH the desktop row and the mobile sheet", (path) => {
    const desk = desktopLinks(path).links;
    expect(desk[2].className).toContain("text-navy font-semibold");
    expect(desk.filter((a) => a.className.includes("font-semibold")).map((a) => a.textContent)).toEqual(["Matchups"]);
    const mobile = mobileLinks(path);
    expect(mobile.filter((a) => a.className.split(/\s+/).includes("text-navy")).map((a) => a.textContent)).toEqual(["Matchups"]);
  });

  it("a child path does not light up a link that merely shares a prefix (/team-stats is not under /teams)", () => {
    const { links } = desktopLinks("/team-stats");
    expect(links.filter((a) => a.className.includes("font-semibold")).map((a) => a.textContent)).toEqual(["Team Stats"]);
    expect(desktopLinks("/team/BUF").links.filter((a) => a.className.includes("font-semibold"))).toHaveLength(0);
  });

  it("Team Stats → /team-stats, carrying ?season= like the other data pages", () => {
    expect(desktopLinks().links[1].getAttribute("href")).toBe("/team-stats");
    const { links } = desktopLinks("/rushing", "season=2025");
    expect(links[1].getAttribute("href")).toBe("/team-stats?season=2025");
    expect(links[0].getAttribute("href")).toBe("/teams?season=2025");
    expect(links.find((a) => a.textContent === "Glossary")?.getAttribute("href")).toBe("/glossary");
  });

  it("Team Stats is active on /team-stats", () => {
    const { links } = desktopLinks("/team-stats");
    expect(links[1].className).toContain("text-navy font-semibold");
    expect(links[0].className).not.toContain("font-semibold");
  });

  it("the desktop row is gap-3, gap-6 from xl (measured 2026-09-28: no label wraps at 1024, one line at 1280)", () => {
    const { row } = desktopLinks();
    const cls = row.className.split(/\s+/);
    expect(cls).toContain("gap-3");
    expect(cls).toContain("xl:gap-6");
    expect(cls).not.toContain("gap-8");
    expect(cls).not.toContain("gap-6");
  });
});
